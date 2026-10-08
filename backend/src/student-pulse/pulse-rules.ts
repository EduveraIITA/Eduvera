/** Evidence-based review rules, not a prediction of a student's intentions. */
export interface SubjectTotal {
  student_id: string; student_name: string; class_id: string; class_name: string;
  term_id: string; term_name: string; subject_id: string; subject_name: string;
  held: number; attended: number; excused: number;
}
export const PULSE_RULE = { minimum_subject_sessions: 5, minimum_other_sessions: 10, minimum_missed: 3, gap_percentage_points: 20 } as const;
export function validTotal(row: Pick<SubjectTotal, 'held' | 'attended' | 'excused'>) {
  return [row.held, row.attended, row.excused].every(n => Number.isSafeInteger(n) && n >= 0)
    && row.attended + row.excused <= row.held;
}
export function evaluateSubjects(rows: SubjectTotal[]) {
  const groups = new Map<string, SubjectTotal[]>();
  for (const row of rows) {
    if (!validTotal(row)) continue;
    const key = `${row.student_id}:${row.term_id}:${row.class_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap(subjects => subjects.map(subject => {
    const eligible = subject.held - subject.excused;
    const others = subjects.filter(row => row.subject_id !== subject.subject_id);
    const otherEligible = others.reduce((n, row) => n + row.held - row.excused, 0);
    const otherAttended = others.reduce((n, row) => n + row.attended, 0);
    const percentage = eligible ? subject.attended / eligible * 100 : null;
    const otherPercentage = otherEligible ? otherAttended / otherEligible * 100 : null;
    const gap = percentage !== null && otherPercentage !== null ? otherPercentage - percentage : null;
    const missed = eligible - subject.attended;
    return { ...subject, eligible, missed, percentage, other_percentage: otherPercentage, gap,
      flagged: eligible >= PULSE_RULE.minimum_subject_sessions && otherEligible >= PULSE_RULE.minimum_other_sessions
        && missed >= PULSE_RULE.minimum_missed && gap !== null && gap >= PULSE_RULE.gap_percentage_points,
      subjects: subjects.map(row => ({ subject_id: row.subject_id, name: row.subject_name, held: row.held,
        attended: row.attended, excused: row.excused, eligible: row.held - row.excused,
        percentage: row.held > row.excused ? row.attended / (row.held - row.excused) * 100 : null })),
    };
  }));
}
export type PulseSignal = ReturnType<typeof evaluateSubjects>[number];
