# School Operations Blueprint implementation

Baseline: [School_Operations_Blueprint.pdf](../../School_Operations_Blueprint.pdf),
v1.0, 15 September 2026, supplied by Abhishek. The repository-root PDF is the primary
blueprint reference; consult its relevant sections for each development increment.
Explicit user decisions and documented architecture decisions clarify its application.

This is the implementation record, not a claim that the entire blueprint is complete.
The blueprint's companion 40-item backlog, six workflow contracts, schemas and 36 acceptance
scenarios were referenced in the PDF but were not attached. IDs below are local traceability IDs,
not reconstructed companion artifacts. Field discovery, school sign-off and operational/legal
decisions cannot be replaced by synthetic software tests.

## Accepted direction

- Preserve the existing blue/mint palette, Plus Jakarta Sans, shared app bars, child switching,
  mobile navigation and existing React UX. Extend established components and semantic tokens.
- Build an adult-operated daily coordination loop; a child does not need a phone to participate.
- Preserve NestJS/Fastify + PostgreSQL + transactional outbox + authorized SSE. Use explicit
  Nest modules for new domains; avoid growing the existing SchoolService further.
- Keep observation, attendance, request approval, response, task closure and physical handover
  distinct. Missing attendance is not absence. A reply is not consent or an attendance correction.
- Keep current React/Vite web clients for this increment. Next.js/Expo are future client decisions,
  not prerequisites for a working web coordination loop. See ADR-001 below.
- Use the local synthetic school for review. Do not silently switch to Supabase credentials.
- Ask Abhishek to review working UI after substantial changes, before continuing UI expansion.
- Preserve `schools` as the current tenancy anchor while modelling new capabilities as
  institution-scoped configuration. The product target includes schools, colleges and coaching
  institutions; capability packs must express regulator and education-stage differences instead
  of scattering school-only assumptions through new domains. The first governance pack is the
  India school core pack; college and coaching packs require their own evidence and acceptance.
- Product decision, 5 October 2026: initial institution onboarding assumes the institution is
  bringing already-admitted learners into Eduvera. A pre-admission/enquiry/application pipeline is
  parked for a later release. Current reviewed individual/bulk enrolment remains the supported
  starting workflow; do not make admissions CRM a dependency for the next academic-operations slice.
- Product decision, 7 October 2026 (latest correction): descriptive **Position**, reusable
  **Role** (supported actions), and **Assignment** (person, role, scope and dates). A workflow is
  the actual domain process, not another name for a role. Remove the Work types / Workflow-alias
  editor. Normal staffing uses ready-made roles; custom roles can change allowed actions.
  No separate eligibility matrix. Domain-native staffing appears on the staff profile automatically.

## Repository audit and dependency order

| Order / requirement | Existing base | Remaining implementation and acceptance |
| --- | --- | --- |
| B0: Reproducible preview | Compiled bundles existed; previous runtime had manual patches and stopped | Restore locked dependencies, compile source, managed local restart, readiness and restart drill |
| B1: People and authority | School-scoped account-optional people; individual and reviewed bulk enrollment; dated guardian leave-signing permission | Other purpose-specific grants, account invitations, transfer/withdrawal; no merge by phone/name |
| B2: Daily plan | Weekly baseline plus dated, versioned daily plans; notices/materials; coverage responses; shared family schedule; conflict checks and outbox updates | Local UI acceptance and school-operating validation; resource catalogue/advanced authoring remains later timetable scope |
| B3: Attendance | Full-roster commands, revision checks, idempotency, correction history, calendar, leave; immutable source-rich observations; encrypted account-scoped offline queue with expiry/quarantine; reviewed paper and office capture | Print/export reconciliation, physical offline/device drill and school-operating acceptance; retain unrecorded/unknown states |
| B4: Attendance follow-up | Attendance facts and parent/teacher screens | First local slice implemented below: explicit owner/deadline, guardian reply, assisted response, outcome, event update |
| B5: Communication/actions | Per-user notification inbox, diary acknowledgments and notes | Dedicated action inbox aggregating obligations; notice creation/audiences; delivery-attempt versus acknowledgment versus decision states; explicit non-app routing |
| B6: Pilot readiness | Scoped documents, auth/CSRF, event replay and tests | Scoped object storage, malware scanning, non-owner RLS runtime roles/context, privileged auth, recovery drill, accessibility/device validation, release evidence |
| C1: Departure coordination | No trusted operational release implementation | Departure plans and revisions; collection authority; verification/approval/readiness/execution; current-authority checks and fallback; separate school sign-off |
| C2: Restricted care | Local restricted-care slice: encrypted intake/notes, dated primary and alternate recipients, explicit per-case access, reporting evidence, closure gate and neutral event envelopes | Authenticated UI/operational sign-off; evidence storage, retention/legal hold, external delivery and institution tabletop drill remain release gates |
| C3: Transport pilot | Some existing read-only placeholder surfaces | Explicit service boundary, route/trip/leg rosters, manual observations, unresolved rider reconciliation and staffed closure; independent readiness gate |
| D1: Repeatable operations | Basic timetable conflict checks | Staff coverage tasks, approved device adapters, quarantine, provider health, onboarding templates |
| D2: Bounded policy | Attendance threshold/calendar configuration plus local G1-G3 institution profile, seeded policy register, immutable draft/review/publication and version acknowledgement | Policy rehearsal, scoped precedence, equal-priority conflict rejection, machine-evaluated explanations and prospective rollback remain open; legal applicability remains institution-reviewed |
| E1: Finance | No authoritative fee ledger; existing labels need review | Obligations, integer minor units, allocations, receipts, verified callbacks, reversals, reconciliation; never gate collection on unpaid fees |
| E2: Academic/admin breadth | Diary/homework completion; timetable editing; local offline assessment/result lifecycle in WF-LOCAL-020 | Weighted term aggregation, configurable grading policy, transcripts, office requests/documents/lost property; extend only after core acceptance |
| F1: Intelligence | Provider-neutral read-only attendance assistant | Evidence/freshness, scoped retrieval tests, safe drafting, policy rehearsal; no authority, diagnosis, release or autonomous reconciliation |

B1 still has foundational gaps; B2 and B3 have locally implemented workflows awaiting acceptance. The B4 slice builds only on already-existing account, enrollment
and attendance primitives; it does not imply that the complete Stage B exit gate has passed.

## Active delivery: institution governance and policy centre — 4 October 2026

The next large delivery increment is tracked in
[Institution governance and policy centre](GOVERNANCE_POLICY_COMPLIANCE.md). G1-G4 are implemented
locally and automated focused checks pass: configurable institution/regulatory profile,
India-school policy catalogue, versioned draft/review/publication, member acknowledgement and the
separate [restricted care workflow](RESTRICTED_CARE_WORKFLOW.md) with encrypted narratives,
explicit assignments and alternate intake routing.
The complete frontend regression suite passes locally (35 files, 222 tests). Visual user sign-off
remains open, so this is not yet a release gate. This is domain hardening and does not represent
compliance certification. G5-G10 remain planned and must not be represented as implemented until
their separate high-risk workflows and evidence pass.

### Authority and mobile-governance overhaul — 7 October 2026

The user-supplied governance framework has been reviewed against the repository blueprint and
adopted as Version 2.1. The engineering contract is
[Institute governance, authority and mobile operations](INSTITUTE_GOVERNANCE_AUTHORITY_ARCHITECTURE.md).
It supersedes any interpretation that a software role, administrator account or generic approval
creates institutional authority. Effective operational assignments activate technical capability;
offices, body seats, appointments, mandates and decision rules establish
the separate institutional-authority model.

The A1 foundation is implemented locally in migration
`048_governance_authority_foundation.sql`. It adds typed authority sources, offices, bodies, seats,
appointments, standing/delegated mandates and matter-specific decision routes with institution-scoped
foreign keys, revisions, RLS and revoked browser-role grants. Migration
`049_governance_authority_integrity.sql` also rejects cross-institution source citations and linked-user
appointments at the database boundary. The governance workspace now leads with
a concise **Authority** surface and **Who can decide what?** view. An empty institution supplies four
necessary facts and the app prepares a reviewable draft; no generated record silently becomes adopted
authority. The repeat-safe Cambridge seed supplies two verified sources, five appointments, two mandates
and five confirmed routes for demonstration.

Verified locally on 7 October 2026: a fresh PostgreSQL 14 database migrated from `001` through `049`,
the focused governance API suite passed 6/6, the governance UI suite passed 3/3, both applications built,
both linters passed, the repeat seed remained stable, and the live workspace returned two sources, two
active office appointments and five confirmed routes. The fresh-database run also exposed and corrected
an older PostgreSQL-15-only column-list `SET NULL` clause in migration `033`; the invitation relationship
now uses the already-adopted restricted deletion path and fresh PostgreSQL 14 setup succeeds.

A2 remains planned, but is not the active product slice. The user explicitly prioritised simple
institution setup and daily operations before further governance expansion. Physical mobile review and
the full automated regression remain open for A1; it is not yet claimed as deployed or institutionally accepted.

### Scoped roles and assignments — 7 October 2026 (current)

The rejected work-type alias editor is replaced by **People / Roles / Leave / Settings**.
The contract is [Roles and contextual assignments](WORK_PROFILE_ACCESS_ARCHITECTURE.md).

- Built-in roles are ready to assign. Custom roles can start from a template or blank and select
  real supported actions in plain language, with automatic prerequisites. The context limits the
  available actions; naming a role never creates a new workflow or institutional authority.
- One profile projects direct class/institution assignments and native event, assessment and
  journey staffing. The same native record carries its optional custom access role; no second
  responsibility or eligibility record is required. Assignment links open their owning work.
- Role edits are revision/impact checked, tenant scoped and audited. Native assignment changes
  have revision checks; ending a class grant retains history and prevents timetable fallback from
  restoring removed permissions. Access-update events refresh staff navigation and data.
- Per-resource checks tie actions to the same class, event, assessment or trip. Teaching does not
  automatically make someone an examiner. Marking and independent review remain separate.
  Class follow-up, photo attendance and messaging use the contextual checks as well.
- Migration `052_scoped_access_roles.sql` keeps existing data and evolves the physical catalogue;
  it removes the immutable-workflow alias restriction. Old work-type mutation routes return 410.
  Compatibility role/eligibility records do not grant operational access or appear in setup.
- An add-only, repeat-safe seed demonstrates **Anil Sharma → Attendance reviewer → Class 6A**.
  It grants read-only attendance, not marking or unrelated institution access. Existing local
  staffing choices were not reset by a full reseed.

Verified locally: fresh PostgreSQL `001`–`052` migration and full demo seed; repeat access-role seed;
**282 backend tests in 39 files**, **253 frontend tests in 42 files**, both typechecks/linters and
production builds. Real Chromium checks cover 320, 390 and 768 px: role catalogue, action editor,
automatic prerequisites, staff profile, assignment form, no horizontal overflow, Escape dismissal
and no page errors. The frontend-engineering workflow retained existing theme/header/navigation
and used an accessible modal rather than introducing another setup surface. Final regression rerun
on 7 October passed the same 282 backend / 253 frontend tests after the access-event refresh and
database-type changes. Local `/healthz`, `/readyz` and the app returned 200; the ngrok health check
also returned 200.

Local migration `052` and the add-only example are applied to `omnischool_node`. The pre-existing
local checksum difference for migration `033` was not rewritten: `052` was applied independently
after checking its `051` prerequisite. Reconcile that older checksum before using the ordinary
migration runner for deployment. No production push/deployment is claimed. Physical phone/product
review and the broader blueprint release gates remain open.

### Staff profile role overview — 7 October 2026

User feedback: repeating every exam/journey assignment as a full card made it difficult to see
which roles a person holds. Staff profiles now group assignments by role identity, with a compact
role/assignment total and expandable rows. Class roles appear first. Search matches role names,
classes, subjects, exams and journeys, and opens matching scoped work when appropriate.

**Assigned / Not assigned / History** separates current/planned/offered bindings from ended records
and identifies available roles not held by the selected person. Scheduled and offered states retain
their actual labels; they are not relabelled as active. Historical assignments have no edit action.
Choosing an unassigned class/institution role preselects it in the existing assignment form; event,
exam and journey roles still link to their authoritative planning screens. Allowed actions appear
once per role group, not on every repeated assignment.

Verification: **262 frontend tests in 43 files**, frontend lint, typecheck and production build pass.
Chromium checks at **320, 390, 768, 1024 and 1440 px** verify grouping, exact-work search, unassigned
roles, preselected assignment forms, read-only history, keyboard expansion and no horizontal
overflow or page errors. Cambridge demo Kavita's **28 current assignments appear as six roles**.
The frontend-engineering pass preserves the established theme, shared headers and navigation.
No permissions, staffing records, migrations or seed data changed in this UI increment. Physical
phone/product review remains open; no push or production deployment is claimed.

### Staff setup simplification — 7 October 2026 (superseded)

Historical record only. The work-type model below was rejected by the user and replaced by the
scoped-role implementation above. Its former verification counts describe that older revision.

The current operations priority is implemented locally around one clear administrator entry:
**Staff setup & leave**. Its tabs are People, Work types, Leave and Settings.

- **People** is the only individual setup surface. A staff record contains descriptive position,
  active scoped assignments, onboarding and leave balance. Assignments are created from the record.
- The People directory and an individual staff record are separate mobile pages. Directory rows use
  the stable `/principal/staff/:staffProfileId` route, and each record returns explicitly to People;
  a selected profile is never appended below the directory list.
- An unfinished onboarding checklist remains visible and actionable. Once every check is recorded,
  the profile replaces it with one compact **Onboarding complete** disclosure; the historical checks
  remain available on demand without occupying the normal staff-profile workflow.
- **Work types** lets an institution name supported kinds of work. Each one is based on an immutable
  platform workflow family; required access, scope kind and safety restrictions are not editable.
- **Leave** contains leave review and the resulting cover queue. Cover is temporary and does not
  create another role or permanent responsibility.
- **My work** is staff self-service only. It is not another administrator configuration surface.
  The old standalone Roles URL redirects into Staff setup → Work types.
- The effective-access query no longer joins the legacy role/eligibility tables. Active dated
  assignments and domain-native staffing records activate their controlled capability packages
  directly, with resource checks retained in each owning service.
- Staff onboarding and ordinary invitations no longer ask for a role. Account type remains separate;
  position and work are completed in Staff setup.
- Migration `050` adds workflow family, institute clone lineage, revision and update attribution to
  the work-type catalogue. Migration `051` enforces the lineage at the database boundary: every
  institute work type must clone a same-institution built-in workflow and keep its scope, capability
  package, safety restriction and access explanation unchanged.
- The Cambridge seed contains three institute examples—Primary class guide, Route collector and
  Exam room supervisor—and an active Class 7A Primary class guide assignment for Kavita Mehta.
- Legacy role tables and API identifiers remain read-only compatibility details. Dated access
  exceptions remain an internal support mechanism and are removed from the normal setup experience.

The current contract is [Staff position, work types, assignments and automatic access](WORK_PROFILE_ACCESS_ARCHITECTURE.md).
Migrations `050` and `051` are applied to the local review database and the repeat-safe demo work
types and assignment are present. A fresh isolated PostgreSQL database migrated from `001` through
`051` and loaded the complete demo seed. The full backend regression passes **281 tests in 39 files**;
the full frontend regression passes **252 tests in 42 files**. Both linters and production builds
pass. Local API health, database/event readiness, the frontend document and the active ngrok tunnel
all return success. Physical mobile review by the product owner remains the only local acceptance
check for this overhaul; no production deployment is claimed.

## Active delivery: offline assessments and results — 5 October 2026

The first Stage E academic-operations increment is tracked in
[Offline assessments and results](OFFLINE_ASSESSMENTS_RESULTS.md). It intentionally supports the
institution's physical exam/class-test workflow rather than becoming an online examination system.
The local implementation covers configurable cycles and assessment kinds, explicit examiner and
moderator assignments, a frozen enrolment roster, truthful non-score outcomes, optional protected
evidence, revision-checked marks, independent moderation, immutable family publication snapshots,
and corrected republication. UI acceptance, institutional grading-policy validation, production
object storage/malware scanning and Stage deployment remain open release gates.

## Section coverage

| PDF sections | Delivery evidence / decision |
| --- | --- |
| 1-4: Definition, principles, boundaries, outcomes | Above baseline and staged roadmap; operational-obligation metric definitions remain to be field validated |
| 5-6: Roles and experience | Existing role shells retained; new follow-ups use deliberate guardian/staff contexts; purpose grants and office/transport/care roles remain B1/C |
| 7-9: Domains, invariants, observations | New CoordinationModule; separate journal; tenant FK; actor and effective/recording time; attendance source observations and reconciliation are implemented locally; other adapters remain D |
| 10: Closed loops | WF-LOCAL-001 below; remaining domain state machines scheduled C/E |
| 11-12: Configuration, non-app and offline | Assisted follow-up channel and account-scoped encrypted attendance device queue implemented locally; policy lifecycle and other non-app channels remain D/D2 |
| 13-15: Architecture, concurrency, tenancy | Retain modular Node backend; transaction + outbox, replay, scope checks, command receipts; runtime-role RLS and purpose grants remain B1/B6 |
| 16-18: Privacy, finance, AI | Restricted-care application encryption, explicit access and metadata-only event envelopes implemented locally; evidence storage/retention/privacy-rights gates remain open; no finance-provider or care AI enablement |
| 19: Measurable targets | Targets are not measured SLAs. 100k-student workload, latency and recovery tests remain unproven |
| 20-22: Discovery, SDLC, people | This traceability record and UI checkpoints; school sponsor/process owner and independent review not yet assigned |
| 23-24: Verification, deployment | Local tests and managed preview; physical school drills and production rollout not performed |
| 25-27: Roadmap, decisions, definition | Dependency sequence above; preserve human verification and narrow release gates |

## WF-LOCAL-001: Attendance-to-guardian follow-up

Actors: assigned teacher or administrator; linked guardian. A principal can see school-scoped
follow-ups. A teacher sees only currently assigned students. A teacher's unrelated parent
context grants no staff access. No student action or device is required.

1. Teacher opens a saved absent, late or half-day attendance record and explicitly raises a
   question with a due time. The creator owns the follow-up. No automatic case for an unmarked register.
2. Guardian sees the child's follow-up on Home and responds. The state becomes `in_review`.
3. Staff can instead record a phone, paper or in-person response, naming the linked guardian,
   time received, staff recorder and entry time. This is an attributed statement, not a consent artifact.
4. Owner or administrator records `absence_explained`, `record_corrected`, or `query_withdrawn`
   with an explanation. A claimed correction requires an actually newer attendance revision.
5. Closure does not rewrite attendance or imply any physical supervision, handover, consent,
   fee payment or receipt. Closing a notification never closes the case.

Invariants:

- INV-LOCAL-001: tenant/student/attendance/date links agree, enforced in PostgreSQL.
- INV-LOCAL-002: current membership, account, assigned class and guardian scope are checked;
  write transactions lock relevant authority rows and revalidate before accepting a command.
- INV-LOCAL-003: one open follow-up per attendance record; one command outcome per actor/key.
- INV-LOCAL-004: duplicate key/same payload replays; changed payload or stale revision conflicts.
- INV-LOCAL-005: factual attendance changes only through the attendance correction API.
- INV-LOCAL-006: ordinary response content stays in the scoped thread; SSE contains IDs/revision only.
- INV-LOCAL-007: closed cases reject new replies; school review is separate from guardian response.

Implementation: `backend/src/coordination`, migration `007_attendance_followups.sql`,
`frontend/src/features/coordination`. Both browser bundles recognize coordination invalidations,
so an SSE leader in the staff bundle can relay them to the responsive web app.

Current boundaries: follow-ups now support students and guardians without login accounts;
staff can record assisted responses. App delivery still requires an authorized linked account.
No SMS/WhatsApp was sent or integrated. Attendance offline writes are explicitly shown as device-pending until accepted or quarantined by the server; other offline writes remain unsupported.
No care/medical details should be entered in this routine thread. Dedicated action navigation,
coverage/reassignment and reminders are subsequent B4/B5 extensions.

The guardian Home screen places the attendance follow-up inbox inside **Guardian Actions** and
does not render the inbox until the selected child has an open follow-up. Staff inboxes retain
their explicit loading, error and empty states for operational visibility.

## WF-LOCAL-002: Reviewed student and guardian enrollment

Implemented first B1 slice: principal **Students & guardians** at `/principal/students`.
This extends the existing responsive principal shell without replacing its theme or navigation.

1. Administrator selects the school, student details, active class/term and effective start date.
2. Add a guardian identity without requiring a login, or search and explicitly select an existing
   same-school guardian. Shared names/phones produce warnings, never automatic merges.
3. Review the complete proposed relationship and enrollment. Explicitly confirm verification
   before saving. Reviewing creates no student, guardian, enrollment or account.
4. Commit rechecks current administrator authority, tenant scope, dates, admission number,
   roll availability and register state in a transaction. Repeated commits return the same student.
5. Save person, student, guardian relationship and enrollment together, with audit and outbox.
   No attendance marks or login accounts are fabricated. The student enters rosters only from
   the enrollment date. Affected submitted registers return to draft with a roster-change audit;
   locked registers block the enrollment until reopened or a valid later date is chosen.

