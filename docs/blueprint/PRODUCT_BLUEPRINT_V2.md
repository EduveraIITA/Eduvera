# ThatCampus product blueprint v2

Status: accepted living blueprint
Version: 2.0
Accepted: 16 October 2026
Supersedes: `School_Operations_Blueprint.pdf` v1.0 as the primary product and engineering authority

## 1. Product vision

ThatCampus is the living digital twin through which people understand and operate a campus.

It is not a traditional ERP that begins with a catalogue of modules and asks every institution to configure all of them. It models the real campus - its people, places, groups, resources, schedules, responsibilities, observations and decisions - and lets an institution activate only the capabilities it needs.

A single tutor and learner, a coaching centre, a college using gate entry, and a multi-branch school use the same conceptual foundation. Their screens, vocabulary, permissions, operating rules and enabled capabilities differ.

The product promise is:

> Create the part of your campus you need today. ThatCampus connects it to one trustworthy operating model and can grow with you from zero to the whole institution.

The public brand promise remains: **Not just any campus. That campus.**

## 2. Product constitution

### 2.1 Model the campus, do not mirror bureaucracy

The model begins with real campus concepts and relationships. A room, class, learner, teacher, session, route and request are created once and reused wherever relevant. The product must reduce duplicate entry instead of reproducing paper departments on-screen.

### 2.2 Start anywhere, connect naturally

An institution may begin with one bounded use case: class attendance, student performance, examinations, gate entry/exit, timetable, communication or another supported capability. It is not forced through unrelated configuration.

When another capability is activated, ThatCampus reuses existing identities and relationships and clearly asks for only the missing information. It never creates a silent parallel class, learner or staff list.

### 2.3 Backend intelligence, domain-specific experience

The backend uses a digital-twin and agent-based architecture. The frontend never exposes that machinery. Users see language and workflows native to their role and institution: Attendance, Exam, Class, Room, Staff, Transport, Request and Operating rules.

The model is the campus operating thread, not a reporting copy beside the product.
Every person who acts in ThatCampus or through an approved external channel is linked
to a stable digital human agent. Their intent enters the model as a typed command or
observation, is executed by the authoritative domain under current authority and
rules, returns as a correlated outcome, and may create owned work for the next human,
team, device or software agent. Domain screens remain simple and familiar; this
agent-to-agent coordination is backend architecture.

The coordination model is event-reactive. Accepted domain events match explicit,
effective-dated subscriptions and create durable reactions for eligible agents. Those
agents communicate through typed operational messages, contribute observations or
issue commands; domain outcomes may trigger the next reaction. Sender, recipient,
owner, delivery, acknowledgement, response, correlation, causation, authority,
Operating-rule version, expiry, escalation and correction remain connected. These
messages may be rendered as requests, tasks or external-channel prompts, but they are
not the AI chat transcript and they do not bypass domain authority.

### 2.4 Precise truth and visible uncertainty

Expected, observed, accepted and derived states are distinct. Missing data is not a negative fact. A gate scan is not classroom attendance. Message delivery is not acknowledgement. A completed task is not proof that a physical event occurred.

### 2.5 Authority is explicit and purpose-specific

Accounts, job titles and contact details do not grant universal authority. Capability, scope, dates, delegation, revocation and current context determine what an actor may do.

### 2.6 Automate burden, not judgment

Routine safe actions should happen automatically when an authorized administrator has activated a bounded Operating rule. The rule states timing, scope, fallback, explanation, audit and correction. Authority, consent, safeguarding outcomes, financial reconciliation and physical handover remain governed by explicit domain rules and human responsibility.

### 2.7 One product, composable capabilities

Capabilities share a core identity, context and event model, but each domain owns its semantics and state machine. ThatCampus is neither a bag of disconnected mini-apps nor a universal low-code platform.

### 2.8 Preserve human-scale operation

Manual, assisted, paper-backed and offline participation are valid paths. The platform supports real campus work; it does not require every learner or guardian to own a phone.

### 2.9 Keep the living development campus until market release cleanup

