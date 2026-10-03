import { playwright } from "./runtime.mjs";
import { localUrl, imageDimensions, captureError } from "./common.mjs";

export class WebCapture {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.context = null;
    this.page = null;
    this.guards = new WeakMap();
  }
  guard(page) {
    if (!this.guards.has(page))
      this.guards.set(
        page,
        (async () => {
          const client = await this.context.newCDPSession(page);
          client.on("Fetch.requestPaused", (event) => {
            let allowed = false;
            try {
              localUrl(event.request.url);
              allowed = true;
            } catch {}
            void client
              .send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
                requestId: event.requestId,
                ...(!allowed ? { errorReason: "BlockedByClient" } : {}),
              })
              .catch(() => {});
          });
          // Chromium interception sees every redirect hop, unlike route handlers.
          await client.send("Fetch.enable", {
            patterns: [
              {
                urlPattern: "*",
                resourceType: "Document",
                requestStage: "Request",
              },
            ],
          });
        })(),
      );
    return this.guards.get(page);
  }
  state() {
    const page = this.currentPage();
    return page
      ? { connected: true, url: page.url(), viewport: page.viewportSize() }
      : { connected: false };
  }
  currentPage() {
    if (this.page?.isClosed()) this.page = null;
    return this.page;
  }
  async open(input) {
    const url = localUrl(input.url).href;
    const width = input.width ?? 1280,
      height = input.height ?? 900;
    if (
      ![width, height].every(
        (n) => Number.isInteger(n) && n >= 320 && n <= 2560,
      )
    )
      throw captureError(
        "Choose viewport dimensions between 320 and 2560 pixels.",
      );
    if (!this.context) {
      const { chromium } = playwright(this.root);
      const options = {
        headless: false,
        ...this.options,
        viewport: { width, height },
        deviceScaleFactor: 1,
        acceptDownloads: false,
      };
      let browser;
      try {
        browser = await chromium.launch(options);
      } catch {
        try {
          browser = await chromium.launch({ ...options, channel: "chrome" });
        } catch {
          throw captureError(
            "The capture browser could not open. Run Scribble setup web, then retry. A desktop session is required.",
            503,
          );
        }
      }
      this.browser = browser;
      this.context = await browser.newContext(options);
      await this.context.route("**/*", async (route) => {
        const request = route.request();
        if (request.isNavigationRequest() && !request.frame().parentFrame()) {
          try {
            localUrl(request.url());
          } catch {
            await route.abort("blockedbyclient");
            return;
          }
        }
        await route.continue();
      });
      this.context.on("page", (page) => {
        void this.guard(page).catch(() => page.close().catch(() => {}));
        page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
      });
      browser.on("disconnected", () => {
        this.context = null;
        this.page = null;
      });
    }
    const page = this.currentPage() || (await this.context.newPage());
    this.page = page;
    await this.guard(page);
    await page.setViewportSize({ width, height });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {
      throw captureError(
        "The local page did not open. Check that its development server is running and the URL stays local.",
        502,
      );
    }
    localUrl(page.url());
    await page.bringToFront();
    return this.state();
  }
  async focus() {
    const page = this.currentPage();
    if (!page)
      throw captureError(
        "The capture browser was closed. Open your local page again.",
        409,
      );
    await page.bringToFront();
    return this.state();
  }
  async capture() {
    const page = this.currentPage();
    if (!page) throw captureError("Open a webpage before capturing it.", 409);
    const url = localUrl(page.url()).href;
    // Metadata brackets the screenshot; discard captures changed by navigation or scroll.
    const before = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      scroll: { x: scrollX, y: scrollY },
      viewport: { width: innerWidth, height: innerHeight },
      deviceScaleFactor: devicePixelRatio,
    }));
    const bytes = await page.screenshot({
      type: "png",
      animations: "disabled",
      caret: "hide",
      timeout: 15000,
    });
    const after = await page.evaluate(() => ({
      url: location.href,
      scroll: { x: scrollX, y: scrollY },
      width: innerWidth,
      height: innerHeight,
    }));
    if (
      url !== after.url ||
      before.scroll.x !== after.scroll.x ||
      before.scroll.y !== after.scroll.y ||
      before.viewport.width !== after.width ||
      before.viewport.height !== after.height
    )
      throw captureError(
        "The page moved during capture. Let it settle and capture again.",
        409,
      );
    return {
      bytes,
      ...imageDimensions(bytes),
      name: `${before.title || new URL(url).host}.png`.slice(0, 200),
      source: { kind: "web", ...before, capturedAt: new Date().toISOString() },
    };
  }
  async close() {
    await this.browser?.close();
    this.context = null;
    this.page = null;
  }
}
