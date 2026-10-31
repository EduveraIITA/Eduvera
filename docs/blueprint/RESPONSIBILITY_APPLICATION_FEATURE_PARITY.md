# Responsibility application feature-parity inventory

Status: active migration gate, 18 October 2026

Normative parent: [Responsibility-composed application](RESPONSIBILITY_COMPOSED_APPLICATION.md)

This inventory prevents the move from persona menus to a responsibility-composed
application from reducing the product. The old screen is only a **baseline** of
capabilities that must be carried forward; it is not the desired page, route or
organization. **Converged** means the feature has evolved into a responsibility- and
relationship-scoped canonical workspace, a normal user can discover it from Today,
Work, Areas or More, and every useful baseline action and record remains available.
An old route becomes a bookmark-only redirect only after focused convergence tests
pass. “Retained” below means the capability is protected while it is migrated; it
never means the existing page design, persona shell or route tree is accepted as the
finished experience.

The route names below are implementation evidence, not permission to infer authority
from `teacher`, `principal`, `parent` or `student`. Current authority remains
server-checked by the owning domain while neutral routes are introduced.

## Cross-application behaviour

| Capability | Required composed experience | Current gate |
| --- | --- | --- |
| ThatCampus AI | Persistent shell action plus `/areas/assistant/conversation`; same authorized tools and return context | canonical shell action restored; end-to-end parity must remain tested |
| Notifications | Header access, unread state and safe exact links | retained; exact links must converge without losing scope |
| Live / Simulation | Same route tree and screen components, isolated data/cache/realtime | retained; every enabled domain needs a scenario adapter |
| Account, appearance and security | More/account access on every supported identity | grouped manifest contributions, guarded shared-shell presentations and canonical router integration present; onboarding-only `/account/security` remains intentionally separate |
| Relationship/scope selection | Current child/class/campus retained across links and back | retained in domain shells; composed-shell continuity remains a gate |
| Attention | Real owned work and descendant attention without fake counters | Work projection exists; domain/descendant parity remains a gate |

## Canonical More inventory

More is an ordered set of server contributions, not a persona menu. A visible item
only makes an already-authorized domain surface discoverable; the owning API still
rechecks every read and mutation. The current convergence inventory is:

| Baseline capability | Canonical destination | Manifest evidence | Owning authorization / remaining boundary |
| --- | --- | --- | --- |
| Profile, appearance, assistant preference and memory | `/more/account` | every active workspace relationship | account APIs; neutral shell-free body implemented |
| Email verification, MFA and recovery codes | `/more/account/security` | every active workspace relationship | account security APIs; onboarding confirmation remains a separate journey |
| Calendar export/subscription and supported messaging connections | `/more/connections` | Live plus an institution-wide authority, active assignment, self relationship or dependent relationship | scope is derived from the manifest; connector APIs still use hidden legacy audience transport values; absent from Simulation to prevent external side effects |
| Current, future and historical responsibility assignments | `/areas/responsibilities/mine` | at least one effective assignment projection | staff-work domain; broader neutral action/history convergence remains open |
| Published policies and acknowledgements | `/more/policies` | active institution relationship | published-policy API filters effective audience and records exact-version acknowledgement |
| Teaching feedback response and coordination | `/more/feedback` | server manifest contributes exact `teacher_feedback.respond` learner/dependent scopes and/or `teacher_feedback.coordinate` institution scope | one neutral workspace composes only the contributed surfaces; pending-response and coordination APIs independently recheck eligibility; broader delegated management authority remains open |
| Institution authority, policy register/profile and audit | `/more/governance` | current administrator authority | governance API remains authoritative; responsibility-native delegation is open |
| Campus View | `/more/campus-view` | current administrator authority | Campus View API rechecks cross-campus oversight access |
| Non-blocking organization verification | `/more/verification` | current administrator authority | progressive-setup/verification API; it never blocks ordinary campus setup |
| Campus, people/access, invitations, organization, responsibilities and capabilities setup | `/more/setup/*` | exact `sis.manage`, `members.invite`, or current administrator authority as required by each contribution | setup/domain APIs recheck authority; one neutral editor per action |
| Cambridge development settings and Campus Lab | `/more/development*` | Cambridge fixture, current administrator authority and Live environment | build flag plus development APIs; absent from Simulation and customer institutions |

Legacy Teacher, Principal, Parent and Student More URLs are query-preserving bookmark
redirects into these guarded routes. They are not additional products or acceptable
authority selectors.

## Relationship-scoped learner and family journeys

