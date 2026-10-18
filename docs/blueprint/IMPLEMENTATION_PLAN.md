Warning: truncated output (original token count: 170964)
Total output lines: 9293

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

## Messaging-to-core human-agent convergence — 17 October 2026 (local complete)

The existing Messaging domain now records accepted person-to-person communication
through a narrow Model Core event-journal port without turning ordinary chat into the
operational mailbox:

- conversation creation, message send/edit and conversation read-through emit typed,
  transactional outbox facts and immutable Model Core events;
- sender and current recipient account endpoints resolve to stable institution human
  agents, with recipient participation retained in an environment-qualified event link;
- bodies, attachments and inferred intent remain exclusively in the governed Messaging
  domain. Core payloads contain only safe structural metadata such as conversation kind,
  attachment/reply flags and recipient count;
- the bridge uses the scoped execution database, so the same implementation journals to
  Live or to the selected isolated Simulation fork and cannot leak a simulated message
  into Live;
- ordinary message events do not create Request/Task/Offer records. Any operational
  effect still requires an explicit domain command or an activated, versioned behaviour.

Implementation evidence: migration `134_communication_agent_event_journal.sql`, the
generic `DomainEventJournalPort`, `ChatModelBridgeService`, backend TypeScript build,
the communication contract tests and realtime-isolation tests. The local migration
also exposed and corrected unapplied migration 133 so new realms select one latest
active version per contract key instead of attempting overlapping activations. Full
isolated-database chat acceptance remains gated by `TEST_DATABASE_ISOLATED=true`.

## Two-world Campus Lab convergence — 17 October 2026 (local complete; managed provider open)

The owner superseded the earlier Cambridge Live-fixture mutation contract. Campus
Lab now uses the same two-world execution model required for customer what-if work:

- activation takes a full point-in-time PostgreSQL snapshot into a separately
  addressed local database, registers a coverage-gated Simulation data plane and
  binds the administrator's server session to its run namespace;
- the four representative sessions and every lazily opened synthetic staff session
  explicitly bind to that same run before reading or acting, so timetable,
  attendance, messages, requests, Campus View and the rest of the normal application
  route through one fork rather than through screen-specific simulation adapters;
- the runner advances the shared virtual clock through the authenticated control
  plane; the normal top marker is the existing **Simulation** marker and Live never
  inherits the rehearsal clock;
- stop returns the operator session to Live, halts and releases actor sessions, then
  destroys the registered driver and physical fork. If the actor status service is
  already unavailable, return-to-Live and discard still win. A failed activation
  compensates back to Live and removes its partial fork;
- the local adapter is development-only and checks both database addresses are
  distinct loopback PostgreSQL databases. Stage/production fail closed until a
  managed, tenant/privacy-reviewed snapshot provider is configured; shell database
  lifecycle is not represented as a production implementation.

Verified local evidence: backend build passes; focused auth/data-plane tests pass
28/28; focused frontend environment/control tests pass 21/21; production frontend
build passes; a real one-minute run returned a server-confirmed Simulation namespace,
advanced across effective Cambridge dates and recorded a teacher message through the
normal chat domain. Stop returned the same browser session to `live:<school-id>` and
the transient PostgreSQL database no longer existed. The existing Cambridge Live
fixture still contains historical records written by the superseded harness; this
slice deliberately does not perform an unsafe partial rollback.

## Accepted direction

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
after-hours review. The runner…150964 tokens truncated…ueries run only inside the matching
  `ExecutionDataPlaneScope` and isolated outbox. Simulation cursor IDs include an
  opaque run-namespace fingerprint, while a foreign, legacy or caller-supplied cursor
  can only request a full refresh and cannot select an environment. Active session
  bindings are rechecked before broadcast and on heartbeat so a switched, expired or
  invalid session stream is closed rather than receiving the former environment.
  Focused cursor, namespace, scope and broker lifecycle tests pass **8/8**; backend
  build and scoped lint pass. The Simulation stream poll remains process-local, like
  the current isolated driver registry; shared multi-instance run storage/broker
  provisioning and complete module projection parity remain open release gates.
