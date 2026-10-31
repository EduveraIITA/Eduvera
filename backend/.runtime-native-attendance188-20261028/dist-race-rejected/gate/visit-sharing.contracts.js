import { z } from 'zod';
export const visitSharingCommand = z.object({ command_id: z.uuid(), expected_revision: z.number().int().nonnegative() }).strict();
export const visitShareInput = visitSharingCommand.extend({
    expected_visit_revision: z.number().int().positive(), organiser_person_id: z.uuid(),
    organiser_person_revision: z.number().int().positive(), ends_at: z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString()),
    directions: z.string().trim().max(1000).default(''),
}).strict();
export const visitQuestionInput = visitSharingCommand.extend({ share_id: z.uuid(), note: z.string().trim().min(1).max(2000) }).strict();
export const visitQuestionReplyInput = visitSharingCommand.extend({ note: z.string().trim().min(1).max(2000) }).strict();
export const sharedVisitListInput = z.object({ page: z.coerce.number().int().min(1).max(2147483647).default(1) }).strict();
export const sharedVisitHref = (id) => `/areas/in-out/visits?visit=${encodeURIComponent(id)}&shared=1`;
//# sourceMappingURL=visit-sharing.contracts.js.map