# Facilities repairs

Status: owner-approved first-delivery contract, 24 October 2026. Implementation
and acceptance evidence belong in `IMPLEMENTATION_PLAN.md`; this contract alone
does not establish delivery or complete story 17.

## Person, outcome and operating experience

A resident reports a leak, a teacher reports a broken classroom light, or a
caretaker records a telephone/register complaint. They need the problem received
by an accountable person, a truthful next step and a checked repair. A technician
or supervisor needs to accept work, arrange access, explain delays and report
what was done. The designated verifier confirms success or requests more work on
the same issue. A small campus can do this with one handler; a larger institution
can assign current app people as handlers. A handler can record work reported by
a passive contractor without manufacturing that contractor's app acceptance.

Entry is the ordinary Repairs area. Report asks where and what, with an optional
photo. A known place/item supplies context; unresolved location text remains
explicitly unlinked rather than manufacturing a room. Optional assistance records
the affected/reported-by person separately from the authenticated recorder.
Configuration asks only for an accountable handler, a closure verifier policy and
optional emergency contact. No full hostel, department or asset inventory is a
prerequisite. Current scope, authority and missing routing remain visible.

Lists are finite, compact and source-backed. A detail explains the current status,
owner, expected time and next action together. Reporter and handler see different
permitted actions on the same record, not separate portals/editors. Work links to
the exact repair. Optional technical evidence uses the shared circled-i disclosure;
errors, emergency guidance and unresolved ownership are never hidden there.

## Published operating evidence, not field-observation claims

Reviewed 24 October 2026. Public procedures demonstrate supported variations, not
their measured adoption, compliance or prevalence across institutions.

