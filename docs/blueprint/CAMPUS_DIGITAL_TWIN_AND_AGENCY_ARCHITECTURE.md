# Campus digital twin and agency architecture

Status: accepted product and architecture direction, 16 October 2026
Owner decision: ThatCampus is a digital twin of a living campus, not an ERP catalogue.
Blueprint basis: [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md). The v1 PDF is historical provenance only.

## 1. Decision

ThatCampus will maintain a trustworthy, time-aware digital representation of the parts of a campus needed to coordinate education and daily operations. Real-world plans, observations, decisions and outcomes flow into that representation. Authorized people, devices, integrations and bounded software agents act through it, and their commands flow back into the campus through ordinary domain workflows.

The architecture has two deliberately different faces:

- **Backend:** a typed campus-model core, explicit agents and authority, temporal relationships, observations, commands, outcomes, domain events and projections.
- **Frontend:** familiar domain language and tasks such as Attendance, Timetable, Classes, Staff, Rooms, Transport, Fees, Requests and Operating rules.

Users must never need to understand graph terminology, twin identities, command envelopes or agent runtimes to operate the product. The conceptual model is infrastructure. The product remains a set of clear, role-appropriate campus workflows.

## 2. Non-negotiable boundary: model core is separate and API-driven

The campus-model core is an independently owned backend module. It is not embedded in React components, feature-specific controllers or database queries spread across the application.

The core is consumed through versioned contracts:

1. synchronous application ports inside the modular monolith;
2. authenticated HTTP APIs where a client or integration boundary is required;
3. transactional domain events and durable inbox/outbox delivery for asynchronous projection;
4. connector adapters for observations from approved external systems and devices.

The following dependency direction is mandatory:

```text
web/mobile screen
        |
        v
domain API (attendance, timetable, people, transport, ...)
        |
        +----> domain service and authoritative domain tables
        |
        +----> Campus Model Core port/API
                     |
                     +----> identity + temporal relationships
                     +----> observation/command/outcome envelopes
                     +----> agent authority evaluation
                     +----> projection subscriptions
```

Prohibited dependencies:

- a frontend screen querying campus-model tables directly;
- a feature module importing the model core's database repository;
- the model core implementing attendance, fee, timetable or safeguarding policy;
- a model provider or AI assistant calling the database or model core without the normal application authorization boundary;
- a generic graph/EAV record replacing typed authoritative domain tables;
- a device or integration publishing an accepted campus fact directly.

The first deployment remains one NestJS modular monolith and one PostgreSQL database. Separation is by module ownership, interfaces, permissions, tests and schemas, not premature microservices. The core may later be extracted only if measured scale, availability or team ownership justifies it.

## 3. What the digital twin represents

The twin is a connected operational model, not a second copy of every database row.

Stable entity identifiers and the space hierarchy deliberately allow a later
spatial read model. A 2D/3D interface would consume a separate geometry/rendering
projection keyed to those identifiers; geometry is not embedded into every domain
record and visual position is not treated as evidence of real-world presence.

### 3.1 Stable things

- institution and campus;
- building, floor, room, gate, lab and other operational space;
- person, enrollment, staff assignment, class/cohort and team;
- bounded resource, device, route, vehicle and integration endpoint;
- schedule, session, trip, event and other operational context.

### 3.2 Time-aware relationships

- a class is placed at a campus and home space for an effective period;
- a staff member is assigned to a campus, role and scope for an effective period;
- a learner is enrolled in a class/term without losing prior placement history;
- a device is registered to a campus/workflow with a reviewed capability;
- a room is allocated to a session or event for a defined interval;
- an operator or software agent has a capability in a defined scope for a defined period.

Relationships retain effective time and recording time. Corrections supersede prior assertions; they do not silently rewrite the past.

### 3.3 Expected, observed, accepted and projected state

These are separate dimensions:

- **Expected:** what the plan says should happen, such as a scheduled Mathematics session.
- **Observed:** what an identified person/device/integration reports happened.
- **Accepted:** the domain decision produced after validation, reconciliation, authority and applicable rules.
- **Projected:** a user-specific, derived view optimized for navigation and action.

No single mutable `status` field represents the whole campus or child. A learner may be expected in class, observed at a gate, accepted absent for one subject session, and assigned an unresolved follow-up at the same time.

