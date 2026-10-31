# End-to-end campus workflows and progressive delivery

Status: owner-directed delivery scope, 21 October 2026. The owner's 22 Riverview
stories are the acceptance source. This document defines the target architecture,
onboarding and delivery sequence; it is **not evidence that these workflows are
implemented**. Exact new domain schemas, protocols and migration contracts must be
reviewed with their owning vertical before implementation.

Read with [Product blueprint v2](PRODUCT_BLUEPRINT_V2.md),
[Universal institution model](UNIVERSAL_INSTITUTION_MODEL.md),
[Model Core](THATCAMPUS_MODEL_CORE_BLUEPRINT.md),
[Progressive onboarding](PROGRESSIVE_CAPABILITY_ONBOARDING.md),
[Operating experience](THATCAMPUS_OPERATING_EXPERIENCE.md) and
[Theme](THATCAMPUS_THEME.md). The normalized
[22-story acceptance inventory](../../artifacts/user-stories-20261021/test-plan.md)
and [current audit](../../artifacts/user-stories-20261021/README.md) retain the
requested endings, observed gaps and limits of the evidence.

## 1. Product decision: both starting paths remain first-class

ThatCampus supports a campus built from the ground up and a campus that starts
with one useful operation. Both are views into the same private operational realm,
not editions, tenant types, databases or separate onboarding applications.

| Entry intent | What happens first | What remains true afterwards |
| --- | --- | --- |
| Start with one workflow | Select an outcome; reuse or add only its required people, context, responsibility and rules; perform the real operation. | Add any supported capability to the same campus without repeating setup or losing history. |
| Build my whole campus | Select an initial sequence, usually two or three outcomes; progressively add shared people, physical/academic structure, services and responsibilities. | Any ready workflow can operate immediately; the plan can be paused, reordered or narrowed. |
| Join, apply or accept work | Resolve the signed invitation, public intake or exact assigned context; authenticate and accept only the permitted relationship. | Enter that existing campus context without founding another campus or choosing one's own powers. |

The first two administrative intents converge before domain setup. Whole-campus
setup is a guided expansion plan over accepted domain records, not a second writer
for those records. Starting with attendance does not require admissions; starting
with loans does not require a timetable; admissions does not require constructing
the entire college before accepting an application.

Campus name, organisation shape, terminology and verification are collected when
an operation needs them. A private founder workspace is not a verified public
institution claim. Public intake, regulated payments and other trust-sensitive
actions retain their explicit publication/authority/provider gates.

## 2. Current implementation and the seams to extend

The current architecture is suitable: NestJS domain modules, typed relational
stores, transactional outbox, Model Core ports, responsibility-composed React
workspaces and isolated Simulation. No replacement stack or generic workflow
engine is required.

The audit found partial support in 12 stories and a missing central workflow in
10; none of the 22 complete endings was proved. Existing team-owned message reads,
dated responsibility memberships, activity planning, registers, exams, Finance,
Events and Transport are foundations to extend, not finished story claims.

Concrete extension points include:

| Existing seam | Required extension |
| --- | --- |
| `institution-activation/progressive-setup.contracts.ts` and `progressive-setup.service.ts` | Expand the seven current goals through reviewed capability manifests; replace campus-wide count readiness with action/actor/scope-specific prerequisite results. |
| `institution-onboarding/progressive-workspace.provisioner.ts` | Preserve one private realm and explicit founder person/account link across both administrative entry intents. |
| `auth/auth.service.ts` | Registration currently provisions a founder campus; add an explicit applicant/join entry contract before reusing account creation for those journeys. |
| `navigation/portalReturnState.ts` and the server operating resume | Add a vetted prerequisite continuation rather than arbitrary return URLs or another setup app. |
| `campus-model-core/*port.ts` | Reuse identity, authority, command/outcome, event, configuration, responsibility, relationships, occurrence and selected-world ports. Add reviewed adapters, not domain branches inside the kernel. |
| `workspace/workspace.service.ts` and domain projections | Exact owned-work routes, waiting-for states, finite queues, failure recovery and source-derived closure. Unknown typed work must not loop back to an unusable list. |

These paths are relative to `backend/src`, except the navigation path under
`frontend/src`. They identify implementation seams, not complete API specifications.

## 3. One DT operating contract for every vertical

```text
Actor's explicit action
  -> current identity, scope, authority, rule and revision checks
  -> owning domain transaction + command outcome + audit/outbox
  -> accepted domain event
  -> reviewed recipient route and exact next person's work
  -> recipient response / next domain action
  -> source-owned completion, correction or visible unresolved exception
```

