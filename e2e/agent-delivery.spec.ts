import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
import { createSession } from "../skills/scribble/scripts/lib/store.mjs";
import {
  pollAgentDelivery,
  settleAgentDelivery,
} from "../skills/scribble/scripts/lib/agent-delivery.mjs";
import { PluginBackend } from "../plugin/backend.mjs";

// Real shared browser/server flow; prompt delivery is acknowledged by a local
// consumer fixture. This deliberately does not start Claude Code.
test("browser delivery queues, pauses, retries, records retrieval, and inherits the chat", async ({
  page,
}) => {
  const project = await mkdtemp(join(tmpdir(), "scribble-browser-delivery-"));
  const root = join(project, ".scribble");
  const directory = join(project, "registry");
  const server = await startServer({
    root,
    session: await createSession(root),
  });
  const backend = new PluginBackend({ directory });
  try {
    const canvas = await backend.open(project, "Browser feedback", "chat-one");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(canvas.url);
    await page.getByRole("button", { name: "Try an example" }).click();
    await page
      .getByRole("textbox", { name: "The bigger picture" })
      .fill("Make this clearer.");
    await page.getByRole("button", { name: "Finish feedback" }).click();
    await page.getByRole("button", { name: "Send to this chat" }).click();
    await expect(
      page.getByRole("button", { name: "Feedback queued" }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Feedback queued" }),
    ).toBeVisible();
    const item = await pollAgentDelivery(directory, "chat-one", "consumer");
    await settleAgentDelivery(
      directory,
      "chat-one",
      "consumer",
      item,
      "stopped",
    );
    await expect(
      page.getByRole("button", { name: "Retry sending" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Retry sending" }).click();
    await expect(
      page.getByRole("button", { name: "Feedback queued" }),
    ).toBeVisible();
    const retry = await pollAgentDelivery(directory, "chat-one", "consumer");
    await settleAgentDelivery(directory, "chat-one", "consumer", retry);
    await expect(
      page.getByRole("button", { name: "Message accepted" }),
    ).toBeVisible();
    await backend.feedback(canvas.sessionId);
    await expect(
      page.getByRole("button", { name: "Feedback read" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New canvas" }).click();
    await page.getByRole("button", { name: "Try an example" }).click();
    await page.getByRole("button", { name: "Finish feedback" }).click();
    await expect(
      page.getByRole("button", { name: "Send to this chat" }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await server.close();
    await rm(project, { recursive: true, force: true });
  }
});
