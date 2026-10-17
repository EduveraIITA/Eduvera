# Campus scenario simulation

**Status:** same-application Live/transient-fork product contract accepted; isolated
campus-planning adapter implemented, complete enabled-module Simulation parity still
incomplete, 17 October 2026. This contract specializes section 16 of
`THATCAMPUS_MODEL_CORE_BLUEPRINT.md`; that document remains normative for the
shared Model Core.

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

The implemented first connected interventions are:

- one effective human teacher unavailable for a future working-day window; and
- one active, bookable campus space unavailable for a future working-day window.

The supported horizon is 7–30 days. The runtime reports schedule, staffing, space,
capacity and learner-place effects. Attendance outcomes, physical movement,
transport, finance and assessment outcomes remain explicit unsupported domains.

## Authoritative Live state and transient Simulation forks

ThatCampus has one authoritative Live environment and may create isolated,
time-bounded Simulation forks:

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
notifications, KPIs and other enabled modules. A compact persistent **Live** or
**Simulation** marker at the top is the only required visual distinction; the
Simulation marker may also show virtual date/time and provide **Return to Live**.

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
The fork expires or is explicitly discarded and cannot mutate or merge into Live. A
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

The adapter reads the Live system only while creating the snapshot. Scenario state is
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
environment and remains in the ordinary ThatCampus application. The shell changes
only its compact environment marker to **Simulation**, with virtual date/time and a
clear **Return to Live** action available from that control. Source snapshot time,
expiry and assumptions belong in its detail, not in a replacement home page or a
parallel set of domain tabs. This is also not a Campus Lab clock badge.

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

The currently implemented aggregate campus-operations adapter snapshot contains only
the selected campus, effective future sessions, canonical space/capacity references,
active enrolment counts, effective human-agent references, configuration hashes and
privacy-minimized aggregate coverage evidence. It is sufficient for the first
calculation but is not the complete snapshot required to operate the application in
Simulation. A full run manifest composes every enabled domain's adapter into one
revision-compatible snapshot. Source revision maxima and a canonical snapshot hash
make each result explainable.

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
snapshot time/hash/revisions, assumptions, unsupported domains and metric
availability. Synchronous runs have explicit session, execution and concurrency
budgets; a zero-overlap intervention is rejected instead of returning a misleading
no-op comparison.

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

## Next extensions

- environment-bound Today, timetable, attendance, Messages, Requests, Campus View
  and KPI projections through the same application contracts;
- event-reactive counterparts for human, team, device, integration and software agents;
- a complete environment-aware session resolver plus isolated caches and realtime,
  while preserving the existing shell/routes/navigation;
- reviewed Operating-rule UI for cohort behaviour policies and calibration quality;
- historical backtesting and horizon-specific forecast scores;
- eligible substitute and alternative-space allocation adapters;
- further interventions such as closures, gate staffing and examination readiness;
- a shared encrypted TTL store for multi-instance deployments; and
- reviewed scenario-to-domain-draft hand-off, never direct apply-to-live.
