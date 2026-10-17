# ThatCampus Blueprint v2 implementation

Baseline: [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md), accepted
16 October 2026. [Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md)
is its normative backend/model companion. [ThatCampus Model Core
blueprint](THATCAMPUS_MODEL_CORE_BLUEPRINT.md) is the detailed core capability and
delivery contract, and [ThatCampus operating
experience](THATCAMPUS_OPERATING_EXPERIENCE.md) is the normative user-facing
interaction/workflow companion. The repository-root `School_Operations_Blueprint.pdf`
v1.0 is historical provenance and is no longer the primary product authority.

This is the implementation record, not a claim that the entire blueprint is complete.
The v1 PDF referenced a companion 40-item backlog, six workflow contracts, schemas and 36
acceptance scenarios that were not attached. IDs below are local traceability IDs, not
reconstructed companion artifacts. Field discovery, institution sign-off and operational/legal
decisions cannot be replaced by synthetic software tests.

## Accepted direction

- Owner-approved assistant response styling, 18 October 2026: replace the electric
  canvas effect with a thin blue flowing edge (seven-second cycle) and restrained
  glow, matching the approved brighter preview. Scope it to compact/full response
  containers only; retain the plain composer, existing layout and reduced-motion
  static fallback. Hosted promotion remains a separate release gate.

- Attribution contrast correction, 17 October 2026: the app shell currently uses
  light surface tokens regardless of device dark preference. Its compact credit
  therefore uses the original navy/blue logo and slate text, without screen blending.
  Desktop retains its actual light/dark surface selection. A dark-device regression
  test, production app build, and browser checks against both clients' real theme
  styles pass locally. Hosted promotion remains a separate deployment gate.

- Owner decision, 17 October 2026: use a compact inline “Powered by” credit beside
  the original ThatCampus logo in both app and desktop, without ribbon, container,
  divider, border, shadow or animation. Existing placement remains unchanged.
  Both production builds and two focused component tests pass locally; isolated
  browser checks cover 320, 768, 1024 and 1440px in light/dark appearance. Hosted
  deployment and owner visual acceptance are separate gates.

- Product decision, 17 October 2026: retain and push the complete digital-twin core,
  broad Cambridge synthetic campus, simulated-human Campus Lab runner, guarded seeds
  and development adapters throughout active development. Cambridge is wholly dummy
  and may be expanded whenever realistic capability demonstration requires more
  people, agents, roles, spaces, resources, schedules, rules or activity. Do not run a
  production-cleanup pass until the owner explicitly asks to **clean for real market
  release**. Synthetic provenance, Cambridge-only scope, ordinary authenticated domain
  APIs, external-side-effect denial and Model Core/domain authority remain mandatory.
  The current wall-clock actor runner is still local-only; hosted Stage actor execution
  needs a separate reviewed isolation/credential contract and must not be claimed from
  source retention alone.

- Product decision, 16 October 2026: ThatCampus is a campus digital twin, not a
  conventional ERP. Institutions can start with one bounded capability and expand from
  zero to the full campus without duplicate people, classes, places or resources. The
  backend Campus Model Core remains a separate API/contract-driven module; domain
  services retain authoritative state and the frontend uses only domain-specific language.
- Product clarification, 16 October 2026: the Campus Model Core is the operating
  coordination kernel, not an after-the-fact projection. Every real person who acts
  through the product or an approved channel must map to one stable human agent linked
  to their person/account identity. Material work follows a traceable agent command or
  observation -> authority/rule/context resolution -> owning-domain execution ->
  correlated outcome/evidence -> next-agent hand-off loop. Typed domain records and
  invariants remain authoritative; the model connects and drives them rather than
  replacing them with a generic ERP schema.
- Product clarification, 16 October 2026: agents are event-reactive participants and
  communicate through durable typed operational messages. Accepted domain events match
  effective, purpose/scope-bound subscriptions and create reaction instances; a
  reaction may send a message, contribute an observation or issue a command; the
  owning domain outcome may trigger the next reaction. Delivery, acknowledgement,
  acceptance, execution and physical evidence remain distinct. Agent messages are not
  the AI chat transcript or generic notifications. The runtime must retain
  correlation/causation, authority and rule evidence, idempotent effects, bounded
  retry/expiry/dead-letter, ordering where declared, escalation, loop limits and a safe
  correction path. Model only the operational granularity justified by purpose,
  privacy and retention requirements.
- Product clarification, 16 October 2026: the Campus Model Core is
  behaviour-neutral. No agent has hard-coded goals, subscriptions, reactions,
  recipients, timing, escalation, autonomy, tools or adaptive/learning behaviour.
  These come only from validated, versioned, effective-dated institution configuration
  and Operating rules, whose versions are retained on every reaction. An agent may
  propose a configuration change but cannot self-activate it; authorized administration
  must validate, rehearse and publish it. Code continues to own schemas, deterministic
  runtime semantics, domain invariants and non-weakenable safety/privacy floors.
  Missing/invalid configuration fails closed or uses its explicit human fallback; it
  never enables an undocumented automation default.
- Product decision, 16 October 2026: the real-campus interface follows the ThatCampus
  Operating Experience contract. Overview/Today is a projection ordered as Now, Needs
  attention, Next and a restrained automatic-history section; it never becomes a
  second editor. Operational communication is rendered as Request, Task or Offer,
  while informational Updates remain in Notifications. Navigation stays stable by
  role, parent indicators are derived from real unresolved descendants, and ordinary
  users see domain language rather than agent/model machinery. Every domain workspace
  shows truthful state, one primary next action, automation explanation and a safe
  correction/escalation route where applicable.

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
- Product decision, 16 October 2026: reduce repetitive staff work through bounded,
  explainable automation. Mutable automatic actions belong to institution-level **Operating
  rules**, not per-record settings or hard-coded UI behavior. Authorized administrators can
  review and edit the rule's timing, scope and fallback; each execution retains the effective
  rule/version, reason and audit evidence, remains visible to the responsible operator, and has
  an explicit correction or override path where the domain permits one. Automation must not
  manufacture observations, infer missing attendance as absence, grant authority or consent,
  complete financial reconciliation, resolve safeguarding decisions, or authorize physical
  handover. New workflows should default routine safe work automatically while escalating only
  genuine exceptions, avoiding extra confirmation steps that do not change risk or authority.
- Preserve `schools` as the current tenancy anchor while modelling new capabilities as
  institution-scoped configuration. The product target includes schools, colleges and coaching
  institutions; capability packs must express regulator and education-stage differences instead
  of scattering school-only assumptions through new domains. The first governance pack is the
  India school core pack; college and coaching packs require their own evidence and acceptance.
- Product decision, 5 October 2026: initial institution onboarding assumes the institution is
  bringing already-admitted learners into ThatCampus. A pre-admission/enquiry/application pipeline is
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
| B1: People and authority | School-scoped account-optional people; individual and reviewed bulk enrollment; dated guardian leave-signing permission; locally implemented connected-student class movement, withdrawal and transfer-out with preserved history | Other purpose-specific grants and account-invitation acceptance; physical connected-student acceptance; no merge by phone/name |
| B2: Daily plan | Weekly baseline plus dated, versioned daily plans; notices/materials; coverage responses; shared family schedule; conflict checks and outbox updates | Local UI acceptance and school-operating validation; resource catalogue/advanced authoring remains later timetable scope |
| B3: Attendance | Daily full-roster commands plus configurable scheduled-subject registers linked to the effective timetable; independent campus-presence mode; revision checks, idempotency, correction history, calendar, leave; immutable source-rich observations; encrypted account-scoped offline queue with expiry/quarantine; reviewed paper and office capture; time-bounded QR self check-in contract | Staff review UI for QR/device evidence; registered camera/biometric adapters and provider health; campus capture command; print/export reconciliation, physical offline/device drill and school-operating acceptance; retain unrecorded/unknown states |
| B4: Attendance follow-up | Attendance facts and parent/teacher screens | First local slice implemented below: explicit owner/deadline, guardian reply, assisted response, outcome, event update |
| B5: Communication/actions | Per-user notification inbox, diary acknowledgments and notes; role-aware Requests inbox; locally implemented scoped notices with immutable recipients, distinct delivery/open/response state and assisted non-app capture | Physical role-by-role acceptance; external SMS provider delivery; operating-policy sign-off; broader conversation acceptance |
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

## Active delivery: Blueprint v2 and Campus Model Core foundation - 16 October 2026 (local)

The owner superseded the v1 PDF as product authority and accepted a new direction:
ThatCampus is a campus digital twin, not a conventional ERP. The normative living
blueprint is now [PRODUCT_BLUEPRINT_V2.md](PRODUCT_BLUEPRINT_V2.md), with the
backend contract in [CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md).
The v1 PDF remains historical provenance only.

The backend target is a separate API/contract-driven Campus Model Core. It owns the
stable cross-domain identity, temporal relationships, observation/command envelopes,
agent authority evidence and projections. Attendance, timetable, people, finance and
other domains keep their authoritative records and invariants. Frontend code calls
domain APIs and uses campus language; no twin/graph persistence or terminology is
exposed to ordinary users.

The campus/space/resource/placement work is retained as the first **campus topology
domain** projection, not treated as the complete model core. Migrations 101 and 102
passed transaction-only validation and are applied to the loopback-only preview
database with checksums recorded in `node_schema_migrations`. The separate
`CampusModelCoreModule` exposes a typed application port; institution setup writes its
authoritative domain state, audit/outbox evidence, stable model identity, temporal
relationships and correlated command/outcome in one database transaction. An
architecture regression rejects direct model-table access from the topology service.

The administrator UI now uses only campus language: Campus & spaces, buildings,
classrooms, equipment, class locations and people. It does not present the internal
model, graph or twin terminology, and it reports connected records rather than a
mandatory whole-institution completion percentage. The setup home uses the app's
compact grouped-list hierarchy instead of dashboard-like blocks. A centralized
`--thatcampus-*` compatibility layer now resolves the established theme tokens during
the brand migration, preventing transparent cards and sheets. Focused editors use an
opaque bottom sheet, contextual title/help, full-width bounded controls, sticky equal
actions and safe-area padding. Browser checks at 320, 390, 768, 1024 and 1440 px found
no horizontal overflow, and the reviewed routes emitted no console warnings/errors;
physical owner-device review remains open.

### Observation and trace spine — first vertical slice (16 October 2026)

Migration 103 and the typed Campus Model Core port now connect the existing immutable
attendance-capture evidence to stable student, class and human-agent identities.
Creation is atomic with the source attendance observation and uses a SHA-256 request
hash plus institution-scoped idempotency key. Acceptance, quarantine and rejection
remain decisions of the attendance continuity workflow; the model core only mirrors
that decided evidence state. Migration backfill connected 203 existing attendance
observations and 204 student identities in the loopback preview database without
inventing missing attendance facts.

The model core owns the combined recent-activity projection; the institution setup
domain consumes it through the port and does not query or write model tables. The
Campus & spaces screen presents the latest setup changes and attendance captures in
ordinary campus language with actor, time, class, count and review state. The screen
does not expose digital-twin, graph, command-envelope or projection terminology.

Verified evidence on this branch: backend TypeScript build and targeted ESLint pass;
the focused CampusReplicaManager tests pass; the local migration applied; source and
model observation counts match at 203; the signed-in mobile-width preview renders six
recent class attendance captures with no raw model terminology. The generic migration
runner remains blocked by a pre-existing checksum mismatch for migration 047 in this
shared development database, so migration 103 was applied transactionally and recorded
with its checksum independently. This does not resolve or overwrite migration 047.
Registered device/integration ingress, richer causation/correlation and Phase 3
authority binding remain open.

Verified local evidence: backend typecheck/build pass; the focused Campus Model Core
contract and architecture suite passes 4/4; focused campus/admin/catalog frontend tests
pass 7/7; targeted frontend lint and Vite production bundling pass after the visual
repair. The persistent
model projection contains institution/campus/space/class/staff identities with current
`part_of`, `located_in`, `home_space` and `assigned_to` relationships and zero detected
cross-tenant relationships. The main preview, database/event readiness and private
photo-attendance health return successfully. Full frontend TypeScript build is
currently blocked by unrelated untracked duplicate `* 2.tsx`/`* 3.tsx` test files in
the shared dirty checkout; those files were not deleted or modified by this slice.

This section records direction and incomplete local work. It does not claim a
complete digital twin, autonomous campus operation, multi-campus release or deployed
behavior.

### Attendance observation convergence — local backend slice (16 October 2026)

The ordinary daily-register save path and the scheduled-session submit path now retain
their authoritative attendance record, immutable revision, domain audit, durable
audience-scoped outbox event and accepted human-agent Campus Model observation in the
same database transaction. Each accepted observation points to its immutable attendance
revision and the per-student outbox event through `domain_event_id`; its payload carries
the class, attendance date and, for scheduled attendance, the exact session ID. The
observation describes attendance participation only and does not infer room presence or
continuous location. The existing continuity-capture workflow remains a distinct
pending/reviewed evidence path.

Scheduled register submission, manual lock/reopen and leased automatic finalization now
emit the same typed attendance/register event family with session-aware payloads and
attendance-model, continuity and Campus View cache targets. Record changes also emit
per-student `attendance.updated` events for learner/family projection refresh; session
events suppress the pre-existing daily-record notification link because that link cannot
identify a scheduled entry. Lock transitions refresh projections but deliberately do not
manufacture per-student observations.

Learner QR check-in now serializes against the session register and rejects a locked
register. Automatic acceptance retains an immutable session-entry revision, accepted
human-origin observation and linked outbox event atomically. Staff-review mode retains a
pending human-origin observation instead; replay does not downgrade already accepted QR
evidence or create another accepted observation. Neither path treats the QR assertion as
a device identity or spatial observation.

The Campus Model recent-activity projection now includes accepted or pending
`attendance.capture`, `attendance.daily`, `attendance.session` and
`attendance.self_check_in` evidence with the source type and human-agent provenance.
Focused backend convergence, core-contract, Campus View and event-service tests pass
**32/32**; backend typecheck and build pass. This is local source evidence, not deployment
or all-panel acceptance. Database-backed API integration was not rerun in this checkout
because no isolated `DATABASE_URL` was provided.

This slice converges accepted attendance facts, evidence and browser invalidation; it
does **not** yet add the full typed model command/outcome and next-agent hand-off chain.
An explicit staff decision endpoint for pending QR evidence, broader scheduled-session
integration/concurrency coverage, operating-rule version snapshots for automatic QR,
and historical daily/session observation backfill remain open.

### User-facing projection convergence — local horizontal slice (16 October 2026)

The accepted read boundary is now explicit: every user-facing panel reads an
authorized, role- and domain-specific projection of the owning domain's current
records. The Campus Model Core connects those records with typed provenance,
correlation and expected/observed/accepted context; it is not a generic UI state
table, and frontend code must not query model-core persistence or reinterpret one
observation as another domain's fact. Domain mutation, audit and the audience-scoped
outbox event commit atomically; authorized clients then invalidate the affected
domain projections and refetch them. Realtime delivery is a convergence signal, not
the state store.

The shared frontend event protocol now covers the dependent role projections for
attendance, timetable, leave, people, fees, diary/day plans, campus events,
assessments, institution setup, Operating rules and activation readiness, with a
broader fail-safe full-sync set. Backend producers now retain atomic durable refresh
events for fee invoice/payment and Razorpay settlement, fee instructions,
homework completion/reopen, diary notes, all Operating-rule saves, invitation
create/resend/revoke/acceptance and membership activation/deactivation. The same
contract now covers staff profile/onboarding, leave-policy/balance and coverage-rule
changes; Activation quick-start catalogue/timetable writes; legacy student, guardian,
enrolment, import and rollover commands; chat message edits; and source-backed
notification-read acknowledgements. Membership revocation emits a narrowly authorized
self-scoped access signal so an already-open client immediately refreshes its authority.
Refresh audiences include the affected learner/family and staff/principal views rather
than requiring a page reload or relying on an unrelated notification count.

Semantic leaks found during this audit were removed. Gate/RFID evidence remains gate
evidence and no longer becomes academic `Present` or `verified`; attendance panels
retain the unrecorded state until attendance evidence exists. Parent Home fee state
is derived from the selected learner's authoritative posted ledger as
not-configured, clear, outstanding, overdue, refund-due or mixed, and no longer uses
a fixture "all clear" label. Authenticated learner/family routes no longer invent a
school identifier, materials, stock profile image or fixture learner when the API
does not provide one; recorded avatar URLs are used and initials are the neutral
fallback.

Verified local evidence for this slice: the combined focused frontend convergence set
passes 47/47; the combined backend projection/event set passes 60/60; the Campus Lab
schedule/safety set passes 8/8; and the production-exclusion set passes 3/3. Backend
build and full backend ESLint pass, the frontend production bundle succeeds, and
targeted frontend ESLint plus repository diff checks pass. The repository-wide frontend
TypeScript command remains blocked by
pre-existing untracked duplicate `* 2.tsx`/`* 3.tsx` files in the shared checkout;
those files were not changed or removed by this slice.

This is not yet evidence that every workflow is fully Model-Core-mediated. Source-free
personal account notifications deliberately remain local because assigning one of the
user's campuses would fabricate provenance; all notification reads with an authoritative
school source now converge across devices. Fees, diary, rules, invitations, activation,
staff administration and legacy enrolment writes still need typed Model Core
command/outcome adapters before those workflows can be called end-to-end
digital-twin-driven. Database integration suites compiled but were skipped without an
isolated test database, and deployment plus owner-device all-panel acceptance remain
open. Migration 110 was applied to the current development database with its recorded
checksum; the normal migration runner still stops at a pre-existing checksum mismatch
for applied migration 047. That historical checksum must be reconciled against the
shared deployment baseline before any managed release rather than bypassed in production.

### Campus View separated from the synthetic school day — implementation and owner validation in progress (16 October 2026)

The owner clarified that campus observability is a permanent administrator feature,
not an experimental simulator page. **Campus view** now belongs directly under
Principal/Admin **More -> School overview**, while only Cambridge's pseudo students,
staff and families performing normal app work remain a development experiment named
**Synthetic school day**. This decision supersedes the earlier dev-only ownership of
the mobile view recorded below.

The production backend now exposes
`GET /api/v1/schools/:schoolId/campus-view/?campus_id=&at=` through a dedicated
Campus View module. It requires an active administrator membership, constrains
topology to institution/campus, reads temporal/model projections through their ports,
and returns a deterministic versioned schematic keyed to real space IDs. Expected,
observed, accepted and unknown assertions remain separate and carry source,
freshness and spatial-claim qualifiers. A timetable remains expected context; gate
and attendance evidence does not become an inferred room position.

The permanent frontend route `/principal/campus` uses React Konva/Konva to render an
immersive top-down Canvas scene. The owner explicitly corrected this route on 16
October: Campus View is a map workspace, so the normal app header, desktop sidebar and
mobile navigation must not reserve top or bottom strips. It now uses a dedicated
edge-to-edge canvas shell with only a floating deterministic **Back to More** control,
the selected campus's short configured code and compact map controls. Other Operations
routes retain the established shell and navigation. The campus world is deliberately
finite: a fixed `760 x 920` schematic coordinate space
is fitted responsively and pan is clamped to recoverable bounds rather than exposing
an infinitely draggable canvas. When the complete site is smaller than the viewport it
stays centred and cannot drift across empty space; panning activates only on axes where
the zoomed site is larger. Wheel, button and two-finger pinch zoom share the same
fit-relative limits, and **Fit campus** returns the whole site to view. Explicit floor
or honestly labelled room-series selection, selectable rooms, clustered counts and
truth-state styling remain within that bounded site.

The view states when geometry is schematic and not to scale. Native-dialog Spaces
and Activity overlays provide a keyboard/screen-reader-accessible map directory and
recent evidence trail; the opaque room sheet retains provenance, spatial qualifiers
and authoritative domain links. The page is read-only; campus edits remain in
Institute setup. The frontend API preserves the backend `spatial_claim` qualifier so
expected context, a point observation and bounded-space presence do not collapse into
one location claim. The development-only adapter may add labelled Cambridge rehearsal
context through a generic view-extension contract, but it does not replace real
assertions or upgrade them to another truth dimension. Personas, development labels
and the runner client remain under `frontend/src/dev`, are loaded only behind the Vite
development constant and remain excluded from production builds.

Point observations without an institution-configured validity window remain
historical evidence: they may be inspected in the room sheet but no longer paint a
room as currently observed or accepted. The sheet labels expected, observed and
accepted evidence separately. Multi-campus selection now selects one real campus
rather than offering a false aggregate, school time uses the configured campus/school
timezone, and the activity trail identifies its current institution-wide scope.

Configured room capacity is now visible directly inside each mapped room as a compact,
anonymous capacity pattern. A source-qualified scheduled or development-overlay count
fills representative places as **planned**; the remainder stays **unconfirmed**. The
view deliberately does not call these places occupied, empty or available because the
current timetable, attendance and gate contracts do not prove chair-level presence.
Capacity-only rooms say that current use is unknown, dense rooms use a proportional
maximum of 60 representative marks, and a plan above capacity is called out without
fabricating extra seat identities. True chair-level occupancy remains gated on a
versioned seat layout plus bounded, source-bearing room-presence evidence.

The current-day operational projection now adds effective timetable occurrences,
responsible-teacher expectation, accepted gate point totals, active visitor records
and a bounded day-activity trail to the same read-only Campus View contract. A
teacher shown against a room is **expected** from the effective schedule, never
presented as physically present. Gate movements remain accepted boundary point
events and never become a room-location claim. Institution-wide gate totals disclose
that scope when a selected-campus attribution cannot be proven. The map summary uses
only the effective schedule for its current-class count; development overlay zones
for reception, health, transport or other operational staff cannot inflate that
number. Pending attendance evidence remains observed, while pending/review/failed
commands remain unknown rather than being promoted to accepted campus truth.

Verified local evidence at this checkpoint:

- backend Campus View tests pass 9/9; the combined Campus View/core temporal suite
  passes 27/27; backend build and targeted lint pass;
- Campus View geometry, finite viewport, full-canvas shell and More navigation tests
  pass together with the focused More suite, 41/41; the viewport suite verifies fit,
  centring whenever the whole site fits on an axis, pointer-centred
  zoom, pinch zoom, scale limits, resize preservation and clamped recoverable bounds;
  targeted frontend lint passes;
- Vite production bundling succeeds with the permanent `CampusViewPage` chunk;
- the focused room-capacity, accessible directory, map geometry and viewport suites
  pass 19/19; scoped lint passes. The capacity suite covers planned versus
  unconfirmed places, explicit zero versus unknown use, overflow, dense proportional
  rendering and the prohibition on presenting planned headcount as physical occupancy;
- the reconciled current-day operations, activity-truth, capacity, accessible
  directory, geometry and viewport suites pass 23/23; the two Campus Lab view/timetable
  suites bring the focused frontend integration run to 27/27. Backend Campus View and
  Cambridge-fixture contracts pass 17/17, backend full typecheck and scoped lint pass,
  frontend scoped lint passes, and the Vite production bundle completes. The full
  frontend typecheck remains blocked only by the already-recorded duplicate test
  artifacts, not by this slice;
- simulator source/exclusion tests pass 3/3, retain the development-only import
  boundary and reject development-persona language from permanent Campus View source;
- the latest production Campus View chunk contains no simulator route/client or
  synthetic/dummy/simulation language;
- the repository-wide frontend TypeScript command remains blocked only by pre-existing
  untracked duplicate `* 2.tsx`/`* 3.tsx` test files in the shared dirty checkout;
  those files were not changed or deleted by this slice.

The local preview database has migrations 106-109 and the Matrix transport migration
applied, and the managed preview is healthy. The permanent Canvas view, bounded
pan/zoom controls, accessible Spaces and Activity overlays and opaque details sheet
were inspected at a narrow `320 x 780` mobile viewport with no document overflow or
reserved application-chrome strip; the development overlay remains clearly labelled.
It remains a source-backed current snapshot, not a continuous
live-location claim. Owner mobile/Cloudflare visual acceptance, mapped surveyed
geometry, event-driven refresh coverage and deployment remain open; this section does
not claim those gates, production readiness or a live-location capability.

The normal local migrator is still blocked by a pre-existing checksum mismatch for
applied migration `047_work_profile_domain_alignment.sql`; the missing post-105
migrations were therefore applied transactionally and recorded for this disposable
preview database. That checksum drift remains a release-engineering debt and is not
claimed as repaired by Campus View.

### Cambridge Campus Lab development harness — real school-day/window correction implemented locally, owner validation open (16 October 2026)

The owner requested a development-only way to watch the fully synthetic Cambridge
school continue to act as real wall-clock time advances. The accepted contract is
[Campus Lab development harness](CAMPUS_LAB_DEVELOPMENT_HARNESS.md). Campus Lab starts
with the managed local preview and has no play, pause, replay, scrub, speed or
fast-forward controls. The owner rejected the earlier rapidly cycling sequence. The
latest owner decision also rejects translating or borrowing a school day for convenient
after-hours review. The runner must resolve the current date in Cambridge's configured
timezone, use only that date's calendar-approved effective schedule, and map each phase
to its actual campus-local instant. It may remain online while paused, but weekends,
holidays, closures, empty effective schedules and time before the first or after the last effective slot
must expose zero synthetic actors and execute zero synthetic actions. Restarting during
the day must not catch up an already-expired action, and institution-local date rollover
must resolve the new calendar day rather than wrap or replay the prior one.

The runner uses existing authenticated demo identities and ordinary domain
APIs. Accepted/refused outcomes therefore pass through current authorization,
invariants, idempotency, audit/outbox and live-update paths instead of a direct
database or frontend-fixture shortcut. All Cambridge fixture people may appear in the
read-only development routine, but a planned marker remains **expected**; it is never
presented as an observed physical location without source-bearing domain evidence.
People without an acting demo account do not sign material commands through hidden
impersonation.

This harness is not the Model Core what-if/scenario runtime. It may mutate only the
disposable local Cambridge fixture through normal APIs, uses the real wall clock and
is excluded from production artifacts. At this checkpoint the scenario runtime remained
separately
gated by an isolated namespace, virtual clock, deterministic seed, snapshot/fake
domain executors, sink-only delivery and zero production mutation/contact. The Model
Core `ExecutionContext` simulation/rehearsal/replay seam therefore remains
unimplemented at this checkpoint. That historical gap is superseded by the transient
scenario slice recorded below and in `CAMPUS_SCENARIO_SIMULATION.md`; Campus Lab and
scenario execution remain separate facilities.

The first local runner slice is implemented. `devtools/campus-simulator/` contains the
standalone wall-clock runner and versioned Cambridge behaviour fixture;
`frontend/src/dev/campus-lab/` contains only the development-only status/overlay
adapter; and the managed preview starts the runner on loopback and exposes its status
only through an ephemeral-key same-origin development proxy. Campus View itself has
moved to permanent production feature code as recorded above. The synthetic adapter
is reachable only in a Vite development build and exposes no time or playback controls.

The earlier runner replaced the rejected fixed short cycle with a
timetable-derived 1:1 routine, but it selected another published weekday when needed
and anchored that day's first instant to process start. That behavior is now explicitly
retired. The corrected runner now obtains the current
institution-local date, instructional/closure context and effective daily schedule
from the ordinary calendar/day-plan domain API; retains actual lesson, break and
uncovered-gap instants; and fails closed outside the first/last effective-slot school
window. A development-only
**Rehearsal now** indication may appear beside the matching row in the normal
timetable only while the live current date and exact effective slot identity also
match Campus View. Timetable/calendar source-revision parity remains a hardening gate
until the source API supplies and the status contract exposes those revisions
explicitly.
This is an additive presentation overlay only: normal pages still fetch the
authoritative timetable API, published times and row state stay unchanged, and runner
status is not written to domain records or injected into the domain query cache. The
indication and its status client must remain absent from production artifacts.

The development-only timetable indication now reaches the normal principal, teacher,
learner and guardian timetable routes through one shared Campus Lab projection. An
explicit URL date always wins. During an active school window, the current
institution-local date may supply the labelled simulated-current instant; while the
runner is paused it must not navigate any role to another weekday/date or highlight a
synthetic current period. Teacher rows use the exact active effective-slot identifier,
while learner and family bell/current/next calculations use that same real
campus-local instant. Every strip is explicitly **Read-only**. Authoritative timetable queries, published times, API
`context.today`, coverage eligibility and attendance mutations remain unchanged; the
rehearsal projection is not written into a domain cache or record. Production routes
retain their full components and load these wrappers only through `import.meta.env.DEV`
guards.

Verified locally for this cross-role display slice: 19 focused timetable/rehearsal
tests passed across projection-date precedence, principal mapping, teacher active-row
state, learner/family bell state and shared presentation; the three production
simulator-exclusion tests passed; focused lint passed; and the production Vite bundle
completed without Campus Lab route chunks. The full TypeScript command remains blocked
only by the unrelated duplicate test artifacts recorded below.

