import { readFileSync } from "node:fs";

const release = JSON.parse(
  readFileSync(new URL("../../version.json", import.meta.url), "utf8"),
);
export const VERSION = release.version;
export const SERVER_PROTOCOL = release.serverProtocol;
