# ThatCampus Model Core blueprint

Status: accepted target architecture and implementation contract, 16 October 2026

Normative parent: [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md)

Architecture boundary: [Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md)

Experience companion: [ThatCampus operating experience](THATCAMPUS_OPERATING_EXPERIENCE.md)

## 1. Purpose

The ThatCampus Model Core is the domain-independent operating coordination kernel for
a living campus digital twin. It connects authoritative domain records, real-world
observations, time-aware plans, identified agents, configured behaviour, typed
messages, commands, outcomes and user-facing projections into one explainable digital
thread.

The core must be broad enough to support attendance, timetable, people, examinations,
events, communication, gate, transport, departure, finance, restricted care and
future domains without containing those domains' business rules or replacing their
relational source of truth.

“Support everything” therefore means:

- every domain can register stable identities and time-aware relationships;
- every accepted domain change can publish a typed event;
- every real-world input can enter as a source-rich observation;
- every acting person, team, device, integration or bounded software process has a
  stable agent identity and current authority;
- configured event reactions can create durable messages or domain commands;
- every command returns a correlated authoritative outcome;
- cross-domain context can be projected and explained without inventing truth;
- the same contracts can later run safely in an isolated simulation;
- no domain must surrender its invariants, records or vocabulary to the core.

### 1.1 Status and conformance language

This document is the normative target contract. **MUST** and **MUST NOT** identify a
release requirement, **SHOULD** identifies the expected implementation unless a
documented exception is approved, and **MAY** identifies a compatible extension.

A domain adapter conforms only when it declares its versioned identities, events,
observations, commands, outcomes, correction path, privacy classification, replay
support and simulation support; passes the shared adapter suite; and does not bypass
the owning domain's authorization or invariants. A core capability described here is
not “implemented” until the implementation plan names the verified code, migration,
tests and remaining release gates. Target contracts and illustrative traces are not
production-readiness claims.

The core supports future domains by a reviewed adapter protocol. “Everything” does
not mean arbitrary runtime objects, scripts or untyped JSON workflows.

## 2. Non-negotiable boundaries

### 2.1 The core coordinates; domains decide

The core owns identity, correlation, causation, time-aware connection, agent runtime,
behaviour configuration, coordination state, provenance and rebuildable projections.

The owning domain decides whether a leave request is valid, an attendance submission
is accepted, a timetable conflicts, a payment reconciles, a result is published, a
collection authority is valid or a safeguarding case is closed.

### 2.2 The core is behaviour-neutral

The core contains no hard-coded Principal agent, attendance agent, leave agent or
domain workflow. It provides validated execution primitives. Mutable behaviour comes
only from versioned, effective-dated institution configuration and Operating rules.

Code owns:

- schema validation;
- transaction, idempotency, ordering and lease semantics;
- tenant and privacy enforcement;
- non-weakenable safety/security floors;
- domain adapter interfaces;
- supported message/command protocol schemas;
- deterministic runtime mechanics.

Configuration owns:

- event subscriptions and filters;
- eligible agent selectors;
- reaction mappings;
- message recipient and owner resolution;
- timing, retries, expiry and escalation;
- maximum autonomy and allowed tools/effects;
- optional model/provider/context policy;
- explicit human fallback;
- activation and effective dates.

An agent cannot learn, rewrite or activate its own production behaviour. A proposed
adaptation remains an inert draft until authorized validation, rehearsal and
activation.

### 2.3 Frontends never operate the core directly

Ordinary clients call domain APIs. Domain services use narrow core ports inside their
application/transaction boundary. Core HTTP endpoints exist only for approved
connector ingress, administration, support/replay and authorized cross-domain reads.

### 2.4 The core is not a generic graph or low-code platform

Entity and relationship registries support connection and temporal context. They do
not provide an arbitrary object builder, EAV store or user-authored executable code.
Relationship kinds, event schemas, protocols and command types are reviewed contracts.

### 2.5 Maximum useful fidelity, not maximum surveillance

The core stores the detail required to coordinate, govern, explain and simulate an
authorized campus operation. It does not continuously track people, infer private
intent, convert sparse observations into location truth or retain sensitive payloads
indefinitely.

### 2.6 State ownership

| State | Authoritative owner |
| --- | --- |
| person, enrollment, leave, register, timetable, payment, trip or care case | owning domain |
| stable cross-domain reference and temporal connection | Model Core projection over domain truth |
| person/account/channel-to-agent binding | Model Core projection over People/Auth truth |
| role, assignment, office, mandate or consent source | owning access/governance domain |
| evaluated authority receipt | Model Core, rechecked by the executing domain |
| Operating-rule version | owning Operating Rules domain |
| behaviour version, subscription, reaction and operational message | Model Core |
| command outcome | owning domain; correlated evidence retained by the core |
| temporal/context assertion and contradiction case | rebuildable Model Core projection |
| Today, Requests and automation history | rebuildable application projection |
| simulation scenario/run | isolated scenario state, never production truth |

## 3. System position

```text
domain-native UI / approved channel / registered device
                         |
                         v
        authenticated domain API or observation gateway
                         |
                         v
             +---------------------------+
             |   ThatCampus Model Core   |
             |---------------------------|
             | identity + relationships  |
             | event/observation journal |
             | agent + authority context |
             | behaviour + subscriptions |
             | reactions + messages      |
             | command routing/outcomes  |
             | projections + explanation |
             | simulation contracts      |
             +---------------------------+
                 |                   ^
        typed command/port       event/outcome
                 v                   |
             owning domain service and database
      attendance / timetable / people / finance / ...
```

The first deployment remains a NestJS modular monolith and PostgreSQL database. The
boundary is enforced by modules, ports, schemas, database permissions and tests. It
does not require premature microservices, a graph database, a message broker or an AI
provider.

