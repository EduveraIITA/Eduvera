import { ConflictException } from '@nestjs/common';
import { sql } from 'kysely';
export async function requireLegacyTimetable(db, classId, termId) {
    if ((await sql `SELECT 1 FROM schedule_versions WHERE class_section_id=${classId}::uuid AND (${termId ?? null}::uuid IS NULL OR term_id=${termId ?? null}::uuid) AND state='published' LIMIT 1`.execute(db)).rows.length)
        throw new ConflictException('This class uses dated timetables. Prepare a draft in Schedule settings instead.');
}
//# sourceMappingURL=legacy-guard.js.map