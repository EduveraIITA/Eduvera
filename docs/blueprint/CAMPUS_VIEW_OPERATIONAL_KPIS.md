# Campus View operational KPIs

**Status:** current product and engineering contract

**Owner:** Campus View read experience
**Last reviewed:** 17 October 2026

This contract defines the operational KPI panel inside Campus View. It is a
read-only, rebuildable projection over authoritative domain records and Campus
Model Core evidence. It is not a second source of truth, an analytics warehouse,
or permission to infer physical presence from a timetable.

Read this alongside:

- `PRODUCT_BLUEPRINT_V2.md`
- `THATCAMPUS_MODEL_CORE_BLUEPRINT.md`
- `THATCAMPUS_OPERATING_EXPERIENCE.md`
- `CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md`
- `PRINCIPAL_INSIGHTS.md`

## 1. Product purpose

The panel helps an authorized campus operator answer four questions without
leaving the live campus surface:

1. What is expected to be happening now?
2. What accepted operational records have actually arrived?
3. Which explicit invariant, deadline, or evidence queue is blocking the day?
4. Is the problem a momentary spike or a persistent pattern?

Campus View remains the place to observe and navigate. The authoritative action
continues to live in the owning attendance, timetable, gate, transport,
assessment, resource, or coordination workspace.

## 2. Non-negotiable truth contract

- Expected, observed, accepted, and unknown are distinct evidence classes.
- A scheduled session is expected use, not proof that teaching occurred.
- A planned seat load is not occupancy.
- An attendance record is accepted participation evidence, not room presence.
- A gate observation proves a boundary event, not continuous location.
- Zero sensor records means **zero recorded events** unless source health proves
  complete coverage. It does not mean nothing happened.
- Missing evidence is `null`/unknown, never silently converted to zero.
- A zero denominator is unavailable or not applicable, never `0%` or `100%`.
- Ratios aggregate raw numerators and denominators; percentages are never
  averaged.
- Live and simulated evidence use separate namespaces and are never aggregated.
  Campus-lab rehearsal overlays are excluded from live KPIs.
- Historical results use semantic event time in the campus timezone. Ingestion
  time is used only for pipeline-latency measures.
- No person-level series, individual ranking, inferred intent, or continuous
  location leaves the API.
- No opaque composite campus-health score is allowed.

Every KPI carries its definition version, source label, evidence dimensions,
scope, availability, current numerator and denominator where meaningful, and a
series of explicit half-open time buckets.

## 3. Navigation and time model

The KPI surface is a modal sheet over the immersive campus map so an operator
can inspect performance without losing map context. It has six pages:

1. Overview
2. Teaching
3. Movement
4. Spaces
5. Coordination
6. Data health

Overview is a current-day snapshot. The other pages support Today, 7 days,
30 days, 90 days, and 1 year. Automatic grain is:

| Range | Grain |
| --- | --- |
| Today and up to 48 hours | 15 minutes |
| More than 48 hours through 31 days | 1 hour |
| More than 31 days through 366 days | 1 day |

The API returns at most 800 points per metric. Live views may refresh every
60 seconds while open. Historical views do not poll.

## 4. KPI catalogue

Availability is defined as:

- **Available:** durable current sources support the stated calculation.
- **Partial:** the calculation is useful but a disclosed lineage, scope, or
  historical limitation remains.
- **Unavailable:** the product needs explicit instrumentation before it can make
  the claim. The UI shows this state; it does not fabricate a value.

### 4.1 Teaching

