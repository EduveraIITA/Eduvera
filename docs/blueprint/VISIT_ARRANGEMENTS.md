# Campus created visit arrangements

Status: bounded implementation contract, 26 October 2026. Delivery evidence and
remaining acceptance gates belong in `IMPLEMENTATION_PLAN.md`.

## Purpose and shortest journey

A campus reception or coordination operator with current institution-scoped
Manage In & Out authority opens **Areas → In & Out → Visits**, enters a guest or
explicitly selects an existing campus person, sets the window and meeting
destination, and retains a named campus contact. Confirming saves the plan in one
action, without a second student/host decision or a compulsory follow-up task.

One organiser and a count suffice for a group. Individual child rosters, accounts,
phone numbers, photos, identity documents and employment profiles are not required.
The coordinator changes or cancels the same arrangement and inspects prior
versions. A stale person or version requires review, not silent substitution.
An ambiguous network result keeps the exact command until its outcome is known.

## Meaning and ownership

Gate owns a physical arrangement, not an event, repair, academic appointment or
general workflow. Those domains retain their activity and work. This increment
does not copy their jobs or accept arbitrary source links; reuse their own
arrangements when they already supply these facts.

People and Campus setup own the canonical person, campus and destination. A guest
name never matches itself into a person or account. One known organiser with a
group count does not identify every participant. A receiving contact gains neither
authority nor an automatic task. The original arrangement slice was
coordinator-only; the organiser-sharing extension below adds exact guest access.
The owner's30October group-registration extension adds a bounded public entry
for one visit, without general campus membership or a visitor directory.

## Sharing the existing visit

Accepted increment, 26 October 2026; implementation and acceptance remain tracked
separately in the delivery plan. A coordinator opens the existing arrangement,
chooses one canonical person as its organiser and shares it. A known visit person
can be preselected; a provisional guest/group name never silently becomes a
person. Sharing does not rewrite the visit's recorded party. One organiser can
represent a group without accounts or individual tracking for its members.

The short sharing sheet contains that person, optional reviewed directions and
an explicit **Available until** date, prefilled from the planned visit end. Access
begins when shared, so the organiser can prepare before arriving. The sharing
deadline is independent of later plan edits: cancellation remains visible while
access is valid, and rescheduling does not silently extend authority. The campus
can renew or revoke sharing. Replacing a party invalidates its prior sharing;
changing it back cannot resurrect the old grant. A new organiser/party receives a
new private source; renewing the same organiser and unchanged party preserves
their question thread. Passing a visit's end invents neither presence nor work.

An existing authenticated person opens the same Visits surface. A person without
an account uses the existing People invitation and independent recipient proof,
limited to this shared source. Another independent campus membership remains
additive. Neither an emailed locator nor the contact's name grants Gate authority.
After joining, the locator follows only its still-valid exact organiser/party
sharing root, including renewal or an explicit question-owner takeover. Losing
the original coordinator does not cancel otherwise valid guest access. A pending
invitation still requires a current authorised issuer; an old root never becomes
access to a replacement party.
Live identity issuance stays unavailable in Simulation; captured people use the
same selected-world sharing and question services.

The guest response is a separate minimized native projection: current purpose,
planned time, destination, named campus contact, reviewed directions, cancellation
and safe post-share plan changes. It excludes movement evidence, internal editor
identities, profile/contact records, unrelated visits and pre-share history.
Opening a shared visit never falls back to the manager response. Sharing is not
an entry pass, host consent, room reservation or acknowledgement of attendance.

## One registration link for a visitor group

Owner decision,30October2026: the visit's primary action is **Invite visitors**.
One reusable link lets each visitor register themselves; individual named
invitations are not required for a group. Organiser coordination remains a
separate optional section, with its existing private question owner and history.
Implementation and rendered acceptance remain separate in the delivery record.

A current Gate manager explicitly creates, replaces or revokes the link after
reviewing the expiry. The initial expiry uses the planned visit end; later plan
edits never silently extend it. Revealing the current link is an explicit,
nonmutating action. A second gesture opens the device Share chooser, opens an
unaddressed email draft, or copies the link. Opening a chooser or draft proves
neither delivery nor registration. Link copies are sensitive and cleared from
the management screen on departure, backgrounding or a changed source/context.
Persist only opaque command recovery evidence, never the secret link.

