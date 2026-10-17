# Campus Lab development harness

Status: accepted synthetic-actor harness over the product Simulation environment;
retained throughout active development by owner decision. Local isolated data-plane
adapter implemented; managed snapshot provider remains an open deployment gate,
17 October 2026

Normative parents:

- [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md)
- [Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md)
- [ThatCampus Model Core blueprint](THATCAMPUS_MODEL_CORE_BLUEPRINT.md)
- [ThatCampus operating experience](THATCAMPUS_OPERATING_EXPERIENCE.md)

## 1. Purpose

The synthetic school-day runner is a development/demo actor harness for exercising a
transient Simulation fork of the Cambridge International School synthetic fixture.
It lets developers and product reviewers watch fixture people call ordinary domain
APIs inside the same isolated execution namespace shown by the normal ThatCampus
frontend. It does not own Campus View, navigation, topology or a parallel simulator
UI; the product execution-environment boundary owns the fork.

Its purpose is rapid observation while building the Campus Model Core and connected
domain workflows, and a realistic synthetic campus for controlled product
demonstrations. It is not a source of real-campus truth, a customer-configurable
simulator or evidence that predictive simulation is complete. Its source and fixture
remain committed throughout active development; that retention is distinct from
whether a particular hosted runtime has completed its safety gates.

The owner decision for this harness is deliberately simple:

- it is available with the managed local development server and isolated Stage test
  deployment, and starts active unless an administrator explicitly stops it in
  Experimental settings;
- it has four closed development clock modes: real time, or one effective school day
  replayed in 1, 15 or 60 wall-clock minutes. Displayed campus times remain the
  source timetable times;
- it has explicit **Activate simulation / Stop simulation** and clock-mode controls
  for the Cambridge actor process. These are harness controls, not customer timetable
  or product-simulation configuration;
- it resolves the current date in Cambridge's configured timezone and uses only that
  date's effective instructional schedule, including dated overrides, cancellations,
  holidays and closures;
- it never changes, republishes or replaces authoritative timetable records, borrows
  another weekday or bypasses the school calendar; the accelerated wall intervals are
  a development projection of the selected real timetable version;
- synthetic presence and domain actions exist only inside the accelerated replay of
  an instructional date with an effective schedule; holidays, closures and empty
  schedules remain paused with zero synthetic actors and actions;
- accelerated activation advances across effective instructional dates within a
  rolling 30-calendar-day window, skips non-instructional days and rotates only
  inside that disposable harness window; real-time mode follows the actual local day;
- it calls ordinary authenticated domain APIs so the normal event and frontend paths
  are exercised;
- its accelerated clock controls only when synthetic fixture clients issue calls; it
  never becomes the clock/date of the Live application or makes a Live page query a
  simulated date;
- it may show a clearly labelled **Rehearsal now** indication only inside the explicit
  Campus Lab developer route, beside a read-only copy of the unchanged timetable; it
  never overlays normal Live domain routes or injects rehearsal state into their
  query caches;
- a real-market release may exclude simulated actor runtime and controls only after
  the owner explicitly requests the market-cleanup pass; until then the complete
  source and Cambridge fixture remain on the shared development branch.

## 2. What Campus Lab is not

Campus Lab is distinct from the Model Core scenario runtime defined in section 16 of
the Model Core blueprint.

| Campus Lab development harness | Model Core rehearsal/simulation |
| --- | --- |
| development and isolated Stage testing aid | product capability for every institution |
| closed 1/15/60-minute or real-time Cambridge replay | isolated virtual clock |
| Cambridge synthetic fixture only | versioned synthetic or sanitized scenario snapshot |
| normal domain APIs and run-local synthetic counterparts | scenario executors and sink-only dispatchers |
| updates only a disposable Simulation database fork | must never mutate Live domain truth |
| developer-only clock modes and rolling fixture window | administrator-selected scenario range, seed and baseline comparison |
| retained development source; current runner is local-only until a hosted showcase contract is accepted | production code may expose an authorized isolated scenario service |
| helps humans observe integration behavior | supports rehearsal and what-if analysis under declared assumptions |

Campus Lab must not create a second recipient-routing or institution-automation
runtime, claim conformance with the future `ExecutionContext` contract, or be reused
as the implementation of predictive analysis. It may operate a bounded synthetic
human client that reads an already-routed work item and answers it through the owning
domain API. The owning domain and Coordination Runtime remain responsible for the
event, selected recipient, message, authority and outcome chain. A future scenario
runtime may reuse domain contracts and fixture ideas, but it must satisfy the Model
Core isolation, virtual-clock, deterministic-seed and side-effect gates independently.

