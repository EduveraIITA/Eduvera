# Offline assessments and results

Status: local implementation slice `WF-LOCAL-020`, 5 October 2026.

This design implements the blueprint's Stage E academic breadth as a bounded,
adult-operated workflow. It does **not** deliver questions, run timed online tests,
proctor students, auto-grade answers, rank children publicly or become a full LMS.
The assessment happens through the institution's normal physical process. Eduvera
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
