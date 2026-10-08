import type { Summary } from './api';
export const ratingNames = { high: 'High', okay: 'Okay', low: 'Low', na: 'Not sure' };
export const signalNames: Record<string, string> = { insufficient: 'More ratings needed', review: 'Discuss together', strength: 'Strength', mixed: 'Mixed feedback' };
export const percent = (value: number, total: number) => total ? Math.round(value / total * 100) : 0;
export function feedbackOverview(parameters: Summary['parameters']) {
  const visible = parameters.filter(p => p.counts !== null);
  const counts = visible.reduce((sum, p) => {
    for (const key of ['low', 'okay', 'high', 'na'] as const) sum[key] += p.counts![key];
    return sum;
  }, { low: 0, okay: 0, high: 0, na: 0 });
  return { counts, rated: counts.low + counts.okay + counts.high, visible: visible.length,
    strengths: visible.filter(p => p.signal === 'strength'),
    priorities: visible.filter(p => p.signal === 'review').sort((a, b) => b.counts!.low / b.rated - a.counts!.low / a.rated) };
}
export function nextStep(parameter: string) {
  const suggestions: Record<string, string> = {
    'Punctuality': 'Check timetable and transition pressures together; agree one practical change before the next check-in.',
    'Teaching clarity': 'Try a worked example and a short understanding check at the end of a lesson.',
    'Doubt resolution': 'Agree a regular time for questions and check whether students feel able to ask.',
    'Class engagement': 'Try a short pair activity or a choice of tasks, then ask the class what helped.',
    'Respect and fairness': 'Arrange a confidential, supportive conversation about consistent classroom expectations.',
    'Pace of teaching': 'Check where learners need more time and try a short recap before new material.',
    'Feedback on work': 'Agree a clear turnaround time and one specific next step with each piece of feedback.',
    'Parent communication': 'Agree a predictable update schedule and a clear route for parent questions.',
  };
  return suggestions[parameter] ?? 'Discuss examples privately with the teacher and agree one small change to revisit in the next feedback round.';
}
