import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { floorPlanDraft } from '../src/campus-scene-import/floor-plan-draft.js';
import { sceneImportSchema } from '../src/campus-scene-import/scene-import.contracts.js';
import { CampusSceneImportProvider } from '../src/campus-scene-import/scene-import.provider.js';
import type * as GoogleGenAi from '@google/genai';
import { CampusSceneImportService } from '../src/campus-scene-import/scene-import.service.js';
import type { CampusScenesService } from '../src/campus-scenes/campus-scenes.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { AuthUser } from '../src/common/request.js';

const model = vi.hoisted(() => ({ countTokens: vi.fn(), generateContent: vi.fn() }));
vi.mock('@google/genai', async importOriginal => ({ ...await importOriginal<typeof GoogleGenAi>(),
  GoogleGenAI: class { models = model; },
}));

const source = { label: 'Learning block · Ground floor', imageId: '10e8534c-477a-4bcc-b65e-83f64700c405', width: 1200, height: 600 };
const room = { kind: 'room', label: 'Seminar room', points: [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 400 }, { x: 100, y: 400 }] };
afterEach(() => vi.unstubAllEnvs());

describe('Untrusted floor-plan proposals', () => {
  it('preserves source aspect ratio and leaves all canonical identities and review decisions to the person', () => {
    const document = floorPlanDraft({ elements: [room, { kind: 'door', label: 'Door 1', points: [{ x: 200, y: 400 }] }] }, source);
    expect(document.bounds).toEqual({ width: 1000, height: 500, unit: 'relative' });
    expect(document.elements[0]).toMatchObject({ kind: 'room', space_id: null, floor_id: null, review_state: 'needs_review', geometry: { points: [{ x: 100, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 200 }, { x: 100, y: 200 }] } });
    expect(document.elements[1]).toMatchObject({ kind: 'fixture', asset_key: 'door', space_id: null, floor_id: null, review_state: 'needs_review' });
    expect(document.source).toMatchObject({ kind: 'site_plan', image_asset_id: source.imageId });
    expect(document.source.notes).toContain('no surveyed scale');
  });

  it('represents stairwells and lift lobbies as reviewable drawing areas without creating routes or equipment', () => {
    const document = floorPlanDraft({ elements: [{ ...room, kind: 'stairwell', label: 'Stairwell' }, { ...room, kind: 'lift_lobby', label: 'Lift lobby' }] }, source);
    for (const element of document.elements) {
      expect(element.kind).toBe('room');
      expect(element).not.toHaveProperty('holding_id');
      expect(element).not.toHaveProperty('navigation_connector');
      expect(element).not.toHaveProperty('navigation');
    }
  });

  it('rejects invented model fields, resource identifiers, unsupported features and excessive output', () => {
    for (const item of [{ ...room, holding_id: source.imageId }, { ...room, floor_id: source.imageId }, { ...room, kind: 'person' }, { ...room, kind: 'computer' }, { ...room, capacity: 40 }]) {
      expect(() => floorPlanDraft({ elements: [item] }, source)).toThrow();
    }
    expect(() => floorPlanDraft({ elements: Array(65).fill(room) }, source)).toThrow();
    expect(() => floorPlanDraft({ elements: [], instructions: 'Ignore the schema' }, source)).toThrow();
  });

  it('rejects invalid polygons, nonfinite/out-of-range points and multi-point openings', () => {
    const invalid = [
      { ...room, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }, { x: 50, y: 0 }] },
      { ...room, points: [{ x: 0, y: 0 }, { x: 1001, y: 0 }, { x: 2, y: 2 }] },
      { ...room, points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 2, y: 2 }] },
      { ...room, kind: 'door' },
    ];
    for (const item of invalid) expect(() => floorPlanDraft({ elements: [item] }, source)).toThrow();
  });

  it('returns an honest empty proposal for unreadable input and never substitutes sample rooms', () => {
    expect(floorPlanDraft({ elements: [] }, source).elements).toEqual([]);
    expect(() => floorPlanDraft({ elements: [] }, { ...source, width: 0 })).toThrow();
    expect(() => floorPlanDraft({ elements: [] }, { ...source, height: Number.POSITIVE_INFINITY })).toThrow();
  });

  it('requires a deliberate site plan, mapped-building identity and paired floor revision without changing ordinary image requests', () => {
    const ordinary = { kind: 'image', idempotency_key: source.imageId, image_asset_id: source.imageId, label: source.label, source_kind: 'site_plan' };
    expect(sceneImportSchema.parse(ordinary)).toEqual({ ...ordinary, instructions: '' });
    const indoor = { ...ordinary, purpose: 'floor_plan', target: { building_id: source.imageId, expected_building_revision: 1 } };
    expect(sceneImportSchema.safeParse(indoor).success).toBe(true);
    expect(sceneImportSchema.safeParse({ ...indoor, target: { ...indoor.target, floor_id: source.imageId, expected_floor_revision: 3 } }).success).toBe(true);
    for (const input of [{ ...indoor, source_kind: 'aerial_image' }, { ...indoor, target: undefined },
      { ...indoor, target: { ...indoor.target, floor_id: source.imageId } },
      { ...indoor, target: { ...indoor.target, expected_floor_revision: 1 } },
      { ...indoor, target: { ...indoor.target, metres_per_pixel: 2 } },
      { ...ordinary, target: indoor.target }]) expect(sceneImportSchema.safeParse(input).success).toBe(false);
  });
});