During product development, Cambridge International School (`cis`) is ThatCampus's
wholly synthetic reference campus. Its broad campus replica and configured simulated
human participants are retained in version control and may evolve as new capabilities
need realistic people, spaces, schedules, resources, rules and coordination to act
against. This reference campus is part of the development and sales-demonstration
strategy; it is not temporary scratch data and must not be silently removed from a
shared development branch.

Synthetic provenance remains explicit. Simulated actors are restricted to Cambridge,
use ordinary authenticated domain and Model Core paths, and cannot manufacture real
evidence or contact external parties. Hosted enablement requires an environment-
specific safety contract. When the owner explicitly requests **clean for real market
release**, release artifacts may exclude the actor harness and synthetic fixture while
the reusable Model Core, Campus View and isolated what-if runtime remain product
capabilities. Until that decision, preserve the full implementation and record any
runtime exclusion as an open deployment boundary rather than deleting its source.

### 2.10 One authoritative campus, transient Simulation forks

ThatCampus has one authoritative Live campus environment. An authorized user may
temporarily fork its digital-twin state into an isolated, expiring Simulation
environment:

- **Live** uses the real clock, real actor endpoints and authoritative domain APIs.
  Its events, observations, commands and outcomes can change campus operation.
- **Simulation** is a transient fork of a privacy-minimized point-in-time snapshot
  into a run-scoped
  namespace with a virtual clock, run-local actor counterparts, snapshot/fake domain
  executors and sink-only effects. It can never write, message or authenticate into
  Live.

Simulation is a product capability for every institution, not a second permanent
platform, onboarding mode or Cambridge-only feature. An administrator starts from the institution's
current digital-twin state; ThatCampus automatically copies the eligible topology,
actors, plans, effective rules and configuration required by registered scenario
adapters. The institution does not recreate its people or timetable. Missing modelled
behaviour remains visibly unsupported or unknown unless an approved, versioned
scenario policy supplies it; the core never invents a person's intent.

The selected execution context is application-wide. An authorized user operates the same
ThatCampus application, routes, navigation, modules and domain language in Live and
Simulation. A compact, persistent **Live** or **Simulation** marker at the top is the
only required visual distinction; Simulation also exposes its virtual date/time and a
clear switch back to Live without turning the product into a separate mini-app.

Today, timetable, attendance, Messages, Requests, Campus View, KPIs and every other
enabled module resolve through the same domain contracts against the environment held
by the server-authoritative user session. They must all read and write one selected
Live or run-scoped Simulation state and clock. The browser cannot select an
environment by supplying a date, route parameter or caller-controlled header. An
environment switch clears or partitions caches and realtime subscriptions before the
same screen is rendered from the new environment.

The fork expires or is explicitly discarded; neither its data nor its actions become
Live campus truth. A scenario result may later be used to prepare a reviewed Live
draft, but that is a new authorized Live command with fresh rule, authority, revision
and invariant checks—not a merge of environments.

During incremental development a domain with no scenario adapter fails closed and is
reported as an implementation gap; it must never fall back to Live data. That state is
not acceptable release parity. Production acceptance requires a snapshot, read,
command and projection adapter for every module enabled for that institution so the
whole familiar application remains operable in Simulation.

The Cambridge Campus Lab is the development actor harness attached to a real
transient Simulation fork. Activating it snapshots Cambridge Live into an isolated
run, binds the reviewing administrator and every synthetic actor counterpart to that
same server-authoritative namespace, and lets them exercise ordinary domain APIs
there. Stopping it halts the actors, returns the reviewing session to Live and
discards the fork. It never writes the Cambridge Live fixture. The actor harness is
development/demo configuration; the underlying two-world execution model remains a
product capability for every institution.

## 3. Who the product serves

### Institution shapes

- individual tutor or one-room learning group;
- school or preschool;
- coaching centre or test-preparation institute;
- college or training provider;
- multi-campus institution or education group.

Institution shape is configuration and capability context, not a forked product.

### People and operating roles

- institution administrator: creates and configures the digital campus, accounts, roles, integrations and Operating rules;
- principal/operations lead: owns daily operational outcomes and exceptions within assigned scope;
- teacher/instructor: operates assigned classes, sessions, attendance, learning and communication;
- office/reception operator: coordinates requests, records, arrivals, departures and assisted paths;
- examination/academic operator: prepares and runs assessments under configured governance;
- accounts operator: manages financial records under specific permissions;
- transport/gate/care operator: uses narrowly scoped operational views;
- guardian/learner: sees and acts only within explicit relationships and permissions;
- ThatCampus support/operator: time-bound, purpose-specific, audited access only.

