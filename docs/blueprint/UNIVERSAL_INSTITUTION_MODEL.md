# ThatCampus universal institution model

Status: accepted target architecture and implementation contract, version 1.0, 17 October 2026

Normative parent: [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md)

Kernel contract: [ThatCampus Model Core blueprint](THATCAMPUS_MODEL_CORE_BLUEPRINT.md)

Architecture boundary: [Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md)

This is an accepted normative companion, not an implementation-completeness claim.
Delivery evidence and remaining gates belong in [the implementation
plan](IMPLEMENTATION_PLAN.md).

## 1. Purpose

ThatCampus must represent a one-room coaching centre, a school, a college, a university,
a distributed training provider or a multi-institution network without changing its
coordination kernel for each kind of institution.

The model is therefore **abstraction-first and domain-extensible**:

- the kernel provides stable identity, scope, time, agents, authority, plan/occurrence
  references, evidence, coordination and execution semantics;
- reviewed type catalogues give those primitives meaning;
- domain adapters connect authoritative operational records to the kernel;
- realm configuration activates only the capabilities and terminology in use;
- frontend projections use domain language and never expose graph or kernel vocabulary.

“Complete” does not mean putting every education noun into a universal table. It means a
routine new bounded domain can participate in identity, authority, evidence, coordination,
replay and Simulation through reviewed contracts **without a workflow-specific kernel
branch or column**. A genuinely new cross-domain invariant may evolve the kernel only
through an explicit versioned architecture migration.

## 2. Layering and ownership

```text
Domain-native UI and APIs
          |
Institution capability configuration and terminology
          |
Versioned domain adapters and semantic type catalogues
          |
Universal Model Core: identity, time, agency, authority, evidence, coordination
          |
Authoritative domain stores + execution-environment data plane
```

The layers have strict ownership:

1. **Domain services own business truth and invariants.** Attendance decides whether a
   register is valid; Timetable decides whether a schedule conflicts; Finance decides
   whether a payment reconciles.
2. **The Model Core owns coordination semantics.** It identifies participants, preserves
   causation, resolves configured reactions, routes typed work and records outcomes.
3. **The catalogue owns shared meaning, not records.** It defines allowed kinds,
   relationships, envelopes and compatibility rules.
4. **Projections are rebuildable views.** They never become a second source of truth.

The kernel MUST NOT contain an `Exam`, `Class`, `Principal`, `Invoice`, `SchoolDay` or
similar domain-specific branch. Those meanings are registered by adapters.

### 2.1 Normative ownership matrix

| Concern | Owner | Core representation |
| --- | --- | --- |
| isolation realm and execution namespace | control plane | non-configurable kernel identity |
| business record and invariant | owning domain | stable reference and revision only |
| entity/relationship meaning | reviewed adapter catalogue | immutable activated definition |
| coordination protocol | Model Core | typed event/message/command/outcome record |
| user-facing state | owning domain/projection | rebuildable, authorized projection |
| Simulation copy | isolated data plane | run-local address plus Live snapshot lineage |

## 3. Kernel realm and domain profiles

### 3.1 Operational realm

The kernel security boundary is the domain-neutral **OperationalRealm**. It bounds
isolation, access-membership resolution, authority evaluation, audit partitioning and
execution-environment selection. People/Governance domains own affiliations, appointments,
delegations and grant sources; the Core evaluates them and records receipts.
Realm identity is a control-plane primitive, not an ordinary catalogue type and cannot be
redefined by an adapter or realm custom field.

The education profile normally maps one Institution to one OperationalRealm. That is the
current product default, not a universal identity equation. A residency/governance split may
map one institution to several realms; a separately governed shared-service realm may serve
several institutions through exchange. Such changes are explicit migrations and never imply
cross-institution authority or shared operational records. The model distinguishes:

- `OperationalRealm`: kernel isolation and execution boundary;
- `RealmAccessMembership`: technical eligibility/account binding only; it never proves a
  learner, worker, guardian or institutional role;
- `Institution`: education-domain operating identity;
- `LegalParty`: externally recognized person or organization with contractual/statutory
  responsibility;
