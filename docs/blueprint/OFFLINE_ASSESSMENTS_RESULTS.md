# Offline assessments and results

Status: local implementation slice `WF-LOCAL-020`, extended with physical
examination-day operations on 16 October 2026.

This design implements the blueprint's Stage E academic breadth as a bounded,
adult-operated workflow. It does **not** deliver questions, run timed online tests,
proctor students, auto-grade answers, rank children publicly or become a full LMS.
The assessment happens through the institution's normal physical process. ThatCampus
coordinates the schedule, examiner authority, optional evidence, marks, moderation,
publication and traceable correction.

## Product outcome and scope

The workflow answers four operational questions:

1. What offline assessment is scheduled, for which class and subject?
2. Who may record and who must independently moderate its results?
3. Is every learner accounted for with a truthful result state?
4. Which immutable result revision has actually been published to the learner/family?

Supported institution types are school, college, coaching and hybrid. Labels and
assessment kinds are configurable at record level; no CBSE-only grading rule is
embedded in code. Initial scoring is marks-based with an optional displayed grade.
Weighted term aggregation, board-specific grade calculation and transcript/certificate
generation remain later policy packs and must not be inferred from this release.

## Roles and authority

- An institution administrator creates cycles and assessments, assigns examiner and
  moderator, opens marking, and publishes approved results.
- An explicitly assigned examiner records marks and optional evidence for that
  assessment. A general teacher role alone does not grant access to every class.
- An explicitly assigned moderator reviews the complete register and either approves
  it or returns it with a reason. The examiner cannot moderate the same assessment.
- Learners and linked guardians see only a published snapshot for their own learner.
  Draft, marking and moderation data never leaks into family views.
- Custom staff roles expose separate `assessments.view`, `assessments.mark` and
  `assessments.moderate` permissions. Publication remains administrator-only in this
  first slice because it is a consequential institution decision.

## State machines

Assessment:

`draft -> scheduled -> marking -> submitted -> moderated -> published`

- `draft` may be edited by administrators.
- `scheduled` fixes the operational paper/session details.
- `marking` creates the roster from effective enrolments.
- `submitted` requires every roster row to be recorded as scored, absent, exempt,
  withheld or not evaluated.
- `moderated` records an independent approval. A returned register goes back to
  `marking` with the moderator's reason.
- `published` creates an immutable publication and per-student snapshot.
- An administrator can cancel an unpublished assessment with a reason.

Result states are deliberately explicit: `unrecorded`, `scored`, `absent`, `exempt`,
`withheld`, `not_evaluated`. Only `scored` carries marks. Zero is a valid score and is
never used as a substitute for absence. Each result write increments a revision and
appends a revision record. Editing after publication starts a correction round, moves
the assessment back to marking, and leaves the previous publication intact until a
new moderated publication is made.

## Evidence and privacy

Evidence is optional unless the assessment says it is required. Supported first-slice
files are PDF, JPEG and PNG up to 10 MB, stored outside the public web root and served
through an authorized API. Evidence records retain uploader, size, media type and
time. The platform does not require institutions to upload every answer sheet.
Malware scanning and external object-storage lifecycle enforcement remain release
gates; local storage is development evidence, not production readiness.

## Data, audit and reliability invariants

- Every assessment, assignment, result, evidence and publication is tenant-scoped.
- The enrolled roster is materialized when marking opens; later enrolment changes do
  not silently rewrite a live or published register.
- Examiner and moderator are different active institution members.
- Marks must be between zero and the assessment maximum.
- Submission cannot pass with `unrecorded` rows or missing required evidence.
- Publication requires a moderated revision and snapshots every learner result in one
  transaction with audit and outbox metadata.
- Corrections never overwrite publication snapshots. Each publication has a sequence,
  reason and source assessment revision.
- Direct Supabase Data API roles receive no table access. Tables have RLS enabled as
  defence in depth and remain behind the authenticated Nest application boundary.

## API and interface

The module is available at `/api/v1/schools/:schoolId/assessments` and the responsive
portal routes `/principal/assessments`, `/teacher/assessments`,
`/student/results`, and `/parent/results`.

The principal workspace presents cycle readiness, unrecorded counts, moderation
queue and publication state. The teacher workspace shows only assigned assessments
and a mobile roster editor. Learner/family screens show published assessment cards
with score/status, grade, feedback and publication date. Empty, loading, failure and
non-published states are explicit.

## Acceptance and remaining gates

Automated acceptance covers tenant and relationship isolation, examiner/moderator
separation, incomplete-register rejection, marks bounds, immutable publication,
family visibility and correction/republication. Before a live rollout, an institution
must still validate its grading scheme, moderation SOP, evidence retention, correction
authority, report wording and accessibility on representative devices. This slice is
not a board-compliance or legal certification.

## Physical examination-day operations — 16 October 2026 (local branch)

Exams, practicals and vivas now have an explicit physical sitting instead of relying on
free-text venue data. An administrator must choose an active, bookable campus space and
offer the duty to at least one active staff member while creating the assessment. The
sitting snapshots the current institution examination Operating rules. An offered
invigilator accepts or declines the duty in the existing assessment workspace; the
sitting cannot be scheduled until the configured minimum number have accepted.

Scheduling freezes the effective learner roster for the assessment date, checks room
capacity, rejects overlapping examination use of the room, class or accepted
invigilator, and retains the canonical campus-space identity. The exam-day workspace
then supports an authorized administrator or accepted invigilator starting the sitting,
recording factual candidate attendance, recording and resolving attributed incidents,
and completing the sitting. Candidate attendance is deliberately independent of the
academic outcome: present, late or absent never creates marks or result status. Manual
and automatic opening of marking both use the frozen candidate roster.