## 3. Source fixture and scope

### 3.1 Cambridge is wholly synthetic

The harness is restricted to the Cambridge International School fixture in local
development and isolated Stage. Its
people, accounts, classes, rooms, timetable, attendance and conversations are test
data. Every harness run records a synthetic provenance label and an explicit fixture
version. Nothing from the runner may select an arbitrary institution merely because
the signed-in user can access it.

The initial fixture includes:

- all seeded Cambridge teachers and students as visible routine participants;
- a versioned, bounded physical topology: three buildings and their floors; eight
  class home rooms; science, computer, art, music and library learning spaces;
  reception, school and Principal offices; counselling, infirmary, staff and dining
  services; an auditorium; main/service gates; assembly, play, court, transport and
  visitor-arrival areas. Geometry is explicitly schematic and capacity remains the
  authoritative relational field;
- seeded class, room, resource and timetable relationships as planning context,
  including bounded computer, science-kit, tablet and projector holdings;
- synthetic operational staff positions for campus operations, front office, health,
  counselling, library, facilities and safety, transport, security, IT, laboratory
  and food services. Each has a primary campus assignment and ordinary configured
  duty; its home-space mapping is a plan, never physical-presence evidence;
- the existing representative administrator/principal, teacher, guardian and learner
  demo identities, plus ordinary seeded Cambridge staff accounts for actions addressed
  to one exact synthetic person, for domain actions their real permissions permit;
- a point-in-time copy of existing seeded domain records in the transient Simulation
  database; the harness never maintains a second hand-authored Cambridge model.

`cambridge-campus-replica.v1` is installed only by the guarded Campus Lab seed. The
seed requires demo mode, explicit opt-in and a local/development/test environment,
uses stable fixture IDs, can upgrade the existing Cambridge database without a full
medium-school reset, and is repeat-safe. Fixture records retain synthetic provenance;
they are not templates or defaults for a customer institution. Job titles remain
descriptive positions, while the seeded `school_duty`, `safety_officer` and
`transport_attendant` assignments use the existing role/work contracts instead of
inventing authorization from a title.

Not every visible fixture person requires a login. A person without an acting demo
account can participate in the development routine's **planned** view, but cannot sign
an authoritative domain command. When a configured reaction is addressed to a seeded
staff account, the harness authenticates that exact synthetic account. Local execution
uses normal login and CSRF with an environment-only fixture credential. Hosted Stage
uses a rotated service credential accepted only for an active `@example.test` account
with an active membership in the exact `cis` school. Material writes use that concrete
identity through the normal application API and its authorization/audit path. The
harness cannot select another school or customer identity, create a reusable browser
session or attribute a representative account's action to another person.

### 3.2 Initial safe action catalogue

The first routine may exercise only bounded synthetic-school actions already supported
by normal domain contracts, for example:

- a teacher sends a fixture family message;
- a teacher records a fixture attendance register while the domain capture window and
  revision permit it;
- an authorized fixture administrator publishes a response-bearing notice;
- a fixture guardian opens or acknowledges that notice;
- a selected synthetic staff member reads an examination-invigilation Offer already
  routed to their normal Requests inbox and accepts it through the existing assessment
  response command;
- the local status projection advances students and teachers between planned fixture
  activities without claiming observed physical movement.

Each domain decides whether a command is accepted. A refusal, stale revision, closed
capture window or missing authority is a visible development result, not a reason for
the harness to bypass validation.

The initial routine must not:

- create payments, reconcile money or contact a payment provider;
- send Telegram, email, SMS, push or other external messages;
- invoke a remote AI/model provider;
- manufacture biometric, camera, gate, GPS, boarding, handover, safeguarding or other
  physical evidence;
- create authority, consent, enrollment or an identity link;
- directly write domain or Model Core tables.

New actions require a reviewed fixture contract, a normal authorized domain endpoint,
synthetic provenance, bounded cleanup/idempotency and an explicit check that they do
not widen the external-side-effect surface.

## 4. Real-time routine

### 4.1 Closed clock modes, instructional dates and school operating window

The runner receives an injectable clock for tests. Local and hosted execution use the
host's real wall clock and one of four validated modes: `realtime`, `1m`, `15m` or
`60m`. In accelerated modes, the full duration from the first to last effective
Cambridge timetable slot is mapped proportionally to the selected wall duration. It
does not override `Date.now`, patch PostgreSQL time or alter institution configuration.
Mode is stored only in the protected Cambridge harness control.

