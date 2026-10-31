# ThatCampus operating experience

Status: accepted product and interaction direction, 16 October 2026; responsibility-
composed application revision accepted 18 October 2026

Normative parent: [ThatCampus product blueprint v2](PRODUCT_BLUEPRINT_V2.md)

Backend companion: [Campus digital twin and agency architecture](CAMPUS_DIGITAL_TWIN_AND_AGENCY_ARCHITECTURE.md)

## 1. Purpose

This document defines how the Campus Model Core becomes a usable real-campus
operating experience. It is the shared contract for product, design, frontend,
backend, automation and acceptance work.

ThatCampus must feel like a calm operating layer for a living campus. It must not feel
like an ERP catalogue, a generic workflow builder, an AI-agent console or a collection
of disconnected dashboards. The model may be highly connected and event-reactive;
the interface remains responsibility-appropriate, direct and expressed in ordinary
campus language. A person never chooses a job-title portal in order to work.

Product work starts with a concrete person doing concrete campus work, not with a
table, event type, agent primitive or navigation category. For each workflow, first
describe the person's responsibility and context, the shortest successful path, what
can interrupt it, what remains visible afterward and how the person corrects a
mistake or hands work on. Validate that operating experience in ordinary campus
language and on the smallest supported mobile viewport. Only then derive the owning
domain contract, projections, authority checks, evidence and Model Core coordination
needed to make it truthful. This is experience-first, not visual-polish-first.

At any operational screen a user should be able to answer:

1. What is happening now?
2. What genuinely needs my action?
3. What will happen next?
4. What happened automatically, and why?
5. Where can I correct, override or escalate it?

Success is measured by reduced operator burden and clearer campus truth, not by how
much model machinery is visible.

## 2. Experience constitution

### 2.1 The campus is modelled once

A learner, teacher, class, subject, room, event, route, request or device is created
once in its authoritative domain and reused wherever eligible. A user must not maintain
parallel attendance, timetable and examination copies of the same class or roster.

### 2.2 Today is a projection, not another source of truth

Today, Work, Areas and search surfaces summarize or route to domain
records. They do not implement a second editor or a second workflow. The authoritative
Attendance, Timetable, Leave, Transport, Examination or Finance screen performs the
action.

### 2.3 Agents are invisible infrastructure

The backend may coordinate human, team, device, integration and software agents. The
UI says **Teacher**, **Principal**, **Office team**, **Main Gate reader**, **Request**,
**Task**, **Offer** and **Update**. It never asks a campus user to operate an actor
graph, mailbox protocol, reaction instance or command envelope.

### 2.4 Automation is configuration-driven

No production agent contains hard-coded or self-adapting operating behaviour. Agent
subscriptions, reaction routing, recipients, timing, escalation, autonomy, tools and
optional model policy come from validated, versioned and effective-dated institution
configuration and Operating rules.

Users configure behaviour in domain language. The system may ship visible templates,
but activation always creates explicit institution configuration. Missing or invalid
configuration means no automatic action or the configured human fallback—not a hidden
default.

### 2.5 Routine work is automatic; judgment remains owned

ThatCampus should remove repetitive coordination when a reviewed Operating rule
permits it. It must not automate authority, consent, safeguarding conclusions,
financial reconciliation, identity proof or physical handover beyond the explicit
domain contract.

### 2.6 Truth dimensions remain distinct

- **Planned:** expected by timetable, calendar, route or assignment.
- **Observed:** reported by a human, device or integration.
- **Submitted:** an actor completed a defined input step.
- **Accepted:** the owning domain validated and recorded the decision.
- **Derived:** a source-backed projection or bounded inference.
- **Corrected:** a later authorized revision superseded earlier state.
- **Unknown:** the evidence is absent, stale, conflicting or outside scope.

Missing evidence is never silently converted into absence, consent, presence,
completion or failure.

## 3. Core-to-interface language

| Core concept | Interface language | UI rule |
| --- | --- | --- |
| model entity | student, teacher, class, room, route, event | use the domain noun and familiar identifier |
| human/team/device agent | person, responsible team, registered device | show responsible actor and scope, not agent IDs |
| domain event | activity or status change | show only when useful for action, explanation or history |
| subscription/reaction | Operating-rule trigger/action | ordinary users see the result; administrators see the readable rule |
| agent message | request, task, offer or update | render by purpose, not as technical chat |
| command/outcome | action and result | keep pending, accepted, conflicted and failed distinct |
| authority | responsibility and access | explain missing access without exposing policy internals |
| observation | recorded by/source/time | never present an observation as broader physical truth |
| projection | Today, schedule, summary or current status | include freshness/source where it changes interpretation |
| correlation/causation | history and why this happened | retain full trace; progressively disclose it |

## 4. Shared application shell

### 4.1 Working context

The shell always knows the current institution, campus/scope where relevant,
person/child relationship where relevant and execution context (authoritative `live`
or one explicit transient simulation run). It composes the signed-in person's current
experience from effective responsibilities, current authority, capability readiness,
owned work and time; it does not select a persona portal.

- Do not silently combine Administrator and Principal authority.
- Multiple responsibilities contribute to one experience. Do not show a role or
  portal switcher. Show a campus/scope selector only when it materially changes the
  records in view.
- Retain the selected context until the user changes it or it becomes invalid.
- A deep link may request a context, but the server rechecks current access before the
  shell switches.
- Context switching returns to the equivalent safe home, not a stale unauthorized
  screen.
- Ordinary entry points open Live. Entering Simulation is an explicit authorized
  action that changes the server-authoritative execution session, not the route map
  or module hierarchy.
- Every active institution administrator receives the same canonical **Simulation**
  contribution in Campus oversight. Do not gate it by institution code, demo profile
  or development mode. A newly onboarded or attendance-first institution can create
  a snapshot-only baseline before campus/timetable setup; setup/readiness guidance
  then states which interventions and domain behavior are not yet modelled.
- The same shell, navigation and screens remain in place. Live keeps the established
  blue palette; Simulation applies the reviewed warm amber palette across the whole
  application. Do not place a floating environment pill over profile/account controls.
  Virtual time and **Return to Live** belong in the owning Simulation workspace. Do not
  create a parallel simulation dashboard, mini-app or second set of domain tabs.