Implementation: `backend/src/people`, migrations 008–010, `frontend/src/features/people`.
PostgreSQL enforces same-school person/student/guardian links; admissions are case-insensitively
unique per school. Table ownership matches the existing runtime tables, without PUBLIC grants.
Existing logins retain their links; optional accounts are separate from canonical person details.
The API retains its legacy display-name container for compatibility and adds explicit `person`
and nullable `account` fields. Login-free identities work in teacher rosters, parent child data,
attendance event generation and assisted follow-ups.

Boundaries: this is individual enrollment, not a completed admissions/import or authority system.
The legacy leave-authorization flag is explicit and defaults off; a guardian relationship does
not grant collection authority. Account provisioning, purpose grants beyond leave signing,
enrollment end dates and transfer/withdrawal remain open. Bulk enrollment is covered by WF-LOCAL-004. Individual reviews expire after
one hour and committed review payloads are cleared; automated expired-draft retention cleanup
is still required before production. Non-owner RLS execution remains a B6 release gate.

## WF-LOCAL-003: Guardian leave-signing authority

Principal directory → guardian **Manage permissions** → **Review permission** → dated grant
or immediate revocation → school-verified reason → review → explicit confirmation.
The existing React shell, palette and typography remain unchanged.

- Purpose is strictly **sign leave requests**. This is not collection permission or revocation
  of the family relationship, record access, account, staff membership or existing signatures.
- Start/end dates use the school timezone; the end date is inclusive. New grants cannot be
  backdated. Expired and future grants cannot sign; an end date is optional. Expiry is checked
  at use, without a polling loop or a scheduled database mutation. An already-open UI may
  need navigation/focus/manual refresh to update a time-bound label; the server remains authoritative.
- Current school administrator membership is required at every command. Changes lock the
  relationship and authority rows, reject stale revisions, and persist prior/new settings,
  actor, verification statement, reason and an idempotent command receipt in one transaction
  with audit and an ID-only outbox event. History is read-only in the application, latest 50 shown.
- Leave submission and guardian actions now check current effective authority inside the
  transaction under a relationship lock, including after waiting behind a revocation. Previous
  signatures are retained rather than silently undone. Date-aware eligibility also drives the
  parent leave screen and eligible-guardian notifications.
- Lost-response retries reuse the same command even if SSE has already delivered its new
  revision. A changed payload/key reuse is rejected. Unsubmitted stale forms must be reviewed again.
- Legacy grants retain their settings and are labelled **not yet reverified here**. Enrollment
  still defaults leave permission off. Seed upserts preserve reviewed permissions and their dates.

Implementation: migration `011_guardian_leave_authority.sql`,
`backend/src/people/guardian-authority.service.ts`, `GuardianAuthorityPanel.tsx` and the existing
SchoolService leave command boundary. The module is deliberately not a generic authorization
engine; additional purposes require their own enforcement and acceptance work.

## WF-LOCAL-004: Complete reviewed bulk enrollment

Delivered as a substantial onboarding workflow, not an isolated import button:

1. Principal opens **Students & guardians → Import students**, downloads the CSV template,
   selects an existing active school term and uploads/pastes up to 500 student rows / 512 KB.
2. A resumable 24-hour draft is saved; no operational student or guardian records are created.
   Upload retries deduplicate by actor/school/key and reject changed content under the same key.
3. Validation checks required data, calendar dates, class/term scope, admission numbers,
   per-class rolls, existing records, explicit family groups and attendance-register state.
4. Staff edit individual rows, select a verified existing guardian, or skip unwanted/duplicate
   students. Repeated names/phones never merge records automatically. An explicit family key
   creates one shared guardian only when all included rows agree on that identity.
5. The final review shows included/excluded counts, new/reused guardians, identity warnings and
   submitted registers requiring review. Explicit confirmation binds to the draft revision and
   a fingerprint of the current validation state. Changed school data requires a new review.
6. The entire included batch saves atomically: people, students, guardians, primary family links,
   effective-date enrollments, empty subject-attendance totals, audits and outbox events.
   No login accounts, leave-signing permission or factual attendance marks are generated.
7. A persisted receipt and private CSV report are available through paginated import history.
   Committed raw rows are cleared. Discarded/expired drafts clear uploaded personal details;
   a 15-minute bounded retention sweep and direct expired-draft reads perform cleanup.

The mutation uses bounded batched inserts and ordered admission/class/guardian/register locks.
Duplicate commands replay the existing receipt. Locked registers block the batch; submitted
registers reopen once per affected register, keeping all marks and an audit of the roster change.
Historical teacher rosters exclude new students before their enrollment dates. Draft changes
emit administrator-only, ID-only events; commits coalesce roster invalidations by affected class.
No polling or outside provider is required.

Implementation: migration 012; `backend/src/people/import-*` and `people-import.*`;
`frontend/src/features/people/PeopleImportPage.tsx` and focused upload/review/editor components.
Detailed scope, CSV contract and limitations: [Bulk enrollment guide](BULK_IMPORT.md).

## ADR-001: Preserve the current web clients

Status: adopted for local implementation, 15 September 2026.
The PDF recommends Next.js/Expo as a starting point without auditing this repository. The
existing app already uses React, TypeScript, Vite and a same-origin Nest backend. The user
explicitly asks to preserve UI/UX. Replacing routing/build frameworks now adds migration work
without enabling the first daily loop. Retain them; evaluate native offline storage separately.

## Review checkpoints

1. Attendance follow-up: teacher creation, parent reply, assisted response and outcome review.
2. People/import/authority and day-plan changes: inspect role-specific workflows before approval.
3. Offline/paper operation: demonstrate pending, conflict and revoked-access scenarios.
4. Departure/care/transport: review documented authority and physical fallback before implementation
   is enabled for a live pilot. Synthetic tests are not a physical-safety approval.
5. Finance/intelligence: independent contracts and permission tests before widening scope.

## WF-STAFF-001: Staff onboarding and leave operations

Delivered as a bounded school-operations workflow on 3 October 2026. This is deliberately not
a payroll, salary, expense, recruitment-pipeline, appraisal or employee-surveillance system.

1. **Principal → More → Staff & leave** provides one mobile-first workspace for the staff
   directory, onboarding checks, leave approvals and leave-policy settings. A staff record holds
   service-record essentials only: school code, contact identity, teaching/non-teaching kind,
   designation, department, employment type and joining date.
2. New staff onboarding creates a single-use 72-hour school invitation when no active account
   already exists. Existing staff accounts are linked instead of duplicated. Invitation acceptance
   completes the account-access check; the record becomes active only after all required checks
   are complete. Existing staff memberships are backfilled with completed legacy checks.
3. The five auditable onboarding checks are identity, service contract, qualifications, emergency
   contact and account access. This aligns with the blueprint's staff-import/onboarding scope and
   CBSE's service-record and contract expectations without claiming that a checklist itself proves
   legal compliance.
4. Leave policies are school/year configuration. Leadership can set allowance, carry-forward cap,
   evidence threshold, paid/unpaid status, statutory label and availability. Starter Casual and
   Medical policies are editable examples, not statutory declarations. Statutory eligibility must
   be confirmed by the school against current applicable law.
5. **Teacher → More → My leave** shows allowance, adjustments, used, pending and available days;
   accepts full- or half-day applications with reason and handover note; and supports withdrawal
   while pending. The server counts working dates, rejects closure-only/overlapping/out-of-year
   requests, and rechecks balances at approval.
6. The principal approval card combines request reason, balance and derived timetable coverage.
   Approval records the affected published periods, writes immutable request history, emits an
   outbox event, notifies the teacher and invalidates staff/leave/timetable consumers. It does not
   silently rewrite teaching assignments; cover remains an explicit day-planning action.
7. School/role boundaries are checked for every read and mutation. Writes use row/advisory locks,
   optimistic revisions, cross-school database constraints, scoped foreign keys, audit records and
   RLS/revocation defense in depth for direct Supabase Data API roles.

Implementation: migration `028_staff_onboarding_and_leave.sql`,
`backend/src/staff-operations/`, `frontend/src/features/staff-operations/`, and the existing
invitation acceptance flow. Research inputs: CBSE Affiliation Bye-Laws 2018 (staff service records
and contracts), Ministry of Labour's current Maternity Benefit Act summary, and Microsoft Shifts'
employee-request/manager-decision interaction model. The product uses configurable policies rather
than treating example balances as universal legal entitlements.

Verified evidence:

- Clean disposable PostgreSQL migration from `001` through `028`.
- `staff-operations.integration.test.ts`: four passing end-to-end API cases covering existing-account
  onboarding, role denial, policy configuration, leave submission, timetable impact, approval,
  balance update, invalid withdrawal, audit and outbox delivery.
- Backend and frontend TypeScript/lint clean; full frontend suite: 32 files / 210 tests passing,
  including focused principal and teacher staff-workspace rendering/interaction checks.
- Local preview database migrated; local API `/readyz` reports database and event broker healthy.

Remaining acceptance gate: a school operator should review the principal and teacher mobile views
with its own leave rules before pilot use. Policy values and statutory categories are school-owned.

Do not silently change navigation or theme at any checkpoint. Record actual user acceptance
and keep open work visible. No release dates or production-complete claim are inferred here.

## Local verification — 15 September 2026

- Backend: source build and lint passed; 68 tests passed, including nine coordination
  integration tests for scope, graph integrity, duplicate commands, stale/concurrent replies,
  assisted attribution, closure rules and unchanged factual attendance.
- Responsive frontend: source build and lint passed; 78 tests passed. Staff desktop bundle:
  source build and seven tests passed. The new inbox is in the responsive teacher/principal
  shells, not yet in the separate `/staff` desktop workspace.
- Browser: signed in as the demo teacher, raised a follow-up from Aarav's saved 25 August
  absence, signed in as the linked parent and replied, then returned as the owner and resolved
  it. The three attributed journal entries persisted. PostgreSQL confirmed that attendance
  stayed `absent` at its original revision. The example is available under **Resolved**.
- Responsive checks at 320, 768, 1024 and 1440 px: no horizontal page overflow in the new
  inbox; phone and desktop layouts visually inspected. Native iPhone/Safari device acceptance
  and a full assistive-technology audit are still required.
- Runtime recovery: an open SSE stream exposed a shutdown-order deadlock. Moved stream
  closure into `beforeApplicationShutdown`, added a regression test, then repeated SIGTERM
  with the browser connected. launchd replaced PID 13282 with 13324; `/readyz` returned
  database/events OK and the browser resumed live updates. The readiness test now waits
  for readiness rather than only HTTP liveness, avoiding a broker-startup race.
- Local launchd registration lasts for this macOS login session. It cannot provide availability
  while the Mac sleeps, PostgreSQL stops, or the machine is off. No ngrok deployment in this slice.
- UI checkpoint: awaiting Abhishek's validation. No school/pilot acceptance is implied.

Lifecycle reference for the recovery fix: [NestJS lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events).

## People/enrollment verification — 15 September 2026

- Backend build and lint passed; 83 tests passed, including 15 people integration cases for
  account-free enrollment, scoped relationship constraints, explicit guardian reuse, pagination,
  duplicate/concurrent commands, revoked authority, expired reviews, effective-date rosters,
  submitted-register invalidation and locked-register rejection.
- Responsive frontend build and lint passed; all 83 tests passed, including enrollment review,
  retry/guardian selection, event invalidation and empty-attendance presentation. The separate
  staff desktop build and seven tests passed; its event protocol recognizes people updates.
- Browser enrollment saved synthetic **Ishaan Deshmukh**, admission **CIS-2026-0201**, Class 7A,
  roll 26, starting 15 September, with guardian **Nandita Deshmukh**. Neither has a login account.
  The current teacher register displays 26 students and Ishaan remains **Not marked**.
- Local database check: 201 students, 201 guardian relationships, zero students missing a
  guardian and zero students missing enrollment. Existing records were retained. A private
  pre-migration backup is in `.runtime/pre-people-20260915-2215.sql`.
- Enrollment/review layouts checked at 320, 768, 1024 and 1440 px without horizontal overflow;
  phone and desktop screenshots inspected. Physical iPhone acceptance remains outstanding.
- New students with no attendance history show **Not recorded**, not a failing 0% score.
  Missing gate evidence shows neutral **Not confirmed**, not an off-campus assertion.
- Local managed preview restarted for this increment. No ngrok or production deployment.
- User authorized continuing development; explicit UI acceptance of this new flow is pending.

## Guardian-authority verification — 15 September 2026

- Backend build/lint and all 89 tests passed. Six new integration cases cover account-free
  grants, actor/school scope, revoked administrator membership, optimistic revision conflicts,
  concurrent retry deduplication, inclusive dates/expiry, actual leave commands, retained past
  signatures and a signing query demonstrably waiting behind a revocation lock.
- Frontend build/lint and all 88 tests passed, including five permission-panel cases for
  confirmation, same-key retry after a newer SSE revision, stale forms, dates/cancellation,
  focus and load failure. All four Python data-generator tests passed, including preserving
  reviewed permissions during reseeding.
- Reviewed the working local form and confirmation at 320, 768, 1024 and 1440 px; no horizontal
  overflow. Phone and desktop screenshots inspected. Physical-device and assistive-technology
  acceptance are still pending.
- Migration applied to the backed-up local database. Private restore point:
  `.runtime/pre-authority-20260915-2247.sql`. `/readyz` reports database/events OK.
- The safety reviewer blocked saving the proposed Nandita/Ishaan preview grant without explicit
  user approval. No preview authority change was made; persistence and real leave enforcement
  were verified in the isolated test database. UI confirmation remains for the user to validate.
- Bulk import and the remainder of B1 are not yet complete. No ngrok or production deployment.

## Bulk-enrollment verification — 15 September 2026

- Backend source build/lint and **114 tests** passed: 17 dedicated import integration cases,
  seven CSV parser/export cases, plus an authenticated HTTP contract test for role, session,
  CSRF and private CSV downloads. Tests commit both 200- and 500-student batches in a separate
  synthetic school and assert complete family/enrollment graphs, no accounts/authority grants,
  no invented attendance, idempotent retries, conflict rollback and class-coalesced events.
- Frontend source build/lint and **99 tests** passed, including 11 import interaction cases for
  upload, retry, row correction, explicit guardian selection, skip/cancel, pagination, review
  verification and stale confirmation protection.
- Actual local browser flow: uploaded a three-row synthetic CSV; fixed Ved Kulkarni's invalid
  date, skipped already-enrolled Aarav, confirmed two siblings. Kaira (7A / roll 27) and Ved
  (7B / roll 26) share one new guardian, Madhuri Kulkarni, with no account or signing authority.
  Import receipt: `b1624c66-6a90-4979-a837-7440f108f5eb`. The school now has 203 students,
  zero students without guardian links, and zero students without enrollments.
- A separate three-row correction draft is available for UI validation; it has intentional
  invalid/duplicate rows and creates no additional students until confirmed.
- Responsive overflow checks at 320, 768, 1024 and 1440 px passed. Phone form and desktop
  validation table were visually inspected. Physical iPhone and full assistive-tech acceptance
  remain open. The existing school header, navigation, palette and typography were preserved.
- Migration 012 applied to local PostgreSQL after private backup
  `.runtime/pre-bulk-import-20260915-2332.sql`. Managed localhost preview updated; no ngrok or
  production deployment. These local tests are not evidence for a production-scale SLA.
- This completes the bounded CSV bulk-enrollment workflow, not all of Stage B or the blueprint.
  Next substantial milestone: daily plans and timetable-change coordination, with a complete
  staff-to-family change flow. Account invitations and other authority purposes remain explicit gaps.

## WF-LOCAL-003: Daily plan and coverage coordination — 16 September 2026

Blueprint traceability: sections 6–10 (adult-operated school day, timetable domain and closed
loops), 11–15 (non-app participation, versions, tenancy and reliable commands), and Stage B.
The dated plan is an exception to the weekly baseline, not a replacement timetable generator.

- The principal selects a school, class and date, prepares a private draft, adjusts periods,
  teacher, room, linked subject and materials, and records the reason and family notice.
  Saved drafts can be resumed or discarded without changing the currently shared schedule.
- Review/publish validates teacher and room conflicts, within-class overlaps, current teacher
  memberships, the school calendar, optimistic revision and the underlying weekly baseline.
  Started periods cannot be rewritten. Prior published versions are retained; a revision's
  author, reason and publication time are visible in history.
- Changed teaching arrangements request a teacher response. Accepting, declining, and an
  office-recorded phone/paper/in-person response are separate from student attendance.
  Assisted responses retain the actual receiving time, channel, note and recording actor.
  The publishing administrator owns unresolved coverage; the day desk highlights affected classes.
- A newly assigned substitute gets the class register only after accepting and only for that
  assigned date. Decline, cancellation or superseding reassignment removes that additional
  access. Existing weekly-teacher permissions remain unchanged. Register writes recheck scope
  inside the transaction; outbox audiences and replay also recognize accepted substitutes.
- Student/parent Home and Timetable consume the same dated schedule. Notices and materials
  appear only after publication; cancelled periods are excluded from the live day and kit.
  Subject attendance projections use the linked subjects from effective dated periods, excluding
  cancelled slots. Publishing or responding never invents an attendance mark.
- Publication, private in-app notices and events commit atomically. Command receipts deduplicate
  retries; current membership and family relationships are rechecked before event delivery.
  No periodic 30-second refresh was added. Weekly edits invalidate daily-plan caches and cannot
  create conflicts with published day allocations.
- The principal and teacher use the existing school header/navigation and blue/mint tokens.
  Native dialogs provide focus containment, Escape dismissal, labelled controls and focus return.
  Unsaved drafts warn on page exit and school/date/class changes. Published plans can be printed.

### Verification and local handoff

- Backend build/lint and **133 tests** pass, including 19 daily-plan integration cases against
  an isolated PostgreSQL database. Coverage includes publish/discard, shared family data, private
  drafts, conflicting/concurrent commands, retries, revoked authority, assisted attribution,
  superseded responses, weekly-source staleness, date-scoped register permissions, event audience
  revalidation and dated subject-attendance projections.
- Responsive frontend build/lint and **116 tests** pass; the staff desktop build and **7 tests**
  also pass. Frontend tests cover period editing, linked subjects/materials, save/publish confirmation,
  retry keys, stale edits, discard, coverage responses, cancelled periods, event invalidation
  the first-draft baseline regression, Sunday dates and named-room labels. There are **256 passing automated tests** across the three bundles.
- Browser: prepared a Class 7A / 16 September Mathematics cover draft. The safety reviewer
  requested explicit approval for publication; Abhishek approved publishing this specific demo
  plan. Published version 1, with Period 1 assigned to Kavita Mehta in the Activity Studio and
  Graph notebook/Ruler as materials. The already-open parent timetable updated via SSE without
  reload. Kavita accepted in the teacher UI, and the principal screen changed live to **Teacher
  confirmed**. Aarav's Home and Timetable showed the same notice; the actual checklist included
  both materials and its check/uncheck interaction worked. Test packing was reset afterwards.
- A rebuild during this walkthrough exposed an old lazy-chunk URL in an already-open session.
  Both Vite clients now retain hashed assets between local builds; the old tab was reloaded once.
  After a subsequent build, an already-open principal session successfully lazy-loaded the weekly
  editor and returned to the published plan; its previous asset URL still returned HTTP 200.
  Remote releases still need deployment-level multi-version asset retention (fresh container
  images do not inherit files from the previous image).
- Principal draft and period editor checked on a 320 px phone viewport; overall layout measured
  at 320, 768, 1024 and 1440 px without horizontal page overflow. Teacher day and parent timetable
  visually checked at 390 px. Physical iPhone/Safari and full assistive-technology acceptance remain open.
- Local migrations 013–016 applied after a private backup at
  `.runtime/pre-day-plans-20260916-0053.sql`. Existing synthetic school data retained. The managed
  local preview is updated; no ngrok, remote database migration, git push or production deployment.
  Final database check: **203 students**, zero missing guardian relationships, zero missing
  enrollments. Plan `05c5a956-74c2-42f8-ad55-6190cec378e7` is at published version 1 / revision 4,
  with an accepted app response (response revision 1) and no draft. All four day-plan events
  were published by the worker. Class 7A still has zero attendance marks for 16 September.
  `/readyz` reports database/events OK;
  launchd reports the managed preview running after restart (PID 53090 at verification).
- Local review starts at `/principal/timetable`, with the weekly editor still available at
  `/principal/timetable/weekly`. Teachers use `/teacher/timetable`; family routes stay unchanged.
- B3 attendance observation/offline/paper reconciliation is implemented locally below and awaits
  physical-device and school-operating acceptance. Do not widen into departure, transport or
  restricted care before their separate authority and safety gates.
- This completes the bounded implementation, not all Stage B, a production-scale SLA, or school
  operational acceptance. Await Abhishek's UI validation before further UI expansion.

## Teacher timetable UI upgrade — 16 September 2026

Implemented as an extension of WF-LOCAL-003, not a new scheduling domain.

- Replaced the teacher timetable's plain date input with a horizontally scrollable day strip.
  Teachers can step one week backward/forward, return to today and select any visible date.
- Added month and year views backed by a staff-authorized summary endpoint. The endpoint derives
  daily and yearly workload numbers from `effective_school_schedule`, including published dated
  plan overrides, coverage responses, cancellations and empty days.
- The month view shows the selected month's daily period load. The year view rolls the same
  authoritative daily summaries into monthly totals, keeping the page useful for workload scanning
  without introducing a separate projection table. These aggregate views expand in the date
  navigation area above the selected day's schedule, so the daily timetable card stays focused
  only on that day.