describe('Floor tracing through the existing bounded Vertex provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AGENT_PROVIDER', 'vertex'); vi.stubEnv('AGENT_ENABLED', 'true');
    vi.stubEnv('AGENT_ENABLED_UNTIL', '2099-01-01T00:00:00Z');
    vi.stubEnv('AGENT_GOOGLE_PROJECT', 'floor-plan-test'); vi.stubEnv('AGENT_GOOGLE_LOCATION', 'global');
    vi.stubEnv('AGENT_MODEL', 'gemini-3.1-flash-lite'); vi.stubEnv('AGENT_API_KEY', ''); vi.stubEnv('AGENT_BASE_URL', '');
    model.countTokens.mockResolvedValue({ totalTokens: 100 });
    model.generateContent.mockResolvedValue({ text: JSON.stringify({ elements: [room] }), candidates: [{ finishReason: 'STOP' }] });
  });
  const input = () => ({ ...source, bytes: Buffer.from('fictional plan only'), mimeType: 'image/png', sourceKind: 'site_plan' as const, instructions: 'One clearly printed floor', purpose: 'floor_plan' as const });

  it('reserves the existing allowance before inference and requests the small indoor schema without tools', async () => {
    const reserve = vi.fn().mockResolvedValue(undefined);
    const document = await new CampusSceneImportProvider().image(input(), reserve);
    expect(reserve).toHaveBeenCalledExactlyOnceWith(100, 6144);
    expect(model.countTokens.mock.invocationCallOrder[0]).toBeLessThan(reserve.mock.invocationCallOrder[0]!);
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(model.generateContent.mock.invocationCallOrder[0]!);
    expect(model.generateContent).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({
      responseMimeType: 'application/json', maxOutputTokens: 6144, candidateCount: 1,
      automaticFunctionCalling: { disable: true }, systemInstruction: expect.stringContaining('floor-plan tracing assistant'),
      responseSchema: expect.objectContaining({ properties: expect.objectContaining({ elements: expect.any(Object) }) }),
    }) }));
    expect(document.elements[0]).toMatchObject({ kind: 'room', space_id: null, floor_id: null, review_state: 'needs_review' });
  });

  it('does not generate when the shared reservation rejects', async () => {
    const reserve = vi.fn().mockRejectedValue(new Error('allowance reached'));
    await expect(new CampusSceneImportProvider().image(input(), reserve)).rejects.toThrow(/could not produce a valid floor plan/);
    expect(model.generateContent).not.toHaveBeenCalled();
  });

  it('fails visibly on incomplete or malformed output without exposing the model payload', async () => {
    model.generateContent.mockResolvedValue({ text: 'PRIVATE model content', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(new CampusSceneImportProvider().image(input(), vi.fn().mockResolvedValue(undefined))).rejects.toThrow(/^Image analysis could not produce a valid floor plan/);
    model.generateContent.mockResolvedValue({ text: JSON.stringify({ elements: [{ ...room, kind: 'computer', holding_id: source.imageId }] }), candidates: [{ finishReason: 'STOP' }] });
    await expect(new CampusSceneImportProvider().image(input(), vi.fn().mockResolvedValue(undefined))).rejects.toThrow(/^Image analysis could not produce a valid floor plan/);
  });

  it('rejects an aerial source or extreme aspect ratio before counting tokens or reserving allowance', async () => {
    const reserve = vi.fn();
    await expect(new CampusSceneImportProvider().image({ ...input(), sourceKind: 'aerial_image' }, reserve)).rejects.toThrow(/floor-plan image/);
    await expect(new CampusSceneImportProvider().image({ ...input(), width: 1, height: 30000 }, reserve)).rejects.toThrow(/too narrow/);
    expect(model.countTokens).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  });
});

