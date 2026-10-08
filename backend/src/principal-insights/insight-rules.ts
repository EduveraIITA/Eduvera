export interface AttendanceStudent {
  id: string; name: string; class_id: string; class_name: string;
  expected: number; recorded: number; scored: number; points: number;
  previous_expected: number; previous_recorded: number; previous_scored: number; previous_points: number;
  missing_homework: number; open_followups: number;
}

export const percentage = (points: number, denominator: number): number | null =>
  denominator > 0 ? Math.round(points * 1000 / denominator) / 10 : null;

export function engagementSignals(students: AttendanceStudent[]) {
  return students.flatMap((student) => {
    const current = percentage(student.points, student.scored);
    const previous = percentage(student.previous_points, student.previous_scored);
    // Incomplete registers can create apparent changes. Require both windows to
    // be sufficiently observed, and preserve missing/excused states separately.
    if (current === null || previous === null || student.scored < 5 || student.previous_scored < 5
      || !student.expected || !student.previous_expected
      || student.recorded / student.expected < 0.8 || student.previous_recorded / student.previous_expected < 0.8
      || previous - current < 10) return [];
    return [{ ...student, current, previous, change: Math.round((current - previous) * 10) / 10,
      combined: student.missing_homework >= 2 }];
  }).sort((a, b) => Number(b.combined) - Number(a.combined) || a.change - b.change || a.name.localeCompare(b.name));
}

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
