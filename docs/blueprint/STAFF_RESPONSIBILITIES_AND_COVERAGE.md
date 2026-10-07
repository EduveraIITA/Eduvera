# Staff Responsibilities & Coverage

**Status:** historical domain foundation; administrator model superseded
**Date:** updated 7 October 2026
**Scope:** configurable schools, colleges and coaching institutions; administrator and staff mobile workflows

The assignment, leave-cover, conflict and audit requirements in this document remain valid. Its
former fixed “responsibility catalogue”, Duties board and work-profile references are no longer the
administrator experience. The authoritative current model is
[Roles and contextual assignments](WORK_PROFILE_ACCESS_ARCHITECTURE.md):
institutes use built-in or custom roles containing supported actions, and assign people to those
roles with scope and dates. There is no second work-type catalogue or role/duty eligibility gate.

## 1. Product decision

An account role answers **which portal may this person enter?** A responsibility answers **why may this staff member act on this resource, for what purpose, and for which dates?** They are not the same field.

`staff` and `admin` remain stable school memberships. Class teacher, subject teacher, mentor, event judge, escort, invigilator, examiner, safety officer and committee member are effective-dated appointments. This avoids permanent privilege growth when one teacher performs several temporary duties.

The release adds one bounded Staff Operations module:

- staff directory and onboarding;
- leave policies, balances, application and approval;
- purpose-scoped responsibility appointments;
- staff acceptance or decline where appropriate;
- revocation with reason and immutable audit history;
- automatic coverage tasks when leave is approved;
- principal assignment of a replacement and replacement acknowledgement;
- conflict checks against approved leave, timetable periods and accepted cover.

Payroll, salary, performance surveillance, disciplinary casework, biometric monitoring and full examination-result processing are deliberately outside this module.

## 2. Evidence and school operating model

The design follows the repository blueprint rule that assignments need scope, effective dates, backups and revocation, and that authorization must combine active membership, assignment, relationship and purpose. A generic staff role is not a second eligibility gate.

It also reflects Indian school operations:

