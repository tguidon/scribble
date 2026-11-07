import { useEffect, useSyncExternalStore } from "react";
import { imageUrl } from "./api";
import { getEditorHost } from "./editorHost";
import type { ImageAsset } from "./imageCache";

const empty: ImageAsset = {};
const noSubscription = () => () => {};
export function useImageSource(id?: string) {
  const cache = getEditorHost()?.images;
  const asset = useSyncExternalStore(cache?.subscribe || noSubscription, () =>
    id && cache ? cache.get(id) : empty,
  );
  const load = () => {
    if (id) void cache?.load(id).catch(() => {});
  };
  useEffect(load, [id, cache]);
  return {
    url: cache ? asset.url : id ? imageUrl(id) : undefined,
    error: asset.error,
    retry: load,
  };
}
