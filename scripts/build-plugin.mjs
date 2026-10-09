import { build } from "esbuild";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

await mkdir("plugin/dist", { recursive: true });
// Older desktop/CLI builds discover the Codex layout. Generate it from the
// portable manifests so both installation paths have one source of truth.
const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
const mcp = JSON.parse(await readFile("mcp.json", "utf8"));
await mkdir(".codex-plugin", { recursive: true });
await writeFile(
  ".codex-plugin/plugin.json",
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      ...manifest.extensions["com.openai"],
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  ".mcp.json",
  JSON.stringify(
    {
      mcpServers: Object.fromEntries(
        Object.entries(mcp.mcpServers).map(([name, { type, ...server }]) => [
          name,
          server,
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
const runtime = await build({
  entryPoints: ["plugin/sdk-entry.mjs"],
  outfile: "plugin/dist/sdk.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  metafile: true,
  legalComments: "linked",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
const ui = await build({
  entryPoints: ["plugin/entry.tsx"],
  outfile: "plugin/dist/editor.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "inline",
});
const js = ui.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = ui.outputFiles.find((f) => f.path.endsWith(".css")).text;
await writeFile(
  "plugin/dist/editor.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scribble</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
);
const packages = new Set();
for (const path of [
  ...Object.keys(runtime.metafile.inputs),
  ...Object.keys(ui.metafile.inputs),
]) {
  const match = path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.add(match[1]);
}
const notices = [];
for (const path of [...packages].sort()) {
  const metadata = JSON.parse(
    await readFile(join(path, "package.json"), "utf8"),
  );
  const licenses = (await readdir(path)).filter((name) =>
    /^licen[cs]e(?:\.|$)/i.test(name),
  );
  const texts = await Promise.all(
    licenses.map((name) => readFile(join(path, name), "utf8")),
  );
  notices.push(
    `${metadata.name} ${metadata.version}\nLicense: ${metadata.license || "See package"}\n\n${texts.join("\n")}`,
  );
}
await writeFile(
  "plugin/dist/THIRD_PARTY_LICENSES.txt",
  notices.join("\n\n---\n\n").replace(/[\t ]+$/gm, "") + "\n",
);
console.log("Built dependency-free plugin runtime and embedded editor.");
