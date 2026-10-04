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
| C2: Restricted care | No care domain | Assigned confidential referrals, alternate reporting route, audited restricted access and documented outcomes; never broad-feed allegations |
| C3: Transport pilot | Some existing read-only placeholder surfaces | Explicit service boundary, route/trip/leg rosters, manual observations, unresolved rider reconciliation and staffed closure; independent readiness gate |
| D1: Repeatable operations | Basic timetable conflict checks | Staff coverage tasks, approved device adapters, quarantine, provider health, onboarding templates |
| D2: Bounded policy | Attendance threshold/calendar configuration | Typed versioned draft/rehearsal/approval/activation workflow, scoped precedence, equal-priority conflict rejection, explanations and prospective rollback |
| E1: Finance | No authoritative fee ledger; existing labels need review | Obligations, integer minor units, allocations, receipts, verified callbacks, reversals, reconciliation; never gate collection on unpaid fees |
| E2: Academic/admin breadth | Diary/homework completion; timetable editing | Admission conversion, assessments/results, office requests/documents/lost property; extend only after core acceptance |
| F1: Intelligence | Provider-neutral read-only attendance assistant | Evidence/freshness, scoped retrieval tests, safe drafting, policy rehearsal; no authority, diagnosis, release or autonomous reconciliation |

B1 still has foundational gaps; B2 and B3 have locally implemented workflows awaiting acceptance. The B4 slice builds only on already-existing account, enrollment
and attendance primitives; it does not imply that the complete Stage B exit gate has passed.

## Section coverage

| PDF sections | Delivery evidence / decision |
| --- | --- |
| 1-4: Definition, principles, boundaries, outcomes | Above baseline and staged roadmap; operational-obligation metric definitions remain to be field validated |
| 5-6: Roles and experience | Existing role shells retained; new follow-ups use deliberate guardian/staff contexts; purpose grants and office/transport/care roles remain B1/C |
| 7-9: Domains, invariants, observations | New CoordinationModule; separate journal; tenant FK; actor and effective/recording time; attendance source observations and reconciliation are implemented locally; other adapters remain D |
| 10: Closed loops | WF-LOCAL-001 below; remaining domain state machines scheduled C/E |
| 11-12: Configuration, non-app and offline | Assisted follow-up channel and account-scoped encrypted attendance device queue implemented locally; policy lifecycle and other non-app channels remain D/D2 |
| 13-15: Architecture, concurrency, tenancy | Retain modular Node backend; transaction + outbox, replay, scope checks, command receipts; runtime-role RLS and purpose grants remain B1/B6 |
| 16-18: Privacy, finance, AI | Restricted-data boundaries recorded; no real provider/finance/safeguarding enablement in this slice |
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
