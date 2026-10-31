import { z } from 'zod';

const uuid = z.string().uuid();
export const activityPurpose = z.enum(['teaching', 'duty', 'training', 'meeting', 'other']);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const zone = z.string().trim().min(1).max(80).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Choose a valid IANA time zone.');
export const activityPlanInput = z.object({
  idempotency_key: uuid,
  expected_revision: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(160),
  purpose: activityPurpose,
  description: z.string().trim().max(1000).default(''),
  timezone: zone,
  starts_on: z.iso.date(),
  ends_on: z.iso.date().nullable().default(null),
  recurrence: z.enum(['once', 'weekly']),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  starts_at: time,
  ends_at: time,
  end_day_offset: z.union([z.literal(0), z.literal(1)]).default(0),
  space_id: uuid.nullable().default(null),
  person_ids: z.array(uuid).max(500).default([]),
  group_ids: z.array(z.string().regex(/^(class|team|group):[0-9a-f-]{36}$/i)).max(50).default([]),
  lead_person_id: uuid.nullable().default(null),
  recorder_person_id: uuid.nullable().default(null),
  reviewer_person_id: uuid.nullable().default(null),
  attendance_mode: z.enum(['none', 'roll_call']).default('none'),
  class_section_id: uuid.nullable().default(null),
  term_id: uuid.nullable().default(null),
  subject_id: uuid.nullable().default(null),
  location_kind: z.enum(['on_campus', 'online', 'off_site', 'unspecified']).default('unspecified'),
  location_label: z.string().trim().max(200).default(''),
  location_url: z.string().trim().max(1000).default('').refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  }, 'Use an HTTP or HTTPS location link without embedded credentials.'),
}).strict().superRefine((value, context) => {
  const issue = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (value.ends_on && value.ends_on < value.starts_on) issue('ends_on', 'End date must not precede the start date.');
  if (value.recurrence === 'weekly' && value.weekdays.length === 0) issue('weekdays', 'Choose at least one repeating weekday.');
  if (new Set(value.weekdays).size !== value.weekdays.length) issue('weekdays', 'Select each weekday only once.');
  if (value.end_day_offset === 0 && value.ends_at <= value.starts_at) issue('ends_at', 'End must follow start; choose Ends next day for an overnight activity.');
  if (value.end_day_offset === 1 && value.ends_at > value.starts_at) issue('ends_at', 'An activity can last up to 24 hours.');
  if (value.person_ids.length === 0 && value.group_ids.length === 0 && !value.class_section_id
    && !(value.attendance_mode === 'none' && value.space_id)) issue('person_ids', 'Choose people, an existing group, or reserve a place without attendance.');
  if (value.location_kind === 'on_campus' && !value.space_id) issue('space_id', 'Choose the campus place for this activity.');
  if (value.location_kind === 'off_site' && !value.location_label) issue('location_label', 'Name the off-site location.');
  if (value.location_kind === 'online' && !value.location_label && !value.location_url) issue('location_label', 'Name the online meeting or provide its joining link.');
  if (Boolean(value.class_section_id) !== Boolean(value.term_id)) issue('class_section_id', 'A class teaching context requires both its class and term.');
  if (value.subject_id && !value.class_section_id) issue('subject_id', 'Choose a class and term before adding an academic subject.');
  if (value.class_section_id && value.purpose !== 'teaching') issue('class_section_id', 'An academic class context is only used for teaching. Choose the class as a participant group for other activities.');
  if (value.recurrence === 'once' && value.ends_on && value.ends_on !== value.starts_on) issue('ends_on', 'A one-time activity uses one starting date; its end time can be the following day.');
});
export const activityActionInput = z.object({
  idempotency_key: uuid, expected_revision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
export const activityRevisionInput = activityActionInput.extend({ starts_on: z.iso.date(), reason: z.string().trim().min(3).max(500) }).strict();
export const activityRangeInput = z.object({
  from: z.iso.date(), until: z.iso.date(),
  page: z.coerce.number().int().positive().default(1),
}).superRefine((value, context) => {
  const days = (Date.parse(value.until) - Date.parse(value.from)) / 86400000;
  if (days < 0 || days > 34) context.addIssue({ code: 'custom', path: ['until'], message: 'Choose an interval of up to 35 days.' });
});
/** Calendar consumers choose expected work explicitly; history remains readable. */
export const activityOccurrenceRangeInput=activityRangeInput.safeExtend({state:z.enum(['all','expected','cancelled']).default('all')});
export type ActivityPlanInput = z.infer<typeof activityPlanInput>;
export interface ActivityParticipant {
  person_id: string; label: string; participation_role: 'participant' | 'lead';
  source_kind: 'person' | 'class' | 'team' | 'group' | 'teaching' | 'event' | 'examination'; source_ref: string;
  source_revision: number; requirement: 'required' | 'optional';
  person_revision?: number;
  /** Scheduled operators remain conflict-bearing without becoming attendees. */
  attendance_expected?: boolean;
}
export interface ActivityOccurrence {
  id: string; school_id: string; activity_id: string; plan_version_id: string | null;
  period_id: string; source: 'activity' | 'academic' | 'event' | 'examination'; source_ref: string; source_revision: number;
  title: string; purpose: string; local_date: string; starts_at: string; ends_at: string;
  timezone: string; space_id: string | null; space_label?: string | null;
  attendance_mode: 'none' | 'roll_call'; context_kind: 'activity' | 'academic_class' | 'event' | 'examination';
  context_ref: string | null; term_id: string | null; subject_id: string | null;
  scheduled_teacher_id: string | null; period_number: number | null;
  state: 'expected' | 'cancelled'; revision: number;
  participants: ActivityParticipant[];
  recorder_person_id: string | null; reviewer_person_id: string | null;
  location_kind: 'on_campus' | 'online' | 'off_site' | 'unspecified'; location_label: string; location_url: string;
}