- `DataResponsibilityAssignment`: purpose-, jurisdiction- and effective-date-specific
  controller/processor/custodian mapping;
- `OrganizationGroup`: brand, ownership or coordination structure with no implicit access.

An institution, legal party and data controller may coincide, but the kernel never assumes
they do. Current `school_id` remains the compatibility representation of an institution
realm until a separately migrated realm contract is delivered.

### 3.2 Organizational hierarchy

```text
Organization group (optional domain structure)
  +-- Institution A -> Operational realm A
  |     +-- Organizational units (recursive)
  |     +-- Campuses/sites (recursive)
  |            +-- Buildings/floors/spaces/zones/access points
  +-- Institution B -> Operational realm B

Federation agreements connect realms only for an explicit approved purpose and period.
```

- **Institution** is the education-domain operating identity and normally owns one realm.
- **Organization group** coordinates independently governed institutions but does not
  silently merge their people, data, agents or authority. A metadata-only group performs
  no operational action. Shared services or aggregate outputs require a separately
  governed group realm containing only approved minimized records.
- **Organizational unit** is a recursive, typed administrative structure such as a
  faculty, department, division, office or house.
- **Campus/site** is a recursive physical or virtual operating location within one
  institution.
- **Space, zone and access point** provide progressively finer topology when a capability
  needs it. They are optional for a minimal institution.
- **Federation agreement** is a multi-party, effective-dated exchange protocol between
  realms, not an ordinary model relationship. Every party supplies a local approval
  receipt; no realm can unilaterally grant itself access to another.

A coaching chain owned and governed as one entity may be one institution with several
sites. Independently governed colleges or franchisees are separate institutions/realms
even if they share an organization group and brand.

### 3.3 Cross-realm exchange

An `ExchangeAgreementEnvelope` is a non-operational control-plane record containing a
neutral protocol ID and immutable proposed participant/purpose terms. It becomes usable only
when every participant has a separately signed, realm-local `ExchangeAcceptance` pinned to
those terms. Each export, receipt, copy and effect belongs to exactly one realm.

The correlated exchange terms declare participants, purpose, permitted schema/field set,
direction, read/copy semantics, minimization, lawful basis or consent where applicable,
residency/transfer constraints, retention, correction ownership, revocation, outstanding
copy handling, audit and breach responsibility. Every exchange still passes the exporting
and receiving domains' policy and authority checks.

An optional `FederatedSubjectLink` uses approved pseudonymous realm-local references. It
supports transfer, shared delivery or credential verification without merging people,
agents or authoritative business records. Exchange normally moves signed evidence or
minimized projections; it never creates a generic cross-realm write path.

## 4. Universal addresses, references and relationships

The core stores a reference to an authoritative record, never a duplicate business
record. Operational identity is environment-qualified:

```text
ModelAddress {
  realm_id
  environment_namespace_id
  model_id
}

DomainSourceRef {
  owning_domain
  domain_record_id
  source_revision
}

EntityRef {
  address
  source_ref
  type_definition_ref
  registration_state
  provenance
}
```

`registration_state` is narrowly core-owned (`active`, `unresolved`, `retired` or
`superseded`); business lifecycle remains in the domain. Any cached display hint is
purpose-redacted, locale-bound, privacy-classified and non-authoritative. Sensitive
attributes, business state and mutable labels remain in the owning domain. References are
stable inside one environment across account/presentation changes and are never reused.

A Simulation copy receives a run-local `ModelAddress` and immutable
`source_snapshot_lineage_ref`; it never reuses a Live address as writable identity.

### 4.1 Temporal relationship instance

An accepted relationship instance contains:

```text
TemporalRelationship {
  realm_id + environment_namespace_id + relationship_id
  relationship_definition_ref + definition_version
  source_address + target_address
  owning_domain + source_record + source_revision + source_event
  valid_interval + recorded_interval
  bounded_validated_qualifiers
  registration_state
  provenance
  correction_or_supersession_ref
}
```

