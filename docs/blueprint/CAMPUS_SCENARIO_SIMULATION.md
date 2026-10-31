# Campus scenario simulation

**Status:** continuous same-application Digital Twin contract accepted; durable run
control, frozen snapshots, copy-on-write domain execution, resource lifecycle and
optional approved cohort policies implemented locally, 19 October 2026. Production parity, scale
and owner-device acceptance remain separate gates. This
contract specializes section 16 of
`THATCAMPUS_MODEL_CORE_BLUEPRINT.md`; that document remains normative for the
shared Model Core.

## Continuous product runs — owner correction, 19 October 2026

This section supersedes the earlier aggregate-planning-only interpretation. Simulation
is a key product capability, not Development settings or only a what-if report.

- **Start baseline simulation** captures the current Live campus and runs its existing
  timetable, people, spaces, availability, rules and approved behaviour unchanged.
- **Start a scenario** captures Live into a paused draft. Clear links open the normal
  timetable, People, leave, campus and Operating-rule editors inside the isolated world.
  Editing is optional; the administrator then starts it.
- Both offer speed (including 20×) and an optional virtual end. Either kind continues
  across days indefinitely when no end is supplied. Closing the browser or returning
  to Live does not stop it. Pause retains the last committed checkpoint; resume and
  speed changes preserve the world. Stopped/completed worlds reopen frozen/read-only.
- Only the selected administrator session changes worlds; other users continue Live.
  Tabs sharing that same authenticated session synchronize selection. Independent
  sessions remain separate. There is no global institution-mode switch.
- The entire normal application becomes warm amber in Simulation, including dark
  appearance; Live stays blue. Inline controls expose confirmed virtual time, speed,
  status, pause/resume, management and Return to Live without covering profile controls.
- Saved simulations lists every retained run owned by the current administrator;
  explicit **Run history** shows the latest ten records, including removed worlds.
  A removed world's history does not occupy a saved place. A controlled duplicate
  starts from the exact original snapshot and deterministic seed, not today's Live state or the source run's later
  mutations. Comparisons use shared committed elapsed durations; independent captures
  are labelled exploratory. The latest-ten history window never deletes active or
  retained runs.

### Focused navigation and finite pages

The Simulation workspace follows progressive disclosure, not a single long stack of
launch settings, history, controls and results. **New simulation** and **Saved** are
distinct views. Baseline settings precede capture/start. Starting a scenario captures
its paused draft first, then presents **Edit campus → Run settings → Run**; edits are optional.
The optional activity-model configuration expands only when selected. An active run
separates its overview/controls from results and recorded changes. Scenario names can
be changed in run settings; recorded changes remain inspectable after starting or
stopping. An optional end is validated against the world's virtual time, not today's
wall clock, so an older paused snapshot can still be run to its own future date.

One run manager presents all of the current owner's retained worlds, five per server
page. **Run history** is an explicit view of the latest ten records, also five per
page; it is not a second removal workflow. Both use the same rows, available actions,
confirmation, paging and focus behavior. Removed records appear only in Run history,
without Open or removal actions. **Compare runs** explicitly enters selection mode;
only currently comparable rows then show checkboxes. Cancel comparison clears the
selection. Normal paging preserves eligible selections and drops those found
ineligible on a refreshed page. Comparison opens a focused view with a clear return
to the same list and page. Longer change records are paged too. Scrolling remains appropriate inside
a coherent editor or results page, but automatic infinite loading is not the navigation
model. Browser Back and shareable presentation parameters preserve the current view,
step and page; they never choose or authorize a backend execution environment.

Comparison attendance metrics distinguish new submissions from finalization. The
stable `submitted_registers` metric counts daily-class and scheduled-session registers
currently submitted/final whose `submitted_at` is after capture and at or before the
committed checkpoint. `finalized_registers` counts currently final registers of both
grains whose `locked_at` is in that same window, including a captured submission that
becomes final during the run. Already-final captured registers are not new
finalizations. These are register-state measures, not learner counts or counts of
repeated finalize/reopen commands. Labels may be clarified without changing retained
sample values. Missing historical metric samples remain unavailable; they are never
backfilled or presented as zero.

