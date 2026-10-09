import { test, expect, type Locator } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
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
// Visibility alone does not prove that an SVG image decoded; broken images
// still occupy their full canvas rectangle.
async function expectDecodedScreenshot(image: Locator) {
  await expect(image).toBeVisible();
  const size = await image.evaluate(async (element) => {
    const bitmap = new Image();
    bitmap.src = element.getAttribute("href")!;
    await bitmap.decode();
    return { width: bitmap.naturalWidth, height: bitmap.naturalHeight };
  });
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
}
let http: Awaited<ReturnType<typeof startServer>>,
  plugin: ReturnType<typeof createPlugin>,
  host: ReturnType<typeof createServer>,
  client: Client;
test.beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "scribble-plugin-browser-"));
  const root = join(project, ".scribble");
  const simCommand = join(project, "simulator.mjs");
  http = await startServer({
    root,
    session: await createSession(root),
    captureOptions: {
      discovery: { list: async () => "" },
      web: { headless: true, channel: "chrome" },
      simulator: {
        devices: async () => [
          { id: "00000000-0000-0000-0000-000000000001", name: "Plugin iPhone" },
        ],
        command: { file: process.execPath, args: [simCommand] },
      },
    },
  });
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
      if (req.url === "/fixture") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<title>Plugin capture fixture</title><h1>A live page</h1><input placeholder="Feedback target">',
        );
      } else if (req.url === "/config" || req.url === "/foreground") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            orientation: "portrait",
            bundleId: "dev.scribble.fixture",
          }),
        );
      } else if (req.url === "/stream.mjpeg") {
        const bytes = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        );
        res.writeHead(200, {
          "Content-Type": "multipart/x-mixed-replace; boundary=frame",
        });
        res.write(
          `--frame\r\nContent-Type: image/png\r\nContent-Length: ${bytes.length}\r\n\r\n`,
        );
        res.write(bytes);
        res.write("\r\n");
      } else if (req.url === "/host" || req.url?.startsWith("/host?")) {
        const params = new URL(req.url, "http://fixture").searchParams;
        res.setHeader("Content-Type", "text/html");
        res.end(
          `<html><body style="margin:0"><iframe title="Scribble plugin" sandbox="allow-scripts allow-downloads" style="border:0;width:100%;height:100vh"></iframe><script>window.fixture=${JSON.stringify({ result, canSend: !params.has("no-send"), reject: params.has("reject"), fitContent: params.has("fit-content"), inline: params.has("inline"), rejectExpand: params.has("reject-expand") }).replaceAll("<", "\\u003c")}</script><script type="module" src="/host.js"></script></body></html>`,
        );
      } else if (req.url === "/host.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else if (req.url === "/editor") {
        res.setHeader("Content-Type", "text/html");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:",
        );
        res.end(
          editor.replace(
            "</body>",
            `<script>
          let previous = 0;
          new ResizeObserver(() => {
            const height = Math.ceil(Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height));
            if (height !== previous) {
              previous = height;
              parent.postMessage({ type: "fixture-size", height }, "*");
            }
          }).observe(document.body);
        </script></body>`,
          ),
        );
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
  await writeFile(
    simCommand,
    `console.log(JSON.stringify(${JSON.stringify({ device: "00000000-0000-0000-0000-000000000001", url: origin, streamUrl: `${origin}/stream.mjpeg` })}))`,
  );
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    console.error(
      "Plugin state:",
      await page
        .frameLocator("iframe")
        .locator("body")
        .innerText()
        .catch(() => "Unavailable"),
    );
    console.error("Plugin calls:", calls);
  }
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
    await expectDecodedScreenshot(ui.locator(".image-stage image"));
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

test("uploaded screenshot decodes with desktop CSP and survives reopening the plugin", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy"))
      violations.push(message.text());
  });
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await expect(
    ui.getByRole("button", { name: "Add screenshots", exact: true }),
  ).toBeEnabled();
  await ui
    .locator('input[type="file"]')
    .setInputFiles("docs/images/scribble.png");
  await expectDecodedScreenshot(ui.locator(".image-stage image"));
  await expect(ui.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.reload();
  await expectDecodedScreenshot(ui.locator(".image-stage image"));
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  await ui.getByRole("button", { name: "Send to this chat" }).click();
  await expect(
    ui.getByRole("button", { name: "Message accepted" }),
  ).toBeVisible();
  const feedback: any = await client.callTool({
    name: "read_feedback",
    arguments: { sessionId: result.structuredContent.sessionId },
  });
  const original: any = await client.callTool({
    name: "read_image",
    arguments: {
      sessionId: result.structuredContent.sessionId,
      imageId: feedback.structuredContent.images[0].id,
    },
  });
  expect(Buffer.from(original.content[0].data, "base64")).toEqual(
    await readFile("docs/images/scribble.png"),
  );
  expect(violations).toEqual([]);
});

