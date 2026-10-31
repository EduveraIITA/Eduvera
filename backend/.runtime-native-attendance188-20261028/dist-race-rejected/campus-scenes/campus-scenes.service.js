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
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, } from "@nestjs/common";
import { campusTimezone } from "../common/campus-timezone.js";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { HUMAN_AGENT_IDENTITY_PORT, } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow, } from "../campus-model-core/execution-time.runtime.js";
import { CampusScenesModel } from "./campus-scenes.model.js";
import { assertPublishableScene, publicSceneDocument, saveSceneDraftSchema, sceneCommandSchema, sceneDocumentSchema, sceneResourceQuerySchema, uploadSceneImageSchema, scenePayloadHash, } from "./campus-scenes.contracts.js";
import { InstitutionSetupService } from "../institution-setup/institution-setup.service.js";
import { reviewedPlaceElementKinds, reviewedPlaceSaveKey, reviewedScenePlacesSchema } from "./reviewed-places.contracts.js";
import { decodeSceneImage } from "./campus-scenes.images.js";
const parseIds = (school, campus) => {
    // Reject malformed path IDs before they reach PostgreSQL casts.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(school) || !uuid.test(campus))
        throw new BadRequestException("Choose a valid institution and campus.");
};
let CampusScenesService = class CampusScenesService {
    db;
    model;
    identities;
    topology;
    constructor(db, model, identities, topology) {
        this.db = db;
        this.model = model;
        this.identities = identities;
        this.topology = topology;
    }
    async membership(tx, user, school, admin) {
        parseIds(school, school);
        const environment = executionEnvironmentStorage.getStore();
        if (!user.is_active ||
            user.active_school_id !== school ||
            (environment && environment.institution_id !== school))
            throw new ForbiddenException("Choose this institution and its current world before opening its campus scene.");
        const member = await tx
            .selectFrom("school_memberships")
            .select(["id", "role"])
            .where("school_id", "=", school)
            .where("user_id", "=", user.id)
            .where("is_active", "=", true)
            .executeTakeFirst();
        if (!member || (admin && member.role !== "admin"))
            throw new ForbiddenException(admin
                ? "An active institution administrator membership is required to edit campus scenes."
                : "A current institution membership is required to view its campus scene.");
        const actor = await this.identities.resolveAccountEndpoint(tx, {
            school_id: school,
            user_id: user.id,
            at: executionNow().toISOString(),
        });
        if (!actor.acting)
            throw new ForbiddenException("Current canonical campus app access is required.");
        return { actor, can_edit: member.role === "admin" };
    }
    async context(tx, user, school, campus, admin) {
        parseIds(school, campus);
        const member = await this.membership(tx, user, school, admin);
        const selected = await tx
            .selectFrom("institution_campuses as campus")
            .innerJoin("schools as school", "school.id", "campus.school_id")
            .select(["campus.id", "campus.name", "campus.code", "campus.status", "campus.timezone", "school.timezone as school_timezone"])
            .where("campus.school_id", "=", school)
            .where("campus.id", "=", campus)
            .executeTakeFirst();
        if (!selected || selected.status !== "active")
            throw new NotFoundException("Active campus not found in this institution.");
        return {
            ...member,
            campus: { id: selected.id, name: selected.name, code: selected.code, timezone: campusTimezone(selected.timezone, selected.school_timezone) },
        };
    }
    directory(user, school) {
        return this.db.transaction().execute(async (tx) => {
            const member = await this.membership(tx, user, school, false);
            const campuses = await tx
                .selectFrom("institution_campuses as campus")
                .innerJoin("schools as school", "school.id", "campus.school_id")
                .select(["campus.id", "campus.name", "campus.code", "campus.is_primary", "campus.timezone", "school.timezone as school_timezone"])
                .where("campus.school_id", "=", school)
                .where("campus.status", "=", "active")
                .orderBy("campus.is_primary", "desc")
                .orderBy("campus.name")
                .execute();
            return { campuses: campuses.map(({ school_timezone, ...campus }) => ({ ...campus, timezone: campusTimezone(campus.timezone, school_timezone) })), can_edit: member.can_edit };
        });
    }
    /** Read-only authority seam for the import provider; never grants later save authority. */
    requireAdmin(user, school, campus) {
        return this.db.transaction().execute(async (tx) => {
            const context = await this.context(tx, user, school, campus, true);
            return { campus: context.campus };
        });
    }
    async current(tx, school, campus, lock = false) {
        let query = tx
            .selectFrom("campus_visual_scenes")
            .selectAll()
            .where("school_id", "=", school)
            .where("campus_id", "=", campus);
        if (lock)
            query = query.forUpdate();
        return (await query.executeTakeFirst()) ?? null;
    }
    async publication(tx, row) {
        if (!row?.published_revision)
            return null;
        return ((await tx
            .selectFrom("campus_scene_revisions")
            .selectAll()
            .where("school_id", "=", row.school_id)
            .where("scene_id", "=", row.id)
            .where("revision", "=", row.published_revision)
            .where("action", "=", "published")
            .executeTakeFirst()) ?? null);
    }
    publicPublication(row) {
        return row
            ? {
                id: row.scene_id,
                version: row.revision,
                published_at: row.recorded_at.toISOString(),
                document: publicSceneDocument(sceneDocumentSchema.parse(row.document)),
            }
            : null;
    }
    published(user, school, campus) {
        return this.db.transaction().execute(async (tx) => {
            const context = await this.context(tx, user, school, campus, false);
            const scene = await this.publication(tx, await this.current(tx, school, campus));
            const published = this.publicPublication(scene);
            const referenced = [
                ...new Set(published?.document.elements.flatMap((element) => [element.space_id, element.floor_id, element.navigation?.start_space_id, element.navigation?.end_space_id, element.navigation_connector?.from_floor_id, element.navigation_connector?.to_floor_id].filter((id) => Boolean(id))) ?? []),
            ];
            const places = referenced.length
                ? await tx
                    .selectFrom("campus_spaces")
                    .select(["id", "name", "code", "kind", "parent_space_id"])
                    .where("school_id", "=", school)
                    .where("campus_id", "=", campus)
                    .where("status", "=", "active")
                    .where("id", "in", referenced)
                    .orderBy("name")
                    .execute()
                : [];
            return {
                campus: context.campus,
                scene: published,
                places,
                can_edit: context.can_edit,
            };
        });
    }
    workspace(user, school, campus) {
        return this.db.transaction().execute(async (tx) => {
            const context = await this.context(tx, user, school, campus, true), row = await this.current(tx, school, campus);
            const publication = await this.publication(tx, row);
            const spaces = await tx
                .selectFrom("campus_spaces")
                .select(["id", "name", "code", "kind", "parent_space_id"])
                .where("school_id", "=", school)
                .where("campus_id", "=", campus)
                .where("status", "=", "active")
                .orderBy("name")
                .execute();
            return {
                campus: context.campus,
                spaces,
                scene: row
                    ? {
                        id: row.id,
                        revision: row.revision,
                        draft: row.draft_document
                            ? sceneDocumentSchema.parse(row.draft_document)
                            : null,
                        published_version: row.published_revision,
                        published: this.publicPublication(publication),
                        updated_at: row.updated_at.toISOString(),
                    }
                    : null,
            };
        });
    }
    resources(user, school, campus, raw) {
        const parsed = sceneResourceQuerySchema.safeParse(raw);
        if (!parsed.success)
            throw new BadRequestException("Choose a valid resource search and page.");
        const { search, page, holding_id, space_id, tracking_mode } = parsed.data, pageSize = 20;
        return this.db.transaction().execute(async (tx) => {
            await this.context(tx, user, school, campus, true);
            if (space_id && !await tx.selectFrom("campus_spaces").select("id")
                .where("school_id", "=", school).where("campus_id", "=", campus)
                .where("id", "=", space_id).where("status", "=", "active").executeTakeFirst())
                throw new NotFoundException("Choose an active place in this campus.");
            let query = tx.selectFrom("campus_resource_holdings as holding")
                .innerJoin("campus_resource_types as type", join => join.onRef("type.id", "=", "holding.resource_type_id").onRef("type.school_id", "=", "holding.school_id"))
                .where("holding.school_id", "=", school).where("holding.campus_id", "=", campus)
                .where("holding.state", "!=", "retired").where("type.is_active", "=", true);
            if (tracking_mode !== "all")
                query = query.where("type.tracking_mode", "=", tracking_mode);
            if (space_id)
                query = query.where("holding.space_id", "=", space_id);
            const matching = query.where(expression => expression.or([expression("holding.name", "ilike", `%${search}%`), expression("holding.asset_tag", "ilike", `%${search}%`)]));
            const columns = ["holding.id", "holding.name", "holding.asset_tag", "holding.space_id", "holding.state", "holding.quantity", "type.tracking_mode", "type.unit_label"];
            const [items, count, selected] = await Promise.all([
                matching.select(columns).orderBy("holding.name").orderBy("holding.id").limit(pageSize).offset((page - 1) * pageSize).execute(),
                matching.select(({ fn }) => fn.countAll().as("total")).executeTakeFirstOrThrow(),
                holding_id ? query.select(columns).where("holding.id", "=", holding_id).executeTakeFirst() : Promise.resolve(undefined),
            ]);
            return { items, selected: selected ?? null, page, page_size: pageSize, total: Number(count.total) };
        });
    }
    resourceStates(user, school, campus) {
        return this.db.transaction().execute(async (tx) => {
            const context = await this.context(tx, user, school, campus, false);
            const publication = this.publicPublication(await this.publication(tx, await this.current(tx, school, campus)));
            const fixtures = publication?.document.elements.filter(element => element.kind === "fixture" && element.holding_id) ?? [];
            const ids = fixtures.map(element => element.holding_id);
            const holdings = ids.length ? await tx.selectFrom("campus_resource_holdings as holding")
                .innerJoin("campus_resource_types as type", join => join.onRef("type.id", "=", "holding.resource_type_id").onRef("type.school_id", "=", "holding.school_id"))
                .select(["holding.id", "holding.name", "holding.state", "holding.asset_tag", "holding.space_id"])
                .where("holding.school_id", "=", school).where("holding.campus_id", "=", campus).where("holding.id", "in", ids)
                .where("holding.state", "!=", "retired").where("type.tracking_mode", "=", "individual").where("type.is_active", "=", true).execute() : [];
            return { generated_at: executionNow().toISOString(), publication: publication ? { id: publication.id, version: publication.version } : null, items: fixtures.map(element => {
                    const holding = holdings.find(item => item.id === element.holding_id);
                    return { element_id: element.id, holding_id: element.holding_id, name: holding?.name ?? element.label,
                        state: holding?.state ?? "unknown",
                        asset_tag: holding?.asset_tag ?? null, space_id: holding?.space_id ?? null, reportable: Boolean(holding),
                        target_path: context.can_edit ? "/more/setup/institution/campus" : holding ? `/areas/facilities?report=1&holding_id=${encodeURIComponent(holding.id)}` : '/more/virtual-campus', };
                }) };
        });
    }
    lock(tx, school, campus) {
        return sql `SELECT pg_advisory_xact_lock(hashtextextended(${`campus-scene:${school}:${campus}`},0))`.execute(tx);
    }
    async documentHash(tx, document) {
        const result = await sql `SELECT encode(sha256(convert_to(${JSON.stringify(document)}::jsonb::text,'UTF8')),'hex') AS hash`.execute(tx);
        return result.rows[0].hash;
    }
    async validateLinks(tx, school, campus, document) {
        if (document.source.image_asset_id) {
            const image = await tx
                .selectFrom("campus_scene_images")
                .select("id")
                .where("id", "=", document.source.image_asset_id)
                .where("school_id", "=", school)
                .where("campus_id", "=", campus)
                .executeTakeFirst();
            if (!image)
                throw new BadRequestException("Choose a source image uploaded to this campus in the current world.");
        }
        const resourceIds = document.elements.flatMap(element => element.holding_id ? [element.holding_id] : []);
        if (resourceIds.length) {
            const resources = await tx.selectFrom("campus_resource_holdings as holding")
                .innerJoin("campus_resource_types as type", join => join.onRef("type.id", "=", "holding.resource_type_id").onRef("type.school_id", "=", "holding.school_id"))
                .select("holding.id").where("holding.school_id", "=", school).where("holding.campus_id", "=", campus)
                .where("holding.id", "in", resourceIds).where("holding.state", "!=", "retired").where("type.tracking_mode", "=", "individual").where("type.is_active", "=", true).forShare(["holding", "type"]).execute();
            if (resources.length !== resourceIds.length)
                throw new BadRequestException("Link each fixture to a current individual resource in this campus.");
        }
        if (!document.elements.some((element) => element.space_id || element.floor_id || element.navigation?.start_space_id || element.navigation?.end_space_id || element.navigation_connector))
            return;
        const spaces = await tx
            .selectFrom("campus_spaces")
            .select(["id", "parent_space_id", "kind"])
            .where("school_id", "=", school)
            .where("campus_id", "=", campus)
            .where("status", "=", "active")
            .execute();
        const byId = new Map(spaces.map((space) => [space.id, space]));
        for (const element of document.elements) {
            if (element.navigation_connector) {
                const connector = element.navigation_connector;
                const building = document.elements.find(item => item.id === element.parent_element_id);
                if (!building?.space_id || building.kind !== "building" || !byId.has(building.space_id))
                    throw new BadRequestException(`“${element.label}” needs a current mapped building.`);
                for (const floorId of [connector.from_floor_id, connector.to_floor_id].filter((id) => Boolean(id))) {
                    let place = byId.get(floorId);
                    if (place?.kind !== "floor")
                        throw new BadRequestException(`“${element.label}” needs active canonical floors in this campus.`);
                    const seen = new Set();
                    while (place && place.id !== building.space_id && !seen.has(place.id)) {
                        seen.add(place.id);
                        place = place.parent_space_id ? byId.get(place.parent_space_id) : undefined;
                    }
                    if (place?.id !== building.space_id)
                        throw new BadRequestException(`“${element.label}” must connect floors in its mapped building.`);
                }
            }
            const routePlaces = [element.navigation?.start_space_id, element.navigation?.end_space_id].filter((id) => Boolean(id));
            if (routePlaces.some(id => !byId.has(id)))
                throw new BadRequestException(`“${element.label}” must connect active places in this campus.`);
            if (element.space_id && !byId.has(element.space_id))
                throw new BadRequestException(`“${element.label}” must link to an active space in this campus.`);
            if (element.floor_id && byId.get(element.floor_id)?.kind !== "floor")
                throw new BadRequestException(`“${element.label}” must use an active floor in this campus.`);
            if (element.space_id && element.floor_id) {
                let parent = byId.get(element.space_id);
                const seen = new Set();
                while (parent &&
                    parent.id !== element.floor_id &&
                    !seen.has(parent.id)) {
                    seen.add(parent.id);
                    parent = parent.parent_space_id
                        ? byId.get(parent.parent_space_id)
                        : undefined;
                }
                if (parent?.id !== element.floor_id)
                    throw new BadRequestException(`“${element.label}” is linked to a space outside its selected floor.`);
            }
            if (element.floor_id) {
                for (const id of routePlaces) {
                    let place = byId.get(id);
                    const seen = new Set();
                    while (place && place.id !== element.floor_id && !seen.has(place.id)) {
                        seen.add(place.id);
                        place = place.parent_space_id ? byId.get(place.parent_space_id) : undefined;
                    }
                    if (place?.id !== element.floor_id)
                        throw new BadRequestException(`“${element.label}” connects a place outside its selected floor.`);
                }
            }
            else {
                for (const id of routePlaces) {
                    let place = byId.get(id);
                    const seen = new Set();
                    while (place && !seen.has(place.id)) {
                        if (place.kind === "floor")
                            throw new BadRequestException(`“${element.label}” must select the recorded floor before connecting an indoor place.`);
                        seen.add(place.id);
                        place = place.parent_space_id ? byId.get(place.parent_space_id) : undefined;
                    }
                }
            }
        }
    }
    result(row, replayed = false) {
        return {
            id: row.scene_id,
            revision: row.revision,
            document: sceneDocumentSchema.parse(row.document),
            draft: row.action === "published"
                ? null
                : sceneDocumentSchema.parse(row.document),
            published_version: row.published_revision,
            ...(row.action === "published" ? { version: row.revision } : {}),
            replayed,
        };
    }
    async replay(tx, school, campus, revision) {
        const record = await tx
            .selectFrom("campus_scene_revisions")
            .selectAll()
            .where("school_id", "=", school)
            .where("campus_id", "=", campus)
            .where("revision", "=", revision)
            .executeTakeFirst();
        if (!record)
            throw new ConflictException("The accepted scene receipt is unavailable. Reload the campus scene.");
        return this.result(record, true);
    }
    /** Shared manual/imported draft seam. Provider output passes identical validation and authorization. */
    saveDraft(user, school, campus, raw) {
        const input = saveSceneDraftSchema.parse(raw);
        return this.db.transaction().execute(tx => this.saveDraftInTransaction(tx, user, school, campus, input));
    }
    /** One reviewed human decision; ordinary native place commands and one native draft save commit together. */
    saveReviewedPlaces(user, school, campus, raw, request) {
        const input = reviewedScenePlacesSchema.parse(raw);
        const requestHash = scenePayloadHash({ school_id: school, campus_id: campus, input });
        return this.db.transaction().execute(async (tx) => {
            let context = await this.context(tx, user, school, campus, true);
            if (!this.topology)
                throw new ConflictException("Campus place setup is unavailable. Your review has not been saved.");
            // Same order as native place writes: campus-space use, institution, scene,
            // then current referenced places. No frontend sequence or nested transaction.
            await this.topology.lockPlaceCreationContext(tx, user, school);
            await this.lock(tx, school, campus);
            const row = await this.current(tx, school, campus, true);
            context = await this.context(tx, user, school, campus, true);
            const target = { id: campus, campus_id: campus, revision: row?.revision ?? 0, kind: "campus_scene" };
            const retained = await this.model.reviewedPlacesReplay(tx, user, context.actor, school, target, input, requestHash);
            if (retained) {
                const accepted = await this.replay(tx, school, campus, retained.revision);
                const requested = new Map(input.rows.map(item => [item.proposal_id, item]));
                const acceptedElements = new Map(accepted.document.elements.map(element => [element.id, element]));
                const seen = new Set();
                for (const mapping of retained.mappings) {
                    const decision = requested.get(mapping.proposal_id);
                    if (!decision || seen.has(mapping.proposal_id) || mapping.element_ids.length !== decision.element_ids.length
                        || mapping.element_ids.some((id, position) => id !== decision.element_ids[position])
                        || mapping.action !== (decision.action === "create" ? "created" : "reused")
                        || (decision.action === "reuse" && (mapping.space_id !== decision.space_id || mapping.space_revision !== decision.expected_space_revision))
                        || mapping.element_ids.some(id => acceptedElements.get(id)?.space_id !== mapping.space_id)) {
                        throw new ConflictException("The accepted place-review mapping is unavailable. Reload the campus draft.");
                    }
                    seen.add(mapping.proposal_id);
                }
                if (seen.size !== input.rows.length)
                    throw new ConflictException("The accepted place-review mapping is incomplete. Reload the campus draft.");
                return { ...accepted, mappings: retained.mappings, current_revision: target.revision };
            }
            if (target.revision !== input.expected_revision)
                throw new ConflictException({ code: "scene_revision_conflict",
                    message: "The campus scene changed. Reload it before saving this place review.", current_revision: target.revision });
            if (row && !row.draft_document)
                throw new ConflictException("Reopen the published campus scene before connecting more places.");
            const document = structuredClone(input.document), elements = new Map(document.elements.map(element => [element.id, element]));
            // The full local document is an explicit draft edit, including a confirmed
            // source replacement. Old canonical places remain; only selected currently
            // unlinked drawings may gain a new link in the reviewed rows below.
            const references = [...new Set(input.rows.flatMap(item => item.action === "reuse" ? [item.space_id] : item.parent_space_id ? [item.parent_space_id] : []))];
            const places = references.length ? await tx.selectFrom("campus_spaces").select(["id", "name", "kind", "status", "revision"])
                .where("school_id", "=", school).where("campus_id", "=", campus).where("id", "in", references).orderBy("id").forShare().execute() : [];
            const currentPlaces = new Map(places.map(place => [place.id, place]));
            const mappings = [];
            for (const item of input.rows) {
                if (item.action === "reuse") {
                    const place = currentPlaces.get(item.space_id);
                    if (!place || place.status !== "active" || place.revision !== item.expected_space_revision)
                        throw new ConflictException({ code: "campus_place_revision_conflict", message: "A selected campus place changed or is unavailable. Reload the places and review this choice." });
                    for (const elementId of item.element_ids) {
                        const element = elements.get(elementId);
                        if (!reviewedPlaceElementKinds(element).includes(place.kind))
                            throw new BadRequestException("Choose a campus place kind appropriate for every drawing in this group.");
                        if (element.space_id && element.space_id !== place.id)
                            throw new ConflictException({ code: "campus_place_link_conflict", message: "An already connected drawing cannot be replaced by this place review." });
                        element.space_id = place.id;
                    }
                    mappings.push({ proposal_id: item.proposal_id, element_ids: item.element_ids, space_id: place.id, space_revision: place.revision, action: "reused" });
                    continue;
                }
                if (item.parent_space_id) {
                    const parent = currentPlaces.get(item.parent_space_id);
                    if (!parent || parent.status !== "active" || parent.revision !== item.expected_parent_revision)
                        throw new ConflictException({ code: "campus_place_revision_conflict", message: "A selected parent place changed or is unavailable. Reload the places and review this choice." });
                }
                if (item.element_ids.some(elementId => Boolean(elements.get(elementId).space_id)))
                    throw new ConflictException({ code: "campus_place_link_conflict", message: "An already connected drawing cannot create a replacement campus place." });
                const created = await this.topology.createSpaceInTransaction(tx, user, school, {
                    create_campus_if_missing: true, idempotency_key: reviewedPlaceSaveKey(input.idempotency_key, item.proposal_id), campus_id: campus,
                    name: item.name, code: item.code, kind: item.kind, parent_space_id: item.parent_space_id ?? null,
                    capacity: null, is_accessible: false, is_bookable: false, status: "active",
                }, request);
                if (created.replayed)
                    throw new ConflictException("This place save key was already used outside this review. Reload the draft and choose the existing place.");
                const placeId = String(created.row.id), revision = Number(created.row.revision);
                for (const elementId of item.element_ids)
                    elements.get(elementId).space_id = placeId;
                mappings.push({ proposal_id: item.proposal_id, element_ids: item.element_ids, space_id: placeId, space_revision: revision, action: "created" });
            }
            const result = await this.saveDraftInTransaction(tx, user, school, campus, { idempotency_key: input.idempotency_key,
                expected_revision: input.expected_revision, document: sceneDocumentSchema.parse(document) }, { request_hash: requestHash, mappings });
            return { ...result, mappings, current_revision: result.revision };
        });
    }
    /** The ordinary native draft writer, shared with the atomic reviewed-place composition. */
    async saveDraftInTransaction(tx, user, school, campus, input, reviewedPlaces) {
        const context = await this.context(tx, user, school, campus, true);
        await this.lock(tx, school, campus);
        const row = await this.current(tx, school, campus, true), target = {
            id: campus,
            campus_id: campus,
            revision: row?.revision ?? 0,
            kind: "campus_scene",
        };
        const command = await this.model.prepare(tx, user, context.actor, school, target, "draft_saved", input, input.document, await this.documentHash(tx, input.document), reviewedPlaces?.request_hash);
        if (command.replayed)
            return this.replay(tx, school, campus, command.revision);
        if (row && !row.draft_document)
            throw new ConflictException("Reopen the published scene before editing its next draft.");
        await this.validateLinks(tx, school, campus, input.document);
        const at = executionNow(), revision = target.revision + 1;
        if (row)
            await tx
                .updateTable("campus_visual_scenes")
                .set({ draft_document: input.document, revision, updated_at: at })
                .where("id", "=", row.id)
                .where("school_id", "=", school)
                .execute();
        else
            await tx
                .insertInto("campus_visual_scenes")
                .values({
                id: campus,
                school_id: school,
                campus_id: campus,
                revision,
                draft_document: input.document,
                published_revision: null,
                created_at: at,
                updated_at: at,
            })
                .execute();
        const receipt = await tx
            .insertInto("campus_scene_revisions")
            .values({
            id: randomUUID(),
            school_id: school,
            campus_id: campus,
            scene_id: campus,
            revision,
            action: "draft_saved",
            document: input.document,
            published_revision: row?.published_revision ?? null,
            command_id: command.prepared.command_id,
            actor_user_id: user.id,
            actor_person_id: context.actor.person_id,
            recorded_at: at,
        })
            .returningAll()
            .executeTakeFirstOrThrow();
        await this.model.finish(tx, user, school, { ...target, revision }, "draft_saved", command.prepared, at, { published_revision: receipt.published_revision, ...(reviewedPlaces ? { reviewed_places_request_hash: reviewedPlaces.request_hash,
                reviewed_places_mappings: reviewedPlaces.mappings } : {}) });
        return this.result(receipt);
    }
    publish(user, school, campus, raw) {
        return this.transition(user, school, campus, raw, "published");
    }
    reopen(user, school, campus, raw) {
        return this.transition(user, school, campus, raw, "reopened");
    }
    transition(user, school, campus, raw, action) {
        const input = sceneCommandSchema.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const context = await this.context(tx, user, school, campus, true);
            await this.lock(tx, school, campus);
            const row = await this.current(tx, school, campus, true), target = {
                id: campus,
                campus_id: campus,
                revision: row?.revision ?? 0,
                kind: "campus_scene",
            };
            const published = action === "reopened" ? await this.publication(tx, row) : null;
            const source = action === "published" ? row?.draft_document : published?.document;
            const command = await this.model.prepare(tx, user, context.actor, school, target, action, input, null, source ? await this.documentHash(tx, source) : undefined);
            if (command.replayed)
                return this.replay(tx, school, campus, command.revision);
            if (!row)
                throw new ConflictException("Save a campus draft first.");
            if (action === "reopened" && row.draft_document)
                throw new ConflictException("This campus already has an editable draft.");
            if (!source)
                throw new ConflictException(action === "published"
                    ? "Save a draft before publishing."
                    : "Publish a scene before reopening it.");
            const document = sceneDocumentSchema.parse(source);
            // A retained publication can be reopened to repair links whose canonical
            // places were retired after publication. New publication rechecks them.
            if (action === "published")
                await this.validateLinks(tx, school, campus, document);
            if (action === "published" && !assertPublishableScene(document))
                throw new BadRequestException({
                    code: "scene_review_required",
                    message: "Review every element in a nonempty scene before publishing it.",
                });
            const at = executionNow(), revision = row.revision + 1, publishedRevision = action === "published" ? revision : row.published_revision;
            await tx
                .updateTable("campus_visual_scenes")
                .set({
                revision,
                draft_document: action === "published" ? null : document,
                published_revision: publishedRevision,
                updated_at: at,
            })
                .where("id", "=", row.id)
                .where("school_id", "=", school)
                .execute();
            const receipt = await tx
                .insertInto("campus_scene_revisions")
                .values({
                id: randomUUID(),
                school_id: school,
                campus_id: campus,
                scene_id: row.id,
                revision,
                action,
                document,
                published_revision: publishedRevision,
                command_id: command.prepared.command_id,
                actor_user_id: user.id,
                actor_person_id: context.actor.person_id,
                recorded_at: at,
            })
                .returningAll()
                .executeTakeFirstOrThrow();
            await this.model.finish(tx, user, school, { ...target, revision }, action, command.prepared, at, { published_revision: publishedRevision });
            return this.result(receipt);
        });
    }
    uploadImage(user, school, campus, raw) {
        const input = uploadSceneImageSchema.parse(raw), image = decodeSceneImage(input.data_url);
        if ((input.width && input.width !== image.width) ||
            (input.height && input.height !== image.height))
            throw new BadRequestException("The supplied image dimensions do not match its bytes.");
        return this.db.transaction().execute(async (tx) => {
            const context = await this.context(tx, user, school, campus, true);
            await this.lock(tx, school, campus);
            const target = {
                id: input.idempotency_key,
                campus_id: campus,
                revision: 0,
                kind: "campus_scene_image",
            };
            const command = await this.model.prepare(tx, user, context.actor, school, target, "image_uploaded", { idempotency_key: input.idempotency_key, expected_revision: 0 }, {
                sha256: image.sha256,
                mime_type: image.mime_type,
                width: image.width,
                height: image.height,
                rights_confirmed: true,
            }, image.sha256);
            if (command.replayed) {
                const retained = await tx
                    .selectFrom("campus_scene_images")
                    .select(["id", "mime_type", "width", "height", "sha256", "byte_size"])
                    .where("id", "=", target.id)
                    .where("school_id", "=", school)
                    .where("campus_id", "=", campus)
                    .executeTakeFirst();
                if (!retained)
                    throw new ConflictException("The accepted source image receipt is unavailable.");
                return { image: retained, replayed: true };
            }
            const at = executionNow();
            await tx
                .insertInto("campus_scene_images")
                .values({
                id: target.id,
                school_id: school,
                campus_id: campus,
                ...image,
                rights_confirmed: true,
                command_id: command.prepared.command_id,
                actor_user_id: user.id,
                actor_person_id: context.actor.person_id,
                created_at: at,
            })
                .execute();
            await this.model.finish(tx, user, school, { ...target, revision: 1 }, "image_uploaded", command.prepared, at, { image_id: target.id, sha256: image.sha256 });
            return {
                image: {
                    id: target.id,
                    mime_type: image.mime_type,
                    width: image.width,
                    height: image.height,
                    sha256: image.sha256,
                    byte_size: image.byte_size,
                },
                replayed: false,
            };
        });
    }
    /** Private authorized source seam used by the renderer and optional import provider. */
    readImage(user, school, campus, imageId) {
        parseIds(school, imageId);
        return this.db.transaction().execute(async (tx) => {
            await this.context(tx, user, school, campus, true);
            const image = await tx
                .selectFrom("campus_scene_images")
                .select(["id", "bytes", "mime_type", "width", "height", "sha256"])
                .where("id", "=", imageId)
                .where("school_id", "=", school)
                .where("campus_id", "=", campus)
                .executeTakeFirst();
            if (!image)
                throw new NotFoundException("Source image not found in this campus and current world.");
            return image;
        });
    }
};
CampusScenesService = __decorate([
    Injectable(),
    __param(2, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(3, Optional()),
    __metadata("design:paramtypes", [DatabaseService,
        CampusScenesModel, Object, InstitutionSetupService])
], CampusScenesService);
export { CampusScenesService };
//# sourceMappingURL=campus-scenes.service.js.map