- Preserved the existing operations shell, blue/mint tokens, navigation and timetable list.
  The new controls use labelled buttons, visible focus states and large touch targets.

Verification:

- `npm --prefix frontend test -- day-plans.test.tsx`: 16 passing tests, including teacher
  calendar range and aggregation helpers.
- `DATABASE_URL=postgresql://abhishekyadav@127.0.0.1:5432/omnischool_node_test npm --prefix backend test -- day-plans.integration.test.ts`:
  19 passing integration tests, including the real teacher summary counts for an accepted
  coverage assignment.
- `npm --prefix frontend run build`: TypeScript and Vite production build passed.
- Managed local preview restarted; `/readyz` reports database/events OK, launchd reports the
  preview running. Browser check on `/teacher/timetable` showed the day strip, month/year views,
  the published 16 September schedule and no console errors or page-level overflow at the
  available viewport. Physical iPhone and full assistive-technology acceptance remain pending.

## Teacher attendance UI polish and live review runtime — 16 September 2026

Implemented as a design-quality pass on the existing attendance register, not a
new attendance workflow.

- Reworked `/teacher/attendance` into the established student/parent visual language:
  a blue register hero, clear class context, polished register status cards, compact
  attendance counters, softer roster cards, neutral unmarked rows, photo avatars,
  labelled search, and mobile-first controls.
- Preserved the existing register behavior: full-roster marking, revision/status
  metadata, principal lock/history actions, follow-up constraints and attendance
  submission guards.
- Changed the managed local preview so `http://127.0.0.1:8000` is now the live Vite
  app with hot React/CSS updates, while the compiled NestJS API runs behind it on
  `http://127.0.0.1:8001`. This keeps the review URL stable while avoiding rebuilds
  for frontend UI edits.

Verification:

- `npm --prefix frontend test -- TeacherAttendancePage.test.tsx`: 6 passing tests.
- `npm --prefix frontend run build`: TypeScript and Vite production build passed.
- `node --check scripts/preview-server.mjs` and `node --check scripts/local-preview.mjs` passed.
- Managed live preview restarted once to swap runtime modes. `curl -I http://127.0.0.1:8000/readyz`
  returned HTTP 200 and `curl -I http://127.0.0.1:8000/@vite/client` returned HTTP 200.
- Browser check on `/teacher/attendance?class_section_id=581087ee-9894-4b69-ad7c-f02861129c8b&date=2026-09-16`
  showed the refreshed register. A follow-up CSS contrast edit to the hero status pill
  appeared in the already-open browser without restarting, confirming HMR for frontend
  edits. Physical iPhone acceptance remains pending.

## Teacher register interaction and layout revision — 16 September 2026

Abhishek rejected the previous attendance UI pass. This revision replaces its tall
blue hero and repeated status cards with a compact class/date summary and inline
totals, following the existing family-portal tokens and blueprint section 6.

- Student rows expose one-tap Present/Absent choices, with Late, Excused, Half day
  and Not marked available through the same accessible native status selector.
  Optional remarks open on request; failed photos fall back to initials.
- All students / Not marked / Exceptions filters and search operate on the current
  editable roster. Submission still includes the entire class, including students
  hidden by filters. No blank mark is inferred as presence or absence.
- A fixed submit bar sits above the existing phone navigation and within the staff
  workspace on desktop. Locking, correction reasons, concurrent-change handling,
  retry keys, history and guardian follow-ups retain their existing behavior.
- Removed the superseded teacher-specific CSS and isolated the new register styles.
  The shared shell supports a page-owned heading without duplicate H1s.

Verification:

- Eight register tests pass, including quick marks/hidden-note preservation across
  filters, complete-roster submission, locked controls and existing lifecycle cases.
- Frontend lint and production build pass. Readiness returns database/events OK.
- Browser exercised Present, Late, note open/close and explicit reset to Not marked;
  these unsaved test changes were reset, and no attendance was submitted to the demo DB.
- Checked 320, 390, 768, 1024 and 1440 px layouts for page overflow. A 320 px filter
  overflow was corrected and rechecked (client and scroll widths equal).
- Frontend edits appeared through hot reload without a service restart. The local
  attendance screen is left open for Abhishek's UI review. Physical iPhone and full
  assistive-technology acceptance remain pending.

## Teacher timetable date-strip refinement — 16 September 2026

- Removed the standalone Today and previous/next-week controls at Abhishek's request.
  The date strip opens centered on the active date (today on the default route),
  supports horizontal scrolling, and recenters after date selection or resizing.
- Week, Month and Year share one equal-width control row below the strip. Week
  opens the existing weekly timetable; month/year aggregate views expand above
  the selected day's teaching schedule.
- The introductory headline, description and separate weekly link were removed.
  Following visual review, the selector uses a continuous blue date band with the
  shared student-home gradient and a uniform contrast overlay, transparent adjacent
  dates and one white selected-date pill. A small month/year context replaces the
  old headline. The dark nested tiles and boxed blue buttons were removed.
- Week/Month/Year sit in a quiet white footer; expanded month/year totals are a
  separate white section rather than nested inside the blue selector. Scroll-edge
  fades soften clipped dates, and interactive targets remain at least 44 px high.
- Date chips use the existing blue theme and full-date accessible labels. Pending
  totals show a loading state rather than incorrectly labelling missing data as free.
- Verified centering at initial load and after selecting 17 September, and verified
  month/year placement in the browser. Frontend build and 16 day-plan tests passed.
  Local Vite preview updates live without a service restart.
- The follow-up visual pass verified date selection to 16 September, month/year
  toggles, and no page overflow at 320, 440, 768, 1024 and 1440 px. Selected dates
  remained centered within 0.3 px across these checks. Lint and all 16 day-plan
  tests pass; the revised local timetable is available for user validation.

## Experimental photo-assisted attendance — 16 September 2026

This is an explicit user-directed deviation from the blueprint's initial privacy baseline and
Stage-D sequencing. It is implemented as a feature-flagged local experiment, not approved as a
production biometric capability. A real-student pilot still requires school privacy/legal review,
purpose-specific authorization, a non-biometric alternative, accuracy calibration, liveness and
operating procedures. The UI and API make no accuracy or liveness claim.

- Adapted the MIT-licensed Attendance Lab inference core into a private Python sidecar. Copied
  capabilities are limited to image validation, tiled YuNet detection, SFace embeddings,
  conservative one-to-one matching, encrypted local templates and seven-day analysis evidence.
  The prototype UI, database, credentials, test images and local data were not copied. Model
  binaries remain ignored and are obtained with manifest/hash verification.
- NestJS owns authenticated school/class scope, current staff assignment, principal-only reference
  enrollment, authorization references, audit events and final attendance. PostgreSQL stores only
  opaque provider identifiers and analysis provenance, not raw photos or embedding vectors. The
  sidecar is loopback/private-network only and uses a generated service token plus an encrypted
  SQLite store. The original classroom photo is not retained by the platform.
- A teacher opens **Take from photo** inside the existing class register, captures or selects one
  image, and reviews every roster row. Only strong one-to-one matches can suggest Present. Missing,
  unmatched and low-quality faces remain unmarked; photo processing never infers absence. All rows
  must be explicitly marked before returning to the register, and the result remains an unsaved
  draft until the normal revision-checked bulk submit succeeds.
- Principals see a separate **Reference setup** tab with an authorization reference, explicit
  authority acknowledgement, roster coverage and per-student enrollment. Teachers cannot enroll
  references. The ordinary manual register is always available if setup or inference is unavailable.
- Migration 017 adds tenant/class/person-constrained bindings, profiles and seven-day analysis
  sessions. A successful register submission links and atomically marks its source photo session
  applied; mismatched, expired, already-applied or cross-school sessions are rejected. Existing
  register idempotency, locks, corrections, events and audit behavior remain authoritative.
- The managed local preview now keeps the private sidecar alive alongside NestJS and the hot Vite
  client. A project-local Python environment avoids macOS launch-service access stalls. Docker
  Compose has the same service boundary, persistent encrypted data/model volumes and health gate.

Verification:

- Photo sidecar: **6 tests passed**, including private-route authentication, no prototype web UI,
  no accuracy claim, zero-face behavior and the invariant that not-seen is never absence.
- Backend: lint/build pass; the isolated clean PostgreSQL suite passes **134 tests** (133 existing
  cases plus the photo proposal-mapping invariant). Migration 017 was applied to the local demo
  database and to the isolated test fixture.
- Frontend: lint/build pass and **120 tests pass**, including reviewed photo marks remaining an
  unsaved draft and carrying their source session into the audited register submission.
- Runtime: `/readyz` reports database/events OK. The private health endpoint reports OpenCV,
  verified model files present, seven-day retention and `accuracy_validated=false`. The actual
  teacher register showed the new entry point and safe zero-reference fallback. The principal
  view showed the authorization-gated, principal-only roster enrollment flow. The themed dialog
  was visually inspected at the current phone-sized viewport without horizontal overflow.
- No real biometric reference was enrolled and no attendance was submitted during verification.
  Physical iPhone/camera capture, real classroom calibration, assistive-technology acceptance,
  privacy/legal approval and production operations remain open release gates. Await Abhishek's UI
  validation before widening or enabling this outside the local review environment.

## Attendance register action polish — 17 September 2026

- Kept the existing theme, class summary, roster, shared navigation and attendance lifecycle.
  On phone layouts, Take from photo and Mark all present now share an equal-width action row
  below the section heading instead of stacking against its right edge.
- Replaced inherited full-width management-button styling with scoped, compact History and
  Lock/Unlock controls. Icons and labels stay together; all four actions retain 44 px target
  heights, keyboard focus styling and existing permission/disabled behavior.
- Verified no page or action-label overflow at 320, 390, 768, 1024 and 1440 px. Reviewed the
  live phone layout and opened/closed history and the photo dialog. The nine existing register
  tests, frontend lint and production build pass. Local readiness reports database/events OK.
- Changes appeared through Vite hot reload without restarting services. No register was
  submitted or locked, and no student data was changed. Local UI is available for user review;
  physical-device and assistive-technology validation remain separate acceptance checks.

## Live mobile preview tunnel — 17 September 2026

- Repointed the reserved ngrok URL from the old attendance-lab process to the active local
  Eduvera preview on port 8000. Vite now accepts the reserved ngrok host during local review,
  so phone sessions reach the hot React dev server instead of receiving a host-header 403.
- Verified `http://127.0.0.1:8000` returns HTTP 200, the ngrok inspector reports
  `https://dalene-miraculous-sweepingly.ngrok-free.dev` forwarding to `http://localhost:8000`,
  and the public URL returns HTTP 200. The tunnel is intentionally a running local review
  session, not a production deployment.

## Photo roll-call mobile sheet polish — 17 September 2026

- Changed the photo roll-call dialog to match the existing class schedule bottom-sheet behavior
  on phone widths: bottom aligned, edge-to-edge, top grab handle, safe-area aware height and
  internal scrolling. Desktop/tablet keeps the centered modal treatment.
- Verified in the live browser at 320 x 760 and 390 x 844 with no horizontal overflow and exact
  viewport-width sheet geometry. At 768 x 900 it returns to the 720 px centered modal. Frontend
  lint, the nine attendance-register tests and the production build pass.

## Reference photo source choices — 17 September 2026

- Principal reference setup now offers separate Camera and Upload actions for each student.
  Camera keeps the user-facing camera capture hint; Upload opens the normal photo/file chooser.
  Successful enrollment shows a short animated Added tick on the student row after the setup
  data refreshes.
- Verified the reference setup tab at 390 px: the actions are side-by-side, equal width and
  there is no horizontal overflow. Frontend lint, the nine attendance-register tests and the
  production build pass. No biometric reference sample was enrolled during verification.

## Reference enrollment angle handling — 17 September 2026

- Separated broad face detection from the stricter classroom matching quality gate. The
  principal-authorized reference path now accepts a usable three-quarter left/right angle at a
  lower detector confidence and wider landmark asymmetry without changing classroom automatic
  match thresholds, absence safeguards or the one-person-only rule.
- Zero-face and multi-face failures now use plain, actionable guidance. Internal labels such as
  `weak_detection` and messages such as `expected exactly one face, found 0` are no longer shown
  to school staff. Full profiles are still rejected because the active five-landmark model needs
  both eyes for a dependable reference embedding.
- Added sidecar coverage for a usable lower-confidence enrollment angle and a zero-face failure;
  all **8 photo-attendance tests pass**. The live React/API/photo sidecar and reserved ngrok tunnel
  were restarted together, and the public app returned HTTP 200. A real side-view student photo
  was not retained or reused for automated verification.

## Photo review evidence and proposal repair — 17 September 2026

- Traced the broken face cards to the provider returning raw JPEG base64 while the web client
  requires an image data URL. The NestJS boundary now normalizes provider thumbnails to
  `data:image/jpeg;base64,...`; the React evidence card also has a themed, non-broken fallback if
  evidence cannot be decoded.
- Traced the missing Present suggestion to a clear enrolled face scoring 0.784 at the detector
  stage while the default detector floor was 0.88. The detector floor is now 0.75. Identity
  similarity, match margin, duplicate-face protection and teacher review remain unchanged, so
  lowering this detector-confidence gate does not allow unmatched classmates to be guessed.
- Only students with authorized reference samples can receive automatic Present suggestions.
  Unmatched/not-seen students deliberately stay unmarked; the teacher must review every roster row,
  return reviewed marks to the register, and submit through the existing audited register flow.
- Added provider regression coverage for a clear face above the revised detector floor and backend
  coverage for raw-base64 thumbnail normalization. Photo sidecar **9 tests pass**; the targeted
  backend service test, frontend lint and production build pass. The local web/API/photo stack was
  restarted and `/healthz` returned OK. The real classroom photo was not retained or replayed by
  the implementation verification.

## Nested detection suppression and local vision cross-check — 20 September 2026

- Investigated a real demo analysis without retaining or printing biometric pixels. The correct
  full-face detection was approximately 1083×1329 px; a second 336×443 px detection was completely
  contained inside it and corresponded to the subject's nose. Standard IoU NMS did not suppress it
  because the inner region was small relative to the outer face.
- Added asymmetric nested-detection suppression after ordinary NMS. A smaller detection is removed
  only when at least 90% contained by a box roughly three times larger; this targets facial-region
  artifacts without merging ordinary partially overlapping classmates. A regression case verifies
  that the larger full-face box wins even when the nested artifact has the higher detector score.
- Reconnected the existing provider-neutral analysis-mode field through React, NestJS and the
  private photo service. Setup now reports local vision-model availability, and the capture sheet
  offers an accessible **Local AI cross-check** option. In local development it uses the installed
  Ollama `qwen3-vl:4b-instruct` model; unavailable or malformed model output fails safely to manual
  review. LLM output remains a proposal and cannot infer absence, bypass full-roster review, or
  submit the authoritative register.
- The local analysis timeout is aligned to five minutes for the on-device vision model. Photo
  service **11 tests pass**, including nested suppression and an end-to-end local-LLM request;
  the backend targeted test/build, frontend lint and production build pass. Local `/healthz` and
  the approved dummy-data ngrok URL returned HTTP 200 after restart. Physical UI inspection is
  awaiting an unlocked host and user validation on the phone.

## Local vision-model fallback — 20 September 2026

- Fixed a local photo-attendance failure where Ollama could be running with a text-only model and
  return `Multimodal data provided, but model does not support multimodal requests`. The photo
  sidecar now checks model image capabilities when available and, more importantly, catches this
  provider error during analysis.
- A failed or non-image-capable local AI cross-check no longer fails the whole photo roll-call.
  The system falls back to the existing face-embedding proposals, returns a staff-facing warning,
  and keeps the full roster review requirement. It still never infers absence from a photo.
- Verification: frontend production build passed; backend production build passed from the
  hydrated preview copy; a direct sidecar regression covered normal vision mode, non-vision model
  status and the exact multimodal provider error. The live local preview was restarted and both
  `http://127.0.0.1:8000/login` and the reserved ngrok `/login` returned HTTP 200.
- Follow-up correction: separated the photo-attendance vision model from the backend text copilot
  model. Local preview and Compose now pass `qwen3-vl:4b-instruct` to the photo sidecar through
  `PHOTO_ATTENDANCE_OLLAMA_MODEL`, while `OLLAMA_MODEL=qwen3:8b` remains available for text-only
  assistant work. The running sidecar reported `supports_images=true` for `qwen3-vl:4b-instruct`;
  local and ngrok `/login` returned HTTP 200 after restart.

## Dated attendance eligibility and register integrity — 20 September 2026

- Replaced term-wide teacher assignments as the daily attendance source with the effective
  timetable for the selected school date. A teacher now sees and can act only on an active
  class/activity period assigned to them, or accepted dated cover. Administrators retain
  school-wide oversight only for classes that actually have an attendance-eligible period.
- Enforced the same rule at every write boundary. Direct/stale register URLs are read-only,
  photo analysis cannot start, the transactional bulk-save path rechecks the effective schedule
  after locking the class/register context, and overdue-alert generation ignores cancelled or
  unscheduled lessons. Future dates and empty rosters remain non-actionable.
- Daily teacher/principal summaries, due/submitted counts, empty states and monthly/yearly period
  totals now derive from the same dated schedule semantics. Existing records are never silently
  deleted: records without a lesson stay visible for principal review as schedule mismatches.
- Added a second integrity check for the saved submitter. A submitted register counts complete
  only when its submitter is an active administrator or matches the current dated teacher/accepted
  cover assignment. The local Saturday Class 6A legacy record is therefore shown as an
  **Assignment mismatch**, remains auditable, and no longer inflates the submitted count.
- Verification: frontend targeted suites pass **17 tests**, frontend production build and lint
  pass, backend build and lint pass, photo/event service suites pass **4 tests**, and the focused
  PostgreSQL integration suite passes all **4** dated-schedule, future-date, authorized-submit and
  overdue-alert cases. Live browser review confirmed Sunday shows zero due registers for teacher
  and principal, a stale teacher link is fully read-only, Thursday shows only three genuinely
  assigned classes, and Saturday surfaces the legacy assignment mismatch. Local and reserved
  ngrok `/login` endpoints both returned HTTP 200 after restart.

## Persistent local mobile-review supervisor — 21 September 2026

- Consolidated the React dev server, NestJS API, private photo-attendance worker and reserved
  ngrok tunnel under the detached `preview-daemon` supervisor. The supervisor remains attached to
  PID 1 for the current macOS session and stops the whole stack if a required child exits, avoiding
  a misleading tunnel that serves only part of the application.
- Isolated frontend, backend and photo-service execution under the OS temporary directory so
  iCloud-backed `Documents` hydration cannot stall dependency discovery after screen lock.
  Dependency installs are content-hash cached; frontend/backend source edits are mirrored into
  the runtime automatically, and transient Python caches are excluded from runtime copies.
- Replaced `tsx` execution with a TypeScript build/watch plus Node watch process because NestJS
  constructor injection requires emitted decorator metadata. This repaired the frontend shell
  loading while `/api/v1/auth/session/` returned 500.
- Verification: the detached supervisor is running with PPID 1; local web and photo health return
  HTTP 200; the local and public session endpoints return HTTP 200; and a teacher/staff demo session
  is created successfully through `https://dalene-miraculous-sweepingly.ngrok-free.dev`.

## Stage feature-line integration — 29 September 2026

- Integrated the latest `origin/Stage` administration, fees, governed chat and safeguarding work
  with this branch's attendance, timetable, people, day-plan, event-delivery and photo-attendance
  modules. Both backend module graphs and all mobile routes remain registered; teacher attendance
  access keeps the stricter dated-assignment rule.
- Kept Stage's already-published chat/operations migration filenames unchanged so previously
  applied migration checksums remain valid. The independent attendance/event migrations coexist
  under their distinct full filenames and are serialized by the existing advisory-locked runner.
- Preserved release-time migrations and explicit demo seeding in the Stage workflow; container
  startup remains schema read-only. The repeat-safe operations seed now runs in isolated CI and
  only during an explicitly requested Stage re-seed.
- Verification from an index-backed local copy: backend build, typecheck and lint pass; **37**
  backend unit/safety tests pass; mobile typecheck, lint and production build pass with **134**
  tests; desktop typecheck and production build pass. Database integration remains delegated to
  the workflow's disposable PostgreSQL service because no isolated local PostgreSQL server was
  available during this merge.

## Campus events and activities — 30 September 2026

- Added school-scoped event drafts, publishing, cancellation and completion for excursions,
  annual functions, sports, workshops, competitions, assemblies, PTMs, clubs and other school
  activities. Teachers can create assigned class tests within their dated class/subject scope.
  Event participation and event-session attendance remain explicitly separate from the daily
  academic attendance register.
- Principal operations cover audiences, independently configured mandatory/optional participation,
  RSVP, purpose-specific guardian consent, staff duties, programme sessions, subgroup rosters,
  packing requirements and event attendance. Family views expose only linked-child participation
  and per-session attendance. Cursor pagination uses an explicit Load more action rather than an
  unbounded background fetch, and event routes preserve each role's established primary navigation.
- Paid optional events create the authoritative invoice only after acceptance. A pre-event family
  withdrawal removes the place, preserves the invoice/payment record and appends a full credit.
  Collected money becomes refund due; authorized finance staff record a manual cash, bank-transfer
  or cheque refund with amount, reference and reason. No gateway refund is claimed. Event
  cancellation uses the same immutable credit/refund reconciliation path and is deliberately
  blocked after the event starts; a post-start abort/reconciliation workflow is a separate release.
