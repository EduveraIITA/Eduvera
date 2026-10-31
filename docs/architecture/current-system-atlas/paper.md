---
title: ThatCampus Current System Architecture Atlas
---

# ThatCampus current system architecture atlas

**Implementation snapshot · 18 October 2026 · local branch `codex/campus-digital-twin`**

This document explains the system that exists in the current working tree. It is a
descriptive map, not a replacement for the normative product and architecture
contracts. Where the code is transitional or a target remains incomplete, the diagram
and text say so explicitly.

> Read this atlas from the outside in: campus actors and user experience, application
> composition, backend/domain boundaries, Model Core coordination, data and runtime.
> A feature is not considered complete merely because a table or target contract exists.

## 1. Status legend and authority

- **IMPLEMENTED** — code and schema exist in this working tree and focused verification exists.
- **TRANSITIONAL** — usable implementation exists but retains a legacy role, transport or authority seam.
- **OPEN** — accepted architecture or release gate is not fully implemented or verified.
- **DOMAIN TRUTH** — the owning domain remains authoritative for the business record.
- **CORE THREAD** — the Model Core retains identity, authority, causation, coordination and projection evidence.

Authority order remains:

1. Current owner decisions.
2. [Product Blueprint v2](../../blueprint/PRODUCT_BLUEPRINT_V2.md).
3. Normative domain and architecture companions.
4. [Implementation Plan](../../blueprint/IMPLEMENTATION_PLAN.md).
5. Code, migrations and tests as implementation evidence.

## 2. One-page mental model

ThatCampus is a modular campus operating application built around a living digital
twin. People use domain-specific screens. The server composes those screens from their
current responsibilities and relationships. Domain modules own authoritative records.
The Campus Model Core connects actors, expected plans, observations, decisions,
messages, commands and outcomes into an explainable thread. The same domain application
can resolve against authoritative **Live** state or a separately isolated **Simulation**
fork.

<div class="concept-grid">
  <div class="concept-card"><strong>1 · Campus actors</strong><span>People, teams, devices, integrations and bounded software agents act.</span></div>
  <div class="concept-card"><strong>2 · App surfaces</strong><span>Today, Work, Areas and More express the campus in domain language.</span></div>
  <div class="concept-card"><strong>3 · Domain truth</strong><span>Owning modules validate and commit attendance, timetable, people, fees and other records.</span></div>
  <div class="concept-card"><strong>4 · Model Core</strong><span>Identity, time, authority, causation, coordination and projections form the digital thread.</span></div>
  <div class="concept-card"><strong>5 · PostgreSQL</strong><span>Domain state, Core journals, audit, outbox and snapshots persist relationally.</span></div>
  <div class="concept-card"><strong>6 · Live / Simulation</strong><span>The same contracts resolve against authoritative Live or an isolated Simulation fork.</span></div>
</div>

### The five truths to remember

1. A **person, room, class or invoice is not owned by the Core**; its domain owns it.
2. A **timetable creates expectation**, not proof that a person is physically present.
3. An **observation is evidence**, not accepted truth until its domain validates it.
4. A **role or title does not grant authority**; effective responsibility, relationship,
   mandate and scope do.
5. Simulation uses the same application contract but must never share mutable state or
   production side effects with Live.

<div class="page-break"></div>

## 3. System context — HLD

The browser application is the main user interface. Approved external channels and
registered devices enter through bounded APIs or connectors. They do not bypass domain
authorization. ThatCampus AI is another authorized interface to domain APIs, not the
system authority.

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"people","left":10,"top":40,"label":"PEOPLE"},
    {"name":"devices","left":10,"top":220,"label":"SOURCES"},
    {"name":"channels","left":10,"top":390,"label":"CHANNELS"},
    {"name":"web","left":300,"top":40,"label":"REACT APP"},
    {"name":"api","left":300,"top":245,"label":"API EDGE"},
    {"name":"app","left":600,"top":130,"label":"MODULAR\nAPPLICATION"},
    {"name":"pg","left":930,"top":130,"label":"POSTGRESQL"},
    {"name":"providers","left":930,"top":350,"label":"PROVIDERS"}
  ],
  "arrows":[
    {"name":"p_web","from":"people","to":"web","label":"HTTPS"},
    {"name":"d_api","from":"devices","to":"api","label":"observation ingress"},
    {"name":"c_api","from":"channels","to":"api","label":"approved adapter"},
    {"name":"web_api","from":"web","to":"api","label":"/api/v1 + SSE"},
    {"name":"api_app","from":"api","to":"app","label":"validated request"},
    {"name":"app_pg","from":"app","to":"pg","label":"Kysely transaction"},
    {"name":"app_provider","from":"app","to":"providers","label":"bounded connector"},
    {"name":"provider_api","from":"providers","to":"api","label":"callback / evidence"}
  ]
}
</div>

### Current technology

| Layer | Current implementation |
| --- | --- |
| Web | React 19, React Router 7, TanStack Query, Vite 8, TypeScript |
| Visual/interaction | FullCalendar, Konva/React-Konva, Leaflet, Lucide, QR libraries |
| API | NestJS 11 on Fastify 5, Zod validation, Swagger support |
| Persistence | PostgreSQL through Kysely; numbered SQL migrations |
| Realtime | Authorized server-sent events plus transactional outbox |
| AI | Provider adapters including Google GenAI/Vertex; tools call authorized domain APIs |
| Runtime | One modular monolith and one relational database in the current deployment model |
| Hosted evidence | Google Cloud Run application and PostgreSQL; Cloudflare is also used for local-device preview |

## 4. Physical runtime and deployment topology

The current architecture deliberately remains a modular monolith. Module boundaries,
ports, schemas, database constraints and tests provide separation; it is not a
microservice system.