- The frontend has one application-level environment context and compact marker on
  authenticated operational routes. Its environment comes from the authenticated
  server session; activation and Return to Live use that control plane, clear cached
  server state after confirmation and retain the same route/module tree. It exposes
  no client environment persistence or magic headers. No parallel Simulation route,
  module tabs or workspace CTA remains. Complete environment-aware domain adapters
  remain open.
- The first tenant-generic campus adapter remains limited to future
  teacher/space-unavailability planning and aggregate Campus View KPIs.
- Complete enabled-module snapshots, shared multi-instance ephemeral storage,
  scenario event/realtime projections and whole-application domain adapters
  remain delivery work. No current evidence supports calling those capabilities
  complete or production-ready.

Next dependency order:

1. keep normal Live routes independent of Campus Lab and retain release-boundary
   tests;
2. register concrete Live/copy-on-write domain-store, executor, clock and side-effect
   adapters, with a coverage manifest that prevents activation until all modules
   enabled for that institution are represented;
3. provide encrypted shared TTL scenario storage and run-scoped event/projection
   streams;
4. connect one event-reactive end-to-end scenario (staff absence → Offers → responses
   → timetable/Requests/Today effects); and
5. add timetable, attendance, Messages, Requests, Campus View/KPI and every remaining
   enabled-module adapter so the existing app reaches Simulation parity, with isolated
   store/cache/realtime namespaces and explicit temporary unsupported states.

### Unavailable Simulation session tombstone — 17 October 2026 (local)

An authenticated session no longer falls silently back to Live when its selected
Simulation expires, its authorized run disappears after a runtime restart, or its
isolated application data plane is no longer registered. The persisted session
binding is retained as an explicit unavailable-Simulation tombstone with its original
institution/scenario/run/namespace identity and a bounded reason; it carries no
executable environment and no fabricated virtual clock. Only an explicit **Return to
Live** command (or the existing explicit institution/session transition) removes the
binding.

The first session guard returns HTTP 410 for ordinary APIs before permission or
domain handlers can query data, while the auth control plane remains available for
session inspection and Return to Live. The interceptor repeats the fail-closed check
as a defense at the data-plane boundary. The React application understands the
server-owned tombstone, mounts no campus children, creates no environment query key,
and shows a full-height **Simulation unavailable** recovery screen on the same route.
Live data is explicitly not rendered as fallback; Return to Live clears cached server
state only after the server confirms the change.

Focused evidence: backend unavailable/expired/restart/session-guard/interceptor tests
pass **16/16**, backend TypeScript build and scoped lint pass; frontend execution-
environment parser/context/boundary/API/marker tests pass **32/32**, and frontend
TypeScript plus scoped lint pass. This fixes environment-loss handling only. It does
not provide the still-missing shared isolated driver provisioner, complete snapshots,
all-domain Simulation adapters or production-ready full-application parity.

## Universal institution model v1.0 — 17 October 2026

`UNIVERSAL_INSTITUTION_MODEL.md` now proposes the domain-neutral realm, semantic
catalogue and adapter model required to span a one-room coaching centre through a
multi-institution network without adding domain branches to the Model Core. It separates
the universal kernel from versioned semantic profiles, domain adapters, realm
capability configuration and domain-native projections. It also defines institution and
cross-realm exchange boundaries, recursive organization/topology, people and agent identity,
authority, universal time/planning primitives, evidence states, Live/Simulation isolation
and conformance gates. Parallel architecture, institutional-scenario and implementation
reviews then separated OperationalRealm from Institution/legal party/data responsibility;
environment-qualified model identity; semantic, protocol, capability and terminology
registries; independent claim/reconciliation/consistency axes; direct-command ingress;
party/representation and cross-realm exchange; adapter/capability lifecycles; civil time;
privacy/restructuring; and resilience/observability contracts.

The architecture is now an accepted target contract. Acceptance does not claim complete
implementation. The first implementation dependencies are
reviewed semantic/protocol registries; OperationalRealm and environment-qualified identity;
organization-group realm, organizational-unit, legal-party/data-responsibility and
agreement-envelope/local-acceptance exchange contracts; capability manifests; generalized
authority/policy receipts; and environment-aware adapter coverage. Existing `school_id`
storage remains a compatibility boundary until a separately migrated and tested realm
contract is delivered.

