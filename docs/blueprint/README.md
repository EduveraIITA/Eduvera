# Current product and engineering contracts

This index makes the accepted direction discoverable to every repository agent.
Read the root `AGENTS.md` first. As of 17 October 2026, the digital-twin integration
is on `Stage`; `main` can lag it. Fetch and compare shared heads rather than assuming
the default branch contains the latest owner decisions.

## Authority order

1. Explicit current owner decisions, recorded with the owning work.
2. `PRODUCT_BLUEPRINT_V2.md`: accepted product constitution and boundaries.
3. Its normative companions below, plus the current contract for the domain being changed.
4. `IMPLEMENTATION_PLAN.md`: verified delivery state, known gaps and release evidence.
5. Current code, migrations and tests: evidence of implementation, not permission to
   perpetuate a documented architectural gap.

`School_Operations_Blueprint.pdf` v1 and the root `01`–`04` proposals are historical
or broader planning context. Preserve requirements explicitly retained by v2, but do
not use their older stack, workflow or navigation proposals to override current
contracts. Do not rewrite historical implementation evidence to pretend an older
release followed a later decision.

The current simulation invariant is intentionally simple: ThatCampus has one
authoritative Live campus. An authorized user may temporarily fork its state into an
isolated, expiring Simulation context, but continues to operate the same application,
routes, modules and workflows. Only the compact top **Live**/**Simulation** marker and
Simulation virtual time need differ. Every read, action, cache and realtime stream
must resolve from the server-authoritative selected context; never build a separate
simulation mini-app or fall back to Live beneath a Simulation marker.

## Normative reading map

| Concern | Read |
| --- | --- |
| Product direction and capability-first setup | `PRODUCT_BLUEPRINT_V2.md` |
| Domain/core separation, identity, events and authority | `CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md` |
| Typed coordination, configuration, command/outcome and adapter contracts | `THATCAMPUS_MODEL_CORE_BLUEPRINT.md` |
| Universal realms, environment-qualified identity, semantic catalogues and domain-extension contract | `UNIVERSAL_INSTITUTION_MODEL.md` |
| Shared shell, domain workspaces, Today, Requests, Updates and interaction | `THATCAMPUS_OPERATING_EXPERIENCE.md` |
| Current delivery evidence and limitations | `IMPLEMENTATION_PLAN.md` |
| Campus spaces and dated placements | `INSTITUTION_CAMPUS_REPLICA.md` |
| Roles, assignments and purpose-specific authority | `WORK_PROFILE_ACCESS_ARCHITECTURE.md`, `INSTITUTE_GOVERNANCE_AUTHORITY_ARCHITECTURE.md` |
| Institution-owned automatic behaviour | `OPERATING_RULES.md`, plus the Model Core and operating-experience contracts |
| Timetable and coverage | `ANNUAL_SCHEDULE_PLANNING.md`, `STAFF_RESPONSIBILITIES_AND_COVERAGE.md` |
| Authoritative Live state, transient Simulation forks, actor counterparts, projections and forecasts | `CAMPUS_SCENARIO_SIMULATION.md` |
| Cambridge-only Live conformance actor harness | `CAMPUS_LAB_DEVELOPMENT_HARNESS.md` |
| Read-only campus measurement | `CAMPUS_VIEW_OPERATIONAL_KPIS.md` |
| Enrollment changes | `STUDENT_ENROLLMENT_LIFECYCLE.md` |

Read the other owning-domain contracts in this directory before changing those
workflows. Marketing, deployment and provider-specific documents remain scoped to
their subjects; they do not redefine the product constitution.

## Applying this direction to teaching preferences

The owner's 17 October request remains active: an assignable **Manage Timetable**
permission, teacher preference invitations, availability, conflict-aware options and
review before timetable changes. The following are implementation requirements,
not claims that the feature has shipped:

- Reuse existing people, staff, classes, subjects, terms and canonical campus spaces.
  Do not create a separate teacher/room catalogue or infer eligibility from a title.
- Keep the workflow within the Timetable domain and existing shell. Preference entry
  is the teacher's authoritative action; Requests/Today only project and link to it.
  Preserve one calendar-based draft editor and publication path.
- Use an institution-scoped permission assignment for coordination. A teacher can
  respond to their own valid invitation without management authority. Recheck actor,
  tenant, recipient, effective assignment, deadline and revision on every command.
- Invitations are owned work, not merely notifications. Retain concrete human-agent
  identity, typed command/event/message/outcome lineage and recipient response through
  reviewed Model Core ports. Domain tables remain authoritative for preferences and
  schedule validity; no frontend or feature imports core persistence.
- Submitted availability and subject preferences are reported planning inputs, not
  inferred intent, teaching eligibility, accepted assignments or physical evidence.
- Generate bounded deterministic suggestions with explicit constraints, objective,
  input revisions and limitations. A failed bounded search does not prove no valid
  timetable exists. Do not call an option globally optimal without evidence.
- Suggestions are proposals. Saving a selected result creates a revision-checked
  domain draft; publishing remains a separately authorized action through current
  schedule validation, temporal projection and coverage reconciliation.
- Use stable space identities, effective dated schedules, closures and daily changes.
  Keep existing attendance, substitutions and historical published versions intact.
- Automatic reminders, recipient routing, escalation and other mutable behaviour
  require explicit reviewed institution configuration. Missing configuration must
  remain visible; never enable hidden defaults or a workflow-local automation runtime.
- Scenario/rehearsal execution, if introduced, uses the shared isolated scenario
  contracts. It must not send live requests, write schedules or manufacture acceptance.

## Evidence before completion

Record the changed code, schema and tests in `IMPLEMENTATION_PLAN.md`. Verify tenant
and permission boundaries, recipient ownership, stale/duplicate commands, deadline
handling, unavailable inputs, hard constraints, draft/publication distinction and
canonical-space conflicts. Verify the actual UI and its loading, empty, failure,
mobile, keyboard and dark-mode states. Report local checks, pushed code, hosted
release and owner acceptance separately.
