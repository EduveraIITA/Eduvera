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
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT } from "../campus-model-core/domain-event-journal.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { effectiveSchoolAccess, institutionSchoolPermission } from "../roles/authorization.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { PEOPLE_RELATIONSHIP_PROJECTION_PORT } from "../campus-model-core/people-relationship-projection.port.js";
import { participantNameCheckSchema, readParticipantNameMatches } from "./participant-name-check.js";
const uuid = z.string().uuid();
const paging = z.object({ search: z.string().trim().max(80).default(""), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict();
const personContactEmail = z.union([z.email(), z.literal("")]).transform(value => value.trim()).pipe(z.string().max(254));
const personContactPhone = z.string().trim().max(32);
export const participantCreateSchema = z.object({
    first_name: z.string().trim().min(1).max(150), last_name: z.string().trim().max(150).default(""),
    affiliation: z.enum(["learner", "worker", "contractor", "visitor", "other"]).optional(),
    // Omitted contact keys remain absent from the retained command payload. Do not
    // default them here: that would change the hash of pre-existing name-only retries.
    contact_email: personContactEmail.optional(), contact_phone: personContactPhone.optional(), idempotency_key: uuid,
}).strict();
export const participantNameCorrectionSchema = z.object({
    first_name: z.string().trim().min(1).max(150), last_name: z.string().trim().max(150).default(""),
    expected_revision: z.number().int().positive(), reason: z.string().trim().min(3).max(500), idempotency_key: uuid,
}).strict();
export const participationGroupSchema = z.object({
    name: z.string().trim().min(1).max(150), person_ids: z.array(uuid).min(1).max(2000),
    starts_on: z.iso.date(), ends_on: z.iso.date().nullable().optional().default(null), idempotency_key: uuid,
}).strict().refine((value) => new Set(value.person_ids).size === value.person_ids.length, "Select each person only once.")
    .refine((value) => !value.ends_on || value.ends_on >= value.starts_on, "Group end must not precede its start.");
const replaceMembersSchema = z.object({
    person_ids: z.array(uuid).min(1).max(2000), effective_on: z.iso.date(), expected_revision: z.number().int().positive(), idempotency_key: uuid,
}).strict().refine((value) => new Set(value.person_ids).size === value.person_ids.length, "Select each person only once.");
const profileCorrectionSchema = z.object({ expected_revision: z.number().int().positive(),
    contact_email: personContactEmail, contact_phone: personContactPhone,
    reason: z.string().trim().min(3).max(500), idempotency_key: uuid }).strict();
const connectionCreateSchema = z.object({ type: z.literal("mentor_of"), target_person_id: uuid, starts_on: z.iso.date(),
    ends_on: z.iso.date().nullable().default(null), reason: z.string().trim().min(3).max(500), idempotency_key: uuid }).strict()
    .refine(value => !value.ends_on || value.ends_on >= value.starts_on, "Connection end must not precede its start.");
const connectionEndSchema = z.object({ expected_revision: z.number().int().positive(), ends_on: z.iso.date(),
    reason: z.string().trim().min(3).max(500), idempotency_key: uuid }).strict();
const groupParentSchema = z.object({ parent_group_id: uuid.nullable(), effective_on: z.iso.date(), expected_revision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500), idempotency_key: uuid }).strict();
let ParticipationPeopleService = class ParticipationPeopleService {
    db;
    events;
    gateway;
    journal;
    identity;
    projection;
    constructor(db, events, gateway, journal, identity, projection) {
        this.db = db;
        this.events = events;
        this.gateway = gateway;
        this.journal = journal;
        this.identity = identity;
        this.projection = projection;
    }
    async authorize(db, user, schoolId) {
        uuid.parse(schoolId);
        if (user.active_school_id !== schoolId)
            throw new BadRequestException("Select this institution before managing people.");
        await institutionSchoolPermission(db, user, schoolId, "sis.manage", true);
    }
    async today(db, schoolId) {
        return (await sql `SELECT (${executionNow().toISOString()}::timestamptz AT TIME ZONE timezone)::date::text AS date FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows[0].date;
    }
    async list(user, schoolId, raw) {
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            const date = await this.today(db, schoolId);
            const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
            const result = await sql `SELECT person.id,
        trim(concat_ws(' ',person.first_name,person.last_name)) AS label,
        ARRAY(SELECT DISTINCT affiliation FROM (
          SELECT affiliation FROM person_affiliations a WHERE a.school_id=person.school_id AND a.person_id=person.id
            AND a.starts_on<=${date}::date AND (a.ends_on IS NULL OR a.ends_on>=${date}::date)
          UNION SELECT 'learner' WHERE EXISTS(SELECT 1 FROM students WHERE person_id=person.id)
          UNION SELECT 'worker' WHERE EXISTS(SELECT 1 FROM staff_profiles WHERE person_id=person.id)
        ) affiliations ORDER BY affiliation) AS affiliations,
        count(*) OVER()::int AS total
        FROM school_people person WHERE person.school_id=${schoolId}::uuid AND person.retired_at IS NULL
          AND trim(concat_ws(' ',person.first_name,person.last_name)) ILIKE ${pattern}
        ORDER BY lower(person.first_name),lower(person.last_name),person.id LIMIT 25 OFFSET ${(input.page - 1) * 25}`.execute(db);
            const total = result.rows[0]?.total ?? (await sql `SELECT count(*)::int AS total FROM school_people person
        WHERE person.school_id=${schoolId}::uuid AND person.retired_at IS NULL
          AND trim(concat_ws(' ',person.first_name,person.last_name)) ILIKE ${pattern}`.execute(db)).rows[0].total;
            const metadata = await this.accountMetadata(db, user, schoolId, result.rows.map(row => row.id));
            return { results: result.rows.map(({ total, ...row }) => { void total; return { ...row, ...metadata.people.get(row.id) }; }),
                page: input.page, page_size: 25, total, capabilities: { ...metadata.capabilities, can_manage_enrollment: true } };
        });
    }
    async nameCheck(user, schoolId, raw) {
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            const input = participantNameCheckSchema.parse(raw);
            return readParticipantNameMatches(db, schoolId, await this.today(db, schoolId), input);
        });
    }
    async accountMetadata(db, user, schoolId, personIds) {
        const now = executionNow().toISOString();
        const states = await this.identity.listPersonAccountStates(db, { school_id: schoolId, person_ids: personIds, at: now, viewer_user_id: user.id });
        if (states.length !== new Set(personIds).size)
            throw new ConflictException("People changed while loading app access. Refresh this directory.");
        const access = await effectiveSchoolAccess(db, user.id, schoolId, "members.invite");
        const canInvite = executionEnvironmentStorage.getStore()?.kind !== "simulation"
            && access.sources.some(source => source.permission === "members.invite" && source.scope_kind === "institution");
        const pending = canInvite && personIds.length ? (await sql `SELECT person_id,id,expires_at
      FROM school_invitations WHERE school_id=${schoolId}::uuid AND person_id=ANY(${personIds}::uuid[])
        AND role='member' AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db)).rows : [];
        const pendingByPerson = new Map(pending.map(invitation => [invitation.person_id, { id: invitation.id,
                expires_at: new Date(invitation.expires_at).toISOString(), state: new Date(invitation.expires_at).getTime() > Date.parse(now) ? "pending" : "expired" }]));
        return { capabilities: { can_invite: canInvite }, people: new Map(states.map(({ person_id, ...state }) => [person_id,
                { ...state, ...(pendingByPerson.has(person_id) ? { pending_invitation: pendingByPerson.get(person_id) } : {}) }])) };
    }
    async command(req, schoolId, key, input, target, expectedRevision, execute, auditMetadata) {
        const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, req.authUser, schoolId);
            const actor = await this.identity.resolveAccountEndpoint(db, { school_id: schoolId, user_id: req.authUser.id, at: executionNow().toISOString() });
            if (!actor.acting)
                throw new ConflictException("Current app access is required before changing People data or retrying a change.");
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`people:${schoolId}:${req.authUser.id}:${key}`},0))`.execute(db);
            const retained = (await sql `SELECT request_hash,result FROM people_participation_commands
        WHERE school_id=${schoolId}::uuid AND actor_id=${req.authUser.id}::uuid AND idempotency_key=${key}::uuid`.execute(db)).rows[0];
            if (retained) {
                if (retained.request_hash !== hash)
                    throw new ConflictException("This retry key belongs to different people data.");
                return retained.result;
            }
            const now = executionNow().toISOString();
            const prepared = await this.gateway.prepareDomainCommand(db, {
                school_id: schoolId, actor_user_id: req.authUser.id, command_type: `people.${target.kind}.save`,
                handler_key: "people.participation", handler_version: 1, source_domain: "people", target,
                current_revision: expectedRevision, expected_revision: expectedRevision, capability: "people:manage", purpose: "manage_participation_identity",
                requested_at: now, correlation_id: req.requestId, causation_id: null, idempotency_key: `people:${req.authUser.id}:${key}`,
                operating_rule_version_ref: null, configuration_refs: [], authority_attestation: {
                    evaluator_domain: "people", decision: "allowed", reason_codes: ["current_people_management_permission"],
                    authority_source_refs: [{ permission: "sis.manage", school_id: schoolId }], operating_rule_refs: [], valid_until: null,
                }, safe_context: { target_kind: target.kind, target_revision: target.source_revision },
            });
            if (prepared.status !== "ready")
                throw new ConflictException("This people command already completed; refresh the directory.");
            const result = await execute(db, prepared);
            const eventKey = `people.participation:${schoolId}:${req.authUser.id}:${key}`;
            const eventType = "people.updated";
            await this.events.enqueueUserEvent(db, { schoolId, eventType, aggregateType: target.kind, aggregateId: target.domain_id,
                audienceUserIds: [req.authUser.id], idempotencyKey: eventKey, payload: { refresh: ["people.participants", "activities.catalogue"], source_revision: target.source_revision } });
            const outbox = await db.selectFrom("event_outbox").select("id").where("idempotency_key", "=", eventKey).executeTakeFirstOrThrow();
            const journal = await this.journal.recordAcceptedEvent(db, {
                school_id: schoolId, source_outbox_event_id: outbox.id, event_type: eventType, subject: target, context: null,
                actor_user_id: req.authUser.id, audience_user_ids: [], occurred_at: now, effective_from: now, effective_until: null,
                source_domain: "people", source_record_id: target.domain_id, source_revision: target.source_revision,
                correlation_id: req.requestId, causation_event_id: null, idempotency_key: eventKey, payload: { kind: target.kind },
            });
            await db.insertInto("audit_events").values({ school_id: schoolId, actor_id: req.authUser.id, action: eventType,
                target_type: target.kind, target_id: target.domain_id, request_id: req.requestId, ip_hash: null, metadata: { revision: target.source_revision, account_created: false, ...auditMetadata?.() } }).execute();
            await this.gateway.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted",
                code: "participation_identity_saved", explanation: "People data saved without creating account access.", resulting_revision: target.source_revision,
                domain_event_id: outbox.id, metadata: { model_event_id: journal.event_id }, completed_at: now });
            await sql `INSERT INTO people_participation_commands(school_id,actor_id,idempotency_key,request_hash,result)
        VALUES(${schoolId}::uuid,${req.authUser.id}::uuid,${key}::uuid,${hash},${JSON.stringify(result)}::jsonb)`.execute(db);
            return result;
        });
    }
    create(req, schoolId, raw) {
        const input = participantCreateSchema.parse(raw);
        const id = randomUUID();
        const label = `${input.first_name} ${input.last_name}`.trim();
        return this.command(req, schoolId, input.idempotency_key, input, { kind: "person", domain: "people", domain_id: id, label, lifecycle_state: "active", source_revision: 1, metadata: {} }, 0, async (db) => {
            await sql `INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone)
          VALUES(${id}::uuid,${schoolId}::uuid,${input.first_name},${input.last_name},${input.contact_email ?? ""},${input.contact_phone ?? ""})`.execute(db);
            if (input.affiliation)
                await sql `INSERT INTO person_affiliations(school_id,person_id,affiliation,starts_on,created_by)
          VALUES(${schoolId}::uuid,${id}::uuid,${input.affiliation},${await this.today(db, schoolId)}::date,${req.authUser.id}::uuid)`.execute(db);
            return { id, label, affiliations: input.affiliation ? [input.affiliation] : [], has_account: false, account_state: "not_linked", is_you: false };
        });
    }
    async detail(user, schoolId, id) {
        uuid.parse(id);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            const person = (await sql `SELECT id,first_name,last_name,revision,contact_email,contact_phone
        FROM school_people WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND retired_at IS NULL`.execute(db)).rows[0];
            if (!person)
                throw new NotFoundException("Person not found in this institution.");
            const date = await this.today(db, schoolId);
            const sources = (await sql `SELECT affiliation,'recorded'::text AS source
        FROM person_affiliations WHERE school_id=${schoolId}::uuid AND person_id=${id}::uuid
          AND starts_on<=${date}::date AND (ends_on IS NULL OR ends_on>=${date}::date)
        UNION SELECT 'learner','learner record' WHERE EXISTS(SELECT 1 FROM students WHERE school_id=${schoolId}::uuid AND person_id=${id}::uuid)
        UNION SELECT 'worker','staff profile' WHERE EXISTS(SELECT 1 FROM staff_profiles WHERE school_id=${schoolId}::uuid AND person_id=${id}::uuid)
        ORDER BY affiliation,source`.execute(db)).rows;
            const metadata = await this.accountMetadata(db, user, schoolId, [id]);
            const access = await effectiveSchoolAccess(db, user.id, schoolId);
            const administrator = access.role === "admin";
            const profiles = (await sql `
        SELECT 'learning'::text AS kind,id,'Learning record'::text AS label,'/areas/people/records?student='||id::text||'&context=learning' AS href
        FROM students WHERE school_id=${schoolId}::uuid AND person_id=${id}::uuid
        UNION ALL SELECT 'work',id,'Work profile','/more/setup/responsibilities/'||id::text||'?context=work'
        FROM staff_profiles WHERE school_id=${schoolId}::uuid AND person_id=${id}::uuid AND ${administrator}
        UNION ALL SELECT 'guardian',guardian_id,'Guardian contact','/areas/people/participants/'||person_id::text
        FROM guardian_school_profiles WHERE school_id=${schoolId}::uuid AND person_id=${id}::uuid
        ORDER BY kind,id`.execute(db)).rows;
            return { ...person, label: `${person.first_name} ${person.last_name}`.trim(), affiliation_sources: sources,
                profile: { contact_email: person.contact_email, contact_phone: person.contact_phone }, source_profiles: profiles,
                ...metadata.people.get(id), capabilities: { ...metadata.capabilities, can_correct_name: true, can_edit_profile: true,
                    can_manage_connections: true, can_manage_groups: true, can_enroll: !profiles.some(profile => profile.kind === "learning"),
                    can_add_work_profile: administrator && !profiles.some(profile => profile.kind === "work"), can_link_guardian: true } };
        });
    }
    correctName(req, schoolId, id, raw) {
        uuid.parse(id);
        const input = participantNameCorrectionSchema.parse(raw);
        let previous;
        return this.command(req, schoolId, input.idempotency_key, { id, ...input }, { kind: "person", domain: "people", domain_id: id, label: `${input.first_name} ${input.last_name}`.trim(),
            lifecycle_state: "active", source_revision: input.expected_revision + 1, metadata: {} }, input.expected_revision, async (db) => {
            const person = (await sql `SELECT first_name,last_name,revision
          FROM school_people WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND retired_at IS NULL FOR UPDATE`.execute(db)).rows[0];
            if (!person)
                throw new NotFoundException("Person not found in this institution.");
            if (person.revision !== input.expected_revision)
                throw new ConflictException("This person changed. Close and reopen their details before correcting the name.");
            if (person.first_name === input.first_name && person.last_name === input.last_name)
                throw new BadRequestException("Change the name before saving a correction.");
            previous = { first_name: person.first_name, last_name: person.last_name };
            await sql `UPDATE school_people SET first_name=${input.first_name},last_name=${input.last_name},revision=revision+1
          WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db);
            return { id, label: `${input.first_name} ${input.last_name}`.trim(), first_name: input.first_name,
                last_name: input.last_name, revision: input.expected_revision + 1 };
        }, () => ({ change_kind: "name_correction", reason: input.reason, previous_name: previous,
            corrected_name: { first_name: input.first_name, last_name: input.last_name } }));
    }
    async groups(user, schoolId, raw) {
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            const date = await this.today(db, schoolId);
            const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
            const rows = (await sql `SELECT g.id,g.name,g.revision,g.is_active,
      (SELECT count(*)::int FROM participation_group_members m JOIN school_people p ON p.id=m.person_id AND p.school_id=m.school_id
        WHERE m.group_id=g.id AND m.school_id=g.school_id AND p.retired_at IS NULL AND m.starts_on<=${date}::date AND (m.ends_on IS NULL OR m.ends_on>=${date}::date)) AS member_count,
      COALESCE((SELECT jsonb_agg(preview.item ORDER BY preview.name,preview.person_id) FROM (
        SELECT jsonb_build_object('person_id',p.id,'label',trim(concat_ws(' ',p.first_name,p.last_name)),'starts_on',m.starts_on,'ends_on',m.ends_on) AS item,
          p.first_name AS name,p.id AS person_id
        FROM participation_group_members m JOIN school_people p ON p.id=m.person_id AND p.school_id=m.school_id
        WHERE m.group_id=g.id AND m.school_id=g.school_id AND p.retired_at IS NULL AND m.starts_on<=${date}::date AND (m.ends_on IS NULL OR m.ends_on>=${date}::date)
        ORDER BY lower(p.first_name),p.id LIMIT 3) preview), '[]'::jsonb) AS members,
      count(*) OVER()::int AS total FROM participation_groups g WHERE g.school_id=${schoolId}::uuid AND g.is_active
        AND g.name ILIKE ${pattern} ORDER BY lower(g.name),g.id LIMIT 25 OFFSET ${(input.page - 1) * 25}`.execute(db)).rows;
            const total = rows[0]?.total ?? (await sql `SELECT count(*)::int AS total FROM participation_groups g
      WHERE g.school_id=${schoolId}::uuid AND g.is_active AND g.name ILIKE ${pattern}`.execute(db)).rows[0].total;
            return { results: rows.map(({ total, ...row }) => { void total; return row; }), page: input.page, page_size: 25, total };
        });
    }
    async peopleExist(db, schoolId, ids) {
        const rows = (await sql `SELECT id FROM school_people WHERE school_id=${schoolId}::uuid
      AND id=ANY(${ids}::uuid[]) AND retired_at IS NULL FOR SHARE`.execute(db)).rows;
        if (rows.length !== ids.length)
            throw new BadRequestException("Choose active people from this institution.");
    }
    createGroup(req, schoolId, raw) {
        const input = participationGroupSchema.parse(raw);
        const id = randomUUID();
        return this.command(req, schoolId, input.idempotency_key, input, { kind: "participation_group", domain: "people", domain_id: id, label: input.name, lifecycle_state: "active", source_revision: 1, metadata: {} }, 0, async (db, prepared) => {
            await this.peopleExist(db, schoolId, input.person_ids);
            await sql `INSERT INTO participation_groups(id,school_id,name,created_by,created_at) VALUES(${id}::uuid,${schoolId}::uuid,${input.name},${req.authUser.id}::uuid,${executionNow().toISOString()}::timestamptz)`.execute(db);
            await sql `INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,ends_on,created_by,recorded_at)
          SELECT ${schoolId}::uuid,${id}::uuid,person_id,${input.starts_on}::date,${input.ends_on}::date,${req.authUser.id}::uuid,${executionNow().toISOString()}::timestamptz FROM unnest(${input.person_ids}::uuid[]) person_id`.execute(db);
            await this.projectMembers(db, req, schoolId, { id, name: input.name, revision: 1, is_active: true }, prepared);
            return { id, name: input.name, revision: 1 };
        });
    }
    async replaceMembers(req, schoolId, id, raw) {
        uuid.parse(id);
        const input = replaceMembersSchema.parse(raw);
        await this.authorize(this.db, req.authUser, schoolId);
        const group = (await sql `SELECT name FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND is_active`.execute(this.db)).rows[0];
        if (!group)
            throw new NotFoundException("Group not found in this institution.");
        return this.command(req, schoolId, input.idempotency_key, { id, ...input }, { kind: "participation_group", domain: "people", domain_id: id, label: group.name, lifecycle_state: "active", source_revision: input.expected_revision + 1, metadata: {} }, input.expected_revision, async (db, prepared) => {
            const current = (await sql `SELECT revision FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND is_active FOR UPDATE`.execute(db)).rows[0];
            if (current?.revision !== input.expected_revision)
                throw new ConflictException("This group changed. Refresh before editing its membership.");
            if (input.effective_on < await this.today(db, schoolId))
                throw new BadRequestException("Use today or a future membership date; historical rosters are retained.");
            await this.peopleExist(db, schoolId, input.person_ids);
            const future = (await sql `SELECT max(starts_on)::text AS latest_start FROM participation_group_members
          WHERE school_id=${schoolId}::uuid AND group_id=${id}::uuid AND starts_on>=${input.effective_on}::date`.execute(db)).rows[0]?.latest_start;
            if (future)
                throw new ConflictException(`Membership already starts on or after this date. Choose a date after ${future} rather than overwriting dated history.`);
            await sql `UPDATE participation_group_members SET ends_on=${input.effective_on}::date-1,revision=revision+1
          WHERE school_id=${schoolId}::uuid AND group_id=${id}::uuid AND starts_on<${input.effective_on}::date AND (ends_on IS NULL OR ends_on>=${input.effective_on}::date)`.execute(db);
            await sql `INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by,recorded_at)
          SELECT ${schoolId}::uuid,${id}::uuid,person_id,${input.effective_on}::date,${req.authUser.id}::uuid,${executionNow().toISOString()}::timestamptz FROM unnest(${input.person_ids}::uuid[]) person_id`.execute(db);
            await sql `UPDATE participation_groups SET revision=revision+1 WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db);
            await this.projectMembers(db, req, schoolId, { id, name: group.name, revision: input.expected_revision + 1, is_active: true }, prepared, input.effective_on);
            await this.history(db, req, schoolId, "group_members", id, input.expected_revision + 1, input.effective_on, "Reviewed group membership change", { person_ids: input.person_ids });
            return { id, revision: input.expected_revision + 1 };
        });
    }
    entity(row) {
        return { kind: "first_name" in row ? "person" : "participation_group", domain: "people", domain_id: row.id,
            label: "first_name" in row ? `${row.first_name} ${row.last_name}`.trim() : row.name,
            lifecycle_state: "active", source_revision: row.revision, metadata: {} };
    }
    async person(db, schoolId, id, lock = false) {
        const row = (await sql `SELECT id,first_name,last_name,revision FROM school_people
      WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND retired_at IS NULL ${lock ? sql `FOR UPDATE` : sql ``}`.execute(db)).rows[0];
        if (!row)
            throw new NotFoundException("Person not found in this institution.");
        return row;
    }
    async interval(db, schoolId, startsOn, endsOn) {
        const row = (await sql `SELECT
      ${startsOn}::date::timestamp AT TIME ZONE timezone AS effective_from,
      (${endsOn}::date+1)::timestamp AT TIME ZONE timezone AS effective_until FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows[0];
        return { effective_from: row.effective_from.toISOString(), effective_until: row.effective_until?.toISOString() ?? null };
    }
    async history(db, req, schoolId, kind, id, revision, effectiveOn, reason, details) {
        await sql `INSERT INTO people_relationship_history(school_id,source_kind,source_id,revision,effective_on,reason,actor_id,recorded_at,details)
      VALUES(${schoolId}::uuid,${kind},${id}::uuid,${revision},${effectiveOn}::date,${reason},${req.authUser.id}::uuid,
        ${executionNow().toISOString()}::timestamptz,${JSON.stringify(details)}::jsonb)`.execute(db);
    }
    async projectMembers(db, req, schoolId, group, prepared, effectiveOn) {
        const rows = (await sql `SELECT p.id,p.first_name,p.last_name,p.revision,m.id AS member_id,m.revision AS member_revision,
        m.starts_on::text,m.ends_on::text,m.starts_on::timestamp AT TIME ZONE s.timezone AS effective_from,
        (m.ends_on+1)::timestamp AT TIME ZONE s.timezone AS effective_until
      FROM participation_group_members m JOIN school_people p ON p.id=m.person_id AND p.school_id=m.school_id
      JOIN schools s ON s.id=m.school_id WHERE m.school_id=${schoolId}::uuid AND m.group_id=${group.id}::uuid
        AND (${effectiveOn ?? null}::date IS NULL OR m.starts_on>=${effectiveOn ?? null}::date OR m.ends_on=${effectiveOn ?? null}::date-1)
      ORDER BY m.id LIMIT 4001`.execute(db)).rows;
        if (rows.length > 4000)
            throw new ConflictException("This change exceeds the reviewed membership batch. Use a later bounded change.");
        await this.projection.projectPeopleRelationships(db, { school_id: schoolId, actor_user_id: req.authUser.id,
            command_id: prepared.command_id, prepared_request_hash: prepared.request_hash, subject: this.entity(group),
            edges: rows.map(row => ({ relation_type: "member_of", source_record_id: row.member_id, source_revision: row.member_revision,
                source: this.entity(row), target: this.entity(group), effective_from: row.effective_from.toISOString(), effective_until: row.effective_until?.toISOString() ?? null })) });
    }
    async correctProfile(req, schoolId, id, raw) {
        uuid.parse(id);
        const input = profileCorrectionSchema.parse(raw);
        const current = await this.detail(req.authUser, schoolId, id);
        return this.command(req, schoolId, input.idempotency_key, { id, ...input }, { ...this.entity(current), source_revision: input.expected_revision + 1 }, input.expected_revision, async (db) => {
            const person = await this.person(db, schoolId, id, true);
            if (person.revision !== input.expected_revision)
                throw new ConflictException("This person changed. Refresh their profile before correcting contact details.");
            const previous = (await sql `SELECT contact_email,contact_phone FROM school_people
          WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db)).rows[0];
            const profile = { contact_email: input.contact_email, contact_phone: input.contact_phone };
            if (previous.contact_email === profile.contact_email && previous.contact_phone === profile.contact_phone)
                throw new BadRequestException("Change the contact details before saving.");
            await sql `UPDATE school_people SET contact_email=${input.contact_email},contact_phone=${input.contact_phone},revision=revision+1
          WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db);
            await sql `INSERT INTO people_profile_history(school_id,person_id,revision,previous_value,current_value,reason,actor_id,recorded_at)
          VALUES(${schoolId}::uuid,${id}::uuid,${input.expected_revision + 1},${JSON.stringify(previous)}::jsonb,${JSON.stringify(profile)}::jsonb,
            ${input.reason},${req.authUser.id}::uuid,${executionNow().toISOString()}::timestamptz)`.execute(db);
            return { id, revision: input.expected_revision + 1, profile };
        });
    }
    async resolvePerson(user, schoolId, raw) {
        const input = z.object({ source_kind: z.enum(["student", "staff", "guardian"]), source_id: uuid }).strict().parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            if (input.source_kind === "staff" && (await effectiveSchoolAccess(db, user.id, schoolId)).role !== "admin")
                throw new NotFoundException("Work profile not available in this scope.");
            const result = input.source_kind === "student" ? await sql `SELECT person_id FROM students WHERE school_id=${schoolId}::uuid AND id=${input.source_id}::uuid`.execute(db)
                : input.source_kind === "staff" ? await sql `SELECT person_id FROM staff_profiles WHERE school_id=${schoolId}::uuid AND id=${input.source_id}::uuid`.execute(db)
                    : await sql `SELECT person_id FROM guardian_school_profiles WHERE school_id=${schoolId}::uuid AND guardian_id=${input.source_id}::uuid`.execute(db);
            const resultRow = result.rows[0];
            if (!resultRow)
                throw new NotFoundException("The source record has no person in this institution.");
            await this.person(db, schoolId, resultRow.person_id);
            return resultRow;
        });
    }
    async personGroups(user, schoolId, id, raw) {
        uuid.parse(id);
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            await this.person(db, schoolId, id);
            const date = await this.today(db, schoolId);
            const administrator = (await effectiveSchoolAccess(db, user.id, schoolId)).role === "admin";
            const result = (await sql `
        WITH memberships AS (
          SELECT g.id,'participation'::text AS kind,g.name,m.starts_on::text,m.ends_on::text
          FROM participation_group_members m JOIN participation_groups g ON g.id=m.group_id AND g.school_id=m.school_id
          WHERE m.school_id=${schoolId}::uuid AND m.person_id=${id}::uuid AND g.is_active
            AND m.starts_on<=${date}::date AND (m.ends_on IS NULL OR m.ends_on>=${date}::date)
          UNION ALL SELECT c.id,'class','Class '||c.grade||c.section||' · '||c.academic_year,
            min(greatest(e.enrolled_on,term.starts_on))::text,
            max(least(COALESCE(e.inactive_from-1,term.ends_on),term.ends_on))::text
          FROM students student JOIN enrollments e ON e.student_id=student.id
          JOIN class_sections c ON c.id=e.class_section_id AND c.school_id=student.school_id
          JOIN academic_terms term ON term.id=e.term_id AND term.school_id=student.school_id
          WHERE student.school_id=${schoolId}::uuid AND student.person_id=${id}::uuid AND e.enrolled_on<=${date}::date
            AND (e.inactive_from IS NULL OR e.inactive_from>${date}::date)
            AND term.starts_on<=${date}::date AND term.ends_on>=${date}::date
          GROUP BY c.id,c.grade,c.section,c.academic_year
          UNION ALL SELECT DISTINCT node.id,'organization',node.name,NULL::text,NULL::text
          FROM staff_profiles profile JOIN organization_node_members member ON member.school_id=profile.school_id AND member.staff_id=profile.id
          JOIN organization_nodes node ON node.school_id=member.school_id AND node.id=member.node_id
          WHERE profile.school_id=${schoolId}::uuid AND profile.person_id=${id}::uuid AND ${administrator}
        ), page AS (SELECT * FROM memberships ORDER BY lower(name),kind,id LIMIT 25 OFFSET ${(input.page - 1) * 25})
        SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(name),kind,id) FROM page),'[]'::jsonb) AS results,
          (SELECT count(*)::int FROM memberships) AS total`.execute(db)).rows[0];
            return { results: result.results.map(row => ({ ...row, source_id: row.id,
                    href: `/areas/people/groups/${row.id}${row.kind === "participation" ? "" : `?kind=${row.kind}`}` })),
                page: input.page, page_size: 25, total: result.total };
        });
    }
    async groupCatalogue(user, schoolId, raw) {
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            const administrator = (await effectiveSchoolAccess(db, user.id, schoolId)).role === "admin";
            const date = await this.today(db, schoolId), pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
            const result = await sql `
        WITH catalogue AS (
          SELECT g.id,'participation'::text AS kind,g.name,
            (SELECT count(*)::int FROM participation_group_members m JOIN school_people p ON p.school_id=m.school_id AND p.id=m.person_id
              WHERE m.school_id=g.school_id AND m.group_id=g.id AND p.retired_at IS NULL AND m.starts_on<=${date}::date AND (m.ends_on IS NULL OR m.ends_on>=${date}::date)) AS member_count,
            (SELECT jsonb_build_object('id',parent.id,'name',parent.name) FROM participation_group_parents edge
              JOIN participation_groups parent ON parent.school_id=edge.school_id AND parent.id=edge.parent_group_id
              WHERE edge.school_id=g.school_id AND edge.group_id=g.id AND edge.starts_on<=${date}::date AND (edge.ends_on IS NULL OR edge.ends_on>=${date}::date)
              ORDER BY edge.starts_on DESC LIMIT 1) AS parent FROM participation_groups g WHERE g.school_id=${schoolId}::uuid AND g.is_active
          UNION ALL SELECT c.id,'class','Class '||c.grade||c.section||' · '||c.academic_year,
            (SELECT count(DISTINCT student.person_id)::int FROM enrollments e JOIN students student ON student.id=e.student_id AND student.school_id=c.school_id
              JOIN school_people person ON person.school_id=student.school_id AND person.id=student.person_id AND person.retired_at IS NULL
              JOIN academic_terms term ON term.id=e.term_id AND term.school_id=c.school_id
              WHERE e.class_section_id=c.id AND e.enrolled_on<=${date}::date AND (e.inactive_from IS NULL OR e.inactive_from>${date}::date)
                AND term.starts_on<=${date}::date AND term.ends_on>=${date}::date),NULL::jsonb
            FROM class_sections c WHERE c.school_id=${schoolId}::uuid
          UNION ALL SELECT n.id,'organization',n.name,
            (SELECT count(DISTINCT profile.person_id)::int FROM organization_node_members member JOIN staff_profiles profile
              ON profile.school_id=member.school_id AND profile.id=member.staff_id
              JOIN school_people person ON person.school_id=profile.school_id AND person.id=profile.person_id AND person.retired_at IS NULL
              WHERE member.school_id=n.school_id AND member.node_id=n.id),
            (SELECT jsonb_build_object('id',parent.id,'name',parent.name) FROM organization_nodes parent WHERE parent.school_id=n.school_id AND parent.id=n.parent_id)
            FROM organization_nodes n WHERE n.school_id=${schoolId}::uuid AND ${administrator}
        ), filtered AS (SELECT * FROM catalogue WHERE name ILIKE ${pattern}), page AS (
          SELECT * FROM filtered ORDER BY lower(name),kind,id LIMIT 25 OFFSET ${(input.page - 1) * 25}
        ) SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(name),kind,id) FROM page),'[]'::jsonb) AS results,
          (SELECT count(*)::int FROM filtered) AS total`.execute(db);
            return { results: result.rows[0].results.map(row => ({ ...row, source_id: row.id,
                    href: `/areas/people/groups/${row.id}${row.kind === "participation" ? "" : `?kind=${row.kind}`}` })),
                total: result.rows[0].total, page: input.page, page_size: 25 };
        });
    }
    async nativeGroup(user, schoolId, rawKind, id, raw) {
        const kind = z.enum(["class", "organization"]).parse(rawKind);
        uuid.parse(id);
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            if (kind === "organization" && (await effectiveSchoolAccess(db, user.id, schoolId)).role !== "admin")
                throw new NotFoundException("Organization group is not available in this scope.");
            const date = await this.today(db, schoolId);
            const source = kind === "class" ? (await sql `SELECT 'Class '||grade||section||' · '||academic_year AS name FROM class_sections WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db)).rows[0]
                : (await sql `SELECT name FROM organization_nodes WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db)).rows[0];
            if (!source)
                throw new NotFoundException("Group not found in this institution.");
            const membersQuery = kind === "class" ? sql `SELECT DISTINCT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS label
        FROM enrollments e JOIN students student ON student.id=e.student_id AND student.school_id=${schoolId}::uuid
        JOIN school_people p ON p.school_id=student.school_id AND p.id=student.person_id
        JOIN academic_terms term ON term.id=e.term_id AND term.school_id=student.school_id
        WHERE e.class_section_id=${id}::uuid AND p.retired_at IS NULL AND e.enrolled_on<=${date}::date
          AND (e.inactive_from IS NULL OR e.inactive_from>${date}::date) AND term.starts_on<=${date}::date AND term.ends_on>=${date}::date`
                : sql `SELECT DISTINCT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS label FROM organization_node_members member
          JOIN staff_profiles profile ON profile.school_id=member.school_id AND profile.id=member.staff_id
          JOIN school_people p ON p.school_id=profile.school_id AND p.id=profile.person_id WHERE member.school_id=${schoolId}::uuid
            AND member.node_id=${id}::uuid AND p.retired_at IS NULL`;
            const result = (await sql `WITH members AS (${membersQuery}),
        page AS (SELECT * FROM members ORDER BY lower(label),person_id LIMIT 25 OFFSET ${(input.page - 1) * 25})
        SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(label),person_id) FROM page),'[]'::jsonb) AS members,
          (SELECT count(*)::int FROM members) AS total`.execute(db)).rows[0];
            return { id, kind, name: source.name, members: result.members, member_count: result.total, total: result.total,
                page: input.page, page_size: 25, source_href: kind === "organization" ? "/more/setup/organization" : null };
        });
    }
    async groupDetail(user, schoolId, id, raw) {
        uuid.parse(id);
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            const group = (await sql `SELECT id,name,revision,is_active FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND is_active`.execute(db)).rows[0];
            if (!group)
                throw new NotFoundException("Group not found in this institution.");
            const date = await this.today(db, schoolId);
            const memberIds = (await sql `SELECT m.person_id FROM participation_group_members m JOIN school_people p ON p.school_id=m.school_id AND p.id=m.person_id
        WHERE m.school_id=${schoolId}::uuid AND m.group_id=${id}::uuid AND p.retired_at IS NULL AND m.starts_on<=${date}::date
          AND (m.ends_on IS NULL OR m.ends_on>=${date}::date) ORDER BY m.person_id LIMIT 2001`.execute(db)).rows.map(row => row.person_id);
            if (memberIds.length > 2000)
                throw new ConflictException("This group's membership exceeds the supported edit capacity.");
            const members = (await sql `SELECT m.person_id,
        trim(concat_ws(' ',p.first_name,p.last_name)) AS label,m.starts_on::text,m.ends_on::text FROM participation_group_members m
        JOIN school_people p ON p.school_id=m.school_id AND p.id=m.person_id WHERE m.school_id=${schoolId}::uuid AND m.group_id=${id}::uuid
          AND p.retired_at IS NULL AND m.starts_on<=${date}::date AND (m.ends_on IS NULL OR m.ends_on>=${date}::date)
        ORDER BY lower(p.first_name),lower(p.last_name),p.id LIMIT 25 OFFSET ${(input.page - 1) * 25}`.execute(db)).rows;
            const parentHistory = (await sql `SELECT p.id,p.parent_group_id,g.name AS parent_name,p.starts_on::text,p.ends_on::text,p.revision,
        COALESCE((SELECT reason FROM people_relationship_history h WHERE h.school_id=p.school_id AND h.source_kind='group_parent'
          AND h.source_id=p.group_id AND h.effective_on=p.starts_on ORDER BY revision DESC LIMIT 1),'Retained group structure') AS reason
        FROM participation_group_parents p JOIN participation_groups g ON g.school_id=p.school_id AND g.id=p.parent_group_id
        WHERE p.school_id=${schoolId}::uuid AND p.group_id=${id}::uuid ORDER BY p.starts_on DESC,p.id LIMIT 25`.execute(db)).rows;
            const activeParent = (await sql `SELECT edge.parent_group_id,parent.name AS parent_name,edge.starts_on::text
        FROM participation_group_parents edge JOIN participation_groups parent ON parent.school_id=edge.school_id AND parent.id=edge.parent_group_id
        WHERE edge.school_id=${schoolId}::uuid AND edge.group_id=${id}::uuid AND edge.starts_on<=${date}::date
          AND (edge.ends_on IS NULL OR edge.ends_on>=${date}::date) ORDER BY edge.starts_on DESC LIMIT 1`.execute(db)).rows[0];
            return { ...group, members, member_ids: memberIds, member_count: memberIds.length,
                parent: activeParent ? { id: activeParent.parent_group_id, name: activeParent.parent_name, starts_on: activeParent.starts_on } : null,
                parent_history: parentHistory, page: input.page, page_size: 25, total: memberIds.length, capabilities: { can_manage: true } };
        });
    }
    async connections(user, schoolId, id, raw) {
        uuid.parse(id);
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            await this.person(db, schoolId, id);
            const today = await this.today(db, schoolId);
            const result = (await sql `WITH connections AS (
        SELECT c.id,c.revision,c.connection_type AS type,
          CASE WHEN c.source_person_id=${id}::uuid THEN 'outgoing' ELSE 'incoming' END AS direction,
          jsonb_build_object('id',p.id,'label',trim(concat_ws(' ',p.first_name,p.last_name))) AS related_person,
          c.starts_on::text,c.ends_on::text,'people'::text AS source_kind,NULL::text AS source_href,
          (c.ends_on IS NULL OR c.ends_on>${today}::date) AS can_end,
          COALESCE((SELECT jsonb_agg(to_jsonb(change) ORDER BY revision DESC) FROM (
            SELECT revision,effective_on::text,reason,recorded_at FROM people_relationship_history h
            WHERE h.school_id=c.school_id AND h.source_kind='mentor' AND h.source_id=c.id ORDER BY revision DESC LIMIT 10) change),'[]'::jsonb) AS history
        FROM person_connections c JOIN school_people p ON p.school_id=c.school_id
          AND p.id=CASE WHEN c.source_person_id=${id}::uuid THEN c.target_person_id ELSE c.source_person_id END
        WHERE c.school_id=${schoolId}::uuid AND (c.source_person_id=${id}::uuid OR c.target_person_id=${id}::uuid)
        UNION ALL SELECT relationship.id,relationship.authority_revision,'guardian_of',
          CASE WHEN guardian.person_id=${id}::uuid THEN 'outgoing' ELSE 'incoming' END,
          jsonb_build_object('id',related.id,'label',trim(concat_ws(' ',related.first_name,related.last_name))),
          NULL::text,NULL::text,'guardian','/areas/people/records?student='||student.id::text||'&guardian='||relationship.id::text,
          false,'[]'::jsonb FROM guardian_relationships relationship
        JOIN students student ON student.school_id=relationship.school_id AND student.id=relationship.student_id
        JOIN guardian_school_profiles guardian ON guardian.school_id=relationship.school_id AND guardian.guardian_id=relationship.guardian_id
        JOIN school_people related ON related.school_id=relationship.school_id
          AND related.id=CASE WHEN guardian.person_id=${id}::uuid THEN student.person_id ELSE guardian.person_id END
        WHERE relationship.school_id=${schoolId}::uuid AND (guardian.person_id=${id}::uuid OR student.person_id=${id}::uuid)
      ), page AS (SELECT * FROM connections ORDER BY starts_on DESC NULLS LAST,id LIMIT 25 OFFSET ${(input.page - 1) * 25})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY starts_on DESC NULLS LAST,id) FROM page),'[]'::jsonb) AS results,
        (SELECT count(*)::int FROM connections) AS total`.execute(db)).rows[0];
            return { results: result.results, page: input.page, page_size: 25, total: result.total };
        });
    }
    async groupMembershipHistory(user, schoolId, id, raw) {
        uuid.parse(id);
        const input = paging.parse(raw);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, schoolId);
            const group = (await sql `SELECT id FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db)).rows[0];
            if (!group)
                throw new NotFoundException("Group not found in this institution.");
            const result = (await sql `
        WITH history AS (SELECT m.id,m.person_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS label,m.starts_on::text,m.ends_on::text,m.revision,m.recorded_at
          FROM participation_group_members m JOIN school_people p ON p.school_id=m.school_id AND p.id=m.person_id
          WHERE m.school_id=${schoolId}::uuid AND m.group_id=${id}::uuid), page AS (
          SELECT * FROM history ORDER BY starts_on DESC,id LIMIT 25 OFFSET ${(input.page - 1) * 25})
        SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY starts_on DESC,id) FROM page),'[]'::jsonb) AS results,
          (SELECT count(*)::int FROM history) AS total`.execute(db)).rows[0];
            return { results: result.results, total: result.total, page: input.page, page_size: 25 };
        });
    }
    async createConnection(req, schoolId, personId, raw) {
        uuid.parse(personId);
        const input = connectionCreateSchema.parse(raw);
        const id = randomUUID();
        if (personId === input.target_person_id)
            throw new BadRequestException("Choose another person for this connection.");
        const subject = { kind: "person_connection", domain: "people", domain_id: id, label: "Mentoring connection", lifecycle_state: "active", source_revision: 1, metadata: {} };
        return this.command(req, schoolId, input.idempotency_key, { person_id: personId, ...input }, subject, 0, async (db, prepared) => {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`people-connections:${schoolId}`},0))`.execute(db);
            const source = await this.person(db, schoolId, personId), target = await this.person(db, schoolId, input.target_person_id);
            if (input.starts_on < await this.today(db, schoolId))
                throw new BadRequestException("Use today or a future connection date; historical connections are retained.");
            const overlap = (await sql `SELECT EXISTS(SELECT 1 FROM person_connections WHERE school_id=${schoolId}::uuid
        AND source_person_id=${personId}::uuid AND target_person_id=${input.target_person_id}::uuid AND connection_type='mentor_of'
        AND daterange(starts_on,ends_on+1,'[)') && daterange(${input.starts_on}::date,${input.ends_on}::date+1,'[)')) AS exists`.execute(db)).rows[0].exists;
            if (overlap)
                throw new ConflictException("This mentoring connection already overlaps that date range.");
            await sql `INSERT INTO person_connections(id,school_id,source_person_id,target_person_id,connection_type,starts_on,ends_on,created_by,recorded_at)
        VALUES(${id}::uuid,${schoolId}::uuid,${personId}::uuid,${input.target_person_id}::uuid,'mentor_of',${input.starts_on}::date,${input.ends_on}::date,
          ${req.authUser.id}::uuid,${executionNow().toISOString()}::timestamptz)`.execute(db);
            await this.projection.projectPeopleRelationships(db, { school_id: schoolId, actor_user_id: req.authUser.id, command_id: prepared.command_id,
                prepared_request_hash: prepared.request_hash, subject, edges: [{ relation_type: "mentor_of", source_record_id: id, source_revision: 1,
                        source: this.entity(source), target: this.entity(target), ...await this.interval(db, schoolId, input.starts_on, input.ends_on) }] });
            await this.history(db, req, schoolId, "mentor", id, 1, input.starts_on, input.reason, { source_person_id: personId, target_person_id: input.target_person_id, ends_on: input.ends_on });
            return { id, revision: 1 };
        });
    }
    async endConnection(req, schoolId, id, raw) {
        uuid.parse(id);
        const input = connectionEndSchema.parse(raw);
        const subject = { kind: "person_connection", domain: "people", domain_id: id, label: "Mentoring connection", lifecycle_state: "active", source_revision: input.expected_revision + 1, metadata: {} };
        return this.command(req, schoolId, input.idempotency_key, { id, ...input }, subject, input.expected_revision, async (db, prepared) => {
            const row = (await sql `SELECT source_person_id,target_person_id,starts_on::text,ends_on::text,revision
        FROM person_connections WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db)).rows[0];
            if (!row)
                throw new NotFoundException("Connection not found in this institution.");
            if (row.revision !== input.expected_revision)
                throw new ConflictException("This connection changed. Refresh before ending it.");
            if (input.ends_on < await this.today(db, schoolId) || input.ends_on < row.starts_on || (row.ends_on && input.ends_on >= row.ends_on)) {
                throw new BadRequestException("Choose today or a future end on or after the start, earlier than its current end.");
            }
            const source = await this.person(db, schoolId, row.source_person_id), target = await this.person(db, schoolId, row.target_person_id);
            await sql `UPDATE person_connections SET ends_on=${input.ends_on}::date,revision=revision+1 WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db);
            await this.projection.projectPeopleRelationships(db, { school_id: schoolId, actor_user_id: req.authUser.id, command_id: prepared.command_id,
                prepared_request_hash: prepared.request_hash, subject, edges: [{ relation_type: "mentor_of", source_record_id: id, source_revision: input.expected_revision + 1,
                        source: this.entity(source), target: this.entity(target), ...await this.interval(db, schoolId, row.starts_on, input.ends_on) }] });
            await this.history(db, req, schoolId, "mentor", id, input.expected_revision + 1, input.ends_on, input.reason, { previous_ends_on: row.ends_on, ends_on: input.ends_on });
            return { id, revision: input.expected_revision + 1, ends_on: input.ends_on };
        });
    }
    async moveGroup(req, schoolId, id, raw) {
        uuid.parse(id);
        const input = groupParentSchema.parse(raw);
        if (input.parent_group_id === id)
            throw new BadRequestException("A group cannot contain itself.");
        await this.authorize(this.db, req.authUser, schoolId);
        const group = (await sql `SELECT id,name,revision,is_active FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${id}::uuid AND is_active`.execute(this.db)).rows[0];
        if (!group)
            throw new NotFoundException("Group not found in this institution.");
        const subject = { ...this.entity(group), source_revision: input.expected_revision + 1 };
        return this.command(req, schoolId, input.idempotency_key, { id, ...input }, subject, input.expected_revision, async (db, prepared) => {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`people-group-structure:${schoolId}`},0))`.execute(db);
            const current = (await sql `SELECT id,name,revision,is_active FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${id}::uuid FOR UPDATE`.execute(db)).rows[0];
            if (current.revision !== input.expected_revision)
                throw new ConflictException("This group changed. Refresh before moving it.");
            if (input.effective_on < await this.today(db, schoolId))
                throw new BadRequestException("Use today or a future move date; prior group structure is retained.");
            const parent = input.parent_group_id ? (await sql `SELECT id,name,revision,is_active FROM participation_groups
        WHERE school_id=${schoolId}::uuid AND id=${input.parent_group_id}::uuid AND is_active FOR SHARE`.execute(db)).rows[0] : null;
            if (input.parent_group_id && !parent)
                throw new BadRequestException("Choose an active parent group from this institution.");
            const existing = (await sql `SELECT id,parent_group_id,starts_on::text,ends_on::text,revision
        FROM participation_group_parents WHERE school_id=${schoolId}::uuid AND group_id=${id}::uuid AND (ends_on IS NULL OR ends_on>=${input.effective_on}::date)
        ORDER BY starts_on FOR UPDATE`.execute(db)).rows;
            if (existing.some(row => row.starts_on >= input.effective_on))
                throw new ConflictException("A move already starts on or after this date. Choose a later date instead of rewriting it.");
            if ((existing[0]?.parent_group_id ?? null) === input.parent_group_id)
                throw new BadRequestException("Choose a different parent before saving a move.");
            // Traverse interval intersections, including future moves: a cycle that only
            // exists next month is still a cycle. UNION/path bounds make malformed data fail closed.
            if (parent) {
                const cycle = (await sql `WITH RECURSIVE ancestors(group_id,from_date,until_date,path,cycle) AS (
          SELECT ${parent.id}::uuid,${input.effective_on}::date,NULL::date,ARRAY[${parent.id}::uuid],false
          UNION ALL SELECT edge.parent_group_id,greatest(a.from_date,edge.starts_on),least(a.until_date,edge.ends_on),
            a.path||edge.parent_group_id,edge.parent_group_id=ANY(a.path)
          FROM ancestors a JOIN participation_group_parents edge ON edge.school_id=${schoolId}::uuid AND edge.group_id=a.group_id
            AND edge.group_id<>${id}::uuid AND daterange(edge.starts_on,edge.ends_on+1,'[)') && daterange(a.from_date,a.until_date+1,'[)')
          WHERE NOT a.cycle AND cardinality(a.path)<=64
        ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE group_id=${id}::uuid OR cycle OR cardinality(path)>64) AS invalid`.execute(db)).rows[0].invalid;
                if (cycle)
                    throw new ConflictException("This move would create a group cycle, including a future dated move.");
            }
            const edges = [];
            for (const prior of existing) {
                await sql `UPDATE participation_group_parents SET ends_on=${input.effective_on}::date-1,revision=revision+1 WHERE id=${prior.id}::uuid AND school_id=${schoolId}::uuid`.execute(db);
                const oldParent = (await sql `SELECT id,name,revision,is_active FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${prior.parent_group_id}::uuid`.execute(db)).rows[0];
                const dates = (await sql `SELECT (${input.effective_on}::date-1)::text AS end`.execute(db)).rows[0];
                edges.push({ relation_type: "part_of", source_record_id: prior.id, source_revision: prior.revision + 1, source: subject, target: this.entity(oldParent), ...await this.interval(db, schoolId, prior.starts_on, dates.end) });
            }
            if (parent) {
                const parentId = randomUUID();
                await sql `INSERT INTO participation_group_parents(id,school_id,group_id,parent_group_id,starts_on,created_by,recorded_at)
          VALUES(${parentId}::uuid,${schoolId}::uuid,${id}::uuid,${parent.id}::uuid,${input.effective_on}::date,${req.authUser.id}::uuid,${executionNow().toISOString()}::timestamptz)`.execute(db);
                edges.push({ relation_type: "part_of", source_record_id: parentId, source_revision: 1, source: subject, target: this.entity(parent), ...await this.interval(db, schoolId, input.effective_on, null) });
            }
            await sql `UPDATE participation_groups SET revision=revision+1 WHERE school_id=${schoolId}::uuid AND id=${id}::uuid`.execute(db);
            await this.projection.projectPeopleRelationships(db, { school_id: schoolId, actor_user_id: req.authUser.id, command_id: prepared.command_id,
                prepared_request_hash: prepared.request_hash, subject, edges });
            await this.history(db, req, schoolId, "group_parent", id, input.expected_revision + 1, input.effective_on, input.reason, { parent_group_id: input.parent_group_id, previous_parent_group_id: existing[0]?.parent_group_id ?? null });
            return { id, revision: input.expected_revision + 1, parent_group_id: input.parent_group_id, effective_on: input.effective_on };
        });
    }
};
ParticipationPeopleService = __decorate([
    Injectable(),
    __param(2, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(3, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(4, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(5, Inject(PEOPLE_RELATIONSHIP_PROJECTION_PORT)),
    __metadata("design:paramtypes", [DatabaseService, SchoolEventService, Object, Object, Object, Object])
], ParticipationPeopleService);
export { ParticipationPeopleService };
//# sourceMappingURL=participation-people.service.js.map