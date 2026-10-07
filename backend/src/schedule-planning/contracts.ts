import { z } from 'zod';
import { date, uuid } from '../day-plans/contracts.js';
export const command = z.object({ school_id: uuid, idempotency_key: uuid });
export const period = z.object({
  id: uuid, weekday: z.number().int().min(1).max(7), period_number: z.number().int().min(1).max(24),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/),
  ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/),
  subject_id: uuid.nullable(), teacher_user_id: uuid.nullable(),
  title: z.string().trim().min(1).max(120), slot_type: z.enum(['class','break','activity']), room: z.string().trim().max(80),
}).strict().refine(p=>p.starts_at.slice(0,5)<p.ends_at.slice(0,5),'End time must follow start time.');
export const start = command.extend({ term_id: uuid, class_section_id: uuid, starts_on: date, ends_on: date, source_id: uuid.optional() }).strict();
export const save = command.extend({ expected_revision: z.number().int().positive(), starts_on: date, ends_on: date, periods: z.array(period).max(168) }).strict().refine(p=>new Set(p.periods.map(r=>`${r.weekday}:${r.period_number}`)).size===p.periods.length,'Period numbers must be unique within each day.');
export const action = command.extend({ expected_revision: z.number().int().positive() }).strict();
export const year = command.extend({ academic_year: z.string().trim().min(1).max(9), source_year: z.string().trim().min(1).max(9).optional(), terms: z.array(z.object({ name: z.string().trim().min(1).max(100), starts_on: date, ends_on: date })).min(1).max(6) }).strict();
export type Period = z.infer<typeof period>;
export interface Version { id:string; school_id:string; class_section_id:string; term_id:string; state:'draft'|'published'|'discarded'; starts_on:string; ends_on:string; revision:number; baseline:boolean; }

export function localConflicts(rows: Period[]) {
  const result:string[]=[];
  for(let i=0;i<rows.length;i++) for(const other of rows.slice(i+1)) {
    const row=rows[i]!;
    if(row.weekday===other.weekday && row.starts_at.slice(0,5)<other.ends_at.slice(0,5) && other.starts_at.slice(0,5)<row.ends_at.slice(0,5)) result.push(`Day ${row.weekday}: periods ${row.period_number} and ${other.period_number} overlap.`);
  }
  return result;
}
