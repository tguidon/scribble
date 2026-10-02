import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { atomicJson, publicSession, sessionDir, loadSession, safeId } from './store.mjs';
import { imageKind, validateDraft } from './validation.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.json':'application/json' };
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function body(req, max = 4 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) fail(413, 'This file is too large. Maximum image size is 20 MB.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function json(req) { try { return JSON.parse((await body(req)).toString()); } catch (e) { if (e.status) throw e; fail(400, 'Invalid JSON.'); } }
function reply(res, status, data) { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(data)); }
export async function startServer({ root, session: initial, port = 0, dev = false }) {
  const initialSession = initial;
  let queue = Promise.resolve();

  const vite = dev ? await (await import('vite')).createServer({ root: resolve(appRoot, '../..'), server: { middlewareMode: true }, appType:'spa' }) : null;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    try {
      const host = req.headers.host;
      if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) fail(403, 'Use the local Scribble URL.');
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) fail(403, 'Cross-origin requests are not allowed.');
      if (!dev) res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed.');
        if (vite) return vite.middlewares(req, res);
        const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
        const file = resolve(appRoot, 'app', `.${path}`);
        if (!file.startsWith(join(appRoot, 'app') + '/')) fail(404, 'Not found.');
        const bytes = await readFile(file).catch(() => null);
        if (!bytes) fail(404, 'Not found. Build Scribble with npm run build.');
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      const id = req.headers['x-scribble-session'] || url.searchParams.get('session') || initialSession.id;
      if (!safeId(id)) fail(400, 'Invalid session ID.');
      // Serialize reads and writes so concurrent autosaves cannot overwrite submissions.
      const operation = queue.then(async () => {
        let session = await loadSession(root, id).catch(() => null);
        if (!session || (req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('token')) !== session.token) fail(401, 'This session link has expired or is incomplete. Open the URL printed by Scribble.');
        const dir = sessionDir(root, session.id);
        const persist = async () => { await atomicJson(join(dir, 'session.json'), session); };
        const receipt = await readFile(join(dir, 'feedback.json'), 'utf8').then(JSON.parse).catch(e => { if(e.code === 'ENOENT') return null; throw e; });
        if(receipt && session.status !== 'submitted') { session.status = 'submitted'; session.submittedAt = receipt.submittedAt; await persist(); }
        if (req.method === 'GET' && url.pathname === '/api/session') return reply(res, 200, publicSession(session));
        if (req.method === 'GET' && url.pathname.startsWith('/api/images/')) {
          const id = url.pathname.split('/').pop(); const image = session.images.find(i => i.id === id);
          if (!image) fail(404, 'Screenshot not found.');
          res.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control':'private, max-age=31536000, immutable' });
          return res.end(await readFile(join(dir, 'images', image.file)));
        }
        if (req.method === 'GET' && url.pathname === '/api/feedback') {
          if (session.status !== 'submitted') fail(404, 'Feedback has not been sent yet.');
          res.setHeader('Content-Disposition', 'attachment; filename="scribble-feedback.json"');
          return reply(res, 200, JSON.parse(await readFile(join(dir, 'feedback.json'), 'utf8')));
        }
        if (session.status !== 'draft') fail(409, 'This feedback has already been sent. Start a new session for more feedback.');
        if (req.method === 'POST' && url.pathname === '/api/images') {
          if (session.images.length >= 30) fail(400, 'A session can have up to 30 screenshots.');
          const width = Number(url.searchParams.get('width')); const height = Number(url.searchParams.get('height'));
          if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 40000000) fail(400, 'Image dimensions exceed the 40 megapixel limit.');
          const bytes = await body(req, 20 * 1024 * 1024); const kind = imageKind(bytes); const id = randomUUID();
          const image = { id, name: (url.searchParams.get('name') || 'Screenshot').slice(0,200), width, height, file: `${id}.${kind.extension}`, mime: kind.mime, annotations: [] };
          await writeFile(join(dir, 'images', image.file), bytes, { mode:0o600 });
          session = { ...session, images:[...session.images, image], revision:session.revision + 1, updatedAt:new Date().toISOString() };
          await persist(); return reply(res, 201, publicSession(session));
        }
        if (req.method === 'PUT' && url.pathname === '/api/draft') {
          const draft = validateDraft(await json(req), session);
          session = { ...session, ...draft, revision:session.revision + 1, updatedAt:new Date().toISOString() };
          await persist(); return reply(res, 200, publicSession(session));
        }
        if (req.method === 'POST' && url.pathname === '/api/submit') {
          const input = await json(req);
          if (input.revision !== session.revision) fail(409, 'The draft changed. Save it again before sending.');
          if (!session.images.length) fail(400, 'Add at least one screenshot before sending.');
          const submittedAt = new Date().toISOString();
          const bundle = { version:1, sessionId:session.id, title:session.title, submittedAt, message:session.message, coordinateSystem:'Original image pixels, origin at top-left. Points are x/y pairs.', images: session.images.map(image => ({ ...image, path: join(dir, 'images', image.file), annotations:image.annotations.map((a,index) => ({...a, number:index+1})) })) };
          // feedback.json is the commit marker read by waiting agents.
          await atomicJson(join(dir, 'feedback.json'), bundle);
          session = { ...session, status:'submitted', submittedAt, updatedAt:submittedAt };
          await persist(); return reply(res, 200, { ...publicSession(session), bundlePath:join(dir,'feedback.json') });
        }
        fail(404, 'Not found.');
      });
      queue = operation.catch(() => {}); await operation;
    } catch (error) {
      if (!res.headersSent) reply(res, error.status || 500, { error: error.status ? error.message : 'Scribble could not save this change. Your browser draft is still available. Try again.' });
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  await new Promise((resolve, reject) => { server.once('error',reject); server.listen(port, '127.0.0.1',resolve); });
  const actualPort = server.address().port;
  const session = initialSession;
  const url = `http://127.0.0.1:${actualPort}/#token=${session.token}&session=${session.id}`;
  const info = { pid:process.pid, port:actualPort, url, sessionId:session.id, root };
  await mkdir(root, {recursive:true, mode:0o700}); await atomicJson(join(root, 'server.json'), info);
  return { server, url, session:publicSession(session), close:async () => { await vite?.close(); await new Promise(resolve => server.close(resolve)); }, info };
}
