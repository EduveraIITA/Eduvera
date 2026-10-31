import type { Pool, PoolClient } from "pg";

/** Synthetic fixture construction only, never a product intake API or proof of
 * an accepted Core action. The caller names exact parent/person IDs; no contact,
 * name or account matching, invitation, permission or acting endpoint is added. */
export async function ensureFixtureGuardianProfile(connection: Pool | PoolClient,input: {
  schoolId: string;guardianId: string;firstName: string;lastName?: string;
  contactPhone?: string;contactEmail?: string;personId?: string;
}) {
  const existing=(await connection.query<{person_id:string}>(`SELECT person_id FROM guardian_school_profiles
    WHERE school_id=$1 AND guardian_id=$2`,[input.schoolId,input.guardianId])).rows[0];
  if(existing) {
    if(input.personId && input.personId!==existing.person_id) throw new Error("The synthetic guardian fixture already identifies another exact person.");
    return existing.person_id;
  }
  const parent=(await connection.query("SELECT id FROM parents WHERE id=$1",[input.guardianId])).rows[0];
  if(!parent) throw new Error("The synthetic guardian fixture requires an existing exact parent record.");
  const person=input.personId ? (await connection.query<{id:string}>("SELECT id FROM school_people WHERE school_id=$1 AND id=$2",
    [input.schoolId,input.personId])).rows[0] : (await connection.query<{id:string}>(`INSERT INTO school_people(school_id,first_name,last_name,contact_phone,contact_email)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[input.schoolId,input.firstName,input.lastName??"",input.contactPhone??"",input.contactEmail??""])).rows[0];
  if(!person) throw new Error("The synthetic guardian fixture person belongs to another institution or is missing.");
  await connection.query("INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)",
    [input.schoolId,input.guardianId,person.id]);
  return person.id;
}
