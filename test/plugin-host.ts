// Standards-based host fixture. This tests MCP Apps interoperability, not the
// separate question of whether a particular desktop build exposes that bridge.
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
declare global {
  interface Window {
    fixture: { result: any; canSend: boolean; reject: boolean };
  }
}
const frame = document.querySelector("iframe")!;
const bridge = new AppBridge(
  null,
  { name: "Scribble test host", version: "1" },
  {
    serverTools: {},
    ...(window.fixture.canSend ? { message: { text: {} } } : {}),
  },
  {
    hostContext: {
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    },
  },
);
bridge.oncalltool = async (params) =>
  (
    await fetch("/tool", { method: "POST", body: JSON.stringify(params) })
  ).json();
bridge.onmessage = async (params) => {
  if (window.fixture.reject) return { isError: true };
  await fetch("/message", { method: "POST", body: JSON.stringify(params) });
  return {};
};
bridge.onrequestdisplaymode = async ({ mode }) => ({ mode });
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: { projectPath: "/test-project" } });
  await bridge.sendToolResult(window.fixture.result);
};
await bridge.connect(
  new PostMessageTransport(frame.contentWindow!, frame.contentWindow!),
);
frame.src = "/editor";
