import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Globe,
  Smartphone,
  RefreshCw,
  AlertCircle,
  MonitorUp,
} from "lucide-react";
import { checkCaptureRuntime, request } from "../api";
import { SharedTabView } from "./SharedTabView";
import type { TabShare, SharedSurface } from "../useTabShare";
import { LiveView } from "./LiveView";
import type { CaptureKind } from "../types";

type Connection = {
  available: boolean;
  connected: boolean;
  generation?: number;
  inputWarning?: string;
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
  webMode: "direct" | "shared";
  setWebMode: (mode: "direct" | "shared") => void;
  share: TabShare;
  onSharedCapture: (file: File, surface: SharedSurface) => Promise<void>;
};
const action = (name: string, body: object) =>
  request(`/capture/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export function CapturePanel({
  kind,
  setKind,
  onBack,
  onCapture,
  webMode,
  setWebMode,
  share,
  onSharedCapture,
}: Props) {
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
  const workspace = useRef<HTMLElement>(null);
  const connection = status?.[kind];
  const shared = kind === "web" && webMode === "shared";
  const connected = shared ? !!share.stream : !!connection?.connected;
  useEffect(() => {
    if (connected) {
      workspace.current?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    }
  }, [connected, shared, kind]);
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
      setError("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  };
  const openWebpage = () => {
    if (busy || !url.trim()) return;
    void perform(
      connection?.available
        ? "Opening webpage…"
        : "Installing capture tools and opening webpage…",
      async () => {
        await action("open", { kind: "web", url, width, height });
        await refresh();
      },
    );
  };
  useEffect(() => {
    heading.current?.focus();
    void perform("Checking sources…", refresh);
  }, [refresh]);
  return (
    <main
      ref={workspace}
      className={`capture-workspace ${connected ? "capture-workspace-live" : ""}`}
    >
      <div className={`capture-sheet ${connected ? "capture-sheet-live" : ""}`}>
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
        {shared ? (
          <div className="capture-layout">
            <button
              className="text-button capture-mode-back"
              disabled={!!busy || share.pending}
              onClick={() => setWebMode("direct")}
            >
              <ArrowLeft size={16} />
              Use a webpage URL
            </button>
            <SharedTabView
              share={share}
              busy={!!busy}
              onCapture={(file, surface) =>
                perform("Capturing shared screen…", () =>
                  onSharedCapture(file, surface),
                )
              }
            />
          </div>
        ) : !status ? (
          <p role="status">{busy || "Could not check capture sources."}</p>
        ) : (
          <div className="capture-layout">
            <details
              className="capture-settings"
              open={!connection?.connected}
              key={`${kind}-${!!connection?.connected}`}
            >
              <summary>
                <span>
                  {kind === "web" ? "Webpage settings" : "Simulator settings"}
                </span>
                {connection?.connected && kind === "web" && (
                  <span className="capture-source-label">{connection.url}</span>
                )}
              </summary>
              {kind === "web" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    openWebpage();
                  }}
                  onKeyDown={(event) => {
                    // Some plugin hosts disallow native form submission.
                    if (
                      event.key === "Enter" &&
                      event.target instanceof HTMLInputElement
                    ) {
                      event.preventDefault();
                      openWebpage();
                    }
                  }}
                >
                  <div className="capture-url-row">
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
                        placeholder="localhost:3000"
                        disabled={!!busy}
                      />
                    </label>
                    <button
                      className="secondary capture-open"
                      type="button"
                      onClick={openWebpage}
                      disabled={!!busy || !url.trim()}
                    >
                      <Globe size={17} />
                      {connection?.connected ? "Open this URL" : "Open webpage"}
                    </button>
                  </div>
                  <p className="capture-hint">
                    Works best with local apps. For hosted sites or existing
                    logins,{" "}
                    <button
                      type="button"
                      className="inline-action"
                      disabled={!!busy}
                      onClick={() => setWebMode("shared")}
                    >
                      share a browser tab
                    </button>
                    .
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
                  <details className="viewport-settings">
                    <summary>
                      Viewport size{" "}
                      <span>
                        {width} × {height}
                      </span>
                    </summary>
                    <div className="capture-dimensions">
                      <label className="capture-field">
                        Width <span>px</span>
                        <input
                          type="number"
                          min={320}
                          max={2560}
                          required
                          value={width}
                          onChange={(event) =>
                            setWidth(Number(event.target.value))
                          }
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
                  </details>
                </form>
              ) : (
                <div className="simulator-settings-body">
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
                      ? devices.length
                        ? "Choose a device to navigate and capture its screen here."
                        : "Open Simulator and boot a device, then refresh this list."
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
              <button
                className="text-button capture-refresh"
                disabled={!!busy}
                onClick={() => void perform("Checking sources…", refresh)}
              >
                <RefreshCw size={16} />
                Refresh sources
              </button>
            </details>
            {connection?.connected && (
              <div className="capture-preview">
                <LiveView
                  key={`${kind}-${connection.generation}-${connection.device?.id || connection.url}-${connection.viewport?.width}-${connection.viewport?.height}`}
                  kind={kind}
                  generation={connection.generation || 0}
                  inputWarning={connection.inputWarning}
                  onReconnect={
                    kind === "simulator"
                      ? () =>
                          perform("Reconnecting simulator…", async () => {
                            await action("open", {
                              kind,
                              deviceId: connection.device?.id,
                            });
                            await refresh();
                          })
                      : undefined
                  }
                  title={
                    kind === "web"
                      ? "Live webpage"
                      : connection.device?.name || "Live simulator"
                  }
                  busy={!!busy}
                  onError={setError}
                  onCapture={() =>
                    perform("Capturing screen…", () => onCapture(kind))
                  }
                />
                <button
                  className="text-button capture-disconnect"
                  disabled={!!busy}
                  onClick={() =>
                    void perform("Disconnecting…", async () => {
                      await action("disconnect", { kind });
                      await refresh();
                    })
                  }
                >
                  {kind === "web" ? "Close webpage" : "Disconnect simulator"}
                </button>
              </div>
            )}
            {kind === "web" && (
              <div className="sharing-entry">
                <div>
                  <strong>Reviewing a hosted site?</strong>
                  <span>
                    Use your browser’s tab, with its logins and verification
                    already handled.
                  </span>
                </div>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => setWebMode("shared")}
                >
                  <MonitorUp size={18} />
                  Share browser tab
                </button>
              </div>
            )}
          </div>
        )}
        <div className="capture-status-row">
          {!status && !shared && (
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => void perform("Checking sources…", refresh)}
            >
              <RefreshCw size={16} />
              Refresh sources
            </button>
          )}
          <span role="status">{busy}</span>
        </div>
      </div>
    </main>
  );
}
