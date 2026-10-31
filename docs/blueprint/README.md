# Product and engineering contracts

Start with root [AGENTS.md](../../AGENTS.md), then read only the owning contracts
for the work. [Current delivery](IMPLEMENTATION_PLAN.md) records what is verified
and what remains open; [Verification](../VERIFICATION.md) owns check commands,
fixture tours and exact evidence links. A design target or old receipt is not
current implementation or institutional acceptance.

## Authority order

1. Explicit current owner decisions, recorded with the owning work.
2. [Product blueprint v2](PRODUCT_BLUEPRINT_V2.md), the product constitution.
3. Its normative architecture and owning-domain contracts below.
4. [Current delivery and next work](IMPLEMENTATION_PLAN.md).
5. Current code, migrations and tests as evidence, not authority to repeat drift.

Earlier proposals, Word/PDF frameworks and chronological QA logs are
[recoverable archived provenance](../VERIFICATION.md#documentation-recovery), not
competing active instructions. Unique accepted requirements remain in the owners
below, including the governance model/acceptance cases.

## Essential architecture

| Concern | Owning contract |
| --- | --- |
| Product purpose, zero-to-whole-campus adoption, operator burden | [Product blueprint](PRODUCT_BLUEPRINT_V2.md) |
| Domain/core separation, stable agents, identity and authority | [DT and agency](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md) |
| Typed commands, observations, configured reactions, outcomes and adapter ports | [Model Core](THATCAMPUS_MODEL_CORE_BLUEPRINT.md) |
| Universal realms, semantic catalogues and environment-qualified identity | [Universal model](UNIVERSAL_INSTITUTION_MODEL.md) |
| Shared shell, Today/Work, attention, Requests/Tasks/Offers and interaction | [Operating experience](THATCAMPUS_OPERATING_EXPERIENCE.md) |
| Responsibility composition, neutral routes and feature migration gates | [Application composition](RESPONSIBILITY_COMPOSED_APPLICATION.md), [parity gate](RESPONSIBILITY_APPLICATION_FEATURE_PARITY.md) |
| Visual tokens, supplied artwork, accessibility and blue/amber themes | [Theme](THATCAMPUS_THEME.md) |
| Versioned institution-owned automatic behavior | [Operating rules](OPERATING_RULES.md) |
| Same-application isolated worlds, clocks, actors, effects, storage and recovery | [Simulation](CAMPUS_SCENARIO_SIMULATION.md) |
| Retained Cambridge synthetic development/conformance tooling | [Campus Lab](CAMPUS_LAB_DEVELOPMENT_HARNESS.md) |

One Live campus is authoritative. Simulation forks its eligible state but uses the
same domain owners, routes and screens, with server-selected stores, clocks,
authority, cache/stream namespaces and sink-only effects. Missing coverage fails
closed; amber never falls back to Live. Runtime safety readiness and capability
evidence are separate. No floating environment pill or separate Simulation ERP.

One responsibility-composed application serves the person, not a job-title portal.
Effective assignments, relationships, owned work and time determine content;
administrator membership is not a Principal/teacher/operating mandate. Users see
domain language, not Core persistence or graph machinery.

## Owning workflow contracts

| Concern | Read before changing it |
| --- | --- |
| Purpose-first account entry, company invitation/security and progressive trust | [Progressive onboarding](PROGRESSIVE_CAPABILITY_ONBOARDING.md) |
| Gradual whole-campus guidance and contextual prerequisites | [Guided setup](WHOLE_CAMPUS_GUIDED_SETUP.md) |
| All22 lifecycle journeys and phased domain ownership targets | [End-to-end workflows](END_TO_END_CAMPUS_WORKFLOWS.md) |
| People/groups, reviewed import, enrollment lifecycle and connections | [People and connections](PEOPLE_GROUPS_AND_CONNECTIONS.md) |
| Scoped roles, responsibilities and calculated technical access | [Access](WORK_PROFILE_ACCESS_ARCHITECTURE.md) |
| Institutional mandates, procedure, appointments and governance acceptance cases | [Governance authority](INSTITUTE_GOVERNANCE_AUTHORITY_ARCHITECTURE.md), [policy compliance](GOVERNANCE_POLICY_COMPLIANCE.md) |
| Descriptive organization and reporting lines without implicit authority | [Organization structure](ORGANIZATION_STRUCTURE_ARCHITECTURE.md) |
| Canonical campuses/buildings/spaces, resources and dated placement | [Campus replica](INSTITUTION_CAMPUS_REPLICA.md) |
| Reviewed map/floor-plan editing, publication and bounded visualization | [Campus scenes](CAMPUS_VISUAL_SCENES.md) |
| Evidence-qualified read-only measurements | [Campus KPIs](CAMPUS_VIEW_OPERATIONAL_KPIS.md), [Insights](PRINCIPAL_INSIGHTS.md) |
| Routine sessions/duties, dated schedule drafts, preferences and publication | [Schedule planning](ANNUAL_SCHEDULE_PLANNING.md), [activity/attendance foundation](PEOPLE_SCHEDULING_AND_ATTENDANCE.md) |
| Important dates and changes, not routine sessions or a second inbox | [Calendar](CAMPUS_CALENDAR.md) |
| Staff leave, review, coverage, conflicts and responsibility continuity | [Staff continuity](STAFF_LEAVE_REVIEW_CONTINUITY.md) |
| Dated preparation, materials and reported lesson coverage | [Teaching sessions](TEACHING_SESSIONS.md) |
| Individual assignment drafts, submitted manifests and feedback | [Assignments](INDIVIDUAL_ASSIGNMENTS.md) |
| Offline assessments, result evidence and policy-derived reports | [Assessments](OFFLINE_ASSESSMENTS_RESULTS.md), [grading/reports](CONFIGURABLE_GRADING_REPORT_CARDS.md), [teacher feedback](TEACHER_FEEDBACK_RESULTS.md) |
| Fees, collections/corrections, instalments, payment claims and provider boundaries | [Finance](FEE_INSTALMENT_AGREEMENTS.md) |
| Exact-item borrowing, quantity, partial returns and custody correction | [Resource loans](RESOURCE_LOANS.md) |
| Assisted repairs, verification/reopening and exact external technician access | [Facilities](FACILITIES_REPAIRS.md) |
| Rooms/places, stays, moves and linked access-item custody | [Accommodation](ACCOMMODATION_AND_MOVES.md) |
| Services, menus/hours, counts and shortage work | [Dining](CAMPUS_DINING_AND_SERVICE.md) |
| Partial adoption, one capability writer and external provider replacement | [Coexistence](EXTERNAL_SYSTEM_COEXISTENCE.md) |
| Scoped gate operation, departure/transport and optional visit observations | [Gate](GATE_WORKSPACE.md), [departure/transport](DEPARTURE_AND_TRANSPORT_COORDINATION.md), [visits](VISIT_ARRANGEMENTS.md) |
| Private case handling and minimal discovery | [Restricted Care](RESTRICTED_CARE_WORKFLOW.md) |
| Authorized AI/tools, reviewed changes, recovery and channels | [Assistant](SCHOOL_AGENT.md), [Matrix deployment/limits](../../deploy/matrix/README.md) |

The [architecture atlas](../architecture/current-system-atlas/paper.md) is a
descriptive structural map with dated status labels, not a replacement for current
contracts/status. Deployment, brand, optional-sidecar and native runbooks retain
their own operational/legal scope.

## Maintenance and acceptance

Maintain one contract per concern; merge extensions into their owner. Keep status
and remaining gates in the implementation plan and exact receipts in Verification
or raw artifacts, not another dated Markdown diary. Do not flatten domain-specific
rules into one generic business-case engine merely to reduce file count.

Work outside-in from a concrete person and real campus outcome. Preserve current
authority, tenant/world isolation, immutable evidence, stale/duplicate/unknown
response recovery and correction. A substantial workflow includes its own native,
Live/Simulation and rendered acceptance proportionate to risk. Physical outcomes,
device approval, real institution authority and production scale require their own
evidence. Test declarations, passing source scans and archived counts do not close
those gates.
