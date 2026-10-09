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
| F1: Intelligence | Read-only attendance copilot plus locally verified, provider-neutral cross-app agent with explicit reviewed actions (9 October user decision; see SCHOOL_AGENT.md) | Domain-by-domain coverage/acceptance, cloud-model evaluations, retention/load/security release gates; no physical authority, diagnosis or autonomous reconciliation |

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


### Principal intelligence dashboard — 7 October 2026

Implemented on the principal home route using the existing blue/mint theme and
shared navigation. The read-only, school-scoped insights endpoint aggregates
attendance trends and completeness, engagement changes, latest published assessment
results, follow-up ownership, upcoming teaching coverage, deadline clusters and
fee ageing. Review windows, class filters, academic thresholds and source-record
drill-downs are available. Existing daily operational workflows remain in place.
See [metric definitions](PRINCIPAL_INSIGHTS.md). No migration or reseed is required.

Verified locally: backend lint, typecheck and build; frontend lint, typecheck and
production build; 8 focused backend tests (including integration on PGlite with all
repository migrations applied); 18 focused frontend tests. Browser checks at 320,
768, 1024 and 1440 px passed for overflow, filter requests, dialog fit, Escape
dismissal and runtime errors using clearly synthetic API fixtures. This is not
PostgreSQL 17 CI or live-data validation. Integrated Stage CI, deployed school-data
checks and user UI review remain open. No merge or deployment is included.
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

