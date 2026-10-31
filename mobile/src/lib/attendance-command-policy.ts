import type { AttendanceCommand } from './attendance-draft';

export type RetainedAttendanceCommand = AttendanceCommand & { phase?: 'prepared' | 'unknown' | 'accepted' };
export function attendanceCommandRefused(error: unknown, previouslyUncertain: boolean): boolean {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
  return !previouslyUncertain && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}
export function attendanceResultMatches(value: unknown, registerId: string, revision: number, acceptedRefresh = false): boolean {
  if (!value || typeof value !== 'object' || !('register' in value) || !value.register || typeof value.register !== 'object') return false;
  const source = value.register as { id?: unknown; revision?: unknown };
  return source.id === registerId && typeof source.revision === 'number' && Number.isSafeInteger(source.revision)
    && (acceptedRefresh ? source.revision > revision : source.revision === revision + 1);
}

export interface AttendanceTransportGuard { assertCurrent(): void }
/** Capture before asynchronous command identity work; never adopt a later session. */
export async function prepareGuardedAttendanceCommand(
  capture: () => AttendanceTransportGuard,
  create: () => Promise<AttendanceCommand>,
  assertVisible: () => void,
): Promise<{ command: RetainedAttendanceCommand; context: AttendanceTransportGuard }> {
  const context = capture(); context.assertCurrent(); assertVisible();
  const command = await create();
  context.assertCurrent(); assertVisible();
  return { command: { ...command, phase: 'prepared' }, context };
}
