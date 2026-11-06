import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";

export type Viewport = { width: number; height: number };

const presets = [
  { label: "Desktop", width: 1920, height: 1080, icon: Monitor },
  { label: "Laptop", width: 1280, height: 900, icon: Laptop },
  { label: "Tablet", width: 768, height: 1024, icon: Tablet },
  { label: "Phone", width: 390, height: 844, icon: Smartphone },
];

export function ViewportPicker({
  viewport,
  disabled,
  onChange,
}: {
  viewport: Viewport;
  disabled: boolean;
  onChange: (viewport: Viewport) => void;
}) {
  return (
    <div className="viewport-picker">
      <div
        className="viewport-presets"
        role="group"
        aria-label="Webpage viewport"
      >
        {presets.map(({ label, width, height, icon: Icon }) => (
          <button
            key={label}
            type="button"
            aria-pressed={
              viewport.width === width && viewport.height === height
            }
            title={`${label}: ${width} × ${height} px`}
            disabled={disabled}
            onClick={() => onChange({ width, height })}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <span className="viewport-size" aria-live="polite" aria-atomic="true">
        {viewport.width} × {viewport.height} px
      </span>
    </div>
  );
}