Release verified: [Stage run 37687825563](https://github.com/EduveraIITA/Eduvera/actions/runs/37687825563)
passed all gates and deployed application revision
`f77127bd1f7b83018be506a17b7183022646e391`. CI passed **317 backend tests in 45
files** and **358 frontend tests in 55 files**, plus secret scanning, all builds,
and fresh PostgreSQL 17 migration/seed verification. Stage then applied
`053_timetable_curriculum_ownership.sql` and `054_annual_schedule_planning.sql`
through the normal checksum-validating runner. Full reseeding was skipped.

Independent public checks returned that exact SHA and `environment: stage`, with
database/events ready. Authenticated WebKit mobile checks opened the new
paper/offline attendance panel and paper-entry selector, navigated from timetable
to Schedule settings, and loaded all eight class arrangements without alerts or
horizontal overflow. The local preview also remained ready. This records a Stage
release, not production approval or physical-device acceptance. The documentation-
only evidence commit does not require redeploying the unchanged application.

### 8 October 2026 — teacher class directory and individual class pages (local)

User decision: keep the shared visual system but replace the large class hero
and inline expansions with a settings-style directory and separate class pages.
The follow-up explicitly requires lesson times and class activity on the list.

- Directory rows show subjects, students, room, dated lesson times (including
  cancellation), attendance state and a separate activity link. No false zero
  counts or empty-state messages are used when loading fails.
- `/teacher/classes/:classId` preserves date and section through reload/back.
  Overview contains class facts, register/timetable links and lesson materials;
  Students contains a searchable roster; Updates contains published notes,
  private replies addressed to this teacher and recorded class notifications.
- The new read-only class-updates endpoint uses the existing date-scoped
  attendance workspace and `attendance.view` permission. It does not infer a
  class from an arbitrary student's current enrolment. Replies are additionally
  limited to diary items authored by the requesting teacher; another teacher's
  private replies are excluded. Published notes are term-scoped.
- Activity is explicitly **recent, last 14 days**, not an invented unread count.
  Only actual notification rows use unread state and an explicit Mark as read
  action. Opening a class does not mark anything read. Both daily-plan and
  repeating-timetable notifications can map to a class. Unscoped notifications
  are not guessed into a class. The latest 50 items per class are returned with
  an explicit truncation message; these badges are not lifetime totals. Updates
  refresh every minute and on focus. Notes/comments do not yet have individual
  server-side read receipts; school-wide changes without class metadata remain
  in the main notification centre.
- Verified locally: frontend/backend typechecking and lint; production builds;
  isolated PostgreSQL class-feed test covering assigned class, term, unpublished
  notes, private recipient, read/unread state and empty scope. Real-data WebKit
  directory/detail/roster/update screens loaded without alerts, preserved a
  direct roster URL through reload, and had no horizontal overflow at widths
  320/390/768/1024/1440. All **371 frontend tests in 56 files** passed.
  Local `/readyz` returned database/events ready.

This is local implementation, not a Stage deployment or physical-device signoff.
User phone validation remains requested. The existing blueprint and shared
header/navigation/theme are unchanged; no school data reset or migration is needed.

Follow-up: Students now offers labelled gallery/list icon controls with pressed
states and 44px targets. List remains the initial default; the chosen layout is
remembered in this browser, with a safe fallback when storage is disabled.
Gallery uses larger photos/initials and retains name, roll/admission number and
attendance state. Search persists while switching layouts. Typecheck, lint and
15 focused class tests passed; WebKit verified persistence after reload and no
horizontal overflow at 320/768/1024/1440px. Preview remained ready. Local only.

Gallery refinement requested immediately afterwards: restored the earlier compact
portrait treatment rather than two large cards per row. Mobile shows four
60px portraits per row, roll-number badges, names and text attendance labels with
status rings; no individual card boxes or admission-number repetition. Admission
numbers remain searchable and visible in list mode. List/toggle persistence is
unchanged. Typecheck and all 15 focused tests passed; WebKit checked four columns
at 320/390px and no overflow through 1440px. Local preview remains healthy; user
visual approval and deployment are still pending.

### Non-home navigation and compact-workspace pass — 8 October 2026 (local)

User direction: retain the shared identity header and every portal home page;
simplify non-home work, not merely recolour oversized banners. Before adding a
screen, check that it has one page title, puts its main list/action immediately
below essential controls, and has no introductory card repeating the page title.
Counts belong beside the relevant list/tab; nonzero action counts must lead to
the work. Use grouped rows and separate record pages. Preserve status meanings,
permissions, confirmations and evidence; never hide operational exceptions to
make a screen look cleaner.

Implemented in this pass:
- Route-scoped shared styling excludes principal, teacher, parent and student
  home routes. Existing branding, marksheets and safety/map status treatments
  remain intact. Default Back moves to the module's parent, preserving relevant
  child/date context; explicit workflow back/cancel handlers retain precedence.
- Assessments, grading schemes/report releases and published policies have
  URL-addressable list/detail navigation rather than auto-opening a record
  underneath its directory. Transport has request, roster, journey, pickup and
  settings sections; forms return to their originating section.
- Staff now begins with tabs and its searchable directory: no Staff Setup hero,
  duplicate People/Staff directory headings or standalone invitation card.
  Active count and Invite/Add share a compact toolbar. Leave badge includes
  outstanding review and cover-gap counts with accessible detail. My Work and
  My Leave summaries are compact rows, not hero cards.
- Removed the duplicate family-fees child selector, kept the shared selector,
  corrected teacher invitation guidance to avoid an inaccessible admin link,
  simplified student leave labels and aligned Schedule settings naming.

Verification: typecheck, lint and production build passed; the full frontend
suite passed 388 tests in 58 files before the final Staff header refinement.
Real-data WebKit checked revised screens in all four portals at 390px with no
horizontal overflow or visible alerts; each home was outside the redesign scope.
Assessment/report detail links survived reload and Back restored their lists;
transport form Back restored settings. Staff, transport and report indices also
had no horizontal overflow at 320/768/1440px.
After the Staff refinement, all 32 focused staff/navigation tests and the
production build passed. The mobile Staff screen has one heading and displays
five complete staff rows within the 390×844 viewport. Local readiness reports
database and events healthy.

This is a substantial first pass, not a claim that every module, mutation,
permission combination or physical-device interaction is signed off. Remaining
acceptance includes user phone review of the simplified hierarchy and individual
legacy-screen cleanup where needed. No Stage deployment or database migration
was performed for this UX pass.

### Remaining non-home screen review — 8 October 2026 (local)

Continued after the user explicitly requested the remaining pages. Reviewed 59
non-home routes in real-data mobile WebKit: principal (19), teacher (14), parent
(12), student (14). These checks covered the index/form routes for attendance,
timetable/calendar, students/import, administration, activation, fees, staff,
messages, concerns, events/create, policies/governance, assessments, reports,
transport, invitations, classes, leave, responsibilities, diary, eligibility,
results and More. Existing compact screens were retained rather than redesigned
without a need. Homes remain excluded from the secondary-screen styling.

Additional implemented changes:
- Event lists have filters and real pending-action context instead of summary
  banners; event details/registers use compact metadata, a single page heading,
  readable statuses and smaller readiness summaries. Consent and register
  restrictions remain unchanged.
- Student diary has one context line and entries instead of two summary cards.
  Parent diary puts notes first in the default empty-packing case; day plan and
  packing are a disclosure, automatically open when there are packing items.
  No-action acknowledgement is a line, and an unavailable note form is omitted.
- Student attendance removes duplicate name/title, decorative ring and repeated
  buffer panel. Eligibility leads with the actual attendance result, with a
  compact next-class/timetable action instead of an empty next-class card.
- Removed the governance metric banner, retaining authority review counts and
  the boundary between app access and institutional authority. Fee balances and
  actions are compact; empty review queues/history no longer occupy large cards.
- Removed duplicate timetable headings, parent leave sign-off banner, and the
  redundant Apply Leave tab/context row. Student secondary routes share the
  same bottom navigation; leave uses More, without changing the student home.
- Account security links retain their originating More route and child context;
  the return target is restricted to the four known More paths. Browser-tested
  account return and diary disclosure opening/closing.

Verification: all 389 frontend tests in 58 files passed; typecheck, lint and
production build passed after the final component refinements. The 59-route
mobile smoke audit had no horizontal overflow or visible error alerts. Eleven
changed layouts were additionally checked at 320/768/1024/1440px, without
horizontal overflow. Visual inspection caught and corrected light-on-light
eligibility/transport text after removing their dark banners. Preview readiness
reports database/events healthy.

Correction after user review: the preceding 59-route pass was a smoke audit and
selected visual cleanup, not completion of the requested all-screen overhaul.
Many route entries were retained or only lightly changed. It did not establish
that every record, modal, permission combination, assistive technology
or physical-device interaction has been exercised. Business commands, financial
verification, safeguarding warnings and authorisation were not relaxed for visual
simplicity. Phone review remains requested; these changes are local, not deployed.

### Structural gaps found after user review — 8 October 2026 (local)

The user correctly identified untouched layouts. Do not use the count of routes
loaded as a count of redesigned screens. The earlier user-facing coverage list
combined substantial changes with minor heading/style changes and was too broad.

This batch changes actual navigation/content structure:
- Students & guardians: a searchable directory without a duplicate directory
  heading; secondary actions under an overflow menu. Student, enrollment and
  guardian-permission screens are mutually exclusive URL-addressable views.
  Profile reload uses the authorized school/admission lookup and checks exact
  student identity; it never substitutes another returned student. Back returns
  permissions → student → directory.
- Fees: records are the default. Reviews and payment settings have separate
  views. Posting an invoice or recording payment opens a focused form, not a
  panel elsewhere in the ledger. Student filter and selected invoice are in the
  URL. Balance detail is optional while outstanding/refund totals remain visible.
  Flattened invoices and removed repeated record headings; verification and
  idempotency behavior remain in place.
- Academic setup: removed the repeated page heading. Class promotion opens its
  form immediately instead of requiring another disclosure click.

These are local changes. The previous rollout has not been deployed, so a
deployed app will still show the older screens. User has been asked which pages
and environment they are looking at; no answer is required to apply these fixes.

Verified for this batch: 396 frontend tests in 60 files passed, including new
profile/enrollment/guardian-navigation and fee-form/review/settings tests.
Typecheck, lint and production build passed. Real-data WebKit verified student
and payment-form direct-link reloads, hierarchical Back, and the student actions
menu. Six affected screens had no overflow or visible alerts at 320/768/1024/1440.
The fee navigation preserves institution/student context. Local readiness is
healthy; no deployment or database change was performed.

### Focused remaining-workspace overhaul — 8 October 2026 (local)

Continued at the user's request after the coverage correction above. The
frontend UI skill informed content-first layouts, accessible controls and
URL-backed navigation. This batch changes eight specific workflow groups;
it does not use a route-smoke count as evidence of a universal redesign.

- **Invitations (admin/delegated staff):** history and status filter first;
  creating an invitation is a separate URL view. Contextual Invite staff/student
  links still preselect the account type. Cancel returns to history; invitation
  codes are not placed in the URL and the delivery/acceptance distinction remains.
- **Student imports (admin/delegated staff):** compact history rows open a
  review/receipt view. New import is separate from history and survives reload.
  School selection resolves only against authorized memberships. Upload guidance,
  explicit review/commit, account/permission boundaries and audit receipts remain.
- **Setup status:** completed checks are collapsed. Active institutions still
  see any current incomplete required check; active is not treated as proof that
  every readiness check continues to pass. Removed the duplicate progress/success
  banners without changing review/activation commands.
- **Family fees (parent/student):** separate invoices, receipts and reviews;
  opening an invoice replaces the directory. Direct links retain student context;
  switching children clears the selected invoice. Students remain read-only.
  Payment reporting retains amount bounds, idempotency, required confirmation and
  explicit pending-verification language. Print is labelled for the current view.
- **Restricted care (admin/staff):** case and intake pages replace scrolling
  overlays, with URL state and Back to cases even after a load error. Team settings
  are separate, with an optional add-member form. Open/reporting counts are inline,
  both recipient-route states remain visible, and emergency/reporting warnings,
  forced alternate routing and explicit per-case access are preserved.
- **Event detail (admin/staff):** sessions, participants and fee reconciliation
  are separate views. Metadata is compact; secondary event commands use an
  accessible overflow menu. Session rows are flat. Existing consent distinctions,
  coarse-only staff finance visibility, cancellation confirmation and manual
  refund evidence remain. Empty reconciliation and unavailable finance states are
  explicit; the read-only fee view does not invent a refund action.
- **Policies/governance:** compact four-section navigation and decision-route
  rows. A rule opens its full initiation/review/decision/implementation conditions
  separately. Policy editors have URLs and return to the register. Publication
  review now displays the exact draft text, audiences, dates and source note above
  the existing review/override controls; editing rules and authority boundaries
  are unchanged.
- **Teacher leave:** requests and balances have separate views; Apply opens a
  focused form with no balance/history stack behind it. Cancel/Back retains the
  originating section. Request cards are flat; approval and withdrawal commands
  are unchanged.

Verification: all **408 frontend tests in 62 files passed**. New tests cover
family fee navigation/read-only access/child switching, import navigation and
school resolution, completed setup disclosure, invitation navigation, care error
return, and decision-route navigation. Updated tests exercise the actual section
selection before asserting existing consent, financial and leave safeguards.
Typecheck, lint and production build passed. Real-data WebKit rendered 24 affected
routes/views across four portals at 320/768/1024/1440px with no horizontal overflow,
visible error alerts or page exceptions. Two additional teacher care URLs were
correctly redirected by the demo account's permission gate; they are not counted
as rendered care screens. Care layout was checked through the admin portal and
its teacher variant through component tests, without expanding demo permissions.
Student/parent invoice reload and Back,
policy and decision-route reload, and event participant reload were also checked.
All four home routes were confirmed outside the secondary-screen styling.

No database reset, migration, permission expansion, push or deployment was done.
The preview remains local; phone review of these workflows is still requested.
These checks do not certify every modal, dataset, assistive technology or device.

### Screenshot-led correction: remaining banners and directories — 8 October 2026 (local)

The user's seven screenshots identified omissions in the preceding passes:
assessment and report-card summaries, the separate message-report queue,
the Messages toolbar, and the events **index** (the prior pass changed event
details). Prior route smoke checks did not establish these screens were redesigned.
This correction covers those five workflows and their shared portal variants;
it is not a claim that every screen in the product is complete.

- **Assessments, admin and teacher:** removed the blue metrics banner. A compact
  status filter carries counts and persists in the URL; opening and returning
  from an assessment preserves it. Each row retains subject, class, date and
  explicit status. Admin creation uses a small New menu with both assessment and
  cycle creation; an assessment still requires a cycle. No teacher creation
  permission or result-publication rule was added.
- **Report cards, admin and teacher:** removed the blue summary. Admins retain
  Releases/Schemes navigation, with New scheme in the Schemes view. Teachers no
  longer get a single-option Releases tab. Release status counts are filters,
  and the selected filter survives detail navigation. Published reports, review
  requirements and correction commands are unchanged.
- **Messages, all four portals:** removed the repeated Conversations heading,
  fixed the vertically stacked toolbar, and replaced ambiguous icons with one
  named New message action plus an options menu for group creation/privacy.
  Removed the duplicate floating compose button obscured by the bottom nav.
  Conversations are one grouped list with unread counts and timestamps retained.
- **Events index, admin and teacher:** replaced large individual event cards
  and separate action/intro blocks with a filter, compact creation link and
  full-row event links. Rows retain event time, venue and status and show their
  own open-register count. Server pagination retains the selected filter.
  Family event consent/participation screens are not changed by this index pass.
- **Message reports:** replaced the horizontal incident strip and automatically
  selected detail underneath it with an exclusive list/detail flow. A `report`
  URL restores the requested record; missing or inaccessible records never
  silently fall back to another report. The shell provides the detail title and
  Back to the same report queue/status. Report content, reviewer restrictions,
  required resolution notes and command payloads remain. Removed redundant
  internal headings, hard-coded school branding, the unconfigured four-hour
  target and canned note chips. Emergency guidance, confidential access and the
  distinction between recorded closure and statutory compliance remain explicit.

The frontend UI engineering skill guided content-first structure, semantic
controls, readable rows and URL-backed navigation. Shared non-home styling also
uses the actual border token so grouped rows have consistent separators.

Verification: **420 frontend tests in 64 files passed**. New regression tests
cover assessment filters and creation prerequisites, teacher report controls,
event row links/pagination, and message-report list/detail, direct links, errors,
staff assignment restrictions, required notes, modal variant and shell Back.
Typecheck, lint and production build passed. Real-data WebKit checked the affected
directories and shared Messages views at 320/768/1024/1440px; no horizontal
overflow was observed. Phone renders were visually reviewed, not just loaded.
The final Messages toolbar is 44px high at all four widths in all four portals;
its options open by keyboard and privacy opens in each portal. Report detail
also passed the four-width check. Assessment/release filter persistence and
message-report reload/Back were verified in the browser. All four home routes
remain outside secondary-screen styling. Both local and phone-preview readiness
endpoints were healthy. No live report action, message send, database reset,
permission expansion, push or deployment was performed. Phone review remains
requested; these checks do not certify all devices or assistive technologies.

### Flat assessment result register — 8 October 2026 (local)

At the user's screenshot-specific request, removed the inset register frame,
rounded inner corners and shaded summary header in admin and teacher assessment
details. Results now use full-width dividers within the existing detail surface,
plain roll numbers, a compact recorded count, and feedback below the score.
An empty workflow-action container no longer adds a blank strip above results.
The evidence-policy label is readable (for example, "Evidence not collected")
instead of "none evidence". This focused use of the frontend UI skill changes no
scoring, authorization, moderation or publication commands.

Verification: all 10 assessment tests passed, including new admin/teacher
read-only and editable-register regressions for unrecorded outcomes, marks and
revision-checked saves. Typecheck, production build and lint passed. Real-data
WebKit checked both portals at 320/768/1024/1440px: the register has no border or
rounded frame, the header has no filled background, and no horizontal overflow
was observed. The mobile render was visually reviewed. Local readiness remains
healthy. No live marks were changed and nothing was pushed or deployed; phone
validation of the updated register is requested.

### Student attendance: scan-first summary and meaningful emphasis — 8 October 2026 (local)

The user clarified that simplicity must not mean muting everything: highlight
facts that help a person understand their position or decide what to do, not
decorative banners. They confirmed the requested header is the **Attendance
summary**, not the shared school header or the Timetable controls. This focused
pass follows the blueprint's distinction between recorded facts, missing data
and projections; it changes no attendance policy or authorization.

- The summary leads with the overall percentage, an explicit above/near/below
  minimum label and the required percentage. Term and attended-day count remain
  visible; detailed totals are under Breakdown. An overall percentage no longer
  asserts eligibility across all subjects.
- Subject rows show name, attended/held classes, percentage and any threshold
  warning. Removed repeated icons, progress bars and safe-buffer pills from the
  collapsed list. One URL-backed subject filter replaces horizontal chips.
- Opening a subject reveals a flat metric row with a prominent safe-buffer class
  count and minimum percentage, followed by teacher, room and next class. The
  adapter exposes the existing buffer calculation as a number, without parsing
  display copy or changing its formula. Positive, zero and below-minimum states
  retain explicit text as well as semantic colour; estimates are not leave
  approval. Missing attendance never becomes a zero-percent or zero-buffer claim.
- Leave, help, class standings and absence planning remain named options. The
  planner requires recorded attendance. Class standings no longer opens from an
  ambiguous percentage/leaderboard preview; closing it restores focus, including
  Safari pointer activation. Home, shared school header and navigation are unchanged.

The frontend UI engineering skill guided the content-first hierarchy, native
disclosures, token-based colours, keyboard access and scoped responsive styles.
Verification: **433 frontend tests across 64 files passed**; the final Safari
focus adjustment also passed all 10 student attendance component tests. Regression
coverage includes threshold states, missing records, numeric buffer values,
subject filtering, expanded details, leave/standings and the planning stepper.
Typecheck, production build and lint passed. Real-data WebKit checked the page at
320/768/1024/1440px without horizontal overflow, and phone screenshots were
visually reviewed. Subject expansion works by keyboard; filter reload, Breakdown,
planning and modal return focus were checked in the browser. The attendance API
returned 200 and in-app navigation produced no page errors. Both local and phone
preview readiness were healthy. No live attendance was changed, and nothing was
pushed or deployed. Phone review of the revised summary and expanded subject is
still requested; these checks do not certify every device or assistive technology.

### Screen simplification release preparation — 8 October 2026

At the user's request to pull, push and deploy, pulled `origin/Stage`; it was
already current at `eab627f`. The release includes the accumulated teacher class
workspace, secondary-screen hierarchy/simplifications, flat assessment register
and focused student attendance changes recorded above. The three unrelated
untracked duplicate files named with ` 2` are excluded and left untouched.

Backend typecheck, lint and build and desktop typecheck/build passed again.
Mobile verification remains 433 passing tests, typecheck, lint and build as
recorded above; CI will re-run verification from the committed source. No schema,
migration, dependency lockfile or deployment-workflow change is included.
The existing Stage pipeline must pass fresh isolated PostgreSQL integration
tests before deploying, then verify the exact application revision and public
readiness. Full demo reseeding and national-directory imports are not requested.
Deployment confirmation will be recorded only after those gates succeed.

The first Stage attempt, run `37780395749` for `2016c40`, correctly stopped before
deployment: all 318 backend tests passed, but the frontend suite passed 432/433.
The parent multi-child-card test timed out while switching was still busy. Its
whole-page role lookup repeatedly evaluated both transition cards before the
timer completed on CI. The test now waits for the observable switching control
to become enabled, then scopes its unchanged identity assertions to the active
card. All three child identities, both swipe directions and the final ID dialog
remain checked; no home/runtime code or timeout limit is changed. The focused
regression passed locally; the next Stage run must re-run the full suite.

Release verified: [Stage run 37781716971](https://github.com/EduveraIITA/Eduvera/actions/runs/37781716971)
passed and deployed application revision `616f3bee8da81b5b0c449eb8031ae4f170070031`.
CI passed **318 backend tests in 46 files** and **433 frontend tests in 64 files**,
secret scanning, typecheck/lint and mobile/backend/desktop builds. Normal Stage
migration validation and exact-release public health checks passed. Full demo
reseeding was skipped. No database reset or directory import was performed.

Independent checks confirmed that exact SHA with `environment: stage` and
database/events ready. Authenticated WebKit checks on the deployed application
verified the eight-subject student attendance list, keyboard expansion, numeric
safe-buffer display, filter persistence after reload and restored standings
focus; the teacher's four-class directory, successful class-updates API, separate
class route, gallery/list roster switching and Back; and the admin's published
assessment register without a nested border/frame. These screens passed
320/768/1024/1440px overflow checks and the phone renders were visually reviewed.
In-app navigation produced no page errors. Local and phone-preview readiness
also remained healthy. These checks do not claim every device or workflow is
certified; user phone validation remains requested. The documentation-only
evidence commit does not require another application deployment.

### Role-specific Analytics: decision model and first academic slice — 8 October 2026 (local)

The user requested Analytics for all four portals, then clarified the design:
Apple Health-like compact overview charts may share one page; tapping a topic
must open a separate focused detail page. Highlights must carry information, not
decoration. Subject/class/institution aggregates must be deliberately placed,
and the product must serve decisions rather than accumulating requested charts.
Home screens, shared headers and bottom navigation remain unchanged.

#### Research and design decisions

- [Apple's chart guidance](https://developer.apple.com/design/human-interface-guidelines/charts)
  prioritizes a clear message, prominent data, contextual labels and accessible
  exploration. The implementation uses a compact overview followed by focused
  pages, native controls, visible values and a table alternative for trends.
  Lines show change, bars compare quantities, histograms show distributions and
  doughnuts show parts of one total. No decorative or three-dimensional charts.
- [IES instructional-data guidance](https://ies.ed.gov/ncee/wwc/practiceguide/12)
  recommends an ongoing improvement cycle and helping students examine their
  own data and goals. These are practice recommendations, not proof that a
  dashboard alone improves outcomes. Each proposed insight needs a decision,
  an authorized owner, source evidence and a next action.
- [EEF attendance monitoring](https://educationendowmentfoundation.org.uk/education-evidence/leadership-and-planning/supporting-attendance/monitor-the-impact-of-approaches)
  emphasizes intended outcomes, granular patterns hidden by headlines and
  sustainable staff workload. Use existing records automatically; do not ask
  staff to re-enter numbers for Analytics. Averages alone are insufficient.
- [EEF feedback guidance](https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/feedback)
  emphasizes task/subject-specific information that learners can act upon.
  [PARAKH's Holistic Progress Card](https://parakh.ncert.gov.in/index.php/hpc)
  also goes beyond marks. The product therefore links to published feedback;
  it must not invent competency, motivation or wellbeing scores from marks.
- [UDISE+](https://www.udiseplus.gov.in/) covers students, teachers and institution
  facilities. This supports a broader administrator planning lens, not just
  examination averages. It is not a claim of UDISE integration or compliance.

International guidance informs product design; it does not prescribe Indian
attendance thresholds, grades or legal duties. Institution policy remains the
source of those rules. No cross-institution benchmark data is imported.

#### What each view should help its user decide (target, not a completion claim)

| View | Decisions and useful analytics | Timing and next action |
| --- | --- | --- |
| Principal / administrator | Participation and data completeness; class/subject learning patterns and result distributions; assessment bottlenecks; planned teaching versus actual coverage; staffing/capacity; fee collection and review backlog where authorized | Daily exceptions belong in existing work queues; weekly trends support follow-up and cover planning; term summaries support resource and academic review. Open the corresponding register, assessment, coverage task or ledger. |
| Teacher | Attendance patterns in assigned classes/subjects; recorded versus missing evidence; comparable assessment outcomes and published feedback; marking/review workload; assigned lessons and cover | Before lessons, review relevant evidence; weekly, plan support or reteaching; before reporting, finish marking/review. Open the owning class, register or assessment. No institution-wide access or teacher league table. |
| Parent | One selected child's participation and published subject progress; teacher feedback; actual homework completion where recorded; outstanding school requests | Review weekly and after new results; respond to a request or discuss a specific issue with the teacher. Keep fees and logistics in their own detail areas, not mixed into academic scores. |
| Student | Own attendance and subject progress; specific feedback; recorded task completion; progress against explicit learning goals if supported | Before study, choose a task/feedback item; periodically review personal progress. No peer ranking, sibling comparison, school finance or staff work queues. |

The common path is **overview → topic → class/subject/period → source record or
work queue**. Defaults come from the authenticated institution, assignments,
selected child and active term. A user should choose only meaningful scope or
period changes. An average never creates a decision or automatically assigns an
intervention. Authorized people interpret evidence and record any action in its
own workflow.

#### Current implementation scope

- More includes Analytics for principal, teacher, parent and student. Teacher
  discoverability follows attendance/assessment access. Separate routes own
  attendance, results and staff-only assessment progress; Back preserves filters.
- A dedicated read-only analytics API checks active school/portal membership,
  family relationships and same-resource staff permissions. Current and historical
  attendance access are checked together. Query keys include user, school, portal,
  learner, class and period. No schema or source-record mutation is introduced.
- Overview cards show recorded attendance and its trend, a scoped published-score
  average and short subject preview, plus assessment-stage composition for staff.
  Detail pages expose class/subject comparisons, recorded-day composition,
  score-band distribution and links to the existing workspaces.
- Institution/class/assigned-work/personal averages are explicitly labelled.
  Results use only the latest immutable publication, normalize marks to percent
  and weight individual scored results equally. The total is not an unweighted
  mean of class averages and is not an official term grade. Different tests and
  sample sizes make these descriptive comparisons, not a fair ranking. Score
  bands count results, not unique children or pass/fail judgements.
- Attendance uses actual daily records; late counts as present, half day as half,
  excused records are excluded and missing is not zero. Subject attendance is a
  labelled projection from recorded days and the effective timetable, matching
  existing half-day/checkout behavior. It is not separately observed lesson
  attendance. Subject counts are lessons/student-lessons, not days/student-days.
- Term/30-day/90-day windows are bounded by the term, school-local date and a
  366-day maximum. Attendance/access events invalidate Analytics. Result updates
  are fetched on refresh/re-entry/focus; a new result-specific live push contract
  is not claimed. Charts have empty, loading, denied-access and error states.

#### Remaining decision-support work (not implemented by this slice)

1. **Completeness before stronger conclusions:** the follow-on institution KPI
   slice below adds scheduled-register submission using current active rosters
   and the effective schedule. Historical roster/schedule reconstruction and
   verified-observation completeness remain open. Do not call the recorded-day
   attendance percentage a completion rate. Assessment roster completion and
   publication lag still need separate denominators.
2. **Like-for-like learning progress:** add subject/cycle/assessment-kind filters,
   repeated comparable assessment series and skill-level evidence where genuinely
   captured. Do not claim mastery or causal teaching effectiveness from aggregate
   marks. Feedback and homework analytics must distinguish sent/read/acknowledged
   from completed or teacher-verified work.
3. **Operations and resources:** add authorized read models for teaching minutes
   versus cover, staffing gaps/capacity and workflow age. Scheduled is not taught;
   assigning cover is not accepted cover. No productivity or behavioral score.
4. **Finance and administration:** compute overdue aging and verified receipts
   from the immutable ledger, separating pending claims, credits, reversals and
   actual receipts. Confidential care remains purpose-restricted; never expose
   narratives or infer an absence's cause. Cross-school analytics requires a
   separately authorized scope and must not be inferred from an admin portal.
5. **Action and review:** support explicit follow-up owners, review dates and
   outcomes; evaluate change with its limitations rather than asserting that an
   intervention caused an improvement. Thresholds require adopted policy, not
   arbitrary red/green cutoffs or imported chronic-absence rules.

These are the proposed engineering direction derived from the request and research,
not claims that all institution analytics are complete. The frontend UI engineering
skill guided readable chart hierarchy, semantic theme colours, native controls and
accessible alternatives. Database guidance led to bounded batched read models and
same-resource permission tests rather than client-side aggregation of private rosters.

#### Verification and handoff

- Full frontend regression: **456 tests in 65 files passed**. After the final
  compact-toolbar/empty-state adjustment, all **19 Analytics component tests**
  passed again. Frontend typecheck, lint and production build passed.
- Backend: **14 focused tests passed** (five metric tests, seven PostgreSQL
  Analytics integration tests and two existing assessment integration tests).
  Typecheck, lint and build passed. Integration ran on an isolated schema-only
  copy of an existing complete test database, not the preview/Stage data. This
  does not certify a fresh migration chain; the initial fresh local PostgreSQL
  14 attempt stopped on the existing migration 033 compatibility issue.
- Tests cover tenant/persona/guardian isolation, effective-dated staff grants and
  revocation, publication revisions, scored versus non-scored outcomes, weighted
  institution/class totals, score bands, missing data, half days/checkout,
  non-instructional dates, subject projections, URL filters and Back navigation.
- Live WebKit opened Analytics through More in all four portals, followed the
  topic pages and Back, changed periods/classes/children, switched class/subject
  comparisons and used the trend-data disclosure by keyboard. API responses were
  200, with no page errors. Overview and result-detail overflow checks passed at
  320/768/1024/1440px, and phone renders were visually reviewed.
- Preview testing exposed permission checks repeated per attendance row. The
  queries now materialize distinct class/date and assessment scopes before those
  checks, preserving the same authorization. In the synthetic preview, observed
  teacher navigation-to-API time fell from about 43.6 seconds to 2.1 seconds;
  this is local evidence, not a production performance guarantee.
- Local and phone-preview readiness report database/events healthy. No real
  attendance, marks, fees, roles or relationships were changed. No migration,
  dependency, home-page or deployment change is included. Nothing was pushed or
  deployed. User phone validation and wider operational Analytics remain open.

### Institution aggregate KPIs — 8 October 2026 (local follow-on)

The user requested more institution-specific aggregates on Analytics home. The
principal/admin overview now adds two focused entry points, without changing the
four portal home screens, theme or shared navigation:

- **Institution snapshot:** enrolled students, active staff, classes with students
  and average class size. Tapping opens `/principal/analytics/institution`, with
  class-enrolment comparison bars, teaching/non-teaching staff composition and
  students per teacher. Links lead to the existing student and staff directories.
- **Register submission:** submitted or locked registers as a proportion of
  scheduled class-days, with an unsubmitted count. Tapping opens
  `/principal/analytics/registers`, with register-state composition and class
  breakdowns. Each incomplete class links to its latest unsubmitted date's
  actual register; the period/class filters and Analytics Back link are retained.

#### Definitions and boundaries

- Snapshot enrolment is the selected term's currently active records, effective
  by the earlier of school-local today and term end. Future enrolments, other
  years/terms and other institutions are excluded. An app account is not needed.
  Populated classes have at least one such enrolment; mean class size excludes
  empty classes, whose count and zero values remain visible in detail.
- Staff means active staff profiles with a joining date no later than today;
  onboarding, inactive and future joiners are excluded. Students per teacher
  uses teaching headcount, including part-time staff, not FTE or teaching load.
  It is not a regulatory staffing-ratio or room-capacity assessment. Missing
  denominators produce a dash, never infinity or a made-up zero.
- The snapshot is explicitly dated/current, not a period-change or intake-growth
  metric. Period changes do not change its totals. It is hidden in class-filtered
  overviews; its dedicated page has no misleading period/class controls.
- Register expectations match `attendanceDayPolicy`: one class/date with active
  enrolled students and a non-cancelled class or activity in the effective
  published schedule. Multiple lessons do not create multiple registers.
  Calendar closures, pre-enrolment dates, future dates and cancelled lessons
  are excluded. Submitted and locked are distinct slices but both count toward
  submission. Reopened drafts count as not submitted; no attendance mutation
  occurs. Includes today, so **not submitted is not synonymous with overdue**.
- This is a current-record projection, not a historical audit reconstruction.
  Changing active enrolments or published schedules can change expectations for
  previous dates. Enrolled classes without any scheduled days are called out
  instead of treated as 100% complete. No schedule yields an unavailable rate.
  Formal submission does not independently prove accuracy or verified attendance.
- Only an active administrator in the principal portal receives these new read
  models. Teacher/family responses return null, including an admin+guardian
  acting in the parent portal. Tenant predicates apply throughout; no private
  student rows, personnel details or new authority is exposed. The existing
  event invalidation applies to attendance, timetable, access and people changes.
  Staff profile changes without a broadcast refresh on normal query refresh,
  re-entry after cache staleness or focus; no universal instant update is claimed.

The frontend UI engineering skill guided the small numeric summary, semantic
colours and separate accessible detail pages. Database guidance kept calculations
in bounded, batched server queries using existing indexed relationships rather
than fetching private rosters to the browser. No schema or dependency change.

#### Verified evidence

- **463 frontend tests in 65 files passed**, including 26 Analytics tests.
  Frontend typecheck, lint and production build passed.
- **17 focused backend tests passed**: ten Analytics PostgreSQL integration,
  five metric and two assessment integration tests. Backend typecheck, lint and
  build passed. Same isolated schema-only test database as the prior slice.
- Added tests for school/portal isolation, account-optional headcounts, active
  versus future/inactive staff and enrolment, null denominators, empty classes,
  period-independent snapshots, class-scoped submission, duplicate lessons,
  closures, date overrides/cancellations, activities and reopened registers.
- Live WebKit verified both new detail routes, period-preserving Back, keyboard
  disclosures, class filters, and opening the actual dated Class 6A attendance
  register. New detail pages passed overflow checks at 320/768/1024/1440px and
  phone screenshots were visually inspected. The final in-app navigation run
  completed with no page errors. Earlier test-script hard reloads during pending
  requests produced WebKit cancellation/access-control errors; replacing those
  artificial reloads with actual app navigation resolved the test harness issue.
- Local and ngrok phone-preview readiness both report database/events healthy.
  Source records were not changed. Nothing pushed or deployed. Phone validation
  remains requested; finance, FTE/workload, historical completeness and comparable
  learning-progress analytics remain separate future work, not implemented claims.

#### Analytics spacing follow-up — 8 October 2026 (local)

The user reported chart captions touching the axis labels, with similar cramped
supporting text elsewhere. Browser measurements confirmed a shared shell CSS
specificity problem: paragraph resets reduced the intended chart-caption margin
to **0px in principal, teacher and student**, versus 10px in parent.

- Analytics paragraph spacing is now scoped above the shell reset, independent
  of lazy stylesheet load order. Chart-to-note gaps are 16px; supporting copy
  uses 8px above / 12px below, with 12px between explanatory paragraphs. Chart
  legends have explicit top spacing. Final notes retain the card's own padding
  without an extra trailing margin. Warning/positive text keeps semantic colour.
- The change covers shared Analytics overview and topic components across all
  four portals. Shell resets and home pages are unchanged. This is not a claim
  that every unrelated application page has been audited for spacing.
- Live WebKit measured **16px chart-to-caption gaps in all four portals** and
  confirmed the supporting-copy margins survive each portal shell. Overview
  and result pages passed 320/768/1024/1440px overflow checks; mobile overview
  and attendance-detail screenshots were inspected. No page errors in that run.
  All 26 Analytics component tests passed again after the CSS change.

### Analytics Stage release preparation — 8 October 2026

The user requested pull, push and deployment. Fetched Stage at `aa32218`, which
contains the separately developed Principal Insights dashboard and its approved
navigation. This release will preserve those changes alongside the role-specific
Analytics pages, institution aggregates and chart-caption spacing correction.
The three unrelated untracked duplicate files named with ` 2` are excluded.

No migration, dependency or deployment-workflow edit, database reset, full demo
reseed or national-directory import is requested. The normal Stage workflow must
verify the integrated commit against fresh PostgreSQL 17, build all clients,
deploy and confirm the exact release revision. Integration and deployment results
will be recorded after verification; this preparation entry is not a success claim.

Integration verification passed locally: **475 frontend tests in 67 files**, all
frontend/backend typecheck, lint and builds, and desktop typecheck/build.
**25 focused backend tests** passed on the isolated database, including both
Analytics and Principal Insights. Browser checks retained principal/teacher
Analytics navigation, scoped data, period/class filters and Back with no page
errors. The merge retains both backend modules and both sets of event-cache
invalidation rules. The existing Stage pipeline will re-run the full backend
suite against a newly migrated/seeded isolated PostgreSQL 17 database.

### Principal Insights navigation — 8 October 2026

User-approved placement supersedes the initial all-on-Overview layout above.
Overview now retains four summary cards, the action brief and a dated View all
insights link. The principal-only `/principal/insights` route groups the full
dashboard into Attendance & learning, Operations and Finance, with date, window,
class and academic-review filters. Principal mobile tabs are Overview, Attendance,
Insights and More. Timetable remains in More, the desktop sidebar and coverage
links; teacher navigation is unchanged. The newest Stage planning/navigation
changes were reconciled without removing either backend module or delivery record.

Local verification: backend and frontend typecheck, lint and production builds
passed. Browser checks using synthetic API fixtures passed at 320, 768, 1024 and
1440 pixels: compact Overview, navigation to Insights, date/window persistence,
deadline deep links, dialog Escape dismissal, active mobile tab and Timetable in
More, with no horizontal overflow or page errors. Test and release status will be
confirmed by the PR/Stage workflow; no national dataset import or reseed is part
of this change. Please review the resulting UI on a physical phone after release.

### Principal Insights reading note — 8 October 2026

Removed the “How to read these insights” disclosure and its unused styles at
the user’s request. Metric definitions remain in PRINCIPAL_INSIGHTS.md.
Dashboard graphs, filters and source-record dialogs are unchanged.
Frontend typecheck and diff whitespace checks passed.

### Analytics Stage release verified — 8 October 2026

Merged the newer Stage Principal Insights work with the role-specific Analytics
release and pushed application commit `98aa6b897ab7d5a10cb8bcec0e4b3fa924565c89`.
[Stage run 37798178025](https://github.com/EduveraIITA/Eduvera/actions/runs/37798178025)
completed successfully, including deployment and public-release verification.

- Fresh PostgreSQL 17 CI passed **341 backend tests in 50 files** and **475
  frontend tests in 67 files**. Backend/frontend typecheck, lint and builds,
  desktop typecheck/build and the repository secret scan passed.
- Independent public checks confirmed the exact application SHA above from
  `/releasez`, environment `stage`, and `/readyz` with database/events healthy at
  `https://omnischool-stage.up.railway.app`. The workflow also verified the mobile
  and desktop applications, demo access and protected metrics.
- Deployed WebKit checks passed for student, parent, teacher and principal:
  Analytics API responses, overview/topic separation, period and class filters,
  parent learner context, source links, shell Back navigation and keyboard chart
  disclosures. The institution and register detail pages, class-scope isolation
  and opening the dated Class 6A attendance register were verified separately.
- All four deployed portals measured **16px chart-to-caption spacing**, with
  supporting-copy margins of 8px above / 12px below. Overview and detail layouts
  passed overflow checks at 320/768/1024/1440px; representative phone screenshots
  were visually inspected. No page errors in the final browser runs. These are
  functional checks, not a performance/load-test claim.
- Local and ngrok preview readiness remained healthy. No new migration, reset or
  full demo reseed was introduced; the existing workflow's normal additive demo
  examples ran. The three unrelated untracked duplicate files remain untouched.

This verifies the Stage release, not a production rollout or physical-device
acceptance. Please refresh and review the Analytics spacing on a phone.

### Unified Insights and focused attendance review — 8 October 2026 (local)

User direction supersedes the separate Analytics/Insights destinations above:
keep the charts and useful operational signals in one calm, progressively disclosed
experience. After reviewing the first local Attendance checks page, the user also
requested a meaningful review workflow instead of prominent filters, large counts
and explanatory copy before the students.

- All four portals now use **Insights** at `/<portal>/insights`. Old Analytics
  bookmarks redirect with query/hash context intact. More search still recognizes
  “analytics”; existing permission/tool identifiers are unchanged. Home screens,
  school headers, existing mobile tabs and domain permissions are unchanged.
- Principal Insights combines a compact attention brief, current institution
  snapshot, recorded trends/results and current operational summaries. Attendance,
  results, assessment progress, institution, register submission, learning review,
  follow-ups, coverage/deadlines and fees have focused topic pages. Analytics and
  Principal Insights remain separate authorized read models, with independent
  loading/error handling and shared cached requests for the operational summaries.
- Reporting definitions are preserved: term/30/90-day trends are not silently
  combined with 14/28/56-day review comparisons. Publication-dated learning review
  stays distinct from assessment-dated result averages; current fees, follow-ups
  and next-seven-day coverage retain their operational as-of context.
- **Attendance review** now starts with students without an open follow-up. Flat
  linked rows show class, current attendance and the decline; already-owned work
  remains available. Class selection is visible; review-window/date controls are
  behind one accessible control. Each student opens a separate page with the two
  periods, relevant evidence and an existing-register or existing-follow-up action.
  No automatic diagnosis, family contact or case creation was introduced. The
  existing workflow still requires a saved eligible attendance record to create a
  follow-up. Recording completeness is a separate page; missing records are never
  treated as absences. Back links preserve class/window and the parent topic.
- This follows the frontend UI engineering guidance through scoped semantic
  colors, readable supporting-copy spacing, keyboard disclosures, text alternatives
  for charts and existing shell/theme components. No new library, backend/API,
  schema, authorization or home-page change is included.

Verified locally after the final UI adjustment:

- Frontend typecheck, lint and production build passed; **495 tests in 68 files
  passed**, including **20 unified Insights tests** for role isolation, legacy
  navigation, independent failures/retry, filters, student review, existing follow-up
  routing, missing records, out-of-scope student IDs and context-preserving Back.
- Live WebKit navigation passed in principal, teacher, parent and student portals.
  Overview/results and principal operational/review detail pages passed horizontal
  overflow checks at **320/768/1024/1440px**. Review filters and keyboard disclosure
  were exercised; student and recording drill-downs returned to the review list.
  Chart-caption gaps remain **16px** in all four portals; no page errors occurred.
- Mobile screenshots of principal, teacher and parent overviews plus the new
  attendance queue and student detail were visually inspected. The queue shows
  multiple students in the first viewport without a large summary card.
- Local preview and ngrok `/readyz` both returned ready with database/events OK.
  No deployment, database reset or reseed was performed. Unrelated ` 2` duplicate
  files remain untouched. Physical-phone UI acceptance is still requested; these
  local checks do not establish a new Stage or production release.

The current interaction and metric contract is [Principal insights](PRINCIPAL_INSIGHTS.md).

### Unified Insights Stage release verified — 8 October 2026

At the user's request, pulled `origin/Stage` (already current at `bcdf8bb`),
committed the unified Insights and attendance-review work, and pushed application
revision `36ddd7933ebaa5a9b4c8a6fee3c78ad9b6098efc` to Stage.
[Stage run 37805815618](https://github.com/EduveraIITA/Eduvera/actions/runs/37805815618)
completed successfully, including Railway deployment and public release verification.

- Fresh PostgreSQL 17 CI passed **341 backend tests in 50 files** and **495 frontend
  tests in 68 files**. The repository secret scan, backend/frontend typecheck,
  lint/build and desktop typecheck/build passed. Local backend checks and desktop
  build were also repeated before the push.
- Independent public requests confirmed the exact application revision above from
  `/releasez`, environment `stage`, and `/readyz` with database/events healthy at
  `https://omnischool-stage.up.railway.app`. The existing release pipeline also
  verified both applications, install icons, API schema, demo access and protected
  metrics. Its optional full demo reseed was skipped; no new migration, database
  reset or national-directory import was introduced.
- Deployed WebKit checks passed in principal, teacher, parent and student portals:
  one Insights destination, trend period persistence, old Analytics bookmark
  redirects, result drill-downs and Back links. Principal attendance review,
  student comparison, the actual dated class register, missing-records detail,
  follow-ups, coverage, fees and learning-review navigation were exercised without
  changing attendance, sending messages or creating follow-ups.
  A separate live check selected an already-owned attendance review and opened
  that student's authorized existing follow-up inbox successfully.
- All four portal overview/results layouts and principal topic/review details
  passed overflow checks at **320/768/1024/1440px**. Chart-caption gaps remain
  **16px**. Keyboard review-rule disclosure and hidden/revealed period controls
  worked. Deployed attendance queue/student-detail phone screenshots were visually
  inspected; no page errors occurred in the final four-portal browser run.
- Local and ngrok previews remained ready with database/events healthy. The three
  unrelated untracked files named with ` 2` remain untouched and uncommitted.

This records a verified Stage release, not a production rollout or physical-phone
acceptance. The user should refresh Stage and review the new Attendance review flow.

### Principal Overview: daily decisions, not stacked dashboards — 8 October 2026 (local)

The user explicitly authorized simplifying the **principal home**, superseding the
earlier exclusion of home screens for this portal only, and required retaining its
blue top card. Teacher, parent and student homes remain unchanged. Blueprint v1.0
sections 5–6 were reread: leadership should see exceptions, coverage and decisions,
with the home answering what needs attention, what is happening and where to act.
Apple's [layout](https://developer.apple.com/design/human-interface-guidelines/layout)
and [color](https://developer.apple.com/design/human-interface-guidelines/color)
guidance informed consistent spacing, scan-first hierarchy and meaningful emphasis;
the established app theme, shared headers and navigation were retained.

- The blue card now has one dated register-submission measure, a progress bar,
  marked-student context and direct links to registers and the timetable. It no
  longer repeats the same pending-register count in a nested spotlight, displays
  a misleading zero-absence summary before recording starts, or declares all
  operations clear from an empty action list. Today appears only off today's date.
- A compact Needs attention list replaces the embedded analytics dashboard and
  review brief. It links to current follow-ups, changed-assignment/schedule records,
  unassigned teaching periods, recent attendance declines and the separate term
  minimum list when those signals exist. Counts come from existing authorized
  read models; they are not summed into a misleading unique-student total.
  Institution-wide query scope ignores prior detail filters, retains the selected
  date, and includes actor/school identity in the review query key. Current follow-up
  and coverage scope is explained when viewing a different date. Failed/pending
  review data never produces an all-clear message; Retry is available.
- Coming up uses compact dated event links and preserves assigned-duty context.
  Full class registers stay in Attendance; charts and institutional metrics stay
  in Insights. No new metric, policy, permission, migration or domain write was added.
- `/principal/attendance/thresholds` retains all returned below-minimum records,
  their recorded-day evidence, policy threshold and dated class-register links.
  The existing 20-record API limit is explicitly labelled when reached, not
  presented as a complete institution count. This list is distinct from the
  28-day decline review and still excludes students with fewer than 5 recorded days.
- `/principal/followups` provides the existing authorized open/resolved conversation
  workspace outside the home, with one page title. Old `#attendance-followups`
  home links redirect there. Both new detail pages return to the dated Overview.
  The home timetable shortcut also returns to Overview; entry from More retains
  its original Back destination. Other portals retain the original inbox headings.

Verified locally: **512 frontend tests in 69 files**, including **17 new home and
detail tests**, plus frontend typecheck, lint, build and `git diff --check` passed.
WebKit exercised date changes/Today, threshold list and its actual source register,
follow-up Open/Resolved filters, dated Back links, keyboard activation, timetable,
attendance review, event detail and legacy conversation anchors without domain
mutations or page errors. Overview and new detail layouts passed overflow checks
at **320/390/768/1024/1440px**; mobile and desktop screenshots were visually reviewed.
The progress-caption gap is **10px** after correcting a shared paragraph-reset
specificity conflict. Both local and ngrok `/readyz` returned database/events OK.

This work is **local only**, not pushed or deployed. Physical-phone acceptance is
requested through the running preview. The unrelated three untracked ` 2` duplicate
files remain untouched. Existing threshold sample limits and analytics evidence
limitations remain; this is a navigation/presentation change, not broader coverage
of school decision-support domains.

### Principal Overview: read-only snapshot and useful school summaries — 9 October 2026 (local)

The user's review supersedes the previous home-card design: the blue card must be
small and non-actionable, with more useful information in the space below. The
established theme, shared header/navigation and all other portal homes are retained.
Blueprint sections 5–6 and the existing Insights metric contracts were reread.

- Replaced the large single-metric card, progress bar and action footer with a
  two-column daily snapshot: students marked and registers submitted. The date
  control, conditional Today button and Timetable link are outside the card.
  Absence/late context appears only when there are marked records. The snapshot
  contains no link, button, input or progress control and measures approximately
  **102px high at a 390px viewport** with the current unmarked demo day.
- Needs attention now also includes pending registers, deadline clashes and
  submitted/moderated assessment decisions. Existing follow-up, coverage, decline,
  minimum-attendance and saved-register exception routes are preserved. The first
  four checks are visible; remaining checks use one keyboard-accessible disclosure.
  The list does not sum unrelated counts or claim an all-clear before both read
  models succeed.
- Added School pulse below attention: a compact recorded-attendance trend, published
  result average, next-seven-day teacher assignment coverage and current outstanding
  fees. Each opens its existing focused Insights topic. Coming up remains a short
  dated event list. Desktop uses two columns without stretching the left-hand gap.
  Chart-caption spacing is explicitly **16px**.
- Whole-school current-term analytics are separate from the selected daily date;
  term end dates and operational dates are shown. Existing attendance denominators,
  half-day treatment and missing-data gaps are retained. Published-result averages
  are not official grades, assigned periods are not verified lesson delivery, and
  fees due today are excluded from the overdue label. Missing samples show explicit
  empty states, not invented zero/100% metrics. Independent request failures retain
  the other summaries and provide retry. Fetching is separated into a shared hook,
  using existing actor/school query keys, event invalidation and minute refreshes.

Verified locally: **520 frontend tests in 70 files**, including **25 principal-home
and detail tests**, plus frontend typecheck, lint, production build and whitespace
checks. The first full run exposed two existing CalendarView tests whose broad
date selector also matched Today after the real date rolled to 9 October. Their
fixture clock is now fixed; assertions and calendar runtime behavior are unchanged.
The complete suite then passed.

WebKit rechecked **320/390/768/1024/1440px**, 200% home text without horizontal
overflow, the non-interactive snapshot, measured spacing, all four School pulse
destinations, date/Today behavior, keyboard register navigation, dated threshold
list and source register, follow-up filters/Back, timetable/Back, event details and
legacy anchors. Mobile/desktop screenshots were visually inspected; no page errors
or domain writes occurred. Both local and ngrok readiness returned database/events
OK. The implementation contract in `PRINCIPAL_INSIGHTS.md` is updated accordingly.

This revision remains **local only**, not pushed or deployed. Physical-phone review
is still requested through the running preview. No backend, migration, permission
or notification changes were made; the three unrelated untracked duplicate files
remain untouched.

### Student and parent homes: preservation-first touch-up — 9 October 2026 (local)

The user requested a light polish, explicitly retaining most of the existing homes.
Blueprint sections 5–6 informed the status treatment and stable daily navigation.
The new shared styles are scoped to `.family-home`; other screens and the shared
shell are unchanged. This is not an information-architecture or workflow redesign.

- Preserved the student/parent accent colors, identity cards and digital IDs,
  parent child-card deck and switching, daily activity rail, all four summary
  tiles, shortcuts, diary, packing checklist and existing drill-downs.
- Applied consistent heading sizes, label/detail spacing, lighter borders and
  shadows, and clearer activity metadata. Current-period and attention/status
  colors remain meaningful. Removed the redundant diary eyebrow and shortened
  parent shortcut labels without changing their destinations or child scope.
- Renamed the mixed daily/term summary to **At a glance** and clarified **Classes
  today**. Unrecorded student attendance now uses a neutral clock, not a confirmed
  checkmark; verified attendance retains its positive status treatment. No metric
  calculation, authorization, request, database or notification behavior changed.

Verified locally: **524 frontend tests in 71 files**, frontend typecheck, lint,
production build and whitespace checks. The suite includes four new family-home
tests and 59 route, identity-card and activity regressions. An initial run caught
an incorrect icon alias in a new test; the assertion was corrected and the complete
suite rerun successfully. WebKit checked both portals at **320/390/768/1024/1440px**, including
all four summary tiles, keyboard digital-ID activation/QR rendering/focus return,
student checklist and schedule sheet, parent standings/homework, child switching,
child-scoped event/leave links, and timetable navigation. No page errors or domain
record writes occurred. Mobile and desktop screenshots were visually reviewed.
At 200% home text, neither portal introduced horizontal page overflow at
320/390/768/1440px; this is not a comprehensive accessibility certification.

The existing local preview remains running; local and ngrok readiness returned
database/events OK. This touch-up is **local only**, not pushed or deployed, and
physical-phone review is requested. Prior principal-home work and unrelated
untracked duplicate files are preserved.

### Transport workflow hardening and map-first rides — 9 October 2026 (local)

Read blueprint sections 5–6 and the departure/transport domain contract before
implementation. The user moved the task from UI-only work to workflow hardening,
then requested map-first staff/parent screens, a ride list instead of a dropdown,
and a 30-minute operating window. The shared theme, role shells and home pages
remain intact. `DEPARTURE_AND_TRANSPORT_COORDINATION.md` records the updated contract.

- Staff use **My rides → dated ride**. Controls open 30 minutes before departure;
  self-service duty changes close then. The backend enforces this in school time,
  including invitation response and approval; urgent cover stays school-managed.
- Active rides lead with their map, then route/vehicle/stop and actual milestones.
  Planned rides have no empty map. Family/student coordinates are returned only
  while their own learner is boarded on an in-progress, current-day ride.
- Hardened lifecycle transitions, authority/link/current-role checks, transaction
  ordering, optimistic concurrency, request withdrawal/duplicate protection,
  bus-to-pickup reconciliation, overdue school reconciliation, real handover notes,
  accepted duty and colleague-cover authorization, foreground GPS and retention.
  Added departure/transport event refreshes without putting coordinates in events.
- Local checks: **32 backend tests / 4 files**, including **14 isolated real-DB
  scenarios**; backend typecheck/lint/build; **567 frontend tests / 77 files**,
  frontend typecheck/lint/build and whitespace checks. This is not a claim that all
  backend suites or fresh migrations passed.
- Real HTTPS WebKit sessions verified staff ride list/detail, persisted map,
  authenticated location upload, parent/student visibility and future-ride control
  suppression, at 320/390/768/1024/1440px without horizontal overflow or page errors.
  Mobile and desktop screenshots were inspected. Simulated browser geolocation
  required correcting the test driver's timestamp unit, not changing production
  timestamps. Phone/device/physical-handover acceptance remains outstanding.
- User explicitly asked for an in-progress **database ride**, rejecting a static
  preview. Removed that preview approach and created dedicated local test accounts,
  a synthetic learner/guardian relationship, route/stop/assignment, an accepted
  in-progress trip and next-day trip in **Transport Test School**. Existing journey
  records were not changed. The active trip ID is
  `3ddc436d-c9ce-4d14-b461-41ef3c8f297f`; its seeded sample location can be replaced
  with the staff screen's actual device sharing. Credentials are provided privately
  in the task response, not committed to this repository.

The managed preview remains running. Local and HTTPS ngrok `/readyz` returned
database/events OK. Nothing pushed or deployed. The isolated backend test database
was a schema-only copy because local PostgreSQL 14 cannot run the existing PG15+
migration 033; fresh PostgreSQL 17 validation is still required. The domain record
also lists planning/exception acceptance gaps; this work is not described as fully
production-ready. Prior unrelated work and untracked duplicate files are preserved.

### Existing-login active demo ride correction — 9 October 2026, 02:00 school time

The user rejected separate test logins and explicitly requested an already-active
fake ride using the existing demo personas. In local `omnischool_node` only, the
existing Cambridge `DEMO-SOUTH` trip
`5ea993a2-388e-44b1-ac1d-3451462843c6` was seeded from its planned state to an
in-progress review fixture dated **2026-10-09 at 02:00 Asia/Kolkata**. It retains
Kavita as attendant and the existing Aarav/Ananya roster and guardian relationships.
The fixture includes simulated boarding, ready plans, and a saved sample location;
it does not assert a physical journey occurred. The prior trip/roster/plan snapshot
is retained in a `trip.demo_fixture_activated` audit, with a coordinate-free refresh
event. Older unfinished demo trips were not overwritten, and no application guard,
permission, normal trip-start rule or UI code was changed for this seed.

Collector/family service reads verified the current active ride and map under
`kavita.staff` and `pooja.parent`; duty changes are unavailable on that active ride.
The four previously created `ride.*.cb6726` test accounts/memberships were disabled
and their test sessions revoked. Their records remain recoverable; no school,
learner or journey history was deleted. The normal Teacher view and Parent view
demo entries are the intended review path—no new credentials are required.

### Transport friction reduction and expanded re-test — 9 October 2026

- User decision: routine roster boarding, non-travel, arrival and handover are
  one-tap actions, without obligatory notes or a second form. Concerns, exception
  resolution and school reconciliation still require an explanation. Existing
  transaction, authorization, revision, audit and physical-outcome checks remain.
  Historical routine notes are collapsed; pending/error states prevent duplicate
  actions and false success. Office pickup authority workflow is unchanged.
- Accepted active rides automatically start foreground geolocation, including on
  reopening the ride. Native browser permission remains necessary. Hidden pages
  pause and returning pages resume; explicit pause/device denial requires a manual
  retry. Completion/unmount clears the watcher. No background-tracking guarantee,
  GPS-inferred handover or first-sample success claim was introduced.
- Verified **579 frontend tests / 77 files**, build/typecheck/lint; **35 backend
  tests / 4 files**, including **15 isolated real-DB scenarios**, typecheck/build/
  lint. HTTPS WebKit with the existing staff account sent a location accepted with
  HTTP 201 without clicking any sharing control; no page errors or overflow at
  320/390/768/1440px. Device/physical-operation acceptance remains outstanding.
- User requested a reset and chose boarding. In local `omnischool_node`, the same
  trip `5ea993a2-388e-44b1-ac1d-3451462843c6` is now boarding at **02:20**, with
  **12 existing demo students / six drop-off stops** on a one-off demo route.
  New current plans supersede the previous two completed plans; old handovers and
  audit history remain. Cleared 13 prior GPS samples for this exact trip. Added an
  explicit demo reset before-snapshot audit and coordinate-free refresh event.
  Existing logins, recurring routes/assignments and future trips are unchanged.
- The user explicitly approved closing the older 6/7 October demo trips that
  prevented departure. They were reconciled using the school service, with notes
  identifying synthetic test outcomes and before-snapshot audits. No production
  guard was bypassed for the next user-operated departure. No new users were made.
  Full fixture IDs and stop list are in `DEPARTURE_AND_TRANSPORT_COORDINATION.md`.

Local preview remains available; no push or production deployment was requested
or performed in this increment. Preserve the earlier documented PG17 fresh-schema
and physical-device/weak-network release gates.

### Naggar location-focused, full-bus walking fixture — 9 October 2026

- Latest user decision replaces the earlier immediate Bengaluru boarding test:
  **40 existing demo students**, eight geotagged pickup/drop-off stops near Naggar
  Castle, two dated rides at normal **08:00 / 16:00** school-local times. Controls
  open at **07:30 / 15:30**; both rides remain planned/expected for user testing.
  Morning ID `1712c7d2-224a-46e0-877c-7ac5bc36594b`; evening retains
  `5ea993a2-388e-44b1-ac1d-3451462843c6`. Existing Kavita/Pooja/Aarav logins apply.
- Aarav's morning and afternoon stop is beside Naggar Castle; the morning route
  ends at a fictitious school meeting point and evening reverses it. The mapped
  road stretch is 838.3 m one way (~1.68 km out-and-back), under the requested 5 km
  walking limit. Detailed coordinates/source and road-access caveat are recorded
  in `DEPARTURE_AND_TRANSPORT_COORDINATION.md`. No synthetic live GPS was added.
- Stop focus is an optional staff roster view using fresh, sufficiently accurate
  GPS with manual fallback. It shows pending students at a nearby stop, handles
  morning school arrival separately, flags unresolved concerns elsewhere, preserves
  All riders, and never auto-records boarding/handover. Added staff-only route-stop
  projection and map pins without exposing other learners/stops through family API.
  Preserved shared styling/navigation and made the stop chooser a 44 px control.
- **593 frontend tests / 78 files**, typecheck/lint/build; **37 backend tests /
  4 files**, including **17 isolated real-DB scenarios**, typecheck/lint/build.
  Two 40-rider lifecycle tests verify both journey directions and per-child privacy.
  Actual staff/parent HTTPS reads verified both scheduled fixtures. Browser-only
  intercepted movement verified nearby five-rider focus, nine map pins, movement
  changes and one-tap actions; no actual planned rider state was consumed by QA.
  No browser errors/overflow at 320/390/768/1024/1440px; screenshots inspected.
- Preview and HTTPS `/readyz` remain healthy. Real walking/GPS, background and weak-
  network acceptance remain unverified. No production deployment or Git push.

### Temporary HTTPS preview recovery — 9 October 2026, 02:49 IST

- Supersedes the earlier HTTPS-health observation above: ngrok subsequently
  returned HTTP 403 `ERR_NGROK_725` (monthly bandwidth exhausted). Local preview,
  database and event service remained healthy. The user approved an alternative
  temporary HTTPS link; no billing/account changes were made.
- Installed official Homebrew `cloudflared` 2026.10.0 and started a task-scoped
  launchd tunnel to the existing local preview, not a new app/database/login:
  **https://route-homeless-trembl-titans.trycloudflare.com**. Managed job:
  `gui/501/dev.eduvera.preview-https`; ignored local configuration/logs live in
  `.runtime/dev.eduvera.preview-https.plist` and `.runtime/preview-https*.log`.
  Its working directory is `/tmp`; it does not require access to source files.
  The preliminary localhost.run and foreground Cloudflare trials were stopped.
- Replacement HTTPS `/readyz` returned database/events OK. WebKit signed into
  existing staff and parent demos and read both planned 08:00/16:00, 40-rider
  fixtures. With SSE deliberately unavailable, the parent page still fetched
  updated data on its existing 10-second interval (two requests observed).
  Browser-only active-ride simulation verified automatic geolocation attempts,
  nine map pins, nearby five-rider focus, one-tap boarding and focus after movement.
  No actual ride/rider state was mutated by this QA; no browser errors or overflow
  at 320/390/768/1024/1440px. New host is a secure browser context.
- Cloudflare Quick Tunnels are temporary, have no uptime guarantee and explicitly
  do not support SSE. Transport polling remains 10 seconds for families and
  15 seconds for staff; instant cross-view notifications are not a release claim
  on this preview. The host computer and app/tunnel must remain running; restarting
  the tunnel can change its hostname. See transport record for operational notes.
  Physical walking/GPS acceptance and production release gates remain open.

### Shared demo assistant and full conversation — 9 October 2026

- Explicit user decision: a centre **Chat** item joins the four primary mobile
  destinations in principal, teacher, parent and student views. Existing staff
  permission filtering remains; restricted accounts do not gain hidden modules.
  Existing school Messages remain separate from assistant Chat. Shared branding,
  home content, child themes and other navigation destinations are preserved.
- Compact mode shows only the latest local reply above its composer, with a
  short reply-change animation and a lightly blurred/dimmed, inert page behind
  it. Escape, Close and the backdrop dismiss it. Topic links open the appropriate
  authorized portal screen and preserve the selected parent child. No live
  counts are fabricated and requested writes are not represented as completed.
- Tapping the reply or its expand icon opens `/<portal>/assistant` with the
  conversation history. **Full chat hides the bottom navigation**, places the
  composer above the keyboard/safe area, and keeps the existing header Back.
  Back restores the compact reply and five-item navigation. Desktop operations
  retains its sidebar. Native transitions wait for the destination DOM to mount
  before capturing the new surface; reduced-motion navigation skips animation,
  and older browsers have a fade fallback.
- Conversation memory is local to the mounted authenticated session, separated
  by portal/child and reset by account/school changes or reload. New chat clears
  the current thread. Voice is explicitly not connected. This is the requested
  **UI demo**, not delivery of blueprint §18/F1: no model, retrieval, provider,
  autonomous actions, persistent messages, database or transport-fixture writes.
- Verification: full frontend suite **612 tests / 80 files** passed, followed by
  **80 focused assistant/navigation/route tests / 5 files**, including 19 assistant
  tests covering final transition timing, reduced motion, memory isolation and
  redirect fallback. Typecheck, lint and
  production build passed. WebKit exercised all four real demo portals on the
  existing HTTPS preview: compact/full/Back, history, input, topic navigation,
  bottom-bar removal/restoration, reduced motion, and 320/390/768/1024/1440px
  layouts without horizontal overflow or page errors. No chat-initiated network
  writes were observed. Instrumented native transitions verified actual
  compact → full and full → compact snapshots; mobile screenshots inspected.
- Local and HTTPS `/readyz` report database/events OK. Preview remains
  **https://route-homeless-trembl-titans.trycloudflare.com**. No Git push or
  production deployment in this increment. Physical-phone keyboard, safe-area
  and perceived motion validation is still requested from the user.

### HTTPS preview restored after host restart — 9 October 2026, 12:05 IST

- The previous Cloudflare Quick Tunnel URL stopped resolving after its local
  connector and preview services disappeared. The local preview on port 8000 was
  stopped as well; its scratch runtime under `/tmp` had been cleared.
- PostgreSQL 14 had a stale `postmaster.pid` naming PID 1125, now an unrelated
  macOS process. No PostgreSQL process or listener was using the data directory.
  Stopped the failed Homebrew service, moved that exact lock to
  `postmaster.pid.stale-20261009-1203` for recovery, and restarted PostgreSQL.
  `pg_isready` accepts connections and the existing `omnischool_node` database
  opens outside recovery. No database records were reset.
- Rebootstrapped the existing launchd preview and Cloudflare tunnel jobs. The
  preview's ignored local plist now disables the exhausted ngrok child while
  keeping the same local app, API and database. The replacement Cloudflare URL is
  **https://procedure-brighton-bush-website.trycloudflare.com**. Both local and
  HTTPS `/readyz` report database/events OK, HTTPS `/login` and `/teacher` return
  200, and WebKit rendered the login screen without page errors.
- This is still an accountless Cloudflare Quick Tunnel. Its hostname can change
  when the tunnel is restarted, and it requires this machine and both launchd
  jobs to remain running. No production deployment or Git push was performed.

### Working cross-app agent with reviewed execution — 9 October 2026

- User decision extends blueprint §18/F1 beyond its first read-only slice: the
  assistant should answer and prepare actions across all four app views, using
  installed local Ollama first and interchangeable providers. Safety/physical
  authority remains human-only. Research, configuration, coverage, operational
  limits and remaining release gates are in [SCHOOL_AGENT.md](SCHOOL_AGENT.md).
- Replaced the wired dummy reply/session flow with authenticated, persistent,
  owner/school/portal/child-scoped conversations. Preserved the existing five-tab
  navigation, compact latest-reply overlay, blur/dim, transition and full-chat
  bottom-bar removal. Added progress/cancel, history, source timestamps, explicit
  action previews and app-owned verification links/receipts. No fake microphone,
  scheduled execution or fabricated action success is exposed.
- Implemented native Ollama, OpenAI Responses, Anthropic Messages, Gemini and
  OpenAI-compatible provider adapters. The live default is installed `qwen3:8b`
  on this Mac; no download or cloud inference was performed. Cloud adapters have
  mocked protocol tests only and need live provider/model acceptance. Model keys
  remain server-only; changing provider never silently enables remote fallback.
- Capability catalogue has **133 entries: 47 reads, 76 reviewed writes, 10 human
  handoffs**. Covers attendance, timetable/year planning, diary, learner/staff
  leave, messages, notifications, events, assessments, report cards, insights,
  records, fees and transport planning. The catalogue reuses guarded domain APIs
  and validators, rather than letting the model execute URLs, SQL or code. These
  counts are implementation coverage, not 133 individually verified workflows.
  Complete parity with every app command, attachments/voice/printing, imports,
  authority/policy/safety decisions and unattended multi-action execution are not
  claimed. Physical boarding/handover/location controls stay with the person.
- Every change waits for an immutable, expiring UI confirmation. Confirmation
  reloads scope, verifies the source snapshot, atomically claims the action and
  uses the original domain endpoint with a stable idempotency key. Stale state,
  changed permissions and duplicate confirmations fail closed. Ambiguous writes
  become uncertain, never automatically retried. Historical answers are checked
  against current source access both for UI history and later model context;
  narrower record sets cannot leak through old conversation memory.
- Added migration **055_school_agent.sql**, four isolated agent tables and explicit
  runtime-role grants. The normal migration runner hit a pre-existing **033
  checksum mismatch**; additive 055 alone was applied and checksum-recorded in an
  advisory-locked transaction. Earlier migration-history drift was not rewritten.
  Existing development records and the user's transport fixtures were preserved.
- Verified **37 backend tests / 3 files**, including **15 isolated real-DB
  scenarios**, plus backend build/typecheck/lint. Covers confirmation/CSRF, replay,
  source changes, rejection/expiry, ownership/child/portal boundaries, membership
  revocation, historical access narrowing, unrestricted-tool rejection,
  cross-user cancellation, worker lease recovery, uncertain-write no-replay,
  attendance registration and existing staff AI grants. Full frontend suite:
  **616 tests / 82 files**; focused
  assistant/navigation/notification checks: **81 tests / 7 files**. Frontend
  typecheck, targeted lint, production build and `git diff --check` passed.
  The final copy-only refinement passed another **18 assistant tests / 4 files**
  and build. Final public HTTPS WebKit checks loaded all four real demo portals
  at 390px with no overflow or JavaScript errors; student/parent/principal
  composers enabled after loading and teacher disabled with the role explanation.
- Actual Ollama read examples returned student recorded attendance in **21.3 s**
  and the teacher's dated classes in **13.2 s**. A **28.9 s** real-model notification
  proposal waited for browser confirmation, changed only after Confirm and opened
  the notification panel from its receipt. These isolated timings are not an SLO.
  Reviewed writes and fixture mutations used `omnischool_agent_test_20261009`, not
  the user's main data. WebKit checked all four portals at **320/390/1024px** without
  overflow or JavaScript errors, and verified composer/nav visibility and the
  student preview/receipt. Physical-phone keyboard/motion and user sign-off remain.
- The main demo teacher's existing role does **not** grant `ai.use`. The agent
  respects that boundary and explains it in the UI. Permission was enabled only
  in the disposable test database for staff QA; enabling the real demo permission
  awaits the user's response. Other app permissions and existing logins remain
  unchanged.
- Local and HTTPS `/readyz` report database/events OK. The preview remains
  **https://procedure-brighton-bush-website.trycloudflare.com** and uses polling
  because this Quick Tunnel does not support SSE. Host/preview/Ollama must stay
  running. No Git push or production deployment in this increment.

Production acceptance remains open: fresh PostgreSQL 17/migration-history and
runtime-role/RLS validation, chosen cloud-provider data approval and live tests,
adversarial/multilingual domain evaluations, bounded retention/deletion policy,
load/latency/failure drills and user/device review. A local safe-action test does
not establish universal model reliability or release readiness.

### Agent follow-up and reviewed-attendance hardening — 9 October 2026

- Investigated the user's actual Aarav conversation: identity lookup succeeded;
  the presence follow-up had no successful read, no proposed action and no write.
  The model confused an admission number with an internal UUID. Conversation
  context previously kept prose without freshly authorized structured references,
  substring routing confused "his"/"history" and presence/academic marks, and
  only a whole-class attendance submission tool was available.
- Rebuilt minimal record references from freshly reauthorized historical sources,
  with exact unique name/admission aliases and fail-closed ambiguity. Whole-word
  tool routing uses the current request plus prior authorized domains. The school
  timezone supplies today's date. The app also binds revision numbers for **34
  routine ID-based writes** from the exact affected record; nested marks/comment
  revisions still require their separate domain acceptance. A generic notification
  follow-up test verifies refreshed evidence, not just attendance-specific logic.
- Added guarded student-attendance lookup and single-student observation commands,
  reusing the existing attendance transaction and authorization/audit/event logic.
  The app resolves the class, student, dated roster and register version. A unique
  authorized match is mandatory; locked/stale/out-of-roster requests fail closed.
  Corrections require the user's actual reason, and omitted notes are preserved.
  Model-invented optional class filters/reasons no longer silently shape the change.
- Product clarification for the user's individual-attendance request: recording
  one learner preserves all other learner observations and **does not submit an
  open class register**. A submitted register correction keeps its submitted state.
  A separate class submission remains necessary. No attendance or security policy
  was relaxed, no new migration was required, and physical transport observations
  remain human-only. Catalogue now has **135 entries: 48 reads, 77 reviewed writes,
  10 handoffs**; those counts are coverage, not universal workflow certification.
- The confirmation shows student, class, date, previous/new status and actual
  reason/notes rather than internal IDs. Confirm is still mandatory. Its receipt
  opens the correct dated register filtered to that student; Clear search restores
  the full roster. The established theme/navigation are preserved. Scroll targets
  account for the fixed header, and composer/keyboard space is reserved so the
  confirmation is not hidden. Failed tools and unverified completion claims have
  bounded recovery plus metadata-only audit events; only receipts establish writes.
- Verified **59 backend tests / 3 files**: 24 real-database integration scenarios,
  25 contract checks and 10 mocked provider-protocol checks. Added cases cover
  lookup → pronoun, ambiguity, draft/other-row/note preservation, correction reason,
  idempotency, stale preview/version, locked/foreign roster and parent denial.
  **15 selected legacy API/attendance tests** passed; 28 tests outside that selection
  were skipped. Backend build/typecheck/targeted lint passed. The legacy full-roster
  ranking test now derives the actual active roster size instead of assuming 25
  after the user's transport fixtures added two learners; eligible cohort checks
  are unchanged.
- Full frontend suite **618 tests / 82 files** passed. The final chat-scroll change
  passed **93 focused tests / 6 files**, typecheck, lint and production build.
  Actual Ollama + WebKit verified preview → Confirm → correct student register →
  full roster at **320/390/768/1024/1440px**, with no horizontal overflow or page
  errors and no bottom navigation in full chat. Screenshots were visually checked;
  physical-phone keyboard/motion and user validation remain open.
- Repeatable real-`qwen3:8b` evaluation is in `backend/test/agent-live.eval.ts`.
  The reported two-message request now creates a correct Aarav presence preview;
  ambiguous "Sharma" asks for a choice instead of preparing the wrong learner.
  An initial wider evaluation exposed invented Class 10 and a verb included in
  the student's name; both were corrected before the passing run. A reviewed
  Ananya correction was confirmed and database-verified in the isolated test DB.
  The final live-model rerun also verified correction → reason question → user
  explanation → preview → Confirm, preserving the user's exact reason. Its five
  turns took 12.2, 12.3, 17.3, 16.3 and 13.5 seconds; these are samples, not an SLO.
  All test mutations used **omnischool_agent_test_20261009**; main school attendance
  and transport fixtures were preserved. The real demo teacher's `ai.use` grant
  remains unchanged and awaits the user's approval.
- This is verified local hardening, not closure of every release gate. Live cloud
  providers, domain-by-domain/multilingual/adversarial evaluations, retention and
  erasure policy, load/failure drills, PostgreSQL 17/RLS/runtime validation and the
  pre-existing migration-033 tracking mismatch remain documented in
  [SCHOOL_AGENT.md](SCHOOL_AGENT.md). No Git push or production deployment occurred.

### Preview restored after the power cut — 9 October 2026

- Rebootstrapped the existing local-preview and preview-HTTPS launchd jobs without
  changing application permissions, data or logins. The replacement temporary URL
  is **https://verde-too-independent-bargains.trycloudflare.com**; the earlier
  `procedure-brighton-bush-website` URL is no longer current.
- Public root and `/readyz` returned 200; local and public readiness report
  database/events OK. Ollama's installed local model is available. Keep the Mac,
  preview and Ollama running. This is still an accountless temporary Quick Tunnel
  with polling (no SSE), not a permanent address or new reboot-persistent install.

### Teacher quick feedback — 8 October 2026

User-requested extension: principal administrators can publish a teacher/class feedback request
for students or parents, choose 1–10 preset/custom parameters and a closing deadline, and close early.
Migration `055_teacher_feedback.sql` stores campaigns, unique account responses and lifecycle audits.
The separate Nest module validates current institution membership, current-term enrollment and guardian
relationships, exact rating keys, deadlines and duplicate submissions. Submission and closure share
a campaign row lock. Responses are confidential, not truly anonymous; identities remain stored to
prevent duplicates, with no individual-response API or teacher results access.

The React flow preserves existing shells/theme and adds More entries, a principal Insights link and
pending home prompts. Low / Okay / High / Not sure ratings are collected with native radio controls.
Private aggregate distributions unlock only on closed requests with at least five responses; each
parameter independently requires five non-abstaining ratings. Signals suggest a supportive review
(40% Low) or strength (70% High), not a staff performance verdict. No public teacher leaderboard.

Verification: GitHub Actions run 37799328175 passed backend typecheck/lint/build,
fresh isolated PostgreSQL migration and all backend tests, mobile typecheck/lint/build/tests,
and desktop typecheck/build. All five feedback integration tests and four rating-rule tests
passed. The scheduling integration test now creates its own subject rather than assuming
an arbitrary school's fixtures. A separate local full frontend run had one navigation timeout
(478/479 passed); the authoritative CI full run passed.

Browser checks with synthetic API fixtures pass at 320/768/1024/1440 pixels for creation,
private results and student submission; the parent route passes without browser errors.
This documentation-only reconciliation retains the newer Analytics Stage release record.
User visual acceptance and merging/deployment remain pending; no deployment is claimed.


### Teacher feedback rating redesign — 8 October 2026

User-requested visual refinement keeps all four rating options in one row, including 320px phones. Amber/blue/green/slate surfaces and labelled expression icons distinguish Low, Okay, High and Not sure. Selected choices use a solid surface; native radios retain keyboard operation and visible focus. Existing submission and confidentiality rules are unchanged. Frontend typecheck and all four feedback tests pass. Synthetic-fixture browser checks pass at 320/768/1024/1440px for principal creation/results and student submission, plus the parent route, with no overflow or page errors. Visual acceptance and deployment of this refinement are pending.


### Teacher feedback segmented selector — 8 October 2026

User refined the visual request with a segmented attendance-control reference. Ratings now share one compact rounded track with a colored active pill translating horizontally between Low, Okay, High and Not sure. Native radio tap and arrow-key behavior is retained, unanswered parameters remain unselected, and reduced-motion preferences disable transitions. Typecheck and all four existing feedback tests pass. Synthetic browser checks cover 320/768/1024/1440px, no overflow, submissions, and keyboard-driven pill movement left/right. Deployment and user acceptance of this refinement remain pending.


### Compact feedback home prompt — 8 October 2026

Confirmed the sliding selector release passed deployment and public revision verification in Actions run 37817363937. User requested a cleaner home prompt: replace the large blue multi-line appeal with one white linked row, small feedback icon, Teacher feedback title, pending request count and chevron. The shared student/parent prompt retains eligibility filtering. Typecheck passes; fixture-backed student home browser checks verify no link overflow and successful navigation at 320/768/1024/1440px. Mobile row visually inspected. This follow-up's deployment and user visual acceptance are pending.


### Drag to change feedback rating — 8 October 2026

The shared native-radio selector now supports horizontal pointer dragging, updates the selected rating across segments, clamps at either end, and preserves tap/keyboard behavior. Vertical touch scrolling remains available; pointer cancellation restores the original answer. Capture transfer from touch targets does not terminate the drag. Typecheck, focused lint and four existing feedback tests pass. Browser tests using Chromium mouse dragging left and CDP touch dragging right pass at 320/768/1024/1440px alongside submission and overflow checks. Physical iOS acceptance and deployment remain pending.

### Teacher feedback results analytics — 8 October 2026

Built the requested animated View results dashboard on Stage revision `633cb05` in
an isolated branch. The [results contract](TEACHER_FEEDBACK_RESULTS.md) records the
principal questions, denominators, comparable-history rules and UX boundaries.
The existing theme, shell, feedback slider and confidentiality gates are preserved.

Results now include a rating-mix donut, sortable expandable parameter distributions,
strength/support summaries with practical suggestions, cumulative response activity
and comparable closed-round history. Hidden parameters cannot contribute to summary
ratings or trends. Historical comparisons require the same institution, teacher,
class, audience and question set with five actual ratings on every parameter; no
respondent identity is returned. Regular open requests expose collection activity only. Per the user’s follow-up,
seeded Cambridge demo administrators can preview graphs after one response while
open, with a visible demo label; other accounts retain five-response gates.
No migration, new package or demonstration data write is required.

Local frontend/backend typechecks and scoped lint passed. Five backend policy/rating
unit tests and eleven frontend feedback tests passed. Chromium fixture checks passed
at 320/768/1024/1440 pixels, including sort, native keyboard disclosure, historical
table, locked state, reduced motion and no browser errors. Phone/tablet screenshots
were visually inspected. The automatic approval review blocked publishing the branch because this turn did
not explicitly authorize source publication. The local commit is retained; PostgreSQL
integration verification in PR CI, Stage deployment and physical-phone acceptance
remain pending. No shared database was accessed for tests.

### Teacher feedback Stage release follow-up — 9 October 2026

PR #12 passed its complete verification and was merged into Stage as `85004c9`.
The release run 37826658055 passed all 353 backend tests but stopped on two existing
CalendarView tests after the school-local date became 9 October: their unanchored
date selector matched both the day cell and the Today shortcut. The test-only fix
anchors the day query and freezes Date on that same collision day, leaving timers
real. All five calendar tests and focused lint pass locally. No application code,
assertion, test gate or shared data is removed; the corrected release must still
pass the full pipeline before deployment can be claimed.

### Agent, transport and home Stage release preparation — 9 October 2026

- User requested pull, push and deployment. Fetched Stage at `abb16eb` and merged
  its teacher-feedback flow, analytics and midnight-stable calendar tests with the
  accumulated home, transport and reviewed-agent implementation. Preserved both
  student Departure and Teacher feedback navigation. The three unrelated ` 2`
  duplicate files remain excluded; no reset, force push or full Stage reseed.
- The custom migration runner keys history by full filename, not numeric prefix;
  `055_school_agent.sql` and `055_teacher_feedback.sql` therefore coexist without
  renaming an already-applied migration. Added `056_school_agent_access.sql` to
  enable RLS, revoke PUBLIC/anon/authenticated table access and assign the four
  private agent tables to the established application owner. This follows the
  existing guarded-backend model, not per-user database-role enforcement. The
  Supabase CLI is not installed; the repository's established runner is retained.
  Checked current [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
- A fresh PostgreSQL 14 check stopped at existing migration 033's newer SQL syntax.
  Restarted the existing container runtime and created a separate PostgreSQL 17
  test instance, matching CI. All migrations, including both 055 files and 056,
  applied successfully there. No existing 033 checksum was rewritten. Locally,
  only verified additive feedback/access migrations were applied under the normal
  advisory lock with checksums; existing app data was not reseeded.
- Merge checks caught missing QueryClient context in the home test and an agent
  regression fixture that incorrectly assumed today's attendance was empty. The
  home test now supplies the real provider; the isolated agent fixture temporarily
  removes/restores the one seeded observation, preserving SQL dates as JSON dates.
  A repeated mutated test database produced unrelated roster-count failures, so
  the complete release suite is rerun on a newly migrated/seeded disposable DB.
- Mobile frontend **629 tests / 84 files** passed after those corrections. Backend,
  frontend and desktop typechecks/builds and backend/frontend lint passed before
  the final test-only corrections; final release checks are recorded below when
  complete. Secret scanning found no leaks in the implementation commit range.
- Railway Stage cannot reach the Mac's localhost Ollama service. This release does
  not expose Ollama publicly, invent a cloud key, or silently switch providers.
  Verify and report deployed model availability separately from app readiness.
  The Cloudflare preview continues to use the local model. Deployment is not yet
  claimed at this preparation step.

Final local pre-push verification passed: **444 backend tests / 58 files** on a
fresh PostgreSQL 17 schema with every isolated-integration flag enabled, and
**629 frontend tests / 84 files**. All three builds/typechecks, backend/frontend
lint and `git diff --check` passed; final fixture edits passed targeted lint and
frontend typecheck again. Remote CI/deployment verification remains separate.

### Agent, transport and home Stage release verified — 9 October 2026

- Pushed merged application commit **f5c3d7162d7f20162d0ff03acaaf5ae79ddb05f4**
  to `origin/Stage` without rewriting remote history. [Stage run 37918047922](https://github.com/EduveraIITA/Eduvera/actions/runs/37918047922)
  completed successfully: Verify in 8m15s and Railway deployment in 4m49s.
- CI confirmed **444 backend tests / 58 files** and **629 frontend tests / 84
  files**, with fresh PostgreSQL 17 migrations, repository secret scanning,
  typecheck/lint and all three application builds. Stage applied additive
  `055_school_agent.sql` and `056_school_agent_access.sql`; the feedback migration
  was already present. The full demo reseed step was skipped.
- Independently verified `/releasez` returns that exact SHA with environment
  `stage`, and `/readyz` returns database/events OK at
  **https://omnischool-stage.up.railway.app**. Pipeline checks also verified both
  SPAs, install icons, OpenAPI, student demo access and protected metrics.
- Authenticated WebKit checks on the deployed application passed for principal,
  teacher, parent and student: working demo login, five bottom destinations on
  home, bottom navigation hidden in full chat, no overflow at 320/390/1024px, and
  no JavaScript errors or server-500 responses. Checked the loaded conversation
  state, not just its loading placeholder; principal screenshot visually inspected.
  Authorized principal/parent/student history reads succeeded with the new table
  protection. Teacher AI access still returns its existing deliberate role denial.
- **Railway inference is not configured:** principal/parent/student status reports
  `ollama`, `qwen3:8b`, `ready:false`. The UI visibly explains the unavailable local
  model and disables input. No model credentials, public Ollama exposure or cloud
  fallback were introduced. Enabling Stage inference requires an approved model
  endpoint reachable from Railway; application deployment is not inference setup.
- The existing **https://verde-too-independent-bargains.trycloudflare.com** preview
  remains healthy. Its four-portal browser check passed, with local Ollama ready
  for authorized accounts. The three unrelated duplicate files remain uncommitted.
  The disposable PostgreSQL 17 test container was stopped, preserving its data.
  This is a verified **Stage**, not production, release; physical-device/product
  acceptance and the remaining agent release gates still apply.
- CI emitted existing maintenance warnings about actions' Node 20 deprecation
  and the upcoming ubuntu-latest image migration. Those did not fail this release;
  no workflow-version change was mixed into this deployment.

### Google Cloud trial connection — 9 October 2026

- User selected **Eduera (`eduera-511111`)** and authorised setup limited to the
  **$300 trial**. No paid-account upgrade, GPU/Marketplace deployment or spending
  beyond available trial credit is authorised. Keep the current deployment intact
  until a separate Google Cloud deployment is verified.
- Google Cloud CLI 588.0.0 is installed and user authentication is verified. The
  local CLI now selects the user-specified project. Project billing reports enabled;
  read-only inventories returned no Cloud Run services, Cloud SQL instances,
  Artifact Registry repositories, storage buckets or Secret Manager secrets.
- The linked billing account is not accessible to the authenticated user:
  `gcloud billing accounts describe` returns permission denied. Trial status,
  remaining credit and expiry have therefore **not** been verified. Request billing
  viewer access or user-provided Billing overview evidence before provisioning
  billable resources. Budget alerts alone are not a hard spending cap.
- No cloud resources, IAM grants, secrets, databases or deployment pipelines were
  created or changed by this setup. Uploads currently use local disk and background
  event processing needs continuous execution; account for both in a hosting design.
  This is connection/preflight evidence, not a deployed or production-ready service.

### Google Cloud Stage automation in progress — 9 October 2026

- The user subsequently authorised creating the required infrastructure against
  their stated $300 trial credit and selected the deployed Stage data as the source.
  The account still cannot independently verify billing credits; budget creation
  failed validation. No successful budget setup or hard spending cap is claimed.
- Concurrent team work was discovered after provisioning began. The team owns the
  existing **`eduera-db`** PostgreSQL 17 micro instance and **`eduera/web`** image
  repository in Mumbai. User explicitly chose those resources and requested
  deletion of our duplicate **`eduvera-stage`** database. Its create operation is
  still running; removing deletion protection returned 409 until creation finishes.
  No team data has been modified.
- Created branch/repository/workflow-restricted GitHub OIDC federation, a deploy
  service account, separate runtime/migration identities, private upload bucket,
  empty migration-secret containers and the `gcp-stage` GitHub environment.
  The extra empty `eduvera-stage` image repository also exists; it is not the chosen
  image destination. No Cloud Run application is deployed by this work yet.
- Added the Google Cloud job to the Stage workflow without removing Railway.
  Source-secret copying is an explicit separate dispatch, never an automatic
  reseed. Release images are built on GitHub; deployment uses a migration job,
  candidate checks and application traffic rollback. Secret values are excluded
  from logs, artifacts and container contexts. Deployment is initially disabled.
- Locally verified five deployment-contract tests, both workflows with actionlint
  structural validation, full shell validation of the new reusable workflow, and
  `git diff --check`. Existing Railway shellcheck warnings remain unchanged.
  GitHub execution, database/file copying, cloud runtime and public verification
  remain pending; see [Google Cloud Stage](../../deploy/gcp/README.md).

### Google Cloud initial deployment and migration verified — 9 October 2026

- User confirmed the $300 trial allowance, selected the deployed Stage database
  as the source, then explicitly directed reuse of the team's **`eduera-db`** and
  removal of our duplicate. Deleted the empty **`eduvera-stage` Cloud SQL instance**;
  delete operation `f0cd4643-5a83-413a-b714-beb70000002f` completed. No team database
  was deleted. The similarly named Cloud Run service is intentional and separate.
- The Stage workflow is published in commit **ada5a011f1de6a716f24206001b8b5de4036e4fa**.
  [Explicit bootstrap run 37928341516](https://github.com/EduveraIITA/Eduvera/actions/runs/37928341516)
  verified GitHub OIDC and copied source configuration without exposing values.
  Temporary per-secret write permissions were revoked after the successful copy.
- Copied a consistent Supabase PostgreSQL 17.6 **public application schema** snapshot
  to the new `omnischool` database inside **`eduera-db`**. Source Supabase-managed
  schemas were not copied; public functions were checked for dependencies on them.
  All **183 table row counts** matched, including **200 students and 64 migrations**.
  Chat, leave and assessment attachment tables were empty. Kept the source encryption
  key so copied restricted records remain decryptable. The original Stage database
  was not altered or continuously replicated. Later source writes do not synchronize.
- Cloud SQL backup **1791548387012** succeeded. Daily backups remain enabled;
  deletion protection and encrypted-only connections were enabled. A private
  local dump is retained under ignored `.runtime/gcp-migration/`, not in GitHub.
- Deployed the tested amd64 image by the initial release SHA to
  **https://eduvera-stage-367469594690.asia-south1.run.app**. Cloud Run uses one CPU,
  1 GiB, one-instance service scaling, continuous CPU for the existing worker,
  private mounted file storage and versioned Secret Manager references. The
  migration job ran successfully using its separate Google service identity.
  The existing database-owner runtime approach remains a documented production
  security gate; separate Google identities do not imply non-owner database RLS.
- The private file mount passed exclusive-write rejection, create/rename/read,
  and cleanup checks in a temporary Cloud Run job. Public readiness, exact release,
  both SPAs, icons, OpenAPI, demo mode and anonymous metrics rejection passed.
  Authenticated WebKit checks passed all four portals at 320/390/1024px with no
  page/server errors. **Cloud inference remains unavailable** (local Ollama);
  no GPU, paid model or billing upgrade was introduced.
- Created a project-only **INR 250 monthly early-usage alert**, before credits,
  with 50/80/100 percent thresholds. Its currency is INR, not USD; it is not a hard
  cap. Actual trial credit/expiry is still not independently visible to this login.
- Enabled the Google Cloud deployment flag and selected Google Cloud as the Stage
  release target. Railway remains available but future releases skip its deploy
  job. Six local release-guard tests and the live runtime guard pass. The next
  automatic candidate/migrate/promote cycle still requires final CI evidence.

### Google Cloud automatic Stage deployment verified — 9 October 2026

- [Stage push run 37930186905](https://github.com/EduveraIITA/Eduvera/actions/runs/37930186905)
  completed **successfully** for release
  **41c9aa537701a39fcd4ba635c0387b9468760578**. Secret scanning, deployment guards,
  backend integration tests, mobile tests, lint/typechecks and both frontend builds
  passed. The Google Cloud job used keyless GitHub authentication, pushed the image,
  ran migration execution **eduvera-stage-migrate-rmpqw**, checked the candidate,
  promoted it and removed its temporary verification tag. Railway was skipped.
- Cloud Run revision **eduvera-stage-00002-wik** now serves 100% of traffic at
  **https://eduvera-stage-367469594690.asia-south1.run.app**. Independently verified
  its exact release SHA and readiness, then re-ran principal, teacher, parent and
  student WebKit login/navigation checks at 320/390/1024px with no overflow,
  JavaScript errors or HTTP 500s. These checks do not certify every domain workflow.
- Confirmed **eduera-db is the only Cloud SQL instance** and the runtime connector
  references it. Removed the unused empty `eduvera-stage` image repository; the
  team's `eduera/web` remains. Disabled temporary source-connection secret versions,
  revoked migration-bootstrap secret-write grants, deleted the completed one-off
  file-check job, and stopped the local migration proxy. Private migration dump and
  original source credentials remain recoverable. Railway and native local preview
  readiness remain healthy; neither is continuously replicated with Google Cloud.
- No paid model or GPU was added. Cloud Ollama inference remains unavailable and
  visibly disabled. Trial budget alerts/deployment expiry are not spending caps;
  production security and operational gates documented above remain open.
- This evidence is recorded in a documentation-only `[skip ci]` follow-up; the
  verified deployed application release remains the SHA above.

### Private Stage accounts and bounded cloud AI — 9 October 2026 (in progress)

- User decision: preserve four existing review personas, remove public shortcuts
  and shared credentials, enable a low-cost Google model using trial credit with
  abuse controls. No authorization to upgrade billing or use GPUs.
- Verified on Cloud Run revision `eduvera-stage-00003-6kd`: `DEMO_MODE=false`,
  private passwords for all four accounts login successfully; 413 other published
  fixture-password hashes disabled, 15 old/probe sessions revoked. Profiles and
  school records remain. Credentials are delivered only in a Git-ignored 0600
  local file. Password rotation is independent of the pending code release.
- Removed public persona shortcuts from mobile and desktop login, prohibited the
  published password outside local demo mode, added durable per-identifier login
  throttling, and restored unambiguous school membership for password sessions.
- Added keyless Vertex adapter, approved Flash-Lite model restriction, per-account
  request limits, durable pre-generation cost reservations (migration 057), input,
  output and concurrency bounds, kill switch and review expiry. Existing domain
  authorization, confirmation, stale-preview and audit protections remain.
- Minimal Google runtime invocation role and Vertex API are provisioned; a small
  synthetic model probe passed. App deployment/real portal evaluation are pending.
  Pricing, trial limits and processing-region boundary are documented in
  `deploy/gcp/README.md`. This is not a claim of zero abuse or production readiness.
- An embedded SMTP fallback credential was removed; delivery is off. Provider-side
  revocation of the historical app password remains an owner action. Separate old
  Railway/local snapshots are not secured or synchronized by this database change.