The applicable Operating rules are institution-wide and revisioned: readiness window,
attendance-close window, minimum invigilators, whether every candidate must have an
attendance observation before completion, and whether completion opens marking
automatically or waits for an administrator. Each sitting keeps the rule revision and
snapshot it received, so later rule edits do not rewrite historical operations.

Material examination work uses two explicit Model Core paths inside the owning
assessment transaction: sitting lifecycle, attendance and incident changes use
accepted-change commands; invigilation responsibility uses a typed Offer and exact
recipient response outcome. Assessment records remain authoritative in both cases.
The model receives the room-bound sitting expectation, lifecycle actions, attendance
completeness and incident state without claiming observed physical presence or
academic outcomes. Active expectations project into Campus View, and scheduled
assessments project into the normal calendar for authorized staff, learners and linked
guardians. Invigilator-only viewers can see the operational sitting but cannot see
marks or publication history.

Migration `117_examination_day_operations.sql` adds tenant-scoped policies, sittings,
invigilator offers, frozen candidates, attendance, incidents and audit evidence. The
schema uses composite foreign keys to prevent a repeated assessment, sitting, candidate
or learner identifier from pointing at a different parent chain. Active membership and
account eligibility are rechecked when an invigilator reads or mutates the sitting.

Local evidence: backend TypeScript and focused lint pass; the fresh isolated-schema
assessment/examination suites pass 11/11, including the end-to-end physical workflow,
all six required model commands and a negative cross-sitting candidate constraint; the
focused bridge, Campus View and assessment-event suites pass 20 tests with the database
case skipped outside the isolated runner. Six focused frontend suites pass 24/24 with
scoped lint and whitespace checks. No deployment or owner-device acceptance is claimed.

### Effective-timetable readiness — 17 October 2026 (local branch)

Examination scheduling now evaluates one authoritative readiness projection before it
freezes the roster. Migration `118_effective_schedule_canonical_spaces.sql` extends the
existing effective timetable with the canonical campus-space identity selected by the
published timetable, dated day plan or legacy timetable source. It does not introduce
a second precedence resolver. The assessment domain uses that contract to explain and
reject overlapping class periods, room occupancy and accepted invigilators' teaching
commitments, alongside cycle dates, current enrolment, room capacity, active/bookable
space state, accepted-invigilator minimums and other physical examinations.

The same projection is returned in the existing assessment detail and dedicated
readiness API, rendered in the existing Exam day panel, and re-evaluated inside the
serialized schedule transaction. The Schedule action is unavailable while a visible
blocker remains. It is not a dead end: an administrator can correct the draft date,
duration, canonical room and invigilators from the same assessment workspace. The
command uses assessment and sitting revisions, rechecks administrator authority,
active/bookable space and staff eligibility, and records the previous/current
arrangements in the domain audit. Changing the time, room or selected staff cancels each still-open
operational Offer, closes its retained binding, and publishes a new Offer for the
resulting assignment revision; an earlier acceptance is never carried onto a
materially changed duty. Audit evidence records the timetable contract and evaluation
time used by an accepted schedule transition; domain records remain the authority and
no Model Core persistence vocabulary is exposed to the interface.

Verified local evidence: migration 118 applied to the development database and a fresh
disposable PostgreSQL schema; the focused examination, Model Bridge and Campus View
suites pass 15/15, including a class/room/invigilator timetable-conflict rejection and
successful correction of the conflicting time, invalidation and re-acceptance of the
revised invigilation offer. Backend source typecheck and focused lint pass. The focused
assessment frontend suites pass 16/16 with source typecheck and lint. No deployment or
owner-device acceptance is claimed.

### Model-mediated invigilation Offers — 17 October 2026 (local branch)

Each offered invigilation assignment revision owns one authoritative
`assessment.invigilation.offered` outbox event and one retained Assessment-domain
binding to the exact approved behaviour, subscription, Model event, reaction and
operational Offer message. The Assessment domain still owns assignment and response
state; the Core owns coordination evidence, not examination truth.

An invited staff member can accept or decline only the exact current message addressed
to their active human agent. The response path rechecks current membership, capability,
assignment/message recipient, assignment revision, response deadline and expiry;
updates the assignment, writes the response event, records the correlated message
outcome and retains an actor-scoped command receipt in one transaction. Identical
command retries return the retained result; the same command identity with a changed
body conflicts. A material arrangements revision cancels the previous open message
before reissuing responsibility.

Missing or invalid approved behaviour or recipient authority fails closed and never
activates a hidden recipient or auto-acceptance. The guarded Cambridge demo seed
installs explicit configuration and capabilities only in development, local or test
environments. A development actor may respond only as the exact offered account
through the normal response command. That is development evidence, not production
automation or evidence that the duty was performed.

Migration `119_assessment_invigilation_model_coordination.sql` adds the immutable
assignment-revision/message bindings and replay-safe response command receipts. The
first Offer/message/response binding is implemented; persistent reminder rounds,
expiry execution and configured escalation/fallback workers remain open.

Remaining release gates are explicit. The current model supports one room and one
frozen cohort per physical assessment; split rooms and multi-sitting papers need a
later data model. The current accepted/declined duty and realtime refresh path must
not be represented as reminder, expiry or escalation automation.