### 3.4 Event-derived runtime state

The operational state of the twin is derived from an ordered history of typed events; it is not maintained by screens silently overwriting a current-state row. The history contains four different kinds of evidence:

- **plan events:** a published timetable, event, trip, duty or closure establishes what is expected;
- **observation events:** an identified human, device or integration reports something it directly observed;
- **decision events:** the owning domain accepts, rejects, corrects or reconciles observations under its invariants;
- **command outcomes:** an authorized action was requested and reached an explicit outcome, without implying that the real-world action occurred.

Every event retains institution, subject/context identities, event time, effective time where applicable, recording time, source/actor, causation/correlation, schema version and provenance. Corrections supersede prior evidence; they do not delete or rewrite it. Materialized current-state projections are disposable and rebuildable from authoritative domain events plus retained observation envelopes.

Configuration such as a campus, room or person identity originates in an authorized domain command. Dynamic claims such as presence, participation, movement or occupancy require observations and domain reconciliation. A command, timetable expectation, missing observation or elapsed deadline never manufactures a real-world fact.

### 3.5 Timetable and operational time are first-class

The timetable is a first-class model context rather than a display-only feature. It consists of versioned schedule definitions and concrete dated occurrences. An occurrence identifies its interval, participants/cohort, responsible staff, subject/activity, campus/space, source schedule version and exception/closure context.

The occurrence engine expands only the bounded time windows required by consumers and accounts for term dates, teaching days, holidays, closures, substitutions, room moves, one-day changes and cancellations. Published versions create expectations; later versions do not silently rewrite previously effective expectations or historical observations.

Schedules may trigger rule evaluation and establish expected state, but they do not prove presence. For example, a timetable can say that a teacher is expected in Room 201 from 9:00 to 9:45. A valid gate check-in can support that the teacher is on campus. Unless a sufficiently specific observation exists, the model must describe Room 201 as an **expected location**, not the teacher's known location. A check-out, approved leave, substitution or contradictory fresh observation changes or invalidates that inference.

### 3.6 Provenance-aware state resolution

Cross-domain queries resolve a typed state assertion instead of returning an unexplained value. Each assertion contains:

- subject and context;
- asserted value and state dimension (`expected`, `observed`, `accepted` or `inferred`);
- valid/effective interval and `asOf` recording time;
- contributing event and rule-version references;
- source kind, freshness and confidence/quality classification;
- contradictions, unresolved evidence and expiry;
- responsible owning domain and available correction path.

Inference is bounded and explainable. It may combine accepted check-in/check-out, effective timetable occurrences, approved leave, substitutions and fresh sensor observations. It must never turn silence into absence or an expectation into a confirmed physical location. Conflicting or stale evidence produces `unknown` or an owned exception, not false precision.

This distinction applies to all future live-campus projections, including 2D/3D views. A visual marker must visibly distinguish scheduled, last observed, accepted and inferred position and must expire when its evidence is no longer fresh.

## 4. Domain truth remains authoritative

The model core connects domains; it does not erase them.

| Domain | Authoritative records | Twin contribution |
| --- | --- | --- |
| People and enrollment | people, guardian relationships, enrollments, staff assignments | stable identities and dated membership/placement relationships |
| Campus setup | campuses, spaces, resource types and holdings | physical/virtual topology and capability context |
| Timetable and calendar | schedule versions, sessions, events, closures | expectations and occupancy relationships |
| Attendance | sessions, observations, decisions, corrections | participation observations and accepted outcomes |
| Requests and leave | requests, approvals, readiness, execution | intended changes and unresolved dependencies |
| Transport and gate | trips, rider rosters, board/alight/handover observations | movement contexts and contradictions; never continuous location truth |
| Communication | threads, delivery, acknowledgement and response | coordination state, not consent or authority |
| Finance | obligations, allocations, payments, receipts and reconciliation | financial obligations/outcomes without collapsing ledger states |
| Care and safeguarding | restricted cases and controlled outcomes | minimal references and neutral public envelopes only |

Each domain owns its validation, state machine, authorization and relational constraints. The core stores canonical references and the cross-domain digital thread needed for explanation, coordination and projections.

## 5. Agent-based operating model

An **agent** is an identified actor capable of proposing or issuing a command. It is not synonymous with AI.

Supported agent kinds:

