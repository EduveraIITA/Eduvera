import type { NativeAttendanceRelationship } from './attendance-access';
import type { AttendanceTransportGuard } from './attendance-command-policy';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface AttendanceAttentionProof { notificationId: string; recordId: string; revision: number; studentId: string; openedTarget: string; cleanHref: string; key: string }
type ReportSource = { student: { id: string }; calendar?: Array<{ id: string; revision: number; date: string }> };
/** Only the exact loaded parent record can acknowledge attendance attention. */
export function attendanceAttentionProof(href: string, selected: NativeAttendanceRelationship, source: ReportSource | undefined): AttendanceAttentionProof | null {
  const hashIndex = href.indexOf('#'), target = hashIndex >= 0 ? href.slice(0, hashIndex) : href, hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const [path, search = ''] = target.split('?');
  if (path !== '/areas/attendance/records' || selected.relationship !== 'dependent' || source?.student.id !== selected.studentId) return null;
  const query = new URLSearchParams(search);
  if (['scope', 'student_id', 'attention_notification_id', 'attendance_record_id', 'attendance_revision', 'date'].some(key => query.getAll(key).length !== 1)) return null;
  const notificationId = query.get('attention_notification_id')!, recordId = query.get('attendance_record_id')!, revisionValue = query.get('attendance_revision')!, date = query.get('date')!;
  if (query.get('scope') !== selected.relationship || query.get('student_id') !== selected.studentId || !uuid.test(notificationId) || !uuid.test(recordId) || !/^[1-9][0-9]*$/.test(revisionValue) || !Number.isSafeInteger(Number(revisionValue)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const revision = Number(revisionValue);
  if (!source.calendar?.some(record => record.id === recordId && record.revision === revision && record.date === date)) return null;
  query.delete('attention_notification_id');
  return { notificationId, recordId, revision, studentId: selected.studentId, openedTarget: target, cleanHref: `${path}${query.size ? `?${query}` : ''}${hash}`, key: JSON.stringify([target, selected.studentId, recordId, revision]) };
}
export async function acknowledgeAttendanceAttention(proof: AttendanceAttentionProof, options: {
  capture(): AttendanceTransportGuard; isCurrent(): boolean;
  send(path: string, body: string): Promise<unknown>; confirmed(cleanHref: string, assertCurrent: () => void): Promise<void> | void;
}): Promise<void> {
  const context = options.capture();
  const assertCurrent = () => { context.assertCurrent(); if (!options.isCurrent()) throw new Error('The exact attendance view is no longer visible in the foreground.'); };
  assertCurrent();
  const receipt = await options.send(`/api/v1/notifications/${proof.notificationId}/read/`, JSON.stringify({ opened_target: proof.openedTarget }));
  assertCurrent();
  const result = receipt as { id?: unknown; read_at?: unknown } | null;
  if (!result || result.id !== proof.notificationId || typeof result.read_at !== 'string' || !Number.isFinite(Date.parse(result.read_at))) throw new Error('The attendance notification was not confirmed as opened.');
  await options.confirmed(proof.cleanHref, assertCurrent); assertCurrent();
}