- Migration 019 adds append-only withdrawal, invoice-credit and refund facts with integer paise,
  school-scoped references, over-credit/over-refund guards, audit, idempotency and outbox delivery.
  Broad event invalidations contain no child identity; linked-family notifications retain their
  private context. Ordinary event staff receive only coarse payment readiness, while authorized
  finance users and the linked family can see the relevant ledger-derived amounts.
- The final clean-copy backend campus-event, authorization, finance, migration and privacy gate
  passes **34 tests**; backend typecheck, lint, production build and the **8-case** repeat-safe seed
  verification pass. Responsive frontend typecheck, lint and production build pass, alongside
  **37 focused event/API/realtime/navigation tests** run serially to avoid the workspace worker
  startup issue.
- The local PostgreSQL review tenant was migrated and loaded successfully with **203 students and
  203 guardian relationships**, including the three legitimate post-fixture students. The event
  reconciliation seed was then run again successfully: immutable payments/consent authorities are
  guarded before their validation triggers, upcoming Class 7A rosters reconcile to **27 students**,
  and completed/locked event history is not expanded by later enrollments.
- UI checkpoint: principal/teacher operations plus parent/student event and reconciliation screens
  are ready for Abhishek's review. Physical-phone and assistive-technology acceptance remain open.
- Principal event creation was blocked by malformed SQL in the subject catalog's lateral query.
  Removed the extra closing parenthesis and added a principal/teacher catalog integration case.
  Verified the live principal and teacher catalog APIs each return HTTP 200, the local and ngrok
  `/principal/events/new` routes each return HTTP 200, and backend typecheck passes. The new
  automated integration case could not run locally because the existing disposable test database
  role lacks `campus_events` access; the real local review database endpoint was exercised instead.
- Release boundaries remain explicit: generic events do not yet perform the new symmetric
  participant-level collision pass against an already-published class test; accountless assisted
  event consent/RSVP needs a school-approved purpose-authority and attribution design; and the
  repository-wide non-owner PostgreSQL runtime/RLS context remains the existing B6 release gate.

## Stage navigation and deployment integration — 30 September 2026

- Merged Stage's mobile More, Calendar and Teacher Classes routes and desktop design-system update
  with the campus-event routes. Teacher and principal event entry points now live in More rather
  than duplicate home-page actions; parent events are also reachable from More, and event screens
  keep More selected in each role's navigation.
- Reconciled Stage's desktop fee-ledger presentation with the event-credit accounting rules:
  adjusted billed, outstanding and refund-due figures remain ledger-derived, credited invoices
  cannot accept further payments, and the displayed collection state reflects refunds.
- Verified mobile, desktop and backend typechecks and production builds; desktop's 11 tests,
  the 23 focused campus-event UI tests, and the event-navigation route test pass. Backend lint and
  52 non-database tests pass. Full backend integration still requires CI's isolated PostgreSQL
  service; the local test command has no `DATABASE_URL` and therefore cannot run those suites.
- Stage deployment verification remains pending until its push-triggered CI workflow and Railway
  health gate complete; this line does not claim a successful deployment before that evidence.
- The first push (`d95b7cf`) passed the secret scan and isolated backend integration tests but
  did not deploy: mobile CI failed on two timing-sensitive parent-home tests and one event-time
  assertion that depended on the runner's timezone. Event and attendance times are now rendered
  in `Asia/Kolkata`, and the mobile test runner uses bounded worker concurrency and realistic
  timeouts. The follow-up full CI and Railway health gate are still pending.
- Mobile navigation now shows at most four tabs per role, including More; teacher/principal
  messages and safeguarding, parent timetable/leave, and student diary/messages remain reachable
  in More. Removed the redundant More shortcut beside each top-bar avatar and added a regression
  test for the four-tab/header rule.

## Responsive school administration and fees — 30 September 2026

- The principal More catalogue now opens responsive **School administration** and **Fee ledger**
  routes in the established operations shell. Administration includes academic terms/classes/
  subjects, reviewed class promotion, existing student/guardian enrolment and import links,
  invitations, member permissions, audit history and new-school provisioning. Existing backend
  permission, transaction and audit boundaries remain authoritative for every command.
- Principal fees show ledger-derived adjusted billed, received, outstanding and refund due,
  student filtering, immutable invoice posting, confirmed offline cash/bank/cleared-cheque
  receipts and a printable statement. Parent/student More pages now expose linked-child
  read-only invoices and receipts through the existing family-scoped fee endpoint. This is
  **not** an online payment gateway or completed bank reconciliation workflow.
- The operations overview and invoice picker now include accountless canonical students;
  the overview guardian list also reads canonical school people rather than requiring a login.
  An isolated-database integration case covers accountless invoice eligibility, but was not
  run in the local live review database because that test mutates records. The local demo
  administrator API returned 203 students in administration and the fee picker, and 16
  invoices; linked demo parent and student fee reads each returned HTTP 200 with one invoice.
- Responsive frontend typecheck, lint and production build pass; the 42 route tests and five
  backend operations unit tests pass. Backend typecheck and build pass. The managed local
  preview returned HTTP 200 for `/principal/fees`, and `/readyz` reported database/events OK.
  Visual acceptance on the user's phone remains open; no Stage/Railway deployment is claimed.
- Mobile principal administration now uses a compact school overview, current-term context,
  sticky icon tabs, task-first setup links and collapsed high-consequence workflows for class
  promotion and school creation. Access management separates invitations from members and keeps
  every existing authorization, confirmation and audit path intact.
- Mobile fees now leads with collectible balance and supporting ledger totals, separates invoice
  and receipt registers, exposes invoice and print tasks as large controls, and presents each
  invoice as an actionable balance card. The linked-family read-only ledger retains its compact
  invoice layout. The refreshed frontend passes typecheck, lint, production build and all **163**
  tests; the live local routes `/principal/administration`, `/principal/fees` and the shared office
  stylesheet each return HTTP 200. Physical-phone visual acceptance remains open.
- Academic setup is now a persistent catalogue workflow rather than an inline demo form. Terms,
  classes and subjects open in an accessible desktop dialog/mobile bottom sheet, preserve the
  selected record, expose dependency counts, and save all supported fields. Term availability and
  subject timetable color/icon are editable. Member access editing now uses the same immediately
  visible sheet instead of rendering below the long staff directory. Linked-record changes require
  an explicit impact review and reason; academic-year transitions remain new records instead of
  rewriting history.
- Migration `021_school_catalog_concurrency.sql` adds catalogue revisions, accountable editor/time
  fields and structured operations-audit metadata. Updates use optimistic concurrency, retain
  stable record IDs, reject no-op/stale writes, append target/reason/dependency context to audit,
  and enqueue `administration.updated` in the same transaction for authorized event-driven cache
  refresh. Hard deletion is deliberately not exposed because referenced timetable, enrollment and
  attendance history must remain intact.
- Verification after this change: backend typecheck, lint and production build pass with the
  focused catalogue validation test; frontend typecheck, lint, production build and all **169**
  tests pass. The local migration is applied, `/readyz` reports database/events OK, and the live
  administration read model returns HTTP 200 with **203 students, 1 term, 8 classes and 8
  subjects**. The new isolated-PostgreSQL conflict/audit/outbox integration case is committed for
  CI but was not run against the shared local demo database. Physical-phone UI acceptance remains
  open.

## Role-aware Home action inbox — 1 October 2026

- Replaced permanent empty action panels with a role-scoped, priority-sorted Home action projection.
  Parent and student views derive the next event step from RSVP, guardian consent, fee balance and
  required checklist state; declined or withdrawn participation no longer leaks into preparation
  actions. Leave signatures and diary acknowledgements share the same queue.
- Teacher Home exposes only assigned attendance registers, owned attendance follow-ups and assigned
  event duties. Principal Home consolidates all incomplete registers into one operational action so
  event and coordination work is not crowded out. Empty action, follow-up, diary and class modules
  are omitted rather than showing reassuring placeholders.
- Domain records remain authoritative. The Home queue contains links and summaries only, and each
  mutation still executes in its owning leave, diary, coordination, attendance, fee or event module.
  Diary acknowledgement now writes its outbox event in the same transaction; campus-event and
  coordination events invalidate only affected Home caches over the existing SSE channel.
- Verified against the seeded local database for parent, student, teacher and principal personas.
  Backend/frontend typechecks, lint and production builds pass. The focused Home, realtime protocol
  and route suite passes **60 tests**. `/readyz` reports database/events OK; physical-phone visual
  acceptance of the new Home hierarchy remains open.

## Role-aware Home hierarchy — 1 October 2026

- Reworked the teacher Home first as the design pilot, then applied the approved hierarchy to parent,
  student and principal Home while preserving each role's established navigation and identity patterns.
  Teacher and principal use the cobalt feature surface for current operational state, progress and the
  single highest-priority action. Parent and student retain the blue digital identity card and attach the
  single live action as a separate accessible dock, so tapping the card still opens student identity.
- Lower-priority work moves into a quiet, single-heading `Later` list. Empty action, follow-up and
  principal exception modules do not reserve space. Principal totals no longer compete with exceptions
  and register workload, while parent term metrics now read as one grouped surface rather than four
  unrelated cards.
- Attendance progress is represented once, with the full register rows remaining authoritative and
  directly actionable. Detailed follow-ups still render only when open, and timetable detail remains
  one tap away. The established Eduvera type, cobalt accent, shell, headers and navigation are unchanged.
- The teacher pilot received user visual approval. Cross-role typecheck, focused tests, production build
  and local route health are the acceptance checks for the expanded implementation; phone review of
  parent, student and principal Home remains the final visual gate.

## Shared heading hierarchy — 2 October 2026

- Standardized the parent and staff shells around one direct page label. Staff shell subtitles no
  longer create an uppercase heading above the page title, and routes with their own content heading
  suppress the duplicate shell title. Parent page labels now use the same formal title treatment on
  every route.
- Replaced promotional or ambiguous labels including “Academic Pulse,” “Presence Pulse,” “School
  pulse,” “Next best actions,” and “work desk” with task-oriented names such as “Current class,”
  “Today's attendance,” “Today,” “Class registers,” and “Diary.” Administration, fees, events, More,
  and student services use the same plain-language hierarchy without changing the established theme,
  navigation or workflow behavior.
- Frontend typecheck, lint, production build, and all **177** tests pass. The rebuilt local Docker
  preview reports database/events ready and the teacher Home hierarchy was visually checked at the
  mobile breakpoint. Cross-role user visual review remains the acceptance gate; no external deployment
  or production-readiness claim is made by this entry.

## Operational surface density — 2 October 2026

- Consolidated the teacher/principal attendance summary to one editable date, one set of authoritative
  register totals and one list heading. Removed the repeated human-readable date, duplicate due count,
  decorative icon and explanatory paragraph while preserving assignment-mismatch, review and audit
  behavior.
- Reduced minimum height and padding across shared timetable, class and campus-event feature surfaces.
  Generic explanatory copy was removed where the adjacent data and controls already communicate the
  task. Student attendance no longer repeats its percentage inside the donut, eligibility policy copy
  is concise, and the diary summary no longer repeats shell-level student identity.
- Teacher and student Home identity/day cards were explicitly excluded and are unchanged by this pass.
  Frontend typecheck, lint and all **177** tests pass. The local teacher attendance route was visually
  checked at the mobile breakpoint; cross-role physical-phone review remains open.

## Principal family contact directory — 2 October 2026

- Reworked Students & guardians into a mobile-first contact directory. Students are grouped by
  name initial, represented by their persisted profile photo with an initials fallback, and paired
  with compact guardian avatar stacks. Expanding a student reveals linked guardian phone,
  relationship, login state and the existing authority-management action without duplicating every
  family record in the default scan view.
- Search now updates after a short debounce and A–Z controls request an exact server-side initial.
  The people API returns student `avatar_url`, orders stable cursor pages by student name, and
  preserves authorization and 25-row pagination. The frontend includes a compatibility fallback for
  older review backends so alphabet filtering remains accurate while the backend release catches up.
- Frontend typecheck, lint and all **177** tests pass; backend typecheck and lint pass. The local
  principal directory, expanded guardian row and alphabet filtering were visually checked at the
  mobile breakpoint. The isolated people integration suite could not complete against the already
  active shared database and remains an open release check.

## Adult profile imagery — 2 October 2026

- Added six consistent, square directory portraits for four seeded guardians (Pooja Sharma, Rashmi
  Joshi, Nandita Deshmukh and Pooja Chauhan), principal Meera Kapoor and teacher Kavita Mehta. The
  assets are bundled with the application rather than referenced from expiring external URLs.
- Added additive `avatar_url` fields to account and school-person identities. Authentication now
  carries adult account imagery, the people directory returns the guardian image, and chat recipient
  discovery falls back from a student portrait to the adult account portrait. The deterministic school
  generator preserves all six mappings across reseeds.
- The shared account menu, demo persona picker and family contact directory render the same identity
  image with initials retained as the fallback. A temporary exact-person frontend fallback keeps the
  local review UI complete while an older backend remains connected.
- All seeded student directory rows now have a stable visual fallback when an older API omits
  `avatar_url`. The four generated guardian portraits are distributed deterministically across every
  seeded guardian profile and parent account; local verification reports **201/201** guardian school
  profiles and **199/199** parent accounts with persisted imagery.
- The migration was applied transactionally to the local PostgreSQL database and verified for all six
  intended people. Frontend/backend typecheck and lint pass, all **177** frontend tests pass, all seed
  integrity tests pass, and backend unit tests pass; database integration suites still require their
  isolated `DATABASE_URL` test database.

## Role-aware operational calendar — 2 October 2026

- Replaced the month-only calendar with URL-addressable Month and Day modes. Month navigation,
  day navigation, Today, direct date selection and the seven-day Day strip all keep the selected
  school date in the URL, so refresh and back/forward navigation preserve the current context.
- Calendar indicators now aggregate the records relevant to each role: campus events and class tests
  for all authorized audiences, attendance and leave for students and families, and school holidays for every
  portal. Selecting a date opens the existing authoritative timetable, register, leave or event
  workflow rather than duplicating mutations inside the calendar.
- Added a tenant-scoped school-calendar read endpoint with active-membership authorization, strict
  ISO date validation and a bounded 92-day range. The deterministic school seed and additive
  migrations include Gandhi Jayanti as a non-instructional day. Non-instructional overrides suppress
  recurring periods and register workload while retaining explicitly scheduled events.
- Loading, empty, error/retry and selected-day states are present, indicators pair shape/labels with
  colour, and controls retain keyboard-visible native button semantics. The existing Eduvera cobalt
  visual system, role headers and navigation remain unchanged.
- Frontend/backend typecheck and lint pass, the production frontend build passes, all **180** frontend
  tests, **53** backend non-integration tests and all **8** deterministic seed integrity tests pass. The localhost preview is healthy
  and Month, Day, event and holiday states were visually checked at the mobile breakpoint. Physical
  phone and cross-role visual acceptance remain the release gate; the additive calendar migrations
  still need to be applied through each deployment environment's normal migration pipeline. Database
  integration suites remain unverified because this workspace has no isolated integration-test
  `DATABASE_URL`; they were not pointed at the active shared database.

## Principal timetable mobile hierarchy — 2 October 2026

- Simplified the principal daily timetable without changing its workflow or navigation. The page now
  has one `Timetable` heading, a compact date/class selector, concise class context and the existing
  weekly-view path. Repeated date headings and promotional schedule labels were removed.
- Replaced the overlapping iOS date/class row with a responsive grid that stacks the native controls
  on phones. Non-instructional days hide the class selector because class choice cannot change a
  school-wide closure. The native date/select controls use grid stretching rather than percentage
  widths, preventing iOS Safari from resolving the date input against the outer card and overflowing
  its padded content area.
- A non-instructional date with no explicit plan now renders one compact school-closure surface. It
  does not offer prepare or print actions that cannot produce a valid regular schedule. Explicitly
  published dated plans remain visible and editable under the existing authorization and validation
  rules. Its action opens the school calendar instead of repeating the weekly-view action.
- Normal school days retain plan preparation, revisions, printing, coverage, history and the full
  period list. Empty instructional schedules use a compact inline state rather than reserving a large
  card. The established Eduvera type, cobalt palette, staff header and four-tab phone navigation are
  unchanged. The selected class, schedule status, revision control and print control now share one
  schedule header rather than repeating the class context in a separate block.
- All **180** frontend tests, the production build, typecheck and lint pass. The Gandhi Jayanti closure state and a
  populated Class 6A day were visually inspected at the mobile breakpoint in the live local preview.
  Physical-phone acceptance remains open.

## Mobile term timetable management — 2 October 2026

- Replaced the principal's flat weekly management list and single-period form with a class-first,
  term-scoped management workspace. The primary `Timetable` module continues to open the published
  schedule; principals enter `Manage timetable` only when changing the weekly plan, targets or school
  dates. A principal can select an academic term, swipe between classes and weekdays,
  see completed class-days, total periods and teacher/room conflicts, then edit only the focused
  day's ordered schedule. The weekly baseline remains the authoritative pattern repeated throughout
  the selected term; dated day plans continue to own exceptions and cover changes.
- Period editing now uses a phone bottom sheet with large native controls and automatic next-period
  defaults. New periods start five minutes after the focused day's final period and retain the
  selected class, room, term and weekday. Class periods require a subject; breaks and activities use
  a descriptive title. Existing period edit and removal paths remain available from each row.
- Added an atomic Copy day workflow for one or more target weekdays. Existing days are visibly
  identified and require an explicit replace confirmation. The server validates term/class scope,
  active school ownership, target contents and teacher/room clashes while holding the school's
  schedule transaction lock; replacement, audit history and the timetable outbox event commit in the
  same transaction. Published dated plans remain protected from silent baseline changes.
- The principal timetable read model now exposes all school terms, selects one explicitly through
  the URL and filters class/slot/conflict data to that term and academic year. Existing slot creation
  also accepts the selected term and rejects cross-year class/term combinations. No database schema
  migration was required.
- Backend and frontend typecheck, lint and production builds pass. All **183** frontend tests and
  **49** backend non-integration tests pass; the focused builder suite contributes **3** workflow
  tests. An isolated-database API case now covers the term read model and atomic day copy, but was
  not run against the active shared demo database. The authenticated Class 6A builder, automatic P7
  defaults and guarded Monday-to-Tuesday copy flow were visually checked at a 393 px mobile viewport.
  Physical-phone acceptance remains open.

## Timetable calendar exceptions and curriculum coverage — 2 October 2026

- Extended the mobile term builder without replacing the accepted weekly-baseline model. Principals
  can now record public holidays, school holidays and emergency closures as dated school-calendar
  exceptions, while the existing daily-plan workspace remains the path for teacher cover, moved
  periods and cancellations on an otherwise instructional date. Closures suppress both recurring
  slots and published dated schedules in the effective projection without deleting their history.
- Added class-and-subject curriculum targets expressed as minutes per academic term. The principal
  coverage view compares those targets with projected effective periods and hours across the whole
  term, including dated plans and excluding closures. Each class reports configured subjects,
  weekly period counts, projected hours and remaining gaps; school-level totals identify ready
  classes, subject gaps and configured targets.
- Target and closure writes are principal-only, tenant-scoped and transactionally serialized. They
  use optimistic revisions, database constraints, audit entries and outbox events. A date cannot be
  closed or reopened after attendance has been recorded, submitted or locked. Emergency closures
  additionally create role-appropriate in-app notices, while all calendar changes invalidate the
  affected role calendars, timetables and Home projections through the existing event channel.
- Added migration `027_timetable_curriculum_and_calendar_management.sql`, including the target table,
  richer school-calendar metadata, tenant indexes, row-level security and explicit privilege
  revocation. It was applied to the local Docker database after a recoverable backup. The API image
  was rebuilt and is healthy on port 8001; the Vite hot-reload preview remains on port 8000 and is
  exposed through the existing ngrok tunnel.
- Frontend typecheck, lint and production build pass; all **185** frontend tests and **53** backend
  non-integration tests pass. A focused isolated-database API test covers target creation, stale-write
  rejection, closure creation, projected-hour reduction and closure removal. Weekly plan, term
  coverage, target editor and school-date sheet were visually checked at the mobile breakpoint.
  Physical-phone acceptance and the normal deployment migration pipeline remain open release gates.

## Shared role-aware timetable views — 2 October 2026

- Standardized the primary timetable module around one shared date strip and Day, Week, Month and
  Year switcher for principals, teachers, students and parents. The selected date and view are URL
  state, so browser navigation, refresh and shared links retain context. The existing weekly
  timetable management workspace remains a separate principal-only editing workflow rather than
  being mislabeled as a read-only Week view.
- Kept role context in the data, not in four competing navigation designs. Principals see the
  selected class and unresolved coverage counts; teachers see only their assigned and accepted
  teaching periods; students see their class schedule; parents see the selected child's schedule.
  Student and parent Day/Week content remains read-only, while staff actions stay in the authorized
  day-plan and timetable-management workflows.
- Added tenant- and role-authorized timetable summary reads for principal and family portals. Month
  and Year totals are calculated from `effective_school_schedule`, so closures, cancellations and
  published dated plans are reflected instead of extrapolating an obsolete recurring template in
  the browser. Summary ranges are validated and capped at 370 days.