- Environment is inherited by every child route, data hook, action and realtime
  subscription. An environment switch clears or partitions cached data before the
  same screen renders from the selected state.
- During development, a screen with no scenario-native adapter shows **Not modelled
  in this run** and never fills from Live APIs. Release acceptance requires adapters
  for every enabled module, so an administrator sees the complete app rather than a
  mixture of operational and placeholder screens.

### 4.2 Stable responsibility-composed navigation

Every authenticated person uses four stable primary destinations:

1. **Today** — Now, genuine attention and near-term plan;
2. **Work** — Requests, Tasks and Offers owned by the person or their team;
3. **Areas** — enabled domain workspaces available through a current responsibility or
   explicit relationship;
4. **More** — lower-frequency personal, setup and governance tools where authorized.

These labels and positions remain stable. Responsibilities determine content, records
and domain entries inside them—not a different tab bar. Events may update content or
attention indicators but never reorder destinations. Capability activation changes
Areas through an explicit accepted result. ThatCampus AI may appear within Areas or
More when enabled and authorized; it does not displace a primary destination. It also
remains a persistent cross-application action in the shared shell so a navigation
migration cannot accidentally remove conversational access.

Owner clarification, 29 October 2026: selecting a different primary destination
retains each tab's current screen, date, filters, scroll and safe local drafts.
Selecting the **already active** Today, Work, Areas or More tab is a deliberate
return to that tab's base page, with its local view state reset. It does not reset
the other tabs. This repeated selection follows the loss and busy guards in
section 4.4; platform layout changes or programmatic tab focus are not user reset
requests.

Changing the application organization is capability-preserving. Every existing
domain journey must have a tested responsibility- or relationship-scoped canonical
home before its former navigation entry or bookmark becomes a redirect. Rendering the
same component is insufficient when scope, actions, attention, return state or normal
discoverability are lost. The complete parity gate is defined in
[Responsibility-composed application](RESPONSIBILITY_COMPOSED_APPLICATION.md).

The normative composition, neutral-route and migration contract is
[Responsibility-composed application](RESPONSIBILITY_COMPOSED_APPLICATION.md).

### 4.3 Header and page hierarchy

The shared header identifies institution/context and provides notifications and
account access. A page has one title, an optional concise scope/date subtitle and one
predictable back destination.

When Back is available, the shared top control visibly shows a back arrow followed
by the destination's readable name; its accessibility name is
**Back to {destination}**. The destination remains visible rather than collapsing to an
unlabelled arrow. Hide the institution crest/name and page title in that top header
while Back is shown. The owning content keeps its single page heading; do not
repeat it in the header or add a second body back control. Without Back, the top
header may identify the institution as usual.

Avoid stacked title bars, repeated institution names, competing card headings or
multiple primary calls to action. Search, filter and view controls belong immediately
above the content they change.

Owner visual direction, 20 October 2026: use a clean, restrained composition with
small green/yellow illustration accents from the supplied ThatCampus logo. Warmth
must coexist with clear operational meaning; decorative blue side stripes are not
the emphasis mechanism. Live actions stay blue and Simulation remains amber.
Today gives a current activity one clear owning action, then presents upcoming
activities as compact rows. Do not repeat Now/Next inside every item or display
routine provenance as competing body copy. Source details remain discoverable,
and dates, planned-versus-recorded distinctions and critical warnings stay truthful.
The owner reviews the rendered experience; passing tests do not establish visual
approval or completion of every screen's polish.

The normative implementation direction is [ThatCampus theme](THATCAMPUS_THEME.md):
flat colourful feature icons, the unchanged branded Assistant mark, rounder
inset surfaces and purposeful depth. Tappable filled entries must remain distinct
from the canvas in both appearances. Dense queues use contextual categories,
search over the complete authorized result set and short finite pages, preserving
filters and the return location rather than showing forty entries at once.

### 4.4 Predictable back and dismissal

Owner priority, 29 October 2026: a person must be able to predict where Back will
take them. Use one shared top back control; do not repeat page-body “Back to…”
buttons as a substitute for correct navigation. The control's destination label
and accessibility name describe the actual return context. Native system
navigation, gestures and Android Back follow that same in-app decision; the
browser retains its normal Back/Forward history and external-app exits retain
the operating system's conventions.

- Back returns to the previous context, date, filters, expansion and scroll position.
- An item opened from Work or a notification returns to that originating context,
  rather than an unrelated retained tab or a generic domain landing page. Keep
  each return tied to an actual navigation entry and the confirmed account,
  campus and Live/Simulation scope. Do not infer it from a job title or accept an
  arbitrary return URL as trusted history.
- Opening another item or an editor adds a navigation level. Search, dates,
  filters, sorting and finite pages update the current view without adding a
  sequence of Back stops. A return pops or dismisses an existing level; it never
  pushes a duplicate parent that makes Back reopen the detail just left.
- Closing a sheet returns to the unchanged underlying screen.
- A deep-linked page without history returns to Today, Work or the owning Area as
  appropriate, using a declared semantic parent rather than truncating a URL into
  a route that may not exist. Show that destination before the person acts.
- A change of account, campus, Live/Simulation world or effective access never
  returns into the prior scope's protected history. Temporary same-scope session
  verification retains safe drafts and their loss guards while navigation is paused.
- Warn before leaving only when a real unsaved draft would be lost.
- A switch to another retained tab does not lose its editor and must not prompt to
  discard it. An active-tab reset evaluates **every screen it will remove**,
  including an unfocused editor underneath the current detail. Any unsafe busy
  operation blocks that reset; genuine unsaved edits receive one loss confirmation.
  Cancelling leaves every tab unchanged. Accepting resets only the chosen tab to
  its base, without pushing a duplicate root above the old detail.
- Browser reload or window closure can remove all retained tabs, so protect their
  unsaved or unsafe busy state even when another tab is focused or session
  verification is showing. Persisted recoverable state does not require a discard
  warning merely because the person changes screens.