## 4. Capability map

The target core has twelve cooperating capabilities.

| Capability | Owns | Does not own |
| --- | --- | --- |
| identity registry | stable cross-domain references and source revision | person/class/room business records |
| temporal relationship service | typed effective-dated connections and lineage | domain assignment validity rules |
| event journal | immutable typed accepted-domain events | domain transaction state |
| observation spine | source-rich reported evidence and reconciliation state | accepted attendance/presence/safety truth |
| agent registry | acting identities for human/team/device/integration/software | accounts, employment or device inventory truth |
| authority context | purpose/scope/time evidence and explanations | role/appointment/domain grant source of truth |
| behaviour registry | validated versioned reaction configuration | hard-coded institutional choices |
| reaction runtime | durable event matching, scheduling, attempts and terminal state | domain decision making |
| operational mailbox | typed agent-to-agent request/task/offer/update protocol | AI chat or ordinary notification rendering |
| command router | validated command envelopes, idempotency and outcome correlation | domain mutation implementation |
| projections/context | rebuildable Now/timeline/work/explanation context | a second writable source of truth |
| scenario runtime | isolated virtual-clock event/reaction simulation | production delivery or live mutation |

These capabilities are implemented behind ports as cooperating modules rather than
one universal service: schema registry; tenant/context guard; identity/relationship
registry; agent/endpoint registry; authority evaluator; behaviour and Operating-rule
resolver; event/observation ingress; subscription matcher; reaction scheduler;
operational mailbox/protocol engine; command router/outcome journal; temporal
projection/query service; contradiction/correction/replay service; scenario runtime;
domain-adapter registry; privacy/retention service; and runtime health/support tools.
Feature modules depend on ports and never on a core repository.

## 5. Canonical primitives

### 5.1 Entity reference

An entity reference connects one authoritative domain record to the model:

- institution/tenant;
- globally stable model ID;
- domain owner and domain record ID;
- reviewed entity kind;
- source revision and lifecycle state;
- safe label and minimal non-sensitive metadata;
- created/updated/superseded provenance.

The registry never becomes the authoritative student, class, invoice or assessment
record. Resolving a consequential command rechecks the domain target.

### 5.2 Temporal relationship

A relationship states that one registered entity is connected to another for a valid
interval. It retains source domain/record/revision and recording time.

Examples:

- campus `part_of` institution;
- room `part_of` building/campus;
- class `home_space` room;
- learner `enrolled_in` class;
- teacher `assigned_to` class/subject/campus;
- period `scheduled_in` room;
- person/team `responsible_for` request/case;
- device `installed_at` gate/space;
- route `operated_by` transport team.

Kinds define source/target types, cardinality, overlap and closure rules in reviewed
code. Domain services determine whether the source assignment is valid.

### 5.3 Domain event

A domain event is an immutable statement that the owning domain accepted a change or
recorded a meaningful transition.

Required fields:

- event ID, tenant and typed schema/version;
- aggregate reference and source revision;
- concrete actor agent and optional delegated/team context;
- occurred, effective and recorded times;
- correlation and causation IDs;
- authority and Operating-rule/behaviour evidence where applicable;
- privacy/retention classification;
- minimal validated payload and restricted-domain evidence references;
- supersession/correction reference where applicable.

Events are written with the authoritative state change or delivered through a
transactional outbox. Publication is at least once; consumption effects are
idempotent.

### 5.4 Observation

An observation records what an identified human, registered device or approved
integration reported.

It includes subject/context, observed and received time, source identity, evidence,
schema/version, idempotency key and review state. `pending`, `accepted`, `rejected`,
`quarantined` and `superseded` describe evidence handling—not the full domain state.

Examples include attendance marks, gate scans, biometric reads, vehicle positions,
payment-provider callbacks, paper-entry transcription and camera-assisted candidate
matches.

No device/integration observation enters directly as accepted attendance,
safeguarding, reconciliation, identity or handover truth.

Evidence references are typed, access-controlled pointers to domain storage. They
retain evidence kind, owning domain, integrity/version metadata, minimum-disclosure
label, retention class and permitted purpose; generic core payloads do not copy the
restricted evidence.

### 5.5 Temporal assertion

A projection may emit an assertion such as:

- expected teacher for a scheduled occurrence;
- latest accepted gate observation;
- active enrollment at an instant;
- responsible team for unresolved work.

Every assertion carries source, valid interval, recorded time, certainty class,
freshness and contradiction evidence. Expected, observed, accepted and derived
assertions remain separate.

### 5.6 Agent

An agent is an identified actor that can receive work, react, communicate, observe or
issue a command:

- **human:** linked to one person/account/channel identity;
- **team:** durable queue/ownership identity; concrete responder still signs actions;
- **device:** registered physical capture/control endpoint;
- **integration:** approved external software connection;
- **software:** deterministic or bounded model-assisted runtime actor.

Passive rooms, classes and resources are entities, not agents. A learner without an
acting account may remain only a person entity.

For humans, identity is person-stable rather than account-stable:

```text
institution-scoped Person
  <-> one stable HumanAgent
  <-> zero or more dated accounts
  <-> zero or more approved external-channel identities
```

Replacing an account or channel does not replace the agent. Merge/split, alias and
retirement operations retain lineage and require People/Auth authority. Team agents
have dated membership and queue ownership; a concrete human still signs a material
response. Device/integration credential rotation does not change source identity.
There is no cross-tenant person or agent merge.

An agent endpoint represents one account, app session, device credential, provider
identity or external channel through which an agent can act or receive delivery. Its
suspension, revocation, scope and delivery health are separate from the stable agent.

### 5.7 Authority evidence