- Interaction research used the official Google Calendar and Microsoft Outlook/Teams patterns:
  quick view switching, stable selection, previous/next date navigation and a selected-day agenda.
  The implementation retains Eduvera's established cobalt strip, compact mobile surfaces, headers
  and four-item navigation rather than copying those products' visual styling.
- Frontend/backend typecheck, lint and production builds pass. All **186** frontend tests and **53**
  database-free backend tests pass. Database integration suites remain gated on an isolated test
  `DATABASE_URL`; the active shared demo database was not used as a test target. Visual validation
  and physical-phone acceptance remain open because the managed local preview could not bind ports
  inside the restricted execution environment for this run.

### Principal summary compatibility follow-up — 2 October 2026

- The live principal preview was still connected to an older API image that did not expose the new
  `/api/v1/day-plans/admin/summary` route, leaving Week, Month and Year in an error fallback even
  though the published timetable builder read model was available. The principal client now falls
  back only on an explicit 404 and derives the requested range from the authorized published
  timetable read model, including term boundaries, the selected class, weekly slots, unassigned
  periods and non-instructional school-calendar exceptions. Other server errors still surface and
  are not hidden.
- Corrected Month totals to include only dates in the displayed month; the wider summary range used
  to populate the scrolling date strip no longer inflates the visible month total.
- Removed staffing-warning badges from the compact date, Week, Month and Year cells after phone
  validation showed that any corner badge competed with the weekday label. Assignment gaps remain
  available in the detailed timetable-management workflow where they have adequate context.
- Moved the principal class selector into the blue timetable scope header, ahead of the date strip
  and view switcher. Week, Month, Year and the selected-day schedule now visibly inherit one class
  choice; the detached selector surface below the overview was removed.
- A focused fallback test passes, and frontend typecheck and lint pass. The authenticated local
  principal view was visually verified with populated Week, Month and Year views; October Class 6A
  shows the Gandhi Jayanti closure as zero periods and a 141-period month total. The new API remains
  the authoritative path once the backend image is rebuilt because it also accounts for published
  dated-plan overrides.

### Fail-safe sign-out — 2 October 2026

- Sign-out now clears cached school data and authenticated client state immediately, before the
  revocation request. An explicit local logout marker prevents a stale HttpOnly session cookie from
  silently signing the user back in after a refresh when the API is temporarily unavailable; a
  successful login, registration or demo selection clears that marker.
- The logout marker also retains the server-advertised demo-mode flag, so the test persona buttons
  stay available after logout and browser reload in local and Railway testing environments.
- The logout endpoint is public and CSRF-independent because it only removes authority. It clears
  both cookies before doing database work, then best-effort revokes the hashed session and records
  the audit event. An expired session, stale CSRF token, audit failure or transient database error can
  no longer trap the user inside the signed-in UI.
- The complete authentication loop is now covered: transient CSRF bootstrap failures retry before
  login, registration or demo entry; a stale CSRF rejection refreshes once; and integration coverage
  verifies demo login -> logout -> anonymous session -> password login in one browser. The signup
  password guidance and browser validation now match the backend's 12-character policy.
- The local live-preview supervisor builds backend artifacts in a scratch runtime rather than the
  macOS Documents/File Provider folder, mirrors edits through descriptor-free polling, and restarts
  ngrok/photo attendance independently so an optional service failure cannot take authentication down.
- The Vite development proxy now normalizes the internal API-hop `Origin` to its trusted localhost
  origin. This prevents ngrok phone requests from being rejected by the intentionally strict backend
  CORS allowlist while leaving browser-facing tunnel URLs, cookies and production CORS unchanged.

### Family timetable summary compatibility — 2 October 2026

- The parent and student Week, Month and Year views now survive rolling deployments where the
  published weekly timetable endpoint is available before the newer summary endpoint. Only an
  explicit summary-route 404 activates the compatibility path; authorization, database and other
  server failures remain visible rather than being masked.
- Compatibility totals are derived from each authorized effective weekly schedule, including dated
  periods and cancellations, and requests are bounded in six-week batches for a Year view. The
  dedicated summary API remains the primary path and automatically takes over as soon as the backend
  deployment exposes it.
- A focused regression test covers complete date ranges, weekday mapping, free days and cancelled
  periods. Frontend typecheck and lint pass. Parent Week and Month views were verified both on the
  localhost mobile preview and through the active ngrok URL; the former error surface is replaced by
  populated daily counts and the selected week reports 33 periods.

## Fee payment submissions and review — 2 October 2026

- Preserved the incoming Stage fee-review workflow while integrating the timetable, calendar and
  authentication work. Migration `022_fee_payment_reviews.sql` adds revisioned school payment
  instructions, immutable guardian submissions and immutable reviewer decisions.
- Parents can review balances, use school payment instructions, report an already-made payment or
  question a fee. Pending claims do not create receipts or reduce balances. Principals and delegated
  finance reviewers can verify or reject claims; verification rechecks the collectible balance and
  writes the receipt and decision atomically.
- Scoped `fees.updated` outbox events refresh the mobile and desktop finance views. Existing invoice,
  receipt, event-credit and refund records remain the financial source of truth. No gateway, automatic
  reconciliation or real school bank/UPI destination is introduced by the demo seed.
- The upstream implementation record and detailed acceptance evidence remain in
  [FEE_PAY_REVIEW.md](FEE_PAY_REVIEW.md). The merged workflow is revalidated by Stage CI against its
  isolated PostgreSQL service before migrations and Railway deployment.

## Principal timetable week navigation and coverage settings — 3 October 2026

- Restored the weekly plan as the principal timetable manager's primary workflow. Curriculum
  coverage is now a secondary `Coverage targets` setting rather than a peer timetable view, and the
  redundant subject selector has been removed. Every configured subject is visible for the selected
  class and opens its existing revisioned target editor directly.
- Added term-bounded week navigation with previous/next controls and a native date jump. The selected
  week and class are URL state. The focused schedule keeps baseline editing explicit as a repeating
  instructional-week pattern, while `Adjust date` carries the selected class and date into the dated-
  plan workflow. A closure is explained without deleting or hiding its preserved recurring pattern.
- Follow-up mobile acceptance restored the original compact weekday-and-period-count rail. Week
  changes are now deliberately limited to the visible previous/next buttons and native date picker;
  the redundant start/week/end divider and horizontal swipe gesture were removed. The selected
  date remains available to assistive technology on each weekday control and closures remain
  explained in the selected-day content.
- The authenticated localhost preview was checked at the mobile breakpoint after the follow-up. The
  compact scrollable day rail, visible date picker and arrow controls were inspected visually.
  Coverage settings, direct target rows, schedule actions and closure explanations remain unchanged.
  Frontend typecheck, lint and production build pass; all **201** frontend tests pass, including
  focused week navigation, date jump, compact-rail and target-editing coverage. Physical-phone
  acceptance remains open.

## Eduvera co-brand and install icon — 3 October 2026

- Extracted the symbol-only Eduvera mark from the approved supplied artwork; the `Eduvera` wordmark,
  surrounding canvas and decorative effects are not embedded in the application asset. The transparent
  master is stored once under the public assets directory and used by the shared school-brand component.
- Login, signup and onboarding now show the school crest and Eduvera mark side by side. Authenticated
  student, parent, teacher and principal headers inherit the same shared component with a compact
  overlapping lockup, while retaining the established school name, theme, navigation and accessible
  label.
- Replaced the old browser and install artwork with symbol-only PNG assets: a browser favicon, a
  180-pixel Safari touch icon, and 192/512-pixel manifest icons with maskable declarations. The manifest
  and document head reference the new files directly so newly added iOS home-screen shortcuts use the
  Eduvera symbol.
- The production SPA server now exposes the root PNG favicon and Safari touch icon plus the manifest
  icon directory. The Stage release smoke test requests all four install assets, preventing a healthy
  application deployment from silently shipping broken home-screen artwork.
- The complete route regression file passes (**44** tests) and the production frontend build succeeds.
  The principal top bar plus login and signup lockups were visually checked at a 390 x 844 mobile
  viewport; both co-brand arrangements remain legible without colliding with account actions.

## Consistent portal page headers — 3 October 2026

- Added one shared, semantic page-title row to the parent, student, teacher and principal shells.
  Every authenticated route now presents its current page name in the same position beneath the
  school identity and account actions. The mobile operations stylesheet no longer hides the title.
- Added a 40-pixel accessible Back control on non-root pages. Explicit parent routes and protected
  edit workflows can provide a stable destination or guarded callback; otherwise the control uses
  valid browser history and safely falls back to the portal home. Parent Home, Student Home, Teacher
  Today and Principal Overview deliberately omit the control.
- Removed redundant local page titles and Back links from timetable management, attendance register,
  student leave and diary, school administration, people import, finance and campus-event workflows.
  Contextual headings such as a class, event or session name remain where they identify the content
  rather than repeat the page title.
- The complete route regression file passes (**45** tests), including title and root/non-root Back
  visibility across all four portal shells and the existing selected-navigation checks. Frontend
  lint and the production build pass. The authenticated localhost
  principal root/detail views and parent root/detail views were inspected; Back is absent on the two
  roots, visible on the detail pages, and the parent Back action returns to Parent Home.

## Shared family Today activities — 3 October 2026

- Renamed the student Home schedule rail from `Today's flow` to the plain-language
  `Today's activities`. Parent Home now uses the same responsive activity rail instead of a
  separate single-class card, while retaining the selected child's presence status and its
  child-scoped timetable destination.
- Parent and student Home both consume the full authoritative effective schedule for the school
  date. The rail centres the current period, or the next/last meaningful period when nothing is
  in progress, and keeps adjacent context available without turning the Home screen into a full
  timetable.
- Subject catalogue color and icon now travel with timetable slots. The shared cards render the
  configured Mathematics, Science, Language, Art, Physical Education, Computing and Social Science
  glyphs, with a deterministic subject-name fallback for older rolling deployments or unconfigured
  activities.
- Every activity card exposes an accessible progress bar: completed periods are 100%, upcoming
  periods are 0%, and the active period is calculated from its published start/end time. Empty days
  remain explicit and link to the role-appropriate timetable.
- Focused component, adapter and parent child-switching/route regressions pass. Frontend and backend
  lint and production builds pass. Physical-phone acceptance remains open.

## Full-screen digital student identity — 3 October 2026

- The expanded student ID now opens as a true viewport-level modal above the shared header and
  bottom navigation in both student and parent contexts. The entire application becomes a dark,
  blurred background so the school identity, portrait, admission details and verification QR remain
  visually isolated and readable.
- The close control is fixed inside the safe area and remains available while a short-height device
  scrolls the card. Opening locks background scrolling; Escape, the close control and backdrop
  dismissal close the modal, return focus to the identity card and restore the previous page scroll
  behavior. Keyboard focus is contained on the close control because the identity itself has no
  secondary actions.
- The complete frontend regression suite passes (**206 tests**), and frontend lint and production
  builds pass. The local readiness probe reports healthy database and event dependencies. Physical-
  phone visual acceptance remains open.

## Student timetable discovery and compact calendar summaries — 3 October 2026

- The existing student Day, Week, Month and Year timetable is now presented as a first-class
  `Timetable` destination in both the four-item bottom navigation and the More service catalogue.
  The former `Classes & Leave` tile was split into clear Timetable and Leave requests destinations,
  without changing the authorized student timetable or leave workflows.
- The shared Month summary now follows a recognizable Monday-first calendar: weekday headings sit
  above aligned date cells, leading spacers preserve the correct weekday position, the selected date
  remains explicit, and each date exposes its scheduled-period count or a free-day state.
- The shared Year summary no longer uses twelve large month cards. It is one compact horizontal load
  chart with Month, Scheduled load and Periods columns, twelve keyboard-accessible month rows and a
  stable zero state. Because the navigator is shared, parent, student, teacher and principal timetable
  readers receive the same calendar structure while retaining their role-specific data.
- Focused month/year and student-route regressions pass. The complete frontend suite passes
  (**208 tests**); frontend lint, type checking and production build pass. Physical-phone visual
  acceptance remains open.

## Staff responsibilities, leave coverage and contextual duties — 3 October 2026

Historical foundation record. The People/Duties split and “My responsibilities” vocabulary below
were superseded on 7 October 2026 by **People / Work types / Leave / Settings** and **My work**.
The current architecture contract is linked in the Staff setup simplification section above.

- Added the research-backed product and engineering specification in
  [STAFF_RESPONSIBILITIES_AND_COVERAGE.md](STAFF_RESPONSIBILITIES_AND_COVERAGE.md). It keeps a
  person's account role stable while modelling class ownership, subject teaching, mentoring,
  coordination, event, examination, safety and committee work as dated, scoped appointments with
  acceptance, revocation, backup and audit history.
- Added tenant-scoped responsibility types, assignments, assignment audits, leave coverage tasks and
  coverage audits. Migration `029_staff_responsibilities_and_coverage.sql` validates scope ownership,
  seeds the standard catalogue for existing and future schools, imports existing class and event
  assignments without duplicating them, enables RLS and preserves the established application-owner
  deployment model.
- Leave approval now creates actionable timetable, event and operational coverage tasks in the same
  transaction. Principals can offer a task to an eligible replacement; the replacement must accept or
  decline it. Approved leave, timetable overlap, duplicate responsibility scope and conflicting cover
  are checked before assignment. Every transition emits an operations audit record and scoped outbox
  event.
- Principal Staff operations now has distinct People, Duties, Leave and Settings workflows. The mobile
  Duties board prioritizes uncovered leave and dated/special duties, keeps routine academic ownership
  collapsed, and provides contextual appointment and replacement pickers. Teachers receive a dedicated
  My responsibilities destination with pending offers, active appointments and accepted cover.
- A clean PostgreSQL database applies all migrations through **029**, loads and verifies the canonical
  200-student demo school, and passes all **210 backend tests** across **23 files**. Backend typecheck,
  lint and production build pass. The complete frontend suite passes all **211 tests** across **32
  files**; frontend typecheck, lint and production build pass. The authenticated localhost principal
  Duties board and assignment sheet were inspected at the mobile breakpoint. Physical-phone acceptance
  remains open.

## Compact published timetable rows — 3 October 2026

- Rebalanced each published period into a compact three-part row: the period rail now owns the complete
  start/end time, the subject and schedule state share the primary line, and teacher and room share a
  two-column metadata line. The former duplicate time entry and mobile-only vertical metadata stack were
  removed without hiding schedule, staffing, room, cancellation, materials or editing information.
- The focused daily-plan suite passes all **17 tests**. Frontend typecheck, lint and production build pass,
  and the authenticated principal published timetable was inspected at the mobile breakpoint with three
  periods visible in substantially less vertical space. Physical-phone acceptance remains open.

## Timetable overview drill-down — 3 October 2026

- Made the shared timetable hierarchy directly navigable across principal, teacher, parent and student
  portals. Selecting a Year load row now selects that month and opens Month view; selecting a Month date
  or Week date selects the exact school date and opens Day view. The current role, class or child context
  remains unchanged.
- Date and view are written through one atomic navigation callback on URL-backed screens, preventing one
  search-parameter update from overwriting the other. Accessible labels now state the destination action
  (`open month view` or `open day view`) for keyboard and assistive-technology users.
- Today is now distinct from the selected date: the date header exposes a persistent `Today · 3 Oct`
  shortcut, current dates use a ring in the day rail and Week/Month calendars, and Year view marks the
  current month separately. Corrected cumulative rail centering so the selected date remains centred
  instead of drifting to the clipped edge after resize updates.
- The complete frontend suite passes all **212 tests** across **32 files**. Frontend typecheck, lint and
  production build pass. The authenticated principal Year → May → 10 May flow was exercised in the local
  mobile preview, including the correct Day-view empty state for a free Sunday and the distinct selected
  2 October/current 3 October markers. Physical-phone acceptance remains open.

## Attendance continuity and reconciliation — 3 October 2026

- Migrations `030_attendance_continuity.sql` and `031_attendance_snapshot_provenance.sql` separate immutable field observations from accepted
  attendance facts. Capture batches retain source, actor, observation/receipt time, roster fingerprint,
  roster capture/expiry time, expected register revision, device/source reference and resolution. Tenant-consistency triggers,
  append-only observation enforcement, RLS and public-role revocation protect the evidence tables.
- Teacher registers now issue an 18-hour, actor-bound HMAC-signed roster snapshot. A matching live or offline capture can publish
  through the existing revision-checked/idempotent attendance command; expired snapshots, roster or
  assignment changes, permission loss and write conflicts are quarantined instead of silently discarded.
  Unrecorded roster rows remain null and are never converted into absence.
- The browser stores roster snapshots and pending captures with non-extractable AES-GCM keys in IndexedDB.
  Records, keys, device identifiers and queue keys are scoped to the authenticated staff account on a
  shared device. Pending observations survive expiry so the server can retain and review the evidence;
  reconnect sync never describes a device-only capture as submitted.
- Principal Attendance includes an evidence/reconciliation desk, current revision and lock context,
  explicit accept/reject notes, and a paper/office capture path. Applying a reviewed observation creates
  an ordinary audited attendance revision; it does not bypass register locks or rewrite observation
  history. History identifies the source and paper/office reference.
- Focused migration, API integration and responsive component regressions cover automatic acceptance,
  expired-snapshot quarantine/rejection, paper review/application, append-only evidence, pending-device
  messaging, source-reference requirements and locked-register review. Backend/frontend type checking
  and both production builds pass. Migrations 030–031 are applied to the local application and isolated
  test databases. Targeted evidence is green (2 migration assertions, 1 end-to-end API workflow and 16 UI
  regressions); the complete automated suites also pass (164 backend and 216 frontend tests). The
  authenticated local mobile preview was exercised through the principal continuity
  desk and into a Class 6A paper-register capture, including the source/reference and review-only states.
  A physical-device offline/reconnect drill must still be recorded before calling this release gate complete.

## Stage release, Supabase migration and demo seed verification — 3 October 2026

- The Stage release workflow applied migrations `028`–`031` to Supabase through the persistent
  session/migration connection before the application rollout. The database seed entry points now use
  the same validated managed-PostgreSQL TLS adapter as the migrator, fixing the certificate-chain
  rejection that previously affected the explicit Stage re-seed path without weakening TLS policy.
- The repeat-safe Stage seed completed with 200 students, 200 guardian links, 12,825 attendance rows,
  264 timetable slots, four campus events, seven event sessions, 450 event participants, 289 event-session
  roster rows, 215 event attendance rows and 16 event fee invoices. The operations seed reported no new
  invoices or payments, confirming that its existing demo records were preserved rather than duplicated.
- GitHub Stage run `37143689643` passed the secret scan, isolated migration and seed preparation, complete
  backend integration suite, mobile typecheck/build/test suite, desktop build, real Supabase migration and
  seed, Railway deployment and public smoke gate. Railway served release `8c5c29b0bac2b2c5f47c69818ca0ccafb2b31d6d`
  with `/readyz` reporting ready database and event dependencies.
- An independent authenticated principal smoke check against Stage returned 17 staff profiles, two leave
  policies and the imported responsibility assignment. Both SPAs, install icons, OpenAPI, demo login and
  protected metrics were also verified by the release gate.


## WF-LOCAL-016: Custom school roles and permission assignment

Historical implementation record. The administrator-facing custom-role workflow below was removed
from normal navigation on 7 October 2026. `/principal/roles` now redirects to **Staff setup → Work
types**; invitations do not grant a staff role, and effective access comes from current scoped work.

Admins/principals open **More → Roles & permissions** (`/principal/roles`),
create a named role, choose grouped permission checkboxes, and assign the role
to an active staff member. Role edits affect existing sessions on their next
guarded API request. One custom role replaces the default staff tool permissions
and old individual SIS/fee grants for that school. Clearing it explicitly restores
the default staff permissions and existing individual grants.

Implemented domains: student administration (`sis.manage`), fees (`fees.manage`),
assigned attendance read/write, photo attendance, timetable/day-plan reading,
coverage response, attendance follow-ups, chat read/send, class group creation,
assigned safeguarding review, event read/manage/attendance, and scoped AI.
No role changes membership, class assignments, guardian relationships, event
responsibilities, or school boundaries. Existing domain authority remains an
additional requirement. School leadership commands (including staff onboarding,
weekly timetable editing, access/invitations, school policy and school-wide
safeguarding assignment) remain built-in admin/principal capabilities. Personal
staff leave/responsibility responses and family rights remain separate.

Role create/edit/delete/assignment is admin-only and recorded in the school
operations audit. Case-insensitive role names are unique in-school; built-in
names are reserved. Revisions guard concurrent role edits; assignment changes
compare the previous role. Used roles cannot be deleted, and admin accounts
cannot be downgraded through the staff assignment endpoint. Composite foreign
keys prevent cross-school role assignment. No new PUBLIC database grants.

Stage demo seeding adds **Arjun Rao** (`arjun.admin`) with a random unusable-as-demo
password and separate **Admin view** one-click persona behind `DEMO_MODE`, plus
Accountant, Class Teacher and Teaching Observer role examples. Existing teacher
assignments are not changed automatically. The deployment workflow seeds only
these examples after migrations; it does not reseed the school.