- A cancelled leave keeps the editor, focus and draft unchanged. Durable saved
  recovery remains discoverable after leaving; Back never submits, abandons or
  automatically replays a command. Guard unsafe in-flight exits without trapping
  the person indefinitely in a recoverable read-only outcome.
- Browser, hardware and in-app back produce the same meaningful result.
- After an owning command acknowledges a successful create or save, its completion
  transition replaces the finished editor rather than leaving a Back path that
  reopens it. An unknown or unacknowledged command is not a completed edit.
- Do not use Back to cancel a committed operation; expose a domain correction action.

The universal migration uses the platform router as the history authority, with
scope-qualified entry metadata only where native retained tabs need an exact
origin. It must not introduce a competing application history stack. Acceptance
covers ordinary and cross-tab entry, direct links, view-state restoration,
different-tab retention, active-tab reset from both a detail and a filtered base,
retained underlying drafts, busy refusal, cancelled/confirmed unsaved exits,
repeated Back, real browser Back/Forward and reload, and scope changes on web,
iPhone/iPad and Android. Verify the visible arrow/destination and accessible name
at the rendered smallest supported viewport. Passing source tests, TypeScript,
exports or native builds alone does not establish these rendered/device behaviors
or close the migration's runtime and retirement gates.

### 4.5 Canonical surfaces and ownership

| Surface | Owns | May show | Must never become |
| --- | --- | --- | --- |
| Today | current responsibility projection and routing | Now, top owned work, Next, material automatic results | a duplicate editor or generic KPI dashboard |
| Work | complete unresolved owned work projection | requests, tasks, offers, filters and exact domain links | the authoritative domain state machine |
| Notifications | delivered informational updates and read state | update text, source and safe deep link | workload, approval state or proof of acknowledgement |
| Areas | discoverable authorized domain workspaces | current areas, readiness and truthful empty states | a persona portal or generic module catalogue |
| Domain workspace | the responsibility-appropriate interface to authoritative domain APIs | current records, direct actions, corrections and domain history | a generic cross-domain object editor |
| More | searchable capability catalogue, lower-frequency tools and administration | real descendant attention markers | a second home dashboard or container of fake counters |
| Administration/Setup | campus configuration, access, connections and Operating rules | readiness for enabled capabilities and audited changes | mandatory full-campus onboarding |
| History/Why | source-backed explanation and prior revisions | actor, source, rule/config version and correction lineage | raw infrastructure logs |
| ThatCampus AI | conversational access to currently authorized domain tools | retrieve, explain, recommend, prepare and bounded execute | system authority, workflow database or required runtime |

### 4.6 Appearance is a device preference

- Every person uses the same Light, Dark or System preference. System is the default;
  an explicit Light or Dark choice takes precedence over the device setting.
- Expose Appearance in the account profile and before authentication on login and
  onboarding. Persist it on this device, apply it before first paint, and reflect
  changes immediately across mounted screens and same-origin tabs. Storage denial
  must not prevent using the application or choosing an in-memory appearance.
- Use shared semantic surface, text, border, action and status tokens. Filled actions
  have their own background/foreground pair; a lightened dark-theme link colour is
  not a suitable filled-action background with white text.
- Preserve institution branding, navigation, information hierarchy and status
  meaning in both themes. Use the supplied ThatCampus artwork with readable lettering
  on dark surfaces. Do not invert photos, documents, QR codes or evidence/map colours.
- Appearance is not a campus rule, role permission, operating state or simulation
  setting. It must never modify domain data or the selected execution environment.

## 5. Today

Today is the user's current operational projection, not a KPI dashboard. Its
default order is:

1. **Now** — the current or immediately upcoming campus context.
2. **Needs attention** — unresolved work owned by the current user/team.
3. **Next** — later scheduled work and preparation.
4. **Completed automatically** — collapsed, meaningful recent automation history.

Sections with no content remain absent or use one concise empty state. Do not show
large zero cards.

### 5.1 Now

Now is driven by effective schedule, assignments and accepted state. It may show:

- the teacher's current class and attendance action;
- a Principal's active operational exception;
- an office operator's current arrival/departure queue;
- a gate operator's active shift and expected groups;
- a guardian's child currently expected at an activity;
- an administrator's blocking device/configuration failure.

Now must not claim live physical location from timetable or a sparse sensor reading.
Use phrases such as **Scheduled in Room 201** or **Recorded at Main Gate at 8:06 AM**.

### 5.2 Needs attention

Needs attention contains only work for which the current user or team is a valid
owner and a real action remains available. It is a compact projection of the shared
work contract in section 6.

Show the most time-sensitive useful items first. Do not let an urgent visual style
make every routine item look like an emergency. The complete queue remains available
through **Work** and opens the one authoritative domain action path.

### 5.3 Next

Next is planned context rather than an action badge. It includes upcoming classes,
duties, events, deadlines and preparation. It may offer contextual creation or direct
editing where the owning domain supports it.

### 5.4 Completed automatically

Show only automatic actions a reasonable operator may need to understand or correct,
for example a substitute assignment, attendance finalization or escalation. Routine
delivery mechanics remain in history/audit, not on the home screen.

Each visible automatic result provides **Why this happened** and, where permitted,
**Correct** or **Request correction**.

## 6. Shared operational work model

Operational communication has four user-facing kinds:

| Kind | Meaning | Typical action |
| --- | --- | --- |
| Request | another actor needs an authorized decision | approve, decline, ask for information |
| Task | the owner must perform or record work | complete, record, resolve, reassign |
| Offer | the recipient may accept or decline responsibility | accept or decline with reason |
| Update | information was delivered; no operational response is required | read or open context |

Requests, tasks and offers can create Needs attention. Updates belong to the
notification centre and never inflate unresolved-work counts.

### 6.1 Required work-item evidence

Every actionable item retains:

- stable work-item ID and domain source;
- kind and domain category;
- institution/campus and subject/context references;
- initiator and current owner/team;
- plain-language title, current status and reason;
- created, effective, due, expiry and updated times where applicable;
- urgency derived from domain state, not arbitrary decoration;
- one primary action and a safe domain deep link;
- authority and Operating-rule/behaviour versions;
- correlation/causation and source event;
- acknowledgement, response and terminal outcome;
- correction, cancellation or escalation route.

