import { readFileSync } from "node:fs";

export const VERSION = JSON.parse(
  readFileSync(new URL("../../version.json", import.meta.url), "utf8"),
).version;
export const SERVER_PROTOCOL = 2;
