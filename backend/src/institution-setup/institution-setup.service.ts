import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import type { AuthUser } from "../common/request.js";
import { CAMPUS_MODEL_CORE_PORT, type CampusModelCorePort } from "../campus-model-core/campus-model-core.port.js";
import { OBSERVATION_SOURCE_REGISTRY_PORT, type ObservationSourceRegistryPort } from "../campus-model-core/observation-source-registry.port.js";
import type { CampusModelEntitySnapshot, CampusModelRelationshipSnapshot } from "../campus-model-core/contracts.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";

type Db = DatabaseService | Transaction<Database>;
type Request = FastifyRequest & { requestId?: string };
type ModelRef = { domain: string; domain_id: string };
interface ModelChange {
  target: ModelRef;
  entities: CampusModelEntitySnapshot[];
  relationships?: CampusModelRelationshipSnapshot[];
  expectedRevision?: number | null;
  resultingRevision?: number | null;
  safeContext?: Record<string, unknown>;
}
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).default("");
const campusFields = {
  parent_campus_id: uuid.nullable().default(null), name: z.string().trim().min(2).max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/),
  campus_type: z.enum(["main", "branch", "learning_centre", "virtual"]),
  status: z.enum(["active", "inactive"]).default("active"), is_primary: z.boolean().default(false),
  address_line: text(240), city: text(100), state: text(100), postal_code: text(16),
  timezone: z.string().trim().min(3).max(80).default("Asia/Kolkata"),
};
const campusCreate = z.object(campusFields).strict();
const campusUpdate = z.object({ ...campusFields, expected_revision: z.number().int().positive() }).strict();
const spaceFields = {
  campus_id: uuid, parent_space_id: uuid.nullable().default(null), name: z.string().trim().min(2).max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/),
  kind: z.enum(["building", "wing", "floor", "classroom", "laboratory", "library", "office", "auditorium", "sports_area", "workshop", "staff_room", "gate", "outdoor_area", "virtual", "other"]),
  capacity: z.number().int().positive().max(100000).nullable().default(null),
  is_accessible: z.boolean().default(false), is_bookable: z.boolean().default(true),
  status: z.enum(["active", "inactive"]).default("active"),
};
const spaceCreate = z.object(spaceFields).strict();
const spaceUpdate = z.object({ ...spaceFields, expected_revision: z.number().int().positive() }).strict();
const typeFields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/), name: z.string().trim().min(2).max(120),
  category: z.enum(["computer", "display", "tablet", "lab_equipment", "furniture", "vehicle", "network", "safety", "other"]),
  tracking_mode: z.enum(["pooled", "individual"]), unit_label: z.string().trim().min(1).max(32), is_active: z.boolean().default(true),
};
const typeCreate = z.object(typeFields).strict();
const typeUpdate = z.object({ ...typeFields, expected_revision: z.number().int().positive() }).strict();
const holdingFields = {
  campus_id: uuid, space_id: uuid.nullable().default(null), resource_type_id: uuid,
  name: z.string().trim().min(2).max(160), quantity: z.number().int().positive().max(1000000).default(1),
  asset_tag: z.string().trim().max(80).nullable().default(null), state: z.enum(["available", "unavailable", "retired"]).default("available"), notes: text(500),
};
const holdingCreate = z.object(holdingFields).strict();
const holdingUpdate = z.object({ ...holdingFields, expected_revision: z.number().int().positive() }).strict();
const placement = z.object({ campus_id: uuid, home_space_id: uuid.nullable().optional(), effective_from: z.string().date(), expected_current_revision: z.number().int().positive().nullable() }).strict();
const staffPlacement = placement.omit({ home_space_id: true });
const sourceCreate = z.object({
  kind: z.enum(["device", "integration"]), external_ref: z.string().trim().min(3).max(160),
  label: z.string().trim().min(2).max(200),
  capabilities: z.array(z.enum(["observe:attendance.capture", "observe:gate.movement"])).min(1).max(2),
  scope_type: z.enum(["institution", "campus", "space"]), scope_id: uuid.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.scope_type !== "institution" && !value.scope_id) context.addIssue({ code: "custom", path: ["scope_id"], message: "Choose the campus or space this source can observe." });
});
const sourceState = z.object({ status: z.enum(["active", "suspended", "revoked"]), expected_revision: z.number().int().positive() }).strict();