For each schedule refresh, the runner records:

- `run_id` and fixture version;
- actual `started_at`, current instant, institution-local date and configured timezone;
- the school-calendar decision for that exact date, including its instructional state,
  label and revision where available;
- the exact effective daily schedule source and revision used for the routine;
- the selected declarative Cambridge development routine;
- calculated compressed wall due instants plus the original school-local bounds for
  each lesson, break, transition and action;
- an action receipt/idempotency ledger.

The routine is built only from the selected institution-local date's effective daily
schedule. In real-time mode that date is the actual local date. In accelerated modes
it is the current date in a rolling 30-calendar-day harness window. The calendar must
first identify it as instructional. Dated plans,
slot cancellations, emergency closures and other effective-day changes take precedence
over the recurring weekly timetable exactly as they do on normal domain screens. An
empty effective schedule does not authorize the runner to select Monday, the next
weekday, the previous school day or any other convenient source date.

The school operating window starts at the first non-cancelled effective slot and ends
at the last non-cancelled effective slot. The current school configuration has no
separate authoritative campus-opening/campus-closing domain field, so the development
fixture must not invent one or add unrestricted arrival/departure padding. If a future
institution-level operating-hours model is introduced, this contract can consume its
versioned effective bounds after a separate review.

Every effective teaching slot and explicit break retains its actual campus-local start
and end values on that date. Uncovered gaps become proportionally scaled transitions
rather than being silently collapsed. A 9:00-9:45 AM lesson is still presented and
identified as 9:00-9:45 AM, but its wall interval is its proportional share of the
configured replay duration. The active marker and all Campus Lab projections use the
same mapping; no screen invents its own clock.

Before activation and for every non-instructional date, status contains no synthetic
presence markers, current-phase activity or due actions. Accelerated activation begins
at the first effective phase, advances to the next instructional date on completion,
skips closures/holidays and rotates only after its bounded 30-day window. A periodic
refresh re-resolves the selected date and effective schedule; a newly published
closure or cancellation fails closed immediately. Actions are placed by configured
phase-relative ratios so they remain observable when source-period durations change.

### 4.2 Bounded administrator controls

An administrator may stop or activate the entire Cambridge actor process and select
one of the four closed clock modes from Experimental settings. Stopped means zero
synthetic actors and zero synthetic actions. Changing mode restarts the transient
harness run; there is no scrub, arbitrary multiplier or direct virtual-date picker.
The bounded rolling window prevents an unlimited unattended future. These controls
never select the date or environment of the ordinary Live application.

Routine definition belongs in a declarative fixture file, not hard-coded Model Core
agent behavior. It defines participant selectors, action templates and safe fallback
activities; the current effective daily schedule supplies the lesson/break sequence
and durations. Code owns schema validation, effective-schedule derivation, calendar
and operating-window safety gates, ordering, idempotency and bounded execution. This
fixture configuration is not an institution Operating rule and must never be copied
into a production institution.

While the real school window is open, the status projection may reconstruct bounded
**phase receipts** for timetable phases that have already started that day. These are
read-only, expected/simulated timeline entries derived from the effective schedule;
they are not replayed commands, accepted domain outcomes, gate check-ins or physical
presence evidence. This keeps a mid-day development view understandable without
violating the no-catch-up rule for material actions. Which phase modes appear and how
many receipts are retained come from the versioned Cambridge fixture.

### 4.3 Idempotency and restart behavior

Every action has a stable key derived from the institution, fixture version, effective
school date, source occurrence/revision and action identity. A process restart on the
same school date therefore cannot make an already-due action new. A retry with the same
payload returns or records the prior outcome. A changed payload under the same key
fails rather than mutating history.

The runner retains enough local receipt state to avoid replaying a committed action
after a process restart in the same identified run. If receipt persistence is absent or
corrupt, the action remains skipped/failed visibly; the runner must not guess that a
material write is safe to repeat. Ordinary domain idempotency remains the final guard.

## 5. Truth, provenance and campus visualization

Campus Lab preserves the product's expected, observed, accepted and derived
distinctions.

### 5.1 Planned positions

Room markers generated from the development routine are **planned/expected**. They
answer “where this synthetic fixture routine currently expects the person or class”
and never “where the real person is.” A timetable relationship or elapsed timer does
not become a location observation.

