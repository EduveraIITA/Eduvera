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

Two controlled duty-change paths are supported until 30 minutes before departure:

- `cover`: the current assignee asks a colleague to take one trip.
- `exchange`: two accepted assignees agree to exchange their dated trips.

The requester remains responsible while the request is submitted. The colleague must accept, then
school operations must approve. Final approval rechecks both trip revisions and atomically changes
the assignment(s); stale, active or frozen trips fail without a partial swap. Rejection, school
decline and reassignment remain recorded in the duty-change history.

Per the user's 9 October decision, collector journey controls open **30 minutes
before the scheduled departure in the institution timezone**. Self-service cover
and exchange requests, responses and approval close at that boundary. Pending duty
acceptance remains available; urgent replacement uses school-managed reassignment
before boarding, with a reason and fresh acceptance. The server enforces the window,
not just the UI. Active journey reconciliation remains available after departure.

Collectors enter a grouped **My rides** list at `/teacher/transport`, then open a
dated ride at `/teacher/transport/:tripId`. There is no journey dropdown. An active
ride with an accepted location observation shows the map first and ride information
below; a planned ride does not reserve an empty map. Parent and student maps require
their learner's recorded boarding and disappear after handover. This is phone
location, not a verified ETA, bus tracker or physical release authorization.

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
- Trip closure is rejected while any rider is still `expected`, `boarded` or in `exception`.
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

## Local hardening evidence — 9 October 2026

- Added current-resource checks inside serialized transactions, explicit journey
  and rider state transitions, optimistic revisions, accepted-duty enforcement,
  actual-outcome notes, school reconciliation of overdue journeys, and same-date
  handover evidence. Approved pickup changes atomically remove expected bus travel;
  occupied or unresolved journeys cannot be silently replaced or cancelled.
- Parent requests now have dated receiver validation, duplicate protection,
  withdrawal and decision history. Morning rides do not depend on an afternoon
  departure plan. Students have an own-record, read-only departure route. Current
  membership/linkage and per-learner boarding limit location access; one child's
  boarding never exposes a sibling's location.
- Duty invitations can reach active staff without an existing collector grant;
  accepting an invitation does not grant operating access until school approval.
  Reassignment and swap approval revalidate the replacement and trip revisions.
- Location sharing is bound to one active ride, stops on hidden/unmounted screens,
  reports permission/network failures, and claims sharing only after API acceptance.
  Independent bounded retention runs expire coordinates even without further GPS
  uploads. Durable audit/outbox milestones omit precise coordinates; school-event
  refreshes now include departure and transport events.
- Maps retain zoom/pan across observations, support recentering and tile-error
  retry, and label old observations. Staff and families use one map-first ride
  information layout while retaining their existing shells and role-specific actions.
- Verified **32 focused backend tests across four files**, including **14 real
  PostgreSQL lifecycle/privacy/timing tests** in an isolated schema-copy database.
  Backend typecheck, lint and build passed. Frontend full suite: **567 tests in
  77 files**; typecheck, lint and build passed. These are local results, not release
  certification or a repository-wide backend integration result.
- WebKit authenticated through the HTTPS review tunnel as staff, parent and student.
  Actual persisted rides/maps loaded; staff location upload returned accepted;
  parent/student read the observation; tomorrow's ride hid boarding and its map.
  No page errors or horizontal overflow at 320/390/768/1024/1440px. The browser's
  simulated geolocation timestamp needed a test-only microsecond-to-millisecond
  correction; no runtime timestamp rewrite was added. Physical-phone GPS is still
  an acceptance gate.
- At the user's explicit request, created a **real database-backed test ride** in
  local `omnischool_node`, isolated in **Transport Test School**
  (`c4a5b108-7cf8-486d-8b01-6842b9e216dc`) with dedicated test accounts and a synthetic
  learner/guardian relationship. Ride `3ddc436d-c9ce-4d14-b461-41ef3c8f297f` is in
  progress; `ee4bf2d5-b085-4937-b7a7-577658995ba0` is scheduled for the following day.
  Both used the application service's real assignment, acceptance, boarding, roster,
  plan, audit and event paths. The initial coordinate is a sample; actual device
  sharing replaces it. Existing schools' students/journeys were not modified.

Remaining release gates: physical phone permission/background/weak-network tests,
school pickup/exception procedures, and fresh PostgreSQL 17 migration validation.
The available local PostgreSQL 14 failed the existing PG15+ syntax in migration 033;
integration tests therefore used a schema-only copy and reference capability-pack
catalog, not a claimed successful fresh migration. Additional planning acceptance
must cover pending future pickup requests before trip generation, recurring-pattern
validation after staff/route changes, and a bus-return-before-departure workflow.
No production deployment or push was performed for this work.