Verified locally for the real school-day/window correction: the runner suite passes
18/18 across the current institution date, exact effective-slot instants, explicit
calendar closure, all-slots-cancelled closure, no-schedule Sunday, configured Saturday,
before/after-hours zero-presence state, action-phase bounds, midday restart suppression
and institution-date rollover. The focused development-presentation suite passes 8/8:
a paused or closed runner cannot drive normal principal, teacher, learner or family
timetable dates, clocks, bells or active-row state, and Campus View retains its
source-backed map while showing a neutral paused badge with no simulated people. The
three production-exclusion checks pass. At 20:30 IST the managed local and Cloudflare
status endpoints both reported `paused`, `after-school-hours`, current date
`2026-10-16`, source `effective_school_schedule`, zero actors and zero synthetic phase
activity; both readiness endpoints were healthy. This is local/preview evidence, not a
managed deployment or owner-device acceptance claim.

Retained local evidence predating the latest school-day/window correction:

- runner tests pass 8/8 across published-slot timing, retained gaps/breaks, one-shot
  completion, safety gates and the protected status surface; these tests did not prove
  current-date selection or off-hours/closure suppression and are superseded by the
  corrected 18/18 runner evidence above;
- focused frontend tests pass across projection-date precedence, exact principal and
  teacher slot matching, learner/family bell state, normal current-timetable parity,
  shared presentation and event-driven role-projection invalidation;
- the production simulator-exclusion checks and production Vite bundle pass without
  Campus Lab route chunks; and
- the managed local and Cloudflare readiness endpoints returned successfully, but the
  observed 221-person after-hours routine exposed the contract gap corrected above;
  it is not acceptance evidence for the new timing rule.

Earlier evidence remains useful only for the retained safety,
ordinary-domain-action and production-exclusion boundaries:

- focused runner tests pass 6/6 for wall-clock phase progression, all-person expected
  projection, safe development gates, production/managed-host/connector refusal,
  private Cambridge API verification and protected read-only status;
- the earlier card-grid scene and its test were retired when the permanent Canvas
  Campus View replaced that development UI; current evidence is recorded above;
- the live routine recorded a teacher-to-family chat, principal acknowledgement
  notice, family acknowledgement and 25-student Class 6A attendance through the
  ordinary application APIs; the feed links each accepted result back to its normal
  domain screen. This proves the retained API path only, not that those actions were
  scheduled within a valid school window;
- the local and Cloudflare readiness and Campus Lab status endpoints return
  successfully;
- focused release/exclusion tests pass 13/13; the permanent Campus View is expected in
  production while the synthetic adapter/status client and simulator markers remain
  excluded. The production Docker context ignores `devtools/`, and the release
  contract rejects simulator environment variables.

The full frontend TypeScript command remains blocked by unrelated duplicate
`* 2.tsx`/`* 3.tsx` files already present in the shared dirty checkout. Those files
were not changed or removed by this slice. The focused TypeScript check and production
bundle complete successfully.

Remaining acceptance before the harness itself is marked complete:

- expose and verify the published source revision in the source API/status contract,
  then prove Campus View and every development timetable indication resolve the same
  calendar/effective-schedule revision, current date and slot identity;
- retain regression coverage proving that cross-role rehearsal indication cannot
  mutate timetable/domain caches, records or API-controlled action eligibility;
- add durable action receipts and restart/idempotency coverage rather than relying on
  one-process action memory;
- add explicit refused/conflicted/unavailable domain-outcome tests and connector
  spies, while retaining the already verified fail-closed connector gate;
- complete automated 320/390px overflow, sheet focus-return and reduced-motion checks;
- verify production-mode route/proxy absence and final container image contents in
  addition to the completed source-context, release-contract and frontend-bundle
  checks;
- owner review through the managed local/Cloudflare preview.

External Telegram/email/SMS/payment/model providers, physical observations and
non-Cambridge institutions remain out of scope for Campus Lab. This historical
checkpoint does not claim scenario-runtime evidence; the later isolated scenario
slice below records its own implementation and acceptance limits.

The Campus Lab activity projection now uses the versioned Cambridge v6 behaviour
fixture. During an open school window it reconstructs a bounded expected-only receipt
for each already-started effective timetable phase, so joining the local preview at
mid-day shows the school-day sequence without replaying any missed material command.
Current class entries name the class, subject and expected teacher, remain explicitly
simulated, and carry `planned_rehearsal_only` / `spatial_evidence=false`. Accepted
ordinary-domain rehearsal actions carry `domain_record_only` /
`spatial_evidence=false`; neither category increments a physical room-evidence count.
The same fixture now maps exact non-teaching designations and the representative demo
administrator to stable configured space codes for expected duty positions; missing
codes remain unplaced rather than falling back to a staff home space or the first
available office. Expected actor and zone markers expose their development source
label/version and current phase validity bounds; these remain planning provenance,
not physical evidence.

The Cambridge source fixture has also been upgraded in place to
`cambridge-campus-replica.v1`. Its guarded, explicit-opt-in seed now provides 36
connected spaces across academic, administration/student-services, community,
arrival and outdoor zones; eight class home rooms; specialist learning, wellbeing,
staff, dining, gate, transport and sports locations; four bounded resource holdings;
and 11 wholly synthetic non-teaching operational staff profiles with current campus
assignments and existing-contract duties. It does not create acting accounts for
those people or turn their planned home space into presence evidence. Stable fixture
IDs and conflict guards allow the existing local database to upgrade without a full
medium-school reset; two consecutive verification runs produced zero new spaces,
resources, staff, assignments, duties or orphan people on the second run. The
authenticated institution-setup projection returned 36 active spaces, 28 staff, all
28 staff campus-assigned, all eight classes with home rooms, and the four seeded
resource holdings. Focused fixture tests pass 5/5; backend lint and typecheck pass.
This is local synthetic-fixture evidence, not production seed behaviour or owner UI
acceptance.
Focused Campus Lab verification passes 24/24 tests, including open/closed windows,
phase receipts, configuration-only staff and administrator placement, missing-space
fail-closed behavior, no catch-up, synthetic staff reactions, evidence scope and the
protected loopback status server.

### Model-mediated workflow gap - 16 October 2026

The current core foundation registers identities, authority, temporal plans,
observations, commands and outcomes, but several existing workflows still execute
entirely inside their domain service and only notify or project afterward. Staff leave
and coverage are a concrete example: they have strong typed records, revision checks,
audits, outbox events, attention and Operating-rule fallbacks, but their human actions
do not yet enter through a stable model-agent command and approved leave/substitution
does not yet supersede the affected temporal occurrences in the model.

Do not call such workflows fully digital-twin-driven. Horizontal migrations must wrap
the existing domain command—not duplicate it—so actor identity, authority, causation,
rule version, domain outcome and next-agent ownership are recorded atomically or by a
durable idempotent bridge. First priority is staff leave -> authorized decision ->
coverage hand-off -> accepted substitution/fallback -> effective timetable context,
because it exercises human-to-human coordination without weakening the existing
leave, staffing or timetable invariants.

The first bounded coordination-runtime foundation is now implemented locally in
migration 106 and the provider-neutral `CoordinationRuntimePort`. It retains approved
behaviour versions and exact event subscriptions, verifies every accepted source
outbox event, creates idempotent per-recipient reactions and typed operational
messages, keeps queued/delivered/acknowledged/responded/expired/cancelled/dead-letter
states distinct, and records a visible unmatched exception when configuration or
authority is absent. It installs no behaviour, subscription, role or fallback. Public
ports use domain-facing agent references rather than private core IDs; human
resolution requires active institution membership and current configured capability.
Team routing deliberately fails closed until dated membership and claim semantics
exist.

Migration 107 now makes a human agent stable by institution person rather than login.
It backfills only explicit student, guardian, staff and governance relationships,
adds dated account/external-channel endpoints and audited idempotent endpoint
close/revoke/replace operations, and preserves the originally addressed recipient on
coordination replay. Exact replay cannot reactivate a suspended or revoked endpoint.
The Core no longer creates a missing People identity lazily: an unlinked account fails
closed until the owning Auth/People workflow supplies the explicit relation. The
remaining identity gates are that Auth/People onboarding and live Agent Channels
link/revoke changes do not yet publish through this lifecycle, dated team membership
is absent, and a purpose-specific identity-management authority is not yet exposed.

This is not yet a full agent runtime. The first bounded, domain-owned staff-leave
bridge is now implemented locally through migration 108 and
`StaffLeaveModelBridgeService`. Submission resolves the exact effective
`staff_leave_decision` officeholder, commits the authoritative leave request, domain
outbox event, configured core event and exactly one durable Request in the same
transaction, and rolls the transaction back if authority or approved routing is
missing or ambiguous. The core payload excludes the private leave reason and handover
note. The exact decision owner is rechecked at execution time, including a locked
current capability grant, and the decision, response and outcome share retained
correlation/causation evidence. Command receipts and outbox collision checks preserve
actor-scoped idempotent retries. Staff Operations and Requests expose private leave
text only to the requester or exact current decision owner; technical administrators
do not inherit review access merely from the admin role. The original requester can
cancel the exact durable Request after the decision route changes or disappears.

Staff leave and coverage are now partially model-mediated, but this remains a bounded
segment rather than the complete configured workflow. Submission and decision retain
the exact configured decision-owner Request trace. For a schedule-backed coverage
task, the offered staff member's replay-safe acceptance records the authoritative
Staff substitution and outbox evidence and invokes the Model Core temporal port in
the same transaction. The effective schedule keeps planned teaching separate from
operational staffing: while approved leave is effective it exposes either the exact
valid accepted replacement or an explicit unassigned occurrence, never the absent
planned teacher. This is plan and responsibility truth, not evidence that the lesson
was physically delivered.

Approve/reject still fails closed if the governance officeholder changes after
submission; configured rerouting and transfer evidence are not yet implemented.
Coverage-task creation and manual assignment remain domain-owned. Migration 116 and
`StaffCoverageOfferBridgeService` now provide the first bounded automatic route: an
exact approved `staff.coverage.opened` subscription configures candidate strategy,
capability/scope and response timing; Staff Operations deterministically filters real
active staff against effective schedules and approved leave; and one exact typed
Offer, route snapshot and task revision are committed atomically. Missing, ambiguous
or invalid automation configuration is retained as a visible domain exception while
the existing explicit administrator assignment path remains available. A configured
recipient response is bound to the exact current Offer, teacher, task revision and
deadline before delegating to the existing authoritative accept/decline path. Later
rounds, expiry workers, escalation/fallback execution and administration UI remain
open. A role-neutral `/work/staff-leave`
action surface reuses the domain review card for either a staff or admin officeholder
and fails closed unless the workspace confirms current decision authority.
Owner-device acceptance remains open. The runtime also has no administration API,
filter language, durable lease/retry worker, mailbox query or channel-delivery
adapter. Existing domain outbox events, notifications, Requests and AI/channel
transcripts remain adapters, not substitutes for the spine. Leave, staffing and
timetable records stay authoritative throughout.

The second bounded coordination segment now connects existing transport-duty cover
and exchange operations through migration 109 and
`TransportDutyModelBridgeService`. It does not introduce a parallel transport
workflow or new UI. The assigned collector's replay-safe command creates the
authoritative domain request and one private typed Offer for the explicitly selected
colleague. A rejection closes that Offer without creating school work. An acceptance
records the exact Offer response and creates one typed Request for the effective
`transport_duty_change_decision` officeholder; unrelated administrators do not receive
the actionable notification or Requests item. The officeholder's replay-safe decision
is bound to that exact Request and the existing transport transaction changes both
trip assignments for an exchange, or neither.

The transport adapter rechecks current human-agent capability, governance authority,
message recipient, trip/offer revisions, assignees, duty conflicts and the configured
journey window. Private request reasons and response/decision notes remain in the
authorized transport domain; the core retains identifiers, revisions, route-to-action
and minimum explanation only. The existing Teacher Transport and Principal Transport
& departure screens remain the sole action surfaces and now retain a command identity
across a mobile reload or ambiguous network response. The resulting assignment is a
plan/responsibility fact only; it is not evidence of trip start, vehicle movement,
boarding, learner location or physical handover.

This transport segment is also bounded. The Cambridge behaviour, capability and
governance configuration is an explicit guarded demo seed, not a production default.
There is no administration UI for activating or rehearsing those versions, and a
changed colleague or officeholder fails closed rather than silently inheriting an old
Offer/Request. Missing routing rolls back the domain command safely, but the resulting
configuration exception is not yet retained outside that rolled-back transaction.
Physical transport observations and handover evidence remain separate later slices.

Verified local evidence for the transport-duty segment: backend build and focused
lint pass; 42 focused backend coordination, governance, Requests, idempotency and seed
contract tests pass; and 26 focused frontend transport/leave retry tests pass with
focused lint. In a disposable PostgreSQL clone of the full local database, migrations
106 through 109 applied transactionally and the transport lifecycle passed 24/24
integration tests, including exact command replay, stale-offer rejection and atomic
exchange rollback. The guarded transport demo seed ran twice without duplication and
retained one decision rule, two exact event subscriptions and 20 explicitly linked
demo response/decision authorities. The disposable databases were dropped and the
shared local database remained at migration 105. This evidence proves the bounded
software path; it does not constitute physical transport acceptance or production
behaviour-configuration readiness.

Verified local evidence for this bounded foundation: backend build and targeted ESLint
pass; 32 focused coordination/core/migration tests pass; migration 106 passed
transaction-only PostgreSQL validation and was rolled back rather than applied. The
tests verify no installed default behaviour, explicit recipient selection, current
authority checks, idempotency evidence, distinct message states and fail-closed team
queues. Runtime domain integration and physical operator acceptance remain open.

Verified local evidence for the staff-leave segment: backend build and focused ESLint
pass; 92 focused backend contract tests pass, with the four database-only governance
tests skipped in the ordinary no-test-database run. Thirty focused frontend route,
authority, reload/retry and idempotency tests pass with focused lint. In a separate
loopback-only disposable PostgreSQL database, migrations 106, 107 and 108 applied
transactionally; governance authority passed 4/4 integration tests, Staff Operations
passed 12/12 integration tests, and the real identity service passed link, resolve,
revoke, exact-replay and inactive-resolution checks. The disposable database was
dropped and the shared development database remained unmigrated. This proves the
bounded software trace, not physical operator acceptance or full MC-2 completion.

The same gap applies to behaviour configuration: current domain services contain a
mixture of explicit Operating rules and code-owned workflow routing. Phase 3 must
introduce a validated `behaviourVersion` contract before any new reactive automation
is called agentic. The first migrated workflow must demonstrate that recipients,
timing, fallback and autonomy change through an approved configuration version, that
the reaction evidence retains that version, and that removing the active version
fails closed. Existing domain invariants remain in code and are not made
administrator-editable.

### Delivery-shape decision - 16 October 2026

Digital-twin delivery must proceed as useful horizontal campus workflows rather than
an infrastructure spear that repeatedly deepens one adapter or one core abstraction.
After a minimum contract exists, each substantial slice should cross the necessary
plan, observation, accepted-domain, authorization, explanation, correction and UI
boundaries far enough to reduce real operator burden. This does not weaken domain
ownership or justify a generic control panel. It prevents model infrastructure from
growing without a domain-language use path that administrators can validate.

### Accepted temporal-runtime direction - 16 October 2026

The next core foundation is an event-derived temporal runtime, not another setup or
domain UI. Versioned timetable definitions and concrete dated occurrences become
first-class model contexts. Published schedules establish expected state and may
trigger versioned Operating rules; human/device/integration captures establish
observed evidence; owning domains establish accepted decisions; rebuildable
projections may expose bounded inferences with provenance, freshness and uncertainty.

In particular, a timetable may place a teacher in Room 201 and a gate reader may
observe a valid campus check-in, but the combination does not prove that the teacher
is physically in Room 201. The context resolver must report expected, observed,
accepted and inferred dimensions separately, expire stale evidence and surface
contradictions as owned work. Missing observations never become absence. Commands and
delivery outcomes never become evidence of physical execution without a later
observation or explicit owning-domain decision.

Before connecting further domains, implement and verify the Phase 2A contracts in
`CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md`: typed event/effective/recorded time,
schedule occurrence identity, supersession lineage, idempotent replay, `asOf` context
resolution and source-backed state assertions. This is target architecture only at
this checkpoint.

The temporal implementation slices are now present locally on the digital-twin branch.
Migration `104_campus_model_temporal_runtime.sql` adds a private, tenant-constrained
event journal and rebuildable schedule-occurrence projection. Schedule publication
uses `TemporalContextPort` in the same database transaction to register the schedule,
period and related identities, retain an idempotent plan event, and expand expected
occurrences in the institution timezone. A typed `resolveAt` query returns planned
context with source, revision, valid interval and recording time for a human agent or
connected entity. Existing published schedules are backfilled without creating
attendance or location observations. Calendar-closure creation and removal and daily
plan publication now use the same port in their owning transactions. Closures cancel
matching expectations without erasing history; closure removal restores only
unblocked expectations; and a published daily plan supersedes recurring occurrences
for the same class/date with explicit dated replacements. Migration
`105_campus_model_gate_observations.sql` connects accepted gate movements to the
immutable observation spine, backfills retained gate history with honest import
provenance, and adds context-time lookup support. New gate movements record their
normalized observation in the same transaction as the owning gate event. The
observation envelope now supports identified human, device and integration capture
agents; this is an internal contract and does not yet expose an unauthenticated device
or biometric ingestion endpoint. Entity `resolveAt` results may contain both expected
schedule assertions and direct observations, whose freshness is explicitly
`point_in_time` so a gate entry is not presented as continuous location truth.
The first horizontal consumer is included in the existing Campus setup workspace:
current timetable occurrences and enrollment are cross-checked with the latest
accepted same-day gate movement and accepted attendance evidence. Only explicit exit
evidence can create a signal. A present/late observation recorded after that exit is
routed to Attendance; otherwise the expected-after-exit cross-check is routed to
Gate. The UI calls these **Signals to review**, explains that no attendance or absence
decision is made automatically, and stays hidden when there is nothing to review.

The next horizontal slice adds an administrator-owned **Devices & connections**
lifecycle to Campus setup. A device or software connector must be registered with
a stable source ID, narrow observation capabilities and an institution, campus or
space scope before the model core will accept its evidence. Observation ingress no
longer creates an active external actor merely because an unknown `external_ref`
appears. It resolves a current active authority, checks the requested source type and
connected scope, and rejects unknown, suspended, revoked or out-of-scope sources.
Device and integration evidence cannot enter as accepted truth; it remains pending
until the owning attendance or gate workflow reviews it.

Administrators can pause and resume a source immediately or revoke it permanently.
Registration and lifecycle changes are transactionally audited and published through
the setup outbox; each authority retains the then-current institution Operating-rules
revision as provenance. Revocation closes current grants and is intentionally
irreversible for that source identity. This slice does not expose a public device
ingestion endpoint, issue provider credentials, or claim that a camera/biometric
adapter is production-ready.

Verified evidence: backend build and focused lint pass; 20 focused core/migration
contract tests pass; migration 104 completes under transaction validation and is
applied to the loopback development database; a disposable runtime verification
verified the full recurring expectation → closure cancellation → closure removal
restoration → daily-plan supersession/replacement sequence, then resolved the dated
replacement from its retained `timetable.day_plan_published` source and removed the
fixture. Migration 105 is applied to the loopback development database and normalized
9,429 retained gate events. A direct resolver verification returned the latest gate
evidence as an `accepted` / `point_in_time` assertion from `gate.movement`. The current
local database contained no pre-existing published recurring versions to backfill.
Authenticated external device adapters, freshness rules, contradiction ownership,
movement inference and campus-wide replay remain open and must not be represented as
implemented.

Horizontal-slice verification: a disposable, rolled-back runtime fixture joined a
current Mathematics occurrence, active enrollment, accepted gate exit and later
accepted present observation into exactly one Attendance-owned
`attendance_after_exit` signal. Three focused Campus setup UI tests pass, including
the no-automatic-conclusion copy. The focused frontend test is green; the full
frontend TypeScript build remains blocked by unrelated duplicate untracked test files
with names ending in ` 2.tsx` / ` 3.tsx`, which are outside this slice and were not
modified or deleted.

### Effective schedule lineage and staff-cover convergence — 16 October 2026 (local)

Migrations `111_campus_model_temporal_schedule_lineage.sql` through
`114_campus_model_substitution_cancellation_lineage.sql` extend the temporal runtime
without replacing the timetable, daily-plan, calendar or Staff domains. A logical
dated occurrence now has append-only recorded-time revisions and a stable journal
cursor. Its plan basis, later change and applicable condition remain separate, and
`resolveAt(at, recordedAsOf)` returns both logical-occurrence and revision identities
with basis/change/condition provenance. No schedule assertion is physical-presence
evidence.

The shared schedule resolver now separates the original planned occurrence from its
effective staffing. Exact accepted cover retains the source kind, source record and
revision, occurrence key, original teacher, replacement, task revision, accepting
actor and authoritative outbox event. Every role-facing timetable consumer continues
to read the shared effective schedule: approved leave with no valid accepted
replacement is shown as unassigned, while a valid accepted replacement is the
effective teacher with an explanation reference. A later account or membership
change does not rewrite elapsed accepted cover.

Acceptance rechecks the offered recipient, approved-leave source, exact current
schedule occurrence and overlapping work under the shared schedule lock. The Staff
task, audit, substitution, command receipt and domain event are committed with the
Model Core `timetable.substitution_effective` decision or all roll back. Schedule or
daily-plan publication, calendar-closure changes, legacy timetable mutations and
staff-membership deactivation call a narrow Staff-owned reconciliation port in their
own transaction. Reconciliation retains the old substitution as history, closes the
invalid task decision, creates a new linked obligation when approved leave still
requires cover, emits exact non-duplicated domain evidence and records a causally
linked Model Core cancellation. Replacement loss leaves the occurrence explicitly
unassigned; removal of the leave obligation restores the original teacher; a newer
schedule source remains untouched.

The retained accepted-cover bootstrap is also a separate typed Staff-domain
preparation port, so schedule owners can establish missing model lineage before they
change authoritative source truth. A non-instructional calendar closure is a
temporary condition: it hides the occurrence for that day but does not supersede an
accepted substitution, which can become effective again after the closure is
removed. Prospective reconciliation considers only tasks still in `accepted` state;
`completed` cover is elapsed evidence and is never rewritten by this reconciler.
Moving a replacement profile from `active` back to onboarding now prepares and
reconciles its future effective substitutions under the school schedule lock, and
retains the shared correlation plus preparation/reconciliation receipts in the Staff
audit.

Verified locally at this checkpoint: the backend build, full backend typecheck and
focused lint pass; 47 focused lineage/provenance/substitution/bootstrap/Campus View
contract tests pass; and migrations `111`–`114` apply on a fresh disposable
PostgreSQL clone. The Staff Operations PostgreSQL suite passes 15/15, including exact
acceptance replay, wrong-actor rejection, linked-task uniqueness after cancellation,
future substitute deactivation through onboarding, temporary-closure retention,
completed-cover immutability, and preservation of past accepted cover. Day Plans
passes 19/19 and Schedule Planning passes 10/10 on the disposable clone. The dated
assignment authorization regression proves that a pending coverage recipient cannot
inherit attendance, photo, messaging or follow-up class authority before acceptance,
and that declining later revokes the accepted date-scoped access.

Retained accepted substitutions without a live command receipt now enter through a
narrow recovery bridge before reconciliation. The bridge resolves exact planned or
retained source evidence, emits one deterministic empty-audience/non-notifying import
event, requires an active importing operator, resolves the historical accepter and
teachers only from retained People/endpoint identity, and invokes the typed temporal
port. It never manufactures a teacher command, authority grant or notification, and
fails closed on identity, source or idempotency mismatch. Five focused bridge tests
and the disposable database suites above verify this path. Configured
cover-recipient selection, Offer routing, expiry, escalation and fallback remain open
MC-2 work. No hosted deployment or owner-device acceptance is claimed.

## Active delivery: connected student lifecycle — 16 October 2026 (local)

The first connected-student lifecycle slice extends the existing student profile rather than creating
another roster or administration module. An authorized `sis.manage` operator can review and apply one
of three same-day decisions: move the student to another class in the current term, withdraw the
student, or record a transfer to another institution. Next-term bulk progression remains owned by the
existing **Promote class** workflow.

The data model now retains inactive enrollment rows and enforces uniqueness only for the current
active student/term placement and active class roll number. A short-lived review command freezes the
expected enrollment and revision, effective date, reason and calculated impact. Commit serializes the
student boundary and rejects expired, stale, cross-tenant, conflicting-roll and final-register changes.
Class movement creates a new active placement; withdrawal and transfer-out leave no active placement.
None of the paths deletes the student identity, guardian relationships, attendance, assessments, fees,
transport or departure history.

Routine propagation is automatic after the human decision: affected submitted attendance registers
return to Draft with roster-change audit entries, destination subject-attendance rows are seeded, the
decision is audited with its reviewed impact, and a scoped `people.updated` outbox event refreshes
authorized principal, teacher, guardian, transport and departure consumers. Final attendance registers
remain an explicit blocker. This follows the operating-rule automation principle: software performs
bounded mechanical propagation, while the consequential enrollment decision is never inferred.

The student profile adds one compact current-placement card, a three-choice progressive change flow,
an impact confirmation, and expandable enrollment history. The UI keeps the established ThatCampus
tokens, shared page shell and mobile hierarchy; it does not introduce a competing student workspace.
Detailed contract and boundaries: [Connected student lifecycle](STUDENT_ENROLLMENT_LIFECYCLE.md).

Verified locally: backend TypeScript build and lint pass; the Vite production bundle passes; focused
student-directory/lifecycle coverage passes **7/7**. Migration 100 was applied transactionally to the
loopback-only preview database and all **3/3** PostgreSQL lifecycle scenarios pass, covering idempotent
movement, preserved history, register reopening, audit/outbox, transfer-out and stale-decision rejection.
The ordinary migration runner remains blocked by the pre-existing migration 047 checksum drift, so the
reviewed migration and its checksum were recorded directly in the local ledger. The managed preview is
healthy. A task-scoped mobile preview is available at
`https://shore-brandon-obligations-researchers.trycloudflare.com`; physical phone review and deployment
remain open release evidence.

## Active delivery: one principal timetable — 14 October 2026

User decision: end the Timetable / Calendar / Planner comparison and keep one principal-facing
planning concept. **Timetable** is now the canonical browsing destination because it is the familiar
school term and the blueprint already assigns it ownership of classes, rooms, staff allocation and
conflict-aware scheduling. Calendar is a view of that timetable, not a peer module; Planner was the
interaction experiment, not a lasting product label.

- `/principal/timetable` now presents the retained planner interaction with Day, Week and Month views.
  Month contains school dates, closures and events, so the separate Calendar decision block is gone.
  The previous preview/current switch, explanatory preview card and redundant colour key were removed.
- The screen has one compact view switch, one class scope and one **New** menu. The later UX refinement
  below moves recurring lesson editing and publication into calendar sheets. **Academic settings** now
  holds term/year preparation, holidays and teaching-time targets. One-day changes still open the dated-plan editor, while recurring classes,
  events and closures continue to write through their existing authoritative APIs and review rules.
- Existing `/principal/calendar` and `/principal/planner` links redirect to the canonical Timetable while
  preserving date, class, view and typed attention parameters. Calendar links default to Month. Calendar
  attention acknowledgement is evaluated inside the retained Timetable, and event creation returns there.
  Search and More now use the single Timetable name; School calendar search opens its Month view.
- No timetable, event or school-calendar data was migrated or duplicated. Teacher, parent and student
  reading experiences are unchanged in this slice.

The retained Day and Week surfaces now use FullCalendar v7's MIT-licensed React time-grid rather than
another bespoke positioning engine. Lesson and event blocks are placed and sized by their real start and
end times, the current day has a live time indicator, empty time can be selected by click, drag or touch,
and the week remains horizontally navigable at phone widths. Selecting free time opens one compact
planning sheet with the date and time already filled. Recurring classes can be composed without leaving
the timetable; event and one-day-change choices continue into their existing authoritative editors.

An in-range timetable draft is projected into the same calendar instead of a separate preview mode.
Draft lessons can be moved or resized in place and save through the existing versioned timetable API;
editing a published lesson prepares a future draft through the same API, while dragging remains scoped
to existing drafts. The month grid remains the better density for long-range browsing, but its
selected-day detail now uses the same proportional day timeline.

Verified locally: 94 focused timetable, calendar-attention, event-navigation, More and hierarchy tests
pass; changed files pass focused ESLint; the Vite production bundle succeeds. The authenticated mobile
preview was checked in Week and Month, including the canonical Calendar redirect, with no runtime error
or horizontal page overflow observed. The repository-wide TypeScript build remains blocked only by the
preserved, unrelated untracked duplicate `* 2.tsx` tests. No cloud deployment or database migration was
performed. Physical-phone acceptance remains requested.

