import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { createSchema, likeLiteral, manualSchema, searchSchema, type DirectoryResult } from "./schemas.js";

const projection = sql`d.id, d.name, d.institution_type, d.source, d.source_code, d.state, d.district, d.city, d.address, d.is_verified,
  o.school_id IS NOT NULL AS is_onboarded, o.school_id AS eduera_institution_id,
  coalesce(o.status, 'not_onboarded') AS onboarding_status,
  CASE WHEN o.school_id IS NULL THEN 'create' WHEN o.status = 'setup_in_progress' THEN 'continue_setup' ELSE 'view' END AS action`;
type Executor = DatabaseService | Transaction<Database>;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

@Injectable()
export class InstitutionsService {
  constructor(private readonly db: DatabaseService) {}

  async requireOperator(userId: string) {
    const result = await sql`SELECT 1 FROM company_operators c JOIN users u ON u.id=c.user_id WHERE c.user_id=${userId}::uuid AND u.is_active`.execute(this.db);
    if (!result.rows.length) throw new ForbiddenException("Company Super Admin access is required.");
  }

  async search(query: unknown) {
    const input = searchSchema.parse(query);
    const q = input.q.toLowerCase();
    const partial = `%${likeLiteral(input.q)}%`;
    const prefix = `${likeLiteral(input.q)}%`;
    const result = await sql<DirectoryResult>`SELECT ${projection}
      FROM institution_directory d LEFT JOIN institution_onboarding o ON o.directory_id=d.id
      WHERE (lower(d.name) LIKE ${partial} OR lower(d.source_code) LIKE ${partial}
        OR lower(d.city) LIKE ${partial} OR lower(d.district) LIKE ${partial})
      ${input.type ? sql`AND d.institution_type=${input.type}` : sql``}
      ${input.state ? sql`AND lower(d.state)=${input.state.toLowerCase()}` : sql``}
      ORDER BY CASE WHEN lower(d.name)=${q} THEN 0 WHEN lower(d.name) LIKE ${prefix} THEN 1
        WHEN lower(d.source_code)=${q} THEN 2 WHEN lower(d.source_code) LIKE ${partial} THEN 3 ELSE 4 END,
        d.is_verified DESC, lower(d.name), d.id LIMIT ${input.limit}`.execute(this.db);
    return { results: result.rows };
  }

  async get(schoolId: string, executor: Executor = this.db) {
    const id = z.uuid().parse(schoolId);
    const result = await sql<DirectoryResult>`SELECT ${projection} FROM institution_directory d
      JOIN institution_onboarding o ON o.directory_id=d.id WHERE o.school_id=${id}::uuid`.execute(executor);
    if (!result.rows[0]) throw new NotFoundException("Institution not found.");
    return result.rows[0];
  }

  private async duplicates(input: z.infer<typeof manualSchema>, executor: Executor) {
    // Name similarity is a warning only. It never claims official identity or auto-links a tenant.
    return (await sql<DirectoryResult>`SELECT ${projection} FROM institution_directory d
      JOIN institution_onboarding o ON o.directory_id=d.id
      WHERE lower(d.name)=lower(${input.name}) OR (
        (lower(d.name) LIKE ${`%${likeLiteral(input.name)}%`} OR similarity(lower(d.name),lower(${input.name})) >= 0.4)
        AND (d.state='' OR lower(d.state)=lower(${input.state}))
        AND (d.city='' AND d.district='' OR lower(d.city)=lower(${input.city || input.district})
          OR lower(d.district)=lower(${input.district || input.city})))
      ORDER BY similarity(lower(d.name),lower(${input.name})) DESC, d.id LIMIT 50`.execute(executor)).rows;
  }

  private async audit(tx: Transaction<Database>, actorId: string, schoolId: string, action: string, metadata: Record<string, unknown> = {}) {
    await tx.insertInto("audit_events").values({ action, actor_id: actorId, school_id: schoolId,
      target_type: "institution", target_id: schoolId, request_id: randomUUID(), ip_hash: null, metadata }).execute();
  }