### Demo access correction — 9 October, 02:00

The user subsequently rejected separate logins. The review fixture is now the
existing Cambridge South Bengaluru trip `5ea993a2-388e-44b1-ac1d-3451462843c6`, dated
9 October at 02:00 school time, seeded in progress for the existing Kavita/Aarav/
Pooja demo personas. Sample boarding and location are explicitly identified as
demo seeding in outcome notes and a before-snapshot audit; normal safety gates were
not weakened. The previous four extra test accounts were disabled and their
sessions revoked, with records retained. See the implementation plan for scope and
verification. No separate login is needed to review the active map.

### One-tap routine outcomes and automatic foreground location — 9 October

Explicit user decision supersedes mandatory prose for every roster observation:
assigned attendants now record routine boarding, non-travel, school arrival and
handover with one tap. Actor, time, optimistic revision, current-plan checks,
handover evidence and coordinate-free refresh events remain transactional. Written
notes are still required for concerns, their resolution and school reconciliation.
Existing routine notes are available under a collapsed Note disclosure. Saving
disables duplicate actions; failures keep the action retryable without claiming
success. This changes transport-roster actions, not office pickup-authority checks.

Location starts automatically when the accepted ride becomes in progress, including
opening an existing active ride. The browser can still request permission. Tracking
pauses while hidden/unmounted and resumes on returning to the active screen; an
explicit pause or device/permission error requires Resume/Retry rather than repeated
automatic permission prompts. GPS never marks a learner boarded or handed over.
Sharing is claimed only after the API accepts a sample. These are foreground web
semantics, not guaranteed tracking with the app closed or phone locked.

Verification: **579 frontend tests / 77 files**, frontend typecheck/build/lint;
**35 focused backend tests / 4 files**, including **15 isolated PostgreSQL lifecycle
tests**, backend typecheck/build/lint. A new integration scenario verifies note-free
boarding and handover, actor/time, current-plan completion, unique handover evidence,
family location cutoff, stale-write rejection and parent refresh events. HTTPS
WebKit on the existing staff demo account uploaded an accepted location (201)
automatically with no click, no page errors or overflow at 320/390/768/1440px.
Simulated sensor timestamp normalization remains test-only. Physical-phone
permission and background/weak-network acceptance are still open release gates.

### Expanded boarding fixture — 9 October, 02:20 school time

The user requested another run with more riders and chose **Restart at boarding**.
The same Cambridge trip `5ea993a2-388e-44b1-ac1d-3451462843c6` now has **12 existing
demo students, two at each of six drop-off stops**, all initially expected. Its
one-off route is `DEMO-REVIEW-1009` (`cff19358-1244-4eda-90bb-b9ff4552a5c6`), with
school origin plus Jayanagar 4th Block, Jayanagar 9th Block, JP Nagar 6th Phase,
JP Nagar 7th Phase, Arekere and Bannerghatta Road. Stop times are sample offsets
from 02:20, not predicted arrival times. Existing recurring routes/assignments and
future rides were left unchanged; no accounts were created.

The prior two completed current plans were superseded, not erased, preserving
their handover records. The roster was reset with higher revisions, new planned
current plans and an append-only before-snapshot `trip.demo_fixture_reset` audit.
Thirteen old location samples for this exact trip were cleared, so the next run
starts without old coordinates. Staff/family service reads verified the new state.
The user separately approved closing the two unfinished 6/7 October demo trips
(`601a2dad-17f3-4d3c-aff6-444b5f7db91d`,
`176b2872-d9d4-43b0-845b-4f3e07d3f292`) that blocked departure. School reconciliation
closed them with explicit synthetic-fixture notes and before-snapshot audit records;
no real-world physical handover was asserted, and the operating safety guard remains.

### Naggar walking test and location-guided roster — 9 October 2026

The user superseded the Bengaluru fixture with a test near **Naggar Castle,
Himachal Pradesh**, requested a full bus, morning pickup and evening drop-off,
the existing parent-demo child at a stop in both directions, and a maximum 5 km
walk. They explicitly chose normal morning/evening times, not immediate departure.

- Local demo school and logins are unchanged. Route
  `895d23b2-dd60-46a5-80dd-844094c4ec33` (`DEMO-NAGGAR-WALK`) has eight synthetic
  roadside pickup/drop-off points, five existing students per point, **40 riders**
  in each direction. No accounts or simulated phone-location samples were created.
- Pickup `1712c7d2-224a-46e0-877c-7ac5bc36594b`: **9 October, 08:00 Asia/Kolkata**;
  boarding opens **07:30**. Drop-off reuses
  `5ea993a2-388e-44b1-ac1d-3451462843c6`: **16:00**, boarding opens **15:30**.
  Both are accepted, planned and fully expected, ready for the user's test.
