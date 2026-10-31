# Accommodation and moves

Status: current bounded contract,24 October2026; the owner additionally clarified
that campuses contain hostels, differing room types and resources. Local delivery
evidence is recorded separately in
[the acceptance record](../VERIFICATION.md#operations).
This is an implementation contract, not evidence of institutional acceptance. Read with
`END_TO_END_CAMPUS_WORKFLOWS.md`, `FACILITIES_REPAIRS.md`,
`INSTITUTION_CAMPUS_REPLICA.md`, `RESOURCE_LOANS.md` and Model Core.

## People and outcome

A resident displaced by a leak needs an available temporary place, a clear move
and access arrangement, updates when the repair slips, and an understandable
return. A warden or residence operator must avoid double-booking and retain the
actual resident, location, responsible person and outstanding work. A desk
custodian needs to record actual key/card issue and return, not infer it from a
room offer. A small campus may instead begin directly with one room and person.

One ordinary Accommodation Area owns the experience, with an optional contextual
entry from the authorized repair. No persona portal, mandatory Admissions/Repairs
configuration, full hostel tree, furniture census or student app account.

## Published operating evidence

These are institutional published procedures, reviewed24 October2026, not field
observation or prevalence claims. Their particular fees and deadlines are not
platform defaults.

- [Ashoka Residence Life](https://dp.ashoka.edu.in/campus-residence-life/): warden
  review, a feasible room offer, explicit response, then physical move/key return.
- [MNNIT hostel booklet](https://mnnit.ac.in/swo/Hostel%20booklet%202021-22%20PDF%20File.pdf):
  room allotment and reporting to the caretaker to take possession are different.
- [Greenwich room moves](https://studentcentre.gre.ac.uk/knowledgebase/article/KA-10006/en-us):
  confirmed arrangement, online check-in/out and separate access-item collection/
  return; old and new keys may legitimately coexist while the move is completed.
- [Boise State community standards](https://www.boisestate.edu/housing/housing-help-center/policies-and-standards/community-standards/):
  repair-related temporary relocation includes belongings and temporary keys.
- [York St John room changes](https://studenthub.yorksj.ac.uk/helppages/article/KA-01035/en-us):
  acceptance, identity-checked key collection and original-key return are separate
  steps. Their timing rules differ from Ashoka's.

## One physical model, distinct operating ownership

Canonical topology owns Campus → Hostel/building → optional block/floor → Room.
An individually assigned bed/place belongs within that room when used. Extend
the bounded canonical space kinds where needed; do not make a second hostel or
room catalogue in Accommodation. A one-room start does not require all ancestors.

Accommodation owns reusable room types (e.g. single, twin, dormitory, staff),
explicit sleeping capacity and allocation mode. Type defaults help create rooms;
changing a type never silently changes active room capacity or accepted holds.
General topology capacity can mean classroom seats and must not be treated as
sleeping places. Whole-room allocation reserves the room exclusively; shared-place
allocation consumes one explicitly available sleeping place per resident. Optional
named places/bed positions have stable identity. A position is not a duplicate
furniture asset; it may explicitly reference an existing exact bed holding.
Ordinary shared-capacity operation must not require a named-bed inventory.

Existing resources remain canonical holdings placed in their actual hostel, room
or shared area. Furniture placement, condition and personal custody are distinct.
Room allocation never silently issues a bed, desk, key or other item. Furnishing
lists must use current authorized resource owners, not inferred quantities from a
room-type name. Keys/cards use Resource Loans actual issue/return evidence.

For example, Maple Hostel may contain Room101 (single), Room102 (twin) and a
six-place dormitory. Each is the same canonical place with its own residential
use record. The twin can operate as two shared places or an exclusively reserved
room; the type name alone never chooses that policy. Its actual beds, desks and
fan remain Resource holdings at Room102. A shared washing machine can instead
belong to the hostel/common area. Neither a room type nor an allocation invents
those holdings, additional occupants, borrowing evidence or fees.

No physical room Reservations owner currently exists. This delivery introduces a
bounded Accommodation-owned capacity/hold seam for its own room/place claims,
not a generic booking/workflow framework. Initially registered residential spaces
are dedicated while active: registration rejects incompatible published teaching/
exam bookings, and those writers reject residential space use. Mixed day/night
classroom conversion needs a later reviewed shared time-capacity contract and is
not implied by this delivery. Preserve authorized historical bookings.

## Small operating flow

Owner clarification, 25 October 2026: an authorised room allocation is not always
an offer requiring a resident decision. The ordinary creation flow starts with
**Assign room** and also offers **Send an offer** when a response is actually
required. A coordinator allocation confirms the arrangement under that actor's
authority; it does not claim resident consent, a physical move or key custody.
Existing offer/response history retains its original basis. Both paths use the
same canonical room, capacity checks and typed DT command/evidence pipeline.

For an allocation, the next physical step is recording actual move-in. An exact
coordinator can change its planned end with a reason and a fresh capacity check,
without recording a fictional resident response. For a resident offer, acceptance
and extension responses remain explicit. The steps below describe that offer path;
they are not mandatory ceremony for every allocation.

1. Register/reuse a canonical room, choose/reuse its type, explicit capacity and
   whole-room/shared-place mode. Create only missing records in context. Optional
   named places/resources may be added without making them prerequisites.
2. An explicitly authorized coordinator offers one place to a canonical person for
   a planned interval, with short instructions, optional original location and
   exact authorized repair reference. Review the offered person/place/time and
   responsible signer. An offer holds capacity; it is not consent or occupancy.
3. The exact resident accepts/declines. An operator may record an assisted response
   only with actual source/method/observed time, signed as that operator. It must
   never impersonate the resident's authenticated response.
4. An authorized recorder records observed move-in, after physical capacity and
   current plan checks. Date passage, acceptance and key collection never do this.
5. An expected-date change/extension rechecks capacity and records its reason and
   notification/response status truthfully. Do not invent agreement, a guaranteed
   repair date or automatic continuation. A declined/conflicting amendment leaves
   the last accepted arrangement and actual occupancy intact.
6. Record observed move-out/move-back with its actual destination or unlinked
   description and provenance. This is not key return or repair verification.
7. Settle the required temporary access-item loans through Resource Loans. Original
   access retained by the resident does not become a false outstanding temporary
   key. Optional access mode explicitly says no tracked item, existing access or
   tracked return-required item; an empty list never silently means all settled.
8. Close only when the required movement/access facts are settled. Repair remains
   its own checked source. The combined view can name each unresolved ending.

Offer expiry and automatic reminders/escalation are not hidden defaults. Any
delivered expiry requires explicit recorded deadline, selected clock, retained
terminal outcome and safe recovery. Otherwise withdrawal/release is an explicit
authorized action. No universal fee, refund, eligibility, gender/medical judgment,
emergency access or legal licence acceptance is automated here.

## Capacity, correction and truth

Use tenant-qualified canonical identity, half-open planned intervals and consistent
room/place locks. Availability checks maximum concurrent claims at interval
boundaries, not a naive sum of every intersecting row. Whole-room and place claims
cannot overlap incompatibly. A person cannot acquire overlapping incompatible stays
by two concurrent saves. Reject stale capacity/room/type/place edits and nonempty
inactivation; retain reasoned history.

Actual occupancy remains open until a recorded move-out. An expected end never
checks somebody out, releases their unresolved occupancy or proves an empty room.
Overstay blocks actual admission and must be visible alongside any affected
future plans, not silently cancel accepted work. New offers/extensions must not
advertise an already overdue occupied place as free. A future planned vacancy is
not a claim that a currently occupied room is empty. Outstanding temporary access
must remain visibly unresolved; room release/security readiness must not be
silently inferred while required keys remain out.

Cancellation before occupation releases a hold, not an actual resident. Corrections
append retained signed evidence, observed versus recorded times and reasons; they
cannot reopen occupancy over another accepted actual resident, erase issue/return
evidence or backdate when the system learned a fact. Explicit reassignment and
orphan recovery retain the previous owner and never expose private stay details to
an unrelated technical manager. Descriptive room affiliation gives no authority.

## DT, custody and minimal private projections

Every material room/type/use/offer/response/movement/amendment/closure/recovery
action uses current identified actor, purpose authority, source revision, prepared
command commitment and native transaction + immutable receipt/audit/outbox/outcome.
The existing Core ports retain configured event-reactive exact-recipient routing,
response/source-supersession lineage and terminal grant retirement. Work is a native
projection, not a writable stay/case store. An estimate is not an action deadline.
Current exact-source coordinator/resident/recorder access is separate from setup
rights; no implicit all-admin resident-data access or blanket Resources authority.

Resource Loans remains the sole custody writer. Its current public operations open
their own transactions, so room and key actions must not be presented as one atomic
write unless an actual reviewed composition port is delivered. An owning issue/
return flow can safely retain accommodation continuation, followed by an exact,
revision-checked link. Validate resident, institution, exact loan/item and current
authority. A narrow minimal custody summary can support the authorized stay without
exposing private borrower questions. Handle a saved loan/link failure explicitly;
retry/link the existing record, never issue a second key blindly.

## Experience, progressive start and Simulation

An ordinary occupied stay before its planned end is not unfinished movement work.
Future confirmed arrivals are not immediate attention either. Work must use the
selected clock and current native state: genuine responses, missing responsibility,
arrival recording when due, ended-stay review and post-departure access/closure
remain visible. A planned end prompts review, never automatic checkout. Keeping a
standing recorder route permits early voluntary move-out without manufacturing a
task throughout the person's residence. These reads do not rewrite stay history.

Lead with resident, room and current state, then compact actual/planned dates.
Routine changes belong under **Manage stay**; timestamps, responsibility and
provenance remain under a labelled information disclosure. When Today has exactly
one complete, actionable item, name it and open its owning action directly rather
than showing only a generic count. Never promote Waiting or partial queue data into
that shortcut.

Use `/areas/accommodation` with exact stay links; offer/move actions live in one
editor. Compact Stays/Rooms views, bounded queues/search, useful human history,
visible resident/place/next owner and one primary action. Related Repairs/Resources
link back to the same stay and preserve unfinished selections. Use the shared
PlannerDialog, InfoSummary, ProductIcon, tokens and Light/Dark Live/amber themes.
Keyboard-safe actions, denial, stale/uncertain write, accepted-but-refresh-failed,
no-space/conflict and lost-authority recovery are part of the first workflow.

Accommodation is an additive purpose and Area. Readiness is actor/world/source-
qualified. Creating a type/room or visiting settings is not first-use completion;
an accepted real arrangement through the ordinary domain path is. Starting with
one workflow or gradually building the campus converges on these same records.

All native owning stores/configuration/permissions/events/commands/relationships
must participate in the same selected-world COW services and clock. No Live
photo/record/custody fallback, external message or separate Simulation logic.
Acceptance must exercise actual branch offers, capacity conflicts, movement and
key settlement, unchanged Live/sibling state, virtual-date behavior, revisions,
exact/changed retries, actor/tenant privacy, revoked roles and native Work lineage.
Record automated, browser, physical-device, hosted and owner acceptance separately.
