import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPlugin } from "../plugin/mcp.mjs";
import { createSession } from "../skills/scribble/scripts/lib/store.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";

let project: string, origin: string, result: any, messages: any[];
let calls: string[];
let http: Awaited<ReturnType<typeof startServer>>,
  plugin: ReturnType<typeof createPlugin>,
  host: ReturnType<typeof createServer>,
  client: Client;
test.beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "scribble-plugin-browser-"));
  const root = join(project, ".scribble");
  http = await startServer({ root, session: await createSession(root) });
  plugin = createPlugin({ directory: join(project, "registry") });
  client = new Client({ name: "browser-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await plugin.server.connect(back);
  await client.connect(front);
  result = await client.callTool({
    name: "open_canvas",
    arguments: { projectPath: project },
  });
  messages = [];
  calls = [];
  const script = (
    await build({
      entryPoints: ["test/plugin-host.ts"],
      bundle: true,
      write: false,
      format: "esm",
    })
  ).outputFiles[0].text;
  const editor = await readFile("plugin/dist/editor.html", "utf8");
  host = createServer(async (req, res) => {
    try {
      if (req.url === "/host" || req.url?.startsWith("/host?")) {
        const params = new URL(req.url, "http://fixture").searchParams;
        res.setHeader("Content-Type", "text/html");
        res.end(
          `<html><body style="margin:0"><iframe title="Scribble plugin" sandbox="allow-scripts allow-downloads" style="border:0;width:100%;height:100vh"></iframe><script>window.fixture=${JSON.stringify({ result, canSend: !params.has("no-send"), reject: params.has("reject") }).replaceAll("<", "\\u003c")}</script><script type="module" src="/host.js"></script></body></html>`,
        );
      } else if (req.url === "/host.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else if (req.url === "/editor") {
        res.setHeader("Content-Type", "text/html");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob:",
        );
        res.end(editor);
      } else {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const data = JSON.parse(Buffer.concat(chunks).toString());
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/tool") {
          calls.push(
            `${data.name} ${data.arguments.sessionId} ${data.arguments.path || ""}`,
          );
          res.end(JSON.stringify(await client.callTool(data)));
        } else if (req.url === "/message") {
          messages.push(data);
          res.end("{}");
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(host.address() as { port: number }).port}`;
});
test.afterEach(async () => {
  await client.close();
  await plugin.close();
  await http.close();
  host.closeAllConnections();
  await new Promise<void>((resolve) => host.close(() => resolve()));
  await rm(project, { recursive: true, force: true });
});

for (const width of [1440, 390])
  test(`sandboxed editor sends feedback and starts another round at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Plugin browser error:", error.message);
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/host`);
    const ui = page.frameLocator("iframe");
    await expect(ui.getByRole("heading", { name: /A picture/ })).toBeVisible();
    await ui.getByRole("button", { name: "Try an example" }).click();
    await ui
      .getByRole("textbox", { name: "The bigger picture" })
      .fill("Improve this example's spacing.");
    await ui.getByRole("button", { name: "Finish feedback" }).click();
    await expect(
      ui.getByRole("heading", { name: "Ready for your agent." }),
    ).toBeVisible();
    await ui.getByRole("button", { name: "Send to this chat" }).click();
    await expect(
      ui.getByRole("button", { name: "Message accepted" }),
    ).toBeVisible();
    expect(messages).toHaveLength(1);
    expect(messages[0].content[0].text).toContain(
      result.structuredContent.sessionId,
    );
    expect(messages[0].content[0].text).not.toContain(
      result._meta.scribble.token,
    );
    const feedback = await client.callTool({
      name: "read_feedback",
      arguments: { sessionId: result.structuredContent.sessionId },
    });
    expect(feedback.isError).not.toBe(true);
    await expect(
      ui.getByRole("button", { name: "Feedback read" }),
    ).toBeVisible();
    if (process.env.SCRIBBLE_VISUAL_TEST)
      await page.screenshot({
        path: `.impeccable/review/plugin-${width}.png`,
        fullPage: true,
      });
    await ui.getByRole("button", { name: "New canvas" }).click();
    await expect(ui.getByRole("heading", { name: /A picture/ }))
      .toBeVisible()
      .catch(async (error) => {
        console.error("Plugin calls:", calls);
        throw error;
      });
    expect(errors).toEqual([]);
  });

test("hosts that cannot send messages keep a copy fallback and never claim delivery", async ({
  page,
}) => {
  await page.goto(`${origin}/host?no-send`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  await expect(
    ui.getByText("This host does not support direct messages.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    ui.getByRole("button", { name: "Send to this chat" }),
  ).toHaveCount(0);
  await expect(
    ui.getByRole("button", { name: "Copy for agent" }),
  ).toBeEnabled();
  expect(messages).toEqual([]);
});

test("host rejection leaves feedback saved and offers manual delivery", async ({
  page,
}) => {
  await page.goto(`${origin}/host?reject`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  await ui.getByRole("button", { name: "Send to this chat" }).click();
  await expect(ui.getByRole("alert")).toContainText("declined");
  await expect(
    ui.getByRole("button", { name: "Message accepted" }),
  ).toHaveCount(0);
  expect(messages).toEqual([]);
});
