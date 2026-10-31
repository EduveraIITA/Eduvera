import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { registerCreatedPerson } from './person-attachment.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { ConflictException } from '@nestjs/common';
export async function saveValidatedImport(db, events, req, job, review, model, attendance) {
    if (review.registers.length && (!model || !attendance))
        throw new ConflictException('The canonical enrollment roster service and current People command are required.');
    const included = review.rows.filter(r => r.decision === 'include').map(r => r.normalized);
    const groups = new Map();
    for (const row of included)
        if (row.guardian_choice.mode === 'new' && !groups.has(row.guardian_group))
            groups.set(row.guardian_group, { id: randomUUID(), person_id: randomUUID(), first_name: row.guardian_first_name, last_name: row.guardian_last_name, phone: row.guardian_phone, email: row.guardian_email });
    const guardians = [...groups.values()];
    const guardianPeople = new Map();
    let createdGuardianProfiles = guardians.length;
    const reusedGuardianProfiles = new Set(included.flatMap(row => row.guardian_choice.mode === 'existing' ? [row.guardian_choice.id] : []));
    for (const row of included)
        if (row.guardian_choice.mode === 'person' && !guardianPeople.has(row.guardian_choice.person_id)) {
            const personId = row.guardian_choice.person_id;
            const existing = await db.selectFrom('guardian_school_profiles').select('guardian_id').where('school_id', '=', job.school_id).where('person_id', '=', personId).executeTakeFirst();
            if (existing) {
                guardianPeople.set(personId, existing.guardian_id);
                reusedGuardianProfiles.add(existing.guardian_id);
            }
            else {
                const parent = await db.insertInto('parents').values({ user_id: null }).returning('id').executeTakeFirstOrThrow();
                await db.insertInto('guardian_school_profiles').values({ school_id: job.school_id, guardian_id: parent.id, person_id: personId }).execute();
                guardianPeople.set(personId, parent.id);
                createdGuardianProfiles++;
            }
        }
    const students = included.map(row => ({ ...row, id: randomUUID(), person_id: row.person?.id ?? randomUUID(), guardian_id: row.guardian_choice.mode === 'existing' ? row.guardian_choice.id
            : row.guardian_choice.mode === 'person' ? guardianPeople.get(row.guardian_choice.person_id) : row.guardian_choice.mode === 'none' ? null : groups.get(row.guardian_group).id }));
    const newPeople = [
        ...students.filter(s => !s.person).map(s => ({ id: s.person_id, school_id: job.school_id, first_name: s.first_name, last_name: s.last_name, contact_phone: "", contact_email: "" })),
        ...guardians.map(g => ({ id: g.person_id, school_id: job.school_id, first_name: g.first_name, last_name: g.last_name, contact_phone: g.phone, contact_email: g.email })),
    ];
    if (newPeople.length)
        await db.insertInto("school_people").values(newPeople).execute();
    if (model)
        for (const person of newPeople)
            await registerCreatedPerson(db, model.ports, { school_id: job.school_id, actor_id: req.authUser.id, person,
                correlation_id: job.id, command_id: model.prepared.command_id, key: `people-import:${job.id}:new:${person.id}` });
    if (guardians.length) {
        await db.insertInto("parents").values(guardians.map(g => ({ id: g.id, user_id: null }))).execute();
        await db.insertInto("guardian_school_profiles").values(guardians.map(g => ({ school_id: job.school_id, guardian_id: g.id, person_id: g.person_id }))).execute();
    }
    await db.insertInto("students").values(students.map(s => ({ id: s.id, school_id: job.school_id, person_id: s.person_id, user_id: null, admission_number: s.admission_number, date_of_birth: s.date_of_birth, blood_group: null, emergency_contact: null }))).execute();
    const relationships = students.flatMap(s => s.guardian_id ? [{ student_id: s.id, guardian_id: s.guardian_id, relationship: s.relationship, is_primary: true, can_authorize_leave: false }] : []);
    if (relationships.length)
        await db.insertInto("guardian_relationships").values(relationships).execute();
    await db.insertInto("enrollments").values(students.map(s => ({ student_id: s.id, class_section_id: s.class_section_id, term_id: job.term_id, roll_number: s.roll_number, enrolled_on: s.enrolled_on }))).execute();
    // Retain the exact reviewed row -> actual created learner before the kernel
    // validates its pending People command. The job stays draft until all effects
    // (including canonical roster reconciliation) commit atomically.
    await sql `UPDATE people_import_rows r SET student_id=x.student_id FROM jsonb_to_recordset(${JSON.stringify(students.map(s => ({ row_number: s.row_number, student_id: s.id })))}::jsonb) AS x(row_number int,student_id uuid)
    WHERE r.import_id=${job.id}::uuid AND r.school_id=${job.school_id}::uuid AND r.row_number=x.row_number`.execute(db);
    await sql `INSERT INTO subject_attendance(student_id,subject_id,term_id)
    SELECT DISTINCT e.student_id,t.subject_id,e.term_id FROM enrollments e JOIN timetable_slots t ON t.class_section_id=e.class_section_id AND t.term_id=e.term_id
    WHERE e.student_id=ANY(${students.map(s => s.id)}::uuid[]) AND t.slot_type='class' AND t.subject_id IS NOT NULL`.execute(db);
    const registers = model && attendance ? await attendance.reconcileEnrollmentRostersInTransaction(db, req.authUser, job.school_id, { kind: 'import', review_id: job.id, command_id: model.prepared.command_id }, req) : [];
    const auditBase = { school_id: job.school_id, actor_id: req.authUser.id, request_id: req.requestId, ip_hash: null };
    await db.insertInto("audit_events").values([
        ...students.map(s => ({ ...auditBase, action: "people.student.enrolled", target_type: "student", target_id: s.id, metadata: { import_id: job.id, row_number: s.row_number, guardian_id: s.guardian_id, class_section_id: s.class_section_id, enrolled_on: s.enrolled_on, can_authorize_leave: false } })),
        ...registers.map(r => ({ ...auditBase, action: "attendance.register.roster_changed", target_type: "attendance_register", target_id: r.id, metadata: { import_id: job.id, revision: r.revision, state: "draft" } })),
        { ...auditBase, action: "people.import.committed", target_type: "people_import", target_id: job.id, metadata: { students: students.length, guardians_created: createdGuardianProfiles, skipped: review.summary.skipped } },
    ]).execute();
    for (const classId of [...new Set(students.map(s => s.class_section_id))].sort()) {
        const guardianIds = students.filter(s => s.class_section_id === classId).flatMap(s => s.guardian_id ? [s.guardian_id] : []);
        const audience = (await sql `SELECT DISTINCT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
      WHERE m.school_id=${job.school_id}::uuid AND m.is_active AND (m.role='admin' OR
      (m.role='staff' AND EXISTS(SELECT 1 FROM timetable_slots t WHERE t.class_section_id=${classId}::uuid AND t.term_id=${job.term_id}::uuid AND t.teacher_user_id=m.user_id)) OR
      (m.role='guardian' AND EXISTS(SELECT 1 FROM parents p WHERE p.id=ANY(${guardianIds}::uuid[]) AND p.user_id=m.user_id)))`.execute(db)).rows.map(r => r.user_id);
        await events.enqueueUserEvent(db, { schoolId: job.school_id, eventType: "people.updated", aggregateType: "class_section", aggregateId: classId, audienceUserIds: audience,
            idempotencyKey: `people-import:${job.id}:${classId}`, payload: { class_section_id: classId, term_id: job.term_id, import_id: job.id, refresh: ["people", "teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "parent.home"] } });
    }
    await sql `UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=${job.id}::uuid`.execute(db);
    const receipt = { import_id: job.id, students: students.length, guardians_created: createdGuardianProfiles, guardians_reused: reusedGuardianProfiles.size, skipped: review.summary.skipped, registers_reopened: registers.filter(r => r.previous_state === 'submitted').length,
        enrolled: students.map(s => ({ row_number: s.row_number, student_id: s.id, admission_number: s.admission_number })) };
    await sql `UPDATE people_imports SET state='committed',revision=revision+1,receipt=${JSON.stringify(receipt)}::jsonb,commit_token=${review.validation_token},committed_at=now(),updated_at=now() WHERE id=${job.id}::uuid`.execute(db);
    const attachedIds = [...new Set([...students.flatMap(row => row.person ? [row.person.id] : []), ...guardianPeople.keys()])];
    const attachedPeople = attachedIds.length ? (await sql `UPDATE school_people SET revision=revision+1
    WHERE school_id=${job.school_id}::uuid AND id=ANY(${attachedIds}::uuid[]) RETURNING id,first_name,last_name,revision`.execute(db)).rows : [];
    if (model)
        for (const person of attachedPeople)
            await registerCreatedPerson(db, model.ports, { school_id: job.school_id, actor_id: req.authUser.id, person,
                correlation_id: job.id, command_id: model.prepared.command_id, key: `people-import:${job.id}:existing:${person.id}` });
    if (model) {
        const key = `people-import:${job.id}:accepted`, now = executionNow().toISOString();
        const outbox = await db.insertInto('event_outbox').values({ school_id: job.school_id, event_type: 'people.updated', aggregate_type: 'people_import', aggregate_id: job.id,
            audience_user_ids: [req.authUser.id], payload: { action: 'reviewed_people_import', refresh: ['people.participants'], count: students.length }, idempotency_key: key }).returning('id').executeTakeFirstOrThrow();
        const event = await model.ports.journal.recordAcceptedEvent(db, { school_id: job.school_id, source_outbox_event_id: outbox.id, event_type: 'people.updated',
            subject: { kind: 'people_import', domain: 'people', domain_id: job.id, label: 'Reviewed enrollment import', lifecycle_state: 'active', source_revision: job.revision + 1, metadata: {} },
            context: null, actor_user_id: req.authUser.id, audience_user_ids: [], occurred_at: now, effective_from: now, effective_until: null, source_domain: 'people', source_record_id: job.id,
            source_revision: job.revision + 1, correlation_id: job.id, causation_event_id: null, idempotency_key: key, payload: { action: 'reviewed_people_import', source_command_id: model.prepared.command_id, count: students.length } });
        await model.ports.gateway.completeDomainCommand(db, { school_id: job.school_id, command_id: model.prepared.command_id, terminal_state: 'accepted', code: 'reviewed_people_import',
            explanation: 'Enrollment records were committed with explicit person identities; no accounts or authority were created.', resulting_revision: job.revision + 1, domain_event_id: outbox.id,
            metadata: { model_event_id: event.event_id, person_ids: students.map(row => row.person_id) }, completed_at: now });
    }
    return receipt;
}
//# sourceMappingURL=import-writer.js.map