The frontend calls the owning domain API. Model Core coordinates typed commands,
authority evidence, accepted events, operational messages and outcomes. It does
not become the owner of applications, marks, loans, fees or repairs. A composed
job workspace is a projection over those records, not a universal writable Case
table. Conversations may explain a decision; only an explicit authorized domain
command changes the arrangement.

### 3.1 Shared foundations, kept narrow

- **People and context:** one canonical campus person, explicit account/agent
  links, dated affiliations, groups and eligibility. App access, employment,
  enrollment, family relationship and authority remain distinct. Passive people
  need not create accounts. Names never silently merge identities.
- **Responsibility and handover:** named people or existing dated responsibility
  teams, exact permitted actions, scope and effective interval. Reuse the current
  team registry. Add audited claim/accept/transfer/reissue and orphan recovery;
  reading a team mailbox alone does not implement these transitions.
- **Time, place and resources:** stable identities, versioned plans and resource
  reservations, explicit conflicts, accepted amendments and retained actuals.
  Booking, acceptance, attendance, movement and custody are different facts.
- **Protected artifacts:** shared upload/render/storage infrastructure with
  domain-owned purpose/access checks, immutable versions, submission manifests,
  security handling, retention and isolated Simulation copies. Uploading a file
  does not submit, approve or release it.
- **Contextual work:** a source reference, current owner, who is waiting for whom,
  due date where applicable, exact destination, last accepted change and permitted
  correction. Persist domain state; derive Today/Work and deduplicate messages
  against the same obligation rather than maintaining another completion flag.
- **Rules and recovery:** institution-reviewed routing, deadlines, retries,
  reminders and escalation. Missing optional automation cannot hide an existing
  domain obligation. Missing required routing is a visible configuration exception
  with an authorized recovery path, never an invented all-admin recipient.

Expected, reported, verified, accepted and physically completed states must not
collapse into one status. Financial and private evidence is minimized in shared
projections. Unavailable, denied, redacted and unknown remain distinguishable.

### 3.2 Minimal authority bootstrap

Preserve Model Core §15.4's audited bootstrap, expiry, first authority source and
handover. Complete the minimum ceremony for the chosen private operation in
context, without demanding the full organisation chart or legal verification.
Retain the exact actor, scope, permitted actions, approving authority and any
explicitly allowed single-founder exception. Bootstrap is not a hidden permanent
administrator grant and cannot execute arbitrary domain work.

A required independent reviewer, financial reconciliation or physical handover
cannot be bypassed to make onboarding finish. A sole operator can perform only
those combinations explicitly permitted by the effective policy. If required
authority is unavailable, preserve the draft and explain how to appoint or obtain
it. Block that consequential action; do not freeze unrelated accepted operations.
Real accounts, invitations and access transitions remain Live control-plane work.

## 4. Onboarding contract: readiness for this operation

Extend the existing capability-pack contract; do not create another capability
registry, setup database or arbitrary rule language. Each delivered outcome needs
a reviewed journey definition containing:

1. stable capability/outcome key, supported entry intents and owning domain;
2. source/entity/scope references and supported operation;
3. actor-, scope-, world- and revision-qualified prerequisite resolution;
4. reusable, required-now, optional-later, conflict and unavailable results;
5. context-local create/select/import and the safe continuation contract;
6. explicit operating responsibilities, rule/configuration versions and fallbacks;
7. normal domain destination, Today/Work/Areas projections and exact action links;
8. first-operation receipt, domain closure/reopen criteria and next useful option;
9. export/disable/history behavior and selected-world/effect/artifact adapters;
10. the story and negative-path acceptance cases proving delivery.

Distinguish **implemented/preview/planned**, **enabled**, **ready for this action**
and **first operation accepted**. An enabled feature or a nonzero campus-wide count
does not prove readiness. Planned outcomes cannot appear as working setup choices
or be advertised as supported merely because a catalogue entry exists.

Prerequisite continuation is server-vetted: actor, realm, selected world, outcome,
operation/scope, source draft and revision, missing prerequisite and allowed return
destination. Resume rechecks current authority and revisions. A continuation is
not an authorization grant. Preserve selected people, uploaded/pasted names,
drafts, filters and pagination when returning. Expired, revoked or world-mismatched
continuations show recovery; never carry a pending write into another world.

### 4.1 Founder journey and whole-campus builder