<div class="topology-grid">
  <div class="topology-lane"><strong>Public website</strong><span>thatcampus.com</span><b>→</b><strong>Marketing service</strong></div>
  <div class="topology-lane"><strong>Application</strong><span>app.thatcampus.com</span><b>→</b><strong>Cloud Run app</strong><b>→</b><strong>Managed PostgreSQL</strong></div>
  <div class="topology-lane"><strong>Approved providers</strong><span>Identity, AI, email, payments and channels connect through bounded adapters.</span></div>
  <div class="topology-lane"><strong>Release path</strong><span>GitHub Actions builds an immutable revision, runs guarded migrations and smoke checks, then promotes traffic.</span></div>
  <div class="topology-lane"><strong>Local preview</strong><span>Local React/Nest/PostgreSQL plus Cambridge fixture; Cloudflare quick tunnel is preview only.</span></div>
</div>

<span class="status-transitional">TRANSITIONAL</span> The implementation plan contains
multiple historical deployment checkpoints. This diagram describes the current intended
shape, not proof that every uncommitted working-tree change is deployed. The architecture
atlas itself records no hosted acceptance.

<div class="page-break"></div>

## 5. User experience and frontend architecture

### 5.1 Responsibility-composed application

One account can carry several concurrent responsibilities. The server constructs one
workspace manifest from effective assignments, relationships, authority, time,
capability readiness and the selected environment. The frontend does not ask the user
to choose a Teacher, Principal, Parent, Gate or Admin portal.

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"session","left":10,"top":140,"label":"SESSION"},
    {"name":"sources","left":270,"top":25,"label":"CONTEXT\nINPUTS"},
    {"name":"manifest","left":270,"top":270,"label":"WORKSPACE\nMANIFEST"},
    {"name":"shell","left":615,"top":140,"label":"APP SHELL"},
    {"name":"today","left":930,"top":10,"label":"TODAY"},
    {"name":"work","left":930,"top":135,"label":"WORK"},
    {"name":"areas","left":930,"top":260,"label":"AREAS"},
    {"name":"more","left":930,"top":385,"label":"MORE"}
  ],
  "arrows":[
    {"name":"session_sources","from":"session","to":"sources"},
    {"name":"sources_manifest","from":"sources","to":"manifest"},
    {"name":"manifest_shell","from":"manifest","to":"shell"},
    {"name":"shell_today","from":"shell","to":"today"},
    {"name":"shell_work","from":"shell","to":"work"},
    {"name":"shell_areas","from":"shell","to":"areas"},
    {"name":"shell_more","from":"shell","to":"more"}
  ]
}
</div>

### 5.2 Frontend component view — LLD

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"app","left":20,"top":35,"label":"ROUTER"},
    {"name":"auth","left":20,"top":235,"label":"AUTH\nCONTEXT"},
    {"name":"queries","left":300,"top":35,"label":"QUERY\nCACHE"},
    {"name":"shell","left":300,"top":235,"label":"APP SHELL"},
    {"name":"boundary","left":605,"top":35,"label":"ROUTE\nBOUNDARY"},
    {"name":"domains","left":605,"top":235,"label":"DOMAIN\nWORKSPACES"},
    {"name":"legacy","left":930,"top":35,"label":"LEGACY\nREDIRECTS"},
    {"name":"ui","left":930,"top":235,"label":"SHARED UI"}
  ],
  "arrows":[
    {"name":"app_auth","from":"app","to":"auth"},
    {"name":"auth_query","from":"auth","to":"queries"},
    {"name":"app_boundary","from":"app","to":"boundary"},
    {"name":"query_boundary","from":"queries","to":"boundary"},
    {"name":"boundary_shell","from":"boundary","to":"shell"},
    {"name":"boundary_domains","from":"boundary","to":"domains"},
    {"name":"legacy_boundary","from":"legacy","to":"boundary"},
    {"name":"domains_ui","from":"domains","to":"ui"}
  ]
}
</div>

### 5.3 Canonical workspace catalogue

| Area | Primary composed surfaces |
| --- | --- |
| Attendance | assigned registers, coordination, self records, dependent records, leave |
| Timetable | responsibility schedule, self/dependent schedule, planning, positional edit, calendar/settings |
| Messages | conversations, Updates/notices, Diary/homework, moderation where authorized |
| People | records, import, assigned classes and rosters |
| Assessments | assigned work, management, self/dependent results, invigilation |
| Events | assigned/manage, relationship calendar/detail, consent, RSVP, register, preparation |
| Reports | remarks, grading, generation, review, publication, self/dependent progress |
| In & Out | gate operation, approvals and management |
| Departure | self/dependent plans, assigned journey operation, institutional coordination |
| Fees | institution ledger plus exact self/dependent accounts |
| Care | protected intake, assigned cases, review, team and external-report evidence |
| Insights | institution, assigned-work, self and dependent analytical surfaces |
| AI | persistent conversation and authorized hand-offs into domain records |

<span class="status-implemented">IMPLEMENTED</span> Canonical routes and manifest-based
surfaces exist for these areas. <span class="status-transitional">TRANSITIONAL</span>
Several underlying APIs still use membership roles or hidden legacy audience values as
transport compatibility; those are identified in section 20.

<div class="page-break"></div>

## 6. Backend modular architecture