Definitions declare direction, inverse, source/target types, context-scoped cardinality,
overlap and closure rules, hierarchy/cycle constraints, transitivity policy and whether
parallel hierarchies are allowed. Cardinality is evaluated for effective time and
recorded-as-of time. Containment, affiliation, service coverage, physical containment,
resource availability and reporting are distinct relationship semantics. A relationship
never confers authority by itself.

Ordinary temporal relationships are single-realm. Federation uses the separate exchange
protocol in section 3.3.

## 5. Separate versioned registries

The model deliberately separates four registries:

1. **Semantic type catalogue:** referencable domain entity and relationship kinds.
2. **Protocol/schema registry:** events, observations, assertions, messages, commands and
   outcomes.
3. **Capability manifest registry:** composition, dependencies and compatibility.
4. **Terminology registry:** realm-specific labels/taxonomy only; it cannot redefine
   isolation, protocols or semantic meaning.

An entity type definition declares its owning domain, privacy class, permitted scopes,
lifecycle semantics and compatible adapter versions. A relationship definition declares
source and target types, direction, inverse meaning, cardinality, overlap rules, temporal
semantics, lineage requirements and privacy limits.

Definitions use a canonical namespace/key, semantic version, owner/approver, content hash
or signed release identity, compatible core/adapter versions, dependencies, privacy and
retention defaults, activation interval and allowed producers/consumers. Lifecycle is:

```text
draft -> validated -> approved -> active -> deprecated -> retired
```

Approved versions are immutable. Replacement requires compatibility, upcaster/downcaster,
migration, activation, rollback and replay rules. Each realm pins the version it activates.
Free-form names or unvalidated JSON do not enter the operating model; realm terminology
does not create a new semantic type.

The platform architecture authority is the trust root for kernel security, protocol and
cross-realm exchange namespaces. Reviewed domain maintainers may approve only their
delegated namespace under platform compatibility policy. Jurisdiction packages require
named legal/privacy review. A realm administrator may activate approved versions but cannot
self-approve definitions; an adapter publisher cannot approve its own security meaning.

### 5.1 Illustrative adapter-provided semantic families

The following are reusable catalogue profiles, not hard-coded kernel enums:

| Family | Illustrative registered types |
| --- | --- |
| organization | group, institution, organizational unit, office |
| topology | campus, site, building, floor, space, zone, access point |
| people | person, affiliation, appointment, role assignment, team, external party |
| learning | program, qualification, learning unit, offering, cohort, section, enrollment |
| time and plan | calendar, term, plan, recurrence, occurrence, duty, reservation |
| resources | resource type, resource, device, vehicle, route |
| coordination | request, case, task, offer |
| evidence | evidence item |

A domain can introduce another reviewed type without altering kernel code. It cannot use
that extensibility to bypass realm isolation, authority, privacy or evidence rules.
Core protocol records—including messages, observations, assertions, commands, outcomes and
contradiction cases—remain protocol schemas, not ordinary domain entity types. A
People-domain Team entity may link to a Model Core TeamAgent; the two are not interchangeable.

## 6. Parties, people, affiliations and agents

A real person is distinct from their account, affiliation, appointment and agent:

- `Person` is a stable realm-local identity resolved by the People domain.
- `Affiliation` is a dated participation/lifecycle record such as learner, worker,
  contractor, visitor, alumnus or candidate; several may coexist.
- `Appointment` or `RoleAssignment` provides a purpose-specific responsibility and
  scope; titles alone never grant authority.
- `Agent` is an actor in the coordination protocol: human, team, device, integration or
  bounded software agent.
- `AgentEndpoint` is a revocable channel through which that agent acts or receives work.

One authentication subject may link to separate realm-local people/agents. Selecting a
realm never merges them, and matching email, phone or external credential is only evidence
for an authorized linking review. A HumanAgent is created only when the person can act or
receive protocol work; passive people need not be agents.

External organizations and people—vendors, regulators, employers, placement sites,
awarding bodies, transport providers and visiting professionals—use domain-owned
`ExternalPartyRef` and `ExternalOperatingContextRef` records. Effective-dated service,
affiliation, resource-use and exchange agreements connect them without making them tenants,
campuses or authority-bearing agents by implication.

