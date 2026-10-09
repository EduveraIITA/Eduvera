import { BadRequestException } from '@nestjs/common';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
export interface RecordReference { id: string; label: string; kind: string; aliases: string[]; source: string }

/** Minimal structured context, rebuilt from freshly authorized reads each turn.
 * Do not carry raw profile fields, credentials or model-invented identifiers.
 */
export function recordReferences(value: unknown, source: string): RecordReference[] {
  const found = new Map<string, RecordReference>();
  function add(id: unknown, label: unknown, kind: string, aliases: unknown[] = []) {
    if (typeof id !== 'string' || !uuid.test(id) || typeof label !== 'string' || !label.trim()) return;
    const prior = found.get(id);
    found.set(id, { id, label: label.slice(0,180), kind, source,
      aliases: [...new Set([...(prior?.aliases ?? []),label,...aliases].filter((alias): alias is string => typeof alias === 'string' && !!alias.trim()))].slice(0,8) });
  }
  function visit(item: unknown, key: string) {
    if (Array.isArray(item)) { item.forEach(row => visit(row,key)); return; }
    if (!item || typeof item !== 'object') return;
    const row = item as Record<string,unknown>;
    const label = row.name ?? row.title ?? row.display_name ?? row.student_name ?? row.class_name
      ?? (typeof row.first_name === 'string' ? `${row.first_name} ${typeof row.last_name==='string'?row.last_name:''}`.trim() : undefined);
    const kind = row.admission_number || /student|roster/.test(key) ? 'student' : key === 'class' || row.class_name ? 'class' : source;
    add(row.id ?? row.student_id, label, kind, [row.admission_number]);
    add(row.class_section_id, row.class_name, 'class');
    for (const [childKey, child] of Object.entries(row)) visit(child,childKey);
  }
  visit(value,source);
  return [...found.values()];
}

export function resolveReferences(value: unknown, references: readonly RecordReference[], key = ''): unknown {
  if (Array.isArray(value)) return value.map(item => resolveReferences(item,references,key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name,item]) => [name,resolveReferences(item,references,name)]));
  if (typeof value !== 'string') return value;
  // IDs remain internal; a unique exact name/admission code is a safe alias.
  if ((key === 'id' || key === 'record_id' || key.endsWith('_id') || key.endsWith('_ids')) && !uuid.test(value)) {
    const matches = [...new Set(references.filter(ref => ref.aliases.some(alias => normalize(alias) === normalize(value)))
      .filter(ref => !key.includes('student') || ref.kind === 'student')
      .filter(ref => !key.includes('class') || ref.kind === 'class').map(ref => ref.id))];
    if (matches.length === 1) return matches[0];
    throw new BadRequestException(matches.length ? 'More than one record matches. Ask for the name and class or another distinguishing detail.'
      : 'Look up this record by name or admission number first. Never ask the user for an internal ID.');
  }
  return value;
}

export function schoolDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function reportsUnverifiedWrite(text: string) {
  return /\b(?:I(?:\s+have|'ve)?|we(?:\s+have|'ve)?)\s+(?:successfully\s+)?(?:marked|saved|submitted|sent|updated|deleted|created|cancelled|recorded|approved|published)\b|\b(?:has|have) been (?:successfully )?(?:marked|saved|submitted|sent|updated|deleted|created|recorded|approved|published)\b/i.test(text);
}
