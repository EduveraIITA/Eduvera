import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from "./types";

export function SceneConnectorFields({ element, scene, spaces, patch }: { element: CampusSceneElement; scene: CampusSceneDocument; spaces: CampusSceneSpace[]; patch: (value: Partial<CampusSceneElement>) => void }) {
  const connector = element.navigation_connector;
  const buildings = scene.elements.filter(item => item.kind === "building" && item.space_id);
  const building = buildings.find(item => item.id === element.parent_element_id);
  const belongs = (space: CampusSceneSpace) => {
    const seen = new Set<string>(); let current: CampusSceneSpace | undefined = space;
    while (current && !seen.has(current.id)) { if (current.id === building?.space_id) return true; seen.add(current.id); current = spaces.find(item => item.id === current?.parent_space_id); }
    return false;
  };
  const floors = spaces.filter(item => item.kind === "floor" && belongs(item));
  return <details className="campus-scene-disclosure"><summary>Entrance, stairs or lift</summary><div className="campus-scene-route-fields">
    <label className="campus-scene-check"><input type="checkbox" checked={Boolean(connector)} onChange={event => patch({ navigation_connector: event.target.checked ? { kind: "entrance", status: "open", accessible: false, from_floor_id: null, to_floor_id: "" } : undefined, ...(event.target.checked ? { floor_id: null } : {}) })} />Use as a floor connection</label>
    {connector ? <>
      <p className="campus-scene-helper">The placed point is the exact landing on both sides. Connect corridor corners to this coordinate. A building, nearby path or matching name does not create a connection.</p>
      <label>Connection type<select value={connector.kind} onChange={event => {
        const kind = event.target.value as typeof connector.kind;
        const from = kind === "entrance" ? null : connector.from_floor_id ?? floors[0]?.id ?? "";
        patch({ floor_id: from, navigation_connector: { ...connector, kind, from_floor_id: from, to_floor_id: connector.to_floor_id !== from ? connector.to_floor_id : "", accessible: kind === "stairs" ? false : connector.accessible } });
      }}><option value="entrance">Building entrance</option><option value="stairs">Stairs</option><option value="lift">Lift</option></select></label>
      <label>Connection building<select value={element.parent_element_id ?? ""} onChange={event => patch({ parent_element_id: event.target.value || null, floor_id: null, navigation_connector: { ...connector, kind: "entrance", from_floor_id: null, to_floor_id: "" } })}><option value="">Choose a mapped building</option>{buildings.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {connector.kind !== "entrance" ? <label>From floor<select value={connector.from_floor_id ?? ""} onChange={event => patch({ floor_id: event.target.value || null, navigation_connector: { ...connector, from_floor_id: event.target.value || null, to_floor_id: event.target.value === connector.to_floor_id ? "" : connector.to_floor_id } })}><option value="">Choose a floor</option>{floors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <p className="campus-scene-helper">Starts outdoors at this exact point.</p>}
      <label>To floor<select value={connector.to_floor_id} onChange={event => patch({ navigation_connector: { ...connector, to_floor_id: event.target.value } })}><option value="">Choose a floor</option>{floors.filter(item => item.id !== connector.from_floor_id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Connection access<select value={connector.status} onChange={event => patch({ navigation_connector: { ...connector, status: event.target.value as "open" | "closed" } })}><option value="open">Open</option><option value="closed">Closed</option></select></label>
      <label className="campus-scene-check"><input type="checkbox" checked={connector.accessible} disabled={connector.kind === "stairs"} onChange={event => patch({ navigation_connector: { ...connector, accessible: event.target.checked } })} />Reviewed step-free connection</label>
      <p className="campus-scene-helper">Review access before publishing. Stairs are never step-free. A lift's published setting does not prove that it is operating now.</p>
    </> : null}
  </div></details>;
}