### OperationalRealm and Attendance contract seam — 17 October 2026 (local)

Migration `124_operational_realm_model_address.sql` adds the domain-neutral
`operational_realms` compatibility mapping, server execution namespaces, separate semantic-
type/protocol-schema/capability-manifest registries, and realm/environment-qualified model
entity and observation identity. Existing `school_id` remains present while every current
school is backfilled to one institution realm and one `live:<school_id>` namespace. The
entity and observation uniqueness boundaries now include realm plus environment namespace,
so an isolated Simulation copy can no longer alias a Live model address.

The Core resolves the server-selected environment through the existing request-local data-
plane scope, creates Simulation namespace metadata only inside that isolated data plane,
and rejects an environment belonging to another institution compatibility key. Generic
observation ingress can validate optional reviewed semantic, protocol and capability
references without a domain-specific branch. The Attendance observation adapter is the first
caller to provide those references (`student`, `class`, `attendance.status_observed`, and
the Attendance capability manifest). Legacy adapters remain explicitly transitional rather
than being falsely marked catalogue-certified.

Local evidence: backend TypeScript build passes; focused Model Core contract, Attendance
convergence and OperationalRealm/model-address suites pass **24/24**; `git diff --check`
passes. The migration has not been applied to a database in this checkout because no
`MIGRATION_DATABASE_URL` or `DATABASE_URL` is configured. Database migration execution,
integration evidence, conversion of the remaining core records/adapters, registry
activation administration and complete Simulation snapshot namespace rewriting remain open
release gates.

### Realm contract governance and exact evidence pinning — 17 October 2026 (local)

Migration `125_model_contract_registry_governance.sql` makes the three reviewed model
catalogues operational. Each OperationalRealm now has an effective-dated activation record
for a particular semantic type, protocol schema or capability-manifest version. The initial
backfill activates only the already-reviewed active definitions for existing setup/active
realms. Reviewed definition content is immutable: lifecycle status may progress, but changing
meaning, schema, compatibility or approval evidence requires publishing a new version.

The reusable `ModelContractRegistryPort` resolves portable adapter references only when every
requested definition is globally active and currently activated for the selected realm. It
fails closed when one pin is missing or suspended. Certified observation ingress now stores
the exact semantic definition on its subject/context entities and the exact protocol and
capability identities and versions on the retained observation. A later catalogue release
therefore cannot silently reinterpret historical evidence. Existing adapters without
`contract_refs` remain visible as transitional uncertified producers; this is migration
compatibility, not an implicit activation or hidden default.

Local evidence: backend TypeScript build and scoped ESLint pass; focused Model Core,
OperationalRealm, registry-governance and Attendance convergence tests pass **27/27**. The
migration has not been applied because this checkout has no configured isolated database.
Relationship-type pinning, realm activation administration/authorization, upcasters,
remaining adapter certification, all-record namespace qualification and database-backed
migration/replay evidence remain open core gates.

### Environment-qualified relationship and command state — 17 October 2026 (local)

Migration `126_model_relationship_command_address.sql` extends the ModelAddress boundary
from entities/observations to relationship history and accepted command/outcome traces.
Relationship source and target, command target and outcome result must now resolve inside the
same OperationalRealm and execution namespace through composite foreign keys. Current
relationship and command idempotency keys are unique per realm/environment, allowing a
Simulation fork to apply the same logical operation without colliding with or mutating Live.
The Core obtains this scope from the server request-local execution data plane; it is not
accepted from a domain adapter or client payload. Registered device/integration scope traversal
also follows relationships only inside that resolved environment.

Existing records are backfilled into their entity's Live address (or the school's Live
namespace for targetless commands). Local evidence: backend TypeScript build and scoped ESLint
pass; focused address-isolation, registry, OperationalRealm, Core contract and Attendance tests
pass **30/30**. Migration execution is still pending without an isolated database URL. Events,
reactions/messages, temporal occurrences, agent/configuration environment semantics and full
database-backed replay isolation remain subsequent core gates.

### Environment-qualified execution and coordination chain — 17 October 2026 (local)