Use the established ThatCampus visual system, clear primary actions, readable grouped
fields, generous touch targets and keyboard focus on the newly displayed heading.
The owner requested the clarity and restraint associated with Apple's design approach,
not an Apple-styled replacement for the application's existing components.

Run lifecycle, revisions, changes, policy receipts, metrics and checkpoints are durable.
One bounded worker loop per process claims due work with PostgreSQL `SKIP LOCKED` and
monotonic fenced leases. A per-world advisory lock covers runtime execution through
checkpoint commit. A separate bounded lock pool avoids starving domain connections.
Persisted wall/virtual anchors preserve the selected speed across delays and restarts;
the current aligned checkpoint quantum is five simulated minutes. The browser displays
processed time, not an unprocessed extrapolation. Domain JavaScript/SQL clocks use this
virtual time; authentication, rate limits, infrastructure leases and scheduling stay real.

`CAMPUS_SIMULATION_DATABASE_URL` addresses a separately provisioned, dedicated database,
never Live. All runs share bounded pools and immutable tenant captures. Schema-only
templates are reused per source schema version. Each run begins with frozen views;
tables materialize on first mutation (or a projection needing native key metadata),
including required FK/trigger dependencies. Native constraints, independent sequences
and derived views are retained. This table-granular COW adapter reuses existing domain
services and the DT Core; it is not a database/process per run or a parallel ERP.
Captured tables with at least 500 rows also receive one immutable indexed read
relation per snapshot, shared across forks. Run views project directly from these
relations so native filters/indexes are usable; repeated large JSON expansion is not
the read path for ordinary high-volume domain screens.

Capture is the only Live domain read. It follows tenant ownership and exact referenced
parents; ancillary parent metadata never expands child ownership. Auth sessions,
credentials, channel secrets, restricted ciphertext and development harness state are
excluded/redacted. Capture fails rather than truncating above 100,000 rows per table or
100 MB per campus. The runtime requires `pg_dump` compatible with the source server;
deployments with newer PostgreSQL must supply a matching/newer client.

All active eligible source agent kinds receive distinct run-local counterparts.
Agents created through normal scenario editors receive counterpart identities too,
without inferred behaviour or auto-granted authority. New Live entities appear in the
next fresh snapshot, not in an already frozen world. Frozen baseline authority cannot
silently grow; future authority interventions require explicit run-local evidence.
Where Live uses an internal owning-domain authority attestation (for example attendance
after membership/timetable checks), Simulation uses the same evaluator against its
frozen/edited branch state and virtual clock. Core requires a matching active
counterpart and sealed source snapshot and records a run-local execution-actor receipt.
This is not a client-supplied authorization assertion, an inferred grant, or a Live
authority lookup. Capabilities using explicit Core grants still use frozen grants.

Synthetic human activity is off until the administrator approves a versioned cohort
policy. Version 2 models attendance proportions/submission delay and separately
opt-in staff-cover/invigilation offer accept/decline/no-response proportions and delay.
Retained version 1 attendance policies normalize without enabling extra behaviour.
It records approval by the captured human administrator and uses a repeatable seed
plus canonical configuration hash. Equivalent policies and controlled duplicates
share the same draws; a random approval-version ID is not a sampling salt. Class and
attendance activity slots use the same owning attendance services, teacher authority,
Core command/evidence, revision, idempotency and state checks. Approved leave/domain
refusals are respected. This never predicts an identified person's intent. Existing
scheduled scans, finalization and isolated event publication reuse domain services.
Unconfigured counterparts remain passive. Cover/invigilation responses pass through
the normal recipient, scope, revision, eligibility, authority and audit paths; the
model does not create offers, choose recipients or infer individual intent.

Reviewed email/invitation, Matrix, payment-order/status, calendar-preview and camera
review adapters operate on durable run-local artifacts and the existing seven Core
effect-sink families. They select isolated ports before any Live provider credential
or network access. Captured is not externally delivered: pending payment orders never
manufacture signatures, successful funds or receipts; photo analysis returns no
biometric matches or automatic assignments and retains no uploaded source media.
Calendar previews require the selected authenticated run; they are not public feed
tokens or installed-calendar subscriptions. Unsupported provider operations fail closed.
Provider/assistant administration and remote AI delegation remain explicitly excluded
control-plane functions, not campus evidence silently borrowed from Live.

