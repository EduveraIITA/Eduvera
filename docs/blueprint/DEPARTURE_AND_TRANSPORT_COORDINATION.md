# Departure and transport coordination

Status: implemented locally and awaiting representative-device acceptance, 6 October 2026.

This workflow closes the school-day handover loop without treating a timetable dismissal,
notification, bus position or scanned credential as proof that a learner was released safely.
It supports schools, colleges and coaching workspaces through institution capability and policy;
no institution is forced to enable guardian-controlled departure.

## Product outcome

For every participating learner and service date the product must answer:

1. What departure arrangement is currently approved?
2. Who may request or approve a change?
3. Which adult or service is expected to assume operational responsibility?
4. Is the learner ready, handed over, independently departed, or unresolved?
5. For school transport, is the assigned trip operating and is this learner still on board?

The primary record is the dated departure plan. A trip, location sample, guardian relationship,
change request and handover are supporting facts with different authority and retention rules.

## Supported departure modes

- `guardian_pickup`: handover to a guardian with a current collection grant.
- `authorized_collector`: handover to another school-verified person with a current grant.
- `independent_departure`: a reviewed institution decision allowing the learner to leave without
  an adult receiver for the stated dates.
- `school_transport`: a learner is assigned to a route, stop and dated trip roster.
- `external_transport`: the school records a family-arranged or contracted arrangement but does
  not imply that it operates or continuously supervises that service.

College and coaching capability packs may default to independent departure or disable this module.
Schools enrolling minors should explicitly configure enabled modes and approval ownership.

## Authority and state

Collection authority is purpose-specific. It is not implied by receiving academic updates,
signing leave, paying fees, appearing as an emergency contact or sharing a phone number. Grants
are institution-scoped, student-scoped, dated, revisioned and revocable. Historical handovers keep
the authority snapshot used at execution.

Departure plan states:

`planned -> ready -> completed`

with `change_pending`, `exception` and `cancelled` branches. A change request is separately
`submitted -> approved | rejected | withdrawn`. Approval creates a new plan revision; it never
silently overwrites history. Completion requires a separate execution command and factual outcome.

Trip states:

`planned -> boarding -> in_progress -> completed`

with cancellation before completion. The dated roster is frozen when boarding starts. Rider state
is `expected`, `boarded`, `dropped`, `not_riding` or `exception`. Every unresolved rider must remain
visible to the assigned collector and institution operations staff before trip closure.

## Bus location sharing

An authenticated staff member assigned as the trip collector starts the journey and explicitly
grants browser location permission. Location is accepted only from that active assigned account,
for the active trip, after departure and before closure. Samples include observed and received time,
accuracy and optional heading/speed; impossible, stale, excessively inaccurate and over-frequent
samples are rejected.

Family visibility is relationship-scoped and time-bounded. A linked guardian sees only the latest
bus position for their selected learner while that learner is `boarded` and not yet `dropped`.
They cannot read the roster, other stops, other learners or the collector's history. Location is
removed from the family response immediately after the learner is dropped, the trip closes or the
assignment is cancelled. Location age and accuracy are visible; stale data is never presented as live.

The current web client uses `navigator.geolocation.watchPosition` over HTTPS and requests a screen
wake lock where supported. Web platforms cannot guarantee collection after the document is hidden,
suspended or closed. The collector UI therefore says to keep the journey screen open, reports when
tracking pauses, and gives operations a stale-location exception. Guaranteed background tracking
requires a separately reviewed native client; it is not claimed by this slice.

Map tiles are presentation only. The tile provider is configurable, attribution remains visible,
and map failure does not block roster or handover commands. Production use requires an institution-
approved tile provider with an SLA; public OpenStreetMap tiles are suitable only for bounded review.

## Interfaces

- Principal/operations: policy, routes/stops, dated trips, roster, requests, authority and exceptions.
- Assigned collector: one active trip, boarding, foreground tracking, ordered stops, rider outcomes
  and explicit trip closure.
- Guardian: selected learner's approved arrangement, request change, and relationship-scoped live
  bus view only during that learner's active ride.
- Office-assisted path: records a phone, paper or in-person request with requester, recorder, time
  and channel. The record is attributed to staff as recorder, never forged as a guardian app action.

## Trip roster and duty planning

Transport planning separates three records that must not be collapsed:

1. A service pattern says which route and direction normally runs on which weekdays, at what
   departure time, with a nominated primary and backup collector, and for which effective dates.
2. A dated trip is the operational instance for one service date. Preparing a week materializes
   only matching active patterns and attaches the learners whose route assignments are effective
   on that date.
3. A trip roster records expected riders and later observations. It may be refreshed while the
   trip remains planned, but it freezes when boarding opens. A removed route assignment never
   silently removes a learner already placed on a dated roster; operations must resolve that case.