- **human:** administrator, teacher, office operator, guardian, learner with an eligible account;
- **team/role:** duty team or office queue used for responsibility routing, never as an anonymous audit actor;
- **device:** registered gate reader, biometric terminal, staff device or camera capture endpoint;
- **integration:** approved SIS, calendar, payment, transport or messaging connector;
- **software agent:** deterministic automation or optional model-assisted orchestration operating inside a bounded capability contract.

Rooms, classes, resources and students without an acting account are model entities, not agents merely because they exist.

Every action records the concrete acting principal. A team may own work, but completion still records the human/device/software actor that performed it.

### 5.1 Authority contract

An authority assignment states:

- agent identity and kind;
- capability/command type;
- institution and eligible domain scope;
- optional campus, class, student, route, space or workflow scope;
- effective start and end;
- grant source and approver;
- constraints and required fresh checks;
- revocation state;
- applicable operating-rule version where automation is involved.

Authority is purpose-specific. Read access, attendance entry, policy editing, money handling, consent, safeguarding and physical handover are never interchangeable.

Every command rechecks current membership, purpose-specific authority, tenant scope, target revision and applicable restrictions at execution time. Cached navigation, previous model context or an earlier approval is not authority.

### 5.2 Autonomy levels

The platform uses the least autonomy that removes work safely:

| Level | Behaviour | Examples |
| --- | --- | --- |
| A0 Observe/explain | read and explain authorized state with source/freshness | explain why a register is waiting |
| A1 Recommend | suggest a next action without preparing a write | recommend assigning a substitute |
| A2 Prepare | create an expiring, reversible draft/review | prepare a notice or timetable change |
| A3 Routine execute | perform a bounded, reversible action under an active Operating rule | send a reminder after its configured delay |
| A4 Human decision | require explicit authorized decision and fresh validation | approve enrollment change or fee reversal |
| A5 Human-only/physical | software may coordinate but cannot authorize or declare the outcome | child handover, safeguarding conclusion, identity verification |

No operating rule may manufacture an observation, infer absence from missing data, create consent/authority, silently reconcile money, conclude safeguarding, or declare a physical handover.

## 6. Operating rules are the automation constitution

Mutable automatic behaviour is defined by versioned institution-level Operating rules, not hard-coded screen logic or per-record switches.

Each rule type declares:

- eligible institution/campus/domain scopes;
- trigger and timing window;
- preconditions and data freshness requirement;
- action and autonomy level;
- fallback and responsible owner;
- explanation template;
- correction/override route;
- audit fields and retention class;
- invariant and safety floors that administrators cannot weaken.

Lifecycle:

```text
Draft -> validated -> rehearsed -> approved -> scheduled -> active -> superseded/withdrawn
```

In-flight workflows retain the rule version they received, except current authority revocation and emergency restrictions are rechecked at action time. Equal-priority conflicts fail activation. Rule evaluation returns an explanation suitable for the domain UI, for example: “A reminder will be sent at 10:50 AM because Daily attendance rule v4 waits 20 minutes after the register deadline.”

## 7. Core contracts

Contracts live in a provider-neutral package/module and are versioned independently of UI components.

### 7.1 Entity reference

```ts
type CampusEntityRef = {
  schoolId: string;
  entityId: string;
  kind: string;
  domain: string;
  domainId: string;
  revision: number;
};
```

The registry supplies stable cross-domain identity. The referenced domain table remains authoritative and must be checked before a consequential command.

### 7.2 Observation envelope

```ts
type CampusObservation = {
  id: string;
  schoolId: string;
  campusId?: string;
  kind: string;
  subject: CampusEntityRef;
  context?: CampusEntityRef;
  observedAt: string;
  receivedAt: string;
  capturedByAgentId: string;
  source: { type: string; id?: string; recordId?: string };
  evidenceRefs: string[];
  payload: unknown;
  schemaVersion: number;
  idempotencyKey: string;
};
```

An observation is immutable application evidence. It is not accepted domain truth until the owning domain validates and reconciles it.

### 7.3 Command envelope

```ts
type CampusCommand = {
  id: string;
  schoolId: string;
  type: string;
  target: CampusEntityRef;
  actorAgentId: string;
  requestedAt: string;
  effectiveAt?: string;
  expectedRevision?: number;
  authorityEvidence: string[];
  operatingRuleVersionId?: string;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  payload: unknown;
};
```