describe('Current mapped-building and floor admission', () => {
  const buildingId = '10e8534c-477a-4bcc-b65e-83f64700c405';
  const floorId = '20e8534c-477a-4bcc-b65e-83f64700c405';
  const otherBuildingId = '30e8534c-477a-4bcc-b65e-83f64700c405';
  type Place = { id: string; revision: number; kind: string; parent_space_id: string | null };
  const places = (): Place[] => [{ id: buildingId, revision: 2, kind: 'building', parent_space_id: null },
    { id: floorId, revision: 3, kind: 'floor', parent_space_id: buildingId }];
  const request = () => ({ kind: 'image', purpose: 'floor_plan', idempotency_key: buildingId, image_asset_id: source.imageId,
    label: source.label, source_kind: 'site_plan', target: { building_id: buildingId, expected_building_revision: 2,
      floor_id: floorId, expected_floor_revision: 3 } });

  function fixture(rows = places(), mapped = true) {
    const workspace = vi.fn().mockResolvedValue({ scene: { draft: { elements: mapped ? [{ kind: 'building', space_id: buildingId }] : [] }, published: null } });
    const query = { select: vi.fn(), where: vi.fn(), execute: vi.fn().mockResolvedValue(rows) };
    query.select.mockReturnValue(query); query.where.mockReturnValue(query);
    const db = { selectFrom: vi.fn().mockReturnValue(query), transaction: vi.fn() };
    const provider = new CampusSceneImportProvider();
    const generate = vi.spyOn(provider, 'image');
    const service = new CampusSceneImportService(db as unknown as DatabaseService, { workspace } as unknown as CampusScenesService, provider);
    return { workspace, query, db, generate, service };
  }

  it.each([
    { change: { expected_building_revision: 1 }, message: /building changed/ },
    { change: { expected_floor_revision: 1 }, message: /floor changed/ },
    { change: { floor_id: otherBuildingId }, message: /active floor/ },
  ])('rejects stale or unknown explicit targets before a proposal or paid call %#', async ({ change, message }) => {
    const f = fixture(), input = request(); input.target = { ...input.target, ...change };
    await expect(f.service.import({} as AuthUser, buildingId, buildingId, input)).rejects.toThrow(message);
    expect(f.generate).not.toHaveBeenCalled(); expect(f.db.transaction).not.toHaveBeenCalled();
    expect(f.query.where).toHaveBeenCalledWith('school_id', '=', buildingId);
    expect(f.query.where).toHaveBeenCalledWith('campus_id', '=', buildingId);
    expect(f.query.where).toHaveBeenCalledWith('status', '=', 'active');
  });

  it('does not infer a floor relationship from a matching name, drawing or campus', async () => {
    const rows = places(); rows[1]!.parent_space_id = otherBuildingId;
    rows.push({ id: otherBuildingId, revision: 1, kind: 'building', parent_space_id: null });
    const f = fixture(rows);
    await expect(f.service.import({} as AuthUser, buildingId, buildingId, request())).rejects.toThrow(/floor belonging to the selected building/);
    expect(f.generate).not.toHaveBeenCalled(); expect(f.db.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unlinked building or a revoked administrator before any image or provider access', async () => {
    const f = fixture(places(), false);
    await expect(f.service.import({} as AuthUser, buildingId, buildingId, request())).rejects.toThrow(/building already linked/);
    expect(f.db.selectFrom).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    f.workspace.mockRejectedValue(new Error('An active administrator is required.'));
    await expect(f.service.import({} as AuthUser, buildingId, buildingId, request())).rejects.toThrow(/active administrator/);
    expect(f.generate).not.toHaveBeenCalled();
  });
});
