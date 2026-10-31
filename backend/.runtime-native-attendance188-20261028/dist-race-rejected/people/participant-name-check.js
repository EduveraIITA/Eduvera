import { sql } from "kysely";
import { z } from "zod";
export const participantNameCheckSchema = z.object({ names: z.array(z.object({
        row_id: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(150),
    }).strict()).min(1).max(100) }).strict().refine(input => new Set(input.names.map(row => row.row_id)).size === input.names.length, "Each row must have a unique row_id.");
// Use the same explicit Unicode whitespace set on both sides of the comparison.
// Normalization is a warning key only: labels and stored names are never rewritten.
const whitespace = "[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+";
export async function readParticipantNameMatches(db, schoolId, date, input) {
    const rows = await sql `WITH requested AS (
    SELECT value->>'row_id' AS row_id,value->>'name' AS name,ordinality,
      lower(btrim(regexp_replace(value->>'name',${whitespace},' ','g'))) AS normalized_name
    FROM jsonb_array_elements(${JSON.stringify(input.names)}::jsonb) WITH ORDINALITY
  ), campus_people AS (
    SELECT person.id,trim(concat_ws(' ',person.first_name,person.last_name)) AS label,person.revision,
      lower(btrim(regexp_replace(concat_ws(' ',person.first_name,person.last_name),${whitespace},' ','g'))) AS normalized_name
    FROM school_people person WHERE person.school_id=${schoolId}::uuid AND person.retired_at IS NULL
  ), ranked AS (
    SELECT person.*,count(*) OVER(PARTITION BY normalized_name)::int AS total,
      row_number() OVER(PARTITION BY normalized_name ORDER BY id) AS position
    FROM campus_people person WHERE normalized_name IN(SELECT normalized_name FROM requested)
  ), matched AS (
    SELECT normalized_name,max(total)::int AS total,jsonb_agg(jsonb_build_object(
      'id',person.id,'label',person.label,'revision',person.revision,'affiliations',ARRAY(
        SELECT DISTINCT affiliation FROM (
          SELECT affiliation FROM person_affiliations a WHERE a.school_id=${schoolId}::uuid AND a.person_id=person.id
            AND a.starts_on<=${date}::date AND (a.ends_on IS NULL OR a.ends_on>=${date}::date)
          UNION SELECT 'learner' WHERE EXISTS(SELECT 1 FROM students s WHERE s.school_id=${schoolId}::uuid AND s.person_id=person.id)
          UNION SELECT 'worker' WHERE EXISTS(SELECT 1 FROM staff_profiles s WHERE s.school_id=${schoolId}::uuid AND s.person_id=person.id)
        ) affiliations ORDER BY affiliation
      )) ORDER BY person.id) AS matches
    FROM ranked person WHERE position<=5 GROUP BY normalized_name
  ) SELECT requested.row_id,requested.name,requested.normalized_name,
    coalesce(matched.matches,'[]'::jsonb) AS matches,coalesce(matched.total,0)::int AS total
    FROM requested LEFT JOIN matched USING(normalized_name) ORDER BY requested.ordinality`.execute(db);
    return { results: rows.rows.map(row => ({ ...row, truncated: row.total > row.matches.length })) };
}
//# sourceMappingURL=participant-name-check.js.map