The NestJS application imports feature modules into one process. Ordinary frontends call
domain controllers. Domain services own rules and relational state. They use narrow Model
Core ports when a material action requires identity, authority, correlation, event or
coordination evidence.

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"edge","left":15,"top":40,"label":"EDGE\nGUARDS"},
    {"name":"composition","left":315,"top":20,"label":"COMPOSITION"},
    {"name":"campus","left":315,"top":150,"label":"CAMPUS\nFOUNDATION"},
    {"name":"academic","left":315,"top":300,"label":"ACADEMICS"},
    {"name":"operations","left":315,"top":450,"label":"OPERATIONS"},
    {"name":"core","left":700,"top":170,"label":"MODEL CORE"},
    {"name":"data","left":1020,"top":170,"label":"POSTGRESQL"}
  ],
  "arrows":[
    {"name":"edge_comp","from":"edge","to":"composition"},
    {"name":"edge_found","from":"edge","to":"campus"},
    {"name":"edge_academic","from":"edge","to":"academic"},
    {"name":"edge_ops","from":"edge","to":"operations"},
    {"name":"comp_core","from":"composition","to":"core","label":"query/coordination ports"},
    {"name":"foundation_core","from":"campus","to":"core","label":"typed ports"},
    {"name":"academic_core","from":"academic","to":"core","label":"typed ports"},
    {"name":"ops_core","from":"operations","to":"core","label":"typed ports"},
    {"name":"foundation_data","from":"campus","to":"data"},
    {"name":"academic_data","from":"academic","to":"data"},
    {"name":"ops_data","from":"operations","to":"data"},
    {"name":"core_data","from":"core","to":"data"}
  ]
}
</div>

### 6.1 Module responsibility map

| Module family | Authoritative responsibility |
| --- | --- |
| Auth / Roles | sessions, CSRF, identity authentication, broad membership compatibility, permission guard |
| People / School | person, learner, guardian and institution records and relationships |
| Institution setup / activation | campuses, spaces, resources, academic readiness and progressive first-use setup |
| Organization / Governance | descriptive hierarchy, formal offices, mandates, policies and acknowledgement |
| Schedule planning / Day plans | timetable definitions, publication, exceptions and operational plan |
| Attendance model / Operations | register lifecycle, observations, submissions, revisions and reconciliation |
| Staff operations | staff profiles, leave, responsibilities, coverage and substitutions |
| Gate / Departure | entry/exit evidence, visitor approval, transport, collection authority and handover |
| Assessments / Reports | examinations, sittings, candidates, results, grading and publication |
| Chat / Notices / Channels | user conversations, updates, delivery, external-channel and calendar connections |
| Events / Fees / Care | activity participation, finance records and restricted safeguarding/care records |
| Workspace / Operating day | read models composing Today, Work, Areas and More from authoritative sources |
| Campus View / Analytics | read-only operational projections, geometry and KPIs |
| Campus scenarios / Campus Lab | isolated scenario execution and Cambridge synthetic development harness |

## 7. Domain/Core dependency boundary

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"ui","left":20,"top":145,"label":"DOMAIN UI"},
    {"name":"controller","left":280,"top":145,"label":"CONTROLLER"},
    {"name":"service","left":550,"top":145,"label":"DOMAIN\nSERVICE"},
    {"name":"port","left":830,"top":20,"label":"CORE PORTS"},
    {"name":"repository","left":830,"top":280,"label":"DOMAIN\nTABLES"},
    {"name":"forbidden","left":550,"top":390,"label":"NO BYPASS"}
  ],
  "arrows":[
    {"name":"ui_controller","from":"ui","to":"controller"},
    {"name":"controller_service","from":"controller","to":"service"},
    {"name":"service_port","from":"service","to":"port","label":"narrow interface"},
    {"name":"service_repo","from":"service","to":"repository","label":"transaction"},
    {"name":"port_service","from":"port","to":"service","label":"routed command/outcome"}
  ]
}
</div>

This separation is central: the Model Core coordinates but never decides whether an
attendance mark, payment, leave request, timetable, exam result or safeguarding action
is valid. The owning domain decides and returns a correlated outcome.

<div class="page-break"></div>

## 8. Campus Model Core — internal LLD

`CampusModelCoreModule` exposes one implementation through narrow dependency-injection
ports. Provisioning, recovery and retention use `ExecutionProvisioningService`. This is
an internal modular boundary, not a separately deployed service.

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"registry","left":10,"top":20,"label":"CONTRACTS"},
    {"name":"identity","left":10,"top":175,"label":"IDENTITY +\nAUTHORITY"},
    {"name":"time","left":10,"top":330,"label":"TIME\nCONTEXT"},
    {"name":"ingress","left":350,"top":20,"label":"INGRESS"},
    {"name":"runtime","left":350,"top":175,"label":"COORDINATION"},
    {"name":"mailbox","left":350,"top":330,"label":"WORK\nPROTOCOL"},
    {"name":"commands","left":690,"top":20,"label":"COMMAND\nGATEWAY"},
    {"name":"projection","left":690,"top":175,"label":"PROJECTION\nRECOVERY"},
    {"name":"scenario","left":690,"top":330,"label":"EXECUTION\nENVIRONMENTS"},
    {"name":"domains","left":1030,"top":175,"label":"DOMAIN\nADAPTERS"}
  ],
  "arrows":[
    {"name":"registry_ingress","from":"registry","to":"ingress"},
    {"name":"identity_runtime","from":"identity","to":"runtime"},
    {"name":"time_runtime","from":"time","to":"runtime"},
    {"name":"ingress_runtime","from":"ingress","to":"runtime"},
    {"name":"runtime_mail","from":"runtime","to":"mailbox"},
    {"name":"runtime_command","from":"runtime","to":"commands"},
    {"name":"commands_domains","from":"commands","to":"domains"},
    {"name":"domains_ingress","from":"domains","to":"ingress","label":"event/outcome"},
    {"name":"ingress_projection","from":"ingress","to":"projection"},
    {"name":"scenario_identity","from":"scenario","to":"identity"},
    {"name":"scenario_commands","from":"scenario","to":"commands"},
    {"name":"projection_time","from":"projection","to":"time"}
  ]
}
</div>

### 8.1 Exposed application ports