Additional timeline verification: the focused planner suite passes **5/5**, the changed planner files pass
focused ESLint, and the Vite production build succeeds. The authenticated mobile preview was exercised in
Day and Week, including free-time selection, recurring-class prefill and the touch-sized planning sheet.
FullCalendar is lazy-loaded with the principal timetable route; its route chunk is approximately 89 kB
gzip. The optional local photo-attendance sidecar still lacks `psycopg` and is unrelated to this slice.

### Calendar interaction and visual refinement — 14 October 2026

The user's phone screenshots rejected the initial library skin and the remaining duplicate class editor.
The recurring timetable now has one principal-facing editing surface:

- New and Academic settings live in the shared page header. Selecting a lesson opens a native modal
  sheet with its time, teacher, room and recurrence; **Edit recurring class** edits it in that sheet.
  Selecting free time opens the small creation menu with the selected date/time and class preserved.
- A class draft has one contextual review control. Dates and publication are reviewed over the calendar,
  using the existing revision-checked save/publish commands. No school timetable was published during
  visual verification. Published-lesson edits create future drafts; matching copied lesson IDs uses the
  original weekday, period number, subject and start time, not subject alone.
- Academic settings no longer lists a second set of class timetable editors. Old pattern links redirect
  to the calendar with class/date/period or review context. Unavailable period links show an explicit
  state instead of selecting a different lesson. Annual setup and coverage configuration remain there.
- Phone Week view uses a compact seven-day strip with a full-width proportional timeline for the chosen
  day. Larger screens retain the seven-column week. Blue lesson blocks have dark readable text; breaks
  use a quiet neutral fill. Details are shown on demand. Short blocks retain their title without clipped
  text. The current-time marker and selected-day treatment use the established brand/severity colours.
- Styling now uses FullCalendar v7 public class hooks and theme variables. The previous v6-style selectors
  did not match v7's generated classes, which caused the default dark blocks and inconsistent spacing.

Verification: 32 focused planner, draft, navigation and event-return tests pass across the final runs;
changed files pass focused ESLint and the production Vite bundle builds. Browser inspection covered
320, 390, 768, 1024 and 1440 CSS-pixel widths, with document width equal to viewport width; calendar-only
overflow at narrower tablet widths remains intentional. Lesson details/editing, free-slot selection,
publication review and the live current-time line were visually checked. Repository-wide TypeScript
checking still reports the pre-existing unrelated duplicate `* 2.tsx` test matcher errors; no new planner
type errors were reported. The managed local preview remains available. No cloud deployment was performed.