| Domain capability | Capability baseline to carry forward | Canonical home | Status |
| --- | --- | --- | --- |
| Home/current day | learner and family home | Today | composed projection present; domain richness parity open |
| Attendance | personal/dependent attendance, eligibility and history | Attendance Area | canonical exact self/dependent surfaces present with query-scope tests |
| Timetable and calendar | day/week/month published schedule | Separate Timetable and Calendar Areas | Calendar contribution derives the same authorized Timetable scope evidence at `/areas/calendar`; retained nested Calendar URLs redirect with child/date/attention context. UI and focused regression evidence are recorded with the owning implementation; this navigation separation does not claim all historical adapter convergence. |
| Leave | apply, authorize and track | Attendance or Work, exact domain screen | retained; canonical contribution open |
| Diary/homework | notes, homework and announcements | Messages Area | canonical exact self/dependent diary workspace present |
| Messages | school, teacher and family conversations | Messages Area | canonical responsibility/self/dependent conversation workspace present alongside Updates and Diary |
| Notices | updates, detail and recorded responses | Messages Area | canonical exact relationship update list/detail present |
| Events | invitations, consent, preparation and detail | Events Area | canonical relationship calendar/detail present with RSVP, consent, preparation and withdrawal parity |
| Results and progress | published results, feedback and trends | Assessments and Reports Areas | canonical learner/dependent results workspace present; broader Reports convergence open |
| Fees | invoices, receipts, balances, payment/review history and authorized guardian actions | Fees Area | one manifest-composed Fees entry now combines only the contributed institution-ledger, self and dependent contexts; the exact account workspace preserves statements, invoices, receipts, print, review history and authorized payment/enquiry actions without choosing a Parent or Student page |
| Departure/transport | approved arrangement, change request and journey | Departure Area | one self/dependent plan workspace preserves learner selection, dated plans, change requests, current journeys, gate pass and attention history; old family/learner URLs redirect and the presentation no longer selects a guardian persona |
| Policies | published policies and acknowledgements | More / Policies | neutral manifest contribution and guarded shared-shell presentation mounted; persona bookmarks redirect |
| Teacher feedback | submit a teaching check-in | More / Feedback | relationship-filtered response is composed from exact manifest capability/scope metadata; persona bookmarks are query-preserving redirects |

## Staff and operational journeys

| Domain capability | Capability baseline to carry forward | Canonical home | Status |
| --- | --- | --- | --- |
| Today/operating day | current class, register and next work | Today | first projection present; full operating-day parity open |
| Registers | assigned register, submit, correct and history | Attendance Area | canonical register presentation and action parity present; responsibility-native list API convergence open |
| Attendance coordination | exception and follow-up review | Attendance Area | canonical coordination presentation present; neutral scoped projection/command convergence open |
| Timetable | day/week schedule | Timetable Area | canonical responsibility schedule with day/week navigation present |
| Timetable planning | draft, conflict review and publish | Timetable Area | canonical planner, positional edit, day-plan and settings surfaces present |
| Classes and rosters | assigned classes, learner roster and class work | People Area | canonical `classes` contribution, router mounts and bookmark redirects are integrated with an exact class-scoped read boundary; assigned directory, dated lessons/status, roster list/gallery/search, class facts/materials, recent updates/read action and Attendance/Timetable hand-offs are preserved |
| Messages | school and family conversations | Messages Area | canonical responsibility conversation workspace present alongside Updates and Diary |
| Notices | create, edit, deliver and review responses | Messages Area | canonical responsibility update list/create/edit/detail present |
| Events | create/edit activity, sessions and event attendance | Events Area | canonical assigned/manage workspaces and exact detail/register actions present |
| Assessments | assigned exams, marking and invigilation | Assessments Area | canonical assigned workspace present with the existing examination/marking actions |
| Reports | report remarks, grading schemes, generated releases, review and publication | Reports Area | canonical responsibility workspace present; the domain response, not a Teacher/Principal route choice, determines available coordination actions |
| Leave | balances, application and decision history | Staff Work Area | retained; canonical contribution open |
| Responsibilities and cover | assignments, offers and accepted cover | Work and Staff Work Area | Work deep links partially present; full Area parity open |
| Departure/transport | operate assigned journey and roster | Departure Area | canonical assigned-journey workspace uses active institution and responsibility context and preserves assignment response, cover/exchange coordination, boarding, roster evidence, location, handover and cancellation; Teacher bookmark redirects |
| In & Out | record authorized arrivals/departures/visitors | In & Out Area | canonical operate surface present |
| Student care | protected intake, assigned cases, factual actions, external-report evidence, care-team routes and message reports | Student Care Area | canonical protected-care workspace resolves institution and exact review capability from the current manifest, loads message-report tooling only when contributed, and preserves case/team actions and history without Teacher/Principal presentation branches |
| Policies | staff policy review and acknowledgement | More / Policies | neutral guarded presentation mounted against the published-policy API; persona bookmark redirects |
| Insights | authorized trends and review | Insights Area | canonical assigned-work and exact self/dependent surfaces present; all trend, result, progress and related domain actions retained in one neutral wrapper; analytics endpoint audience remains a hidden transport discriminator while authority stays domain-checked |

