export type ImageAsset = { url?: string; error?: string };
const empty: ImageAsset = {};

// Shared asset state lets every thumbnail observe a retry without coupling
// screenshot downloads to the document's save acknowledgement.
export function createImageCache(
  load: (id: string, signal: AbortSignal) => Promise<string>,
  release: (url: string) => void,
) {
  const images = new Map<string, Promise<string>>();
  const assets = new Map<string, ImageAsset>();
  const listeners = new Set<() => void>();
  const abort = new AbortController();
  const publish = (id: string, asset: ImageAsset) => {
    assets.set(id, asset);
    for (const listener of listeners) listener();
  };
  return {
    get: (id: string) => assets.get(id) || empty,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load(id: string) {
      let pending = images.get(id);
      if (!pending) {
        publish(id, empty);
        pending = load(id, abort.signal)
          .then((url) => {
            if (abort.signal.aborted) {
              release(url);
              throw abort.signal.reason;
            }
            publish(id, { url });
            return url;
          })
          .catch((error) => {
            images.delete(id);
            if (!abort.signal.aborted) publish(id, { error: error.message });
            throw error;
          });
        images.set(id, pending);
      }
      return pending;
    },
    dispose() {
      abort.abort();
      for (const pending of images.values())
        void pending.then(release, () => {});
      images.clear();
      assets.clear();
      listeners.clear();
    },
  };
}
export type ImageCache = ReturnType<typeof createImageCache>;