1. **Account:** concise contact/security step, existing theme and explicit consent.
2. **Intent:** compact multi-select outcome tiles, whole-campus guidance or explore.
   Group/search the expanded catalogue; do not replace seven tiles with a wall of
   22 stories or ask for a persona/organisation type.
3. **Starting point:** the approved compact campus-centered hub-and-spoke graphic
   communicates reusable People, Groups, Places, Schedules and Resources. Keep its
   current gentle in-place motion and reduced-motion support.
4. **Do the first job:** enter the ordinary domain workspace with the few required
   decision groups, reusable records and concise authority checks.
5. **Review and operate:** show the exact action and next owner, then accept it
   through the domain API. Saving setup is not proof of taking attendance,
   confirming funds, issuing a loan or sending an offer.
6. **Continue:** show a truthful receipt and a quiet next step. Working now, Useful
   next, Available anytime and Trust & connections reflect the chosen operation.

Whole-campus guidance can progressively cover identity/locale, physical or virtual
places, people/responsibilities, academic structure, services and reviewed rules.
Each node edits the existing domain, reuses prior records and shows actual
readiness; it does not become a graph editor or universal completion percentage.
The user can enter real work at any step and later resume the same plan.

### 4.2 Applicant, invitation and responsibility entry

Public admission information is readable without membership. Saving an application
authenticates an account and creates only the explicit applicant-context link to
that destination campus. It does not found a realm, grant member-wide visibility,
enroll the person or infer identity from an email/name match. Account links and
applicant-to-enrolled transitions require explicit reviewed identity resolution.

A signed invitation supplies the intended person and scope; recipients do not
select their own powers. Accepting a scoped duty may use an existing account.
Assisted admission retains the same application, true acting officer, applicant
and on-behalf-of provenance; it does not impersonate the applicant. Every entry
returns to its exact application, invitation or duty instead of founder setup.

### 4.3 Theme is part of each workflow's delivery

Use the current shared theme and components, not a separate onboarding aesthetic:
short headings/copy; one primary next action; rounded inset surfaces with gentle
depth and clear Light/Dark separation; current colourful feature identities and
utility icons; protected Assistant artwork. Keep content above controls, large
metrics only where meaningful, and bounded categorized lists instead of 40 cards.

Use one Name with identified name chips, multiline paste, Import beside the field,
the filled ten-row optional-field template and explicit collision resolution.
Keep essential errors/safety facts visible; circled-i disclosures hold optional
information, not required decisions. Native fields remain at least 16px, touch
targets 44px, and sheet headers/footers stay usable with keyboard and safe areas.
Preserve the stable Today / Work / Areas / More shell and contextual Back behavior.
The calendar remains an independent Area with relevant links to/from Timetable.

## 5. Smallest useful setup by outcome

These are minimum **valid** setups, not permission to skip required safeguards.

| First outcome | Required now | Add only when needed |
| --- | --- | --- |
| Attendance / teach one group | People or a valid roster, activity/session, time, explicit recorder/instructor and reviewer where required | Program, departments, guardians, full buildings and fee structure |
| Timetable / exams | Eligible groups/candidates, dates, responsible assignments, required space/duties and review policy | Whole academic hierarchy or complete resource catalogue |
| Admissions | Intake/course information, required evidence, dates, authorized reviewer and publication policy | Timetable, complete student records and payment connection until required |
| Fees | Beneficiary, real obligation, amount/currency/date and authorized issuer/payer/reviewer | Classes, all terms, buildings or payment gateway |
| Club / event | Group/proposer, members/audience, scoped organiser and approval route; dates/place at the relevant step | Formal recognition, full campus catalogue, budget/provider setup before money is involved |
| Visit | Lead, participants, destination/time and instructions; transport authority/checkpoints if provided | Recurring bus network or GPS |
| Mentoring | Explicit mentor/participant context, private audience, meeting/plan responsibility | Whole staff/class structure or safeguarding case |
| Repair | Reporter, place, problem and authorized triage owner | Complete hostel or asset inventory |
| Loan | Borrower, custodian, item/copy, due policy and components if a bundle | Full library catalogue, procurement or depreciation |
| Placement | Opportunity, eligible audience, coordinator, deadline and submission requirements | Employer accounts or unrelated academic setup |
| Handover | Exact outgoing responsibilities, pending sources, successor and effective date | Recreating unrelated staff records |
| Completion | Applicant, requested document family, authorized issuer and applicable requirement owners | Rebuilding all historical campus data; approved external attestations may be used explicitly |