Design references: [Teams calendar interaction](https://support.microsoft.com/en-us/teams/meetings/get-started-with-the-microsoft-teams-calendar)
and [FullCalendar v7 styling API](https://fullcalendar.io/docs/css-customization). Physical-phone review
is still required; these local checks do not claim school acceptance or complete release readiness.

## Superseded comparison record: unified planning preview — 14 October 2026

A second, explicitly labelled **Planner preview** was implemented locally for principal review without
replacing the current Timetable, Calendar or Schedule settings experience. A top-level comparison
control switches between the current experience and `/principal/planner`; it preserves date, class and
the originating current view so the trial does not introduce a second navigation hierarchy.

The preview follows the interaction rhythm of a modern work calendar while retaining ThatCampus's
existing visual tokens and domain boundaries:

- Day, week and month views project the authoritative dated timetable versions, legacy weekly
  baseline where no dated version applies, school closures and campus events. The all-class week
  overview groups lessons by period to prevent a forty-register school from rendering hundreds of
  competing cards; selecting a class reveals the individual lessons.
- One **New** menu is the only creation entry point in the preview. Its templates distinguish a
  recurring class, an event/activity, a holiday/closure and a one-day change. This is progressive
  disclosure, not four permanently competing action bars.
- Recurring class creation writes to the existing versioned timetable draft API and requires the
  established publish review before becoming live. Event creation opens the canonical event editor
  with the chosen date/time prefilled and a safe return to the planner. Holidays reuse the existing
  audited closure command and editor. A one-day change opens the existing dated day-plan workflow.
  No second scheduling store, event store, permission path or approval engine was added.
- The comparison UI described below has now been removed by the decision above. Its data ownership
  remains valid: removing the preview did not orphan records because all writes belonged to the
  authoritative domains.

Verified locally: the focused planner, comparison-navigation and event-return coverage passes **9/9**;
changed files pass focused ESLint; the Vite production bundle succeeds. Repository-wide TypeScript
checking remains blocked only by the preserved, unrelated untracked duplicate `* 2.tsx` tests already
recorded above. The authenticated managed preview was inspected at the mobile breakpoint in week and
month views, including the grouped all-class overview and recurring-class composer. The core preview
is running; its optional photo-attendance sidecar currently lacks the local `psycopg` package and is
not part of this planning slice. This was the evidence used for the consolidation decision recorded
above. No cloud deployment or database migration was performed for this comparison slice.

## Active delivery: cross-app behaviour consolidation — 13 October 2026

The first two locally implemented slices of the cross-app consistency audit reduce overlapping
navigation concepts without changing domain authority. The AI destination is now named
**Assistant** in navigation, compact controls, the full-page header and history controls;
person-to-person communication remains **Messages**. Student and teacher More catalogues no
longer repeat their primary Attendance and Timetable destinations, while those destinations remain
directly available in bottom navigation and searchable from More. Parent, student, teacher and
principal transport catalogue labels now use the stable domain name **Transport & departure**.

Pro-off presentation now hides Assistant memory as well as assistant navigation and direct routes.
The Student More catalogue no longer exposes a separate Attendance Copilot tile; contextual
attendance help remains inside Attendance when Pro is enabled. Duplicate page-level H1s were
removed from student Home, notice detail and teacher-feedback content so the shared portal app bar
is the single page-title owner.

The leave-cover operating rule now has one fallback meaning rather than an independently editable
type and label. The UI sends the canonical display label for the chosen fallback and the service
derives it again before persistence, preventing contradictory combinations from old or external
clients. The form now reports successful persistence. Focused frontend coverage passes 38 tests
across Assistant, More, account profile, transport and staff operating rules; the changed frontend
files pass ESLint. Backend typecheck, build and targeted lint pass. Full frontend typecheck/build
remain blocked by preserved, untracked duplicate `* 2.tsx` files that TypeScript includes; this is
pre-existing workspace state and those files were not removed or edited. Phone review and cloud
deployment remain pending.

The authoritative class-test ownership slice is now locally implemented. New class tests are
planned in Assessments, not Campus events: an assigned subject teacher may create only a draft
class test for the same class, subject and effective assignment dates; the teacher remains the
examiner, an active school administrator is selected as the independent reviewer, and principal
scheduling remains the release gate. That scheduling transaction serializes the class boundary and
rechecks the future instructional day, effective subject period, same-day duration and conflicts
with already scheduled assessments or published events. The Events screen links to this workflow, its teacher-facing
name is now Events & activities, and the campus-event API rejects every new `class_test` creation.
Existing event-based class-test records remain readable and editable in their existing draft path
so audit history is not rewritten. The focused frontend assessment, event and More-navigation pass
covers 54 tests. Backend typecheck, build, targeted lint and four
assessment event-contract tests pass. Full frontend typecheck/build remain blocked only by the
preserved untracked duplicate test files already recorded above. Physical phone review remains open.

Dirty-navigation protection is now wired through every operating-rule editor. A changed value
guards in-app links, browser Back/swipe and refresh/close; the guard remains active after a failed
save and clears only after that section saves successfully. The parent category owns the guard so
categories with more than one stored rule source do not show duplicate prompts. Focused operating
rules/navigation/staff tests pass 24 tests and the changed files pass ESLint. Physical phone review
remains open.

The one-save operating-rule transaction slice is now implemented locally. Event attendance,
Departure & transport and Messaging each render as one category editor with one save action. The
category command locks the institution, checks both the shared workflow revision and domain-rule
revision, writes both records in one PostgreSQL transaction, and creates one before/after audit event.
Coverage and Daily attendance were already single-record editors. Messaging rules now carry their
own optimistic revision (`084_chat_policy_revision.sql`), including the existing standalone chat-policy
write path. The rollback-only database verification covers all three category commands, stale revisions,
tenant/admin authorization and atomic audit; focused frontend coverage passes 25 tests. Backend
typecheck/build/targeted lint and changed frontend lint pass. The local database received migration 084
directly for preview compatibility because the migration runner stops on a pre-existing checksum drift in
applied migration 047; that migration-ledger discrepancy must be reconciled before a normal deployment.
Physical phone review remains open.

The shared register lifecycle terminology slice is now implemented locally. Class attendance and event
attendance keep their existing domain-specific storage states and command contracts, but every user-facing
surface now uses the same lifecycle language: **Draft** while work is editable, **Submitted** when a class
register awaits principal review, **Final** when the authoritative register is immutable, and **Correction**
when an authorized user reopens or changes recorded decisions. The shared mapping is consumed by class
queues, class register details, event registers, event details, family schedules and paper/offline
reconciliation. User actions now say **Finalize register** and **Reopen for correction**; event changes are
saved explicitly as a draft or correction. Backend `open`, `submitted` and `locked` values remain unchanged,
avoiding an unsafe data migration or a generic cross-domain status enum.

This matches the blueprint's requirement for explicit state machines while keeping an unsubmitted register
as a staff task rather than an inferred student absence. Focused lifecycle, class attendance, continuity and
campus-event coverage passes **78/78** tests, and focused lint passes. The repository-wide frontend typecheck
continues to be blocked only by the preserved untracked duplicate `* 2.tsx` test files documented above.
Physical phone review remains open.

The configurable class-register finalization slice is now implemented locally. A full-roster submission
remains the durable audit boundary, but it no longer always creates a second principal task. The
institution-wide **Daily attendance** operating rule chooses one of two explicit paths: **Finalize
automatically** after a 0–1,440 minute delay, or **Require principal review**. Each new submission
snapshots the operating-rule revision and, for automatic mode, its exact due time. Previously submitted
registers are intentionally not rescheduled by a later rule change.

A leased background worker claims due submitted registers with row locks, makes them final exactly once,
records automatic versus manual provenance, writes an audit event and emits the existing register refresh
event. Principal attendance separates scheduled automatic work from the review queue, while the teacher
register shows the scheduled finalization time and removes the redundant Finalize action. Reopening a
final register remains an explicit correction workflow. Migration
`085_attendance_register_finalization_policy.sql` is applied to the local preview database; it was also
applied directly to the disposable integration database because those local databases retain the previously
documented migration-ledger drift.

Verified locally: backend typecheck/build and focused lint pass; operating-rule validation passes **15/15**;
the automatic-finalization database integration passes with state, revision, policy snapshot, audit and
outbox assertions; focused operating-rule and class-attendance UI coverage passes **36/36** with focused
lint clean. Repository-wide frontend typecheck remains blocked only by the preserved untracked duplicate
`* 2.tsx` tests documented above. Authenticated phone review and cloud deployment remain pending.

The shared temporal-input containment slice is now implemented locally. All **77** date, time and
date-time controls across **39** application files use one ref-forwarding `TemporalInput` component.
It preserves the browser and operating system's native picker, keyboard, locale, validation and form
semantics while enforcing `width`, `min-width`, `max-width` and `border-box` containment. A defensive
selector applies the same constraint to temporal inputs rendered by older or external composition.
Physical iPhone review exposed WebKit bug 301648: iOS repaints temporal controls as menu-list buttons
and can restore `content-box` sizing after the cascade, placing horizontal padding outside a 100%-wide
field. The component now applies prefixed and standard `appearance: none`, after which WebKit honors
the bounded border-box; internal date/time parts have normalized padding and alignment. The native
picker remains attached to the input type, so this fixes the overflow without a custom calendar.

The component has attribute, ref, class-composition and submitted-value coverage. A source-level
regression test fails if a new raw date/time input bypasses the component, and asserts the required
iOS appearance opt-out cannot be removed accidentally. Focused component, date-navigation and
operating-rule coverage passes **12/12**; all 39 consuming files pass ESLint and
the Vite production bundle succeeds. The broader frontend run passes **920/921** tests; the remaining
More-page attention-count expectation fails independently of these form-control changes and is retained
as an existing active-worktree issue. Repository-wide TypeScript checking remains blocked only by the
preserved duplicate `* 2.tsx` test files documented above. Physical iPhone review remains pending.

Remaining consolidation slices are attention/escalation operating rules; and shared loading, empty, error,
unauthorized and stale-state components.

## Active delivery: role-aware Requests inbox — 13 October 2026

Transport drill-down correction (13 October, local): the principal Transport & pickup
landing screen now lists the exact departure/transport attention items from the same
read model as More, including dates and direct review destinations. The reviewed local
five-item queue consists of unstarted planned demo journeys, not unread messages.
No journeys or rider outcomes were silently closed. Journey, roster and pickup mutations
invalidate Attention/Requests immediately. Loading failures remain visible with retry.
Twenty focused transport tests and a clean frontend build pass; phone acceptance and
cloud deployment remain pending.

Event badge correction (13 October, local): routine open-register attention now expires
at the configured event staff-entry deadline for principals as well as staff. Recorded
check-ins awaiting checkout remain principal exceptions; no attendance, session state,
or audit history is changed. Events now shows the authoritative attention items above
Upcoming/Drafts/Past filters, with exact action links independent of event-list pagination.
Event writes invalidate Requests/Attention, and the shared read model refreshes each minute
while active. A live local principal projection confirms zero event-register attention for
the three expired, unrecorded 10 October picnic sessions. 59 focused event/More tests pass;
backend build passes. Cloud rollout and authenticated phone acceptance remain pending.

Parents, staff and principals now have one **Requests** module for work that needs their attention.
It is a read-only, role-scoped projection over authoritative domain workflows, not a second approval
engine: selecting an item opens the owning attendance, event, leave, staffing, transport, finance,
governance, academic or student-care screen, where the existing domain rules perform any change.

- The common contract separates category, status, subject, due time, priority and destination. It
  orders **Act now**, **Review soon** and **When you can** deterministically by urgency and deadline.
- Parent scope is restricted to a linked child and includes existing family actions, required policy
  acknowledgements and outstanding fee obligations. Staff scope includes assigned registers, cover,
  responsibility offers, transport duty, assessment work and policy acknowledgements. Principal
  scope includes institution-wide leave, departure and transport decisions, finance review, policy
  review, assessment moderation, attendance reconciliation and open student concerns.
- Requests are reachable first in each applicable More menu, carry a live attention indicator, and
  the principal Home attention section links to the full inbox. Students intentionally do not receive
  this adult operational inbox.
- Cross-role calls were exercised against the local seeded school: parent-to-principal,
  staff-to-parent and principal-to-staff contexts each return `403`. The seeded principal receives
  three scoped items, the teacher four and the parent currently has a truthful empty state. Mobile
  Chromium checks at 390 px show no horizontal overflow or browser errors for all three views.

Focused request projection/UI tests, both typechecks, both linters and both production builds are
release evidence for this increment. Physical phone review by the product owner remains open; the
broader B5 acceptance gaps above are not claimed as complete.

## Active delivery: notices and response tracking — 13 October 2026

The next B5 slice is implemented locally as an explicit **Notices** workflow rather than an
announcement-shaped chat message. A notice is a draft until an authorized publisher releases an
immutable recipient snapshot. Principals can address staff, all guardians or one class; staff can
address guardians only in a class where their current `messages.send` assignment is effective.
Publication rechecks that authority and fails when the audience resolves to nobody.

- Notice modes are **information**, **acknowledgement** and **choice**. Choice is a generic response,
  not legal consent: event consent remains in the event workflow and cannot be manufactured by a
  notice. Information notices never create a Request.
- Delivery attempts (`app`, `SMS`, `paper`, `phone`, `in person`), opening and the recorded response
  are separate records. An app delivery does not imply that the person opened or acknowledged it.
  Guardians without an app account remain in the audience and start with a queued paper route.
- Parents and directly addressed staff respond in their own portal. Administrators can record the
  effective time, channel and attributed actor for an assisted response, or append manual delivery
  evidence. All state changes use revision checks, command idempotency, domain audit rows, the common
  audit ledger and a content-free transactional outbox envelope.
- Pending acknowledgements and choices project into the role-aware Requests inbox. Principals receive
  a separate exception only for a latest failed delivery or an overdue missing response. Notice text
  does not enter realtime event payloads.
- The web flow has focused list, compose, review/publish and detail pages. It preserves the shared
  app bars and navigation, uses one page title, and keeps recipient progress and manual follow-up
  progressively disclosed rather than stacking summary cards.

Verified locally: migration `061_school_notices.sql` applied successfully to a disposable clone of
the current local schema; the focused backend workflow suite passes **4/4** across audience scope,
idempotency, delivery/response separation, Requests projection, assisted non-app capture and neutral
events. Backend typecheck, lint and production build pass. Focused Notices/Requests/navigation UI
tests pass **12/12**, and the frontend regression excluding unrelated duplicate files passes
**682/682 across 94 files**. The new frontend files pass lint and typechecking; the repository-wide frontend
typecheck remains obstructed by pre-existing untracked duplicate `* 2.tsx` test files and is not
claimed. No cloud/shared database migration or deployment is claimed. Physical parent/staff/principal
review, real provider delivery and operating-policy sign-off remain B5 acceptance gates.

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
  ThatCampus preview on port 8000. Vite now accepts the reserved ngrok host during local review,
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
- Principal operations cover audiences, independentl…66394 tokens truncated…ed the local migration proxy. Private migration dump and
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

### Verified private accounts, Vertex AI and Railway retirement — 9 October 2026

- Release `26dc964d192def75494e8fcbefba51fd6fb16853` passed Stage run
  **37935688102**: 457 backend + 630 frontend tests, lint/typechecks/builds, secret
  scan, additive migration and public/candidate checks. Two obsolete demo-button
  assertions were updated; a pre-existing two-child route test now has a 30s
  overall timeout for its unchanged bounded waits/assertions. No failing gate was
  skipped. Final workflow-only cleanup is linted, not represented as a new app build.
- Vertex model `gemini-3.1-flash-lite` is enabled through keyless runtime identity,
  expiry **8 November 2026**, 10 requests/hour and 30/day per account, shared
  conservative reservations of $0.50/day and $5/month. All runtime resource/model
  guards were checked after configuration. Actual remaining trial credit is still
  unavailable; these are application limits, not total cloud billing caps.
- Live private sign-in, five-tab navigation, full-chat nav hiding and responsive
  320/390/1024px checks passed for all four personas, with no page/server errors.
  All four completed real authorized reads with verified sources. Principal
  Aarav lookup → pronoun attendance preview was correct and explicitly rejected;
  no attendance was changed. The model ledger recorded 9 calls and 109117 reserved
  micro-USD. Teacher received only an audited, assigned-resources `ai.use` exception
  through the same review window; no wider operational access was added.
- User explicitly requested **keep Cloudflare for personal testing, remove
  Railway**. Railway removal run **37936914773** deleted only the old Stage
  application; public URL verified 404. Read-only run **37937246349** confirmed no
  remaining service and retained volume metadata. External source database and
  private migration snapshot are preserved. Removed Railway deployment/bootstrap
  jobs, the GitHub Railway token and obsolete service/URL variables; Stage now
  verifies then deploys only to Google Cloud.
- Cloudflare and native preview remain healthy and retain their separate local
  demo mode by the user's decision. The new private passwords apply to Google
  Cloud, not those separate snapshots. Historical SMTP app-password revocation,
  production security/retention/load gates and global model-region review remain
  open; this release is not a claim of zero abuse or production certification.

### Branded invitation email — 9 October 2026

Razorpay merge compatibility: sandbox payments now use the non-production/test-key
guard independently of demo login access. Google Cloud Stage retains `DEMO_MODE=false`
and private authentication. Temporary owner-requested Stage test credentials remain
overridable, and production activation is rejected. Focused configuration, provider,
invitation-email and connection-policy tests passed (32 tests), as did focused ESLint.
Deployment and real browser checkout remain separate verification steps.

- Added an inline-styled blue/mint HTML invitation with a selectable single-use
  code, invited email, UTC expiry, join button and existing-account instructions.
  Plain text remains available. Both SMTP and Resend receive the HTML variant;
  account-action messages retain their existing plain-text behavior.
- Dynamic HTML values are escaped. Codes remain out of links; no remote images,
  tracking pixels or scripts are included. The existing post-commit send, expiry,
  authority checks and honest provider-acceptance/failure states are preserved.
- Removed obsolete Railway-specific advice from transport connection errors.
- GCP delivery still requires the runtime to reference the owner's new
  `eduera-smtp-password` secret as `SMTP_PASSWORD`, and SMTP delivery enabled.
  Creating the secret alone does not activate sending. No live inbox delivery
  is claimed by this code change.
- Local verification: backend typecheck, focused ESLint and all 10 invitation
  tests passed, including SMTP/API HTML delivery, HTML escaping, secret-free links,
  disabled sending and provider failure handling. `git diff --check` passed.

### Invitation logo — 9 October 2026

- Reused the app's existing `frontend/public/assets/edura-leaf-mark.png` in
  the invitation header at 48px alongside the ThatCampus wordmark. The fixed image
  URL uses the configured public origin, with no recipient/code/query parameters.
  This supersedes the previous template's no-remote-image design at the user's
  request. Text branding and the full invitation remain usable if images are blocked.
- Verified the deployed static asset returns HTTP 200 with image/png. No new
  image, third-party image host, tracking pixel or dependency was introduced.

### Local agent SDK recovery, decision APIs and compact charts — 9 October 2026

- Read blueprint §18 and the current agent/insights release contracts. User
  explicitly requested established provider techniques, richer safe principal
  analytics, local Gemini using the existing trial-credit project, and charts
  above the mini-chat composer. Preserved the existing theme and navigation.
- Replaced hand-written Gemini transport with official `@google/genai` 2.28.0 and
  `google-auth-library` 11.2.0. Validated function calling, native thought-signature
  retention and `p-retry` 7.1.0 bounded recovery keep app tools/confirmation separate
  from model generation. Each attempted generation is budget-reserved; malformed
  responses cannot dispatch partial commands. Permanent denials/refusals do not
  retry. Code-only failure audits and specific safe errors replace opaque failures.
- Added two authorized, read-only APIs/tools: principal learner/class/institution
  attendance and published-result reports, and focused attendance/learning/
  follow-up/coverage/deadline/fee-ageing reviews. Strict inputs, current institution
  membership, ambiguous-name choices, minimal identity fields, parameterized SQL,
  published snapshots and denominator definitions apply. Catalogue now contains
  137 capabilities (50 reads, 77 reviewed writes, 10 human handoffs), not 137
  individually certified workflows. Individual-source screens preserve learner,
  class, period and subject/class comparison instead of opening school totals.
- Chart presets become server-produced line/bar/donut data from authorized API
  results; the model cannot supply values, HTML, code or arbitrary URLs. The latest
  mini reply shows a compact four-bar preview; full chat has full source charts,
  data tables, explanatory definitions and direct verification links. Missing data
  stays missing, donuts use whole record partitions, and daily-derived subject
  attendance is explicitly a projection. Historical charts share source revocation
  checks with their answers. Source links remain outside the mini scroll region.
- Verified ADC sign-in and quota project `eduera-511111`. Local preview uses the
  same `gemini-3.1-flash-lite` Vertex model as Stage, no API key or billing upgrade.
  Separate local reservations: $0.25/day, $1/month, 10 requests/hour, 30/day,
  expiry 8 November. Added only migration 057 to local `omnischool_node` under
  the advisory lock; existing migration checksum drift was not overwritten.
  Trial credit can apply to eligible Vertex usage; remaining credit is unknown,
  and per-database allowances are not a project-wide/hosting billing cap.
- Verification: **471/471 backend tests** on a freshly migrated/CI-seeded disposable
  PostgreSQL 17 database; **634/634 frontend tests**, then **77/77 focused frontend
  tests** including a new learner-source regression. Typechecks, full lint and
  builds passed. A first full run reused old fixtures and omitted CI demo mode;
  its 11 failures were not waived—the complete clean run passed. No real local
  ride/attendance data was reset by tests. Provider tests cover malformed calls,
  output limits, 429, permanent errors, safety, cancellation, signature retention
  and durable budget refusal; chart tests cover nulls, truncation and source routing.
- Real opt-in Vertex evaluation through the full isolated API passed the final
  four-turn greeting → learner bar chart → learner/class/school results →
  attendance/coverage/follow-up review. An earlier sample omitted school scope and
  chose the wrong chart; clearer schemas/tool guidance corrected the tested cases.
  Total eval reservation 162073 micro-USD/12 generations; local browser chart
  26928 micro-USD/2 generations. These are conservative reservations, not invoices.
  Browser QA verified mini/full transitions, bottom-nav hiding, correct learner
  source values and no overflow/composer clipping at 320/390/768/1024/1440px.
  Native and Cloudflare readiness both returned 200.
- **Deployed to Google Cloud Stage** at commit `5d1f452` by workflow
  `37948358227` (attempt 2). Migration 058 completed and revision
  `eduvera-stage-00024-jer` receives 100% traffic. Release identity, database/event
  readiness, private-session mode and both web roots passed the automated gate;
  independent `/releasez`, `/readyz` and root checks returned HTTP 200. The first
  deployment attempt correctly preserved the previous serving revision when a
  whitespace-prefixed SMTP secret binding prevented startup; the binding was
  corrected to the existing `eduera-smtp-password` Secret Manager secret before
  the successful retry. Historic Stage HTTP-200 failures did not retain the provider finish
  reason, so their exact root cause is not claimed as proven. User/physical-device
  review, broad adversarial/multilingual evaluation, load/latency, chat retention,
  provider data approval and existing dependency/security advisories remain open.
  No claim that every request or model is reliable, or that AI misuse is eliminated.

### Per-user Pro features preview switch — 9 October 2026

- Added Profile → Pro features across all four views. The switch is an opt-in
  **preview preference**, initially off; it is not a paid entitlement or a
  subscription claim. The earlier split between basic and advanced assistant
  behavior was superseded by the user's explicit decision on 9 October: when
  off, the assistant is entirely absent. Chat tabs, compact overlays and the full
  assistant page are not rendered; direct assistant URLs return to the portal
  home before requesting agent data. The server rejects every agent endpoint,
  specialist attendance AI and pending-action decisions. Disabling the preference
  atomically cancels running requests and rejects pending confirmations; a later
  re-enable cannot revive an old proposal. Normal school workflows and
  person-to-person Messages remain available.
- Additive migration `058_user_pro_features.sql` stores the preference per user.
  Existing `ai.use`, photo attendance and role/record permissions remain
  mandatory when Pro is on. Historical agent answers based on now-hidden tools
  are masked while Pro is off. Account changes are audited; toggling does not
  create a billing entitlement. A future plan gate must be evaluated server-side
  **in addition** to this preference, not replaced by it.
- Verified after merging current `Stage`, on a freshly migrated and seeded
  disposable PostgreSQL 17 database: backend **337 passed, 153 intentional
  skips**; frontend **640 passed**. Tests include
  off-state tool filtering, direct attendance-AI denial, pending-action
  confirmation denial and the profile toggle. Both builds and both linters
  passed. Verification also hardened day-plan and attendance-follow-up response
  timestamps against bounded five-second application/database clock skew while
  continuing to reject materially future or pre-publication observations. A
  first backend run against reused fixtures had dashboard count mismatches;
  clean reseed resolved them. Migration 058 was applied to local
  `omnischool_node` and Google Cloud Stage under their migration advisory locks.
  Local backend and
  Cloudflare health returned HTTP 200; an authenticated local demo preference
  read returned `enabled:false`. Stage workflow `37948358227` deployed revision
  `eduvera-stage-00024-jer`; release/readiness/root checks returned HTTP 200 and
  the service reports 100% traffic on that revision. User/device visual acceptance
  is not yet claimed; ask for UI validation before release.
- The full-off revision passed **27/27 agent integration tests** on the isolated
  `omnischool_agent_test_20261009` database and **63/63 focused frontend route,
  navigation and profile tests**. Focused frontend/backend lint, backend build and backend
  typecheck passed. The dirty shared workspace's frontend typecheck was obstructed
  by pre-existing untracked duplicate `* 2.tsx` test files; a clean detached
  worktree containing this exact patch passed full frontend typecheck, production
  build and lint. No deployment or physical-device UI acceptance is claimed yet.

### Concise, accessible assistant results — 9 October 2026

- Re-read blueprint §18 and applied the user's explicit content-first direction
  without changing shared navigation or the established portal theme. The result
  treatment follows Apple HIG chart/layout guidance: answer first, direct labels,
  restrained semantic color, short scanning paths and progressive disclosure for
  supporting detail. Visible `Assistant`/provider labels and generic footer copy
  were removed; screen-reader response labels remain.
- Added semantic Markdown rendering through pinned `react-markdown` 10.1.0 with
  raw HTML, model-authored links, images and tables disabled. Headings, lists,
  emphasis, quotes and code now use a consistent hierarchy; list markers and key
  values use the existing portal accent. Pre-render normalization removes stray
  punctuation and chart boilerplate. If prose merely repeats verified chart rows,
  the UI replaces it with a short deterministic finding from the authorized chart
  data; meaningful model analysis is preserved.
- Reworked bar results into a flat, compact chart with direct subject/value labels
  and thin comparison lines. Full chat shows up to eight rows; the mini result
  shows four and an explicit remaining count. Scope and period stay visible, while
  the data table, method and projection caveats move under `Data and method`.
  Evidence links and freshness remain available once, without duplicating the
  chart source in a second source block. Null values remain `Not recorded`.
- Tightened the provider instruction to lead with the requested answer, omit
  greetings/request restatement/chart narration/closing offers, limit chart prose
  to two findings and avoid Markdown tables, links and hash headings. Chart values
  continue to be server-produced from authorized APIs; the model cannot invent
  visual data or arbitrary destinations.
- Verification: focused assistant UI **19/19 tests**, chart unit **3/3 tests** and
  agent integration **27/27 tests** passed. A clean detached worktree containing
  the exact patch passed frontend typecheck, production build, lint and the full
  **645/645 test** suite; backend typecheck, build and lint passed. Production
  dependency audit reported zero vulnerabilities. Browser QA at 390×844 verified
  full and mini density, composer clearance, progressive detail and screen-reader
  labels. Local, Cloudflare and backend readiness were rechecked separately.
  No Stage deployment or physical-device visual acceptance is claimed in this task.

### Focused assistant action approval — 9 October 2026

- Re-read blueprint §18 before changing the approval surface. The existing
  immutable preview, expiry, permission revalidation, deterministic execution and
  receipt behavior are unchanged. Mini chat still cannot confirm a write. It only
  opens the complete review, preserving an explicit human decision before the
  server is asked to execute anything.
- Replaced the neutral full-chat action block with one focused approval surface.
  Pending actions use the established warning tokens, state `Review required`,
  name the affected person or record, show the exact effect and state plainly that
  nothing has changed. Individual attendance now presents current and proposed
  values as a direct before/after comparison. Supporting facts stay flat and
  scannable; success, uncertainty and failure use their existing semantic colors.
- When a proposal is pending, mini chat replaces the ordinary answer/source stack
  with a compact amber approval banner directly above the composer. It shows the
  action, affected target and expiry, while keeping Confirm unavailable. The entire
  review link retains the smooth full-chat transition and return state. Close,
  keyboard focus, screen-reader labels and reduced-motion behavior remain intact.
- Verification: focused assistant **20/20 tests** passed. A clean detached
  worktree containing the exact patch passed frontend typecheck, production build,
  lint and the full **646/646 test** suite; production dependency audit reported
  zero vulnerabilities. Real principal proposals verified the full review at
  320/390/768/1024/1440px and the mini approval at 320/390px, with no horizontal
  overflow or JavaScript errors. Both QA proposals were dismissed after review;
  no attendance record was changed. Local and Cloudflare health were rechecked.
  Stage deployment and physical-device visual acceptance remain open.

### Local AI test allowance — 9 October 2026

- Increased only the personal local/Cloudflare preview's durable Vertex allowance
  from **$0.25/day to $1/day** so the current demo can be tested more extensively.
  The separate **$1/month** reservation ceiling, 10 requests/hour and 30 requests/day
  per-account limits, trial expiry, approved Flash-Lite model, Pro-feature gate and
  all authorization/confirmation controls remain unchanged. This application
  allowance is conservative pre-call reservation accounting, not a Google Cloud
  invoice or hard billing cap.
- Before the change, the local ledger contained 18 reservations totaling 245,423
  micro-USD for the current UTC day/month. Existing reservations were preserved;
  no usage was reset or deleted. The parsed runtime policy now reports 1,000,000
  daily micro-USD, 1,000,000 monthly micro-USD, 10 requests/hour and 30/day. The
  managed preview was restarted; local and Cloudflare `/readyz` both returned
  HTTP 200 with database and event storage healthy.

### Contract-driven agent autonomy, prompt and memory hardening — 9 October 2026

- Re-read blueprint §18 and recorded the user's explicit refinement: the platform
  should govern effects according to risk, not make the model ask permission for
  every useful operation. The blueprint's same-API authorization, tenant scope,
  auditability, deterministic validation and human-only physical/safety boundaries
  remain intact. Autonomous reasoning/reads are unrestricted within the user's
  granted catalogue. Only the reciprocal homework complete/reopen flags are now
  classified as monitored low-impact effects; all 75 other record-changing tools
  remain reviewed until their domain invariants and reversal semantics earn a
  narrower classification.
- Added one versioned machine-readable capability contract shared by tool
  descriptions, `find_tools`, the status API, execution policy, persisted action
  state, receipts and UI presentation. It declares domain, inputs, required prior
  read, effect class, control, outcome, presentation and reversal. Concise labels
  are separate from detailed model guidance; this prevents instructions such as
  “never invent missing statuses” from appearing as an approval title.
- Split the growing system prompt into stable role/authorization rules, current
  time/scope, intent policy, dynamically selected domain skills and a concise
  response contract. The model receives at most the relevant tool subset, can
  discover more via the permission-filtered manifest, and treats every retrieved
  record as untrusted data. The app continues to own tenant/child scope, IDs,
  revisions, idempotency, chart values, links, execution and receipts.
- Removed special retry-command behavior. Natural user turns remain ordered context;
  app-owned outcome messages explicitly distinguish proposed, dismissed, expired,
  stale, failed, uncertain and succeeded effects. Rejected model tool arguments are
  not reintroduced. Deterministic attendance validation uses the newest explicit
  user-authored learner/status and cannot widen a learner correction into a class
  register.
- Added provider-aware context sizing and durable LLM compaction at **30%**. Oldest
  turns become a bounded goals/preferences/corrections/outcomes summary; recent
  turns remain verbatim. The summary excludes identifiers, tool arguments and
  school-record facts and is always labelled non-evidence/non-authority, so a fresh
  authorized API read remains mandatory. Summary cursor, prompt/contract versions
  and success/failure are auditable. Additive migration
  `059_agent_effect_contract.sql` persists these policy and memory fields without
  reclassifying historical actions.
- Research used official Vertex function-calling/thought-signature and Agent Engine
  evaluation guidance, Google ADK trace/golden-set evaluation, LangGraph durable
  execution/selective tool review, MCP's current consent/audit direction and
  pgvector's filtered similarity model. Decision: retain the official Google SDK,
  Zod/JSON Schema contracts and PostgreSQL state now. Evaluate ADK/LangGraph on the
  same golden multi-turn traces before adopting either; do not add pgvector until
  there is an approved unstructured corpus, and do not use MCP to bypass internal
  APIs or authorization.
- Verified so far: backend typecheck/build and full backend lint; **29/29
  capability/prompt/memory contract tests**; **22/22 mocked provider-protocol
  tests**; **31/31 isolated real-database agent integration tests**; and **17/17
  focused assistant UI tests** with focused frontend lint.
  The latter cover natural continuation after a dismissed proposal, absence of
  rejected tool arguments, learner-versus-class containment, stale/uncertain
  effects, preservation of all natural turns below the 30% threshold, compaction
  above it with non-authoritative memory, and one monitored homework
  completion with a fresh-source check and audit receipt. The shared workspace's
  full frontend typecheck is still obstructed by pre-existing untracked duplicate
  `* 2.tsx` tests with missing matcher augmentation; those files were preserved.
  Live Vertex, preview/browser and deployment checks remain separate and are not
  yet claimed by this increment.
- A subsequent real-Vertex, read-only local smoke test passed three principal
  turns: today's attendance-recording gaps, the natural follow-up “Which class
  should I check first?”, and an independent two-bullet check after prompt version
  `2026-10-09.layered-v3` moved compacted memory out of system-role authority.
  Each turn refreshed the authorized `class_registers` source, returned concise
  evidence-linked output and created no action. The test threads were archived; no
  attendance or other school record changed. Local and Cloudflare readiness returned
  HTTP 200; the public agent status reports configured model ready and capability
  contract `2026-10-09.2`. This is a two-turn observation, not a model-wide SLO or
  adversarial certification. Review URL:
  `https://verde-too-independent-bargains.trycloudflare.com`.

### Bounded long-term user memory — 10 October 2026

- Re-read blueprint §18 and separated two different kinds of memory. Existing
  thread compaction preserves short-term task continuity after 30% of the model
  context; new long-term memory stores only an explicitly stated durable
  communication preference, recurring app workflow preference or self-described
  app familiarity. It does not store transcript excerpts or school-record facts.
- Selected structured PostgreSQL over pgvector/managed Memory Bank for this release.
  The active set is intentionally small enough to send in full after exact
  owner/school/portal filtering, so relational storage gives deterministic
  upsert/delete, user inspection, auditability, local-Ollama portability and no
  embedding spend or approximate filtered-recall failure. Introduce vectors only
  for a separately approved larger corpus with tenant-filter recall and poisoning
  evaluations; never use vectors as the source of attendance, marks, fees or action
  state.
- Added migration `060_agent_user_memory.sql`, the versioned
  `manage_user_memory` contract and authenticated list/delete/clear APIs. The
  default limits are 1,200 estimated tokens total, 32 items, 96 estimated tokens
  per item and 365-day expiry. Same-topic corrections revise the row; deterministic
  priority/recency eviction and a periodic expiry sweep enforce bounded storage.
  The Profile surface explains the boundary, reports budget use, forgets one item
  and uses a two-step clear-all action. Inspection/deletion remains available when
  Pro AI is off.
- Long-term writes require an exact evidence quote from the current user message.
  Schema and server validation reject model/assistant/tool-derived text, one-off
  inference, credentials, contacts, identifiers, URLs, exact locations, sensitive
  traits, health/safeguarding data, school records, permission text and prompt/tool
  injection. Audit events retain only operation counts/categories and contract
  version, not memory content. Memory is labelled untrusted personalization data
  in every prompt and cannot supply identity proof, authorization, action intent,
  tool arguments or record evidence.
- The model now receives minimal live account context: display name, effective
  account role, portal, institution and selected learner. Contact fields are
  excluded. This context can make conversation natural but never broadens the
  capability catalogue or replaces fresh authorization and record reads.
- Verified against the reset isolated `omnischool_agent_test_20261009` database:
  **32/32 integration**, **30/30 contract**, **22/22 provider**, and **1/1 storage**
  tests passed (**85/85 total**). The database scenario covers model-mediated
  remember, cross-thread reuse, exact owner retrieval, account context without
  email, user deletion and audit evidence. Profile UI **2/2** passed; focused
  frontend/backend lint and backend typecheck/build pass. The local PostgreSQL 14
  instance cannot replay historical migration 033's newer syntax from a blank
  database, so this disposable test was rebuilt from the already-migrated local
  schema and data; no working database records were changed. The full frontend
  build remains blocked by preserved pre-existing untracked duplicate `* 2.tsx`
  test files with missing matcher augmentation. No deployment, browser/device
  acceptance or live-provider memory certification is claimed.

### Role-aware assistant conversation — 10 October 2026

- Re-read blueprint sections 6 and 18 and corrected a contradictory response rule
  that prohibited greetings. Identity and effective role now shape the conversation
  without being announced. The assistant uses the signed-in person's preferred
  first name for one concise opening greeting, never says “you are currently logged
  in as…”, and does not repeat a greeting in later turns. Direct identity questions
  use the live app context rather than a school-record lookup.
- Added portal-specific response priorities without changing authorization or tool
  availability: principal answers lead with decisions, exceptions, institution
  impact and next steps; staff answers lead with assigned work, class/learner
  context, timing and the next practical step. Parent/student language stays scoped
  and plain. Simple answers use one or two sentences and ordinary answers target
  fewer than 80 words unless detail is requested.
- Versioned the layered prompt as `2026-10-10.layered-v5` and added contract
  assertions for opening/continuing turns, preferred-name context, role focus and
  prohibited bureaucratic phrasing. Backend typecheck/build and focused lint pass;
  focused verification passes **30/30 prompt/capability contracts**, **22/22 provider
  protocol tests**, **32/32 isolated agent integration tests** and **1/1 storage test**.
- A paid read-only Vertex run on a separately cloned synthetic test database passed
  five connected principal turns and one separately authorized staff opening. The
  verified responses included **“Hello, Meera. What can I help with?”**, **“Your
  name is Meera Kapoor.”**, and **“Hello, Kavita. What can I help with?”**. Later
  principal responses did not re-greet and retained app-owned sources. Nine model
  calls reserved 127,041 micro-USD under the isolated test allowance; this is not
  an invoice or general model-quality certification. The temporary staff test grant
  and database were deleted. No Stage deployment or physical-device acceptance is
  claimed.

### Authenticated four-profile development switcher — 10 October 2026

- Added a temporary account Profile surface for the four Cambridge review identities:
  student, parent, teacher and principal. A valid password sign-in remains mandatory;
  public `demo-session` authentication remains disabled on managed Stage. After one of
  those four identities signs in, the login flow opens Profile and shows the four
  already-seeded identities with the active identity clearly marked.
- Switching is a CSRF-protected authenticated command, not a client-side role override.
  The server accepts only the four fixed roles, confirms the current and target accounts
  are the seeded review identities, creates a new server session, revokes the previous
  session, changes to the target's Cambridge membership and records
  `auth.demo_profile.switched` without credentials in audit metadata. Other users receive
  a concealed 404 and cannot enumerate or use the switcher.
- `DEMO_PROFILE_SWITCHER_ENABLED` defaults off and is hard-disabled when
  `DEPLOYMENT_ENVIRONMENT=production`. The Google Cloud Stage release command explicitly
  enables the switcher on its no-traffic candidate revision; this does not weaken the
  existing `DEMO_MODE=false` release assertion. Removing that one Stage flag disables the
  temporary surface without changing accounts or data.
- Verified locally with backend typecheck/build, focused frontend lint and **3/3** Profile
  UI tests, **1/1** real PostgreSQL auth/session integration test, and **7/7** Google Cloud
  release-contract tests. The database test proves anonymous denial, four-profile listing,
  CSRF rejection, session rotation, target identity restoration, audit evidence and
  exclusion of the company persona. Workflow `37984688625` then passed the complete clean
  PostgreSQL/backend, **674/674** frontend, desktop and release-contract gates and promoted
  Cloud Run revision `eduvera-stage-00057-hew` to 100% traffic. An authenticated Stage check
  listed exactly four profiles and rotated a principal session to staff. Physical-device
  acceptance remains open.

### Generic action-following agent contract — 10 October 2026

- Replaced the layered instruction stack with one concise operating prompt plus only the
  relevant domain skill and audience response guidance. The prompt now describes the
  general contract: use an available app tool for the requested job, read current records,
  ask only for a genuinely missing real-world detail, and let the application enforce
  authorization, scope, validation, confirmation and receipts. It contains no learner-,
  phrase- or screenshot-specific workaround.
- Clear action requests now use the catalogue's highest-ranked authorized write tool as a
  provider-level required tool on the first model turn. Vertex/Gemini, OpenAI Responses,
  OpenAI-compatible chat and Anthropic each receive their native constrained tool-choice
  form. Only one write can be required; schemas and server-side preparation still reject
  missing or invented values, and consequential effects still stop at the existing review
  screen. Ordinary questions retain normal model choice.
- Short explicit continuations such as “you can”, “go ahead” and “proceed” inherit only the
  latest user-authored goal containing an app domain or action. Model text, tool arguments,
  dismissed proposals and record payloads never create action authority. This fixes the
  general multi-turn failure where the model forgot the actionable goal and responded with
  a refusal, without hard-coding a retry phrase or a particular attendance scenario.
- The design follows provider guidance to keep role/goals/style in a compact system
  instruction and expose clear, predictable function schemas; deterministic application
  code remains responsible for effects. Verified with backend typecheck/build, **31/31**
  capability/prompt contracts, **24/24** multi-provider protocol tests and **32/32**
  isolated real-database agent integration tests, including a natural “You can” continuation
  after a dismissed proposal. The same Stage workflow deployed the contract. A real Vertex
  request using ordinary possessive wording prepared `record_student_attendance` for Aarav
  Sharma; the review was dismissed and a fresh read confirmed that the record stayed
  unchanged. Local/Cloudflare repeated the same no-write flow, and both public readiness
  checks report healthy database and event storage. Broader live-device and adversarial
  model evaluation remain open; this smoke test is not a general reliability claim.

### Family fees clarity and receipt printing — 9 October 2026

User-requested cleanup preserves the shared parent/student shell and blue semantic
palette. Fee descriptions now lead compact rows, balances align on the right,
and status labels and readable due dates replace reference-first scanning.
References remain available in rows, details and printouts. Verified receipts
open a student-scoped detail route with an individual print action. Statement,
invoice, receipt register and review print actions use a dedicated print document
with school/student identity and full references; payment controls and navigation
are excluded. Razorpay test receipts retain explicit sandbox labeling. No payment
or verification rules change, and student views remain read-only.

Validation: 18 focused frontend tests pass, covering receipt navigation, selected
receipt-only print content, unavailable receipt isolation, invoice printing,
child switching, review confirmation and existing mocked gateway flows. Browser
print dialog/device printing and live gateway completion are separate acceptance
checks; no real payment was made. Build/lint and Stage verification are recorded
in the associated PR; user visual acceptance remains pending.


### Invitation email actions — 9 October 2026

School invitation creation now explicitly says **Send invitation email**. Pending
and expired school/company invitations offer **Resend invitation email**. Resend
retains recipient, role, target records and source; rotates the stored token hash;
renews the 72-hour expiry; records an audit action; and sends after commit.
School locks serialize resend with acceptance/revocation. Accepted or revoked
invitations cannot be resent; delegated inviters cannot resend company or admin
invitations. A one-minute cooldown limits accidental repeats. Receipts distinguish
provider acceptance, failure and manual delivery. UI/transport and TypeScript
checks pass locally; database integration cases are included for CI. Live inbox
delivery remains unverified.


### Numeric invitation codes and embedded email logo — 9 October 2026

User-requested correction: new school, staff-profile and company invitations use
cryptographically generated six-digit codes (including leading zeros), expire in
30 minutes, and retain existing single-use, recipient and authority checks.
Numeric hashes use an email-bound HMAC with the stable cookie secret; previously
issued long-code hashes remain compatible until their original expiry. Five
acceptance attempts per recipient per 15 minutes are committed separately from
acceptance so failed guesses cannot roll back the limit. Resend replaces the code.
The established ThatCampus logo is embedded as an inline PNG attachment with a CID
reference in SMTP and HTTPS provider emails; it no longer needs a remote image
request. Focused checks cover MIME metadata, code scoping and legacy digests;
database CI covers guess limits. Live deployment/email verification follows CI.

### Razorpay wallet recovery, payment status and emailed PDFs — 9 October 2026

The observed Stage headers enforce same-origin opener isolation and self-only
form posting. Enabled Razorpay now uses popup-compatible opener isolation and
allows form posts only to self and the exact Razorpay API origin. This addresses
a likely wallet popup failure; user-device completion is not yet verified.
Invoice status persists across visits and refreshes while visible. Verified failed
and pending attempts are distinct from captured and school-review payments.
Parents can download an authorized PDF from invoice status or receipt detail.

Migration 059 adds a transactional, deduplicated email queue. A post-commit worker
uses ThatCampus's existing configured sender, verifies the initiating guardian still
has access and a verified email, and attaches a branded PDF only for allocated
capture. Other states get accurate status templates. Provider acceptance is not
claimed as inbox delivery. Ambiguous sending is recorded without automatic resend;
payment remains committed even when email fails. Old receipts are not backfilled.
The embedded receipt font and its license are packaged in the runtime image.

Local verification: backend typecheck/build, focused lint, 18 provider/template/PDF
tests and 30 fee frontend tests passed. The sample PDF was rendered and visually
checked. Additional isolated-database tests cover duplicate enqueue, recipient
eligibility, PDF authorization and ambiguous sends; CI remains required. Live
wallet completion and actual email inbox receipt are separate acceptance checks.
### Compact invitation confirmation — 9 October 2026

User correction replaces the separate "Invitation ready" receipt with a compact
confirmation on the invitation list. Successful provider acceptance shows an
animated mint checkmark, "Invitation sent", and the recipient email. The shared
company receipt uses the same presentation. Tokens, join URLs, expiry text and
copy actions are no longer rendered. Failed or unavailable email delivery shows
an explicit alert and points to settings/resend; it never uses the success
animation. Sending still uses the existing API and does not claim inbox delivery.
The confirmation can be dismissed with the keyboard, uses a live status region,
and disables animation for reduced-motion preferences.

Local verification: 15 onboarding tests passed, including success, failed resend,
unavailable email, hidden tokens, return to the list and dismissal; frontend
TypeScript/production build and lint passed. A component preview was prepared,
but its local server did not remain reachable. Browser visual verification is
pending because the local Chromium download is unavailable. CI, deployment and user visual acceptance
must be verified separately; no live email was sent by this UI change.

### Reference-led invitation email — 9 October 2026

The supplied email reference now guides the invitation template: white rounded
card, original embedded ThatCampus logo, navy heading, neutral code panel with
single-use label, readable UTC expiry including time, violet full-width join
button, fallback join link and quiet privacy footer. Responsive overrides reduce
padding on small screens; presentation tables and inline styles retain email
client fallbacks. The code remains contiguous and selectable so copying preserves
leading zeros. No non-functional clipboard button or invented Help/Privacy links
are added. The existing logo attachment, plain-text alternative, escaped values
and code-free links are unchanged. No invitation TTL or acceptance behavior changes.

Verification: 11 focused email tests and backend production build pass locally.
These tests use mocked transports; no live email was sent. Real inbox/client
visual verification and deployment remain pending. This change and the compact
confirmation above remain local until the user authorizes publishing to GitHub.

### Invitation link prefill and transparent logo — 9 October 2026

User correction: Accept Invitation now centers its label without an offset arrow.
Both email links and the plain-text alternative carry the invited email and code
in the URL fragment. The join form reads valid details, preserves leading zeros,
and removes the fragment with history replacement. Opening a link never consumes
an invitation: acceptance still requires the existing explicit form submission,
CSRF, password/account checks, expiry and single-use validation. Invalid or older
bare links retain manual entry. Email copy now describes the code as a backup.
This explicitly supersedes the earlier code-free-link decision at the user's
request; fragments are not included in HTTP requests/referrer headers.

The embedded logo now reuses the existing transparent RGBA brand PNG verbatim,
instead of the opaque RGB app icon, preserving the original artwork for dark
email backgrounds. Local verification: 11 email tests and 20 onboarding tests,
both production builds and targeted lint pass. Tests cover fragment encoding,
leading zeros, plus-address email, no acceptance on open, history cleanup,
invalid-link fallback, expired-invitation errors and logo alpha metadata.
Real email-client rendering and Stage deployment are separate verification gates.


### Invitation email copy cleanup — 9 October 2026

User correction centers the numeric invitation code with inline text alignment
and an HTML alignment fallback. Removes the invited-email/current-password
paragraph from HTML and the corresponding lines from the plain-text alternative.
A 24px gap separates expiry and the accept button. Link prefill, original
transparent logo, expiry and acceptance rules remain intact. The existing email
transport/escaping tests are used for verification; release status follows CI.

### Reference-led family finance screens — 9 October 2026

User supplied a two-screen reference for fee overview and invoice statement.
Implemented a total/paid/overdue summary, invoice status filter, segmented tabs,
compact icon rows and an enquiry entry point using existing school ledger data.
Pay balance opens unpaid invoice selection: the existing checkout is scoped to
one invoice, not an unsupported multi-invoice charge. Invoice statements show
original charge, actual credits, linked verified receipts, outstanding/refund
balance, copy reference, print and refresh controls. No office hours, verification
claims or sample monetary values from the image are introduced as live data.
Shared portal navigation, receipt printing and payment authorization remain intact.

Validation: 21 focused fee/review/gateway tests pass including filter replacement,
enquiry navigation and statement refresh without payment submission; focused lint
passes. Production build and Stage release follow CI. Visual acceptance against
the user's reference and physical iPad printing remain user acceptance checks.


### Invitation sent popup — 9 October 2026

User correction moves successful invitation confirmation from an inline list card
to a centered native modal dialog above the app. The existing mint checkmark
animates within a compact card with recipient email and a close control. It closes
after four seconds or immediately via close/Escape. Native dialog behavior supplies
the modal backdrop and focus containment; opening locks page scroll, cleanup restores
scroll/focus and cancels the timer, and reduced-motion preferences disable animations.
Failed/manual delivery remains a persistent inline alert; the popup is shown only
for provider-accepted email. Invitation records and delivery APIs are unchanged.

Local verification: 22 focused onboarding/popup tests pass, including timer cleanup,
callback refresh without restarting the deadline, manual dismissal, focus restoration,
hidden codes and persistent failure states. Frontend production build and targeted
TypeScript-aware lint pass. Real-device visual review and deployment remain separate
gates; no live invitation email was sent for these tests.

### Background invitation delivery and translucent confirmation — 10 October 2026

User correction removes the dark backdrop and changes the invitation popup to a
translucent, blurred theme surface (opaque fallback for reduced transparency).
Pending mail shows a dismissible sending state; only provider acceptance starts
the success animation and four-second dismissal. Workspace polling exposes queued,
sending, accepted, failed, unconfirmed and cancelled delivery without exposing codes.
Delivery job IDs prevent a stale pre-resend success from confirming the new attempt.

Migration 060 adds a durable PostgreSQL invitation queue. School/company create and
resend transactions enqueue atomically and return without waiting for SMTP/HTTPS.
The existing always-allocated Stage CPU runs a one-second worker; atomic SKIP LOCKED
claims prevent duplicate concurrent processing. Codes are AES-GCM encrypted with a
domain-separated key derived from the configured application secret, bound to the
invitation ID, and erased on completion/cancellation. Revoked, expired, accepted or
rotated invitations are skipped. Interrupted/ambiguous sends are marked unconfirmed
without automatic resending; the authorized sender can check and resend manually.
Pending jobs survive process restarts. No new infrastructure or credentials required.

Invitation/payment HTML now references a public, versioned PNG endpoint serving the
same original transparent logo, rather than attaching it as a CID MIME part. Real
payment PDF attachments remain unchanged. The logo URL contains no user identifiers.
Remote-image blocking may hide the image in some clients; the text brand remains.
Already-sent messages and their Gmail attachment chips cannot be changed retroactively.

Local evidence: 30 focused frontend tests and 17 backend email/asset/crypto/PDF tests
pass; frontend production build and backend build/typecheck pass. Ten new disposable
PostgreSQL integration cases cover transaction rollback, concurrent workers, slow
providers, invalidated invitations, interrupted attempts and sanitized failures.
They require the isolated CI database (no local PostgreSQL available). Full CI,
Stage deployment, and real-device/email-client visual review remain separate gates.
No live invitation or payment emails were sent while testing.

### Conversation-first agent and API-owned controls — 10 October 2026

User clarification: the assistant is a school conversation partner that can act,
not a single-command form. Read blueprint §18 before this change. Stage audit of
the reported thread showed an English regex replaced the learner with the literal
`his attendence to`, followed by Vertex HTTP 400. There was no authorization-denied
API result in that thread. A separate protocol audit found that discovery returned
a root array where Gemini requires an object-valued function response.

This supersedes the earlier “Generic action-following agent contract” implementation:
remove forced highest-ranked writes, phrase-specific continuation detection, and
English-regex rewriting/gating of learner/date/status arguments. Topic retrieval
uses the latest user topic for domain-less follow-ups, while the model receives the
conversation and chooses whether to discuss, read, clarify or act. All authorized
operations remain discoverable. The concise v7 prompt and tool descriptions explain
outcomes, not a repeated list of approval prohibitions. API access, fresh-read binding,
revisions, idempotency, immutable review, confirmation, Pro-off checks and audit remain
server-owned. Correction reasons/notes must still come from actual user messages.

Gemini function results now wrap root arrays/primitives in an object and discovery
returns a named `tools` array. Error results distinguish invalid input, missing data,
state conflict, real access denial and service failure. Added a staff-only, existing-
API-backed `student_fees` read for scoped conversational follow-ups and a verification
link to that learner's fee view. No provider switch, extra infrastructure or new
database migration is introduced.

Research: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
and [Google function calling](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling)
support clear function contracts, application-owned execution and native tool-result
history. Retain the official Google SDK and native signatures; adding an orchestration
library would not itself fix corrupt arguments or invalid provider payloads.

Cross-domain evaluation also caught incorrect paise-to-rupee interpretation. Fee
tools now provide application-formatted INR amounts and computed outstanding totals;
the unmodified integer ledger remains the audited source. Missing values remain unknown.

Verified locally: backend build/typecheck/focused lint, **70 unit/protocol/chart/money
tests** and **32 integration tests** pass. All tracked migrations applied successfully
to a fresh isolated PostgreSQL 17 cluster. A paid real-Gemini conversation verified
lookup, pronoun/date handling, missing-reason clarification, review dismissal, intervening
discussion, resumption, confirmed one-student update, recovery from historical false
refusal, and switching to that learner's fees. The final fee answer correctly reported
INR 11,500.00, not 1,150,000; no provider recovery occurred. One earlier local harness
run overlapped suites against the same actor and was discarded; the integration suite
was rerun sequentially and passed. No Stage school record was changed by these tests.
Google release evidence follows CI; these checks do not certify every model response.

First release attempt passed 540/542 backend tests, including the agent suite, but
stopped on two existing campus-event tests whose fixed demo picnic date had passed.
The isolated suite now shifts that fixture and its sessions into the future and
restores their original timestamps afterward. All 15 event tests pass locally;
production consent/history and register-lock rules are unchanged. Full CI is rerun.

Release verified: [Stage run 38019566819](https://github.com/EduveraIITA/Eduvera/actions/runs/38019566819)
passed **542 backend tests and 674 mobile tests**, backend/mobile typecheck/lint/build,
desktop typecheck/build, migration and candidate/public checks. Release
`ecd86c05013a430be97e654329346fac2d6232a8` serves 100% of Stage traffic on
`eduvera-stage-00060-zom`. Public `/releasez` matches and `/readyz` reports database
and events ready. Authenticated Vertex `gemini-3.1-flash-lite` reports ready.
A deployed read-only three-turn smoke verified student lookup, general study-support
discussion without an action, and return to the student's class in conversational
context (thread `5786451a-a5d5-4013-9a7c-593ccf82626d`). No school record was changed.
Local port 8000 and the existing Cloudflare preview both pass readiness checks.
Stopped the temporary isolated PostgreSQL cluster and read-only Cloud SQL proxy;
the user's preview and tunnel remain available.

### Chat navigation belongs to the header — 10 October 2026

User correction: conversation history and new-chat are navigation controls, not
conversation content. The full assistant page removes both rows from the transcript
and places two icon-only, 40-pixel controls in the shared Chat title bar across
principal, teacher, parent and student portals. Accessible labels and native focus
remain; the history icon opens a bounded translucent conversation menu, while the
compose icon starts a new chat. No agent, database or permission behavior changed.

### Personal HTTPS preview restarted — 13 October 2026

The previous Cloudflare quick tunnel and local preview were no longer registered
after the host stopped. Both task-scoped launchd jobs are running again. The current
preview is **https://nevada-senior-coding-enabled.trycloudflare.com**; public `/login`
returns 200 and `/readyz` reports database and events ready. The older ngrok endpoint
still returns `ERR_NGROK_3200`, so it was not reused.

The demo-profile APIs were then checked through the live preview with all four saved
review logins: every login returned 200, advertised the switcher and listed exactly
four profiles. The missing screen was a frontend redirect-order bug: a protected
route's `next=` parameter won over the temporary review profile destination. Demo
identities now always see Profile first after password login; ordinary accounts still
honour `next=`. This changes navigation only, not authentication or authorization.

### Cross-portal attention and exact-item navigation — 13 October 2026 (local)

The parent, teacher and principal portals now use one authorized server projection
for attention rather than unrelated page counters. It distinguishes unread/new,
action-required and exception signals without collapsing them: opening an item clears
only its unread state, while an outstanding response or operational exception remains.
The notification bell remains a separate delivery feed. Parent projections are scoped
to the selected child and school; staff projections retain the existing role and
delegated-permission checks.

The shared projection covers notices and unread conversations plus the actionable
work already owned by attendance registers/follow-ups/reconciliation, diary
acknowledgements, student and staff leave, event responses/checklists/payments/duties,
teacher-feedback requests, report-card review, protected-care cases, responsibility
and cover offers/gaps, transport duties/swaps/departure changes, fee and payment
review, policy acknowledgement/review, assessment work/moderation and safeguarding
reports. The canonical Requests queues are not arbitrarily truncated. More shows one
quiet descendant indicator, each affected module shows the strongest relevant state,
and Requests orders work as Urgent, Next and Later. Every row carries a stable URL to
the owning record rather than ending at a generic dashboard.

Destination pages consume those record identifiers and open, scroll to or focus the
specific item. This includes follow-ups, registers, notice recipient state, diary,
leave, events, feedback, report batches, care cases, assignments and cover, transport,
fees, policies, assessments, attendance reconciliation and student concerns. A new
principal student-leave review route supplies the previously missing exact decision
surface. Shared school events invalidate both Requests and attention so an open queue
cannot drift after a mutation.

The exact-link audit now covers every emitted destination family, including later
revisions and historical records. It corrected deep links for diary dates, event
RSVP/consent/payment/checklist sections, notice exceptions, follow-ups outside the
first page, attendance-reconciliation cases outside the first 50 rows, completed
journey reconciliation and decided staff workflows. Bottom navigation shows the same
owning-module state for Attendance, Timetable/Calendar, Diary, Messages and
Safeguarding where those modules are directly reachable; More remains an aggregate,
not a competing counter. Projection queries and exact-focus APIs do not impose UI
page caps. If an attention query, child scope or exact target cannot be authorized and
loaded, the interface shows a compact unavailable/retry state instead of a false
all-clear and does not acknowledge the linked notification.

Notice attention is revision-aware. Publishing, cancelling, opening and responding
update the recipient projection and its linked bell notification; a cancellation or
later notice revision becomes new even if the recipient opened an earlier revision.
Delivery failure and overdue response remain exception/action signals. Migrations
062–079 add revision/audit support, authorized realtime delivery, current-scope replay
checks, cross-portal cancellation and exact safeguarding/departure/staff workflow
links. The frozen audiences are narrow and replay re-checks current assignment,
enrolment, guardian, active-profile and administrator authority so stale relationships
cannot retain access. All 18 migration files have matching local ledger checksums and
are applied to the local development database; migration 079 also passed against an
isolated clone before that clone was removed. The repository still has unrelated
pre-existing clean-replay blockers in older migrations, so a fresh full migration
replay remains a release gate.

Duplicate outcomes are suppressed at projection time: staff response rows replace
their pending assignment/cover rows, and an event-owned invoice replaces the generic
fee obligation for the same payment. A resolved source remains reachable for audit,
but current authorization and the exact source revision must match before its delivery
is acknowledged. Staff and transport producers emit typed, revisioned links rather
than generic module alerts.

Local verification includes backend typecheck/lint/build and **187 focused backend
unit/contract/migration tests**; the complete frontend suite passes with **845 tests
across 118 files**; canonical frontend source typecheck and lint pass; and a production
Vite build succeeds. The repository-wide TypeScript wrapper still includes unrelated
untracked duplicate `* 2.tsx` test files whose matcher declarations conflict, so that
wrapper remains red while the canonical source check is green. Earlier authenticated
read-only parent/teacher/principal API smoke checks passed. Full release CI, Stage
deployment and physical phone validation of the complete drill-down chain remain
acceptance gates; this section does not claim those gates have passed.

### Staff-cover deadline and automatic fallback — 13 October 2026 (local)

Approved staff leave no longer leaves past cover tasks indefinitely in the live queue.
Migration 080 adds a school-scoped, revisioned cover policy with a bounded deadline and
typed fallback choices: independent study, physical activity, library period, merged
class or cancelled period. A school may optionally name an active staff profile as the
responsible fallback contact. The principal can edit these settings under Staff →
Settings, and the same capability is exposed through the reviewed agent tool contract.

The application reconciles deadlines both in a background worker and before returning
the staff workspace. Pending tasks are claimed with row locks. An enabled policy records
`fallback_applied`, the exact policy revision and any named supervisor; this is explicitly
an administrative fallback decision, not proof that the activity was delivered. Without
an enabled policy, a period found after it ends is closed as `expired_unconfirmed` in the
audit trail. Resolved and past tasks never reappear in the live cover queue, and historical
cleanup does not create new unread notification badges. The approved leave record instead
summarises the recorded decision (`covered`, or the named fallback) alongside its counts.

The Cambridge review school now uses a 30-minute Independent study fallback. Its six
7–8 October historical gaps retain their original unconfirmed audit entries and now also
carry the explicit `Independent study` fallback decision requested for the demo. Migration
081 records that transition, preserves the audit chain and marks the superseded unread
alerts read. No historical classroom delivery was asserted. The policy can be changed to
Games / physical activity or another supported fallback in the UI.

Verified locally: migrations 080–081 executed transactionally and their ledger checksums
match; backend typecheck/lint/build pass; 398 non-database backend tests and all 37
agent-contract tests pass; the staff workflow passes 10/10 API/database integration
tests on a disposable clone; the complete frontend suite passes 848/848 tests across
118 files; canonical frontend source typecheck/lint and the production Vite build pass.
The all-backend convenience command also selected 12 integration suites without the
required disposable-database environment, and those suites correctly refused to run;
this is not represented as a full integration pass. Stage deployment and physical
mobile review remain release gates.

### Staff leave queue hierarchy refinement — 13 October 2026 (local)

The principal Staff → Leave workspace now treats submitted leave as the decision
queue and decided leave as history. Only submitted requests render as expanded action
cards. Approved, rejected and withdrawn requests render as compact, keyboard-accessible
disclosures and expand on demand; an exact deep link opens the targeted decided record.
The queue header has one heading (`Leave requests`) and its count refers only to pending
work. The coverage panel likewise has one heading (`Leave coverage`); its open count and
empty state communicate operational status without a second headline. An explicit
responsive layout gap separates the leave inbox and coverage panels on mobile.

Verified locally: the focused Staff Operations component suite passes 17/17,
the complete frontend suite passes 848/848 across 118 files, canonical source
typecheck and focused lint pass, and the production Vite build succeeds. Physical
phone review remains required before treating the spacing as accepted.

### Attendance attention provenance — 13 October 2026 (local)

The Attendance navigation indicator and the register workspace now consume the
same authorized attention projection. The workspace gives the signal one compact
plain-language explanation, exposes a **Needs attention** filter, orders affected
registers first and places one small, tone-matched marker beside each exact affected
class. Routine cards do not acquire decorative dots. Exceptions remain red, action
required remains amber and new information remains blue; text status remains the
authoritative cue so meaning never depends on colour alone.

Attention is deliberately narrower than the daily plan. An unsubmitted register is
ordinary planned work until the institution's configured attendance submission
cutoff; only then does it enter Requests/Attention. Saved schedule or assignment
mismatches remain immediate exceptions. Reconciliation and follow-up items that do
not belong to a visible class card are counted once in the compact summary and retain
their exact workflow link rather than being copied onto unrelated cards.

Submitting, locking, reopening or reconciling attendance invalidates the shared
attention projection immediately and is also propagated through the transactional
school event. Because the projection is recomputed from current register/review state,
resolving the last underlying item removes its card marker, module indicator and
aggregate More indicator; merely opening the page does not clear operational work.

Verified locally: backend typecheck/build and focused Requests/Attention suites pass
**97/97**; frontend Attendance/attention-navigation suites pass **22/22**, and the
complete frontend suite passes **850/850 across 118 files**. Focused frontend/backend
lint, canonical frontend source typecheck and the production Vite build pass. The
repository-wide frontend wrapper remains blocked only by the already documented
untracked duplicate `* 2.tsx` test files. Both local and Cloudflare readiness report
database and events healthy. Physical phone validation of the hierarchy and density
remains required.

### Attendance submission transport repair — 13 October 2026 (local)

The continuity client now preserves the complete server-issued roster proof when it
submits a class register. `roster_captured_at` and `snapshot_token` were assembled by
the route but omitted from the HTTP body, causing the backend schema to reject every
otherwise complete register before the command reached attendance domain logic. The
client-side contract now also refuses to send unless all five continuity fields are
present: observation time, roster fingerprint, capture time, expiry and snapshot token.

A focused transport regression test asserts the exact signed request body. The API and
register component tests pass **17/17**, the complete frontend suite passes **851/851**
across 118 files, focused lint passes and the Vite production build succeeds. The existing backend continuity integration case already exercises the
same complete contract; a fresh isolated replay was attempted but the repository's
current migration chain stops after migration 032 on an unrelated SQL syntax error, so
that replay is not represented as passing in this evidence.

### Navigation and Back contract — 13 October 2026 (local, not deployed)

The shared portal app bars now distinguish navigation history from transient view state.
Opening a record, editor or workflow remains a semantic drill-down and adds a history entry;
changing a date, tab, filter, selected child or other in-page view replaces the current entry.
Back first returns to the observed same-portal semantic predecessor. A direct link, reload or
missing predecessor instead replaces the current route with the role-specific canonical parent,
so fallback navigation cannot create a list/detail/list loop or cross into another portal.

Requests and notifications attach a validated, same-portal return location to exact-item links.
The title bar uses that provenance when present and rejects external, protocol-relative and
cross-role targets. Canonical parents are role aware: principal Insights and timetable,
teacher timetable, parent timetable and student Copilot no longer inherit a generic hierarchy.
Account Profile/Security and Operating rules retain their actual origin chain rather than always
returning to a fixed More page.

Selected-child changes preserve harmless list context but remove record, revision, workflow and
attention identifiers that belong to the previous learner. Notices and Events carry their current
list view through detail, editor and event-register routes. Attendance uses the shared Back path
while retaining its unsaved-change confirmation; cancelling that confirmation leaves the user on
the register. Loading and unavailable states in the corrected restricted-care flow retain the same
portal shell and safe Back destination.

Focused local suites were run separately as the work landed: **17/17** provenance,
Requests and notification checks; **83/83** student-context checks; **88/88** URL-state checks;
and a later **143/143** shared navigation, account, attention, notices, events, restricted-care,
assistant and attendance regression. Query-backed invitation, leave, people, import, fee and
governance close/success behavior passed **65/65** focused checks. The reusable unsaved-work guard
and its day-plan/attendance integrations passed **44/44** focused checks. These sets overlap and are
not presented as a combined regression count. Focused lint, a canonical-source TypeScript check
(excluding the already documented duplicate scratch files), the production Vite build, and local
plus Cloudflare readiness pass. Full repository regression, physical phone/edge-swipe validation
and any Stage or cloud deployment remain open; this section records local implementation only.

### Leave-cover operating-rule presentation — 13 October 2026 (local, not deployed)

The administrator's Leave cover rule now uses one grouped settings surface instead of
nesting a second bordered form inside a generic staff panel. The page has one heading,
one concise explanation, an accessible platform-style switch, four clearly named rule
rows and one primary save action. Secondary explanation is reduced to a single neutral
note; it no longer competes with the controls or creates another visual section.

The existing operating-rule API, revision check, authorization and audit behavior are
unchanged. A successful refresh remounts the editor at the returned policy revision so
the switch and other uncontrolled inputs cannot display stale values after a save.

Verified locally: the focused Operating rules, navigation and Staff Operations suites
pass **21/21**, focused lint passes and the production Vite bundle succeeds. The canonical
TypeScript build remains blocked by the already documented untracked duplicate
`* 2.tsx` test files; no Stage deployment was requested. Physical phone review remains
required before treating the new spacing as accepted.

## Configurable attendance models — 14 October 2026 (local, not deployed)

The attendance foundation now separates three concerns that were previously conflated:

1. **Academic register scope** is configured as one class register per day, one register per
   scheduled subject/session, or no academic register.
2. **Campus presence** is independently configured as unused, entry only, or entry and exit.
   A gate or biometric event never silently becomes evidence for every subject lesson.
3. **Evidence channels** are configured independently for academic and campus attendance.
   Academic channels include staff roll call, learner QR, camera-assisted review, registered
   biometric-device assertions and paper/offline capture. Campus channels include staff entry,
   QR, camera-assisted and biometric-device assertions.

This implements the blueprint's capability-profile direction rather than choosing a permanent
institution-type shortcut. The research basis includes the Ministry of Education's ordinary
student roll-call model and mobile/offline implementation, the Government BACALS example of
twice-daily biometric presence, UGC/college rules that measure lecture/tutorial/practical
attendance, and institution examples that record attendance after each lecture or separately by
subject. The privacy boundary follows the DPDP child-data consent requirements; Aadhaar biometric
storage or matching is deliberately not part of this implementation.

`086_configurable_attendance_models.sql` adds institution operating-rule fields, timetable-linked
session registers, per-learner entries, idempotent submissions, immutable revisions, evidence,
short-lived hashed QR challenges and an audit journal. Scheduled-subject mode materializes one
register from each effective published class period and snapshots the subject, period, room and
scheduled teacher. The Attendance list uses the subject as its primary label with class, period and
teacher context. The existing daily tables remain intact for institutions choosing daily mode and
for historical records.

`087_attendance_session_lifecycle.sql` brings subject registers under the same configurable
finalization contract as daily registers. Automatic mode is processed by the shared leased
background worker; principal-review mode exposes authorized finalize and reasoned-reopen commands.
Both paths preserve the acting user, timestamp, policy revision and audit event. Session submission
stores its idempotent response inside the same database transaction, and an automatically accepted
learner QR assertion creates an immutable entry revision rather than only changing the current row.
Principals can inspect that change history from the existing register review surface.

Full-roster session submission rechecks active membership, exact scheduled/explicit attendance
authority and the current roster inside the write transaction. It applies optimistic revision and
idempotency checks, records changes and their reasons, snapshots automatic-finalization settings,
and recomputes subject-attendance totals from submitted/final session facts. Learner QR check-in
uses a short-lived random token stored only as a SHA-256 hash, verifies current enrollment and the
institution's configured before/after window, and either records presence or creates pending
evidence according to the configured resolution rule. Existing staff decisions are never silently
overwritten by learner QR.

Verified locally: migrations 086–087 were applied directly because the repository's migration runner
still stops on the previously documented checksum drift in applied migration 047. Backend build
and focused lint plus all **23 operating-rule tests** pass; the rollback-only database checks exercised a 25-learner
subject-register submission and automatic QR self check-in without retaining test changes.
Disposable local records also verified manual finalize/reopen and leased automatic finalization,
including lifecycle state, revision, source and lock timestamp; those records and their audits were
removed after verification.
Focused operating-rule, attendance-list and register UI coverage passes **32/32**. The local
workspace returns **40** scheduled-subject registers for 14 October and a 25-learner Hindi session
for Class 6A. The principal's scheduled-session workspace now presents that volume as a compact
register navigator rather than forty full cards: search is persistently available, periods and
classes are alternate grouping dimensions, one relevant group is disclosed at a time, and each
row retains subject, class/period, teacher, completion and exact-register navigation. Attention is
placed only on its exact session when the attention link carries `session_id`; daily-register
attention remains class scoped. Teacher and daily-register presentation is unchanged.

Future-date navigator summaries now follow the register's authoritative `date_open` state. A future
collection is labelled `Upcoming`; its groups report scheduled sessions and its rows report roster size,
so zero completed submissions cannot be mistaken for submitted attendance. Submission and marked-count
language appears only after the selected date is open.

Open-date summaries are action-oriented rather than denominator-oriented: the collection and each
group report the remaining `Pending` count, and untouched subject rows use the same `Pending` label.
`Submitted` is reserved for collections, groups and rows that contain completed submissions, removing
the previous `0/8 submitted` versus `Not submitted` wording conflict.

The focused workspace suite passes **15/15**, the seven attendance regression files pass **60/60**,
and focused lint passes. Responsive browser review at
390 × 844 confirms the 40-register period and class views remain within the viewport, with one
expanded group and compact rows. The complete frontend TypeScript/build wrapper remains blocked
only by the already documented duplicate `AgentChart.test 2.tsx` and
`AccountProfilePage.test 2.tsx` files; the unrelated `WorkflowRules.test.tsx` lint issue also remains.
Physical iPhone review remains required.

Not yet represented as complete: camera/biometric provider onboarding, signed device identities,
provider-health monitoring, campus entry/exit writes, and the staff evidence-review screen. The
database/API contracts reserve these evidence types, but no hardware observation is accepted as a
fact until those adapters and release checks exist.

### Gemini-assisted camera attendance — 14 October 2026 (Stage pilot deployed and verified)

The user explicitly requested a Stage camera-attendance pilot after the blueprint baseline had kept
biometric provider onboarding out of scope. This is a material, Stage-only deviation: reference face
embeddings and encrypted thumbnails are processed for an authorized demo class, and a labelled
comparison sheet is sent to Vertex AI. It must not be represented as a production child-biometric
rollout. Production use still needs the institution's documented purpose, appropriate guardian/data
authority, retention/deletion procedure, provider review and a non-biometric path.

The implemented workflow is deliberately assistive rather than authoritative. OpenCV YuNet/SFace
detects and embeds faces locally inside the private inference service; Vertex
`gemini-3.1-flash-lite` receives one labelled comparison sheet and returns schema-constrained match
proposals. The model cannot mark absence, submit/finalize a register or override an existing staff
decision. Every learner remains visible in the ordinary register and every proposal must be reviewed
before the existing audited submission command accepts it. Model/provider failure falls back to the
manual/embedding register instead of blocking attendance.

Scheduled-subject registers now carry their exact session ID through setup, reference enrollment,
analysis, review and submission. Accepted camera evidence is attached to the immutable subject
submission and student-entry revisions; unmatched or manually changed rows retain staff-roll-call
provenance. The sidecar uses keyless Vertex credentials, encrypted Cloud SQL fields for templates and
analysis results, shared-secret authenticated private endpoints, one concurrent CPU worker, seven-day
analysis retention and non-refundable request reservations capped at 60/day and 1,000/31 days. No
GPU is provisioned. The Stage pipeline builds and deploys the sidecar separately, runs migrations
first, verifies its public health-only endpoint, then injects only its URL and Secret Manager token
into the main candidate revision.

The user-supplied group image contains 14 detectable adults. The user approved an identity-preserving
headshot contact sheet; its 14 portraits are assigned to the first 14 Class 7A demo learners while the
remaining 11 learners exercise manual review. A live local Vertex smoke used those approved portraits
against the original group image and returned 14 detections and 14 reviewed-present proposals from
`gemini-3.1-flash-lite`. This is a fixture connectivity/contract result, not an accuracy, fairness,
liveness or production-readiness claim. Sidecar tests pass **15/15**, focused attendance UI tests pass
**32/32**, focused backend photo/operating-rule tests pass **24/24**, backend build/typecheck, focused
frontend lint, seed generation and eight release-contract tests pass. Stage deployment, authenticated
profile enrollment and physical-phone acceptance remained pending at that checkpoint.

Stage release rehearsal exposed that Cloud Run reserves the standard `Authorization` header even on
an otherwise public health endpoint. The inference contract now uses the dedicated
the existing internal inference-token header so the Secret Manager credential reaches the application unchanged;
the public surface remains limited to `/api/health`. This correction passed the 15 sidecar tests and
backend typecheck. The first Stage enrollment then exposed a PostgreSQL-only nullable-parameter
ambiguity in the provider roster query; the durable store now uses separate filtered and unfiltered
queries instead of passing an untyped `NULL` parameter.

Stage run [38462793920](https://github.com/EduveraIITA/Eduvera/actions/runs/38462793920)
passed the complete backend, isolated-PostgreSQL, mobile (**926 tests**) and desktop gates and deployed
release `75133ddd36d7269fe1015a00441160f2e33bd8ff`. The sidecar query correction was then built as the
immutable image digest `sha256:ee450f5d2043d1468fb1379b528d3c0cfbbcdae878c9b841ee56c8746c98a231`
and promoted to the bounded `eduvera-stage-photo` service. The internal token was rotated to a
newline-free Secret Manager version after the original provisioning command was found to have stored
its trailing newline; both services are pinned to the same corrected version.

An authenticated principal Stage check enrolled the 14 user-approved Class 7A portraits and analyzed
the original group fixture with Vertex `gemini-3.1-flash-lite`: 14 faces were detected, 13 learners
were proposed present and 12 of the 25-learner roster remained for review (the 11 without reference
profiles plus one uncertain enrolled learner). The analysis was saved as a seven-day review draft;
**no attendance was submitted or finalized**. This verifies the live workflow and safety boundary,
not identity accuracy, liveness, fairness or production readiness. Physical-phone visual acceptance
remains required.

### Attendance follow-up interaction refresh — 14 October 2026 (local)

The principal follow-up destination now follows the established single-heading and progressive-
disclosure rules. The page-level app bar remains the only title. Open/Resolved is a compact native-
style segmented control, and each conversation is a separate touch-sized task card with the student,
attendance date, responsible owner, plain-language state and one restrained overdue cue. The full
question and response controls remain available only after the user opens the exact card, removing
internal fixture prose and competing status pills from the scanning view without changing the
follow-up contract, authority checks or resolution workflow. Loading, empty, error and selected-
attention states remain explicit; reduced-motion and keyboard focus treatment are preserved.

Focused coordination tests pass **8/8**, focused lint passes, and isolated TypeScript validation of
the changed component graph passes. The complete frontend TypeScript wrapper remains blocked by the
previously documented untracked duplicate `AgentChart.test 2.tsx` and
`AccountProfilePage.test 2.tsx` files, which were not modified. Physical-phone visual acceptance and
Stage deployment remain pending at this checkpoint.

The first Stage run reached the full mobile route suite and exposed two existing timing-sensitive
assertions under shared CI load: the parent More attention link used the query library's one-second
default, while the two month/year timetable cases inherited the suite's 15-second ceiling. Their
behavior was already correct and the focused cases passed locally; the tests now use explicit bounded
waits appropriate to those asynchronous screens. The affected route cases pass **3/3** locally.

Stage run [38510889856](https://github.com/EduveraIITA/Eduvera/actions/runs/38510889856)
then passed the complete backend, isolated-PostgreSQL, mobile and desktop gates. Google Cloud promoted
revision `eduvera-stage-00081-fuw` and verified commit
`43dda491b526647b2bc629776f831d5b78c4adce` on the public service. Physical-phone visual acceptance
of the refreshed follow-up list remains required.

### Provider-neutral assistant channels — 14 October 2026 (Telegram live on Stage)

The assistant can now use a verified external messaging transport without creating a
second agent or bypassing the application's controls. Migration
`091_agent_messaging_channels.sql` adds private, backend-owned connection, one-use
link, idempotent webhook-queue and metadata-only delivery tables. Telegram is the
first adapter behind a provider registry; WhatsApp is an explicit adapter seam rather
than a second hard-coded conversation path.

A signed-in Pro user starts a short-lived connection from Profile. Telegram's private
`/start` update consumes the token once, links one Telegram user to one current
ThatCampus owner/provider pair and creates a normal owner/school/portal/child-scoped
agent thread. Raw link tokens are hashed before persistence, webhook requests require
Telegram's secret header, duplicate provider updates are ignored and completed
transport text is erased. The existing agent service revalidates the active account,
school membership, selected child, role permissions, Pro preference, tool catalogue,
per-user allowance, model budget and pending-action state on every turn. External
channels do not receive direct write authority: reviewed actions link back to the
exact in-app conversation for the existing preview/revalidation/confirmation flow.

The shared profile surface lists configured connections and supports disconnect. It
is hidden with the rest of Pro AI when the Pro preference is off. Deep links select
the exact channel thread in the existing Assistant UI. The transport worker uses the
same leased PostgreSQL and continuously allocated single-instance Stage runtime
assumptions already enforced for background events; when no provider is configured,
the worker does not poll the database.

Verified locally: backend typecheck/build and focused provider/delegation tests pass;
the frontend connection tests and production build pass; the nine-table agent storage
isolation check passes against a disposable loopback schema clone. Migration 091 was
applied to the local development database only. A clean-database rehearsal still stops
on the pre-existing SQL error after migration 032, and the ordinary local runner still
stops on the pre-existing checksum drift in applied migration 047; neither historical
migration was changed.

The existing Telegram bot's token and webhook verification secret are
held only in Google Secret Manager and are exposed to the capped Stage runtime through
secret references; the release contract fails closed if either value becomes plaintext
or automatic verified webhook registration is disabled. Stage workflow
[38540126927](https://github.com/EduveraIITA/Eduvera/actions/runs/38540126927)
passed the full repository secret scan, backend, isolated PostgreSQL, mobile and desktop
gates, then migrated, smoke-tested and promoted commit
`321bc2526e442ca747497980dfc6cedc47f244fa` as revision
`eduvera-stage-00087-xew`. Public release and readiness checks report that commit with
database/events ready. Telegram `getMe` verifies the bot, `getWebhookInfo` reports the
canonical `/api/v1/agent/channels/telegram/webhook` URL, zero pending updates, no last
error and message-only delivery, and the live revision logs confirm successful webhook
registration. The service remains one CPU / 1 GiB, min/max one, with CPU always allocated;
no additional always-on service was added. A real user still needs to complete the
Profile connection and private-chat round trip as physical-device acceptance. A future
WhatsApp adapter requires its own Meta account, webhook verification, policy review and
template/24-hour-window handling while retaining this same application-owned identity
and action contract.

### Provider-independent calendar export and subscription — 14 October 2026 (Google Cloud Stage)

Users can now take the role-aware ThatCampus calendar into an installed calendar application
without granting Google, Microsoft or Apple API access. An authenticated export returns a
standards-based `.ics` snapshot for the selected portal/child. A separate private
subscription URL provides a continuously refreshed, read-only projection for calendar
applications that support web calendar subscriptions. ThatCampus remains the source of truth;
external calendar applications receive no command path back into attendance, assessments,
events or school configuration.

Migration `092_calendar_subscriptions.sql` stores one active subscription per
owner/school/portal/child scope. The 256-bit bearer token is returned only when created;
only its SHA-256 digest and a six-character display hint are retained. Replacing or
disconnecting immediately revokes the previous feed. Every fetch revalidates the active
account, school membership, portal and guardian/student relationship before producing a
feed. The projection includes non-instructional school dates, the learner's or teacher's
effective timetable (including published dated changes), visible campus events and
permission-scoped assessments. Principal feeds deliberately omit every classroom period
to avoid turning the leadership calendar into thousands of low-value entries. Event
descriptions are minimized and direct the user back to ThatCampus for current details.

Profile now exposes Calendar sync independently of the AI Pro toggle. It supports
one-year snapshot export, subscription creation, one-time open/copy actions, last-fetch
health, confirmed link replacement and confirmed disconnect. The implementation uses
stable iCalendar UIDs, revisions, explicit cancellation, exclusive all-day end dates,
UTF-8-safe line folding, UTC event times and the school's IANA timezone metadata.

Verified locally: backend build/typecheck and focused lint pass; iCalendar format tests
pass **2/2**; Profile/calendar interaction tests pass **6/6**; the complete frontend suite
passes **930/930** and the Vite production build passes. All runnable backend unit tests
pass (**432 passed, 184 skipped**); the remaining integration files correctly refuse to run
without the repository's isolated `DATABASE_URL`. The complete frontend TypeScript wrapper
remains blocked by the previously documented untracked duplicate test files and was not
represented as passing locally. Migration 092 has also been applied to the local development
database.

Stage workflow [38550372652](https://github.com/EduveraIITA/Eduvera/actions/runs/38550372652)
passed the repository secret scan, deployment-contract checks, clean PostgreSQL migration,
backend integration suite, complete mobile checks and desktop build. The migration execution
completed successfully, the no-traffic candidate passed its checks, and commit
`436889dac5119b31b8d8b03a1b840f3c02f1ddde` was promoted as Cloud Run revision
`eduvera-stage-00091-jog` with 100% traffic. Independent public `/releasez` and `/readyz`
checks report that exact commit with database/events ready. Installed-calendar/physical-phone
acceptance remains open because a real calendar client must consume the private subscription.

### ThatCampus product identity and domain transition — 14 October 2026 (historical checkpoint)

This section records the pre-release checkpoint. The later release entries below
supersede its pending gates with verified Stage and public-domain evidence.

The approved customer-facing product identity is **ThatCampus**, the canonical domain is
`thatcampus.com`, and the tagline is **“Not just any campus. That campus.”** Mobile, desktop,
browser/PWA metadata, authentication and onboarding copy, transactional email, receipts,
calendar exports, assistant language, documentation and package display names now use the
new identity in the working tree. The complete two-line lockup extracted from the approved supplied
artwork replaces the prior product mark, with separate opaque light- and dark-background versions,
beside each institution's own crest; school identity, navigation and the established interface
theme remain unchanged.

Compatibility identifiers that are not shown to customers have deliberately not been renamed:
the existing Google Cloud project, Cloud Run services, Artifact Registry, Cloud SQL resources,
GitHub repository, database columns, signed-token labels, telemetry keys, legacy email asset URL
and stable iCalendar UIDs continue to use their deployed identifiers. Renaming those values is a
separate infrastructure/data migration, not a visual rebrand. The old invitation image route is
retained only for messages that have already been sent; new messages and receipts use the
ThatCampus mark.

A repository-wide public-surface audit now covers the mobile and desktop source trees, browser
metadata, backend-generated customer messages and the photo-attendance service. It corrected the
remaining institution-onboarding message and added an automated regression check that rejects the
retired OmniSchool/Eduvera/Eduera/Edura/Edera/Educera names in customer-facing source. The guard
also asserts the approved name and tagline remain on authentication, install-manifest and invitation
surfaces. Explicitly allowlisted legacy inference headers and already-sent email asset URLs remain
unchanged as compatibility contracts; database/resource names, stable calendar UIDs, storage keys,
event channels and deployed infrastructure identifiers are likewise not presentation branding.

Google Search Console ownership of `thatcampus.com` is verified for the deployment account and
the verification TXT record resolves publicly. Direct Cloud Run domain mapping was attempted and
correctly rejected by Google because the current Mumbai region (`asia-south1`) is not supported by
the preview mapping product. The user selected **Cloudflare Free** as the public edge. A versioned
Worker now proxies the apex to the existing Mumbai Cloud Run service, redirects `www` to the apex,
preserves paths, queries, request bodies and streaming responses, rewrites only origin redirects,
and rejects unknown hosts. Release checks accept the custom domain only when explicitly requested.

The Cloudflare Free account is authenticated through Wrangler with only user/background access,
Workers route/script write and zone read scopes. The `thatcampus.com` zone has been created and its
six public records were independently compared with Cloudflare's import: two parked apex A records,
the `www` and `_domainconnect` aliases, Google verification TXT and DMARC TXT are preserved. The
tested Worker is uploaded as `thatcampus-edge` (version
`bb8f5238-7ebf-4f10-9394-648bbce0032f`) and its non-destructive zone routes are deployed for
`thatcampus.com/*` and `www.thatcampus.com/*`; zone routes were chosen after custom-domain setup
correctly refused to replace the imported apex records.

The registrar owner replaced the GoDaddy delegation with `diana.ns.cloudflare.com` and
`elijah.ns.cloudflare.com`; ICANN Registry RDAP reports that exact delegation and records the
change at 15:11:29 UTC. Cloudflare activated the zone shortly afterwards. Its authoritative server
and the `1.1.1.1` resolver return the live Cloudflare edge addresses, while `8.8.8.8` and the local
resolver were still returning the previously cached GoDaddy parking addresses at the activation
checkpoint. This is resolver propagation, not an application or Worker failure.

Bypassing the stale local resolver verifies the live edge end to end: HTTPS `/` returns the app with
HTTP 200 through Cloudflare, `/readyz` returns HTTP 200 from the Cloud Run origin, and HTTPS `www`
returns the intended 308 redirect to `https://thatcampus.com/`. The public domain is therefore live,
although individual devices may temporarily see the old GoDaddy site until their recursive DNS
cache expires. API, deep-link, Assistant streaming, file-upload, Telegram-webhook and calendar-link
release checks remain open; only after those pass should Cloud Run canonical URL/origin settings
and the webhook be switched.

Verified locally at this checkpoint: backend TypeScript build, mobile Vite production build,
desktop TypeScript/Vite build, deployment-contract tests (**10/10**), Cloudflare edge tests
(**5/5**), focused backend email, receipt, calendar and assistant-channel tests (**24/24**) and the
public-brand regression guard (**3/3**) pass. Mobile route, account-profile and onboarding checks
pass **87/87** when run as focused suites. The complete mobile TypeScript/build wrapper remains
blocked only by the already documented untracked duplicate `* 2.tsx` test files; the production
Vite build itself succeeds. Stage deployment and physical-device brand acceptance remain pending.
## Gate & Safety — 14 October 2026

User-directed first release: a non-technical gatekeeper workspace at `/gate`, with
three large actions (Scan QR, Find Student, Visitor Entry), account-and-institution
scoped Hindi/English preference, and explicit identity confirmation. New
`gate.manage` (Manage In & Out) is institution scoped and excluded from default
teaching permissions. Admins can provision a non-teaching gatekeeper with a random
initial password and one direct Gatekeeper assignment; no teaching, finance,
collection-authority management or approval permission is granted.

Opaque QR passes store only hashes. Student passes identify entry; single-use
15-minute pickup passes require today's current ready departure plan. Confirmation
rechecks the school, plan and current collector authority under the existing
school departure lock, then atomically records the handover, completes the plan,
consumes the pass, saves the gate observation and queues guardian notifications.
Gate movement never writes classroom attendance. Visitor requests require admin
approval before entry; approved visitors have QR passes with ordered check-in and
checkout. Admin QR generation and visitor approvals are available under
Principal → More → Gate & Safety; guardians can display their own pickup QR in
Transport & departure. Other collectors need an office-issued pass.

Verified locally: all 93 numbered migrations (including duplicate-numbered
existing migrations) applied to a disposable PostgreSQL WASM database with pg_trgm;
seven database lifecycle/authorization tests and five QR/movement rule tests pass.
Frontend gate, More grouping and permission-scoped navigation tests pass. Backend
and frontend typechecks, builds and lint pass. Native PostgreSQL CI passed all 793 backend tests, including the seven gate
lifecycle tests, and all 934 mobile tests; desktop typecheck/build passed.
Physical phone camera and accessibility review remain pending. Offline release, staff movement,
vehicle/bus gate scans, historical corrections and configurable gate policy are
outside this first release; no release is authorized from cached offline data.

Stage release evidence: PR [#27](https://github.com/EduveraIITA/Eduvera/pull/27)
merged as `a58155193a8658b14704b1e549c0988870d9ffa1`. Stage workflow
[38569760911](https://github.com/EduveraIITA/Eduvera/actions/runs/38569760911)
passed verification and Google Cloud deployment. The migration job completed,
candidate revision `eduvera-stage-00094-xid` passed checks, and public release
verification confirmed that exact SHA. Live gatekeeper account creation and
signed-in UI review were not performed: automatic approval review rejected the
principal browser sign-in needed for privileged account provisioning. The account
creation workflow is implemented and covered by the native database tests;
explicit principal sign-in authorization is needed to complete the live review.

## ThatCampus public website — 14 October 2026

The user's explicit marketing brief adds a separate React/Vite/TypeScript website
in `marketing/`, with runtime-configurable existing Eduera Login, prerendered SEO
pages and labelled illustrative product previews. This is a sales enquiry flow,
not the institution pre-admission pipeline. PostgreSQL migration 094 adds enquiries,
shared rate buckets and notification outbox. Existing company operators review
enquiries in /company; school membership does not grant company access. Email uses
the existing backend transport and an explicitly configured MARKETING_NOTIFY_TO.
Local marketing TypeScript, lint, build and seven HTTP/security tests pass. Real
PostgreSQL/browser CI, backend checks, Cloud Run public verification and DNS/HTTPS
remain release gates until their actual workflow evidence is recorded. Payments
are disclosed as sandbox; university suitability is not advertised as implemented.
See [deployment and verification](../marketing/DEPLOYMENT.md) for the separate
service workflow and the remaining account/domain prerequisites. Existing app
authentication and dashboards are preserved.


## Direct Stage gatekeeper entry — 14 October 2026

The user approved the review gatekeeper and explicitly requested direct database
creation after declining browser authentication. The bounded private-job route,
its schema-job execution exception, least-privilege checks and encrypted delivery
are recorded in [GATEKEEPER_PROVISIONING.md](GATEKEEPER_PROVISIONING.md). Local
contracts and actual SQL/encryption validation pass; live creation is pending
execution of the authorized maintenance marker.
## Branded public routing and Stage release — 14 October 2026

`thatcampus.com` now fronts the separately deployed marketing service and
`app.thatcampus.com` fronts the school application through the checked-in
Cloudflare Worker contract in `deploy/cloudflare/`. The homepage login contract,
marketing runtime fallback and Stage deployment verifier use the branded app URL.
The Worker preserves `Origin` for API authorization while removing it only from
static app asset origin fetches, preventing Cloud Run CORS handling from blocking
the browser bundle. Seven Worker contract tests pass and the live homepage-to-login
flow was browser-verified. The existing Stage workflow remains the single push
gate: every successful `Stage` push builds, verifies and promotes both Cloud Run
services, which the stable Cloudflare routes expose without a per-release edge
deployment.

## Stitch marketing homepage — 14 October 2026

The uploaded blue/indigo platform-1 Stitch design is implemented in marketing/: centred hero, operating dashboard, feature cards, five stakeholder cards, desktop/mobile preview and the existing persistent demo form. Original transparent brand.png and local SVG icons are used throughout; no emojis or Tailwind CDN. Typecheck, lint, eight server tests and production build pass. Chromium checks passed at 320, 360, 768, 1024 and 1440px for overflow, logo, navigation, dashboard controls and legal routes. Real PostgreSQL form verification and live release are pending Stage CI.


### Gatekeeper direct Stage account retry — 14 October 2026

The live private database job successfully verified `gatekeeper.review` with only institution-scoped `gate.manage` after full Stage Verify checks. Workflow 38609626549 / execution `eduvera-stage-migrate-g7qrk` completed the account operation but failed afterward because Cloud Logging denied encrypted-result retrieval. Credential delivery is pending; do not claim it complete or reset an existing password. Runtime origin and maintenance queue corrections are in PRs #32 and #33. Full evidence and the precise blocker are in [GATEKEEPER_PROVISIONING.md](GATEKEEPER_PROVISIONING.md).

## Last Stitch variant selected — 14 October 2026

User correction: use the last uploaded UI variant, `thatcampus_education_management_platform_2`, superseding platform_1. Marketing now follows its monochrome centred hero, italic Connected headline, three-column feature cards, institution solutions, horizontal role selector, sample dashboard and dark sales banner. The no-emoji rule is retained and the replacement logo is supplied by the shared full-mark asset described below. Typecheck, lint, eight server tests, production build and five-viewport local browser checks pass. Live release and PostgreSQL CI verification are pending.

The shared visual identity now uses the exact user-supplied full ThatCampus mark
through a cache-busted asset on the marketing header, previews, application school
header, authentication surface, browser favicon and install metadata. The prior
Eduvera leaf is no longer referenced by rendered product branding. Marketing and
application production builds, focused UI tests and desktop browser screenshots
were verified before release.

Verified last-template release: Stage run 38614406544 succeeded and public thatcampus.com/readyz reports 1588213bc8f1bec52ed9e8cf730328d2087a0471. Public HTML confirms the platform_2 centred hero, feature cards, horizontal role selector and zero emoji characters. Website CI 38613892400 passed five viewports and real PostgreSQL enquiry persistence. The shared backend suite passed after making the lead-time test fixture remain on its service date near midnight; production transport authorization was not changed.
## Principal timetable experience experiment — 15 October 2026

User decision: preserve the established timetable and calendar while the unified,
Teams-inspired timeline is evaluated. The current experience remains the default;
the new interface must not silently replace a proven operational workflow.

- Added **More → Account → Experimental settings** for principals. The timetable
  choice is stored per signed-in user on the current device and is labelled as an
  interface experiment, not an institution operating rule or school policy.
- **Current** retains the existing principal timetable and calendar routes without
  changing their data, navigation or authoring behavior. **Timeline** uses the
  shared schedule data in a proportional day/week canvas with a current-time line,
  positional class and event blocks, free-time planning, month navigation, and the
  existing authorized draft/publication commands.
- The preference controls both `/principal/timetable` and `/principal/calendar` so
  the two destinations cannot present contradictory experiences. Calendar context
  and attention deep-link parameters survive the experimental redirect. Switching
  back changes only the interface; timetable records are not copied or rewritten.
- Kept the experiment principal-only. Teacher, parent and student timetable/calendar
  experiences are unchanged.

Verified locally: frontend typecheck and zero-warning lint pass; production build
passes; 38 focused planner, experiment and More tests pass; 100 tests pass when the
affected application-route suite is included. Stage deployment and physical-phone
acceptance remain open at this point.

## Gate permission in role editor — 15 October 2026

Fixed the institution-context API allowlist omitting `gate.manage`. Migration 093
already allowed it in PostgreSQL and the permission catalogue already registered
**Gate & Safety → Manage In & Out**, but the API's context list hid it from the
role editor and rejected saves/assignments containing it. The API now matches the
database contract. Institution roles can contain gate access alone or combine it
with other explicitly selected institution actions, then be assigned to existing
staff through the ordinary role-assignment flow. No new account is required.
Other contexts still reject gate access; default teaching access does not gain
it, and it does not imply departure-management or collection authority.

The new policy test reproduced the defect (two assertions failed before the
fix); all six assertions pass after it. All 18 staff UI tests pass, including
selecting the Gatekeeper template, seeing the checked action, toggling it and
saving exactly `gate.manage`. Backend typecheck and lint pass locally. Added a
native PostgreSQL HTTP regression for role options, custom-role creation,
assignment to an existing account, gate endpoint authorization, audit evidence
and immediate revocation. All 819 backend tests (including that regression) and
949 mobile tests passed in trusted Stage workflow
[38696887998](https://github.com/EduveraIITA/Eduvera/actions/runs/38696887998), along
with the desktop build. PR [#35](https://github.com/EduveraIITA/Eduvera/pull/35)
merged as `75cadec48984db444f752818893432c7b1e9502b`. The public branded app's
`/releasez` returned that exact SHA after promotion; `/readyz` reported ready with
both database and events OK. Signed-in tablet/phone confirmation of the updated
checkbox remains a user acceptance check; automated role editor and HTTP
assignment/revocation coverage passed.

## Product-led public website — 15 October 2026

User decision supersedes the prior public Stitch variant: use the real product,
Apple-inspired clarity, generous space and restrained screenshot tilt/parallax.
Implemented six real synthetic-demo captures, a four-workflow gallery, image
enlargement, full timetable preview, role-specific storytelling, the exact brand
mark/tagline, responsive dark/reduced-motion handling and the existing persistent
enquiry form. No authenticated-app routes or operational data were changed.

Read the blueprint product-positioning and attendance/calendar/AI boundaries
before writing copy. Experimental timeline and sandbox payment limitations are
disclosed rather than marketed as unconditional capabilities. Legacy brand names
in visible website/legal copy are replaced with ThatCampus.

Local evidence: typecheck/lint/build, ten HTTP/security/deployment tests, real
isolated-PostgreSQL enquiry/outbox browser verification, and six desktop/mobile/
dark visual variants. Full screenshot provenance, refresh scripts and acceptance
scope are in `docs/marketing/PRODUCT_STORY.md`. Stage deployment, live verification
and owner physical-phone acceptance are pending at this checkpoint.

Release evidence: website CI `38697763717` and Stage deployment `38697763736`
passed. Public website and app release endpoints both report
`11077883d2b9bfd63ce641d5ee37d6b67a65defc`. Live desktop/mobile browser checks
passed for the new content, image delivery, layout, gallery/modal, Login and form
configuration. The owner approved the visual direction. Isolated form persistence
is verified; no test lead was sent to production. Physical-device review remains
open. See `docs/marketing/PRODUCT_STORY.md` for audit scores and the nonblocking
Cloudflare analytics/CSP warning, which was not bypassed.

## 15 October 2026 — transparent ThatCampus branding

Replaced the opaque app and marketing logo references with transparent PNG/WebP assets; removed white logo containers. Invitations, payment emails, account emails and PDF receipts share the ThatCampus mark. Email asset v2 avoids immutable-cache reuse; the legacy endpoint remains available for previously delivered emails. Validation and release evidence are recorded in the change commit.

## 15 October 2026 — Stitch surroundings with preserved product showcases

Latest explicit owner brief supersedes the Apple-inspired surrounding marketing
layout: follow `stitch_thatcampus_education_saas_website (1).zip`, use Plus Jakarta
Sans and retain every live product screenshot and demonstration unchanged. This
applies only to the public website. Existing app and authentication are outside scope.

Implemented the Stitch hero, capability cards, school/college/university suitability
sections, four role benefits, contact treatment and navy footer. Existing showcase
functions, animation timings, stylesheet and screenshot files are protected by a
baseline hash regression. No screenshots were captured from the application.

Local typecheck, lint, production build and 11 HTTP/configuration/preservation tests
pass. Browser checks and production release evidence will be recorded in
`docs/marketing/STITCH_RELEASE.md`; do not infer deployment from this implementation
record. A website-only mode in the existing trusted Google Cloud workflow retains
website configuration, tests a no-traffic candidate, promotes only thatcampus-web,
and rolls back website traffic if final verification fails. It never deploys or
updates eduvera-stage, its database migrations, domain or DNS.

## Gate access setup belongs in Roles & permissions — 15 October 2026

Explicit owner decision: gate access is configured in the ordinary role and
permission workflow, not through a separate gatekeeper-account form. Removed that
form, its generated-password display and its account-creation action from Gate &
Safety. Replaced it with links to central Roles and the People directory. Named
the central role panel **Roles & permissions**. The institution-scoped
**Manage In & Out** action remains assignable through built-in or custom roles to
existing active staff; no duplicate account is required. Existing accounts,
assignments and backend administrative compatibility operations are unchanged.
QR issuance, visitor approvals and the permission-scoped Hindi/English guard
workspace stay in their existing modules.

Added gate-admin coverage for role/profile destinations, no account form or
password UI, keyboard navigation, student QR issuance, visitor approvals and
non-admin denial. All 27 focused tests, frontend typecheck, lint and production
build passed locally. The local preview served the current build; its referenced
gate-admin chunk contains the central role/profile links and no account/password
form. Trusted Stage workflow [38712551172](https://github.com/EduveraIITA/Eduvera/actions/runs/38712551172)
passed all 819 backend and 954 mobile tests plus the desktop build, then completed
Google Cloud deployment successfully. PR [#38](https://github.com/EduveraIITA/Eduvera/pull/38)
merged as `2b0090da73d23377e2796ac16bb40466455dc318`. Revision
`eduvera-stage-00136-xam` was promoted; the trusted deployer verified that exact
release, readiness, database/events, both app bundles and public origin at
09:42:51 UTC. An independent Python request from the editing environment received
HTTP 403; public release evidence is the successful trusted workflow's checks,
not that blocked request. Signed-in physical-device review remains user acceptance.

## Product demonstrations and sales narrative — 15 October 2026

Latest owner decision: learn Stripe's product storytelling and motion detail,
without copying its brand. Replace generic feature cards with relevant real app
demonstrations that help school leaders understand the product and request a demo.
The main public website now leads through attendance, timetable and family
workflows, role-specific perspectives and configurable operating rules. Original
screen assets/showcase functions remain protected and available in an expandable
gallery. The school application, domain routing and production school records are
outside this slice.

Latest owner decision rejects the subsequent sand-particle/cropped-screen
experiment and restores the previously reviewed walkthrough-based preview.
The active version uses three actual synthetic-app recordings, spring ribbon/grid/
orbit backgrounds, individual/global playback controls, reduced-motion/data-saving
fallbacks, offscreen suspension, accessible expanded video and streamed MP4 ranges.
Do not reintroduce the rejected composition without a new owner decision.
The existing authorized enquiry persistence/outbox and legal consent remain intact.
Experimental timetable, sandbox payments and institution-fit limitations remain
visible. No fabricated proof, metrics or customers are introduced.

The original walkthrough version passed local typecheck/lint/build, nineteen unit
tests, six visual variants and the isolated PostgreSQL enquiry regression. The
restoration passes those checks again; all six media assets byte-match their
backups and local preview readiness is healthy. Details, research, screenshot
preservation, capture provenance, verified final checks and remaining gates are in
[MOTION_STORY.md](../marketing/MOTION_STORY.md). Website-only Stage promotion and
owner physical-device acceptance remain pending at this implementation checkpoint.
The capture found a separate parent timetable mixed-child heading; it is recorded
in [MOTION_CAPTURE.md](../marketing/MOTION_CAPTURE.md), not presented as fixed.

## Public, read-only product exploration — 15 October 2026

Latest owner decision: prospective users may explore a working four-role ThatCampus
demo without creating an account or supplying personal information. The public
website also carries short, truthful ThatCampus AI demonstrations and the personal
demo form asks for one contact route only: email or phone.

The implementation adds a dedicated `/demo` role chooser for principal, teacher,
parent and student. Public-demo sessions are distinct, expire after 30 minutes and
are rate-limited by anonymised client bucket and globally. A server-side guard
permits reads and profile switching but rejects every other state-changing request;
the application keeps a visible **Sample data · read-only** banner. The feature is
enabled only on the isolated Stage deployment, and production startup rejects an
enabled public-demo configuration. Standard authenticated sessions and the private
development demo route are unchanged. The Stage data set must remain synthetic;
this control does not authorize publishing real school data.

The marketing enquiry now accepts exactly one field containing a valid email address
or phone number, while preserving the existing enquiry audit/outbox workflow and
concise consent notice. Two compact AI motion stories use a purpose-built synthetic
app screen: the assistant identifies an attendance task, answers a contextual
follow-up, names its source and prepares a reminder for human review. They are
illustrative product media, not claimed as live model recordings. Future replacement
with captured live AI interactions requires the same synthetic-data review.

Verified locally: frontend, backend and marketing typechecks pass; the marketing
production build and all 19 marketing HTTP/configuration tests pass; the public-demo
guard has focused read/write/control-path coverage. The dedicated website workflow
then passed five viewport/browser checks, navigation, JavaScript-error detection,
and isolated PostgreSQL enquiry persistence in run 38729379402. Full Stage run
38729379496 passed the backend integration suite, mobile typecheck/lint/build/tests
and desktop build, but correctly stopped before migration or traffic promotion when
the pre-deployment runtime assertion encountered the last Stage revision, which
predated the public-demo gate (while already carrying the authenticated profile
switcher). The release guard now permits only the two known private-demo predecessor
states; an explicit public-demo false or any other partial configuration still fails
closed, and the candidate must still pass the release
smoke checks before promotion. Trusted Stage promotion and physical-device review
remain release gates and must not be inferred from this implementation record.

## Stage CI execution optimization — 15 October 2026

Baseline observed in Actions run 38732120179: Verify took about 10 minutes;
mobile install/check/build/test took 6m06s, backend integration 2m13s, backend
install/check/build 51s, and desktop 14s. Deployment subsequently failed, so
these timings are not evidence of a successful release.

The optimization branch runs security/deployment contracts, backend verification,
client builds and three disjoint Vitest mobile shards concurrently. The existing
`Verify` check aggregates every job and fails closed on failure, cancellation or
skipping; both release paths still depend on it. Backend integration remains
serial against its disposable database. All existing test files are retained.
CI reuses the backend build before Vitest; local `npm test` still builds first.
Client and marketing builds already typecheck, so separate duplicate typechecks
are removed. npm caches use each package's lockfile instead of a repository-wide
key. Docker Buildx uses separately scoped GitHub layer caches for application,
photo service and marketing images; authentication remains after image builds.
Cloud migration, candidate checks, promotion and release serialization remain.

Validation: actionlint passed for all three edited workflows; 14 GCP contracts
and 5 Matrix configuration tests passed locally; the aggregate gate was checked
against success, failure, cancellation and skipped results. Mobile shard 1 passed all 300 tests. Shard 3 passed 351 tests and failed two
campus-event attendance tests; both failures reproduce with the original unsharded
command. A family-home timeout in shard 2 passes on isolated rerun; that full
shard did not finish locally and was stopped. Hosted CI validation is still required. Failures are not waived. Actual hosted speedup and
warm Docker cache behavior require subsequent Actions runs. More parallel runners
can increase total runner minutes even while reducing elapsed time.

## Public search discovery foundation — 15 October 2026

Latest owner decision: make the public ThatCampus website understandable and
discoverable through Google Search and recommendation systems. Search work must
not become a keyword dump or invent customers, rankings, certifications, pricing
or production capabilities. The existing visual system, public demo distinction
and product-availability disclosures remain authoritative.

The first implementation slice adds five substantial, server-rendered solution
pages for school management, attendance, timetable/calendar, parent communication
and the access-aware school assistant. Each page has one clear intent, a unique
title and description, visible explanatory copy, a real product screen or the
approved illustrative AI videos, direct demo/walkthrough routes, related-workflow
links and a single canonical slashless URL. The homepage and footer now provide
crawlable links to every solution; the public demo, personal walkthrough and
school login remain three distinct destinations.

Prerendering now emits page-specific canonical, Open Graph, Twitter and language
metadata plus truthful Schema.org Organization, WebSite, SoftwareApplication,
WebPage and BreadcrumbList data. The AI page also exposes two VideoObject records
whose titles, descriptions, thumbnails, durations and MP4 URLs match the visible
media. The XML sitemap lists all canonical pages and both videos; robots continues
to exclude only API routes. `llms.txt` provides a concise, caveated product map for
systems that voluntarily consume it, without claiming it is a ranking signal.
Only the canonical Cloudflare hosts are indexable; Cloud Run previews retain the
existing `X-Robots-Tag: noindex` protection.

Verified in the isolated worktree: marketing lint and production build pass; all
eight public HTML documents are prerendered with one H1, unique metadata and JSON-LD;
focused deployment/server tests pass, including canonical-host indexing, solution
routes and trailing-slash redirects. The Stage workflow has separately been
parallelised and cached by PR #40; this slice must rebase onto that work and must
not restore the former serial test path. Remaining external gates are trusted Stage
deployment, Rich Results/URL Inspection checks, Google Search Console ownership and
sitemap submission, followed by measurement of impressions, queries and qualified
demo visits. No search ranking is promised or represented as achieved.

## New gate.demo user, not Kavita — 15 October 2026

Latest owner instruction supersedes assigning gate access to `kavita.staff`:
create a separate new user. Added a fixed-target private maintenance operation for
`gate.demo`, with an active non-teaching profile and exactly `gate.manage` through
the Gatekeeper role in Cambridge (`cis`). No existing user, password or assignment
is updated. Account and role binding are transactional, audited and emit an access
update. Re-running against an existing username fails without resetting it.

Initial credentials are generated and encrypted by the trusted runner so delivery
does not depend on the unavailable Cloud Logging read permission. The database job
receives only a salted scrypt hash, not the plaintext password. The operation uses
the existing approved private job with per-execution arguments; persisted job
configuration and IAM remain unchanged. Public-demo session restrictions remain.
Details: [GATEKEEPER_PROVISIONING.md](GATEKEEPER_PROVISIONING.md).

All 19 deployment/maintenance contract tests and backend typecheck/lint pass locally.
Added a native PostgreSQL regression for account creation, credential compatibility,
gate-only scope, refusal to overwrite, outbox evidence and unchanged Kavita data.
Hosted verification, live account creation and private credential delivery remain
pending; no database change has been made at this implementation checkpoint.

<!-- Verified gate.demo follow-through: 15 October 2026 -->

### New gate.demo account — verified live

PR #43 merged as `8a6a8547fb284414e1207267e5cca4a0d847471e`. All 827 backend
tests, mobile shards, client builds and deployment contracts passed. Stage run
`38743814034` completed the account-only private job `eduvera-stage-migrate-kfzd4`
at 13:38:50 UTC on 15 October 2026. It created the separate `gate.demo` user in
Cambridge with only institution-scoped `gate.manage`, an active non-teaching
profile and Gatekeeper role. Kavita and all existing account credentials were
unchanged; persisted migration configuration was unchanged. The encrypted
credential was recovered privately and delivered as `Gate_Demo_Credentials.txt`.
No password/private key is committed. Regular credential login is required;
public-demo personas and read-only authority are unchanged. See
`GATEKEEPER_PROVISIONING.md` for the fixed-target operation and success evidence.

### Search-engine registration and change notification — 15 October 2026

Google Search Console domain ownership was automatically verified through the
existing DNS record. Google accepted the canonical sitemap and reported eight
discovered pages and two discovered videos. The homepage was already indexed;
its refreshed release plus the five primary solution pages were individually
submitted to Google's priority crawl queue. Submission is discovery evidence,
not a guarantee of indexing or ranking.

The public website now also hosts a non-secret IndexNow verification key and the
tested deployment paths send the eight canonical public URLs to the shared
IndexNow endpoint after successful promotion. Search notification is deliberately
best-effort and cannot roll back an otherwise healthy release when an external
search endpoint is unavailable. Stage run `38749486599` deployed commit
`d2dbd4ff9db7b683dcb24e1f5f807c9c4616ec93`, passed every existing parallel test
and build gate, verified the public ownership assets, and received HTTP 202 from
IndexNow for all eight canonical URLs. Its deployment verifier now tolerates the
brief Cloud Run propagation interval after traffic promotion instead of rolling
back a healthy revision because the stable URL still serves the previous release.

Bing ownership was then verified independently with the live root XML file, so
Bing received no ongoing Google Search Console access. Bing Webmaster Tools
accepted `https://thatcampus.com/sitemap.xml` on 15 October 2026 and showed one
known sitemap, zero errors and zero warnings while crawl processing began.
Submission and notification are discovery evidence, not guarantees of indexing
or ranking.

## Invitation account flow — 15 October 2026

User decision: accepting a valid email invitation verifies that email; subsequent login
opens the assigned home. Staff with no permissions see account/institution information
and instructions to ask their administrator for a role. Server authorization is unchanged.
Password reset retains its existing expiring single-use token flow and uses the invitation
email layout. Email branding uses only the original logo with a white contrast surface
for dark inboxes. Migration 096 repairs previously accepted invitations only when the
current account existed at acceptance. Local verification and release evidence follow.

Verification: backend build passed; 13 email/transport tests passed, including reset
layout/link handling. Frontend auth/permission tests passed (10 total after adding the
no-permission landing regression). PostgreSQL acceptance regression added for the
isolated CI suite; no local disposable PostgreSQL available. Inbox-client rendering
still needs user validation on the affected email app after release.

## Gate home theme, staff tab and bounded search — 15 October 2026

Owner requested the gate workspace match the shared app theme, be the gatekeeper
home, and appear as a new bottom button for authorized staff. Implemented branded
gate-only home with shared color/spacing/card tokens, Hindi/English controls,
primary QR action and compact search/visitor actions. `/teacher` redirects gate-only
staff to `/gate`; mixed staff keep their home and gain a permission-gated
`/teacher/gate` In & Out tab in both mobile navigation and sidebar. Scoped staff
home also exposes the gate tool. Existing accounts and assignments are untouched.

Search now debounces at 250 ms, cancels obsolete requests, handles loading/error/
empty results, and uses a bounded lightweight school-roster query instead of
loading gate history and collector data for all matches. Migration 097 adds
name/admission substring indexes. Selecting a result reloads current student
detail; transactional QR/current-authority checks remain the source of truth.
Companion contract: [GATE_WORKSPACE.md](GATE_WORKSPACE.md). Local typecheck, lint
and frontend production build pass; focused UI tests cover the changed behavior.
Native PostgreSQL CI passed; Stage run `38752498133` deployed merge
`3079cff948d60962aed03e63b533459b344bb091` successfully, with 829 backend and
961 frontend tests passing. Migration execution `eduvera-stage-migrate-62mqr`
completed; app revision `eduvera-stage-00160-pux` passed candidate and exact public
release/readiness checks after promotion. The separate website release succeeded.
The headless browser successfully checked the actual local app with synthetic API
fixtures at 320/768/1024/1440 px for gate-only and mixed staff: no overflow/page
errors, home redirect, active bottom tab, search and fresh detail, and identity
confirmation safeguards. Phone/tablet renders were visually inspected. The
regular browser launcher failed on a Unix socket; headless QA did not require it.
A local public HTTP recheck returned 403, so live confirmation relies on the
trusted release verifier. Owner device review remains requested.

### Mobile sign-in layout — 15 October 2026

User superseded the powered-by ribbon proposal: prioritize the demo's mobile login
layout without any attribution, and only suggest placement after sign-in. Added
mobile-only centered original ThatCampus logo, Welcome back heading, campus subtitle,
larger inputs and primary action. Existing email/username authentication, MFA,
password reset, invitation and signup links remain functional. No unconnected
social-provider buttons were added. Logged-in shells remain unchanged. Proposed
future attribution location: Profile/About, pending the user's choice.

Verification: frontend production build, AuthPages lint and existing AuthPages
sign-in regression test passed. Deployment and user visual acceptance remain open.

## Gate one-click entry and visitor approvals — 15 October 2026

Owner explicitly requested one-click student entry after search, themed visitor
entry/pending lists and a MyGate-style approval popup after login. Search now
includes the latest direction for only its bounded shortlist. Mark entry attests
identity after the visible instruction and sends a stable movement command UUID
without a detail fetch; current server authority/state checks still apply. This
owner decision changes entry only; exit identity/pickup QR safeguards remain.

Visitor creation uses a stable request UUID; migration 098 adds idempotency,
revision and expiry. Selected active staff/admin hosts can approve their own
pending requests without gate.manage, while school admins retain fallback
authority. Other staff/gate operators cannot approve another host's request.
Revision checks and row locks reject stale decisions; expired requests cannot be
admitted. Audit, outbox and durable notifications are atomic with each change.
Current relationship checks protect event replay and notification reads. The
authenticated shell presents Approve/Decline/Review later, invalidates queues on
live events and refreshes on focus/poll fallback. This is in-app notification,
not OS/background push. Gate lists immediately reflect returned entry/exit state.
No account or permission assignments changed. Contract: [GATE_WORKSPACE.md](GATE_WORKSPACE.md).

Local typechecks/lint, production frontend build, 49 focused UI tests and real
headless browser fixture workflows passed, including responsive 320/768/1024/1440
px layouts with no overflow/page errors. Native integration coverage was added
for publisher delivery, retries, revocation, school isolation, expiry and racing
decisions. Hosted CI and deployed verification passed as recorded below. Owner device
review remains requested after release. Concurrent mobile sign-in changes from
PR #48 were preserved.


### Desktop/tablet floating-window login — 15 October 2026

User selected the second preview in the latest set (05, Floating window) and requested implementation and push. Above 650px, login uses a pale blue canvas with decorative rays, a white card with blue top accent and a floating original-logo tab. The old marketing sidebar is hidden. Phone layout, authentication behavior and non-login auth pages remain unchanged. No powered-by ribbon or unsupported social providers were added.

Verification: frontend production build and existing AuthPages regression test passed locally; diff whitespace check passed. Browser visual verification was blocked by the environment's process-singleton socket permission. The workspace disconnected before push, so the CSS patch was reconstructed via GitHub; remote CI and user device review remain pending. Pushed for review, not deployed.


Release verification: PR #50 passed hosted CI run `38764776642` (832 backend
and 971 frontend tests, both client builds and security/deployment contracts).
Merge `585fc55c45f55460528fa894c6629c7fe51bf1f8` deployed successfully in Stage
run `38765399927`. Private migration `eduvera-stage-migrate-d65b2` completed at
16:08:56 UTC. App revision `eduvera-stage-00166-hop` passed candidate checks and
was promoted; the trusted release verifier confirmed the exact public SHA,
Stage environment, readiness and both apps at 16:09:59 UTC. The separate website
release succeeded; IndexNow accepted eight canonical URLs at 16:11:08 UTC.
No existing account or permission assignments changed. Owner device review and
a real host/guard visitor-request walkthrough remain requested. Local fixture QA
and native isolated database tests do not represent that live account walkthrough.

### Shared ThatCampus page loader — 15 October 2026

The user-supplied animated ThatCampus SVG now replaces the legacy synthetic mark
for full-page route loading. One accessible shared component covers lazy route
transitions, authentication restoration, live school-record loading, operations
workspaces and ThatCampus AI startup. It announces contextual status text, keeps
the artwork decorative for assistive technology and presents a static branded
fallback when the device requests reduced motion. Contextual section-level
skeletons and local progress indicators remain unchanged.

Verification on current Stage: focused ESLint passed; the loader component test
passed; TypeScript and the production Vite build passed. Deployment evidence is
Stage workflow `38770723509` passed all frontend, mobile, backend, security and
deployment gates for application commit
`80cd39400010a9af0284ec628b6c6f41b22f2b73`. Google Cloud candidate verification,
promotion and the separate website deployment completed successfully. Independent
public checks returned HTTP 200 for `https://app.thatcampus.com/login` and the new
SVG asset; `/releasez` reported that exact Stage SHA and `/readyz` reported ready
database and event dependencies. The marketing apex intentionally does not serve
application routes. Physical-phone visual acceptance remains requested.

## Home-only guest approvals and subtle decision feedback — 15 October 2026

Owner requested approvals only on home after login, with notification access and
no departure from home after close/approve/reject. VisitorApprovalCenter now uses
the existing authDestination contract, suppresses cached popups and approval
polling on non-home routes, and routes valid visitor notification links to home.
All dismissal/decision paths clear the request marker and notification return
state without returning to the originating tool. Existing host authority, current
revision checks, expiry and durable notification behavior remain unchanged.

After server-confirmed approval/rejection, a restrained themed check/cross
animation announces the saved decision and dismisses after 1.2 seconds or Done.
Errors never show the success state. Modal focus and reduced-motion support are
retained. Contract: [GATE_WORKSPACE.md](GATE_WORKSPACE.md). Local production build,
typecheck, focused lint and 24 approval/notification tests passed. Actual local
headless browser fixture checks passed home-only behavior, notification links,
close/decisions remaining home, both animations and reduced motion, plus layouts
at 320/768/1024/1440 px without overflow or page errors. These are not live account
checks. Hosted CI and deployment passed as recorded below; owner-device review remains pending.


Home-only approval release verification: PR #52 passed CI run `38774800786`
with 832 backend and 986 frontend tests, both client builds and deployment/security
contracts. Merge `45ddb3e53fc53e15063e93f89543bfefcbbc0586` deployed successfully
in Stage run `38775411724`. Migration/guard execution `eduvera-stage-migrate-9b75h`
completed at 17:20:34 UTC (no new schema migration in this UI change). App revision
`eduvera-stage-00175-nip` passed candidate checks, promotion and exact public SHA,
environment, readiness and both-app verification at 17:21:38 UTC. The website
release also succeeded; IndexNow accepted eight URLs at 17:22:53 UTC. The local
review preview returned HTTP 200. Owner device/live-account review remains open;
local synthetic browser fixtures do not establish that acceptance.


## Google sign-in — 15 October 2026

User authorized Google sign-in and supplied the public OAuth web Client ID. Both React clients
use the official Google Identity Services button and POST its ID token through the existing
same-origin CSRF convention. The backend uses google-auth-library to verify signature, issuer,
audience and expiry, plus a signed browser cookie and expiring, single-use database nonce.
Google subject is the durable identity key. First linking accepts only verified Gmail or Google
Workspace email, preserves existing roles and memberships, and revokes pre-link sessions.
Third-party non-Workspace email must use password login. Disabled accounts remain blocked.
New Google accounts have no school membership or operational grants; ordinary onboarding applies.
Both Google and password sign-in use the same MFA challenge/session boundary; desktop now
supports that existing MFA challenge too. No Google client secret or API scopes are used.

The Stage release sets GOOGLE_CLIENT_ID explicitly; other environments default to disabled.
Required authorized origin: https://app.thatcampus.com (identified in the current deployment
configuration and communicated to the user), plus the existing direct Stage origin when used.
The marketing origins alone do not authorize the app subdomain. OAuth origin setup and an
interactive real-account Google login remain user acceptance gates.

Local evidence: both frontend production builds passed, backend typecheck and focused lint
passed after the new test additions; 10 signed-token/identity rejection tests, 3 Google button
tests and 8 existing frontend auth regressions passed. New isolated PostgreSQL cases cover linking, no automatic membership, replay,
disabled accounts, changed email, conflicting identity and MFA; CI verification and deployment
are pending. No real-user Google login has been claimed.

Publishing status: the user explicitly approved pushing, CI and Stage deployment on 15 October
2026 after the initial automatic approval review requested publication authorization. Hosted CI
and Stage verification are pending. PostgreSQL integration tests were skipped locally because
no isolated PostgreSQL server is available.

### Compact post-login attribution — 15 October 2026

User approved a smaller Powered by ThatCampus pill after login and removal of the ThatCampus logo from authenticated headers. Added a shared compact 190px ribbon to operations/web sidebars and the parent, student and operations Home content footer on mobile. The separate desktop client also includes it in the sidebar. The school crest/name remain in headers; auth branding remains unchanged. The Home footer scrolls with content and does not overlay bottom navigation.

Validation: both frontend production builds and targeted ESLint passed; git diff whitespace check passed. Existing route branding assertions updated. Local Vitest runs stalled before reporting results (including a single-worker retry), but all hosted PR checks subsequently passed, including all three frontend test shards, backend, both builds and security/deployment contracts. Owner visual acceptance remains pending. This record does not claim deployment or pixel verification.

### Subtle attribution reflection — 15 October 2026

Owner approved a soft reflection and blue glow on the compact post-login ribbon in both clients. Identical CSS adds a brief sweep every nine seconds, behind the stationary text and logo, clipped to the pill with a non-interactive decorative pseudo-element. Animation only runs with prefers-reduced-motion: no-preference; reduced-motion users retain the static ribbon. No size, placement or auth changes. Prior compact-ribbon release d44652ea211389001f986fb551319adaf99b4443 passed Stage application promotion and public verification in run 38778851119. Animation change awaits hosted build checks and deployment; local execution is unavailable, so no visual acceptance is claimed.

### Stronger ribbon animation — 15 October 2026

Owner requested a more visible reflection and glow on both web/app ribbons. Increased the sweep frequency from nine to four seconds, starting immediately, with a wider white/cyan/lilac reflection and stronger smoothly breathing blue/violet halo and border. Text/logo remain stationary above the effect. Reduced-motion fallback, pill dimensions and placements remain intact. Previous reflection release fd7ae93aa721329ba209b9cac32e876b1b3e7502 passed all Stage checks and application public verification in run 38781089465. This CSS adjustment awaits hosted validation/deployment; local execution and visual review are unavailable.

## Google sign-in release verification — 15 October 2026

PR #56 passed hosted CI run 38781597027, including all 846 backend tests and the four new
isolated PostgreSQL Google-linking/MFA cases. Merge e7322a95279b8206de9fd4fde876d84de2c636a3
passed Stage run 38782143819, including migration, candidate checks, promotion, public-service
verification and the separate website deployment. Independent live checks returned the exact
merge SHA at /releasez, ready database/events at /readyz and enabled Google configuration with
the supplied Client ID and a nonce. Live browser inspection confirmed Continue with Google on
/login and /staff/login.

Outstanding configuration: the live Google button reports '[GSI_LOGGER]: The given origin is not
allowed for the given client ID.' The owner must add https://app.thatcampus.com to this OAuth
client's Authorized JavaScript origins and save. This is an observed external configuration
blocker, not a completed real-account sign-in. Real Google login and owner-device acceptance
remain pending that change. No client secret is needed or stored.

## Light-blue campus login reference — 16 October 2026

Owner supplied a visible Stitch login screenshot after ZIP access failed. Recreated its centered pale login card, blue/cyan background, framed header/footer and floating feature badges in both app and desktop sign-in. The owner's latest correction explicitly retains the reference-style ThatCampus name and blue graduation-cap icon in the header and centered cap icon above Welcome back. This supersedes the earlier instruction to omit the logo. Authenticated Home and Powered by ribbons are unchanged.

Existing password login, Google credentials/nonce flow, MFA, errors, invitation, registration and reset routes are retained. Google is first, using its official rendered button. Help Center opens real account guidance. Decorative badges describe actual portal capabilities rather than invent uptime, response speed, library hours or compliance. The unsupported remember-device checkbox is omitted. Responsive rules retain the login at phone widths and remove peripheral badges where space is limited.

Updated existing login branding/title expectations. Local execution and browser inspection are unavailable; hosted builds/tests and public release verification remain required. Screenshot matching and device acceptance are not claimed as tested.

## Original ThatCampus logo on login — 16 October 2026

Owner clarified that login must use the same original stacked ThatCampus logo as Home, supplying the navy/blue wordmark reference. Both login clients now reuse /assets/thatcampus-logo.png (the existing Home attribution asset) in the header and above Welcome back, replacing the generic graduation-cap icons and separate typed wordmark. Uses object-fit: contain and responsive dimensions; retains the latest Threads background, authentication flows and other concurrent changes. Hosted build/release checks are pending; no visual device acceptance is claimed.

## Compact route regression suite — 15 October 2026

Follow-up to PR #40: all hosted checks passed and release 2de06c11cad265560b79883767564a97ae37715a
was successfully deployed in Actions run 38735993491. PR verification took about
3m37s versus the earlier roughly 10-minute sequential baseline. The remaining
mobile hotspot was App.routes.test.tsx (62 cases, about 169s in the merged run).

Consolidate this suite to 54 cases by removing duplicate full-App mounts, keeping
observable assertions in the interaction tests that already exercise each route:

- Four heading-only smoke cases move to existing parent home/attendance and
  student home/attendance workflows. Other smoke routes remain.
- Two parent standings cases move into the existing home-card and attendance
  score workflows. Aggregate-card, whole-home-card and score triggers all remain,
  including row count, selected-child highlighting and list visibility checks.
- The default home metrics case shares the homework/attendance interaction mount.
  Alternate homework counts move to the alternate-metrics case, retaining count,
  trend direction and missing-baseline assertions.
- The child-menu case owns selection and identity data; the four-child deck case
  owns swipe behavior. Eight repeated deck transitions become four: an interior
  move and wraparound in each direction. The two swipes after menu selection remain
  because they cover synchronization of menu selection and deck position. Two-child switching, delayed loading,
  header selection, and permission/authorization regressions remain separate.

No skips, timeout increases, application-code changes or backend/security test
removals are introduced. Hosted run 38738727147 passed every check, including
all 54 route cases. That file took 198s versus 169s in the prior run, so the
compaction alone does not establish a speedup. A local full run hit two 15s
timeouts (combined standings and unchanged avatar switching). The combined
standings case now uses click dispatch and dialog-scoped close lookup, matching
its route-outcome purpose, instead of costly pointer simulation. Its isolated
local run passed in 9.25s versus 16.52s before that adjustment; no timeout was
increased. Lint passed. Historical hosted validation passed in run 38739608845; a fresh run
is required after reconciling this branch with current Stage.

Reconciliation checkpoint (15 October 2026): preserved current Stage branding,
login, assistant and release work. The compacted tests retain core assertions with
fewer repeated swipe permutations. Fresh hosted validation is pending.

Coverage review retained the distinct menu-selection-to-swipe regression, rather
than treating it as a duplicate of the isolated deck test. No skipped cases or
increased timeouts were introduced.

### 2026-10-15 — Parallel release image preparation

The measured PR #40 release took 12m42s overall versus 15m56s before it;
verification improved, but serial image building/cache exports increased the
release job to 8m59s. Image preparation now uses three independent matrix runners
for application, photo attendance and marketing, each authenticating after its
build and uploading its SHA-tagged image. The deployment job requires the entire
matrix to succeed, repeats the target/window guard, and retains migration,
candidate health, promotion and public verification. Disabled deployment still
only prepares application/photo images; website-only and provision paths remain
separate. Existing release concurrency and environment protections remain.

Photo model download/checksum layers precede application source, marketing build
copies only its production inputs, and mobile test files already excluded by its
production tsconfig no longer invalidate the application image cache. No tests
were removed. A path-filtered PR workflow builds all three Dockerfiles without
publishing or cloud credentials when container configuration changes.

Local evidence: workflow actionlint and all 14 GCP deployment contract tests pass.
Docker is unavailable locally; hosted container validation is required before
merging. The new end-to-end deployment duration is not yet measured; parallel
builds target the serial image bottleneck, not runtime verification safeguards.

Reconciliation and fresh-runner repair (15 October 2026): this branch includes the
current Stage work and PR #41's compacted tests, retaining menu-to-swipe integration
coverage. The split deployment runner resolves both immutable image digests from
Artifact Registry instead of inspecting images on another runner. Lookup accepts
only the two approved repositories, full commit tags and valid SHA-256 digests;
missing images or denied registry reads fail before migration. All 13 release
contract tests and syntax checks pass locally, including three new regressions.
Fresh hosted checks and deployment timing are pending; old runs do not validate
this reconciled head. No security/runtime guards or provisioning paths were removed.

## Parent Home fee and identity truth correction — 16 October 2026

Parent Home no longer returns or renders the static `All Cleared` demo assertion.
Its fee summary is now a read-only projection over the selected student's posted
invoices, accepted payments, event credits and recorded refunds. Applicable records
are invoices due within the active enrollment term plus unresolved carried balances
up to that term's end. The response identifies the fee ledger as its source, carries
the school-local `as_of` date and keeps no applicable invoice data as **Not
configured**, distinct from **No balance due** on one or more posted invoices.
Outstanding, overdue, refund-due and mixed balances remain distinct integer-paise
states. Pending family payment claims remain in Fees & receipts and do not reduce the
Home balance before school verification.

The authenticated parent shell no longer imports a fixture learner or fabricates the
Cambridge school name while linked-student or membership context is absent. It uses a
route-provided or authorized accessible student, otherwise shows a neutral
loading/unavailable context and does not form a fixture student scope for attention or
the assistant. Static parent demo data remains explicitly labelled as demo data and is
not a live-route default.

Local focused evidence: 3 backend fee-state tests, 15 frontend adapter/shell tests and
the parent Home fee-card route regression passed. Backend source typecheck and focused
lint passed; a frontend source typecheck excluding the already-recorded duplicate
`* 2.tsx`/`* 3.tsx` test artifacts and focused lint passed. A read-only isolated API
integration assertion now compares Home aggregates with the family fee endpoint, but
that PostgreSQL integration case was not run locally. Hosted CI, deployment and owner
device review are not claimed.

Remaining finance modelling gap: existing fee invoices do not carry an explicit term
or normalized obligation/line-item identity, so the Home projection must use the
documented due-date and carried-balance rule. Adding explicit obligation-to-term
ownership should replace that compatibility rule in the authoritative finance-domain
contract; no inference from invoice description/reference was introduced here.

## Attendance command and evidence convergence — 16 October 2026 (local branch)

Scheduled-session attendance now retains its accepted domain decision and its Campus
Model command outcome in the same transaction. A complete staff submission records a
typed `attendance.register.submit` command against the attendance-register entity,
including the source and resulting register revisions, the exact register event,
safe session context and the effective institution Operating-rule revision. Automatic
student QR acceptance does the same through
`attendance.self_check_in.accept_automatically`; the QR evidence and audit record also
snapshot the configured self-check mode and time-window values that authorized the
decision. This does not make QR evidence a room-presence assertion.

Staff-review QR mode now has an explicit evidence decision instead of leaving pending
observations without an operator path. Pending evidence is returned inside the same
subject register. An authorized recorder must provide a verification note and an
expected register revision, then accept or reject it through an idempotent endpoint.
Acceptance writes the current register row, immutable attendance revision, student and
register events, accepted observation and typed model command atomically. Rejection
preserves the evidence and transitions its model observation without changing the
register. The evidence metadata retains the decision idempotency binding and applicable
Operating-rule revisions. The register UI prevents evidence decisions while local
attendance edits are unsaved, avoiding an invisible overwrite or parallel workflow.

Local evidence: backend source typecheck passed; the focused attendance-model suite
passed **5/5**; the focused register/query frontend suites passed **18/18** and the
register suite with the new QR-review interaction passed **17/17**; the Vite production
bundle and a source typecheck limited to the changed frontend dependency graph passed.
The repository-wide frontend TypeScript command remains blocked by pre-existing,
untracked duplicate `* 2.tsx`/`* 3.tsx` test artifacts with missing DOM matcher types;
those shared artifacts were not deleted or changed. No push, deployment, live database
walkthrough or device acceptance is claimed.

Remaining attendance coordination gates: overdue and exception events still use the
legacy broad outbox audience rather than a configured next-agent selector; automatic
finalization still needs a typed model outcome; older attendance facts need an explicit
historical backfill policy. These stay separate from the now-complete staff/QR evidence
decision path and must not be presented as delivered.

## Examination-day operations and model convergence — 16 October 2026 (local branch)

The offline assessment domain now covers the operational period between planning a
physical exam and opening its result register. Exams, practicals and vivas require a
canonical campus space and offered invigilator at creation. An institution-level,
revisioned Operating rule controls readiness and attendance windows, required accepted
invigilators, attendance completeness at completion, and manual versus automatic entry
to marking. Invigilator response, room capacity, frozen roster, start, factual candidate
attendance, incident handling, completion and cancellation are tenant-scoped,
revision-guarded, audited and emitted through the existing event boundary.

Migration `117_examination_day_operations.sql` owns the new policy and operational
records. Composite unique keys and foreign keys keep the assessment/sitting/candidate/
learner chain internally consistent. Physical assessments cannot schedule without a
sitting or open marking before completion. Both manual and automatic marking derive
their result rows from the same frozen roster. Invigilator fallback access requires an
active institution membership and active account; operational viewers do not receive
result or publication data.

Material examination operations are connected through the appropriate Core contract:
sitting state and evidence changes use accepted-change commands, while invigilation
assignment and response use typed coordination messages. Draft/readiness state remains
authoritative in Assessments. The model records the scheduled-in relationship to the
canonical space, lifecycle actions, attendance completeness and incident state while
keeping planned expectation, factual evidence and academic outcome distinct. Campus
View consumes current, revision-matched examination expectations; the standard calendar
and assessment workspace remain the operator interfaces. The frontend reuses the class
attendance row interaction for candidate attendance and adds a focused exam-day panel,
invigilation response, incident log and a dedicated Examination day Operating-rules
screen without introducing a separate navigation system.

Verified local evidence: backend typecheck and scoped lint pass; a fresh isolated
PostgreSQL schema passes the assessment/examination suites 11/11, including six asserted
model commands and a cross-sitting integrity rejection; focused model bridge, Campus
View and realtime/event suites pass 20 tests outside the isolated database runner. Six
focused frontend suites pass 24/24 with scoped lint and diff whitespace checks. This
record does not claim deployment or owner-device acceptance.

### Examination effective-timetable readiness — 17 October 2026 (local branch)

The next assessment slice closes the canonical timetable/resource acceptance gate.
Migration `118_effective_schedule_canonical_spaces.sql` adds
`effective_school_schedule_v4`, an additive wrapper over the established v3 effective
schedule. It resolves the already-selected source occurrence to its canonical
`campus_spaces` identity without changing published-timetable, dated-plan, closure or
staff-substitution precedence.

`ExamOperationsService` now produces one domain-native readiness projection covering
cycle/future time, effective enrolment, room availability/capacity, accepted invigilator
minimums, other exam reservations, effective class periods, canonical room occupancy
and accepted invigilators' teaching commitments. Assessment detail and the dedicated
readiness route expose the same explanation to authorized administrators and assigned
invigilators. The existing Exam day panel lists concrete blockers and disables the
Schedule action; the schedule command re-evaluates the projection under the existing
institution-scoped advisory lock before freezing candidates. Accepted schedule audit
evidence retains the readiness time and timetable-contract version. The same workspace
also provides the correction path: before scheduling, administrators can revise the
time, duration, canonical room and invigilators with optimistic concurrency and domain
audit evidence. A changed time or room resets selected invigilator confirmations and
requires acceptance of the revised duty rather than reusing stale consent.

Verified local evidence: backend source typecheck and focused lint pass; a fresh
disposable PostgreSQL schema applied migrations through 118 and the focused
examination, Model Bridge and Campus View suites pass 15/15. The integration case
asserts simultaneous class, room and invigilator timetable blockers, server-side
schedule rejection, an administrator correction, reset/re-acceptance of the material
duty change and a clear re-evaluation. Focused assessment frontend suites pass 16/16
with source typecheck and lint. Migration
118 is applied to the local development database. No push, deployment or owner-device
acceptance is claimed.

### Examination invigilation coordination — 17 October 2026 (local branch)

Migration `119_assessment_invigilation_model_coordination.sql` and
`AssessmentInvigilationOfferBridgeService` connect each offered assignment revision to
one typed `assessment.invigilation.offered` outbox event, the exact approved behaviour
and subscription, the accepted Model event/reaction, and one durable operational Offer
addressed to the explicitly selected human agent. Assessments remains authoritative
for assignment and response state; the bridge uses only the Coordination Runtime port
and does not write Model Core tables directly.

The normal invigilator response command now requires an actor-generated command ID,
rechecks membership, assignment revision, exact message recipient, capability,
deadline and expiry, and records the Assessment mutation, response outbox event,
correlated Core outcome, immutable binding closure and actor-scoped replay receipt in
one transaction. An identical retry returns its retained result; changed work under
the same command ID conflicts. Material changes to time, room or selected staff cancel
an open Offer before resetting responsibility and publish the replacement only after
the new arrangements are authoritative. Requests remains a domain projection of the
same assignment status, not a second acceptance workflow.

There is no runtime fallback recipient or automatic acceptance. A guarded Cambridge
seed provides an explicit route and response capability only for development, local
and test environments. The development runner may answer only an Offer addressed to
its authenticated account through the normal staff endpoint; it cannot impersonate
another fixture staff member. Past physical-examination times are rejected before
room or invigilator coordination, and the sitting projection exposes the exact offered
username needed by that development boundary.

Verified local evidence for this bridge is kept separate from the earlier readiness
counts: backend source typecheck passes; 95 focused bridge, configuration, attention
and fixture-seed checks pass; five database-backed assessment integration tests pass
against the isolated `omnischool_test_exam_readiness_20261017` database after applying
migration 119; 21 focused Assessment and Requests frontend checks pass; and 20 Campus
Lab action, session, model, runtime and safety checks pass. Migration 119, the guarded
Cambridge coordination seed and the explicit 40-seat classroom fixture are applied to
the local development database. The local preview and existing Cloudflare quick tunnel
both return HTTP 200; Campus Lab reports `paused` before the effective 09:00 school
start, so no off-hours acceptance is claimed. The repository-wide migration runner is
still blocked by pre-existing checksum drift in applied migration 047; migration 119
was applied locally as one transaction and recorded with its verified checksum without
rewriting that historical record. No push, deployment or owner-device acceptance is
claimed.

Remaining acceptance gates: add configured reminder rounds, expiry processing and
escalation/fallback workers on top of the retained first Offer; define a multi-room/split-
cohort model; and complete representative administrator/invigilator mobile validation.
These are not implemented behavior in this slice.

## Attendance completion and exception coordination — 17 October 2026 (local branch)

Attendance completion now follows the configured academic model instead of producing
one broad, hard-coded alert. Migration
`120_attendance_completion_coordination.sql` adds institution-owned first-reminder and
administrator-escalation delays. Administrators edit both values alongside the existing
attendance deadline, session window and finalization policy in **Operating rules →
Attendance**. Validation requires escalation to occur after the first reminder. The
scheduled-session deadline is the effective period end plus the configured close window;
the daily-class deadline remains the institution's daily submission cutoff.

The leased attendance scan materializes effective subject registers and emits one typed
overdue event only after the configured reminder delay. A scheduled-session reminder is
addressed only to its effective scheduled teacher. A daily-class reminder first uses an
explicit current `attendance.record` class owner; only when none exists may one unique
effective teacher be used. An ambiguous or missing owner fails closed instead of notifying
every teacher or administrator. Principals do not receive the teacher reminder. Their
Requests projection adds the unresolved register only after the configured escalation
delay. Daily-class and scheduled-session Requests are mutually exclusive, and every
materialized subject item deep-links through the canonical `session_id` attendance path.

For institutions with an approved behaviour, each overdue domain event passes through
the Coordination Runtime as an `attendance_completion` Task addressed to the selected
human agent. The runtime retains the source outbox event, Operating-rule revision,
correlation, recipient capability and exact action path. A later authoritative
`submitted` or `locked` register state cancels the still-open Task as satisfied; Requests
disappears from the same domain state rather than running a second workflow. Missing,
overlapping or unauthorized behaviour remains a visible fail-closed coordination
exception. The guarded Cambridge development seed installs the explicit behaviour, two
event subscriptions and `attendance_completion:complete` capabilities for linked active
staff agents only in development/local/test with both demo opt-ins.

Automatic finalization now records a typed accepted Model Core command/outcome for daily
and subject registers, retaining the exact register revision, snapshotted finalization
rule and emitted locked event. The submitting human remains the accepted-change actor
while `attendance_register_auto_finalize` is retained as executor metadata; a first-class
software-agent executor identity is still an open core-contract refinement and is not
claimed here.

Verified local evidence: the refreshed shared branch matched local `HEAD` before this
work; backend typecheck, scoped lint and production build pass; 49 focused backend
Operating-rules, Requests, event, convergence and guarded-seed checks pass; 22 focused
attendance/Operating-rules frontend checks, scoped lint and the production Vite build
pass. Migration 120 was applied transactionally and checksum-recorded in the local
database without changing the known historical migration-047 checksum drift. The
explicit Cambridge seed resolved 17 linked staff agents, one approved behaviour and two
subscriptions. The live principal Requests API projected eight currently escalated
subject registers with exact session links while the current demo teacher correctly had
no assigned overdue register. The local `/readyz` reports database/events ready and the
existing Cloudflare preview returns HTTP 200.

Remaining gates: the principal escalation is currently an authorized administrator
Requests queue, not a single dated officeholder/team-agent assignment; team membership
and claim semantics remain intentionally outside the public coordination contract.
Historical pre-Core attendance events still need an explicit backfill policy. Physical
owner-device validation of the new rule fields, teacher reminder and principal escalation
remains open. No push or production deployment is claimed.

## Campus View operational KPI cockpit — 17 October 2026 (local branch)

Campus View now has a read-only operational KPI contract and panel without turning the
Model Core into an analytics store. `CAMPUS_VIEW_OPERATIONAL_KPIS.md` defines the first
versioned catalogue of 30 measures across teaching and attendance, movement and people,
spaces, coordination and data health. Each measure declares its source, grain, scope,
unit, numerator/denominator where applicable, evidence class and safe interpretation.
Expected, recorded, accepted and unknown states remain distinct; unavailable evidence is
returned as unavailable or partial rather than as zero, simulated rehearsal activity is
excluded, and the overview has no opaque campus-health score or staff ranking.

The authorized Campus View query endpoint serves six pages (`overview`, `teaching`,
`movement`, `spaces`, `coordination`, `data_health`) and five windows (`today`, `7d`,
`30d`, `90d`, `1y`). Today uses 15-minute buckets, seven- and 30-day views use hourly
buckets, and 90-day and one-year views use daily buckets. Ratio rollups retain numerator
and denominator instead of averaging percentages. Due attendance uses effective schedule
requirements, the configured close-after deadline and explicit missing-register unknowns;
unsupported attendance modes fail closed. Teacher assignment accepts only active human
agents. Planned space use unions each canonical bookable leaf's scheduled intervals over
the effective daily instructional envelope so double bookings and nights do not distort
the rate. The overview combines four headline values, an evidence-safe attendance
composition, recorded gate-flow bars and an objective bottleneck table with links back to
the owning domain workspace. The mobile Campus View exposes the dashboard as a fourth
bottom action and an independent sheet, so a slow KPI request cannot block or blank the
live map. All charts have textual summaries and semantic data tables.

Verified local evidence: backend typecheck and scoped lint pass; 22 focused backend KPI
and Campus View checks pass; 36 focused frontend Campus View checks pass with scoped KPI
lint. Authenticated end-to-end calls against the Cambridge development school returned
the complete 30-definition catalogue, six pages, seven overview measures, four current
headline projections, completed/outstanding/unknown due-register composition, explicit
`available`/`partial` evidence states and one current bottleneck. The 30-day Teaching
request returned hourly series in 404 ms, and the one-year Spaces request returned six
measures and 2,190 daily series points in 1.14 seconds. The Overview completed in 48 ms.
The local preview `/readyz` and the existing Cloudflare Campus View URL both return HTTP
200.

Remaining gates: complete owner-device review of the KPI sheet, page navigation, chart
legibility and bottleneck deep links; measure query latency again as the retained history
grows before adding cache tables or indexes; and add only those later metrics whose
domain evidence and interpretation contracts are approved. The repository-wide frontend
typecheck remains blocked by unrelated pre-existing duplicate `*test 2.tsx` and
`*test 3.tsx` files, so it is not claimed here. No push or production deployment is
claimed.

## Isolated Campus View scenarios — 17 October 2026 (local branch)

The first Model Core what-if foundation is implemented under
`backend/src/campus-model-core/scenarios/`. It provides the shared immutable execution
contracts, distinct real-human/delegate/scenario-persona identities, virtual clock,
seeded deterministic randomness, sink-only message/evidence facilities, production
side-effect denial, baseline/alternative comparison, optional policy-backed Monte
Carlo ranges and a bounded transient run store. The campus-specific repository,
executor and HTTP surface remain in `campus-scenarios`; future domains must register
against the shared foundation rather than fork its semantics.

An active institution administrator can discover future scheduled teacher and active
bookable-space targets, then model one unavailable target over its real per-date
scheduled span for a 7, 14 or 30 day horizon. The snapshot is captured in one read-only
repeatable-read transaction from the effective schedule, canonical spaces and
capacities, active enrolments, human-agent identity mappings, configuration hashes and
privacy-minimized aggregate coverage evidence. The same transaction resolves any
requested institution-owned behaviour version. The client can select only its ID;
unreviewed probabilities, hashes, calibration claims, sample counts and random seeds
are not accepted.

The deterministic run reports schedule, uncovered/unplaced sessions, teacher/space
conflicts, capacity and disrupted learner places. Missing agent mappings and missing
room capacity remain explicit unknown/partial evidence. A reviewed historical cohort
policy may add P10/P50/P90 response ranges, but a modelled positive response never
invents a substitute or alternative room and never closes the operational disruption.
Attendance outcomes, physical movement, transport, finance, assessments and eligible
candidate allocation are returned as unsupported.

Runs are copy-on-write, process-local, institution-scoped and expire after 30 minutes;
they never write operational/Core tables, send production messages or call connectors.
Session/execution/result-size limits, one active run per institution, a global runner
cap, oldest-result eviction, authorization-first target caching/in-flight deduplication
and route-specific rate limits bound resource use. The API supports target discovery,
create, retrieve and explicit discard. Campus View exposes it separately from Live
performance as **Plan & what-if**, uses only verified effective session windows, labels
deterministic results as point estimates and reserves P50/P10–P90 language for
calibrated ensembles.

Verified local evidence: backend source typecheck and focused lint pass; **15/15**
focused scenario-runtime, campus-adapter and route-limit tests pass; the read-only
repeatable-read snapshot query was probed against local PostgreSQL; and **42/42**
focused Campus View frontend tests plus scoped lint pass. The repository-wide frontend
typecheck remains blocked only by the pre-existing duplicate `* 2.tsx` test files, with
no Campus View errors. The restarted local `/readyz` and existing Cloudflare Campus
View URL both return HTTP 200; owner-device workflow acceptance is still open at this
checkpoint. No push or production deployment is claimed.

Remaining gates: replace process-local storage with a shared encrypted ephemeral store
before multi-instance production use; add the general authority resolver/domain
executor registry; provide reviewed Operating-rule administration and backtesting for
forecast policies; connect eligible substitute/space allocation; add further
evidence-backed interventions; and implement a separately authorized
scenario-to-domain-draft hand-off. Direct apply-to-live remains prohibited.

### Scenario catalogue and mobile workspace repair — 17 October 2026 (local branch)

Owner-device review exposed a real integration gap: Cambridge had a valid future
effective timetable, but the scenario catalogue returned no selectable targets. The
repository was still joining the identity column retired by the person-stable human
agent migration, while legacy timetable periods had no explicit canonical space even
though every class had a dated home-space placement. Target discovery and run-time
target resolution now use active, effective `thatcampus` account endpoints linked to
person-stable human agents. Explicit scheduled spaces win; the dated class home space
is the fallback. No label, email or phone matching was introduced.

The Cambridge development dataset now resolves **16 teacher targets and 8 bookable
space targets**, each with verified future session windows. The Campus performance
dialog is full device height on phones with safe-area handling and independent content
scrolling. Planning options now have distinct loading, retryable error and empty-plan
states instead of presenting an unexplained disabled form. Focused verification passes:
backend typecheck/scoped lint and **16/16** scenario tests; frontend scoped lint and
**14/14** planner/KPI-panel tests. Mobile owner validation remains open; no push or
production deployment is claimed.

## Loader visual update — 16 October 2026

User-approved four-arm ThatCampus loader uses alternating logo blues, a fixed center gap, and a trailing arm that shrinks toward white. The final requested speed is a 2.667-second cycle. Shared route loading and inline loading indicators across authentication, activation, chat, notifications, onboarding, planner, attendance, leave and student submissions use this asset. Existing labels, control sizes, loading conditions and reduced-motion fallback remain. TypeScript and the shared loader test passed; production rollout is not yet verified.

## Campus digital-twin Stage release reconciliation — 17 October 2026

At the user's request, the previously verified Stage head `59879d7` fast-forwarded
`main`. The digital-twin branch then committed its reviewed working tree while
excluding the known untracked numbered duplicate artifacts, merged Stage's login,
logo, loader and public-website changes, and fast-forwarded `Stage` to `f22ec2b`.
No force push or live database edit was used.

[Stage run 39018988945](https://github.com/EduveraIITA/Eduvera/actions/runs/39018988945)
correctly stopped before deployment. It found a new historical fingerprint for the
existing mocked Telegram credential fixture, a CI call that bypassed the guarded
governance-seed wrapper, two stale Institute setup navigation assertions, one raw
date input outside the shared bounded component and a realtime assertion that had
not counted the three new Campus Model/Campus View dependent invalidations. The
release corrections retain the exact-fingerprint secret-scan policy, switch CI to
the approved npm seed wrappers, hide administrator-only access/rule/readiness links
from delegated office staff, adopt `TemporalInput`, and assert all eight intended
realtime invalidations. Focused evidence after repair: 19/19 frontend regressions,
15/15 guarded-seed checks and 26/26 deployment-contract checks pass. A fresh Stage
run must still pass the complete clean-checkout matrix, migration, candidate checks
and public revision verification before this release is called deployed.

[Stage run 39019345150](https://github.com/EduveraIITA/Eduvera/actions/runs/39019345150)
then cleared the frontend build, desktop build, secret scan, deployment contracts and
all three client test shards, but again stopped before deployment when the complete
backend suite exposed integration fixtures that predated current digital-twin
invariants. The repair keeps the digital-twin implementation authoritative: inactive
enrolments now carry their required lifecycle evidence; attendance fixtures grant a
dated class responsibility instead of inferring authority from a timetable row; the
report-card fixture no longer models a roomless physical exam; accepted legacy cover
uses the reviewed schedule identity; and manual cover acceptance retains its exact
manual-task authority receipt. The authoritative leave-review link remains the shared
`/work/staff-leave` action surface. Remaining visible `Edura`/`Eduera` copy was replaced
with ThatCampus, the approved light-background mark and install icons are used, and the
approved tagline is present on login, install and invitation identity surfaces.

Release-candidate evidence on 17 October 2026: backend typecheck and zero-warning lint
pass; 17/17 focused temporal, attention and public-brand tests pass; 53/53 previously
failing database assertions pass against an isolated PostgreSQL 17 database; and the
complete backend suite passes **147 files / 1107 tests**. This is local candidate
evidence only. A new Stage run must still pass the clean-checkout matrix and complete
Google Cloud/public revision verification before the digital-twin release is called
published.

[Stage run 39020260985](https://github.com/EduveraIITA/Eduvera/actions/runs/39020260985)
cleared the complete clean-checkout verification matrix: security/deployment
contracts, frontend and desktop builds, all three client test shards, **147 backend
files / 1107 tests**, and all three release-image builds. Promotion stopped before a
candidate revision was created because the long-lived Stage database keeps
`pgcrypto` in its dedicated `extensions` schema while the historical baseline and
fresh verification databases install it in `public`. Migration 104 now establishes
the extension and normalizes its schema before creating temporal digital-twin lineage
evidence, rather than relying on environmental history. A replacement Stage run must
still pass migration, candidate and public-revision verification before publication
is claimed.

[Stage run 39021148594](https://github.com/EduveraIITA/Eduvera/actions/runs/39021148594)
then passed the complete verification matrix, migration execution, photo-service
deployment and zero-traffic candidate creation for `da8e7b2`. Its final smoke check
correctly failed closed because the verifier still expected the retired
`OmniSchool · Staff` document title even though the reviewed Stage branding serves
`ThatCampus · Staff`. The verifier and its success-path contract now use the current
brand. Promotion/public revision verification remains required before publication is
claimed.

## Repository authority reconciliation — 17 October 2026

The owner requested that subsequent work use the new committed digital-twin direction.
The active integration head inspected was `Stage` at `e1086b3`; `main` at `59879d7`
still contained the v1-era root instructions. Root `AGENTS.md` on Stage already used
Blueprint v2 and its normative companions. It now also names the integration-branch
check, repository-wide scope and current contract index to prevent sessions from
silently using an older default-branch document.

Corrected two live entry-point conflicts: README still named the v1 PDF as the primary
baseline, and the enrollment lifecycle header still named it as current authority.
Root design/architecture/functionality/flow proposals now explicitly defer to v2;
the annual-planning delivered-scope paragraph now reflects the already accepted
14 October canonical calendar editor rather than the superseded separate editor.
Historical release evidence remains unchanged.

The contract index records how the requested teaching-preference workflow must
integrate with current identity/coordination ports, canonical spaces, owned work,
existing schedule drafts, temporal publication and coverage reconciliation. This is
an implementation direction, not a delivered teacher-preference feature. The early
unconnected solver/schema scratch work has not been registered, migrated or shipped.

## Development simulator retention and published DT inventory — 17 October 2026

Owner clarification supersedes any interpretation that synthetic development code is
disposable before launch cleanup. At integration commit `bc4ea2b`, Git contains the
complete `devtools/campus-simulator` runner and Cambridge behaviour fixture, guarded
Cambridge seed, development Campus Lab frontend adapters, permanent Campus View,
Campus Model Core, coordination runtime and isolated scenario foundation. The tracked
core/Campus View/scenario/Campus Lab inventory contains 84 files; the simulator source
and broad digital-twin implementation are not confined to an unpushed checkout.

[Stage run 39021823505](https://github.com/EduveraIITA/Eduvera/actions/runs/39021823505)
passed the complete clean-checkout verification matrix, migrations, both release-image
builds, photo-service verification, zero-traffic candidate verification, public
promotion, branded app/staff smoke checks and website deployment for `bc4ea2b`.
This establishes that the current broad digital-twin and scenario product code is
published on Stage. It does **not** establish that the separate wall-clock Campus Lab
actor process is running there: its reviewed implementation still requires loopback,
private demo authentication and all external connectors disabled, and the Stage release
contract currently excludes that local process. A dedicated Cambridge-only hosted
development/showcase contract is an open deployment slice. Until then, contributors
must preserve, test and push the full runner rather than deleting it or representing
source retention as hosted execution.

Real-market cleanup is deferred. It may begin only after an explicit owner instruction
to clean for real market release, and must distinguish the removable development actor
harness/fixture from permanent product capabilities such as Model Core coordination,
Campus View and isolated what-if analysis.

The owner also requested an explicit administrator control rather than an always-on
local runner. Experimental settings now exposes **Activate simulation / Stop
simulation** beside current Cambridge status. The authenticated same-origin
development proxy is the only caller of the loopback control endpoint; the existing
ephemeral proxy key is required. Stopping clears timers and projects zero simulated
actors/actions without changing timetable or domain data. Activation reconnects or
refreshes Cambridge and resumes from the real current instant, still respecting the
instructional calendar and school-hours gate and never replaying missed actions.

## Hosted Cambridge Campus Lab for Stage testing — 17 October 2026

The owner authorized simulated Cambridge users on the actual Stage platform during
active feature development, with the additional requirement that stopping the harness
must not reserve paid simulator compute. The implementation keeps the runner separate
from the application as `eduvera-stage-simulator`, with no database access, zero
minimum instances, one maximum instance and request-time CPU. Its durable start/stop
state lives in a Stage-only application table. Once stopped, the admin client stops
polling and Cloud Run can scale the simulator to zero; there is no simulator scheduler
or always-on instance. Activated execution advances through bounded admin-client
pulses, so it is intentionally a live testing aid rather than an unattended daemon
when nobody is using Stage.

The runner calls the canonical app through normal domain APIs. A rotated Secret
Manager service credential maps each request only to an exact active
`@example.test` user in synthetic school code `cis`; commands remain attributed,
authorized and audited as that Cambridge person. A second rotated key protects runner
status/control. The browser receives neither secret. The same-origin app proxy rechecks
active Cambridge admin membership, while the existing public-demo mutation guard
continues to block start/stop writes.

Stage's web image includes only the build-gated Campus Lab adapter; the simulator is
built as its own image and the default customer build keeps the adapter disabled.
Local verification currently includes backend TypeScript build and focused lint,
26/26 simulator tests, 19/19 release/deployment-boundary tests and focused frontend
lint. The full local frontend build remains blocked only by pre-existing untracked
numbered duplicate test artifacts, which were not modified. Clean-checkout Stage CI,
deployment and authenticated mobile validation remain open evidence gates.

### One-hour Cambridge timetable replay — 17 October 2026

The owner superseded the earlier real-duration development clock so frontend behavior
can be observed economically during active development. Campus Lab now reads the
current instructional date's actual `effective_school_schedule`, retains every real
slot ID and school-local start/end value, and maps the complete first-to-last-slot
window proportionally onto one fixture-configured 3,600-second run. The timetable is not
rewritten in PostgreSQL: normal timetable panels keep the authoritative Cambridge
version while their shared rehearsal marker, active periods, Campus View expectations
and configured actor actions advance from the same accelerated status projection.

Action timing is configured as a bounded ratio within a named real timetable phase,
so a timetable change cannot leave an accelerated run waiting for an obsolete fixed
offset. Holidays, closures and days without an effective schedule still fail closed.
One activation produces one bounded one-hour run and pauses at completion; the runner does not
loop material writes. Stopping remains durable and lets the separate hosted service
scale to zero. Focused simulator verification covers the exact one-hour bounds,
source schedule identity, accelerated campus time, phase advancement and bounded
action due instants. Stage deployment and owner mobile acceptance remain open.

### Cambridge configured-attendance convergence — 17 October 2026 (local correction)

Owner validation exposed that a Campus Lab receipt saying “Demo teacher submitted
Class 6A attendance” did not change the principal's scheduled subject register. The
receipt described a real write, but the runner had called the separate `daily_class`
API while Cambridge's effective Operating rule and principal workspace use
`scheduled_session`. Both attendance models remain valid product capabilities; the
simulator selected the wrong one.

Cambridge behaviour v6 now reads the effective attendance mode first. For
`scheduled_session`, it resolves an open register from the normal attendance-model
workspace, constrains it to a real `schedule_slot_id` in the active published period,
starts a hosted fixture session for that register's exact assigned teacher, and
submits `/attendance-model/sessions/:sessionId/submit`. For `daily_class`, it retains
the daily register flow; for `none`, it records a visible no-action receipt. The
existing owning-domain transaction retains roster validation, revision/idempotency,
authorization, immutable evidence, Model Core command/outcome and outbox invalidation.
Before emitting a successful Campus Lab receipt, the runner re-reads the principal's
authoritative workspace and requires the identical session to be submitted/final with
marked and roster counts equal to the submitted payload. A mismatch becomes a visible
issue receipt. No cache copying or compensating synchronization was added.

A Stage rehearsal also exposed a startup retry storm: the simulator fetched the full
principal timetable projection merely to discover the school-local date, hit its
bounded HTTP timeout while the server continued the expensive work, and retried every
five seconds. Startup and refresh now obtain the current date from the configured
institution timezone and read the narrower effective day-plan contract directly.
Booting is single-flight with a bounded retry interval, and activation returns a
connecting snapshot immediately instead of holding the operator request open. This
keeps simulator control responsive and prevents overlapping abandoned timetable reads.

Local verification: Campus Lab model/action tests pass **20/20**, including scheduled,
daily-class and disabled-mode routing; backend TypeScript typecheck passes; and the
focused attendance-model convergence suite passes **5/5**. Stage deployment and a
fresh one-hour-run mobile validation remain open evidence gates.

## Gate references, direct search and visitor photos — 17 October 2026

Implemented on an isolated feature branch from Stage following the owner's three HTML
references and follow-up photo/no-host decision. Preserves shared theme and navigation,
Hindi support, permission-scoped direct search, pickup safeguards and home-only host
approval. Adds camera/file photo input, preview/removal, private authorized photo reads,
host approval photo, category and no-host direct arrival. Migration 122 makes host optional
with a database invariant for direct entry and stores only photo metadata in PostgreSQL.
Search also accepts an exact roll number across classes; no class selector is required.

Local backend/frontend typechecks, production frontend build, 34 focused UI tests and
6 photo/gate unit tests passed. Focused lint passed after fixing photo URL cleanup.
Added isolated-database tests for direct entry/retry/outbox, photo round-trip, current
host/gate authority, school isolation and revocation; hosted CI must execute them.
Local visual browser verification is blocked by unavailable Chromium and a corrupt
browser-download response. No screenshot or device-validation success is claimed.
A local Vite preview is running on port 5177; hosted deployment and owner-device review
remain pending until separately verified.

Follow-up before release: the portable Chromium runtime succeeded with synthetic API
fixtures. Visitor form and direct search rendered at 320/768/1024/1440 px with no page
errors; visitor form overflow checks passed at all four widths. Phone and tablet
screenshots were visually inspected. This supersedes the initial browser-download
block above. Native owner-device camera review remains open. Large JPEG/PNG camera
captures are resized locally before upload; submission waits for photo preparation.

## 17 October 2026 — scanner home and camera-only visitor follow-up

Owner requested the new pickup scanner HTML reference for In & Out home and resumed
the camera-only visitor change. Added themed viewfinder/checkpoint presentation and
live scanner status; retained real student/guardian verification and direct search.
Removed file picker; live camera captures JPEG on Apple and other devices, with preview,
retake/removal, permission-error recovery, cancellation and late-stream cleanup.
Local frontend typecheck, focused lint and 15 gate/form tests passed. Portable Chromium
synthetic fixtures verified camera capture to preview, no page errors, and visitor/search
layouts at 320/768/1024/1440 px. Real iPhone camera acceptance remains open. Deployment
is tracked separately; these checks do not establish real-device or hosted acceptance.

## 17 October 2026 — owner compact visitor form correction

Removed the inactive decorative QR panel and its checkpoint introduction. Simplified
visitor photo to a camera control and a small captured thumbnail with overlaid removal;
removed helper text and the no-host entry note, retained optional host/direct entry,
and styled categories as reference pills. JPEG data URL previews fix the production
CSP incompatibility of blob image previews without weakening the security policy.
Validation: frontend typecheck, 15 focused gate/form tests and focused ESLint passed.
Portable Chromium verified capture and a decoded thumbnail (naturalWidth > 0), no page
errors, responsive visitor/search layouts at 320/768/1024/1440px, and absence of the
removed home QR panel. Compact captured-photo screenshot was visually reviewed.

## 17 October 2026 — gate header and camera placement correction

Owner marked the redundant gate heading/introduction for removal and requested an
icon-only camera directly above visitor name. Removed that block, moved the language
switch to the footer, and moved the accessible camera action above the visitor fields.
Existing thumbnail removal and camera lifecycle remain unchanged.
Frontend typecheck, focused lint and 15 gate/form tests passed. Portable Chromium
verified capture/decoded preview without page errors and responsive layouts at
320/768/1024/1440px; icon-only control and top thumbnail screenshots reviewed.