The queue is a projection over domain state and agent messages. It does not replace
the authoritative leave request, attendance register, coverage task or other record.

### 6.2 Ownership

A team may own work, but a concrete person or bounded software agent signs the
response. Reassignment is explicit and auditable. Removing the effective
responsibility, team membership or authority immediately removes the ability to act;
it does not delete history.

### 6.3 Priority and ordering

Recommended ordering:

1. safety-critical or explicitly urgent domain work;
2. overdue actionable work;
3. work due soon;
4. other active requests/tasks/offers;
5. future planned work, which normally belongs in Next rather than Needs attention.

The UI must not continuously reorder the list while the user is touching or reading
it. New state may appear as a restrained **Updated** affordance until the interaction
ends.

### 6.4 Needs me and source-backed waiting

Work separates currently actionable **Needs me** from **Waiting** on another
person. Waiting does not inflate Today attention or a reviewer decision badge.
Each contribution comes from its owning source, with an exact current request
revision, retained next owner and raw due time only when that source has one.
Do not label another person's required response as complete or invent an SLA.
Use finite pages and retained view/search/date context over the complete permitted
result set. A source head limit cannot masquerade as the total; test obligations
beyond the former hundred-message boundary or disclose the incomplete coverage.

The first outgoing contribution is the requester's submitted Staff Leave, derived
from native leave and retained submission-route evidence. It closes on accepted
approve/reject/withdraw. If the current governance route no longer matches the
retained reviewer, say **Review route changed — needs reassignment**. Do not imply
that a new officeholder has received the old request. The requester explicitly
sends it to the current reviewer, or that exact authorised reviewer explicitly
takes over, through the native revision-checked Staff action and retained old/new
message lineage. See `STAFF_LEAVE_REVIEW_CONTINUITY.md`. Technical admin status
cannot manufacture that institutional decision authority.

Deduplicate one source/action by environment + owning domain + source identity +
decision action, retaining its Core trace. Different titles or query parameter
spellings must not duplicate a leave decision; unrelated actions must not collapse
by title. Pending assignment dialogs cannot dismiss a write in flight, and an
accepted write followed by failed refresh is distinguished from an unknown write.

## 7. Notifications, badges and attention

### 7.1 Semantics

- Notification count: unread informational updates.
- Navigation dot/count: unresolved actionable work within that destination.
- Status chip: state of the specific domain record.
- Due/overdue label: time relationship, not a second status.

Reading a notification does not resolve work. Completing work may produce an update.

### 7.2 Aggregation

- A parent indicator is the de-duplicated union of currently actionable descendant
  work items.
- Opening the parent screen identifies the corresponding rows immediately.
- Resolving the last descendant removes the parent indicator.
- Past events, future planned items and history never produce unresolved-work badges.
- Invalid/unauthorized deep links remove or quarantine stale attention rather than
  trapping the user.

### 7.3 Visual restraint

- Red is reserved for failed, overdue or safety-significant work.
- Amber indicates timely attention without emergency.
- Blue/neutral indicates new information or an available normal action.
- Green confirms accepted completion; it is not permanently repeated on every row.
- A bottom-navigation destination uses at most one indicator.
- A landing list uses status text/chips rather than a dot on every item.

## 8. Domain workspace contract

Attendance, Timetable, Leave, Events, Transport, Examinations and other operational
modules share an interaction grammar without becoming visually identical.

### 8.1 Workspace anatomy

1. title and current scope/date;
2. date/scope navigation and search/filter where required;
3. truthful compact aggregate summary;
4. main domain content;
5. one primary next action when an action is available;
6. progressively disclosed secondary actions, explanation and history.

Avoid dashboard card grids for sequential mobile work. Prefer full-width grouped
lists, timelines, directly manipulable schedules and compact sheets.

### 8.2 View and edit

View and edit should normally remain one coherent experience:

- select or manipulate the relevant item in context;
- show a draft/pending state immediately;
- validate at the field and workflow level;
- commit once when the domain requires a batch decision;
- keep the primary action visible without covering content;
- preserve safe drafts through temporary navigation/offline operation;
- do not create separate management pages merely to change one value.

Consequential actions may use a focused review sheet. Confirmation is used only when
it changes risk, authority or reversibility—not for every save.

### 8.3 Aggregate correctness

Parent status is computed from child truth and must never contradict it.

Examples:

- `0 of 8 submitted`, not `Submitted`;
- future registers are `Scheduled`, not `Not submitted` or `Submitted`;
- a period group is `Partially submitted` when only some class/subject registers are
  submitted;
- a paid provider order remains `Payment received—reconciliation pending` until the
  ledger accepts it;
- a sent notice is `Delivered` only for recipients with delivery evidence; sent is not
  read or acknowledged.

### 8.4 State completeness

Every workspace defines:

- loading/skeleton;
- empty but valid;
- missing prerequisite;
- unavailable/degraded provider;
- unauthorized/expired authority;
- draft/unsaved;
- pending sync/offline;
- submitted/pending review;
- accepted/completed;
- corrected/superseded;
- conflicted/disputed;
- failed/retryable;
- archived/read-only.

Errors name what happened, whether data was saved, and the next safe action. Avoid
generic messages such as **Check the submitted fields and try again**.

### 8.5 Finite workflows, pagination and purposeful scrolling

Owner clarification, 19 October 2026: do not turn operational work into an endlessly
scrolling stack of setup, controls, lists and results. Separate different tasks into
focused views or short, explicit steps with clear Back/Next navigation and one primary
action. Keep related fields together; optional detail should not become a mandatory
step. Preserve safe form state, filters and selections as the person navigates.

Use bounded pagination for history, record collections and comparisons where location,
selection and return matter. State the current page/range, respect page boundaries,
and retain selections across pages. Do not automatically append an unbounded list.
Scrolling is still appropriate within a coherent form, timeline or results view;
wide comparison tables may scroll inside their own labelled region. Choose the
interaction by the task rather than paginating every few fields or eliminating scroll.