Family, care, representation, sponsorship and delegated handover use typed purpose-specific
party relationships with interval, jurisdiction, source evidence, restrictions, disclosure
scope, consent basis and revocation. A guardian/family relationship does not automatically
grant application access, disclosure permission, consent power or collection authority.

Teams own queues; a concrete human still signs accountable decisions.

## 7. Authority model

Authority is explicit, purpose-specific, effective-dated and evaluated at command time.
An `AuthorityDecisionReceipt` is an evaluated decision—not a permanent grant—derived from
domain-owned sources such as:

- permission assignment;
- appointment or office;
- delegation;
- team responsibility;
- bounded emergency mandate;
- integration or device capability grant.

A scope selector may identify an institution, organizational subtree, campus, entity,
occurrence, workflow or bounded collection. Relationship proximity never grants
authority. Exchange agreements authorize bounded exchange only, never remote command
authority. A remote request enters the target realm as a typed exchange message; only a
target-realm agent/domain may execute it under target-local authority. A group administrator
is not automatically an institution administrator.

Material execution evaluates distinct layers rather than collapsing them into “allowed”:

1. authenticated agent and active endpoint/channel;
2. technical access/permission;
3. institutional mandate, delegation and represented-principal chain;
4. privacy purpose, minimum disclosure, legal basis/consent and restricted compartment;
5. configured behaviour/autonomy permission;
6. owning-domain invariant and current target revision.

`PolicyDecisionReceipt` retains the privacy/disclosure/residency decision separately from
authority. Receipts retain evaluator/source versions, decision instant, constraints and
expiry so an outcome remains explainable. Every material action records acting agent,
`on_behalf_of` principal where relevant, delegation chain, team/queue context, accountable
owner, endpoint/channel and environment.

## 8. Universal time and planning model

The model distinguishes:

- effective/valid time: when a fact or rule applies;
- recorded time: when the system committed it;
- observed and received time: when physical evidence occurred and arrived;
- scheduled and actual time: planned versus evidenced execution;
- resolved time: when a conflict or case was closed.

Intervals are half-open. The model distinguishes a civil date, local wall time, instant,
deadline, all-day interval, floating local time and open availability window. An interpreted
time retains source scope, IANA zone, timezone-rule version, precision/uncertainty, UTC
instant and DST gap/fold resolution. Scope precedence is explicit and effective-dated;
historical recurrence is never reinterpreted using a later timezone. Participant-local
display does not alter occurrence identity. Working days, holidays, shifts, day parts and
closure rules are realm/domain configuration; the kernel contains no Sunday, 9-to-5, noon
or academic-year assumption.

Planning domains own plan validity, recurrence interpretation, constraints, publication,
reservation and conflict decisions. The core registers immutable plan-version and
occurrence references as temporal context through a neutral envelope:

```text
Domain PlanVersion -> domain recurrence/exception expansion -> stable OccurrenceRef
                                                        |-> participation expectation
                                                        |-> resource expectation
                                                        |-> source plan/version/context
```

Published plan versions are immutable and have draft/published/superseded/cancelled
lifecycle. Materialization has a bounded horizon; exception/override precedence,
substitutions, closures, resource moves and stable occurrence identity are explicit.
Occurrences may be interval, instant, deadline, open-window or all-day forms. Async activity
does not pretend to be a classroom interval, and virtual spaces are service/resource
references rather than fabricated physical locations.

## 9. Evidence and state

The digital twin never equates a plan, command or inference with physical truth.

- **Event** records an immutable accepted digital occurrence.
- **Observation** records what an identified source reported, including source,
  observed/received time, quality and evidence references.
- **Assertion** is a typed claim with provenance, certainty and validity interval.
- **ContradictionCase** retains incompatible assertions until an authorized domain path
  resolves or supersedes them.

Claims do not use one mutually exclusive “status.” An assertion carries independent axes:

```text
Assertion {
  claim_basis: planned | directly_observed | domain_decision | derived
  reconciliation: pending | accepted | rejected | superseded
  consistency: uncontested | contradicted | unresolved
  certainty + freshness
  valid_interval + recorded_as_of
  provenance[]
}
```

