import { createServer } from "node:net";
import { access } from "node:fs/promises";
import { chromium } from "playwright";

// Check before starting test workers: denied Chrome launches on macOS can
// generate a crash report and a desktop alert for every attempted worker.
const server = createServer();
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
} catch (error) {
  console.error(
    `Scribble tests need permission to bind localhost (127.0.0.1): ${error.code || error.message}. ` +
      "Run them in an environment that allows local test servers and browser processes. No test browsers were started.",
  );
  process.exitCode = 1;
}

// Use the dedicated headless shell, with no fallback to the installed Chrome.
// A missing browser must stop here, before capture tests can try that fallback.
if (!process.exitCode) {
  try {
    await access(chromium.executablePath());
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch (error) {
    console.error(
      "Scribble tests could not start Playwright's Chromium headless shell. " +
        "Run npx playwright install chromium, and allow browser processes in the test environment.\n" +
        error.message,
    );
    process.exitCode = 1;
  }
}
