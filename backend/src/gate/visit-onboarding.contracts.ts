import { z } from 'zod';
export const onboardingToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const onboardingLinkCommand = z.object({ command_id: z.uuid(), expected_revision: z.number().int().nonnegative(),
  expected_visit_revision: z.number().int().positive(), action: z.enum(['issue', 'revoke']),
  ends_at: z.string().datetime({ offset: true }).optional() }).strict().superRefine((input, ctx) => {
  if (input.action === 'issue' && !input.ends_at || input.action === 'revoke' && input.ends_at !== undefined)
    ctx.addIssue({ code: 'custom', message: 'Issue requires an explicit expiry; revocation does not change it.' });
});
export const onboardingPreviewInput = z.object({ token: onboardingToken }).strict();
export const onboardingProofInput = onboardingPreviewInput.extend({ email: z.email().trim().toLowerCase().max(254) }).strict();
export const onboardingAccountInput = onboardingProofInput.extend({ challenge_id: z.uuid(), code: z.string().regex(/^\d{6}$/),
  first_name: z.string().trim().min(1).max(150), last_name: z.string().trim().max(150).default(''), password: z.string().min(1).max(128) }).strict();
export const onboardingJoinInput = onboardingPreviewInput.extend({ command_id: z.uuid() }).strict();
export const participantVisitHref = (visit: string) => `/areas/in-out/visits?visit=${encodeURIComponent(visit)}&participant=1`;
