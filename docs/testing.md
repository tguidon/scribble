# Tests and large-draft recovery

## Run the tests

Install the browser versions that match this checkout's Playwright dependency. The installation includes a headless shell and a full Chromium browser. The full browser supports the real tab-sharing test.

```sh
npm install
npx playwright install chromium
npm run build
npm test
npm run test:e2e
```

Both npm test commands first test access to a local server port and the dedicated headless browser. If access fails, they stop before starting test workers. Allow local server ports and browser processes, then rerun the command. Increasing a test timeout does not resolve an environment permission failure.

The default tests use Playwright's headless shell. The capture tests use its full Chromium browser for real tab sharing. Neither configuration launches your installed Chrome application. After updating Playwright, rerun its browser installation command.

For an explicit compatibility run against an installed Chrome application, set `SCRIBBLE_TEST_CHANNEL`:

```sh
SCRIBBLE_TEST_CHANNEL=chrome npm run test:e2e -- --grep 'a near-limit draft'
```

This override selects Chrome for the editor under test. The server's capture tests still use the dedicated headless browser. Run this command in an environment that permits browser processes and local servers.

## Resolved draft timeout

The failing fixture contained 450 annotations with nearly 4 MB of comment text. Most comments contained 10,000 characters without spaces. Chrome 156 spent about 22.6 seconds calculating the page layout each time it opened this draft.

The test opened the draft twice, so it exceeded its 45-second limit. Its first failure reported an empty message after reload. Further measurement showed that the save request completed successfully before the second slow layout. The investigation did not reproduce saved-message loss.

A user can encounter this rendering delay with many large comments that contain long, unbroken strings. The same fixture with ordinary word breaks took about 0.21 seconds of layout time. The supported Playwright headless shell also handled the original fixture quickly. These measurements came from the development Mac and do not predict timings on every device.

The editor now lets the browser skip layout for comments outside the visible area. It retains all comments in the document. The browser remembers each comment's height after rendering. Scrolling, keyboard navigation, and selecting a mark still make its comment available for editing. The change uses `content-visibility: auto` with an estimated comment height.

In the same Chrome 156 reproduction, initial layout dropped to about 4 milliseconds. The first edit completed about 100 milliseconds after reload. The regression tests retain the unbroken text and the 4 MB limit. They cover desktop and narrow layouts within a 15-second test budget. They also check oversized-edit rejection, saves, reloads, and editing a comment at the end of the list.

The stronger test also exposed overhead from a role-based lookup of an offscreen field. That lookup forced Chrome to lay out skipped comments again. The test now addresses the field by its explicit accessible label. It also waits for a successful save response before reloading. The complete desktop sequence passed in about 2.7 seconds in the same Chrome version.

## Chrome crash dialogs during tests

An earlier sandboxed test run attempted to launch the installed Chrome application repeatedly. macOS aborted those processes during application registration, before they loaded Scribble. The crash-report process IDs matched the Playwright launch logs. These were test-browser startup crashes, rather than evidence of a Scribble page crash.

The test commands now check localhost access before launching a browser. They also check that Playwright's dedicated browser can start before launching test workers. Missing browser files produce an installation error instead of triggering the capture adapter's Chrome fallback. No operating-system crash reporting preferences are changed.

The real tab-sharing test needs the full browser's newer headless mode. Other tests use the smaller headless shell. Both browsers belong to Playwright's cache and are separate from the installed Chrome application.

References: [Playwright browser setup](https://playwright.dev/docs/browsers), [CSS content visibility and accessibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility).
