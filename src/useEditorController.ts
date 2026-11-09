import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./useSession";
import {
  INKS,
  type Annotation,
  type CaptureKind,
  type CaptureRequest,
  type Draft,
  type Tool,
} from "./types";

const draftOf = ({ message, images }: Draft): Draft => ({ message, images });
type History = { past: Draft[]; future: Draft[] };
const emptyHistory = (): History => ({ past: [], future: [] });

// Document commands and interaction choices share the canvas lifetime. Mounted
// views own only DOM effects and transient affordances such as open dialogs.
export function useEditorController() {
  const {
    session,
    change,
    upload,
    capture,
    recovery,
    busy: working,
    setError,
    ...persistence
  } = useSession();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureKind, setCaptureKind] = useState<CaptureKind>("web");
  const [webMode, setWebMode] = useState<"direct" | "shared">("direct");
  const [activeId, setActiveId] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pin");
  const [color, setColor] = useState(INKS[0].color);
  const [history, setHistory] = useState<History>(emptyHistory);
  const typing = useRef<string | undefined>(undefined);
  const imageSet = session?.images.map((item) => item.id).join(":");
  // Image inventory changes are not undoable, including partially successful
  // multi-file uploads. Keep history from restoring an obsolete inventory.
  useEffect(() => {
    setHistory(emptyHistory());
    typing.current = undefined;
  }, [imageSet]);
  const image =
    session?.images.find((item) => item.id === activeId) || session?.images[0];
  const busy = working || !!recovery;
  const submitted = session?.status === "submitted";
  const disabled = busy || !session || submitted || captureOpen;
  const endEdit = useCallback(() => {
    typing.current = undefined;
  }, []);
  const edit = (next: Draft, group?: string) => {
    if (disabled || !session || !change(next)) return false;
    const grouped = group !== undefined && typing.current === group;
    setHistory(({ past }) => ({
      past: grouped ? past : [...past.slice(-99), draftOf(session)],
      future: [],
    }));
    typing.current = group;
    return true;
  };
  const undo = useCallback(() => {
    const previous = history.past.at(-1);
    if (disabled || !session || !previous || !change(previous)) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [draftOf(session), ...history.future],
    });
    typing.current = undefined;
    setSelected(null);
  }, [history, disabled, session, change]);
  const redo = useCallback(() => {
    const next = history.future[0];
    if (disabled || !session || !next || !change(next)) return;
    setHistory({
      past: [...history.past, draftOf(session)],
      future: history.future.slice(1),
    });
    typing.current = undefined;
    setSelected(null);
  }, [history, disabled, session, change]);
  const acceptImages = useCallback((result?: typeof session) => {
    if (!result) return;
    setActiveId(result.images.at(-1)?.id);
    setSelected(null);
  }, []);
  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled || !files.length) return;
      acceptImages(await upload(files));
    },
    [disabled, upload, acceptImages],
  );
  const captureImage = async (input: CaptureRequest) => {
    const result = await capture(input);
    acceptImages(result);
    setCaptureOpen(false);
  };
  return {
    ...persistence,
    session,
    recovery,
    setError,
    busy,
    working,
    submitted,
    disabled,
    image,
    selected,
    setSelected,
    tool,
    setTool,
    color,
    setColor,
    captureOpen,
    setCaptureOpen,
    captureKind,
    setCaptureKind,
    webMode,
    setWebMode,
    selectImage: (id: string) => {
      setActiveId(id);
      setSelected(null);
    },
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    endEdit,
    addFiles,
    captureImage,
    totalMarks:
      session?.images.reduce(
        (count, item) => count + item.annotations.length,
        0,
      ) || 0,
    addMark(mark: Annotation) {
      if (!image || !session) return false;
      if (image.annotations.length >= 500) {
        setError(
          "This screenshot has 500 marks. Add another screenshot to continue.",
        );
        return false;
      }
      return edit({
        ...draftOf(session),
        images: session.images.map((item) =>
          item.id === image.id
            ? { ...item, annotations: [...item.annotations, mark] }
            : item,
        ),
      });
    },
    updateComment(id: string, comment: string) {
      if (!session) return;
      edit(
        {
          ...draftOf(session),
          images: session.images.map((item) => ({
            ...item,
            annotations: item.annotations.map((mark) =>
              mark.id === id ? { ...mark, comment } : mark,
            ),
          })),
        },
        id,
      );
    },
    setMessage(message: string) {
      if (session) edit({ ...draftOf(session), message }, "overall");
    },
    deleteMark(id: string) {
      if (!session) return;
      if (
        edit({
          ...draftOf(session),
          images: session.images.map((item) => ({
            ...item,
            annotations: item.annotations.filter((mark) => mark.id !== id),
          })),
        }) &&
        selected === id
      )
        setSelected(null);
    },
    removeImage(id: string) {
      if (
        disabled ||
        !session ||
        !change({
          ...draftOf(session),
          images: session.images.filter((item) => item.id !== id),
        })
      )
        return false;
      setSelected(null);
      return true;
    },
  };
}
export type EditorController = ReturnType<typeof useEditorController>;