Migration `127_execution_trace_model_address.sql` moves the complete mutable execution spine
behind the ModelAddress boundary in one convergence slice: typed events, temporal schedule
occurrence revisions, reactions, coordination exceptions, operational messages and message
outcomes. Each child inherits its realm/environment from its addressed parent; database
triggers reject a missing parent, a cross-environment reference or later address mutation.
Composite constraints also keep event causation/supersession, temporal entity references and
reaction/message lineage inside the same environment.

Event, reaction and message-outcome idempotency is now realm/environment-local. Consequently a
Simulation can replay the same configured workflow and logical keys without returning a Live
event or suppressing simulated work. Existing records are deterministically backfilled through
their entity/event/reaction/message parent into Live. Realm-shared people-agent identity and
approved behaviour configuration deliberately remain shared definitions; their mutable
execution records are isolated.

The Core's current-activity, operational-signal and temporal-context projections now bind to
the request-local execution namespace. Temporal entity/observation lookups, registered-source
relationship traversal and replay queries no longer use an unqualified school-wide model row.
Frontend/domain callers still use their existing domain ports; no Model Core storage concept was
introduced into UI code.

Local evidence: backend TypeScript build and scoped ESLint pass; **76/76** focused registry,
address, Core, Attendance, coordination and temporal lineage/substitution tests pass. Migrations
124–127 remain unapplied because this checkout has no isolated database URL. Database migration
and rollback rehearsal, agent/configuration snapshot semantics, environment-qualified projection
checkpoints, generic authority/policy receipts, registry administration/upcasters and remaining
adapter certification are still open core gates.

### Execution identity, sealed configuration and authority evidence — 17 October 2026 (local)

Migration `128_execution_identity_authority_checkpoint.sql` implements the next shared-kernel
boundary as one coordinated slice. A stable `campus_model_agents` identity still represents the
real person, team, device or bounded software actor across the realm; an execution-local actor
binding now states whether that identity is acting as the Live agent, a Simulation counterpart or
an explicit delegate. Database guards prevent a Live agent binding inside Simulation, a simulated
counterpart inside Live, or later rewriting of the captured actor identity/configuration.

Execution configuration is sealed into an immutable snapshot plus exact version/hash items for
Operating rules, behaviour, domain configuration, semantic/protocol contracts, capability
manifests and terminology. The reusable `ExecutionSnapshotPort` computes a deterministic content
hash and requires a Simulation fork to match the server-selected `source_snapshot_ref`; a caller
cannot install a different state after entering the run. Simulation authority is copied as an
immutable minimum grant set tied to that exact snapshot. Live authority remains current and
effective-dated. It is not silently replaced by a snapshot.

The reusable `AuthorityEvaluationPort` now emits immutable, idempotent receipts within one
ModelAddress. In Live it evaluates current agent authority; in Simulation it requires the exact
snapshot and actor binding, then evaluates only the frozen grant set. Accepted Model Core commands
may reference an allowed receipt, and the Core rechecks same environment, actor, correlation and
validity before retaining that reference. The field remains optional only for existing adapters
during convergence; catalogue-certified adapters must be migrated to issue and retain it before
the release gate can close.

`ProjectionCheckpointPort` adds environment-local forward-only checkpoints keyed by realm,
namespace and consumer. This prevents a Simulation replay cursor from advancing or suppressing a
Live projection. It is the storage contract for subsequent leased replay/rebuild workers, not a
claim that those workers are complete.

Local evidence: backend TypeScript build and scoped ESLint pass; the focused migrations 124–128,
registry, ModelAddress, Core, Attendance, coordination and temporal suites pass **109/109**
(the narrow migration-124–128 address/registry set is **20/20**). Migration 128, like 124–127, is not applied in
this checkout because no isolated database URL is configured. Database migration/rollback and
concurrency rehearsal, an authorized snapshot provisioner that copies every enabled domain,
projection leases/rebuild APIs, command-adapter adoption of authority receipts, general policy
decision receipts, retention cleanup and all-domain Simulation parity remain open release gates.

### Domain-neutral snapshot provisioning and projection recovery — 17 October 2026 (local)

