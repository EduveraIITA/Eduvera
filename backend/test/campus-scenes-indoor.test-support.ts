import type { DatabaseService } from "../src/database/database.service.js";
import type { SceneDocument, SceneElement } from "../src/campus-scenes/campus-scenes.contracts.js";
import { createCampusSceneFixture } from "./campus-scenes.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
export async function createIndoorSceneFixture(db: DatabaseService) {
  const f = await createCampusSceneFixture(db);
  return f.run(async () => {
    const create = async (name: string, kind: string, parent_space_id: string | null = null) => String((await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name, code: name.replaceAll(" ", "-").toUpperCase(), kind, parent_space_id }, resourceLoanRequest(f.user))).id);
    const buildingId = await create("Learning block", "building"), groundId = await create("Ground floor", "floor", buildingId), firstId = await create("First floor", "floor", buildingId), roomId = await create("Room 201", "classroom", firstId), gateId = await create("Main gate", "gate");
    const point = (x: number, y: number) => ({ x, y });
    const walk = (id: string, points: { x: number; y: number }[], floor_id: string | null, start: string | null, end: string | null): SceneElement => ({ id, kind: "path", label: id, space_id: null, floor_id, parent_element_id: floor_id ? "building" : null, review_state: "reviewed", geometry: { type: "polyline", points }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: start, end_space_id: end } });
    const connector = (kind: "entrance" | "stairs" | "lift", x: number, y: number, from: string | null): SceneElement => ({ id: kind, kind: "fixture", label: `East ${kind}`, asset_key: "equipment", parent_element_id: "building", floor_id: from, space_id: null, review_state: "reviewed", geometry: { type: "point", points: [point(x, y)] }, navigation_connector: { kind, status: "open", accessible: kind !== "stairs", from_floor_id: from, to_floor_id: from ? firstId : groundId } });
    const document: SceneDocument = { schema_version: 1, name: "Reviewed indoor campus", bounds: { width: 800, height: 600, unit: "relative" }, source: { kind: "manual", label: "Explicit fictional plan" }, elements: [
      { id: "building", kind: "building", label: "Learning block", space_id: buildingId, floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [point(40, 40), point(200, 40), point(200, 160), point(40, 160)] } },
      { id: "room", kind: "room", label: "Room 201", space_id: roomId, floor_id: firstId, parent_element_id: "building", review_state: "reviewed", geometry: { type: "polygon", points: [point(50, 50), point(90, 50), point(90, 80), point(50, 80)] } },
      walk("outside", [point(300, 170), point(120, 160)], null, gateId, buildingId),
      walk("ground-corridor", [point(120, 160), point(70, 120), point(150, 120)], groundId, null, null),
      walk("first-corridor", [point(150, 120), point(70, 120), point(70, 80)], firstId, null, roomId),
      connector("entrance", 120, 160, null), connector("stairs", 70, 120, groundId), connector("lift", 150, 120, groundId),
    ] };
    return { ...f, document, buildingId, groundId, firstId, roomId, gateId };
  });
}