Presentation URLs may preserve the current view, step and page without changing
authority or selecting a Simulation world. After an explicit step/page change, move
keyboard focus to the new heading and keep touch controls comfortably usable. Apply
the restraint and clarity in section 15 using ThatCampus's existing visual language.

## 9. Direct manipulation and time

Where time and position are the domain, the interface should use a time-based canvas:

- timetable/calendar entries are positioned by start and duration;
- a current-time line appears only on the current date;
- empty time can be selected to create a class, event or activity;
- an existing draft can be moved/resized when constraints permit;
- conflicts are shown in context before publication;
- viewing and editing do not require switching between unrelated modes;
- keyboard/list alternatives remain available for accessibility.

Date/time controls use one shared responsive component, stay within the viewport,
respect safe areas and provide native or accessible fallback interaction.

## 10. Automation and Operating rules

### 10.1 Four separate control layers

| Layer | User-facing home | Purpose |
| --- | --- | --- |
| roles and access | Administration > Roles & access | who may act and within what scope |
| behaviour configuration | generated behind domain Operating rules | what events create which reactions/messages/effects |
| Operating rules | Administration > Operating rules | institution-specific timing, threshold, fallback and autonomy choices |
| domain invariants | not editable | non-weakenable validity, safety and accounting constraints |

Normal administrators never edit raw event schemas, recipients queries or agent
graphs. A domain rule editor writes validated behaviour configuration through a typed
backend contract.

### 10.2 Rule index

Operating rules are grouped by campus activity rather than database module:

- Attendance;
- Timetable and daily changes;
- Staff leave and cover;
- Events and activities;
- Gate, departure and transport;
- Communication;
- Examinations/results;
- Finance/reconciliation where automation is permitted.

Each row says what is active in one sentence and identifies its scope. Disabled rules
say what will require manual handling.

### 10.3 Rule editor

An editor progressively reveals:

1. **When** — triggering campus event and timing window;
2. **Where/who** — institution, campus, classes, teams or other eligible scope;
3. **Then** — permitted routine action or request/offer routing;
4. **Wait/retry** — response deadline and bounded retry;
5. **If unresolved** — fallback or escalation owner;
6. **Review** — plain-language example, affected records and autonomy level;
7. **Rehearse** — dry-run/scenario result without live delivery or writes;
8. **Activate** — effective date, approver and version.

No agent may modify or activate its own behaviour. Suggested improvements remain
drafts for authorized review.

### 10.4 Explanation and correction

Every visible automatic action can answer:

- what triggered it;
- which rule/version applied;
- who/what performed it;
- what changed and what did not;
- what evidence is still awaited;
- who owns the next step;
- how an authorized person can correct or escalate it.

Example:

> Cover was offered to Rohan Sen at 8:14 AM because Staff cover rule v3 routes an
> approved absence to an available teacher. A response is due at 8:24 AM. If there is
> no response, the timetable coordinator will be asked to decide.

## 11. Real-time, offline and conflict behaviour

### 11.1 Calm real-time updates

- Apply background updates without resetting date, filters, scroll or open sheets.
- Do not move the row under the user's pointer while they are acting.
- If a relevant record changes, show **Updated—review latest** and reconcile safely.
- Invalidate only affected projections; avoid full-screen reloads.
- A badge may disappear when its underlying work resolves, but the current screen
  retains a brief resolved state rather than vanishing abruptly.

### 11.2 Optimistic interaction

Optimistic UI is allowed only for reversible local presentation or low-risk drafts.
Consequential operations remain pending until the authoritative domain outcome is
accepted. Never show an attendance register, approval, payment reconciliation or
handover as complete merely because the request was sent.

### 11.3 Offline

- Clearly mark **Saved on this device**, **Waiting to sync**, **Sync failed** and
  **Synced**.
- Encrypt and scope offline data to the account and institution.
- Recheck authority, expiry, target revision and rule version on sync.
- Conflicting offline work is quarantined for review; it is not silently overwritten.
- Logging out or losing scope removes accessible offline data according to the domain
  contract.

## 12. Responsibility-specific operating experience

### 12.1 Institution administrator

The administrator configures the digital campus, accounts, roles, devices,
integrations, capability activation and Operating rules. Administrator access does
not automatically create Principal responsibility.

The administrator's Today projection prioritizes blocking setup, account/device
failures, rule activation problems and configuration changes. Routine Principal
decisions appear only when that person also holds an effective Principal
responsibility.

### 12.2 Principal or operations lead

The Principal sees exceptions, decisions and cross-domain impact—not every normal
record. A complete attendance day should collapse into a concise summary. Missing,
conflicted or overdue registers identify the responsible class/teacher and open the
exact review context.

### 12.3 Teacher or instructor

The teacher sees today's schedule and the nearest required action. During a class,
attendance is primary. Leave, cover offers, assigned work and student follow-ups appear
only when owned. Administrative configuration remains out of the daily path.

### 12.4 Office, gate, transport and care operators

Each responsibility contributes a narrow live queue for its current purpose. A gate
responsibility does not grant classroom-attendance controls; the same person sees
those controls only if another assignment grants them. An office responsibility may
record assisted input with source attribution; restricted-care data remains visible
only to explicitly authorized handlers.

### 12.5 Learner and guardian

These experiences are personal and relationship-scoped. They show schedule, requests,
results, obligations and messages relevant to the selected learner. The user should
not need to understand internal teams or administrative workflow stages unless a
response is required.

### 12.6 ThatCampus AI

The assistant is an optional authorized interface to the same domain actions. It may
explain, retrieve, recommend or prepare allowed work and may execute only within its
configured autonomy. It cannot create authority, bypass review, substitute chat for a
typed operational response or become the source of campus truth.

## 13. Representative workflows

### 13.1 Scheduled class attendance

**Plan**

1. A published timetable creates a dated expected session/register.
2. Before the configured window the register is **Scheduled**, not overdue.
3. During the window the teacher's Now card opens the correct class/subject register.

**Action**

4. Staff, QR, paper, office, biometric or reviewed camera evidence enters with source
   and time.
