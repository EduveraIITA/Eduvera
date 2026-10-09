import { z } from 'zod';

export const principalReportInput = z.object({
  topic:z.enum(['summary','attendance','results']).default('summary'),
  period:z.enum(['term','30','90']).default('term'),
  student:z.string().trim().min(2).max(120).optional().describe('Student name, admission number or previously read ID. Never a pronoun.'),
  class_name:z.string().trim().min(1).max(80).optional().describe('An exact class name such as Class 7A, or a previously read class ID. Omit both student and class_name to read the whole institution; school averages ARE available to principals.'),
  group_by:z.enum(['subject','class']).default('subject'),
  offset:z.coerce.number().int().min(0).max(10000).default(0),
  limit:z.coerce.number().int().min(1).max(30).default(20),
}).strict();
export const principalReviewInput = z.object({
  topic:z.enum(['attendance','learning','followups','coverage','fees']),
  date:z.iso.date().optional(), days:z.coerce.number().int().refine(n=>[14,28,56].includes(n)).default(28),
  class_section_id:z.uuid().optional(),threshold:z.coerce.number().int().min(1).max(99).default(50),
}).strict();

export const analyticsDefinitions = {
  attendance:'Recorded student-days: present/late = 1, half-day = 0.5, absent = 0; excused excluded. Missing records are not absences. This is not recording completeness.',
  subject_attendance:'Estimated from recorded daily attendance and effective scheduled lessons, not direct per-lesson observations.',
  results:'Mean percentage of scored results in the latest published snapshots, selected by assessment date; not an official report-card grade or pass rate. Missing scores are excluded, not zero.',
  comparison:'Class and school averages are computed from their underlying records, never by averaging rounded subject/class percentages. Current term and current enrolments apply; cohort changes can affect comparisons.',
};
