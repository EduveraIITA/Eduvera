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
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { PLAN_OCCURRENCE_PORT } from '../campus-model-core/plan-occurrence.port.js';
import { activityOccurrenceId } from './activity-occurrence.engine.js';
/** Translation only. The owning event/examination command validates and commits. */
let OwnedPlanFootprintBridge = class OwnedPlanFootprintBridge {
    projections;
    constructor(projections) {
        this.projections = projections;
    }
    async record(tx, input) {
        const domain = input.source === 'event' ? 'events' : 'assessments';
        const contextKind = input.source === 'event' ? 'campus_event' : 'exam_sitting';
        const ids = [];
        const captured = [];
        for (const occurrence of input.occurrences) {
            const id = activityOccurrenceId(input.school_id, input.source, occurrence.source_id, occurrence.local_date);
            ids.push(id);
            const inserted = (await sql `INSERT INTO schedule_activity_occurrences(id,school_id,activity_id,period_id,source,source_ref,source_revision,
        title,purpose,local_date,starts_at,ends_at,timezone,space_id,attendance_mode,context_kind,context_ref,state)
        VALUES(${id}::uuid,${input.school_id}::uuid,${occurrence.source_id}::uuid,${occurrence.source_id}::uuid,${input.source},${occurrence.source_id},
          ${occurrence.source_revision},${occurrence.title},${input.source},${occurrence.local_date}::date,${occurrence.starts_at}::timestamptz,
          ${occurrence.ends_at}::timestamptz,${occurrence.timezone},${occurrence.space_id}::uuid,${occurrence.attendance_mode},${input.source},
          ${input.context_id}::uuid,${input.state}) ON CONFLICT(id) DO NOTHING RETURNING id`.execute(tx)).rows[0];
            if (inserted && occurrence.people.length) {
                // A person may be an organizer and attendee. Keep the attendance-bearing
                // role when both are declared; do not duplicate or change their identity.
                const people = new Map();
                for (const person of occurrence.people) {
                    const previous = people.get(person.person_id);
                    if (!previous || person.attendance_expected)
                        people.set(person.person_id, person);
                }
                await sql `INSERT INTO schedule_activity_occurrence_people(occurrence_id,school_id,person_id,label,participation_role,
          source_kind,source_ref,source_revision,person_revision,requirement,attendance_expected)
          SELECT ${id}::uuid,${input.school_id}::uuid,person_id,label,role,${input.source},source_ref,source_revision,person_revision,
            CASE WHEN required THEN 'required' ELSE 'optional' END,attendance_expected
          FROM jsonb_to_recordset(${JSON.stringify([...people.values()])}::jsonb) person(person_id uuid,label text,role text,source_ref text,
            source_revision integer,person_revision integer,required boolean,attendance_expected boolean)`.execute(tx);
            }
            const people = (await sql `SELECT person_id,label,person_revision,participation_role AS role,source_ref,source_revision,
        (requirement='required') AS required,attendance_expected FROM schedule_activity_occurrence_people
        WHERE school_id=${input.school_id}::uuid AND occurrence_id=${id}::uuid ORDER BY person_id,participation_role`.execute(tx)).rows;
            captured.push({ ...occurrence, people });
        }
        if (input.state === 'cancelled')
            await sql `UPDATE schedule_activity_occurrences SET state='cancelled',revision=revision+1
      WHERE school_id=${input.school_id}::uuid AND id=ANY(${ids}::uuid[]) AND state='expected'`.execute(tx);
        const resources = (await sql `SELECT id,name,revision FROM campus_spaces
      WHERE school_id=${input.school_id}::uuid AND id=ANY(${input.occurrences.flatMap(occurrence => occurrence.space_id ? [occurrence.space_id] : [])}::uuid[])`.execute(tx)).rows;
        const from = input.occurrences.map(occurrence => occurrence.starts_at).sort()[0] ?? input.occurred_at;
        const last = input.occurrences.map(occurrence => occurrence.ends_at).sort().at(-1) ?? input.occurred_at;
        const until = new Date(Math.max(Date.parse(last), Date.parse(from) + 1)).toISOString();
        const receipt = await this.projections.recordPlanOccurrences(tx, { school_id: input.school_id, actor_user_id: input.actor_user_id,
            plan: { kind: 'schedule', domain, domain_id: `${input.plan_id}:plan`, label: input.title, lifecycle_state: input.state === 'cancelled' ? 'inactive' : 'active', source_revision: input.revision, metadata: {} },
            source_revision: input.revision, event_type: `${domain}.plan_${input.state === 'cancelled' ? 'cancelled' : 'published'}`,
            occurred_at: input.occurred_at, correlation_id: input.correlation_id, causation_event_id: null, horizon: { from, until },
            occurrences: captured.map((occurrence, index) => ({ occurrence_key: ids[index],
                occurrence: { kind: 'schedule_occurrence', domain, domain_id: ids[index], label: occurrence.title, lifecycle_state: 'active', source_revision: input.revision, metadata: {} },
                local_date: occurrence.local_date, starts_at: occurrence.starts_at, ends_at: occurrence.ends_at, time_zone: occurrence.timezone,
                context: { kind: contextKind, domain, domain_id: input.context_entity_id ?? input.context_id, label: input.title, lifecycle_state: input.state === 'cancelled' ? 'inactive' : 'active', source_revision: input.revision, metadata: {} },
                participants: occurrence.people.map(person => ({ person: { kind: 'person', domain: 'people', domain_id: person.person_id, label: person.label.slice(0, 200),
                        lifecycle_state: 'active', source_revision: person.person_revision, metadata: {} }, role: person.role, required: person.required,
                    source_ref: person.source_ref, source_revision: person.source_revision })),
                resources: occurrence.space_id ? resources.filter(resource => resource.id === occurrence.space_id).map(resource => ({ kind: 'space', domain: 'campus_topology', domain_id: resource.id,
                    label: resource.name, lifecycle_state: 'active', source_revision: resource.revision, metadata: {} })) : [], state: input.state })) });
        return { ...receipt, occurrence_ids: ids };
    }
};
OwnedPlanFootprintBridge = __decorate([
    Injectable(),
    __param(0, Inject(PLAN_OCCURRENCE_PORT)),
    __metadata("design:paramtypes", [Object])
], OwnedPlanFootprintBridge);
export { OwnedPlanFootprintBridge };
//# sourceMappingURL=owned-plan-footprint.bridge.js.map