The model core authenticates the envelope and resolves agent authority. The owning domain executes the command and returns a typed outcome. The core never interprets arbitrary payloads as permission.

### 7.4 Outcome and event

An outcome states accepted, rejected, conflicted, expired, queued-for-review or failed, with a machine code, safe explanation, resulting aggregate revision and domain event references. Accepted domain events are written with the state change in one transaction and include privacy class, actor, rule/policy version, correlation and causation.

## 8. Initial persistence model

PostgreSQL remains authoritative. Use relational columns and constraints for identity, time, tenant, state and authority; JSONB is limited to validated versioned payloads/metadata.

Proposed internal tables:

- `campus_model_entities`: stable registry for typed domain records;
- `campus_model_relationships`: typed, effective-dated cross-entity relationships;
- `campus_model_agents`: human/team/device/integration/software actor identity;
- `campus_model_agent_authorities`: effective-dated capability and scope grants;
- `campus_model_observations`: immutable normalized observation envelopes;
- `campus_model_commands`: immutable command requests and execution state;
- `campus_model_command_outcomes`: append-only attempts/outcomes;
- `campus_model_projection_checkpoints`: idempotent projection consumption state.

These tables are private to the core. Browser/database roles have no direct grants. Row-level security, composite tenant keys and service authorization remain required even though the API also checks scope.

### 8.1 Relationship typing

Relationship kinds are code-reviewed contracts such as `located_in`, `assigned_to`, `enrolled_in`, `scheduled_in`, `responsible_for`, `operated_by` and `observed_in`. Each kind declares permitted source/target entity kinds, overlap rules and cardinality. Administrators cannot invent new relationship semantics through a custom-field editor.

### 8.2 No generic graph source of truth

The registry and relationships enable connected queries; they do not create a graph database or universal object editor. Domain services still enforce such rules as one active class enrollment, attendance correction lineage and balanced finance allocation. A projection may use graph traversal for explanation/navigation, but it cannot bypass the authoritative domain service for a write.

## 9. APIs and module ownership

### 9.1 Internal application ports

The core exports narrow interfaces rather than repositories:

- `EntityRegistryPort.register/supersede/resolve`;
- `RelationshipPort.link/close/listAt`;
- `ObservationIngressPort.capture`;
- `AgentAuthorityPort.evaluate/explain`;
- `CommandRouterPort.issue/status/cancel`;
- `ProjectionPort.getContext/getTimeline`.

Feature modules depend on interfaces declared in a shared contract package. The model-core module implements them. Contract tests must be runnable with an in-memory fake and PostgreSQL adapter.

### 9.2 HTTP boundary

Ordinary screens call domain APIs. Model-core HTTP routes are limited to:

- approved connector observation ingestion;
- administrator topology/setup commands expressed in campus language;
- authorized cross-domain context/timeline queries used by a domain API;
- command status and explanation;
- operational health and replay tooling restricted to support authority.

No public endpoint accepts arbitrary entity kinds, SQL-like filters, relationship definitions or executable rules.

### 9.3 Events

Domain modules emit accepted business events through the existing transactional outbox. The core consumes them idempotently to update canonical references and projections. The core emits neutral coordination events; downstream consumers must still enforce their own authorization and domain invariants.

## 10. Frontend contract: domain language only

The model architecture must make the existing product simpler, not expose more configuration.

Frontend rules:

- keep established ThatCampus theme, navigation, headers and mobile interaction patterns;
- use nouns already used on campus: branch, classroom, teacher, class, period, register, route, request;
- show one clear status and next action, with source/time/owner where relevant;
- explain automation in plain language and link to the responsible Operating rule;
- reuse one campus identity across screens rather than making users re-enter the same room/resource;
- reveal setup dependencies progressively inside the workflow that needs them;
- show contradictions and uncertainty without inventing a resolved state;
- never display internal terms such as twin entity, edge, command envelope, actor graph or projection checkpoint.

Example: the timetable editor asks for **Room**, not `located_in` relationship. Attendance says **Awaiting teacher submission**, not `expected-state divergence`. A gate observation can say **Recorded at Main Gate at 8:06 AM; classroom attendance not yet recorded**.

## 11. Bidirectional campus loop

