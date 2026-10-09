import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadSession,
  request,
  saveDraft,
  currentSessionId,
  uploadImage,
} from "./api";
import type { CaptureMode, Draft, Session } from "./types";
import { draftStorage } from "./draftStorage";
import {
  draftBytes,
  MAX_DRAFT_BYTES,
  DRAFT_TOO_LARGE,
} from "../skills/scribble/scripts/lib/limits.mjs";
type Backup = { draft: Draft; revision: number; pendingSaveId?: string };
type PendingSave = {
  draft: Draft;
  revision: number;
  id: string;
  generation: number;
};
export function useSession() {
  const key = `scribble-draft-${currentSessionId()}`;
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<
    "loading" | "saved" | "saving" | "offline"
  >("loading");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<Backup>();
  const pending = useRef<PendingSave | undefined>(undefined);
  const pendingCapture = useRef<
    { kind: CaptureMode; captureId: string } | undefined
  >(undefined);
  const current = useRef<Session | undefined>(undefined);
  const generation = useRef(0);
  const saved = useRef(0);
  const revision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const update = useCallback((value: Session) => {
    current.current = value;
    setSession(value);
  }, []);
  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const promise = queue.current.then(task);
    queue.current = promise.catch(() => {});
    return promise;
  }, []);
  const backup = useCallback(() => {
    const value = current.current;
    if (!value) return;
    try {
      if (saved.current === generation.current && !pending.current)
        draftStorage.removeItem(key);
      else
        draftStorage.setItem(
          key,
          JSON.stringify({
            draft: { message: value.message, images: value.images },
            revision: revision.current,
            pendingSaveId: pending.current?.id,
          } satisfies Backup),
        );
    } catch {
      setError(
        "Browser backup is full or unavailable. Keep this tab open until “Draft saved” appears.",
      );
    }
  }, []);
  useEffect(() => {
    let active = true;
    loadSession()
      .then((value) => {
        if (!active) return;
        revision.current = value.revision;
        let local: Backup | undefined;
        try {
          local = JSON.parse(draftStorage.getItem(key) || "null");
        } catch {
          /* A broken browser cache must not block disk recovery. */
        }
        if (
          value.status === "draft" &&
          local &&
          (local.revision === value.revision ||
            (local.pendingSaveId &&
              local.pendingSaveId === value.lastSaveId &&
              local.revision + 1 === value.revision))
        ) {
          value = { ...value, ...local.draft };
          generation.current = 1;
        } else if (local) {
          setRecovery(local);
          setError(
            "This session changed since your last save. Your unsaved draft is preserved. Download it before choosing Use saved draft.",
          );
        }
        update(value);
        setSaveState(generation.current ? "saving" : "saved");
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setSaveState("offline");
        }
      });
    return () => {
      active = false;
    };
  }, [update]);
  const flush = useCallback(
    () =>
      enqueue(async () => {
        // Retry the exact outstanding request before saving any newer edits.
        while (
          current.current?.status === "draft" &&
          (pending.current || saved.current !== generation.current)
        ) {
          const value = current.current;
          const operation = (pending.current ||= {
            id: crypto.randomUUID(),
            revision: revision.current,
            draft: { message: value.message, images: value.images },
            generation: generation.current,
          });
          backup();
          setSaveState("saving");
          try {
            const response = await saveDraft(
              operation.draft,
              operation.revision,
              operation.id,
            );
            revision.current = response.revision;
            saved.current = operation.generation;
            pending.current = undefined;
            update({
              ...current.current!,
              revision: response.revision,
              updatedAt: response.updatedAt,
            });
            backup();
            if (saved.current === generation.current) {
              setSaveState("saved");
              setError("");
            }
          } catch (error) {
            // Rejected input may be corrected. Uncertain network outcomes retain the ID.
            if (
              error instanceof Error &&
              "status" in error &&
              [400, 413].includes(Number(error.status))
            ) {
              pending.current = undefined;
              backup();
            }
            setSaveState("offline");
            throw error;
          }
        }
      }),
    [enqueue, update, backup],
  );
  useEffect(() => {
    if (
      !session ||
      session.status !== "draft" ||
      generation.current === saved.current
    )
      return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch((e) => setError(e.message));
    }, 500);
    return () => clearTimeout(timer.current);
  }, [session, flush]);
  useEffect(() => {
    const retry = () => {
      void flush().catch((e) => setError(e.message));
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generation.current !== saved.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("online", retry);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [flush]);
  const change = useCallback(
    (draft: Draft) => {
      if (!current.current || current.current.status !== "draft") return;
      if (recovery) return false;
      if (draftBytes(draft) > MAX_DRAFT_BYTES) {
        setError(DRAFT_TOO_LARGE);
        return false;
      }
      generation.current++;
      update({ ...current.current, ...draft });
      setSaveState("saving");
      backup();
      return true;
    },
    [update, backup, recovery],
  );
  const upload = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setError("");
      try {
        await flush();
        return await enqueue(async () => {
          let result = current.current;
          for (const file of files) {
            const response = await uploadImage(file);
            revision.current = response.revision;
            result = {
              ...response,
              message: current.current?.message || response.message,
            };
            update(result);
          }
          return result;
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [enqueue, flush, update],
  );
  const capture = useCallback(
    async (kind: CaptureMode, file?: File, surface?: string) => {
      if (recovery)
        throw new Error(
          "Resolve the saved draft conflict before capturing a screen.",
        );
      setBusy(true);
      setError("");
      if (pendingCapture.current?.kind !== kind)
        pendingCapture.current = {
          kind,
          captureId: crypto.randomUUID(),
        };
      const operation = pendingCapture.current;
      try {
        await flush();
        return await enqueue(async () => {
          let result: Session;
          try {
            if (operation.kind === "shared") {
              if (!file) throw new Error("Capture a shared frame first.");
              const params = new URLSearchParams({
                captureId: operation.captureId,
                revision: String(revision.current),
                surface: surface || "browser",
              });
              result = await request<Session>(`/capture/shared?${params}`, {
                method: "POST",
                // Keep the ID for lost acknowledgements, but use the current
                // frame when the previous attempt did not save an image.
                body: file,
              });
            } else
              result = await request<Session>("/capture/snapshot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...operation,
                  revision: revision.current,
                }),
              });
          } catch (error) {
            const recovered = await loadSession().catch(() => undefined);
            if (
              !recovered?.images.some(
                (image) => image.id === operation.captureId,
              )
            )
              throw error;
            result = recovered;
          }
          revision.current = result.revision;
          pendingCapture.current = undefined;
          update(result);
          setSaveState("saved");
          return result;
        });
      } finally {
        setBusy(false);
      }
    },
    [enqueue, flush, update, recovery],
  );
  const submit = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await flush();
      await enqueue(async () => {
        const result = await request<Session>("/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: revision.current }),
        });
        update(result);
        draftStorage.removeItem(key);
      });
    } catch (e) {
      // A dropped response may follow a successful durable submission.
      const recovered = await loadSession().catch(() => undefined);
      if (recovered?.status === "submitted") {
        update(recovered);
        draftStorage.removeItem(key);
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [enqueue, flush, update]);
  return {
    session,
    error,
    setError,
    saveState,
    busy,
    recovery,
    downloadRecovery: () => {
      if (!recovery) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(recovery.draft, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "scribble-unsaved-draft.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    useSavedDraft: () => {
      draftStorage.removeItem(key);
      setRecovery(undefined);
      setError("");
    },
    change,
    upload,
    capture,
    submit,
    flush,
  };
}
