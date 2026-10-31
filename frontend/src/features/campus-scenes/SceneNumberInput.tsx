import { useRef, useState } from "react";

/** Keep partial numbers editable; apply a finite bounded value when the field is left. */
export function SceneNumberInput({ value, min, max, step = .1, onCommit }: { value: number; min: number; max: number; step?: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const cancel = useRef(false);
  return <input type="number" min={min} max={max} step={step} value={text ?? value}
    onFocus={() => setText(String(value))} onChange={event => setText(event.target.value)}
    onBlur={event => {
      const raw = event.currentTarget.value;
      if (!cancel.current && raw.trim()) {
        const next = Number(raw);
        if (Number.isFinite(next)) { const bounded = Math.max(min, Math.min(max, next)); if (bounded !== value) onCommit(bounded); }
      }
      cancel.current = false; setText(null);
    }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); cancel.current = true; event.currentTarget.blur(); }
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    }} />;
}