One person may hold multiple effective-dated assignments. The interface opens in the chosen working context and does not silently merge authority.

## 4. The campus model

The model has five layers.

### 4.1 Campus world

Typed, authoritative domain records represent institutions, campuses, spaces, people, cohorts, resources, devices, schedules, sessions, activities and service contexts.

### 4.2 Observations

An observation records what an identified human, device or integration reported; where/when it was observed and received; the evidence/source; and its schema. It does not become accepted truth merely because it was captured digitally.

### 4.3 Accepted campus state

Domain services validate observations and commands against current authority, rules, revisions and invariants. Accepted decisions update authoritative domain records. User-facing projections are derived from those records.

### 4.4 Agents and authority

Humans, teams, registered devices, approved integrations and bounded software agents can propose or issue commands. Each acts through explicit capability and scope. “Agent” does not mean “AI”; deterministic software automation is preferred for routine operations.

Agents react to immutable campus events through explicit subscriptions. A human agent
reacts through the relevant campus workflow; a team owns a queue but a concrete actor
signs the response; a device or integration reacts only within its registered
capability; and a software agent acts only at its configured autonomy level. A
subscription makes an agent eligible to react—it never grants authority.

The core does not hard-code an agent's operating behaviour and no agent adapts its own
production behaviour. Goals, subscriptions, reactions, recipients, timing,
escalation, autonomy, permitted tools and optional model/context policy come from
validated, versioned, effective-dated institution configuration and Operating rules.
An agent may propose a change but cannot activate it; an authorized administrator must
review, rehearse and publish a new version. Code retains domain invariants and
non-weakenable safety/privacy floors. Missing configuration means no automation, not a
hidden default.

### 4.5 Commands and outcomes

Actions flow back into the campus as typed commands. An accepted command can create a task, message, schedule change, device instruction or other domain outcome. Delivery/readiness and physical execution remain distinct until later evidence closes the loop.

Every material hand-off is durable: initiator, intended recipient/owner, authority,
scope, plan/effective time, rule version, delivery, response, decision, execution
outcome, correction and provenance remain connected. This evidence depth must support
complex campus management even when ThatCampus deliberately avoids ERP-like setup
screens and terminology.

Granularity is purpose-bound. The model should capture enough event, relationship and
message detail to coordinate, govern, explain and later simulate campus operation, but
must not infer private human intent, present sparse observations as continuous
location, or collect/retain data merely because a digital twin can represent it.

The normative technical contract is [Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md).

### 4.6 Campus View and later spatial visualization

Campus View is a first-class, read-only administrator capability. Its mobile 2D
scene projects stable campuses and spaces together with explicitly separated
scheduled context, source-bearing observations, accepted records, unknown state and
contradictions. It is available directly from administrator navigation and remains
useful without any development simulator.

The initial scene may use a deterministic schematic generated from configured spaces
and must say that it is schematic and not to scale. Surveyed geometry, floor plans,
coordinates, sensor placement and rendering metadata belong in a separate versioned
visualization projection keyed to model identities. A future richer 2D/3D interface
uses the same contract; neither the current nor future view is a second source of
truth or may imply continuous knowledge of a person's location from schedules or
sparse observations.

The read-only operational measurement contract for this surface is [Campus View
operational KPIs](CAMPUS_VIEW_OPERATIONAL_KPIS.md). It keeps expected, observed,
accepted and unknown evidence separate; forbids inferred occupancy and opaque
health scores; and defines bounded live and one-year historical views that link
back to the owning domain action.

## 5. Model-core separation

The detailed implementation contract is [ThatCampus Model Core
blueprint](THATCAMPUS_MODEL_CORE_BLUEPRINT.md). It defines the core capabilities,
primitives, domain-adapter boundary, configured reaction runtime, simulation contract,
failure semantics and acceptance gates. Its domain-neutral realm, environment-qualified
identity, semantic-catalogue and extension rules are defined by the accepted [universal
institution model](UNIVERSAL_INSTITUTION_MODEL.md).

