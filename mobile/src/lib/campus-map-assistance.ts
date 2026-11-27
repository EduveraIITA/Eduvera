import { scenePlaceCode, scenePlaceKinds, type ScenePlaceKind } from '../../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import type { ReviewedScenePlaceRow } from '../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneAsset, CampusSceneDocument } from '../../../packages/contracts/src/campus-scenes/types';

export type CampusMapAssistance = { status: 'ai' | 'map_only' | 'simulation'; messages: unknown[] };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function campusMapAssistance(value: unknown): CampusMapAssistance | null {
  const source = record(value);
  if (!source || (source.status !== 'ai' && source.status !== 'map_only' && source.status !== 'simulation')
    || !Array.isArray(source.messages) || !source.messages.length || source.messages.length > 10) return null;
  return { status: source.status, messages: source.messages };
}

const buildingAsset: Partial<Record<ScenePlaceKind, CampusSceneAsset>> = {
  building: 'generic', library: 'library', laboratory: 'laboratory', office: 'administration',
  auditorium: 'auditorium', hostel: 'residence',
};

export function applyCampusMapHints(document: CampusSceneDocument, hints: unknown) {
  const entries = record(hints);
  const kinds = new Map<string, ScenePlaceKind>();
  if (!entries) return { document, kinds };
  const elements = document.elements.map(element => {
    if (!Object.hasOwn(entries, element.id) || element.space_id || element.floor_id) return element;
    const hint = record(entries[element.id]);
    const label = typeof hint?.label === 'string' ? hint.label.trim() : '';
    const type = hint?.kind;
    const kind = Array.isArray(type) && type.length === 1 ? type[0] : type;
    const options = scenePlaceKinds(element);
    if (!options.length) return element;
    if (label.length < 2 || label.length > 160) return element;
    const placeKind = typeof kind === 'string' && options.includes(kind as ScenePlaceKind) ? kind as ScenePlaceKind : undefined;
    if (placeKind) kinds.set(element.id, placeKind);
    const asset = element.kind === 'building' && placeKind ? buildingAsset[placeKind] ?? element.asset_key
      : element.kind === 'surface' && placeKind === 'sports_area' ? 'sports' : element.asset_key;
    if (label === element.label && asset === element.asset_key) return element;
    return { ...element, label, ...(asset ? { asset_key: asset } : {}), review_state: 'needs_review' as const };
  });
  return { document: { ...document, elements }, kinds };
}

/** Explicit answers become one reviewed-place command. Other shapes remain available in the drawing. */
export function assistedFacilityReview(document: CampusSceneDocument, hints: unknown, existingCodes: readonly string[]) {
  const result = applyCampusMapHints(document, hints);
  const used = new Set(existingCodes.map(code => code.toUpperCase()));
  const rows: ReviewedScenePlaceRow[] = [];
  for (const element of result.document.elements) {
    const kind = result.kinds.get(element.id);
    if (!kind) continue;
    rows.push({
      proposal_id: `facility_${rows.length + 1}`, element_ids: [element.id],
      action: 'create', name: element.label, kind,
      code: scenePlaceCode(element.label, rows.length, used),
    });
  }
  return { document: result.document, rows };
}