## 6. End-to-end verticals and their actual endings

The full steps remain in the linked 22-story inventory. The following contracts
name the owner, important missing behavior and completion evidence for each story.

### 6.1 Admissions and becoming a student — stories 1–3

**1. Applicant:** a new Admissions domain owns intake/application drafts, submitted
versions, per-document issues and replacement evidence, offers, acceptance dates,
waitlist/seat decisions and outstanding document deadlines. Drafts survive login
and return. Finance owns payment confirmation/refund; Enrollment owns the admitted
student transition. Seat confirmation, money and a remaining document are separate
facts. The ending shows the accepted seat, confirmed receipt, student number,
first-day instructions and that document's exact next action/date.

**2. Officer:** queues distinguish new submissions from applicant replies and
waiting-for-others. One assisted applicant uses the same application. Replacement
review closes that document issue, not every requirement. Withdrawal invokes
Finance refund work and releases capacity only under the effective rule; waitlist
offers are revision-checked, deadline-bound and capacity-safe. The day's ending is
a finite, owned queue with no lost pending cases.

**3. First day and daily learning:** Today composes published orientation and
reporting instructions, superseding venue revisions, document preparation, ID
collection, workshop registration, mentor meetings and then sessions/preparation/
due work. A mentor question stays in its authorized meeting/plan context with a
real recipient response. Student-transition/identity-document adapters must own ID-ready and
collection evidence; a fabricated diary note is not issuance. The student can find
tomorrow and unfinished work beyond a narrow date window without reconstructing
the plan from chat.

### 6.2 Connected academic work — stories 4–8 and 10

Introduce typed learning units/offerings and offering-specific enrollment while
retaining class/term placement as its school specialization. College parallel
electives are not a relaxed one-active-class-per-term rule or a group tag. A simple
teaching group must still operate without a program/department/semester hierarchy.

**4. Timetable:** extend current scheduling/conflicts with reviewed offering/group
rosters, teacher/resource availability, context-linked negotiation, accepted shared
lab reservations and authorized individual-week previews. Publish one plan version;
split practicals through reviewed future roster/session changes with affected-person
preview. The current timetable and notification refer to the same accepted revision.

**5. Teaching:** compose roster/room/earlier actual coverage, versioned reading/code,
exceptions-first attendance, late decisions, actual taught topic and due practice
work in one session view. A student raises a linked attendance dispute; its teacher
receives, checks and corrects it through the attendance owner. Homework completion
must use its completion contract, not acknowledgement. Material, work, questions
and corrected attendance remain findable next day.

**6. Cover:** offer the existing session's narrow duty to an eligible available
teacher; require acceptance, grant only required materials/actions, revise the room
and expose outstanding acknowledgements. Planned teacher, accepted substitute and
actual teaching log remain distinct. Preserve one logical teaching context and its
register/history, allowing source-owned superseding occurrence identities where a
future revision requires them; never duplicate the class or rewrite actuals. No
whole-account delegation. Completion requires actual session
evidence that the original teacher can later read.

**7. Group assignment:** Learning owns criteria/deadline, versioned group roster,
draft artifacts/feedback, explicit revised scope and the exact final submission
manifest. Concurrent members submit one idempotent group receipt. Leaving a group
does not rewrite past submissions. Published group and individual contribution
marks, grading components and feedback remain separately identifiable to the
correct audience; private personal feedback is not disclosed to the whole group.

**8. Elective change:** Enrollment/Learning owns the requested effective change;
the reviewer gathers timetable confirmation, destination catch-up work and Finance's
explicit adjustment/no-adjustment outcome. Preview and acceptance recheck all
participating source revisions. Change future entitlements and explicitly cancel/
supersede future economics tasks with lineage; retain earlier attendance,
submissions, learning work and results, and explain earlier-work treatment.
Partial cross-domain execution remains visible/recoverable, not falsely complete.

**10. Exams/results:** extend current assessment operations with candidate/room/
invigilator/accommodation clash review, linked student reports and immutable revised
schedules over a stable examination. Changes after a sitting starts preserve its
actuals. Student Exam details shows the current time, room, instructions, authorized
personal arrangements and revised-plan provenance. Marks submission, moderation
and publication remain distinct. Missing marks
stay unknown. Student queries pin the result/release; authorized correction produces
a re-moderated identifiable release and reply without erasing the prior publication.

#### First bounded teaching delivery: class practice