The bounded operational specialization for transient baseline-versus-alternative
planning and future KPI ranges is [Campus scenario simulation](CAMPUS_SCENARIO_SIMULATION.md).

The Campus Model Core is a separate backend module with versioned ports, APIs and events. It owns cross-domain identity, temporal relationships, normalized observation/command envelopes, agent authority evidence, coordination hand-offs and projections. It mediates the operational thread between agents and domains; it is not an after-the-fact analytics mirror.

It does not own attendance decisions, timetable validity, finance allocation, examination rules, communication consent, safeguarding outcomes or user interface composition.

Rules:

- frontend features call their domain APIs, never the model-core database;
- domain modules keep authoritative tables and invariants;
- model-core persistence is private to its module;
- accepted domain events update connected projections idempotently;
- model providers use the same authorized application tools as any other channel;
- no generic graph/EAV editor becomes the product data model.

## 6. Capability activation: zero to n

### 6.1 No mandatory full-campus onboarding

Account creation produces an institution administrator context and a minimal institution identity. The user selects a first outcome, not an implementation checklist.

Examples:

- **Take class attendance:** create/import learners, one class, assigned teacher and attendance method.
- **Manage examinations:** create/import learners, academic grouping, subjects, examination cycle and responsible staff.
- **Track gate entry:** create/import people, gate, approved capture method and exception owner.
- **Run one teacher's class:** create teacher, learner group and schedule only as needed.

### 6.2 Shared prerequisite resolver

Each capability declares typed prerequisites. The resolver classifies them as:

- already available and reusable;
- required now;
- optional enhancement;
- conflicting/duplicate and needing review;
- unavailable because of authority or institution rules.

The UI asks for missing prerequisites inside the selected domain journey and shows why each is needed. It does not redirect to a generic setup maze.

### 6.3 Connected identity and duplicate prevention

Names and phone numbers never automatically merge people. Imports and module activation search stable institution-scoped identities and present reviewable match evidence. Duplicate candidates remain unresolved until an authorized person chooses to link or keep separate.

### 6.4 Capability packs

A capability pack contains:

- domain feature flag;
- prerequisite schema;
- default roles and permissions;
- eligible Operating rule types;
- required states/fallbacks;
- navigation contributions;
- data/export contract;
- activation and deactivation checks;
- acceptance scenarios.

Packs compose around the shared campus model. They do not create separate tenants or duplicate person/class stores.

## 7. Institution setup as a digital-campus builder

Setup should feel like bringing the institution into focus.

The administrator can configure:

1. institution identity, locale, timezone and terminology;
2. campuses/branches and virtual contexts;
3. buildings, floors, rooms, gates, labs and bounded resources;
4. people, accounts, roles, assignments and teams;
5. academic/program structure, classes/cohorts, subjects and terms;
6. schedules, services, devices and integrations;
7. enabled capabilities and Operating rules.

Readiness is computed per enabled capability. An empty resource catalogue does not block attendance. A one-teacher institution is not “20% complete” because it has no branches or transport.

The setup experience uses a connected campus overview, progressive disclosure and contextual completion. It must not become a dashboard of arbitrary percentage scores or a collection of unrelated forms.

Detailed topology decisions live in [Institution and campus replica model](INSTITUTION_CAMPUS_REPLICA.md); that document is a domain projection of this blueprint, not the product architecture itself.

## 8. User experience architecture

The normative interaction and workflow contract is [ThatCampus operating
experience](THATCAMPUS_OPERATING_EXPERIENCE.md). It translates the hidden model and
agent runtime into role-specific campus language, attention, automation explanations,
domain workspaces and acceptance scenarios.

### 8.1 Stable, role-specific navigation

Daily navigation is built from current capability and permission manifests. It remains stable for a working context. An event can create a badge or action but must not unpredictably reorder the navigation.

### 8.2 Domain-native screens

Each screen answers:

- what is this;
- what is its current, truthful state;
- what requires this user's attention;
- what is the one primary next action;
- why did an automatic action happen;
- where can it be corrected or escalated.