@Injectable()
export class InstitutionSetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(CAMPUS_MODEL_CORE_PORT) private readonly campusModel: CampusModelCorePort,
    @Inject(OBSERVATION_SOURCE_REGISTRY_PORT) private readonly observationSources: ObservationSourceRegistryPort,
  ) {}

  private async requireAdmin(user: AuthUser, schoolId: string, db: Db = this.db) {
    const member = await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId)
      .where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
    if (!member) throw new ForbiddenException("An active institution administrator membership is required.");
  }
  private async campus(schoolId: string, id: string, db: Db = this.db) {
    const row = await db.selectFrom("institution_campuses").selectAll().where("school_id", "=", schoolId).where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundException("Campus not found in this institution."); return row;
  }
  private async space(schoolId: string, campusId: string, id: string, db: Db = this.db) {
    const row = await db.selectFrom("campus_spaces").selectAll().where("school_id", "=", schoolId).where("campus_id", "=", campusId).where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundException("Space not found in the selected campus."); return row;
  }
  private async setupEvent(db: Transaction<Database>, input: { schoolId: string; actorId: string; action: string; targetType: string; targetId: string; metadata?: Record<string, unknown>; requestId?: string | undefined; model: ModelChange }) {
    await db.insertInto("institution_setup_audits").values({ school_id: input.schoolId, actor_id: input.actorId, action: input.action, target_type: input.targetType, target_id: input.targetId, metadata: input.metadata ?? {} }).execute();
    const audience = await db.selectFrom("school_memberships").select("user_id").where("school_id", "=", input.schoolId).where("role", "=", "admin").where("is_active", "=", true).execute();
    const event = await db.insertInto("event_outbox").values({ school_id: input.schoolId, event_type: "institution.setup.updated", aggregate_type: input.targetType, aggregate_id: input.targetId,
      audience_user_ids: audience.map((item) => item.user_id), payload: { refresh: ["principal.administration"], action: input.action, ...input.metadata },
      idempotency_key: `institution-setup:${input.requestId ?? randomUUID()}:${input.action}:${input.targetId}` }).returning("id").executeTakeFirstOrThrow();
    await this.campusModel.recordAcceptedChange(db, {
      school_id: input.schoolId,
      actor_user_id: input.actorId,
      command_type: input.action,
      target: input.model.target,
      idempotency_key: `campus-model:${event.id}`,
      correlation_id: randomUUID(),
      causation_id: null,
      expected_revision: input.model.expectedRevision ?? null,
      authority_evidence: ["active_institution_administrator"],
      operating_rule_version_ref: null,
      source_domain: "campus_topology",
      safe_context: input.model.safeContext ?? {},
      entities: input.model.entities,
      relationships: input.model.relationships ?? [],
      outcome: {
        code: input.action,
        explanation: "The institution setup change was accepted.",
        resulting_revision: input.model.resultingRevision ?? null,
        metadata: {},
      },
      domain_event_id: event.id,
    });
  }

  private entity(input: CampusModelEntitySnapshot): CampusModelEntitySnapshot { return input; }
  private ref(domain: string, domainId: string): ModelRef { return { domain, domain_id: domainId }; }
  private relationship(input: CampusModelRelationshipSnapshot): CampusModelRelationshipSnapshot { return input; }
  private time(value: Date | string | null | undefined = new Date()): string {
    return new Date(value ?? Date.now()).toISOString();
  }
  private institutionEntity(row: { id: string; name: string }) {
    return this.entity({ kind: "institution", domain: "institutions", domain_id: row.id, label: row.name, lifecycle_state: "active", source_revision: 1, metadata: {} });
  }
  private campusEntity(row: { id: string; name: string; status: "active" | "inactive"; revision: number }) {
    return this.entity({ kind: "campus", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.status, source_revision: row.revision, metadata: {} });
  }
  private spaceEntity(row: { id: string; name: string; status: "active" | "inactive"; revision: number; kind: string }) {
    return this.entity({ kind: "space", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.status, source_revision: row.revision, metadata: { space_kind: row.kind } });
  }
  private resourceTypeEntity(row: { id: string; name: string; is_active: boolean; revision: number; category: string }) {
    return this.entity({ kind: "resource_type", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.is_active ? "active" : "inactive", source_revision: row.revision, metadata: { category: row.category } });
  }
  private holdingEntity(row: { id: string; name: string; state: "available" | "unavailable" | "retired"; revision: number }) {
    return this.entity({ kind: "resource", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.state === "retired" ? "retired" : "active", source_revision: row.revision, metadata: { availability: row.state } });
  }
  private classEntity(row: { id: string; grade: string; section: string; revision: number }) {
    return this.entity({ kind: "class", domain: "academic_structure", domain_id: row.id, label: `Class ${row.grade}${row.section}`, lifecycle_state: "active", source_revision: row.revision, metadata: {} });
  }
  private staffEntity(row: { id: string; first_name: string; last_name: string; status: "onboarding" | "active" | "inactive"; revision: number }) {
    return this.entity({ kind: "staff", domain: "people", domain_id: row.id, label: `${row.first_name} ${row.last_name}`.trim(), lifecycle_state: row.status === "inactive" ? "inactive" : "active", source_revision: row.revision, metadata: {} });
  }
  private setRelationship(input: {
    type: string; source: ModelRef; target: ModelRef; effectiveFrom: string;
    sourceRecordId: string; sourceRevision: number; metadata?: Record<string, unknown>;
  }) {
    return this.relationship({ relation_type: input.type, source: input.source, target: input.target,
      operation: "set", effective_from: input.effectiveFrom, effective_until: null,
      source_domain: "campus_topology", source_record_id: input.sourceRecordId,
      source_revision: input.sourceRevision, replace_current: true, metadata: input.metadata ?? {} });
  }
  private clearRelationship(input: {
    type: string; source: ModelRef; effectiveFrom: string; sourceRecordId: string; sourceRevision: number;
  }) {
    return this.relationship({ relation_type: input.type, source: input.source, target: null,
      operation: "clear", effective_from: input.effectiveFrom, effective_until: null,
      source_domain: "campus_topology", source_record_id: input.sourceRecordId,
      source_revision: input.sourceRevision, replace_current: true, metadata: {} });
  }
  private async externalAudit(action: string, request: Request, user: AuthUser, schoolId: string, targetType: string, targetId: string) {
    await this.audit.record({ action, request, actorId: user.id, schoolId, targetType, targetId });
  }

  async workspace(user: AuthUser, schoolId: string) {
    await this.requireAdmin(user, schoolId);
    const school = await this.db.selectFrom("schools").select(["id", "name", "code", "timezone", "institution_kind"]).where("id", "=", schoolId).executeTakeFirst();
    if (!school) throw new NotFoundException("Institution not found.");
    const [campuses, spaces, resourceTypes, holdings, classes, staff, history, activity, signals, observationSources] = await Promise.all([
      this.db.selectFrom("institution_campuses").selectAll().where("school_id", "=", schoolId).orderBy("is_primary", "desc").orderBy("name").execute(),
      this.db.selectFrom("campus_spaces").selectAll().where("school_id", "=", schoolId).orderBy("name").execute(),
      this.db.selectFrom("campus_resource_types").selectAll().where("school_id", "=", schoolId).orderBy("name").execute(),
      this.db.selectFrom("campus_resource_holdings as holding").innerJoin("campus_resource_types as type", "type.id", "holding.resource_type_id")
        .select(["holding.id", "holding.school_id", "holding.campus_id", "holding.space_id", "holding.resource_type_id", "holding.name", "holding.quantity", "holding.asset_tag", "holding.state", "holding.notes", "holding.revision", "type.name as resource_type_name", "type.category", "type.tracking_mode", "type.unit_label"])
        .where("holding.school_id", "=", schoolId).orderBy("holding.name").execute(),
      sql<any>`SELECT section.id,section.grade,section.section,section.academic_year,section.revision AS class_revision,
          placement.id AS placement_id,placement.campus_id,placement.home_space_id,placement.revision AS placement_revision,
          placement.effective_from,placement.effective_until,space.name AS home_space_name
        FROM class_sections section LEFT JOIN class_campus_placements placement ON placement.class_section_id=section.id
          AND placement.is_primary AND placement.effective_from<=current_date AND (placement.effective_until IS NULL OR placement.effective_until>=current_date)
        LEFT JOIN campus_spaces space ON space.id=placement.home_space_id
        WHERE section.school_id=${schoolId}::uuid ORDER BY section.grade,section.section`.execute(this.db).then((result) => result.rows),
      sql<any>`SELECT profile.id,profile.first_name,profile.last_name,profile.staff_code,profile.designation,profile.status,
          assignment.id AS assignment_id,assignment.campus_id,assignment.revision AS assignment_revision,
          assignment.effective_from,assignment.effective_until
        FROM staff_profiles profile LEFT JOIN staff_campus_assignments assignment ON assignment.staff_profile_id=profile.id
          AND assignment.is_primary AND assignment.effective_from<=current_date AND (assignment.effective_until IS NULL OR assignment.effective_until>=current_date)
        WHERE profile.school_id=${schoolId}::uuid ORDER BY profile.first_name,profile.last_name`.execute(this.db).then((result) => result.rows),
      this.db.selectFrom("institution_setup_audits").selectAll().where("school_id", "=", schoolId).orderBy("created_at", "desc").limit(20).execute(),
      this.campusModel.recentActivity(schoolId),
      this.campusModel.operationalSignals(schoolId),
      this.observationSources.listObservationSources(schoolId),
    ]);
    const activeCampuses = campuses.filter((item) => item.status === "active");
    const locatedClasses = classes.filter((item) => item.home_space_id).length;
    const assignedClasses = classes.filter((item) => item.campus_id).length;
    const locatedStaff = staff.filter((item) => item.campus_id).length;
    const readiness = [
      { key: "campus", label: "Campus", complete: activeCampuses.length > 0, detail: `${activeCampuses.length} active` },
      { key: "spaces", label: "Spaces", complete: spaces.some((item) => item.status === "active"), detail: `${spaces.filter((item) => item.status === "active").length} mapped` },
      { key: "classes", label: "Class campuses", complete: classes.length === 0 || assignedClasses === classes.length, detail: `${assignedClasses}/${classes.length} assigned` },
      { key: "staff", label: "Staff campuses", complete: staff.length === 0 || locatedStaff === staff.length, detail: `${locatedStaff}/${staff.length} assigned` },
    ];
    return { school, campuses, spaces, resource_types: resourceTypes, holdings, classes, staff, history, activity, signals, observation_sources: observationSources, readiness,
      summary: { campuses: activeCampuses.length, spaces: spaces.filter((item) => item.status === "active").length,
        resources: holdings.filter((item) => item.state !== "retired").reduce((sum, item) => sum + item.quantity, 0),
        classes: classes.length, classes_with_home_space: locatedClasses, staff: staff.length, complete: readiness.every((item) => item.complete) } };
  }

  async registerObservationSource(user: AuthUser, schoolId: string, body: unknown, request: Request) {
    const data = sourceCreate.parse(body);
    const row = await this.db.transaction().execute(async (db) => {
      await this.requireAdmin(user, schoolId, db);
      let scope: { domain: string; domain_id: string } | null = null;
      if (data.scope_type === "campus") { await this.campus(schoolId, data.scope_id!, db); scope = { domain: "campus_topology", domain_id: data.scope_id! }; }
      if (data.scope_type === "space") {
        const item = await db.selectFrom("campus_spaces").select(["id", "campus_id"]).where("school_id", "=", schoolId).where("id", "=", data.scope_id!).executeTakeFirst();
        if (!item) throw new NotFoundException("Space not found in this institution.");
        scope = { domain: "campus_topology", domain_id: item.id };
      }
      const rule = (await sql<{ revision: number }>`SELECT revision FROM institution_operating_rules WHERE school_id=${schoolId}::uuid`.execute(db)).rows[0];
      const created = await this.observationSources.registerObservationSource(db, { school_id: schoolId, actor_user_id: user.id,
        kind: data.kind, external_ref: data.external_ref, label: data.label, capabilities: data.capabilities,
        scope, operating_rule_version_ref: rule ? `institution-operating-rules:${rule.revision}` : null });
      await this.sourceLifecycleEvent(db, schoolId, user.id, "observation_source.registered", created.id, request.requestId, { label: created.label, status: created.status });
      return created;
    });
    await this.externalAudit("institution.setup.observation_source.registered", request, user, schoolId, "observation_source", row.id);
    return row;
  }

  async setObservationSourceStatus(user: AuthUser, schoolId: string, sourceId: string, body: unknown, request: Request) {
    const data = sourceState.parse(body);
    const row = await this.db.transaction().execute(async (db) => {
      await this.requireAdmin(user, schoolId, db);
      const updated = await this.observationSources.setObservationSourceStatus(db, { school_id: schoolId, actor_user_id: user.id,
        source_id: sourceId, status: data.status, expected_revision: data.expected_revision });
      await this.sourceLifecycleEvent(db, schoolId, user.id, `observation_source.${data.status}`, updated.id, request.requestId, { label: updated.label, status: updated.status });
      return updated;
    });
    await this.externalAudit(`institution.setup.observation_source.${data.status}`, request, user, schoolId, "observation_source", row.id);
    return row;
  }

  private async sourceLifecycleEvent(db: Transaction<Database>, schoolId: string, actorId: string, action: string, targetId: string, requestId: string | undefined, metadata: Record<string, unknown>) {
    await db.insertInto("institution_setup_audits").values({ school_id: schoolId, actor_id: actorId, action, target_type: "observation_source", target_id: targetId, metadata }).execute();
    const audience = await db.selectFrom("school_memberships").select("user_id").where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).execute();
    await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "institution.setup.updated", aggregate_type: "observation_source", aggregate_id: targetId,
      audience_user_ids: audience.map((item) => item.user_id), payload: { refresh: ["principal.administration"], action, ...metadata },
      idempotency_key: `institution-setup:${requestId ?? randomUUID()}:${action}:${targetId}` }).execute();
  }

  async createCampus(user: AuthUser, schoolId: string, body: unknown, request: Request) {
    const data = campusCreate.parse(body);
    const row = await this.db.transaction().execute(async (db) => { await this.requireAdmin(user, schoolId, db);
      const institution = await db.selectFrom("schools").select(["id", "name"]).where("id", "=", schoolId).executeTakeFirstOrThrow();
      const parent = data.parent_campus_id ? await this.campus(schoolId, data.parent_campus_id, db) : null;
      if (data.is_primary) await db.updateTable("institution_campuses").set({ is_primary: false, updated_by: user.id }).where("school_id", "=", schoolId).where("is_primary", "=", true).execute();
      const created = await db.insertInto("institution_campuses").values({ school_id: schoolId, ...data, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
      const campusRef = this.ref("campus_topology", created.id);
      const parentRef = parent ? this.ref("campus_topology", parent.id) : this.ref("institutions", institution.id);
      const entities = [this.institutionEntity(institution), this.campusEntity(created), ...(parent ? [this.campusEntity(parent)] : [])];
      await this.setupEvent(db, { schoolId, actorId: user.id, action: "campus.created", targetType: "institution_campus", targetId: created.id, metadata: { name: created.name }, requestId: request.requestId,
        model: { target: campusRef, entities, relationships: [this.setRelationship({ type: "part_of", source: campusRef, target: parentRef, effectiveFrom: this.time(created.created_at), sourceRecordId: created.id, sourceRevision: created.revision })], expectedRevision: 0, resultingRevision: created.revision, safeContext: { campus_code: created.code } } }); return created; });
    await this.externalAudit("institution.setup.campus.created", request, user, schoolId, "institution_campus", row.id); return row;
  }
  async updateCampus(user: AuthUser, schoolId: string, campusId: string, body: unknown, request: Request) {
    const data = campusUpdate.parse(body);
    const row = await this.db.transaction().execute(async (db) => { await this.requireAdmin(user, schoolId, db); const current = await this.campus(schoolId, campusId, db);
      const institution = await db.selectFrom("schools").select(["id", "name"]).where("id", "=", schoolId).executeTakeFirstOrThrow();
      const parent = data.parent_campus_id ? await this.campus(schoolId, data.parent_campus_id, db) : null;
      if (current.is_primary && (!data.is_primary || data.status === "inactive")) throw new ConflictException("Choose another primary campus before changing this one.");
      if (data.status === "inactive") { const usage = (await sql<{ used: boolean }>`SELECT EXISTS(SELECT 1 FROM class_campus_placements WHERE campus_id=${campusId}::uuid AND (effective_until IS NULL OR effective_until>=current_date) UNION ALL SELECT 1 FROM staff_campus_assignments WHERE campus_id=${campusId}::uuid AND (effective_until IS NULL OR effective_until>=current_date) UNION ALL SELECT 1 FROM campus_resource_holdings WHERE campus_id=${campusId}::uuid AND state<>'retired') AS used`.execute(db)).rows[0]?.used; if (usage) throw new ConflictException("Move current classes, staff and resources before inactivating this campus."); }
      if (data.is_primary && !current.is_primary) await db.updateTable("institution_campuses").set({ is_primary: false, updated_by: user.id }).where("school_id", "=", schoolId).where("is_primary", "=", true).execute();
      const { expected_revision, ...values } = data; const updated = await db.updateTable("institution_campuses").set({ ...values, updated_by: user.id }).where("id", "=", campusId).where("school_id", "=", schoolId).where("revision", "=", expected_revision).returningAll().executeTakeFirst();
      if (!updated) throw new ConflictException("Campus details changed. Refresh and review the latest version.");
      const campusRef = this.ref("campus_topology", updated.id);
      const parentRef = parent ? this.ref("campus_topology", parent.id) : this.ref("institutions", institution.id);
      const entities = [this.institutionEntity(institution), this.campusEntity(updated), ...(parent ? [this.campusEntity(parent)] : [])];
      await this.setupEvent(db, { schoolId, actorId: user.id, action: "campus.updated", targetType: "institution_campus", targetId: campusId, requestId: request.requestId,
        model: { target: campusRef, entities, relationships: [this.setRelationship({ type: "part_of", source: campusRef, target: parentRef, effectiveFrom: this.time(), sourceRecordId: updated.id, sourceRevision: updated.revision })], expectedRevision: expected_revision, resultingRevision: updated.revision, safeContext: { campus_code: updated.code } } }); return updated; });
    await this.externalAudit("institution.setup.campus.updated", request, user, schoolId, "institution_campus", campusId); return row;
  }

  async createSpace(user: AuthUser, schoolId: string, body: unknown, request: Request) { return this.saveSpace(user, schoolId, null, body, request); }
  async updateSpace(user: AuthUser, schoolId: string, id: string, body: unknown, request: Request) { return this.saveSpace(user, schoolId, id, body, request); }
  private async saveSpace(user: AuthUser, schoolId: string, id: string | null, body: unknown, request: Request) {
    const data = id ? spaceUpdate.parse(body) : spaceCreate.parse(body);
    const row = await this.db.transaction().execute(async (db) => { await this.requireAdmin(user, schoolId, db);
      const campus = await this.campus(schoolId, data.campus_id, db);
      const parent = data.parent_space_id ? await this.space(schoolId, data.campus_id, data.parent_space_id, db) : null;
      if (id && data.parent_space_id === id) throw new ConflictException("A space cannot contain itself.");
      const values = { campus_id: data.campus_id, parent_space_id: data.parent_space_id, name: data.name, code: data.code, kind: data.kind, capacity: data.capacity, is_accessible: data.is_accessible, is_bookable: data.is_bookable, status: data.status, updated_by: user.id };
      const saved = id ? await db.updateTable("campus_spaces").set(values).where("id", "=", id).where("school_id", "=", schoolId).where("revision", "=", (data as z.infer<typeof spaceUpdate>).expected_revision).returningAll().executeTakeFirst()
        : await db.insertInto("campus_spaces").values({ school_id: schoolId, ...values, created_by: user.id, attributes: {} }).returningAll().executeTakeFirst();
      if (!saved) throw new ConflictException(id ? "Space details changed. Refresh and review the latest version." : "Space could not be created.");
      const spaceRef = this.ref("campus_topology", saved.id);
      const parentRef = parent ? this.ref("campus_topology", parent.id) : this.ref("campus_topology", campus.id);
      const entities = [this.spaceEntity(saved), this.campusEntity(campus), ...(parent ? [this.spaceEntity(parent)] : [])];
      await this.setupEvent(db, { schoolId, actorId: user.id, action: id ? "space.updated" : "space.created", targetType: "campus_space", targetId: saved.id, requestId: request.requestId,
        model: { target: spaceRef, entities, relationships: [this.setRelationship({ type: "part_of", source: spaceRef, target: parentRef, effectiveFrom: this.time(id ? undefined : saved.created_at), sourceRecordId: saved.id, sourceRevision: saved.revision })], expectedRevision: id ? (data as z.infer<typeof spaceUpdate>).expected_revision : 0, resultingRevision: saved.revision, safeContext: { space_kind: saved.kind, campus_id: saved.campus_id } } }); return saved; });
    await this.externalAudit(`institution.setup.space.${id ? "updated" : "created"}`, request, user, schoolId, "campus_space", row.id); return row;
  }

  async createResourceType(user: AuthUser, schoolId: string, body: unknown, request: Request) { return this.saveResourceType(user, schoolId, null, body, request); }
  async updateResourceType(user: AuthUser, schoolId: string, id: string, body: unknown, request: Request) { return this.saveResourceType(user, schoolId, id, body, request); }
  private async saveResourceType(user: AuthUser, schoolId: string, id: string | null, body: unknown, request: Request) {
    const data = id ? typeUpdate.parse(body) : typeCreate.parse(body);
    const expected: number | undefined = "expected_revision" in data ? Number(data.expected_revision) : undefined;
    const values = { code: data.code, name: data.name, category: data.category, tracking_mode: data.tracking_mode, unit_label: data.unit_label, is_active: data.is_active };
    const row = await this.db.transaction().execute(async (db) => { await this.requireAdmin(user, schoolId, db);
      const institution = await db.selectFrom("schools").select(["id", "name"]).where("id", "=", schoolId).executeTakeFirstOrThrow();
      const saved = id ? await db.updateTable("campus_resource_types").set({ ...values, updated_by: user.id }).where("id", "=", id).where("school_id", "=", schoolId).where("revision", "=", expected!).returningAll().executeTakeFirst()
        : await db.insertInto("campus_resource_types").values({ school_id: schoolId, ...values, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirst();
      if (!saved) throw new ConflictException(id ? "Resource type changed. Refresh and review the latest version." : "Resource type could not be created.");
      const typeRef = this.ref("campus_topology", saved.id);
      const institutionRef = this.ref("institutions", institution.id);
      await this.setupEvent(db, { schoolId, actorId: user.id, action: id ? "resource_type.updated" : "resource_type.created", targetType: "campus_resource_type", targetId: saved.id, requestId: request.requestId,
        model: { target: typeRef, entities: [this.institutionEntity(institution), this.resourceTypeEntity(saved)], relationships: [this.setRelationship({ type: "defined_by", source: typeRef, target: institutionRef, effectiveFrom: this.time(id ? undefined : saved.created_at), sourceRecordId: saved.id, sourceRevision: saved.revision })], expectedRevision: id ? expected ?? null : 0, resultingRevision: saved.revision, safeContext: { category: saved.category, tracking_mode: saved.tracking_mode } } }); return saved; });
    await this.externalAudit(`institution.setup.resource_type.${id ? "updated" : "created"}`, request, user, schoolId, "campus_resource_type", row.id); return row;
  }

  async createAsset(user: AuthUser, schoolId: string, body: unknown, request: Request) { return this.saveHolding(user, schoolId, null, body, request); }
  async updateAsset(user: AuthUser, schoolId: string, id: string, body: unknown, request: Request) { return this.saveHolding(user, schoolId, id, body, request); }
  private async saveHolding(user: AuthUser, schoolId: string, id: string | null, body: unknown, request: Request) {
    const data = id ? holdingUpdate.parse(body) : holdingCreate.parse(body);
    const expected: number | undefined = "expected_revision" in data ? Number(data.expected_revision) : undefined;
    const values = { campus_id: data.campus_id, space_id: data.space_id, resource_type_id: data.resource_type_id, name: data.name, quantity: data.quantity, asset_tag: data.asset_tag, state: data.state, notes: data.notes };
    const row = await this.db.transaction().execute(async (db) => { await this.requireAdmin(user, schoolId, db);
      const campus = await this.campus(schoolId, data.campus_id, db);
      const space = data.space_id ? await this.space(schoolId, data.campus_id, data.space_id, db) : null;
      const kind = await db.selectFrom("campus_resource_types").selectAll().where("id", "=", data.resource_type_id).where("school_id", "=", schoolId).executeTakeFirst(); if (!kind) throw new NotFoundException("Resource type not found in this institution.");
      if (kind.tracking_mode === "individual" && (data.quantity !== 1 || !data.asset_tag)) throw new BadRequestException("Individually tracked resources need quantity one and an asset tag.");
      if (kind.tracking_mode === "pooled" && data.asset_tag) throw new BadRequestException("Pooled resources use a quantity, not an individual asset tag.");
      const saved = id ? await db.updateTable("campus_resource_holdings").set({ ...values, updated_by: user.id }).where("id", "=", id).where("school_id", "=", schoolId).where("revision", "=", expected!).returningAll().executeTakeFirst()
        : await db.insertInto("campus_resource_holdings").values({ school_id: schoolId, ...values, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirst();
      if (!saved) throw new ConflictException(id ? "Resource holding changed. Refresh and review the latest version." : "Resource holding could not be created.");
      const holdingRef = this.ref("campus_topology", saved.id);
      const typeRef = this.ref("campus_topology", kind.id);
      const locationRef = this.ref("campus_topology", space?.id ?? campus.id);
      const effectiveFrom = this.time(id ? undefined : saved.created_at);
      await this.setupEvent(db, { schoolId, actorId: user.id, action: id ? "resource.updated" : "resource.created", targetType: "campus_resource_holding", targetId: saved.id, requestId: request.requestId,
        model: { target: holdingRef, entities: [this.holdingEntity(saved), this.resourceTypeEntity(kind), this.campusEntity(campus), ...(space ? [this.spaceEntity(space)] : [])], relationships: [
          this.setRelationship({ type: "instance_of", source: holdingRef, target: typeRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
          this.setRelationship({ type: "located_in", source: holdingRef, target: locationRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
        ], expectedRevision: id ? expected ?? null : 0, resultingRevision: saved.revision, safeContext: { campus_id: saved.campus_id, space_id: saved.space_id, resource_type_id: saved.resource_type_id } } }); return saved; });
    await this.externalAudit(`institution.setup.resource.${id ? "updated" : "created"}`, request, user, schoolId, "campus_resource_holding", row.id); return row;
  }

  async placeClass(user: AuthUser, schoolId: string, classId: string, body: unknown, request: Request) {
    const data = placement.parse(body); const row = await this.db.transaction().execute(async (db) => { await this.requireAdmin(user, schoolId, db);
      const campus = await this.campus(schoolId, data.campus_id, db);
      const space = data.home_space_id ? await this.space(schoolId, data.campus_id, data.home_space_id, db) : null;
      const section = await db.selectFrom("class_sections").select(["id", "grade", "section", "revision"]).where("id", "=", classId).where("school_id", "=", schoolId).executeTakeFirst(); if (!section) throw new NotFoundException("Class not found in this institution.");
      const current = await db.selectFrom("class_campus_placements").selectAll().where("class_section_id", "=", classId).where("is_primary", "=", true).where("effective_from", "<=", data.effective_from).where((eb) => eb.or([eb("effective_until", "is", null), eb("effective_until", ">=", data.effective_from)])).forUpdate().executeTakeFirst();
      if ((current?.revision ?? null) !== data.expected_current_revision) throw new ConflictException("Class placement changed. Refresh and review the latest version.");
      if (current && current.effective_from >= data.effective_from) throw new ConflictException("Choose a date after the current placement began.");
      if (current) await db.updateTable("class_campus_placements").set({ effective_until: sql<string>`${data.effective_from}::date-1`, assigned_by: user.id }).where("id", "=", current.id).where("revision", "=", current.revision).execute();
      const saved = await db.insertInto("class_campus_placements").values({ school_id: schoolId, class_section_id: classId, campus_id: data.campus_id, home_space_id: data.home_space_id ?? null, is_primary: true, effective_from: data.effective_from, effective_until: null, assigned_by: user.id }).returningAll().executeTakeFirstOrThrow();
      const classRef = this.ref("academic_structure", section.id);
      const campusRef = this.ref("campus_topology", campus.id);
      const effectiveFrom = this.time(`${data.effective_from}T00:00:00.000Z`);
      const relationships = [
        this.setRelationship({ type: "located_in", source: classRef, target: campusRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
        space
          ? this.setRelationship({ type: "home_space", source: classRef, target: this.ref("campus_topology", space.id), effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision })
          : this.clearRelationship({ type: "home_space", source: classRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
      ];
      await this.setupEvent(db, { schoolId, actorId: user.id, action: "class.placement.updated", targetType: "class_section", targetId: classId, metadata: { campus_id: data.campus_id, effective_from: data.effective_from }, requestId: request.requestId,
        model: { target: classRef, entities: [this.classEntity(section), this.campusEntity(campus), ...(space ? [this.spaceEntity(space)] : [])], relationships, expectedRevision: data.expected_current_revision, resultingRevision: saved.revision, safeContext: { campus_id: data.campus_id, home_space_id: data.home_space_id ?? null, effective_from: data.effective_from } } }); return saved; });
    await this.externalAudit("institution.setup.class_placement.updated", request, user, schoolId, "class_section", classId); return row;
  }
  async placeStaff(user: AuthUser, schoolId: string, staffId: string, body: unknown, request: Request) {
    const data = staffPlacement.parse(body); const row = await this.db.transaction().execute(async (db) => { await this.requireAdmin(user, schoolId, db);
      const campus = await this.campus(schoolId, data.campus_id, db);
      const profile = await db.selectFrom("staff_profiles").select(["id", "first_name", "last_name", "status", "revision"]).where("id", "=", staffId).where("school_id", "=", schoolId).executeTakeFirst(); if (!profile) throw new NotFoundException("Staff member not found in this institution.");
      const current = await db.selectFrom("staff_campus_assignments").selectAll().where("staff_profile_id", "=", staffId).where("is_primary", "=", true).where("effective_from", "<=", data.effective_from).where((eb) => eb.or([eb("effective_until", "is", null), eb("effective_until", ">=", data.effective_from)])).forUpdate().executeTakeFirst();
      if ((current?.revision ?? null) !== data.expected_current_revision) throw new ConflictException("Staff campus assignment changed. Refresh and review the latest version.");
      if (current && current.effective_from >= data.effective_from) throw new ConflictException("Choose a date after the current assignment began.");
      if (current) await db.updateTable("staff_campus_assignments").set({ effective_until: sql<string>`${data.effective_from}::date-1`, assigned_by: user.id }).where("id", "=", current.id).where("revision", "=", current.revision).execute();
      const saved = await db.insertInto("staff_campus_assignments").values({ school_id: schoolId, staff_profile_id: staffId, campus_id: data.campus_id, is_primary: true, effective_from: data.effective_from, effective_until: null, assigned_by: user.id }).returningAll().executeTakeFirstOrThrow();
      const staffRef = this.ref("people", profile.id);
      const campusRef = this.ref("campus_topology", campus.id);
      await this.setupEvent(db, { schoolId, actorId: user.id, action: "staff.placement.updated", targetType: "staff_profile", targetId: staffId, metadata: { campus_id: data.campus_id, effective_from: data.effective_from }, requestId: request.requestId,
        model: { target: staffRef, entities: [this.staffEntity(profile), this.campusEntity(campus)], relationships: [this.setRelationship({ type: "assigned_to", source: staffRef, target: campusRef, effectiveFrom: this.time(`${data.effective_from}T00:00:00.000Z`), sourceRecordId: saved.id, sourceRevision: saved.revision })], expectedRevision: data.expected_current_revision, resultingRevision: saved.revision, safeContext: { campus_id: data.campus_id, effective_from: data.effective_from } } }); return saved; });
    await this.externalAudit("institution.setup.staff_placement.updated", request, user, schoolId, "staff_profile", staffId); return row;
  }
}