Authority is purpose-specific, scoped and effective-dated. It references the owning
role, assignment, appointment, device grant, consent or exception record.

The core can resolve and explain authority but does not become the sole source of
roles or appointments. Consequential domain execution rechecks current authority,
target scope, revision and emergency restrictions.

An authority decision is a dated receipt containing `allow`, `deny` or
`review_required`, purpose/command, target/context, requested autonomy, channel,
matched grants/mandates, constraints, expiry/freshness, explanation code and source
evidence. It never becomes a permanent grant.

### 5.8 Behaviour version

A behaviour version is immutable after activation and includes:

- institution and eligible scope;
- agent kind/capability selector;
- trigger event schema/version and filters;
- reaction contract and permitted effects;
- allowed message, observation and command schemas;
- maximum autonomy and permitted application tools;
- recipient/owner resolution strategy;
- timing, ordering, retry/backoff, expiry, rate and loop limits;
- Operating-rule dependencies;
- data-minimization, memory and model/provider policy;
- fallback, escalation and correction owner;
- validation, rehearsal, approval, activation and supersession evidence;
- effective interval and configuration hash.

Lifecycle:

```text
draft -> validated -> rehearsed -> approved -> scheduled -> active
                                                   |
                                                   v
                                    superseded / withdrawn
```

An active version is never edited in place. In-flight reactions keep their snapshot,
except current authority revocation and mandatory safety restrictions are evaluated
fresh.

An Operating-rule version remains a separate institution-owned record for timing,
threshold, scope, fallback and automatic choice. A behaviour version references the
rule version it uses; neither silently copies nor rewrites the other.

### 5.9 Subscription

A subscription makes a currently eligible agent or selector a candidate to react to
a named event. It never grants authority.

It references the behaviour version, event filter, tenant/purpose/scope, subscriber
selector, effective interval and deterministic reaction contract. Event matching is
idempotent and records why a subscription did or did not match.

### 5.10 Reaction

A reaction is one durable evaluation of one event under one subscription/behaviour
version for one resolved agent/owner.

States:

```text
scheduled -> leased -> running -> waiting -> completed
                       |          |          |
                       v          v          v
                     failed    expired    cancelled/dead_letter
```

It retains attempts, processing lease, current authority result, input context,
explanation, emitted message/observation/command IDs, retry schedule, terminal reason
and escalation.

### 5.11 Agent message

A message is typed operational communication, not raw chat:

- `inform` / Update;
- `request` / decision needed;
- `delegate` / Task assignment;
- `propose` / reversible proposal;
- `offer` / responsibility offered;
- `accept`, `reject`, `reply`, `query`;
- `escalate`, `acknowledge`, `cancel`.

It retains sender, recipients, current owner, conversation/correlation/causation,
protocol/schema, subject/context, sent/deliver/expiry/response-due times,
sensitivity/retention and delivery/acknowledgement/response state.

The same record may render as a request card, queue task, Telegram prompt or email.
Channel text is a redacted presentation, not the source of authority or state.

A conversation groups correlated protocol messages without turning them into chat.
It retains protocol/version, participants, subject/context, current owner, source
record/revision and terminal outcome. Per-recipient delivery, acknowledgement,
claim, response and terminal resolution are independent states.

### 5.12 Command

A command asks one owning domain to attempt a typed state transition. It includes
actor, target, expected revision, authority evidence, effective time, rule/behaviour
version, correlation/causation, idempotency key and validated payload.

The command router does not interpret arbitrary JSON as permission and does not
mutate domain tables itself.

### 5.13 Outcome

The owning domain returns `accepted`, `review_required`, `rejected`, `conflicted`,
`expired`, `failed` or `cancelled` with machine code, safe explanation, resulting
revision/entity/event references and correction/retry hints.

Accepted command is not physical execution. A later observation may be required to
close the real-world loop.

### 5.14 Projection checkpoint

Each projection consumer stores last processed delivery/event, schema version,
rebuild version and health. Projection failure never rolls back accepted domain truth.

### 5.15 Scenario

A scenario defines an isolated model namespace, starting snapshot, virtual clock,
configuration versions, synthetic/sanitized participants and result metrics. Scenario
events/reactions/messages can never target production channels, commands, authority or
evidence.

### 5.16 Trace, contradiction and simulation-run records

A trace context carries tenant, correlation, causation, aggregate/partition sequence,
source revision and optional scenario namespace across events, reactions, messages,
commands and outcomes.

A contradiction case is durable, owned and correctable. It points to the incompatible
assertions, their certainty/freshness, responsible owner, status, due/expiry time and
closing domain outcome. A signal alone is not a resolved fact.

A simulation run records scenario snapshot/version, virtual-clock range,
deterministic seed, copied configuration versions, supported/unsupported adapters,
assumptions, produced artifacts, metrics, uncertainty and comparison baseline.

## 6. Time model

Campus operation needs more than one timestamp.

| Time | Meaning |
| --- | --- |
| occurred at | when the source says an event happened |
| observed at | when a real-world condition was captured |
| effective at/from/until | when a plan, relationship, rule or decision applies |
| recorded/received at | when ThatCampus durably learned it |
| processed at | when a reaction/projection consumed it |
| due/expires at | when owned work requires response or stops being actionable |
| available at / deliver after | when a committed item becomes eligible to consume or deliver |
| scheduled for | the virtual or production runtime instant chosen by configuration |

Historical queries support both **valid time** and **recorded-as-of time**. A corrected
late observation can change what is known now about yesterday without pretending the
system knew it yesterday.

Half-open intervals `[from, until)` are the default for assignments, authority,
subscriptions and behaviour activation. Institution timezone is explicit; UTC is used
for stored instants. Local date/time recurrence retains timezone and daylight-saving
resolution policy.