| Key | Definition | Evidence | Current availability |
| --- | --- | --- | --- |
| `teaching.sessions_planned` | Effective class/activity occurrence starts in each bucket; current value is active expected sessions at `as_of`. | Expected schedule occurrences | Available |
| `teaching.minutes_planned` | Sum of the overlap between effective class/activity occurrences and each bucket. | Expected schedule occurrences | Available |
| `teaching.learner_places_planned` | Effective enrolled learners summed across expected sessions. | Expected schedule + effective enrolment | Available |
| `teaching.teacher_assignment_rate` | Expected sessions with an active responsible human agent divided by all expected sessions. | Expected schedule | Available |
| `attendance.register_completion_rate` | Submitted/locked due registers divided by expected registers past their configured deadline. | Accepted attendance domain records | Partial: old rule snapshots are incomplete |
| `attendance.recording_coverage` | Authoritative attendance rows divided by the effective eligible roster for due registers. | Accepted attendance records | Available |
| `attendance.participation_rate` | Recorded present/late/eligible half-day participation divided by scored accepted entries. | Accepted attendance records | Available |
| `attendance.late_rate` | Recorded late entries divided by scored accepted entries. | Accepted attendance records | Available |
| `attendance.evidence_review_backlog` | Pending/quarantined session evidence plus open reconciliation cases at bucket end. | Observed evidence and accepted review state | Available |

### 4.2 Movement

| Key | Definition | Evidence | Current availability |
| --- | --- | --- | --- |
| `people.teachers_expected` | Distinct responsible agents in effective expected activity. | Expected schedule | Available |
| `people.teacher_schedule_conflicts` | Concurrent expected sessions assigned to the same responsible agent. | Expected schedule | Available |
| `access.gate_entries_recorded` | Accepted gate-entry observations in the bucket. | Accepted point observations | Available |
| `access.gate_exits_recorded` | Accepted gate-exit observations in the bucket. | Accepted point observations | Available |
| `access.people_observed_distinct` | Distinct subjects with accepted gate evidence in the bucket. | Accepted point observations | Available |
| `access.visitors_inside` | Visitor workflows whose check-in interval is open at bucket end. | Accepted visitor workflow state | Available at institution scope |

### 4.3 Spaces

| Key | Definition | Evidence | Current availability |
| --- | --- | --- | --- |
| `spaces.planned_active` | Distinct canonical spaces referenced by expected activity. | Expected schedule | Available |
| `spaces.planned_use_rate` | Unioned scheduled minutes in canonical bookable leaf spaces divided by those spaces' minutes inside each day's effective instructional envelope. Concurrent bookings do not inflate the numerator. | Expected schedule + topology | Available |
| `spaces.planned_seat_load_rate` | Planned learner-place minutes divided by known-capacity scheduled space minutes. | Expected schedule + roster + capacity | Partial: historical capacity is not versioned |
| `spaces.over_capacity_sessions` | Known-capacity expected sessions whose roster/candidates exceeds configured capacity. | Expected plan | Partial for historical capacity lineage |
| `spaces.double_booking_conflicts` | Non-pairwise-overcounted minutes with concurrent effective occurrences in one canonical space. | Expected plan | Available |
| `spaces.missing_canonical_space` | Expected physical occurrences that do not resolve to an active selected-campus space. | Expected plan + topology | Available |

### 4.4 Coordination

| Key | Definition | Evidence | Current availability |
| --- | --- | --- | --- |
| `coordination.work_open` | Request/Task/Offer messages queued, delivered, or acknowledged at bucket end. | Protocol records | Available |
| `coordination.work_overdue` | Open actionable messages past an explicit response due time. | Protocol records | Available |
| `coordination.response_rate` | Responded terminal messages divided by eligible terminal messages. | Protocol records | Available |
| `coordination.median_response_minutes` | Median time from queued to responded for Requests/Tasks/Offers in the latest interval containing response evidence. The historical series retains each interval median; this value is not represented as the median of the whole selected range. | Protocol records | Available |
| `coordination.failure_rate` | Expired/dead-letter messages divided by responded/expired/dead-letter terminal messages. | Protocol records | Available |
| `coordination.exceptions_open` | Unresolved coordination configuration/routing exceptions at bucket end. | Protocol records | Available, with known under-recording for rolled-back routes |

### 4.5 Data health

| Key | Definition | Evidence | Current availability |
| --- | --- | --- | --- |
| `evidence.observations_accepted` | Observation records in accepted disposition. | Observation pipeline | Available |
| `evidence.observations_waiting` | Pending and quarantined observation records. | Observation pipeline | Available |
| `evidence.command_conflict_failure_rate` | Conflicted/failed terminal command outcomes divided by terminal command outcomes. | Command protocol | Available |

