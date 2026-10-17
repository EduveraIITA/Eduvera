# Campus Lab development harness

Status: accepted implementation contract; retained throughout active development by
owner decision, hosted showcase enablement and remaining hardening gates open,
17 October 2026

Normative parents:

- [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md)
- [Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md)
- [ThatCampus Model Core blueprint](THATCAMPUS_MODEL_CORE_BLUEPRINT.md)
- [ThatCampus operating experience](THATCAMPUS_OPERATING_EXPERIENCE.md)

## 1. Purpose

The synthetic school-day runner is a development-only harness for exercising the Cambridge International
School synthetic fixture as the real clock advances. It lets developers and product
reviewers watch scheduled fixture people and ordinary domain workflows change through
the normal ThatCampus frontend. It may add an explicitly simulated overlay to the
production Campus View, but it does not own that view, its navigation or its topology.

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
- it uses wall-clock time only;
- it has one explicit **Activate simulation / Stop simulation** control for the
  Cambridge actor process; it has no fast-forward, speed, scrub, replay or virtual-
  date controls;
- it resolves the current date in Cambridge's configured timezone and uses only that
  date's effective instructional schedule, including dated overrides, cancellations,
  holidays and closures;
- it never translates a timetable to the runner start, borrows another weekday or
  moves the institution clock so that a synthetic day is easier to observe;
- synthetic presence and domain actions exist only inside the configured school
  operating window on an instructional date; weekends, holidays, closures, empty
  effective schedules and before/after-school time remain paused with zero synthetic
  actors and zero synthetic actions;
- the process may remain alive between school windows, but it follows the campus-local
  calendar as real time changes instead of looping or replaying a school day;
- it calls ordinary authenticated domain APIs so the normal event and frontend paths
  are exercised;
- it may show a clearly labelled development-only **Rehearsal now** indication beside
  the unchanged timetable on normal screens, but it never rewrites authoritative
  timetable data or injects rehearsal state into a domain query cache;
- a real-market release may exclude simulated actor runtime and controls only after
  the owner explicitly requests the market-cleanup pass; until then the complete
  source and Cambridge fixture remain on the shared development branch.

## 2. What Campus Lab is not

Campus Lab is distinct from the Model Core scenario runtime defined in section 16 of
the Model Core blueprint.

| Campus Lab development harness | Model Core rehearsal/simulation |
| --- | --- |
| development and isolated Stage testing aid | future product/core capability |
| real wall clock | isolated virtual clock |
| Cambridge synthetic fixture only | versioned synthetic or sanitized scenario snapshot |
| normal domain APIs and exact synthetic fixture identities | scenario executors and sink-only dispatchers |
| may intentionally update the disposable local fixture | must never mutate live domain truth |
| no playback or time controls | deterministic scenario range, seed and baseline comparison |
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
- existing seeded domain records rather than a parallel Campus Lab database.

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

### 4.1 Wall clock, current calendar date and school operating window

The runner receives an injectable clock for tests, but local execution uses the host's
real wall clock. It does not reinterpret a minute as an hour, change the institution
date, override `Date.now`, patch PostgreSQL time or expose a speed multiplier.

For each schedule refresh, the runner records:

- `run_id` and fixture version;
- actual `started_at`, current instant, institution-local date and configured timezone;
- the school-calendar decision for that exact date, including its instructional state,
  label and revision where available;
- the exact effective daily schedule source and revision used for the routine;
- the selected declarative Cambridge development routine;
- calculated real due instants for each lesson, break, transition and action;
- an action receipt/idempotency ledger.

The routine is built only from the current institution-local date's effective daily
schedule. The calendar must first identify that date as instructional. Dated plans,
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
and end instant on that date. Uncovered gaps become transitions or unassigned time
rather than being silently collapsed. A forty-five-minute source lesson remains the
real 9:00-9:45 AM interval in the institution timezone; it is never shifted to the
process start. The runner must not use arbitrary 90-second lessons, modulo-select a
period by ordinal position or synthesize a second clock.

Before the operating window, after it closes, and for every non-instructional date,
the status is explicitly paused and contains no synthetic presence markers, current
phase activity or due domain actions. Starting or restarting the preview during an
active school window may join the real current phase, but actions whose due instant is
already in the past are not replayed as catch-up work. A periodic refresh and every
institution-local date rollover re-resolve the calendar and effective daily schedule;
a newly published closure or cancellation fails closed immediately.

### 4.2 Continuous real time with one bounded administrator control

The runner evaluates the real campus-local instant automatically while the managed
local preview or hosted Stage test client is active. There is no user control to start,
replay, skip or accelerate the school clock. An administrator may stop or activate the
entire Cambridge actor process from Experimental settings. Stopped means zero
synthetic actors and zero synthetic actions; activation resumes evaluation at the real
current instant and never catches up missed actions. Its process may stay healthy while
the routine is paused, but paused means zero synthetic actors and zero domain actions. It
becomes active only when real time enters an instructional date's operating window and
returns to paused when that window ends. Institution-local midnight triggers a new
calendar resolution; it does not wrap the prior day's end into a manufactured next
school day.

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

```text
current instructional date's effective Cambridge schedule
        + declarative safe actions + real wall clock
                    |
                    v
local runner or isolated Stage runner + exact synthetic identity
                    |
                    v
ordinary attendance / notices / chat / other domain API
                    |
                    v
domain authorization, validation, audit and authoritative record
                    |
                    v
transactional event/outbox -> existing live-event bridge
                    |
                    v
normal query invalidation and domain screen update
```

The development overlay adapter may poll the loopback runner or authenticated hosted
proxy for ephemeral planned markers, the current real-time effective slot and runner health.
Domain pages continue to fetch their authoritative timetable and other domain data
from their normal APIs and react to the existing event bridge.

To make Campus View and the normal timetable understandable together, a development
build may add a separate **Rehearsal now** indication to a timetable row only when the
status source record/revision, institution-local date and slot identity match the row
returned by the domain API. That indication is a presentation overlay with a simulation
label and the unchanged source schedule time. It must not replace row state, alter
published start/end values, write a day plan, mutate a React Query/domain cache, or
become an input to attendance, notifications or any other domain decision. If status
is missing, stale, mismatched or degraded, the indication disappears or explains that
the rehearsal is unavailable; the normal timetable remains usable and truthful.

When the routine is paused because the current date is non-instructional or the campus
is outside its operating window, no role surface may navigate to, highlight or borrow a
different date on the simulator's behalf. Normal role-specific Today/timetable behavior
continues without a synthetic current-period indication.

Principal timetable is the first role surface for this indication. Equivalent
teacher, learner and guardian timetable indication remains an explicit parity gate
until each role has been implemented and verified; Campus View alone is not evidence
that those normal screens reflect the rehearsal.

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

