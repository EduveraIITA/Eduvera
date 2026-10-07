import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { likeLiteral, manualSchema, searchSchema, type DirectoryResult } from "./schemas.js";

const projection = sql`d.id, d.name, d.institution_type, d.source, d.source_code, d.state, d.district, d.city, d.address, d.is_verified,
  o.school_id IS NOT NULL AS is_onboarded, o.school_id AS eduera_institution_id,
  coalesce(o.status, 'not_onboarded') AS onboarding_status,
  CASE WHEN o.school_id IS NULL THEN 'create' WHEN o.status = 'setup_in_progress' THEN 'continue_setup' ELSE 'view' END AS action`;
type Executor = DatabaseService | Transaction<Database>;


@Injectable()
export class InstitutionsService {
  constructor(private readonly db: DatabaseService) {}

  async requireOperator(userId: string) {
    const result = await sql`SELECT 1 FROM company_operators c JOIN users u ON u.id=c.user_id WHERE c.user_id=${userId}::uuid AND c.is_active AND u.is_active`.execute(this.db);
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

  async prepare(executor: Transaction<Database>, input: {
    directory_id?: string | undefined; manual?: z.infer<typeof manualSchema> | undefined;
    name: string; institution_kind: string; acknowledged_duplicate_ids?: string[] | undefined;
  }) {
    if (input.directory_id) {
      const directory = (await sql<{ id: string; name: string; institution_type: string }>`SELECT id,name,institution_type FROM institution_directory
        WHERE id=${input.directory_id}::uuid FOR UPDATE`.execute(executor)).rows[0];
      if (!directory) throw new NotFoundException("Directory institution not found.");
      const existing = (await sql<{ school_id: string }>`SELECT school_id FROM institution_onboarding WHERE directory_id=${directory.id}::uuid`.execute(executor)).rows[0];
      if (existing) throw new ConflictException({ code: "institution_already_onboarded", message: "This institution already has an Eduera account.", fields: { existing: await this.get(existing.school_id, executor) } });
      return { directory_id: directory.id, name: directory.name, institution_kind: ['college','university','standalone'].includes(directory.institution_type) ? 'college' as const : 'school' as const };
    }
    const manual = input.manual ?? { name: input.name, institution_type: input.institution_kind === 'college' ? 'college' as const : 'school' as const, state: '', district: '', city: '', address: '' };
    await sql`SELECT pg_advisory_xact_lock(78234109)`.execute(executor);
    const duplicates = await this.duplicates(manual, executor);
    if (duplicates.some(item => !input.acknowledged_duplicate_ids?.includes(item.eduera_institution_id!))) {
      throw new ConflictException({ code: "probable_duplicate", message: "Possible existing institutions found. Review before creating another account.", fields: { duplicates } });
    }
    const directoryId = randomUUID();
    await sql`INSERT INTO institution_directory(id,name,institution_type,source,state,district,city,address)
      VALUES(${directoryId}::uuid,${manual.name},${manual.institution_type},'MANUAL',${manual.state},${manual.district},${manual.city},${manual.address})`.execute(executor);
    return { directory_id: directoryId, name: manual.name, institution_kind: ['college','university','standalone'].includes(manual.institution_type) ? 'college' as const : 'school' as const };
  }

  async link(executor: Transaction<Database>, schoolId: string, directoryId: string) {
    // The schools trigger creates a fallback manual entry for all provisioning paths.
    // Replace that placeholder atomically after claiming the selected directory identity.
    await sql`UPDATE institution_onboarding SET directory_id=${directoryId}::uuid,updated_at=now() WHERE school_id=${schoolId}::uuid`.execute(executor);
    await sql`DELETE FROM institution_directory WHERE id=${schoolId}::uuid AND source='MANUAL'
      AND NOT EXISTS(SELECT 1 FROM institution_onboarding WHERE directory_id=${schoolId}::uuid)`.execute(executor);
  }
}