This first catalogue is intentionally limited to 30 operational KPIs. Exam
readiness, transport reconciliation, handover exceptions, gate/schedule
contradictions, observation latency, resource availability and projection
coverage remain candidates for later catalogue revisions after their historical
evidence and ownership contracts meet the same standard. They may still appear
as current objective bottlenecks when an authoritative domain explicitly reports
them. Page responses return only the metrics for that page so one-year reads stay
bounded.

## 5. Overview page

The first page uses four primary headline cells:

1. Active expected sessions
2. Due attendance completion
3. Open and overdue actionable work
4. Accepted gate evidence in the last 15 minutes

Snapshot charts are limited to defensible compositions:

- attendance registers: completed, outstanding, and unknown;
- evidence pipeline: accepted, pending, quarantined, and rejected;
- planned seat capacity: planned, known free plan capacity, over-capacity, and
  unknown capacity (always labelled **planned**, never occupied).

The bottleneck table is sorted by a domain-defined severity and then due age. A
row exists only for an explicit invariant or deadline, including:

- overdue attendance registers;
- expected sessions missing a teacher or canonical space;
- teacher or space schedule conflicts;
- known capacity breaches;
- physical examination readiness blockers;
- gate/schedule contradictions;
- transport reconciliation or handover exceptions;
- overdue actionable work;
- coordination routing exceptions;
- quarantined evidence.

Every row discloses scope and evidence class and deep-links to the single
authoritative action path.

## 6. API shape

The initial endpoint is:

```text
GET /api/v1/schools/:schoolId/campus-view/kpis
  ?campus_id=<uuid>
  &page=overview|teaching|movement|spaces|coordination|data_health
  &range=today|7d|30d|90d|1y
```

The server owns a metric allowlist; client input never becomes an interpolated
table, column, expression, or metric key. Queries always constrain `school_id`.
The optional campus must belong to the school and attribution must use canonical
topology. Institution-only data retains an Institution scope label rather than
being assigned to the selected campus for convenience.

The response contains:

- snapshot timestamp, campus timezone and selected scope;
- page and requested range;
- automatic bucket kind and half-open period;
- metric definition and evidence metadata;
- current value plus numerator/denominator;
- explicit availability;
- historical points with `null` gaps;
- Overview headline keys, composition and objective bottlenecks.

## 7. Source and projection architecture

The first implementation queries durable domain history directly. It must not
use the short-retention event outbox as KPI history and must not create a second
mutable KPI truth store.

If measured production query plans later require aggregation, add a rebuildable,
versioned projection with source watermarks. Aggregate rows must retain raw
numerator, denominator, unknown count, definition version, evidence class,
scope, mode, source watermark, and quality status. Distinct counts and medians
must use mergeable sketches or be recomputed from source records; they cannot be
summed or averaged from lower-grain values.

## 8. Authorization, privacy, and correction

- Access requires an active account, active administrator membership, active
  school context, and a campus belonging to that school.
- Aggregate reads never return person identities.
- Drill-down routes perform their own domain authorization.
- Corrections to authoritative domain records rebuild or naturally restate the
  projection. The KPI panel does not edit operational truth.
- Current historical schedule series are corrected history as known now unless
  a future recorded-as-of option is explicitly implemented.

## 9. Release gates

Before this surface is described as complete:

- verify tenant and campus isolation;
- verify campus-timezone bucket boundaries, including daylight-offset changes;
- verify ratio aggregation and zero-denominator behavior;
- verify unavailable and partial metrics render without fabricated zeroes;
- verify rehearsal data is excluded;
- verify no physical occupancy claim is serialized;
- verify one-year responses stay within the point and latency budgets;
- verify mobile sheet focus, keyboard tabs, readable charts, textual chart
  summaries, reduced-motion behavior, and 44px controls;
- measure query plans before adding indexes or aggregate tables;
- keep a local preview available for user validation after substantial UI work.

