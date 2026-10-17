# Campus scenario simulation

**Status:** first backend and Campus View slice implemented locally on 17 October
2026. This contract specializes section 16 of
`THATCAMPUS_MODEL_CORE_BLUEPRINT.md`; that document remains normative for the
shared Model Core.

## Purpose

Campus scenarios let an authorized administrator fork a point-in-time,
privacy-minimized digital-twin snapshot and compare the published plan with one
hypothetical change. They support planning and later forecast calibration without
turning synthetic activity into campus truth.

The first connected interventions are:

- one effective human teacher unavailable for a future working-day window; and
- one active, bookable campus space unavailable for a future working-day window.

The supported horizon is 7–30 days. The runtime reports schedule, staffing, space,
capacity and learner-place effects. Attendance outcomes, physical movement,
transport, finance and assessment outcomes remain explicit unsupported domains.

## Identity model

The runtime never treats three related actors as interchangeable:

1. the real `HumanAgent` remains the stable production identity;
2. an AI delegate is a separately identified software agent with an explicit,
   revocable `acts_for` authority snapshot; and
3. a `ScenarioPersona` is a run-local proxy linked to the source human agent but has
   no production credential, endpoint, authority or channel.

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

Production commands, messages, notifications, connector calls, evidence writes and
authority lookups are structurally denied. Every emitted message and artifact carries
its scenario, namespace and run identity. A domain executor that cannot model an
outcome returns `unsupported`; it never invents an action.

The adapter reads the live system only while creating the snapshot. Scenario state is
copy-on-write and is held in a bounded process-local store with a 30-minute TTL,
institution quota, global quota and serialized-size limit. It is never inserted into
operational or Model Core tables. Process restart intentionally discards it. A future
shared ephemeral store may replace this implementation without changing the runtime
contract. When a quota is reached the oldest completed transient result is evicted, so
an abandoned browser sheet cannot lock an institution out of planning.

This first slice does not yet implement the complete section 16.5 authority resolver,
general domain-executor registry or reviewed scenario-to-live-draft path. The current
campus adapter performs its institution-admin authorization before entering the
isolated engine and invokes one explicit campus-operations executor.

## Snapshot and forecast semantics

The campus-operations snapshot contains only the selected campus, effective future
sessions, canonical space/capacity references, active enrolment counts, effective
human-agent references, configuration hashes and privacy-minimized aggregate coverage
evidence. Source revision maxima and a canonical snapshot hash make each result
explainable.

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

## API

All routes require an active institution administrator membership:

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

## Next extensions

- reviewed Operating-rule UI for cohort behaviour policies and calibration quality;
- historical backtesting and horizon-specific forecast scores;
- eligible substitute and alternative-space allocation adapters;
- further interventions such as closures, gate staffing and examination readiness;
- a shared encrypted TTL store for multi-instance deployments; and
- reviewed scenario-to-domain-draft hand-off, never direct apply-to-live.