Ordinary Chat attachments, leave documents, assessment evidence and gate-photo uploads
use a reviewed run-local artifact boundary. Restricted/source file bytes are never
copied or fetched from Live; missing originals return clearly labelled placeholders
with Simulation/source-omitted provenance. Normal permission/relationship checks run
before reads or writes. Unknown multipart routes still refuse execution.
Operational events/messages remain in the isolated branch. Native import expiry,
transport retention, payment reconciliation/mail and Matrix outbox work run on the
virtual tick, alongside attendance deadlines/finalization and staff reconciliation.
An unavailable selected world fails closed, never falls back.

### Capacity, retention and continuing platform changes

Admission/start/resume serialize per institution in PostgreSQL; workers claim due
tenants with bounded leases and monotonic fences. Defaults are 12 retained/open
worlds, 4 running/leased worlds and 2 GiB accounted storage per institution, with a
100 MiB reservation per run. Capture is limited to 100 MiB; files to 25 MiB each and
100 MiB per run; effect receipts to 100,000 per run. These deployment limits are
configurable. Resource pressure rejects admission or pauses a run visibly; it never
silently deletes or gives an active/paused indefinite world a TTL.

The saved-world limit includes ended worlds until their isolated storage has been
released. Stopping or unpinning does not free a saved place. **Saved simulations**
therefore opens the single retained-world manager, five per page, rather than a
latest-ten-only catalogue. Capacity recovery links for saved places, running runs,
storage and pins all lead to this manager. An active administrator who owns an ended,
unpinned world may choose **Remove simulation** and confirm the named world and its
current control revision. The same fenced retention/cleanup owner releases only
that exact isolated world, preserves shared snapshots needed by siblings and keeps
the run history, metrics, actor-bound request audit and cleanup receipts. Removal
does not change Live. Active and draft worlds are never directly removed. A running
or paused run must be stopped first; a pinned terminal world must be unpinned first.
For an owned draft with the native Stop action, **Discard draft** asks once for a
named confirmation, sends Stop bound jointly to the reviewed control revision and
`draft` status, then uses the returned stopped revision for native fenced removal.
A concurrent Start or another control revision refuses that conditional Stop without
stopping the active run. This is two ordinary lifecycle commands, not an atomic
delete or a bypass of cleanup. If Stop succeeds but removal is refused or unavailable,
the stopped world remains retained until removal can finish. Current selection,
pending work, leases, ownership and authority are rechecked on the server. Replaying
the exact accepted request returns its retained result rather than deleting again.
An uncertain Stop result is reconciled with GET, never blindly stopped again or
rebased onto a started or newer run. An uncertain removal retains its exact reviewed
revision for retry, including when a refreshed page omits the row. An accepted
removal followed by a failed list refresh retries only the read. While confirmation
or its request remains open, other manager actions and paging stay locked. An
unconfirmed result can be closed after its request settles; closing never cancels
a submitted command.
This explicit owner-requested release does not enable automatic GC or shorten
another run's retention. Capacity messages distinguish saved places, running runs,
storage and pins so the recovery action actually addresses the exhausted resource.

Terminal worlds receive a 30-day retention window, with up to 4 pinned runs by
default. Latest-ten history is only presentation. The opt-in GC worker cannot claim
active, paused, pinned, leased or selected worlds. It uses retryable fenced claims,
the same final session-selection lock as Auth, the normal COW/resources lock order,
and append-only control/target receipts. Last-fork deletion reclaims the source
snapshot and unreferenced template; other forks retain their shared source. Reported
bytes are accounted relation/logical estimates, not a guarantee of filesystem space
returned to the OS. `SIMULATION_GC_ENABLED=false` is the safe rollout default; enable
only after testing the separate store and confirming its retention policy.

The root `AGENTS.md` makes Simulation adaptation part of the definition of done for
every platform change. `npm run simulation:conformance` runs during backend build/CI:
the exact module/worker/material-boundary inventories and semantic source, frontend,
clock/effect/schema fingerprints cannot drift unnoticed. Updating the generated lock
requires a reviewed manual conformance revision. Safety readiness and module-specific
workflow evidence are separate: untested workflows stay visible as coverage gaps,
never become “verified” merely because their module or copy-on-write table exists.
Live and Simulation changes/tests belong in the same delivery, or require a specific
reviewed no-impact classification; unsupported campus workflows remain product debt.