5. Observations remain distinct until the attendance domain accepts them.
6. The teacher reviews unresolved students and submits once.

**Automation**

7. The configured rule either finalizes automatically after its delay or routes a
   review request to the authorized owner.
8. A missing submission becomes attention only after the configured deadline. The
   responsible teacher receives the first reminder; an authorized administrator queue
   receives it only after the separate configured escalation delay.
9. The reminder is one typed Task for one effective owner. A missing or ambiguous
   owner fails closed for configuration review; it never becomes a broadcast alert.
10. Submitting, finalizing or locking the authoritative register closes the still-open
    completion Task. Reading its notification does not close it.

**UI result**

- Teacher sees one primary action: **Take attendance**, **Continue** or **Submit**.
- Principal grouping says `6 of 8 submitted`; the two unresolved child rows explain
  why.
- Scheduled-session and daily-class completion work never appear together for one
  active attendance mode.
- Correcting an accepted register creates revision history rather than rewriting it.

### 13.2 Staff leave and cover

**Request**

1. Teacher selects leave type/date and sees affected scheduled duties.
2. Submitting creates the authoritative leave request and a typed Request for the
   configured decision owner.
3. The Principal sees dates, balance evidence, timetable impact and one primary
   decision. Rejecting requires a reason; approval revalidates current balance and
   authority.

**Coordination**

4. Approval emits a domain event.
5. Active behaviour configuration determines eligible coverage recipients, offer
   ordering, response window and escalation—not service code defaults.
6. Recipients receive typed Offers. Acceptance/decline becomes a response command.
7. The staff/timetable domain checks conflicts and records the authoritative cover.
8. If unresolved, the configured fallback either asks a human to decide or applies a
   permitted administrative fallback. It never claims the substitute or activity was
   physically delivered.

**UI result**

- Teacher sees leave status and later an Update.
- Principal sees only unresolved decisions/exceptions.
- Substitute sees one offer with class, time, room and accept/decline.
- Timetable displays the accepted substitution with provenance.
- The automatic-history row explains the rule/version and correction route.

### 13.3 Gate observation contradicts schedule context

1. A registered gate device records a student's accepted exit observation.
2. The timetable still expects a later class.
3. The core creates a source-backed contradiction signal; it does not mark the learner
   absent.
4. Behaviour configuration routes a Task to Gate or Attendance based on the evidence
   pattern and institution rule.
5. The owner reviews the gate event and attendance context in the owning domain.
6. A correction or accepted decision produces a new event and closes the task.

The UI says **Exit recorded at Main Gate; later Mathematics attendance is not yet
recorded**, never **Student is absent** or **Student left campus** without the required
accepted evidence.

### 13.4 Start with attendance only

1. An administrator activates Attendance without completing unrelated transport,
   finance or examination setup.
2. The prerequisite resolver identifies only the missing class, roster, responsible
   staff and attendance mode.
3. The administrator creates or connects those items in a focused sheet and returns
   to activation at the same step.
4. Existing people/classes are reused; likely duplicates require explicit merge
   review rather than automatic name/phone matching.
5. The new capability contributes its authorized Area after activation without
   changing the four shell destinations.

### 13.5 Event attendance

1. An event session creates an attendance context with participants rather than a
   class roster.
2. The same attendance interaction component is reused with event-specific labels,
   eligibility and statuses.
3. The interface presents one Participants workspace; it does not introduce a
   separate lock/finalize vocabulary unless an Operating rule requires review.
4. A save/submit result and automatic finalization follow the same explanation and
   correction contract as class attendance.

### 13.6 Examination marks and publication

1. The examination operator schedules an assessment and assigns mark-entry owners.
2. Teachers receive Tasks only when the entry window opens.
3. Submission is distinct from moderation and publication.
4. Operating rules may remind or escalate; they cannot publish results without the
   configured authorized decision.
5. Learners/guardians receive an Update only after accepted publication.

### 13.7 Automation configuration missing or invalid

1. An event matches no active valid behaviour configuration.
2. The runtime performs no hidden default automation.
3. If the capability defines a required fallback owner, that owner receives a Task
   explaining that manual handling is required.
4. Administrators see a configuration exception with affected scope and safe repair.
5. Repairing configuration affects new reactions or an explicit authorized replay;
   it does not silently rewrite past outcomes.

### 13.8 Rehearsal and simulation

1. An administrator drafts a new cover rule.
2. Rehearsal runs in a clearly labelled scenario with a virtual clock and
   copied/synthetic recipients.
3. The UI shows which offers, escalations and conflicts would occur.
4. No production message, command, authority or evidence is changed.
5. Activation records the reviewed result, approver and effective date.
6. When the administrator selects the run, the existing application changes from the
   Live blue palette to the Simulation amber palette. The same Today, timetable,
   attendance, Messages, Requests, Campus View, notification, KPI and domain screens
   now follow that run and virtual clock; the Simulation workspace owns virtual time
   and **Return to Live**.
7. During development, unsupported screens disclose a missing adapter and fail
   closed. No screen mixes a simulated date/header with Live domain rows, attention
   counts or badges; all enabled modules must achieve parity before release.
8. **Return to Live** restores the unchanged Live application and its separately
   namespaced caches and subscriptions.

### 13.9 Notice requiring a guardian response

1. Staff publish a notice to an immutable eligible audience.
2. Delivery, opening, acknowledgement and a requested choice remain separate.
3. Guardians receive an Update when reading is sufficient, or a Request when an
   explicit acknowledgement/choice is genuinely required.
4. The staff workspace shows only failed, overdue or required unresolved responses as
   attention; normal delivered/read recipients stay quiet.
5. Correcting the notice creates a new revision and clearly identifies which audience
   received which version.

### 13.10 Departure and transport handover

1. An approved departure plan establishes the expected collector, mode and time.
2. A staff member may receive a duty Offer or Task according to configured routing.
3. Boarding, pickup/drop and handover observations are recorded separately with
   source and time.
