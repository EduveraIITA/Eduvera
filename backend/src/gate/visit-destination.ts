import { NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../database/types.js';
/** Exact retained destination for manager, organiser and minimized participant reads. */
export async function readVisitDestination(tx: Transaction<Database>, school: string, visit: { place_id: string | null; destination_campus_id?: string | null }) {
  const row = (await sql<{id:string;label:string;kind:string;campus_label:string}>`
    SELECT space.id,space.name AS label,space.kind,campus.name AS campus_label
    FROM campus_spaces space JOIN institution_campuses campus ON campus.id=space.campus_id AND campus.school_id=space.school_id
    WHERE space.school_id=${school}::uuid AND space.id=${visit.place_id}::uuid
    UNION ALL SELECT campus.id,campus.name,'campus',campus.name FROM institution_campuses campus
    WHERE campus.school_id=${school}::uuid AND campus.id=${visit.destination_campus_id ?? null}::uuid`.execute(tx)).rows;
  if (row.length !== 1) throw new NotFoundException('The exact retained visit destination is unavailable.');
  return row[0]!;
}