test("restored chat cards stay compact, allow chat scrolling, and reopen the saved canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.goto(`${origin}/host?inline&fit-content`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await ui.getByRole("button", { name: "Try an example" }).click();
  await expectDecodedScreenshot(ui.locator(".image-stage image"));
  await expect(ui.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    ui.getByRole("button", { name: "Open canvas", exact: true }),
  ).toBeEnabled();
  await expect(ui.locator(".app")).toHaveCount(0);
  await page.waitForTimeout(600);
  const heights = await page.evaluate(
    () => (window as any).fixtureHeights as number[],
  );
  expect(heights.length).toBeGreaterThan(0);
  expect(heights.length).toBeLessThan(10);
  expect(Math.max(...heights)).toBeLessThan(320);
  // Wheel over the card must reach the conversation, not a hidden canvas.
  await page.evaluate(() => {
    document.body.style.paddingBottom = "2000px";
  });
  await ui.getByRole("heading", { name: "Scribble", exact: true }).hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expectDecodedScreenshot(ui.locator(".image-stage image"));
  await ui
    .getByRole("textbox", { name: "The bigger picture" })
    .fill("Still usable after reopening.");
  await expect(ui.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).fixtureDisplayMode("inline"));
  await expect(ui.locator(".app")).toHaveCount(0);
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(
    ui.getByRole("textbox", { name: "The bigger picture" }),
  ).toHaveValue("Still usable after reopening.");
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  await expect(
    ui.getByRole("heading", { name: "Ready for your agent." }),
  ).toBeVisible();
});

test("expanded canvases follow the host height and collapse back to a card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.goto(`${origin}/host?inline`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(ui.locator("#root")).toHaveCSS("height", "1000px");
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(ui.locator("#root")).toHaveCSS("height", "800px");
  await page.evaluate(() => (window as any).fixtureDisplayMode("inline"));
  await expect(
    ui.getByRole("button", { name: "Open canvas", exact: true }),
  ).toBeEnabled();
  await expect(ui.locator(".app")).toHaveCount(0);
});

test("a declined expansion keeps the chat card usable and offers the browser editor", async ({
  page,
}) => {
  await page.goto(`${origin}/host?inline&reject-expand`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(ui.getByRole("alert")).toContainText("Could not open");
  await expect(
    ui.getByRole("button", { name: "Open browser editor" }),
  ).toBeEnabled();
  await expect(ui.locator(".app")).toHaveCount(0);
});

test("narrow expanded editors scroll over an image and keep controls within the panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await expectDecodedScreenshot(ui.locator(".image-stage image"));
  await ui.locator(".viewport").hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => ui.locator("#root").evaluate((root) => root.scrollTop))
    .toBeGreaterThan(100);
  await expect(
    ui.getByRole("textbox", { name: "The bigger picture" }),
  ).toBeInViewport();
  await ui.getByRole("button", { name: "Pan (H)" }).click();
  await ui.locator("#root").evaluate((root) => {
    root.scrollTop = 0;
  });
  const transform = ui.locator(".image-transform");
  const originalTransform = await transform.getAttribute("style");
  await ui.locator(".viewport").hover();
  await page.mouse.wheel(0, 80);
  await expect
    .poll(() => transform.getAttribute("style"))
    .not.toBe(originalTransform);
  expect(await ui.locator("#root").evaluate((root) => root.scrollTop)).toBe(0);
  for (const width of [320, 390, 570, 980, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await ui.locator("#root").evaluate((root) => {
      root.scrollTop = 0;
    });
    await expect(
      ui.getByRole("button", { name: "Add images", exact: true }),
    ).toBeInViewport();
    await expect(
      ui.getByRole("button", { name: "Capture live app", exact: true }),
    ).toBeInViewport();
    expect(
      await ui
        .locator("#root")
        .evaluate((root) => root.scrollWidth <= root.clientWidth),
    ).toBe(true);
    await ui.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(ui.locator(".help-panel")).toBeInViewport();
    await ui.getByRole("button", { name: "Keyboard shortcuts" }).click();
  }
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

for (const kind of ["web", "simulator"])
  test(`embedded ${kind} live preview crosses the MCP bridge and freezes a capture`, async ({
    page,
  }) => {
    await page.goto(`${origin}/host`);
    const ui = page.frameLocator("iframe");
    await ui
      .getByRole("button", { name: "Capture a webpage or simulator" })
      .click();
    if (kind === "web") {
      await ui.getByLabel("Webpage URL").fill(`${origin}/fixture`);
      await ui
        .getByRole("button", { name: "Open webpage", exact: true })
        .click();
    } else {
      await ui.getByRole("button", { name: "Simulator", exact: true }).click();
      await ui.getByRole("button", { name: "Connect simulator" }).click();
    }
    await expect(
      ui.getByRole("button", { name: "Capture & annotate" }),
    ).toBeEnabled({ timeout: 20000 });
    const image = ui.locator(".live-screen img");
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
    ).toBeGreaterThan(0);
    await ui.getByRole("button", { name: "Capture & annotate" }).click();
    await expectDecodedScreenshot(ui.locator(".image-stage image"));
    await ui.getByRole("button", { name: "Finish feedback" }).click();
    await expect(
      ui.getByRole("heading", { name: "Ready for your agent." }),
    ).toBeVisible();
    const feedback: any = await client.callTool({
      name: "read_feedback",
      arguments: { sessionId: result.structuredContent.sessionId },
    });
    expect(feedback.structuredContent.images[0].source.kind).toBe(kind);
  });

test("upload drop overlay stays inside the viewport after scrolling the expanded editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await expectDecodedScreenshot(ui.locator(".image-stage image"));
  await ui.locator("#root").evaluate((root) => {
    root.scrollTop = 500;
  });
  await ui.locator(".app").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["fixture"], "fixture.png", { type: "image/png" }),
    );
    element.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, dataTransfer }),
    );
  });
  const overlay = ui.locator(".drop-overlay");
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
});