Migration `129_execution_provisioning_projection_recovery.sql` and the reusable
`ExecutionProvisioningPort`, `ProjectionRecoveryPort` and `EnvironmentRetentionPort` implement the
next Core reliability boundary. The kernel still does not know an Attendance, timetable, finance or
people table. A reviewed, versioned snapshot adapter definition names the handler and capture/restore
schema and is backed by a realm-activated capability manifest. Each realm explicitly activates the
adapter for a module.

An authorized Live capture request freezes the requested module list and exact adapter versions into
an immutable expected-coverage manifest. Missing coverage blocks capture; overlapping required
adapters fail as ambiguous. Each domain adapter contributes only a content-addressed artifact
reference, record count, source watermark, privacy-transform reference, capture/restore schema pins
and safe metadata. Replay keys carry request hashes, and a repeated adapter contribution must exactly
match retained evidence. A provision becomes ready only when every frozen adapter contributes.

Inside the server-selected Simulation data plane, restoration must match the provision's source
snapshot and sealed execution snapshot. Every expected adapter reports an exact artifact hash,
restore-schema version, restored row count and adapter-owned receipt. The Simulation restore cannot
become ready until all captured adapters have reported. This establishes the domain-neutral
orchestration contract; individual domain artifact serializers/restorers and the shared encrypted
artifact store are deliberately adapter/infrastructure work, not hidden generic-table copying in the
Core.

Projection recovery is now an authorized, environment-local job with an immutable request hash,
requested sequence boundary, configured retry-policy reference and exact retry delays. Workers claim
jobs with bounded `SKIP LOCKED` leases, heartbeat ownership, cannot complete before the matching
environment checkpoint reaches the requested boundary, and retain poison events in a separate
quarantine with safe diagnostics. Retry timing is supplied by reviewed configuration rather than a
hard-coded Core default.

Transient Simulation retention likewise has an explicit policy reference, allowed authority receipt,
artifact classes, bounded attempts and configured retry delays. A worker must report deletion counts
for every declared artifact class before the namespace can be marked expired. The Core retains the
cleanup ledger; a privileged storage executor performs physical deletion so ordinary application code
does not acquire broad destructive access.

Local evidence: backend TypeScript build and scoped ESLint pass; focused Model Core, Attendance,
coordination, temporal, registry and migrations 124–129 suites pass **118/118** (the narrow
provisioning/registry/ModelAddress set is **29/29**). Migration 129 has not been applied because this
checkout has no isolated database URL. Database migration/rollback and multi-worker lease rehearsal,
adapter-definition/activation administration, encrypted artifact transport, implementation of every
enabled domain capture/restore adapter, a privileged retention executor, quarantine release workflow,
and hosted all-module Simulation parity remain open release gates.

### Core persistence boundary convergence — 17 October 2026 (local)

Transport-duty coordination no longer reconstructs event/reaction/message traces by querying
Model Core tables. `CoordinationRuntimePort.findExactTrace` now owns that exact, revision-bound
lookup. The overdue-attendance coordinator likewise asks the Core whether an outbox event has
already been accepted and claims open workflow messages through the operational-mailbox port;
it reads only the authoritative attendance registers needed to decide whether its domain work is
satisfied. The Core still owns message locking and work-state selection.

A source-level architecture regression rejects direct Model Core SQL from ordinary business
domains. The only explicit allowlist is the Campus View/KPI read projection and the scenario
snapshot adapter. Those adapters still perform transitional cross-store composition and must move
to independently checkpointed projection/snapshot contracts; the allowlist is not production
acceptance of generic table access.

Local evidence: backend TypeScript build passes. Focused coordination, staff-leave, transport and
persistence-boundary tests pass **26/26**. Database-backed locking/concurrency evidence remains
open because this checkout has no isolated database URL. Full backend lint remains blocked by the
pre-existing hosted Campus Lab clock-mode stringification error; this slice does not claim a clean
repository-wide lint gate.

### Pre-domain command gateway — 17 October 2026 (local)