Every ordered stream retains aggregate/domain revision, partition or aggregate
sequence and a stable journal position/checkpoint equivalent. Device observations
also retain source-clock quality, declared timezone and measured/estimated drift.
The integration journal does not imply that every domain is event-sourced; rebuilds
therefore use authorized domain snapshot anchors plus complete subsequent events.

## 7. Event and schema registry

Every event, observation, message and command protocol has:

- canonical name and owning module;
- semantic version/schema version;
- validated payload;
- privacy and retention class;
- allowed producers/consumers;
- backward/forward compatibility rule;
- deprecation/supersession plan;
- example fixtures and contract tests.

Unknown schemas are quarantined rather than interpreted dynamically. Consumers declare
supported versions and use explicit upcasters for replay. Breaking semantic changes
use a new event/protocol version.

## 8. Event-reactive execution

### 8.1 Happy path

```text
domain state + outbox event commit atomically
 -> model event is recorded idempotently
 -> active subscriptions are resolved at effective/recorded time
 -> eligible recipient/agent selectors are evaluated
 -> one reaction is scheduled per event/subscription/agent
 -> reaction creates typed message, observation request or domain command
 -> delivery/acknowledgement/response is recorded
 -> domain command rechecks authority + revision + invariants
 -> outcome and resulting event are correlated
 -> later reactions continue, close, escalate or await real-world evidence
```

### 8.2 Delivery and effects

- Delivery may be at least once.
- Material effects are exactly-once by deterministic idempotency key.
- Idempotency key reuse with changed payload is rejected.
- Ordering is guaranteed only where a protocol declares it, normally per aggregate or
  conversation.
- Out-of-order events remain stored and either reconcile or create explicit conflict.
- Each attempt has a lease; crashed leases expire and can be reclaimed.
- Retry uses configured bounded backoff and jitter.
- Expired or exhausted work follows configured escalation/dead-letter handling.
- Hop count, repeated causation and execution budgets prevent loops.

The scheduler uses durable leases, heartbeats and explicit `retry_scheduled`,
`dead_letter` and cancellation evidence. Dispatch is tenant-fair and applies bounded
fan-out/backpressure so one institution or broadcast cannot starve others.

### 8.3 No hidden fallback

If no active configuration matches, the runtime performs no inferred automation. It
records a coordination result such as `configuration_missing`. If a capability defines
an explicit human fallback, a minimal Task is routed to that configured owner. No
runtime code selects “all admins” or a guessed Principal.

### 8.4 Safe degraded operation

Where a domain contract permits it, safe manual/offline capture may commit to the
domain with a durable outbox marker `model_link_pending`. It cannot trigger
cross-domain automation until the core has correlated it. A core or projection outage
must not lose an accepted domain action, and recovery must not repeat its material
effect.

## 9. Operational mailbox and work ownership

The mailbox is durable coordination state for agents and teams. It supports:

- send and idempotent delivery;
- claim/assign/reassign;
- acknowledge without resolving;
- accept/reject/reply through typed protocols;
- response deadline and expiry;
- cancellation and supersession;
- escalation to configured owner;
- minimum-disclosure external rendering;
- read models for Requests/My work and domain attention;
- full correlation with domain source and outcome.

Mailbox state never replaces domain state. Requests/My work revalidates current
source status, authority and revision before showing a primary action.

Work may be owned by a team, but claim and response name the concrete agent. A
recipient can see a message without owning or having authority to execute it.
External-channel responses reauthenticate or use a narrowly scoped, expiring signed
protocol; channel possession alone grants no authority.

## 10. Command routing

### 10.1 Registration

Each command type registers:

- owning domain executor;
- target entity kinds;
- payload schema;
- required capability/purpose;
- autonomy ceiling;
- idempotency and revision policy;
- possible outcomes and safe UI explanations;
- correction/reversal contract;
- whether later physical observation is required.

### 10.2 Execution

The router validates the envelope, resolves current agent identity and authority,
checks active configuration/autonomy, then invokes the owning domain port. The domain
repeats its own authorization and invariants. State, audit, outbox event and core
command/outcome evidence commit atomically or through a durable idempotent bridge.

Command coordination states are `received`, `authorized`, `executing`, `accepted`,
`rejected`, `conflicted`, `review_required`, `expired`, `cancelled`, `failed` and
`uncertain`. An uncertain result blocks blind retry until reconciliation or retained
outcome lookup resolves it.

### 10.3 Retry and ambiguous results

The caller can query by command/idempotency key. A network retry returns the retained
outcome rather than repeating the domain mutation. A timed-out call remains pending
until the executor reports or reconciliation determines a safe terminal state.

## 11. Observation ingestion and reconciliation

### 11.1 Source registration

A device/integration must have stable identity, capability profile, institution/scope,
credentials, schema versions, status, health and effective authority before ingress.

### 11.2 Ingress

Ingress authenticates source, validates schema/scope/time/idempotency, records the
observation and routes it to the owning reconciliation domain. Unknown, suspended,
revoked, out-of-scope, duplicate-with-changed-payload or invalid evidence is rejected
or quarantined with safe diagnostics.

Ingress also enforces credential/attestation state, nonce or replay protection,
payload/evidence limits, source clock quality/skew and declared source health.

### 11.3 Reconciliation

The domain may accept, reject, quarantine or supersede evidence. The model updates its
observation state and projections from the domain decision. Contradictions become
owned work rather than silent last-write-wins.

## 12. Temporal plans and context

The core registers versions and dated occurrences from timetable, daily plan,
calendar, event, route, examination and assignment domains.

It supports:

- recurring plan publication and bounded occurrence expansion;
- exception, closure, substitution, cancellation and supersession events;
- source revision and event lineage;
- `resolveAt(entity/agent, effectiveInstant, recordedAsOf?)`;
- expected versus observed versus accepted versus derived assertions;
- contradiction evidence;
- rebuildable projections and deterministic replay.

A plan establishes expectation and may trigger configured work. It does not establish
physical presence or execution.

## 13. Projection and query model

Core projections exist for narrow operational questions:

- stable entity resolution;
- current/effective relationships;
- source-backed timeline;
- current temporal context;
- agent mailbox/work ownership;
- cross-domain contradiction signals;
- automation explanation;
- recent material activity;
- role-scoped Today inputs;
- simulation outcomes.

Assertions are typed as expected, directly observed, domain accepted, bounded
derived, contradicted or unknown. Query authorization includes tenant, acting agent,
purpose, scope and redaction—not only `school_id`.

Every projection returns freshness and provenance where it changes interpretation.
Sensitive domain details remain referenced rather than copied. A projection may be
rebuilt from retained authoritative events/configuration or explicitly backfilled with
import provenance.

The UI-facing Today/Requests APIs are owned by application/domain composition modules,
not by exposing core tables.

## 14. Behaviour configuration and Operating rules

### 14.1 Separation

- **Authority** answers whether an agent may act.
- **Behaviour configuration** answers which event may cause which agent reaction and
  permitted effect.
- **Operating rule** answers institution-specific timing, threshold, fallback and
  automatic choice.
- **Domain invariant** answers whether the requested transition is valid.

### 14.2 Activation

Validation checks schema, references, authority requirements, loop/budget risk,
privacy and non-weakenable floors. Rehearsal runs representative/synthetic events in a
scenario. Approval and activation are separate evidence-bearing commands. Equal-
priority conflicting active versions are rejected.

### 14.3 Templates

Capability packs may provide reviewed templates. Installation copies a visible draft
for the institution. A migration of an existing hard-coded behavior may create an
explicit visible configuration snapshot with provenance, but must not leave the
runtime with an undocumented fallback.

## 15. Authority and governance

### 15.1 Identity parity

Every real person acting in the product or approved channel maps to one stable human
agent linked to person and account/channel. Shared accounts are prohibited for
material actions. Team queues never hide the concrete responder.

### 15.2 Authority resolution

Resolution considers:

- active account/membership/source status;
- purpose-specific role, assignment or office;
- institution/campus/entity/workflow scope;
- effective dates and current revocation;
- delegation/exception provenance;
- consent/relationship where required;
- target state and emergency restrictions;
- maximum configured autonomy.

Authorization evidence is retained but never treated as permanently valid. Command
execution performs a fresh check.

Resolution keeps two questions explicit: **technical access** from active
account/membership/role/resource scope, and **institutional authority** from office,
mandate, reserved matter, resolution, delegation or consent. Passing one does not
imply the other. Recipient visibility and prior approval are not execution authority.

### 15.3 Autonomy

| Level | Permitted behaviour |
| --- | --- |
| A0 | observe/explain |
| A1 | recommend |
| A2 | prepare an expiring reversible draft |
| A3 | execute a bounded reversible routine action under active rule |
| A4 | request and record an authorized human decision |
| A5 | coordinate a human-only/physical step without deciding it |

The labels describe ceilings, not automatic permission.

## 16. Simulation and what-if analysis

The core must remain simulation-capable even before a full scenario engine ships.

### 16.1 Isolation

A scenario uses a separate namespace/tenant partition, virtual clock and synthetic or
sanitized snapshot. Scenario IDs are mandatory on all scenario artifacts. Production
connectors, recipients, commands, authority and notifications are unreachable.

Each run has a deterministic seed, explicit scope and retention deadline. Credentials
and endpoints are scenario-only; a code path that cannot prove scenario isolation
must refuse execution.

### 16.2 Reuse

Simulation reuses the same event schemas, behaviour versions, subscription matching,
reaction logic, message protocols, domain command fakes and projection functions.
Domain adapters provide deterministic scenario executors or explicit unsupported
outcomes.

### 16.3 Inputs

- selected production snapshot with privacy-safe transformation;
- synthetic campus fixture;
- alternate timetable/role/resource configuration;
- hypothetical observations or absences;
- different Operating-rule/behaviour versions;
- virtual date/time and event sequence.

### 16.4 Outputs

- reactions/messages/commands that would occur;
- resource, staffing and schedule conflicts;
- unresolved work, escalations and fallback counts;
- rule and authority explanations;
- service-level timing;
- assumptions, unsupported domains and uncertainty;
- comparison against baseline scenario.

Simulation predicts model outcomes under declared assumptions; it does not claim real
human behavior or physical certainty.

Required reference rehearsals include staff-cover response windows, timetable/room
reallocation, gate staffing/load, examination publication delay, transport disruption
and attendance-finalization rule change.

## 17. Domain adapter contract

Every connected domain provides:

1. stable entity kinds and canonical source IDs;
2. event schemas for meaningful accepted transitions;
3. observation schemas and reconciliation path where relevant;
4. command executors with authority/invariant/idempotency checks;
5. safe outcome codes and explanations;
6. correction/supersession semantics;
7. temporal relationships/occurrences where relevant;
8. restricted-data references and minimum projection fields;
9. replay/backfill/version-upgrade strategy;
10. contract, integration, security and failure tests.

It also declares domain-link/explanation resolution, snapshot/rebuild support,
simulation support level, readiness/health and compatible core contract version.
Unsupported capabilities are explicit; the core never infers domain meaning from
table names or arbitrary payload keys.

The adapter writes domain state first or atomically with its outbox/core evidence. It
never writes another domain's records to “keep the twin in sync.”

