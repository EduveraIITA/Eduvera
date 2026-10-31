import type { Campaign, Rating, Summary, Workspace } from '../../../packages/contracts/src/wire/features/teacher-feedback/api';
import type { WorkspaceMoreItem } from '../../../packages/contracts/src/workspace';
export const feedbackRatings: readonly Rating[] = ['low', 'okay', 'high', 'na'];
export const feedbackRatingLabels: Record<Rating, string> = { low: 'Low', okay: 'Okay', high: 'High', na: 'Not sure' };
export function nativeFeedbackAccess(item: WorkspaceMoreItem) { return { coordinate: item.capabilities?.includes('teacher_feedback.coordinate') === true, respond: item.capabilities?.includes('teacher_feedback.respond') === true, scopes: item.scopes?.filter(scope => scope.kind === 'self' || scope.kind === 'dependent') ?? [] }; }
export function nativeFeedbackRatingsValid(campaign: Campaign, ratings: unknown): ratings is Record<string, Rating> {
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings) || campaign.is_closed || campaign.submitted) return false;
  const values = ratings as Record<string, unknown>;
  return campaign.parameters.length > 0 && Object.keys(values).length === campaign.parameters.length && campaign.parameters.every(parameter => Object.hasOwn(values, parameter) && feedbackRatings.includes(values[parameter] as Rating));
}
export function validateNativeFeedbackCreation(body: Record<string, unknown>, workspace: Workspace, now: number) {
  if (typeof body.title !== 'string' || body.title.trim().length < 3 || body.title.trim().length > 120 || !workspace.teachers.some(teacher => teacher.id === body.teacher_user_id) || !workspace.classes.some(group => group.id === body.class_section_id) || !['students', 'parents'].includes(String(body.audience))) throw new Error('Choose a title, a current teacher, class and audience.');
  const params = body.parameters;
  if (!Array.isArray(params) || params.length < 1 || params.length > 10 || params.some(value => typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 80) || new Set(params.map(value => value.trim().toLocaleLowerCase())).size !== params.length) throw new Error('Choose 1–10 distinct parameters, each 3–80 characters.');
  const deadline = typeof body.closes_at === 'string' ? Date.parse(body.closes_at) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(deadline) || deadline <= now || deadline > now + 90 * 86_400_000) throw new Error('Choose a future deadline within 90 days of the selected campus clock.');
}
/** A parameter never escapes suppression merely because the campaign is released. */
export function nativeFeedbackResultsReleased(summary: Summary) {
  const minimum = summary.minimum_responses ?? 5;
  return summary.available && (summary.campaign.is_closed || summary.demo_preview === true) && Number.isSafeInteger(minimum) && minimum >= 1 && (minimum >= 5 || summary.demo_preview === true) && summary.response_count >= minimum;
}
export function nativeFeedbackReleasedParameters(summary: Summary) {
  if (!nativeFeedbackResultsReleased(summary)) return [];
  const minimum = summary.minimum_responses ?? 5;
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum < 5 && !summary.demo_preview) return [];
  return summary.parameters.map(parameter => {
    const counts = parameter.counts;
    const valid = counts && feedbackRatings.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0) && counts.low + counts.okay + counts.high === parameter.rated && parameter.rated >= minimum;
    return valid ? parameter : { ...parameter, counts: null, signal: 'insufficient' };
  });
}
export function nativeFeedbackNextStep(parameter: string) {
  const prompts: Record<string, string> = {
    Punctuality: 'Check timetable and transition pressures together; agree one practical change before the next check-in.',
    'Teaching clarity': 'Try a worked example and a short understanding check at the end of a lesson.',
    'Doubt resolution': 'Agree a regular time for questions and check whether learners feel able to ask.',
    'Class engagement': 'Try a short pair activity or a choice of tasks, then ask the class what helped.',
    'Respect and fairness': 'Arrange a confidential, supportive conversation about consistent classroom expectations.',
    'Pace of teaching': 'Check where learners need more time and try a short recap before new material.',
    'Feedback on work': 'Agree a clear turnaround time and one specific next step with each piece of feedback.',
    'Parent communication': 'Agree a predictable update schedule and a clear route for parent questions.',
  };
  return prompts[parameter] ?? 'Discuss examples privately with the teacher and agree one small change to revisit in the next round.';
}
export function nativeFeedbackSortedParameters(parameters: Summary['parameters'], order: string) {
  return parameters.map((parameter, index) => ({ parameter, index })).sort((a, b) => {
    if (order === 'question') return a.index - b.index;
    if (!a.parameter.counts || !b.parameter.counts) return Number(!a.parameter.counts) - Number(!b.parameter.counts) || a.index - b.index;
    const key = order === 'high' ? 'high' : 'low';
    return b.parameter.counts[key] / b.parameter.rated - a.parameter.counts[key] / a.parameter.rated || a.index - b.index;
  }).map(item => item.parameter);
}