- [IIIT Allahabad](https://cow.iiita.ac.in/services.html): register intake,
  supervisor ERP entry and vendor follow-up, student-confirmed closure.
- [IIIT Delhi](https://www.iiitd.ac.in/facilities/fms): phone, WhatsApp, email and
  portal intake, named assignment, external-agency expected time and complainant
  confirmation. Its own service targets are not platform defaults.
- [DTU](https://dtu.ac.in/Web/enggcell/ExecutionofWork/): phone/manual intake,
  complaint number, supervisor assignment, separately authorized materials and
  user confirmation; larger works follow a different approval path.
- [Karnavati University](https://kutimes.karnavatiuniversity.edu.in/comp_mgmt/main.php):
  staff-assisted entry and warden/maintenance-team verification.
- [Buffalo State](https://facilities.buffalostate.edu/work-orders): technician
  completion differs from supervisor closure; reopening can mean further work or
  a record amendment, so its reason must be retained.
- [UCL](https://www.ucl.ac.uk/study/accommodation/current-residents/maintenance-halls):
  emergency contact differs from routine intake; response and repair times differ;
  parts and specialist waits need progress communication.

## Authoritative ownership and DT path

Facilities owns intake-rule versions, repair state, assignments, reported progress,
claimed completion, verification/reopen, photo metadata and immutable receipts.
The original intake owner remains the repair's explicit accountable coordinator;
assigning a different worker does not remove that coordinator's oversight. The
current authenticated handler can operate only that assigned repair without
acquiring campus-wide setup or management powers. A current coordinator can
delegate/recover their own repair through source-specific authority; unrelated
technical managers receive only minimal orphan-recovery context, not its photos
or private problem. Coordinator replacement is an explicit retained operation,
not a side effect of changing the intake rule for future reports.
Canonical People, topology places and individually identified resource holdings
are referenced, never copied into a second catalogue. Membership or a descriptive
contractor affiliation does not grant operational authority.

Every material action follows the shared Model Core command gateway with an
identified current account/person/agent, scope/authority receipt, source revision,
exact command commitment and effective configuration. The native transaction
commits state, receipt, audit/outbox and correlated command outcome. Accepted
events and reviewed configured subscriptions produce durable exact-recipient
messages; the next person's authorized native action retains that lineage.
Core coordinates but does not own repair business state. Work is a projection,
not a second writable case store. No hard-coded all-administrator fallback,
implicit route, local scheduler or hidden default automation is allowed.

Settings activation is an explicit authorized command with immutable versions and
visible chosen owner/closure policy. Existing repair evidence pins its applicable
version. Reassignment records old/new owner and reason, rejects revoked actors,
and replaces/supersedes outstanding handoffs without inventing acceptance.
Authorized recovery must remain available when a handler leaves. An outside
contractor may be passive; a current campus operator can record reported work
with provenance but cannot fabricate that contractor's authenticated acceptance.

## State and correction invariants

- Reported, assigned, accepted, in progress, waiting, work reported complete and
  verified closed are distinct. Accepting responsibility does not claim work has
  started. An expected finish is an estimate, not a scheduled or completed visit.
- Waiting records a concrete reason (access, parts, contractor, approval or other)
  and any revised expected time. No access or vendor handoff is not completion.
- A report's urgency is a report, not an independently assessed emergency or
  guaranteed service level. No universal response/repair SLA is installed.
- Closure requires the configured eligible verifier's explicit action. Silence
  does not become acceptance. A verification failure or later recurrence can
  reopen the same source with a reason and retained earlier evidence.
- Reopening for a record amendment must not be presented as proof a repair failed.
  Append-only receipts retain who changed what, when and why. No rewriting history.
- Exact retries return the retained outcome; changed commitments, stale revisions,
  wrong tenant/world, disabled membership or wrong recipient fail safely.
- Shared-area duplicate reports may be recognized by people; text/name similarity
  never automatically merges reports or reveals private room photos.
- Submitting a repair does not grant room-entry permission. Access arrangements
  remain explicit and subject to the institution's actual policy.
- Repair notes do not authorize spending, receive a borrowed item, change occupancy
  or release a damaged resource. Each requires its own owning-domain operation.

## Protected photos and selected execution world

Only repair-authorized participants can upload/download its evidence. Accept
bounded JPEG/PNG bytes with matching signatures, sanitized names, immutable keys,
recorded size/hash and integrity-checked reads. Images are reports, not verified
physical facts. No public static upload route, broad directory access or private
photo/detail payload in shared refresh events. Preserve accepted metadata when
storage/read integrity fails, and allow exact retry without overwriting bytes.

Live and Simulation use the same domain services, screens and invariants, selected
database, effective clock and actor identities. Register all owning tables,
relationships, configuration, commands/events and artifact source coverage in the
same release. Simulation uses run-local bytes or an explicitly labelled omitted-
source placeholder, never a Live-file fallback. A real mutation in one branch
must leave its source and sibling unchanged. Version/conformance acceptance must
be refreshed only after reviewing and exercising the changed sources.

## Bounded first-delivery acceptance

26 October clarity refinement: use the existing authorized repair detail for the
current next person, an honest not-yet-shared estimate and latest meaningful
progress note. The latter is independent of history pagination and excludes photo
and assignment noise; it does not replace immutable receipts. Minimal orphan/
transfer recovery does not expose it. Less-frequent responsibility changes may
be collapsed, but broken routing stays a visible warning with recovery open.
Optional accept/verify notes and optional estimates are progressively disclosed;
native required explanations and explicit verification remain. A photo already
chosen when sending a report gets one initial upload attempt after the report is
confirmed. This is the same explicit user action, not a newly activated rule.
Photo failure never makes an accepted report appear unsaved, and unknown results
use exact command recovery rather than automatic retries.

Exercise ordinary founder setup and person-bound member accounts: short direct
report and staff-assisted intake, exact assignment/acceptance, progress/expected-finish updates,
parts/access delay and revised date, claimed completion, configured verification,
failed verification/reopen and eventual checked closure. Include permission,
cross-tenant, stale/changed retry, history, upload rejection/private reads, revoked
handler/reassignment recovery, exact Work links and retained pending outcomes.
Exercise meaningful mutation, privacy-minimized capture, source/sibling isolation
and retry in actual COW Simulation, not only a fake selected-world header.

Review common mobile/320px, keyboard-safe sheets, Light/Dark Live and Simulation,
loading/empty/denied/error states and real UI interaction. Record automated,
browser, physical-phone, hosted and owner acceptance separately.

Temporary accommodation, reservations, actual moves, key issue/return, procurement,
vendor billing, preventive maintenance and full service-team/escalation rule
management are separate extensions unless explicitly verified in the delivery
record. A checked repair alone is not the complete hostel story ending.

## External technician work

This bounded extension assigns a named external campus person to an existing
repair, not a second contractor job or visitor portal. From the repair, its
coordinator reviews exact shared instructions, selects a canonical person, chooses
an explicit access end and optionally shares selected photos. Shared Add people
handles a missing person. Employment, a company record, visitor category or a
physical visit is not required.

An existing account continues to that job. A person without app access joins
through the neutral-person invitation and independent mailbox proof. Joining
links identity but never accepts work; a pending invitation neither creates an
active recipient nor transfers the current handler's responsibility. One explicit
Accept job action binds the preapproved handoff to the authenticated recipient
and accepts responsibility. The technician reports progress, access/parts delays,
estimates and work done through normal repair actions. Campus verification, not
technician completion, determines closure. Returning to the same job does not
require registering another visit.

### Exact work access and private projection

Facilities owns an immutable revisioned grant for one person, one repair and a
half-open `[starts_at, ends_at)` interval. Omitted start uses owning execution time;
the coordinator must choose the end. A repair estimate is not authority expiry.
The 365-day maximum is an engineering bound, not an employment policy. Changes
and endings retain old source, signer, reason and evidence. An activated handler
is not silently renewed: end that assignment and recover unfinished work to a
campus handler before issuing a new invitation. Expiry during independent campus
verification does not reopen completed work; a later reopening needs explicit
handler recovery.

The technician receives only exact shared instructions, place/item, campus
contact, selected evidence and their own permitted work history. Private reporter
details, original complaint, internal notes, unrelated history and unshared photos
are absent from the response, not merely hidden by UI. They gain no coordinator
or verifier power. Uploads and updates retain their owning records/provenance;
internal verification/reopening notes need a separately reviewed sharing action.

A work-only invitation creates ordinary neutral membership limited to assigned
work, not a visitor role or portal. Existing independent membership is never
downgraded; nor does membership alone widen the repair's private projection.
Independent source roles retain only their own powers. Reads, commands, photos,
lists, Work and event/replay all recheck source scope after selected-world binding.
No directory, place/resource catalogue or unrelated domain becomes browsable.
Revocation/expiry removes this source's future access without erasing identity,
other jobs or repair history. A safe own-command receipt can confirm acceptance
without reopening newly protected details.

### Invitation, handoff and uncertain-result recovery

The source continuation is server-owned and resolves only after authentication,
campus selection, exact accepted-recipient and current-grant checks. A forwarded
URL is not identity or authority. Mail failure remains explicit; no manual
mailbox-proof bypass is permitted. A new authorized invitation may retire only
that person's obsolete pending invitation for that exact repair. Other jobs,
accepted identity and unrelated access remain untouched. Queued mail rechecks its
source before sending so ended/replaced grants cannot deliver outdated invitations.

Pending joining is Waiting, not repeated coordinator attention. When an unfinished
handler loses access, campus recovery has an explicit owner; an already-pending
verification stays with its independent verifier. No departure is inferred.
Activation and native repair acceptance are separate typed commands whose IDs and
payloads are retained before sending. Unknown activation blocks acceptance until
its receipt is reconciled; unknown acceptance keeps its own key. GETs, photos and
campus invitation acceptance have no work-acceptance side effects.

Facilities owns grants, current pointers and immutable receipt snapshots. People
owns canonical identity; Auth/People owns account invitation, proof and technical
membership. Prepared authority/revision-checked native commands, events, configured
exact-recipient handoffs and correlated outcomes retain the Core coordination
thread. Private instructions/photos stay native; shared refreshes carry minimum
references. This grant implies no gate entry, room access, procurement, supplier
bill or payment authority.

### External-work acceptance

Exercise coordinator and technician together: invitation/identity recovery, exact
continuation, pending joining, accept/delay/return, selected photos, claimed finish,
independent verification and reopening. Include combined internal/external roles,
unrelated-source denial, before-start/exact-expiry/revocation, second-job continuity,
stale/changed retries, evidence tampering and private event replay. Same-service,
real-COW grant/progress/expiry mutations must leave Live and a sibling unchanged.
Real account issuance/outbound delivery remain Live control-plane effects, never
borrowed by Simulation. Mobile, Light/Dark and blue/amber checks are separate
from real inbox and physical-phone acceptance.
