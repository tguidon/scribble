import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../skills/scribble/scripts/lib/store.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
let root: string;
let app: Awaited<ReturnType<typeof startServer>>;
test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), "scribble-browser-"));
  const session = await createSession(root);
  app = await startServer({ root, session });
  await page.goto(app.url);
  await expect(page.getByRole("heading", { name: /A picture/ })).toBeVisible();
});
test.afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});
test("complete visual feedback flow, recovery, and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.screenshot({
    path: ".impeccable/review/empty.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(
    page.getByRole("button", { name: "Open Example — Fieldnotes.png" }),
  ).toBeVisible();
  const stage = page.locator(".image-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("No canvas");
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.2);
  await page
    .getByRole("textbox", { name: "Comment for mark 1" })
    .fill("Give the heading a little more breathing room.");
  await page.getByRole("button", { name: "Arrow (A)" }).click();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.38);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.87, box.y + box.height * 0.2, {
    steps: 8,
  });
  await page.mouse.up();
  await page
    .getByRole("textbox", { name: "Comment for mark 2" })
    .fill("Make this action easier to find.");
  await page.getByRole("button", { name: "Blue ink" }).click();
  await page.getByRole("button", { name: "Rectangle (R)" }).click();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.33);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.65, {
    steps: 8,
  });
  await page.mouse.up();
  await page
    .getByRole("textbox", { name: "Comment for mark 3" })
    .fill("Keep these project cards, but simplify the metadata.");
  await page
    .getByRole("textbox", { name: "The bigger picture" })
    .fill("Keep the quiet feel. Let’s make the important things stand out.");
  await expect(
    page.getByRole("status").filter({ hasText: "Draft saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 3" }),
  ).toHaveValue("Keep these project cards, but simplify the metadata.");
  await page.getByRole("button", { name: "Select (V)" }).click();
  await page.getByRole("button", { name: /Mark 1:/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 1" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit screenshot" }).click();
  await page.screenshot({
    path: ".impeccable/review/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("textarea").first().blur();
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.screenshot({
    path: ".impeccable/review/mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Draw (D)" }).click();
  const b = await stage.boundingBox();
  if (!b) throw new Error("No canvas");
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.75, {
    steps: 5,
  });
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.7, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 4" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 4" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 4" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete mark 4" }).click();
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Point made." }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download feedback" }).click();
  expect((await download).suggestedFilename()).toBe("scribble-feedback.json");
  const params = new URLSearchParams(new URL(app.url).hash.slice(1));
  const result = await page.request.get(
    `${new URL(app.url).origin}/api/feedback`,
    { headers: { Authorization: `Bearer ${params.get("token")}` } },
  );
  const feedback = await result.json();
  expect(feedback.images[0].annotations).toHaveLength(3);
  expect(feedback.message).toContain("quiet feel");
  expect(feedback.images[0].annotations[0].points[0].x).toBeCloseTo(
    1200 * 0.62,
    0,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Point made." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("multiple uploads, invalid files, removal, keyboard pin and retryable save failure", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".image-stage")).toBeVisible();
  const bytes = await (
    await page.request.get(
      new URL(
        (await page.locator(".thumbnail img").getAttribute("src"))!,
        app.url,
      ).href,
    )
  ).body();
  await page.getByLabel("Upload screenshots").setInputFiles([
    { name: "Second.png", mimeType: "image/png", buffer: bytes },
    { name: "Third.png", mimeType: "image/png", buffer: bytes },
  ]);
  await expect(
    page.getByRole("button", { name: "Open Third.png" }),
  ).toBeVisible();
  await page.locator(".image-stage").focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 1" }),
  ).toBeFocused();
  await page.route("**/api/draft", (route) => route.abort());
  await page
    .getByRole("textbox", { name: "Comment for mark 1" })
    .fill("Keep this draft through a connection failure.");
  await expect(page.getByText("Not saved to server")).toBeVisible();
  await page.unroute("**/api/draft");
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Second.png" })
    .click({ force: true });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Second.png" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Upload screenshots")
    .setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "choose a PNG, JPEG, or WebP",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Third.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Third.png" }).click();
  await expect(
    page.getByRole("textbox", { name: "Comment for mark 1" }),
  ).toHaveValue("Keep this draft through a connection failure.");
});
