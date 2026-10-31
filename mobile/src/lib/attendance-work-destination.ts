import type { WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import { academicAttendanceHref, academicAttendanceSource } from './academic-attendance';

/**
 * Older academic Work contributions used the coordination URL even when their
 * recipient's current Attendance entry is Registers. Resolve only an exact,
 * still-current Work contribution into that existing authorized source entry.
 * Direct/deleted/foreign links and actual coordination work remain unchanged.
 */
export function attendanceWorkDestination(manifest: WorkspaceManifest, href: string): string {
  if (href.split('?')[0] !== '/areas/attendance/coordination'
    || !manifest.work.items.some(item => item.href === href)) return href;
  const surfaces = manifest.areas.find(area => area.key === 'attendance')?.surfaces ?? [];
  if (surfaces.some(surface => surface.key === 'coordination')
    || !surfaces.some(surface => surface.key === 'registers' && surface.href.split('?')[0] === '/areas/attendance/registers')) return href;
  try {
    const source = academicAttendanceSource(href);
    if (!source) return href;
    const params = new URLSearchParams(href.split('?')[1] ?? '');
    if ([...params.keys()].some(key => !['class_section_id', 'session_id', 'date', 'student_id'].includes(key))) return href;
    return academicAttendanceHref(source);
  } catch { return href; }
}