Multiple assertions may coexist. Absence of sufficient evidence is represented by
`knowledge_state: insufficient`, not another claim basis. “Teacher scheduled in Room 201”
is planned; “device credential read at Gate A” is directly observed; neither silently
proves the other.

Projection responses separate `knowledge_state: known | insufficient | conflicting` from
`disclosure_state: disclosed | redacted | withheld | unauthorized`. A caller must not infer
campus uncertainty merely because a valid claim was withheld from that caller.

Observations also retain source trust profile, device/calibration revision where relevant,
clock quality, precision, offline/late-arrival state and evidence-integrity references.

## 10. Behaviour-neutral agent coordination

There are three universal ingress paths:

```text
authenticated agent intent
 -> Core command intake + current identity/authority/policy/context evaluation
 -> owning domain validation/execution
 -> correlated outcome/event
registered source report -> observation -> domain reconciliation/event
accepted domain event
 -> effective subscription
 -> eligible recipient resolution + disclosure policy
 -> durable typed message/work item
 -> agent reaction (message, observation or command)
 -> current authority/policy/revision check + owning domain execution
 -> correlated outcome + domain event
 -> next configured reaction or human correction
```

The kernel implements deterministic mechanics only. Every subscription, filter,
recipient selector, reaction mapping, delay, retry, expiry, escalation, autonomy bound,
tool permission and human fallback comes from a validated, versioned, effective-dated
Behaviour Configuration. Missing or invalid configuration fails closed; no domain gets
a hidden default workflow.

Visibility to receive a message is distinct from authority to execute a resulting command.
Delivery, acknowledgement, acceptance, command success and physical completion are
separate protocol states. Correlation, causation, idempotency, retry limits, expiry,
loop limits, correction and audit evidence are mandatory.

## 11. Domain adapter contract

Every domain adapter declares:

1. authoritative domains and required domain versions;
2. registered entity and relationship definitions;
3. event, observation, message, command and outcome schemas;
4. identity resolution and source-revision rules;
5. authority-requirement schemas, reviewed source-resolver ports and policy/privacy
   classifications;
6. command executors and invariant failures;
7. correction, replay and projection rebuild paths;
8. live side effects and their Simulation substitutes;
9. snapshot/copy-on-write requirements;
10. readiness prerequisites and unsupported states;
11. compatibility with catalogue, kernel and other adapters.

Adapters call domain APIs. They do not write domain tables, import kernel persistence
into frontend code or create workflow-local event buses and automation runtimes.
Only reviewed Governance/Core evaluators issue decision receipts; adapters cannot install
arbitrary authorization logic, weaken platform floors or replace the owning domain's
execution-time recheck.

Adapter lifecycle is `registered -> validated -> rehearsed -> active -> degraded ->
suspended -> superseded -> retired`. Activation atomically pins core, catalogue, protocol
and domain versions and passes health/readiness gates. Contracts define parallel-version
support, backfill, safe rollback, disable/uninstall behavior, retained data ownership and
dependency failure. A degraded/suspended adapter is visible and fails through its declared
safe behavior; the runtime never silently substitutes generic handling.

## 12. Realm configuration and capability composition

A **capability manifest** composes one or more adapters with prerequisites, dependency and
conflict ranges, navigation, terminology, configuration templates, readiness evaluation,
privacy needs and acceptance scenarios. One adapter may support several capabilities and
one capability may require several adapters.

A realm may remain in auditable setup-only state before selecting a capability. Institution
is the normal education-facing profile, but a separately governed shared-service realm need
not fabricate one. A capability declares the minimum connected structure it needs. Examples:

- gate entry may require people, affiliations and access points but no classes;
- class attendance may require a cohort, occurrence and roster but no finance;
- examinations may require candidates, occurrences and optionally spaces/invigilators;
- resource booking may require spaces/resources without student enrollment.

Readiness is computed per capability and scope. Adding a capability reuses stable
references and proposes reviewable matches; it never creates a parallel person, class,
space or schedule catalogue.

