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

if (process.env.SCRIBBLE_SOAK_FRAMES)
  test.use({ launchOptions: { args: ["--site-per-process"] } });

let project: string, origin: string, result: any, messages: any[];
let calls: string[];
let simulatorFrame: Buffer;
let openSimulatorStreams: number;
// Visibility alone does not prove that an SVG image decoded; broken images
// still occupy their full canvas rectangle.
async function expectDecodedScreenshot(image: Locator) {
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("href", /^data:image\//);
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
  openSimulatorStreams = 0;
  simulatorFrame = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC",
    "base64",
  );
  project = await mkdtemp(join(tmpdir(), "scribble-plugin-browser-"));
  const root = join(project, ".scribble");
  const simCommand = join(project, "simulator.mjs");
  http = await startServer({
    root,
    session: await createSession(root),
    captureOptions: {
      discovery: { list: async () => "" },
      web: { headless: true },
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
          `<title>Plugin capture fixture</title><h1>A live page</h1><input placeholder="Feedback target">
           <div id="stripes" style="position:fixed;top:0;left:0;width:8px;height:8px;background:repeating-linear-gradient(to right,#f00 0 .5px,#00f .5px 1px)"></div>
           <script>document.addEventListener("click", () => document.querySelector("#stripes").style.transform = "scaleX(-1)")</script>`,
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
        res.writeHead(200, {
          "Content-Type": "multipart/x-mixed-replace; boundary=frame",
        });
        const sendFrame = () => {
          const bytes = simulatorFrame;
          res.write(
            `--frame\r\nContent-Type: image/png\r\nContent-Length: ${bytes.length}\r\n\r\n`,
          );
          res.write(bytes);
          res.write("\r\n");
        };
        sendFrame();
        const repeat = setInterval(sendFrame, 50);
        openSimulatorStreams++;
        res.once("close", () => {
          clearInterval(repeat);
          openSimulatorStreams--;
        });
      } else if (req.url === "/host" || req.url?.startsWith("/host?")) {
        const params = new URL(req.url, "http://fixture").searchParams;
        res.setHeader("Content-Type", "text/html");
        res.end(
          `<html><body style="margin:0"><iframe title="Scribble plugin" sandbox="allow-scripts allow-downloads" style="border:0;width:100%;height:100vh"></iframe><script>window.fixture=${JSON.stringify({ result, canSend: !params.has("no-send"), reject: params.has("reject"), fitContent: params.has("fit-content"), inline: params.has("inline"), rejectExpand: params.has("reject-expand"), theme: params.get("theme") || undefined }).replaceAll("<", "\\u003c")}</script><script type="module" src="/host.js"></script></body></html>`,
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
  for (const theme of ["light", "dark"])
    test(`sandboxed editor sends feedback and starts another round at ${width}px in ${theme}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
        console.error("Plugin browser error:", error.message);
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/host?theme=${theme}`);
      const ui = page.frameLocator("iframe");
      await expect(
        ui.getByRole("heading", { name: /A picture/ }),
      ).toBeVisible();
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
        ui.getByRole("status").filter({ hasText: "Message accepted" }),
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
        ui.getByRole("status").filter({ hasText: "Feedback read" }),
      ).toBeVisible();
      await expect(
        ui.getByRole("button", { name: "Feedback read" }),
      ).toHaveCount(0);
      await expect(ui.getByRole("button", { name: "New canvas" })).toHaveClass(
        "primary",
      );
      await expect(
        ui.getByRole("button", { name: "Copy for agent" }),
      ).toHaveClass("text-button");
      await expect(ui.locator(".receipt-note")).toHaveCount(0);
      if (process.env.SCRIBBLE_VISUAL_TEST)
        await page.screenshot({
          path: `.impeccable/review/receipt-${theme}-${width}.png`,
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

test("image failures do not reject saved uploads or edits and retry independently", async ({
  page,
}) => {
  let failImages = true;
  let uploads = 0;
  await page.route("**/tool", async (route) => {
    const params = route.request().postDataJSON();
    if (params.name === "editor_request") {
      if (params.arguments.path.startsWith("/images?")) uploads++;
      if (failImages && params.arguments.path.startsWith("/images/")) {
        await route.fulfill({
          json: {
            isError: true,
            content: [{ type: "text", text: "Image temporarily unavailable" }],
          },
        });
        return;
      }
    }
    await route.continue();
  });
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await expect(ui.getByText("Draft saved", { exact: true })).toBeVisible();
  await expect(ui.getByRole("alert")).toContainText(
    "Image temporarily unavailable",
  );
  await ui
    .getByLabel("The bigger picture")
    .fill("Saved despite image download failure");
  await expect(ui.getByText("Draft saved", { exact: true })).toBeVisible();
  failImages = false;
  await ui.getByRole("button", { name: "Retry image", exact: true }).click();
  await expectDecodedScreenshot(ui.locator(".image-stage image"));
  expect(uploads).toBe(1);
  await page.reload();
  await expect(ui.getByLabel("The bigger picture")).toHaveValue(
    "Saved despite image download failure",
  );
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
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
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
  await expect(
    ui.getByRole("button", { name: "Open canvas", exact: true }),
  ).toBeEnabled();
  expect(calls).toHaveLength(0);
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
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
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
      await ui
        .getByRole("button", { name: "Simulator / Emulator", exact: true })
        .click();
      await ui.getByRole("button", { name: "Connect simulator" }).click();
    }
    await expect(
      ui.getByRole("button", { name: "Capture & annotate" }),
    ).toBeEnabled({ timeout: 20000 });
    if (kind === "web") {
      const image = ui.locator(".live-screen img");
      await expect(image).toBeVisible();
      // Half-CSS-pixel stripes should survive the entire live preview path.
      const readDetail = () =>
        image.evaluate((element: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = 2;
          canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(element, 0, 0);
          return {
            width: element.naturalWidth,
            pixels: Array.from(ctx.getImageData(0, 0, 2, 1).data),
          };
        });
      await expect.poll(readDetail).toEqual({
        width: 2560,
        pixels: [255, 0, 0, 255, 0, 0, 255, 255],
      });
      // A static page sends identical image data when the preview reconnects.
      await ui.getByRole("button", { name: "Reconnect view" }).click();
      await expect(
        ui.getByRole("button", { name: "Capture & annotate" }),
      ).toBeEnabled();
      await image.click();
      await expect.poll(readDetail).toEqual({
        width: 2560,
        pixels: [0, 0, 255, 255, 255, 0, 0, 255],
      });
    } else {
      const canvas = ui.getByRole("img", { name: "Live simulator screen" });
      await expect(canvas).toHaveAttribute("width", "1");
      await expect(ui.locator(".live-screen img")).toHaveCount(0);
      simulatorFrame = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4z8AARAAI/gH/xp559wAAAABJRU5ErkJggg==",
        "base64",
      );
      await expect(canvas).toHaveAttribute("width", "2");
      await expect
        .poll(() =>
          canvas.evaluate((element: HTMLCanvasElement) => [
            ...element.getContext("2d")!.getImageData(0, 0, 1, 1).data,
          ]),
        )
        .toEqual([255, 0, 0, 255]);
    }
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
    await ui.getByRole("button", { name: "Back to live preview" }).click();
    await expect(
      ui.getByRole("button", { name: "Capture & annotate" }),
    ).toBeEnabled();
    await ui.getByRole("button", { name: "Back to annotations" }).click();
    await expect(
      ui.getByRole("button", { name: "Capture a webpage or simulator" }),
    ).toBeVisible();
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

for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`host ${theme} theme stays consistent through the plugin flow at ${width}px`, async ({
      page,
    }) => {
      const opposite = theme === "dark" ? "light" : "dark";
      await page.emulateMedia({ colorScheme: opposite });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/host?inline&theme=${theme}`);
      const ui = page.frameLocator("iframe");
      const background =
        theme === "dark" ? "rgb(34, 34, 31)" : "rgb(246, 243, 236)";
      const checkTheme = async () => {
        await expect(ui.locator("html")).toHaveCSS("color-scheme", theme);
        await expect(ui.locator("body")).toHaveCSS(
          "background-color",
          background,
        );
        if (await ui.locator(".app-header").count())
          await expect(ui.locator(".app-header")).toHaveCSS(
            "background-color",
            theme === "dark" ? "rgb(41, 41, 37)" : "rgb(253, 252, 248)",
          );
      };
      const capture = async (name: string) => {
        if (!process.env.SCRIBBLE_VISUAL_TEST) return;
        // Host notifications and style assertions can complete before the
        // embedded frame's compositor has painted the new color scheme.
        await ui
          .locator("body")
          .evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
        await page.screenshot({
          path: `.impeccable/review/theme-${theme}-${width}-${name}.png`,
          animations: "disabled",
        });
      };
      await expect(
        ui.getByRole("button", { name: "Open canvas" }),
      ).toBeVisible();
      await checkTheme();
      await capture("card");
      await ui.getByRole("button", { name: "Open canvas" }).click();
      await expect(
        ui.getByRole("heading", { name: /A picture/ }),
      ).toBeVisible();
      await checkTheme(); // Display-mode-only updates must preserve the host theme.
      await ui.getByRole("button", { name: "Capture live app" }).click();
      await expect(ui.getByRole("textbox", { name: /URL/ })).toBeVisible();
      await capture("web");
      await ui
        .getByRole("button", { name: "Simulator / Emulator", exact: true })
        .click();
      await capture("simulator");
      await ui.getByRole("button", { name: "Back to annotations" }).click();
      await ui.getByRole("button", { name: "Try an example" }).click();
      await expectDecodedScreenshot(ui.locator(".image-stage image"));
      const original = await ui
        .locator(".image-stage image")
        .getAttribute("href");
      await ui
        .getByRole("textbox", { name: "The bigger picture" })
        .fill("Keep this feedback while switching themes.");
      await page.evaluate((theme) => window.fixtureTheme(theme), opposite);
      await expect(ui.locator("html")).toHaveCSS("color-scheme", opposite);
      await expect(
        ui.getByRole("textbox", { name: "The bigger picture" }),
      ).toHaveValue("Keep this feedback while switching themes.");
      expect(await ui.locator(".image-stage image").getAttribute("href")).toBe(
        original,
      );
      await page.evaluate((theme) => window.fixtureTheme(theme), theme);
      await checkTheme();
      await ui.locator("#root").evaluate((el) => el.scrollTo(0, 0));
      await capture("editor");
      await ui.getByRole("button", { name: "Finish feedback" }).click();
      await expect(
        ui.getByRole("heading", { name: "Ready for your agent." }),
      ).toBeVisible();
      await checkTheme();
      await capture("receipt");
      await ui.getByRole("button", { name: "Send to this chat" }).click();
      await expect(
        ui.getByRole("status").filter({ hasText: "Message accepted" }),
      ).toBeVisible();
      await checkTheme();
      await ui.getByRole("button", { name: "New canvas" }).click();
      await expect(
        ui.getByRole("heading", { name: /A picture/ }),
      ).toBeVisible();
      await checkTheme();
    });

test("panel collapse preserves image selection, tools, and undo and redo history", async ({
  page,
}) => {
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await expect(
    ui.getByRole("button", { name: "Open Example — Fieldnotes.png" }),
  ).toBeVisible();
  const buffer = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      canvas.getContext("2d")!.fillRect(0, 0, 32, 32);
      return canvas.toDataURL().split(",")[1];
    }),
    "base64",
  );
  await ui
    .getByLabel("Upload screenshots")
    .setInputFiles({ name: "second.png", mimeType: "image/png", buffer });
  await expect(ui.locator(".image-stage")).toHaveAttribute(
    "aria-label",
    /second.png/,
  );
  await ui.locator(".image-stage").press("Enter");
  const comment = ui.getByLabel("Comment for mark 1");
  await comment.fill("Preserve my editing session");
  await ui.getByRole("button", { name: "Arrow (A)", exact: true }).click();
  await ui.getByRole("button", { name: "Blue ink", exact: true }).click();
  await page.evaluate(() => window.fixtureDisplayMode("inline"));
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(ui.locator(".image-stage")).toHaveAttribute(
    "aria-label",
    /second.png/,
  );
  await expect(ui.locator(".comment.active")).toHaveCount(1);
  await expect(
    ui.getByRole("button", { name: "Arrow (A)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    ui.getByRole("button", { name: "Blue ink", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await ui.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(comment).toHaveValue("");
  await page.evaluate(() => window.fixtureDisplayMode("inline"));
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await ui.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(comment).toHaveValue("Preserve my editing session");
});

test("delayed autosave preserves newer edits across repeated panel collapses", async ({
  page,
}) => {
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await expect(ui.getByText("Draft saved", { exact: true })).toBeVisible();
  let release!: () => void;
  let intercepted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  let first = true;
  let completed!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route("**/tool", async (route) => {
    const params = route.request().postDataJSON();
    if (
      first &&
      params.name === "editor_request" &&
      params.arguments.path === "/draft"
    ) {
      first = false;
      intercepted();
      await held;
      const response = await route.fetch();
      await route.fulfill({ response });
      completed();
    } else await route.continue();
  });
  const message = ui.getByRole("textbox", { name: "The bigger picture" });
  await message.fill("First edit held in an old autosave");
  await waiting;
  await page.evaluate(() => (window as any).fixtureDisplayMode("inline"));
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(message).toHaveValue("First edit held in an old autosave");
  await message.fill("Newer edit after reopening");
  release();
  await firstCompleted;
  // Let the old hook handle its success before the new 500ms debounce fires.
  await page.waitForTimeout(50);
  await page.evaluate(() => (window as any).fixtureDisplayMode("inline"));
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(message).toHaveValue("Newer edit after reopening");
  await expect(ui.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(message).toHaveValue("Newer edit after reopening");
});

test("delivery acceptance and read receipts survive panel collapse and reload", async ({
  page,
}) => {
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  await ui.getByRole("button", { name: "Send to this chat" }).click();
  await expect(
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).fixtureDisplayMode("inline"));
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
  ).toBeVisible();
  expect(messages).toHaveLength(1);
  await client.callTool({
    name: "read_feedback",
    arguments: { sessionId: result.structuredContent.sessionId },
  });
  await expect(
    ui.getByRole("status").filter({ hasText: "Feedback read" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    ui.getByRole("status").filter({ hasText: "Feedback read" }),
  ).toBeVisible();
  expect(messages).toHaveLength(1);
  await ui.getByRole("button", { name: "New canvas" }).click();
  await ui.getByRole("button", { name: "Try an example" }).click();
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  await expect(
    ui.getByRole("button", { name: "Send to this chat" }),
  ).toBeEnabled();
});

test("closing the panel while sending never enables a duplicate send", async ({
  page,
}) => {
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  let release!: () => void;
  let intercepted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route("**/message", async (route) => {
    intercepted();
    await held;
    await route.continue();
  });
  await ui.getByRole("button", { name: "Send to this chat" }).click();
  await waiting;
  await page.evaluate(() => (window as any).fixtureDisplayMode("inline"));
  await ui.getByRole("button", { name: "Open canvas", exact: true }).click();
  await expect(
    ui.getByRole("button", { name: "Checking delivery…" }),
  ).toBeDisabled();
  await expect(
    ui.getByRole("button", { name: "Send to this chat" }),
  ).toHaveCount(0);
  release();
  await expect(
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
  ).toBeVisible();
  expect(messages).toHaveLength(1);
});

test("accepted delivery retries receipt storage without sending again", async ({
  page,
}) => {
  await page.goto(`${origin}/host`);
  const ui = page.frameLocator("iframe");
  await ui.getByRole("button", { name: "Try an example" }).click();
  await ui.getByRole("button", { name: "Finish feedback" }).click();
  let records = 0;
  await page.route("**/tool", async (route) => {
    const params = route.request().postDataJSON();
    if (params.name === "record_delivery" && ++records === 1) {
      await route.fulfill({
        json: {
          isError: true,
          content: [
            { type: "text", text: "Temporary receipt storage failure" },
          ],
        },
      });
    } else await route.continue();
  });
  await ui.getByRole("button", { name: "Send to this chat" }).click();
  await expect(
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
  ).toBeVisible();
  await expect.poll(() => records).toBeGreaterThan(1);
  await expect
    .poll(
      async () =>
        (
          await plugin.backend.delivery(
            result._meta.scribble.sessionId,
            result._meta.scribble.token,
          )
        ).acceptedAt,
    )
    .toBeTruthy();
  await page.reload();
  await expect(
    ui.getByRole("status").filter({ hasText: "Message accepted" }),
  ).toBeVisible();
  expect(messages).toHaveLength(1);
});

test("an unattended visible plugin panel stops polling and resumes the same simulator after a workday", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(origin + "/host");
  const ui = page.frameLocator("iframe");
  await ui
    .getByRole("button", { name: "Capture a webpage or simulator" })
    .click();
  await ui.getByRole("button", { name: "Simulator / Emulator" }).click();
  await ui.getByRole("button", { name: "Connect simulator" }).click();
  const capture = ui.getByRole("button", { name: "Capture & annotate" });
  await expect(capture).toBeEnabled();
  await ui.getByText("Type or paste text", { exact: true }).click();
  const text = ui.getByLabel("Text to type in the app");
  await text.fill("Keep this pending text");
  // Leave the focused, static preview on screen for several old poll cycles.
  const frames = () =>
    calls.filter((call) => call.startsWith("live_frame ")).length;
  const initial = frames();
  await new Promise((resolve) => setTimeout(resolve, 3200));
  expect(frames() - initial).toBeLessThanOrEqual(1);
  // Move real keyboard focus out of the iframe while leaving it visible.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.clock.fastForward("00:16");
  await expect(ui.locator(".live-screen canvas")).toHaveAttribute("width", "1");
  await expect(capture).toBeEnabled();
  await expect.poll(() => openSimulatorStreams, { timeout: 32000 }).toBe(0);
  const before = calls.length;
  await page.clock.fastForward("08:00:00");
  expect(calls.length).toBe(before);
  // Returning focus alone must acquire a fresh frame of the same source.
  simulatorFrame = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4z8AARAAI/gH/xp559wAAAABJRU5ErkJggg==",
    "base64",
  );
  await text.focus();
  await expect(ui.locator(".live-screen canvas")).toHaveAttribute("width", "2");
  await expect(text).toHaveValue("Keep this pending text");
  expect(calls.filter((call) => call.endsWith(" /capture/open"))).toHaveLength(
    1,
  );
  await capture.click();
  await expect(ui.locator(".image-stage")).toBeVisible();
});

test("changing simulator frames stay out of the embedded renderer console", async ({
  page,
}) => {
  // Match an animated full-size preview. Vary a trailer on each JPEG so the
  // relay delivers a new frame even when the scene has the same dimensions.
  const frames = Number(process.env.SCRIBBLE_SOAK_FRAMES || 12);
  test.setTimeout(30000 + frames * 1500);
  await page.goto(origin + "/host?isolated-editor");
  const ui = page.frameLocator("iframe");
  await ui
    .getByRole("button", { name: "Capture a webpage or simulator" })
    .click();
  await ui
    .getByRole("button", { name: "Simulator / Emulator", exact: true })
    .click();
  const editor = page
    .frames()
    .find((frame) => frame.url().endsWith("/editor"))!;
  const measureHeap = async (phase: string) => {
    if (!process.env.SCRIBBLE_SOAK_FRAMES) return;
    const session = await page.context().newCDPSession(editor);
    try {
      await session.send("HeapProfiler.collectGarbage");
      const memory = await session.send("Runtime.getHeapUsage");
      console.log(phase, memory);
      return memory.usedSize;
    } finally {
      await session.detach();
    }
  };
  const jpg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1206;
    canvas.height = 2622;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 4200; i++) {
      ctx.fillStyle = `hsl(${(i * 73) % 360} 55% 50%)`;
      ctx.fillRect((i * 17) % 1206, (i * 29) % 2622, 65, 31);
    }
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  });
  simulatorFrame = Buffer.concat([Buffer.from(jpg, "base64"), Buffer.alloc(4)]);
  // Observe only the editor. The host is an independent application.
  await editor.evaluate(() => {
    const original = console.debug;
    Object.assign(window, { frameLogBytes: 0, previewPaints: 0 });
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.closest(".live-screen")) (window as any).previewPaints++;
      return Reflect.apply(drawImage, this, args);
    };
    console.debug = (...args) => {
      const frame = args[1]?.result?._meta?.scribble?.frame;
      if (typeof frame === "string")
        (window as any).frameLogBytes += frame.length;
      original(...args);
    };
  });
  const before = await measureHeap("before preview");
  let tick = 0;
  const timer = setInterval(
    () => simulatorFrame.writeUInt32BE(++tick, simulatorFrame.length - 4),
    40,
  );
  try {
    await ui.getByRole("button", { name: "Connect simulator" }).click();
    await expect(
      ui.getByRole("button", { name: "Capture & annotate" }),
    ).toBeEnabled();
    const waitForPaints = (count: number) =>
      expect
        .poll(() => editor.evaluate(() => (window as any).previewPaints), {
          timeout: frames * 1500,
        })
        .toBeGreaterThanOrEqual(count);
    if (frames > 120) {
      await waitForPaints(120);
      await measureHeap("after 120 paints");
    }
    await waitForPaints(frames);
    const after = await measureHeap("after preview");
    if (before !== undefined && after !== undefined) {
      // One 1206 × 2622 preview, measured after GC. Allow startup overhead
      // but fail well before retaining one compressed payload per frame.
      expect(after - before).toBeLessThan(16 * 1024 * 1024);
    }
    expect(await editor.evaluate(() => (window as any).frameLogBytes)).toBe(0);
  } finally {
    clearInterval(timer);
  }
});
