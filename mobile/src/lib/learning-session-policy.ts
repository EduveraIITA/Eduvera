import type { TeachingMaterial, TeachingSessionDetail } from '../../../packages/contracts/src/wire/features/teaching-sessions/api';
import type { NativePendingAction } from './native-pending-action';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function learningSessionMaterials(source: TeachingSessionDetail) {
  const visible = source.materials.filter(item => item.shared || source.capabilities.can_read_preparation);
  const replaced = new Set(visible.map(item => item.replaces_material_id).filter(Boolean));
  return { current: visible.filter(item => !replaced.has(item.id)), earlier: visible.filter(item => replaced.has(item.id)) };
}
export function learningResourceEnvelope(source: TeachingSessionDetail, input: { materialId: string; title: string; shared: boolean; replaces?: TeachingMaterial | null }) {
  if (!source.capabilities.can_manage || source.session.state !== 'expected' || !input.materialId || source.materials.some(item => item.id === input.materialId) || !input.title.trim() || input.title.length > 180 || source.materials.length >= 50) throw new Error('Refresh the current session and choose an available resource title.');
  if (input.replaces && !learningSessionMaterials(source).current.some(item => item.id === input.replaces!.id)) throw new Error('Only a current resource from this exact session can receive a new version.');
  return { expected_revision: source.lesson.revision, source_fingerprint: source.session.source_fingerprint, material_id: input.materialId, title: input.title.trim(), shared: input.shared, ...(input.replaces ? { replaces_material_id: input.replaces.id } : {}) };
}
/** Existing lesson, resource and private assignment writers share the retained
 * journal. Confirm each owning receipt before switching to read-only recovery. */
export function learningWorkRefreshPath(value: unknown, action: NativePendingAction): string {
  const receipt = object(value), source = action.source;
  const body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : action.payload.fields;
  if (!receipt || !source || !body) throw new Error('The saved learning result did not match its retained source.');
  const path = new URL(action.endpoint, 'https://thatcampus.invalid');
  const read = new URL(action.refreshPath, 'https://thatcampus.invalid');
  if (source.kind === 'session') {
    const root = `/api/v1/learning/sessions/${encodeURIComponent(source.sourceId)}`;
    if (read.pathname !== root || read.searchParams.get('date') !== path.searchParams.get('date')) throw new Error('The teaching recovery read did not match the original session date.');
    if (![`${root}/lesson`,`${root}/materials`,`${root}/materials/files`].includes(path.pathname) || receipt.id !== source.sourceId || receipt.date !== path.searchParams.get('date') || receipt.revision !== source.revision + 1 || Number(body.expected_revision) !== source.revision || body.source_fingerprint !== source.fingerprint) throw new Error('The teaching receipt did not match the exact date, revision and source.');
    if (path.pathname.endsWith('/lesson') ? receipt.state !== body.state : receipt.material_id !== body.material_id || receipt.shared !== (body.shared === true || body.shared === 'true')) throw new Error('The teaching receipt did not match the exact saved lesson or resource.');
  } else if (source.kind === 'assignment') {
    const match = /^\/api\/v1\/learning\/assignments\/([^/]+)\/(work|people)\/([^/]+)\/(.*)$/.exec(path.pathname);
    if (!match || decodeURIComponent(match[1]!) !== source.sourceId || receipt.id !== source.sourceId || receipt[match[2] === 'people' ? 'person_id' : 'student_id'] !== decodeURIComponent(match[3]!)) throw new Error('The assignment receipt did not match the exact learner and assignment.');
    if (read.pathname !== `/api/v1/learning/assignments/${match[1]}/${match[2]}/${match[3]}/`) throw new Error('The private assignment recovery read did not match the original learner.');
    const tail = match[4]!;
    if (tail === 'review/') {
      if (receipt.attempt_id !== body.attempt_id || receipt.decision !== body.decision || Number(body.expected_revision) !== source.revision) throw new Error('The review receipt did not match the original attempt and decision.');
    } else {
      if (receipt.revision !== source.revision + 1 || Number(body.expected_revision) !== source.revision) throw new Error('The private work receipt did not match the expected draft revision.');
      if (tail === 'files/' && receipt.file_id !== body.file_id) throw new Error('The upload receipt did not match the retained file.');
      if (tail === 'submit/' && (receipt.attempt_id !== body.attempt_id || !Number.isSafeInteger(receipt.attempt_number) || Number(receipt.attempt_number) < 1 || !/^[a-f0-9]{64}$/.test(String(receipt.manifest_hash)))) throw new Error('The submission receipt did not match the exact attempt and manifest.');
      if (tail && tail !== 'files/' && tail !== 'submit/' && !/^files\/[^/]+\/$/.test(tail)) throw new Error('This private assignment action needs its owning receipt verifier.');
    }
  } else throw new Error('This learning action needs its owning receipt verifier.');
  return action.refreshPath;
}