| Port | Purpose |
| --- | --- |
| `CAMPUS_MODEL_CORE_PORT` | stable entity/relationship integration boundary |
| `DOMAIN_COMMAND_GATEWAY_PORT` | prepare/replay and complete material domain commands |
| `DOMAIN_EVENT_JOURNAL_PORT` | record accepted typed domain events |
| `OBSERVATION_INGRESS_PORT` | accept source-rich evidence without treating it as domain truth |
| `OBSERVATION_SOURCE_REGISTRY_PORT` | register, scope, suspend and revoke device/integration sources |
| `HUMAN_AGENT_IDENTITY_PORT` | map acting people/accounts to stable human agents |
| `AUTHORITY_EVALUATION_PORT` | evaluate and explain current scoped authority |
| `COORDINATION_RUNTIME_PORT` | match subscriptions, create reactions and route work |
| `TEMPORAL_CONTEXT_PORT` | manage expected occurrences and time-aware context |
| `MODEL_CONTRACT_REGISTRY_PORT` | schema, semantic type and capability contract registry |
| `EXECUTION_SNAPSHOT_PORT` | snapshot eligible Live state for isolated execution |
| `EXECUTION_PROVISIONING_PORT` | provision execution namespaces and actors |
| `PROJECTION_CHECKPOINT_PORT` / `PROJECTION_RECOVERY_PORT` | checkpoint and repair rebuildable projections |
| `ENVIRONMENT_RETENTION_PORT` | expire/discard transient Simulation data |

### Current internal implementation note

<span class="status-transitional">TRANSITIONAL</span> Ports separate responsibilities,
but `CampusModelCoreService` currently implements many of them in one large service. The
target calls for cooperating registries/workers; extraction should follow operational need,
not premature microservices.

## 9. Material command lifecycle — sequence

A material action is prepared with actor, authority, environment, target revision,
configuration and idempotency evidence; the owning domain then decides.

<ol class="diagram-flow">
  <li><strong>Act</strong><span>Human, device or agent submits an action or evidence.</span></li>
  <li><strong>Validate</strong><span>API checks session, tenant, DTO and environment.</span></li>
  <li><strong>Prepare</strong><span>Gateway resolves actor, authority, revision and idempotency.</span></li>
  <li><strong>Commit</strong><span>Owning domain rechecks invariants and writes truth.</span></li>
  <li><strong>Record</strong><span>Outcome and accepted event retain causation.</span></li>
  <li><strong>React</strong><span>Effective configuration may create the next work.</span></li>
  <li><strong>Project</strong><span>Today, Work and operational projections update.</span></li>
  <li><strong>Explain</strong><span>The user sees the result and correction path.</span></li>
</ol>

Terminal command states include `accepted`, `rejected`, `conflicted`, `review_required`,
`failed`, `uncertain`, `cancelled` and `expired`. Delivery is not acknowledgement;
acknowledgement is not acceptance; command success is not physical-world evidence.

<span class="status-transitional">TRANSITIONAL</span> Attendance submission, selected
staff-leave decisions, progressive Attendance/Gate setup and Organization save use the
pre-domain gateway. Several other domains still use a legacy post-domain accepted-change
adapter and require convergence.

## 10. Event-reactive agent coordination — sequence

An agent is any identified actor able to receive work or act: human, team, registered
device, integration or bounded software process. It is not synonymous with AI.

<ol class="diagram-flow">
  <li><strong>Domain event</strong><span>An owning domain accepts a meaningful transition.</span></li>
  <li><strong>Subscription</strong><span>Effective configuration matches type, scope and date.</span></li>
  <li><strong>Reaction</strong><span>Rule and authority versions are snapshotted.</span></li>
  <li><strong>Work item</strong><span>A request, task, offer or update gets an owner.</span></li>
  <li><strong>Response</strong><span>The concrete actor emits a command, observation or message.</span></li>
  <li><strong>Domain outcome</strong><span>The owning module accepts, rejects or conflicts.</span></li>
  <li><strong>Trace</strong><span>Correlation joins delivery, acknowledgement and outcome.</span></li>
  <li><strong>Fallback</strong><span>Missing configuration or expiry returns to a human.</span></li>
</ol>

Mutable behaviour is never hidden in the runtime. Subscriptions, recipient selection,
timing, escalation, autonomy, tools and fallback must come from validated, versioned,
effective-dated configuration and Operating rules.

## 11. Observation and truth-resolution flow

<div class="flow-ribbon"><span>Registered source</span><b>→</b><span>Observation</span><b>→</b><span>Reviewable evidence</span><b>→</b><span>Domain review</span><b>→</b><span>Decision</span></div>
<div class="flow-note"><strong>Expected plan</strong> informs review and projection, but never proves physical reality. The resulting projection keeps expected, observed, accepted and inferred states distinct.</div>

Attendance has the first catalogue-certified observation adapter. Gate student, staff and
visitor movements are evidence-connected but still need complete catalogue/contract
certification.

## 12. Live and Simulation architecture

ThatCampus lives in one authoritative Live environment. An authorized user can fork an
eligible snapshot into a transient Simulation environment. Both use the same routes and
domain contracts, while stores, clocks, actors, cache keys and effects remain isolated.

<div class="worlds-grid">
  <div class="world-card live"><strong>LIVE</strong><span>Authoritative state, real clock, production agents and approved effects.</span></div>
  <div class="world-arrow">qualified snapshot →</div>
  <div class="world-card sim"><strong>SIMULATION</strong><span>Run-local state, virtual clock, actor counterparts and denied production effects.</span></div>
  <div class="world-card shared"><strong>SAME APPLICATION</strong><span>The selected environment changes every domain route, query key and realtime namespace.</span></div>
  <div class="world-card result"><strong>SCENARIO RESULT</strong><span>Forecasts and explanations expire or are discarded; nothing merges directly into Live.</span></div>
</div>

| Concern | Live | Simulation |
| --- | --- | --- |
| Starting state | current authoritative domain state | immutable qualified snapshot of Live |
| Clock | institution real time | virtual run-local clock |
| Actors | stable production agents/endpoints | run-local counterparts without credentials |
| Writes | authorized domain writes | copy-on-write scenario state only |
| Connectors | explicitly approved production adapters | sink-only or scenario adapters |
| Cache/realtime | Live namespace | run ID namespace |
| End state | retained operational history | expires/discards; cannot merge directly |