The locator uses the public frontend's exact `/visit-join` route with its secret
in a fragment. Public entry removes that fragment before requesting a minimized
preview, then retains only a bounded process-local continuation through ordinary
sign-in, verification and MFA. A new account first proves its email address and
uses the existing password policy. Account creation alone creates no session,
campus person or membership. Unavailable email delivery remains explicit.
Native app entries capture the exact fragment before router URL normalization and
replace it with the same origin-bound volatile nonce; query-token substitutes do
not become valid invitations. Returning from sign-in or the background rechecks
current link validity. A terminal refusal removes cached preview details while
retaining any dispatched command for its original actor; it never manufactures a
new successful registration. Preview dates and destination reuse the own-visit
card, without adding private contact or general map access to the public preview.

After ordinary authentication, a verified active account explicitly registers
itself. An existing current canonical identity is reused without changing its
access. A genuinely unlinked account receives one canonical person and only the
technical `member/assigned_work` connection required to open its own registered
visit. Retained/revoked identities require campus review; no name or email match
claims another person or restores access. The owning Gate/Core transaction keeps
the exact registration, actor, source, command, event and outcome together.

Registered visitors see only their own minimized purpose, planned dates, place,
campus contact and registration evidence. They gain no organiser thread, other
visitors' roster, People directory, Gate operation, general campus map access,
entry permission or presence evidence. Cancellation remains readable while the
exact registration access is otherwise current. Link revocation, expiry,
replacement or lost issuer authority fails closed. Planned party size,
self-registration count and observed movement counts remain distinct.

Public account creation, mailbox proof and real self-joining are Live account
control-plane actions. They refuse Simulation rather than borrowing a Live
credential. Captured link metadata, own participant projections and a meaningful
branch-only link change still use the same selected-world Gate owner, authority,
clock and immutable evidence, with unchanged Live and sibling state required.

The visit details use one heading and a grouped Starts/Ends/place/contact card.
Entry and exit icons distinguish the scheduled endpoints without labelling them
as actual arrival/departure. Contact or destination chevrons appear only when an
authorized canonical destination is available; a display label never supplies
an invented identity or map route.

## Destination selection and schedule context

The shared React Native editor offers categorized, immediately searchable current
places and **Choose on campus**. Categories cover the complete paged authorized
catalogue; published building/floor ancestry distinguishes repeated room names.
A visual chooser uses the same published campus renderer and canonical IDs as
Virtual campus. A manager's destination chevron opens a floating preview of its
actual containing building; display names never guess a location. Unmapped places
remain explicit, with no private draft substituted. Visitor/participant projections
do not thereby acquire general map or People access.

The overview offers **Choose entire campus**; selecting a building offers the
entire building or its mapped floors/rooms. Campus and space IDs remain distinct:
Gate accepts exactly one physical place or one active physical campus. This does
not create a synthetic room or change topology. Each selection rechecks its exact
current Gate eligibility, then returns only to the unsaved parent editor. Saving
uses the existing revisioned Gate command and retains destination history, actor,
Core context and exact retry evidence. Whole-campus plans retain the canonical
campus context; old place-based plans and historical snapshots stay readable.

For a valid visit interval of up to 35 inclusive campus dates, the chooser reads
all authorized published timetable pages through the selected-world activity
owner. Half-open intervals permit an activity ending when the visit starts.
Building/floor checks include mapped descendants; campus checks explicitly cover
mapped places. Yellow geometry and a textual count indicate scheduled conflicts;
absence of a conflict is **No scheduled conflict**, never a booking guarantee.
Missing/partial authority, an unsupported interval or an unavailable read remains
**Availability not confirmed**. Unknown is not free. Other bookings, closures,
exclusive campus use and a general reservation owner are not certified by this
check. Selection does not reserve anything or block an otherwise authorized plan.

Management, boundary observations and retained history are fully presented rather
than hidden to conceal unfinished controls. Each history row opens its immutable
saved plan and observation in a read-only sheet. Historical labels are never
reconstructed from current People/place records; missing labels stay explicit.
The sheet cannot carry a selection across accounts, campuses or selected worlds.
Observed counts begin empty, stay bound to the visit revision and require an
explicit whole count from 1 to 5,000. A new revision clears the unsent count; expected
people and previous observations never prefill it. Invitation loading failures
have an explicit retry, and its pinned action yields while typing a movement.
A concurrent plan change keeps the editor draft and requires current-source review;
that review displays the saved visitors, purpose, count, dates, place and contact
before an explicit reviewed save. A second change still requires another review. Edit and quiet cancellation are grouped;
arrival/exit selection, observed count and one reviewed recording action remain
separate from Invite visitors and from planned dates. Confirmation rechecks the
current visit, count, direction, source revision and operating context before the
existing owner is called. Cancelled/failed/stale confirmations write no observation.

