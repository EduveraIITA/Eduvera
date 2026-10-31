import { ConflictException } from "@nestjs/common";
import { sql } from "kysely";
/** People/Staff identity bridge for an explicitly assigned campus operator.
 * Reuses an exact account endpoint; contact details never resolve or merge people.
 * A teaching responsibility supplies no employment, qualifications or tenure facts.
 */
export async function ensureOperationalStaffProfile(db, identities, input) {
    await sql `SELECT pg_advisory_xact_lock(hashtextextended(
    ${`staff-account-profile:${input.school_id}:${input.user_id}`},0))`.execute(db);
    const existing = await db.selectFrom("staff_profiles").selectAll()
        .where("school_id", "=", input.school_id).where("user_id", "=", input.user_id)
        .forUpdate().executeTakeFirst();
    if (existing && existing.status !== "active") {
        throw new ConflictException("This person's staff access is not active. Review their existing staff record before assigning the register.");
    }
    let identity = await identities.resolveAccountEndpoint(db, {
        school_id: input.school_id, user_id: input.user_id, at: input.at,
    });
    // Legacy active Staff records already own the explicit person link. Linking that
    // known profile is safe; never create a second person to recover an unlinked login.
    if (!identity.acting && identity.reason === "account_not_linked" && existing) {
        identity = await identities.linkAccountEndpoint(db, {
            school_id: input.school_id, user_id: input.user_id, actor_user_id: input.actor_user_id,
            person_id: existing.person_id, effective_from: input.at, effective_until: null,
            source_domain: "staff", source_record_id: existing.id, source_revision: existing.revision,
            metadata: { identity_source: "explicit_staff_profile", purpose: "progressive_capability_setup" },
        });
    }
    if (!identity.acting) {
        throw new ConflictException("This account needs its campus person identity restored before assigning the register.");
    }
    if (existing) {
        if (existing.person_id !== identity.person_id) {
            throw new ConflictException("The account and staff record identify different campus people. Review the identity link before assigning work.");
        }
        return existing;
    }
    const personProfile = await db.selectFrom("staff_profiles").select("id")
        .where("school_id", "=", input.school_id).where("person_id", "=", identity.person_id)
        .executeTakeFirst();
    if (personProfile) {
        throw new ConflictException("This campus person already has a staff record linked to another account. Review that record instead of creating a duplicate.");
    }
    try {
        return await db.insertInto("staff_profiles").values({
            school_id: input.school_id, user_id: input.user_id, person_id: identity.person_id,
            staff_code: `OPS-${input.user_id.replaceAll("-", "")}`,
            staff_kind: input.staff_kind, designation: input.designation,
            employment_type: "unspecified", joined_on: null, status: "active",
            created_by: input.actor_user_id, updated_by: input.actor_user_id,
        }).returningAll().executeTakeFirstOrThrow();
    }
    catch (error) {
        if (error.code === "23505") {
            throw new ConflictException("A work record already uses this person's identity or staff code. Review that record before assigning the register.");
        }
        throw error;
    }
}
//# sourceMappingURL=operational-staff-profile.js.map