### 11.1 Real campus to ThatCampus

```text
person/device/integration reports something
 -> observation adapter authenticates source
 -> model core stores normalized observation
 -> owning domain validates/reconciles
 -> authorized decision changes domain state
 -> business event updates projections/tasks
 -> domain UI shows source, freshness and next action
```

### 11.2 ThatCampus to real campus

```text
human or bounded software agent proposes a command
 -> current authority + rule + revision are evaluated
 -> owning domain executes or requests review
 -> task/message/device instruction is dispatched
 -> delivery/readiness remain separate from execution
 -> later observation records what actually happened
 -> outcome closes or escalates the loop
```

A sent message is not acknowledgment. A device instruction is not physical execution. A task marked complete is not automatically an observation.

## 12. Security, privacy and failure rules

- tenant identity is present in every primary key/unique relationship boundary where practical;
- cross-tenant references fail at service and database layers;
- software agents receive no standing database credentials;
- model providers use permission-scoped application tools and never sit in critical paths;
- observation source, observed time, received time and evidence lineage are retained;
- sensitive payloads stay in their restricted domain and are referenced minimally;
- idempotency rejects the same key with changed payload;
- late, duplicate and out-of-order observations remain reconcilable;
- failed projections do not roll back accepted domain truth;
- core unavailability must not prevent safe manual/offline domain capture where the blueprint requires it;
- retention/deletion/redaction follow data category and legal hold, not an unlimited “append-only” claim.

## 13. Transformation plan

### Phase 0 - Contract and dependency guards

- accept this architecture record and link it from technical, product, design and agent documents;
- add a `campus-model-core` Nest module and a separate typed contracts package/directory;
- add architecture tests forbidding frontend/database and cross-module repository dependencies;
- document current tables mapped to domain ownership.

Exit: the boundary compiles and tests without changing visible behaviour.

### Phase 1 - Campus topology projection

- implement campuses, spaces, bounded resources and dated class/staff placements;
- register those typed domain records with stable model identities;
- publish accepted setup events transactionally;
- expose only campus-language setup APIs and screens;
- backfill one primary campus and existing room/class/staff placements without fabricated resources.

Exit: one tutor/learner and a multi-branch fixture both form a navigable connected campus; history and tenant constraints pass.

### Phase 2 - Observation and command spine

- normalize existing attendance/device observations behind `ObservationIngressPort`;
- add command/outcome envelopes around selected existing domain commands;
- preserve current domain APIs while adding correlation, causation, actor and rule evidence;
- project an explainable cross-domain timeline.

Exit: an attendance observation and a campus-setup move can be traced from source through accepted outcome without the core deciding domain truth.

Implementation checkpoint (16 October 2026): the first Phase 2 slice is delivered on
the campus-digital-twin branch. Immutable attendance-capture observations enter the
core through the typed port in the same transaction as their source evidence. Their
state follows the attendance domain's later accepted, quarantined or rejected
decision; the core does not decide attendance. Existing evidence is backfilled with
stable student/class/actor identity, provenance and idempotency hashes. Campus setup
commands and attendance observations are combined by a core-owned read projection
and exposed to administrators as **Recent activity** in campus language. Registered
device and integration ingress, event-level correlation for attendance acceptance,
and the wider cross-domain command set remain Phase 2 work.

### Phase 2A - Temporal runtime and schedule context

- register schedule definitions, versions and dated occurrences as first-class model contexts;
- consume published timetable, exception, closure, substitution and cancellation events idempotently;
- add a provider-neutral event journal contract with event/effective/recorded time and supersession lineage;
- implement rebuildable state projections and an `asOf` context resolver;
- return provenance, freshness, certainty and contradiction evidence with every dynamic state assertion;
- keep expected location and observed presence separate in storage, APIs and UI copy;
- create owned exceptions for material contradictions rather than resolving them silently.

Exit: for a selected teacher, learner, class, room or resource, an authorized caller can ask what was planned, observed, accepted and inferred at a given time and receive a source-backed answer. Replaying the same events produces the same projection, and no timetable entry or missing observation is presented as proof of physical presence.

### Phase 3 - Agents and authority

- register human, device, integration and deterministic software agents;
- bind current roles/assignments and registered devices to effective-dated authority;
- make authority explanations available to domain services;
- distinguish institution administrator from Principal operational assignment.