<span class="status-transitional">TRANSITIONAL</span> Session-selected environment,
separate routed data planes, effect denial, snapshot, actor binding and scenario primitives
exist. Complete all-domain parity, universal virtual-clock adoption and a production-grade
hosted Simulation provider remain open.

## 13. Aggregate what-if runtime versus whole-app Simulation

These are related but not the same implementation.

| Path | Purpose | User experience | Persistence |
| --- | --- | --- | --- |
| Whole-app Simulation | rehearse operating workflows from a snapshot | normal screens and APIs with a Simulation marker | isolated routed PostgreSQL data plane |
| Aggregate what-if | compare baseline and alternatives quickly | KPI/scenario report, not application parity | process-local transient result store |

The Cambridge Campus Lab uses the whole-app development path and synthetic actors. The
KPI planning panel uses the aggregate what-if runtime and explicitly reports that it does
not provide application parity.

<div class="page-break"></div>

## 14. Core persistence model — ERD/class view

This diagram shows the principal Core aggregates. It intentionally omits support indexes,
audit columns and several recovery tables so the lifecycle remains readable.

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"realm","left":10,"top":15,"label":"REALM"},
    {"name":"namespace","left":10,"top":170,"label":"NAMESPACE"},
    {"name":"entity","left":285,"top":15,"label":"ENTITY"},
    {"name":"relationship","left":285,"top":170,"label":"RELATIONSHIP"},
    {"name":"agent","left":285,"top":325,"label":"AGENT"},
    {"name":"authority","left":555,"top":325,"label":"AUTHORITY"},
    {"name":"event","left":555,"top":15,"label":"EVENT"},
    {"name":"observation","left":555,"top":170,"label":"OBSERVATION"},
    {"name":"behaviour","left":825,"top":15,"label":"BEHAVIOUR"},
    {"name":"reaction","left":825,"top":170,"label":"REACTION"},
    {"name":"message","left":825,"top":325,"label":"MESSAGE"},
    {"name":"command","left":1095,"top":15,"label":"COMMAND"},
    {"name":"snapshot","left":1095,"top":170,"label":"SNAPSHOT"},
    {"name":"projection","left":1095,"top":325,"label":"RECOVERY"}
  ],
  "arrows":[
    {"name":"realm_ns","from":"realm","to":"namespace"},
    {"name":"realm_entity","from":"realm","to":"entity"},
    {"name":"entity_rel","from":"entity","to":"relationship"},
    {"name":"entity_agent","from":"entity","to":"agent"},
    {"name":"agent_auth","from":"agent","to":"authority"},
    {"name":"entity_event","from":"entity","to":"event"},
    {"name":"entity_obs","from":"entity","to":"observation"},
    {"name":"event_reaction","from":"event","to":"reaction"},
    {"name":"behaviour_reaction","from":"behaviour","to":"reaction"},
    {"name":"reaction_message","from":"reaction","to":"message"},
    {"name":"reaction_command","from":"reaction","to":"command"},
    {"name":"authority_command","from":"authority","to":"command"},
    {"name":"namespace_snapshot","from":"namespace","to":"snapshot"},
    {"name":"snapshot_projection","from":"snapshot","to":"projection"},
    {"name":"event_projection","from":"event","to":"projection"}
  ]
}
</div>

### Core table groups

| Group | Current typed tables |
| --- | --- |
| Addressing/contracts | `operational_realms`, environment namespaces, semantic/protocol definitions, capability manifests, contract activations |
| Twin topology | entities and effective-dated relationships |
| Agency | agents, authorities, endpoints and endpoint transitions |
| Coordination | behaviour versions, subscriptions, reactions, exceptions, messages and message outcomes |
| Evidence | observations, events, schedule occurrences and authority receipts |
| Commands | commands and command outcomes |
| Execution isolation | snapshots, items, actor bindings, frozen grants, adapter expectations and contributions |
| Recovery/retention | checkpoints, restore contributions, recovery jobs, replay quarantine and retention jobs |

## 15. Campus foundation data model — ERD

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"school","left":20,"top":20,"label":"INSTITUTION"},
    {"name":"campus","left":300,"top":20,"label":"CAMPUS"},
    {"name":"space","left":580,"top":20,"label":"SPACE"},
    {"name":"resource","left":860,"top":20,"label":"RESOURCE"},
    {"name":"person","left":20,"top":220,"label":"PERSON"},
    {"name":"account","left":300,"top":220,"label":"ACCOUNT"},
    {"name":"student","left":580,"top":220,"label":"LEARNER /\nGUARDIAN"},
    {"name":"staff","left":860,"top":220,"label":"STAFF"},
    {"name":"term","left":20,"top":420,"label":"TERM"},
    {"name":"class","left":300,"top":420,"label":"CLASS"},
    {"name":"enrol","left":580,"top":420,"label":"ENROLMENT"},
    {"name":"placement","left":860,"top":420,"label":"PLACEMENT"}
  ],
  "arrows":[
    {"name":"school_campus","from":"school","to":"campus"},
    {"name":"campus_space","from":"campus","to":"space"},
    {"name":"space_resource","from":"space","to":"resource"},
    {"name":"school_person","from":"school","to":"person"},
    {"name":"person_account","from":"person","to":"account"},
    {"name":"person_student","from":"person","to":"student"},
    {"name":"person_staff","from":"person","to":"staff"},
    {"name":"school_term","from":"school","to":"term"},
    {"name":"school_class","from":"school","to":"class"},
    {"name":"student_enrol","from":"student","to":"enrol"},
    {"name":"class_enrol","from":"class","to":"enrol"},
    {"name":"term_enrol","from":"term","to":"enrol"},
    {"name":"class_place","from":"class","to":"placement"},
    {"name":"space_place","from":"space","to":"placement"},
    {"name":"staff_place","from":"staff","to":"placement"}
  ]
}
</div>

