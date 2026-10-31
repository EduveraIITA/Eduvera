import type { ApiDiaryItem } from '../../../packages/contracts/src/wire/features/school/api';
import type { NativePendingAction, NativePendingInput } from './native-pending-action';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function learningDiaryCommand(item: ApiDiaryItem, studentId: string, kind: 'complete' | 'acknowledge' | 'note', note: string, noteId: string): NativePendingInput {
  if (!item.id || !studentId) throw new Error('The exact diary item and learner are required.');
  if (kind === 'complete') {
    if (item.item_type !== 'homework' || typeof item.completed !== 'boolean') throw new Error('Refresh this homework completion status before changing it.');
    return { endpoint: `/api/v1/homework/${encodeURIComponent(item.id)}/complete/${item.completed ? `?student_id=${encodeURIComponent(studentId)}` : ''}`, method: item.completed ? 'DELETE' : 'POST', body: item.completed ? { command: {} } : { student_id: studentId }, serverKey: 'command', source: { kind: 'homework', sourceId: item.id, revision: 0 } };
  }
  if (kind === 'acknowledge') {
    if (!item.requires_acknowledgement || item.acknowledged) throw new Error('No acknowledgement is pending for this diary item.');
    return { endpoint: `/api/v1/diary/${encodeURIComponent(item.id)}/acknowledge/`, body: { student_id: studentId }, serverKey: null, replayPolicy: 'inspect_only', source: { kind: 'diary_acknowledgement', sourceId: item.id, revision: 0 } };
  }
  const body = note.trim();
  if (body.length < 2 || body.length > 2000 || !noteId) throw new Error('Write a private note from 2 to 2000 characters.');
  // The legacy non-homework handler ignores command identities. Its uncertain
  // result must never be replayed as though it had the practice receipt contract.
  const homework = item.item_type === 'homework';
  return { endpoint: `/api/v1/diary/${encodeURIComponent(item.id)}/notes/`, body: { student_id: studentId, body, ...(homework ? { command: { note_id: noteId } } : {}) }, serverKey: homework ? 'command' : null, replayPolicy: homework ? 'same_request' : 'inspect_only', source: { kind: homework ? 'homework_note' : 'diary_note', sourceId: item.id, revision: 0 } };
}

export function learningDiaryRefreshPath(value: unknown, action: NativePendingAction): string {
  const receipt = object(value), source = action.source;
  const body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  if (!receipt || !source || !body) throw new Error('The saved diary result could not be matched to its retained action.');
  const endpoint = new URL(action.endpoint, 'https://thatcampus.invalid'), refresh = new URL(action.refreshPath, 'https://thatcampus.invalid');
  const studentId = action.method === 'DELETE' ? endpoint.searchParams.get('student_id') : body.student_id;
  if (refresh.pathname !== `/api/v1/diary/${encodeURIComponent(source.sourceId)}/` || refresh.searchParams.get('student_id') !== studentId) throw new Error('The saved diary read did not match the original learner and item.');
  if (source.kind === 'homework') {
    if (endpoint.pathname !== `/api/v1/homework/${encodeURIComponent(source.sourceId)}/complete/` || receipt.item_id !== source.sourceId || receipt.student_id !== studentId || receipt.completed !== (action.method === 'POST')) throw new Error('The homework receipt did not match the exact learner, item and requested completion state.');
  } else if (source.kind === 'homework_note') {
    if (endpoint.pathname !== `/api/v1/diary/${encodeURIComponent(source.sourceId)}/notes/` || receipt.id !== object(body.command)?.note_id) throw new Error('The practice note receipt did not match the original private note.');
  } else if (source.kind === 'diary_note') {
    if (action.replayPolicy !== 'inspect_only' || endpoint.pathname !== `/api/v1/diary/${encodeURIComponent(source.sourceId)}/notes/` || typeof receipt.id !== 'string' || receipt.body !== body.body || typeof receipt.created_at !== 'string') throw new Error('The private diary note result could not be confirmed.');
  } else if (source.kind === 'diary_acknowledgement') {
    if (action.replayPolicy !== 'inspect_only' || endpoint.pathname !== `/api/v1/diary/${encodeURIComponent(source.sourceId)}/acknowledge/` || typeof receipt.id !== 'string' || typeof receipt.acknowledged_at !== 'string') throw new Error('The diary acknowledgement result could not be confirmed.');
  } else throw new Error('This diary action needs its owning result verifier.');
  return action.refreshPath;
}