The nominated collector receives a pending duty and must explicitly accept or decline it. A
declined duty remains visible to operations and cannot open boarding. Operations can assign a new
primary and backup, which creates a new pending acceptance rather than silently transferring
responsibility.

Two controlled duty-change paths are supported before boarding:

- `cover`: the current assignee asks a colleague to take one trip.
- `exchange`: two accepted assignees agree to exchange their dated trips.

The requester remains responsible while the request is submitted. The colleague must accept, then
school operations must approve. Final approval rechecks both trip revisions and atomically changes
the assignment(s); stale, active or frozen trips fail without a partial swap. Rejection, school
decline and reassignment remain recorded in the duty-change history.

## Security, privacy and safety invariants

- Every record and relationship is constrained to one institution.
- Every command rechecks current membership, assignment, relationship and authority in its transaction.
- One current plan exists per student/date; every revision links to the preceding accepted plan.
- Starting a trip freezes its roster; later roster changes require an explicit exception.
- A generated or manually created trip cannot operate until its current collector accepts.
- A requested cover or exchange does not change responsibility before colleague acceptance and
  school approval; active and frozen trips cannot be swapped.
- A location point is an observation of the assigned phone, not proof of bus or learner location.
- Family access ends for that learner at drop-off, regardless of whether the trip continues.
- Trip closure is rejected while any rider is still `boarded` or in `exception`.
- Fees never affect departure readiness or handover authority.
- Routine notifications contain neutral state and identifiers, not precise coordinates.
- Precise samples use short retention; durable audits keep milestones without coordinates.
- Cached authority or a successful map load never authorizes physical release.

## Deliberate boundaries

No face recognition, passive child tracking, covert staff tracking, public share links, route
optimization, automatic geofenced drop-off, QR-only release or fee-gated handover. Transport vendor
feeds and a native background-location client require separate readiness and privacy review.

## Acceptance scenarios

1. A guardian requests a dated pickup change; staff approves it and the new plan revision becomes
   current without altering the prior plan.
2. A revoked collector cannot be selected or used for handover, including from a stale browser.
3. An office worker can record an assisted request without attributing it to the guardian account.
4. Only the assigned trip collector can start, publish location or record rider outcomes.
5. A guardian cannot access another learner's trip by changing `student_id` or trip identifiers.
6. Location is absent before boarding and immediately after that learner's drop-off.
7. Stale location is labelled stale and cannot be interpreted as a current bus position.
8. A trip cannot close while a learner is boarded or unresolved.
9. Independent departure produces an execution record distinct from an adult handover.
10. All accepted changes append audit and transactional outbox evidence without coordinates.
11. A recurring service pattern prepares only its selected weekdays and uses effective-dated rider
    assignments for each generated roster.
12. A collector can decline a pending duty, after which boarding stays blocked until reassignment
    and acceptance.
13. A mutual exchange changes both dated trips only after colleague acceptance and school approval;
    a stale revision changes neither trip.

## Local implementation evidence — 6 October 2026

- Migration `043_departure_and_transport_coordination.sql` is applied to the local development
  database and a second migration run is a no-op. It creates tenant-scoped policy, authority,
  route, stop, assignment, trip, roster, location, plan, request, handover and audit records with
  browser-role grants revoked and RLS enabled.
- Principal operations are available at `/principal/departure`; the assigned collector journey is
  `/teacher/transport`; the selected-child family view is `/parent/departure`. More navigation and
  the parent home shortcut retain the selected learner query context.
- Principal operations configure enabled modes/cutoff/location retention, create routes and stops,
  assign learners, create frozen dated rosters, verify or revoke receivers, record phone/paper/in-
  person requests, approve changes, mark readiness and record factual handover.
- Principal operations now include a seven-day duty calendar, effective-dated recurring service
  patterns, bulk week preparation, explicit primary/backup assignment and planned-roster refresh.
  Collector views include duty acceptance, one-way cover requests and mutual trip exchanges;
  accepted requests remain pending until principal approval.
- The repeat-safe Cambridge demo creates two current collection authorities, one route with three
  stops, two student assignments, an active assigned trip, a two-rider roster and a recent precise
  observation. Authenticated API smokes returned one family journey, one collector trip and the
  matching principal workspace.
- A real-database privacy smoke verified that coordinates are returned for the boarded learner,
  withheld from the linked sibling before boarding and removed immediately after the boarded learner
  is marked dropped. The roster state was restored after the smoke.
- Backend typecheck, lint and production build pass; 18 focused backend tests pass, including the
  new migration contract. Frontend typecheck, lint and production build pass; all 247 frontend tests
  pass. The repository-wide backend command still requires its documented isolated test database
  for six integration files and is not represented as a complete green integration run here.
- The live-reload preview and API health are available locally and through the existing HTTPS ngrok
  review tunnel. Real phone geolocation permission, screen-lock interruption, weak-network recovery,
  route operations and physical gate handover still require representative-device and school-
  operations acceptance before release.
