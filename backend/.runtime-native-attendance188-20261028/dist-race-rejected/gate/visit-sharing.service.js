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
import { sql } from 'kysely';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service.js';
import { executionEnvironmentStorage, executionNow } from '../campus-model-core/execution-time.runtime.js';
import { HUMAN_AGENT_IDENTITY_PORT } from '../campus-model-core/human-agent-identity.port.js';
import { hasScopedSchoolPermission } from '../roles/authorization.js';
import { readVisitInvitation } from '../operations/person-work-invitation-read.js';
import { sharedVisitHref, sharedVisitListInput, visitShareInput, visitSharingCommand, visitQuestionInput, visitQuestionReplyInput } from './visit-sharing.contracts.js';
import { VisitSharingModel, visitSharingHash } from './visit-sharing.model.js';
const iso = (value) => new Date(value).toISOString();
const label = (first, last) => `${first} ${last}`.trim();
let VisitSharingService = class VisitSharingService {
    db;
    identities;
    model;
    constructor(db, identities, model) {
        this.db = db;
        this.identities = identities;
        this.model = model;
    }
    async actor(tx, user, school) {
        z.uuid().parse(school);
        const environment = executionEnvironmentStorage.getStore();
        if (!user.is_active || user.active_school_id !== school || environment?.institution_id && environment.institution_id !== school)
            throw new ForbiddenException('Select this campus and its current world before opening the visit.');
        const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: school, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new ForbiddenException('Current canonical campus app access is required.');
        return actor;
    }
    manages(tx, user, school) { return hasScopedSchoolPermission(tx, user, school, 'gate.manage', 'institution', school); }
    async manager(tx, user, school) {
        const actor = await this.actor(tx, user, school);
        if (!await this.manages(tx, user.id, school))
            throw new ForbiddenException('Manage In & Out permission is required to share or coordinate visits.');
        return actor;
    }
    async visit(tx, school, id, lock = false) {
        z.uuid().parse(id);
        let query = tx.selectFrom('gate_visit_arrangements').selectAll().where('school_id', '=', school).where('id', '=', id);
        if (lock)
            query = query.forUpdate();
        const row = await query.executeTakeFirst();
        if (!row)
            throw new NotFoundException('This visit is unavailable in the selected campus.');
        return row;
    }
    head(tx, school, visit) {
        return tx.selectFrom('gate_visit_shares').selectAll().where('school_id', '=', school).where('visit_id', '=', visit).orderBy('revision', 'desc').limit(1).executeTakeFirst();
    }
    question(tx, share) {
        return tx.selectFrom('gate_visit_questions').selectAll().where('school_id', '=', share.school_id).where('share_root_id', '=', share.root_id).executeTakeFirst();
    }
    async unbroken(tx, share) {
        return Boolean((await sql `SELECT gate_visit_share_party_valid(${share.school_id}::uuid,${share.id}::uuid) AS valid`.execute(tx)).rows[0]?.valid);
    }
    async valid(tx, share) {
        return Boolean((await sql `SELECT gate_visit_share_current(${share.school_id}::uuid,${share.visit_id}::uuid,${share.organiser_person_id}::uuid,${executionNow()}::timestamptz) AS valid`.execute(tx)).rows[0]?.valid);
    }
    async person(tx, school, id, revision) {
        const row = (await sql `SELECT id,first_name,last_name,revision FROM school_people
      WHERE school_id=${school}::uuid AND id=${id}::uuid AND retired_at IS NULL FOR SHARE`.execute(tx)).rows[0];
        if (!row)
            throw new UnprocessableEntityException('Choose a current canonical campus person.');
        if (revision !== undefined && revision !== row.revision)
            throw new ConflictException('This organiser changed. Select their current profile again.');
        return { id: row.id, label: label(row.first_name, row.last_name), revision: row.revision };
    }
    async owner(tx, share) {
        const person = await tx.selectFrom('school_people').select(['first_name', 'last_name']).where('school_id', '=', share.school_id).where('id', '=', share.owner_person_id).executeTakeFirstOrThrow();
        const endpoint = await this.identities.resolvePersonAgent(tx, { school_id: share.school_id, person_id: share.owner_person_id, at: executionNow().toISOString() });
        const available = endpoint.acting && await this.manages(tx, endpoint.user_id, share.school_id);
        return { id: share.owner_person_id, label: label(person.first_name, person.last_name), available: Boolean(available),
            user_id: endpoint.acting && available ? endpoint.user_id : null };
    }
    async safeVisit(tx, visit) {
        const place = (await sql `SELECT space.id,space.name AS label,space.kind,campus.name AS campus_label
      FROM campus_spaces space JOIN institution_campuses campus ON campus.id=space.campus_id AND campus.school_id=space.school_id
      WHERE space.school_id=${visit.school_id}::uuid AND space.id=${visit.place_id}::uuid`.execute(tx)).rows[0];
        const people = await tx.selectFrom('school_people').select(['id', 'first_name', 'last_name']).where('school_id', '=', visit.school_id)
            .where('id', 'in', [visit.contact_person_id, ...(visit.person_id ? [visit.person_id] : [])]).execute();
        const contact = people.find(person => person.id === visit.contact_person_id);
        const guest = people.find(person => person.id === visit.person_id);
        return { id: visit.id, revision: visit.revision, title: visit.title, guest_label: guest ? label(guest.first_name, guest.last_name) : visit.guest_name,
            party_size: visit.party_size, starts_at: iso(visit.starts_at), ends_at: iso(visit.ends_at), state: visit.state, place,
            contact: { label: label(contact.first_name, contact.last_name) } };
    }
    async reader(tx, user, school, visit) {
        const actor = await this.actor(tx, user, school), share = await this.head(tx, school, visit.id);
        if (!share || !await this.valid(tx, share))
            throw new NotFoundException('This shared visit is no longer available. Ask the campus contact to review its access.');
        const owner = await this.owner(tx, share);
        const organiser = actor.person_id === share.organiser_person_id;
        const answering = actor.person_id === share.owner_person_id && owner.available;
        if (!organiser && !answering)
            throw new ForbiddenException('Only this organiser and the current question owner can open its private shared view.');
        return { actor, share, owner, organiser, answering };
    }
    async sharedIn(tx, user, school, visit) {
        const permission = await this.reader(tx, user, school, visit), { share, owner, organiser, answering } = permission;
        const campus = await tx.selectFrom('schools').select('timezone').where('id', '=', school).executeTakeFirstOrThrow();
        const question = await this.question(tx, share);
        const versions = await tx.selectFrom('gate_visit_arrangement_revisions').select(['revision', 'action', 'recorded_at', 'snapshot', 'place_label', 'contact_label'])
            .where('school_id', '=', school).where('visit_id', '=', visit.id).where('revision', '>', share.baseline_visit_revision)
            .where('action', '!=', 'movement_recorded').orderBy('revision', 'desc').limit(26).execute();
        const entries = question ? await tx.selectFrom('gate_visit_question_entries').select(['id', 'action', 'note', 'actor_label', 'recorded_at'])
            .where('school_id', '=', school).where('question_id', '=', question.id).where('action', 'in', ['asked', 'replied']).orderBy('revision', 'desc').limit(51).execute() : [];
        return { timezone: campus.timezone, visit: await this.safeVisit(tx, visit),
            share: { id: share.id, root_id: share.root_id, revision: share.revision, starts_at: iso(share.starts_at), ends_at: iso(share.ends_at), directions: share.directions,
                owner: { label: owner.label, available: owner.available }, can_ask: organiser && owner.available, can_reply: answering && question?.state === 'waiting_for_review' },
            changes: versions.slice(0, 25).map(version => {
                const source = version.snapshot;
                return { revision: version.revision, action: version.action,
                    recorded_at: iso(version.recorded_at), title: source.title, starts_at: iso(source.starts_at), ends_at: iso(source.ends_at),
                    state: source.state, party_size: source.party_size, place_label: version.place_label, contact_label: version.contact_label };
            }),
            changes_has_more: versions.length > 25,
            question: question ? { id: question.id, revision: question.revision, state: question.state,
                entries: entries.slice(0, 50).reverse().map(entry => ({ id: entry.id, kind: entry.action === 'asked' ? 'question' : 'reply',
                    note: entry.note, recorded_at: iso(entry.recorded_at), author: entry.action === 'asked' ? 'organiser' : 'campus', author_label: entry.actor_label })),
                entries_has_more: entries.length > 50 } : null };
    }
    sharedDetail(user, school, id) {
        return this.db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => this.sharedIn(tx, user, school, await this.visit(tx, school, id)));
    }
    async managementIn(tx, user, visit) {
        const actor = await this.manager(tx, user, visit.school_id), share = await this.head(tx, visit.school_id, visit.id);
        if (!share)
            return { visit_revision: visit.revision, share_revision: 0, can_share: true, can_open_shared: false, current: null };
        const owner = await this.owner(tx, share), party = await this.unbroken(tx, share), valid = await this.valid(tx, share);
        // Historical metadata remains operable after a person is retired. Only a
        // newly selected/reviewed recipient uses the current-person validator.
        const retained = (await sql `
      SELECT id,first_name,last_name,revision,retired_at FROM school_people
      WHERE school_id=${visit.school_id}::uuid AND id=${share.organiser_person_id}::uuid`.execute(tx)).rows[0];
        const organiser = { id: retained.id, label: label(retained.first_name, retained.last_name), revision: retained.revision };
        const states = await this.identities.listPersonAccountStates(tx, { school_id: visit.school_id, person_ids: [organiser.id], at: executionNow().toISOString() });
        const canOpen = valid && (actor.person_id === share.organiser_person_id || actor.person_id === share.owner_person_id && owner.available);
        return { visit_revision: visit.revision, share_revision: share.revision, can_share: true, can_open_shared: canOpen,
            current: { id: share.id, root_id: share.root_id, revision: share.revision, organiser: { ...organiser, has_app_access: retained.retired_at === null && states[0]?.account_state === 'active' },
                starts_at: iso(share.starts_at), ends_at: iso(share.ends_at), directions: share.directions,
                state: !party ? 'party_changed' : share.status === 'revoked' ? 'revoked' : valid ? 'active' : 'expired',
                owner: { id: owner.id, label: owner.label, available: owner.available }, can_renew: true, can_revoke: share.status === 'granted',
                can_takeover: valid && !owner.available,
                invitation: actor.person_id === share.owner_person_id && owner.available ? await readVisitInvitation(tx, { school_id: visit.school_id, visit_id: visit.id, share_id: share.id, person_id: organiser.id }) : null } };
    }
    management(user, school, id) {
        return this.db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => this.managementIn(tx, user, await this.visit(tx, school, id)));
    }
    shareSource(visit, share) {
        return { school_id: visit.school_id, visit_id: visit.id, id: visit.id, revision: share?.revision ?? 0, kind: 'share', last_event_id: share?.domain_event_id ?? null };
    }
    commitment(share) {
        return { share_id: share.id, root_id: share.root_id, organiser_person_id: share.organiser_person_id, organiser_person_revision: share.organiser_person_revision,
            party_person_id: share.party_person_id, party_guest_name_hash: share.party_guest_name === null ? null : visitSharingHash(share.party_guest_name), baseline_visit_revision: share.baseline_visit_revision,
            owner_person_id: share.owner_person_id, starts_at: share.starts_at.toISOString(), ends_at: share.ends_at.toISOString(), directions_hash: visitSharingHash(share.directions),
            status: share.status, previous_share_id: share.previous_share_id };
    }
    async audience(tx, share) {
        const rows = (await sql `SELECT endpoint.user_id FROM campus_model_current_account_endpoints(${share.school_id}::uuid,NULL,${executionNow()}::timestamptz) endpoint
      WHERE endpoint.person_id IN(${share.organiser_person_id}::uuid,${share.owner_person_id}::uuid)`.execute(tx)).rows;
        return rows.map(row => row.user_id);
    }
    async share(user, school, id, raw) {
        const input = visitShareInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.manager(tx, user, school), visit = await this.visit(tx, school, id, true), old = await this.head(tx, school, id);
            const person = await this.person(tx, school, input.organiser_person_id, input.organiser_person_revision);
            const same = old && old.organiser_person_id === person.id && await this.unbroken(tx, old);
            const retained = await this.model.retained(tx, user, school, input.command_id);
            const action = retained?.command_type === 'gate.visit_share.shared' ? 'shared'
                : retained?.command_type === 'gate.visit_share.renewed' ? 'renewed' : same ? 'renewed' : 'shared', at = executionNow();
            const body = { id: input.command_id, school_id: school, visit_id: id, root_id: same ? old.root_id : input.command_id, revision: (old?.revision ?? 0) + 1,
                organiser_person_id: person.id, organiser_person_revision: person.revision, party_person_id: visit.person_id, party_guest_name: visit.guest_name,
                baseline_visit_revision: same ? old.baseline_visit_revision : visit.revision, owner_person_id: same ? old.owner_person_id : actor.person_id,
                starts_at: at, ends_at: new Date(input.ends_at), directions: input.directions, status: 'granted', action,
                previous_share_id: old?.id ?? null, actor_person_id: actor.person_id, actor_user_id: user.id, recorded_at: at };
            const source = { ...this.shareSource(visit, old), at: at.toISOString() }, prepared = await this.model.prepare(tx, user, actor, source, action, input, 'gate.manage', { visit_id: id, permission: 'gate.manage', organiser_person_id: person.id }, this.commitment(body), null);
            if (prepared.replay)
                return this.managementIn(tx, user, visit);
            if (visit.revision !== input.expected_visit_revision)
                throw new ConflictException('This visit plan changed. Review its current details before sharing.');
            if (body.ends_at <= at)
                throw new UnprocessableEntityException('Choose an access end after the current time.');
            const data = { visit_id: id, share_id: body.id, root_id: body.root_id, question_id: null, revision: body.revision, action };
            const event = await this.model.event(tx, user, source, data, prepared.prepared);
            const share = await tx.insertInto('gate_visit_shares').values({ ...body, command_id: prepared.prepared.command_id, domain_event_id: event.event_id }).returningAll().executeTakeFirstOrThrow();
            if (old) {
                const question = await this.question(tx, old);
                if (question?.state === 'waiting_for_review') {
                    if (!same)
                        await this.reconcileQuestion(tx, user, actor, old, question, input.command_id, 'withdrawn');
                    else if (!await this.validAtPrevious(tx, old, at) && (await this.owner(tx, share)).available)
                        await this.reconcileQuestion(tx, user, actor, share, question, input.command_id, 'rerouted');
                }
            }
            await this.model.complete(tx, user, source, data, prepared.prepared, event.outbox_id, [...await this.audience(tx, share), user.id]);
            return this.managementIn(tx, user, visit);
        });
    }
    async validAtPrevious(tx, share, at) {
        return share.status === 'granted' && share.starts_at <= at && share.ends_at > at && await this.unbroken(tx, share);
    }
    async revoke(user, school, id, shareId, raw) { return this.changeShare(user, school, id, shareId, raw, 'revoked'); }
    async takeover(user, school, id, shareId, raw) { return this.changeShare(user, school, id, shareId, raw, 'taken_over'); }
    async changeShare(user, school, id, shareId, raw, action) {
        z.uuid().parse(shareId);
        const input = visitSharingCommand.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.manager(tx, user, school), visit = await this.visit(tx, school, id, true), old = await this.head(tx, school, id);
            if (!old)
                throw new NotFoundException('This visit has no sharing arrangement.');
            const at = executionNow(), source = { ...this.shareSource(visit, old), at: at.toISOString() };
            const body = { ...old, id: input.command_id, revision: old.revision + 1, previous_share_id: old.id, action,
                status: action === 'revoked' ? 'revoked' : old.status, owner_person_id: action === 'taken_over' ? actor.person_id : old.owner_person_id,
                actor_person_id: actor.person_id, actor_user_id: user.id, recorded_at: at };
            const prepared = await this.model.prepare(tx, user, actor, source, action, { ...input, share_id: shareId }, 'gate.manage', { visit_id: id, share_id: shareId, permission: 'gate.manage' }, this.commitment(body), null);
            if (prepared.replay)
                return this.managementIn(tx, user, visit);
            if (old.id !== shareId)
                throw new ConflictException('This sharing version changed. Review the current access.');
            if (old.status !== 'granted')
                throw new UnprocessableEntityException('This sharing access is already revoked.');
            if (action === 'taken_over' && ((await this.owner(tx, old)).available || !await this.valid(tx, old)))
                throw new ForbiddenException('Take over only while access is available, the retained question owner is unavailable and the same visit party remains.');
            const data = { visit_id: id, share_id: body.id, root_id: body.root_id, question_id: null, revision: body.revision, action };
            const event = await this.model.event(tx, user, source, data, prepared.prepared);
            const share = await tx.insertInto('gate_visit_shares').values({ ...body, command_id: prepared.prepared.command_id, domain_event_id: event.event_id }).returningAll().executeTakeFirstOrThrow();
            const question = await this.question(tx, old);
            if (question?.state === 'waiting_for_review')
                await this.reconcileQuestion(tx, user, actor, share, question, input.command_id, action === 'revoked' ? 'withdrawn' : 'rerouted');
            await this.model.complete(tx, user, source, data, prepared.prepared, event.outbox_id, [...await this.audience(tx, old), ...await this.audience(tx, share), user.id]);
            return this.managementIn(tx, user, visit);
        });
    }
    async saveQuestionEntry(tx, user, actor, source, share, old, action, note, command, event, owner) {
        const at = source.at ? new Date(source.at) : executionNow(), values = { id: source.id, school_id: source.school_id, visit_id: source.visit_id, share_root_id: share.root_id,
            organiser_person_id: share.organiser_person_id, owner_person_id: owner, revision: source.revision + 1,
            state: action === 'replied' ? 'answered' : action === 'withdrawn' ? 'withdrawn' : 'waiting_for_review',
            created_at: old?.created_at ?? at, updated_at: at, last_command_id: command.command_id, last_domain_event_id: event.event_id,
            coordination_receipt: event.receipt ?? old?.coordination_receipt ?? null };
        if (old)
            await tx.updateTable('gate_visit_questions').set(values).where('school_id', '=', source.school_id).where('id', '=', source.id).execute();
        else
            await tx.insertInto('gate_visit_questions').values(values).execute();
        await sql `INSERT INTO gate_visit_question_entries(id,school_id,visit_id,question_id,revision,share_id,action,note,actor_person_id,actor_user_id,actor_label,command_id,domain_event_id,recorded_at,snapshot)
      SELECT ${command.command_id}::uuid,question.school_id,question.visit_id,question.id,question.revision,${share.id}::uuid,${action},${note},${actor.person_id}::uuid,${user.id}::uuid,${actor.label},${command.command_id}::uuid,${event.event_id}::uuid,${at}::timestamptz,to_jsonb(question)
      FROM gate_visit_questions question WHERE question.school_id=${source.school_id}::uuid AND question.id=${source.id}::uuid`.execute(tx);
    }
    async reconcileQuestion(tx, user, actor, share, question, commandId, action) {
        const owner = await this.owner(tx, share);
        const actualAction = action === 'rerouted' && (!owner.available || !await this.valid(tx, share)) ? 'withdrawn' : action;
        const source = { school_id: share.school_id, visit_id: share.visit_id, id: question.id, revision: question.revision, kind: 'question', last_event_id: question.last_domain_event_id, at: executionNow().toISOString() };
        const input = { command_id: `${commandId}:${actualAction}`, expected_revision: question.revision, share_id: share.id };
        const commitment = { question_id: question.id, share_id: share.id, share_root_id: question.share_root_id, note_hash: visitSharingHash(''), owner_person_id: share.owner_person_id };
        const prepared = await this.model.prepare(tx, user, actor, source, actualAction, input, 'gate.manage', { visit_id: share.visit_id, share_id: share.id, permission: 'gate.manage' }, commitment, null);
        if (prepared.replay)
            return;
        const route = actualAction === 'rerouted' ? await this.model.configureQuestion(tx, user, { ...source, revision: source.revision + 1 }, question.id, { person_id: share.owner_person_id, user_id: owner.user_id }, 'gate.manage', share.id, null, 'gate.visit_question.rerouted') : undefined;
        const data = { visit_id: share.visit_id, share_id: share.id, root_id: question.share_root_id, question_id: question.id, revision: question.revision + 1, action: actualAction };
        const event = await this.model.event(tx, user, source, data, prepared.prepared, route);
        await this.model.closePrevious(tx, user, source, question.coordination_receipt, event, prepared.prepared, 'gate.manage', false);
        await this.saveQuestionEntry(tx, user, actor, source, share, question, actualAction, '', prepared.prepared, event, share.owner_person_id);
        await this.model.complete(tx, user, source, data, prepared.prepared, event.outbox_id, [...await this.audience(tx, share), user.id]);
    }
    async ask(user, school, id, raw) {
        const input = visitQuestionInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const visit = await this.visit(tx, school, id, true), permission = await this.reader(tx, user, school, visit), { actor, share, owner } = permission;
            if (!permission.organiser)
                throw new ForbiddenException('Only the exact organiser can ask this private visit question.');
            const old = await this.question(tx, share), questionId = old?.id ?? input.command_id;
            const source = { school_id: school, visit_id: id, id: questionId, revision: old?.revision ?? 0, kind: 'question', last_event_id: old?.last_domain_event_id ?? null, at: executionNow().toISOString() };
            const prepared = await this.model.prepare(tx, user, actor, source, 'asked', input, 'gate.visit.question.ask', { visit_id: id, share_id: share.id, organiser_person_id: actor.person_id }, { question_id: questionId, share_id: share.id, share_root_id: share.root_id, note_hash: visitSharingHash(input.note), owner_person_id: share.owner_person_id }, iso(share.ends_at));
            if (prepared.replay)
                return this.sharedIn(tx, user, school, visit);
            if (input.share_id !== share.id)
                throw new ConflictException('This visit sharing version changed. Review the current plan before sending.');
            if (!owner.available)
                throw new UnprocessableEntityException('The campus question contact is unavailable. Your question was not sent; ask the campus to restore its coordinator.');
            const route = await this.model.configureQuestion(tx, user, { ...source, revision: source.revision + 1 }, questionId, { person_id: share.owner_person_id, user_id: owner.user_id }, 'gate.visit.question.ask', share.id, iso(share.ends_at));
            const data = { visit_id: id, share_id: share.id, root_id: share.root_id, question_id: questionId, revision: source.revision + 1, action: 'asked' };
            const event = await this.model.event(tx, user, source, data, prepared.prepared, route);
            if (old?.state === 'waiting_for_review')
                await this.model.closePrevious(tx, user, source, old.coordination_receipt, event, prepared.prepared, 'gate.visit.question.ask', false);
            await this.saveQuestionEntry(tx, user, actor, source, share, old, 'asked', input.note, prepared.prepared, event, share.owner_person_id);
            await this.model.complete(tx, user, source, data, prepared.prepared, event.outbox_id, [user.id, owner.user_id]);
            return this.sharedIn(tx, user, school, visit);
        });
    }
    async reply(user, school, id, questionId, raw) {
        z.uuid().parse(questionId);
        const input = visitQuestionReplyInput.parse(raw);
        return this.db.transaction().execute(async (tx) => {
            const visit = await this.visit(tx, school, id, true), permission = await this.reader(tx, user, school, visit), { actor, share, owner } = permission;
            if (!permission.answering)
                throw new ForbiddenException('Only the current exact question owner can answer this private question.');
            const question = await this.question(tx, share);
            if (!question || question.id !== questionId)
                throw new NotFoundException('This question is unavailable in the current sharing context.');
            const source = { school_id: school, visit_id: id, id: question.id, revision: question.revision, kind: 'question', last_event_id: question.last_domain_event_id, at: executionNow().toISOString() };
            const prepared = await this.model.prepare(tx, user, actor, source, 'replied', { ...input, question_id: questionId }, 'gate.visit.question.reply', { visit_id: id, share_id: share.id, owner_person_id: actor.person_id }, { question_id: questionId, share_id: share.id, share_root_id: share.root_id, note_hash: visitSharingHash(input.note), owner_person_id: actor.person_id }, null);
            if (prepared.replay)
                return this.sharedIn(tx, user, school, visit);
            if (question.state !== 'waiting_for_review' || question.owner_person_id !== actor.person_id)
                throw new ConflictException('This question is not waiting for your answer.');
            const data = { visit_id: id, share_id: share.id, root_id: share.root_id, question_id: questionId, revision: question.revision + 1, action: 'replied' };
            const event = await this.model.event(tx, user, source, data, prepared.prepared);
            await this.model.closePrevious(tx, user, source, question.coordination_receipt, event, prepared.prepared, 'gate.visit.question.reply', true);
            await this.saveQuestionEntry(tx, user, actor, source, share, question, 'replied', input.note, prepared.prepared, event, actor.person_id);
            await this.model.complete(tx, user, source, data, prepared.prepared, event.outbox_id, [...await this.audience(tx, share), owner.user_id]);
            return this.sharedIn(tx, user, school, visit);
        });
    }
    confirmation(user, school, id, command) {
        z.uuid().parse(id);
        z.uuid().parse(command);
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.actor(tx, user, school), receipt = await this.model.retained(tx, user, school, command);
            if (!receipt)
                return { state: 'not_found' };
            if (receipt.actor_agent_id !== actor.agent_id || receipt.safe_context.visit_id !== id)
                throw new ConflictException('This command belongs to another visit or actor.');
            return receipt.state === 'pending' ? { state: 'pending' } : receipt.receipt.terminal_state !== 'accepted' ? { state: 'not_accepted' }
                : { state: 'accepted', result: receipt.receipt.metadata };
        });
    }
    async sharedWorkspace(user, school, raw = {}) {
        const input = sharedVisitListInput.parse(raw);
        return this.db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
            const actor = await this.actor(tx, user, school), at = executionNow();
            const filter = sql `(share.organiser_person_id=${actor.person_id}::uuid OR share.owner_person_id=${actor.person_id}::uuid AND gate_visit_actor_can_manage(share.school_id,${user.id}::uuid)) AND gate_visit_share_current(share.school_id,share.visit_id,share.organiser_person_id,${at}::timestamptz)
        AND NOT EXISTS(SELECT 1 FROM gate_visit_shares later WHERE later.school_id=share.school_id AND later.visit_id=share.visit_id AND later.revision>share.revision)`;
            const rows = (await sql `SELECT visit.* FROM gate_visit_arrangements visit JOIN gate_visit_shares share ON share.school_id=visit.school_id AND share.visit_id=visit.id
        WHERE visit.school_id=${school}::uuid AND ${filter} ORDER BY visit.starts_at,visit.id LIMIT 10 OFFSET ${(input.page - 1) * 10}`.execute(tx)).rows;
            const total = (await sql `SELECT count(*)::int AS count FROM gate_visit_shares share WHERE share.school_id=${school}::uuid AND ${filter}`.execute(tx)).rows[0].count;
            const campus = await tx.selectFrom('schools').select('timezone').where('id', '=', school).executeTakeFirstOrThrow();
            return { visits: await Promise.all(rows.map(visit => this.safeVisit(tx, visit))), timezone: campus.timezone,
                pagination: { page: input.page, page_size: 10, total, total_pages: Math.ceil(total / 10) } };
        });
    }
    async discovery(user, school) {
        try {
            return await this.db.transaction().execute(async (tx) => {
                const actor = await this.actor(tx, user, school), can_manage = await this.manages(tx, user.id, school);
                const own = (await sql `SELECT 1 FROM gate_visit_shares share WHERE share.school_id=${school}::uuid AND share.organiser_person_id=${actor.person_id}::uuid
        AND gate_visit_share_current(share.school_id,share.visit_id,share.organiser_person_id,${executionNow()}::timestamptz) LIMIT 1`.execute(tx)).rows.length > 0;
                const questions = can_manage && (await sql `SELECT 1 FROM gate_visit_questions question
        JOIN LATERAL(SELECT * FROM gate_visit_shares candidate WHERE candidate.school_id=question.school_id AND candidate.visit_id=question.visit_id ORDER BY candidate.revision DESC LIMIT 1) share ON share.root_id=question.share_root_id
        WHERE question.school_id=${school}::uuid AND question.state='waiting_for_review'
          AND gate_visit_share_current(share.school_id,share.visit_id,share.organiser_person_id,${executionNow()}::timestamptz)
          AND(share.owner_person_id=${actor.person_id}::uuid OR NOT gate_visit_share_owner_available(share.school_id,share.id,${executionNow()}::timestamptz)) LIMIT 1`.execute(tx)).rows.length > 0;
                return { can_manage, has_shared: own, has_questions: Boolean(questions) };
            });
        }
        catch (error) {
            if (error instanceof ForbiddenException)
                return { can_manage: false, has_shared: false, has_questions: false };
            throw error;
        }
    }
    async work(user, school) {
        try {
            return await this.db.transaction().execute(async (tx) => {
                const actor = await this.actor(tx, user, school), manager = await this.manages(tx, user.id, school), at = executionNow();
                const questions = (await sql `
        SELECT question.id,question.visit_id,question.share_root_id,question.revision,question.created_at,question.coordination_receipt,
          share.owner_person_id,share.organiser_person_id,btrim(concat(owner.first_name,' ',owner.last_name)) AS owner_label,endpoint.user_id AS owner_user_id
        FROM gate_visit_questions question
        JOIN LATERAL(SELECT * FROM gate_visit_shares candidate WHERE candidate.school_id=question.school_id AND candidate.visit_id=question.visit_id ORDER BY candidate.revision DESC LIMIT 1) share ON share.root_id=question.share_root_id
        JOIN school_people owner ON owner.school_id=share.school_id AND owner.id=share.owner_person_id
        LEFT JOIN LATERAL(SELECT candidate.user_id FROM campus_model_current_account_endpoints(${school}::uuid,NULL,${at}::timestamptz) candidate
          WHERE candidate.person_id=share.owner_person_id AND gate_visit_actor_can_manage(${school}::uuid,candidate.user_id)) endpoint ON true
        WHERE question.school_id=${school}::uuid AND question.state='waiting_for_review'
          AND gate_visit_share_current(share.school_id,share.visit_id,share.organiser_person_id,${at}::timestamptz)
          AND(share.organiser_person_id=${actor.person_id}::uuid OR ${manager} AND(share.owner_person_id=${actor.person_id}::uuid
            OR endpoint.user_id IS NULL))
        ORDER BY question.created_at,question.id`.execute(tx)).rows;
                const needs_me = [], waiting = [];
                for (const question of questions) {
                    const available = question.owner_user_id !== null;
                    const record = { id: question.id, visit_id: question.visit_id, share_root_id: question.share_root_id, revision: question.revision,
                        title: 'Visit question', state: available ? 'review_needed' : 'needs_reassignment', href: available ? sharedVisitHref(question.visit_id) : `/areas/in-out/visits?visit=${question.visit_id}`,
                        created_at: iso(question.created_at), message_id: question.coordination_receipt?.message_id ?? null,
                        owner: { user_id: question.owner_user_id, label: question.owner_label }, action: available ? 'reply' : 'recover' };
                    if (manager && (actor.person_id === question.owner_person_id || !available))
                        needs_me.push(record);
                    if (actor.person_id === question.organiser_person_id)
                        waiting.push({ ...record, state: available ? 'waiting_for_review' : 'needs_reassignment' });
                }
                return { needs_me, waiting };
            });
        }
        catch (error) {
            if (error instanceof ForbiddenException)
                return { needs_me: [], waiting: [] };
            throw error;
        }
    }
};
VisitSharingService = __decorate([
    Injectable(),
    __param(1, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __metadata("design:paramtypes", [DatabaseService, Object, VisitSharingModel])
], VisitSharingService);
export { VisitSharingService };
//# sourceMappingURL=visit-sharing.service.js.map