Each new immutable snapshot seals a semantic compatibility manifest/hash for capture,
branch/Core/action/effect/artifact/behaviour ABIs and its schema catalogue. Reopen,
fork, policy editing and advancement validate this evidence without reading Live.
Ordinary code-build identity is provenance, not automatically a schema break; an
unsupported schema/ABI, tampering or a legacy snapshot without a manifest yields
`simulation_snapshot_incompatible`. Active runs pause with a retained-world recovery
notice instead of retrying forever or switching environments. Recovery currently
means a fresh capture; a future approved target-only migrator must create a derived
version/receipt, never rewrite original snapshot evidence. No automatic upgrade or
universal backward-compatibility claim is made.

Capture records its exact originating run so a failed preparation can reclaim only
its own partial snapshot. Failed preparations without a world also receive an
idempotent cleanup receipt; they do not remain permanently uncollectable reservations.
A bounded DB-clock recovery pass marks abandoned initial preparations failed after
the configurable `SIMULATION_PREPARATION_TIMEOUT_MS` (15 minutes by default).
Late preparation completion is rejected. This is crash recovery before a usable
world exists, never a time limit on a running or paused unbounded Simulation.

The operational API under `/api/v1/schools/:schoolId/simulation` provides `/runs`,
`/runs/:id`, `/draft`, `/changes`, `/behaviour`, `/start`, `/pause`, `/resume`, `/stop`,
`/duplicate`, `/pin`, `/unpin`, `/resources` and `/compare`. `/resources` pages durable
effect receipts without exposing addresses, message bodies, credentials or file bytes.
`GET /runs?view=retained&page=N` provides the default Saved simulations catalogue;
`GET /runs?limit=10` provides explicit Run history, including removed records.
`POST /runs/:id/stop` retains ordinary Stop with an empty body. Draft discard supplies
the optional joint pair `{expected_revision, expected_status: "draft"}`; malformed or
partial pairs are rejected, and the exact draft/revision is checked under the native
institution/run locks before any transition. Its ordinary stopped-run response
supplies the control revision for the subsequent removal.
`POST /runs/:id/remove` accepts the reviewed `expected_revision` for explicit ended-
world release. These endpoints do not create a second domain execution path or allow
hard deletion of run history, metrics, control audit or cleanup receipts.
The authenticated execution-environment session selects
the run; normal domain API URLs remain unchanged. Run control/auth stay Live.

Release gates include real signup and Cambridge through the same path, day progression,
terminal read-only views, restart/retry/fencing, concurrent real-user continuity,
cross-module/realtime isolation and mobile/dark theme review. Indefinite operation
additionally needs monitored large-campus performance, deployment policy/retention
enablement and recovery evidence. Implemented quotas or passing source scans are not
proof of universal enabled-module parity. Do not claim production readiness while
these gates or intentionally unsupported external/restricted workflows remain open.

## Purpose

Campus scenarios let an authorized administrator fork a point-in-time,
privacy-minimized digital-twin snapshot and operate an isolated copy of the platform
under a virtual clock. The same capability supports a focused baseline comparison,
an interactive what-if run and later forecast calibration without turning synthetic
activity into campus truth.

Simulation is available to every institution from its current setup. It is not a
second onboarding flow and does not require a duplicate people, timetable, space or
rule configuration. Registered snapshot adapters copy the eligible current state and
effective versions automatically. The Cambridge Campus Lab is a separate development
conformance harness and is not the implementation of this capability.

Every institution administrator receives the canonical `/more/simulation` workspace
from the same responsibility-composed manifest rule. No institution code, seeded
profile or development flag grants product Simulation access. The workspace exists
even before the institution has a campus or enough scheduled data to run the first
supported intervention. In that state it can create an institution-scoped baseline
snapshot, disclose the captured topology and run-local agent coverage, and explain
which planning evidence or domain adapters are still missing. Development harness
routes are not product navigation.

The separate legacy aggregate-planning adapter's run shapes are:

- an institution-scoped baseline snapshot with no intervention, campus or future
  timetable prerequisite;
- one effective human teacher unavailable for a future working-day window; and
- one active, bookable campus space unavailable for a future working-day window.