## 18. Domain coverage matrix

| Domain | Entities/context | Observations | Commands/outcomes | Agent coordination | Key boundary |
| --- | --- | --- | --- | --- | --- |
| people/enrollment | people, accounts, guardians, enrollments, assignments | assisted identity/source evidence | enroll, move, withdraw, invite, grant/revoke | invitations, reviews, lifecycle tasks | no merge from name/phone alone |
| campus/resources | campuses, spaces, gates, resources, placements | device/resource health | create/place/retire | setup/readiness tasks | not facilities/asset accounting ERP |
| timetable/calendar | terms, schedules, periods, occurrences, closures | actual delivery evidence only if captured | publish, substitute, cancel, correct | cover and conflict resolution | plan is not presence |
| attendance/presence | registers, sessions, roster context | staff/QR/device/paper/camera evidence | submit, accept, correct, finalize | due work, review, follow-up | one context does not prove another |
| learning/exams | subjects, work, assessments, exams, result registers | submission/mark evidence | schedule, enter, moderate, publish | examiner/moderator tasks | submission is not publication |
| requests/communication | request sources, conversations, audiences | delivery/open/response evidence | request/respond/cancel/publish | typed mailbox/rendering | delivery is not acknowledgement |
| events | event, session, participant, duty, option | check-in/attendance/payment evidence | create, RSVP, consent, record, close | guardian/staff work | event context is not class context |
| gate/departure/transport | gates, plans, routes, trips, rosters | movement, boarding, vehicle location | approve plan, start/close trip, reconcile | duty offers and exceptions | no inferred learner location/handover |
| finance | obligations, orders, payments, allocations, receipts | provider/family payment claims | verify, allocate, reverse, reconcile | finance review tasks | callback is not ledger reconciliation |
| restricted care | case reference and responsible handler | restricted evidence references | assign, review, close | minimum-disclosure tasks | no generic projection of sensitive content |
| assistant/channels | authorized conversation context | user messages/tool results | permission-scoped domain tools | rendering/response adapter | AI is neither core nor authority |

## 19. Worked model traces

### 19.1 Staff leave to effective cover

```text
Teacher human agent
 -> SubmitLeave command
 -> Staff domain validates balance/overlap and writes leave request
 -> staff.leave.submitted event
 -> configured Principal-decision subscription
 -> Principal/team reaction + typed Request message
 -> Principal human agent sends ApproveLeave command
 -> Staff domain rechecks authority/revision/balance and accepts
 -> staff.leave.approved + staff.coverage.opened events
 -> configured cover-routing reactions + Offers
 -> replacement accepts through RespondCoverage command
 -> Staff/timetable domains validate conflicts and record substitution
 -> timetable.substitution_effective event supersedes expected occurrence
 -> Updates and explanation projections
 -> later attendance/observation establishes actual delivery evidence
```

No step duplicates leave, coverage or timetable state in the core. Missing behaviour
configuration routes only to its explicit human fallback.

### 19.2 Attendance with device evidence

```text
published timetable occurrence -> expected register context
registered device -> attendance observation (pending)
attendance domain review/reconciliation -> accepted/rejected evidence
teacher submission command -> register revision/outcome
configured finalization reaction -> auto-finalize or human review request
accepted finalization event -> student/class projections + optional follow-up work
```

The device does not become the teacher and missing scans do not become absence.

### 19.3 Gate and timetable contradiction

```text
accepted gate exit observation
+ later expected class occurrence
+ optional accepted class attendance observation
 -> projection detects explicit contradiction pattern
 -> configured owner reaction creates Gate/Attendance Task
 -> owning domain review/correction
 -> resolved/corrected event closes work
```

The projection never claims continuous physical location.

### 19.4 Family payment claim

```text
family/provider observation -> payment claim evidence
configured finance-review Task -> finance agent
VerifyPayment command -> provider/ledger checks
finance domain accepts allocation/reconciliation or rejects/conflicts
receipt event -> family Update
```

Provider success cannot directly reduce the obligation.

### 19.5 Examination publication

```text
exam scheduled -> examiner Tasks at configured window
marks submitted -> domain completeness checks
moderation Request -> assigned moderator
moderator command -> accepted/returned outcome
publication decision -> results event
learner/guardian Updates
```

Reminder/escalation can be automated; publication authority remains explicit.

### 19.6 Departure handover

```text
approved departure plan -> expected context
collector duty Offer -> accepted assignment
boarding/drop observations -> roster reconciliation
unresolved rider -> exception Task blocks closure
authorized human handover decision + observation -> accepted outcome
```

Software coordinates but does not manufacture collection authority or physical proof.

## 20. Security and privacy

- tenant identity participates in keys/foreign references where practical;
- service and database layers reject cross-tenant references;
- core tables are private; browser/authenticated database roles have no direct grant;
- software/model agents receive no database credentials;
- all payload schemas declare privacy/retention class;
- restricted domains expose only opaque/minimal references;
- mailbox delivery checks recipient purpose and minimum disclosure;
- external renderings omit sensitive detail and require authenticated deep link;
- secrets and biometric templates never enter generic event/message payloads;
- redaction/deletion preserve required non-sensitive audit skeleton where lawful;
- legal hold and retention operate by data category, not unlimited append-only storage;
- support access is time-bound, purpose-specific and audited.

## 21. Reliability and failure semantics

### 21.1 Core unavailable

Safe domain/manual/offline capture may continue where its domain contract permits.
Outbox events wait for delivery. UI shows delayed model-derived context without
claiming domain failure.

### 21.2 Projection failed

Accepted domain state remains valid. Projection health identifies lag/checkpoint and
supports idempotent replay or rebuild.

### 21.3 Reaction failed