## A question, not a new approval workflow

Sharing says **Questions come to you** and retains the sharing coordinator as the
explicit answering owner. The descriptive campus contact does not acquire a job
by inference. The organiser asks in the same visit; this explicit action creates
one private Request to that exact current owner through the existing configured
Model Core coordination ports. Further text while waiting does not create a
second open task: it supersedes the prior protocol revision with one current
Request under the same native thread and stable Work identity. The campus owner's
reply both retains the answer and finishes that
Request; there is no separate Resolve, guest acknowledgement or thank-you step.
A later question reopens the same private thread with a fresh exact request.

Question revisions are independent of plan and sharing revisions. Prose remains
native and visible only to the organiser and retained answering owner; Core and
refresh envelopes contain opaque references, not the question text. Other Gate
managers see only necessary recovery metadata. If the answering owner loses
current access, a current Gate manager can explicitly take over, including before
the first question. An open request is superseded and reissued with retained
old/new lineage, never silently inherited. A new send fails honestly if no valid
owner can receive it. Taking over does not revive expired or revoked sharing.
No automatic reminders, escalation or fabricated response deadline is introduced.

The confirmed window is a plan, not gate admission, a room reservation, lab access,
consent, presence, attendance or completed work. The canonical destination is
retained natively and linked as plan context through the Core journal, without
an exclusive schedule claim. Passing the planned end invents neither departure
nor an attention task, failure or new permission.

## Optional movement evidence

An authorised operator can explicitly record arrival/departure with an observed
count and time. These are campus-boundary point observations, not live location
or cumulative occupancy. They do not establish arrival at the meeting room.
Group observations remain distinct from named-person evidence. Future observations
are rejected, and recorded identity cannot be replaced by an ordinary plan edit.
Departure can be the first observed point; a missing entry is not grounds to
demand a fabricated arrival. Actual counts can differ from planned party size,
including extra people. Changing a planned count retains original observations.

Cancelling preserves physical evidence and can leave departure recording available;
it never records an exit. Existing assisted walk-ins remain independently usable.
Arranging does not create a walk-in automatically. A mistaken movement needs an
explicit evidence-preserving correction/retraction extension, not a plan edit or
a fabricated opposite movement.

## Native state and DT chain

`gate_visit_arrangements` retains the typed current aggregate. Its immutable
`gate_visit_arrangement_revisions` retains source versions, actor, command and
readable label snapshots. Composite tenant references preserve canonical links.
Deferred guards require the same accepted typed command, actor, authority, source
event and native version. No generic visitor workflow engine is introduced.

Every mutation uses the identified human's prepared Core command, fresh domain
authority and revision checks, owning transaction, audit, typed action event and
correlated outcome. Existing narrow journal and observation ports retain evidence.
Private names/descriptions stay in authorised native records, not broad Core
payloads, notifications or refreshes. Refreshes contain opaque source references,
action and revision. No hidden host approval, routing, reminder or expiry runs.

Retries recheck current access, then compare the retained source, action, revision
and payload commitment without repeating the effect. Actor-scoped receipt lookup
reconciles uncertainty; pending does not authorise another effect. Lists page ten
records with complete authorised counts; choices are bounded and searchable.
Detail discloses the latest 25 versions and says when older retained history exists.

## Same application and isolated Simulation

The same API, services, typed ports and screens use the selected store and clock.
Capture retains native tables and references. Real COW changes and observations
must leave Live and a sibling unchanged. Refreshes and caches remain world-qualified.
Older snapshots lacking this schema require fresh capture under the compatibility
gate; they cannot borrow Live.

Acceptance covers confirmation, known person/provisional group, edit/cancel,
revocation, cross-campus references, retries, stale races, native evidence guards,
privacy, virtual time and actual COW isolation. Check mobile Light/Dark and
blue/amber. Physical-phone keyboard and real campus acceptance remain distinct
from browser and synthetic software checks.

The wider direction is [Campus visitor experiences](../VERIFICATION.md#visits).
Public discovery, anonymous intake, scoped external job participation, access
systems, sensitive documents, recurring itineraries and external delivery retain
their own future owning contracts and evidence.
