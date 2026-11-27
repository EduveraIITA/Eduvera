import { scenePlaceKinds, type ScenePlaceKind } from '../../../packages/contracts/src/campus-scenes/scenePlaceProposals';
import type { CampusSceneDocument } from '../../../packages/contracts/src/campus-scenes/types';

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
    if (typeof kind === 'string' && options.includes(kind as ScenePlaceKind)) kinds.set(element.id, kind as ScenePlaceKind);
    return label.length >= 2 && label.length <= 160 && label !== element.label
      ? { ...element, label, review_state: 'needs_review' as const } : element;
  });
  return { document: { ...document, elements }, kinds };
}