The reaction retains attempts/error class, follows configured bounded retry and then
escalates/dead-letters. It never rewrites the triggering event.

### 21.4 Delivery failed

Message delivery state remains separate from acknowledgement/response. The configured
channel fallback or owner is used; no broadcast to unauthorized recipients.

### 21.5 Domain command conflicted

The outcome is `conflicted` with current revision/recovery hint. The reaction may ask a
human to review but cannot silently overwrite.

### 21.6 Configuration invalid/missing

No automation executes. A visible coordination/configuration exception goes to the
explicit fallback owner if defined.

## 22. Observability and explanation

Operational telemetry uses counts/latency/error classes and opaque identifiers where
possible. Logs avoid student/message payloads.

Required health views:

- event/outbox lag;
- schema quarantine;
- subscription match/rejection counts;
- reaction scheduled/running/retry/expired/dead-letter;
- mailbox delivery/response SLA;
- command latency/outcome/conflict;
- projection checkpoint/rebuild health;
- observation-source health and authority failures;
- scenario workload isolated from production.

Every user-visible automatic outcome is explainable from event, configuration,
authority, command and domain outcome references without exposing raw infrastructure.

An explanation includes what happened, why it matched, who or what acted, the
effective rule and behaviour versions, evidence freshness, current owner, resulting
domain state and the permitted correction or escalation route.

## 23. Versioning, migration and replay

- Core schema migrations are append-safe and checksummed.
- Activated behaviour/configuration is immutable; supersession creates a new version.
- Event/protocol versions use explicit compatibility and upcasters.
- Backfill records import provenance and never fabricates unknown history.
- Replay consumers are idempotent and can start from a checkpoint or bounded event
  range.
- Rebuild writes into a new projection version and swaps only after verification.
- Historical event correction appends a correction/supersession event.
- Destructive retention/redaction follows domain/legal authority and retains only the
  permitted lineage skeleton.
- Domain extraction/microservice boundaries may change transport, not contracts.

Replay is authorized, dry-runnable and bounded by event/trace/tenant/time range. It
tracks progress, cancellation, poison-event quarantine and schema upcasting. It MUST
NOT silently resend an external message, repeat a domain write, replace historical
configuration with today's version or erase an original outcome. Projection rebuild,
reaction replay, domain correction, command reversal and message cancellation are
separate operations.

## 24. Scale and deployment evolution

The modular-monolith implementation should support:

- transactional outbox/inbox within PostgreSQL;
- indexed tenant/event/aggregate/conversation access;
- `SKIP LOCKED` bounded reaction workers and leases;
- horizontal workers with idempotent effects;
- SSE/web push/channel adapters fed from committed records;
- partition/archive strategy only when measured volume requires it;
- optional broker transport later without changing event semantics;
- optional graph/search/vector projections later, never as the write authority.

Indexes and worker claims are tenant/state/due-time aware; high fan-out expands in
bounded batches; occurrence materialization has a bounded horizon; hot/cold retention
and projection snapshots are measured choices. Quotas and tenant-fair claiming apply
before service extraction. Recovery-point, recovery-time, backup/restore and
projection-rebuild drills are release evidence, not assumptions.

Extraction criteria include measured throughput, independent availability, data
residency or team ownership—not architectural fashion.

## 25. Test strategy

### 25.1 Contract tests

- every schema accepts/rejects canonical fixtures;
- incompatible versions quarantine;
- privacy/minimum disclosure fields are enforced;
- domain modules depend only on ports.

### 25.2 Transaction and idempotency tests

- domain state/outbox evidence commit together;
- replay creates one event/reaction/message/effect;
- same idempotency key with changed payload fails;
- ambiguous retry returns prior outcome;
- projection failure does not roll back domain truth.

### 25.3 Authority/security tests

- tenant isolation at service/database layers;
- revocation between message delivery and command execution is honored;
- subscription/configuration never grants authority;
- device cannot impersonate human;
- external channel cannot widen scope;
- restricted payload is not copied to generic tables/logs.

### 25.4 Time/replay tests

- late/out-of-order event handling;
- valid-time versus recorded-as-of query;
- recurrence/timezone/closure/substitution;
- deterministic replay and rebuild;
- in-flight reaction retains configuration snapshot.

### 25.5 Runtime tests

- lease recovery, bounded retry, expiry, cancellation and dead-letter;
- per-conversation ordering where declared;
- loop and execution-budget protection;
- fallback/manual route for missing configuration;
- model/connector/core degradation.

### 25.6 Simulation tests

- scenario cannot address production connector/recipient/command;
- virtual clock is deterministic;
- baseline and alternative configurations compare repeatably;
- unsupported domain action is explicit, not silently assumed.

### 25.7 End-to-end domain traces

At least one trace per connected domain proves actor/event/reaction/message/command/
outcome/projection lineage while the owning domain remains authoritative.

The conformance suite also includes property/model-based state-machine tests,
fault/uncertain-write injection, migration/backfill tests, privacy/redaction tests,
fan-out/fairness/load evidence and physical/manual degraded-operation drills where a
domain depends on real devices or people.

## 26. Current implementation status — 16 October 2026

Implemented locally on `codex/campus-digital-twin` before the coordination-runtime
slice:

- private stable entity/relationship/agent/authority/observation/command/outcome
  persistence from migration 102;
- observation spine and retained attendance evidence from migration 103;
- event-derived timetable/day-plan/closure temporal runtime from migration 104;
- accepted gate observation connection from migration 105;
- registered device/integration source lifecycle and scoped ingress authority;
- typed ports for registry/topology change, observations, source registration and
  temporal context;
