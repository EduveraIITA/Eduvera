import { Compass, LocateFixed, Minus, Plus } from "lucide-react";

export function CampusMapControls({ onZoomIn, onZoomOut, onFit }: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return <>
    <div className="campus-map-compass" aria-hidden="true"><Compass size={15} /><b>N</b></div>
    <div className="campus-map-zoom" role="group" aria-label="Campus map controls">
      <button type="button" onClick={onZoomIn} aria-label="Zoom in"><Plus size={20} /></button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out"><Minus size={20} /></button>
      <button type="button" onClick={onFit} aria-label="Fit whole campus"><LocateFixed size={19} /></button>
    </div>
  </>;
}
