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
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service.js';
import { hasScopedSchoolPermission } from '../roles/authorization.js';
import { executionEnvironmentStorage, executionNow } from '../campus-model-core/execution-time.runtime.js';
import { HUMAN_AGENT_IDENTITY_PORT } from '../campus-model-core/human-agent-identity.port.js';
import { DOMAIN_COMMAND_GATEWAY_PORT } from '../campus-model-core/domain-command-gateway.port.js';
import { DOMAIN_COMMAND_RECEIPT_READ_PORT } from '../campus-model-core/domain-command-receipt-read.port.js';
import { DOMAIN_EVENT_JOURNAL_PORT } from '../campus-model-core/domain-event-journal.port.js';
import { OBSERVATION_INGRESS_PORT } from '../campus-model-core/observation-ingress.port.js';
import { visitArrangementInput, visitCommand, visitListInput, visitMovementInput, visitOptionsInput } from './visit-arrangements.contracts.js';
const label = (first, last) => `${first} ${last}`.trim();
const iso = (value) => value === null ? null : new Date(value).toISOString();
const handler = 'gate.visit-arrangements.v1';
let VisitArrangementsService = class VisitArrangementsService {
    db;
    identities;
    gateway;
    receipts;
    journal;
    observations;
    constructor(db, identities, gateway, receipts, journal, observations) {
        this.db = db;
        this.identities = identities;
        this.gateway = gateway;
        this.receipts = receipts;
        this.journal = journal;
        this.observations = observations;
    }
    async access(tx, user, school) {
        z.uuid().parse(school);
        const environment = executionEnvironmentStorage.getStore();
        if (!user.is_active || user.active_school_id !== school || environment?.institution_id && environment.institution_id !== school)
            throw new ForbiddenException('Choose this campus and its current world before opening visits.');
        if (!await hasScopedSchoolPermission(tx, user.id, school, 'gate.manage', 'institution', school))
            throw new ForbiddenException('Manage In & Out permission is required to arrange visits.');
        const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: school, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new ForbiddenException('Current canonical campus app access is required.');
        return actor;
    }
    async visit(tx, school, id, lock = false) {
        z.uuid().parse(id);
        let query = tx.selectFrom('gate_visit_arrangements').selectAll().where('school_id', '=', school).where('id', '=', id);
        if (lock)
            query = query.forUpdate();
        const visit = await query.executeTakeFirst();
        if (!visit)
            throw new NotFoundException('This visit is unavailable in the selected campus.');
        return visit;
    }
    async person(tx, school, id, revision) {
        const row = (await sql `
      SELECT id,first_name,last_name,revision,avatar_url FROM school_people
      WHERE school_id=${school}::uuid AND id=${id}::uuid AND retired_at IS NULL FOR SHARE`.execute(tx)).rows[0];
        if (!row)
            throw new UnprocessableEntityException('Choose a current person from this campus.');
        if (revision !== undefined && revision !== row.revision)
            throw new ConflictException({ code: 'visit_person_changed', message: 'This person changed. Select their current profile again.' });
        return { id: row.id, label: label(row.first_name, row.last_name), revision: row.revision, avatar_url: row.avatar_url };
    }
    async place(tx, school, id) {
        const row = (await sql `SELECT place.id,place.name AS label,place.kind,campus.name AS campus_label
      FROM campus_spaces place JOIN institution_campuses campus ON campus.id=place.campus_id AND campus.school_id=place.school_id
      WHERE place.school_id=${school}::uuid AND place.id=${id}::uuid AND place.status='active' AND place.kind<>'virtual' AND campus.status='active'
      FOR SHARE OF place,campus`.execute(tx)).rows[0];
        if (!row)
            throw new UnprocessableEntityException('Choose a current physical meeting place from this campus.');
        return row;
    }
    async validateReferences(tx, school, input) {
        if (input.person_id)
            await this.person(tx, school, input.person_id, input.person_revision);
        await this.person(tx, school, input.contact_person_id, input.contact_revision);
        await this.place(tx, school, input.place_id);
    }
    async summaries(tx, school, visits) {
        if (!visits.length)
            return [];
        const peopleIds = [...new Set(visits.flatMap(row => [row.contact_person_id, ...(row.person_id ? [row.person_id] : [])]))];
        const people = await tx.selectFrom('school_people').select(['id', 'first_name', 'last_name', 'revision', 'avatar_url']).where('school_id', '=', school).where('id', 'in', peopleIds).execute();
        const placeIds = [...new Set(visits.map(row => row.place_id))];
        const places = (await sql `SELECT place.id,place.name AS label,place.kind,campus.name AS campus_label
      FROM campus_spaces place JOIN institution_campuses campus ON campus.id=place.campus_id AND campus.school_id=place.school_id
      WHERE place.school_id=${school}::uuid AND place.id=ANY(${placeIds}::uuid[])`.execute(tx)).rows;
        const person = (id) => {
            const row = people.find(candidate => candidate.id === id);
            return { id: row.id, label: label(row.first_name, row.last_name), revision: row.revision, avatar_url: row.avatar_url };
        };
        return visits.map(visit => ({
            id: visit.id, revision: visit.revision, title: visit.title,
            person: visit.person_id ? person(visit.person_id) : null,
            guest_name: visit.guest_name,
            guest_label: visit.person_id ? person(visit.person_id).label : visit.guest_name,
            party_size: visit.party_size, starts_at: iso(visit.starts_at), ends_at: iso(visit.ends_at),
            place: places.find(row => row.id === visit.place_id), contact: person(visit.contact_person_id),
            state: visit.state, created_at: iso(visit.created_at), updated_at: iso(visit.updated_at), cancelled_at: iso(visit.cancelled_at),
            last_movement: visit.last_movement_direction ? {
                direction: visit.last_movement_direction, occurred_at: iso(visit.last_movement_at), observed_count: visit.last_movement_count,
            } : null,
        }));
    }
    async detailIn(tx, visit) {
        const versions = await tx.selectFrom('gate_visit_arrangement_revisions as version')
            .select(['version.revision', 'version.action', 'version.recorded_at', 'version.actor_person_id', 'version.snapshot', 'version.guest_label', 'version.place_label', 'version.contact_label', 'version.actor_label'])
            .where('version.school_id', '=', visit.school_id).where('version.visit_id', '=', visit.id).orderBy('version.revision', 'desc').limit(25).execute();
        return {
            visit: (await this.summaries(tx, visit.school_id, [visit]))[0],
            can_edit: visit.state === 'confirmed', can_cancel: visit.state === 'confirmed',
            can_record_arrival: visit.state === 'confirmed', can_record_exit: true,
            history: versions.map(version => {
                const source = version.snapshot;
                return {
                    revision: version.revision, action: version.action, recorded_at: iso(version.recorded_at),
                    actor: { id: version.actor_person_id, label: version.actor_label },
                    title: source.title, guest_name: source.guest_name, person_id: source.person_id,
                    guest_label: version.guest_label, place_label: version.place_label, contact_label: version.contact_label,
                    party_size: source.party_size, starts_at: iso(source.starts_at), ends_at: iso(source.ends_at),
                    place_id: source.place_id, contact_person_id: source.contact_person_id, state: source.state,
                    last_movement: source.last_movement_direction ? { direction: source.last_movement_direction, occurred_at: iso(source.last_movement_at), observed_count: source.last_movement_count } : null,
                };
            }),
            history_has_more: visit.revision > versions.length,
        };
    }
    async workspace(user, school, raw = {}) {
        const input = visitListInput.parse(raw);
        return this.db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
            await this.access(tx, user, school);
            const at = executionNow(), pattern = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
            const filter = input.view === 'all' ? sql `true` : input.view === 'cancelled' ? sql `visit.state='cancelled'` : input.view === 'past' ? sql `visit.state='confirmed' AND visit.ends_at<${at}` : sql `visit.state='confirmed' AND visit.ends_at>=${at}`;
            const search = sql `(visit.title ILIKE ${pattern} ESCAPE '\\' OR coalesce(visit.guest_name,concat(person.first_name,' ',person.last_name)) ILIKE ${pattern} ESCAPE '\\')`;
            const rows = (await sql `SELECT visit.* FROM gate_visit_arrangements visit LEFT JOIN school_people person ON person.id=visit.person_id AND person.school_id=visit.school_id
        WHERE visit.school_id=${school}::uuid AND(${filter}) AND(${search})
        ORDER BY CASE WHEN visit.ends_at>=${at} AND visit.state='confirmed' THEN 0 ELSE 1 END,visit.starts_at,visit.id
        LIMIT 10 OFFSET ${(input.page - 1) * 10}`.execute(tx)).rows;
            const counts = (await sql `SELECT
        count(*) FILTER(WHERE ${filter})::int AS total,
        count(*) FILTER(WHERE visit.state='confirmed' AND visit.ends_at>=${at})::int AS upcoming,
        count(*) FILTER(WHERE visit.state='confirmed' AND visit.ends_at<${at})::int AS past,
        count(*) FILTER(WHERE visit.state='cancelled')::int AS cancelled
        FROM gate_visit_arrangements visit LEFT JOIN school_people person ON person.id=visit.person_id AND person.school_id=visit.school_id
        WHERE visit.school_id=${school}::uuid AND(${search})`.execute(tx)).rows[0];
            const campus = await tx.selectFrom('schools').select('timezone').where('id', '=', school).executeTakeFirstOrThrow();
            return { visits: await this.summaries(tx, school, rows), pagination: { page: input.page, page_size: 10, total: counts.total, total_pages: Math.ceil(counts.total / 10) }, totals: { upcoming: counts.upcoming, past: counts.past, cancelled: counts.cancelled }, timezone: campus.timezone, can_manage: true };
        });
    }
    async options(user, school, raw = {}) {
        const input = visitOptionsInput.parse(raw);
        return this.db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
            const actor = await this.access(tx, user, school), pattern = `%${input.q.replace(/[\\%_]/g, '\\$&')}%`, offset = (input.page - 1) * 25;
            const people = (await sql `SELECT id,trim(concat(first_name,' ',last_name)) AS label,revision,avatar_url FROM school_people
        WHERE school_id=${school}::uuid AND retired_at IS NULL AND(trim(concat(first_name,' ',last_name)) ILIKE ${pattern} ESCAPE '\\')
        ORDER BY first_name,last_name,id LIMIT 26 OFFSET ${offset}`.execute(tx)).rows;
            const peopleMore = people.length > 25;
            for (const id of new Set([input.person_id, input.contact_person_id].filter(Boolean)))
                if (!people.some(row => row.id === id))
                    people.push(await this.person(tx, school, id));
            const places = (await sql `SELECT place.id,place.name AS label,place.kind,campus.name AS campus_label FROM campus_spaces place
        JOIN institution_campuses campus ON campus.id=place.campus_id AND campus.school_id=place.school_id
        WHERE place.school_id=${school}::uuid AND place.status='active' AND place.kind<>'virtual' AND campus.status='active'
        AND(place.name ILIKE ${pattern} ESCAPE '\\' OR campus.name ILIKE ${pattern} ESCAPE '\\')
        ORDER BY place.name,place.id LIMIT 26 OFFSET ${offset}`.execute(tx)).rows;
            const placesMore = places.length > 25;
            if (input.place_id && !places.some(row => row.id === input.place_id))
                places.push(await this.place(tx, school, input.place_id));
            const self = await this.person(tx, school, actor.person_id), campus = await tx.selectFrom('schools').select('timezone').where('id', '=', school).executeTakeFirstOrThrow();
            const choices = [...people.slice(0, 25), ...people.slice(25).filter(row => row.id === input.person_id || row.id === input.contact_person_id)];
            const accounts = await this.identities.listPersonAccountStates(tx, { school_id: school, person_ids: choices.map(person => person.id), at: executionNow().toISOString() });
            return { actor: { person_id: actor.person_id, label: actor.label, revision: self.revision }, people: choices.map(person => ({ ...person, has_app_access: accounts.some(account => account.person_id === person.id && account.account_state === 'active') })), places: [...places.slice(0, 25), ...places.slice(25).filter(row => row.id === input.place_id)], pagination: { page: input.page, page_size: 25, people_has_more: peopleMore, places_has_more: placesMore }, timezone: campus.timezone };
        });
    }
    detail(user, school, id) {
        return this.db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => { await this.access(tx, user, school); return this.detailIn(tx, await this.visit(tx, school, id)); });
    }
    retained(tx, user, school, command) {
        return this.receipts.readDomainCommandReceipt(tx, { school_id: school, actor_user_id: user.id, source_domain: 'gate', handler_key: handler, handler_version: 1, idempotency_key: `gate-visit:${user.id}:${command}` });
    }
    async prepare(tx, user, actor, source, action, input) {
        const payloadHash = createHash('sha256').update(JSON.stringify({ visit_id: source.id, action, ...input })).digest('hex');
        const old = await this.retained(tx, user, source.school_id, input.command_id);
        if (old) {
            if (old.actor_agent_id !== actor.agent_id || old.target.domain_id !== source.id || old.command_type !== `gate.visit_arrangement.${action}` || old.expected_revision !== input.expected_revision || old.safe_context.payload_hash !== payloadHash)
                throw new ConflictException('This command belongs to a different visit action.');
            if (old.state === 'pending')
                throw new ConflictException({ code: 'visit_pending', message: 'This exact action is awaiting confirmation. Check it before starting another action.' });
            if (old.receipt.terminal_state !== 'accepted')
                throw new ConflictException('This visit action was not accepted. Review the current record.');
            return { replay: true };
        }
        if (source.revision !== input.expected_revision)
            throw new ConflictException({ code: 'visit_changed', message: 'This visit changed. Review its latest version before saving.', fields: { visit_changed: { confirmation: 'permanently_inapplicable', receipt_state: 'absent', visit_id: source.id, command_id: input.command_id, expected_revision: input.expected_revision, current_revision: source.revision, reason: 'stream_advanced' } } });
        const prepared = await this.gateway.prepareDomainCommand(tx, {
            school_id: source.school_id, actor_user_id: user.id, command_type: `gate.visit_arrangement.${action}`,
            handler_key: handler, handler_version: 1, source_domain: 'gate',
            target: { kind: 'gate_visit_arrangement', domain: 'gate', domain_id: source.id, label: 'Campus visit', lifecycle_state: 'active', source_revision: Math.max(1, source.revision), metadata: {} },
            current_revision: source.revision, expected_revision: input.expected_revision, capability: 'gate.manage', purpose: `gate_visit_${action}`,
            requested_at: executionNow().toISOString(), correlation_id: source.id, causation_id: source.last_domain_event_id ?? null,
            idempotency_key: `gate-visit:${user.id}:${input.command_id}`, operating_rule_version_ref: null, configuration_refs: [],
            authority_attestation: { evaluator_domain: 'gate', decision: 'allowed', reason_codes: ['explicit_current_institution_gate_authority'], authority_source_refs: [{ school_id: source.school_id, permission: 'gate.manage', context_kind: 'institution', scope_id: source.school_id, actor_person_id: actor.person_id }], operating_rule_refs: [], valid_until: null },
            safe_context: { visit_id: source.id, payload_hash: payloadHash },
        });
        if (prepared.status !== 'ready')
            throw new ConflictException('Refresh this exact visit action.');
        return { replay: false, prepared };
    }
    async finish(tx, user, actor, visit, action, command, previousEvent) {
        const payload = { visit_id: visit.id, revision: visit.revision, action, source_command_id: command.command_id, refresh: ['gate-visits'] };
        const eventType = `gate.visit_arrangement.${action}`;
        const outbox = await tx.insertInto('event_outbox').values({ school_id: visit.school_id, event_type: eventType, aggregate_type: 'gate_visit_arrangement_event', aggregate_id: visit.id, audience_user_ids: [], payload, idempotency_key: `gate-visit-event:${command.command_id}`, created_at: visit.updated_at, notification_user_ids: [], notification_payload: null }).returning('id').executeTakeFirstOrThrow();
        const destination = await tx.selectFrom('campus_spaces').select(['id', 'name', 'revision', 'status', 'kind']).where('school_id', '=', visit.school_id).where('id', '=', visit.place_id).executeTakeFirstOrThrow();
        const event = await this.journal.recordAcceptedEvent(tx, {
            school_id: visit.school_id, source_outbox_event_id: outbox.id, event_type: eventType,
            subject: { kind: 'gate_visit_arrangement', domain: 'gate', domain_id: visit.id, label: 'Campus visit', lifecycle_state: visit.state === 'cancelled' ? 'inactive' : 'active', source_revision: visit.revision, metadata: {} },
            context: { kind: 'space', domain: 'campus_topology', domain_id: destination.id, label: destination.name, lifecycle_state: destination.status, source_revision: destination.revision, metadata: { space_kind: destination.kind } }, actor_user_id: user.id, occurred_at: visit.updated_at.toISOString(), effective_from: visit.updated_at.toISOString(), effective_until: null,
            source_domain: 'gate', source_record_id: visit.id, source_revision: visit.revision, correlation_id: visit.id, causation_event_id: previousEvent,
            idempotency_key: `gate-visit-journal:${command.command_id}`, payload, audience_user_ids: [user.id],
        });
        await tx.updateTable('gate_visit_arrangements').set({ last_domain_event_id: event.event_id }).where('school_id', '=', visit.school_id).where('id', '=', visit.id).execute();
        await sql `INSERT INTO gate_visit_arrangement_revisions(school_id,visit_id,revision,action,command_id,actor_person_id,actor_user_id,recorded_at,guest_label,place_label,contact_label,actor_label,snapshot)
      SELECT visit.school_id,visit.id,visit.revision,${action},visit.last_command_id,visit.updated_by_person_id,visit.updated_by_user_id,visit.updated_at,
        CASE WHEN visit.person_id IS NOT NULL THEN trim(concat(guest.first_name,' ',guest.last_name)) ELSE visit.guest_name END,
        place.name,trim(concat(contact.first_name,' ',contact.last_name)),trim(concat(recorder.first_name,' ',recorder.last_name)),to_jsonb(visit)-'last_domain_event_id'
      FROM gate_visit_arrangements visit
      LEFT JOIN school_people guest ON guest.id=visit.person_id AND guest.school_id=visit.school_id
      JOIN school_people contact ON contact.id=visit.contact_person_id AND contact.school_id=visit.school_id
      JOIN school_people recorder ON recorder.id=visit.updated_by_person_id AND recorder.school_id=visit.school_id
      JOIN campus_spaces place ON place.id=visit.place_id AND place.school_id=visit.school_id
      WHERE visit.school_id=${visit.school_id}::uuid AND visit.id=${visit.id}::uuid`.execute(tx);
        await tx.insertInto('audit_events').values({ actor_id: user.id, school_id: visit.school_id, action: `gate.visit_arrangement.${action}`, target_type: 'gate_visit_arrangement', target_id: visit.id, request_id: command.command_id, ip_hash: '', metadata: { revision: visit.revision, actor_person_id: actor.person_id } }).execute();
        await this.gateway.completeDomainCommand(tx, { school_id: visit.school_id, command_id: command.command_id, terminal_state: 'accepted', code: 'visit_arrangement_accepted', explanation: 'This exact visit action was saved. Its meeting place does not reserve a room; confirmation does not record arrival, attendance or completed work.', resulting_revision: visit.revision, domain_event_id: outbox.id, metadata: { id: visit.id, revision: visit.revision, action }, completed_at: visit.updated_at.toISOString() });
        const audience = action === 'changed' || action === 'cancelled' ? (await sql `
      SELECT DISTINCT candidate.user_id FROM(
        SELECT ${user.id}::uuid AS user_id UNION ALL
        SELECT endpoint.user_id FROM gate_visit_shares share
        JOIN campus_model_current_account_endpoints(${visit.school_id}::uuid,NULL,${visit.updated_at}::timestamptz) endpoint
          ON endpoint.person_id IN(share.organiser_person_id,share.owner_person_id)
        WHERE share.school_id=${visit.school_id}::uuid AND share.visit_id=${visit.id}::uuid
          AND NOT EXISTS(SELECT 1 FROM gate_visit_shares later WHERE later.school_id=share.school_id AND later.visit_id=share.visit_id AND later.revision>share.revision)
      ) candidate WHERE gate_visit_event_recipient_valid(${visit.school_id}::uuid,${JSON.stringify(payload)}::jsonb,candidate.user_id)`.execute(tx)).rows.map(row => row.user_id) : [user.id];
        await tx.insertInto('event_outbox').values({ school_id: visit.school_id, event_type: 'gate.visit_arrangement.updated', aggregate_type: 'gate_visit_arrangement', aggregate_id: visit.id, audience_user_ids: audience, payload, idempotency_key: `gate-visit-refresh:${command.command_id}`, created_at: visit.updated_at, notification_user_ids: [], notification_payload: null }).execute();
    }
    async create(user, school, raw) {
        const input = visitArrangementInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access(tx, user, school);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`gate-visit:${school}:${input.command_id}`},0))`.execute(tx);
            const existing = await tx.selectFrom('gate_visit_arrangements').selectAll().where('school_id', '=', school).where('id', '=', input.command_id).executeTakeFirst();
            const prepared = await this.prepare(tx, user, actor, { id: input.command_id, school_id: school, revision: existing?.revision ?? 0 }, 'arranged', input);
            if (prepared.replay)
                return this.detailIn(tx, await this.visit(tx, school, input.command_id));
            if (input.expected_revision !== 0 || existing)
                throw new ConflictException('This visit was already arranged. Open its current record.');
            await this.validateReferences(tx, school, input);
            const at = executionNow();
            const visit = await tx.insertInto('gate_visit_arrangements').values({ id: input.command_id, school_id: school, person_id: input.person_id, guest_name: input.guest_name, party_size: input.party_size, title: input.title, starts_at: new Date(input.starts_at), ends_at: new Date(input.ends_at), place_id: input.place_id, contact_person_id: input.contact_person_id, state: 'confirmed', revision: 1, created_by_person_id: actor.person_id, created_by_user_id: user.id, updated_by_person_id: actor.person_id, updated_by_user_id: user.id, created_at: at, updated_at: at, cancelled_at: null, last_movement_direction: null, last_movement_at: null, last_movement_count: null, last_movement_command_id: null, last_command_id: prepared.prepared.command_id, last_domain_event_id: null }).returningAll().executeTakeFirstOrThrow();
            await this.finish(tx, user, actor, visit, 'arranged', prepared.prepared, null);
            return this.detailIn(tx, await this.visit(tx, school, visit.id));
        });
    }
    async update(user, school, id, raw) {
        const input = visitArrangementInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access(tx, user, school), old = await this.visit(tx, school, id, true);
            const prepared = await this.prepare(tx, user, actor, old, 'changed', input);
            if (prepared.replay)
                return this.detailIn(tx, old);
            if (old.state !== 'confirmed')
                throw new UnprocessableEntityException('A cancelled visit cannot be changed. Arrange a new visit instead.');
            if (old.last_movement_command_id && (input.person_id !== old.person_id || input.guest_name !== old.guest_name))
                throw new UnprocessableEntityException('Arrival or departure was already recorded for this party. Arrange a separate visit for a different person or group.');
            await this.validateReferences(tx, school, input);
            const visit = await tx.updateTable('gate_visit_arrangements').set({ person_id: input.person_id, guest_name: input.guest_name, party_size: input.party_size, title: input.title, starts_at: new Date(input.starts_at), ends_at: new Date(input.ends_at), place_id: input.place_id, contact_person_id: input.contact_person_id, revision: old.revision + 1, updated_at: executionNow(), updated_by_person_id: actor.person_id, updated_by_user_id: user.id, last_command_id: prepared.prepared.command_id }).where('school_id', '=', school).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
            await this.finish(tx, user, actor, visit, 'changed', prepared.prepared, old.last_domain_event_id);
            return this.detailIn(tx, await this.visit(tx, school, id));
        });
    }
    async cancel(user, school, id, raw) {
        const input = visitCommand.strict().parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access(tx, user, school), old = await this.visit(tx, school, id, true);
            const prepared = await this.prepare(tx, user, actor, old, 'cancelled', input);
            if (prepared.replay)
                return this.detailIn(tx, old);
            if (old.state === 'cancelled')
                throw new UnprocessableEntityException('This visit is already cancelled.');
            const at = executionNow();
            const visit = await tx.updateTable('gate_visit_arrangements').set({ state: 'cancelled', cancelled_at: at, revision: old.revision + 1, updated_at: at, updated_by_person_id: actor.person_id, updated_by_user_id: user.id, last_command_id: prepared.prepared.command_id }).where('school_id', '=', school).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
            await this.finish(tx, user, actor, visit, 'cancelled', prepared.prepared, old.last_domain_event_id);
            return this.detailIn(tx, await this.visit(tx, school, id));
        });
    }
    async movement(user, school, id, raw) {
        const input = visitMovementInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access(tx, user, school), old = await this.visit(tx, school, id, true);
            const prepared = await this.prepare(tx, user, actor, old, 'movement_recorded', input);
            if (prepared.replay)
                return this.detailIn(tx, old);
            const at = executionNow(), observed = input.occurred_at ? new Date(input.occurred_at) : at;
            if (observed > at)
                throw new UnprocessableEntityException('An arrival or departure cannot be observed in the future.');
            if (old.last_movement_at && observed < old.last_movement_at)
                throw new UnprocessableEntityException('This visit has a later movement record. Review it before recording an earlier observation.');
            if (input.direction === 'in' && old.state === 'cancelled')
                throw new UnprocessableEntityException('A cancelled visit cannot receive a new arrival.');
            const visit = await tx.updateTable('gate_visit_arrangements').set({ last_movement_direction: input.direction, last_movement_at: observed, last_movement_count: input.observed_count, last_movement_command_id: prepared.prepared.command_id, revision: old.revision + 1, updated_at: at, updated_by_person_id: actor.person_id, updated_by_user_id: user.id, last_command_id: prepared.prepared.command_id }).where('school_id', '=', school).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
            await this.observations.recordObservations(tx, [{ school_id: school, captured_by: { kind: 'human', user_id: user.id }, kind: 'movement.visit_observed', subject: { kind: 'gate_visit_arrangement', domain: 'gate', domain_id: id, label: 'Campus visit', lifecycle_state: visit.state === 'cancelled' ? 'inactive' : 'active', source_revision: visit.revision, metadata: {} }, context: null, source_type: 'gate.arranged_visit', source_ref: id, source_record_id: prepared.prepared.command_id, observed_at: observed.toISOString(), received_at: at.toISOString(), evidence_refs: [`gate_visit_revision:${id}:${visit.revision}`], payload: { direction: input.direction, observed_count: input.observed_count, evidence_scope: 'campus_boundary', person_scope: visit.person_id && visit.party_size === 1 && input.observed_count === 1 ? 'named_person' : 'provisional_party', visit_id: id, revision: visit.revision }, schema_version: 1, state: 'accepted', idempotency_key: `gate-visit-observation:${prepared.prepared.command_id}`, domain_event_id: null }]);
            await this.finish(tx, user, actor, visit, 'movement_recorded', prepared.prepared, old.last_domain_event_id);
            return this.detailIn(tx, await this.visit(tx, school, id));
        });
    }
    confirmation(user, school, id, commandId) {
        z.uuid().parse(id);
        z.uuid().parse(commandId);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.access(tx, user, school), receipt = await this.retained(tx, user, school, commandId);
            if (!receipt)
                return { state: 'not_found' };
            if (receipt.actor_agent_id !== actor.agent_id || receipt.target.domain !== 'gate' || receipt.target.domain_id !== id)
                throw new ConflictException('This confirmation belongs to another visit.');
            if (receipt.state === 'pending')
                return { state: 'pending' };
            if (receipt.receipt.terminal_state !== 'accepted')
                return { state: 'not_accepted' };
            return { state: 'accepted', result: await this.detailIn(tx, await this.visit(tx, school, id)) };
        });
    }
};
VisitArrangementsService = __decorate([
    Injectable(),
    __param(1, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(2, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(3, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __param(4, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(5, Inject(OBSERVATION_INGRESS_PORT)),
    __metadata("design:paramtypes", [DatabaseService, Object, Object, Object, Object, Object])
], VisitArrangementsService);
export { VisitArrangementsService };
//# sourceMappingURL=visit-arrangements.service.js.map