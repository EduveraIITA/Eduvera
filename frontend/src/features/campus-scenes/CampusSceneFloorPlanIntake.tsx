import { useEffect, useMemo, useState } from "react";
import { FileImage } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { isDefinitiveSceneImportFailure } from "./sceneImportFailure";
import type { CampusSceneDocument, CampusSceneImportCapabilities, CampusSceneSpace } from "./types";
import "./campus-scene-floor-plan.css";

export interface FloorPlanIntakeRequest {
  file: File;
  buildingId: string;
  floorId: string | null;
  newFloor?: { name: string; code: string };
  instructions: string;
  rightsConfirmed: true;
  traceOnly?: boolean;
}

interface Props {
  document: CampusSceneDocument;
  spaces: readonly CampusSceneSpace[];
  initialBuildingId?: string | null;
  capabilities?: CampusSceneImportCapabilities;
  disabled?: boolean;
  onPrepare: (request: FloorPlanIntakeRequest) => Promise<void>;
  onClose: () => void;
}

/** Exact ancestry is used only to offer a floor in its selected building. */
export function floorBelongsToBuilding(floor: CampusSceneSpace, buildingId: string, spaces: readonly CampusSceneSpace[]): boolean {
  if (floor.kind !== "floor") return false;
  const visited = new Set<string>([floor.id]);
  let parentId = floor.parent_space_id;
  while (parentId && !visited.has(parentId)) {
    if (parentId === buildingId) return true;
    visited.add(parentId);
    parentId = spaces.find(space => space.id === parentId)?.parent_space_id ?? null;
  }
  return false;
}

export function CampusSceneFloorPlanIntake({ document, spaces, initialBuildingId, capabilities, disabled = false, onPrepare, onClose }: Props) {
  const buildings = useMemo(() => spaces.filter(space => space.status !== "inactive" && document.elements.some(element => element.kind === "building" && element.space_id === space.id)), [document.elements, spaces]);
  const [buildingId, setBuildingId] = useState(() => buildings.some(space => space.id === initialBuildingId) ? initialBuildingId! : buildings[0]?.id ?? "");
  const floors = useMemo(() => spaces.filter(space => floorBelongsToBuilding(space, buildingId, spaces)), [spaces, buildingId]);
  const [floorId, setFloorId] = useState(() => floors[0]?.id ?? "");
  const [floorName, setFloorName] = useState("Ground floor");
  const [floorCode, setFloorCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [terminalFailure, setTerminalFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const maxImageBytes = capabilities?.max_image_bytes ?? 4 * 1024 * 1024;
  const analysisAvailable = capabilities?.image_analysis.available === true;
  const locked = disabled || busy;
  const valid = Boolean(file && rights && buildingId && (floorId || floorName.trim().length >= 2));
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const prepare = async (traceOnly = false) => {
    if (!valid || !file || locked) return;
    setBusy(true); setError(null); setTerminalFailure(false);
    try {
      await onPrepare({ file, buildingId, floorId: floorId || null, ...(!floorId ? { newFloor: { name: floorName.trim(), code: floorCode.trim() } } : {}), instructions: instructions.trim(), rightsConfirmed: true, ...(traceOnly || !analysisAvailable ? { traceOnly: true } : {}) });
    } catch (cause) {
      setTerminalFailure(isDefinitiveSceneImportFailure(cause));
      setError(cause instanceof Error ? cause.message : "This floor plan could not be prepared. Your campus layout is unchanged.");
    } finally { setBusy(false); }
  };

  return <PlannerDialog title="Add a floor plan" subtitle="Bring the rooms into your existing campus layout." busy={locked} onClose={onClose}>
    <div className="scene-floor-plan-intake">
      {!buildings.length ? <p role="status">Connect a building in your campus layout first, then add its floor plan here.</p> : <>
        <p className="scene-floor-plan-intake__intro">Choose the floor and upload its plan. You will check the suggested places together before anything is created.</p>
        <fieldset className="campus-scene-fields" disabled={locked}>
          <div className="scene-floor-plan-intake__context">
            <label>Building<select value={buildingId} onChange={event => { const id = event.target.value; setBuildingId(id); setFloorId(spaces.find(space => floorBelongsToBuilding(space, id, spaces))?.id ?? ""); setError(null); }}>
              {buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select></label>
            <label>Floor<select value={floorId} onChange={event => { setFloorId(event.target.value); setError(null); }}>
              {floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
              <option value="">Create a floor with these rooms</option>
            </select></label>
          </div>
          {!floorId ? <label>Floor name<input value={floorName} maxLength={160} onChange={event => setFloorName(event.target.value)} /></label> : null}
          <label className="campus-scene-upload"><FileImage size={28} aria-hidden="true" /><strong>{file?.name ?? "Choose a floor plan"}</strong><span>PNG, JPEG or WebP · up to {Math.floor(maxImageBytes / 1024 / 1024)} MB</span><input aria-label="Floor plan image" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
            const next = event.target.files?.[0]; if (!next) return;
            setFile(null); setImageUrl(null); setRights(false); setError(null); setTerminalFailure(false);
            if (!["image/png", "image/jpeg", "image/webp"].includes(next.type) || next.size > maxImageBytes) { setError(`Choose a PNG, JPEG or WebP smaller than ${Math.floor(maxImageBytes / 1024 / 1024)} MB.`); event.target.value = ""; return; }
            setFile(next); setImageUrl(URL.createObjectURL(next));
          }} /></label>
          {imageUrl ? <img className="campus-scene-source-preview" src={imageUrl} alt="Selected floor plan for review" /> : null}
          <label className="campus-scene-check"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /><span>I have permission to use and adapt this floor plan.</span></label>
          <details className="campus-scene-disclosure"><summary>Details that help (optional)</summary><div className="campus-scene-fields">
            <label>Notes about this plan<textarea rows={3} maxLength={1000} value={instructions} placeholder="Reception at the bottom. The wide central area is a corridor." onChange={event => setInstructions(event.target.value)} /></label>
            {!floorId ? <label>Floor code<input maxLength={40} value={floorCode} placeholder="Suggested automatically if left blank" onChange={event => setFloorCode(event.target.value)} /></label> : null}
          </div></details>
        </fieldset>
        {!analysisAvailable ? <p className="campus-scene-notice">{capabilities?.image_analysis.reason ?? "Image analysis is unavailable."} You can still trace this plan in the same editor.</p> : null}
        {error ? <p className="campus-scene-error" role="alert">{error}</p> : null}
        {terminalFailure ? <p className="campus-scene-helper">The previous analysis may have used an allowance. Start a new attempt when ready, or trace this plan instead.</p> : null}
        <details className="campus-scene-disclosure"><InfoSummary>What happens next</InfoSummary><p>The plan is fitted to the selected building as an editable proposal. Check its position, names and openings. Furniture stays illustrative until you link a recorded resource. Publishing is a separate step.</p></details>
      </>}
    </div>
    <footer className="scene-floor-plan-intake__actions"><button type="button" className="campus-scene-button" disabled={locked} onClick={onClose}>Cancel</button>
      {error && analysisAvailable && file && rights ? <button type="button" className="campus-scene-button" disabled={locked || !valid} onClick={() => void prepare(true)}>Trace plan instead</button> : null}
      {buildings.length ? <button type="button" className="campus-scene-button campus-scene-button--primary" disabled={locked || !valid} onClick={() => void prepare()}>{busy ? "Preparing floor plan…" : terminalFailure ? "Start a new attempt" : analysisAvailable ? "Find rooms in this plan" : "Use plan as tracing guide"}</button> : null}
    </footer>
  </PlannerDialog>;
}
