import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 45000,
  use: {
    channel: process.env.SCRIBBLE_TEST_CHANNEL || undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  },
  reporter: "list",
});