The next teaching increment is an immutable text practice item, not a file/group
submission LMS. An explicitly authorized teacher publishes a title, instructions,
date and optional due date to one existing class/term, opens the exact item and
sees **current class · reported completion**. Its learner or current guardian can
report done, reopen and ask a private question. The source author can reply in
that same learner/item thread while their current authority remains valid. Done
is not submitted, graded, verified, read or acknowledged; a reply is not automatic
issue closure. The app must say who can see the private thread.

Reuse `diary_items`, `diary_notes` and `homework_completions` as the owning native
records. A new practice source is immutable revision1 and its audience follows
the existing effective class Diary semantics. Do not invent a frozen roster,
durable draft, edit-in-place publication, file manifest or resolution state in
Core metadata. Those require their separately reviewed native persistence later.
The unsaved composer publishes only by explicit command; no future `published_at`
is used as a fake draft. Exact item reads must work beyond the Diary date window.

Add the implemented class-scoped `learning.work.publish` action to the existing
role catalogue, with no default/seeded grant. A dated, active exact-class learning
assignment and current acting identity authorize publish/progress; a general
teacher/admin title, timetable visibility or attendance permission does not.
Replies additionally require the author's current class/subject-scoped
`messages.send` and exact learner/guardian context. A different subject's messaging
grant is not authority for this source; general class practice requires an
unscoped class grant. Another teacher/admin cannot inspect that
private thread. Learners/guardians cannot publish, and teachers cannot complete
on their behalf. An ended assignment fails closed with an explicit recovery path.

Use a class scope of the existing Diary workspace so a learning-only operator
does not acquire attendance access. An independently authorized class workspace
can link there; it is not the authority gate. Reuse self/dependent Diary for the
learner and guardian, preserving source/date/return context and actor/world cache
partitioning. The unfinished learner task derives from the owning completion
record, not `requires_acknowledgement`. No teacher reply obligation is invented
from arbitrary private notes.

All new publish/note/completion/reopen writers prepare an exact, typed
`learning.practice.*` command through the current DomainCommandGateway before
native effects, then atomically retain source/outbox/outcome evidence. Stable
source/note/command IDs support response-loss replay; changed payloads conflict,
and replaying an old completion after a later reopen must not reapply it. Recheck
current source authority and acting identity before the narrow retained-receipt
lookup; a new preparation uses current server execution time rather than a
client-retained historical timestamp. Creation-only due-time validation cannot
block discovery of an already accepted unchanged publication. Private
note bodies never enter generic Work or Core safe context. No default reminder,
subscriber, escalation or provider action is enabled. Use the same selected-world
DB/clock/identity/authority paths; prove branch publish, completion/reopen and
private reply with unchanged Live/sibling records. This is a bounded delivery
contract until API, real-DB/COW, authenticated multi-person and themed UI evidence
are recorded, not a claim that stories5/7 are complete.

### 6.3 Money, private support and clubs — stories 9, 11–12

**9. Instalments/payment:** Finance owns the private request and approved dated
agreement against the existing obligation, not duplicate charges. Distinguish
agreement, reported transaction, verified allocation, remaining balance and receipt.
An approved reminder-rule revision follows the arrangement. Adult self-payer access
is explicit, not guardian-dependent. Optional father/payer sharing is selected,
purpose-scoped, expiring/revocable and limited to the relevant obligations/actions.
The ending proves ₹10,000 allocated once, ₹20,000 due on the agreed date, a resolved
query and no disclosure of the student's whole account.

**11. Mentoring:** add a private mentoring-plan owner for request, offered times,
accepted meeting, agreed catch-up tasks/revisions and follow-up. People `mentor_of`
describes a relationship; it is not disclosure authority. Explicitly share only
approved academic arrangements with named teachers, never the personal explanation
by default. The student sees who is included, current agreement and next meeting.
Do not turn restricted safeguarding into a general mentoring workflow.

**12. Robotics group:** reuse the same canonical group, membership history and
activities through growth and formal recognition. Add scoped, dated organiser
powers including student organisers; no fabricated employment or campus-wide event
grant. Labs and funds remain reservation/Finance decisions. Lead transfer requires
accepted succession and exact authority/work reconciliation, preserving continuity.

### 6.4 Fest and visits — stories 13–16

**13. Fest preparation:** Events owns a student proposal, faculty review, activity
plans, scoped teams, responsible preparation tasks and registration-readiness
conditions. Reservations own venue acceptance; Finance distinguishes sponsorship
offers, approved budget and received funds. Finance also owns vendor expense/bill
submission, authorized review/questions, revisions, approval and reconciliation;
an Event preparation task cannot stand in for those financial decisions.
Pending approval is visible before
registration opens; the organiser can identify exactly who must act next.

