# Institute governance, authority and mobile operations

Status: adopted architecture; authority foundation implemented locally on 7 October 2026

Applies to: schools, colleges, coaching centres and hybrid institutions.
This is the maintained governance contract under
[Blueprint v2](PRODUCT_BLUEPRINT_V2.md), the
[Model Core contract](THATCAMPUS_MODEL_CORE_BLUEPRINT.md) and the
[responsibility-composed application](RESPONSIBILITY_COMPOSED_APPLICATION.md).
The former Word framework is historical provenance; its 35 model and 24 governance
coverage cases are preserved below, not treated as executed tests or a competing
application/navigation specification.

## Product decision

ThatCampus has one institute model and two management experiences:

- **Institute Setup** records how the institute is organised, where authority comes from,
  who currently holds offices or body seats, which matters are reserved, and which
  routine work is delegated.
- **Daily Work** presents the concrete teaching, service, review, decision,
  implementation and oversight actions that the current person may perform.

Application access and institutional authority are separate. An administrator may
prepare a governance configuration without having the power to adopt it. A software
role cannot appoint a principal, create a committee seat, supply a vote or transfer a
reserved decision.

## Human experience and automation contract

The user supplies only facts that the product cannot safely know:

1. The legal operator and applicable institution context.
2. The current holder of a main office or seat.
3. The source or evidence for material authority.
4. An institution-specific deviation, limit or final authorised decision.

The product derives or prepares everything else it can explain:

- a suitable school, college or coaching starting structure;
- offices, bodies, seats and vacancies;
- supported-role recommendations and scoped, dated assignment proposals;
- standing-mandate and reserved-matter suggestions;
- the plain-language **Who can decide what?** map;
- review tasks, expiry reminders, blocked-authority explanations and impact previews.

Generated records retain their template and source. They remain suggestions until the
required authority confirms them. Automation must never silently create authority,
adopt a governance rule, invent a meeting, fabricate evidence, infer a legal conclusion
or show an unaccepted offline action as recorded.

## Unambiguous model

| Concept | Product meaning | It does not grant |
| --- | --- | --- |
| Person | Human identity, with or without an account | Login or authority by itself |
| Account and institution membership | Authenticated identity and current institution participation | A separate persona portal, job title, office or unrestricted union of permissions |
| Role | A named bundle of supported actions, built-in or institution-customized | An employment designation, eligibility gate, office or reserved decision power |
| Contextual assignment | Person + role + exact supported resource scope + effective dates, retained by its owning domain | Work outside that binding or institutional decision authority |
| Supported permission vocabulary | Platform-defined operations and protected domain constraints; institution custom roles may select supported actions | New software operations, arbitrary scope or a bypass of independence, publication or authority requirements |
| Access exception | Dated, reasoned technical exception | Office, committee seat or vote |
| Authority source | Governing instrument, rule, order, resolution or declaration and its status | Authority until its applicability and state support it |
| Office | Continuing individual institutional position | A specific officeholder without an appointment |
| Body | Continuing collective authority or advisory group | A completed collective decision |
| Seat | Defined place in a body, possibly vacant | Membership without an appointment |
| Appointment | Effective-dated connection from a person to an office or seat | Power outside the office/seat and source |
| Mandate | Bounded standing or delegated power | Power beyond its source, matter, limit or period |
| Decision matter rule | Complete route for one institutional matter | A decision on a particular proposal |
| Decision case | Versioned proposal and required decision work | Resolution before the procedure completes |
| Resolution | Adopted outcome of an authorised procedure | Unlimited execution permission |
| Decision authorisation | Bounded mapping from a resolution to a domain command | Other commands, targets, amounts or versions |

## Access and authority evaluation

Technical access uses the model in
[Roles and contextual assignments](WORK_PROFILE_ACCESS_ARCHITECTURE.md):

```text
active account and membership
AND a current matching scoped role/assignment, an explicit permitted
    administrator grant, or an active dated access exception
AND owning-domain resource and workflow checks
```

Each positive grant must cover the complete action and target scope; never combine
an action on one resource with a read-only relationship to another. Native class,
event, assessment and journey staffing stays with its owning domain and projects
into the staff profile rather than creating another assignment or eligibility
record. There is no duty-to-role eligibility matrix. Technical administrator
access remains bounded and never supplies an institutional mandate.

