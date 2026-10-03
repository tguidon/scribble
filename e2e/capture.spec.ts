import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession } from "../skills/scribble/scripts/lib/store.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
let root: string,
  source: Server,
  sourceUrl: string,
  app: Awaited<ReturnType<typeof startServer>>;
const device = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Review iPhone",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), "scribble-capture-ui-"));
  source = createServer((req, res) => {
    if (req.url?.endsWith("/config")) {
      res.end(JSON.stringify({ orientation: "portrait" }));
      return;
    }
    if (req.url?.endsWith("/foreground")) {
      res.end(JSON.stringify({ bundleId: "dev.review.app" }));
      return;
    }
    if (req.url?.endsWith("/stream.mjpeg")) {
      res.writeHead(200, {
        "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      });
      res.write("--frame\r\nContent-Length: " + png.length + "\r\n\r\n");
      res.write(png);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<title>${req.url === "/details" ? "Project details" : "Local workspace"}</title><body style="font:20px system-ui;padding:60px;background:#f5f1e9;color:#34322e"><h1>Make room for a good idea.</h1><p>A local page for reviewing visual changes.</p><button>New project</button></body>`,
    );
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  sourceUrl = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
  const command = join(root, "simulator.mjs");
  await writeFile(
    command,
    `console.log(JSON.stringify(${JSON.stringify({ device: device.id, url: sourceUrl, streamUrl: sourceUrl + "/stream.mjpeg" })}))`,
  );
  const session = await createSession(root);
  app = await startServer({
    root,
    session,
    captureOptions: {
      discovery: {
        list: async () =>
          `p123\ncnode\nn127.0.0.1:${new URL(sourceUrl).port}\n`,
      },
      web: { headless: true, channel: "chrome" },
      simulator: {
        devices: async () => [device],
        command: { file: process.execPath, args: [command] },
      },
    },
  });
  await page.goto(app.url);
});
test.afterEach(async () => {
  await app.close();
  await new Promise<void>((resolve) => {
    source.close(() => resolve());
    source.closeAllConnections();
  });
  await rm(root, { recursive: true, force: true });
});

test("local capture opens, annotates, resumes, captures again, and submits both images", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Capture a webpage or simulator" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bring a live screen into focus." }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: `Local workspace ${sourceUrl}` })
    .click();
  await expect(page.getByLabel("Webpage URL")).toHaveValue(sourceUrl);
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your browser is ready." }),
  ).toBeVisible();
  await page.screenshot({
    path: ".impeccable/review/capture-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.screenshot({
    path: ".impeccable/review/capture-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Simulate a lost acknowledgement after the server has durably saved the image.
  await page.route("**/api/capture/snapshot", async (route) => {
    await route.fetch();
    await route.abort();
    await page.unroute("**/api/capture/snapshot");
  });
  await page.getByRole("button", { name: "Capture & annotate" }).click();
  await expect(
    page.getByRole("button", { name: "Open Local workspace.png" }),
  ).toBeVisible();
  await page.locator(".image-stage").focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "Comment for mark 1" })
    .fill("Give this heading more space.");
  await page.getByRole("button", { name: "Resume live capture" }).click();
  await expect(
    page.getByRole("button", { name: "Return to browser" }),
  ).toBeVisible();
  await page.getByLabel("Webpage URL").fill(sourceUrl + "/details");
  await page.getByRole("button", { name: "Open this URL" }).click();
  await expect(
    page.getByRole("button", { name: "Capture & annotate" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Capture & annotate" }).click();
  await expect(
    page.getByRole("button", { name: "Open Project details.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Local workspace.png" }).click();
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 1" }),
  ).toHaveValue("Give this heading more space.");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Project details.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Point made." }),
  ).toBeVisible();
  const url = new URL(app.url),
    params = new URLSearchParams(url.hash.slice(1));
  const response = await page.request.get(url.origin + "/api/feedback", {
    headers: { Authorization: `Bearer ${params.get("token")}` },
  });
  const bundle = await response.json();
  expect(bundle.images).toHaveLength(2);
  expect(bundle.images[0].source.url).toBe(sourceUrl + "/");
  expect(bundle.images[1].source.url).toBe(sourceUrl + "/details");
});

test("simulator selection captures into the same editor and supports disconnect", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Capture live app" }).click();
  await expect(
    page.getByRole("button", { name: "Simulator", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Simulator", exact: true }).click();
  await expect(page.getByLabel("Booted simulator")).toHaveValue(device.id);
  await page.getByRole("button", { name: "Connect simulator" }).click();
  await expect(
    page.getByRole("link", { name: "Open live simulator" }),
  ).toHaveAttribute("href", sourceUrl + "/?device=" + device.id);
  await page.screenshot({
    path: ".impeccable/review/simulator-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.screenshot({
    path: ".impeccable/review/simulator-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Capture & annotate" }).click();
  await expect(
    page.getByRole("button", { name: "Open Review iPhone.jpg" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume live capture" }).click();
  await page.getByRole("button", { name: "Disconnect simulator" }).click();
  await expect(
    page.getByRole("button", { name: "Capture & annotate" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to annotations" }).click();
  await expect(
    page.getByRole("button", { name: "Open Review iPhone.jpg" }),
  ).toBeVisible();
});

test("capture errors allow correction and missing tools do not block first-use setup", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Capture live app" }).click();
  await page.getByLabel("Webpage URL").fill("file:///etc/passwd");
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP or HTTPS");
  await page.getByLabel("Webpage URL").fill(sourceUrl);
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Capture & annotate" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close capture browser" }).click();
  await expect(
    page.getByRole("button", { name: "Capture & annotate" }),
  ).toHaveCount(0);
  await page.route("**/api/capture/status", async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    value.web.available = false;
    await route.fulfill({ response, json: value });
  });
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText(/First use installs the browser tools automatically/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open browser", exact: true }),
  ).toBeEnabled();
});

test("a stale backend explains recovery instead of showing Not found", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Not found." }),
    }),
  );
  await page
    .getByRole("button", { name: "Capture live app", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "server is too old for live capture",
  );
  await expect(page.getByRole("alert")).toContainText(
    "saved draft is preserved",
  );
  await page.unroute("**/api/health");
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(page.getByLabel("Webpage URL")).toBeVisible();
});