Migration 130 and `DomainCommandGatewayPort` add the first shared execution boundary for material
domain mutations. Before an adopted domain writes authoritative state, it now prepares an
environment-qualified command envelope with an immutable canonical request hash, idempotency key,
stable acting-human identity, target and expected revision, handler/version, exact configuration
references and authority evidence. A replay with the same envelope returns the existing command or
terminal outcome; reuse of the key with different intent fails closed. Terminal completion records the
owning domain's result revision/event and supports an explicit `uncertain` state so an ambiguous effect
cannot be presented as accepted.

The gateway remains behaviour-neutral. In Live it retains a fresh authority attestation supplied by the
owning domain after that domain re-evaluates its current relationships, appointments and rules. In
Simulation it ignores Live attestations and evaluates only the frozen authority grants of the isolated
environment. It does not move business validation into the Core or permit the Core to mutate domain
records.

Two end-to-end paths now prove the boundary:

- staff-leave approve/reject prepares `staff.leave.decide` after current Governance authority and request
  revision checks, then completes it with the Staff-owned revision and outbox event;
- attendance record/submission prepares an attendance command after fresh membership, class assignment,
  cover, roster, register revision and Operating-rule checks, then completes it with the authoritative
  register revision and event.

Source-level regression coverage verifies migration/schema invariants, realm/environment isolation,
identity and authority retention, replay semantics and the ordering of both domain integrations. The
remaining acceptance work is migration/concurrency evidence on an isolated PostgreSQL database,
independently durable rejected/failed evidence when a domain transaction rolls back, recovery and expiry
for abandoned `pending`/`uncertain` commands, administration of handler/configuration versions, and
adoption by the other material domain mutations.

### Fresh-database Core correctness audit — 17 October 2026 (local)

The migration, seed and implemented Core boundary have now been exercised from zero on a disposable
PostgreSQL 17.11 database rather than only through source-level contracts. Migrations 131–133 close
three discovered provisioning gaps: every newly inserted institution atomically receives one
OperationalRealm and Live namespace; empty institution rollback follows the school → realm →
namespace ownership chain while populated model history stays restrictive; and each realm receives
the currently reviewed structural contract pins plus its institution identity. This provisions
schemas and identity only—it does not activate an Operating rule, subscription, reaction, recipient
or automation.

The Cambridge post-migration seed now reconciles all explicit person/account identities into stable
human agents and current endpoints, Campus Lab relationship writes use the complete ModelAddress,
and the private gatekeeper provisioner creates its Staff agent/endpoint in the same transaction.
Test fixtures that previously chose an arbitrary first administrator now bind explicitly to the
Cambridge school, removing suite-order ambiguity without weakening tenant isolation.

Verified evidence: fresh migration and full seed succeeded; **418** active Cambridge human agents
and **418** current account endpoints were retained; production TypeScript build and scoped ESLint
passed; Python seed tests passed **12/12**; and the fully enabled backend suite passed
**1,220/1,220** tests across **167/167** files with destructive integration suites enabled. The new
whole-model integrity suite checks realm/address cardinality, active contract coverage, human-agent
endpoint completeness, cross-address consistency and evidence-certification atomicity. Full method,
defect evidence and the still-open blueprint gates are recorded in
`CORE_VERIFICATION_AUDIT_2026-10-17.md`. This is evidence for the implemented boundary, not a claim
that the target Core or production release gates are complete.

### Shared operating-day vertical slice — 17 October 2026 (local)

The first MC-3 application composition is now implemented across timetable, Attendance,
accepted gate evidence and cross-domain contradiction signals. `TemporalContextPort.listOperatingDay`
owns the environment-qualified effective schedule query, including current substitution/cancellation
lineage and exact timetable-period identity. The new domain-facing `OperatingDayService` composes that
plan with authoritative records through the request-selected data plane and execution clock; it does
not expose Core persistence to frontend code.

Attendance is deliberately configuration-sensitive. `daily_class` produces one expected register per
class/day, `scheduled_session` produces one per effective occurrence and joins the subject-session
register by its canonical timetable slot, while `none` returns `not_required` and zero invented work.
Staff receive only occurrences assigned to their stable human agent; administrators receive the whole
institution day. The projection supplies Live/Simulation identity, Now/Next/completed state, gate totals,
register progress, provenance/freshness and reviewable gate/schedule contradictions. It is available as
`GET /api/v1/schools/:schoolId/operating-day` and is embedded in the existing teacher Today and Principal
Overview responses and UI without replacing their established navigation or domain action screens.

