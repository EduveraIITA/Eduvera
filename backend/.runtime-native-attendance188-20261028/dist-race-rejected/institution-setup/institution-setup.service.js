var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { CAMPUS_MODEL_CORE_PORT } from "../campus-model-core/campus-model-core.port.js";
import { OBSERVATION_SOURCE_REGISTRY_PORT } from "../campus-model-core/observation-source-registry.port.js";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { acceptedChangeProjectionHash } from "../campus-model-core/accepted-change-command.binding.js";
import { DatabaseService } from "../database/database.service.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT } from "../campus-model-core/domain-command-receipt-read.port.js";
import { institutionSchoolPermission } from "../roles/authorization.js";
import { lockCampusSpaceUse } from "../common/campus-space-use.js";
import { lendingItemInput, lendingItemPayloadHash, lendingCopyIds, lendingCopyTags } from './lending-item.contracts.js';
const uuid = z.string().uuid();
const text = (max) => z.string().trim().max(max).default("");
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
    kind: z.enum(["hostel", "residential_room", "building", "wing", "floor", "classroom", "laboratory", "library", "office", "auditorium", "sports_area", "workshop", "staff_room", "gate", "outdoor_area", "virtual", "other"]),
    capacity: z.number().int().positive().max(100000).nullable().default(null),
    is_accessible: z.boolean().default(false), is_bookable: z.boolean().default(true),
    status: z.enum(["active", "inactive"]).default("active"),
};
const spaceCreate = z.object(spaceFields).strict();
const quickSpaceCreate = z.object({ ...spaceFields, campus_id: uuid.optional(),
    create_campus_if_missing: z.literal(true), idempotency_key: uuid }).strict();
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
    if (value.scope_type !== "institution" && !value.scope_id)
        context.addIssue({ code: "custom", path: ["scope_id"], message: "Choose the campus or space this source can observe." });
});
const sourceState = z.object({ status: z.enum(["active", "suspended", "revoked"]), expected_revision: z.number().int().positive() }).strict();
let InstitutionSetupService = class InstitutionSetupService {
    db;
    audit;
    campusModel;
    observationSources;
    commands;
    identities;
    commandReceipts;
    constructor(db, audit, campusModel, observationSources, commands, identities, commandReceipts) {
        this.db = db;
        this.audit = audit;
        this.campusModel = campusModel;
        this.observationSources = observationSources;
        this.commands = commands;
        this.identities = identities;
        this.commandReceipts = commandReceipts;
    }
    async requireAdmin(user, schoolId, db = this.db) {
        const member = await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId)
            .where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
        if (!member)
            throw new ForbiddenException("An active institution administrator membership is required.");
    }
    async campus(schoolId, id, db = this.db) {
        const row = await db.selectFrom("institution_campuses").selectAll().where("school_id", "=", schoolId).where("id", "=", id).executeTakeFirst();
        if (!row)
            throw new NotFoundException("Campus not found in this institution.");
        return row;
    }
    async space(schoolId, campusId, id, db = this.db) {
        const row = await db.selectFrom("campus_spaces").selectAll().where("school_id", "=", schoolId).where("campus_id", "=", campusId).where("id", "=", id).executeTakeFirst();
        if (!row)
            throw new NotFoundException("Space not found in the selected campus.");
        return row;
    }
    acceptedChange(input, eventId) {
        return {
            ...(input.prepared ? { prepared_command_id: input.prepared.command_id, prepared_request_hash: input.prepared.request_hash } : {}),
            school_id: input.schoolId, actor_user_id: input.actorId, command_type: input.action,
            target: input.model.target, idempotency_key: input.commandKey ?? `campus-model:${eventId}`,
            correlation_id: input.requestId ?? randomUUID(), causation_id: null,
            expected_revision: input.model.expectedRevision ?? null, authority_evidence: input.authorityEvidence ?? ["active_institution_administrator"],
            operating_rule_version_ref: null, source_domain: "campus_topology", safe_context: input.model.safeContext ?? {},
            entities: input.model.entities, relationships: input.model.relationships ?? [],
            outcome: { code: input.outcomeCode ?? input.action, explanation: "The institution setup change was accepted.",
                resulting_revision: input.model.resultingRevision ?? null, metadata: input.outcomeMetadata ?? {} }, domain_event_id: eventId,
        };
    }
    async setupEvent(db, input) {
        await db.insertInto("institution_setup_audits").values({ school_id: input.schoolId, actor_id: input.actorId, action: input.action, target_type: input.targetType, target_id: input.targetId, metadata: { ...input.metadata, ...input.auditMetadata } }).execute();
        const audience = await db.selectFrom("school_memberships").select("user_id").where("school_id", "=", input.schoolId).where("role", "=", "admin").where("is_active", "=", true).execute();
        const event = await db.insertInto("event_outbox").values({ ...(input.eventId ? { id: input.eventId } : {}), school_id: input.schoolId, event_type: "institution.setup.updated", aggregate_type: input.targetType, aggregate_id: input.targetId,
            audience_user_ids: audience.map((item) => item.user_id), payload: { refresh: ["principal.administration"], action: input.action, ...input.metadata },
            idempotency_key: `institution-setup:${input.requestId ?? randomUUID()}:${input.action}:${input.targetId}` }).returning("id").executeTakeFirstOrThrow();
        await this.campusModel.recordAcceptedChange(db, this.acceptedChange(input, event.id));
    }
    entity(input) { return input; }
    ref(domain, domainId) { return { domain, domain_id: domainId }; }
    relationship(input) { return input; }
    time(value = executionNow()) {
        return new Date(value ?? executionNow().getTime()).toISOString();
    }
    async placementInstant(db, date, timezone) {
        const boundary = (await sql `SELECT ${date}::date::timestamp AT TIME ZONE ${timezone} AS instant`.execute(db)).rows[0];
        return boundary.instant.toISOString();
    }
    institutionEntity(row) {
        return this.entity({ kind: "institution", domain: "institutions", domain_id: row.id, label: row.name, lifecycle_state: "active", source_revision: 1, metadata: {} });
    }
    campusEntity(row) {
        return this.entity({ kind: "campus", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.status, source_revision: row.revision, metadata: {} });
    }
    spaceEntity(row) {
        return this.entity({ kind: "space", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.status, source_revision: row.revision, metadata: { space_kind: row.kind } });
    }
    resourceTypeEntity(row) {
        return this.entity({ kind: "resource_type", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.is_active ? "active" : "inactive", source_revision: row.revision, metadata: { category: row.category } });
    }
    holdingEntity(row) {
        return this.entity({ kind: "resource", domain: "campus_topology", domain_id: row.id, label: row.name, lifecycle_state: row.state === "retired" ? "retired" : "active", source_revision: row.revision, metadata: { availability: row.state } });
    }
    classEntity(row) {
        return this.entity({ kind: "class", domain: "academic_structure", domain_id: row.id, label: `Class ${row.grade}${row.section}`, lifecycle_state: "active", source_revision: row.revision, metadata: {} });
    }
    staffEntity(row) {
        return this.entity({ kind: "staff", domain: "people", domain_id: row.id, label: `${row.first_name} ${row.last_name}`.trim(), lifecycle_state: row.status === "inactive" ? "inactive" : "active", source_revision: row.revision, metadata: {} });
    }
    setRelationship(input) {
        return this.relationship({ relation_type: input.type, source: input.source, target: input.target,
            operation: "set", effective_from: input.effectiveFrom, effective_until: null,
            source_domain: "campus_topology", source_record_id: input.sourceRecordId,
            source_revision: input.sourceRevision, replace_current: true, metadata: input.metadata ?? {} });
    }
    clearRelationship(input) {
        return this.relationship({ relation_type: input.type, source: input.source, target: null,
            operation: "clear", effective_from: input.effectiveFrom, effective_until: null,
            source_domain: "campus_topology", source_record_id: input.sourceRecordId,
            source_revision: input.sourceRevision, replace_current: true, metadata: {} });
    }
    async externalAudit(action, request, user, schoolId, targetType, targetId) {
        await this.audit.record({ action, request, actorId: user.id, schoolId, targetType, targetId });
    }
    async workspace(user, schoolId) {
        await this.requireAdmin(user, schoolId);
        const school = await this.db.selectFrom("schools").select(["id", "name", "code", "timezone", "institution_kind"]).where("id", "=", schoolId).executeTakeFirst();
        if (!school)
            throw new NotFoundException("Institution not found.");
        const [campuses, spaces, resourceTypes, holdings, classes, staff, history, activity, signals, observationSources] = await Promise.all([
            this.db.selectFrom("institution_campuses").selectAll().where("school_id", "=", schoolId).orderBy("is_primary", "desc").orderBy("name").execute(),
            this.db.selectFrom("campus_spaces").selectAll().where("school_id", "=", schoolId).orderBy("name").execute(),
            this.db.selectFrom("campus_resource_types").selectAll().where("school_id", "=", schoolId).orderBy("name").execute(),
            this.db.selectFrom("campus_resource_holdings as holding").innerJoin("campus_resource_types as type", "type.id", "holding.resource_type_id")
                .select(["holding.id", "holding.school_id", "holding.campus_id", "holding.space_id", "holding.resource_type_id", "holding.name", "holding.quantity", "holding.asset_tag", "holding.state", "holding.notes", "holding.revision", "type.name as resource_type_name", "type.category", "type.tracking_mode", "type.unit_label"])
                .where("holding.school_id", "=", schoolId).orderBy("holding.name").execute(),
            sql `SELECT section.id,section.grade,section.section,section.academic_year,section.revision AS class_revision,
          placement.id AS placement_id,placement.campus_id,placement.home_space_id,placement.revision AS placement_revision,
          placement.effective_from,placement.effective_until,space.name AS home_space_name
        FROM class_sections section LEFT JOIN LATERAL (
          SELECT placement.* FROM class_campus_placements placement JOIN institution_campuses campus ON campus.id=placement.campus_id AND campus.school_id=placement.school_id
          WHERE placement.class_section_id=section.id AND placement.school_id=section.school_id AND placement.is_primary
            AND placement.effective_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
            AND (placement.effective_until IS NULL OR placement.effective_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date)
          ORDER BY placement.effective_from DESC,placement.id LIMIT 1
        ) placement ON true
        LEFT JOIN campus_spaces space ON space.id=placement.home_space_id
        WHERE section.school_id=${schoolId}::uuid ORDER BY section.grade,section.section`.execute(this.db).then((result) => result.rows),
            sql `SELECT profile.id,person.first_name,person.last_name,profile.staff_code,profile.designation,profile.status,
          assignment.id AS assignment_id,assignment.campus_id,assignment.revision AS assignment_revision,
          assignment.effective_from,assignment.effective_until
        FROM staff_profiles profile JOIN school_people person ON person.id=profile.person_id AND person.school_id=profile.school_id LEFT JOIN LATERAL (
          SELECT assignment.* FROM staff_campus_assignments assignment JOIN institution_campuses campus ON campus.id=assignment.campus_id AND campus.school_id=assignment.school_id
          WHERE assignment.staff_profile_id=profile.id AND assignment.school_id=profile.school_id AND assignment.is_primary
            AND assignment.effective_from<=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date
            AND (assignment.effective_until IS NULL OR assignment.effective_until>=(${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date)
          ORDER BY assignment.effective_from DESC,assignment.id LIMIT 1
        ) assignment ON true
        WHERE profile.school_id=${schoolId}::uuid ORDER BY person.first_name,person.last_name`.execute(this.db).then((result) => result.rows),
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
    async registerObservationSource(user, schoolId, body, request) {
        const data = sourceCreate.parse(body);
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            let scope = null;
            if (data.scope_type === "campus") {
                await this.campus(schoolId, data.scope_id, db);
                scope = { domain: "campus_topology", domain_id: data.scope_id };
            }
            if (data.scope_type === "space") {
                const item = await db.selectFrom("campus_spaces").select(["id", "campus_id"]).where("school_id", "=", schoolId).where("id", "=", data.scope_id).executeTakeFirst();
                if (!item)
                    throw new NotFoundException("Space not found in this institution.");
                scope = { domain: "campus_topology", domain_id: item.id };
            }
            const rule = (await sql `SELECT revision FROM institution_operating_rules WHERE school_id=${schoolId}::uuid`.execute(db)).rows[0];
            const created = await this.observationSources.registerObservationSource(db, { school_id: schoolId, actor_user_id: user.id,
                kind: data.kind, external_ref: data.external_ref, label: data.label, capabilities: data.capabilities,
                scope, operating_rule_version_ref: rule ? `institution-operating-rules:${rule.revision}` : null });
            await this.sourceLifecycleEvent(db, schoolId, user.id, "observation_source.registered", created.id, request.requestId, { label: created.label, status: created.status });
            return created;
        });
        await this.externalAudit("institution.setup.observation_source.registered", request, user, schoolId, "observation_source", row.id);
        return row;
    }
    async setObservationSourceStatus(user, schoolId, sourceId, body, request) {
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
    async sourceLifecycleEvent(db, schoolId, actorId, action, targetId, requestId, metadata) {
        await db.insertInto("institution_setup_audits").values({ school_id: schoolId, actor_id: actorId, action, target_type: "observation_source", target_id: targetId, metadata }).execute();
        const audience = await db.selectFrom("school_memberships").select("user_id").where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).execute();
        await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "institution.setup.updated", aggregate_type: "observation_source", aggregate_id: targetId,
            audience_user_ids: audience.map((item) => item.user_id), payload: { refresh: ["principal.administration"], action, ...metadata },
            idempotency_key: `institution-setup:${requestId ?? randomUUID()}:${action}:${targetId}` }).execute();
    }
    async createCampus(user, schoolId, body, request) {
        const data = campusCreate.parse(body);
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            const institution = await db.selectFrom("schools").select(["id", "name"]).where("id", "=", schoolId).executeTakeFirstOrThrow();
            const parent = data.parent_campus_id ? await this.campus(schoolId, data.parent_campus_id, db) : null;
            if (data.is_primary)
                await db.updateTable("institution_campuses").set({ is_primary: false, updated_by: user.id }).where("school_id", "=", schoolId).where("is_primary", "=", true).execute();
            const created = await db.insertInto("institution_campuses").values({ school_id: schoolId, ...data, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
            const campusRef = this.ref("campus_topology", created.id);
            const parentRef = parent ? this.ref("campus_topology", parent.id) : this.ref("institutions", institution.id);
            const entities = [this.institutionEntity(institution), this.campusEntity(created), ...(parent ? [this.campusEntity(parent)] : [])];
            await this.setupEvent(db, { schoolId, actorId: user.id, action: "campus.created", targetType: "institution_campus", targetId: created.id, metadata: { name: created.name }, requestId: request.requestId,
                model: { target: campusRef, entities, relationships: [this.setRelationship({ type: "part_of", source: campusRef, target: parentRef, effectiveFrom: this.time(created.created_at), sourceRecordId: created.id, sourceRevision: created.revision })], expectedRevision: 0, resultingRevision: created.revision, safeContext: { campus_code: created.code } } });
            return created;
        });
        await this.externalAudit("institution.setup.campus.created", request, user, schoolId, "institution_campus", row.id);
        return row;
    }
    async updateCampus(user, schoolId, campusId, body, request) {
        const data = campusUpdate.parse(body);
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            await lockCampusSpaceUse(db, schoolId);
            const current = await this.campus(schoolId, campusId, db);
            const institution = await db.selectFrom("schools").select(["id", "name"]).where("id", "=", schoolId).executeTakeFirstOrThrow();
            const parent = data.parent_campus_id ? await this.campus(schoolId, data.parent_campus_id, db) : null;
            if (current.is_primary && (!data.is_primary || data.status === "inactive"))
                throw new ConflictException("Choose another primary campus before changing this one.");
            if (data.status === "inactive") {
                const usage = (await sql `SELECT EXISTS(SELECT 1 FROM class_campus_placements WHERE campus_id=${campusId}::uuid AND (effective_until IS NULL OR effective_until>=(${executionNow()}::timestamptz AT TIME ZONE ${current.timezone})::date) UNION ALL SELECT 1 FROM staff_campus_assignments WHERE campus_id=${campusId}::uuid AND (effective_until IS NULL OR effective_until>=(${executionNow()}::timestamptz AT TIME ZONE ${current.timezone})::date) UNION ALL SELECT 1 FROM campus_resource_holdings WHERE campus_id=${campusId}::uuid AND state<>'retired') AS used`.execute(db)).rows[0]?.used;
                if (usage)
                    throw new ConflictException("Move current classes, staff and resources before inactivating this campus.");
            }
            if (data.is_primary && !current.is_primary)
                await db.updateTable("institution_campuses").set({ is_primary: false, updated_by: user.id }).where("school_id", "=", schoolId).where("is_primary", "=", true).execute();
            const { expected_revision, ...values } = data;
            const updated = await db.updateTable("institution_campuses").set({ ...values, updated_by: user.id }).where("id", "=", campusId).where("school_id", "=", schoolId).where("revision", "=", expected_revision).returningAll().executeTakeFirst();
            if (!updated)
                throw new ConflictException("Campus details changed. Refresh and review the latest version.");
            const campusRef = this.ref("campus_topology", updated.id);
            const parentRef = parent ? this.ref("campus_topology", parent.id) : this.ref("institutions", institution.id);
            const entities = [this.institutionEntity(institution), this.campusEntity(updated), ...(parent ? [this.campusEntity(parent)] : [])];
            await this.setupEvent(db, { schoolId, actorId: user.id, action: "campus.updated", targetType: "institution_campus", targetId: campusId, requestId: request.requestId,
                model: { target: campusRef, entities, relationships: [this.setRelationship({ type: "part_of", source: campusRef, target: parentRef, effectiveFrom: this.time(), sourceRecordId: updated.id, sourceRevision: updated.revision })], expectedRevision: expected_revision, resultingRevision: updated.revision, safeContext: { campus_code: updated.code } } });
            return updated;
        });
        await this.externalAudit("institution.setup.campus.updated", request, user, schoolId, "institution_campus", campusId);
        return row;
    }
    async createSpace(user, schoolId, body, request) {
        if (body && typeof body === "object" && "create_campus_if_missing" in body)
            return this.quickCreateSpace(user, schoolId, body, request);
        return this.saveSpace(user, schoolId, null, body, request);
    }
    /** The same canonical place command, with an explicit first-campus convenience. Nothing is created on signup or skip. */
    async quickCreateSpace(user, schoolId, body, request) {
        const outcome = await this.db.transaction().execute(db => this.createSpaceInTransaction(db, user, schoolId, body, request)).catch((error) => {
            // A legacy setup writer may race this command without taking the school lock.
            if (error && typeof error === "object" && "code" in error && error.code === "23505"
                && "constraint" in error && error.constraint === "campus_spaces_campus_id_code_key") {
                throw new ConflictException({ code: "campus_place_code_conflict", message: "A place with this code already exists on this campus. Choose the existing place or use another code." });
            }
            throw error;
        });
        if (!outcome.replayed)
            await this.externalAudit("institution.setup.space.created", request, user, schoolId, "campus_space", String(outcome.row.id));
        return outcome.row;
    }
    /** Transaction seam for the reviewed scene batch. This remains the native place command and audit writer. */
    async createSpaceInTransaction(db, user, schoolId, body, request) {
        const data = quickSpaceCreate.parse(body);
        const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
        const institution = await this.lockPlaceCreationContext(db, user, schoolId);
        const retained = (await sql `SELECT metadata FROM institution_setup_audits
      WHERE school_id=${schoolId}::uuid AND actor_id=${user.id}::uuid AND action='space.created'
        AND metadata->>'idempotency_key'=${data.idempotency_key} LIMIT 1`.execute(db)).rows[0];
        if (retained) {
            if (retained.metadata.request_hash !== requestHash)
                throw new ConflictException("This place save key belongs to different details. Review the place and try again.");
            return { row: retained.metadata.result, replayed: true };
        }
        const activeCampuses = await db.selectFrom("institution_campuses").selectAll().where("school_id", "=", schoolId).where("status", "=", "active").orderBy("is_primary", "desc").orderBy("id").execute();
        if (!data.campus_id && activeCampuses.length > 1)
            throw new BadRequestException("Choose which campus contains this place.");
        const existingCampus = data.campus_id ? await this.campus(schoolId, data.campus_id, db) : activeCampuses[0];
        if (existingCampus && existingCampus.status !== "active")
            throw new BadRequestException("Choose an active campus for this place.");
        const now = executionNow().toISOString();
        const campusId = existingCampus?.id ?? randomUUID();
        const campus = existingCampus ?? { id: campusId, name: institution.name, status: "active", revision: 1 };
        const parent = data.parent_space_id ? await this.space(schoolId, campusId, data.parent_space_id, db) : null;
        const duplicate = await db.selectFrom("campus_spaces").select("id").where("school_id", "=", schoolId).where("campus_id", "=", campusId).where("code", "=", data.code).executeTakeFirst();
        if (duplicate)
            throw new ConflictException({ code: "campus_place_code_conflict", message: "A place with this code already exists on this campus. Choose the existing place or use another code." });
        const id = randomUUID();
        const eventId = randomUUID();
        const correlationId = request.requestId ?? randomUUID();
        const space = { id, name: data.name, kind: data.kind, status: data.status, revision: 1 };
        const spaceRef = this.ref("campus_topology", id);
        const campusRef = this.ref("campus_topology", campusId);
        const commandKey = `campus-place:${user.id}:${data.idempotency_key}`;
        const model = { target: spaceRef,
            entities: [this.spaceEntity(space), this.campusEntity(campus), ...(parent ? [this.spaceEntity(parent)] : []), ...(!existingCampus ? [this.institutionEntity(institution)] : [])],
            relationships: [this.setRelationship({ type: "part_of", source: spaceRef, target: parent ? this.ref("campus_topology", parent.id) : campusRef,
                    effectiveFrom: now, sourceRecordId: id, sourceRevision: 1 }), ...(!existingCampus ? [this.setRelationship({ type: "part_of", source: campusRef,
                        target: this.ref("institutions", institution.id), effectiveFrom: now, sourceRecordId: campusId, sourceRevision: 1 })] : [])],
            expectedRevision: 0, resultingRevision: 1, safeContext: { space_kind: data.kind, campus_id: campusId, created_first_campus: !existingCampus },
        };
        const eventInput = { schoolId, actorId: user.id, action: "space.created", targetType: "campus_space", targetId: id,
            metadata: { name: data.name, campus_id: campusId, created_first_campus: !existingCampus }, requestId: correlationId, model, eventId, commandKey, outcomeCode: "space_created" };
        const prepared = await this.commands.prepareDomainCommand(db, {
            school_id: schoolId, actor_user_id: user.id, command_type: "space.created", handler_key: "campus_topology.space.create", handler_version: 1,
            source_domain: "campus_topology", target: this.spaceEntity(space), current_revision: 0, expected_revision: 0,
            capability: "campus_topology:manage", purpose: "create_canonical_campus_place", requested_at: now, correlation_id: correlationId,
            causation_id: null, idempotency_key: commandKey, operating_rule_version_ref: null, configuration_refs: [],
            authority_attestation: { evaluator_domain: "campus_topology", decision: "allowed", reason_codes: ["active_institution_administrator"],
                authority_source_refs: [{ school_id: schoolId, membership: "active_admin" }], operating_rule_refs: [], valid_until: null },
            safe_context: { ...model.safeContext, accepted_change_hash: acceptedChangeProjectionHash(this.acceptedChange(eventInput, eventId)) },
        });
        if (prepared.status !== "ready")
            throw new ConflictException("This place command has completed without its retained result. Refresh the campus places.");
        if (!existingCampus) {
            const primary = await db.selectFrom("institution_campuses").select("id").where("school_id", "=", schoolId).where("is_primary", "=", true).executeTakeFirst();
            if (primary)
                throw new ConflictException("The primary campus is inactive. Reactivate it or choose an active campus before adding a place.");
            const mainCode = await db.selectFrom("institution_campuses").select("id").where("school_id", "=", schoolId).where("code", "=", "MAIN").executeTakeFirst();
            await db.insertInto("institution_campuses").values({ id: campusId, school_id: schoolId, name: institution.name,
                code: mainCode ? `MAIN-${campusId.slice(0, 8).toUpperCase()}` : "MAIN", campus_type: "main", status: "active", is_primary: true,
                timezone: institution.timezone, created_by: user.id, updated_by: user.id, created_at: new Date(now), updated_at: new Date(now) }).execute();
        }
        const saved = await db.insertInto("campus_spaces").values({ id, school_id: schoolId, campus_id: campusId, parent_space_id: data.parent_space_id,
            name: data.name, code: data.code, kind: data.kind, capacity: data.capacity, is_accessible: data.is_accessible, is_bookable: data.is_bookable,
            status: data.status, created_by: user.id, updated_by: user.id, attributes: {}, created_at: new Date(now), updated_at: new Date(now) }).returningAll().executeTakeFirstOrThrow();
        const row = JSON.parse(JSON.stringify(saved));
        await this.setupEvent(db, { ...eventInput, prepared, auditMetadata: { idempotency_key: data.idempotency_key, request_hash: requestHash, result: row } });
        return { row, replayed: false };
    }
    /** Shared lock order for individual and reviewed-batch place commands. No authority is supplied by the caller. */
    async lockPlaceCreationContext(db, user, schoolId) {
        await this.requireAdmin(user, schoolId, db);
        if (!user.is_active || user.active_school_id !== schoolId)
            throw new ForbiddenException("Select this institution before creating a place.");
        const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new ForbiddenException("An active campus person identity is required to create a place.");
        await lockCampusSpaceUse(db, schoolId);
        // Serialize place creators while remaining compatible with the school FK
        // KEY SHARE locks taken by an ordinary scene command holding its scene lock.
        return db.selectFrom("schools").select(["id", "name", "timezone"]).where("id", "=", schoolId).forNoKeyUpdate().executeTakeFirstOrThrow();
    }
    async updateSpace(user, schoolId, id, body, request) { return this.saveSpace(user, schoolId, id, body, request); }
    async saveSpace(user, schoolId, id, body, request) {
        const data = id ? spaceUpdate.parse(body) : spaceCreate.parse(body);
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            await lockCampusSpaceUse(db, schoolId);
            const campus = await this.campus(schoolId, data.campus_id, db);
            const parent = data.parent_space_id ? await this.space(schoolId, data.campus_id, data.parent_space_id, db) : null;
            if (id && data.parent_space_id === id)
                throw new ConflictException("A space cannot contain itself.");
            const values = { campus_id: data.campus_id, parent_space_id: data.parent_space_id, name: data.name, code: data.code, kind: data.kind, capacity: data.capacity, is_accessible: data.is_accessible, is_bookable: data.is_bookable, status: data.status, updated_by: user.id };
            const saved = id ? await db.updateTable("campus_spaces").set(values).where("id", "=", id).where("school_id", "=", schoolId).where("revision", "=", data.expected_revision).returningAll().executeTakeFirst()
                : await db.insertInto("campus_spaces").values({ school_id: schoolId, ...values, created_by: user.id, attributes: {} }).returningAll().executeTakeFirst();
            if (!saved)
                throw new ConflictException(id ? "Space details changed. Refresh and review the latest version." : "Space could not be created.");
            const spaceRef = this.ref("campus_topology", saved.id);
            const parentRef = parent ? this.ref("campus_topology", parent.id) : this.ref("campus_topology", campus.id);
            const entities = [this.spaceEntity(saved), this.campusEntity(campus), ...(parent ? [this.spaceEntity(parent)] : [])];
            await this.setupEvent(db, { schoolId, actorId: user.id, action: id ? "space.updated" : "space.created", targetType: "campus_space", targetId: saved.id, requestId: request.requestId,
                model: { target: spaceRef, entities, relationships: [this.setRelationship({ type: "part_of", source: spaceRef, target: parentRef, effectiveFrom: this.time(id ? undefined : saved.created_at), sourceRecordId: saved.id, sourceRevision: saved.revision })], expectedRevision: id ? data.expected_revision : 0, resultingRevision: saved.revision, safeContext: { space_kind: saved.kind, campus_id: saved.campus_id } } });
            return saved;
        });
        await this.externalAudit(`institution.setup.space.${id ? "updated" : "created"}`, request, user, schoolId, "campus_space", row.id);
        return row;
    }
    async createResourceType(user, schoolId, body, request) { return this.saveResourceType(user, schoolId, null, body, request); }
    async updateResourceType(user, schoolId, id, body, request) { return this.saveResourceType(user, schoolId, id, body, request); }
    async saveResourceType(user, schoolId, id, body, request) {
        const data = id ? typeUpdate.parse(body) : typeCreate.parse(body);
        const expected = "expected_revision" in data ? Number(data.expected_revision) : undefined;
        const values = { code: data.code, name: data.name, category: data.category, tracking_mode: data.tracking_mode, unit_label: data.unit_label, is_active: data.is_active };
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            await lockCampusSpaceUse(db, schoolId);
            const institution = await db.selectFrom("schools").select(["id", "name"]).where("id", "=", schoolId).executeTakeFirstOrThrow();
            const saved = id ? await db.updateTable("campus_resource_types").set({ ...values, updated_by: user.id }).where("id", "=", id).where("school_id", "=", schoolId).where("revision", "=", expected).returningAll().executeTakeFirst()
                : await db.insertInto("campus_resource_types").values({ school_id: schoolId, ...values, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirst();
            if (!saved)
                throw new ConflictException(id ? "Resource type changed. Refresh and review the latest version." : "Resource type could not be created.");
            const typeRef = this.ref("campus_topology", saved.id);
            const institutionRef = this.ref("institutions", institution.id);
            await this.setupEvent(db, { schoolId, actorId: user.id, action: id ? "resource_type.updated" : "resource_type.created", targetType: "campus_resource_type", targetId: saved.id, requestId: request.requestId,
                model: { target: typeRef, entities: [this.institutionEntity(institution), this.resourceTypeEntity(saved)], relationships: [this.setRelationship({ type: "defined_by", source: typeRef, target: institutionRef, effectiveFrom: this.time(id ? undefined : saved.created_at), sourceRecordId: saved.id, sourceRevision: saved.revision })], expectedRevision: id ? expected ?? null : 0, resultingRevision: saved.revision, safeContext: { category: saved.category, tracking_mode: saved.tracking_mode } } });
            return saved;
        });
        await this.externalAudit(`institution.setup.resource_type.${id ? "updated" : "created"}`, request, user, schoolId, "campus_resource_type", row.id);
        return row;
    }
    async createAsset(user, schoolId, body, request) { return this.saveHolding(user, schoolId, null, body, request); }
    /** One user decision, one transaction, one ordinary owning command per copy. */
    async createLendingItem(user, schoolId, body, request) {
        const input = lendingItemInput.parse(body), ids = lendingCopyIds(input.command_id, input.quantity), tags = lendingCopyTags(input);
        if (!this.commandReceipts)
            throw new ConflictException('Reviewed resource creation is unavailable.');
        return this.db.transaction().execute(async (db) => {
            if (user.active_school_id !== schoolId)
                throw new ForbiddenException('Choose this campus before adding an item.');
            await institutionSchoolPermission(db, user, schoolId, 'resources.manage', true);
            const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
            if (!actor.acting)
                throw new ForbiddenException('Current canonical app access is required before adding an item.');
            // This existing topology lock also serializes exact concurrent retries.
            // The retained check must happen after waiting for an earlier transaction.
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`lending-type:${schoolId}`},0))`.execute(db);
            const key = `lending-item:${user.id}:${input.command_id}`, payloadHash = lendingItemPayloadHash(input);
            const retained = await this.commandReceipts.readDomainCommandReceipt(db, { school_id: schoolId, actor_user_id: user.id, source_domain: 'campus_topology', handler_key: 'campus_topology.lending_item', handler_version: 1, idempotency_key: key });
            if (retained) {
                if (retained.actor_agent_id !== actor.agent_id || retained.target.domain !== 'campus_topology' || retained.target.kind !== 'resource' || retained.target.domain_id !== input.command_id || retained.safe_context.payload_hash !== payloadHash)
                    throw new ConflictException('This item command belongs to different details.');
                if (retained.state !== 'completed' || retained.receipt.terminal_state !== 'accepted')
                    throw new ConflictException('This exact item is awaiting confirmation. Refresh before sending another item.');
                const recorded = retained.receipt.metadata.created_item_ids;
                const acceptedIds = recorded === undefined && input.quantity === 1 ? [input.command_id] : z.array(uuid).min(1).max(100).parse(recorded);
                if (JSON.stringify(acceptedIds) !== JSON.stringify(ids))
                    throw new ConflictException('This item batch has different retained copy identities.');
                for (const id of ids.slice(1)) {
                    const child = await this.commandReceipts.readDomainCommandReceipt(db, { school_id: schoolId, actor_user_id: user.id, source_domain: 'campus_topology', handler_key: 'campus_topology.lending_item', handler_version: 1, idempotency_key: `lending-item:${user.id}:${id}` });
                    if (!child || child.state !== 'completed' || child.receipt.terminal_state !== 'accepted' || child.actor_agent_id !== actor.agent_id || child.target.domain !== 'campus_topology' || child.target.kind !== 'resource' || child.target.domain_id !== id || child.safe_context.payload_hash !== payloadHash || child.safe_context.batch_command_id !== input.command_id)
                        throw new ConflictException('This exact batch’s retained copy evidence is unavailable.');
                }
                const rows = await db.selectFrom('campus_resource_holdings').selectAll().where('school_id', '=', schoolId).where('id', 'in', ids).execute();
                const ordered = ids.map(id => rows.find(row => row.id === id));
                if (ordered.some(row => !row))
                    throw new ConflictException('An accepted copy is unavailable. Review the retained batch before retrying.');
                return { id: input.command_id, quantity: input.quantity, created_items: ordered.map(row => row) };
            }
            const campus = await db.selectFrom('institution_campuses').selectAll().where('school_id', '=', schoolId).where('id', '=', input.campus_id).forShare().executeTakeFirst();
            if (!campus || campus.status !== 'active')
                throw new UnprocessableEntityException('Choose an active existing campus.');
            const kind = input.resource_type_id ? await db.selectFrom('campus_resource_types').selectAll().where('school_id', '=', schoolId).where('id', '=', input.resource_type_id).executeTakeFirst() : await db.selectFrom('campus_resource_types').selectAll().where('school_id', '=', schoolId).where('code', '=', 'LENDING-ITEMS').executeTakeFirst();
            if (input.resource_type_id && !kind)
                throw new UnprocessableEntityException('Choose a resource type from this campus.');
            if (kind && (!kind.is_active || kind.tracking_mode !== 'individual'))
                throw new UnprocessableEntityException('Choose an active individually tracked resource type.');
            const plannedKind = kind ?? { id: randomUUID(), name: 'Individually tracked items', category: 'other', is_active: true, revision: 1 };
            const created = [];
            for (const [index, id] of ids.entries())
                created.push(await this.createLendingCopy(db, user, schoolId, input, { id, tag: tags[index], index, ids, payloadHash }, campus, plannedKind, !kind && index === 0, request));
            return { id: input.command_id, quantity: input.quantity, created_items: created };
        }).catch((error) => {
            if (error && typeof error === 'object' && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'campus_resource_holdings_asset_tag_idx')
                throw new UnprocessableEntityException('This asset tag already identifies an existing copy. Choose that item or correct the tag.');
            throw error;
        });
    }
    async createLendingCopy(db, user, schoolId, input, copy, campus, kind, createType, request) {
        const now = executionNow().toISOString(), eventId = randomUUID(), correlationId = request.requestId ?? input.command_id, key = `lending-item:${user.id}:${copy.id}`;
        const holding = { id: copy.id, name: input.name, state: 'available', revision: 1 }, target = this.ref('campus_topology', copy.id);
        const model = { target, entities: [this.holdingEntity(holding), this.resourceTypeEntity(kind), this.campusEntity(campus)], relationships: [
                this.setRelationship({ type: 'instance_of', source: target, target: this.ref('campus_topology', kind.id), effectiveFrom: now, sourceRecordId: copy.id, sourceRevision: 1 }),
                this.setRelationship({ type: 'located_in', source: target, target: this.ref('campus_topology', campus.id), effectiveFrom: now, sourceRecordId: copy.id, sourceRevision: 1 })
            ], expectedRevision: 0, resultingRevision: 1,
            safeContext: { payload_hash: copy.payloadHash, campus_id: campus.id, batch_command_id: input.command_id, batch_quantity: input.quantity, copy_index: copy.index + 1, asset_tag: copy.tag, ...(copy.index === 0 ? { created_item_ids: copy.ids } : {}) } };
        const eventInput = { schoolId, actorId: user.id, action: 'resource.created', targetType: 'campus_resource_holding', targetId: copy.id,
            requestId: correlationId, eventId, commandKey: key, outcomeCode: 'resource_created', authorityEvidence: ['current_resources_management_permission'], model,
            outcomeMetadata: copy.index === 0 ? { quantity: input.quantity, created_item_ids: copy.ids } : { batch_command_id: input.command_id, copy_index: copy.index + 1 } };
        const prepared = await this.commands.prepareDomainCommand(db, { school_id: schoolId, actor_user_id: user.id, command_type: 'resource.created', handler_key: 'campus_topology.lending_item', handler_version: 1, source_domain: 'campus_topology', target: this.holdingEntity(holding), current_revision: 0, expected_revision: 0, capability: 'campus_topology:manage', purpose: 'create_exact_lending_resource', requested_at: now, correlation_id: correlationId, causation_id: null, idempotency_key: key, operating_rule_version_ref: null, configuration_refs: [], authority_attestation: { evaluator_domain: 'campus_topology', decision: 'allowed', reason_codes: ['current_resources_management_permission', 'explicit_named_item_and_campus'], authority_source_refs: [{ permission: 'resources.manage', campus_id: campus.id }], operating_rule_refs: [], valid_until: null }, safe_context: { ...model.safeContext, accepted_change_hash: acceptedChangeProjectionHash(this.acceptedChange(eventInput, eventId)) } });
        if (prepared.status !== 'ready')
            throw new ConflictException('Refresh this exact item batch before retrying.');
        if (createType)
            await db.insertInto('campus_resource_types').values({ id: kind.id, school_id: schoolId, code: 'LENDING-ITEMS', name: kind.name, category: 'other', tracking_mode: 'individual', unit_label: 'items', created_by: user.id, updated_by: user.id, created_at: new Date(now), updated_at: new Date(now) }).execute();
        const saved = await db.insertInto('campus_resource_holdings').values({ id: copy.id, school_id: schoolId, campus_id: campus.id, space_id: null, resource_type_id: kind.id, name: input.name, quantity: 1, asset_tag: copy.tag, state: 'available', notes: '', created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
        await this.setupEvent(db, { ...eventInput, prepared });
        return saved;
    }
    async updateAsset(user, schoolId, id, body, request) { return this.saveHolding(user, schoolId, id, body, request); }
    async saveHolding(user, schoolId, id, body, request) {
        const data = id ? holdingUpdate.parse(body) : holdingCreate.parse(body);
        const expected = "expected_revision" in data ? Number(data.expected_revision) : undefined;
        const values = { campus_id: data.campus_id, space_id: data.space_id, resource_type_id: data.resource_type_id, name: data.name, quantity: data.quantity, asset_tag: data.asset_tag, state: data.state, notes: data.notes };
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            await lockCampusSpaceUse(db, schoolId);
            const campus = await this.campus(schoolId, data.campus_id, db);
            const space = data.space_id ? await this.space(schoolId, data.campus_id, data.space_id, db) : null;
            const kind = await db.selectFrom("campus_resource_types").selectAll().where("id", "=", data.resource_type_id).where("school_id", "=", schoolId).executeTakeFirst();
            if (!kind)
                throw new NotFoundException("Resource type not found in this institution.");
            if (kind.tracking_mode === "individual" && (data.quantity !== 1 || !data.asset_tag))
                throw new BadRequestException("Individually tracked resources need quantity one and an asset tag.");
            if (kind.tracking_mode === "pooled" && data.asset_tag)
                throw new BadRequestException("Pooled resources use a quantity, not an individual asset tag.");
            const saved = id ? await db.updateTable("campus_resource_holdings").set({ ...values, updated_by: user.id }).where("id", "=", id).where("school_id", "=", schoolId).where("revision", "=", expected).returningAll().executeTakeFirst()
                : await db.insertInto("campus_resource_holdings").values({ school_id: schoolId, ...values, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirst();
            if (!saved)
                throw new ConflictException(id ? "Resource holding changed. Refresh and review the latest version." : "Resource holding could not be created.");
            const holdingRef = this.ref("campus_topology", saved.id);
            const typeRef = this.ref("campus_topology", kind.id);
            const locationRef = this.ref("campus_topology", space?.id ?? campus.id);
            const effectiveFrom = this.time(id ? undefined : saved.created_at);
            await this.setupEvent(db, { schoolId, actorId: user.id, action: id ? "resource.updated" : "resource.created", targetType: "campus_resource_holding", targetId: saved.id, requestId: request.requestId,
                model: { target: holdingRef, entities: [this.holdingEntity(saved), this.resourceTypeEntity(kind), this.campusEntity(campus), ...(space ? [this.spaceEntity(space)] : [])], relationships: [
                        this.setRelationship({ type: "instance_of", source: holdingRef, target: typeRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
                        this.setRelationship({ type: "located_in", source: holdingRef, target: locationRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
                    ], expectedRevision: id ? expected ?? null : 0, resultingRevision: saved.revision, safeContext: { campus_id: saved.campus_id, space_id: saved.space_id, resource_type_id: saved.resource_type_id } } });
            return saved;
        });
        await this.externalAudit(`institution.setup.resource.${id ? "updated" : "created"}`, request, user, schoolId, "campus_resource_holding", row.id);
        return row;
    }
    async placeClass(user, schoolId, classId, body, request) {
        const data = placement.parse(body);
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            const campus = await this.campus(schoolId, data.campus_id, db);
            const space = data.home_space_id ? await this.space(schoolId, data.campus_id, data.home_space_id, db) : null;
            const section = await db.selectFrom("class_sections").select(["id", "grade", "section", "revision"]).where("id", "=", classId).where("school_id", "=", schoolId).executeTakeFirst();
            if (!section)
                throw new NotFoundException("Class not found in this institution.");
            const current = await db.selectFrom("class_campus_placements").selectAll().where("class_section_id", "=", classId).where("is_primary", "=", true).where("effective_from", "<=", data.effective_from).where((eb) => eb.or([eb("effective_until", "is", null), eb("effective_until", ">=", data.effective_from)])).forUpdate().executeTakeFirst();
            if ((current?.revision ?? null) !== data.expected_current_revision)
                throw new ConflictException("Class placement changed. Refresh and review the latest version.");
            if (current && current.effective_from >= data.effective_from)
                throw new ConflictException("Choose a date after the current placement began.");
            if (current)
                await db.updateTable("class_campus_placements").set({ effective_until: sql `${data.effective_from}::date-1`, assigned_by: user.id }).where("id", "=", current.id).where("revision", "=", current.revision).execute();
            const saved = await db.insertInto("class_campus_placements").values({ school_id: schoolId, class_section_id: classId, campus_id: data.campus_id, home_space_id: data.home_space_id ?? null, is_primary: true, effective_from: data.effective_from, effective_until: null, assigned_by: user.id }).returningAll().executeTakeFirstOrThrow();
            const classRef = this.ref("academic_structure", section.id);
            const campusRef = this.ref("campus_topology", campus.id);
            const effectiveFrom = await this.placementInstant(db, data.effective_from, campus.timezone);
            const relationships = [
                this.setRelationship({ type: "located_in", source: classRef, target: campusRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
                space
                    ? this.setRelationship({ type: "home_space", source: classRef, target: this.ref("campus_topology", space.id), effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision })
                    : this.clearRelationship({ type: "home_space", source: classRef, effectiveFrom, sourceRecordId: saved.id, sourceRevision: saved.revision }),
            ];
            await this.setupEvent(db, { schoolId, actorId: user.id, action: "class.placement.updated", targetType: "class_section", targetId: classId, metadata: { campus_id: data.campus_id, effective_from: data.effective_from }, requestId: request.requestId,
                model: { target: classRef, entities: [this.classEntity(section), this.campusEntity(campus), ...(space ? [this.spaceEntity(space)] : [])], relationships, expectedRevision: data.expected_current_revision, resultingRevision: saved.revision, safeContext: { campus_id: data.campus_id, home_space_id: data.home_space_id ?? null, effective_from: data.effective_from } } });
            return saved;
        });
        await this.externalAudit("institution.setup.class_placement.updated", request, user, schoolId, "class_section", classId);
        return row;
    }
    async placeStaff(user, schoolId, staffId, body, request) {
        const data = staffPlacement.parse(body);
        const row = await this.db.transaction().execute(async (db) => {
            await this.requireAdmin(user, schoolId, db);
            const campus = await this.campus(schoolId, data.campus_id, db);
            const profile = await db.selectFrom("staff_profiles as profile").innerJoin("school_people as person", join => join.onRef("person.id", "=", "profile.person_id").onRef("person.school_id", "=", "profile.school_id")).select(["profile.id", "person.first_name", "person.last_name", "profile.status", "profile.revision"]).where("profile.id", "=", staffId).where("profile.school_id", "=", schoolId).executeTakeFirst();
            if (!profile)
                throw new NotFoundException("Staff member not found in this institution.");
            const current = await db.selectFrom("staff_campus_assignments").selectAll().where("staff_profile_id", "=", staffId).where("is_primary", "=", true).where("effective_from", "<=", data.effective_from).where((eb) => eb.or([eb("effective_until", "is", null), eb("effective_until", ">=", data.effective_from)])).forUpdate().executeTakeFirst();
            if ((current?.revision ?? null) !== data.expected_current_revision)
                throw new ConflictException("Staff campus assignment changed. Refresh and review the latest version.");
            if (current && current.effective_from >= data.effective_from)
                throw new ConflictException("Choose a date after the current assignment began.");
            if (current)
                await db.updateTable("staff_campus_assignments").set({ effective_until: sql `${data.effective_from}::date-1`, assigned_by: user.id }).where("id", "=", current.id).where("revision", "=", current.revision).execute();
            const saved = await db.insertInto("staff_campus_assignments").values({ school_id: schoolId, staff_profile_id: staffId, campus_id: data.campus_id, is_primary: true, effective_from: data.effective_from, effective_until: null, assigned_by: user.id }).returningAll().executeTakeFirstOrThrow();
            const staffRef = this.ref("people", profile.id);
            const campusRef = this.ref("campus_topology", campus.id);
            await this.setupEvent(db, { schoolId, actorId: user.id, action: "staff.placement.updated", targetType: "staff_profile", targetId: staffId, metadata: { campus_id: data.campus_id, effective_from: data.effective_from }, requestId: request.requestId,
                model: { target: staffRef, entities: [this.staffEntity(profile), this.campusEntity(campus)], relationships: [this.setRelationship({ type: "assigned_to", source: staffRef, target: campusRef, effectiveFrom: await this.placementInstant(db, data.effective_from, campus.timezone), sourceRecordId: saved.id, sourceRevision: saved.revision })], expectedRevision: data.expected_current_revision, resultingRevision: saved.revision, safeContext: { campus_id: data.campus_id, effective_from: data.effective_from } } });
            return saved;
        });
        await this.externalAudit("institution.setup.staff_placement.updated", request, user, schoolId, "staff_profile", staffId);
        return row;
    }
};
InstitutionSetupService = __decorate([
    Injectable(),
    __param(2, Inject(CAMPUS_MODEL_CORE_PORT)),
    __param(3, Inject(OBSERVATION_SOURCE_REGISTRY_PORT)),
    __param(4, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(5, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(6, Optional()),
    __param(6, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __metadata("design:paramtypes", [DatabaseService,
        AuditService, Object, Object, Object, Object, Object])
], InstitutionSetupService);
export { InstitutionSetupService };
//# sourceMappingURL=institution-setup.service.js.map