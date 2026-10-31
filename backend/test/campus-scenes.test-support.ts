import type { DatabaseService } from "../src/database/database.service.js";
import { CampusScenesModel } from "../src/campus-scenes/campus-scenes.model.js";
import { CampusScenesService } from "../src/campus-scenes/campus-scenes.service.js";
import type { SceneDocument } from "../src/campus-scenes/campus-scenes.contracts.js";
import {
  createResourceLoanFixture,
  resourceLoanServices,
} from "./resource-loans.test-support.js";

export const campusScenePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rWQAAAAASUVORK5CYII=";
export function campusSceneDocument(
  spaceId: string | null = null,
): SceneDocument {
  return {
    schema_version: 1,
    name: "Fictional campus",
    bounds: { width: 800, height: 600, unit: "relative" },
    source: {
      kind: "manual",
      label: "Fictional source",
      notes: "PRIVATE acquisition notes",
      reference_url: "https://private.example/campus",
    },
    elements: [
      {
        id: "building-one",
        label: "Library",
        kind: "building",
        geometry: {
          type: "polygon",
          points: [
            { x: 40, y: 40 },
            { x: 200, y: 40 },
            { x: 200, y: 160 },
            { x: 40, y: 160 },
          ],
        },
        space_id: spaceId,
        floor_id: null,
        levels: 2,
        material: "brick",
        asset_key: "library",
        review_state: "reviewed",
      },
      {
        id: "path-one",
        label: "Main walk",
        kind: "path",
        geometry: {
          type: "polyline",
          points: [
            { x: 200, y: 170 },
            { x: 500, y: 170 },
          ],
        },
        space_id: null,
        floor_id: null,
        width: 8,
        review_state: "reviewed",
      },
    ],
  };
}
export function campusSceneServices(db: DatabaseService) {
  const base = resourceLoanServices(db);
  return {
    ...base,
    scenes: new CampusScenesService(
      db,
      new CampusScenesModel(base.core, base.core, base.core),
      base.core,
      base.topology,
    ),
  };
}
export async function createCampusSceneFixture(db: DatabaseService) {
  return {
    ...(await createResourceLoanFixture(db)),
    ...campusSceneServices(db),
  };
}