**14. Participation:** Events owns the accepted team-member snapshot, each required
acceptance, capacity, ordered waitlist, expiring offer and registration. Serialize
competing slot claims. Coordinate payments through retained order/status references;
response loss cannot create duplicate charges. Registration details bring together
current venue, team, seat, confirmed receipt and cancellation/refund state without
pretending payment success itself guarantees a place.

**15. Running fest:** use one stable event with immutable accepted plan versions,
not an immutable published aggregate that forbids rain changes. Preview affected
people/duties/resources; reissue material acceptance/consent requirements. Volunteer
replacement is narrow and explicit. Gate uses the same registration for manual
dead-phone identity checks and idempotent entry/inside-state checks. Ending, attendance
confirmation, loan returns, bills/refunds and certificate eligibility are independent
closeout facts. Certificates require actual eligible participation and authorized
document-family-specific issuance, not RSVP.

**16. Industrial visit:** Events/Visit planning links to existing Transport-owned
outbound/return journey legs. Registration/waitlist is not boarding. Preserve frozen
rosters with explicit exceptions, record bus-transfer/rider reconciliation, retain
reported vehicle/ETA revisions and purpose-selected contacts. Return closure rejects
unresolved riders. The visit can show travel complete while a named financial or
equipment obligation remains open; it cannot claim every subsystem is settled.

### 6.5 Campus services and opportunities — stories 17–19

**17. Hostel leak:** create Facilities work orders for report, triage, assignment,
acceptance, repair, inspection, resolution and reopen. This is outside topology,
not a maintenance ERP. A bounded Facilities accommodation component owns temporary
dated allocations, using Reservations for capacity and Resource Loans for actual
key issue/return evidence; accepted reservation, actual move and occupancy remain
distinct. Staff completion waits for the appropriate
inspection/resident response; new photos reopen the same issue. The ending proves
repair acceptance, settled accommodation and temporary key return individually.

**18. Books/equipment:** create Resource Loans with borrower, custodian, exact copy/
item, component quantities, condition, due rule and physical issue/return evidence.
Book and camera use the same bounded custody foundation with typed item behavior.
Borrower return claims trigger review, not automatic receipt. Partial return keeps
the charger outstanding; correction retains observed and recorded dates. An overdue
dispute stays linked through custodian review, reply and accepted return correction;
the resulting outstanding notice clears from the corrected source. Availability
also respects custody, reservations, condition, repair holds and unavailable/retired
state; full return cannot make damaged equipment available. Fines/settlement are explicit Finance handoffs;
lost-item settlement is not a fictitious return.

**19. Placements:** a new Placement domain owns opportunity, eligibility, versioned
candidate submission/résumé, shortlist, private interview, withdrawal/replacement and
own outcome. Employer is an explicit external party, not an automatic campus member.
Interview/assessment clashes coordinate exact affected students while Assessment
owns its revised arrangement. The submitted résumé version cannot change silently
when a newer upload arrives. Students see their own final outcome; officers retain
the complete application/interview/offer record.

### 6.6 Responsibility, completion and oversight — stories 20–22

**20. Takeover:** Staff coordinates a handover containing exact responsibilities,
source work, successor and dates; each owner validates transfer/reissue. Preserve
Thomas's signatures and Neha's own actions. A pending scholarship requires a typed
Financial Aid application/document-review owner, not a fake handover task standing
in for an absent scholarship workflow. Financial award and payment remain separate.
Examination reservation work uses its actual source. Revoked people lose authority;
unassigned work becomes a visible recovery item with an explicitly configured owner.

**21. Graduation:** Completion/Document Issuance owns the request and requirement
assembly, not the truth of every clearance. Accounts, loans/lab and other owners
supply dated, revision-qualified clear/blocked/pending/not-applicable evidence;
missing integration is unknown, not clear. Approved external attestations retain
their source. Reviewed name correction calls People without rewriting history;
document correction creates a superseding authorized release. Issued, downloaded
and physically collected are different. Deposit refund and access-transition plan
remain separate, with a retained route to remaining personal documents/updates.
No graduation action silently deletes an account or claims legal accreditation.

