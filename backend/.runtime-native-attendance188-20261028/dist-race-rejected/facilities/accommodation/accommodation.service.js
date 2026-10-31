var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException, } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { executionNow } from "../../campus-model-core/execution-time.runtime.js";
import { lockCampusSpaceUse, assertSpaceCanBecomeResidential, } from "../../common/campus-space-use.js";
import { DatabaseService } from "../../database/database.service.js";
import { ResourceLoansService } from "../../resource-loans/resource-loans.service.js";
import { retainOperatingDestination } from "../../institution-onboarding/operating-resume.js";
import { institutionSchoolPermission } from "../../roles/authorization.js";
import { AccommodationAccess } from "./accommodation.access.js";
import { AccommodationModel, } from "./accommodation.model.js";
import { accommodationType, accommodationRoom, accommodationPlace, accommodationOffer, accommodationAction, accommodationLoan, accommodationList, accommodationOptions, accommodationHref, } from "./accommodation.contracts.js";
const iso = (value) => value === null ? null : new Date(value).toISOString();
function fail(message) {
    throw new UnprocessableEntityException(message);
}
const nativeError = (error) => {
    if (error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "23514" || error.code === "23505"))
        throw new UnprocessableEntityException("message" in error
            ? String(error.message)
            : "This arrangement conflicts with current accommodation records.");
    throw error;
};
let AccommodationService = class AccommodationService {
    db;
    access;
    model;
    loans;
    constructor(db, access, model, loans) {
        this.db = db;
        this.access = access;
        this.model = model;
        this.loans = loans;
    }
    async lock(tx, school) {
        await lockCampusSpaceUse(tx, school);
        await sql `SELECT set_config('thatcampus.accommodation_now',${executionNow().toISOString()},true)`.execute(tx);
    }
    async person(tx, school, id) {
        const row = (await sql `SELECT id,first_name,last_name FROM school_people WHERE school_id=${school}::uuid AND id=${id}::uuid AND retired_at IS NULL`.execute(tx)).rows[0];
        if (!row)
            throw new UnprocessableEntityException("Choose a current person in this campus.");
        return { id: row.id, label: `${row.first_name} ${row.last_name}`.trim() };
    }
    async endpoint(tx, school, person, cache) {
        const key = `${school}:${person}`;
        if (cache?.has(key))
            return cache.get(key);
        const pending = this.resolveEndpoint(tx, school, person);
        cache?.set(key, pending);
        return pending;
    }
    async resolveEndpoint(tx, school, person) {
        const result = await this.access.identities.resolvePersonAgent(tx, {
            school_id: school,
            person_id: person,
            at: executionNow().toISOString(),
        });
        return result.acting
            ? { person_id: result.person_id, user_id: result.user_id }
            : null;
    }
    participants(stay) {
        return [
            ...new Set([
                stay.resident_person_id,
                stay.coordinator_person_id,
                stay.recorder_person_id,
            ]),
        ];
    }
    async stay(tx, school, id, lock = false) {
        let query = tx
            .selectFrom("accommodation_stays")
            .selectAll()
            .where("school_id", "=", school)
            .where("id", "=", id);
        if (lock)
            query = query.forUpdate();
        const row = await query.executeTakeFirst();
        if (!row)
            throw new NotFoundException("This stay is unavailable in the selected campus.");
        return row;
    }
    async roomIn(tx, school, id, lock = false) {
        let query = tx
            .selectFrom("accommodation_rooms")
            .selectAll()
            .where("school_id", "=", school)
            .where("id", "=", id);
        if (lock)
            query = query.forUpdate();
        const row = await query.executeTakeFirst();
        if (!row)
            throw new NotFoundException("This residential room is unavailable.");
        return row;
    }
    async unavailable(tx, stay, cache) {
        return (!(await this.endpoint(tx, stay.school_id, stay.coordinator_person_id, cache)) ||
            !(await this.endpoint(tx, stay.school_id, stay.recorder_person_id, cache)));
    }
    async readable(tx, user, stay) {
        const actor = await this.access.campus(tx, user, stay.school_id), manager = await this.access.manages(tx, user, stay.school_id), participant = this.participants(stay).includes(actor.person_id), recovery = manager && !participant && (await this.unavailable(tx, stay));
        if (!participant && !recovery)
            throw new ForbiddenException("This stay is private to its current resident and responsible people.");
        return { actor, manager, participant, recovery };
    }
    async audience(tx, stay) {
        const audience = [];
        for (const person of this.participants(stay)) {
            const endpoint = await this.endpoint(tx, stay.school_id, person);
            if (endpoint)
                audience.push(endpoint.user_id);
        }
        return [...new Set(audience)];
    }
    async next(tx, stay, cache) {
        if (!["offered", "accepted"].includes(stay.state))
            return null;
        if (stay.state === "offered" || stay.proposed_ends_at)
            return ((await this.endpoint(tx, stay.school_id, stay.resident_person_id, cache)) ??
                (await this.endpoint(tx, stay.school_id, stay.coordinator_person_id, cache)));
        return this.endpoint(tx, stay.school_id, stay.actual_move_out_at
            ? stay.coordinator_person_id
            : stay.recorder_person_id, cache);
    }
    async routeReady(tx, stay, cache) {
        const receipt = stay.coordination_receipt, next = await this.next(tx, stay, cache);
        if (!next ||
            !receipt.message_id ||
            receipt.route_unavailable ||
            receipt.recipient_user_id !== next.user_id)
            return false;
        const trace = await this.model.coordination.findExactTrace(tx, {
            school_id: stay.school_id,
            source_domain: "accommodation",
            source_record_id: stay.id,
            event_type: receipt.event_type,
            source_revision: receipt.source_revision,
            message_id: receipt.message_id,
        });
        return Boolean(trace?.message_open);
    }
    async capacity(tx, stay, physical = false) {
        const room = await this.roomIn(tx, stay.school_id, stay.room_id);
        await this.validateRoomTopology(tx, room);
        await sql `SELECT accommodation_assert_capacity(${stay.school_id}::uuid,${stay.room_id}::uuid,${stay.id}::uuid,${stay.resident_person_id}::uuid,${stay.place_id}::uuid,${stay.planned_starts_at}::timestamptz,${stay.proposed_ends_at ?? stay.planned_ends_at}::timestamptz,${physical})`.execute(tx);
    }
    async validateRoomTopology(tx, room) {
        await this.space(tx, room.school_id, room.space_id);
        const invalid = (await sql `WITH RECURSIVE path AS(
      SELECT id,parent_space_id,campus_id,status,kind,ARRAY[id] AS visited FROM campus_spaces WHERE school_id=${room.school_id}::uuid AND id=${room.space_id}::uuid
      UNION ALL SELECT parent.id,parent.parent_space_id,parent.campus_id,parent.status,parent.kind,child.visited||parent.id FROM campus_spaces parent JOIN path child ON parent.id=child.parent_space_id WHERE parent.school_id=${room.school_id}::uuid AND NOT parent.id=ANY(child.visited) AND cardinality(child.visited)<33)
      SELECT bool_or(status<>'active' OR kind='virtual' OR parent_space_id=ANY(visited) OR cardinality(visited)>=33 OR campus_id<>(SELECT campus_id FROM campus_spaces WHERE school_id=${room.school_id}::uuid AND id=${room.space_id}::uuid)) AS invalid FROM path`.execute(tx)).rows[0];
        if (invalid?.invalid)
            fail("This room’s campus or containing hostel hierarchy needs review before new arrangements or movement.");
    }
    /** An actual interval is checked against retained physical history, not merely
     * whichever people happen to be inside at the time a late record is saved. */
    async physicalCapacity(tx, stay, starts, ends) {
        const room = await this.roomIn(tx, stay.school_id, stay.room_id);
        await this.validateRoomTopology(tx, room);
        const conflict = (await sql `WITH actual AS(
      SELECT resident_person_id,room_id,place_id,actual_move_in_at AS lo,coalesce(actual_move_out_at,'infinity'::timestamptz) AS hi FROM accommodation_stays
      WHERE school_id=${stay.school_id}::uuid AND id<>${stay.id}::uuid AND actual_move_in_at IS NOT NULL AND tstzrange(actual_move_in_at,actual_move_out_at,'[)') && tstzrange(${starts}::timestamptz,${ends}::timestamptz,'[)')),
      boundaries AS(SELECT ${starts}::timestamptz AS at UNION SELECT lo FROM actual WHERE room_id=${stay.room_id}::uuid AND lo>${starts}::timestamptz AND lo<coalesce(${ends}::timestamptz,'infinity'::timestamptz))
      SELECT EXISTS(SELECT 1 FROM actual WHERE resident_person_id=${stay.resident_person_id}::uuid) AS person_conflict,
       EXISTS(SELECT 1 FROM actual WHERE room_id=${stay.room_id}::uuid AND(${room.allocation_mode === "whole_room"} OR ${stay.place_id}::uuid IS NOT NULL AND place_id=${stay.place_id}::uuid)) AS place_conflict,
       coalesce((SELECT max((SELECT count(*) FROM actual WHERE room_id=${stay.room_id}::uuid AND lo<=boundary.at AND hi>boundary.at)) FROM boundaries boundary),0)::int AS peak`.execute(tx)).rows[0];
        if (conflict.person_conflict ||
            conflict.place_conflict ||
            conflict.peak + 1 >
                (room.allocation_mode === "whole_room" ? 1 : room.sleeping_capacity))
            fail("This physical interval would overlap another actual resident. Resolve the discrepancy without rewriting their occupancy.");
    }
    async space(tx, school, id) {
        const row = await tx
            .selectFrom("campus_spaces as space")
            .innerJoin("institution_campuses as campus", (join) => join
            .onRef("campus.id", "=", "space.campus_id")
            .onRef("campus.school_id", "=", "space.school_id"))
            .select(["space.id", "space.name", "space.status", "space.kind"])
            .where("space.school_id", "=", school)
            .where("space.id", "=", id)
            .where("campus.status", "=", "active")
            .executeTakeFirst();
        if (!row || row.status !== "active" || row.kind === "virtual")
            fail("Choose an active physical campus place.");
        return { id: row.id, label: row.name };
    }
    async roomDto(tx, room) {
        return (await this.roomDtos(tx, [room]))[0];
    }
    async roomDtos(tx, rooms) {
        if (!rooms.length)
            return [];
        const school = rooms[0].school_id, roomIds = rooms.map((room) => room.id), spaceIds = rooms.map((room) => room.space_id);
        const [spaces, types, places, furnishings, path] = await Promise.all([
            tx
                .selectFrom("campus_spaces")
                .select(["id", "name"])
                .where("school_id", "=", school)
                .where("id", "in", spaceIds)
                .execute(),
            tx
                .selectFrom("accommodation_room_types")
                .select(["id", "name"])
                .where("school_id", "=", school)
                .where("id", "in", rooms.map((room) => room.room_type_id))
                .execute(),
            tx
                .selectFrom("accommodation_places as place")
                .leftJoin("campus_resource_holdings as holding", (join) => join
                .onRef("holding.id", "=", "place.holding_id")
                .onRef("holding.school_id", "=", "place.school_id"))
                .selectAll("place")
                .select(["holding.name as holding_name"])
                .where("place.school_id", "=", school)
                .where("place.room_id", "in", roomIds)
                .orderBy("place.label")
                .execute(),
            sql `SELECT id,name,space_id,asset_tag,quantity,state FROM(
       SELECT holding.*,row_number() OVER(PARTITION BY space_id ORDER BY name,id) AS ordinal FROM campus_resource_holdings holding WHERE school_id=${school}::uuid AND space_id=ANY(${spaceIds}::uuid[]) AND state<>'retired') holding WHERE ordinal<=51 ORDER BY space_id,name,id`.execute(tx),
            sql `WITH RECURSIVE ancestors AS(
        SELECT id AS root_id,id,name,parent_space_id,campus_id,0 AS depth FROM campus_spaces WHERE school_id=${school}::uuid AND id=ANY(${spaceIds}::uuid[])
        UNION ALL SELECT child.root_id,parent.id,parent.name,parent.parent_space_id,parent.campus_id,child.depth+1 FROM campus_spaces parent JOIN ancestors child ON parent.id=child.parent_space_id WHERE parent.school_id=${school}::uuid AND child.depth<32)
        SELECT root_id,id,label FROM(SELECT DISTINCT ancestor.root_id,campus.id,campus.name AS label,1000 AS sort FROM institution_campuses campus JOIN ancestors ancestor ON ancestor.campus_id=campus.id WHERE campus.school_id=${school}::uuid
         UNION ALL SELECT root_id,id,name AS label,depth AS sort FROM ancestors) path ORDER BY root_id,sort DESC`.execute(tx),
        ]);
        const spaceById = new Map(spaces.map((space) => [space.id, space])), typeById = new Map(types.map((type) => [type.id, type]));
        return rooms.map((room) => {
            const space = spaceById.get(room.space_id), type = typeById.get(room.room_type_id);
            if (!space || !type)
                throw new ConflictException("The residential room’s canonical references need review.");
            const items = furnishings.rows.filter((item) => item.space_id === room.space_id);
            return {
                ...room,
                created_at: iso(room.created_at),
                updated_at: iso(room.updated_at),
                space: { id: space.id, label: space.name },
                room_type: { id: type.id, label: type.name },
                location_path: path.rows
                    .filter((ref) => ref.root_id === room.space_id)
                    .map((ref) => ({ id: ref.id, label: ref.label })),
                places: places
                    .filter((place) => place.room_id === room.id)
                    .map((place) => ({
                    id: place.id,
                    revision: place.revision,
                    label: place.label,
                    active: place.active,
                    holding: place.holding_id
                        ? {
                            id: place.holding_id,
                            label: place.holding_name ?? "Resource",
                        }
                        : null,
                })),
                furnishings_has_more: items.length > 50,
                furnishings: items.slice(0, 50).map((item) => ({
                    id: item.id,
                    label: item.name,
                    asset_tag: item.asset_tag,
                    quantity: item.quantity,
                    state: item.state,
                })),
            };
        });
    }
    async summary(tx, stay) {
        return (await this.summaries(tx, [stay]))[0];
    }
    async summaries(tx, stays) {
        if (!stays.length)
            return [];
        const rows = (await sql `SELECT stay.id,concat_ws(' ',resident.first_name,resident.last_name) AS resident_label,concat_ws(' ',coordinator.first_name,coordinator.last_name) AS coordinator_label,concat_ws(' ',recorder.first_name,recorder.last_name) AS recorder_label,space.name AS room_label,place.label AS place_label
     FROM accommodation_stays stay JOIN accommodation_rooms room ON room.id=stay.room_id AND room.school_id=stay.school_id JOIN campus_spaces space ON space.id=room.space_id AND space.school_id=stay.school_id
     JOIN school_people resident ON resident.id=stay.resident_person_id AND resident.school_id=stay.school_id JOIN school_people coordinator ON coordinator.id=stay.coordinator_person_id AND coordinator.school_id=stay.school_id JOIN school_people recorder ON recorder.id=stay.recorder_person_id AND recorder.school_id=stay.school_id LEFT JOIN accommodation_places place ON place.id=stay.place_id AND place.school_id=stay.school_id
     WHERE stay.school_id=${stays[0].school_id}::uuid AND stay.id=ANY(${stays.map((stay) => stay.id)}::uuid[])`.execute(tx)).rows;
        const lookup = new Map(rows.map((row) => [row.id, row]));
        return stays.map((stay) => {
            const row = lookup.get(stay.id);
            if (!row)
                throw new ConflictException("This stay’s canonical references need review.");
            return {
                id: stay.id,
                revision: stay.revision,
                state: stay.state,
                arrangement_basis: stay.arrangement_basis,
                resident: { id: stay.resident_person_id, label: row.resident_label },
                coordinator: {
                    id: stay.coordinator_person_id,
                    label: row.coordinator_label,
                },
                recorder: { id: stay.recorder_person_id, label: row.recorder_label },
                room: { id: stay.room_id, label: row.room_label },
                place: stay.place_id
                    ? { id: stay.place_id, label: row.place_label ?? "Named place" }
                    : null,
                planned_starts_at: iso(stay.planned_starts_at),
                planned_ends_at: iso(stay.planned_ends_at),
                proposed_ends_at: iso(stay.proposed_ends_at),
                actual_move_in_at: iso(stay.actual_move_in_at),
                actual_move_out_at: iso(stay.actual_move_out_at),
                overstayed: Boolean(stay.actual_move_in_at &&
                    !stay.actual_move_out_at &&
                    stay.planned_ends_at < executionNow()),
                updated_at: iso(stay.updated_at),
            };
        });
    }
    async accessSummary(tx, user, stay) {
        const links = await tx
            .selectFrom("accommodation_access_loans")
            .selectAll()
            .where("school_id", "=", stay.school_id)
            .where("stay_id", "=", stay.id)
            .orderBy("created_at")
            .execute(), result = [];
        for (const link of links)
            result.push({
                id: link.id,
                return_required: link.return_required,
                ...(await this.loans.accommodationCustody(tx, user, stay.school_id, stay.id, link.loan_id)),
            });
        return {
            access_loans: result,
            access_settled: (stay.access_mode !== "tracked_required" ||
                result.some((link) => link.return_required)) &&
                result
                    .filter((link) => link.return_required)
                    .every((link) => link.outstanding === 0),
        };
    }
    async repairSummary(tx, user, stay) {
        if (!stay.repair_id)
            return null;
        const actor = await this.access.campus(tx, user, stay.school_id), repair = await tx
            .selectFrom("facilities_repairs")
            .select([
            "id",
            "state",
            "reporter_person_id",
            "recorder_person_id",
            "coordinator_person_id",
            "handler_person_id",
            "verifier_person_id",
        ])
            .where("school_id", "=", stay.school_id)
            .where("id", "=", stay.repair_id)
            .executeTakeFirstOrThrow();
        return {
            id: repair.id,
            label: "Related repair",
            state: repair.state,
            href: [
                repair.reporter_person_id,
                repair.recorder_person_id,
                repair.coordinator_person_id,
                repair.handler_person_id,
                repair.verifier_person_id,
            ].includes(actor.person_id)
                ? `/areas/facilities?repair_id=${repair.id}`
                : null,
        };
    }
    async detailIn(tx, user, stay, page = 1) {
        const permission = await this.readable(tx, user, stay), coordinator = permission.actor.person_id === stay.coordinator_person_id, recorder = permission.actor.person_id === stay.recorder_person_id, resident = permission.actor.person_id === stay.resident_person_id, route = await this.routeReady(tx, stay), unavailable = await this.unavailable(tx, stay), active = ["offered", "accepted"].includes(stay.state), canCoordinate = coordinator || permission.recovery;
        if (permission.recovery)
            return {
                id: stay.id,
                revision: stay.revision,
                state: stay.state,
                recovery_only: true,
                route_unavailable: true,
                coordinator_unavailable: !(await this.endpoint(tx, stay.school_id, stay.coordinator_person_id)),
                recorder_unavailable: !(await this.endpoint(tx, stay.school_id, stay.recorder_person_id)),
                allowed_actions: { reassign: true },
                history: [],
                history_pagination: { page: 1, page_size: 10, total: 0 },
            };
        const access = await this.accessSummary(tx, user, stay), history = await tx
            .selectFrom("accommodation_receipts as receipt")
            .innerJoin("school_people as actor", (join) => join
            .onRef("actor.id", "=", "receipt.actor_person_id")
            .onRef("actor.school_id", "=", "receipt.school_id"))
            .selectAll("receipt")
            .select(["actor.first_name", "actor.last_name"])
            .where("receipt.school_id", "=", stay.school_id)
            .where("receipt.stay_id", "=", stay.id)
            .orderBy("receipt.revision", "desc")
            .limit(10)
            .offset((page - 1) * 10)
            .execute();
        const origin = stay.origin_space_id
            ? await tx
                .selectFrom("campus_spaces")
                .select(["id", "name"])
                .where("school_id", "=", stay.school_id)
                .where("id", "=", stay.origin_space_id)
                .executeTakeFirst()
            : null, destination = stay.destination_space_id
            ? await tx
                .selectFrom("campus_spaces")
                .select(["id", "name"])
                .where("school_id", "=", stay.school_id)
                .where("id", "=", stay.destination_space_id)
                .executeTakeFirst()
            : null;
        return {
            ...(await this.summary(tx, stay)),
            accepted_at: iso(stay.accepted_at),
            instructions: stay.instructions,
            origin_space: origin ? { id: origin.id, label: origin.name } : null,
            origin_note: stay.origin_note,
            destination_space: destination
                ? { id: destination.id, label: destination.name }
                : null,
            destination_note: stay.destination_note,
            repair: await this.repairSummary(tx, user, stay),
            access_mode: stay.access_mode,
            ...access,
            route_unavailable: active && !route,
            coordinator_unavailable: !(await this.endpoint(tx, stay.school_id, stay.coordinator_person_id)),
            recorder_unavailable: !(await this.endpoint(tx, stay.school_id, stay.recorder_person_id)),
            recovery_only: false,
            allowed_actions: {
                accept: resident && stay.state === "offered" && route,
                decline: resident && stay.state === "offered" && route,
                record_response: stay.arrangement_basis === "resident_offer" &&
                    coordinator &&
                    active &&
                    (stay.state === "offered" || Boolean(stay.proposed_ends_at)),
                move_in: recorder &&
                    stay.state === "accepted" &&
                    !stay.actual_move_in_at &&
                    route,
                move_out: recorder &&
                    stay.state === "accepted" &&
                    Boolean(stay.actual_move_in_at) &&
                    !stay.actual_move_out_at &&
                    route,
                extend: stay.arrangement_basis === "resident_offer" &&
                    coordinator &&
                    stay.state === "accepted" &&
                    !stay.actual_move_out_at &&
                    !stay.proposed_ends_at,
                change_end: stay.arrangement_basis === "coordinator_allocation" &&
                    coordinator &&
                    stay.state === "accepted" &&
                    !stay.actual_move_out_at,
                accept_extension: resident && Boolean(stay.proposed_ends_at) && route,
                decline_extension: resident && Boolean(stay.proposed_ends_at) && route,
                cancel: coordinator && active && !stay.actual_move_in_at,
                correct_move: recorder &&
                    Boolean(stay.actual_move_in_at) &&
                    stay.state !== "closed",
                reassign: canCoordinate && active && (unavailable || coordinator),
                close: coordinator &&
                    stay.state === "accepted" &&
                    Boolean(stay.actual_move_out_at) &&
                    access.access_settled,
                link_access: (coordinator || recorder) && active,
            },
            history: history.map((receipt) => ({
                id: receipt.id,
                revision: receipt.revision,
                action: receipt.action,
                arrangement_basis: receipt.arrangement_basis,
                actor_label: `${receipt.first_name} ${receipt.last_name}`.trim(),
                occurred_at: iso(receipt.recorded_at),
                recorded_at: iso(receipt.recorded_at),
                observed_at: iso(receipt.observed_at),
                note: receipt.note,
                method: receipt.method,
                response: receipt.response,
                response_for: receipt.response_for,
                supersedes_receipt_id: receipt.supersedes_receipt_id,
                movement_kind: receipt.movement_kind,
                movement_retracted: receipt.movement_retracted,
                planned_ends_at: iso(receipt.planned_ends_at),
                proposed_ends_at: iso(receipt.proposed_ends_at),
            })),
            history_pagination: { page, page_size: 10, total: stay.revision },
        };
    }
    detail(user, school, id, raw = {}) {
        const query = z
            .object({
            history_page: z.coerce.number().int().min(1).max(100000).default(1),
        })
            .strict()
            .parse(raw);
        return this.db
            .transaction()
            .execute(async (tx) => this.detailIn(tx, user, await this.stay(tx, school, id), query.history_page));
    }
    async room(user, school, id) {
        return this.db.transaction().execute(async (tx) => {
            await this.access.manager(tx, user, school);
            return this.roomDto(tx, await this.roomIn(tx, school, id));
        });
    }
    async workspace(user, school, raw = {}) {
        const input = accommodationList.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school), pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`, participant = sql `${actor.person_id}::uuid IN(stay.resident_person_id,stay.coordinator_person_id,stay.recorder_person_id)`;
            const rows = (await sql `SELECT stay.* FROM accommodation_stays stay JOIN campus_spaces space ON space.id=(SELECT space_id FROM accommodation_rooms WHERE id=stay.room_id AND school_id=stay.school_id) AND space.school_id=stay.school_id JOIN school_people resident ON resident.id=stay.resident_person_id AND resident.school_id=stay.school_id WHERE stay.school_id=${school}::uuid AND ${participant} AND(${input.state === "all"} OR ${input.state === "closed"} AND stay.state IN('closed','cancelled','declined') OR ${input.state === "active"} AND stay.state IN('offered','accepted')) AND(concat_ws(' ',resident.first_name,resident.last_name) ILIKE ${pattern} OR space.name ILIKE ${pattern}) ORDER BY stay.updated_at DESC,stay.id LIMIT 10 OFFSET ${(input.page - 1) * 10}`.execute(tx)).rows;
            const totals = (await sql `SELECT count(*) FILTER(WHERE stay.state IN('offered','accepted'))::int AS active,count(*) FILTER(WHERE stay.state='offered')::int AS offered,count(*) FILTER(WHERE stay.actual_move_in_at IS NOT NULL AND stay.actual_move_out_at IS NULL)::int AS occupied,count(*) FILTER(WHERE stay.state IN('closed','cancelled','declined'))::int AS closed,count(*) FILTER(WHERE ${input.state === "all"} OR ${input.state === "closed"} AND stay.state IN('closed','cancelled','declined') OR ${input.state === "active"} AND stay.state IN('offered','accepted'))::int AS total FROM accommodation_stays stay WHERE stay.school_id=${school}::uuid AND ${participant}`.execute(tx)).rows[0];
            if (input.search) {
                totals.total = (await sql `SELECT count(*)::int AS total FROM accommodation_stays stay JOIN accommodation_rooms room ON room.id=stay.room_id AND room.school_id=stay.school_id JOIN campus_spaces space ON space.id=room.space_id AND space.school_id=stay.school_id JOIN school_people resident ON resident.id=stay.resident_person_id AND resident.school_id=stay.school_id WHERE stay.school_id=${school}::uuid AND ${participant}
        AND(${input.state === "all"} OR ${input.state === "closed"} AND stay.state IN('closed','cancelled','declined') OR ${input.state === "active"} AND stay.state IN('offered','accepted')) AND(concat_ws(' ',resident.first_name,resident.last_name) ILIKE ${pattern} OR space.name ILIKE ${pattern})`.execute(tx)).rows[0].total;
            }
            const roomRows = manager && input.view === "rooms"
                ? await tx
                    .selectFrom("accommodation_rooms as room")
                    .innerJoin("campus_spaces as space", (join) => join
                    .onRef("space.id", "=", "room.space_id")
                    .onRef("space.school_id", "=", "room.school_id"))
                    .selectAll("room")
                    .where("room.school_id", "=", school)
                    .where("space.name", "ilike", pattern)
                    .orderBy("space.name")
                    .limit(10)
                    .offset((input.page - 1) * 10)
                    .execute()
                : [], roomTotal = manager && input.view === "rooms"
                ? (await tx
                    .selectFrom("accommodation_rooms as room")
                    .innerJoin("campus_spaces as space", "space.id", "room.space_id")
                    .select(({ fn }) => fn.countAll().as("count"))
                    .where("room.school_id", "=", school)
                    .where("space.name", "ilike", pattern)
                    .executeTakeFirstOrThrow()).count
                : 0;
            const stays = await this.summaries(tx, rows);
            const rooms = await this.roomDtos(tx, roomRows);
            return {
                view: input.view,
                can_manage: manager,
                can_offer: manager,
                stays,
                rooms,
                room_types: manager
                    ? await tx
                        .selectFrom("accommodation_room_types")
                        .selectAll()
                        .where("school_id", "=", school)
                        .orderBy("name")
                        .limit(25)
                        .execute()
                    : [],
                totals,
                pagination: {
                    page: input.page,
                    page_size: 10,
                    total: input.view === "rooms" ? Number(roomTotal) : totals.total,
                },
            };
        });
    }
    async options(user, school, raw = {}) {
        const input = accommodationOptions.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school);
            let source = false, sourceRecorder = false;
            if (input.stay_id) {
                const stay = await this.stay(tx, school, input.stay_id), permission = await this.readable(tx, user, stay);
                source =
                    permission.actor.person_id === stay.coordinator_person_id ||
                        permission.recovery;
                sourceRecorder = permission.actor.person_id === stay.recorder_person_id;
            }
            if (input.repair_id) {
                const repair = await tx
                    .selectFrom("facilities_repairs")
                    .select([
                    "reporter_person_id",
                    "recorder_person_id",
                    "handler_person_id",
                    "coordinator_person_id",
                    "verifier_person_id",
                ])
                    .where("school_id", "=", school)
                    .where("id", "=", input.repair_id)
                    .executeTakeFirst();
                if (!repair ||
                    ![
                        repair.reporter_person_id,
                        repair.recorder_person_id,
                        repair.handler_person_id,
                        repair.coordinator_person_id,
                        repair.verifier_person_id,
                    ].includes(actor.person_id))
                    throw new ForbiddenException("Open the exact authorized repair.");
            }
            const canChoose = manager || source, pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`, offset = (input.page - 1) * 25;
            const people = canChoose
                ? (await sql `SELECT id,concat_ws(' ',first_name,last_name) AS label FROM school_people WHERE school_id=${school}::uuid AND retired_at IS NULL AND(concat_ws(' ',first_name,last_name) ILIKE ${pattern} OR id=${input.person_id ?? null}::uuid) ORDER BY first_name,last_name,id LIMIT 25 OFFSET ${offset}`.execute(tx)).rows
                : [];
            if (canChoose &&
                input.person_id &&
                !people.some((person) => person.id === input.person_id)) {
                const person = await this.person(tx, school, input.person_id);
                people.push({ id: person.id, label: person.label });
            }
            const personOptions = [];
            for (const person of people) {
                const hasApp = Boolean(await this.endpoint(tx, school, person.id));
                personOptions.push({
                    ...person,
                    has_app: hasApp,
                });
            }
            const spaces = canChoose || sourceRecorder
                ? (await sql `SELECT space.id,space.name AS label,space.kind,space.campus_id FROM campus_spaces space JOIN institution_campuses campus ON campus.id=space.campus_id AND campus.school_id=space.school_id WHERE space.school_id=${school}::uuid AND space.status='active' AND campus.status='active' AND space.kind<>'virtual' AND(space.name ILIKE ${pattern} OR space.id=${input.space_id ?? null}::uuid) ORDER BY space.name,space.id LIMIT 25 OFFSET ${offset}`.execute(tx)).rows
                : [];
            const roomTypes = canChoose
                ? (await sql `SELECT * FROM accommodation_room_types WHERE school_id=${school}::uuid AND(name ILIKE ${pattern} OR id=${input.room_type_id ?? null}::uuid) ORDER BY name,id LIMIT 25 OFFSET ${offset}`.execute(tx)).rows
                : [];
            if (canChoose &&
                input.room_type_id &&
                !roomTypes.some((type) => type.id === input.room_type_id)) {
                const selected = await tx
                    .selectFrom("accommodation_room_types")
                    .selectAll()
                    .where("school_id", "=", school)
                    .where("id", "=", input.room_type_id)
                    .executeTakeFirst();
                if (!selected)
                    throw new NotFoundException("This room type is unavailable in the selected campus.");
                roomTypes.push(selected);
            }
            if ((canChoose || sourceRecorder) &&
                input.space_id &&
                !spaces.some((space) => space.id === input.space_id)) {
                await this.space(tx, school, input.space_id);
                const selected = await tx
                    .selectFrom("campus_spaces")
                    .select(["id", "name as label", "kind", "campus_id"])
                    .where("school_id", "=", school)
                    .where("id", "=", input.space_id)
                    .executeTakeFirstOrThrow();
                spaces.push(selected);
            }
            const roomRows = canChoose
                ? (await sql `SELECT room.* FROM accommodation_rooms room JOIN campus_spaces space ON space.id=room.space_id AND space.school_id=room.school_id WHERE room.school_id=${school}::uuid AND(space.name ILIKE ${pattern} OR room.id=${input.room_id ?? null}::uuid) ORDER BY space.name,room.id LIMIT 25 OFFSET ${offset}`.execute(tx)).rows
                : [];
            if (canChoose &&
                input.room_id &&
                !roomRows.some((room) => room.id === input.room_id))
                roomRows.push(await this.roomIn(tx, school, input.room_id));
            if (canChoose && input.place_id) {
                const selected = await tx
                    .selectFrom("accommodation_places")
                    .select(["id", "room_id"])
                    .where("school_id", "=", school)
                    .where("id", "=", input.place_id)
                    .executeTakeFirst();
                if (!selected)
                    throw new NotFoundException("This named place is unavailable.");
                if (!roomRows.some((room) => room.id === selected.room_id))
                    roomRows.push(await this.roomIn(tx, school, selected.room_id));
            }
            const rooms = await this.roomDtos(tx, roomRows);
            const holdings = canChoose
                ? (await sql `SELECT holding.id,concat_ws(' · ',holding.name,holding.asset_tag) AS label FROM campus_resource_holdings holding JOIN campus_resource_types type ON type.id=holding.resource_type_id AND type.school_id=holding.school_id WHERE holding.school_id=${school}::uuid AND holding.state<>'retired' AND type.tracking_mode='individual' AND(${input.room_id ?? null}::uuid IS NULL OR holding.space_id=(SELECT space_id FROM accommodation_rooms WHERE school_id=${school}::uuid AND id=${input.room_id ?? null}::uuid)) AND(holding.name ILIKE ${pattern} OR holding.asset_tag ILIKE ${pattern} OR holding.id=${input.holding_id ?? null}::uuid) ORDER BY holding.name,holding.id LIMIT 25 OFFSET ${offset}`.execute(tx)).rows
                : [];
            if (canChoose &&
                input.holding_id &&
                !holdings.some((holding) => holding.id === input.holding_id)) {
                const selected = (await sql `SELECT holding.id,concat_ws(' · ',holding.name,holding.asset_tag) AS label FROM campus_resource_holdings holding JOIN campus_resource_types type ON type.id=holding.resource_type_id AND type.school_id=holding.school_id WHERE holding.school_id=${school}::uuid AND holding.id=${input.holding_id}::uuid AND holding.state<>'retired' AND type.tracking_mode='individual' AND(${input.room_id ?? null}::uuid IS NULL OR holding.space_id=(SELECT space_id FROM accommodation_rooms WHERE school_id=${school}::uuid AND id=${input.room_id ?? null}::uuid))`.execute(tx)).rows[0];
                if (!selected)
                    fail("This current furnishing is unavailable for the selected room.");
                holdings.push(selected);
            }
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
            let canAddPeople = false;
            try {
                await institutionSchoolPermission(tx, user, school, "sis.manage", true);
                canAddPeople = true;
            }
            catch (error) {
                if (!(error instanceof ForbiddenException))
                    throw error;
            }
            return {
                actor: { id: actor.person_id, label: actor.label },
                can_manage: manager,
                can_offer: manager,
                can_create_places: manager,
                can_add_people: canAddPeople,
                people: personOptions,
                spaces,
                room_types: roomTypes,
                rooms,
                places: rooms.flatMap((room) => room.places),
                holdings,
                campuses,
                people_has_more: people.length >= 25,
                spaces_has_more: spaces.length === 25,
                room_types_has_more: roomTypes.length === 25,
                rooms_has_more: roomRows.length >= 25,
                holdings_has_more: holdings.length === 25,
            };
        });
    }
    setupReceipt(tx, user, school, person, source, kind, revision, command, values) {
        return tx
            .insertInto("accommodation_setup_receipts")
            .values({
            id: randomUUID(),
            school_id: school,
            source_id: source,
            kind,
            revision,
            command_id: command,
            actor_person_id: person,
            actor_user_id: user.id,
            name: values.name ?? "",
            default_capacity: values.default_capacity ?? null,
            allocation_mode: values.allocation_mode ?? null,
            space_id: values.space_id ?? null,
            room_type_id: values.room_type_id ?? null,
            sleeping_capacity: values.sleeping_capacity ?? null,
            room_id: values.room_id ?? null,
            holding_id: values.holding_id ?? null,
            active: values.active ?? true,
            reason: values.reason ?? "",
            recorded_at: values.recorded_at ?? executionNow(),
        })
            .returningAll()
            .executeTakeFirstOrThrow();
    }
    async saveRoomType(user, school, raw) {
        const input = accommodationType.parse(raw);
        return this.db
            .transaction()
            .execute(async (tx) => {
            const actor = await this.access.manager(tx, user, school);
            await this.lock(tx, school);
            const id = input.id ?? input.command_id, previous = await tx
                .selectFrom("accommodation_room_types")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", id)
                .forUpdate()
                .executeTakeFirst(), prepared = await this.model.prepare(tx, user, actor, { id, school_id: school, revision: previous?.revision ?? 0 }, "setup.room_type", input, "accommodation.manage", { scope: school });
            if (prepared.replay)
                return previous;
            if (previous &&
                !input.active &&
                (await tx
                    .selectFrom("accommodation_rooms")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("room_type_id", "=", id)
                    .where("active", "=", true)
                    .executeTakeFirst()))
                fail("This type is used by an active residential room.");
            if (previous && input.reason.length < 3)
                fail("Add a short reason for this change.");
            const at = executionNow(), values = {
                name: input.name,
                default_capacity: input.default_capacity,
                allocation_mode: input.allocation_mode,
                active: input.active,
                revision: (previous?.revision ?? 0) + 1,
                updated_at: at,
            };
            const saved = previous
                ? await tx
                    .updateTable("accommodation_room_types")
                    .set(values)
                    .where("school_id", "=", school)
                    .where("id", "=", id)
                    .returningAll()
                    .executeTakeFirstOrThrow()
                : await tx
                    .insertInto("accommodation_room_types")
                    .values({ id, school_id: school, created_at: at, ...values })
                    .returningAll()
                    .executeTakeFirstOrThrow();
            const receipt = await this.setupReceipt(tx, user, school, actor.person_id, id, "room_type", saved.revision, prepared.prepared.command_id, { ...values, reason: input.reason, recorded_at: at });
            await this.model.finishSetup(tx, user, receipt, prepared.prepared);
            return saved;
        })
            .catch(nativeError);
    }
    async saveRoom(user, school, raw) {
        const input = accommodationRoom.parse(raw);
        return this.db
            .transaction()
            .execute(async (tx) => {
            const actor = await this.access.manager(tx, user, school);
            await this.lock(tx, school);
            const id = input.id ?? input.command_id, previous = await tx
                .selectFrom("accommodation_rooms")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", id)
                .forUpdate()
                .executeTakeFirst(), prepared = await this.model.prepare(tx, user, actor, { id, school_id: school, revision: previous?.revision ?? 0 }, "setup.room", input, "accommodation.manage", { scope: school });
            if (prepared.replay)
                return this.roomDto(tx, previous);
            await this.space(tx, school, input.space_id);
            const type = await tx
                .selectFrom("accommodation_room_types")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", input.room_type_id)
                .where("active", "=", true)
                .executeTakeFirst();
            if (!type)
                fail("Choose an active room type.");
            if (input.active &&
                (!previous?.active || previous.space_id !== input.space_id))
                await assertSpaceCanBecomeResidential(tx, school, input.space_id, executionNow().toISOString());
            if (previous) {
                if (input.reason.length < 3)
                    fail("Add a short reason for this room change.");
                const used = await tx
                    .selectFrom("accommodation_stays")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("room_id", "=", id)
                    .where("state", "in", ["offered", "accepted"])
                    .executeTakeFirst();
                if (used &&
                    (input.space_id !== previous.space_id ||
                        input.sleeping_capacity !== previous.sleeping_capacity ||
                        input.allocation_mode !== previous.allocation_mode ||
                        !input.active))
                    fail("Settle current offers and stays before changing capacity, allocation, location or availability.");
                const named = await tx
                    .selectFrom("accommodation_places")
                    .select(({ fn }) => fn.countAll().as("count"))
                    .where("school_id", "=", school)
                    .where("room_id", "=", id)
                    .where("active", "=", true)
                    .executeTakeFirstOrThrow();
                if (input.sleeping_capacity < Number(named.count))
                    fail("Capacity cannot be smaller than the active named places.");
            }
            const at = executionNow(), values = {
                space_id: input.space_id,
                room_type_id: input.room_type_id,
                sleeping_capacity: input.sleeping_capacity,
                allocation_mode: input.allocation_mode,
                active: input.active,
                revision: (previous?.revision ?? 0) + 1,
                updated_at: at,
            }, saved = previous
                ? await tx
                    .updateTable("accommodation_rooms")
                    .set(values)
                    .where("school_id", "=", school)
                    .where("id", "=", id)
                    .returningAll()
                    .executeTakeFirstOrThrow()
                : await tx
                    .insertInto("accommodation_rooms")
                    .values({ id, school_id: school, created_at: at, ...values })
                    .returningAll()
                    .executeTakeFirstOrThrow();
            const receipt = await this.setupReceipt(tx, user, school, actor.person_id, id, "room", saved.revision, prepared.prepared.command_id, { ...values, reason: input.reason, recorded_at: at });
            await this.model.finishSetup(tx, user, receipt, prepared.prepared);
            return this.roomDto(tx, saved);
        })
            .catch(nativeError);
    }
    async savePlace(user, school, raw) {
        const input = accommodationPlace.parse(raw);
        return this.db
            .transaction()
            .execute(async (tx) => {
            const actor = await this.access.manager(tx, user, school);
            await this.lock(tx, school);
            const id = input.id ?? input.command_id, previous = await tx
                .selectFrom("accommodation_places")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", id)
                .forUpdate()
                .executeTakeFirst(), prepared = await this.model.prepare(tx, user, actor, { id, school_id: school, revision: previous?.revision ?? 0 }, "setup.place", input, "accommodation.manage", { scope: school });
            if (prepared.replay)
                return previous;
            const room = await this.roomIn(tx, school, input.room_id, true);
            if (!room.active || room.allocation_mode !== "shared")
                fail("Named places belong to an active shared room.");
            if (previous) {
                if (input.reason.length < 3)
                    fail("Add a short reason for this place change.");
                if (previous.room_id !== input.room_id)
                    fail("A named place cannot be moved to a different room.");
                if (await tx
                    .selectFrom("accommodation_stays")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("place_id", "=", id)
                    .where("state", "in", ["offered", "accepted"])
                    .executeTakeFirst())
                    fail("This named place has a current offer or stay.");
            }
            if (input.active) {
                const count = await tx
                    .selectFrom("accommodation_places")
                    .select(({ fn }) => fn.countAll().as("count"))
                    .where("school_id", "=", school)
                    .where("room_id", "=", room.id)
                    .where("active", "=", true)
                    .where("id", "!=", id)
                    .executeTakeFirstOrThrow();
                if (Number(count.count) >= room.sleeping_capacity)
                    fail("Every sleeping place is already named. Increase unused capacity before adding another.");
            }
            if (input.holding_id) {
                const item = await tx
                    .selectFrom("campus_resource_holdings as holding")
                    .innerJoin("campus_resource_types as type", "type.id", "holding.resource_type_id")
                    .select(["holding.space_id", "holding.state", "type.tracking_mode"])
                    .where("holding.school_id", "=", school)
                    .where("holding.id", "=", input.holding_id)
                    .executeTakeFirst();
                if (!item ||
                    item.state === "retired" ||
                    item.tracking_mode !== "individual" ||
                    item.space_id !== room.space_id)
                    fail("Choose an individually identified furnishing currently placed in this room.");
            }
            const at = executionNow(), values = {
                room_id: room.id,
                label: input.label,
                holding_id: input.holding_id,
                active: input.active,
                revision: (previous?.revision ?? 0) + 1,
                updated_at: at,
            }, saved = previous
                ? await tx
                    .updateTable("accommodation_places")
                    .set(values)
                    .where("school_id", "=", school)
                    .where("id", "=", id)
                    .returningAll()
                    .executeTakeFirstOrThrow()
                : await tx
                    .insertInto("accommodation_places")
                    .values({ id, school_id: school, created_at: at, ...values })
                    .returningAll()
                    .executeTakeFirstOrThrow();
            const receipt = await this.setupReceipt(tx, user, school, actor.person_id, id, "place", saved.revision, prepared.prepared.command_id, {
                name: input.label,
                room_id: room.id,
                holding_id: input.holding_id,
                active: input.active,
                reason: input.reason,
                recorded_at: at,
            });
            await this.model.finishSetup(tx, user, receipt, prepared.prepared);
            return saved;
        })
            .catch(nativeError);
    }
    receipt(tx, user, stay, actor, command, action, input = {}) {
        return tx
            .insertInto("accommodation_receipts")
            .values({
            id: randomUUID(),
            school_id: stay.school_id,
            stay_id: stay.id,
            revision: stay.revision,
            command_id: command,
            action,
            arrangement_basis: stay.arrangement_basis,
            actor_person_id: actor,
            actor_user_id: user.id,
            note: input.note ?? "",
            observed_at: input.retract
                ? executionNow()
                : input.observed_at
                    ? new Date(input.observed_at)
                    : null,
            method: input.method ?? null,
            response: input.response ?? null,
            response_for: input.response_for ?? null,
            supersedes_receipt_id: input.supersedes_receipt_id ?? null,
            movement_kind: action === "moved_in"
                ? "move_in"
                : action === "moved_out"
                    ? "move_out"
                    : (input.movement ?? null),
            movement_retracted: input.retract ?? false,
            state: stay.state,
            coordinator_person_id: stay.coordinator_person_id,
            recorder_person_id: stay.recorder_person_id,
            planned_starts_at: stay.planned_starts_at,
            planned_ends_at: stay.planned_ends_at,
            proposed_ends_at: stay.proposed_ends_at,
            accepted_at: stay.accepted_at,
            actual_move_in_at: stay.actual_move_in_at,
            actual_move_out_at: stay.actual_move_out_at,
            destination_space_id: stay.destination_space_id,
            destination_note: stay.destination_note,
            recorded_at: stay.updated_at,
        })
            .returningAll()
            .executeTakeFirstOrThrow();
    }
    async offer(user, school, raw) {
        const input = accommodationOffer.parse(raw), allocated = input.arrangement_basis === "coordinator_allocation", action = allocated ? "allocated" : "offered";
        return this.db
            .transaction()
            .execute(async (tx) => {
            const actor = await this.access.manager(tx, user, school);
            await this.lock(tx, school);
            const existing = await tx
                .selectFrom("accommodation_stays")
                .selectAll()
                .where("school_id", "=", school)
                .where("id", "=", input.command_id)
                .executeTakeFirst(), prepared = await this.model.prepare(tx, user, actor, {
                id: input.command_id,
                school_id: school,
                revision: existing?.revision ?? 0,
            }, action, input, "accommodation.manage", {
                coordinator_person_id: input.coordinator_person_id,
                recorder_person_id: input.recorder_person_id,
                resident_person_id: input.resident_person_id,
            });
            if (prepared.replay)
                return this.result(tx, user, existing);
            await this.person(tx, school, input.resident_person_id);
            if (!(await this.endpoint(tx, school, input.coordinator_person_id)) ||
                !(await this.endpoint(tx, school, input.recorder_person_id)))
                fail("Name a current app-enabled coordinator and physical recorder.");
            const room = await this.roomIn(tx, school, input.room_id, true);
            if (!room.active)
                fail("Choose an active residential room.");
            if (input.origin_space_id)
                await this.space(tx, school, input.origin_space_id);
            if (input.repair_id) {
                const repair = await tx
                    .selectFrom("facilities_repairs")
                    .selectAll()
                    .where("school_id", "=", school)
                    .where("id", "=", input.repair_id)
                    .executeTakeFirst();
                if (!repair ||
                    ![
                        repair.reporter_person_id,
                        repair.recorder_person_id,
                        repair.coordinator_person_id,
                        repair.handler_person_id,
                        repair.verifier_person_id,
                    ].includes(actor.person_id))
                    throw new ForbiddenException("Only an exact participant may link this private repair.");
            }
            const starts = new Date(input.starts_at), ends = new Date(input.ends_at);
            if (ends <= starts || ends <= executionNow())
                fail("Choose a planned interval ending after its start and after now.");
            const at = executionNow(), values = {
                id: input.command_id,
                school_id: school,
                resident_person_id: input.resident_person_id,
                coordinator_person_id: input.coordinator_person_id,
                recorder_person_id: input.recorder_person_id,
                recorded_by_user_id: user.id,
                room_id: input.room_id,
                place_id: input.place_id,
                repair_id: input.repair_id,
                origin_space_id: input.origin_space_id,
                origin_note: input.origin_note,
                instructions: input.instructions,
                access_mode: input.access_mode,
                arrangement_basis: input.arrangement_basis ?? "resident_offer",
                state: allocated ? "accepted" : "offered",
                planned_starts_at: starts,
                planned_ends_at: ends,
                proposed_ends_at: null,
                accepted_at: allocated ? at : null,
                actual_move_in_at: null,
                actual_move_out_at: null,
                destination_space_id: null,
                destination_note: "",
                revision: 1,
                created_at: at,
                updated_at: at,
                coordination_receipt: {},
            };
            await this.capacity(tx, values);
            const stay = await tx
                .insertInto("accommodation_stays")
                .values(values)
                .returningAll()
                .executeTakeFirstOrThrow(), receipt = await this.receipt(tx, user, stay, actor.person_id, prepared.prepared.command_id, action);
            await this.model.finish(tx, user, stay, receipt, prepared.prepared, "accommodation.manage", await this.next(tx, stay), await this.audience(tx, stay));
            if (allocated)
                await retainOperatingDestination(tx, user, school, "accommodation", accommodationHref(stay.id), { onlyPending: true, source: "accepted_accommodation_arrangement" });
            return this.result(tx, user, await this.stay(tx, school, stay.id));
        })
            .catch(nativeError);
    }
    async result(tx, user, stay) {
        const actor = await this.access.campus(tx, user, stay.school_id);
        if (!this.participants(stay).includes(actor.person_id))
            return { id: stay.id, revision: stay.revision, access_transferred: true };
        return this.detailIn(tx, user, stay);
    }
    async act(user, school, id, raw) {
        const input = accommodationAction.parse(raw);
        return this.db
            .transaction()
            .execute(async (tx) => {
            await this.lock(tx, school);
            let stay = await this.stay(tx, school, id, true);
            const permission = await this.readable(tx, user, stay), actor = permission.actor, coordinator = actor.person_id === stay.coordinator_person_id, recorder = actor.person_id === stay.recorder_person_id, resident = actor.person_id === stay.resident_person_id, active = ["offered", "accepted"].includes(stay.state), routeReady = await this.routeReady(tx, stay);
            if (([
                "accept",
                "decline",
                "accept_extension",
                "decline_extension",
            ].includes(input.action) &&
                !resident) ||
                (["move_in", "move_out", "correct_move"].includes(input.action) &&
                    !recorder) ||
                (["record_response", "extend", "change_end", "cancel", "close"].includes(input.action) &&
                    !coordinator) ||
                (input.action === "reassign" && !coordinator && !permission.recovery))
                throw new ForbiddenException("Only the exact current responsible person can perform this stay action.");
            const actions = {
                accept: "accepted",
                decline: "declined",
                record_response: "response_recorded",
                move_in: "moved_in",
                move_out: "moved_out",
                extend: "extension_offered",
                change_end: "end_changed",
                accept_extension: "extension_accepted",
                decline_extension: "extension_declined",
                cancel: "cancelled",
                correct_move: "movement_corrected",
                reassign: "reassigned",
                close: "closed",
            }, action = actions[input.action], capability = permission.recovery
                ? "accommodation.manage"
                : coordinator
                    ? "accommodation.coordinate"
                    : resident
                        ? "accommodation.respond"
                        : "accommodation.record", prepared = await this.model.prepare(tx, user, actor, stay, action, input, capability, {
                resident_person_id: stay.resident_person_id,
                coordinator_person_id: stay.coordinator_person_id,
                recorder_person_id: stay.recorder_person_id,
            });
            if (prepared.replay)
                return this.result(tx, user, stay);
            if (!active)
                fail("This arrangement has ended. Its retained record remains available.");
            const previous = stay.coordination_receipt, patch = {
                revision: stay.revision + 1,
                updated_at: executionNow(),
            }, observed = input.observed_at ? new Date(input.observed_at) : null;
            let accepted = false;
            if ([
                "accept",
                "decline",
                "accept_extension",
                "decline_extension",
                "record_response",
            ].includes(input.action)) {
                if (stay.arrangement_basis !== "resident_offer")
                    fail("This room was assigned directly; no resident decision is required.");
                const assisted = input.action === "record_response", extension = assisted
                    ? input.response_for === "extension"
                    : input.action.endsWith("_extension"), response = assisted
                    ? input.response
                    : input.action.startsWith("accept")
                        ? "accept"
                        : "decline";
                if (assisted) {
                    if (resident)
                        fail("Use your own Accept or Decline action.");
                    if (!observed ||
                        !input.method ||
                        input.note.length < 3 ||
                        !input.response ||
                        !input.response_for)
                        fail("Record how and when this resident gave their actual response.");
                    if (observed > executionNow() || observed < stay.created_at)
                        fail("The response observation must be between the offer and now.");
                }
                else if (!routeReady)
                    fail("This exact response invitation is unavailable. Ask the coordinator to recover it.");
                if (extension) {
                    if (!stay.proposed_ends_at || stay.state !== "accepted")
                        fail("There is no pending extension to respond to.");
                    if (response === "accept") {
                        patch.planned_ends_at = stay.proposed_ends_at;
                        accepted = true;
                    }
                    patch.proposed_ends_at = null;
                }
                else {
                    if (stay.state !== "offered")
                        fail("Only the current offer can be accepted or declined.");
                    if (stay.planned_ends_at <= executionNow())
                        fail("The planned interval has passed. Ask the coordinator for a current offer.");
                    patch.state = response === "accept" ? "accepted" : "declined";
                    if (response === "accept") {
                        patch.accepted_at = executionNow();
                        accepted = true;
                    }
                }
            }
            else if (input.action === "move_in") {
                if (stay.state !== "accepted" ||
                    stay.actual_move_in_at ||
                    !routeReady)
                    fail("Accept the current arrangement before recording its first move-in.");
                if (!observed ||
                    observed > executionNow() ||
                    observed < stay.planned_starts_at ||
                    observed >= stay.planned_ends_at)
                    fail("Record an actual move-in time inside the accepted planned interval, no later than now.");
                await this.capacity(tx, stay, true);
                await this.physicalCapacity(tx, stay, observed, null);
                patch.actual_move_in_at = observed;
            }
            else if (input.action === "move_out") {
                if (!stay.actual_move_in_at || stay.actual_move_out_at || !routeReady)
                    fail("Only a current actual resident can be moved out.");
                if (!observed ||
                    observed > executionNow() ||
                    observed < stay.actual_move_in_at)
                    fail("Record an actual move-out time after move-in, no later than now.");
                if (input.destination_space_id)
                    await this.space(tx, school, input.destination_space_id);
                if (!input.destination_space_id && input.destination_note.length < 3)
                    fail("Record the actual destination or a short unlinked description.");
                patch.actual_move_out_at = observed;
                patch.destination_space_id = input.destination_space_id ?? null;
                patch.destination_note = input.destination_note;
                patch.proposed_ends_at = null;
            }
            else if (input.action === "extend") {
                if (stay.arrangement_basis !== "resident_offer" ||
                    stay.state !== "accepted" ||
                    stay.actual_move_out_at ||
                    stay.proposed_ends_at)
                    fail("Only a current accepted stay without a pending amendment can be extended.");
                if (!input.ends_at ||
                    new Date(input.ends_at) <= stay.planned_ends_at ||
                    new Date(input.ends_at) <= executionNow() ||
                    input.note.length < 3)
                    fail("Choose a later expected end and say why the change is proposed.");
                patch.proposed_ends_at = new Date(input.ends_at);
                await this.capacity(tx, { ...stay, ...patch });
            }
            else if (input.action === "change_end") {
                const end = input.ends_at ? new Date(input.ends_at) : null;
                if (stay.arrangement_basis !== "coordinator_allocation" ||
                    stay.state !== "accepted" ||
                    stay.actual_move_out_at ||
                    stay.proposed_ends_at ||
                    !end ||
                    end <= executionNow() ||
                    end <= stay.planned_starts_at ||
                    (stay.actual_move_in_at && end <= stay.actual_move_in_at) ||
                    end.getTime() === stay.planned_ends_at.getTime() ||
                    input.note.length < 3)
                    fail("Choose a new future end date and add a short reason for the assignment change.");
                patch.planned_ends_at = end;
                await this.capacity(tx, { ...stay, ...patch });
            }
            else if (input.action === "cancel") {
                if (stay.actual_move_in_at)
                    fail("Record the resident’s actual move-out; cancellation cannot remove occupancy.");
                if (input.note.length < 3)
                    fail("Add a short withdrawal reason.");
                patch.state = "cancelled";
                patch.proposed_ends_at = null;
            }
            else if (input.action === "correct_move") {
                if (!input.supersedes_receipt_id ||
                    !input.movement ||
                    (!input.retract && !observed) ||
                    input.note.length < 3 ||
                    (observed && observed > executionNow()))
                    fail("Choose the movement evidence, corrected observation time and reason.");
                const receipt = await tx
                    .selectFrom("accommodation_receipts")
                    .selectAll()
                    .where("school_id", "=", school)
                    .where("stay_id", "=", id)
                    .where("id", "=", input.supersedes_receipt_id)
                    .executeTakeFirst();
                if (!receipt ||
                    !["moved_in", "moved_out", "movement_corrected"].includes(receipt.action))
                    fail("Choose movement evidence from this same stay.");
                const receiptKind = receipt.movement_kind ??
                    (receipt.action === "moved_in"
                        ? "move_in"
                        : receipt.action === "moved_out"
                            ? "move_out"
                            : null);
                if (receiptKind !== input.movement || receipt.movement_retracted)
                    fail("Choose the current evidence for this exact kind of movement.");
                if (await tx
                    .selectFrom("accommodation_receipts")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("stay_id", "=", id)
                    .where("supersedes_receipt_id", "=", receipt.id)
                    .executeTakeFirst())
                    fail("That movement evidence was already superseded. Review the latest observation.");
                const expected = input.movement === "move_in"
                    ? stay.actual_move_in_at
                    : stay.actual_move_out_at;
                if (!expected ||
                    !receipt.observed_at ||
                    receipt.observed_at.getTime() !== expected.getTime())
                    fail("That movement evidence was already superseded. Review the latest observation.");
                if (input.retract) {
                    if (input.movement === "move_out") {
                        if (!stay.actual_move_in_at)
                            fail("There is no actual arrival to restore.");
                        await this.capacity(tx, stay, true);
                        await this.physicalCapacity(tx, stay, stay.actual_move_in_at, null);
                        patch.actual_move_out_at = null;
                        patch.destination_space_id = null;
                        patch.destination_note = "";
                    }
                    else {
                        if (stay.actual_move_out_at ||
                            (await tx
                                .selectFrom("accommodation_access_loans")
                                .select("id")
                                .where("school_id", "=", school)
                                .where("stay_id", "=", id)
                                .executeTakeFirst()))
                            fail("Settle dependent departure or custody evidence before retracting an arrival.");
                        patch.actual_move_in_at = null;
                    }
                }
                else if (input.movement === "move_in") {
                    if (!observed)
                        fail("Record the corrected observation time.");
                    if (observed < stay.planned_starts_at ||
                        observed >= stay.planned_ends_at ||
                        (stay.actual_move_out_at && observed > stay.actual_move_out_at))
                        fail("The corrected move-in must fit the accepted arrangement and actual departure.");
                    patch.actual_move_in_at = observed;
                }
                else {
                    if (!observed)
                        fail("Record the corrected observation time.");
                    if (!stay.actual_move_in_at || observed < stay.actual_move_in_at)
                        fail("The corrected departure cannot precede move-in.");
                    patch.actual_move_out_at = observed;
                    if (input.destination_space_id)
                        await this.space(tx, school, input.destination_space_id);
                    if (input.destination_space_id !== undefined)
                        patch.destination_space_id = input.destination_space_id;
                    if (input.destination_note)
                        patch.destination_note = input.destination_note;
                }
                if (!input.retract) {
                    const lo = patch.actual_move_in_at ?? stay.actual_move_in_at, hi = patch.actual_move_out_at ?? stay.actual_move_out_at;
                    if (lo)
                        await this.physicalCapacity(tx, stay, lo, hi);
                }
            }
            else if (input.action === "reassign") {
                if (input.note.length < 3 ||
                    (!input.coordinator_person_id && !input.recorder_person_id))
                    fail("Choose the responsible person to replace and explain the handover.");
                if (input.coordinator_person_id) {
                    if (!(await this.endpoint(tx, school, input.coordinator_person_id)))
                        fail("Choose a current app-enabled coordinator.");
                    patch.coordinator_person_id = input.coordinator_person_id;
                }
                if (input.recorder_person_id) {
                    if (!(await this.endpoint(tx, school, input.recorder_person_id)))
                        fail("Choose a current app-enabled physical recorder.");
                    patch.recorder_person_id = input.recorder_person_id;
                }
                if ((patch.coordinator_person_id ?? stay.coordinator_person_id) ===
                    stay.coordinator_person_id &&
                    (patch.recorder_person_id ?? stay.recorder_person_id) ===
                        stay.recorder_person_id &&
                    routeReady &&
                    !(await this.unavailable(tx, stay)))
                    fail("These responsible people and their current handoff are already active.");
            }
            else if (input.action === "close") {
                if (!stay.actual_move_out_at)
                    fail("Record the actual move-out before closing.");
                if (!(await this.accessSummary(tx, user, stay)).access_settled)
                    fail("Required temporary access is still unresolved. Link the existing loan and record its return through Resources.");
                patch.state = "closed";
                patch.proposed_ends_at = null;
            }
            stay = await tx
                .updateTable("accommodation_stays")
                .set(patch)
                .where("school_id", "=", school)
                .where("id", "=", id)
                .where("revision", "=", stay.revision)
                .returningAll()
                .executeTakeFirstOrThrow();
            if (accepted)
                await this.capacity(tx, stay);
            const receipt = await this.receipt(tx, user, stay, actor.person_id, prepared.prepared.command_id, action, input);
            await this.model.finish(tx, user, stay, receipt, prepared.prepared, capability, await this.next(tx, stay), await this.audience(tx, stay), previous);
            if (accepted)
                await retainOperatingDestination(tx, user, school, "accommodation", accommodationHref(id), { onlyPending: true, source: "accepted_accommodation_arrangement" });
            return this.result(tx, user, await this.stay(tx, school, id));
        })
            .catch(nativeError);
    }
    async linkAccess(user, school, id, raw) {
        const input = accommodationLoan.parse(raw);
        return this.db
            .transaction()
            .execute(async (tx) => {
            await this.lock(tx, school);
            let stay = await this.stay(tx, school, id, true);
            const permission = await this.readable(tx, user, stay);
            if (![stay.coordinator_person_id, stay.recorder_person_id].includes(permission.actor.person_id))
                throw new ForbiddenException("Only this stay’s coordinator or recorder may link access custody.");
            const prepared = await this.model.prepare(tx, user, permission.actor, stay, "access_linked", input, "accommodation.record", {
                resident_person_id: stay.resident_person_id,
                coordinator_person_id: stay.coordinator_person_id,
                recorder_person_id: stay.recorder_person_id,
            });
            if (prepared.replay)
                return this.detailIn(tx, user, stay);
            const routeWasReady = await this.routeReady(tx, stay);
            if (!["offered", "accepted"].includes(stay.state))
                fail("Link access to a current arrangement.");
            const loan = await this.loans.accommodationCustody(tx, user, school, id, input.loan_id);
            if (stay.access_mode === "no_tracked_item")
                fail("This arrangement explicitly has no tracked access item. Create a corrected arrangement rather than silently changing its access policy.");
            if (stay.access_mode === "tracked_required" && !input.return_required)
                fail("Temporary access items on this arrangement require a physical return.");
            if (stay.access_mode === "existing_access" && input.return_required)
                fail("Retained existing access is not a temporary return-required item. Use the tracked-access mode on a new arrangement.");
            if (input.return_required &&
                (await tx
                    .selectFrom("accommodation_access_loans")
                    .select("id")
                    .where("school_id", "=", school)
                    .where("loan_id", "=", loan.loan_id)
                    .where("return_required", "=", true)
                    .where("stay_id", "!=", id)
                    .executeTakeFirst()))
                fail("This exact temporary-access loan is already accountable to another stay.");
            if (await tx
                .selectFrom("accommodation_access_loans")
                .select("id")
                .where("school_id", "=", school)
                .where("stay_id", "=", id)
                .where("loan_id", "=", loan.loan_id)
                .executeTakeFirst())
                fail("This existing loan is already linked.");
            const previous = stay.coordination_receipt;
            stay = await tx
                .updateTable("accommodation_stays")
                .set({ revision: stay.revision + 1, updated_at: executionNow() })
                .where("school_id", "=", school)
                .where("id", "=", id)
                .returningAll()
                .executeTakeFirstOrThrow();
            const receipt = await this.receipt(tx, user, stay, permission.actor.person_id, prepared.prepared.command_id, "access_linked", { note: input.note });
            await tx
                .insertInto("accommodation_access_loans")
                .values({
                id: randomUUID(),
                school_id: school,
                stay_id: id,
                loan_id: input.loan_id,
                return_required: input.return_required,
                receipt_revision: stay.revision,
                created_at: stay.updated_at,
            })
                .execute();
            await this.model.finish(tx, user, stay, receipt, prepared.prepared, "accommodation.record", routeWasReady ? await this.next(tx, stay) : null, await this.audience(tx, stay), previous);
            return this.detailIn(tx, user, await this.stay(tx, school, id));
        })
            .catch(nativeError);
    }
    async confirmation(user, school, id, command) {
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), receipt = await this.model.retained(tx, user, school, command);
            if (!receipt)
                return { state: "not_found" };
            if (receipt.actor_agent_id !== actor.agent_id ||
                receipt.target.domain_id !== id)
                throw new ConflictException("This confirmation belongs to another source or actor.");
            if (receipt.state === "pending")
                return { state: "pending" };
            if (receipt.receipt.terminal_state !== "accepted")
                return { state: "not_accepted" };
            const stay = await this.stay(tx, school, id);
            return {
                state: "accepted",
                result: {
                    id,
                    revision: receipt.receipt.resulting_revision,
                    access_transferred: !this.participants(stay).includes(actor.person_id),
                },
            };
        });
    }
    async setupConfirmation(user, school, command) {
        return this.db.transaction().execute(async (tx) => {
            await this.access.manager(tx, user, school);
            const retained = await this.model.retained(tx, user, school, command);
            if (!retained)
                return { state: "not_found" };
            if (retained.state === "pending")
                return { state: "pending" };
            if (retained.receipt.terminal_state !== "accepted")
                return { state: "not_accepted" };
            const receipt = await tx
                .selectFrom("accommodation_setup_receipts")
                .select(["source_id", "revision", "kind"])
                .where("school_id", "=", school)
                .where("command_id", "=", retained.receipt.command_id)
                .executeTakeFirst();
            if (!receipt)
                throw new ConflictException("This command is not a room setup operation.");
            return {
                state: "accepted",
                result: {
                    id: receipt.source_id,
                    revision: receipt.revision,
                    kind: receipt.kind,
                },
            };
        });
    }
    async discovery(user, school) {
        return this.db
            .transaction()
            .execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school), own = await tx
                .selectFrom("accommodation_stays")
                .select("id")
                .where("school_id", "=", school)
                .where((eb) => eb.or([
                eb("resident_person_id", "=", actor.person_id),
                eb("coordinator_person_id", "=", actor.person_id),
                eb("recorder_person_id", "=", actor.person_id),
            ]))
                .executeTakeFirst();
            return {
                can_manage: manager,
                can_offer: manager,
                has_stays: Boolean(own),
            };
        })
            .catch((error) => {
            if (error instanceof ForbiddenException)
                return { can_manage: false, can_offer: false, has_stays: false };
            throw error;
        });
    }
    async work(user, school) {
        return this.db
            .transaction()
            .execute(async (tx) => {
            const actor = await this.access.campus(tx, user, school), manager = await this.access.manages(tx, user, school);
            const rows = (await sql `SELECT stay.* FROM accommodation_stays stay WHERE stay.school_id=${school}::uuid AND stay.state IN('offered','accepted')
    AND(${actor.person_id}::uuid IN(stay.resident_person_id,stay.coordinator_person_id,stay.recorder_person_id)
      OR ${manager} AND(NOT accommodation_person_available(${school}::uuid,stay.coordinator_person_id) OR NOT accommodation_person_available(${school}::uuid,stay.recorder_person_id))) ORDER BY stay.updated_at,stay.id`.execute(tx)).rows;
            const endpointCache = new Map(), at = executionNow(), summaries = new Map((await this.summaries(tx, rows.filter((stay) => this.participants(stay).includes(actor.person_id)))).map((stay) => [stay.id, stay]));
            const needs_me = [], waiting = [];
            for (const stay of rows) {
                const participant = this.participants(stay).includes(actor.person_id), orphan = await this.unavailable(tx, stay, endpointCache);
                const next = await this.next(tx, stay, endpointCache), ready = await this.routeReady(tx, stay, endpointCache), person = next
                    ? await this.person(tx, school, next.person_id)
                    : null, response = stay.state === "offered" || Boolean(stay.proposed_ends_at), receipt = stay.coordination_receipt;
                // A standing handoff permits a voluntary move, but is not itself
                // unfinished work throughout an ordinary stay or before arrival.
                // Recheck this from the selected world's clock on every projection;
                // reading Work never changes the native arrangement or its DT trace.
                // An unrelated manager's actual orphan-recovery item stays visible.
                if (!response &&
                    (participant || !orphan) &&
                    ready &&
                    !stay.actual_move_out_at &&
                    (stay.actual_move_in_at
                        ? stay.planned_ends_at > at
                        : stay.planned_starts_at > at))
                    continue;
                const summary = summaries.get(stay.id);
                const settled = participant && stay.actual_move_out_at
                    ? (await this.accessSummary(tx, user, stay)).access_settled
                    : false;
                const record = {
                    id: `accommodation-stay:${stay.id}`,
                    stay_id: stay.id,
                    revision: stay.revision,
                    title: participant
                        ? (summary?.resident.label ?? "Resident")
                        : "Accommodation responsibility needs review",
                    ...(participant && summary
                        ? {
                            detail: [summary.room.label, summary.place?.label]
                                .filter(Boolean)
                                .join(" · "),
                        }
                        : {}),
                    state: ready
                        ? "review_needed"
                        : next
                            ? "route_unavailable"
                            : "needs_reassignment",
                    href: accommodationHref(stay.id),
                    created_at: iso(stay.updated_at),
                    due_at: null,
                    message_id: receipt.message_id ?? null,
                    owner: {
                        user_id: next?.user_id ?? null,
                        label: person?.label ?? "Responsible person unavailable",
                    },
                    action: !ready
                        ? "recover"
                        : response
                            ? "respond"
                            : stay.actual_move_out_at
                                ? settled
                                    ? "coordinate"
                                    : "return_access"
                                : stay.planned_ends_at <= at
                                    ? "review_end"
                                    : "move_in",
                };
                if (manager && orphan && !participant) {
                    needs_me.push({
                        ...record,
                        title: "Accommodation responsibility needs review",
                        state: "needs_reassignment",
                        action: "recover",
                        message_id: null,
                        owner: { user_id: user.id, label: "Accommodation manager" },
                    });
                    continue;
                }
                if (next?.user_id === user.id ||
                    (!ready &&
                        (actor.person_id === stay.coordinator_person_id ||
                            (manager && orphan))))
                    needs_me.push(record);
                else if (participant)
                    waiting.push({
                        ...record,
                        state: ready ? "waiting_for_review" : record.state,
                    });
            }
            return { needs_me, waiting };
        })
            .catch((error) => {
            if (error instanceof ForbiddenException)
                return { needs_me: [], waiting: [] };
            throw error;
        });
    }
};
AccommodationService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService,
        AccommodationAccess,
        AccommodationModel,
        ResourceLoansService])
], AccommodationService);
export { AccommodationService };
//# sourceMappingURL=accommodation.service.js.map