The fixture may also declare expected duty positions for exact synthetic staff
designations using configured campus-space codes. A published teaching assignment
takes precedence for a teacher; otherwise a matching duty position remains an
expected simulation marker only. A missing designation or space-code match is shown
as unplaced rather than guessed. These expectations never become gate, biometric or
room-presence observations.

The development status contract for each marker includes at least:

- stable fixture person and campus-space references;
- safe display label and role/class context;
- state dimension (`expected` initially);
- source (`cambridge_development_routine` plus fixture/run version);
- valid-from/until and generated-at times;
- the published timetable source identity/revision and slot/class relationship where
  available;
- source schedule and actual institution-local validity window.

An `observed` marker may be rendered only when a normal domain response supplies a
source-bearing synthetic observation that the owning domain recognizes. Campus Lab
does not synthesize that dimension from motion, silence or a scheduled action.

### 5.2 Campus View overlay

Campus View is a permanent administrator feature under **More -> School overview**.
It renders configured topology and ordinary model-core read projections even when
the development runner is absent. The development adapter may add planned Cambridge
markers and runner activity to that production component only in local development or
when the reviewed `VITE_CAMPUS_LAB_ENABLED` Stage build gate is active. Every such
marker says **Simulated** and remains expected, not observed. The default customer
build keeps that gate false.

Experimental settings owns only the **Synthetic school day** description/status and
may deep-link to Campus View. The permanent view, route, canvas renderer, accessible
space list and source/freshness sheets remain in production code. The runner has no
simulation controls, developer graph terminology or domain mutation buttons.

## 6. Normal application integration

Campus Lab exercises existing boundaries rather than teaching the frontend a fake
state path:

Activation changes the administrator's server-owned execution environment from Live
to the newly created Simulation fork. The root application, normal navigation and
all ordinary domain routes stay unchanged; their existing database contracts are
routed to the isolated driver. The shared marker therefore says **Simulation** and
shows its virtual time. Runner status, planned positions and accelerated phases may
add development observability, but they never substitute a second query/cache path.
Stop clears application caches through the standard environment switch, returns the
session to Live and destroys the fork.

```text
point-in-time Cambridge Live snapshot -> isolated Simulation database
                    |
                    v
current instructional date's effective Cambridge schedule
        + declarative safe actions + real wall clock
                    |
                    v
local runner + run-local synthetic counterpart session
                    |
                    v
ordinary attendance / notices / chat / other domain API
                    |
                    v
domain authorization, validation, audit and Simulation record
                    |
                    v
transactional event/outbox -> isolated realtime boundary
                    |
                    v
normal query invalidation and domain screen update
```

The explicit Campus Lab route may poll the loopback runner or authenticated hosted
proxy for ephemeral planned markers, its projected effective slot and runner health.
Ordinary domain pages continue to fetch timetable and other data from their normal
APIs, but the server-selected run routes every query and command to the fork. The actor harness
follows the institution's effective Operating rules. For
academic attendance, `scheduled_session` selects an open register whose
`schedule_slot_id` belongs to the configured active timetable phase, authenticates as
each register's assigned synthetic teacher and submits every eligible subject-session
register configured for that teaching period. The Cambridge behavior fixture declares
an `each_lesson` reaction policy: the runner expands it from the effective published
timetable, and each assigned teacher reacts to their own resulting lesson obligation.
It does not centrally hard-code period numbers, silently limit the rehearsal to
Period 1, or let one representative teacher stand in for all classes.
`daily_class` uses the daily class register; `none` performs no attendance action.
The harness must not write one attendance model and describe it as completion of the
other.

Inside the explicit Campus Lab route, a read-only timetable copy may show a separate
**Rehearsal now** indication only when status source record/revision,
institution-local date and slot identity match the row returned by the Simulation
domain API. It is extra development observability, not the source of timetable state.

When the routine is paused because the current date is non-instructional or the campus
is outside its operating window, no role surface may navigate to, highlight or borrow a
different date on the simulator's behalf. Normal role-specific Today/timetable behavior
continues without a synthetic current-period indication.

Campus Lab may retain role-specific inspection copies for diagnostics, but acceptance
is measured on the normal Principal, teacher, learner and guardian routes bound to the
same fork—not on those copies.

The UI must be able to show both sides honestly: the fixture routine planned an action,
and the domain accepted, refused or has not yet processed it. A completed runner task
is not itself a completed campus operation.

## 7. Local and hosted Stage safety contract

The local runner fails closed unless every required condition is true:

