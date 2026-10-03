import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Globe,
  Smartphone,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { checkCaptureRuntime, request } from "../api";
import type { CaptureKind } from "../types";

type Connection = {
  available: boolean;
  connected: boolean;
  setupCommand: string;
  supported?: boolean;
  url?: string;
  viewport?: { width: number; height: number };
  device?: { id: string; name: string };
  previewUrl?: string;
};
type Status = Record<CaptureKind, Connection>;
type Props = {
  kind: CaptureKind;
  setKind: (kind: CaptureKind) => void;
  onBack: () => void;
  onCapture: (kind: CaptureKind) => Promise<void>;
};
const action = (name: string, body: object) =>
  request(`/capture/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export function CapturePanel({ kind, setKind, onBack, onCapture }: Props) {
  const [status, setStatus] = useState<Status>();
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [url, setUrl] = useState("");
  const [apps, setApps] = useState<{ url: string; title: string }[]>([]);
  const [discoveryMessage, setDiscoveryMessage] = useState("");
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(900);
  const [busy, setBusy] = useState("Checking sources…");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const connection = status?.[kind];
  const refresh = useCallback(async () => {
    await checkCaptureRuntime();
    const next = await request<Status>("/capture/status");
    setStatus(next);
    if (next.web.connected && next.web.url) setUrl(next.web.url);
    if (next.web.viewport) {
      setWidth(next.web.viewport.width);
      setHeight(next.web.viewport.height);
    }
    if (next.simulator.device) setDeviceId(next.simulator.device.id);
    if (kind === "web") {
      const result = await request<{
        apps: { url: string; title: string }[];
        message?: string;
      }>("/capture/apps");
      setApps(result.apps);
      setDiscoveryMessage(
        result.message ||
          (result.apps.length
            ? ""
            : "No running web apps found. Enter a URL, or start your app and refresh."),
      );
    }
    if (kind === "simulator" && next.simulator.supported) {
      const result = await request<{ devices: { id: string; name: string }[] }>(
        "/capture/devices",
      );
      setDevices(result.devices);
      setDeviceId((current) =>
        result.devices.some((d) => d.id === current)
          ? current
          : result.devices[0]?.id || "",
      );
    }
  }, [kind]);
  const perform = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    heading.current?.focus();
    void perform("Checking sources…", refresh);
  }, [refresh]);
  return (
    <main className="capture-workspace">
      <div className="capture-sheet">
        <button
          className="text-button capture-back"
          onClick={onBack}
          disabled={!!busy}
        >
          <ArrowLeft size={17} /> Back to annotations
        </button>
        <h1 tabIndex={-1} ref={heading}>
          Bring a live screen into focus.
        </h1>
        <p className="capture-intro">
          Navigate your app, then capture the moment you want to mark up.
        </p>
        <div className="capture-tabs" role="group" aria-label="Capture source">
          <button
            aria-pressed={kind === "web"}
            onClick={() => {
              setKind("web");
              setError("");
            }}
            disabled={!!busy}
          >
            <Globe size={19} /> Webpage
          </button>
          <button
            aria-pressed={kind === "simulator"}
            onClick={() => {
              setKind("simulator");
              setError("");
            }}
            disabled={!!busy}
          >
            <Smartphone size={19} /> Simulator
          </button>
        </div>
        {error && (
          <div className="capture-error" role="alert">
            <AlertCircle size={19} />
            <span>{error}</span>
          </div>
        )}
        {!status ? (
          <p role="status">{busy || "Could not check capture sources."}</p>
        ) : (
          <>
            {kind === "web" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(
                    connection?.available
                      ? "Opening browser…"
                      : "Installing capture tools and opening browser…",
                    async () => {
                      await action("open", { kind, url, width, height });
                      await refresh();
                    },
                  );
                }}
              >
                <label className="capture-field">
                  Webpage URL
                  <input
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="example.com or localhost:3000"
                    disabled={!!busy}
                  />
                </label>
                <p className="capture-hint">
                  Open any website or local app in a separate capture browser.
                </p>
                <div className="capture-apps" aria-label="Running web apps">
                  {apps.length > 0 && (
                    <p className="capture-hint">Running on this Mac</p>
                  )}
                  {apps.map((app) => (
                    <button
                      type="button"
                      className="capture-app"
                      key={app.url}
                      disabled={!!busy}
                      onClick={() => setUrl(app.url)}
                    >
                      <Globe size={17} />
                      <span>
                        <strong>{app.title}</strong>
                        <span>{app.url}</span>
                      </span>
                    </button>
                  ))}
                  {discoveryMessage && (
                    <p className="capture-hint">{discoveryMessage}</p>
                  )}
                </div>
                <div className="capture-dimensions">
                  <label className="capture-field">
                    Width <span>px</span>
                    <input
                      type="number"
                      min={320}
                      max={2560}
                      required
                      value={width}
                      onChange={(event) => setWidth(Number(event.target.value))}
                      disabled={!!busy}
                    />
                  </label>
                  <span aria-hidden="true">×</span>
                  <label className="capture-field">
                    Height <span>px</span>
                    <input
                      type="number"
                      min={320}
                      max={2560}
                      required
                      value={height}
                      onChange={(event) =>
                        setHeight(Number(event.target.value))
                      }
                      disabled={!!busy}
                    />
                  </label>
                </div>
                <button
                  className="secondary capture-open"
                  type="submit"
                  disabled={!!busy}
                >
                  <Globe size={17} />
                  {connection?.connected ? "Open this URL" : "Open browser"}
                </button>
              </form>
            ) : (
              <div>
                <label className="capture-field">
                  Booted simulator
                  <select
                    value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                    disabled={!!busy || !devices.length}
                  >
                    <option value="">
                      {devices.length
                        ? "Choose a device"
                        : "No booted simulators"}
                    </option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="capture-hint">
                  {connection?.supported
                    ? "Open Simulator and boot a device, then refresh this list. Scribble connects through serve-sim."
                    : "Simulator capture requires an Apple Silicon Mac with Xcode."}
                </p>
                <button
                  className="secondary capture-open"
                  disabled={!!busy || !deviceId || !connection?.supported}
                  onClick={() =>
                    void perform(
                      connection?.available
                        ? "Connecting simulator…"
                        : "Installing serve-sim and connecting…",
                      async () => {
                        await action("open", { kind, deviceId });
                        await refresh();
                      },
                    )
                  }
                >
                  <Smartphone size={17} />
                  Connect simulator
                </button>
              </div>
            )}
            {connection &&
              !connection.available &&
              (kind === "web" || connection.supported) && (
                <p className="capture-hint">
                  First use installs{" "}
                  {kind === "web" ? "the browser tools" : "serve-sim"}{" "}
                  automatically. This download can take a few minutes.
                </p>
              )}
            {connection?.connected && (
              <section
                className="capture-connected"
                aria-label="Connected source"
              >
                <div>
                  <span className="connected-dot" />
                  <h2>
                    {kind === "web"
                      ? "Your browser is ready."
                      : `${connection.device?.name} is connected.`}
                  </h2>
                </div>
                <p>
                  {kind === "web"
                    ? "Navigate or sign in in the capture browser. Return here when the screen is ready."
                    : "Open the live preview to tap, scroll, and navigate. Return here when the screen is ready."}
                </p>
                {kind === "web" ? (
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      void perform("Opening browser…", () =>
                        action("focus", { kind }),
                      )
                    }
                  >
                    Return to browser <ArrowUpRight size={16} />
                  </button>
                ) : (
                  <a
                    className="text-button"
                    href={connection.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open live simulator <ArrowUpRight size={16} />
                  </a>
                )}
                <button
                  className="primary capture-submit"
                  disabled={!!busy}
                  onClick={() =>
                    void perform("Capturing screen…", () => onCapture(kind))
                  }
                >
                  <Camera size={18} />
                  Capture & annotate
                </button>
                <p className="capture-hint">
                  Saves a still image. Your app keeps running, and earlier
                  captures stay as they were.
                </p>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() =>
                    void perform("Disconnecting…", async () => {
                      await action("disconnect", { kind });
                      await refresh();
                    })
                  }
                >
                  {kind === "web"
                    ? "Close capture browser"
                    : "Disconnect simulator"}
                </button>
              </section>
            )}
          </>
        )}
        <div className="capture-status-row">
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => void perform("Checking sources…", refresh)}
          >
            <RefreshCw size={16} />
            Refresh sources
          </button>
          <span role="status">{busy}</span>
        </div>
      </div>
    </main>
  );
}
