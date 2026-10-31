import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, RotateCw } from "lucide-react";
import { useState } from "react";
import type { FloorPlanAdjustment } from "./sceneFloorPlans";

export function CampusSceneFloorPlanAlignment({ disabled, step, onAdjust }: { disabled: boolean; step: number; onAdjust: (adjustment: FloorPlanAdjustment) => void }) {
  const [angle, setAngle] = useState("");
  return <details className="campus-scene-disclosure scene-floor-plan-alignment"><summary>Adjust plan alignment</summary>
    <p className="campus-scene-helper">Move the whole plan together. Placement and scale remain illustrative; this does not change the building outline.</p>
    <div className="scene-floor-plan-alignment__controls"><div role="group" aria-label="Rotate floor plan"><button type="button" className="campus-scene-button" disabled={disabled} onClick={() => onAdjust({ rotationDeg: -90 })}><RotateCcw size={16} />Left 90°</button><button type="button" className="campus-scene-button" disabled={disabled} onClick={() => onAdjust({ rotationDeg: 90 })}><RotateCw size={16} />Right 90°</button></div>
      <div role="group" aria-label="Floor plan size"><button type="button" className="campus-scene-button" disabled={disabled} onClick={() => onAdjust({ scale: .9 })}>Smaller</button><button type="button" className="campus-scene-button" disabled={disabled} onClick={() => onAdjust({ scale: 1 / .9 })}>Larger</button></div>
      <div role="group" aria-label="Move floor plan">{([{ label: "Move plan left", icon: ArrowLeft, dx: -step, dy: 0 }, { label: "Move plan up", icon: ArrowUp, dx: 0, dy: -step }, { label: "Move plan down", icon: ArrowDown, dx: 0, dy: step }, { label: "Move plan right", icon: ArrowRight, dx: step, dy: 0 }] as const).map(({ label, icon: Icon, dx, dy }) => <button key={label} type="button" className="campus-scene-icon-button" aria-label={label} disabled={disabled} onClick={() => onAdjust({ dx, dy })}><Icon size={18} /></button>)}</div>
      <div className="scene-floor-plan-alignment__angle"><label>Fine rotation (degrees)<input type="number" min={-180} max={180} step={1} value={angle} disabled={disabled} onChange={event => setAngle(event.target.value)} /></label><button type="button" className="campus-scene-button" disabled={disabled || !angle || !Number.isFinite(Number(angle)) || Math.abs(Number(angle)) > 180 || Number(angle) === 0} onClick={() => { onAdjust({ rotationDeg: Number(angle) }); setAngle(""); }}>Rotate plan</button></div>
    </div>
  </details>;
}
