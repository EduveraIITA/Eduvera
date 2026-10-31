var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { assignmentId, learningOfferingCreate, learningOfferingEnroll, learningOfferingEnd, learningOfferingInstructor, learningOfferingReceipts } from "./learning-assignment.contracts.js";
import { LearningAssignmentContextService } from "./learning-assignment-context.service.js";
import { LearningAssignmentModelService } from "./learning-assignment-model.service.js";
const pageOf = (value) => { const page = Number(value ?? 1); if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new BadRequestException("Choose a valid page."); return page; };
/** Native learning responsibility, independent of descriptive People groups and school class/term records. */
let LearningOfferingsService = class LearningOfferingsService {
    db;
    context;
    model;
    constructor(db, context, model) {
        this.db = db;
        this.context = context;
        this.model = model;
    }
    async canSetup(tx, user, schoolId) {
        return Boolean(await tx.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst());
    }
    async summary(tx, user, school, source, manager) {
        const appointments = await tx.selectFrom("learning_offering_teaching_assignments as appointment").innerJoin("school_people as person", "person.id", "appointment.person_id")
            .select(["appointment.id", "appointment.person_id", "appointment.revision", "appointment.can_publish", "appointment.can_review", "person.first_name", "person.last_name"])
            .where("appointment.school_id", "=", school.id).where("appointment.offering_id", "=", source.id).where("appointment.starts_on", "<=", school.today)
            .where(eb => eb.or([eb("appointment.ends_on", "is", null), eb("appointment.ends_on", ">", school.today)])).orderBy("appointment.created_at").orderBy("appointment.id").execute();
        const own = appointments.filter(item => item.person_id === school.actor.person_id), current = appointments.find(item => item.can_publish) ?? appointments[0];
        const registration = await tx.selectFrom("learning_offering_enrollments").select(["id", "person_id", "revision"]).where("school_id", "=", school.id).where("offering_id", "=", source.id)
            .where("person_id", "=", school.actor.person_id).where("starts_on", "<=", school.today).where(eb => eb.or([eb("ends_on", "is", null), eb("ends_on", ">", school.today)])).executeTakeFirst();
        const count = manager || own.length ? (await sql `SELECT count(*)::int AS count FROM learning_offering_enrollments WHERE school_id=${school.id}::uuid AND offering_id=${source.id}::uuid
      AND starts_on<=${school.today}::date AND(ends_on IS NULL OR ends_on>${school.today}::date)`.execute(tx)).rows[0]?.count : undefined;
        return { ...source, can_manage: manager, can_publish: own.some(item => item.can_publish), can_review: own.some(item => item.can_review), own_enrollment: registration ?? null,
            current_instructor: current ? { id: current.id, person_id: current.person_id, name: `${current.first_name} ${current.last_name}`.trim(), revision: current.revision } : null,
            ...(count !== undefined ? { learner_count: count } : {}) };
    }
    async list(user, query = {}) {
        const page = pageOf(query.page), search = (query.search ?? "").trim();
        if (search.length > 150)
            throw new BadRequestException("Use a shorter search.");
        return this.db.transaction().execute(async (tx) => {
            const school = await this.context.account(tx, user), manager = await this.canSetup(tx, user, school.id);
            const person = await tx.selectFrom("school_people").select(["id", "first_name", "last_name", "revision"]).where("school_id", "=", school.id).where("id", "=", school.actor.person_id).executeTakeFirstOrThrow();
            const items = (await sql `SELECT offering.id,offering.name,offering.revision FROM learning_offerings offering
        WHERE offering.school_id=${school.id}::uuid AND offering.state='active' AND(${search}='' OR strpos(lower(offering.name),lower(${search}))>0)
          AND(${manager} OR EXISTS(SELECT 1 FROM learning_offering_teaching_assignments a WHERE a.school_id=offering.school_id AND a.offering_id=offering.id AND a.person_id=${person.id}::uuid
            AND a.starts_on<=${school.today}::date AND(a.ends_on IS NULL OR a.ends_on>${school.today}::date))
            OR EXISTS(SELECT 1 FROM learning_offering_enrollments e WHERE e.school_id=offering.school_id AND e.offering_id=offering.id AND e.person_id=${person.id}::uuid
              AND e.starts_on<=${school.today}::date AND(e.ends_on IS NULL OR e.ends_on>${school.today}::date))) ORDER BY offering.name,offering.id LIMIT 11 OFFSET ${(page - 1) * 10}`.execute(tx)).rows;
            return { can_create: manager, actor_person: { id: person.id, name: `${person.first_name} ${person.last_name}`.trim(), revision: person.revision }, today: school.today, timezone: school.timezone,
                items: await Promise.all(items.slice(0, 10).map(item => this.summary(tx, user, school, item, manager))), page, has_more: items.length > 10 };
        });
    }
    async detail(user, id) {
        assignmentId.parse(id);
        return this.db.transaction().execute(async (tx) => {
            const school = await this.context.account(tx, user), manager = await this.canSetup(tx, user, school.id);
            const source = await tx.selectFrom("learning_offerings").select(["id", "name", "revision", "created_at"]).where("school_id", "=", school.id).where("id", "=", id).where("state", "=", "active").executeTakeFirst();
            if (!source)
                throw new NotFoundException("Learning group unavailable.");
            const item = await this.summary(tx, user, school, { id: source.id, name: source.name, revision: source.revision }, manager);
            const historical = await tx.selectFrom("learning_assignment_audience as audience").innerJoin("learning_assignments as assignment", "assignment.id", "audience.assignment_id")
                .select("audience.person_id").where("audience.school_id", "=", school.id).where("audience.person_id", "=", school.actor.person_id).where("assignment.offering_id", "=", id).executeTakeFirst();
            if (!manager && !item.can_publish && !item.can_review && !item.own_enrollment && !historical)
                throw new ForbiddenException("This learning group is not available to your current account.");
            const roster = manager || item.can_publish || item.can_review;
            const enrollments = roster ? await tx.selectFrom("learning_offering_enrollments as registration").innerJoin("school_people as person", "person.id", "registration.person_id")
                .select(["registration.id", "registration.person_id", "registration.revision", "registration.starts_on", "registration.ends_on", "person.first_name", "person.last_name"])
                .where("registration.school_id", "=", school.id).where("registration.offering_id", "=", id).where("registration.ends_on", "is", null).orderBy("person.first_name").orderBy("person.id").limit(100).execute() : [];
            const first = await tx.selectFrom("learning_offering_teaching_assignments").select("starts_on").where("school_id", "=", school.id).where("offering_id", "=", id).orderBy("created_at").limit(1).executeTakeFirst();
            return { ...item, starts_on: first?.starts_on ?? school.today, today: school.today, timezone: school.timezone,
                enrollments: enrollments.map(({ first_name, last_name, ...row }) => ({ ...row, name: `${first_name} ${last_name}`.trim() })) };
        });
    }
    async people(tx, schoolId, refs, command) {
        // Stable lock order prevents competing roster/setup commands from deadlocking.
        const rows = await tx.selectFrom("school_people").select(["id", "revision", "account_user_id"]).where("school_id", "=", schoolId).where("id", "in", refs.map(ref => ref.id)).where(sql `retired_at IS NULL`).orderBy("id").forShare().execute();
        const obsolete = refs.find(ref => rows.some(row => row.id === ref.id && row.revision > ref.expected_revision));
        if (obsolete)
            throw new ConflictException({ code: "learning.offering_selection_obsolete", message: "A selected person changed. Review your selection before continuing.",
                fields: { offering_obsolete: { code: "learning.offering_selection_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.offerings",
                        ...command, person_id: obsolete.id, selected_revision: obsolete.expected_revision, current_person_revision: rows.find(row => row.id === obsolete.id).revision } } });
        if (rows.length !== refs.length || refs.some(ref => !rows.some(row => row.id === ref.id && row.revision === ref.expected_revision)))
            throw new ConflictException("A selected person changed or is unavailable. Review your selection.");
        return rows;
    }
    date(startsOn, today) { if (startsOn > today)
        throw new BadRequestException("Start this learning group today or on an earlier date. Future starts are not supported in this first setup."); }
    async instructor(tx, user, schoolId, ref, command) {
        const [person] = await this.people(tx, schoolId, [ref], command);
        if (!person)
            throw new BadRequestException("Choose an available instructor.");
        const actor = await this.model.identityPort().resolvePersonAgent(tx, { school_id: schoolId, person_id: person.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new BadRequestException("The instructor needs current app access before they can receive assignment work.");
        if (actor.person_id !== person.id)
            throw new ConflictException("The selected instructor's account link changed.");
        return person;
    }
    async activeCount(tx, schoolId, id) {
        return (await sql `SELECT count(*)::int AS total FROM learning_offering_enrollments WHERE school_id=${schoolId}::uuid AND offering_id=${id}::uuid AND ends_on IS NULL`.execute(tx)).rows[0].total;
    }
    async addEnrollments(tx, user, schoolId, id, refs, startsOn, command) {
        await this.people(tx, schoolId, refs, command);
        if (await this.activeCount(tx, schoolId, id) + refs.length > 100)
            throw new BadRequestException("This learning group supports up to 100 current people.");
        const existing = await tx.selectFrom("learning_offering_enrollments").select("person_id").where("school_id", "=", schoolId).where("offering_id", "=", id).where("person_id", "in", refs.map(ref => ref.id)).where("ends_on", "is", null).execute();
        if (existing.length)
            throw new ConflictException("A selected person is already enrolled. Refresh the group.");
        if (await tx.selectFrom("learning_offering_teaching_assignments").select("id").where("school_id", "=", schoolId).where("offering_id", "=", id)
            .where("person_id", "in", refs.map(ref => ref.id)).where("ends_on", "is", null).executeTakeFirst())
            throw new BadRequestException("Choose learners separately from the instructor. Self-assessed assignments are not supported in this first learning group setup.");
        return tx.insertInto("learning_offering_enrollments").values(refs.map(ref => ({ id: randomUUID(), school_id: schoolId, offering_id: id, person_id: ref.id,
            selected_person_revision: ref.expected_revision, starts_on: startsOn, ends_on: null, revision: 1, created_by: user.id, created_at: executionNow(), ended_by: null, ended_at: null, end_reason: null })))
            .returning(["id", "person_id", "revision"]).execute();
    }
    async create(user, raw) {
        const data = learningOfferingCreate.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const school = await this.context.setup(tx, user);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`learning-offering:${data.offering_id}`},0))`.execute(tx);
            const existing = await tx.selectFrom("learning_offerings").selectAll().where("id", "=", data.offering_id).forUpdate().executeTakeFirst();
            if (existing && existing.school_id !== school.id)
                throw new ForbiddenException("This learning group identifier is unavailable.");
            const source = existing ?? { id: data.offering_id, school_id: school.id, revision: 0 };
            const prepared = await this.model.prepareOffering(tx, user, source, "create", { command_id: data.command_id, expected_revision: 0 }, data);
            if (prepared.status === "completed")
                return { ...learningOfferingReceipts.create.parse(prepared.metadata), replayed: true };
            if (existing)
                throw new ConflictException("This learning group already exists.");
            if (data.participants.some(person => person.id === data.instructor.id))
                throw new BadRequestException("Choose learners separately from the instructor. Self-assessed assignments are not supported in this first learning group setup.");
            const selection = { source_id: source.id, command_id: data.command_id, expected_revision: 0, current_revision: source.revision };
            this.date(data.starts_on, school.today);
            await this.instructor(tx, user, school.id, data.instructor, selection);
            const saved = await tx.insertInto("learning_offerings").values({ id: data.offering_id, school_id: school.id, name: data.name, state: "active", revision: 1, created_by: user.id, created_at: executionNow(), updated_at: executionNow() }).returningAll().executeTakeFirstOrThrow();
            const appointment = await tx.insertInto("learning_offering_teaching_assignments").values({ id: randomUUID(), school_id: school.id, offering_id: saved.id, person_id: data.instructor.id,
                selected_person_revision: data.instructor.expected_revision, can_publish: true, can_review: true, starts_on: data.starts_on, ends_on: null, revision: 1,
                created_by: user.id, created_at: executionNow(), ended_by: null, ended_at: null, end_reason: null }).returning("id").executeTakeFirstOrThrow();
            const enrollments = await this.addEnrollments(tx, user, school.id, saved.id, data.participants, data.starts_on, selection);
            const result = { id: saved.id, revision: saved.revision, teaching_assignment_id: appointment.id, enrollments };
            const event = await this.model.offeringEvent(tx, user, saved, "created", prepared.command_id, [user.id]);
            await this.model.finishOffering(tx, saved, prepared.command_id, result, event);
            return { ...result, replayed: false };
        });
    }
    async locked(tx, schoolId, id) {
        const source = await tx.selectFrom("learning_offerings").selectAll().where("school_id", "=", schoolId).where("id", "=", assignmentId.parse(id)).forUpdate().executeTakeFirst();
        if (!source || source.state !== "active")
            throw new NotFoundException("Learning group unavailable.");
        return source;
    }
    async enroll(user, id, raw) {
        const data = learningOfferingEnroll.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const school = await this.context.setup(tx, user), source = await this.locked(tx, school.id, id);
            const prepared = await this.model.prepareOffering(tx, user, source, "enroll", data, { id, ...data });
            if (prepared.status === "completed")
                return { ...learningOfferingReceipts.enroll.parse(prepared.metadata), replayed: true };
            this.date(data.starts_on, school.today);
            const enrollments = await this.addEnrollments(tx, user, school.id, id, data.participants, data.starts_on, { source_id: id, command_id: data.command_id, expected_revision: data.expected_revision, current_revision: source.revision });
            const saved = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
            const result = { id, revision: saved.revision, enrollments }, event = await this.model.offeringEvent(tx, user, saved, "enrolled", prepared.command_id, [user.id]);
            await this.model.finishOffering(tx, saved, prepared.command_id, result, event);
            return { ...result, replayed: false };
        });
    }
    async appointInstructor(user, id, raw) {
        const data = learningOfferingInstructor.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const school = await this.context.setup(tx, user), source = await this.locked(tx, school.id, id);
            const prepared = await this.model.prepareOffering(tx, user, source, "instructor.appoint", data, { id, ...data });
            if (prepared.status === "completed")
                return { ...learningOfferingReceipts.instructor.parse(prepared.metadata), replayed: true };
            this.date(data.starts_on, school.today);
            await this.instructor(tx, user, school.id, data.instructor, { source_id: id, command_id: data.command_id, expected_revision: data.expected_revision, current_revision: source.revision });
            if (await tx.selectFrom("learning_offering_enrollments").select("id").where("school_id", "=", school.id).where("offering_id", "=", id)
                .where("person_id", "=", data.instructor.id).where("ends_on", "is", null).executeTakeFirst())
                throw new BadRequestException("The instructor cannot also be a current learner in this first learning group setup. End that learner enrollment or choose another instructor.");
            if (await tx.selectFrom("learning_offering_teaching_assignments").select("id").where("school_id", "=", school.id).where("offering_id", "=", id).where("ends_on", "is", null).executeTakeFirst())
                throw new ConflictException("End the current teaching appointment before appointing its replacement. Published assignments are not reassigned automatically.");
            const appointment = await tx.insertInto("learning_offering_teaching_assignments").values({ id: randomUUID(), school_id: school.id, offering_id: id, person_id: data.instructor.id,
                selected_person_revision: data.instructor.expected_revision, starts_on: data.starts_on, ends_on: null, revision: 1, can_publish: true, can_review: true,
                created_by: user.id, created_at: executionNow(), ended_by: null, ended_at: null, end_reason: null }).returning("id").executeTakeFirstOrThrow();
            const saved = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
            const result = { id, revision: saved.revision, teaching_assignment_id: appointment.id }, event = await this.model.offeringEvent(tx, user, saved, "instructor_appointed", prepared.command_id, [user.id]);
            await this.model.finishOffering(tx, saved, prepared.command_id, result, event);
            return { ...result, replayed: false };
        });
    }
    endEnrollment(user, id, recordId, raw) { return this.end(user, id, recordId, raw, false); }
    endInstructor(user, id, recordId, raw) { return this.end(user, id, recordId, raw, true); }
    async end(user, id, recordId, raw, teaching) {
        const data = learningOfferingEnd.parse(raw);
        assignmentId.parse(recordId);
        return this.db.transaction().execute(async (tx) => {
            const school = await this.context.setup(tx, user), source = await this.locked(tx, school.id, id);
            const table = teaching ? "learning_offering_teaching_assignments" : "learning_offering_enrollments";
            const record = await tx.selectFrom(table).selectAll().where("school_id", "=", school.id).where("offering_id", "=", id).where("id", "=", recordId).forUpdate().executeTakeFirst();
            if (!record)
                throw new NotFoundException("This responsibility is unavailable.");
            const action = teaching ? "instructor.end" : "enrollment.end";
            const prepared = await this.model.prepareOffering(tx, user, { ...source, revision: record.revision }, action, data, { id, recordId, ...data });
            if (prepared.status === "completed")
                return { ...learningOfferingReceipts.end.parse(prepared.metadata), replayed: true };
            if (record.ends_on)
                throw new ConflictException("This responsibility has already ended.");
            if (record.starts_on > school.today)
                throw new ConflictException("This future responsibility needs a separate correction.");
            await tx.updateTable(table).set({ ends_on: school.today, revision: record.revision + 1, ended_by: user.id, ended_at: executionNow(), end_reason: data.reason }).where("id", "=", recordId).execute();
            const saved = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
            const result = { id, revision: saved.revision, record_id: recordId, record_revision: record.revision + 1, ends_on: school.today };
            const event = await this.model.offeringEvent(tx, user, saved, teaching ? "instructor_ended" : "enrollment_ended", prepared.command_id, [user.id]);
            await this.model.finishOffering(tx, saved, prepared.command_id, result, event);
            return { ...result, replayed: false };
        });
    }
    async confirmation(user, id, commandId, action) {
        assignmentId.parse(id);
        assignmentId.parse(commandId);
        if (!["create", "enroll", "enrollment.end", "instructor.end", "instructor.appoint"].includes(action))
            throw new BadRequestException("Choose an exact learning group action.");
        return this.db.transaction().execute(async (tx) => {
            const school = await this.context.setup(tx, user), receipt = await this.model.offeringReceipt(tx, user, school.id, id, commandId, action);
            const base = { handler: "learning.offerings", source_id: id, command_id: commandId, action };
            if (!receipt)
                return { ...base, state: "not_found" };
            if (receipt.state === "pending")
                return { ...base, state: "pending" };
            if (receipt.receipt.terminal_state !== "accepted")
                return { ...base, state: "not_accepted" };
            const schema = action === "create" ? learningOfferingReceipts.create : action === "enroll" ? learningOfferingReceipts.enroll : action === "instructor.appoint" ? learningOfferingReceipts.instructor : learningOfferingReceipts.end;
            return { ...base, state: "accepted", result: schema.parse(receipt.receipt.metadata) };
        });
    }
};
LearningOfferingsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, LearningAssignmentContextService, LearningAssignmentModelService])
], LearningOfferingsService);
export { LearningOfferingsService };
//# sourceMappingURL=learning-offerings.service.js.map