**22. Principal:** compose authorized decisions, delays, owner and waiting-for states
from the same domain records and typed work. Source-backed groups may summarize the
five blocked applications, but each links to its real issue and recipient. A fest
expense question/revised proposal uses the Finance-owned review/decision path.
Questions,
delegation, deadlines, replies and follow-up retain lineage. Principal mandate is
not administrator membership and does not expose unrelated private mentoring or
financial evidence. Wednesday's view explains actual changes, unknowns and remaining
decisions without requesting a fresh manual summary.

## 7. Compatibility and expansion without a rewrite

Keep the current tenancy anchor (`school_id`) behind the universal realm mapping
until a separately reviewed migration changes it. Add explicit typed domain models
and environment-qualified source references; do not create a campus-wide EAV table,
new identity catalogue or domain-specific Model Core columns.

For each existing school-only boundary: inventory callers and invariants; introduce
the typed eligibility/context adapter; retain canonical person and legacy ID mapping;
reconcile reads/authority/history; then cut that context to one authoritative writer.
Compatibility readers can be temporary; dual writable enrollment or timetable
engines cannot. Preserve frozen rosters and earlier results/registers. Do not fake
student enrollment, staff membership or guardians to pass old endpoint guards.

Register new domain schema, relations, commands, events, projections, files, workers
and effect policy in the reviewed adapter/conformance catalogue in the same change.
The physical resource catalogue remains topology; Facilities, custody, external
parties and document eligibility have their own bounded owners. Disabling a
capability preserves history and either settles/reassigns open work or explicitly
blocks deactivation; it must not erase obligations.

## 8. Delivery sequence: complete verticals, not a module checklist

No calendar promise is implied. Each slice includes domain contracts/migrations,
ordinary UI, contextual onboarding, authority, handoffs, corrections and verified
Live/Simulation behavior. Add only the shared contracts its first real journey needs.

| Slice | Deliverable / exit proof | Depends on |
| --- | --- | --- |
| A. Truthful existing work | Fix blank-score-to-zero, homework acknowledgement/completion and submitted-register reviewer Work; prove exact source links, retained retries and closure through ordinary accounts. | Current domains and audit reproductions |
| B. Start anywhere safely | Action-specific readiness/continuation, founder versus applicant/join intent, narrow bootstrap, exact source work/recovery and capability availability labels. Prove one-workflow start then growth into another without duplicate identities. | A; only the identity/authority seams required for the chosen first vertical |
| C. Teaching and academic change | Connected teacher/student loop, typed offering enrollment, materials/group submissions, conflict/reservation/cover, elective impact and exam revision/query. | A–B; offering roster, artifacts, authority and Finance decision seam as each path needs them |
| D. Money and participation | Adult fee plans/queries/scoped payer sharing and vendor bills/review; student event proposals, teams/capacity, running revisions, Gate and visit/Transport reconciliation. Useful subflows can ship before whole-story closeout. | A–B; existing Finance/Events/Gate/Transport; C's scheduling context where needed. Full stories 15–16 also need G custody/returns and the document-issuance gate in H where applicable. |
| E. Admission to student transition | Public intake, applicant identity/application/document/offer loop, waitlist/withdrawal, Finance, enrollment and explicit orientation/ID transition. | B; minimal learning-offering context from C and payment/enrollment ports, not every academic feature. Full story 3 also needs D workshop participation and F mentoring; do not claim that ending early. |
| F. Ongoing people coordination | Private mentoring, club recognition/succession, placements and typed scholarship/Financial Aid; explicit work takeover and scoped oversight composition. | B; narrow artifacts, scheduling, Finance and authority seams for each journey |
| G. Campus-service operation | Facilities/temporary accommodation and Resource Loans, including inspection/reopen and partial return. These can run in parallel with C–F. | B; canonical places/items, custody/evidence and reviewed owners; no academic prerequisite |
| H. Completion and full-campus proof | Owner-derived clearances, corrected document release/refund/access plan; all 22 multi-role endings and grow-from-one cross-capability regressions. | Applicable owners in C–G, typed issuance and proven transfer/recovery |

Start with A and the smallest B change that completes one current operation. Then
deliver independently useful domain verticals in parallel where dependencies allow.
Do not postpone onboarding/theming until after backend completion or build an
unbounded generic framework before any useful journey closes.

## 9. Release evidence for every story and both entry paths

Use the fictional Riverview actors and all steps in the source inventory. A story
passes only when its requested ending is demonstrated, not when a route, schema,
mock, unit test or first screen exists.

