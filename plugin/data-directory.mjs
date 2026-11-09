import { join } from "node:path";
import { homedir } from "node:os";

export const pluginDataDirectory = () =>
  process.env.SCRIBBLE_PLUGIN_DATA ||
  process.env.PLUGIN_DATA ||
  join(homedir(), ".local", "share", "scribble-plugin");