## Administration, coordination and governance

| Domain capability | Capability baseline to carry forward | Canonical home | Status |
| --- | --- | --- | --- |
| Campus setup | spaces, academics, access, history and promotion | More / Setup | More exposes one Campus setup journey instead of competing shortcuts; the neutral setup overview and guarded institution editors preserve spaces, academics, operating rules, history, promotion and correction paths |
| People and invitations | directory, enrolment, guardian authority, import and invitations | People Area and More / Setup | server-composed People surfaces plus the neutral People setup journey preserve records, import, account access, invitations and responsibility hand-offs; owning APIs remain authoritative |
| Responsibilities and staff | templates, assignments, detail and leave decisions | More / Setup and Work | canonical entries mounted; scope/deep-link parity open |
| Organization | units, teams and reporting lines | More / Setup | neutral guarded setup presentation mounted; organization remains descriptive and does not grant application authority |
| Capability activation | progressive capability readiness | More / Setup | neutral guarded progressive-capability presentation mounted from the composed setup journey |
| Operating rules | explicit reviewed automatic behaviour | More / Setup | canonical route mounted |
| Campus View | live/simulated operational observability | More / Campus oversight | neutral manifest contribution and parameterized shared-shell/canvas route mounted; environment guard and canonical-marker tests pass |
| Experimental/Campus Lab | Cambridge-only simulated-human controls | More / Development tools | retained by owner decision; Live Cambridge administrator-only contribution and guarded neutral routes are mounted; hosted-runner boundary remains open |
| Gate management | entry points, passes, visitors and records | In & Out Area | canonical manage surface present |
| Assessments | create, schedule, coordinate and moderate | Assessments Area | canonical manage workspace present; authority convergence for non-administrator scoped creation remains open |
| Reports | grading schemes, generated term reports, moderation and publication | Reports Area | canonical responsibility workspace present with scheme, release, remarks, correction and publication parity; responsibility-native backend authority remains an open convergence gate |
| Fees | invoices, offline payment, receipts and reconciliation | Fees Area | manifest-contributed neutral ledger workspace preserves invoice, receipt, offline-payment, review, settings, print, history and correction actions; relationship accounts compose beside it only when genuinely available |
| Departure | routes, rosters, handover and journey detail | Departure Area | neutral manage/detail workspaces preserve requests, rosters, duty swaps, routes, recurring service setup, dated trips, receiver authority, assisted intake, handover, journey map/history and reconciliation; attention comes from composed Work and Principal bookmarks redirect; backend delegated authority remains open |
| Governance | policies, authority and decision rules | More / Governance | one neutral More presentation preserves policy, authority, decision-rule and audit work without a Principal/Admin screen choice; the owning API still requires current administrator authority while broader delegation remains open |
| Verification | non-blocking organization verification | More / Campus oversight | neutral shared-shell presentation mounted without blocking setup |
| Insights | institution, attendance, learning, operations and finance review | Insights Area | canonical institution surface present with attendance, learning, recording, follow-up, coverage/deadline and finance topics; internal and assistant hand-offs use neutral Area routes; generalized delegated institution-review authority remains open |
| Feedback | create/close teaching check-ins, review protected results and answer current requests | More / Feedback | one environment-qualified neutral workspace preserves coordination, results, response and deep-link actions; surfaces derive from exact server manifest metadata and persona bookmarks only redirect; delegated coordination beyond current administrator domain authority remains open |

## Redirect acceptance checklist

For each old bookmark proposed as a redirect, the owning test must prove:

- identical authenticated eligibility and server authorization;
- preserved query/hash scope, especially `student_id`, date, class, campus, record and
  return-location context;
- every prior read and mutation action remains available;
- attention and notifications deep-link to the exact canonical record;
- browser, hardware and in-app back return to a meaningful composed destination;
- Live never leaks into Simulation and Simulation never mutates Live;
- mobile, keyboard, loading, empty, unavailable, denied and revoked states remain
  usable;
- the feature is normally discoverable without knowing its previous URL.

Until these assertions pass, the existing route may remain only as a bounded safety
entry while the feature is actively evolved. Mark the canonical contribution open in
this inventory; never describe the old page itself as the accepted destination.