1. **Find and finish:** ordinary accounts can locate the start, perform/pass their
   part, understand delays/revisions and identify the final outcome. Capture the
   first help/repetition/context-loss/chasing point and its resolution.
2. **Real handoffs:** separate creator, student/applicant, reviewer and relevant
   operator accounts act under current assignments. Test unrelated/revoked actors,
   private evidence/search/projections, successor acceptance and orphan recovery.
3. **Both administrative paths:** a fresh minimal campus operates the selected
   subsystem alone; whole-campus guidance reaches the same domain operation.
   Add a second and third subsystem and verify stable reused people/groups/places,
   preserved first-workflow history and no unrelated setup failure blocking it.
4. **Truth and failure:** stale revisions, duplicates/concurrency, interrupted uploads,
   ambiguous responses/retries, revocation, cancelled prerequisite sheets, expired
   offers, conflicting reservations, partial returns, repair reopen and changed
   clearance evidence have explicit safe outcomes. Unknown never becomes zero/done.
5. **Mobile/theme:** actual 320px/common-phone Light/Dark × Live/Simulation checks,
   keyboard-open sheets, safe-area footers, focus/Back, finite queues and reduced
   motion. Retain physical-iPhone acceptance separately from desktop emulation.
6. **Same-app Simulation:** the same services/routes run against captured dependencies,
   run-local authority, artifacts, workers and virtual time. Demonstrate meaningful
   mutations and deadline/reminder/offer expiry execution, unchanged Live and sibling
   worlds, no real provider effects and no Live fallback. Missing synthetic human
   behavior remains unknown unless explicitly configured; no invented acceptance.
7. **External and physical gates:** simulated provider confirmation is not a real
   payment integration; rendered receipt is not settlement; UI boarding/return is
   not witnessed physical handover. Name these remaining acceptance gates honestly.
8. **Evidence and migration:** update owning contracts, conformance/fingerprint,
   implementation record and story receipts together. Separate source support,
   isolated tests, local browser evidence, physical-device review and hosted release.
   Re-run school history/guardian regressions as college contexts are introduced.

## 10. Scope reconciliation and first implementation checkpoint

The 21 October owner direction adds the full 22-story lifecycle to delivery scope.
It supersedes the older decision to park pre-admission **as a target-scope limit**;
it does not retroactively make Admissions implemented. Preserve older evidence.
Likewise, topology's maintenance exclusion remains correct: introduce Facilities
and Resource Loans as their own domain owners instead of turning topology into ERP.

Before each new vertical, amend its owning domain contract with the exact states,
authority/configuration, integration, migration, onboarding and acceptance rules.
In particular, replace guardian-only self-service assumptions where adult policy
permits it; add student organiser scope explicitly; extend published events/exams
through immutable versions; add Financial Aid and typed document-family contracts.
Do not infer these details from labels or implement them as generic request flags.

The first implementation checkpoint is **A plus the minimal B contract**: repair
the three reproduced correctness/attention defects, establish exact reviewer work
and truthful completion, and prove one minimal start-to-handoff-to-closure flow
before extending it to the next outcome. This planning checkpoint changes no
runtime, database, authority, credentials or provider integration, and claims no
new passing product story. Subsequent implementation is recorded separately in
[the first-slice evidence](../../artifacts/end-to-end-slice-a-20261021/README.md)
and the implementation record; it must not be inferred from this target plan.

Checkpoint63 adds the bounded Timetable first-use continuation recorded in
[its receipts](../../artifacts/timetable-continuation-20261023/README.md), without
proving a full teaching story. The owner's 23 October priority is to stop further
Timetable refinement for now and advance the wider learning, examinations/results
and cross-person workflow gaps. Parallel work remains bounded by each owning
domain's authority, records, theme and Live/Simulation acceptance, not a promise
that the remaining stories are already supported.

Checkpoint 68 delivers the next bounded expansion: class-practice text publication,
reported completion and exact private author threads; explained result correction
through independent moderation and immutable republication; source-backed Staff
Leave Waiting alongside actionable Work; and role-assignment write/recovery
safety. The [expansion evidence](../../artifacts/workflow-expansion-ui-20261023/README.md)
records real PostgreSQL/COW and authenticated HTTP checks, ordinary multi-person
browser handoffs, theme inspection and precise limits. Current identity is checked
before private source reads and retained command replay. No teaching reply duty,
review deadline, universal case owner or all-22 completion is inferred. Full
teaching/group submissions, Admissions and the later verticals remain governed by
the contracts and delivery sequence above; both starting paths remain intact.
