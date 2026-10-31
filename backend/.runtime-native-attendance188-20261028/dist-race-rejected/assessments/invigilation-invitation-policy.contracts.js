import { z } from 'zod';
export const invigilationInvitationApprovalSchema = z.object({
    expected_revision: z.number().int().nonnegative(), enabled: z.boolean(),
    recipient_person_ids: z.array(z.string().uuid()).max(2000),
    response_due_minutes: z.number().int().min(1).max(10080),
    expires_after_minutes: z.number().int().min(1).max(43200),
    approval_note: z.string().trim().min(5).max(1000),
    idempotency_key: z.string().trim().min(8).max(160),
}).strict().superRefine((value, context) => {
    if (new Set(value.recipient_person_ids).size !== value.recipient_person_ids.length)
        context.addIssue({ code: 'custom', path: ['recipient_person_ids'], message: 'Select each person once.' });
    if (value.enabled && !value.recipient_person_ids.length)
        context.addIssue({ code: 'custom', path: ['recipient_person_ids'], message: 'Choose at least one eligible recipient.' });
    if (value.expires_after_minutes < value.response_due_minutes)
        context.addIssue({ code: 'custom', path: ['expires_after_minutes'], message: 'Invitation expiry cannot precede its response deadline.' });
});
//# sourceMappingURL=invigilation-invitation-policy.contracts.js.map