### 8.3 Apple-inspired interaction principles

- one clear heading and hierarchy;
- direct manipulation where appropriate;
- progressive disclosure instead of simultaneous decisions;
- restrained motion with purpose and reduced-motion support;
- generous space, readable type and consistent touch targets;
- familiar controls and predictable back behavior;
- no decorative counts, fake urgency or unexplained badges;
- no overflow, clipped controls or desktop forms compressed onto mobile.

### 8.4 Connected but not generic

Cross-domain context appears inside the task that needs it. A class page may show today's room and attendance state; it does not expose a graph browser. A learner profile may show current enrollment, attendance and exam context; it does not become an unbounded super-record.

### 8.5 State completeness

Every operational flow defines loading, empty, unavailable, unauthorized, draft, pending sync, submitted, accepted, corrected, disputed, failed, archived and offline behavior where applicable.

## 9. Operating rules and bounded autonomy

Operating rules are institution-owned, versioned instructions for routine platform behavior. They are not school policy documents, and they are not configured separately on every record.

Rules cover supported choices such as timing, capture window, automatic finalization, reminder/escalation, fallback, retry and assignment. Each rule exposes affected scope and examples before activation.

Autonomy levels:

- observe and explain;
- recommend;
- prepare a reversible action;
- execute a routine reversible action under an active rule;
- request an authorized human decision;
- coordinate but never decide a human-only/physical outcome.

Every automatic action retains trigger, rule/version, actor, target, result, explanation and override/correction route.

## 10. Core domains

### 10.1 People, enrollment and authority

Owns local identity, contact endpoints, relationships, enrollment, staff assignment, role/capability grants and lifecycle history. Students can exist without software accounts. Admin and Principal are distinct assignments.

### 10.2 Campus topology and resources

Owns campuses, spaces, operational resources and dated placements. It is not a facilities-management or asset-accounting suite.

### 10.3 Calendar, timetable and daily plan

Owns terms, closures, schedules, sessions, events, dated changes, rooms and responsible staff. View and edit occur in one coherent time-based experience; duplicated Calendar/Planner/Timetable concepts are avoided.

### 10.4 Attendance and presence

Supports institution-configured modes: scheduled subject/session attendance, daily class attendance, campus entry/exit presence or combinations with clear semantics. Capture can be staff, QR, registered device, reviewed camera assistance, office or paper. No method silently proves another context.

### 10.5 Learning, assessment and examinations

Owns subjects, learning work, assessment definitions, exam cycles, marks/results, grading configuration, moderation/publication and learner/guardian views. Institutions may activate this without other operational modules.

### 10.6 Requests, communication and action inbox

Owns domain requests, delivery, acknowledgement, responses, assigned work and closure. The action inbox surfaces real unresolved work; menu indicators are derived from actionable items, not dummy or historical counts.

### 10.7 Gate, departure and transport

Owns distinct arrival, departure, trip and handover contexts. Device evidence, readiness, authority and execution remain separate.

### 10.8 Finance

Owns obligations, line items, payment, allocation, receipt, reversal/refund and reconciliation. Payment-provider success is not ledger reconciliation.

### 10.9 Restricted care and safeguarding

Owns narrowly scoped cases, responsible handlers and outcomes. Public/cross-domain projections contain only minimal neutral references.

### 10.10 Assistant and channels

ThatCampus AI is one authorized interface to domain APIs, not the model core or system authority. Web, Telegram and future providers share the same conversation/tool contracts and recheck current scope for every turn.

## 11. Data and engineering architecture

- TypeScript/NestJS modular monolith initially;
- PostgreSQL authoritative relational data;
- transactional outbox and idempotent consumers;
- explicit module ports and forbidden-dependency tests;
- tenant and authority checks at API and database boundaries;
- realtime as an update channel, not a state store;
- workers for asynchronous delivery, projection and scheduled rules;
- object storage for controlled files/evidence;
- connector adapters with declared authority, schema, health and retry;
- AI provider abstraction with no unrestricted data/tool access.

Use typed relational tables for important identity, time, state, money and authority. JSON is reserved for validated, versioned payloads and bounded metadata.

## 12. Security, privacy and trust

