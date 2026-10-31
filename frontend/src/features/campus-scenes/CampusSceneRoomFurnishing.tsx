import { useState } from "react";
import { ROOM_FURNISHING_TEMPLATES, type RoomFurnishingTemplate } from "./sceneRoomTemplates";

export function CampusSceneRoomFurnishing({ existingCount, disabled, relativeScale = false, onApply }: { existingCount: number; disabled: boolean; relativeScale?: boolean; onApply: (template: RoomFurnishingTemplate) => void }) {
  const [template, setTemplate] = useState<RoomFurnishingTemplate>("office");
  const [replace, setReplace] = useState(false);
  return <details className="campus-scene-disclosure scene-room-furnishing"><summary>Furnish this room</summary>
    <div className="campus-scene-fields"><p className="campus-scene-helper">Start with an editable arrangement. This creates illustration objects; recorded inventory is linked separately.</p>
      {relativeScale ? <p className="campus-scene-helper">This plan has no measured scale. Furniture sizes and spacing are fitted illustratively to the room.</p> : null}
      <label>Room arrangement<select value={template} disabled={disabled} onChange={event => { setTemplate(event.target.value as RoomFurnishingTemplate); setReplace(false); }}>{ROOM_FURNISHING_TEMPLATES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <p className="campus-scene-helper">{ROOM_FURNISHING_TEMPLATES.find(item => item.key === template)?.description}. Items that cannot fit inside the room are left out.</p>
      {existingCount ? <label className="campus-scene-check"><input type="checkbox" checked={replace} disabled={disabled} onChange={event => setReplace(event.target.checked)} /><span>Add an arrangement alongside the {existingCount} existing {existingCount === 1 ? "object" : "objects"} in this room.</span></label> : null}
      <button type="button" className="campus-scene-button" disabled={disabled || Boolean(existingCount && !replace)} onClick={() => { onApply(template); setReplace(false); }}>Add editable furniture</button>
    </div>
  </details>;
}