Verified evidence: backend TypeScript production build; focused projection tests **3/3**; PostgreSQL 17
fresh migration and seed; database-backed daily/session/none repository integration **1/1**; Nest startup,
administrator login and endpoint response against the disposable database; focused frontend component
test **1/1**; and frontend production build. The integration test remains opt-in behind the existing
isolated-database guard. The seed does not itself emit historical timetable events into the Core, so the
fresh-seed endpoint correctly returned an empty modeled schedule; model backfill/convergence remains a
separate open gate rather than being hidden by a legacy timetable fallback. Campus View still has its
transitional allowlisted composition and must converge on this boundary/checkpoint before MC-3 is complete.
## Gate references, direct search and visitor photos — 17 October 2026

Implemented on an isolated feature branch from Stage following the owner's three HTML
references and follow-up photo/no-host decision. Preserves shared theme and navigation,
Hindi support, permission-scoped direct search, pickup safeguards and home-only host
approval. Adds camera/file photo input, preview/removal, private authorized photo reads,
host approval photo, category and no-host direct arrival. Migration 122 makes host optional
with a database invariant for direct entry and stores only photo metadata in PostgreSQL.
Search also accepts an exact roll number across classes; no class selector is required.

During integration with the shared digital-twin branch, host-free visitor entry and
all later visitor check-in/check-out actions were connected to the existing
Observation Ingress port in the same Gate transaction. Gate remains authoritative;
the Core retains only a provisional visitor identity and privacy-minimal accepted
boundary evidence. Phone, photo and purpose do not enter the Core, approval never
becomes presence, and request retries cannot duplicate observations. Focused
isolated-database coverage asserts one ordered entry/exit pair and no phone leakage.

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

## 18 October 2026 — deployment test date correction

Gate header release ff0bf02 was blocked by seven existing agent attendance integration
assertions after the school-local clock crossed into Sunday. The tests implicitly used
today even when the fixture had no scheduled lessons. Select the latest actual scheduled
date within the fixture term and use it explicitly in lookup and mocked attendance tools.
Retain all attendance availability/authority checks and assertions; no production rule
or test gate is disabled. Hosted integration rerun must verify this correction.

## 18 October 2026 — one responsive application

The owner retired the separate `/staff` Vite application because its screens were a
dummy parallel experience while the primary `frontend/` application already provides
the responsive, authoritative workflows. Removed `frontend-desktop/` and its duplicate
build, container, runtime configuration, branding checks and CI matrix entry. The
NestJS application now redirects legacy `/staff` bookmarks to `/`; release verification
checks that compatibility redirect and the responsive application shell. Historical
desktop-build evidence above remains an accurate record of earlier checkpoints, not a
current architecture claim.

## 18 October 2026 — approved centered gate layout

Owner approved the two-screen preview with language at top, Guest instead of Official
Guest, and optional visit purpose. Centered the home action group with top breathing
room, retained the shared shell/title language control, centered the icon-only camera
and removable thumbnail, and kept four category pills on one row. Visitor purpose is
optional in the form and authoritative domain validation (omitted values normalize to
an empty string); host approval versus direct arrival remains unchanged.
Frontend typecheck, focused ESLint and 15 gate/form tests passed. Portable Chromium
fixtures verified gate-only and staff layouts at 320/768/1024/1440px, camera capture
and decoded preview, with no page errors or horizontal overflow. Native iPhone camera
acceptance remains owner review.
The inherited Stage run 39063211812 was blocked by unrelated test type errors. Updated
SchoolService test constructors to inject the real model command gateway, aligned
contract registry fixtures and test-double types with current interfaces, retained
all assertions, and corrected two existing lint findings. The 30 focused auth, effect
isolation and registry tests pass; production backend build passes. Hosted integration
and deployment remain separate release gates.

Release follow-up: Stage run 39064145346 passed every frontend check and 1,227 backend
tests, but the isolated CI fixture omitted the existing human-agent identity seed.
Added db:seed:human-agents after profile/governance seeds so current endpoint integrity
and model-mediated attendance authorization run against complete fixture identities.
No domain permission, identity assertion or deployment gate is relaxed.

