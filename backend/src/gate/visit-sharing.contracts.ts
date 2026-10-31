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
export const sharedVisitHref = (id: string) => `/areas/in-out/visits?visit=${encodeURIComponent(id)}&shared=1`;
export interface VisitQuestionWorkRecord {
  id: string; visit_id: string; share_root_id: string; revision: number; title: string;
  state: 'review_needed' | 'needs_reassignment' | 'waiting_for_review'; href: string; created_at: string;
  message_id: string | null; owner: { user_id: string | null; label: string }; action: 'reply' | 'recover';
}
export interface VisitQuestionCoordination {
  event_id: string; source_revision: number; event_type: string; message_id: string;
  recipient_user_id: string; correlation_id: string; behaviour_version_id: string; subscription_id: string; selector_key: string;
}
