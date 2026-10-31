# Activity scheduling and attendance

Status: owner direction accepted 20 October 2026. The unified foundation is now
implemented locally; the original scoped integration and visible-UI acceptance
passed against revision 21. Fresh-account setup, role separation and retained-
history corrections are verified through revision 27; see the
[20 October QA record](../VERIFICATION.md#operations).
**This is not a hosted-release or whole-platform completion claim.**
This revision supersedes this document's earlier proposal for **Staff duties** and
**Staff Attendance** branches. It does not supersede historical delivery evidence.

Parents: [Product blueprint v2](PRODUCT_BLUEPRINT_V2.md),
[Operating experience](THATCAMPUS_OPERATING_EXPERIENCE.md),
[Universal institution model](UNIVERSAL_INSTITUTION_MODEL.md) and
[Model Core blueprint](THATCAMPUS_MODEL_CORE_BLUEPRINT.md).

Existing domain contracts remain applicable:
[Annual schedule planning](ANNUAL_SCHEDULE_PLANNING.md),
[Roles and contextual assignments](WORK_PROFILE_ACCESS_ARCHITECTURE.md) and
[Campus scenario simulation](CAMPUS_SCENARIO_SIMULATION.md).

## 1. Accepted owner decision

Timetable and Attendance must describe **what is happening, when, where, who is
expected and what participation needs to be recorded**. They are not separate
student and employee products. A guard, learner, instructor, contractor or visiting
participant uses the same person identity and may participate in several contexts.
Job title and affiliation do not select the engine, editor or portal.

One Timetable presents authorized scheduled activities. One Attendance workspace
presents authorized registers. Purpose-specific vocabulary and validated context
adapters make each task understandable; one foundation does not mean one enormous
generic form or weakened domain rules. A lesson may need a subject and enrollment;
a duty must not require an artificial class, academic term, student or subject.

This is a transformation of the existing Digital Twin system, not a second ERP or
an attendance application attached to it afterward. Real Live workflows and their
usability lead acceptance. Simulation parity is mandatory in the same delivery but
does not substitute for Live workflow evidence.

## 2. Experiences the shared model must express

These are acceptance contexts for one foundation, not a menu of new modules or a
claim that every context is already supported.

| Operating context | Relevant detail, without a separate engine |
| --- | --- |
| One tutor or coaching batch | One person/group, optional place, recurring or one-off session; no formal year or departments unless needed |
| School class or daily attendance | Existing class, enrollment and class/day or lesson grain; subject only where relevant |
| University course, elective or practical | Offering-specific eligible roster, cross-class participants, rotating groups and shared instructor/space constraints |
| Duty, shift or service | One or more existing people/team, explicit interval including overnight, location/resource and operational eligibility |
| Workshop, training, club or meeting | Mixed participants regardless of affiliation, facilitator and optional attendance |
| Event or examination | Existing owning-domain plan, eligible audience/candidates, consent/readiness and staffing rules retained |
| Online, hybrid or off-site activity | Explicit virtual/external context and timezone; participation does not assert physical campus presence |
| Daily check-in or unscheduled attendance | Explicit authorized date/window and roster source, without fabricating a timetable lesson |
| Room or equipment reservation | Resource expectation; no human attendance register unless participation is explicitly required |

Asynchronous learning completion, gate entry/exit, journey boarding and physical
handover retain their own evidence semantics. They may appear as related context;
they are not automatically converted into activity attendance. Unsupported context
types are explicitly unavailable, not silently approximated with student records.

## 3. One purpose-first experience

### Timetable: schedule the activity, not the person's category

An authorized planner opens the existing calendar and chooses **Schedule activity**
or selects a free interval. Familiar purpose presets reveal only relevant fields:
for example lesson, duty, training or meeting. Presets are reviewed context schemas,
not separate planners or arbitrary executable workflows.

The shortest journey connects:

1. **Activity and people:** a clear title/purpose, existing people or eligible group,
   and the responsible people. Reuse a class, cohort or team when it is already the
   correct roster source. Person lookup/create is shared with People, never a
   timetable-only directory. Duplicate candidates require explicit review.
2. **Time and place:** one date or repeating pattern, local start/end, timezone and
   optional physical/virtual place or resources. Repeat and advanced constraints
   appear only when needed. Overnight explicitly says **Ends next day** and review
   shows both dates. A bounded expansion horizon does not impose an arbitrary end
   on a legitimately open recurring plan.
3. **Review and publish:** expected people, applicable attendance requirement,
   effective dates, recorder responsibility and actionable conflicts. Saving a
   draft neither publishes it nor activates authority, attendance or notifications.

Keep this in a focused sheet or short Details / Time / Review sequence when the
task needs it. Do not impose three pages on a simple one-off entry, require a
student/staff choice or expose all context fields simultaneously.

Attendee, instructor/facilitator, organizer, assigned operator and authorized
attendance recorder are context roles, not mutually exclusive kinds of person. A
recorder can record others without being an attendee. Scheduling a recorder does
not itself grant permission; the flow reuses valid authority or clearly requests
its separate setup. A no-account person can be scheduled and recorded without email
or an invitation. Optional app access later links to that same person.

App-access clarification, 20 October 2026: People derives account status through
the reviewed Core identity port, not only student/staff/guardian compatibility
profiles. A renamed founder remains **App account · You**. Retained but inactive
access is labelled inactive; inviting must not reactivate or replace it.

For an unlinked person, an authorized administrator can choose **Invite to app**
and enter only the recipient's email. Acceptance links that exact existing person
and stable human agent after email-code possession and account authentication.
It creates a neutral `member` membership, not a student, staff or guardian profile,
enrollment, assignment or operational permission. The recipient can see their own
already-scheduled work; recording/reviewing attendance or managing people still
requires separately established current authority. Pending, expired and revoked
invitations remain distinct from accepted app access. A conflicting existing
campus identity is refused rather than merged by name or email.

Account credentials, membership issuance and invitation delivery are Live account
control-plane actions. Simulation captures existing identity facts and uses its
own canonical person/account-state projection, but must not send invitations,
create real accounts, reactivate access or silently switch the administrator to
Live. The common People UI explains this boundary and hides invitation controls
in Simulation. Meaningful run-local identity/name changes remain isolated from
Live and sibling runs; no second simulation-only person directory is introduced.

Fresh-account acceptance clarification, 20 October 2026: the activity lead remains
in the scheduled footprint and conflict checks, but lead-only participation has
`attendance_expected: false`. Explicit direct or eligible-group participation
sets it true, including when the same person is also lead, recorder or reviewer.
The register and Today participant counts follow this expectation; assigning an
operator never silently selects them as an attendee. Retained occurrence/register
snapshots and accepted history are not rewritten to repair an old selection.

Attendance-first setup opens the shared activity editor at the selected campus's
current local time. It must permit saving an incomplete draft without appointed
operators; publication still requires valid explicit recorder/reviewer assignments.
Review distinguishes attendees from responsible operators. Confirmation returns
to the saved draft or the correct dated attendance queue rather than leaving the
administrator to rediscover their first activity.

Timetable-first creation uses the same editor without silently requiring
attendance. Retain the accepted source plan and revision in a vetted continuation
so reload, Back and prerequisite return do not select a different draft. The
owning API rechecks current identity, authority, world and source revision; stale
links require review and never overwrite current truth. Keep the accepted draft
when publication fails or its response is unconfirmed. Saving is not publication,
and publishing is not proof that the activity happened. Personal automatic resume
must not take over another manager's draft; deliberate shared planning remains
subject to the ordinary manager checks.

An empty location picker is not a setup dead end. Where location is optional,
offer **Choose place later** without creating a placeholder campus/place. An
authorized active administrator can **Add place** inline through the canonical
institution-setup service, then continue the unchanged activity with that place
selected. Explicit first-place creation may atomically create a primary campus
only after explaining that effect. Existing/multiple campus selection, retries,
foreign/inactive targets, current authority and the exact prepared Core command
binding are checked in the owning transaction. Reuse this flow in Simulation;
do not introduce a timetable-only places directory or Live fallback.

Selecting a published activity opens its details and permitted dated change,
cancellation, substitution or correction path. Review the effect on future
occurrences and retain past expectations/evidence. Offers needing acceptance keep
their own response state; publication cannot manufacture acceptance or coverage.

An existing event, assessment or journey remains edited through its authoritative
domain action. Timetable shows its scheduling footprint and opens that action; it
does not create a second event, exam or transport editor.

### Attendance: open the activity and record its participants

One dated queue shows only registers available through the user's current
responsibility. Each row says activity, time/window, place where relevant, expected
participants and truthful state. Optional filters are by activity, people/group,
place and status—not an obligatory **Students / Staff** split. Today and Work link
to the same exact register rather than providing another editor.

Open the register, record participation, review unrecorded people and submit once.
The same participant interaction serves a learner in a class, a guard on a duty and
both in a training session. Relevant identifiers/statuses come from the context;
admission number, academic term and subject are not universal required fields.
Attendance not required creates no overdue register.

Untouched rows remain **Not recorded**. Explicit bulk actions preview and affect
only the intended eligible rows; missing evidence never becomes absence. Capture
and review retain source, observation time and received time. Check-in/out or
duration capture is available only where a supported context/rule calls for it;
a roll-call mark does not prove continuous attendance or working hours.

After submission show who recorded it, source, state and correction/history action.
An authorized correction requires a reason and preserves prior evidence. A
substitute, unexpected participant, enrollment/group change, late evidence,
contradiction or unscheduled attendance follows an explicit review path; opening a
register never silently edits the published roster. A cancelled activity is not an
unsubmitted or absent register.

Submission is **Submitted**, not Final. The current explicitly appointed
reviewer with effective review permission receives a source-linked Work task and
Today attention for an unresolved submitted generic register, including older
dates. Technical administrator status alone does not assign that work. The owning
register rechecks authority/revision when opened or changed; accepted finalization
clears the projected obligation. Do not infer an overdue deadline, send automatic
notifications or create a second task-completion store to implement this read
projection. A healthy, approved automatic policy whose scheduled instant is still
future is **Automatic pending**, viewable without required human-review work. The
retained/current policy, active approver, roster revision/fingerprint, required
marks and evidence must match. At the exact scheduled instant, an unfinalized
register returns to its reviewer as overdue; this is not a claim that a worker
failure was diagnosed. Changed/blocked policy, pending evidence and reopened
records also retain explicit human review. Do not revoke an appointed reviewer's
deliberate manual override. Executor health before due remains unavailable through
the current read port. Queue categories distinguish To record, Awaiting review,
Automatic pending and Final; only accepted locking makes a register Final.

### Keep common work small and recoverable

School-approved student leave is an administrative exemption, not a physical
participation report. The owning academic adapter applies it through the same
attendance kernel and retained register revisions, never an archived legacy writer.
The kernel rechecks the actual approved leave, concrete deciding administrator,
institution, dated enrollment, exact daily roster/term/date and expected revision.
An exemption may cover a future instructional date, but never creates a physical
observation or invented observation time: its `approved_leave` source is explicit,
its decision is `excused`, and its observation time is unknown/not applicable.
Existing present, late, half-day or other non-absent decisions remain untouched;
locked/cancelled registers fail closed. Leave approval, source audit, exemption
history and typed command/event/outcome commit together or roll back together.
Derived subject counts still stop at the selected campus-local date, so future
leave does not manufacture classes already held. Ordinary attendance opening,
capture and recipient-response restrictions are unchanged in Live and Simulation.

Reuse the shared shell, calendar, date controls and focused sheets. Preserve date,
filters, draft, selected item and return path. Use finite pages for register
collections, person results and history; scroll purposefully within a calendar,
roster or coherent form. Large group actions apply to an explicitly stated scope,
not an invisible page selection. Include loading, empty, missing prerequisite,
revoked access, stale revision, offline/pending sync and safe retry states.

Progressive onboarding asks what the person wants to run and only its actual missing
prerequisites. Recording participation must not require **I teach this group**, a
staff login, an academic year or a full campus hierarchy when the purpose does not.

## 4. Shared domain model, distinct owners

The minimum conceptual chain is:

```text
People / effective groups + places / resources
 -> owning-domain plan and immutable published version
 -> stable dated occurrence or explicit daily/window context
 -> participation expectation / applicable roster revision
 -> source-bearing observations
 -> accepted attendance decisions and register revisions
 -> corrections, projections and configured next-owner work
```

These are typed domain records and references, not generic graph/EAV business data.

- **People** owns stable institution-scoped person identity, affiliations and
  effective group membership. A person can have several affiliations. Contact
  details do not merge people. Participation eligibility, app access, acting agent
  endpoint and responsibility authority remain separate.
- **Planning** owns plan validity, participant/resource expectations, recurrence,
  publication, exceptions, cancellation and conflict decisions. A teaching context
  retains its academic class/term/enrollment constraints through its adapter, not
  as mandatory columns for all activities. Other authoritative planning domains
  register their own plans/occurrences through the same reviewed contract.
- **Attendance** owns one participant-neutral register/evidence lifecycle: applicable
  roster, capture, reconciliation, submission, finalization/reopening and correction.
  Typed context adapters resolve eligibility, grain, supported capture/statuses and
  context-specific invariants. Do not add a guard-only table/service/worker or keep
  independent student and staff attendance engines behind one screen.
- **Authority** owns who may plan, publish, view, record, review or correct within
  effective scope. Being a participant, instructor or scheduled operator never
  silently grants those permissions. Each material command rechecks current
  authority, target revision and applicable rules in the owning domain.
- **Operating rules** own institution choices about capture windows, reminders,
  finalization, escalation and permitted routine automation. Supported templates
  produce explicit versioned configuration, not hidden defaults per person type.
  Academic, operational or event constraints are not weakened by a preset.

Roster resolution retains its source, effective time, recorded-as-of boundary and
revision. Occurrences pin the applicable expectation; later group changes do not
rewrite submitted evidence. Joining, leaving or substituting uses a supported
effective change/correction with retained lineage. Live eligibility is never
resolved by querying today's membership to reinterpret an old register.

Publication checks conflicts using the same canonical person, place and resource
identities across purposes. The person who teaches in one activity and attends
training in another is checked once, not as two accounts. Constraints distinguish
required participation, optional invitations, capacity, availability and unresolved
assignment acceptance. Permitted overrides require explicit authority and reason;
an unoverridable domain/privacy/safety invariant remains blocking.

Time uses actual half-open intervals, explicit local dates and IANA timezone, with
declared DST gap/fold behavior and historical interpretation. Adjacent intervals
need not conflict; overnight/multi-day intervals must overlap correctly. Closure,
dated exception, substitution and bounded-version precedence is owned and explicit,
not a universal assumption that every activity stops on an academic holiday.
Unbounded recurring plans expand only bounded requested/worker horizons with stable
occurrence identity and retry-safe progression.

## 5. Digital Twin is the operating path

Every material action must use the existing reviewed path:

```text
identified human/device/integration command or observation
 -> current identity, purpose-specific authority, time/rule/context evidence
 -> owning-domain execution and invariant checks
 -> transactional accepted records, audit and outbox
 -> correlated Model Core outcome/event
 -> rebuildable expectations/evidence projections
 -> configured next-agent work or explicit terminal/correction state
```

Reuse the command gateway, human identity, observation and temporal ports. The
current academically shaped temporal projection needs a versioned neutral
plan/occurrence contract; domain adapters perform domain recurrence/exception
resolution and Core preserves stable references, time and provenance. Do not add
class, student, guard or duty-specific workflow branches to the kernel. Frontends
call domain APIs and never operate Core persistence or a graph editor.

Participant identity need not be an acting agent endpoint. A no-account attendee
remains a People identity; the actual recorder signs the command. Eligible active
agents receive run-local counterparts in Simulation, without creating real account
access or inventing behavior for passive participants.

Plans are expectations; reports are observations; accepted marks are domain
decisions. Gate entry is not activity attendance; attendance is not proof of work
completion, payroll entitlement, continuous location or physical handover.
Configured messages retain ownership, response, correlation and correction; reading
an Update does not submit attendance or accept an assignment.

## 6. Compatibility migration, not two permanent systems

Pre-implementation gaps verified 20 October (historical audit; the local delivery
checkpoint below supersedes these as a statement of current implementation):

- recurring drafts require class/term, use teacher account IDs and same-day periods;
- Core occurrence contracts require academic class/period fields and perform
  academic recurrence themselves;
- scheduled attendance requires class/term/subject/student and same-day intervals;
- People/setup and onboarding use apparently neutral labels over student/class or
  account-required staff creation;
- event/exam participation has its own student-bound storage and validity rules;
- planner commands have local idempotency plus audit/outbox but no pre-domain Core
  command gateway; scheduled attendance also needs full gateway adoption. These
  after-the-fact integration seams are gaps, not patterns to repeat.

Deliver the transformation in end-to-end slices over shared contracts:

1. Prove the smallest mobile lesson, no-account overnight duty and mixed training
   journeys using the same calendar/register interaction and explicit authorities.
2. Introduce reviewed person/group/participation and neutral plan/occurrence
   contracts with compatibility mappings for existing records. Preserve domain IDs,
   historical source references, revision/correction lineage and current access.
3. Migrate academic scheduling and attendance into specializations of the common
   foundation while adding the non-academic cases. Reconcile counts, evidence and
   permissions before an atomic owning-context cutover. Temporary compatibility
   reads/redirects delegate to one authority; there is no dual writable source or
   permanent second engine. Do not fabricate old observations or silently rewrite
   migration checksums/history.
4. Reuse the shared participant interactions for event/exam contexts through their
   owning adapters; preserve consent, RSVP, candidate eligibility and publication
   rules. Remove duplicate action paths only after capability-preserving acceptance.
5. Adapt and test Simulation, time workers, Today/Work, queries, realtime/cache,
   metrics and conformance alongside each affected slice, not after platform work.

The canonical frontend presentation lives in `features/attendance`: one
`AttendanceRegisterView` composition and one `AttendanceParticipantRow`. Academic
and activity adapters retain their current data, authority, evidence and recovery
contracts; examination and event adapters retain their owning eligibility and
lifecycle rules while consuming the neutral participant interaction. These are
legitimate domain adapters, not permission to retain a second register page or
visual system. After capability-preserving cutover, remove the superseded
implementation, exports, wrappers, imports and styles in the same change, and move
its behavioral tests to the canonical owner rather than leaving compatibility UI
behind. Presentation cleanup does not authorize deletion of retained backend
records, provenance, compatibility projections or domain adapters; those require
their own reviewed migration and parity evidence.

The migration must not interrupt existing campus business. A plan or contract is
not delivery evidence. Record migrated contexts and remaining unsupported cases in
[the implementation plan](IMPLEMENTATION_PLAN.md); do not claim this transformation
after relabeling a selector or sharing only a frontend row component.

## 7. Acceptance before completion

1. Visible Live UI proves a lesson and daily attendance, a no-account overnight duty,
   and mixed-person training through the same foundation. No artificial student,
   class, subject, academic year or app entitlement is created for a duty/training.
2. Validate one-person coaching, elective/rotating groups, multiple campuses,
   virtual/off-site activities, optional/no attendance and authorized unscheduled
   recording. Distinct realm/campus scopes never leak authority or records.
3. Exercise person/resource conflicts across purposes, leave/unavailability, adjacent
   intervals, midnight, DST, closure/exception precedence, cancellation, substitution
   acceptance, group lifecycle changes and historical roster preservation.
4. Prove current/revoked recorder authority, stale/duplicate/changed-payload retries,
   future/closed windows, no evidence, late/offline/contradictory input, explicit
   submission/finalization and reasoned correction. Missing data remains unknown.
5. Verify pre-domain commands/observations, accepted outcomes, immutable event/source
   lineage, audit/outbox, deterministic occurrence replay and exact Today/Work links.
   A projection outage cannot conceal already accepted domain truth.
6. In a fresh Simulation, use the same screens/services in amber to change a plan
   and attendance, advance across days/midnight and configured worker transitions,
   then return to unchanged blue Live. Test unchanged sibling runs, independent
   Live users, tenant/run separation, recovery/idempotency and sink-only effects.
7. Update privacy-safe snapshot coverage, counterpart identity, virtual workers,
   artifact/effect isolation, metrics, query/realtime/cache scope and executable
   conformance together. Unknown human behavior remains unknown without an
   explicitly approved policy. Capture/source scans alone are not parity evidence.
8. Record mobile/keyboard/recovery results, steps and repeated entry avoided, plus
   migration/API/UI tests and remaining limits. Local verification, hosted readiness
   and owner-device acceptance remain separate claims.

## 8. Local delivery checkpoint — 20 October 2026

The local branch now uses one person/activity/occurrence/register foundation.
Academic daily/session attendance and event/examination attendance delegate accepted
decisions to the shared kernel. Owning adapters retain their eligibility, consent,
candidate, assignment and lifecycle rules. Imported academic/event/exam tables are
read-only compatibility projections over retained provenance, not second accepted
writers. Pending paper reports remain evidence until an appointed reviewer decides.

The common timetable supports no-account participants, mixed groups, optional or no
attendance, place reservations, online/off-site context, overnight intervals,
once/weekly recurrence and bounded expansion of unbounded plans. Published rosters
retain their source and labels. One-off moves cancel the original future occurrence;
disjoint dated replacement windows preserve the original plan outside each window.
Cancellation is explicitly plan-version-specific: separately published replacement
plans are not silently cancelled. Current authority, conflict and owning invariants
are rechecked through pre-domain Model Core commands and retained outcomes.

The ordinary UI has one calendar and register queue, finite pages, a three-step
activity editor, exact occurrence-to-register navigation, reasoned corrections,
history and explicit submission/finalization. No-account person creation and
name-only institution-person correction are separate from account access. Dated group
membership editing preserves prior membership and explains that an already published
plan requires a reviewed change to capture a different roster. Informational
affiliation editing and general person/group retirement are not delivered by these
controls; they must not be inferred from a name or membership correction.

Physical-exam invitations now have institution-neutral explicit administrator
approval, selected eligible recipients, immutable timing/configuration evidence and
safe disable. Replaced or expired invitations require explicit reissue and a new
recipient response. There is no Cambridge default, implicit acceptance, attendance
grant, reminder worker or escalation promise in this setup.

Visible local UI evidence includes: a mixed learner/no-account-worker register with
submission, reasoned correction and finalization; unbounded overnight duty; academic
paper evidence remaining pending until review; a bounded20× scenario with automatic
attendance and an ended read-only register; shared-duration comparison with a
different-snapshot warning; and Return to Live restoring the original register list
without the scenario activity. Screenshots are retained in
`artifacts/unified-activity-ui-20261020/`.

Database/API verification additionally exercises current/revoked authority,
cross-purpose conflicts, historical roster preservation, source/evidence forgery,
retry/rollback, source-safe outbox upgrade, discriminator-safe compatibility views,
and actual accelerated selected-world event/exam operations with unchanged Live and
sibling records. Final conformance revision 21, build and compatibility checks pass.
The full frontend checkpoint passed 238 files / 1,434 tests. The explicitly selected
backend regression passed 212 files / 1,376 tests, with one file / five tests skipped;
the exact exclusions are retained rather than counted as passing. Separate actual
Product and owning event/exam HTTP journeys also passed against the final compiled
binary. Final UI acceptance caught and corrected moved-activity calendar/list/count
disagreement and ambiguous same-weekday future duty labels, then verified both
through Safari. The application was left in blue Live with no active QA simulation.

Evidence and scope boundaries:
[visible acceptance journal and screenshots](../../artifacts/unified-activity-ui-20261020/README.md),
[backend regression receipt](../../artifacts/documentation-history-20261029/unified-participation-product-regression-2026-10-20.json),
[implementation checkpoint](IMPLEMENTATION_PLAN.md).
Ready conformance is not whole-platform parity: 117 broader capability-evidence gaps
remain explicit. The undelivered lifecycle controls and deployment/hardware/provider
release gates above remain open; this does not certify an entire hosted release.