That aggregate adapter's supported horizon is 7–30 days. It reports schedule, staffing, space,
capacity and learner-place effects. Attendance outcomes, physical movement,
transport, finance and assessment outcomes remain explicit unsupported domains.

## Authoritative Live state and transient Simulation forks

ThatCampus has one authoritative Live environment and may create isolated,
optionally time-bounded Simulation forks:

1. **Live** contains real people/devices/integrations, real institution time,
   authoritative domain records and approved external effects.
2. A **Simulation** fork contains a frozen, privacy-minimized snapshot of that
   institution's Live state, run-local actor counterparts, virtual time, scenario
   projections and sink-only effects. Synthetic fixtures belong only to automated
   tests and the separate development harness; they are not a customer's product
   Simulation starting state.

Selecting a Simulation fork is an explicit application-level context change, not navigation
to a separate simulation product. The administrator continues to see the same shell,
routes, navigation, Today, timetable, attendance, Messages, Requests, Campus View,
notifications, KPIs and other enabled modules. Live retains the established blue
application palette; Simulation applies the reviewed warm amber palette to the entire
application. No floating environment pill may cover profile or account controls.
Virtual date/time and **Return to Live** remain available in the owning Simulation workspace.

Every shared domain hook, action and realtime subscription resolves from the selected
server-authoritative execution-environment session. Run identity is mandatory in the
backend context, projection/event storage, store namespace, realtime topic and browser
cache, but is not trusted from a caller-controlled header, date or arbitrary route
parameter. The same domain API path resolves Live stores/clock/connectors in Live and
copy-on-write scenario stores/virtual clock/sink connectors in Simulation. Switching
environment tears down or partitions the previous caches and subscriptions before the
same screen renders.

During incremental development, a module without a complete registered scenario
adapter shows **Not modelled in this run** and fails closed; it never calls Live as a
fallback. This is a temporary engineering safety state, not an intended product mode.
Release acceptance requires every module enabled for the institution to operate from
the selected Simulation state, so the user experiences a complete campus application.
An operational run ends only at its optional end or explicit Stop. It cannot mutate or merge into Live. A
later result may only prepare a new reviewed Live draft through fresh authority, rule,
revision and domain-invariant checks.

## Identity model

The runtime never treats three related actors as interchangeable:

1. each real human, team, device, integration or software `Agent` remains the stable
   production identity;
2. an AI delegate is a separately identified software agent with an explicit,
   revocable `acts_for` authority snapshot; and
3. a scenario actor counterpart is a run-local proxy linked to one source agent but
   has no production credential, endpoint, authority or channel.

Snapshot materialization creates one counterpart for every eligible active source
agent included by the run manifest, not only teachers referenced by a schedule. A
counterpart records source agent ID/kind, safe person or external lineage reference,
scenario/run/namespace, copied configuration evidence and a readiness state:

- `modelled`: a registered deterministic adapter can react;
- `passive`: it may appear in projections but emits no reaction; or
- `unsupported`: required behavior cannot be modelled and is disclosed.

No agent adapts itself and no human behaviour is hard-coded. Effective institution
rules and approved scenario behaviour versions are copied automatically, but an
uncertain human choice remains unknown unless a reviewed versioned scenario policy
models the appropriate cohort. The UI must never describe such a modeled response as
an identified person's intent.

Scenario results may describe cohort-level modeled responses. They must not claim
that an identified person intended, accepted, attended or occupied a space.

## Isolation and execution

The reusable contracts, engine, identity/message runtime and transient-store port live
under the shared Campus Model Core. The campus-scenarios module is only a
campus-operations snapshot adapter, executor and HTTP surface; another domain must
register an executor against the same core rather than create a parallel runtime.

Every run receives a scenario-only execution context containing a namespace, run ID,
virtual clock, deterministic seed, immutable configuration references, scenario
identity resolver, sink-only message dispatcher, transient evidence store and
deny-by-default side-effect policy. The core has no database, network or connector
dependency.

Live-state commands, production messages/notifications, connector calls, evidence
writes, credentials, stores and authority lookups are structurally denied. Simulation
actions still traverse the same domain validation, authority, state-machine,
idempotency, audit and event semantics, with environment-bound resolvers and
copy-on-write scenario persistence. Every emitted event, message, observation,
projection and artifact carries its scenario, namespace and run identity. During
development, a domain executor that cannot model an outcome returns `unsupported`;
it never invents an action.