### Foundation invariant

Person identity, account access, employment/enrolment relationship, organizational title,
operational responsibility and Core agent identity are separate concepts. Joining them in
projections is useful; collapsing them into one role field would recreate the portal model.

## 16. Identity, responsibility and authority — class diagram

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"person","left":15,"top":25,"label":"PERSON"},
    {"name":"agent","left":270,"top":25,"label":"HUMAN\nAGENT"},
    {"name":"account","left":525,"top":25,"label":"ACCOUNT /\nENDPOINT"},
    {"name":"membership","left":15,"top":230,"label":"MEMBERSHIP"},
    {"name":"profile","left":270,"top":230,"label":"DOMAIN\nPROFILE"},
    {"name":"template","left":525,"top":230,"label":"ROLE\nTEMPLATE"},
    {"name":"assignment","left":780,"top":230,"label":"ASSIGNMENT"},
    {"name":"mandate","left":780,"top":25,"label":"MANDATE"},
    {"name":"receipt","left":1035,"top":125,"label":"AUTHORITY\nRECEIPT"},
    {"name":"action","left":1035,"top":350,"label":"DOMAIN\nACTION"}
  ],
  "arrows":[
    {"name":"person_agent","from":"person","to":"agent"},
    {"name":"agent_account","from":"agent","to":"account"},
    {"name":"person_member","from":"person","to":"membership"},
    {"name":"person_profile","from":"person","to":"profile"},
    {"name":"profile_assignment","from":"profile","to":"assignment"},
    {"name":"template_assignment","from":"template","to":"assignment"},
    {"name":"assignment_receipt","from":"assignment","to":"receipt"},
    {"name":"mandate_receipt","from":"mandate","to":"receipt"},
    {"name":"agent_receipt","from":"agent","to":"receipt"},
    {"name":"receipt_action","from":"receipt","to":"action"}
  ]
}
</div>

| Concept | Grants application authority? | Meaning |
| --- | --- | --- |
| Account | No, by itself | authentication endpoint |
| Membership | Only bounded compatibility/setup cases | relationship with an institution |
| Job title / organization node | No | descriptive structure and reporting |
| Responsibility assignment | Yes, within exact capability/scope/time | operational work authority |
| Guardian relationship | Yes, only within reviewed dependent authority | relationship/consent source |
| Governance appointment/mandate | Yes, for declared matters/scope/time | formal institutional authority |
| Authority receipt | Evidence, not new authority | evaluated explanation used by a command |

<div class="page-break"></div>

## 17. Timetable, attendance and physical evidence model

<div class="arrowgram">
{
  "version":1,
  "nodes":[
    {"name":"calendar","left":10,"top":20,"label":"CALENDAR\nDAY"},
    {"name":"slot","left":270,"top":20,"label":"TIMETABLE\nSLOT"},
    {"name":"occurrence","left":530,"top":20,"label":"SCHEDULE\nOCCURRENCE"},
    {"name":"expected","left":790,"top":20,"label":"EXPECTED"},
    {"name":"observation","left":270,"top":245,"label":"OBSERVATION"},
    {"name":"register","left":530,"top":245,"label":"REGISTER"},
    {"name":"record","left":790,"top":245,"label":"ATTENDANCE\nRECORD"},
    {"name":"case","left":1050,"top":245,"label":"FOLLOW-UP"},
    {"name":"projection","left":790,"top":445,"label":"CAMPUS\nPROJECTION"}
  ],
  "arrows":[
    {"name":"calendar_slot","from":"calendar","to":"slot"},
    {"name":"slot_occ","from":"slot","to":"occurrence"},
    {"name":"occ_expected","from":"occurrence","to":"expected"},
    {"name":"ob_register","from":"observation","to":"register"},
    {"name":"occ_register","from":"occurrence","to":"register"},
    {"name":"register_record","from":"register","to":"record"},
    {"name":"obs_case","from":"observation","to":"case"},
    {"name":"record_case","from":"record","to":"case"},
    {"name":"expected_projection","from":"expected","to":"projection"},
    {"name":"observation_projection","from":"observation","to":"projection"},
    {"name":"record_projection","from":"record","to":"projection"},
    {"name":"case_projection","from":"case","to":"projection"}
  ]
}
</div>

### Attendance submission example

1. A timetable occurrence establishes that Class 6A and its teacher are expected.
2. The responsible teacher opens the exact register from Today or Attendance.
3. Marks are captured as source-rich observations/submission input.
4. Attendance validates roster, date, authority, revision and idempotency.
5. The register and individual records commit with revision history.
6. A typed accepted event and command outcome enter the Core thread.
7. Today, Work, Campus View and family/self records update from accepted domain state.
8. Missing, conflicting or late evidence creates an owned exception; silence never becomes
   a fabricated absence.

## 18. Realtime event delivery

<div class="flow-ribbon"><span>Domain transaction</span><b>→</b><span>Durable outbox</span><b>→</b><span>Wake-up</span><b>→</b><span>Delivery cursor</span><b>→</b><span>SSE / Core bridge</span><b>→</b><span>Client cache</span></div>

The outbox is authoritative for delivery. `LISTEN/NOTIFY` reduces latency but may be lost
without losing the event; cursors/replay recover durable rows.

## 19. Major domain data families

The database contains roughly two hundred typed table interfaces. The useful way to
understand it is by authoritative aggregate, not as one giant ERP schema.