A material institutional action adds a second, independent test:

```text
technical access is allowed
AND a current standing mandate or decision authorisation covers this matter
AND its source, holder, target, limits, dates, conditions and version match
AND any independent or external decision is complete
AND the domain command invariants hold
```

The server evaluates both. Navigation is a projection, not an enforcement boundary.

## Setup states

Authority records use explicit states. A saved draft must never look adopted.

- Source: `draft -> recorded/self_attested -> verified -> superseded`.
- Office, body and seat: `proposed -> active -> retired`.
- Appointment: `proposed/future -> active -> suspended/ended`.
- Mandate: `suggested -> active -> suspended/revoked/expired`.
- Decision matter rule: `suggested -> confirmed -> retired`.

`self_attested` is an honest source state for a small owner-operated coaching
workspace. It does not claim regulator or platform verification. A verified institute
records its actual instrument and review evidence. Selecting a simpler template cannot
remove a body or step required by an applicable source.

## First authority foundation slice

Migration `048_governance_authority_foundation.sql` adds source-backed, institution-
scoped authority records with typed foreign keys, uniqueness checks, effective dates,
optimistic revisions, RLS and no browser-role table grants.

The early governance foundation exposes **Authority** and shows:

- source status and issues needing review;
- current offices and officeholders;
- bodies and visible seat vacancies;
- a concise **Who can decide what?** map;
- a four-fact setup form when no authority structure exists.

The setup command prepares a draft from the institution profile. For a self-service
coaching workspace, the source is explicitly self-attested. For a managed or verified
institution, the source and generated records remain recorded/proposed until the
appropriate adoption flow is complete.

The Cambridge demo contains two verified sources, Principal and Manager offices,
Management and SMC bodies, five current appointments, two bounded mandates and five
decision routes. The fee-policy route is labelled institution-specific and requires
current Karnataka applicability review; it is not presented as a universal rule.

## Delivery sequence

| Slice | Outcome | State |
| --- | --- | --- |
| A1 | Authority sources, offices, bodies, seats, appointments, mandates and decision-map read model | Implemented locally; UI validation pending |
| A2 | Protected adoption of authority changes, appointment evidence, vacancy/expiry management and continuity | Next |
| A3 | One complete collective path: proposal versions, notice, eligibility, conflict, quorum, voting, resolution and certification | Planned |
| A4 | Bounded decision authorisation linked to one real domain command and idempotent execution | Planned |
| A5 | Implementation evidence, independent verification, obligations and oversight closure | Planned |
| A6 | College and coaching-specific templates, external conditions and additional supported procedures | Planned |

Advanced proxies, weighted voting, secret ballots and offline voting stay unsupported
until their complete procedure, privacy and evidence semantics exist.

## Invariants

- GOV-AUTH-001: every record has one institution owner; all relational references retain
  that owner.
- GOV-AUTH-002: a technical administrator or permission cannot create institutional
  authority.
- GOV-AUTH-003: an authority source retains issuer, jurisdiction, reference,
  verification state and effective dates.
- GOV-AUTH-004: an office or seat has at most one current/future appointment in this
  release; vacancies are visible.
- GOV-AUTH-005: an ex-officio seat references the qualifying office.
- GOV-AUTH-006: a mandate has exactly one holder type and can only narrow its source.
- GOV-AUTH-007: a standing decision route references a standing mandate.
- GOV-AUTH-008: a rule remains suggested until its applicable source and adoption route
  are confirmed.
- GOV-AUTH-009: a draft governance change cannot authorise its own adoption.
- GOV-AUTH-010: a collective decision requires its supported procedure; an approval count
  is not a resolution.
- GOV-AUTH-011: an adopted resolution and current executor authority are separate facts.
- GOV-AUTH-012: implementation, evidence submission and verified closure are separate
  states.

## Primary-source boundary

