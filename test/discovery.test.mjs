import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  discoverWebApps,
  listeningApps,
} from "../skills/scribble/scripts/lib/capture/discovery.mjs";

test("discovery selects local development listeners and excludes Scribble and OS services", () => {
  const output =
    "p1\ncnode\nn*:3000\nn[::1]:3000\np2\ncControlCenter\nn*:5000\np3\ncpython3\nn127.0.0.1:8000\np4\ncnode\nn10.0.0.5:9000\np5\ncnode\nn127.0.0.1:56150";
  assert.deepEqual(
    listeningApps(output, [56150]).map((x) => x.url),
    ["http://[::1]:3000", "http://127.0.0.1:8000"],
  );
});

test("discovery verifies HTML apps, bounds streamed content, and reports an unavailable scanner", async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.write("<title>My local app</title>" + "x".repeat(40000));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const port = server.address().port;
  const result = await discoverWebApps({
    list: async () => `p1\ncnode\nn127.0.0.1:${port}`,
  });
  assert.equal(result.apps[0].title, "My local app");
  assert.equal(result.apps[0].url, `http://127.0.0.1:${port}`);
  assert.deepEqual(
    (
      await discoverWebApps({
        list: async () => {
          throw new Error("missing lsof");
        },
      })
    ).apps,
    [],
  );
});