Lifecycle includes draft install, activate, upgrade, disable, reactivate and retire.
Disabling never deletes domain history or abandons owned work: the system reports dependent
capabilities, unresolved work, retained records, export obligations and projection cleanup.
Bootstrap uses an audited, expiring setup grant, first-governance source, handover and
recovery evidence—never an implicit permanent super-administrator.

Signed versioned `ConfigurationPackage`s may distribute templates across a franchise or
network, but each receiving realm reviews and activates them under local authority. An
upgrade cannot silently overwrite local policy or give the publisher operational access.

## 13. Locale, jurisdiction and terminology

Effective-dated settings may exist at realm, institution, campus/site and occurrence scope
with declared precedence and conflict behavior. They include country/jurisdiction packs,
locale, languages, currency, timezone, week rules, date/number/calendar display formats,
terminology and data-residency/privacy policy.
Jurisdiction packs may add stricter constraints but cannot weaken platform safety floors.

UI vocabulary is mapped from semantic concepts: a `learning_group` may display as
Class, Batch, Section or Tutorial Group. The semantic identifier remains stable while
the frontend stays natural for the institution.

## 14. Physical topology and resources

Topology is optional and progressively refinable. A site may begin as one space and later
add buildings, floors, zones, gates, capacity, accessible routes and layout versions.
Geometry is owned by the topology domain and referenced by the core. A map is a projection,
not the model database.

Resource profiles remain domain-owned and may declare typed capabilities, capacity units,
serialized versus fungible quantity, availability, condition and maintenance references.
Ownership, custody, location, permitted use, reservation and operation are separate
effective-dated relationships: one party may own a resource located at another site,
reserved by another scope and operated by another agent. No resource-specific column is
added to the kernel.

## 15. Execution environments and modes

The same application, domain APIs, adapters and contracts execute against one selected
environment:

- **Live** is authoritative and may use real people, devices, integrations and side effects.
- **Simulation** is an isolated, expiring fork of a Live snapshot. Counterpart actors may
  react under explicit scenario configuration, but cannot mutate Live or call production
  side effects.

User-selectable `EnvironmentKind` is `live | simulation`. Internal bounded
`ExecutionMode` is `normal | rehearsal | replay`: rehearsal uses an isolated namespace and
no production effects; replay is read-only/effect-free and rebuilds or verifies projections.
Neither becomes another writable user campus.

The valid construction matrix is closed and maps losslessly to the accepted Core modes:

| Universal context | Core mode |
| --- | --- |
| Live environment + normal | `live` |
| Simulation environment + normal | `simulation` |
| isolated scenario namespace + rehearsal | `rehearsal` |
| authorized source + read-only/effect-free replay sink | `replay` |

Every other combination is rejected at construction.

Environment is server-authoritative and applies to every read, write, cache, clock, event,
realtime stream and projection. Missing Simulation coverage fails closed; it never falls
back to Live. A run records source snapshot manifest, deterministic seed, virtual-clock
policy, catalogue/rule/adapter versions and complete effect-coverage attestation. A
cross-realm scenario requires separately authorized snapshots and a scenario-local exchange
contract from every participating realm.

Snapshots strip Live credentials, sessions, independently usable authority, connector
secrets and external-channel endpoints. Counterpart actors receive run-local identity and
the minimum snapshotted explanatory context only.

Simulated events, evidence, authority receipts and history are never imported as Live truth.
An authorized person may review a result and issue a **new Live command** that rechecks
current authority, revisions, rules and domain invariants.

## 16. Logical kernel records

The physical schema may evolve, but the kernel requires these logical records:

- type catalogues and immutable definition versions;
- entity references and temporal relationships;
- agents, endpoints and RealmAccessMembership bindings;
- authority and policy-decision receipts;
- events, observations, assertions and contradiction cases;
- behaviour versions, subscriptions and reaction executions;
- protocol messages/work items;
- commands and outcomes;
- projection checkpoints and replay cursors;
- capability manifests and adapter registrations;
- exchange agreement envelopes, realm-local signed acceptances and exchange projections;
- execution-environment/run bindings and effect coverage attestations.

This is not permission to build an entity-attribute-value store for business data.
Relational domain records remain typed and authoritative.