1. an explicit Campus Lab enable flag is set;
2. Node and deployment environment are both development;
3. the application API origin resolves to loopback;
4. no Cloud Run/service production marker is present;
5. the application's release endpoint reports development;
6. authentication reports demo mode;
7. the selected school is exactly the Cambridge `cis` fixture;
8. Telegram webhook/bot, invitation email, payment and other configured external
   connectors are disabled;
9. the local proxy secret is present and sufficiently strong;
10. the environment-only Cambridge fixture credential required for exact synthetic
    actor login is present.

Failure of a startup or periodic recheck stops domain actions and exposes only a safe
degraded status. It does not fall back to direct database writes, anonymous requests or
a less strict environment check.

The runner and its status server bind to loopback. A phone connected through the local
Cloudflare development URL reaches status only through the same-origin Vite
development proxy. The proxy adds an ephemeral per-preview secret header; that secret
is not committed, rendered in HTML or accepted by a production server. The runner has
no public CORS surface.

Credentials are not stored in Campus Lab source. Representative roles use the existing
local demo-session mechanism. Exact seeded staff actors use the private local fixture
credential supplied by the preview environment, normal login, CSRF and domain
revision contracts. That credential is never returned by the status endpoint or
written to activity output. Logs redact cookies, CSRF tokens, credentials, message
content where unnecessary and restricted domain payloads.

Hosted Stage uses the separate `eduvera-stage-simulator` Cloud Run service with no
database credential. It accepts no unkeyed status/control request and calls only the
canonical `https://app.thatcampus.com` origin. A rotated service secret authenticates
exact synthetic users; a separate rotated proxy key protects runner status/control.
Both live only in Secret Manager and are available to the Stage runtime identity.
The browser receives neither secret. The application proxy rechecks an active admin
membership in school code `cis`; the public-demo write guard continues to reject
control mutations.

The hosted service uses zero minimum instances, at most one instance and request-time
CPU. The durable enabled/stopped value lives in the application database. When stopped,
the frontend stops polling and no scheduler or reserved simulator instance keeps it
alive; Cloud Run can scale it to zero, so there is no continuing simulator compute
charge after the platform's normal scale-down delay. When activated, authenticated
admin polling supplies bounded request-time pulses that advance the wall-clock runner.
This testing mode does not promise autonomous activity while nobody has the Stage app
open; persistent unattended rehearsal would require a separately approved scheduler
and cost contract.

## 8. Development retention and market-release boundary

The owner has explicitly retained Campus Lab and the Cambridge dummy campus throughout
active development. Every branch carrying related Model Core/domain work must push the
complete runner, fixture, guarded seeds and development adapters. A generic statement
that the harness is “not production” is not authority to delete it, leave it only in
one checkout or strip it from the shared development history.

The actor runner is also enabled for isolated Stage testing under the bounded contract
above. This does not authorize it for production or for any non-Cambridge institution.

Only after the owner explicitly asks to **clean for real market release** does the
following artifact-exclusion checklist become the active release target:

- runner source lives under a top-level development-tools directory outside backend
  and frontend production source roots;
- the production Docker context ignores the runner directory;
- the production Dockerfile never copies the runner directory or its dependencies;
- the synthetic overlay adapter and status client are loaded only through a Vite
  development or explicitly reviewed Stage-build guarded dynamic import;
- a production frontend build contains the Campus View route and Canvas renderer but
  no synthetic-school-day adapter, runner label, timetable rehearsal indication,
  fixture or status-proxy chunk;
- deployment configuration rejects Campus Lab/synthetic-actor environment variables;
- CI scans the build context, final image/file list and frontend bundle for the
  development runner and its unique markers;
- production startup neither imports nor attempts to start the runner.

The repository retains development source so contributors and product reviewers can
use it even after such a release cleanup. The customer-facing artifact may then
contain Campus View and the isolated scenario product while excluding the wall-clock
simulated-agent runner and development overlay. This cleanup must never remove the
Campus Model Core or confuse product what-if simulation with the Campus Lab harness.

## 9. Failure behavior

