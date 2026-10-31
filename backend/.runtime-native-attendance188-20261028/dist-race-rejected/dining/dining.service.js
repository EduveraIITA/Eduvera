var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { lockCampusSpaceUse, assertSpacesNotResidential, } from "../common/campus-space-use.js";
import { retainOperatingDestination } from "../institution-onboarding/operating-resume.js";
import { DiningAccess } from "./dining.access.js";
import { DiningModel } from "./dining.model.js";
import { DiningWeeklyService } from "./dining-weekly.service.js";
import { diningDateValue } from "./dining-weekly.resolver.js";
import { diningServiceInput, diningSessionInput, diningActionInput, diningIssueInput, diningIssueActionInput, diningListInput, diningOptionsInput, diningHistoryInput, diningHref, } from "./dining.contracts.js";
let DiningService = class DiningService {
    db;
    access;
    model;
    weekly;
    recoverPlan(user, school, id, body) {
        return this.weekly.recoverPlan(this, user, school, id, body);
    }
    savePlan(user, school, body) {
        return this.weekly.savePlan(this, user, school, body);
    }
    plans(user, school, query) {
        return this.weekly.plans(this, user, school, query);
    }
    plan(user, school, id, query = {}) {
        return this.weekly.plan(this, user, school, id, query);
    }
    publishPlan(user, school, id, body) {
        return this.weekly.publishPlan(this, user, school, id, body);
    }
    revisePlan(user, school, id, body) {
        return this.weekly.revisePlan(this, user, school, id, body);
    }
    stopPlan(user, school, id, body) {
        return this.weekly.stopPlan(this, user, school, id, body);
    }
    planOccurrences(user, school, id, query, preview = false) {
        return this.weekly.occurrences(this, user, school, id, query, preview);
    }
    planDate(user, school, series, date) {
        return this.weekly.planDate(this, user, school, series, date);
    }
    actPlanDate(user, school, series, date, body) {
        return this.weekly.actPlanDate(this, user, school, series, date, body);
    }
    availability(user, school, query) {
        return this.weekly.availability(this, user, school, query);
    }
    ownedAvailability(user, school, query) {
        return this.weekly.ownedAvailability(this, user, school, query);
    }
    endpointCache = new WeakMap();
    constructor(db, access, model, weekly) {
        this.db = db;
        this.access = access;
        this.model = model;
        this.weekly = weekly;
    }
    async lock(tx, school) {
        await lockCampusSpaceUse(tx, school);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`dining:${school}`},0))`.execute(tx);
    }
    async serviceRow(tx, school, id, lock = false) {
        const row = await tx
            .selectFrom("dining_services")
            .selectAll()
            .where("school_id", "=", school)
            .where("id", "=", id)
            .$if(lock, (q) => q.forUpdate())
            .executeTakeFirst();
        if (!row)
            throw new NotFoundException("Dining service not found.");
        return row;
    }
    async sessionRow(tx, school, id, lock = false) {
        const row = await tx
            .selectFrom("dining_sessions")
            .selectAll()
            .where("school_id", "=", school)
            .where("id", "=", id)
            .$if(lock, (q) => q.forUpdate())
            .executeTakeFirst();
        if (!row)
            throw new NotFoundException("Dated service not found.");
        return { ...row, weekly_date: diningDateValue(row.weekly_date) };
    }
    async issueRow(tx, school, id, lock = false) {
        const row = await tx
            .selectFrom("dining_issues")
            .selectAll()
            .where("school_id", "=", school)
            .where("id", "=", id)
            .$if(lock, (q) => q.forUpdate())
            .executeTakeFirst();
        if (!row)
            throw new NotFoundException("Dining report not found.");
        return row;
    }
    endpoint(tx, school, person) {
        let cache = this.endpointCache.get(tx);
        if (!cache) {
            cache = new Map();
            this.endpointCache.set(tx, cache);
        }
        const key = `${school}:${person}`;
        let endpoint = cache.get(key);
        if (!endpoint) {
            endpoint = this.access.identities.resolvePersonAgent(tx, {
                school_id: school,
                person_id: person,
                at: executionNow().toISOString(),
            });
            cache.set(key, endpoint);
        }
        return endpoint;
    }
    async recipient(tx, school, person) {
        const p = await this.endpoint(tx, school, person);
        return p.acting ? { person_id: person, user_id: p.user_id } : null;
    }
    async requirePerson(tx, school, person) {
        const p = await this.recipient(tx, school, person);
        if (!p)
            throw new BadRequestException("Choose a person with current campus app access for this responsibility.");
        return p;
    }
    async place(tx, school, id, requireActive = true) {
        if (!id)
            return null;
        const rows = (await sql `WITH RECURSIVE path AS (
      SELECT space.*,ARRAY[space.id] AS visited,0 AS depth FROM campus_spaces space WHERE space.school_id=${school}::uuid AND space.id=${id}::uuid
      UNION ALL SELECT parent.*,child.visited||parent.id,child.depth+1 FROM campus_spaces parent JOIN path child ON parent.id=child.parent_space_id AND parent.school_id=child.school_id WHERE NOT parent.id=ANY(child.visited) AND child.depth<32
    ) SELECT room.id,room.name,room.status,room.kind,room.campus_id,room.revision,
      jsonb_build_array(jsonb_build_object('id',campus.id,'label',campus.name))||coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'label',p.name) ORDER BY p.depth DESC) FROM path p),'[]'::jsonb) AS path,
      campus.status='active' AND room.status='active' AND NOT EXISTS(SELECT 1 FROM path p WHERE p.status<>'active' OR p.campus_id<>room.campus_id) AS valid
    FROM path room JOIN institution_campuses campus ON campus.id=room.campus_id AND campus.school_id=room.school_id WHERE room.depth=0`.execute(tx)).rows;
        const row = rows[0];
        if (!row || (requireActive && !row.valid))
            throw new BadRequestException("Choose an active place in this campus and its current location hierarchy.");
        if (requireActive)
            await assertSpacesNotResidential(tx, school, [id]);
        return row;
    }
    async refs(tx, school, people, spaces) {
        const [persons, places] = await Promise.all([
            tx
                .selectFrom("school_people")
                .select(["id", "first_name", "last_name"])
                .where("school_id", "=", school)
                .where("id", "in", [...new Set(people)].length
                ? [...new Set(people)]
                : ["00000000-0000-0000-0000-000000000000"])
                .execute(),
            tx
                .selectFrom("campus_spaces")
                .select(["id", "name"])
                .where("school_id", "=", school)
                .where("id", "in", spaces.filter((v) => Boolean(v)).length
                ? [...new Set(spaces.filter((v) => Boolean(v)))]
                : ["00000000-0000-0000-0000-000000000000"])
                .execute(),
        ]);
        const p = new Map(persons.map((r) => [
            r.id,
            { id: r.id, label: `${r.first_name} ${r.last_name}`.trim() },
        ])), s = new Map(places.map((r) => [r.id, { id: r.id, label: r.name }]));
        return {
            person: (id) => p.get(id) ?? { id, label: "Campus person" },
            space: (id) => id ? (s.get(id) ?? { id, label: "Campus place" }) : null,
        };
    }
    source(row) {
        return row.menu_mode === "reference" || row.operations_mode === "reference"
            ? {
                label: row.source_label,
                url: row.source_url,
                reference: row.source_reference,
                observed_at: row.source_observed_at?.toISOString() ?? null,
                mode: "reference_only",
            }
            : null;
    }
    async history(tx, school, rows) {
        const refs = await this.refs(tx, school, rows.map((row) => row.actor_person_id), []);
        return rows.map((row) => {
            const record = row;
            return {
                ...row,
                action: record.action ?? "service_saved",
                note: record.note ?? record.reason ?? "",
                actor: refs.person(row.actor_person_id),
                actor_label: refs.person(row.actor_person_id).label,
                recorded_at: row.recorded_at.toISOString(),
            };
        });
    }
    async serviceDto(tx, user, row, person, manager) {
        const refs = await this.refs(tx, row.school_id, [row.coordinator_person_id], [row.space_id]);
        const hasSessions = Boolean(await tx
            .selectFrom("dining_sessions")
            .select("id")
            .where("school_id", "=", row.school_id)
            .where("service_id", "=", row.id)
            .limit(1)
            .executeTakeFirst());
        const hasPlans = Boolean(await tx
            .selectFrom("dining_weekly_plans")
            .select("id")
            .where("school_id", "=", row.school_id)
            .where("service_id", "=", row.id)
            .limit(1)
            .executeTakeFirst());
        const locationPath = row.space_id
            ? ((await this.place(tx, row.school_id, row.space_id, false))?.path ?? [])
            : [];
        return {
            ...row,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            source_observed_at: row.source_observed_at?.toISOString() ?? null,
            coordinator: refs.person(row.coordinator_person_id),
            place: refs.space(row.space_id),
            location_path: locationPath,
            source: this.source(row),
            has_sessions: hasSessions,
            modes_locked: hasSessions || hasPlans,
            allowed_actions: manager || person === row.coordinator_person_id
                ? [
                    "edit",
                    ...(row.active &&
                        (row.menu_mode === "native" || row.operations_mode === "native")
                        ? ["create_session", "create_plan"]
                        : []),
                ]
                : [],
        };
    }
    isParticipant(row, person) {
        return (person === row.coordinator_person_id || person === row.operator_person_id);
    }
    async sessionActions(tx, row, person, manager) {
        const actions = [], coordinator = person === row.coordinator_person_id, operator = person === row.operator_person_id;
        const missing = !(await this.recipient(tx, row.school_id, row.coordinator_person_id)) ||
            (row.operations_mode === "native" &&
                !(await this.recipient(tx, row.school_id, row.operator_person_id)));
        if (coordinator || (manager && missing))
            actions.push("reassign");
        if (coordinator && row.state === "draft")
            actions.push("save", "publish", "cancel");
        if (coordinator && ["published", "open", "paused"].includes(row.state))
            actions.push("publish_changes");
        if (coordinator && row.state === "published")
            actions.push("cancel");
        if (row.operations_mode === "native" && operator) {
            if (row.state === "published")
                actions.push("open");
            if (row.state === "open")
                actions.push("pause", "end", "count");
            if (row.state === "paused")
                actions.push("resume", "end");
            if (row.current_count_receipt_id &&
                ["open", "paused", "ended"].includes(row.state))
                actions.push("correct_count");
        }
        if (this.isParticipant(row, person) &&
            row.state !== "draft" &&
            row.state !== "cancelled" &&
            row.operations_mode === "native")
            actions.push("report_issue");
        return (await this.routeHealthy(tx, row))
            ? actions
            : actions.filter((action) => action === "reassign");
    }
    async sessionDto(tx, row, person, manager) {
        const refs = await this.refs(tx, row.school_id, [row.coordinator_person_id, row.operator_person_id], [row.space_id]);
        const service = await this.serviceRow(tx, row.school_id, row.service_id), participant = this.isParticipant(row, person);
        const actions = await this.sessionActions(tx, row, person, manager);
        return {
            id: row.id,
            revision: row.revision,
            state: row.state,
            label: row.label,
            service: { id: service.id, label: service.name },
            service_id: row.service_id,
            service_revision: row.service_revision,
            coordinator: refs.person(row.coordinator_person_id),
            operator: refs.person(row.operator_person_id),
            place: refs.space(row.space_id),
            space_id: row.space_id,
            starts_at: row.starts_at.toISOString(),
            ends_at: row.ends_at.toISOString(),
            menu_text: row.menu_text,
            menu_mode: row.menu_mode,
            operations_mode: row.operations_mode,
            source: this.source(row),
            count_total: participant && row.current_count_receipt_id ? row.count_total : null,
            count_receipt_id: participant ? row.current_count_receipt_id : null,
            published_at: row.published_at?.toISOString() ?? null,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            allowed_actions: actions,
            route_unavailable: participant
                ? !(await this.routeHealthy(tx, row))
                : false,
            availability_only: true,
            venue_reserved: false,
            weekly_plan_id: row.weekly_plan_id,
            weekly_series_id: row.weekly_series_id,
            weekly_date: diningDateValue(row.weekly_date),
            changed_for_date: row.weekly_exception,
        };
    }
    async routeHealthy(tx, row) {
        const previous = row.coordination_receipt;
        const issue = "session_id" in row;
        const expected = issue
            ? row.state === "resolved"
                ? null
                : row.handler_person_id
            : row.state === "draft"
                ? row.coordinator_person_id
                : row.operations_mode === "native" &&
                    !["ended", "cancelled"].includes(row.state)
                    ? row.operator_person_id
                    : null;
        if (!expected)
            return !previous?.message_id;
        if (!previous?.message_id ||
            previous.source_revision !== row.revision ||
            previous.recipient_person_id !== expected)
            return false;
        const p = previous.recipient_person_id
            ? await this.recipient(tx, row.school_id, previous.recipient_person_id)
            : null;
        if (!p || p.user_id !== previous.recipient_user_id)
            return false;
        const trace = await this.model.coordination.findExactTrace(tx, {
            school_id: row.school_id,
            source_domain: "dining",
            source_record_id: row.id,
            event_type: previous.event_type,
            source_revision: previous.source_revision,
            message_id: previous.message_id,
        });
        return Boolean(trace?.message_open);
    }
    async requireRoute(tx, row) {
        if (!(await this.routeHealthy(tx, row)))
            throw new ConflictException("The exact responsibility route is unavailable. Ask the coordinator to explicitly reissue or reassign it.");
    }
    async window(tx, school, starts, ends) {
        const start = new Date(starts), end = new Date(ends);
        if (!Number.isFinite(+start) ||
            !Number.isFinite(+end) ||
            +end <= +start ||
            +end - +start > 86400000)
            throw new BadRequestException("Choose serving hours lasting more than zero and at most 24 hours.");
        const schoolRow = await tx
            .selectFrom("schools")
            .select("timezone")
            .where("id", "=", school)
            .executeTakeFirstOrThrow();
        // Inputs are already explicit offset instants, not ambiguous wall times.
        // Shared UI time resolution requires an explicit first/second fold choice.
        new Intl.DateTimeFormat("en", { timeZone: schoolRow.timezone });
        return { starts_at: start, ends_at: end };
    }
    async saveService(user, school, raw) {
        const body = diningServiceInput.parse(raw), id = body.id ?? body.command_id;
        return this.db.transaction().execute(async (tx) => {
            await this.lock(tx, school);
            const actor = await this.access.campus(tx, user, school), old = await tx
                .selectFrom("dining_services")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", id)
                .executeTakeFirst();
            const manager = await this.access.manages(tx, user, school);
            if (!manager && old?.coordinator_person_id !== actor.person_id)
                throw new ForbiddenException("Current dining setup authority or this service's coordinator is required.");
            const source = old ?? {
                id,
                school_id: school,
                revision: 0,
                updated_at: executionNow(),
            }, capability = manager ? "dining.manage" : "dining.coordinate";
            const command = await this.model.prepare(tx, user, actor, source, "service", "saved", body, capability, {
                service_id: id,
                coordinator_person_id: old?.coordinator_person_id ?? null,
            });
            if (command.replay)
                return command.result;
            if (old && !body.reason.trim())
                throw new BadRequestException("Give a reason for changing this service.");
            if ((body.menu_mode === "reference" ||
                body.operations_mode === "reference") &&
                !body.source_label)
                throw new BadRequestException("Name the external source. This is a reference, not a live connection.");
            if (body.source_observed_at &&
                Date.parse(body.source_observed_at) > +executionNow())
                throw new BadRequestException("A source cannot have been checked in the future.");
            if (old &&
                (old.menu_mode !== body.menu_mode ||
                    old.operations_mode !== body.operations_mode) &&
                (await tx
                    .selectFrom("dining_sessions")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("service_id", "=", id)
                    .limit(1)
                    .execute()).length)
                throw new ConflictException("This service has dated records. Ownership changes need an explicit reviewed handover, not an edit.");
            await this.requirePerson(tx, school, body.coordinator_person_id);
            await this.place(tx, school, body.space_id);
            const at = executionNow(), values = {
                name: body.name,
                coordinator_person_id: body.coordinator_person_id,
                space_id: body.space_id,
                menu_mode: body.menu_mode,
                operations_mode: body.operations_mode,
                source_label: body.source_label,
                source_url: body.source_url,
                source_reference: body.source_reference,
                source_observed_at: body.source_observed_at
                    ? new Date(body.source_observed_at)
                    : null,
                active: body.active,
                revision: source.revision + 1,
                updated_at: at,
            };
            const row = old
                ? await tx
                    .updateTable("dining_services")
                    .set(values)
                    .where("school_id", "=", school)
                    .where("id", "=", id)
                    .returningAll()
                    .executeTakeFirstOrThrow()
                : await tx
                    .insertInto("dining_services")
                    .values({
                    id,
                    school_id: school,
                    ...values,
                    created_by_user_id: user.id,
                    created_at: at,
                })
                    .returningAll()
                    .executeTakeFirstOrThrow();
            await tx
                .insertInto("dining_service_receipts")
                .values({
                ...row,
                id: body.command_id,
                service_id: id,
                command_id: command.prepared.command_id,
                actor_person_id: actor.person_id,
                actor_user_id: user.id,
                reason: body.reason,
                recorded_at: at,
            })
                .execute();
            await this.model.finish(tx, user, row, "service", "saved", command.prepared, capability, null, [user.id]);
            return { id, kind: "service", revision: row.revision };
        });
    }
    async createSession(user, school, raw) {
        const body = diningSessionInput.parse(raw), id = body.command_id;
        return this.db.transaction().execute(async (tx) => {
            await this.lock(tx, school);
            const actor = await this.access.campus(tx, user, school), service = await this.serviceRow(tx, school, body.service_id, true), manager = await this.access.manages(tx, user, school);
            if (!manager && actor.person_id !== service.coordinator_person_id)
                throw new ForbiddenException("This service's coordinator or explicit dining setup authority is required.");
            const existing = await tx
                .selectFrom("dining_sessions")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", id)
                .executeTakeFirst();
            const command = await this.model.prepare(tx, user, actor, existing ?? {
                id,
                school_id: school,
                revision: 0,
                updated_at: executionNow(),
            }, "session", "created", body, manager ? "dining.manage" : "dining.coordinate", {
                service_id: service.id,
                service_revision: service.revision,
                coordinator_person_id: service.coordinator_person_id,
            });
            if (command.replay)
                return command.result;
            if (service.revision > body.service_expected_revision)
                throw new ConflictException({
                    code: "dining_obsolete",
                    message: "This service changed. Review it before preparing another dated service.",
                    fields: {
                        dining_obsolete: {
                            confirmation: "permanently_inapplicable",
                            receipt_state: "absent",
                            source_id: service.id,
                            command_id: body.command_id,
                            expected_revision: body.service_expected_revision,
                            current_revision: service.revision,
                            reason: "stream_advanced",
                        },
                    },
                });
            if (!service.active ||
                service.revision !== body.service_expected_revision)
                throw new BadRequestException("Choose a current active dining service before planning a date.");
            if (service.menu_mode === "reference" &&
                service.operations_mode === "reference")
                throw new BadRequestException("This service is reference-only. Continue in its source application; no local menu or serving record is created.");
            if (service.menu_mode === "reference" && body.menu_text)
                throw new BadRequestException("Keep the external menu at its source instead of creating an editable local copy.");
            await this.requirePerson(tx, school, service.coordinator_person_id);
            await this.requirePerson(tx, school, body.operator_person_id);
            await this.place(tx, school, body.space_id);
            const at = executionNow(), window = await this.window(tx, school, body.starts_at, body.ends_at);
            const row = await tx
                .insertInto("dining_sessions")
                .values({
                id,
                school_id: school,
                service_id: service.id,
                service_revision: service.revision,
                label: body.label,
                coordinator_person_id: service.coordinator_person_id,
                operator_person_id: body.operator_person_id,
                space_id: body.space_id,
                menu_mode: service.menu_mode,
                operations_mode: service.operations_mode,
                source_label: service.source_label,
                source_url: service.source_url,
                source_reference: service.source_reference,
                source_observed_at: service.source_observed_at,
                menu_text: body.menu_text,
                ...window,
                state: "draft",
                revision: 1,
                published_at: null,
                count_total: 0,
                current_count_receipt_id: null,
                created_by_user_id: user.id,
                created_at: at,
                updated_at: at,
            })
                .returningAll()
                .executeTakeFirstOrThrow();
            await this.sessionReceipt(tx, user, actor.person_id, row, body.command_id, command.prepared.command_id, "created", "");
            const next = await this.requirePerson(tx, school, row.coordinator_person_id);
            await this.model.finish(tx, user, row, "session", "created", command.prepared, manager ? "dining.manage" : "dining.coordinate", next, [user.id, next.user_id]);
            return { id, kind: "session", revision: 1 };
        });
    }
    sessionReceipt(tx, user, person, row, id, command, action, note, observed = null, supersedes = null) {
        return tx
            .insertInto("dining_session_receipts")
            .values({
            id,
            school_id: row.school_id,
            session_id: row.id,
            revision: row.revision,
            command_id: command,
            action,
            actor_person_id: person,
            actor_user_id: user.id,
            note,
            state: row.state,
            label: row.label,
            menu_text: row.menu_text,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
            space_id: row.space_id,
            coordinator_person_id: row.coordinator_person_id,
            operator_person_id: row.operator_person_id,
            count_total: row.count_total,
            observed_at: observed,
            supersedes_receipt_id: supersedes,
            recorded_at: row.updated_at,
        })
            .execute();
    }
    async act(user, school, id, raw) {
        const body = diningActionInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            await this.lock(tx, school);
            const actor = await this.access.campus(tx, user, school), old = await this.sessionRow(tx, school, id, true), manager = await this.access.manages(tx, user, school);
            if (!this.isParticipant(old, actor.person_id) &&
                !(manager &&
                    !(await this.recipient(tx, school, old.coordinator_person_id))))
                throw new ForbiddenException("This source belongs to its current dining responsibilities.");
            const capability = body.action === "reassign" &&
                manager &&
                actor.person_id !== old.coordinator_person_id
                ? "dining.manage"
                : actor.person_id === old.coordinator_person_id
                    ? "dining.coordinate"
                    : "dining.operate";
            const command = await this.model.prepare(tx, user, actor, old, "session", body.action, body, capability, {
                session_id: id,
                coordinator_person_id: old.coordinator_person_id,
                operator_person_id: old.operator_person_id,
            });
            if (command.replay)
                return command.result;
            const allowed = await this.sessionActions(tx, old, actor.person_id, manager);
            if (!allowed.includes(body.action))
                throw new ForbiddenException("This action is not available to your current dining responsibility.");
            if (body.action !== "reassign")
                await this.requireRoute(tx, old);
            const at = executionNow(), values = {
                revision: old.revision + 1,
                updated_at: at,
                ...(old.weekly_plan_id &&
                    ["save", "publish_changes", "cancel"].includes(body.action)
                    ? { weekly_exception: true }
                    : {}),
            };
            let action = body.action, observed = null;
            if ([
                "pause",
                "end",
                "cancel",
                "publish_changes",
                "correct_count",
                "reassign",
            ].includes(body.action) &&
                body.note.length < 3)
                throw new BadRequestException("Add a short reason for this change.");
            if (["save", "publish_changes"].includes(body.action)) {
                if (old.menu_mode === "reference" && body.menu_text)
                    throw new BadRequestException("This menu belongs to its external source.");
                Object.assign(values, {
                    label: body.label ?? old.label,
                    menu_text: body.menu_text ?? old.menu_text,
                    ...(await this.window(tx, school, body.starts_at ?? old.starts_at, body.ends_at ?? old.ends_at)),
                    space_id: body.space_id === undefined ? old.space_id : body.space_id,
                });
                await this.place(tx, school, values.space_id ?? null);
                if (body.action === "publish_changes" &&
                    old.menu_mode === "native" &&
                    !values.menu_text?.trim())
                    throw new BadRequestException("Add the menu before publishing it.");
            }
            if (body.action === "publish") {
                if (old.menu_mode === "native" && !old.menu_text.trim())
                    throw new BadRequestException("Add the menu before publishing it.");
                await this.place(tx, school, old.space_id);
                Object.assign(values, { state: "published", published_at: at });
                action = "published";
            }
            if (body.action === "open") {
                if ((+at < +old.starts_at || +at >= +old.ends_at) &&
                    body.note.length < 3)
                    throw new BadRequestException("Give a reason for opening outside the planned serving hours.");
                await this.place(tx, school, old.space_id);
                values.state = "open";
                action = "opened";
            }
            if (body.action === "pause") {
                values.state = "paused";
                action = "paused";
            }
            if (body.action === "resume") {
                await this.place(tx, school, old.space_id);
                values.state = "open";
                action = "resumed";
            }
            if (body.action === "end") {
                values.state = "ended";
                action = "ended";
            }
            if (body.action === "cancel") {
                values.state = "cancelled";
                action = "cancelled";
            }
            if (body.action === "save")
                action = "saved";
            if (body.action === "count" || body.action === "correct_count") {
                if (body.count_total === undefined || !body.observed_at)
                    throw new BadRequestException("Enter the cumulative number served and when it was observed.");
                observed = new Date(body.observed_at);
                if (+observed > +at || +observed < +old.created_at)
                    throw new BadRequestException("Choose an observation time between preparation of this record and now.");
                if (body.action === "count" && body.count_total < old.count_total)
                    throw new BadRequestException("Use Correct count with a reason to replace an incorrect total.");
                if (body.action === "correct_count" &&
                    body.supersedes_receipt_id !== old.current_count_receipt_id)
                    throw new ConflictException("Review the latest count before correcting it.");
                if (body.action === "count" && old.current_count_receipt_id) {
                    const previous = await tx
                        .selectFrom("dining_session_receipts")
                        .select("observed_at")
                        .where("school_id", "=", school)
                        .where("id", "=", old.current_count_receipt_id)
                        .executeTakeFirst();
                    if (previous?.observed_at && +observed < +previous.observed_at)
                        throw new BadRequestException("An older observation cannot replace a newer cumulative count. Use its correction path.");
                }
                Object.assign(values, {
                    count_total: body.count_total,
                    current_count_receipt_id: body.command_id,
                });
                action = body.action === "count" ? "counted" : "count_corrected";
            }
            if (body.action === "reassign") {
                if (!body.coordinator_person_id && !body.operator_person_id)
                    throw new BadRequestException("Choose the responsibility to reissue or change.");
                if (body.coordinator_person_id) {
                    await this.requirePerson(tx, school, body.coordinator_person_id);
                    values.coordinator_person_id = body.coordinator_person_id;
                }
                if (body.operator_person_id) {
                    await this.requirePerson(tx, school, body.operator_person_id);
                    values.operator_person_id = body.operator_person_id;
                }
                if ((body.coordinator_person_id ?? old.coordinator_person_id) ===
                    old.coordinator_person_id &&
                    (body.operator_person_id ?? old.operator_person_id) ===
                        old.operator_person_id &&
                    (await this.routeHealthy(tx, old)))
                    throw new BadRequestException("These responsibilities and their handoff are already current.");
                action = "reassigned";
            }
            const row = await tx
                .updateTable("dining_sessions")
                .set(values)
                .where("school_id", "=", school)
                .where("id", "=", id)
                .returningAll()
                .executeTakeFirstOrThrow();
            await this.sessionReceipt(tx, user, actor.person_id, row, body.command_id, command.prepared.command_id, action, body.note, observed, body.action === "correct_count" ? body.supersedes_receipt_id : null);
            const nextPerson = row.state === "draft"
                ? row.coordinator_person_id
                : row.operations_mode === "native" &&
                    !["ended", "cancelled"].includes(row.state)
                    ? row.operator_person_id
                    : null;
            const next = nextPerson
                ? await this.requirePerson(tx, school, nextPerson)
                : null;
            const audience = [
                user.id,
                ...(await Promise.all([row.coordinator_person_id, row.operator_person_id].map((p) => this.recipient(tx, school, p))))
                    .filter((p) => Boolean(p))
                    .map((p) => p.user_id),
            ];
            await this.model.finish(tx, user, { ...row, coordination_receipt: old.coordination_receipt }, "session", action, command.prepared, capability, next, audience);
            if (row.weekly_plan_id)
                await this.weekly.projectSession(this, tx, user, row);
            if (row.menu_mode === "native" &&
                (body.action === "publish" || body.action === "publish_changes"))
                await retainOperatingDestination(tx, user, school, "dining", diningHref(id), { onlyPending: true, source: "accepted_dining_publication" });
            return { id, kind: "session", revision: row.revision };
        });
    }
    async reportIssue(user, school, sessionId, raw) {
        const body = diningIssueInput.parse(raw), id = body.command_id;
        return this.db.transaction().execute(async (tx) => {
            await this.lock(tx, school);
            const actor = await this.access.campus(tx, user, school), session = await this.sessionRow(tx, school, sessionId, true);
            if (!this.isParticipant(session, actor.person_id) ||
                session.state === "draft" ||
                session.state === "cancelled" ||
                session.operations_mode !== "native")
                throw new ForbiddenException("Only the current dated service participants may report this operational issue.");
            const old = await tx
                .selectFrom("dining_issues")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", id)
                .executeTakeFirst();
            const committed = {
                ...body,
                expected_revision: 0,
                session_id: sessionId,
                session_expected_revision: body.expected_revision,
            };
            const command = await this.model.prepare(tx, user, actor, old ?? {
                id,
                school_id: school,
                revision: 0,
                updated_at: executionNow(),
            }, "issue", "reported", committed, "dining.operate", {
                session_id: sessionId,
                coordinator_person_id: session.coordinator_person_id,
                operator_person_id: session.operator_person_id,
            });
            if (command.replay)
                return command.result;
            if (session.revision !== body.expected_revision)
                throw new ConflictException({
                    code: "dining_obsolete",
                    message: "This service changed. Review it before reporting.",
                    fields: {
                        dining_obsolete: {
                            confirmation: "permanently_inapplicable",
                            receipt_state: "absent",
                            source_id: sessionId,
                            command_id: body.command_id,
                            expected_revision: body.expected_revision,
                            current_revision: session.revision,
                            reason: "stream_advanced",
                        },
                    },
                });
            const next = await this.requirePerson(tx, school, body.handler_person_id), at = executionNow();
            const row = await tx
                .insertInto("dining_issues")
                .values({
                id,
                school_id: school,
                session_id: sessionId,
                reporter_person_id: actor.person_id,
                handler_person_id: body.handler_person_id,
                coordinator_person_id: session.coordinator_person_id,
                title: body.title,
                detail: body.note,
                state: "open",
                revision: 1,
                created_by_user_id: user.id,
                created_at: at,
                updated_at: at,
            })
                .returningAll()
                .executeTakeFirstOrThrow();
            await tx
                .insertInto("dining_issue_receipts")
                .values({
                id: body.command_id,
                school_id: school,
                issue_id: id,
                revision: 1,
                command_id: command.prepared.command_id,
                action: "reported",
                actor_person_id: actor.person_id,
                actor_user_id: user.id,
                note: body.note,
                state: "open",
                handler_person_id: row.handler_person_id,
                coordinator_person_id: row.coordinator_person_id,
                recorded_at: at,
            })
                .execute();
            await this.model.finish(tx, user, { ...row, space_id: session.space_id }, "issue", "reported", command.prepared, "dining.operate", next, [user.id, next.user_id], sessionId);
            return { id, kind: "issue", revision: 1 };
        });
    }
    issueParticipant(row, person) {
        return [
            row.reporter_person_id,
            row.handler_person_id,
            row.coordinator_person_id,
        ].includes(person);
    }
    async issueActions(tx, row, person, manager) {
        const result = [], handler = person === row.handler_person_id, coordinator = person === row.coordinator_person_id;
        if (handler && row.state === "open")
            result.push("accept");
        if (handler && row.state === "accepted")
            result.push("resolve");
        if (row.state === "resolved" &&
            (person === row.reporter_person_id || coordinator))
            result.push("reopen");
        if (coordinator ||
            (manager &&
                !(await this.recipient(tx, row.school_id, row.coordinator_person_id))))
            result.push("reassign");
        return (await this.routeHealthy(tx, row))
            ? result
            : result.filter((action) => action === "reassign" ||
                (action === "reopen" && row.state === "resolved"));
    }
    async actIssue(user, school, id, raw) {
        const body = diningIssueActionInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            await this.lock(tx, school);
            const actor = await this.access.campus(tx, user, school), old = await this.issueRow(tx, school, id, true), manager = await this.access.manages(tx, user, school);
            if (!this.issueParticipant(old, actor.person_id) &&
                !(manager &&
                    !(await this.recipient(tx, school, old.coordinator_person_id))))
                throw new ForbiddenException("This report belongs to its current participants.");
            const capability = body.action === "reassign"
                ? actor.person_id === old.coordinator_person_id
                    ? "dining.coordinate"
                    : "dining.manage"
                : "dining.resolve";
            const command = await this.model.prepare(tx, user, actor, old, "issue", body.action, body, capability, {
                issue_id: id,
                reporter_person_id: old.reporter_person_id,
                handler_person_id: old.handler_person_id,
                coordinator_person_id: old.coordinator_person_id,
            });
            if (command.replay)
                return command.result;
            if (!(await this.issueActions(tx, old, actor.person_id, manager)).includes(body.action))
                throw new ForbiddenException("This report action is not available to your current responsibility.");
            if (!["reassign", "reopen"].includes(body.action))
                await this.requireRoute(tx, old);
            if (body.action !== "accept" && body.note.length < 3)
                throw new BadRequestException("Add a short reason or resolution.");
            const values = {
                revision: old.revision + 1,
                updated_at: executionNow(),
            };
            let action = body.action;
            if (body.action === "accept") {
                values.state = "accepted";
                action = "accepted";
            }
            if (body.action === "resolve") {
                values.state = "resolved";
                action = "resolved";
            }
            if (body.action === "reopen") {
                values.state = "open";
                action = "reopened";
            }
            if (body.action === "reassign") {
                if (!body.handler_person_id)
                    throw new BadRequestException("Choose the next responsible person.");
                await this.requirePerson(tx, school, body.handler_person_id);
                if (body.handler_person_id === old.handler_person_id &&
                    (await this.routeHealthy(tx, old)))
                    throw new BadRequestException("This responsibility and its handoff are already current.");
                values.handler_person_id = body.handler_person_id;
                values.state = old.state === "resolved" ? "resolved" : "open";
                action = "reassigned";
                if (actor.person_id !== old.coordinator_person_id)
                    values.coordinator_person_id = actor.person_id;
            }
            const row = await tx
                .updateTable("dining_issues")
                .set(values)
                .where("school_id", "=", school)
                .where("id", "=", id)
                .returningAll()
                .executeTakeFirstOrThrow();
            await tx
                .insertInto("dining_issue_receipts")
                .values({
                id: body.command_id,
                school_id: school,
                issue_id: id,
                revision: row.revision,
                command_id: command.prepared.command_id,
                action,
                actor_person_id: actor.person_id,
                actor_user_id: user.id,
                note: body.note,
                state: row.state,
                handler_person_id: row.handler_person_id,
                coordinator_person_id: row.coordinator_person_id,
                recorded_at: row.updated_at,
            })
                .execute();
            const next = row.state !== "resolved"
                ? await this.requirePerson(tx, school, row.handler_person_id)
                : null;
            const audience = [
                user.id,
                ...(await Promise.all([
                    row.reporter_person_id,
                    row.handler_person_id,
                    row.coordinator_person_id,
                ].map((p) => this.recipient(tx, school, p))))
                    .filter((p) => Boolean(p))
                    .map((p) => p.user_id),
            ];
            const session = await this.sessionRow(tx, school, row.session_id);
            await this.model.finish(tx, user, {
                ...row,
                space_id: session.space_id,
                coordination_receipt: old.coordination_receipt,
            }, "issue", action, command.prepared, capability, next, audience, row.session_id);
            return { id, kind: "issue", revision: row.revision };
        });
    }
    async workspace(user, school, raw = {}) {
        const input = diningListInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school), zone = await tx
                .selectFrom("schools")
                .select("timezone")
                .where("id", "=", school)
                .executeTakeFirstOrThrow();
            const date = input.date ??
                (await sql `SELECT (${executionNow()}::timestamptz AT TIME ZONE ${zone.timezone})::date::text AS date`.execute(tx)).rows[0].date;
            const services = await tx
                .selectFrom("dining_services")
                .selectAll()
                .where("school_id", "=", school)
                .where("name", "ilike", `%${input.search}%`)
                .where((q) => q.or([
                q("active", "=", true),
                q("coordinator_person_id", "=", actor.person_id),
                ...(manager ? [q.val(true)] : []),
            ]))
                .orderBy("name")
                .orderBy("id")
                .limit(11)
                .offset((input.page - 1) * 10)
                .execute();
            const sessions = (await sql `SELECT session.* FROM dining_sessions session JOIN dining_services service ON service.school_id=session.school_id AND service.id=session.service_id
        WHERE session.school_id=${school}::uuid AND (session.published_at IS NOT NULL OR session.coordinator_person_id=${actor.person_id}::uuid OR session.operator_person_id=${actor.person_id}::uuid)
        AND (session.label ILIKE ${`%${input.search}%`} OR service.name ILIKE ${`%${input.search}%`})
        AND session.starts_at<((${date}::date+1)::timestamp AT TIME ZONE ${zone.timezone}) AND session.ends_at>(${date}::date::timestamp AT TIME ZONE ${zone.timezone})
        ORDER BY session.starts_at,session.id LIMIT 11 OFFSET ${(input.page - 1) * 10}`.execute(tx)).rows;
            return {
                view: input.view,
                date,
                timezone: zone.timezone,
                can_manage: manager,
                services: await Promise.all(services
                    .slice(0, 10)
                    .map((r) => this.serviceDto(tx, user, r, actor.person_id, manager))),
                sessions: await Promise.all(sessions
                    .slice(0, 10)
                    .map((r) => this.sessionDto(tx, r, actor.person_id, manager))),
                pagination: {
                    page: input.page,
                    page_size: 10,
                    has_more: input.view === "services"
                        ? services.length > 10
                        : sessions.length > 10,
                },
                availability_only: true,
            };
        });
    }
    async service(user, school, id, raw = {}) {
        const input = diningHistoryInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), row = await this.serviceRow(tx, school, id), manager = await this.access.manages(tx, user, school), dto = await this.serviceDto(tx, user, row, actor.person_id, manager);
            const sessions = await tx
                .selectFrom("dining_sessions")
                .selectAll()
                .where("school_id", "=", school)
                .where("service_id", "=", id)
                .where((q) => q.or([
                q("published_at", "is not", null),
                q("coordinator_person_id", "=", actor.person_id),
                q("operator_person_id", "=", actor.person_id),
            ]))
                .orderBy("starts_at", "desc")
                .orderBy("id")
                .limit(11)
                .offset((input.page - 1) * 10)
                .execute();
            const history = manager || actor.person_id === row.coordinator_person_id
                ? await tx
                    .selectFrom("dining_service_receipts")
                    .selectAll()
                    .where("school_id", "=", school)
                    .where("service_id", "=", id)
                    .orderBy("revision", "desc")
                    .limit(11)
                    .offset((input.history_page - 1) * 10)
                    .execute()
                : [];
            return {
                ...dto,
                sessions: await Promise.all(sessions
                    .slice(0, 10)
                    .map((s) => this.sessionDto(tx, s, actor.person_id, manager))),
                sessions_pagination: {
                    page: input.page,
                    page_size: 10,
                    has_more: sessions.length > 10,
                },
                history: await this.history(tx, school, history.slice(0, 10)),
                history_pagination: {
                    page: input.history_page,
                    page_size: 10,
                    has_more: history.length > 10,
                },
            };
        });
    }
    async detail(user, school, id, raw = {}) {
        const input = diningHistoryInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), row = await this.sessionRow(tx, school, id), manager = await this.access.manages(tx, user, school), participant = this.isParticipant(row, actor.person_id);
            if (!row.published_at && !participant) {
                if (manager &&
                    !(await this.recipient(tx, school, row.coordinator_person_id)))
                    return {
                        id,
                        revision: row.revision,
                        recovery_only: true,
                        allowed_actions: ["reassign"],
                        state: row.state,
                    };
                throw new ForbiddenException("This draft belongs to its exact coordinator and operator.");
            }
            const dto = await this.sessionDto(tx, row, actor.person_id, manager);
            const history = participant
                ? await tx
                    .selectFrom("dining_session_receipts")
                    .selectAll()
                    .where("school_id", "=", school)
                    .where("session_id", "=", id)
                    .orderBy("revision", "desc")
                    .limit(11)
                    .offset((input.history_page - 1) * 10)
                    .execute()
                : [];
            const issues = await tx
                .selectFrom("dining_issues")
                .selectAll()
                .where("school_id", "=", school)
                .where("session_id", "=", id)
                .where((q) => q.or([
                q("reporter_person_id", "=", actor.person_id),
                q("handler_person_id", "=", actor.person_id),
                q("coordinator_person_id", "=", actor.person_id),
            ]))
                .orderBy("created_at", "desc")
                .orderBy("id")
                .limit(11)
                .offset((input.page - 1) * 10)
                .execute();
            let path = [];
            if (row.space_id) {
                try {
                    path =
                        (await this.place(tx, school, row.space_id, false))?.path ?? [];
                }
                catch (error) {
                    if (!(error instanceof BadRequestException ||
                        error instanceof ConflictException))
                        throw error;
                }
            }
            return {
                ...dto,
                location_path: path,
                history: await this.history(tx, school, history.slice(0, 10)),
                history_pagination: {
                    page: input.history_page,
                    page_size: 10,
                    has_more: history.length > 10,
                },
                issues: await Promise.all(issues
                    .slice(0, 10)
                    .map((issue) => this.issueDto(tx, issue, actor.person_id, manager))),
                issues_pagination: {
                    page: input.page,
                    page_size: 10,
                    has_more: issues.length > 10,
                },
            };
        });
    }
    async issueDto(tx, row, person, manager) {
        const refs = await this.refs(tx, row.school_id, [
            row.reporter_person_id,
            row.handler_person_id,
            row.coordinator_person_id,
        ], []);
        return {
            id: row.id,
            session_id: row.session_id,
            title: row.title,
            state: row.state,
            revision: row.revision,
            reporter: refs.person(row.reporter_person_id),
            handler: refs.person(row.handler_person_id),
            coordinator: refs.person(row.coordinator_person_id),
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            allowed_actions: await this.issueActions(tx, row, person, manager),
            route_unavailable: !(await this.routeHealthy(tx, row)),
        };
    }
    async issueDetail(user, school, id, raw = {}) {
        const input = diningHistoryInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), row = await this.issueRow(tx, school, id), manager = await this.access.manages(tx, user, school);
            if (!this.issueParticipant(row, actor.person_id)) {
                if (manager &&
                    !(await this.recipient(tx, school, row.coordinator_person_id)))
                    return {
                        id,
                        session_id: row.session_id,
                        revision: row.revision,
                        state: row.state,
                        recovery_only: true,
                        allowed_actions: ["reassign"],
                    };
                throw new ForbiddenException("This report is private to its current participants.");
            }
            const session = await this.sessionRow(tx, school, row.session_id), service = await this.serviceRow(tx, school, session.service_id), refs = await this.refs(tx, school, [], [session.space_id]);
            const history = await tx
                .selectFrom("dining_issue_receipts")
                .selectAll()
                .where("school_id", "=", school)
                .where("issue_id", "=", id)
                .orderBy("revision", "desc")
                .limit(11)
                .offset((input.history_page - 1) * 10)
                .execute();
            return {
                ...(await this.issueDto(tx, row, actor.person_id, manager)),
                detail: row.detail,
                session: {
                    id: session.id,
                    label: session.label,
                    href: diningHref(session.id),
                },
                service: { id: service.id, label: service.name },
                place: refs.space(session.space_id),
                history: await this.history(tx, school, history.slice(0, 10)),
                history_pagination: {
                    page: input.history_page,
                    page_size: 10,
                    has_more: history.length > 10,
                },
            };
        });
    }
    async confirmation(user, school, sourceId, commandId) {
        return this.db.transaction().execute(async (tx) => {
            await this.access.campus(tx, user, school);
            const receipt = await this.model.retained(tx, user, school, commandId);
            if (!receipt)
                return { state: "not_found", result: null };
            if (receipt.target.domain_id !== sourceId)
                throw new NotFoundException("This save belongs to another source.");
            if (receipt.state === "pending")
                return { state: "pending", result: null };
            if (receipt.receipt.terminal_state !== "accepted")
                return { state: "not_accepted", result: null };
            return {
                state: "accepted",
                result: receipt.receipt.metadata,
            };
        });
    }
    async options(user, school, raw = {}) {
        const input = diningOptionsInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school);
            let canChoose = manager;
            if (input.service_id) {
                const s = await this.serviceRow(tx, school, input.service_id);
                canChoose ||= s.coordinator_person_id === actor.person_id;
            }
            if (input.session_id) {
                const s = await this.sessionRow(tx, school, input.session_id);
                canChoose ||=
                    s.coordinator_person_id === actor.person_id ||
                        s.operator_person_id === actor.person_id;
            }
            if (input.issue_id) {
                const issue = await this.issueRow(tx, school, input.issue_id);
                canChoose ||= issue.coordinator_person_id === actor.person_id;
            }
            if (input.plan_id) {
                const plan = await tx
                    .selectFrom("dining_weekly_plans")
                    .select(["coordinator_person_id"])
                    .where("school_id", "=", school)
                    .where("id", "=", input.plan_id)
                    .executeTakeFirst();
                if (!plan)
                    throw new NotFoundException("Weekly plan not found.");
                canChoose ||= plan.coordinator_person_id === actor.person_id;
            }
            let people = canChoose
                ? await tx
                    .selectFrom("school_people")
                    .select(["id", "first_name", "last_name"])
                    .where("school_id", "=", school)
                    .where((q) => q.or([
                    q("first_name", "ilike", `%${input.search}%`),
                    q("last_name", "ilike", `%${input.search}%`),
                ]))
                    .orderBy("first_name")
                    .orderBy("id")
                    .limit(26)
                    .offset((input.page - 1) * 25)
                    .execute()
                : [];
            if (canChoose &&
                input.person_id &&
                !people.some((p) => p.id === input.person_id)) {
                const selected = await tx
                    .selectFrom("school_people")
                    .select(["id", "first_name", "last_name"])
                    .where("school_id", "=", school)
                    .where("id", "=", input.person_id)
                    .executeTakeFirst();
                if (selected)
                    people = [...people.slice(0, 25), selected];
            }
            const hasMorePeople = people.length > 25;
            const selectedPeople = people.slice(0, 25);
            if (input.person_id) {
                const retained = people.find((p) => p.id === input.person_id);
                if (retained && !selectedPeople.some((p) => p.id === retained.id))
                    selectedPeople.push(retained);
            }
            const states = selectedPeople.length
                ? await this.access.identities.listPersonAccountStates(tx, {
                    school_id: school,
                    person_ids: selectedPeople.map((p) => p.id),
                    at: executionNow().toISOString(),
                    viewer_user_id: user.id,
                })
                : [];
            let spaces = canChoose
                ? (await sql `SELECT space.id,space.name AS label FROM campus_spaces space JOIN institution_campuses campus ON campus.school_id=space.school_id AND campus.id=space.campus_id
        WHERE space.school_id=${school}::uuid AND space.status='active' AND campus.status='active' AND space.kind<>'virtual' AND space.name ILIKE ${`%${input.search}%`}
        AND NOT EXISTS(SELECT 1 FROM accommodation_rooms room WHERE room.school_id=space.school_id AND room.space_id=space.id AND room.active)
        ORDER BY space.name,space.id LIMIT 26 OFFSET ${(input.page - 1) * 25}`.execute(tx)).rows
                : [];
            const hasMoreSpaces = spaces.length > 25;
            spaces = spaces.slice(0, 25);
            if (canChoose &&
                input.space_id &&
                !spaces.some((s) => s.id === input.space_id)) {
                try {
                    const selected = await this.place(tx, school, input.space_id);
                    if (selected)
                        spaces.push({ id: selected.id, label: selected.name });
                }
                catch (error) {
                    if (!(error instanceof BadRequestException ||
                        error instanceof ConflictException))
                        throw error;
                }
            }
            const canCreate = canChoose &&
                Boolean(await tx
                    .selectFrom("school_memberships")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("user_id", "=", user.id)
                    .where("role", "=", "admin")
                    .where("is_active", "=", true)
                    .executeTakeFirst());
            const campuses = canChoose
                ? await tx
                    .selectFrom("institution_campuses")
                    .select(["id", "name as label", "is_primary"])
                    .where("school_id", "=", school)
                    .where("status", "=", "active")
                    .orderBy("name")
                    .limit(100)
                    .execute()
                : [];
            return {
                people: selectedPeople.map((p) => ({
                    id: p.id,
                    label: `${p.first_name} ${p.last_name}`.trim(),
                    has_app: states.some((s) => s.person_id === p.id && s.account_state === "active"),
                })),
                people_has_more: hasMorePeople,
                spaces,
                spaces_has_more: hasMoreSpaces,
                can_create_places: canCreate,
                campuses,
                page: input.page,
            };
        });
    }
    async discovery(user, school) {
        try {
            return await this.db.transaction().execute(async (tx) => {
                const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school);
                const found = await tx
                    .selectFrom("dining_services")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("active", "=", true)
                    .limit(1)
                    .execute();
                const published = await tx
                    .selectFrom("dining_sessions")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("published_at", "is not", null)
                    .where((q) => q.or([
                    q("operator_person_id", "=", actor.person_id),
                    q("coordinator_person_id", "=", actor.person_id),
                ]))
                    .limit(1)
                    .execute();
                return {
                    can_manage: manager,
                    has_services: found.length > 0,
                    has_published_sessions: published.length > 0,
                };
            });
        }
        catch (error) {
            if (error instanceof ForbiddenException)
                return {
                    can_manage: false,
                    has_services: false,
                    has_published_sessions: false,
                };
            throw error;
        }
    }
    async work(user, school) {
        try {
            return await this.db.transaction().execute(async (tx) => {
                const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school);
                const sessions = (await sql `SELECT * FROM dining_sessions s WHERE school_id=${school}::uuid AND state NOT IN('ended','cancelled') AND (coordinator_person_id=${actor.person_id}::uuid OR operator_person_id=${actor.person_id}::uuid OR ${manager} AND NOT dining_person_available(s.school_id,s.coordinator_person_id)) ORDER BY created_at,id`.execute(tx)).rows;
                const issues = (await sql `SELECT * FROM dining_issues issue WHERE school_id=${school}::uuid AND state<>'resolved' AND (reporter_person_id=${actor.person_id}::uuid OR handler_person_id=${actor.person_id}::uuid OR coordinator_person_id=${actor.person_id}::uuid OR ${manager} AND NOT dining_person_available(issue.school_id,issue.coordinator_person_id)) ORDER BY created_at,id`.execute(tx)).rows;
                const result = { needs_me: [], waiting: [] };
                const owners = await this.refs(tx, school, [
                    ...sessions.map((row) => row.state === "draft"
                        ? row.coordinator_person_id
                        : row.operator_person_id),
                    ...issues.map((row) => row.handler_person_id),
                ], []);
                for (const row of [...sessions, ...issues]) {
                    const issue = "session_id" in row, sourceKind = issue ? "dining_issue" : "dining_session", sessionId = issue ? row.session_id : row.id;
                    if (!issue &&
                        row.state !== "draft" &&
                        row.operations_mode !== "native")
                        continue;
                    const person = issue
                        ? row.handler_person_id
                        : row.state === "draft"
                            ? row.coordinator_person_id
                            : row.operator_person_id, next = await this.recipient(tx, school, person), coordinator = await this.recipient(tx, school, row.coordinator_person_id), healthy = await this.routeHealthy(tx, row);
                    const recovery = !next || !coordinator || !healthy, ownsRecovery = actor.person_id === row.coordinator_person_id ||
                        (manager && !coordinator);
                    const mine = recovery ? ownsRecovery : person === actor.person_id;
                    const record = {
                        id: `dining:${sourceKind}:${row.id}`,
                        source_id: row.id,
                        source_kind: sourceKind,
                        session_id: sessionId,
                        issue_id: issue ? row.id : null,
                        revision: row.revision,
                        title: issue ? "Dining report" : "Dining service",
                        state: recovery
                            ? "route_unavailable"
                            : mine
                                ? "review_needed"
                                : "waiting_for_review",
                        href: diningHref(sessionId, issue ? row.id : undefined),
                        created_at: row.created_at.toISOString(),
                        due_at: null,
                        message_id: row.coordination_receipt?.message_id ?? null,
                        owner: {
                            user_id: next?.user_id ?? null,
                            label: next
                                ? owners.person(person).label
                                : "Responsibility unavailable",
                        },
                        action: recovery
                            ? "recover"
                            : issue
                                ? "resolve"
                                : row.state === "draft"
                                    ? "publish"
                                    : "run",
                    };
                    (mine ? result.needs_me : result.waiting).push(record);
                }
                return result;
            });
        }
        catch (error) {
            if (error instanceof ForbiddenException)
                return { needs_me: [], waiting: [] };
            throw error;
        }
    }
};
DiningService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService,
        DiningAccess,
        DiningModel,
        DiningWeeklyService])
], DiningService);
export { DiningService };
//# sourceMappingURL=dining.service.js.map