import { z } from 'zod';
export const DEFAULT_PARAMETERS = ['Punctuality', 'Teaching clarity', 'Doubt resolution', 'Class engagement', 'Respect and fairness', 'Pace of teaching', 'Feedback on work', 'Parent communication'];
export const campaignInput = z.object({
  teacher_user_id: z.uuid(), class_section_id: z.uuid(), title: z.string().trim().min(3).max(120),
  audience: z.enum(['students', 'parents']), closes_at: z.iso.datetime({ offset: true }),
  parameters: z.array(z.string().trim().min(3).max(80)).min(1).max(10)
    .refine(values => new Set(values.map(v => v.toLowerCase())).size === values.length, 'Use distinct parameters'),
});
export const responseInput = z.object({ ratings: z.record(z.string(), z.enum(['low', 'okay', 'high', 'na'])) });
export type Ratings = z.infer<typeof responseInput>['ratings'];
export function validRatingKeys(parameters: string[], ratings: Ratings) {
  return Object.keys(ratings).length === parameters.length && parameters.every(p => Object.hasOwn(ratings, p));
}
export function summarizeRatings(parameters: string[], responses: Ratings[], minimum = 5) {
  return parameters.map(parameter => {
    const counts = { low: 0, okay: 0, high: 0, na: 0 };
    for (const response of responses) { const rating = response[parameter]; if (rating) counts[rating]++; }
    const rated = counts.low + counts.okay + counts.high;
    // A parameter with too few actual ratings is suppressed independently of total responses.
    return { parameter, rated, counts: rated >= minimum ? counts : null,
      signal: rated < minimum ? 'insufficient' : counts.low / rated >= 0.4 ? 'review' : counts.high / rated >= 0.7 ? 'strength' : 'mixed' };
  });
}

export function feedbackReleasePolicy(demoMode: boolean, user: {username: string; email: string}, schoolCode: string) {
  const demoIdentity = (user.username === 'meera.principal' && user.email === 'meera.kapoor@example.test')
    || (user.username === 'arjun.admin' && user.email === 'arjun.rao@example.test');
  const demo = demoMode && schoolCode === 'cis' && demoIdentity;
  return { demo_preview: demo, minimum_responses: demo ? 1 : 5 };
}