The framework was checked on 7 October 2026 against the official
[CBSE Affiliation Bye-Laws](https://www.cbse.gov.in/cbsenew/aff-bye-laws.html),
[Ministry clarification on the 2026 SMC Guidelines](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2263719&lang=1&reg=20),
[UGC autonomous-college regulations, 2023](https://www.ugc.gov.in/pdfnews/0367475_UGC-(Conferment-of-Autonomous-Status-upon-Colleges-and-Measures-for-Maintenance-of-Standards-in-Autonomous-Colleges)-Regulations,-2023.pdf),
[Ministry reply on coaching regulation](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2298513&lang=1&reg=1),
and the [Ministry reply on education fees](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2298339&lang=1&reg=48).
These sources support specific examples, not a universal legal template. Each institute
must retain its applicable State/UT, board, university, governing-document and effective-
date evidence.

## Retained model coverage cases

These 35 conceptual challenges were migrated from the former framework's Appendix B
on 29 October 2026 before retiring the duplicate Word document. They preserve the
scenario and its required distinction/failure boundary, not a promise that every
capability exists. Implement only a reviewed owning-domain slice through the current
Model Core, canonical People and shared neutral routes. A reusable definition is not
a second workflow runtime, and conceptual records do not prescribe table counts.

| Case and challenge | Required model behavior and failure to prevent |
| --- | --- |
| C01 · School class VI-B has common subjects and different teachers. | Programme/curriculum, period, enrollment, administrative cohort, offerings, teaching groups and staff assignments remain distinct. A class-section supplies a convenient default roster, not every subject's delivery or teacher permission. |
| C02 · One teacher teaches VI-A/VI-B, leads VI-B and a mixed-grade club. | Each scoped duty permits only its own actions/learners. A designation or teacher-to-class link must not become broad subject editing or prevent simultaneous responsibilities. |
| C03 · Midyear VI-A → VI-B transfer, then next-cycle VII-A progression. | End/start effective memberships while preserving completed-session rosters, marks, periods and historical access context; changing the current class cannot relocate history. |
| C04 · Six-week remedial group and mixed-age sports cross sections. | Dated instructional/activity memberships can coexist with an unchanged administrative home cohort, without duplicated learners or fictitious permanent sections. |
| C05 · College admission batch spans study stages and teaching sections. | Programme enrollment, admission cohort, progression/current period and actual teaching roster are independent; repeats/leave must not break a rigid batch→semester→class tree. |
| C06 · Three departments share an elective that fulfils different requirements. | One offering/session/teacher/capacity/result serves several programmes. Each curriculum separately maps requirement fulfilment; copying the delivery per department is not convergence. |
| C07 · Electives have credit limits, prerequisites and an approved substitution. | Versioned requirements, credits, completed attempts, eligibility and exception evidence govern choices; tree position or arbitrary form fields cannot calculate or authorize them. |
| C08 · A failed course is repeated next term with another teacher. | Retain separate offerings, registrations/attempts, instructors and results. An explicit repeat-policy version chooses progression treatment; a single overwritten grade loses provenance. |
| C09 · Supplementary assessment/review without repeating teaching. | Distinguish assessment attempts, reviewed result versions and appeal/correction from a new course registration; do not invent classes, attendance or fees to express reassessment. |
| C10 · Same course name/code acquires a new syllabus, credits or scheme. | Version course/curriculum and bind each offering/outcome to its applicable version and effective dates; a current catalogue edit cannot relabel old transcripts or requirements. |
| C11 · One lecture cohort, two tutorials and four labs have different schedules. | One course registration may have several component-specific group memberships; validate required combinations rather than cloning the course or using unrelated unconstrained groups. |
| C12 · Main programme plus minor/certificate may share one result. | Concurrent programme enrollments retain their own requirement/credit-allocation/reuse rules. Reference one achievement without duplicated learner/results or unapproved double counting. |
| C13 · Weekly rolling admission grants each learner three months. | Individual registration dates and validity/completion windows govern rolling or self-paced access; a mandatory global year/class must not truncate a late joiner's duration, fees or attendance denominator. |
| C14 · English, coding and mathematics have independent start dates. | One learner has concurrent offerings, groups, agreements, schedules, prices, lifecycle and progress. Updating one current batch/fee field cannot overwrite the other courses. |
| C15 · Test-only, monthly membership and class/test bundle purchases coexist. | Explicit dated product entitlements authorize their intended assessment/service participation; teaching/programme enrollment is optional. An invoice/payment alone is not an entitlement or classroom. |
| C16 · Seven-day trial converts to paid study. | Preserve identity, practice progress, participation and commercial history; conversion changes explicit validity/access, not deletion/recreation or a permanent trial-active flag. |
| C17 · Evening learner seeks a full morning group. | Retain waitlist/request and effective transfer; commit against actual capacity, approvals, timetable and applicable commercial adjustment. Preserve historical session membership. |
| C18 · Study pauses and later resumes selected outstanding courses. | Coordinate explicit academic standing, pause periods, attempts, attendance eligibility, entitlements and billing rules; one active flag cannot encode these independent states. |
| C19 · One teacher works at campuses with travel/setup constraints. | Conflict checks reuse the same person across authorized assignments and practical travel time, without exposing unrelated campus records or granting organization-wide access. |
| C20 · Departments/events share labs, halls and equipment. | Teaching and nonteaching bookings consume the same resource availability/capacity/setup constraints at commit. Separate department/event trees must not each reserve the same asset. |
| C21 · Independent franchise centres share brand/templates and limited reporting. | Preserve operating-entity/institution data and financial boundaries; scoped membership/reporting grants, not a parent tree, authorize head-office summaries/private information. |
| C22 · One group runs different campus curricula plus college/coaching. | Each programme/campus binds applicable curriculum, local policy/calendar, catalogue and scoped enrollment. Shared defaults cannot overwrite distinct operating models. |
| C23 · Weekday school and weekend coaching use different holidays/terms. | Applicable programme/offering calendar, period, occurrence and dated exception determine scheduling and expected attendance, not one global school-day flag. |
| C24 · Adult learner has no guardian or chooses limited family assistance. | Account/relationship/representative grants are optional, action-scoped and dated. A mandatory parent field must neither block adult learning nor disclose records to unapproved contacts. |
| C25 · One person is staff, parent of two and an evening learner. | Evaluate each action's institution, capacity, relationship, enrollment and exact target; no persona portal, single global user type or unrestricted permission union. |
| C26 · Guardian views progress, grandparent pays, neighbour collects Fridays. | Verify and independently scope view, consent, payer and pickup authority by child/action/date; a payer or generic family link must not reveal location or authorize collection. |
| C27 · Instalments, sibling concession and threshold-approved scholarship combine. | Version the plan/agreement and eligibility; retain request, independent approval/limits and posted financial adjustment separately. An unrestricted discount field cannot replace evidence or authority. |
| C28 · Cancellation follows some delivered sessions. | Calculate/approve adjustment against the applicable agreement/policy and actual consumption; end the proper entitlement and retain original payments, learning and refund evidence. |
| C29 · Centre transfer changes issuer; sponsor funds one programme. | Contracting entity, invoice issuer, agreement, payer allocation and adjustments remain scoped. A group-wide wallet cannot merge obligations that have distinct owners. |
| C30 · Hostel bed changes and hostel leave coexist with academics. | Residence service, exact hostel/room/bed allocation, capacity, movement/leave and service charges retain independent dated history; a class field or academic attendance cannot express occupancy. |
| C31 · Different morning/afternoon routes, later transport suspension. | Retain route/trip/stop/dated roster, entitlement, boarding, pickup authority and service billing independently of classroom enrollment/attendance; one bus field loses direction/date/evidence. |
| C32 · Cancellation, substitute session and makeup all occur. | Retain distinct occurrences/status/replacement links, staff/resources and observations. Applicable delivered sessions alone affect attendance/consumption; editing a cell must not erase or double count them. |
| C33 · Numerical marks, pass/fail and ranked coaching tests coexist. | Typed schemes, attempts, raw evidence, versioned calculations, comparison population and publication scope retain actual meaning; neither marks-out-of-100 nor arbitrary fields are universal outcomes. |
| C34 · Hybrid course mixes classes, recordings and practice tests. | Component entitlements and explicit completion policy combine distinct physical, consumption and assessment evidence; video access must not become classroom presence. |
| C35 · Grading/refund policy changes after final outcomes. | Bind configuration versions/effective scope and retained decision snapshots; only authorized explicit correction/migration changes historical results or transactions. A live settings edit cannot silently recalculate them. |

## Retained governance acceptance cases

The following 24 cases preserve the former framework's Appendix D. They are future
acceptance conditions unless a release-bound test demonstrates the owning slice;
the foundation status above is not blanket acceptance. Use the institution's actual
adopted procedure, not a universal quorum, threshold or approval chain.

| Case and challenge | Required result |
| --- | --- |
| G01 · Agenda administrator adds themselves to a body. | Appointment authority is required; technical access supplies no seat, vote or institutional power. |
| G02 · Principal's concession delegation is used for annual fee policy. | Resolve the applicable reserved/external fee procedure; an individual-concession mandate cannot adopt the policy. |
| G03 · One member holds employee and officeholder positions. | Apply verified identity and the adopted representation/voting rule; app roles do not multiply votes. |
| G04 · A member leaves/recuses before a motion. | Re-evaluate item-specific eligible participation, quorum and threshold, retaining reason and evidence. |
| G05 · One abstains and another is conflict-excluded. | Retain distinct abstain/recuse states and explicit denominator treatment; neither is implicitly yes or missing. |
| G06 · A required seat category is vacant. | Enforce actual composition/quorum and any authorized vacancy rule; invitations are not participation. |
| G07 · Appointment expires during circulation. | Apply declared continuation/replacement/restart; do not silently change the electorate or recorded responses. |
| G08 · Former member acts through an old mobile task/session. | Recheck current eligibility for the new action while retaining authorized historical visibility. |
| G09 · Amount changes after recommendation/voting. | Create a new material proposal version and renew affected decisions; old approval cannot authorize the changed effect. |
| G10 · Academic approval exists but required finance decision is pending. | Keep activation pending until every required authority and external condition is satisfied. |
| G11 · Resolution's original members later depart. | Preserve the historical resolution and explicit current status; turnover does not automatically erase a valid decision. |
| G12 · Executor loses permission after adoption. | Preserve the resolution, refuse the former executor's new command and route execution to currently authorized responsibility. |
| G13 · Unknown refund reply leads to retry. | Deduplicate the exact business effect and reconcile actual provider state; approval does not establish settlement. |
| G14 · Related purchases split a period-limited mandate. | Apply the adopted aggregation/usage policy atomically; new request IDs do not reset a delegated ceiling. |
| G15 · Draft lowers quorum and uses it to adopt itself. | Evaluate under current effective amendment authority or a separately verified external instrument, never self-authorizing configuration. |
| G16 · Signed physical minutes are entered later. | Retain source, real decision date, capture time and verification; do not fabricate individual app ballots. |
| G17 · Signature exists but the required body has not decided. | A signature proves only its supported evidence; missing decision power/procedure remains unresolved. |
| G18 · Offline response arrives after closure/material change. | Server checks current time, version and eligibility; an unaccepted offline draft cannot appear as a recorded vote. |
| G19 · Principal is the complaint subject. | Use the applicable independent/alternative route and confidentiality instead of returning the case through the accused person's default reporting line. |
| G20 · Governor seeks unrelated personnel/counselling attachment. | Enforce exact record/field projections; body membership is not unrestricted private-case access. |
| G21 · Urgency claims a process exemption. | Require defined emergency power, limits, evidence and subsequent review; never invent prior approval. |
| G22 · Only authority is unavailable with no acting/succession instrument. | Keep decisions pending through an authorized continuity path; technical account recovery cannot appoint a successor. |
| G23 · Internal approval awaits external order/acceptance. | Require verified scoped external-condition evidence; submission is not acceptance. |
| G24 · Implementation owner ticks complete without evidence. | Retain submission and require configured evidence/independent verification; unjustified closure leaves overdue/unresolved work visible. |

Tests derived from these cases must also exercise foreign institution/world,
revoked authority, stale material versions, duplicate/uncertain effects, concurrent
capacity/mandate consumption, privacy and historical corrections. Each implemented
slice uses the same ordinary services and isolated Simulation contract. The
[verification guide](../VERIFICATION.md) distinguishes conceptual coverage from
executed source, native, browser, runtime and physical-device acceptance.