## 17. Privacy, retention and restructuring lifecycle

Every collected payload declares purpose, minimum fields, sensitivity/compartment,
retention class/deadline and legal basis where required. Legal hold, correction, export,
deletion/anonymization requests and their authority are explicit workflows. Immutability
applies to authorized lineage and accepted transitions subject to law; sensitive payloads
may be redacted or cryptographically erased while a minimum pseudonymized tombstone and
redaction evidence remain where lawful. Cleanup includes projections, caches, search/vector
indexes, replicas, exports, backups at expiry and Simulation snapshots/artifacts.

Realm closure, campus transfer, institution merger/split, franchise termination and group
reorganization are governed migration workflows, not ordinary relationship edits. They
retain historic addresses and provenance, define the destination/controller and retention
responsibility, and never rewrite signed events. Exchanged-copy deletion and correction
responsibility follows the active or terminating correlated exchange protocol.

## 18. Reliability, observability and recovery

The runtime uses transactional outbox/inbox, at-least-once delivery, idempotent effects,
partition/aggregate sequence, bounded leases, retry/backoff, expiry, dead-letter and poison
event quarantine. Fan-out/backpressure is bounded and realm-fair. Projections have durable
checkpoints, authorized rebuild and effect-suppressed replay. Domains declare safe behavior
when the Core or a projection is unavailable; authoritative domain work must not depend on
a stale read model pretending to be current.

Realm-safe observability covers schema quarantine, adapter compatibility, outbox lag,
reaction queues, projection freshness, evidence-source health, authority/policy failures,
privacy jobs, exchange transfers and Simulation isolation. Logs and metrics use opaque IDs
and do not copy person, message or evidence payloads. Disaster recovery is tested by restore
with realm/environment separation, provenance and checkpoint integrity preserved.

## 19. Non-weakenable invariants

1. Every realm-operational artifact, effect, cache entry and execution resolves exactly one
   realm and environment namespace. Platform definitions are explicitly platform-scoped,
   immutable and contain no institution business state.
2. Cross-realm exchange is denied unless correlated active local acceptances plus exporting
   and receiving authority/policy decisions permit the exact schema, fields and purpose.
   Exchange never grants direct remote command authority.
3. Domain records remain authoritative; projections are rebuildable.
4. Type, direction, cardinality, temporal overlap and source revision are validated.
5. Events and effects are idempotent and preserve correlation and causation.
6. Authority is rechecked at execution; message receipt does not confer authority.
7. A plan is not an observation, an observation is not automatically accepted truth, and
   command success is not physical completion.
8. Mutable behaviour is versioned configuration; agents cannot self-enable or rewrite it.
9. Privacy purpose, minimization, retention and correction paths apply to every adapter.
10. Simulation is isolated and cannot silently use Live stores, clocks, caches or effects.
11. No identifier, matching heuristic or inferred intent silently merges people or agents.
12. Every material automated action has an explanation, bounded fallback and human
    correction path.

## 20. Scenario conformance examples

| Fixture | Minimum proof |
| --- | --- |
| one-person coaching | operates without departments/buildings/formal year |
| K-12 | guardian/consent/handover remain purpose-specific and revocable |
| college/university | parallel academic/administrative/campus scopes do not leak authority |
| international/hybrid | scoped timezone/privacy/locale and async activity remain correct |
| vocational | external parties/sites exchange evidence without becoming campuses |
| franchise/network | configuration sharing never grants data or operational authority |
| multi-realm delivery | dual-approved exchange, pseudonymous linkage and revocation work |

### 20.1 One-room coaching centre

One realm/institution activates one tutor affiliation, one learning group, one offering and
recurring occurrences. A physical or virtual teaching site is optional. The same tutor may
hold teaching and administration assignments. Attendance works without campus topology,
departments or a formal academic year.

### 20.2 Indian K-12 school

The institution configures campuses, sections, subject offerings, period occurrences,
daily and/or subject attendance, staff duties, gates and local calendars. Principal and
class-teacher are domain roles and assignments, never kernel agent classes.

### 20.3 College or university

