import { z } from "zod";

export const practiceId = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !value.includes("\0"));
export const practiceCommand = z.object({ command_id: practiceId });
export const publishPractice = practiceCommand.extend({
  practice_id: practiceId, class_section_id: practiceId, term_id: practiceId,
  subject_id: practiceId.nullable().default(null), date: z.iso.date(),
  title: text(180), body: text(4000), due_at: z.iso.datetime({ offset: true }).nullable().default(null),
}).strict();
export const practiceNote = practiceCommand.extend({ note_id: practiceId, student_id: practiceId, body: text(2000) }).strict();
export const practiceCompletion = practiceCommand.extend({ student_id: practiceId, completed: z.boolean() }).strict();
export type PracticeCommand = z.infer<typeof practiceCommand>;