Exit: revocation and scope changes take effect immediately; no implicit administrator-to-Principal authority remains for migrated workflows.

### Phase 4 - Operating-rule automation

- route existing scheduled automations through typed rule/version evidence;
- add rehearsal, explanation, fallback and override outcomes;
- convert hard-coded mutable timings/choices domain by domain;
- keep consequential and physical decisions outside automatic execution.

Exit: every automatic write in scope can name the rule, trigger, actor, reason, result and correction path.

### Phase 5 - Domain adapters and connected projections

- timetable/attendance, enrollment, events, transport/gate and communication connect in dependency order;
- add contradiction cases and responsible-owner routing;
- replace duplicate room/class/resource configuration with canonical identities;
- preserve domain-specific screens and state machines.

Exit: connected workflows reduce repeated entry without creating a generic control-panel UI.

### Phase 6 - External campus connections

- onboard approved devices/connectors through capability profiles;
- enforce source identity, schema, health, replay and quarantine;
- provide non-digital/manual fallbacks;
- validate each adapter and campus workflow separately.

Exit: no connector can publish accepted safety/attendance/authority facts directly, and degraded operation is visible.

### Optional later phase - Spatial campus projection

- attach versioned floor plans/geometry to stable campus-space identities;
- project schedules, resources and sufficiently fresh observations into 2D/3D views;
- preserve source, freshness and uncertainty in every live visual state;
- keep all edits routed through domain APIs rather than manipulating the scene as
  an unvalidated source of truth.

Exit: the visual campus helps navigation or operations without manufacturing live
location, bypassing authority or creating a second data model.

## 14. First implementation slice

The existing `institution_campuses`, `campus_spaces`, resource and placement work becomes the **campus topology domain**, not the model core itself.

Before enabling its UI:

1. create the separate contracts and `CampusModelCoreModule` skeleton;
2. add stable entity registration and typed relationship ports;
3. make institution-setup service call those ports in the same transaction boundary;
4. publish setup audit/outbox evidence;
5. split the large campus setup component into domain-focused components;
6. add backend tenant/concurrency/history tests and focused frontend interaction/accessibility tests;
7. apply the migration only after transaction-only schema validation and preview recovery checks;
8. ask for physical mobile validation before expanding to the next domain.

This slice does not claim a complete digital twin, multi-campus release, device integration or autonomous campus operation.

## 15. Acceptance gates

### Architecture

- feature modules cannot import model-core persistence adapters;
- frontend contains no model-core table/contract imports;
- domain writes still pass their original authorization and invariant tests;
- duplicate/out-of-order event tests prove idempotent projection;
- the app operates when an AI/model provider is disabled.

### Data

- one stable entity identity maps to one school-scoped authoritative record;
- dated relationships reject invalid overlap/cross-tenant links;
- observation source/time/evidence are preserved;
- command outcome and domain event are correlated;
- correction/retention behavior is defined and tested.

### User experience

- users see only domain language and one clear next action;
- a campus item created once is reused wherever eligible;
- empty/loading/error/offline/conflict/unauthorized states are defined;
- phone layouts do not overflow and meet established accessibility standards;
- setup makes missing dependencies visible without forcing irrelevant configuration.

### Operational

- rule-driven automation identifies timing, scope, fallback and override;
- authority revocation is reflected before a consequential command executes;
- connector/model-core failure has a documented safe fallback;
- logs and audit evidence avoid unnecessary student data;
- release evidence distinguishes local tests, hosted tests, deployment and human acceptance.

## 16. Explicit non-goals

- replacing every domain table with a graph;
- exposing a universal low-code object/relationship builder;
- making AI the source of campus truth;
- continuous surveillance or a single “where is the child” status;
- automatic safeguarding, consent, collection, financial reconciliation or physical handover decisions;
- forcing a complete institution setup before a bounded workflow can operate;
- turning campus resources into a full ERP asset, procurement or facilities suite;
- redesigning established day-to-day screens merely to reveal the architecture.

## 17. Working product test

The architecture is succeeding when a real operator can say:

> “I entered this classroom once. It appears in the timetable, attendance context and event planning; ThatCampus explains which class and staff are assigned there today; routine reminders happen under rules I can inspect; contradictions become owned work; and no screen asks me to understand the machinery underneath.”
