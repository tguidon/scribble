import type {
  CaptureInput,
  CaptureCommand,
  WebConnection,
  SimulatorConnection,
} from "../skills/scribble/scripts/lib/capture/contracts.mjs";

const pointer: CaptureInput = {
  type: "pointer",
  phase: "down",
  x: 0.5,
  y: 0.5,
};
const command: CaptureCommand = {
  action: "input",
  kind: "web",
  generation: 1,
  ...pointer,
};
const fullPage: CaptureCommand = {
  action: "snapshot",
  kind: "web",
  fullPage: true,
};
const fullSimulator: CaptureCommand = {
  action: "snapshot",
  kind: "simulator",
  // @ts-expect-error Full-page snapshots apply only to webpages.
  fullPage: true,
};
// @ts-expect-error A pointer requires coordinates.
const missingPoint: CaptureInput = { type: "pointer", phase: "down" };
// @ts-expect-error The action name is a closed union.
const unknownInput: CaptureInput = { type: "magic" };
// @ts-expect-error Live input requires the source generation.
const missingGeneration: CaptureCommand = {
  action: "input",
  kind: "web",
  type: "release",
};
// @ts-expect-error Simulator commands cannot resize a viewport.
const wrongSource: CaptureCommand = {
  action: "resize",
  kind: "simulator",
  generation: 1,
  width: 390,
  height: 844,
};
// @ts-expect-error A connected webpage requires its URL, viewport, and generation.
const incompleteWeb: WebConnection = { kind: "web", connected: true };
// @ts-expect-error A connected simulator requires a device and generation.
const incompleteSimulator: SimulatorConnection = {
  kind: "simulator",
  connected: true,
};
const disconnected: WebConnection = { kind: "web", connected: false };
// @ts-expect-error Disconnected states do not offer live metadata.
const viewport = disconnected.viewport;
void [
  command,
  fullPage,
  fullSimulator,
  missingPoint,
  unknownInput,
  missingGeneration,
  wrongSource,
  incompleteWeb,
  incompleteSimulator,
  viewport,
];