- Aarav/Pooja's stop in both directions is the road beside Naggar Castle:
  **32.111946, 77.164802**. A fictitious school meeting point is at
  **32.115339, 77.168281**. The stop sequence reverses for the return ride.
  The school label is a simulation, not a real Cambridge campus in Himachal.
- Public OSRM road geometry returned **838.3 m** for the selected stretch. Stops
  are interpolated along that road at approximately 100 m intervals, not scattered
  around a straight-line radius. About **1.68 km out-and-back**, leaving margin
  below the requested 5 km limit. This is mapped road length, not an independent
  pedestrian-access, terrain-safety or full-size-bus suitability certification.
  Castle reference: [Himachal Tourism site report](https://himachaltourism.gov.in/wp-content/uploads/2024/07/IEE-Report-Naggar-Castle-110724.pdf).
  Geometry: [OSRM road response](https://router.project-osrm.org/route/v1/driving/77.16464,32.11199;77.1689,32.1156?overview=full&geometries=geojson&steps=false).
- The prior 12-rider unobserved boarding fixture was reset to the evening planned
  ride with a higher revision. Its 12 plans were superseded by new current plans;
  older plans, handovers and audits remain intact. All changed state was validated
  before writing, and `trip.demo_walk_fixture_prepared` audits capture the previous
  fixture and test geometry. No unrelated recurring/future rides were altered.

Staff UI adds **All riders / Stop focus**. The focused roster uses fresh (<=90 s),
usable (<=75 m accuracy) phone observations to suggest a nearby pending stop within
75 m. Ambiguous close stops, missing coordinates and stale/poor GPS have explicit
manual stop selection and next-stop fallback; all riders remain accessible. Concerns
at other stops remain signposted. Morning boarded learners collect into the school-
arrival group rather than appearing to drop at their pickup stop. Routine actions
remain one tap with actor/time/revision/audit evidence. No position change records
an outcome. Stop selection is locked while entering an exception or saving, and
resolved-row announcements survive filtering. Staff maps show geotagged stop pins;
the family API still exposes only that family's learner, never the full stop roster.
Walking-direction links are user-initiated, not navigation promises or road ETAs.

Verification: **593 frontend tests / 78 files**, frontend build/typecheck/lint;
**37 focused backend tests / 4 files**, including **17 isolated real-DB tests**.
Two real-DB scenarios complete 40-rider buses across eight geotagged stops in each
direction, including note-free actions, per-child location privacy, audit count and
closure. Authenticated HTTPS WebKit loaded both actual planned rides under the
existing staff/parent accounts. A separate browser-only intercepted movement test
verified five-rider nearby focus, nine map pins (including school), changing focus
on movement, and one-tap boarding without altering the user's planned DB rides.
No page errors or horizontal overflow at 320/390/768/1024/1440px; mobile screenshots
were inspected. Local and HTTPS `/readyz` returned database/events OK. Physical
walking/GPS acceptance remains for the user; nothing was pushed or deployed.

#### Preview access update — 9 October 2026, 02:49 IST

After the checks above, ngrok exhausted its monthly bandwidth and began returning
HTTP 403 `ERR_NGROK_725`. The user approved a temporary alternative. The same
existing app/database is now reachable at:
**https://route-homeless-trembl-titans.trycloudflare.com**.

Official Homebrew `cloudflared` 2026.10.0 runs under the task-scoped launchd job
`gui/501/dev.eduvera.preview-https`, forwarding only to `127.0.0.1:8000`. Its local
ignored plist is `.runtime/dev.eduvera.preview-https.plist`, with logs in
`.runtime/preview-https*.log`. The original app service remains unchanged. To stop
only this temporary exposure, use `launchctl bootout gui/501/dev.eduvera.preview-https`.
Restarting it can generate a different hostname; read the current URL from the
error log and re-check `/readyz`. The computer/app/tunnel must remain online.
No new login, billing change, production deployment or database reset was needed.

The replacement passed authenticated HTTPS WebKit checks of both existing demo
accounts and both planned rides, and `/readyz` returned database/events OK.
Parent polling continued with SSE explicitly blocked (two requests on the existing
10-second interval). Browser-only mocked active-ride movement verified automatic
location attempts, nearby five-rider focus, nine map pins, one-tap boarding and
changing stops without writing to the user's actual planned rides. No page errors
or horizontal overflow at 320/390/768/1024/1440px.

This is a testing link, not production hosting: [Cloudflare Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
include no uptime guarantee and no supported Server-Sent Events. Family/staff
transport refresh remains available through existing 10/15-second polling;
instant cross-view event delivery must not be assumed on this temporary link.
Real phone permission, GPS accuracy, physical walking and weak-network behavior
still need the user's on-device review.