The legacy aggregate-planning adapter reads Live only while creating its snapshot. Its state is
copy-on-write and is held in a bounded process-local store with a 30-minute TTL,
institution quota, global quota and serialized-size limit. It is never inserted into
operational or Model Core tables. Process restart intentionally discards it. A future
shared ephemeral store may replace this implementation without changing the runtime
contract. When a quota is reached the oldest completed transient result is evicted, so
an abandoned browser sheet cannot lock an institution out of planning.

This first aggregate what-if slice does not yet implement the complete section 16.5
authority resolver, general environment-bound domain-store/executor registry, shared
multi-instance ephemeral store, whole-app projection set or reviewed
scenario-to-Live-draft path. The current campus adapter performs its
institution-admin authorization before entering the isolated engine and invokes one
explicit campus-operations executor. It is the first adapter and planning proof, not
the full operational Simulation environment. Until a domain adapter is registered,
its simulation surface must remain unavailable rather than borrowing Live state.

## Same-application Simulation parity

An authorized administrator or delegated experimenter selects one run-scoped
environment and remains in the ordinary ThatCampus application. The complete semantic
palette changes from Live blue to Simulation amber. Virtual date/time and a clear
**Return to Live** action remain available from the canonical Simulation workspace;
they do not float over the profile control. Source snapshot time, expiry and
assumptions belong in that workspace, not in a replacement home page or a parallel
set of domain tabs. This is also not a Campus Lab clock badge.

Each participating domain registers four scenario capabilities:

1. a privacy-safe snapshot adapter and source-revision manifest;
2. deterministic command/observation fakes or explicit unsupported outcomes;
3. event-reactive projection reducers for its domain-native screens; and
4. environment-bound query/realtime ports whose cache keys include institution,
   scenario, run, projection kind and revision.

The same visual components, navigation names, domain language, hooks and action
contracts serve both environments. Their server-authoritative execution binding—not
component branching—selects Live or scenario state. A scenario attendance page reads
scenario registers and scenario messages through the normal attendance contract; it
cannot query Live records using a simulated date. The same requirement applies to
Today, timetable, Messages, Requests, Campus View, notifications, badges and KPIs.
Aggregates must be computed from one scenario revision so summary counts and child
rows agree.

Realtime updates are scenario event-stream updates, not writes into Live client
caches. A browser with both Live and Simulation sessions open must maintain separate
cache and subscription namespaces. Expiry or loss of the run produces an explicit
unavailable state and never silently renders Live data under a Simulation marker.

The snapshot must contain the complete state needed by every enabled module at its
captured revision, not only the records required by the initiating intervention.
Scenario writes update that copy-on-write state, continue the same typed agent/event
coordination and become immediately visible across every affected module just as the
corresponding Live write would. A message, attendance submission or timetable change
in Simulation is therefore reflected everywhere in Simulation and nowhere in Live.

## Snapshot and forecast semantics

The separate aggregate campus-operations adapter snapshot contains the
institution's active Model Core agent registry and, when present, the selected campus,
effective future sessions, canonical space/capacity references, active enrolment
counts, configuration hashes and privacy-minimized aggregate coverage evidence. A
baseline-only run therefore remains valid before campus/timetable setup, while an
intervention run still requires its real campus target and overlapping future plan.
This snapshot is sufficient for the first calculation but is not the complete state
required to operate every application module in Simulation. A full run manifest
composes every enabled domain's adapter into one revision-compatible snapshot. Source
revision maxima, a canonical snapshot hash and a sealed identity-manifest hash make
each result explainable.

The snapshot is assembled inside one read-only, repeatable-read database
transaction. Each run produces:

- a deterministic baseline;
- the deterministic alternative;
- per-metric baseline, alternative and delta values;
- optional Monte Carlo P10/P50/P90 ranges when the request identifies a behaviour
  version and the server resolves it to an approved, effective, institution-owned
  cohort policy;
- assumptions, unsupported capabilities, expiry and source-version evidence.

