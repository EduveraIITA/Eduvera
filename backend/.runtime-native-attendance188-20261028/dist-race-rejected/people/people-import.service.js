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
import { executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermission } from "../roles/authorization.js";
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { IMPORT_COLUMNS, csvCell, guardianChoiceSchema, parseImportCsv, valuesSchema } from "./import-csv.js";
import { validateImport } from "./import-validation.js";
import { saveValidatedImport } from "./import-writer.js";
import { HUMAN_AGENT_IDENTITY_PORT } from '../campus-model-core/human-agent-identity.port.js';
import { DOMAIN_COMMAND_GATEWAY_PORT } from '../campus-model-core/domain-command-gateway.port.js';
import { DOMAIN_EVENT_JOURNAL_PORT } from '../campus-model-core/domain-event-journal.port.js';
import { prepareAttachmentBatch } from './person-attachment.js';
import { AcademicParticipationBridge } from '../attendance/academic-participation-bridge.service.js';
import { lockSchedule } from '../day-plans/schedule.js';
const uuid = z.string().uuid();
let PeopleImportService = class PeopleImportService {
    db;
    events;
    identity;
    gateway;
    journal;
    attendance;
    timer;
    cleaning = new Set();
    constructor(db, events, identity, gateway, journal, attendance) {
        this.db = db;
        this.events = events;
        this.identity = identity;
        this.gateway = gateway;
        this.journal = journal;
        this.attendance = attendance;
    }
    onModuleInit() { const run = () => void this.expireDrafts().catch(() => Logger.warn("Import retention cleanup will retry.", "PeopleImportService")); run(); this.timer = setInterval(run, 15 * 60 * 1000); this.timer.unref(); }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async expireDrafts() {
        const environment = executionEnvironmentStorage.getStore();
        if (environment?.kind === 'simulation' && environment.domain_read_only)
            return;
        const namespace = executionEnvironmentStorage.getStore()?.namespace_id ?? "live";
        if (this.cleaning.has(namespace))
            return;
        this.cleaning.add(namespace);
        try {
            await this.db.transaction().execute(async (db) => {
                const expired = (await sql `SELECT id FROM people_imports WHERE state='draft' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`.execute(db)).rows.map(r => r.id);
                if (!expired.length)
                    return;
                await sql `UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=ANY(${expired}::uuid[])`.execute(db);
                await sql `UPDATE people_imports SET state='expired',revision=revision+1,updated_at=now() WHERE id=ANY(${expired}::uuid[])`.execute(db);
            });
        }
        finally {
            this.cleaning.delete(namespace);
        }
    }
    async authorize(db, user, schoolId, lock = false) {
        uuid.parse(schoolId);
        await institutionSchoolPermission(db, user, schoolId, "sis.manage", lock);
    }
    async job(db, id, schoolId, lock = false) {
        const job = (await sql `SELECT * FROM people_imports WHERE id=${uuid.parse(id)}::uuid AND school_id=${uuid.parse(schoolId)}::uuid ${lock ? sql `FOR UPDATE` : sql ``}`.execute(db)).rows[0];
        if (!job)
            throw new NotFoundException("Import not found in this school.");
        return job;
    }
    async rows(db, id) { return (await sql `SELECT row_number,raw_values AS "values",decision,guardian_choice,student_id FROM people_import_rows WHERE import_id=${id}::uuid ORDER BY row_number`.execute(db)).rows; }
    async audit(db, req, schoolId, id, action, metadata) { await db.insertInto("audit_events").values({ school_id: schoolId, actor_id: req.authUser.id, action, target_type: "people_import", target_id: id, request_id: req.requestId, ip_hash: null, metadata }).execute(); }
    async notifyAdministrators(db, schoolId, id, revision) {
        const audience = (await sql `SELECT DISTINCT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active WHERE m.school_id=${schoolId}::uuid AND m.role='admin' AND m.is_active`.execute(db)).rows.map(r => r.user_id);
        await this.events.enqueueUserEvent(db, { schoolId, eventType: "people.updated", aggregateType: "people_import", aggregateId: id, audienceUserIds: audience,
            idempotencyKey: `import-draft:${id}:${revision}`, payload: { import_id: id, revision, refresh: ["people"] } });
    }
    ensureDraft(job, revision) { if (job.state !== 'draft')
        throw new ConflictException("This import is no longer editable."); if (new Date(job.expires_at).getTime() <= executionNow().getTime())
        throw new ConflictException("This import expired. Upload a new file."); if (job.revision !== revision)
        throw new ConflictException("This import changed. Reload the latest review before continuing."); }
    async template(user, schoolId) { await this.authorize(this.db, user, schoolId); return `${IMPORT_COLUMNS.join(",")}\r\n`; }
    async list(user, query) {
        const input = z.object({ school_id: uuid, cursor: uuid.optional() }).parse(query);
        await this.authorize(this.db, user, input.school_id);
        await this.expireDrafts();
        const results = (await sql `SELECT i.id,i.filename,i.state,i.revision,i.row_count,i.created_at,i.expires_at,i.committed_at,t.name AS term_name,
      concat_ws(' ',u.first_name,u.last_name) AS created_by_name,i.receipt-'enrolled' AS summary
      FROM people_imports i JOIN academic_terms t ON t.id=i.term_id JOIN users u ON u.id=i.created_by
      WHERE i.school_id=${input.school_id}::uuid AND (${input.cursor ?? null}::uuid IS NULL OR (i.created_at,i.id)<(SELECT c.created_at,c.id FROM people_imports c WHERE c.id=${input.cursor ?? null}::uuid AND c.school_id=${input.school_id}::uuid))
      ORDER BY i.created_at DESC,i.id DESC LIMIT 21`.execute(this.db)).rows;
        return { results: results.slice(0, 20), next_cursor: results.length > 20 ? results[19].id : null };
    }
    async stage(req, body) {
        const input = z.object({ school_id: uuid, term_id: uuid, filename: z.string().trim().min(1).max(150).refine(v => [...v].every(c => c.charCodeAt(0) >= 32 && c !== "/" && c !== "\\"), "Use a filename without control characters or path separators."), csv: z.string().max(512 * 1024), idempotency_key: uuid }).strict().parse(body);
        await this.authorize(this.db, req.authUser, input.school_id);
        const rows = parseImportCsv(input.csv);
        const digest = createHash("sha256").update(input.csv).digest("hex");
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, req.authUser, input.school_id, true);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`import-upload:${input.school_id}:${req.authUser.id}:${input.idempotency_key}`},0))`.execute(db);
            const existing = (await sql `SELECT id,source_digest,term_id,filename FROM people_imports WHERE school_id=${input.school_id}::uuid AND created_by=${req.authUser.id}::uuid AND upload_key=${input.idempotency_key}::uuid`.execute(db)).rows[0];
            if (existing) {
                if (existing.source_digest !== digest || existing.term_id !== input.term_id || existing.filename !== input.filename)
                    throw new ConflictException("This upload key was used for a different file.");
                return { id: existing.id };
            }
            if (!(await sql `SELECT id FROM academic_terms WHERE id=${input.term_id}::uuid AND school_id=${input.school_id}::uuid AND is_active FOR SHARE`.execute(db)).rows.length)
                throw new BadRequestException("Select an active academic term in this school.");
            const job = (await sql `INSERT INTO people_imports(school_id,term_id,created_by,filename,row_count,upload_key,source_digest) VALUES(${input.school_id}::uuid,${input.term_id}::uuid,${req.authUser.id}::uuid,${input.filename},${rows.length},${input.idempotency_key}::uuid,${digest}) RETURNING id`.execute(db)).rows[0];
            await sql `INSERT INTO people_import_rows(school_id,import_id,row_number,raw_values) SELECT ${input.school_id}::uuid,${job.id}::uuid,(ordinality+1)::int,value FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) WITH ORDINALITY`.execute(db);
            await this.audit(db, req, input.school_id, job.id, "people.import.staged", { row_count: rows.length, term_id: input.term_id });
            await this.notifyAdministrators(db, input.school_id, job.id, 1);
            return job;
        });
    }
    async detail(user, id, schoolId) {
        await this.authorize(this.db, user, schoolId);
        const environment = executionEnvironmentStorage.getStore();
        const readOnly = environment?.kind === 'simulation' && environment.domain_read_only;
        // Directly purge this authorized expired draft, even when the background queue is busy.
        if (!readOnly)
            await this.db.transaction().execute(async (db) => {
                const job = await this.job(db, id, schoolId, true);
                if (job.state === 'draft' && new Date(job.expires_at).getTime() <= executionNow().getTime()) {
                    await sql `UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=${id}::uuid`.execute(db);
                    await sql `UPDATE people_imports SET state='expired',revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(db);
                    await db.insertInto("audit_events").values({ school_id: schoolId, actor_id: null, action: "people.import.expired", target_type: "people_import", target_id: id, request_id: randomUUID(), ip_hash: null, metadata: {} }).execute();
                }
            });
        // One repeatable snapshot prevents row edits from being paired with an older revision.
        return this.db.transaction().setIsolationLevel("repeatable read").execute(async (db) => {
            const job = await this.job(db, id, schoolId);
            const summary = { id: job.id, filename: job.filename, state: job.state, revision: job.revision, row_count: job.row_count, created_at: job.created_at, expires_at: job.expires_at, receipt: job.receipt };
            if (job.state !== 'draft' || new Date(job.expires_at).getTime() <= executionNow().getTime())
                return { ...summary, state: job.state === 'draft' ? 'expired' : job.state, review: null };
            return { ...summary, review: await validateImport(db, job, await this.rows(db, id)) };
        });
    }
    async updateRow(req, id, rowNumber, body) {
        const input = z.object({ school_id: uuid, expected_revision: z.number().int().positive(), values: valuesSchema, decision: z.enum(['include', 'skip']), guardian_choice: guardianChoiceSchema }).strict().parse(body);
        z.number().int().min(2).max(501).parse(rowNumber);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, req.authUser, input.school_id, true);
            const job = await this.job(db, id, input.school_id, true);
            this.ensureDraft(job, input.expected_revision);
            const updated = await sql `UPDATE people_import_rows SET raw_values=${JSON.stringify(input.values)}::jsonb,decision=${input.decision},guardian_choice=${JSON.stringify(input.guardian_choice)}::jsonb WHERE import_id=${id}::uuid AND row_number=${rowNumber} RETURNING row_number`.execute(db);
            if (!updated.rows.length)
                throw new NotFoundException("Import row not found.");
            await sql `UPDATE people_imports SET revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(db);
            await this.audit(db, req, input.school_id, id, "people.import.row_updated", { row_number: rowNumber, revision: job.revision + 1, decision: input.decision, guardian_mode: input.guardian_choice.mode });
            await this.notifyAdministrators(db, input.school_id, id, job.revision + 1);
            return { revision: job.revision + 1 };
        });
    }
    async cancel(req, id, body) {
        const input = z.object({ school_id: uuid, expected_revision: z.number().int().positive() }).strict().parse(body);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, req.authUser, input.school_id, true);
            const job = await this.job(db, id, input.school_id, true);
            if (job.state === 'cancelled')
                return { state: 'cancelled' };
            this.ensureDraft(job, input.expected_revision);
            await sql `UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=${id}::uuid`.execute(db);
            await sql `UPDATE people_imports SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(db);
            await this.audit(db, req, input.school_id, id, "people.import.cancelled", { revision: job.revision + 1 });
            await this.notifyAdministrators(db, input.school_id, id, job.revision + 1);
            return { state: 'cancelled' };
        });
    }
    async commit(req, id, body) {
        const input = z.object({ school_id: uuid, expected_revision: z.number().int().positive(), validation_token: z.string().regex(/^[a-f0-9]{64}$/), verified: z.literal(true) }).strict().parse(body);
        try {
            return await this.db.transaction().execute(async (db) => {
                await sql `SET LOCAL lock_timeout='5s'`.execute(db);
                await sql `SET LOCAL statement_timeout='20s'`.execute(db);
                await this.authorize(db, req.authUser, input.school_id, true);
                const job = await this.job(db, id, input.school_id, true);
                const ports = this.identity && this.gateway && this.journal ? { identity: this.identity, gateway: this.gateway, journal: this.journal } : undefined;
                if (ports) {
                    const actor = await ports.identity.resolveAccountEndpoint(db, { school_id: input.school_id, user_id: req.authUser.id, at: executionNow().toISOString() });
                    if (!actor.acting)
                        throw new ConflictException('Current campus app access is required.');
                }
                if (job.state === 'committed') {
                    if (job.commit_token !== input.validation_token || job.revision !== input.expected_revision + 1)
                        throw new ConflictException("This import was committed from a different review.");
                    return job.receipt;
                }
                this.ensureDraft(job, input.expected_revision);
                const rows = await this.rows(db, id);
                await lockSchedule(db, job.school_id);
                const referencedPeople = [...new Set(rows.filter(row => row.decision === 'include').flatMap(row => [row.values.person_id, row.values.guardian_person_id,
                        row.guardian_choice.mode === 'person' ? row.guardian_choice.person_id : undefined]).filter((value) => uuid.safeParse(value).success))];
                if (referencedPeople.length && !ports)
                    throw new ConflictException('The reviewed existing-person import path is unavailable.');
                // Same lock order as individual enrollment: admission, classes, term, guardians, registers.
                const admissions = [...new Set(rows.filter(r => r.decision === 'include').map(r => r.values.admission_number.toUpperCase()))].sort();
                await sql `SELECT pg_advisory_xact_lock(hashtextextended(key,0)) FROM (SELECT unnest(${admissions.map(admission => `admission:${job.school_id}:${admission}`)}::text[]) AS key ORDER BY key OFFSET 0) ordered_keys`.execute(db);
                if (referencedPeople.length)
                    await sql `SELECT id FROM school_people WHERE school_id=${job.school_id}::uuid AND id=ANY(${referencedPeople}::uuid[]) ORDER BY id FOR UPDATE`.execute(db);
                const preflight = await validateImport(db, job, rows);
                const classIds = [...new Set(preflight.rows.flatMap(r => r.normalized ? [r.normalized.class_section_id] : []))];
                await sql `SELECT c.id FROM class_sections c WHERE c.school_id=${job.school_id}::uuid AND c.id=ANY(${classIds}::uuid[]) ORDER BY c.id FOR UPDATE OF c`.execute(db);
                await sql `SELECT id FROM academic_terms WHERE id=${job.term_id}::uuid FOR SHARE`.execute(db);
                const guardians = rows.flatMap(r => r.decision === 'include' && r.guardian_choice.mode === 'existing' ? [r.guardian_choice.id] : []);
                await sql `SELECT p.id FROM parents p JOIN guardian_school_profiles gp ON gp.guardian_id=p.id JOIN school_people person ON person.id=gp.person_id WHERE gp.school_id=${job.school_id}::uuid AND p.id=ANY(${guardians}::uuid[]) ORDER BY p.id FOR UPDATE OF p FOR SHARE OF gp,person`.execute(db);
                await sql `SELECT register.id FROM activity_attendance_registers register
        JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
        WHERE register.school_id=${job.school_id}::uuid AND occurrence.term_id=${job.term_id}::uuid
          AND occurrence.source='academic' AND occurrence.context_ref=ANY(${classIds}::uuid[])
        ORDER BY register.id FOR UPDATE OF register`.execute(db);
                const review = await validateImport(db, job, rows);
                if (!review.summary.included || review.summary.errors)
                    throw new ConflictException("Resolve or skip every invalid row before importing. At least one valid row is required.");
                if (review.validation_token !== input.validation_token)
                    throw new ConflictException("School records changed since this review. Reload and check the updated results before confirming.");
                if (review.registers.length && !this.attendance)
                    throw new ConflictException('The canonical enrollment roster service is required.');
                const targetDates = new Map();
                for (const row of review.rows)
                    if (row.decision === 'include' && row.normalized) {
                        const value = row.normalized, prior = targetDates.get(value.class_section_id);
                        if (!prior || value.enrolled_on < prior.effective_on)
                            targetDates.set(value.class_section_id, { class_id: value.class_section_id, term_id: job.term_id, effective_on: value.enrolled_on });
                    }
                const prepared = ports ? await prepareAttachmentBatch(db, ports, { school_id: job.school_id, actor_id: req.authUser.id, target_id: job.id,
                    target_kind: 'people_import', label: 'Reviewed enrollment import', revision: job.revision, command_type: 'people.enrollment.import', source_domain: 'people',
                    key: `people-import:${job.id}`, correlation_id: job.id, request_hash: review.validation_token, permission: 'sis.manage', roster_targets: [...targetDates.values()] }) : undefined;
                if (prepared && this.attendance)
                    await this.attendance.prepareEnrollmentRostersInTransaction(db, req.authUser, job.school_id, { kind: 'import', review_id: job.id, command_id: prepared.command_id });
                return saveValidatedImport(db, this.events, req, job, review, ports && prepared ? { ports, prepared } : undefined, this.attendance);
            });
        }
        catch (error) {
            const code = error.code;
            if (['23505', '40001', '40P01', '55P03', '57014'].includes(code ?? ''))
                throw new ConflictException("Another school update conflicted with this import. Nothing from this attempt was saved; reload and review before retrying.");
            throw error;
        }
    }
    async report(user, id, schoolId) {
        const result = await this.detail(user, id, schoolId);
        if (result.review)
            return ["row,admission_number,student,decision,errors,warnings", ...result.review.rows.map(r => [r.row_number, r.values.admission_number, `${r.values.first_name} ${r.values.last_name}`.trim(), r.decision, r.errors.join(" | "), r.warnings.join(" | ")].map(csvCell).join(","))].join("\r\n");
        if (result.receipt)
            return ["row,admission_number,student_id", ...result.receipt.enrolled.map(r => [r.row_number, r.admission_number, r.student_id].map(csvCell).join(","))].join("\r\n");
        throw new ConflictException("Row details have been cleared for this closed import.");
    }
};
PeopleImportService = __decorate([
    Injectable(),
    __param(2, Optional()),
    __param(2, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(3, Optional()),
    __param(3, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(4, Optional()),
    __param(4, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(5, Optional()),
    __metadata("design:paramtypes", [DatabaseService, SchoolEventService, Object, Object, Object, AcademicParticipationBridge])
], PeopleImportService);
export { PeopleImportService };
//# sourceMappingURL=people-import.service.js.map