  async create(actorId: string, payload: unknown) {
    const input = createSchema.parse(payload);
    try {
      return await this.db.transaction().execute(async (tx) => {
        let directoryId = input.directory_id;
        let name: string;
        if (directoryId) {
          // Serializes onboarding with itself and importer relinking; unique FK is the final DB guard.
          const found = await sql<{ name: string }>`SELECT name FROM institution_directory WHERE id=${directoryId}::uuid FOR UPDATE`.execute(tx);
          if (!found.rows[0]) throw new NotFoundException("Directory institution not found.");
          name = found.rows[0].name;
          const existing = await sql<{ school_id: string }>`SELECT school_id FROM institution_onboarding WHERE directory_id=${directoryId}::uuid`.execute(tx);
          if (existing.rows[0]) throw new ConflictException({ code: "institution_already_onboarded", message: "This institution already has an Eduera account.", fields: { existing: await this.get(existing.rows[0].school_id, tx) } });
        } else {
          const manual = input.manual!;
          // Manual checks must observe earlier concurrent manual creations before inserting.
          await sql`SELECT pg_advisory_xact_lock(78234109)`.execute(tx);
          const duplicates = await this.duplicates(manual, tx);
          if (duplicates.some((item) => !input.acknowledged_duplicate_ids.includes(item.eduera_institution_id!))) {
            throw new ConflictException({ code: "probable_duplicate", message: "Possible existing institutions found. Review before creating another account.", fields: { duplicates } });
          }
          directoryId = randomUUID();
          name = manual.name;
          await sql`INSERT INTO institution_directory (id,name,institution_type,source,state,district,city,address)
            VALUES (${directoryId}::uuid,${name},${manual.institution_type},'MANUAL',${manual.state},${manual.district},${manual.city},${manual.address})`.execute(tx);
        }
        const schoolId = randomUUID();
        await tx.insertInto("schools").values({ id: schoolId, name, code: `EDU-${randomBytes(10).toString("hex")}` }).execute();
        await sql`INSERT INTO institution_onboarding (school_id,directory_id) VALUES (${schoolId}::uuid,${directoryId}::uuid)`.execute(tx);
        await this.audit(tx, actorId, schoolId, "institution.created", { directory_id: directoryId, acknowledged_duplicate_ids: input.acknowledged_duplicate_ids });
        return this.get(schoolId, tx);
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new ConflictException("This institution is already being onboarded. Search again to continue setup.");
      }
      throw error;
    }
  }

  async invite(actorId: string, schoolId: string, payload: unknown) {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(payload);
    const token = randomBytes(32).toString("hex");
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT school_id FROM institution_onboarding WHERE school_id=${z.uuid().parse(schoolId)}::uuid FOR UPDATE`.execute(tx);
      const institution = await this.get(schoolId, tx);
      if (institution.onboarding_status === "suspended") throw new ConflictException("Suspended institutions cannot invite administrators.");
      await sql`UPDATE institution_admin_invitations SET revoked_at=now() WHERE school_id=${schoolId}::uuid AND accepted_at IS NULL AND revoked_at IS NULL`.execute(tx);
      await sql`INSERT INTO institution_admin_invitations (school_id,email,token_hash,created_by,expires_at)
        VALUES (${schoolId}::uuid,${email},${hash(token)},${actorId}::uuid,now()+interval '72 hours')`.execute(tx);
      await this.audit(tx, actorId, schoolId, "institution.admin_invited", { email });
      return { token, email, expires_in_hours: 72, join_path: "/join-institution", delivery: "manual_share" };
    });
  }

  async accept(userId: string, payload: unknown) {
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(payload);
    return this.db.transaction().execute(async (tx) => {
      const candidate = (await sql<{ school_id: string }>`SELECT school_id FROM institution_admin_invitations WHERE token_hash=${hash(token)}`.execute(tx)).rows[0];
      if (!candidate) throw new NotFoundException("Invitation is expired, revoked, or already used.");
      // Consistent lock order with invite/replacement avoids invitation/onboarding deadlocks.
      await sql`SELECT school_id FROM institution_onboarding WHERE school_id=${candidate.school_id}::uuid FOR UPDATE`.execute(tx);
      const invitation = (await sql<{ id: string; school_id: string; email: string; created_by: string }>`SELECT * FROM institution_admin_invitations
        WHERE token_hash=${hash(token)} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`.execute(tx)).rows[0];
      if (!invitation) throw new NotFoundException("Invitation is expired, revoked, or already used.");
      const user = await tx.selectFrom("users").select(["email", "is_active"]).where("id", "=", userId).executeTakeFirstOrThrow();
      if (!user.is_active || user.email.toLowerCase() !== invitation.email) throw new ForbiddenException("Sign in using the invited email address.");
      const authority = await sql`SELECT 1 FROM company_operators c JOIN users u ON u.id=c.user_id WHERE c.user_id=${invitation.created_by}::uuid AND u.is_active`.execute(tx);
      if (!authority.rows.length) throw new ForbiddenException("The inviting operator no longer has company access.");
      if ((await this.get(invitation.school_id, tx)).onboarding_status === "suspended") throw new ConflictException("Institution is suspended.");
      await tx.insertInto("school_memberships").values({ school_id: invitation.school_id, user_id: userId, role: "admin" })
        .onConflict((oc) => oc.columns(["user_id", "school_id", "role"]).doUpdateSet({ is_active: true })).execute();
      await sql`UPDATE institution_admin_invitations SET accepted_at=now() WHERE id=${invitation.id}::uuid`.execute(tx);
      await sql`UPDATE institution_onboarding SET status='active',updated_at=now() WHERE school_id=${invitation.school_id}::uuid`.execute(tx);
      await this.audit(tx, userId, invitation.school_id, "institution.admin_invitation_accepted");
      return { school_id: invitation.school_id, onboarding_status: "active" };
    });
  }
}