Scheduled teachers resolve through effective, active ThatCampus account endpoints to
their person-stable human agents. Scenario discovery must not join the retired
`campus_model_agents.user_id` compatibility column. A scheduled explicit campus space
takes precedence; when an effective class period has no explicit space, its dated class
home-space placement supplies the canonical space. Missing endpoint or placement
evidence remains unknown and is never recovered through name matching.

The caller never supplies probabilities, calibration claims, hashes or sample counts.
Without a resolved approved policy, the run is a deterministic point estimate and
stochastic metrics remain unavailable rather than receiving a hidden default. A
modeled positive response is coordination evidence only. Until a connected eligibility
allocator selects a real scenario candidate, it does not remove teacher/space conflicts
or claim that a session has been covered or relocated.

## Implemented aggregate-planning API

These current routes belong to the first aggregate what-if adapter and require an
active institution administrator membership:

- `GET /api/v1/schools/:schoolId/campus-view/scenarios/targets`
  lists future-plan teacher and space targets for the selected campus/horizon;
- `POST /api/v1/schools/:schoolId/campus-view/scenarios`
  captures and runs one transient scenario;
- `GET /api/v1/schools/:schoolId/campus-view/scenarios/:runId`
  returns an unexpired institution-scoped result; and
- `DELETE /api/v1/schools/:schoolId/campus-view/scenarios/:runId`
  discards the transient result.

The response always declares `evidence_mode: simulation`, whether uncertainty is a
deterministic point estimate or a calibrated ensemble, its side-effect policy,
snapshot time/hash/revisions, sealed identity-manifest provenance, run-local
counterpart coverage/readiness, assumptions, unsupported domains and metric
availability. Synchronous runs have explicit session, execution and concurrency
budgets; a zero-overlap intervention is rejected instead of returning a misleading
no-op comparison. A baseline snapshot is explicitly labelled snapshot-only and does
not imply that attendance or whole-application behaviour has been modelled.

Target discovery is authorization-first, short-lived and institution/campus/horizon
scoped. Equal requests share one in-flight load, builds are concurrency bounded, and
route-specific request limits protect the effective-schedule expansion. A submitted
request may identify only a server-owned behaviour-version ID; arbitrary client
probabilities, calibration claims, sample counts and deterministic seeds are rejected.

These routes do not define the final whole-app transport. The product environment
switch is a server-authoritative session action. Once selected, the existing module
API paths resolve through that session to Live or scenario-backed domain ports; the
browser does not append a trusted simulation header or replace normal modules with
scenario-specific pages.

## Campus View presentation

Campus performance has separate **Live performance** and **Plan & what-if** modes.
The planning mode uses bounded targets from the future effective plan, a campus-local
future effective session window and a 7/14/30-day horizon. It repeatedly states that
no live changes or messages occur. Deterministic results are labelled as point
estimates; calibrated ensembles compare baseline and alternative medians and show
P10/P90. Every result discloses assumptions/unsupported domains and can be discarded.

On phones this is a full-height Campus performance workspace rather than a short
bottom sheet. Its header and mode control stay visible, the form/results scroll inside
the device safe areas, and the run action remains reachable. Loading, catalogue error
and genuinely empty future-plan states are distinct; a successful empty catalogue does
not leave disabled controls without an explanation or recovery action.

No simulated point is blended into live KPI history. Promotion into an operational
draft is intentionally not implemented; when added, it must create a new reviewed
domain command after fresh authorization and retain only a minimal scenario receipt.

Campus View is only one projection in the Simulation environment. Its successful
rendering does not establish that timetable, attendance, Messages, Requests or any
other module supports the run. During development, environment parity is verified
domain by domain through the four-capability adapter contract above; release requires
all institution-enabled modules to pass together in the same run.

## Further extensions beyond current operational implementation

- exhaustive enabled-module acceptance and monitored large-campus operation;
- further explicitly configured human/device/integration reaction adapters beyond
  attendance and staff-cover/invigilation offer cohorts;
- reviewed Operating-rule UI for cohort behaviour policies and calibration quality;
- historical backtesting and horizon-specific forecast scores;
- eligible substitute and alternative-space allocation adapters;
- further interventions such as closures, gate staffing and examination readiness;
- monitored production retention/compaction and large-campus quota/load evidence; and
- reviewed scenario-to-domain-draft hand-off, never direct apply-to-live.