| Family | Principal records | Core contribution |
| --- | --- | --- |
| People & enrolment | people, students, guardians, memberships, enrolments | stable entity/agent and dated relationship references |
| Campus topology | campuses, spaces, resource types/holdings, placements | entity hierarchy and scope context |
| Timetable & calendar | terms, slots, calendar days, day plans, occurrences | expected operational state |
| Attendance | registers, submissions, records/revisions, observations, reconciliation | accepted participation and evidence trace |
| Staff | profiles, responsibilities, leave, balances, coverage, substitutions | effective authority, owned work and outcome events |
| Governance | policies, offices, bodies, appointments, mandates, matter rules | formal authority and rule-version evidence |
| Communication | conversations, participants, messages, attachments, reports, notices/recipients | coordination and delivery context, not consent by itself |
| Assessments | cycles, assessments, sittings, candidates, invigilators, results, evidence, publications | exam work, results and coordination events |
| Reports | schemes, bands, components, batches, student/subject records, audits | generated/reviewed/published outcomes |
| Events | activities, sessions, participants, consent, checklists, attendance, withdrawals | participation and consent/evidence events |
| Finance | invoices, payments, credits, refunds and review records | obligation/outcome evidence without replacing ledger states |
| Departure & transport | policies, authorities, routes, stops, trips, rosters, plans, handovers, swaps | movement context and handover evidence |
| Restricted care | cases, role assignments, case assignments, entries, external reports, audit | minimal restricted references and controlled outcomes |
| Auth & audit | sessions, environment selection, audit events, rate limits | authenticated actor/environment and system evidence |
| Model Core | realms, entities, agents, events, observations, commands, messages, snapshots, recovery | cross-domain digital thread and isolated execution |

<div class="page-break"></div>

## 20. Progressive activation flow

The product does not require a complete institution model before first use. It creates a
private connected workspace, asks what the user wants to operate first, then collects only
the minimum authoritative records for that job.

<ol class="diagram-flow activation-flow">
  <li><strong>Arrive</strong><span>Understand the product or explore the demo.</span></li>
  <li><strong>Private workspace</strong><span>Create and verify the current account.</span></li>
  <li><strong>Starting outcome</strong><span>Choose the first operation, not an organization type.</span></li>
  <li><strong>Connected campus</strong><span>See that every later capability joins the same model.</span></li>
  <li><strong>Minimum setup</strong><span>Add only the people, place, group, responsibility and plan needed now.</span></li>
  <li><strong>Operate</strong><span>Perform the first real domain action in the normal app.</span></li>
  <li><strong>Progress</strong><span>See Working now, Useful next and Available anytime.</span></li>
  <li><strong>Expand</strong><span>Reuse existing people, places, schedules and evidence—never restart.</span></li>
</ol>

<span class="status-implemented">IMPLEMENTED</span> Attendance and Gate have true guided
first-operation setup. Other starting goals currently use readiness checks and links into
their owning setup/workspace. <span class="status-transitional">TRANSITIONAL</span> The
current journey is account → email verification → purpose; pre-account private exploration
followed by save-later is not implemented.

## 21. Security, tenancy and privacy boundaries

<div class="flow-ribbon"><span>Request</span><b>→</b><span>Global guards</span><b>→</b><span>Execution context</span><b>→</b><span>Workspace discovery</span><b>→</b><span>Domain recheck</span><b>→</b><span>DB constraints</span></div>
<div class="flow-note"><strong>Two enclosing controls:</strong> privacy minimizes disclosure and retention; correction preserves history and supersession instead of silent overwrite.</div>

Implemented controls include signed HttpOnly sessions, CSRF validation, Google token
verification, password/MFA/recovery flows, public-demo write denial, tenant-qualified
services, session-selected execution environment, revisions, idempotency, audit/outbox,
restricted-care boundaries and Simulation effect denial.

<span class="status-transitional">TRANSITIONAL</span> Tenant isolation currently depends
substantially on guards, domain query scoping and composite constraints. RLS exists for
many tables but is not yet demonstrated as a complete per-tenant runtime boundary. Also,
the Stage payment sandbox fallback found in source configuration must be removed and its
credential rotated before release; this document deliberately does not reproduce it.

## 22. External integration map

| Integration | Current state | Boundary |
| --- | --- | --- |
| Calendar | revocable read-only ICS feed/export | no bidirectional provider write; legacy audience transport remains |
| Telegram | verified webhook, linking, durable inbox/retry provider adapter | Telegram only; every action still rechecks domain scope |
| WhatsApp | provider seam only | not implemented |
| Matrix | opt-in outgoing review bridge | not a complete chat replacement; inbound/E2EE/receipts remain open |
| Email | SMTP/Resend adapter | disabled without explicit provider configuration |
| Google sign-in | token, issuer, audience, expiry and nonce verification | hosted configuration/acceptance required |
| AI | local/provider abstractions and Vertex-capable tools | AI is not authority; material writes require domain confirmation |
| Payments | Razorpay sandbox path and webhook verification | production intentionally not enabled |
| Photo attendance | proposal sidecar | never authoritative; liveness/privacy/device validation open |
| Cloudflare | edge routing and local preview tunnel | not an auth, tenancy or data authority layer |

<div class="page-break"></div>

## 23. Current implementation state

### Implemented foundation

- Responsive React application with one responsibility-composed shell.
- Server-generated workspace manifest for Today, Work, Areas and More.
- Canonical responsibility/relationship workspaces for principal product domains.
- Progressive private workspace and first-operation Attendance/Gate setup.
- NestJS modular monolith with PostgreSQL authoritative domain records.
- Stable entities, relationships, human agents, authority receipts, typed events,
  observations, commands/outcomes, behaviours, subscriptions, reactions and messages.
- Session-selected Live/Simulation namespace, isolated routing and effect controls.
- Campus View, KPIs, scenario APIs and Cambridge synthetic Campus Lab retained for development.
- Broad domain records for attendance, timetable, people, gate, transport, assessments,
  reports, events, fees, communication, governance and restricted care.

### Transitional seams

- Gate/In & Out management still contains staff/admin membership assumptions.
- Leave review and parts of staff coordination still seek administrator/staff membership.
- Shared calendar internals retain teacher/principal selection paths.
- Assessment and report services still use broad admin/staff/student/guardian classifications
  for part of their access logic.
- Governance and some feedback coordination require current administrator membership rather
  than generalized delegated responsibility.