Release follow-up: b913e63 passed all CI and candidate smoke checks. Public verification
rolled back because the existing Cloudflare proxy rewrites Location: / to the equivalent
absolute branded root URL. Compare the resolved same-origin root URL in the smoke check;
retain 308, reject other origins/paths/query strings, and cover both origin and edge forms
in deployment contract tests. No application routing or authority change is needed.

## 18 October 2026 — organization hierarchy implementation

Owner requested the desktop/mobile organization hierarchy reference. Added the
administrator Organization workspace under More → Institute, preserving the shared
shell. It supports pastel connected hierarchy cards, list/outline, department and
people search, zoom/fit, desktop reparenting, keyboard/mobile parent selection,
details/member/report tabs, staff heads/membership, local Undo and explicit Save.
Empty institutions remain empty rather than receiving invented sample staff.

The Organization domain owns descriptive reporting nodes, not permissions or legal
appointments. Migration 135 retains school-scoped canonical nodes/member FKs,
aggregate revisions and audit snapshots. Current admin membership is locked and
rechecked, staff references are tenant-validated, cycles/depth/size are bounded,
and saves traverse the existing command gateway and accepted-event journal with
atomic domain/outbox/outcome evidence. Exact retries are idempotent; conflicting
saves retain the local draft. Realtime delivery rechecks current admin authority.
See `ORGANIZATION_STRUCTURE_ARCHITECTURE.md` for the ownership and release boundary.

Local evidence: 8 new domain tests and 9 new UI/protocol tests pass; the focused
UI/navigation/protocol suite and 15 domain/gateway tests passed. Backend and frontend compilation and focused
lint pass. Chromium fixture checks at 320/390/768/1024/1440px found no horizontal
page overflow or runtime exceptions; mobile detail editing and Save were exercised.
Isolated PGlite checks executed the new migration and verified composite staff FKs,
deferred reporting parents, atomic replacement/rollback and RLS (not a substitute
for the full production PostgreSQL migration chain).

Release gaps: full backend run passed 835 tests and skipped 227, with 17 integration
files unable to initialize because no disposable DATABASE_URL is configured here.
Added a gated real PostgreSQL/model-gateway suite for saves, replay, revision races
and revoked authorization; it remains to be run in CI. Two existing campus-event
frontend tests fail under the session's UTC timezone and all 39 campus-event tests
pass under Asia/Kolkata. No unrelated test behavior was changed. No push, deployment
or live verification is claimed by this checkpoint. Owner visual acceptance remains.

The full local frontend run completed with 1,153 passes and four failures: the two
timezone-dependent event tests above and two existing parent route interaction
timeouts. These are not represented as a passing full regression gate.
Both parent route tests passed on targeted rerun (24.69s); the complete suite was
not rerun to replace the recorded initial result. Production builds pass, with
the existing Vite large-chunk advisory unchanged.

## 18 October 2026 — gate and safety reference flow refresh

Updated the gate-only home to the supplied two-action Scan QR / Manually layout,
with recent recorded movements and Home / Approvals / Logs / More navigation.
Manual search covers both students and staff; detail pages display current
school-recorded state and expose transitions allowed by that state. Logs retain
revision-bound visitor arrival/departure actions. The scanner also supports
user-selected QR images and a capability-detected flashlight; visitor photo
capture remains camera-only under the prior owner direction.

Added migration 136 and staff gate movement endpoints. Staff boundary events
remain separate from classroom attendance, check current staff and permissions
transactionally, apply transition/idempotency checks and write audit plus
boundary-scoped Model Core evidence. Host approval remains limited to the
addressed active host or school administrator; no account or permission
assignments changed. See `GATE_WORKSPACE.md` for the domain boundary and UI
contract.

Local evidence: frontend typecheck/build, backend typecheck/build, 16 focused
gate/form tests, changed-file ESLint and synthetic-data Chromium checks at
320/390/768/1024/1440 px pass. The browser checks reached student search/detail
and entry controls with no page errors or horizontal overflow. Hosted
PostgreSQL-backed integration and Stage release verification remain required.
