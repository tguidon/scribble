import { captureError } from "./common.mjs";

// Visit each viewport to trigger lazy content without resizing the page. A finite
// budget prevents infinite feeds from silently producing an incomplete capture.
export async function prepareFullPage(page) {
  const deadline = Date.now() + 10000;
  let top = 0;
  let bottomHeight;
  for (let step = 0; step < 100 && Date.now() < deadline; step++) {
    const bounds = await page.evaluate(async (top) => {
      window.scrollTo({ left: 0, top, behavior: "instant" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const visibleImages = Array.from(document.images).filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      });
      await Promise.race([
        Promise.all(
          visibleImages.map((image) => image.decode().catch(() => {})),
        ),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ]);
      const body = document.body;
      const html = document.documentElement;
      return {
        width: Math.max(
          html.scrollWidth,
          html.offsetWidth,
          html.clientWidth,
          body?.scrollWidth || 0,
          body?.offsetWidth || 0,
        ),
        height: Math.max(
          html.scrollHeight,
          html.offsetHeight,
          html.clientHeight,
          body?.scrollHeight || 0,
          body?.offsetHeight || 0,
        ),
        viewportHeight: innerHeight,
        y: scrollY,
      };
    }, top);
    if (bounds.width * bounds.height > 40000000)
      throw captureError(
        "The full page exceeds 40 megapixels. Choose a narrower viewport or use Capture & annotate for a visible section.",
      );
    if (bounds.y + bounds.viewportHeight >= bounds.height) {
      if (bottomHeight === bounds.height) {
        await page.evaluate(() =>
          window.scrollTo({ left: 0, top: 0, behavior: "instant" }),
        );
        return;
      }
      bottomHeight = bounds.height;
    } else {
      bottomHeight = undefined;
    }
    top = Math.min(
      bounds.y + bounds.viewportHeight,
      bounds.height - bounds.viewportHeight,
    );
  }
  throw captureError(
    "The page keeps growing or took too long to prepare. Use Capture & annotate for a visible section.",
  );
}
