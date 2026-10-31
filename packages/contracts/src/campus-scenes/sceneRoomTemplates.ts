import type { CampusSceneAsset, CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";

export const ROOM_FURNISHING_TEMPLATES = [
  { key: "office", label: "Office", description: "Desk, computer, visitor seating and storage" },
  { key: "classroom", label: "Teaching room", description: "Teaching wall and rows of desks and chairs" },
  { key: "laboratory", label: "Computer laboratory", description: "Workstations, chairs and a teaching wall" },
  { key: "meeting", label: "Meeting room", description: "Shared table, seating and a display wall" },
] as const;
export type RoomFurnishingTemplate = typeof ROOM_FURNISHING_TEMPLATES[number]["key"];

type Item = { asset: CampusSceneAsset; label: string; x: number; y: number; width: number; depth: number; rotation?: number };
const inside = (point: CampusScenePoint, polygon: readonly CampusScenePoint[]) => {
  let contained = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contained = !contained;
  }
  return contained;
};
const crosses = (a: CampusScenePoint, b: CampusScenePoint, c: CampusScenePoint, d: CampusScenePoint) => {
  const side = (p: CampusScenePoint, q: CampusScenePoint, r: CampusScenePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

/** Editable visual furniture only. Exact resource registration/linking stays an explicit native action. */
export function furnishSceneRoom(document: CampusSceneDocument, room: CampusSceneElement, template: RoomFurnishingTemplate, makeId: () => string = () => crypto.randomUUID()): { elements: CampusSceneElement[]; omitted: number } {
  if (room.kind !== "room" || room.geometry.type !== "polygon" || room.geometry.points.length < 3 || !room.floor_id) return { elements: [], omitted: 0 };
  const points = room.geometry.points;
  const minX = Math.min(...points.map(point => point.x)), minY = Math.min(...points.map(point => point.y));
  const width = Math.max(...points.map(point => point.x)) - minX, depth = Math.max(...points.map(point => point.y)) - minY;
  const relative = document.bounds.unit === "relative";
  if (width <= 0 || depth <= 0 || !relative && (width < 2.4 || depth < 2.4)) return { elements: [], omitted: 0 };
  // Relative plans have no surveyed scale: size this illustration from its room,
  // never the campus's drawing extent. Metre plans retain physical asset sizes.
  const unit = relative ? Math.min(width / (template === "office" || template === "meeting" ? 6 : 9), depth / 6) : 1;
  const items: Item[] = [];
  const put = (asset: CampusSceneAsset, label: string, x: number, y: number, w: number, d: number, rotation = 0) => items.push({ asset, label, x, y, width: relative ? Math.min(w * unit, width * .32) : w, depth: relative ? Math.min(d * unit, depth * .24) : d, rotation });
  const offsetX = (metres: number) => metres * unit / width;
  const offsetY = (metres: number) => metres * unit / depth;
  if (template === "office") {
    put("desk", "Work desk", .5, .45, 1.5, .8); put("computer", "Desktop computer", .5, .45, .6, .35);
    put("chair", "Desk chair", .5, .45 - offsetY(.85), .5, .5); put("chair", "Visitor chair", .5 - offsetX(.55), .45 + offsetY(1), .5, .5, 180); put("chair", "Visitor chair", .5 + offsetX(.55), .45 + offsetY(1), .5, .5, 180);
    put("cabinet", "Storage cabinet", .82, .24, 1.2, .45);
  } else if (template === "meeting") {
    put("meeting_table", "Meeting table", .5, .52, 3.5, 1.4);
    for (const dx of [-1, 0, 1]) { put("chair", "Meeting chair", .5 + offsetX(dx), .52 - offsetY(1.1), .5, .5); put("chair", "Meeting chair", .5 + offsetX(dx), .52 + offsetY(1.1), .5, .5, 180); }
    put("whiteboard", "Meeting whiteboard", .5, .08, 2.2, .12);
  } else {
    const columns = relative ? width / depth < .5 ? 2 : 4 : Math.max(1, Math.min(4, Math.floor(width / 2.1)));
    const rows = relative ? depth / width < .4 ? 2 : 3 : Math.max(1, Math.min(3, Math.floor(depth / 2.4)));
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const x = relative ? (col + 1) / (columns + 1) : .5 + offsetX((col - (columns - 1) / 2) * 2);
      const y = relative ? .24 + row * .5 / Math.max(1, rows - 1) : .5 + offsetY((row - (rows - 1) / 2) * 2.1);
      put("desk", template === "laboratory" ? "Computer workstation" : "Learning desk", x, y, 1.35, .7);
      put("chair", "Room chair", x, y + offsetY(.85), .5, .5);
      if (template === "laboratory") put("computer", "Workstation computer", x, y, .55, .32);
    }
    put("whiteboard", "Teaching whiteboard", .5, .08, 2.4, .12);
  }
  let omitted = 0;
  const elements = items.flatMap(item => {
    const center = { x: minX + width * item.x, y: minY + depth * item.y };
    const footprint = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: center.x + x! * item.width / 2, y: center.y + y! * item.depth / 2 }));
    const crossesWall = footprint.some((corner, index) => points.some((wall, wallIndex) => crosses(corner, footprint[(index + 1) % 4]!, wall, points[(wallIndex + 1) % points.length]!)));
    if (!footprint.every(point => inside(point, points)) || crossesWall || !inside(center, points)) { omitted++; return []; }
    return [{ id: makeId(), kind: "fixture" as const, label: item.label, asset_key: item.asset, geometry: { type: "point" as const, points: [center] }, width: item.width, depth: item.depth, rotation_deg: item.rotation, space_id: null, floor_id: room.floor_id, parent_element_id: room.id, review_state: "needs_review" as const }];
  });
  return { elements, omitted };
}