- CBSE places timetable preparation, teaching-load allocation, staff supervision and examination duty allocation with the Head of School. See [CBSE Affiliation Bye-Laws, chapter 9](https://www.cbse.gov.in/cbsenew/aff-bye-laws.html).
- CBSE treats teacher service duties, records and Board/examination obligations as responsibilities beyond classroom instruction. See [CBSE expectations from teachers](https://www.cbse.gov.in/cbsenew/cbse-exp-teacher.html) and the [Teacher Handbook](https://www.cbse.gov.in/cbsenew/documents/Handbook_for_Teachers.pdf).
- Government school-safety guidance uses a whole-school accountability model across management, principal, teachers, parents and other functionaries. See the Ministry of Education [Guidelines on School Safety and Security 2021](https://dsel.education.gov.in/sites/default/files/2021-10/guidelines_sss.pdf).
- NCPCR publishes school safety and education guidance that makes child-facing safety appointments sensitive rather than ordinary labels. See [NCPCR education guidelines](https://ncpcr.gov.in/public/education-guidelines).

These sources support the operating pattern; they do not create a uniform statutory leave entitlement. Each school must configure its own leave policy and verify applicable central, state, board and employment rules.

## 3. Responsibility catalogue

| Category | Initial types | Typical scope | Confirmation |
|---|---|---|---|
| Academic | Class teacher, subject teacher, section coordinator | Class and optional subject | Existing academic ownership activates immediately; coordination is accepted |
| Student support | Student mentor | Class/cohort | Required; restricted |
| Event | Coordinator, judge, escort, attendance lead | One event | Required; judge and escort are restricted |
| Examination | Exam in-charge, invigilator, internal examiner | Named dated duty | Required; restricted |
| Operations | School duty, transport attendant | Date, time, location or assigned journey | Required |
| Governance | Safety officer, committee member | Named school-wide scope | Required; restricted |

School-created arbitrary permission codes are intentionally not supported. The catalogue is controlled because each type carries a known scope shape, acceptance rule and access explanation.

## 4. Lifecycle and authorization

### Responsibility

`offered → active → completed`  
`offered → declined`  
`offered|active → revoked`

- Principal/admin creates and revokes.
- The named staff account may accept or decline an offered appointment.
- A decline requires a reason; revocation always requires a reason.
- Non-acceptance types activate immediately.
- Every transition is written to a domain audit table and the school operations audit.
- Notifications use the transactional outbox.
- A work profile lists the controlled responsibilities the staff member is eligible to perform. It
  does not activate access without actual assigned work.
- An active, in-date appointment activates the platform-owned capability pack only when a current
  work profile contains the same responsibility type.
- Creating an incompatible appointment is rejected. If a profile is removed after appointment,
  the appointment remains visible for correction but stops activating access immediately.
- Legitimate work that the responsibility catalogue cannot express uses a dated, reasoned access
  exception. Technical permission checklists are not exposed in the normal administrator workflow.
- The complete authorization contract is defined in
  [Work profiles, assignments and calculated access](WORK_PROFILE_ACCESS_ARCHITECTURE.md).

### Coverage

`open → offered → accepted → completed`  
`offered → declined → offered`  
`open|offered|accepted → cancelled`

- Approving staff leave creates a coverage task for every affected effective timetable period.
- It also creates tasks for dated event or operational responsibilities beginning during the leave window.
- Principal/admin offers each open task to an active staff account.
- The replacement accepts or declines. A declined task returns to the principal queue.
- Assignment is rejected when the replacement has approved leave, a clashing timetable period or another offered/accepted cover duty.

The current UI does not expose manual completion/cancellation because those transitions need the dated school-day completion job and leave-reversal policy. They are reserved in the schema, not represented as working UI.

## 5. Data ownership

- `staff_responsibility_types`: school catalogue, scope shape and safety metadata.
- `school_custom_role_duties`: responsibility eligibility selected for each work profile; profile
  membership alone grants no operational access.
- `staff_responsibility_assignments`: staff, purpose, scope links, dates, optional time/location, backup and lifecycle.
- `staff_responsibility_audits`: immutable assignment transitions.
- `staff_coverage_tasks`: one actionable duty created from approved leave.
- `staff_coverage_task_audits`: immutable coverage transitions.
- Existing `class_section_staff_assignments` and `campus_event_staff` remain domain-owned. Migration 029 imports them as active responsibility views; it does not delete or repurpose them.
- Existing `staff_leave_requests` remains the source of leave truth.

All records carry `school_id`; database constraint triggers reject cross-school scope references. RLS is enabled and public database roles receive no direct table grants. Application authorization is deny-by-default through active school membership checks.

## 6. Mobile experience

### Principal: Staff Operations → Duties

1. See active appointments, awaiting replies and uncovered duties first.
2. Assign a responsibility by choosing its controlled type, staff member, contextual resource and dates.
3. For scheduled duties, add the actual time and location.
4. Review restricted-purpose access before sending.
5. Assign uncovered leave periods from the same board.
6. End an appointment with an explicit reason.

### Teacher: My responsibilities

1. Offers needing a response appear first.
2. The offer shows purpose, resource, date/time, instructions and access boundary.
3. Accept or decline; declining needs a reason.
4. Current responsibilities and accepted cover remain visible together.
5. Leave remains a separate personal workflow, linked by the generated coverage state.

## 7. Safety and privacy rules

- An appointment never changes the user’s coarse login role.
- A restricted responsibility does not reveal student information by itself; downstream modules must explicitly authorize the responsibility type and resource scope.
- Event judge access is limited to the assigned event and a future published rubric workflow. This release does not invent scores or expose unrelated academic records.
- Mentor, escort, invigilation and safety appointments are marked restricted for downstream policy checks.
- Historical appointments remain auditable but are not presented as current authority.
- The interface never exposes salary or performance scoring.

## 8. Acceptance criteria

1. A principal can assign a class, event, examination, operational or governance responsibility with correct required scope.
2. Cross-school, duplicate and invalid-scope appointments are rejected.
3. A teacher sees only their appointments and may respond only to their own offers.
4. Revoked or declined appointments no longer appear as current.
5. Leave approval atomically creates timetable and dated-duty coverage tasks.
6. A principal sees all open cover; a replacement sees only cover offered to them.
7. Cover assignment rejects leave and time conflicts.
8. Every state change produces audit evidence; notification-worthy changes use the outbox.
9. Principal and teacher views remain usable at a 390-pixel phone width with visible focus states and 40-pixel-or-larger actions.
10. Migration, backend integration, frontend interaction, typecheck, lint and production builds pass before release.
11. Work-profile eligibility plus an active scoped appointment produces explainable calculated
    access; incompatible new appointments are blocked and existing mismatches are visible for review.

## 9. Follow-on domain work

The responsibility foundation is intentionally ready for, but does not pretend to implement:

- event judging rubric, scoring moderation and result publication;
- examination paper custody, room plans, candidate accommodations and evaluation workflow;
- committee meetings, minutes and resolutions;
- automated duty completion and no-show escalation;
- workload planning based on contracted time and school policy.

Each follow-on must remain owned by its domain and reference the responsibility assignment as purpose evidence rather than creating new global account roles.