- Insights and assistant use hidden legacy audience/portal discriminators as transport seams.
- Attendance coordination still has transitional home/role projections in part of its stack.
- Departure retains some portal-era notification/eligibility fields.
- Simulation Work can omit domain Request items that have not moved into Core operational messages.
- The canonical Messages moderation link still contains a likely stale `/areas/safeguarding`
  destination while the current canonical Area is `/areas/care`.

### Open release gates

- Complete responsibility-native authority convergence in every owning domain.
- Complete all-domain Simulation adapters, effect routing, virtual time and projection parity.
- Database-backed migration/replay and multi-instance locking/concurrency evidence for the Core.
- Registry/handler/configuration version administration and upcasters.
- Reconciliation for timed-out, abandoned or uncertain pending commands.
- Complete snapshot namespace rewriting and adapter certification.
- Hosted simulator isolation/credentials and production-safe runner boundary.
- Fresh full PostgreSQL migration/integration evidence for the uncommitted convergence set.
- Fix hosted SPA deep-link handling for canonical `/today`, `/work`, `/areas/*` and `/more/*` routes.
- Broad physical-device, mobile, accessibility and owner acceptance.
- Commit, push, Stage merge, migration application and hosted deployment of the current worktree.

### Delivery status of this snapshot

The responsibility-composed convergence is a large local working tree. It is not yet a
clean committed, pushed, migrated or deployed release. Migrations `141–148` are part of
the local convergence and must not be described as hosted schema until they pass the
normal fresh-database and promotion gates.

## 24. How to trace any feature

When reviewing or extending a feature, follow this order:

1. **User surface:** Which Today, Work, Area or More contribution makes it discoverable?
2. **Scope:** Which exact responsibility, relationship or mandate contributes that surface?
3. **Domain API:** Which controller/service rechecks authority and owns the command?
4. **Domain aggregate:** Which typed records and revisions are authoritative?
5. **Core ports:** Which identity, command, event, observation or coordination evidence is recorded?
6. **Projection:** Which Today/Work/Campus View/notification records are rebuildable?
7. **Environment:** Does the same path resolve from Live or an isolated Simulation namespace?
8. **Correction:** How can an authorized human correct, supersede or reconcile the result?
9. **Verification:** Which migration, focused test and real PostgreSQL scenario proves it?

## 25. Source map

| Concern | Primary implementation evidence |
| --- | --- |
| Application router | [`frontend/src/App.tsx`](../../../frontend/src/App.tsx) |
| Shared shell | [`frontend/src/pages/operations/OperationsShell.tsx`](../../../frontend/src/pages/operations/OperationsShell.tsx) |
| Workspace frontend | [`frontend/src/features/workspace/`](../../../frontend/src/features/workspace/) |
| Workspace backend | [`backend/src/workspace/`](../../../backend/src/workspace/) |
| Backend composition | [`backend/src/app.module.ts`](../../../backend/src/app.module.ts) |
| Core ports/runtime | [`backend/src/campus-model-core/`](../../../backend/src/campus-model-core/) |
| Database type inventory | [`backend/src/database/types.ts`](../../../backend/src/database/types.ts) |
| Migrations | [`backend/migrations/`](../../../backend/migrations/) |
| Progressive onboarding | [`backend/src/institution-onboarding/`](../../../backend/src/institution-onboarding/) and [`frontend/src/features/onboarding/`](../../../frontend/src/features/onboarding/) |
| Activation/setup | [`backend/src/institution-activation/`](../../../backend/src/institution-activation/) and [`frontend/src/features/setup/`](../../../frontend/src/features/setup/) |
| Local simulator | [`devtools/campus-simulator/`](../../../devtools/campus-simulator/) |
| Deployment | [`deploy/gcp/`](../../../deploy/gcp/) and [`deploy/cloudflare/`](../../../deploy/cloudflare/) |
| Model Core contract | [ThatCampus Model Core Blueprint](../../blueprint/THATCAMPUS_MODEL_CORE_BLUEPRINT.md) |
| Digital twin boundary | [Campus Digital Twin and Agency Architecture](../../blueprint/CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md) |
| Product experience | [ThatCampus Operating Experience](../../blueprint/THATCAMPUS_OPERATING_EXPERIENCE.md) |
| App composition | [Responsibility-Composed Application](../../blueprint/RESPONSIBILITY_COMPOSED_APPLICATION.md) |
| Implementation evidence | [Implementation Plan](../../blueprint/IMPLEMENTATION_PLAN.md) |

## 26. Glossary

| Term | Meaning in ThatCampus |
| --- | --- |
| Domain | Owner of a typed business record and its invariants |
| Digital twin | Connected, time-aware operational model of plans, evidence, decisions and outcomes |
| Agent | Identified human, team, device, integration or bounded software actor |
| Entity | Stable reference to an authoritative domain thing such as person, class or room |
| Observation | Source-rich report of something observed; not automatically accepted truth |
| Event | Immutable statement that an owning domain accepted a meaningful transition |
| Command | Authorized request for an owning domain to attempt a state transition |
| Outcome | Explicit terminal result returned by the owning domain |
| Operational message | Typed request/task/offer/update between agents; not generic chat |
| Responsibility | Effective assignment of capabilities to a person/team in a scope and interval |
| Relationship | Domain-backed connection such as guardian-of or enrolled-in |
| Workspace manifest | Server-composed discovery/read model for Today, Work, Areas and More |
| Live | Authoritative campus environment |
| Simulation | Transient isolated fork of qualified Live state with virtual actors/clock/effects |
| Projection | Rebuildable user- or operation-specific view derived from authoritative records/events |
| Evidence | Typed provenance used to explain or validate a claim without inventing certainty |

---

**Maintenance rule:** update this atlas when a material architecture boundary changes,
but never edit it to claim an unverified target as current implementation. Keep normative
decisions in the owning blueprint and delivery evidence in the implementation plan.
