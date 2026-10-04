import { useCallback, useEffect, useRef, useState } from "react";

export type SharedSurface = "browser" | "window" | "monitor";
export function useTabShare() {
  const [stream, setStream] = useState<MediaStream>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const current = useRef<MediaStream | undefined>(undefined);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    current.current?.getTracks().forEach((track) => track.stop());
    current.current = undefined;
    setStream(undefined);
    setPending(false);
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      current.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  const start = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMessage(
        "Tab sharing is unavailable in this browser. Open this Scribble session in Chrome or Edge, then choose Share browser tab.",
      );
      return;
    }
    const attempt = ++generation.current;
    setPending(true);
    setMessage("");
    try {
      // Call synchronously from the user's click: the picker requires user activation.
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      } as DisplayMediaStreamOptions);
      if (generation.current !== attempt) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = next.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        next.getTracks().forEach((track) => track.stop());
        throw new Error("The shared screen ended. Choose a tab again.");
      }
      current.current?.getTracks().forEach((track) => track.stop());
      current.current = next;
      track.contentHint = "detail";
      track.addEventListener(
        "ended",
        () => {
          if (current.current !== next) return;
          stop();
          setMessage(
            "Sharing ended. Your captured images are saved. Share a tab to continue.",
          );
        },
        { once: true },
      );
      setStream(next);
    } catch (error) {
      if (generation.current !== attempt) return;
      const name = (error as Error).name;
      setMessage(
        name === "NotAllowedError" || name === "AbortError"
          ? "No new tab was shared. Choose Share browser tab when you’re ready."
          : name === "NotReadableError"
            ? "The browser could not read that screen. Check your screen recording permission, then try again."
            : (error as Error).message ||
              "Could not share this screen. Try Chrome or Edge.",
      );
    } finally {
      if (generation.current === attempt) setPending(false);
    }
  };
  return { stream, pending, message, start, stop };
}
export type TabShare = ReturnType<typeof useTabShare>;
