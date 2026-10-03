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
  await page.getByRole("button", { name: "Send to agent" }).focus();
  await page.keyboard.press("Space");
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
  await page.getByLabel("Upload screenshots").setInputFiles({
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

test("Space activates native upload and toolbar buttons", async ({ page }) => {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Add screenshots", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await chooser;
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".image-stage")).toBeVisible();
  await page.getByRole("button", { name: "Arrow (A)" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Arrow (A)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator(".image-stage").focus();
  await page.keyboard.down("Space");
  await expect(page.locator(".viewport")).toHaveClass(/tool-pan/);
  await page.keyboard.up("Space");
});

test("a lost submission response still recovers the saved receipt", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".image-stage")).toBeVisible();
  await page.route("**/api/submit", async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Point made." }),
  ).toBeVisible();
});

test("lost save acknowledgement retries the original save before newer edits", async ({
  page,
}) => {
  let acknowledge!: () => void;
  let committed!: () => void;
  const committedOnServer = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const release = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  let intercepted = false;
  await page.route("**/api/draft", async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    await route.fetch();
    committed();
    await release;
    await route.abort();
  });
  const message = page.getByRole("textbox", { name: "The bigger picture" });
  await message.fill("The first saved edit.");
  await committedOnServer;
  await message.fill("A newer edit written before the save acknowledgement.");
  acknowledge();
  await expect(page.getByText("Not saved to server")).toBeVisible();
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.reload();
  await expect(message).toHaveValue(
    "A newer edit written before the save acknowledgement.",
  );
});

test("reload recovers newer edits after a lost save acknowledgement", async ({
  page,
}) => {
  let first = true;
  await page.route("**/api/draft", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
    }
    await route.abort();
  });
  const message = page.getByRole("textbox", { name: "The bigger picture" });
  await message.fill("Saved on the server, acknowledgement lost.");
  await expect(page.getByText("Not saved to server")).toBeVisible();
  await message.fill("Keep these newer unsaved edits after reload.");
  await expect(page.getByText("Not saved to server")).toBeVisible();
  await page.unroute("**/api/draft");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(message).toHaveValue(
    "Keep these newer unsaved edits after reload.",
  );
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.reload();
  await expect(message).toHaveValue(
    "Keep these newer unsaved edits after reload.",
  );
});

test("a genuine conflict preserves a downloadable backup until explicitly dismissed", async ({
  page,
}) => {
  const params = new URLSearchParams(new URL(app.url).hash.slice(1));
  const response = await page.request.put(
    `${new URL(app.url).origin}/api/draft`,
    {
      headers: { Authorization: `Bearer ${params.get("token")}` },
      data: {
        revision: 0,
        saveId: "another-tab",
        message: "Saved in the other tab.",
        images: [],
      },
    },
  );
  expect(response.ok()).toBe(true);
  const message = page.getByRole("textbox", { name: "The bigger picture" });
  await message.fill("My unsaved draft must survive.");
  await expect(page.getByText("Not saved to server")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Download unsaved draft" }),
  ).toBeVisible();
  await expect(message).toBeDisabled();
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("View unsaved draft", { exact: true }).click();
  const preview = page.getByRole("textbox", { name: "Unsaved draft backup" });
  await expect(preview).toBeVisible();
  expect(JSON.parse(await preview.inputValue()).message).toBe(
    "My unsaved draft must survive.",
  );
  await expect(preview).toHaveAttribute("readonly", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".impeccable/review/recovery.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download unsaved draft" }).click();
  const file = await (await download).path();
  const { readFile } = await import("node:fs/promises");
  expect(JSON.parse(await readFile(file!, "utf8")).message).toBe(
    "My unsaved draft must survive.",
  );
  await page.getByRole("button", { name: "Use saved draft" }).click();
  await expect(message).toBeEnabled();
  await expect(message).toHaveValue("Saved in the other tab.");
});

test("an edit beyond the shared draft budget keeps the last valid draft", async ({
  page,
}) => {
  const { MAX_DRAFT_BYTES, draftBytes } =
    await import("../skills/scribble/scripts/lib/limits.mjs");
  const params = new URLSearchParams(new URL(app.url).hash.slice(1));
  const headers = { Authorization: `Bearer ${params.get("token")}` };
  const origin = new URL(app.url).origin;
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const draft = await (
    await page.request.post(`${origin}/api/images?width=1&height=1`, {
      headers,
      data: image,
    })
  ).json();
  draft.images[0].annotations = Array.from({ length: 450 }, (_, n) => ({
    id: `pin-${n}`,
    type: "pin",
    color: "#c94b35",
    points: [{ x: 0.5, y: 0.5 }],
    comment: "x".repeat(10000),
  }));
  let remaining = draftBytes(draft) - MAX_DRAFT_BYTES + 100;
  for (const mark of draft.images[0].annotations) {
    const remove = Math.min(remaining, mark.comment.length);
    mark.comment = mark.comment.slice(remove);
    remaining -= remove;
  }
  expect(
    (
      await page.request.put(`${origin}/api/draft`, { headers, data: draft })
    ).ok(),
  ).toBe(true);
  await page.reload();
  const message = page.getByRole("textbox", { name: "The bigger picture" });
  await message.fill("é".repeat(100));
  await expect(page.getByRole("alert")).toContainText("4 MB limit");
  await expect(message).toHaveValue("");
  await message.fill("Still fits.");
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.reload();
  await expect(message).toHaveValue("Still fits.");
});
