import type { CampusMapAsset } from '../../../packages/contracts/src/campus-operation';
import { campusAssetUnavailable } from '../../../packages/contracts/src/campus-operation-presentation';
import type { CampusSceneDocument } from '../../../packages/contracts/src/campus-scenes/types';

export interface NativeCampusAssetRenderState {
  elementId: string;
  holdingId: string;
  availability: CampusMapAsset['native_state'];
  reportState: CampusMapAsset['signal']['state'];
  impact: CampusMapAsset['signal']['impact'];
  openReports: number | null;
  suppressNightGlow: boolean;
}

/** The caller first checks the exact publication, campus and selected world.
 * Only reviewed, explicitly holding-linked fixtures enter this minimal renderer
 * projection. Names, positions and repair prose never establish an identity.
 * Missing or ambiguous status remains unknown, without inventing a healthy item.
 * No private repair ID, participant, photo, description or action path is copied. */
export function nativeCampusAssetRenderStates(scene: CampusSceneDocument | null, assets: readonly CampusMapAsset[]): NativeCampusAssetRenderState[] {
  if (!scene) return [];
  const fixtures = scene.elements.filter(element => element.kind === 'fixture' && element.review_state === 'reviewed' && element.holding_id);
  const byElement = new Map<string, CampusMapAsset[]>(), holdingCounts = new Map<string, number>(), elementCounts = new Map<string, number>(), assetHoldingCounts = new Map<string, number>();
  for (const fixture of fixtures) {
    holdingCounts.set(fixture.holding_id!, (holdingCounts.get(fixture.holding_id!) ?? 0) + 1);
    elementCounts.set(fixture.id, (elementCounts.get(fixture.id) ?? 0) + 1);
  }
  for (const asset of assets) {
    assetHoldingCounts.set(asset.holding_id, (assetHoldingCounts.get(asset.holding_id) ?? 0) + 1);
    const rows = byElement.get(asset.element_id);
    if (rows) rows.push(asset); else byElement.set(asset.element_id, [asset]);
  }
  const emitted = new Set<string>();
  const states: NativeCampusAssetRenderState[] = [];
  for (const fixture of fixtures) {
    if (emitted.has(fixture.id)) continue;
    emitted.add(fixture.id);
    const candidates = byElement.get(fixture.id), candidate = candidates?.length === 1 ? candidates[0] : undefined;
    const asset = candidate && candidate.holding_id === fixture.holding_id && holdingCounts.get(fixture.holding_id!) === 1
      && elementCounts.get(fixture.id) === 1 && assetHoldingCounts.get(fixture.holding_id!) === 1
      && ['available','unavailable','retired','unknown'].includes(candidate.native_state)
      && candidate.signal && ['unknown','reported_fault','awaiting_verification','verified_resolution'].includes(candidate.signal.state)
      && [null,'not_working','degraded'].includes(candidate.signal.impact)
      && Number.isSafeInteger(candidate.signal.open_reports) && candidate.signal.open_reports >= 0 ? candidate : undefined;
    states.push({ elementId: fixture.id, holdingId: fixture.holding_id!, availability: asset?.native_state ?? 'unknown',
      reportState: asset?.signal.state ?? 'unknown', impact: asset?.signal.impact ?? null,
      openReports: asset?.signal.open_reports ?? null, suppressNightGlow: asset ? campusAssetUnavailable(asset) : false });
  }
  return states;
}
