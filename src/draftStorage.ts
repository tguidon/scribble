import { getEditorHost } from "./editorHost";

// Opaque plugin iframes may forbid browser storage. Keep their unsaved recovery
// copy in memory; the existing autosave still writes every draft to local disk.
const memory = new Map<string, string>();
function storage() {
  try {
    return window.localStorage;
  } catch (error) {
    if (!getEditorHost()) throw error;
    return {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };
  }
}
export const draftStorage = {
  getItem: (key: string) => storage().getItem(key),
  setItem: (key: string, value: string) => storage().setItem(key, value),
  removeItem: (key: string) => storage().removeItem(key),
};
