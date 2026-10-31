import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Trash2, X } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { CAMPUS_SCENE_ASSETS, SCENE_MATERIALS, SCENE_ROOFS } from "./sceneAssets";
import { clampPoint, elementBounds, moveElement, resizeElement } from "./sceneEditing";
import { sceneElementHeight, sceneElementWidth, sceneUnitScale } from "./sceneGeometry";
import { SceneNumberInput } from "./SceneNumberInput";
import { CampusSceneResourcePicker, type CampusSceneResourceScope } from "./CampusSceneResourcePicker";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from "./types";
import { SceneConnectorFields } from "./SceneConnectorFields";
import { sceneIndoorDepth } from "./sceneIndoorAssets";

interface Props {
  element: CampusSceneElement; scene: CampusSceneDocument; spaces: CampusSceneSpace[]; disabled: boolean;
  onChange: (element: CampusSceneElement) => void; onDelete: () => void; onDuplicate: () => void; onClose: () => void;
  setupHref?: string; resourceScope?: CampusSceneResourceScope; onCreatePlace?: () => void;
  fixedFloorContext?: boolean;
}

export function CampusSceneInspector({ element, scene, spaces, disabled, onChange, onDelete, onDuplicate, onClose, setupHref, resourceScope, onCreatePlace, fixedFloorContext }: Props) {
  const [pointLimit, setPointLimit] = useState(8);
  const helpId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const box = elementBounds(element);
  const patch = (update: Partial<CampusSceneElement>) => onChange({ ...element, ...update, review_state: "needs_review" });
  const floors = spaces.filter(space => space.kind === "floor");
  const assetOptions = CAMPUS_SCENE_ASSETS.filter(asset => asset.kind === element.kind);
  const minimumPoints = element.geometry.type === "polygon" ? 3 : element.geometry.type === "polyline" ? 2 : 1;
  const walkingPath = element.kind === "path" && element.asset_key !== "boundary_wall";
  const bySpaceId = new Map(spaces.map(space => [space.id, space]));
  const placeFloor = (space: CampusSceneSpace) => {
    let current: CampusSceneSpace | undefined = space;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.kind === "floor") return current.id;
      seen.add(current.id); current = current.parent_space_id ? bySpaceId.get(current.parent_space_id) : undefined;
    }
    return null;
  };
  const endpointPlaces = spaces.filter(space => placeFloor(space) === element.floor_id);
  const unit = scene.bounds.unit === "metres" ? "m" : "units";
  const connectorReady = !element.navigation_connector || Boolean(element.parent_element_id && element.navigation_connector.to_floor_id && (element.navigation_connector.kind === "entrance" || element.navigation_connector.from_floor_id));
  return <section className="campus-scene-inspector" aria-label="Selected item details">
    <header className="campus-scene-panel-heading"><div><span className="campus-scene-eyebrow">{element.kind}</span><h2 ref={heading} tabIndex={-1}>{element.label || "Unnamed item"}</h2></div><button type="button" className="campus-scene-icon-button" aria-label="Close item details" onClick={onClose}><X size={20} /></button></header>
    <fieldset disabled={disabled} className="campus-scene-fields">
      <label>Name<input value={element.label} maxLength={160} onChange={event => patch({ label: event.target.value })} /></label>
      {assetOptions.length > 1 ? <label>Appearance<select value={element.asset_key ?? ""} onChange={event => {
        const asset = assetOptions.find(option => option.key === event.target.value);
        if (asset) patch({ asset_key: asset.key, material: asset.material, ...(asset.roof ? { roof: asset.roof } : {}) });
      }}>{!assetOptions.some(asset => asset.key === element.asset_key) ? <option value={element.asset_key ?? ""}>Unspecified {element.kind}</option> : null}{assetOptions.map(asset => <option key={`${asset.kind}-${asset.key}`} value={asset.key}>{asset.label}</option>)}</select></label> : null}
      <label>Campus place<select aria-label="Campus place" aria-describedby={`${helpId}-place`} value={element.space_id ?? ""} onChange={event => patch({ space_id: event.target.value || null })}>
        <option value="">Visual feature only</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}{space.code ? ` · ${space.code}` : ""}</option>)}
      </select><small id={`${helpId}-place`}>Link an existing place to open its campus information. Appearance and names do not create a new place.</small></label>
      {onCreatePlace ? <button type="button" className="campus-scene-button" onClick={onCreatePlace}>{element.space_id ? "Edit campus place" : "Create campus place"}</button> : null}
      {setupHref && !onCreatePlace ? <p className="campus-scene-helper">Missing a place? <a className="campus-scene-text-link" href={setupHref}>Add or manage campus places</a>. Save your draft before leaving.</p> : null}
      {element.kind === "fixture" && resourceScope ? <CampusSceneResourcePicker key={`${resourceScope.schoolId}:${resourceScope.campusId}`} {...resourceScope} holdingId={element.holding_id ?? null} linkedElsewhere={new Set(scene.elements.flatMap(item => item.id !== element.id && item.holding_id ? [item.holding_id] : []))} disabled={disabled} onChange={holding_id => patch({ holding_id })} /> : null}
      {element.kind === "fixture" ? <SceneConnectorFields element={element} scene={scene} spaces={spaces} patch={patch} /> : null}
      {element.kind === "room" ? fixedFloorContext ? <p className="campus-scene-helper">The building and floor are chosen in this floor-plan review.</p> : <><label>Inside building<select value={element.parent_element_id ?? ""} onChange={event => patch({ parent_element_id: event.target.value || null })}><option value="">Not selected</option>{scene.elements.filter(item => item.kind === "building").map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Floor<select value={element.floor_id ?? ""} onChange={event => patch({ floor_id: event.target.value || null })}><option value="">Not selected</option>{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label></> : null}
      {walkingPath ? <details className="campus-scene-disclosure"><summary>Walking routes</summary>
        <p className="campus-scene-helper">Include a path only after checking its real walking access. Paths join only at identical corner coordinates on the same floor. Crossings do not create a junction.</p>
        <div className="campus-scene-route-fields"><label className="campus-scene-check"><input type="checkbox" checked={Boolean(element.navigation)} onChange={event => patch({ navigation: event.target.checked ? { walkable: true, accessible: false, status: "open", start_space_id: null, end_space_id: null } : undefined })} />Use for walking routes</label>
        {element.navigation ? <>
          <label>Route building<select value={element.parent_element_id ?? ""} onChange={event => patch({ parent_element_id: event.target.value || null })}><option value="">Outdoors or not selected</option>{scene.elements.filter(item => item.kind === "building" && item.space_id).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Route floor<select value={element.floor_id ?? ""} onChange={event => patch({ floor_id: event.target.value || null, navigation: { ...element.navigation!, start_space_id: null, end_space_id: null } })}><option value="">Outdoors</option>{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label>
          <label>Walking access<select value={element.navigation.status} onChange={event => patch({ navigation: { ...element.navigation!, status: event.target.value as "open" | "closed" } })}><option value="open">Open</option><option value="closed">Closed</option></select></label>
          <label className="campus-scene-check"><input type="checkbox" checked={element.navigation.accessible} onChange={event => patch({ navigation: { ...element.navigation!, accessible: event.target.checked } })} />Reviewed step-free path</label>
          {(["start_space_id", "end_space_id"] as const).map((field, index) => <label key={field}>{index === 0 ? "Path start place" : "Path end place"}<select value={element.navigation![field] ?? ""} onChange={event => patch({ navigation: { ...element.navigation!, [field]: event.target.value || null } })}><option value="">Junction only</option>{endpointPlaces.map(space => <option key={space.id} value={space.id}>{space.name}{space.code ? ` · ${space.code}` : ""}</option>)}</select></label>)}
          <p className="campus-scene-helper">The first and last corners are the linked place's entrance or arrival point. No route is added through a building or between floors. Step-free access is an administrator's review, not an accessibility certification.</p>
        </> : null}</div>
      </details> : null}
      <div className="campus-scene-field-pair">
        <label>Surface<select value={element.material ?? "neutral"} onChange={event => patch({ material: event.target.value as CampusSceneElement["material"] })}>{SCENE_MATERIALS.map(material => <option key={material.key} value={material.key}>{material.label}</option>)}</select></label>
        {element.kind === "building" ? <label>Floors<SceneNumberInput min={1} max={100} step={1} value={element.levels ?? 1} onCommit={value => patch({ levels: Math.round(value), height: undefined })} /></label> : null}
        {element.kind === "road" || element.kind === "path" || element.kind === "tree" || element.kind === "fixture" ? <label>Width ({unit})<SceneNumberInput min={.1} max={10000} value={sceneElementWidth(element, sceneUnitScale(scene))} onCommit={value => patch({ width: value })} /></label> : null}
      </div>
      {element.kind === "building" ? <label>Roof<select value={element.roof ?? "flat"} onChange={event => patch({ roof: event.target.value as CampusSceneElement["roof"] })}>{SCENE_ROOFS.map(roof => <option key={roof.key} value={roof.key}>{roof.label}</option>)}</select></label> : null}
      <details className="campus-scene-disclosure"><summary>Position and shape</summary><p className="campus-scene-helper">Edit these values, or move the item and its corners in the flat plan.</p>
        <div className="campus-scene-field-pair"><label>Left ({unit})<SceneNumberInput min={0} max={scene.bounds.width} value={box.x} onCommit={value => onChange(moveElement(element, value - box.x, 0, scene.bounds))} /></label><label>Top ({unit})<SceneNumberInput min={0} max={scene.bounds.height} value={box.y} onCommit={value => onChange(moveElement(element, 0, value - box.y, scene.bounds))} /></label></div>
        {element.geometry.type === "polygon" ? <div className="campus-scene-field-pair"><label>Footprint width ({unit})<SceneNumberInput min={.1} max={scene.bounds.width} value={box.width} onCommit={value => onChange(resizeElement(element, "width", value, scene.bounds))} /></label><label>Footprint depth ({unit})<SceneNumberInput min={.1} max={scene.bounds.height} value={box.depth} onCommit={value => onChange(resizeElement(element, "depth", value, scene.bounds))} /></label></div> : null}
        {element.kind === "fixture" ? <div className="campus-scene-field-pair"><label>Depth ({unit})<SceneNumberInput min={.1} max={10000} value={sceneIndoorDepth(element, sceneUnitScale(scene))} onCommit={value => patch({ depth: value })} /></label><label>Rotation (°)<SceneNumberInput min={-360} max={360} step={1} value={element.rotation_deg ?? 0} onCommit={value => patch({ rotation_deg: value })} /></label></div> : null}
        {element.kind === "building" || element.kind === "tree" || element.kind === "fixture" || element.asset_key === "boundary_wall" ? <label>Visual height ({unit})<SceneNumberInput min={.1} max={10000} value={Math.round(sceneElementHeight(element, sceneUnitScale(scene)) * 100) / 100} onCommit={value => patch({ height: value })} /><small>Appearance only. Confirm real dimensions separately.</small></label> : null}
        <details className="campus-scene-disclosure"><summary>Corner coordinates ({element.geometry.points.length})</summary>
          {element.geometry.points.slice(0, pointLimit).map((point, index) => <div key={index} className="campus-scene-coordinate-row"><span>{index + 1}</span>{(["x", "y"] as const).map(axis => <label key={axis}><span>{axis.toUpperCase()} {index + 1}</span><SceneNumberInput min={0} max={axis === "x" ? scene.bounds.width : scene.bounds.height} value={point[axis]} onCommit={value => patch({ geometry: { ...element.geometry, points: element.geometry.points.map((item, position) => position === index ? clampPoint({ ...item, [axis]: value }, scene.bounds) : item) } })} /></label>)}<button type="button" className="campus-scene-icon-button" aria-label={`Remove corner ${index + 1}`} disabled={element.geometry.points.length <= minimumPoints} onClick={() => patch({ geometry: { ...element.geometry, points: element.geometry.points.filter((_, position) => position !== index) } })}><X size={16} /></button></div>)}
          {pointLimit < element.geometry.points.length ? <button type="button" className="campus-scene-button" onClick={() => setPointLimit(value => value + 8)}>Show more coordinates</button> : null}
          {element.geometry.type !== "point" && element.geometry.points.length < 500 ? <button type="button" className="campus-scene-button" onClick={() => {
            const points = element.geometry.points; const last = points.at(-1)!; const other = element.geometry.type === "polygon" ? points[0]! : points.at(-2)!;
            patch({ geometry: { ...element.geometry, points: [...points, clampPoint({ x: (last.x + other.x) / 2, y: (last.y + other.y) / 2 }, scene.bounds)] } }); setPointLimit(points.length + 1);
          }}>Add corner</button> : null}
        </details>
      </details>
      <div className="campus-scene-review-item"><span>{!connectorReady ? "Choose the mapped building and connection floors before review." : element.review_state === "reviewed" ? "Reviewed" : "Check its position, appearance and place link."}</span><button type="button" className="campus-scene-button" disabled={!element.label.trim() || !connectorReady || element.review_state === "reviewed"} onClick={() => onChange({ ...element, review_state: "reviewed" })}><Check size={16} />Mark reviewed</button></div>
      <div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button" disabled={scene.elements.length >= 2000} onClick={onDuplicate}><Copy size={16} />Duplicate</button><button type="button" className="campus-scene-button campus-scene-button--danger" onClick={onDelete}><Trash2 size={16} />Remove</button></div>
    </fieldset>
    <details className="campus-scene-disclosure"><InfoSummary>About campus place links</InfoSummary><p className="campus-scene-helper">A linked building or room opens its existing campus place. This view does not change room capacity, schedules, access or presence information.</p></details>
  </section>;
}
