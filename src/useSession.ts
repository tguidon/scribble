import { useCallback, useEffect, useRef, useState } from "react";
import { loadSession, request, saveDraft, sessionId, uploadImage } from "./api";
import type { Draft, Session } from "./types";
const key = `scribble-draft-${sessionId}`;
export function useSession() {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<
    "loading" | "saved" | "saving" | "offline"
  >("loading");
  const [busy, setBusy] = useState(false);
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
  useEffect(() => {
    let active = true;
    loadSession()
      .then((value) => {
        if (!active) return;
        revision.current = value.revision;
        let local: { draft: Draft; revision: number } | undefined;
        try {
          local = JSON.parse(localStorage.getItem(key) || "null");
        } catch {
          /* A broken browser cache must not block disk recovery. */
        }
        if (
          value.status === "draft" &&
          local &&
          local.revision === value.revision
        ) {
          value = { ...value, ...local.draft };
          generation.current = 1;
        } else if (local) {
          localStorage.removeItem(key);
          if (value.status === "draft")
            setError(
              "A newer draft was saved in another tab. The latest server draft has been loaded.",
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
        const value = current.current;
        if (
          !value ||
          value.status === "submitted" ||
          saved.current === generation.current
        )
          return;
        const version = generation.current;
        setSaveState("saving");
        try {
          const response = await saveDraft(
            { message: value.message, images: value.images },
            revision.current,
          );
          revision.current = response.revision;
          saved.current = version;
          if (current.current)
            update({
              ...current.current,
              revision: response.revision,
              updatedAt: response.updatedAt,
            });
          if (generation.current === version) {
            localStorage.removeItem(key);
            setSaveState("saved");
          } else {
            try {
              localStorage.setItem(
                key,
                JSON.stringify({
                  draft: {
                    message: current.current!.message,
                    images: current.current!.images,
                  },
                  revision: revision.current,
                }),
              );
            } catch {
              /* Server remains primary storage. */
            }
          }
        } catch (e) {
          setSaveState("offline");
          throw e;
        }
      }),
    [enqueue, update],
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
      generation.current++;
      const value = { ...current.current, ...draft };
      update(value);
      setSaveState("saving");
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ draft, revision: revision.current }),
        );
      } catch {
        setError(
          "Browser backup is full or unavailable. Keep this tab open until “Draft saved” appears.",
        );
      }
    },
    [update],
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
        localStorage.removeItem(key);
      });
    } catch (e) {
      // A dropped response may follow a successful durable submission.
      const recovered = await loadSession().catch(() => undefined);
      if (recovered?.status === "submitted") {
        update(recovered);
        localStorage.removeItem(key);
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
    change,
    upload,
    submit,
    flush,
  };
}