- combined recent activity and bounded contradiction signals;
- domain-language Campus setup consumers;
- a local, bounded coordination-runtime foundation in migration 106: private
  behaviour versions, exact event subscriptions, idempotent reactions, operational
  messages, distinct message outcomes and visible coordination exceptions;
- a provider-neutral coordination port that verifies the source outbox event, fails
  closed without one effective approved configuration, resolves only explicit
  domain-facing agent references, rechecks current capability/scope, and records
  queued Request/Task/Offer/Update evidence or an unmatched exception atomically.

Not yet implemented at this checkpoint:

- the complete validate/rehearse/approve/schedule/activate behaviour lifecycle and
  administration API;
- safe filter language, general selectors, durable worker leases/heartbeats,
  retry/expiry/dead-letter execution and loop/fan-out budgets;
- mailbox query/claim/reassign/channel-delivery APIs and dated team membership;
- general authority resolution from roles/appointments;
- idempotent domain command router across workflows;
- staff leave/coverage model mediation;
- accepted cover as effective timetable substitution;
- role-specific Today composition from the shared model;
- automation explanation API;
- isolated scenario/simulation runtime;
- general replay/rebuild/support tooling;
- production connector credentials and provider health.

Known transitional mismatches that later slices MUST remove:

- current human agents are keyed by `user_id`, not yet by person-stable identity with
  dated account/channel endpoints;
- `recordAcceptedChange` records an already accepted topology result and is not the
  general pre-domain authority/command gateway;
- some operational-signal queries still join enrollment/student domain tables rather
  than consuming adapter-owned projections;
- relationship kinds are syntactically checked but not yet enforced through a
  reviewed relationship-type/cardinality catalogue;
- event ordering, privacy/rule fields, schema registry/upcasters and tenant-partitioned
  checkpoint semantics are incomplete;
- contradiction results are signals, not yet durable owned cases;
- current temporal `resolveAt` and accepted-observation naming require conformance
  review so historical/future context cannot be mislabeled as present domain truth.

This section is an inventory, not a production-readiness claim.

## 27. Delivery sequence

### MC-0 — Contracts and guards

- keep this blueprint, architecture and operating-experience documents linked;
- enforce module/table dependency tests;
- publish schema registry conventions and domain adapter checklist.

### MC-1 — Configured coordination spine

- behaviour versions, subscriptions, reactions and messages;
- idempotent accepted-domain event publication;
- authority-aware recipient resolution;
- reaction leases/retry/expiry/dead-letter;
- mailbox query/respond contract;
- no hidden defaults.

### MC-2 — Staff leave vertical trace

- teacher event to configured Principal request;
- human decision command to authoritative leave outcome;
- per-coverage-obligation events;
- configured offers/response/escalation;
- effective timetable substitution and explanation.

### MC-3 — Shared work/Today projections

- operational mailbox/domain source reconciliation;
- Requests/Task/Offer and Update separation;
- real descendant attention aggregation;
- role-specific Now/Next composition.

### MC-4 — Observation reconciliation breadth

- registered device endpoints, schema/health/quarantine;
- attendance, gate and transport adapters;
- contradiction cases and responsible-owner routing.

### MC-5 — Operating-rule lifecycle and rehearsal

- validate/rehearse/approve/schedule/activate/supersede;
- explanation/correction APIs;
- isolated scenario engine and baseline comparison.

### MC-6 — Domain expansion

- examinations/results;
- communication/notices/events;
- departure/transport;
- finance/reconciliation;
- restricted-care minimum projection;
- each with separate acceptance and security gates.

### MC-7 — Operational hardening

- replay/rebuild/support tools;
- retention/redaction/legal hold;
- scale/partition/worker drills;
- disaster recovery and degraded-operation validation;
- measured release evidence.

## 28. Acceptance gates

The Model Core is fit for broader domain adoption only when:

1. domain modules cannot directly access core persistence;
2. frontends contain no core persistence/graph contracts;
3. one stable identity maps to one authoritative domain record per tenant;
4. one human agent remains stable across authorized account/channel changes;
5. all accepted events are correlated to authoritative source revision and ordered
   checkpoint context;
6. duplicate/out-of-order delivery has deterministic safe behavior;
7. current authority is rechecked before consequential execution;
8. subscriptions/configuration never create authority;
9. every automatic effect names behavior/rule version and correction route;
10. missing configuration fails closed or uses an explicit human fallback;
11. operational messages preserve owner/delivery/ack/response distinctions;
12. command outcomes remain distinct from physical observations;
13. projections expose freshness/provenance and are rebuildable;
14. restricted data does not leak to generic events/messages/logs;
15. model/AI provider outage leaves safe domain operation available;
16. replay cannot redeliver/rewrite material effects without explicit authorization;
17. scenario runs cannot mutate or contact production;
18. UI validation proves domain language and the operating-experience contract;
19. release evidence distinguishes local, hosted, deployed and human-accepted state.

## 29. Explicit non-goals

- replacing domain databases with the Model Core;
- universal graph/EAV editing;
- arbitrary executable administrator scripts;
- hard-coded or self-adapting production agents;
- AI as authority or mandatory runtime;
- continuous campus surveillance;
- inferring human intent, consent, presence or physical outcome;
- one global state enum for all domains;
- storing sensitive domain payloads for convenience;
- using notification delivery as workflow truth;
- simulating human behavior as certain prediction;
- premature microservice, broker or graph-database extraction.

## 30. Working architecture test

The core succeeds when a developer and campus operator can both say:

> “The leave, timetable, attendance, gate and communication domains keep their own
> precise truth. The Model Core connects their identities, times, events and actors;
> routes configured work; records who decided what and why; exposes contradictions
> without inventing facts; and can replay or simulate the same contracts safely. The
> user still sees a simple campus workflow, not the machinery.”