Verification before release: backend/frontend typechecks, backend lint/build,
frontend build and existing 216 UI tests passed; the new checkbox editor tests
and 23 local PostgreSQL-backed service/guard assertions passed. All migrations
including `032_custom_school_roles.sql` applied to a disposable PostgreSQL
engine. Real PostgreSQL HTTP integration tests are included in the Stage CI
gate; the local socket emulator cannot reliably multiplex the app's event
listener and request transactions, so that attempted run is not API release
evidence. Physical school acceptance, stronger privileged auth and non-owner
RLS gates remain separate from this role-management increment.

## WF-LOCAL-017: Company provisioning and delegated institution onboarding

User decision (4 October 2026): institution provisioning belongs to the company
backend superuser, then the institution admin handles academic setup, invites
staff/students and delegates onboarding through custom roles. This supersedes
WF-LOCAL-016's leadership-only invitation/enrollment boundary.

Implemented: a separately bootstrapped `company_operators` authority and `/company`
console; transactional school/college creation with first-admin invitation;
operator metadata-only workspace; admin invitation replacement/revocation;
main-app `/join` acceptance with new/existing account protection; empty-institution
setup routing; school member invitations with native student/guardian record
activation; staff custom role on joining; `members.invite` permission and delegated
native directory/reviewed enrollment/import through `sis.manage`. School admins
can no longer self-provision another school through the old API or either UI.
Custom role assignment, administrator invitations, HR authority and guardian
leave-authority edits remain protected leadership operations. Company authority
cannot be granted from signup, role checkboxes or school APIs.

Migration `033` adds institution kind, company grants/audit, invitation origin,
record targets and same-institution invited custom-role linkage. Codes remain
single-use, email-bound, hashed, expiring and manually delivered. Acceptance
rechecks the original company/admin/delegated inviter's live authority. College
records reuse the established term/class model; dedicated degree/credit workflows
and automatic email delivery are not included.

Local validation: backend typecheck/lint/build, frontend typecheck/build; five new
onboarding UI tests plus auth/import checks; migration 033 and 22 direct
PostgreSQL-engine service checks (company/school separation, first-admin handoff,
role delegation, native student linkage, pending-invitation revocation). Eleven
HTTP integration scenarios against real disposable PostgreSQL are added to the
Stage release gate. See `COMPANY_ONBOARDING.md` for production operator bootstrap.

WF-LOCAL-016 release evidence: Stage run `37184577063` passed 219 backend and 219
frontend tests, migrated/seeded, deployed and verified exact release
`07b5ce6be1657f7ceb1082690ac3b5f2064df388`. Live dummy-admin login, role list,
assignment controls and checkbox grouping were verified through the browser.

### Local merge reconciliation — 4 October 2026

The Stage custom-role/company-provisioning work and the local governance/restricted-care
slice were merged without dropping either route, module or authorization layer. The local
governance migrations were renumbered to `034`–`036`; existing local migration history was
remapped by exact filename and checksum before applying Stage migrations `032` and `033`.
Migration `033` now uses a PostgreSQL-compatible restrictive composite foreign key for invited
custom roles, preserving cross-institution integrity and the rule that a role still referenced
by an invitation cannot be deleted.

Verified locally after reconciliation: both development and isolated-test databases contain
the ordered `032`–`036` migration set; backend typecheck/lint/build and all 240 backend tests
pass; responsive frontend typecheck/lint/build and all 230 UI tests pass; and the desktop staff
bundle typechecks and builds. This is local merge evidence only, not Stage deployment evidence.

Follow-up seed correction: the original local `db:seed` command loaded the base Cambridge
dataset but did not invoke the new role/company demo seeder, leaving `/company` unavailable even
though migrations `032`–`033` existed. `db:seed` now chains the repeat-safe role/operator seeder,
and `db:seed:roles` provides a narrow repair path. The seeder fills each missing named example role
independently rather than skipping all examples when any custom role already exists. The repaired
development database was verified with the `company.demo` session, company-operator profile claim,
two-institution company workspace and the local/ngrok `/company` route.

Company creation usability correction: the institution code is now derived from the entered name and
normalizes spaces, capitals, punctuation and accented characters while it is edited. This removes the
browser-native pattern-validation dead end that could make the create action appear unresponsive, while
preserving the backend's lowercase tenant-code invariant. Verified evidence includes the company UI
regression test for generated and manually edited codes plus an authenticated browser creation through
the local ngrok preview; the transactional service and database constraints remain the authority.

## WF-LOCAL-018: Two-lane self-service onboarding

User decision (4 October 2026): the product must support both company-verified onboarding for
formal institutions and immediate, no-company-verification creation for small coaching/tutor
workspaces. Detailed contract: [Self-service institution onboarding](SELF_SERVICE_ONBOARDING.md).

Implemented locally in migrations `037`–`038`, `backend/src/institution-onboarding`, the company review
service, and `frontend/src/features/onboarding`:

- Signup accepts an **Institution owner** account choice but grants no tenant access by itself.
- Formal school/college/hybrid submission creates an audited application only. Company operators
  can request information, reject or approve; only approval creates the tenant, regulatory profile
  and applicant's first admin membership in one transaction.
- Coaching creation immediately creates a `coaching` tenant, admin membership and `coaching_core`
  profile labelled `self_service_coaching` / `not_required`. The product explicitly says this is
  not a verified school or college. One coaching workspace per creating account is the initial
  bounded anti-abuse rule.
- Applicant status and resubmission, company queue and decisions, loading/error states, mobile
  layout, tenant-code conflicts, current-session switching, RLS enablement/revokes and global plus
  workflow audits are included.

Verified local evidence: migrations 037–038 applied to development PostgreSQL and from-scratch to
a disposable seeded PostgreSQL database; backend/frontend typecheck, lint and production build pass.
The complete backend suite passes against that clean database (29 files, 241 tests), including the
real-PostgreSQL HTTP test for the immediate coaching path, duplicate guard,
application-without-tenant boundary, information request, resubmission, approval, membership
creation and repeat-decision rejection.
The complete frontend suite passes locally (37 files, 233 tests), including the two-model selector,
formal submission boundary and updated no-membership routing.
The signup, two-model selector and formal form were visually inspected through the local preview at
desktop and mobile breakpoints with no browser console warnings/errors. This is not Stage deployment
or company operating-policy acceptance. The user UI review, Stage migration/seed/Railway smoke,
decision notification delivery, email verification/MFA, ownership transfer and coaching/college
policy packs remain open release work.

Release migration correction (4 October 2026): applied migration `033_company_provisioning.sql`
is restored byte-for-byte to its Stage checksum. The later decision to prevent deletion of a custom
role referenced by an invitation is now an append-only change in migration `039`, after migrations
037–038. This preserves migration-history integrity while retaining the intended final foreign-key
behavior. Fresh-schema PostgreSQL 17 verification and Stage application remain guarded by the Stage
workflow; the local Homebrew PostgreSQL 14 server cannot parse migration 033's PostgreSQL 15+
column-list `SET NULL` syntax and is not accepted as release evidence for this correction.
The Stage runtime repair step now also preserves or generates a dedicated restricted-care encryption
key (distinct from cookie and metrics secrets) and binds the service to `0.0.0.0`; both are required
by the managed-environment configuration before Railway can become ready.

## WF-LOCAL-019: Institution activation and first-day readiness

Implemented locally on 5 October 2026. Detailed contract:
[Institution activation and first-day readiness](INSTITUTION_ACTIVATION.md).

- Both formal and coaching onboarding now require a verified owner email. New tenants begin in a
  revisioned `draft` activation state selected from a configurable school, college or coaching
  capability pack; successful review moves the current evidence to `ready`, and a fresh locked
  recheck is required for `active`.
- New account trust includes hashed expiring email-verification/password-reset tokens,
  authenticator TOTP with encrypted secrets and replay prevention, single-use hashed recovery codes,
  MFA login challenges, enumeration-safe reset requests and all-session revocation on reset.
- **Principal → More → Institution setup** computes readiness from real term, class/batch, subject,
  attendance-policy, contact, staff, enrolment and timetable records. Empty workspaces can create the
  academic foundation transactionally; partly configured workspaces deep-link to the established
  administration, people, invitation, governance and timetable modules instead of being overwritten.
- Review and activation are admin-only in addition to `sis.manage`, revision checked, globally audited
  and recorded in an append-only activation history. Activation emits an `InstitutionActivated`
  outbox event. New tables have RLS enabled and direct browser-role grants revoked.

Verified local evidence: migration 040 applies from scratch on PostgreSQL 17; the local development
database was reconciled to the restored migration-033 checksum, then migrations 039–040 applied.
Backend lint/typecheck/build and all 253 tests pass across 31 files on a clean, seeded PostgreSQL 17
database, including five new HTTP integration scenarios. Frontend lint/typecheck/build and all 237
tests across 38 files pass, including computed checklist, optional-requirement and transactional
quick-start UI coverage. The running local API reports ready database/events and its authenticated
activation workspace returns 200. Mobile user acceptance and Stage migration/deployment/mailbox smoke
remain open; this record does not claim those gates have passed.

Demo-context correction (5 October 2026): every institution demo session now starts with the
seeded Cambridge International School (`cis`) as its server-side active institution. Student,
guardian, staff, principal and school-admin profiles therefore enter their contextual Cambridge
workspace instead of the institution-onboarding flow; the company persona intentionally remains
institution-free. The repeat-safe demo seeder also marks only the known, populated Cambridge
reference tenant active, while real customer tenants keep the full readiness and verification
gates. API regression coverage asserts the active-school and onboarding contract for all six demo
personas, and a local browser check confirmed Principal view lands on `/principal` with Cambridge
data rather than `/onboarding/start`.

## WF-LOCAL-020: Offline assessment operations and results

Implemented locally on 5 October 2026. Detailed contract:
[Offline assessments and results](OFFLINE_ASSESSMENTS_RESULTS.md).

- Principals create active assessment cycles inside an academic term, plan a class/subject
  assessment, and assign different active members as examiner and moderator. Assessment kinds are
  institution-neutral (`exam`, `class_test`, `quiz`, `assignment`, `practical`, `viva`, `project`,
  `other`) so school, college and coaching capability packs can apply their own policy later.
- Opening marking freezes the roster from active term enrolments. An assigned examiner records a
  score or the explicit `absent`, `exempt`, `withheld` or `not_evaluated` outcome for every learner;
  zero is a real score and never substitutes for absence. Bounds, evidence requirements and stale
  revisions are enforced by the service and database-backed workflow, not only the browser.
- The assigned moderator independently approves or returns a complete register. Principal
  publication creates an immutable, sequenced result snapshot and notifies each account at its
  correct student or guardian route. A later mark correction reopens marking and must pass the same
  moderation/publication sequence; previous releases remain auditable.
- Learner and guardian pages query only the latest published snapshot for the selected learner.
  Draft marks, evidence and moderation data stay private. Evidence files are kept outside the public
  web root and require current scoped staff authority to retrieve.
- Migration `041_offline_assessments_and_results.sql` adds tenant-scoped cycles, assessments,
  assignments, result revisions, evidence, publications and audits; direct browser-role grants are
  revoked and RLS is enabled as defence in depth. `assessments.view`, `assessments.mark` and
  `assessments.moderate` extend configurable staff roles without granting publication authority.

Verified local evidence: migration 041 is applied to the development database; the repeat-safe demo
seed provides a Class 7A marking register with 27 learners. Principal and assigned-teacher workspace
smokes return the same scoped assessment. The isolated PostgreSQL lifecycle test passes creation,
roster freeze, complete marking, self-moderation denial, independent approval, publication,
relationship-scoped family access, correction and second publication while preserving release one.
Focused family UI tests cover published correction display and private/empty states. Complete-suite
verification now passes on a clean isolated PostgreSQL database: backend lint/typecheck/build and all
256 tests across 32 files; frontend lint/typecheck/build and all 239 tests across 39 files. The local
API reports ready database and event dependencies and both the login and principal-assessment routes
return successfully.

Responsive shell correction verified on 5 October 2026: role portals now share one 16 px mobile page
gutter owned by the parent, student or operations shell. Assessments/results, institution setup and
governance/policy workspaces no longer add a second horizontal page gutter, while intentionally
full-bleed rails remain unchanged. The authenticated principal assessment route was measured at both
390 px and 320 px: its hero is exactly 16 px from both viewport edges, the narrow metric row does not
overflow or add a scrollbar, and the page has no horizontal overflow. Frontend lint, typecheck,
production build and all 239 tests across 39 files pass after the correction. Representative physical-
device acceptance across every role remains open and must not be inferred from this targeted browser
verification.

Content-density correction verified on 5 October 2026: newly added assessment/results, institution
setup, account-security and self-service onboarding screens now follow the established concise portal
pattern. Repeated page headings, promotional hero copy and implementation explanations were removed;
operational counts, state, required choices, safety warnings and actionable next steps remain. The
principal assessment and institution-setup routes were visually checked at 390 px and measured at
320 px with the shared 16 px gutter and no horizontal overflow. Focused coverage asserts the concise
empty/result, readiness and onboarding states; frontend lint, typecheck, production build and all 239
tests across 39 files pass after the change.