4. An unresolved rider blocks trip closure and becomes owned work.
5. Device/vehicle location is never presented as the learner's location.
6. Software may coordinate and surface evidence but cannot authorize or declare the
   physical handover unless the explicit human-only domain step is completed.

### 13.11 Family-reported fee payment

1. A family reports a payment reference or a provider reports success.
2. The family sees **Payment received—school review pending**; the obligation is not
   reduced merely from the claim/callback.
3. Finance receives a Task with the minimum verification evidence.
4. Independent verification and ledger allocation produce the accepted financial
   outcome.
5. A receipt Update is delivered only after authoritative reconciliation.

### 13.12 Offline attendance capture

1. The teacher opens an already authorized register and loses connectivity.
2. Entries remain encrypted and account/institution scoped on the device as **Saved on
   this device**.
3. Reconnection changes the state to **Syncing** and rechecks authority, capture
   window, register revision and configured method.
4. Accepted evidence becomes **Synced**; a stale/conflicting batch becomes **Needs
   review** without overwriting the current register.
5. The UI never says Submitted or Final until the domain accepts the command.

## 14. Backend projection contracts for the UI

The following are conceptual versioned API contracts. Exact code ownership may differ,
but equivalent evidence is required.

### 14.1 One campus state, responsibility-appropriate projections

A user-visible operational state may be rendered only through an authorized
responsibility/domain projection. Authoritative fields come from the owning domain's
committed records; Model Core fields are typed, provenance-bearing context (`expected`,
`observed`, `accepted`, `derived` or `unknown`), never a second writable truth.

Every material mutation retains one correlated chain in the same owning-domain
transaction where applicable:

```text
actor command or observation
 -> current authority and Operating-rule evaluation
 -> domain state, correction lineage and audit
 -> durable outbox event
 -> Model Core evidence/message where applicable
 -> targeted responsibility-projection invalidation and refetch
```

The browser never reads Model Core persistence tables or a generic `/dt/state` and
never writes a domain cache from a simulator/model response. Application composition
APIs combine domain truth with only the minimum authorized model context needed by the
responsibility. If model projection processing is delayed, the UI labels that context
**Delayed** or **Unknown** with its `asOf` time; it does not hide, downgrade or replace
the already accepted domain result. Rehearsal/simulation state remains isolated and
labelled and cannot enter a normal query cache or claim accepted/live campus state.

Live and Simulation use the same product routes, visual components and domain API
contracts. A server-authoritative execution session selects the backing environment
and cannot be overridden by a caller-controlled environment header. Underneath those
shared contracts they use separate store namespaces, cache keys, realtime topics and
revision sequences. A Simulation projection key includes institution, scenario, run,
projection kind and projection revision. All summary and detail data on one rendered
screen must come from the same environment and compatible revision. Expiry,
unsupported capability during development or a missing scenario stream is an explicit
state; none permits fallback to Live state.

Shared data hooks and actions must always resolve through the current environment
binding. In Simulation they emit only scenario events/messages/artifacts and execute
the same domain invariants against copy-on-write scenario state. Simulation context
cannot resolve a production recipient, credential or connector. Switching environment
tears down the prior realtime subscriptions and clears or partitions query caches
before any shared screen is allowed to render.

### 14.2 Conceptual projection contracts

```ts
type OperationalWorkItem = {
  id: string;
  domain: string;
  sourceType: string;
  sourceId: string;
  kind: "request" | "task" | "offer";
  category: string;
  title: string;
  detail: string;
  statusLabel: string;
  urgency: "normal" | "due_soon" | "overdue" | "critical";
  owner: { type: "human" | "team"; id: string; label: string };
  subject?: { kind: string; id: string; label: string };
  occursAt?: string;
  dueAt?: string;
  expiresAt?: string;
  primaryAction: { label: string; href: string };
  explanationAvailable: boolean;
  correlationId: string;
  sourceRevision: number;
};
```

```ts
type OperationalUpdate = {
  id: string;
  category: string;
  title: string;
  detail: string;
  occurredAt: string;
  readAt?: string;
  href?: string;
  correlationId?: string;
};
```

```ts
type AutomationExplanation = {
  trigger: { label: string; occurredAt: string; sourceHref?: string };
  behaviourVersion: { id: string; label: string };
  operatingRuleVersion?: { id: string; label: string; href?: string };
  actor: { label: string; kind: "human" | "team" | "device" | "integration" | "software" };
  result: string;
  unchangedTruths: string[];
  nextOwner?: string;
  evidenceAwaited?: string[];
  correction?: { label: string; href: string };
};
```

```ts
type TodayProjection = {
  generatedAt: string;
  context: {
    institutionId: string;
    campusId?: string;
    responsibilityScopeIds: string[];
    environment: "live" | "simulation";
    timezone: string;
  };
  now: unknown[];
  attention: OperationalWorkItem[];
  next: unknown[];
  automaticResults: AutomationExplanation[];
  freshness: { state: "live" | "delayed" | "offline"; asOf: string };
};
```

These projections never grant authority. Every primary action revalidates the domain
record, revision and current permission.

## 15. Visual and interaction principles

ThatCampus remains Apple-inspired without imitating Apple decoration:

- one strong hierarchy and one primary action;
- generous spacing and readable typography;
- full-width grouped content rather than card grids everywhere;
- restrained borders/shadows and semantic colour;
- direct manipulation where it matches the domain;
- familiar controls and consistent 44px-or-larger touch targets;
- short purposeful motion with reduced-motion support;
- opaque, viewport-bounded sheets with safe-area padding;
- no clipped controls, horizontal page overflow or desktop forms squeezed onto phones;
- skeletons that match final layout and avoid disruptive jumping;
- icons from the established library, paired with text where meaning is not universal.

Accessibility requirements include logical focus order, visible focus, labelled
controls, status announcements, non-colour status cues, adequate contrast, dynamic
text resilience and keyboard alternatives to drag/gesture interaction.

## 16. Security, privacy and failure experience

- Show only minimum information needed by the current purpose and authority.
- Do not expose sensitive evidence in attention cards or push notifications.
- External-channel messages use redacted renderings and reauthenticate before a
  consequential response.