| Condition | Required behavior |
| --- | --- |
| local API not ready | remain booting and retry with a bounded backoff |
| unsafe environment or connector enabled | refuse actions and report the failed safety gate |
| Cambridge fixture missing | show setup error; never select another school |
| demo identity lacks authority | record refused action and continue unrelated routine steps |
| a configured staff Offer has not reached that recipient's Requests inbox | leave the Offer unchanged; never infer routing or answer as another account |
| domain validation/revision conflict | show the domain-safe explanation; do not patch data |
| SSE unavailable | domain screens use their existing focus/poll fallback; no fake success |
| status endpoint unavailable | Campus Lab shows offline; ordinary product pages remain usable |
| timetable source/revision mismatch | hide the rehearsal-row match, explain the stale source in development UI and leave authoritative timetable rows unchanged |
| weekend, holiday or calendar closure | remain paused with zero synthetic actors and zero synthetic actions; show the calendar reason when available |
| before the first effective slot or after the last effective slot | remain paused with zero synthetic actors and zero synthetic actions; report the next relevant boundary without replaying missed work |
| current instructional date has no effective slots | remain paused/unassigned; never borrow another weekday or date |
| runner starts or restarts after an action's due instant | do not replay the missed action; retain or record an explicit skipped outcome |
| runner crash | managed preview may restart it; receipts prevent duplicate committed effects |
| external network unavailable | routine remains local and does not require a provider |

An error feed is bounded and redacted. The harness must never turn repeated failures
into an unbounded retry loop or a flood of fixture records.

## 10. Implementation shape

The expected repository shape is:

```text
devtools/campus-simulator/       local runner, fixture routine and focused tests
frontend/src/features/campus-view/ permanent admin view and Canvas renderer
frontend/src/dev/campus-lab/     development-only Campus View and timetable presentation adapters
scripts/preview-server.mjs       managed local child-process integration
frontend/vite.config.ts          loopback status proxy for development only
deploy/gcp/                      production-exclusion release contracts
```

Names may be refined while implementing, but crossing the development/production
boundary or placing simulated actors in ordinary domain code requires a new reviewed
decision. The Campus Lab status schema is versioned even though it is local, so the
page and runner fail clearly rather than silently misrendering one another.

## 11. Verification and acceptance gates

Campus Lab is not complete until the implementation plan records evidence for all of
the following:

### 11.1 Runner and safety

- unit tests prove exact campus-local mapping of effective lesson, break, gap and
  first/last effective-slot bounds and the absence of translation, a virtual clock, speed control or
  looping;
- injected-clock tests remain deterministic without changing the runtime contract;
- weekend, holiday, closure, empty-effective-day, before-start and after-end tests
  produce zero synthetic actors and zero synthetic actions and do not select an
  unrelated weekday or date;
- restart-during-day tests join only the real current phase and do not catch up expired
  actions; institution-local midnight tests re-resolve the calendar and effective day;
- source/revision mismatch and mid-run calendar changes fail closed before another
  action executes;
- every unsafe-environment condition fails closed;
- restart/idempotency tests prove a committed action is not repeated;
- connector stubs/spies prove zero external delivery/provider calls;
- API contract tests prove the runner uses normal authenticated domain endpoints and
  handles accepted, refused, conflicted and unavailable outcomes.
- configured synthetic-human reaction tests prove an exact fixture staff account reads
  its routed Requests item and calls the normal response command only during an active
  instructional operating window; closed days and hours make no inspection or write.

### 11.2 Truth and UI

- all fixture people have stable planned routine state or an explicit unassigned state;
- planned markers cannot render as observed without source-bearing domain evidence;
- Campus View and the development timetable indication name the same published source,
  revision, institution-local date, slot and actual source time;
- the timetable indication is additive development presentation only: published rows,
  normal domain caches and domain records remain unchanged;
- principal, teacher, learner and guardian role parity is either verified or recorded
  as an open gate rather than implied by one role's implementation;
- a normal domain action updates its ordinary screen through the established API/event
  path, not a Campus Lab-only store;
- mobile checks at 320 and 390 CSS pixels show no horizontal overflow, clipped sheet or
  unreachable control;
- keyboard, screen-reader labels, focus return and reduced-motion behavior pass focused
  checks;
- degraded/offline/after-hours startup remains understandable;
- the owner validates the working mobile UI through the local preview/Cloudflare link.

### 11.3 Market-release exclusion (deferred until explicit owner request)

- production bundle inspection finds Campus View and no synthetic overlay, status
  client, runner label, normal-timetable rehearsal indication or runner code;
- container-context and final-image tests find no development runner source/dependency;
- a release-contract test rejects Campus Lab/synthetic-actor environment variables;
- a production-mode route request cannot reach the status proxy or development
  overlay; the ordinary Campus View route remains reachable to authorized admins;
- normal production builds, release checks and local preview readiness still pass.

Until these gates have verified evidence, the implementation-plan status remains
**in progress**. During active development this does not authorize removal of Campus
Lab or the Cambridge fixture. Passing Campus Lab tests does not satisfy the Model Core
simulation acceptance gates or production-readiness gates for any domain.

