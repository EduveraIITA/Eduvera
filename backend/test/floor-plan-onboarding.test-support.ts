import { randomUUID } from 'node:crypto';
import type { DatabaseService } from '../src/database/database.service.js';
import type { SceneDocument, SceneElement } from '../src/campus-scenes/campus-scenes.contracts.js';
import { CampusSceneImportProvider } from '../src/campus-scene-import/scene-import.provider.js';
import { CampusSceneImportService } from '../src/campus-scene-import/scene-import.service.js';
import { campusOperationsServices } from './campus-operations.test-support.js';
import { createFacilitiesFixture } from './facilities.test-support.js';
import { resourceLoanRequest } from './resource-loans.test-support.js';

/** A new institution and normally accepted neutral member, never an Aaranya ID. */
export async function createFloorPlanFixture(database: DatabaseService) {
  const base = await createFacilitiesFixture(database), services = campusOperationsServices(database);
  const f = { ...base, ...services };
  return f.run(async () => {
    const building = await f.topology.createSpace(f.user, f.schoolId, {
      campus_id: f.campusId, name: 'Learning and research block', code: 'LEARNING', kind: 'building',
    }, resourceLoanRequest(f.user));
    const document: SceneDocument = {
      schema_version: 1, name: 'Willow Research Campus', bounds: { width: 800, height: 600, unit: 'relative' },
      source: { kind: 'manual', label: 'Institution-reviewed campus plan' },
      elements: [{ id: 'learning-block', kind: 'building', label: 'Learning and research block',
        geometry: { type: 'polygon', points: [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 500 }, { x: 100, y: 500 }] },
        space_id: String(building.id), floor_id: null, levels: 2, material: 'concrete', review_state: 'reviewed' }],
    };
    const saved = await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
      idempotency_key: randomUUID(), expected_revision: 0, document,
    });
    const published = await f.scenes.publish(f.user, f.schoolId, f.campusId, {
      idempotency_key: randomUUID(), expected_revision: saved.revision,
    });
    await f.facilities.saveSettings(f.user, f.schoolId, {
      command_id: randomUUID(), expected_revision: 0, handler_person_id: f.custodianPersonId, verifier_mode: 'reporter',
    });
    const provider = new CampusSceneImportProvider();
    const importer = new CampusSceneImportService(database, f.scenes, provider);
    return { ...f, buildingId: String(building.id), buildingRevision: Number(building.revision), document,
      publishedRevision: published.revision, provider, importer };
  });
}
export type FloorPlanFixture = Awaited<ReturnType<typeof createFloorPlanFixture>>;

/** Controlled fictional extraction at the external-provider boundary only. */
export function extractedFloorPlan(imageId: string): SceneDocument {
  const rectangle = (id: string, label: string, x: number, y: number, width: number, depth: number): SceneElement => ({
    id, label, kind: 'room', space_id: null, floor_id: null, review_state: 'needs_review',
    geometry: { type: 'polygon', points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + depth }, { x, y: y + depth }] },
  });
  return {
    schema_version: 1, name: 'Learning block first-floor plan', bounds: { width: 1000, height: 1000, unit: 'relative' },
    source: { kind: 'site_plan', label: 'Institution-supplied floor plan', image_asset_id: imageId,
      notes: 'Fictional test extraction. No surveyed scale, equipment inventory, safety or navigation claims.' },
    elements: [rectangle('plan-reception', 'Research reception', 0, 0, 450, 420),
      rectangle('plan-laboratory', 'Systems laboratory', 550, 0, 450, 420),
      rectangle('plan-meeting', 'Seminar room', 0, 580, 450, 420),
      { id: 'plan-corridor', label: 'Central corridor', kind: 'path', space_id: null, floor_id: null,
        review_state: 'needs_review', width: 32, geometry: { type: 'polyline', points: [{ x: 500, y: 20 }, { x: 500, y: 980 }] } },
      { id: 'plan-door', label: 'Laboratory door', kind: 'fixture', asset_key: 'door', space_id: null, floor_id: null,
        review_state: 'needs_review', width: 25, depth: 10, rotation_deg: 0, geometry: { type: 'point', points: [{ x: 550, y: 210 }] } },
    ],
  };
}

/** An explicit administrator edit: fit the reviewed image within its chosen building. */
export function floorPlanReview(f: FloorPlanFixture, proposal: SceneDocument, expectedRevision: number) {
  const imported = proposal.elements.map(element => ({ ...structuredClone(element), parent_element_id: 'learning-block',
    geometry: { ...element.geometry, points: element.geometry.points.map(point => ({ x: 100 + point.x * 0.6, y: 100 + point.y * 0.4 })) },
    ...(element.width ? { width: element.width * 0.5 } : {}), ...(element.depth ? { depth: element.depth * 0.5 } : {}),
  }));
  return {
    idempotency_key: randomUUID(), expected_revision: expectedRevision,
    document: { ...structuredClone(f.document), elements: [...structuredClone(f.document.elements), ...imported] },
    rows: [
      { proposal_id: 'first-floor', action: 'create', kind: 'floor', name: 'First floor', code: 'LEARNING-F1',
        parent_space_id: f.buildingId, expected_parent_revision: f.buildingRevision,
        element_ids: [], floor_element_ids: imported.map(element => element.id) },
      { proposal_id: 'reception', action: 'create', kind: 'office', name: 'Research reception', code: 'LR-101',
        parent_proposal_id: 'first-floor', element_ids: ['plan-reception'] },
      { proposal_id: 'laboratory', action: 'create', kind: 'laboratory', name: 'Systems laboratory', code: 'LR-102',
        parent_proposal_id: 'first-floor', element_ids: ['plan-laboratory'] },
      { proposal_id: 'meeting', action: 'create', kind: 'classroom', name: 'Seminar room', code: 'LR-103',
        parent_proposal_id: 'first-floor', element_ids: ['plan-meeting'] },
    ],
  };
}

/** Editable illustration is intentionally distinct from one native tagged item. */
export function furnishFloor(document: SceneDocument, floorId: string, roomId: string, holdingId: string): SceneDocument {
  const fixture = (id: string, label: string, asset_key: SceneElement['asset_key'], x: number, y: number,
    width: number, depth: number, holding_id?: string): SceneElement => ({
      id, label, kind: 'fixture', asset_key, space_id: roomId, floor_id: floorId, parent_element_id: 'learning-block',
      review_state: 'needs_review', width, depth, rotation_deg: 0, ...(holding_id ? { holding_id } : {}),
      geometry: { type: 'point', points: [{ x, y }] },
    });
  const next = structuredClone(document);
  next.elements.push(fixture('lab-desk', 'Laboratory workbench', 'desk', 500, 180, 55, 28),
    fixture('lab-chair', 'Laboratory chair', 'chair', 500, 212, 16, 16),
    fixture('lab-computer', 'Workstation illustration', 'computer', 500, 173, 16, 12),
    fixture('lab-lamp', 'Laboratory task light', 'lamp', 570, 180, 14, 14, holdingId));
  return next;
}