- least privilege and purpose-specific access;
- no cross-tenant identity merging or relationship;
- source/freshness visible for operational evidence;
- data minimization by domain and projection;
- current revocation checked before consequential execution;
- immutable ordinary audit with lawful retention/redaction workflows;
- manual/offline fallbacks with visible pending/conflict state;
- no required biometrics or student phone for core participation;
- no AI-generated factual or authority record;
- public demo isolated from production tenants, credentials and external side effects.

## 13. Product intelligence

AI and deterministic software agents use permission-scoped domain tools. They may retrieve, summarize, explain, draft and perform specifically classified routine actions. Consequential writes use deterministic review/authorization contracts.

The platform must remain usable when the model provider is unavailable. Model responses are not audit evidence; app-generated command receipts are.

## 14. Delivery strategy

Transformation occurs in vertical slices that preserve the current working app.

### Foundation 1 - Model boundary

Create the separate model-core contracts/module, dependency guards, canonical entity/relationship spine and event projection without changing visible behavior.

### Foundation 2 - Campus topology

Connect campuses, spaces, resources and dated staff/class placement through domain APIs and a usable institution-setup experience.

### Foundation 3 - People and authority

Complete person/enrollment lifecycle, explicit admin versus Principal assignment, account invitations, scoped roles and authority projections.

### Connected operation 1 - Timetable to attendance

Make schedule/session/room/teacher relationships drive the correct attendance mode and actionable state while preserving corrections, offline capture and operating rules.

### Connected operation 2 - Requests and communications

Connect leave, substitutions, notices, follow-ups and real menu attention indicators through actual unresolved work.

### Connected operation 3 - Gate/transport/departure

Implement observations, authority, readiness, contradictions and human-owned physical outcomes behind a separate acceptance gate.

### Breadth - Examination, learning and finance

Activate each domain on the shared model without making another domain a prerequisite unless the workflow truly depends on it.

### Scale - Integrations and multi-campus

Add validated connectors, capability profiles, group-level context and operational scale only after tenant, recovery and domain acceptance evidence.

## 15. Release and evidence rules

A feature is not complete because its screen renders. Required evidence is proportional to risk and includes:

- schema/invariant/concurrency tests;
- permission and tenant-isolation tests;
- domain API and event contract tests;
- focused UI interaction/accessibility/responsive tests;
- failure, stale, duplicate, offline and correction paths;
- preview health and user validation for substantial UI work;
- hosted build/deployment evidence where a release is claimed;
- real workflow acceptance for physical or institutional claims.

Test suites should avoid repeated expensive mounts while retaining distinct observable behavior, as recorded in the implementation plan.

## 16. Product measures

Measure whether the twin reduces operational burden and improves closure, not how many modules are enabled.

Primary measures:

- time from account creation to first real completed workflow;
- repeated data entry avoided through reused campus identities;
- staff interactions per completed workflow;
- actionable exceptions resolved within their operating window;
- automatic actions completed without correction, grouped by rule/version;
- unresolved contradictions and time to responsible ownership;
- user-reported clarity and confidence;
- capability activation and expansion without duplicate data;
- tenant isolation, recovery and audit correctness.

Avoid vanity totals, fake unread numbers and inferred completion.

## 17. Non-goals

- forcing a complete institution setup before first use;
- copying a generic ERP menu/module structure;
- exposing the twin as a graph editor;
- supporting arbitrary administrator code or workflows;
- treating AI as a school administrator;
- manufacturing observations or resolving unknown state;
- replacing every specialist system immediately;
- continuous child surveillance;
- making UI redesign a prerequisite for backend transformation.
- requiring a 2D/3D campus renderer before the operational model is useful.

## 18. Blueprint governance

This Markdown file is the living product blueprint and is version controlled with the implementation. Material product decisions update this file or a linked normative companion in the same change.

`School_Operations_Blueprint.pdf` v1.0 is historical provenance. It is not the default authority. A v1 constraint remains binding only where v2 or a linked current domain contract explicitly retains it.

The current delivery state, verification evidence and unresolved acceptance gates live in [Implementation plan](IMPLEMENTATION_PLAN.md). Proposed target architecture must never be reported as implemented until that plan records verified evidence.
