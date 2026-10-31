import { z } from 'zod';

export const visitCommand = z.object({
  command_id: z.uuid(),
  expected_revision: z.number().int().min(0),
});

const timestamp = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const visitArrangementInput = visitCommand.extend({
  person_id: z.uuid().nullable().default(null),
  person_revision: z.number().int().positive().nullable().default(null),
  guest_name: z.string().trim().min(1).max(150).nullable().default(null),
  party_size: z.number().int().min(1).max(5000).default(1),
  title: z.string().trim().min(1).max(160),
  starts_at: timestamp,
  ends_at: timestamp,
  place_id: z.uuid().nullable().default(null),
  campus_id: z.uuid().nullable().optional(),
  contact_person_id: z.uuid(),
  contact_revision: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (value.person_id ? value.guest_name !== null || value.person_revision === null : value.guest_name === null || value.person_revision !== null)
    context.addIssue({ code: 'custom', path: ['person_id'], message: 'Choose one existing person or enter a guest name.' });
  if ((value.place_id !== null) === (value.campus_id != null))
    context.addIssue({ code: 'custom', path: ['place_id'], message: 'Choose one physical place or the entire campus.' });
  if (value.ends_at <= value.starts_at)
    context.addIssue({ code: 'custom', path: ['ends_at'], message: 'The visit must end after it starts.' });
});

export const visitMovementInput = visitCommand.extend({
  direction: z.enum(['in', 'out']),
  observed_count: z.number().int().min(1).max(5000),
  occurred_at: timestamp.optional(),
}).strict();

export const visitListInput = z.object({
  view: z.enum(['upcoming', 'past', 'cancelled', 'all']).default('upcoming'),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  search: z.string().trim().max(100).default(''),
}).strict();

export const visitOptionsInput = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  person_id: z.uuid().optional(),
  contact_person_id: z.uuid().optional(),
  place_id: z.uuid().optional(),
  campus_id: z.uuid().optional(),
}).strict();

export type VisitArrangementInput = z.infer<typeof visitArrangementInput>;
export type VisitMovementInput = z.infer<typeof visitMovementInput>;
