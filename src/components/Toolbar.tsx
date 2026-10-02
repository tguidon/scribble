import {
  MousePointer2,
  MapPin,
  MoveUpRight,
  Square,
  Pencil,
  Hand,
  Undo2,
  Redo2,
} from "lucide-react";
import { INKS, type Tool } from "../types";
const tools = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2 },
  { id: "pin", label: "Pin", key: "P", icon: MapPin },
  { id: "arrow", label: "Arrow", key: "A", icon: MoveUpRight },
  { id: "rectangle", label: "Rectangle", key: "R", icon: Square },
  { id: "freehand", label: "Draw", key: "D", icon: Pencil },
  { id: "pan", label: "Pan", key: "H", icon: Hand },
] as const;
export function Toolbar({
  tool,
  setTool,
  color,
  setColor,
  undo,
  redo,
  canUndo,
  canRedo,
  disabled,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  disabled: boolean;
}) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="tool-group">
        {tools.map(({ id, label, key, icon: Icon }) => (
          <button
            key={id}
            className={`tool-button ${tool === id ? "active" : ""}`}
            aria-label={`${label} (${key})`}
            aria-pressed={tool === id}
            title={`${label} · ${key}`}
            disabled={disabled}
            onClick={() => setTool(id)}
          >
            <Icon size={19} />
          </button>
        ))}
      </div>
      <div className="tool-group ink-group">
        {INKS.map((ink) => (
          <button
            key={ink.color}
            className={`ink ${color === ink.color ? "chosen" : ""}`}
            style={{ "--ink": ink.color } as React.CSSProperties}
            aria-label={`${ink.name} ink`}
            aria-pressed={color === ink.color}
            title={`${ink.name} ink`}
            disabled={disabled}
            onClick={() => setColor(ink.color)}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="tool-group">
        <button
          className="tool-button"
          aria-label="Undo"
          title="Undo · ⌘Z / Ctrl+Z"
          disabled={!canUndo || disabled}
          onClick={undo}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="tool-button"
          aria-label="Redo"
          title="Redo · ⌘⇧Z / Ctrl+Shift+Z"
          disabled={!canRedo || disabled}
          onClick={redo}
        >
          <Redo2 size={18} />
        </button>
      </div>
    </div>
  );
}