- Expired/revoked users may see that access changed but not the protected record.
- Provider/device failure states identify the affected source and fallback without
  leaking credentials or raw payloads.
- Audit/history is useful and filtered; raw system logs are not an administrator UI.
- Correction preserves prior evidence and records the actor/reason.
- A model/AI provider outage cannot block safe manual domain operation.

## 17. Acceptance scenarios

### Shared shell and navigation

1. Navigation does not reorder when new work arrives.
2. A person with teaching, lab and timed gate responsibilities sees one composed
   experience and no role/portal chooser.
3. Back from a deep-linked work item returns to Today, Work or the owning Area.
4. Returning from a sheet preserves filters, date, expansion and scroll.
5. A phone viewport has no horizontal overflow or covered primary action.
6. Administrator membership alone exposes no Principal, teaching or gate action.
7. Revoking one responsibility removes only its current actions and retains history.
8. Live and Simulation render the same shell and routes from isolated state.

### Attention and notifications

9. An unread Update increases notification count but not unresolved-work count.
10. A new owned Request creates attention at the destination and exact row.
11. Resolving the final child removes the parent indicator.
12. Future planned work does not create an overdue/red indicator.
13. Historical data does not produce a badge.
14. Revoked authority removes the action and stale attention safely.
15. Red is not used for routine pending work.

### Domain state

16. A parent aggregate cannot say complete while an actionable child remains.
17. A future attendance register says Scheduled.
18. A sent command remains pending until the domain outcome is accepted.
19. A sensor observation displays source/time and does not imply broader presence.
20. A correction preserves and explains revision history.
21. Loading, empty, missing-setup, unauthorized, offline, conflict and failure states
    each provide a safe next step.

### Automation

22. Every automatic write names behaviour/rule versions and a correction route.
23. Disabling/removing behaviour configuration causes fail-closed/manual fallback.
24. No agent can activate its own proposed configuration.
25. Rule rehearsal produces no live messages or writes.
26. Authority revocation is rechecked even for an in-flight reaction.
27. Duplicate delivery produces one material effect.
28. Retry, expiry and escalation are visible in the owning work history.
29. A command outcome is not presented as physical execution without observation.

### Representative workflows

30. Teacher leave approval creates coverage work and accepted substitution without
    duplicate timetable editing.
31. An unresolved coverage offer escalates according to the active rule.
32. Attendance becomes attention only after the configured deadline.
33. Event attendance reuses the shared interaction without class-specific copy.
34. A gate/timetable contradiction creates review work without marking absence.
35. Activating one capability asks only for its actual missing prerequisites.

## 18. Delivery slices

Each slice must cross core, domain, evidence and user experience far enough to reduce
real work. Do not build an infrastructure spear or redesign unrelated screens.

### OE-0 — Normative contract and regression guards

- accept and link this operating-experience blueprint;
- add architecture/contract tests preventing UI dependence on model persistence;
- identify existing projections that map to Request, Task, Offer and Update;
- retain the current visual theme while replacing persona navigation with the accepted
  stable shell; do not run parallel old/new navigation behind a feature toggle.

### OE-1 — Staff leave as the first configured agent workflow

- add behaviour-version, subscription, reaction and typed-message persistence/ports;
- configure leave-submission routing to the current decision owner;
- bridge the existing authoritative leave request/outbox transaction into the core;
- surface the current Request through the existing Requests/Staff domain UI;
- retain correlation, rule/config version, delivery, response command and outcome;
- fail closed/manual when no active configuration exists;
- do not duplicate leave, coverage or timetable state.

### OE-2 — Coverage offers and timetable outcome

- route approved leave into configured coverage Offers;
- use current conflict checks and coverage task records;
- record accept/decline, expiry and escalation as agent reactions/messages;
- connect accepted substitution/fallback to effective timetable context;
- show automatic explanation and correction.

### OE-3 — Shared work and badge semantics

- normalize existing Request inbox projections to the shared work contract;
- keep informational updates in Notifications;
- derive navigation attention from real unresolved items;
- remove remaining historical/dummy/decorative indicators;
- add exact-destination and stale-authority tests.

### OE-4 — Responsibility-composed application

- implement the stable Today / Work / Areas / More shell and neutral routes;
- compose Now, Needs attention, Next and Areas from effective responsibilities and
  existing domain APIs;
- prove Kavita's concurrent teaching, lab and timed gate responsibilities from one
  account;
- retain independent authority checks and calm realtime reconciliation;
- remove persona navigation and duplicate route/editor paths after parity; do not
  preserve them as a user-facing option.

### OE-5 — Operating-rule explanation and rehearsal

- present readable active behaviour/rule summaries;
- add trigger/scope/action/wait/fallback/review flow;
- expose source-backed Why this happened;
- add isolated rehearsal with no production side effects.

### OE-6 — Domain workspace convergence

- standardize shared state/action/sheet patterns;
- repair contradictory aggregate/child status domain by domain;
- unify responsive date/time controls and back/draft behavior;
- preserve domain-specific interaction such as timetable canvas and roster marking.

## 19. Explicit non-goals

- exposing a digital-twin or agent graph to ordinary users;
- one universal dashboard that ignores responsibility and scope;
- one identical set of records or actions for every person;
- a job-title portal, role picker or persona-prefixed route tree;
- parallel legacy and responsibility-composed experiences behind a feature switch;
- storing workflow truth in notification badges or AI chat;
- making every event visible as activity noise;
- raw low-code automation or arbitrary executable administrator scripts;
- agents that learn, mutate goals or self-activate behaviour in production;
- continuous person tracking or speculative intention/location;
- duplicate Today/domain editors;
- confirmation dialogs for harmless reversible actions;
- automatic consent, safeguarding conclusions, financial reconciliation or physical
  handover without the owning domain's explicit authority contract.

## 20. Working product test

The operating experience succeeds when a real campus user can say:

> “ThatCampus shows what I am doing now and only the work that really needs me. Routine
> coordination happens under rules our administrator can inspect. When something
> changes I can see why, who owns the next step and how to correct it. Attendance,
> timetable, requests and devices feel connected, but every screen still speaks the
> language of the campus.”