Recursive organizational units represent faculties and departments. Programs,
qualifications, course offerings, elective enrollments and shared resources coexist with
campuses. Attendance may be session-specific, entry/exit-only or disabled per offering.

### 20.4 International or hybrid institution

Each campus has its own timezone and calendar. Virtual sites and online spaces participate
in occurrences without fabricated physical presence. Jurisdiction packs constrain consent,
retention and residency without changing core coordination semantics.

### 20.5 Vocational or workplace training

External employers, placement sites, assessors and awarding bodies are ExternalParty/
OperatingContext references under effective agreements. Placement evidence is exchanged
through approved schemas; the employer is not fabricated as a campus or silently made a
tenant member.

### 20.6 Franchise network

Each franchisee remains a separate realm. Signed ConfigurationPackages provide templates;
local authority activates or diverges from them. The franchisor gains neither person access
nor operational authority from brand membership.

### 20.7 Multi-institution network

Independent institutions join an organization group. A purpose-limited activated exchange
protocol may allow minimized aggregate reporting or shared-resource offers. Person identity,
authority and detailed records remain realm-local; approved exchange does not merge them.

## 21. Conformance gates for a new domain

A domain is not core-compatible until it demonstrates:

- registration without a kernel schema/runtime branch;
- realm, environment, type, cardinality and temporal validation;
- current authority evaluation and recipient ownership;
- typed event -> message/command -> outcome lineage;
- idempotent duplicate and stale-revision handling;
- correction, contradiction and replay behavior;
- privacy, retention and audit evidence;
- explicit Live side effects and isolated Simulation behavior;
- domain-native UI with no core persistence or graph concepts.

Formal extension test:

> A routine new domain adds domain records plus a reviewed adapter/catalogue package. It
> adds no workflow-specific kernel branch or table column, environment bypass, generic
> payload interpretation or frontend access to core persistence.

The reusable certification suite includes realm/environment negative isolation, forbidden
exchange, parallel hierarchy/cycle, bitemporal cardinality, schema compatibility/upcasting,
late/out-of-order/duplicate delivery, stale-revision and revocation races, retry/dead-letter/
loop limits, direct-command and event-reaction traces, projection rebuild, replay effect
suppression, privacy/disclosure/retention/legal-hold behavior, capability activate/upgrade/
disable/rollback, Live/Simulation address non-aliasing, effect coverage, cache/realtime
isolation and disaster restore with provenance preserved.

## 22. Delivery implications and known gaps

The existing platform can evolve toward this contract incrementally, but this draft does
not assert that it already conforms. The next architecture work should:

1. introduce OperationalRealm while preserving the current Institution-to-realm and
   `school_id` compatibility mapping at API/storage boundaries;
2. add reviewed type/cardinality catalogues instead of proliferating free-form kinds;
3. define organization-group realms, organizational-unit, legal-party/data-responsibility
   and cross-realm agreement-envelope/local-acceptance contracts;
4. make capability manifests and adapter compatibility machine-verifiable;
5. complete people/affiliation/appointment/team plus generalized authority and policy
   receipts;
6. remove hard-coded locale, currency, weekday and clock assumptions from participating
   domains;
7. add contradiction-case, privacy-purpose, checkpoint and retention contracts;
8. complete environment-aware adapters and isolated data planes before claiming full-app
   Simulation parity.

Implementation should proceed through vertical domain slices, but each slice must use these
shared abstractions rather than adding a domain-specific parallel core.

The accepted Model Core and digital-twin contracts require a coordinated compatibility
migration wherever older text says institution/tenant but means security realm, federation
link but means exchange protocol, or unqualified reference but means ModelAddress. The
migration must be lossless and must not retroactively claim current storage or adapters
already implement this contract.

## 23. Explicit non-goals

- a universal ERP table or arbitrary property graph replacing domain databases;
- a workflow language that permits unreviewed code or scripts;
- hard-coded school roles, calendars, approval chains or automation defaults;
- inferred surveillance, emotion, intent or physical presence;
- cross-institution super-admin authority by organizational hierarchy alone;
- a separate Simulation product or Cambridge-specific production architecture.