Stage release evidence (5 October 2026): GitHub Actions
[run 37232887399](https://github.com/EduveraIITA/Eduvera/actions/runs/37232887399) completed both
`Verify` and `Deploy to Railway` successfully for application commit `a86215b`. The guarded database
step applied migrations `040_institution_activation_and_account_trust.sql` and
`041_offline_assessments_and_results.sql` to the Stage Supabase database before the Railway release.
The workflow then verified API readiness, mobile and staff SPAs, install icons, OpenAPI, Stage demo
login and protected metrics against that exact release SHA. An independent post-deploy check returned
`ready` with database and event dependencies healthy, `/releasez` identified environment `stage` and
SHA `a86215bcb7147d6207ff41fc742891ee1b542aaf`, and `/principal/assessments` returned HTTP 200. This is
Stage deployment evidence, not production approval or representative physical-device acceptance.

Open boundaries: no online test runner, question bank, proctoring, auto-grading, public ranking,
weighted aggregate, board-specific grade calculation, transcript/certificate or result analytics is
claimed. Production evidence storage still requires object lifecycle, scanning, retention and legal
review. Institutional grading/moderation SOP and representative-device acceptance remain mandatory.

## WF-LOCAL-021: Configurable grading and immutable report cards

Implemented locally on 5 October 2026. Detailed contract:
[Configurable grading and report cards](CONFIGURABLE_GRADING_REPORT_CARDS.md).

- Institution administrators create versioned term/class grading schemes with contiguous grade
  bands, explicit absence treatment, optional subject pass thresholds and weighted subject
  components. Components map only to published assessments from the same institution, term, class
  and subject; their weights must total 100%. The architecture contains no school-board-specific
  formula and remains usable by school, college and coaching capability packs.
- Activation freezes the scheme. Generation calculates from the latest immutable assessment
  publication, stores relational learner/subject/component/source snapshots and never substitutes an
  unknown result for zero. Independent review can require a second administrator before publication.
- Class-teacher remarks require both an effective class assignment and the new `reports.comment`
  permission. Principal remarks, review and publication remain administrator-only. Learners and
  linked guardians see only the latest published release for their own record.
- A corrected assessment produces a new sequenced report batch with a reason; previous published
  assessment and report releases remain intact. The family report identifies corrected releases and
  supports a print-safe view without exposing drafts or rankings.
- Migration `042_configurable_grading_and_report_cards.sql` adds eleven institution-scoped policy,
  mapping, snapshot and audit tables. Browser database grants are revoked and all new tables have RLS
  enabled as defence in depth behind the authenticated application service.

Verified local evidence: all 42 migrations apply to clean PostgreSQL 17 and a repeat migration is a
no-op. The repeat-safe demo seed creates one active scheme, one published batch and 25 learner
reports; all eleven new tables report RLS enabled. The real-database lifecycle test covers assessment
publication, 80% report calculation, self-review denial, independent review, publication, unrelated-
learner denial, relationship-scoped family access and a corrected 90% second release while retaining
release one. Backend lint/typecheck/build and all 262 tests across 33 files pass. Frontend
lint/typecheck/production build and all 241 tests across 40 files pass; the desktop client typecheck
and production build also pass.

Stage release `548ee54a4752146a35b1501d00ab7fea5afd2dbe` passed the complete GitHub Actions
[Stage workflow](https://github.com/EduveraIITA/Eduvera/actions/runs/37329333873) on 5 October 2026.
That run reapplied the clean-build, lint, typecheck and test gates above, applied migration `042` to
Stage Supabase, ran the repeat-safe report-card demo seed and bound the Railway release to the exact
commit. Independent public checks returned ready database/event health and the same release SHA.
The four principal, teacher, guardian and learner report-card routes returned HTTP 200. An
authenticated principal demo smoke returned admin mode, one active scheme, one published batch,
eight classes, nine subjects and one mapped source assessment. This is verified Stage deployment
evidence, not production approval or representative physical-device acceptance. Open product
boundaries include board/university policy packs, promotion decisions, transcripts, certificates,
digital signatures, longitudinal analytics and institution-approved print/retention policy.

### Family marksheet and learner discovery polish — 6 October 2026

The published family result now leads with a mobile-first official marksheet rather than presenting
the term aggregate as another generic card. It shows institution identity, learner/admission/class
identity, overall outcome and grade, a compact subject table, school remarks and an immutable
publication reference. Individual assessment releases remain available as a denser history beneath
the marksheet. Printing removes portal chrome and the assessment history, while retaining the
published record styling. No rank, percentile, signature or board-specific claim was added.

The learner module catalogue now exposes the existing relationship-scoped `/student/results` route;
the former omission made the capability undiscoverable even though authorization and routing were
already present. The parent context also normalizes the API's `Class 7A` label so it no longer renders
as `Class Class 7A`. Local migration `042` and the repeat-safe assessment/report demo seed were
applied, after which an authenticated learner smoke returned one published assessment and one report
with one subject. The full frontend gate passes: lint, typecheck, production build and 243 tests in
41 files. The general 200-student seed regeneration was not claimed: its existing picnic-payment
integrity assertion failed against this reused local database before the targeted repeat-safe demo
seed completed.

Stage workflow [37448393097](https://github.com/EduveraIITA/Eduvera/actions/runs/37448393097)
then passed secret scanning, isolated backend integration tests, the complete mobile frontend gate,
the desktop build, migration validation, repeat-safe demo-data repair and Railway deployment for
application commit `63a40f247ed5cc53781a2c1911646066ac75ae77`. Independent public checks returned
ready database/event dependencies and the same release SHA; both family result routes returned HTTP
200. An authenticated learner smoke returned Aarav with one published assessment and one report
containing one subject. Representative physical-device acceptance remains pending.

### Searchable family marksheet gallery and child context — 6 October 2026

The individual assessment history has been replaced by a horizontally swipeable document gallery
for both learner and guardian portals. A compact dot navigator reports position and opens any card.
Every published assessment now renders as an institution-branded marksheet
with learner/class identity, explicit score or non-scored outcome, percentage, subject total,
feedback, release sequence and immutable publication reference. Search covers assessment, subject,
cycle, term and year; academic-year and record-type controls filter both assessment marksheets and
term reports. In the combined view, an assessment that is an actual source of a published term or
annual report is represented only by the official aggregate marksheet; its individual record remains
available under Assessments. This relationship is driven by source assessment IDs returned by the
family report API rather than subject-name inference. Each record can be printed or saved through an
isolated print view. Term reports remain the visual reference: assessment documents now use the same
learner identity, three-part result band, subject table, remarks and verification layout. Both
document types inherit the active learner's accent without record-type color overrides.
Their title headers stay intentionally simple and inherit the active learner tint without record-type
color overrides or decorative raster artwork. The document now starts directly with a solid accent
header titled `Term report` or `Assessment report`; institution branding is intentionally omitted from
the document card. Publication status sits at the right edge of the same header to avoid wasting a
separate row. The term/year and actual report or assessment name follow without repeating the type,
preventing collision at every mobile width while keeping the shared document body unchanged.
Learner identity and subject results are flat document sections rather than inset cards: identity
fields use only structural dividers, and the subject header and rows extend to the marksheet edges.
Draft results, ranks and signatures remain absent.

The repeat-safe Cambridge demo seed now supplies three independent class tests, six subject-level
annual examinations and one six-subject annual examination report. Report source links are retained,
so class tests remain separate gallery cards while the six annual paper records are not repeated in
the combined view. Re-running the seed does not create duplicate assessments or report releases.

The shared parent shell now assigns stable, accessible accent families to the ordered learner list.
A single learner retains the existing blue theme; with multiple learners the active profile changes
the inherited parent-portal brand, feature gradient, buttons, selections, soft surfaces and focus
cues. Profile portraits and the stacked identity-card layers retain distinct learner colors, while
the institution crest and official document crest stay institution-blue. The shared shell now reads
the authoritative `student_id` query context on generic parent routes such as More, preserves it in
service links and back navigation, and can switch profiles there without falling back to the first
learner. This is a presentation context only: relationship-scoped authorization and the
`student_id` route context remain authoritative.

Verified locally: the live family-results API returned `Term 1 · 2026-27` for the seeded English
publication; frontend typecheck, lint and production build pass; the new gallery tests pass; all 47
application-route tests pass; and the complete frontend suite passes 247 tests in 41 files. Backend
typecheck, lint and production build pass. The backend non-isolated unit set passed 67 tests, while
the repository-wide backend command still requires its documented disposable `DATABASE_URL` for
six integration suites. Physical mobile review of the new gallery and multi-child palette remains
pending.

## WF-LOCAL-022: Controlled departure and transport coordination

Implemented locally on 6 October 2026. Detailed contract:
[Departure and transport coordination](DEPARTURE_AND_TRANSPORT_COORDINATION.md).

- One dated, revisioned departure plan now coordinates guardian pickup, verified external
  collectors, reviewed independent departure, school transport and family/external transport.
  Purpose-specific collection grants are institution/learner/date scoped and revocable; revocation
  moves affected current plans into exception instead of leaving a cached receiver usable.
- Guardian app changes and staff-recorded phone, paper or in-person requests remain separately
  attributed. Approval creates a superseding current plan. Non-bus handover requires an explicit
  ready check followed by a factual execution record; bus drop uses the frozen rider roster and
  writes the terminal transport-handover evidence.
- School transport separates reusable routes/stops/learner assignments from dated trips and frozen
  rosters. Only the assigned collector account can open boarding, depart, publish location, update
  rider outcomes and close the trip. Closure is refused while any rider remains expected, boarded
  or unresolved.
- The guardian API returns the latest precise phone observation only while the selected learner is
  boarded on an in-progress trip. It withholds the same trip coordinates from a linked sibling who
  has not boarded and removes them immediately at that learner's drop. Map failure never blocks
  roster or handover work.
- Institution policy configures enabled arrangements, same-day cutoff, sample retention and stale-
  location threshold. The web collector explicitly requests geolocation and a screen wake lock;
  it labels foreground-only operation rather than claiming guaranteed background tracking.
- Migration `043_departure_and_transport_coordination.sql`, authenticated APIs, principal, collector
  and family mobile views, role permissions, navigation, audit/outbox events and a repeat-safe
  Cambridge demo scenario are included.

Verified local evidence: migration 043 applied successfully and a second migration run was a no-op;
the demo seed is repeat-safe. Authenticated smokes returned the expected parent, assigned-collector
and principal workspaces. A real-database privacy smoke passed boarded visibility, sibling isolation
and immediate post-drop removal. Backend typecheck/lint/build and 18 focused tests pass. Frontend
typecheck/lint/build and all 247 tests pass. Live local API and proxied preview health return OK.
The repository-wide backend command still needs its documented disposable integration database for
six suites. Physical-device permission, suspension, weak-network and real gate/bus operations remain
release gates; native background location and transport-vendor feeds remain deliberate later slices.

## WF-LOCAL-023: Transport duty calendar, roster preparation and mutual swaps

Implemented locally on 6 October 2026 as the staffing and planning continuation of WF-LOCAL-022.

- Effective-dated service patterns now define route, direction, weekdays, departure time, primary
  collector and optional backup. A six-week-bounded generator prepares dated trips and rider
  rosters from the learner route assignments effective on each service date.
- Principal transport operations now show a mobile-responsive seven-day calendar with each trip,
  collector acceptance state and rider count. Operations can prepare a week, refresh an unfrozen
  planned roster and reassign primary/backup staff. Reassignment returns the duty to pending;
  boarding stays blocked until the current assignee accepts.
- Staff can decline a new duty, request one-way cover or request a mutual exchange with a
  colleague's accepted planned trip. The colleague accepts or rejects first. School operations
  separately approves or declines an accepted request. Approval locks and revision-checks the
  affected trip(s) and applies an exchange atomically; active, frozen or stale trips are refused.
- Migration `044_transport_duty_planning_and_swaps.sql` adds protected service-pattern and swap
  records plus dated-trip acceptance/backup fields. Browser roles have no direct table grants;
  backend permission checks, audits and outbox notifications remain the application boundary.

Verified local evidence: migration 044 applied and a second migration run was a no-op. The
repeat-safe Cambridge transport seed still completes. A real authenticated smoke created two
dated rosters, captured both staff acceptances, captured the colleague's mutual-exchange acceptance,
approved it as principal and verified both assignments swapped while remaining accepted; smoke
records were removed. A separate recurring-pattern smoke generated one pending trip with its two-
rider roster and was also cleaned up. Backend build/lint/typecheck and six transport migration
contract tests pass; frontend typecheck/lint/production build pass. The full frontend regression
passes all 247 tests in 41 files. Physical mobile and real transport-operations
review remain the final local acceptance gates for this slice.

### Restricted staff navigation correction — 6 October 2026

- Teacher-portal tool cards, bottom navigation and direct route authorization now use one shared
  permission map. A custom transport role with only `departure.collect` no longer sees or enters
  assessment marking (`assessments.view`) or report remarks (`reports.comment`). Backend guards
  remain authoritative for every request.
- Restricted custom roles now retain a safe **Today** landing page instead of being forced to
  **More** or into the teaching-day API, which requires `timetable.view`. The page exposes only
  permission-backed operational links plus the staff member's own scoped responsibilities.
- Route guards reject unauthorized module URLs before their lazy pages load or issue module API
  requests. Default teaching roles retain the existing teaching-day home and navigation.

Verified local evidence: frontend typecheck, lint and production build pass; the complete frontend
regression passes 251 tests in 42 files, including restricted-role visibility, direct-route denial
and scoped-home coverage. Local preview/API health returns OK. Physical mobile validation with the
actual Bus Attendant account remains pending.

### Role duty planning and access recommendations — 6 October 2026

Historical implementation record. Its separate Duties and recommendation UI was superseded on
7 October 2026 by **Staff setup & leave** and automatic access.

- The earlier permission-enforcement proposal was reverted before release. Duty-to-access mapping
  is advisory: schools may have temporary duties and intentional permission exceptions, and a duty
  must never silently grant account access.
- Migration `045_role_duty_planning.sql` adds a school-scoped role-duty relation and recommended
  permission metadata to the controlled duty catalogue. Transport attendant is represented as a
  first-class operational duty with `departure.collect` as its access recommendation.
- The role editor now starts with **duties this role can perform**, derives explainable access
  recommendations, and offers an explicit **Add recommended** action. Administrators retain final
  control and can save with recommendation gaps.
- Actual offered/active appointments and current transport trips are compared with the staff
  member's custom-role duties. Mismatches are visible in **Roles & permissions** and **Staff
  operations → Duties**, but do not block role changes, appointments or temporary cover.
- Existing roles receive a conservative initial duty selection inferred from current permissions;
  this is reviewable configuration rather than a claim that every inferred duty is correct.

Verified local evidence: migration 045 applied and repeat-safe demo role/transport seeds complete.
The Cambridge Bus Attendant role is initialized with only **Transport attendant**; its eight existing
teaching/event appointments are reported as duty-list mismatches rather than permission failures.
Backend typecheck, lint and production build pass; 75 non-database tests pass and 13 focused role/
staff integration tests pass against an isolated database. Frontend typecheck, lint and production
build pass; all 253 tests in 42 files pass, including duty-first recommendation and mismatch UI.
Physical mobile review remains an acceptance gate.

### Work-profile authorization redesign — 6 October 2026

Historical implementation record. The role/work-profile eligibility layer described below was
superseded on 7 October 2026 by Position → Work type → Assignment. Migrations `046`–`047` remain in
the immutable migration history for deployed-schema compatibility, but current authorization no
longer joins their profile or duty tables. See the current contract linked above.

- Product decision: institution administrators describe work; the platform calculates access.
  `WORK_PROFILE_ACCESS_ARCHITECTURE.md` is the authoritative vocabulary, invariant and migration
  contract. Account type, work-profile eligibility, actual scoped responsibilities, internal
  capability packs and dated access exceptions are distinct concepts.
- The earlier duty-plus-manual-access editor is superseded. Atomic permission codes remain an
  internal server enforcement contract and must not appear in the normal administrator workflow.
- Migrations `046_work_profiles_and_calculated_access.sql` and
  `047_work_profile_domain_alignment.sql` implement multiple profiles with one
  presentation-only primary, a controlled capability catalogue, bounded migration continuity and
  dated, reasoned access exceptions. The effective-access evaluator requires active membership,
  profile eligibility and a live domain assignment, then leaves concrete resource and workflow
  checks with the owning service.
- Work-profile and exception APIs are tenant-scoped, revision checked and audited. Overlapping
  exceptions for the same outcome are rejected. Assessment, event, transport, cover and protected-
  care assignment now reject staff who lack matching profile eligibility. Removing
  eligibility immediately removes derived access while leaving the responsibility visible for
  administrator review. Realtime fee/event replay uses the same calculated finance authority.
- The administrator UI now uses templates, plain-language responsibility selection, multiple
  profile assignment, one primary profile, current-access explanations and a bounded temporary-
  exception flow. Raw permission and module-access checklists were removed from role and member UI.
- Auth projection, staff navigation and route guards consume calculated outcomes; backend guards
  remain authoritative. Existing administrator authority and domain-level class, learner, event,
  assessment, transport and case checks remain unchanged.
- The repeat-safe Cambridge demo now gives all 17 active staff at least one profile and exactly one
  primary profile. It includes seven meaningful profile types, Teaching profiles for 16 academic
  staff, event profiles for five assigned event staff, Finance, School-office and protected-care
  examples, and one dated exception for visible review. Migration continuity noise and superseded
  demo roles are removed only from the reference institution. The full generator and companion
  role/transport seeds complete successfully on repeated runs.

Verified local evidence: a fresh isolated PostgreSQL database applied migrations 001–047 and loaded the
complete demo seed. Backend typecheck, lint and production build pass; all 276 backend tests in 37
files pass against the isolated database. Frontend typecheck, lint and production build pass; all
251 frontend tests in 42 files pass. Physical mobile review of Work profiles, staff assignment and
Current access remains the local acceptance gate. This slice is not yet claimed as deployed.

## Invitation SMTP delivery — 4 October 2026

User request: send company/admin and school-member invitations using the
Pathyakram Gmail account. The supplied `gamil.com` address is treated as a typo
for `gmail.com`; account verification and a new Google app password remain
required for live activation. No supplied password is committed.

A shared Nodemailer transport attempts email only after invitation transactions
commit. TLS is mandatory (465 implicit TLS or 587 STARTTLS), with certificate
validation and bounded connection/socket timeouts. Credentials and trusted join
origin come from environment variables. All three invitation creation paths use
this adapter. The message includes email-bound code, expiry and `/join` address;
no code is placed in URLs or logged. Mobile and desktop receipts distinguish
mail-server acceptance, unconfirmed delivery and manual sharing. Invitation
expiry/revocation/acceptance and current-authority checks remain authoritative.

Validation: five transport tests and seven onboarding UI tests pass. Backend
and mobile typechecks, backend lint, backend build and both web production builds
pass. The connected Railway account exposes DigiRobe and Petboarding only, so
Eduera SMTP variables have not been configured and no live email has been sent.
Durable queue retries, persisted delivery history, crash recovery and real mailbox
confirmation remain outside this increment; create a replacement invitation for
manual retry. See COMPANY_ONBOARDING.md for server activation settings.

## Invitation email failure investigation — 5 October 2026

A company-demo invitation to the user-requested `ise2016004@gmail.com` on
live Stage release `669050f` returned `delivery: failed`. Inbox delivery was
not confirmed. The prior blanket error hid the cause. Connected Railway access
still does not expose the Eduera project, so the plan, variables and runtime
logs cannot be inspected through that connector. Local Gmail SMTP is also
unreachable from this workspace; that does not prove the live server's cause.

Added allowlisted invitation failure categories and human-readable messages
without disclosing raw provider errors. Added an optional Resend HTTPS transport
for Railway plans which block SMTP; invitation and account-action emails share
this transport. SMTP TLS validation and bounded timeouts remain. API requests
have a fixed HTTPS destination, reject redirects and require a provider message
ID before reporting acceptance. Production requires provider-specific credentials.

Validation: 22 backend transport/configuration tests and 10 mobile onboarding
tests pass; backend typecheck, lint and build, both web typechecks and production
builds pass. Live Resend sending is blocked until a valid API key and allowed
sender are configured. Live Gmail authentication remains unverified. This work
does not claim email delivery is fixed merely because tests pass.

## Dated transport assignments in staff profiles — 7 October 2026

The four South Bengaluru entries in Kavita Mehta's staff profile are four distinct
trip records, one for each 3:30 PM departure on 7–10 October, not duplicate role
grants. The trip pattern prepares dated rosters in advance. The role-binding view
uses the earlier trip creation date as the access-window start so staff can see and
accept future work; that window was mistakenly presented in the profile as the
journey's duration. Route-only labels compounded the confusion. Its generic
`active` binding status also did not mean a pending collector had accepted a trip.

The staff-assignment read projection now includes each trip's service date, departure
time, direction, journey state and collector response. The profile and staff self-view
show the actual dated journey; the administrator profile uses the date as the row
heading and the route/time/direction beneath it. Pending, scheduled, in-progress,
completed and cancelled labels reflect the transport record. Date search and
per-trip accessible action labels distinguish journeys on the same route. The
underlying trip records, advance-access window and authorization rules are unchanged.

Verified: a fresh disposable PostgreSQL database applied migrations 001–052 and
the eight staff-operations integration cases passed, including two distinct trip
projections. All 264 frontend tests in 43 files, including the ten focused profile
UI cases, pass; frontend/backend typecheck and
lint and both production builds pass. A live local-preview browser smoke on the
Cambridge demo showed four distinct dated journeys with their current responses,
no browser error or horizontal overflow at 390 px; the broader profile smoke also
passed at 320, 390, 768, 1024 and 1440 px. Physical-phone review remains open.

## More navigation and actionable markers — 7 October 2026

The parent, student, teacher and principal More pages now use one tool catalogue and offer
the existing two-column grid or a compact settings-style list. The choice is stored per user;
switching views does not change route access, role filtering, or the parent's selected-child
links. The student launcher uses the same control and includes its existing destinations.

A small red marker appears only when a supported current action exists. The home APIs expose
`more_attention` derived from RSVP, guardian consent, event-payment/preparation, leave-signature,
diary-acknowledgement and attendance-register action projections. A transport-only staff member
uses the authorized collector journey response for pending trip acceptance or incoming duty swaps;
the More page does not request the teaching home without `timetable.view`. Informational updates,
upcoming events, guardian-only decisions in the student view and the bell's unread notification
total do not create tool markers. Markers are
deliberately non-numeric: some source projections group or cap actions, so a displayed number
would imply a complete domain queue that the app does not yet provide. Other modules do not claim
zero pending work when no marker is shown; the B5 action-inbox contract remains the path to
complete cross-module counts.

Verified locally: backend and frontend typechecks, lint and production builds pass; the two focused
badge derivation tests pass; all 267 frontend tests in 43 files pass. A live browser smoke on the
managed preview showed principal and parent grid/list pages, the parent's real pending Leave
marker, and no horizontal overflow at 320, 390 or 430 px. The preview health endpoint returned
OK and the existing ngrok tunnel remained active. Physical-phone/user review remains open; this
increment has not been deployed to production.

## Grouped More hierarchy across all portals — 7 October 2026

User decision: apply the settings-style hierarchy to **every** institutional view,
not only admin. Keep the app's theme and primary navigation. Group headings organize
the same screen; they do not add a layer of navigation. The default is now a compact
list, while an explicitly saved grid/list preference is retained per account.

| View | Stable groups |
| --- | --- |
| Admin | People; Academics; Operations; Institute; Account |
| Staff | My work; Schedule & activities; Communication & care; Administration (only when delegated); Staff services; Account |
| Parent / student | Learning; Schedule & attendance; School life; Payments & policies; Account |

Search indexes accessible destinations, familiar task synonyms and the admin's
nested tasks, displaying each result's location in the hierarchy. Hidden staff
modules are excluded before grouping/search; empty groups disappear. Parent links
retain `student_id` in either layout and in search. Existing action-dot semantics
remain unchanged: this navigation slice does not invent counts or widen access.

Canonical homes and routes:

- Students & guardians owns import, class promotion and family invitations.
- Staff owns its directory, roles, assignments, leave and staff invitations.
- A single invitation UI handles contextual entry from People/Staff/Account access,
  preselects the account type, and returns to the originating module. The older
  duplicate invitation creation/revocation UI in Administration was removed.
- Institute settings is a short list leading to Academic setup, Account access,
  Administrative history and Setup status. Its children have explicit back routes.
  Completed onboarding is not displayed in More or ongoing academic setup. A
  Finish setup shortcut appears only for a successfully loaded non-active institution.
- Timetable & calendar owns the daily plan, weekly timetable and calendar, with
  shared local navigation. The primary Timetable tab uses the same entry point.
- Assessments and Report cards stay separate; search can open grading schemes
  directly. Policies & governance has addressable profile/register tabs.
- Account security remains findable under Account and is also accessible from the
  shared profile menu. No additional account-management screen is introduced.

This is navigation/presentation only: existing institutional permissions, protected
care scope, audit writes, invitations and domain workflows retain their server checks.
No database migration or reseeding is required. All route URLs remain compatible.

Verified locally: all 286 frontend tests in 46 files passed, including hierarchy,
permission filtering, selected-child search links, layout persistence, incomplete-only
setup, contextual invitations and nested settings navigation. A subsequent focused
report-workspace regression passed after correcting the grading deep link to load
the scheme detail rather than a report batch. Frontend lint, typecheck and production
build pass. Live Cambridge demo smoke covered all four More views in grid and list
at 320, 390, 768, 1024 and 1440 px without horizontal overflow or runtime exceptions.
Nested settings, invitations, grading, governance profile and planning routes opened
successfully; a real task-search → staff invitation → back-to-Staff sequence passed.
The managed preview health/readiness checks and existing ngrok tunnel are healthy.
Physical-phone/user review remains open. No production deployment is included.


### Institution directory — 7 October 2026

The searchable local UDISE/AISHE directory is integrated into the company console.
Migration 053 keeps master directory identities separate from school tenants,
protects official source/code and tenant links with database uniqueness, and tracks
Stage activation status. Creation and invitations use the existing CompanyService
and email delivery path; university/standalone records use the existing college
workspace. CSV upsert and explicit legacy mappings preserve stable identities.
See ../INSTITUTION_DIRECTORY.md. Integrated Stage CI and deployed UI review are
required before claiming this change live; no national dataset is committed.

## Stage release verification — 7 October 2026

The grouped More hierarchy, staff access/governance work and companion migrations
were released to **Stage**, not production, at commit `bc22e550bad2dacd7199fc1922c35bb7eb582b4d`.
[Stage workflow 37655645215](https://github.com/EduveraIITA/Eduvera/actions/runs/37655645215)
passed secret scanning, backend build and integration tests, a fresh PostgreSQL 17
migration/seed, all 286 mobile tests, the desktop build, existing Stage migrations,
and Railway deployment. The Stage demo seed completed for roles, a two-rider
transport trip, governance sources/offices/bodies/appointments/decision rules,
and an Attendance reviewer scoped to Class 6A. The transport pattern seed now
upserts by its stable demo ID so a later calendar date does not collide with an
existing primary key. The Stage workflow's public smoke check passed both SPAs,
API readiness, demo login, install icons, OpenAPI and protected metrics.

Independent checks of `https://omnischool-stage.up.railway.app` returned HTTP 200
for `/` and `/staff/`; `/readyz` reported database and events OK; `/releasez`
reported the exact commit above and `environment: stage`. The local review preview
also remained ready. Physical-phone/user review is still open, and this evidence
does not assert a production release.

## Timetable and calendar simplification — 7 October 2026

User decision: simplify the planning screens using a calm, content-first hierarchy.
This supersedes the earlier large blue date board and stacked planning/view tabs,
while retaining the established school header, bottom navigation, typeface and
per-child accent. Blueprint sections 6–7 remain the basis: daily expectations and
scoped work are primary, with a stable navigation model. The UI approach follows
[Apple's toolbar guidance](https://developer.apple.com/design/human-interface-guidelines/toolbars)
and [layout hierarchy guidance](https://developer.apple.com/design/human-interface-guidelines/layout),
adapted to the existing web components rather than a native Apple implementation.

- Admin planning has two browsing destinations, **Timetable** and **Calendar**.
  **Edit timetable** opens the existing weekly management workspace; it is no longer
  a competing browsing tab plus a duplicate management button. Links retain the
  selected school, date and class. Existing route URLs remain compatible.
- All four timetable readers use one compact view picker and neutral date surface.
  Day view shows a complete Monday–Sunday rail, selected-date text, a separate Today
  marker and previous/next-week controls. Month and Year keep their drill-downs;
  period navigation handles month ends and leap years without overflowing dates.
- Admin daily change/revision and printing controls are in **Schedule actions**.
  The published schedule appears earlier on mobile. Drafting, publication, coverage,
  history and server authorization are unchanged; no new mutation is introduced.
- Parent/student Day views use a vertical agenda with full subject names, times,
  teacher, room, cancellation and supplied materials. Existing lesson details remain
  accessible by tapping a row. Week view retains the comparative weekly grid.
- The shared calendar uses a compact Month/Day picker, lighter date grid, explicit
  today/selection semantics and an expandable **Calendar key**. Its role-specific
  events, leave, attendance and school closure details remain unchanged.

Verified locally: the 76-test timetable/calendar/navigation/day-plan/route run passed;
the subsequent 17-test calendar/navigation/timetable/weekly-builder run passed.
The new family agenda regression and five affected route tests passed after the
agenda change. Frontend lint, typecheck and production build pass. Browser smoke
covered admin, teacher, parent and student timetable/calendar at 320, 390, 768,
1024 and 1440 CSS pixels with no horizontal page overflow or runtime exceptions.
Month-to-Day selection, Today, calendar Day navigation, keyboard dismissal of
schedule actions, family lesson details and return to the weekly grid were exercised.
Local and ngrok readiness both report database and events OK. No database changes
or reseeding are required. This slice has not been pushed or deployed to Stage. Physical-phone/user
acceptance remains open; please review the live preview before further UI expansion.

### Timetable navigation follow-up — 7 October 2026

Latest user decisions supersede the Week browsing behavior above:

- Retain the **Day / Month / Year** dropdown. Remove Week from the shared
  timetable reader; Day already includes the seven-day rail. Existing `view=week`
  links safely open Day. The separate admin weekly timetable editor is unchanged.
- Day and Month are the compact and expanded forms of the same date selector.
  The bottom toggle is **arrow-only**, with an accessible name, expanded state,
  keyboard activation and a 44-pixel-high target. The month heading also toggles it.
  No visible Expand/Collapse wording and **no swipe gesture**: ordinary touch
  scrolling remains with the browser. This supersedes the initial gesture idea.
- Selecting dates or another month preserves expanded Month and updates
  the daily schedule beneath it. **Today selects today and collapses to Day**,
  including when invoked from Year. URL state retains the view through reload/back.
  Dates remain selectable while totals load or fail; unloaded totals are not
  presented as free days.
- Year shows only its overview in admin, teacher, parent and student timetables:
  no daily periods, empty-day messages, notices or materials list. Opening a month
  returns to the expanded Month selector. School/class/child context is retained.
- During date fetches, keep the date selector and same-person/class context stable,
  show a loading state instead of the previous day's work, and never reuse a
  different child's placeholder data. Teachers can still change school in Year.
- Selected dates share the same solid-accent circle and white number in compact
  Day and expanded Month; Today uses the same accent outline in both. Shared theme
  tokens retain each child's colour instead of a separate pale Month selection.

Verified locally: 30 focused timetable/calendar/navigation/day-plan tests and seven
affected route tests passed. Browser checks passed for all four roles: the three
dropdown choices, expansion/collapse controls, no gesture-triggered mode change,
Month persistence after selection and reload, Year hiding of daily content, and
Year-to-Month drill-down. Day/Month/Year had no horizontal page overflow at 320,
390, 768, 1024 and 1440 CSS pixels, and no runtime exceptions were observed.
The final arrow-only control and delayed parent-date fetch were also checked in a
mobile browser: the calendar stayed expanded and the old day's agenda was hidden
during loading. Frontend lint, typecheck and production build pass. Local and ngrok
readiness report database and events OK. These navigation changes alone need no database changes. Physical-phone
user review remains open; this follow-up is not pushed or deployed.

### Timetable editing repair — 7 October 2026

- **Prepare changes:** reproduced a mobile Safari/WebKit event-order bug. Tapping
  the menu action blurred the native disclosure with a null focus target, closing
  it before its click could fire. The shared ScheduleActions wrapper now dismisses
  on outside pointer interaction, actual keyboard focus departure or Escape, not
  a null-target blur from a tap inside. Existing draft authorization and command
  behavior remain unchanged.
- **Edit timetable:** the route opened, but its API failed because the runtime
  database role could not read `curriculum_subject_targets`. That table had retained
  a different migration-account owner. Migration **053** aligns table and scope
  validator ownership with `students`, following the existing direct-database
  application boundary. RLS stays enabled; PUBLIC, anon and authenticated do not
  gain table access. No timetable data is rewritten. The editor also now retains
  the selected date/week from the daily view, with invalid/out-of-term fallback.
- Applied only the reviewed 053 SQL transactionally to the local preview database
  and a dedicated test clone. **No remote database or Stage changes were made.**
  The ordinary migration runner is blocked locally by a pre-existing checksum
  mismatch for migration **047**. Its source/history were not rewritten or bypassed
  in the migration ledger; reconcile that drift before using the normal deployment
  migration path. Do not treat this local repair as a clean deployment gate.

Verified: all **44** focused frontend tests across timetable/navigation/calendar,
day-plan API/editor and schedule-menu suites pass; lint, typecheck and production
build pass. **21** backend day-plan integration and migration checks pass against
the isolated database using the runtime role. Real mobile WebKit created a draft
and displayed the editor against that clone; no draft was created in the user's
review data. Chromium and WebKit opened the live weekly/period editor; WebKit also
verified retained date context and Today collapsing from Year. The broad existing
API test was attempted but stopped before timetable assertions on an unrelated
fixed demo-count expectation (200 students versus the clone's 203); it is not
claimed passing. Physical-phone acceptance and deployment remain open.

### Separate timetable settings page — 8 October 2026

User decision: the repeating-timetable editor is a settings destination, inspired
by iPhone Settings, not another Timetable/Calendar browsing tab. This follows
blueprint sections 3 and 6–7 while retaining the existing shared header, theme,
navigation and authorization. Frontend UI engineering guidance informed the grouped
rows, full-row tap targets, keyboard focus handling and progressive disclosure.

- **Edit timetable** now opens a standalone page at the existing `/weekly` route.
  Browsing tabs are absent during loading, errors and normal editing. Back retains
  the selected class, school, date and browsing view.
- Class and term use compact grouped settings rows. A weekday selector leads
  directly to tappable period rows. Removed decorative totals, duplicate date/week
  navigation, the class-card carousel and the always-visible success banner.
- Existing add/edit/remove/copy operations remain intact. Real allocation conflicts
  appear in the class picker, affected weekday and period; they are not hidden by
  the simplified layout. Breaks no longer show meaningless unassigned-teacher text.
- School dates and coverage targets are grouped settings entries. Coverage opens
  as a focused subpage with its own title/back action; query-only page changes
  reset scroll so the scope controls do not disappear behind the header.
- Existing sheets now trap keyboard focus, support Escape (unless saving), and
  restore focus on dismissal. Loading and retry states keep the editor's header
  and back navigation instead of dropping the user onto an unframed error.

**Scheduling scope, not a new temporal model:** the user pointed out that the
screen appears limited to the current week. Inspection of the slot commands confirms
that a slot is keyed by term and weekday, not by calendar week. The editor now
explicitly says **Every week in this term** and shows its start/end dates. The
existing daily-planning link remains available for date-specific changes. Changing
the selected weekday does not create a future-effective timetable version.
The follow-up choice is still open: a different pattern for one selected future
week, a new repeating pattern effective from a future date, or both. Do not claim
these future-scheduling semantics are implemented or simulate them with a date picker.

Verification: 49 focused editor/navigation/calendar/day-plan tests and four affected
route tests pass. After adding explicit term scope, the 22-test editor/navigation
rerun also passes. Lint, typecheck and production build pass. Chromium and WebKit
UI checks covered 320, 390, 768, 1024 and 1440 px: no horizontal overflow; period
dialog opening, focus trapping/restoration, coverage navigation and scroll reset
passed. WebKit also retained Month/class/date on return to the timetable; its
navigation run emitted existing aborted auth-session/event-stream diagnostics, so
this is not a claim of a clean browser-console audit. A separate Chromium check
passed the delayed loading, failed API and successful retry sequence. Local and
ngrok readiness report database and events OK. No new backend/schema/seed changes
were made in this UI slice. Not pushed or deployed; the earlier migration-047 drift
gate and physical-phone review remain open.

## 8 October 2026 — Annual schedule preparation and dated publication

Supersedes the preceding open future-scheduling choice: the user approved both
future repeating arrangements and bounded temporary arrangements. Contract and
research references: `ANNUAL_SCHEDULE_PLANNING.md`. Blueprint sections 3 and 6–8
remain the primary domain reference; shared navigation/theme are preserved.

Implemented standalone Schedule settings, next-year terms/class reuse into
unpublished drafts, school-day timing generation, period editing/day copy,
teaching allocation and existing closure/coverage controls. Publication uses
explicit dates, revision checks, idempotency, active staff checks, class/teacher/
room conflict checks, audit, transactional outbox and deduplicated notifications.
Migration 054 adds immutable dated recurring versions and freezes legacy baseline
identities at first publication. Closures and published daily changes retain
precedence; temporary expiry restores the preceding pattern. Legacy weekly writes
are blocked once a dated version exists. Teaching-access fallback uses effective
dates. Calendar working-day indicators use actual effective schedules; assessment
dates are projected without marks and scoped to permitted staff or learners.

Verified: 29 backend integration tests (10 annual planning, 19 existing daily-plan)
pass against an isolated full-schema database. Frontend full suite: 320 tests in
50 files pass. Backend/frontend lint, typecheck and production builds passed.
Chromium and WebKit settings checks passed at 320/390/768/1024/1440 px without
horizontal overflow; real-database draft creation and discard passed in both.
Local migration 054 applied transactionally; local and ngrok `/readyz` both report
database/events OK. Demo schedules/enrollments were not replaced by test data.

Boundaries: no automatic timetable solver, student rollover, published-version
cancellation, or remote deployment is claimed. Starts must be after today; same-day
changes remain Daily Plan. Existing migration-ledger drift at 047 still blocks a
normal release until deliberately reconciled; historical checksums were not
rewritten. Physical-phone acceptance remains requested. No push/deploy this turn.

### Daily Plan entry correction — 8 October 2026

The settings link previously returned to the timetable reader, leaving its edit
action inside the overflow menu. It now opens explicit Daily Plan editing mode,
retains class/date, sets Day view, and shows Prepare changes/Create revision as a
primary action. Existing drafts still open in the editor; navigation alone never
creates a draft. Past dates remain read-only. Back returns to Schedule settings.
Five focused navigation/action tests passed, including context preservation,
no write on entry, explicit preparation and historical-date protection. Production
build passed. Chromium/WebKit mobile checks confirmed the actual link destination,
visible preparation action and no horizontal overflow. Local readiness is healthy.
No database change, push or remote deployment for this correction.

### Discard proxy-error handling — 8 October 2026

The reported discard dialog displayed an ngrok HTML document. Current local and
public readiness checks pass; the original transient failure is not conclusively
identified. Shared API handling now rejects HTML proxy responses (including HTTP
200), displays a concise uncertainty/retry message, and preserves JSON domain
errors. Ngrok-hosted API requests send the browser-warning bypass header. An HTML
response cannot be mistaken for a successful command. Six regression tests,
frontend build/typecheck and lint passed. A WebKit mobile check against an isolated
database injected an HTML 502 on discard, verified the readable error, then retried
against the actual backend: discard succeeded with the identical idempotency key.
The user's live draft was not altered. No migration or remote deployment.

### Simplified day editing — 8 October 2026

User decision supersedes the separate Daily Plan entry mode above: remove the
large Change this day panel. The ordinary Day schedule overflow menu now offers
Edit day schedule (or Resume editing for an existing draft). The editor opens
only after that action; opening the timetable does not create or open a draft.
Schedule settings retains a plainly labelled View day schedule navigation link,
not a required editing gateway. Date/class context and past-date safeguards remain.
Five focused tests, production build/typecheck and lint pass. WebKit mobile testing
against the isolated database verified menu → editor, reload → read-only schedule,
Resume editing → discard. No live user draft was modified, no schema change or
deployment. Uses the existing accessible overflow-menu pattern and shared theme.

Menu polish: Edit day schedule/Resume editing now has a decorative 19px pencil
icon matching Print. Both actions use equal horizontal padding and nonshrinking
icons. Three focused tests and typecheck pass; local readiness remains healthy.

## 8 October 2026 — Attendance presentation simplification

Applied the user's timetable-style simplification to staff/admin workspaces and
registers, plus parent/student attendance. Blueprint sections 6, 8, 10 and 12
invariants retained: unsubmitted is not absence, gate observations remain separate,
offline/reconciliation states remain explicit, correction/locking rules unchanged.

- Shared compact attendance date control: native date entry, Previous/Next day,
  Today and arrow-only month disclosure. Picking a date keeps the month expanded;
  Today collapses it. Register date changes still use the unsaved-edit confirmation.
- Removed the staff workspace gradient hero; kept compact factual totals, search
  and status filters. Class cards form a flatter grouped list. Attendance desk
  starts collapsed unless review cases/errors require attention; paper entry and
  reconciliation remain available within it.
- Register header is flatter with the shared date control. Removed redundant
  principal-review prose; retained the explicit edit/correction action, attribution,
  revision history, source handling, offline warnings and submission safeguards.
- Parent calendar and subject records precede optional breakdown/arrival details.
  Student subject attendance precedes optional class standings/absence simulation.
  These secondary sections use disclosures, not deleted features. Family summaries
  use existing surfaces and child accents with corrected text contrast. Source
  order follows visual order for keyboard users. No data/permission/schema changes.

Evidence: full frontend suite 331/331 passed; post-reordering focused tests 17/17
passed. Build/typecheck and lint passed. WebKit checks covered principal, teacher,
parent and student at 320/390/768/1024/1440 px with no horizontal overflow; expanded
calendar and real register navigation checked. Local/ngrok readiness both healthy.
Physical-phone review requested. No push or remote deployment this turn.

### Attendance-first correction — 8 October 2026

The user rejected copying timetable controls into attendance. This decision
supersedes the expandable attendance calendar and workspace totals above.
Staff/admin attendance is a daily register queue: one inline native date picker
with adjacent-day navigation (Today only when viewing another day), followed by
one status select with counts and optional search/attendance-desk tools. Removed
the separate calendar card/expander, repeated totals, Registers heading and four
filter chips. Registers now follow the controls directly. Existing filter logic,
record states and marking/correction rules are unchanged.

Desk cases retain a badge plus visible review notice; load failures retain an
explicit notice, never an implied zero queue. Paper/reconciliation tools open
from the desk button. Search opens with focus and closes/clears with Escape or
its close button, returning focus to its trigger. The native date picker also
simplifies individual registers while retaining unsaved-edit protection.

Verified: 23 focused date/workspace/register tests, build/typecheck and lint pass.
WebKit shows no horizontal overflow at 320/390/768/1024/1440 px. Real preview
principal and teacher search/filter entry and principal desk opening verified;
mobile screenshot confirms class records visible immediately below two control
rows. Local and ngrok readiness healthy. No data/schema edits, push or deployment.
Request phone validation of this revised hierarchy rather than claiming acceptance.

### Shared date navigation — 8 October 2026

Latest user decisions supersede the previous per-module picker treatments:

- One shared date-navigation component, date grid and view selector now serve
  timetable and Calendar across all four portals, plus admin/teacher attendance
  workspaces and individual registers. Module-specific data and actions remain
  separate; this does not add new attendance aggregates or permissions.
- Tapping the top-left date/month/year uses the same native date input in each
  module. It does **not** expand/collapse the inline calendar. Only the separate
  arrow (or Day/Month selector) changes inline presentation. Timetable retains
  its Year overview without a daily agenda. No swipe gestures were added.
- Attendance remains one compact date row, with adjacent-day arrows and **no
  inline expansion**. Timetable/Calendar use Monday-first seven-day strips and
  week arrows; expanded month and year arrows move the displayed period. All
  arrows have explicit accessible period labels.
- Today is shown only when the selected school date differs from today. Returning
  to today also collapses the timetable/calendar month view. Calendar updates
  date and view atomically while retaining other URL context. Picking another
  date does not collapse an already expanded month.
- The same accent-filled circle marks selection; an outline marks unselected
  today. Event/status dots and timetable totals remain domain-specific; indicator
  space is reserved across a row to keep date numbers aligned. Month/year changes
  clamp to valid dates; date arithmetic uses UTC calendar days, not device offsets.
- Removed the repeated visible selected-date/Today line next to the expansion
  arrow and tightened bottom spacing. A screen-reader announcement remains.
  Touch targets, keyboard month-boundary navigation and visible focus are retained.
- Schedule settings is an unboxed text link with its chevron and keyboard focus
  outline. The actual destination and class/date context are unchanged.
- Register date changes still go through the unsaved-work confirmation. Rejected
  changes do not update the controlled date. No attendance commands, access rules,
  schema changes, live-data edits or remote deployment are part of this change.

Evidence: full frontend suite passed 339/339 before final minor styling/metadata
polish. Focused shared-control checks cover native input changes vs expansion,
Today visibility/collapse, guard rejection, leap years, month-end clamping,
keyboard focus and calendar indicators. WebKit exercised date selection, month
selection persistence and Today across principal/teacher/parent/student timetable
and Calendar plus both staff attendance queues; no horizontal overflow at
320/390/768/1024/1440 px. Local and ngrok readiness passed. Physical-phone native
picker and visual acceptance remain requested; browser emulation is not that sign-off.

Final polish verification: 19 focused date/navigation tests, production build,
typecheck and lint passed. WebKit confirmed the Schedule settings link has zero
border, transparent background and a retained 44px hit area on both routes;
320/390px rechecks and local readiness passed after the final changes.

### Timetable compact counts and monthly year overview — 8 October 2026

User clarification: Year is an overview of monthly scheduled classes, **not** a
grid of miniature calendars. The interim mini-calendar design was rejected and
removed. Year now displays twelve tappable month totals with a restrained selected
month accent, no date cells, bar chart, or daily agenda. Tapping a month retains
the established Month-view destination. Counts retain the existing "periods"
unit: these are scheduled lesson periods, not distinct class sections.

The compact seven-day strip now shows the same per-date count as the expanded
month (dash for a known free day). Missing or failed data is never presented as
zero/free. The shared implementation serves all timetable portals and preserves
child accent colours. Month totals without summary data read "Not loaded".

Verified: 12 date/timetable component tests passed after the correction, including
compact counts, missing data and the explicit absence of calendar dates in Year.
Seven route-level timetable checks passed during this slice. WebKit verified the
final monthly-total layout and month drill-down at 320/390/768/1024/1440 px with no
horizontal overflow; all four portal count/navigation flows were also exercised.
Phone visual acceptance remains open. No data, permission or schema changes.

### Attendance paper/offline review clarity — 8 October 2026

User feedback: the "Operational continuity / Evidence and reconciliation" panel
did not explain its purpose and repeated headings, zero summaries and nested boxes.
The panel is now named **Paper & offline entries**, with one short explanation,
flat class/date review rows, and a collapsed **Enter a paper register** action.
The empty state is a single "Nothing to review" line. Processing details no longer
dominate the view: pending entries appear only when nonzero; applied/rejected
totals are disclosed under their actual attendance date. Missing, loading and
failed responses never imply a zero/clear queue.

Scope was checked against the existing backend: open cases and pending/review
counts span all dates, while processed totals are date-specific. Every case shows
its own date; the toolbar uses the full review count rather than the loaded list
(the server caps that list at 50). Review details retain the original server
reason, recorder, observation time, source reference and current revision. Required
notes, locked-register protection, revision checks and accept/reject command
semantics remain intact. Busy actions cannot be duplicated or switched mid-save.

Verification: 347 frontend tests passed before the final additional toolbar-count
regression; the final focused panel/workspace set passes 16 tests. Production
build/typecheck and lint passed. WebKit inspected the real empty/paper-entry flow
and read-only mocked review/locked/error states; no overflow at
320/390/768/1024/1440px, with 44px controls and keyboard focus verified. A navigation
abort of the existing events stream produced an access-control console error;
this is not represented as a clean console or a resolved event-stream issue.
Local preview readiness is healthy. No attendance records, permissions or schema
were changed; no push or deployment. Physical-phone visual validation is pending.

### Public institution directory population — 8 October 2026

Prepared a checksum-pinned, Stage-only import of the publicly licensed India Data
Portal UDISE snapshot and an AISHE-derived public snapshot. Rows retain provenance,
remain unverified, and cannot overwrite existing official identities or tenant
links. Normalization rejects invalid identifiers and quarantines conflicting
AISHE codes. Source files remain outside Git. The dedicated workflow verifies the
loader against isolated PostgreSQL before using the existing Stage credentials;
its summary artifact records actual accepted/rejected counts. Live counts and
search verification must be taken from a successful run, not inferred from source
row totals. See `docs/INSTITUTION_DIRECTORY.md` for attribution and snapshot dates.

Stage import attempt `37671492107` failed with PostgreSQL `53100` (no space left
on device) after validating all 1,440,856 rows. Its atomic transaction rolled back;
these are prepared counts, not live directory coverage. The loader now respects
per-statement limits with 5,000-row windows, verified by a late-window rollback
test. Automatic imports are disabled: full import requires a manual workflow run
after database storage is increased. Ordinary VACUUM is available for reclaiming
dead tuples without removing live records; no tenant records are deleted.

### Scheduling/attendance Stage integration — 8 October 2026

Pulled Stage through `196e93a` and preserved its institution-directory work alongside
the scheduling and attendance changes. The only merge conflict was the appended
implementation record; both histories are retained. The three unrelated local
duplicate files named with ` 2` remain untracked and are excluded from the release.

Historical migration sources, including 047, are unchanged relative to the latest
successfully deployed Stage revision. The earlier 047 checksum warning concerns
the local preview ledger; it was not bypassed or rewritten. The two independently
named 053 migrations are distinct immutable entries in the existing filename-keyed
runner. New curriculum ownership and annual schedule migrations remain subject to
fresh PostgreSQL 17 integration tests and normal Stage checksum enforcement.

Merged backend typecheck/lint/build, mobile typecheck/lint/build and desktop
typecheck/build passed locally. Deployment is pending the push-triggered Stage
verification, migration and exact-release health gates; this entry does not claim
that the new revision is already live. No full demo reset or national-directory
import was requested or started.
