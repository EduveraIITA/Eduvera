# THATCAMPUS — Product & Experience Design Specification

> Authority: [Product blueprint v2](docs/blueprint/PRODUCT_BLUEPRINT_V2.md) and its
> [current normative contracts](docs/blueprint/README.md) take precedence. This
> broader proposal contains historical and future design choices; it is not a
> statement that every described stack, screen or workflow is implemented. Read
> the current owning code and implementation evidence before extending it.

**Document:** 01_DESIGN.md  
**Target:** Web + Android + iOS  
**Status:** Production design proposal based on the uploaded `eduvera.jsx` prototype  
**Product model:** Multi-role school operating system

---

## 1. Design intent

THATCAMPUS should feel like **one coherent school operating system**, not a collection of ERP screens.

Blueprint v2 clarifies the underlying product as a campus digital twin. That is a
backend architecture, not a new interface metaphor. Users continue to see
domain-specific language and established workflows; never expose graph, edge,
twin-entity, command-envelope or projection terminology in ordinary product UI.

The uploaded prototype already establishes several strong ideas worth preserving:

- A public-facing school website and a logged-in application use the same design language but different presentation density.
- Staff/admin, parent and student users receive different navigation and data scopes.
- Desktop uses a persistent side navigation.
- Mobile switches to bottom navigation.
- An AI assistant is available from every role.
- The AI is explicitly scoped to the records the current user can access.
- Risky AI actions require confirmation.
- Fees, attendance, admissions, timetable and conversations are designed as connected workflows rather than isolated pages.
- Light and dark themes share common semantic design tokens.

The production product should preserve those ideas while making the mobile experience genuinely native and permission-driven.

---

## 2. Core UX principles

### 2.1 Role first, module second

The first question the product answers is:

> “Who is signed in, what are they responsible for, and what are they allowed to see or do?”

Navigation, dashboard cards, search results, notifications, AI context and actions must all derive from the same permission manifest.

A Principal should not see the same mobile navigation as an Accounts Clerk.  
A Teacher should not see the same navigation as Admissions staff.  
A Parent must only see linked children.  
A Student must only see their own records unless explicitly granted another scope.

---

### 2.2 Mobile is not compressed desktop

Do **not** port the desktop layout into a mobile WebView.

Desktop is optimized for:

- data tables,
- multi-column dashboards,
- bulk actions,
- administration,
- reporting,
- schedule construction,
- admissions pipeline management.

Mobile is optimized for:

- glanceable status,
- alerts,
- approvals,
- attendance,
- messaging,
- payments,
- assignments,
- timetable,
- AI assistance,
- quick search,
- urgent actions.

The same domain model is shared; the screen composition is not.

---

### 2.3 One source of truth

Every important number must lead back to the underlying records.

Examples:

- “4.62M collected” → filtered fee ledger, in the tenant's currency.
- “94.8% attendance” → daily attendance register.
- “12 overdue invoices” → invoice list.
- “3 chronic absentees” → student attendance histories.
- AI answer → source records used to generate the answer.

The UI should avoid “dashboard-only” metrics that cannot be inspected.

The frontend reaches truth through domain APIs. It must not call the Campus Model
Core or query its persistence directly. Cross-domain context is composed by a
domain service and presented in the vocabulary of the current task.

---

### 2.4 Explainability over cleverness

School software contains money, children’s records, academic results and administrative decisions.

For any important state, the user should be able to answer:

- What happened?
- Why?
- Who changed it?
- When?
- What is the current status?
- What can I do next?

This is particularly important for:

- fee changes,
- concessions,
- attendance corrections,
- leave approval,
- timetable substitutions,
- admission decisions,
- report-card changes,
- AI-generated actions.

---

### 2.5 Progressive disclosure

Show the minimum necessary information first, with details available on demand.

Example fee card:

1. Amount due
2. Due date
3. Pay / request installment
4. “Why this amount?”
5. Full invoice breakdown
6. Ledger / receipt / audit history

This prevents ERP-style visual overload.

---

## 3. Product surfaces

THATCAMPUS should have four primary surfaces.

| Surface | Primary audience | Main device |
|---|---|---|
| Public website | Prospective/current families | Web + mobile web |
| Operations app | Principal, admin, accounts, admissions, teachers | Desktop web + mobile |
| Parent app | Parents/guardians | Android + iOS + web |
| Student app | Students | Android + iOS + web |

A fifth internal surface can later be added:

| Surface | Audience |
|---|---|
| ThatCampus Control Plane | THATCAMPUS SaaS operations / school tenant management |

---

## 4. Information architecture

### 4.1 Staff/admin capability library

The uploaded prototype already contains:

- Overview
- Admissions
- Students
- Fees
- Attendance
- Timetable
- Conversations
- Academics
- Staff
- Reports
- AI assistant
- Settings

Production should treat these as **capabilities**, not hard-coded “staff routes.”

Additional capabilities likely required:

- Announcements
- Documents
- Notifications
- Approvals
- Transport
- Integrations
- Audit
- User & role administration
- Academic year setup
- Campus setup

Each capability can be enabled/disabled per school and granted per user.

---

### 4.2 Parent capability library

Core:

- Home
- Child profile
- Fees
- Attendance
- Timetable
- Messages
- Academics
- AI assistant

Production additions:

- Assignments
- Results/report cards
- Leave requests
- Documents
- Notices/events
- Payment receipts
- Installment requests
- Consent/forms
- Transport status (optional)
- Parent-teacher meeting booking

---

### 4.3 Student capability library

Core:

- Home
- Schedule
- Attendance
- Assignments
- Academics/results
- Messages
- AI assistant

Production additions:

- Notices/events
- Learning resources
- Submission history
- Exam calendar
- Documents
- Clubs/activities
- Transport status where appropriate

---

## 5. Permission-aware navigation

### 5.1 Navigation must come from the backend

The client should receive a manifest similar to:

```json
{
  "user": "u_123",
  "roleLabels": ["Principal"],
  "scope": {
    "schoolId": "school_1",
    "campusIds": ["campus_1"]
  },
  "capabilities": [
    {"id": "overview", "read": true},
    {"id": "students", "read": true, "write": true},
    {"id": "fees", "read": true, "write": true, "approve": true},
    {"id": "attendance", "read": true, "write": true},
    {"id": "timetable", "read": true, "write": true},
    {"id": "ai", "read": true}
  ]
}
```

The UI renders only authorized destinations.

This is the production version of the idea already present in the prototype’s role-specific navigation.

---

## 6. Mobile navigation

### 6.1 Maximum five persistent destinations

The current prototype can render four role routes plus AI plus More. For a production mobile app, keep the persistent bottom navigation to **five items maximum**.

Recommended pattern:

#### Principal

- Home
- Students
- Attendance
- Fees
- More

AI appears as a persistent floating/pill action above the navigation or as a top-bar action.

#### Accounts

- Home
- Fees
- Students
- Messages
- More

#### Teacher

- Home
- Classes
- Attendance
- Messages
- More

#### Admissions

- Home
- Pipeline
- Applicants
- Messages
- More

#### Parent

- Home
- Attendance
- Fees
- Messages
- More

#### Student

- Home
- Schedule
- Assignments
- Academics
- More

The exact set is generated from permissions and usage priorities.

---

### 6.2 “More” screen

The More screen is not an overflow junk drawer.

It contains:

1. All authorized tools
2. Pinned tools
3. Recent tools
4. Search
5. Settings/profile
6. Help/support

Users with many permissions can pin up to three capabilities to the primary navigation.

---

## 7. Desktop navigation

Use the prototype’s general model:

- fixed left sidebar,
- global search / command palette,
- page title and breadcrumbs,
- notification center,
- AI entry,
- contextual page actions,
- main working surface.

Recommended sidebar groups:

### Operations

- Overview
- Students
- Attendance
- Timetable

### Finance & Growth

- Admissions
- Fees

### Engagement

- Conversations
- Announcements

### Academic

- Academics
- Staff

### Intelligence

- Reports
- AI assistant

### Administration

- Settings

Group visibility is permission-driven.

---

## 8. Role-specific home screens

### 8.1 Principal home

The Principal does not need a generic dashboard. The screen should answer:

**What needs my attention today?**

Top area:

- Attendance today
- Fee collection status
- Admissions movement
- Missing registers / operational exceptions

Then:

- Needs attention
- Approvals
- Important conversations
- Today’s school events
- AI daily brief

Quick actions:

- Make announcement
- View absentees
- Review overdue fees
- Check timetable conflicts
- Ask AI

---

### 8.2 Teacher home

- Today’s classes
- Attendance still to mark
- Assignments to review
- Messages
- Substitution notices
- Class alerts
- AI teaching/admin assistant

---

### 8.3 Accounts home

- Collections today
- Due this week
- Overdue
- Failed/reversed payments
- Reconciliation exceptions
- Installment requests
- Concessions awaiting approval

---

### 8.4 Admissions home

- New enquiries
- Follow-ups due
- Assessments today
- Offers awaiting response
- Documents pending
- Conversion funnel
- Lead-source performance

---

### 8.5 Parent home

The parent home should be child-centric.

Header:

- school
- child switcher
- notification icon

Hero:

- “Aarav today”
- attendance state
- next class/event
- any urgent action

Cards:

- fees
- assignments
- attendance
- messages
- upcoming tests
- notices

If a family has multiple children, switching child updates all child-scoped modules.

Family-level items such as payments or announcements can remain shared.

---

### 8.6 Student home

- next class
- timetable remainder
- work due soon
- attendance
- latest results
- announcements
- AI study assistant

Avoid putting parent-only controls such as fee payment in the student experience. A student may view a fee status if the school enables it, but should not modify billing by default.

---

## 9. Search and command system

The prototype contains a command palette. This should become a first-class feature.

Global search can return:

- students
- parents
- staff
- applicants
- invoices
- receipts
- conversations
- classes
- timetable entries
- assignments
- reports
- app destinations
- actions

Search results must be permission-filtered on the server, not only hidden in the UI.

Desktop shortcut:

- `Cmd/Ctrl + K`

Mobile:

- search field on Home / More
- optional swipe-down search

---

## 10. AI assistant design

The prototype’s AI interaction model is one of the strongest parts of the concept and should be preserved.

### 10.1 AI principles

The AI must:

- know the signed-in user,
- inherit the user’s permissions,
- know current school/campus/academic year,
- cite the records used,
- distinguish facts from generated text,
- never silently change data,
- preview write actions,
- require confirmation for consequential actions,
- record approved actions in the audit log.

---

### 10.2 AI interaction modes

#### Ask

Read-only questions.

Examples:

- Which Grade 8 students have low attendance?
- Why did this invoice change?
- What is due this week?
- Summarize this parent conversation.

#### Draft

Creates content but does not send.

Examples:

- Draft fee reminder.
- Draft parent announcement.
- Draft admissions follow-up.

#### Analyze

Cross-module reasoning.

Examples:

- Students below 75% attendance with unpaid fees.
- Timetable conflicts tomorrow.
- Admission offers untouched for five days.

#### Act

Proposes a structured system action.

Examples:

- approve leave,
- move timetable room,
- queue fee reminders,
- flag student for counselor,
- post announcement.

Act always shows:

- action,
- affected records,
- effect,
- permission used,
- confirmation.

---

## 11. AI transparency and contestability

Users must be able to tell that they are dealing with an AI system, and to challenge what it produces.

- AI responses and AI-generated drafts are visibly marked as such, wherever they appear, including inside messages a staff member sends onward.
- Every AI answer shows the records it used. An answer without citations is a defect.
- Any AI-assisted outcome that affects a person — an admissions recommendation, an assessment aid, a flagged concern — is presented as a recommendation attributed to the system, and the resulting decision is attributed to the human who made it.
- The interface always offers a route to human review, and to contest an outcome. This is a first-class product surface, not a support email address.
- Confidence and limitations are stated plainly. Do not present a generated figure with the same visual authority as a queried one.

Where a feature cannot be offered compliantly in a market, it is switched off cleanly — not degraded into something that looks the same but silently does less.

---

## 12. Conversation design

The existing three-pane desktop pattern is appropriate for large screens:

1. Thread list
2. Conversation
3. Context/details

Mobile becomes:

1. Conversation list
2. Thread screen
3. Context via sheet

Thread context can include:

- linked child/applicant,
- fee state,
- attendance state,
- open requests,
- labels,
- priority,
- internal notes.

This turns messaging into operational context rather than a separate chat app.

---

## 13. Fees UX

### Payer

The payer may be a guardian, a sponsor or an adult learner.

Primary card:

- amount due, with an explicit currency
- due date, in the payer's timezone
- status
- Pay
- Request instalments

Then:

- transparent fee breakdown
- concessions and scholarships
- add-ons
- invoice history
- receipts and credit notes
- payment history
- support conversation

Never hide:

- payment or convenience fees,
- taxes where applicable, and whether prices shown include them,
- late fees,
- refund and credit note state,
- payment processor state.

Global payment states the UI must express:

```text
initiated        payer has started, not yet confirmed
pending          asynchronous method still settling - can take days
authenticating   awaiting 3-D Secure, bank redirect or mandate confirmation
paid             confirmed and allocated
reversed         a settled payment later returned - possible weeks afterwards
```

"Pending" and "paid" must never look the same. A payer who has completed a bank transfer needs to see that the institution has not yet received it, and why that is normal.

---

### Staff/accounts

Views:

- collection dashboard
- invoice ledger
- ageing
- failed payments
- reconciliation
- concessions
- refunds
- installment plans
- reminder campaigns

Bulk actions belong on desktop.

Approval actions should be easily available on mobile.

---

## 14. Attendance UX

### Teacher

Fast attendance screen:

- class and date
- student list
- default Present
- tap Absent / Late / Leave
- bulk mark
- unsaved warning
- offline support
- submit register

### Parent

- calendar
- term percentage
- absence reasons
- leave request
- supporting document upload
- alerts when below threshold

### Student

- personal calendar
- term percentage
- attendance policy
- no editing

---

## 15. Timetable UX

Desktop:

- week grid
- drag/drop
- room/teacher conflict detection
- substitution management
- utilization
- printable/exportable view

Mobile:

- “Today”
- next class
- substitution alert
- room change
- personal/class timetable

Do not attempt full timetable construction on a small phone unless necessary.

---

## 16. Admissions UX

Desktop primary view:

- pipeline / Kanban
- applicant table
- application detail drawer
- document checklist
- assessment
- interview
- offer
- fee token
- enrollment

Mobile primary view:

- new enquiries
- follow-ups due
- applicant details
- call/message
- stage change
- notes
- document status

---

## 17. Visual language

Preserve the prototype’s institutional/operational split.

### Public website

- editorial typography for headlines,
- generous whitespace,
- school photography,
- warmer institutional tone,
- limited density.

### Application

- highly legible sans-serif,
- compact operational layout,
- neutral surfaces,
- restrained brand color,
- semantic status colors,
- minimal decoration.

---

## 18. Design tokens

Create a platform-neutral token package.

Token families:

```text
color
  surface
  text
  border
  brand
  success
  warning
  danger
  info

space
  2 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48

radius
  small / medium / large / pill

type
  display
  heading
  body
  label
  caption
  numeric

elevation
  0 / 1 / 2 / 3

motion
  fast / normal / slow
```

Tokens should compile into:

- CSS variables for web,
- TypeScript constants for React Native.

---

## 19. Component system

Shared conceptual components:

- Button
- IconButton
- TextField
- Select
- DateField
- SearchField
- Tabs
- Segmented control
- Chip / StatusChip
- Avatar
- Card
- StatCard
- ListItem
- DataTable
- EmptyState
- ErrorState
- Skeleton
- Drawer / Sheet
- Dialog
- Toast
- Progress
- Calendar
- Timeline
- Notification item
- Message bubble
- AI citation
- AI action confirmation

The web and mobile implementations may differ internally while sharing names, tokens and behavior rules.

---

## 20. Responsive strategy

### Web breakpoints

#### Wide desktop

`>= 1280px`

- persistent sidebar
- 3–4 column analytics
- full tables
- three-pane messaging

#### Desktop/tablet landscape

`900–1279px`

- persistent or collapsible sidebar
- 2-column cards
- reduced table columns

#### Tablet/mobile

`< 900px`

- no sidebar
- bottom navigation
- cards become single-column
- drawers become full-screen sheets
- tables become card lists or horizontal scroll only where unavoidable

---

## 21. Mobile interaction standards

- Minimum comfortable touch target: 44–48 dp.
- Primary actions positioned within thumb reach.
- Destructive actions separated from primary actions.
- Swipe actions only as shortcuts, never the sole method.
- System share sheet for receipts/reports.
- Native date/time pickers.
- Haptics for confirmations where appropriate.
- Biometric re-authentication for sensitive actions can be added.
- Pull-to-refresh only where users expect live data.
- Offline state always visible.

---

## 22. Status language

Use plain status labels.

Good:

- Paid
- Due
- Overdue
- Submitted
- Approved
- Pending
- Present
- Absent
- Late

Avoid ambiguous ERP labels such as:

- Processed
- Closed
- Complete

unless the user can inspect exactly what they mean.

---

## 23. Empty, loading and failure states

Every operational screen must define:

- loading,
- initial empty,
- filtered empty,
- permission denied,
- offline,
- retryable error,
- validation error,
- partial failure.

Examples:

> “No overdue invoices” is a success state.

> “Invoices could not be loaded” is an error state.

These must look different.

---

## 24. Notification UX

Notification channels:

- in-app inbox,
- push,
- email,
- SMS/WhatsApp where configured.

A notification should deep-link to the exact object/action.

Example:

**Term 2 invoice overdue — Diya Nair**  
Tap → invoice detail, not generic Fees page.

Users should be able to configure channel preferences where policy allows.

---

## 25. Accessibility

Production target:

- WCAG 2.2 AA for web,
- accessible labels and roles,
- keyboard navigation,
- screen-reader support,
- visible focus states,
- scalable text,
- sufficient contrast,
- status never communicated using color alone,
- reduced-motion support.

The prototype already includes focus and reduced-motion concepts; production should formalize them.

Accessibility is a legal obligation in the product's principal markets, and public-sector and state-funded institutions procure against it. Treat conformance as a launch requirement:

- WCAG 2.2 AA on web **and** native mobile — mobile is the primary surface for guardians and is the one usually missed.
- Generated documents — invoices, receipts, report cards, transcripts — must be accessible too.
- An accessibility conformance report is a sales prerequisite in several markets.
- Accessibility checks run in CI, and keyboard plus screen-reader passes are part of the release checklist.

---

## 26. Internationalization and localization

The product ships to any country. Localization is a first-class design constraint, not a later translation pass.

### Language

- Every user-visible string comes from a resource catalogue. No literal text in components.
- Translated text expands and contracts substantially — plan layouts for roughly 1.5x the English length, and never size a control to its English label.
- Never assemble a sentence from concatenated fragments. Pluralization, grammatical gender, word order and agreement differ per language; pass parameters into a whole translated string instead.
- Right-to-left languages mirror the entire interface — navigation side, icon direction, progress and chart direction — not just text alignment.
- Scripts vary in height and required line spacing. Fix line-height in relative units and verify with Devanagari, Arabic, Thai and CJK.

### Formatting

Locale-aware formatters for dates, times, numbers, currency and lists. Never hand-format.

```text
dates        order and separators vary; never render a bare numeric date
              that could read as either day-month or month-day
times        12h and 24h by locale
numbers      decimal and grouping separators vary, including by digit grouping
currency     symbol, position and spacing come from locale + currency
names        given/family order and honorifics vary; store parts separately
              and support a display-name override
addresses    field order and postal formats vary; do not impose one shape
calendars    Gregorian for operations, with local calendar display where expected
```

### Currency in the interface

- Always show an explicit currency indicator. A bare number is ambiguous to an international audience and unusable in a multi-currency institution.
- Do not abbreviate amounts using conventions local to one market. Use the locale's own grouping and abbreviation.
- Where a view can contain more than one currency, never present an unlabelled total.

### Vocabulary

Terminology is resolved from the tenant's institution type as well as its locale.

```text
class group    class / grade / year group / batch / cohort
guardian       parent / guardian / sponsor
staff          teacher / tutor / faculty / educator
period         academic year / semester / term / batch
```

A playschool, a coaching centre and a college must each read as though the product was built for them. That is a content and configuration problem, not a separate design.

---

## 27. What to retain from the prototype

Keep:

- brand-neutral operational aesthetic,
- role-specific experiences,
- public/app visual distinction,
- desktop sidebar,
- permission-aware concept,
- child switcher,
- cards + drawers,
- command search,
- AI citations,
- AI confirmation step,
- fee transparency,
- attention-oriented dashboard,
- light/dark tokens.

---

## 28. What to change before production

Change:

1. Hard-coded role navigation → backend permission manifest.
2. Six-item mobile bottom bar → maximum five persistent items.
3. Desktop layouts compressed onto mobile → native mobile compositions.
4. Static seed data → API-driven states.
5. Demo role switcher → secure authentication.
6. Hard-coded AI replies → policy-constrained AI tools.
7. UI-only confirmation → transactional backend action + audit record.
8. CSS-only design system → cross-platform token/component packages.
9. Local-only messages → realtime, durable messaging.
10. Demo payments → real payment/reconciliation service.
11. Static reports → server-generated report jobs.
12. Static notices → publishable announcement model.

---

## 29. Recommended design deliverables before engineering scale-up

Create in Figma:

1. Design foundations
2. Shared component library
3. Staff desktop shell
4. Staff mobile shell
5. Parent mobile shell
6. Student mobile shell
7. Public website
8. Critical flows
9. Empty/error/loading/offline states
10. AI assistant patterns
11. Permission-driven navigation examples
12. Responsive specifications

Critical flows to prototype:

- Principal morning review
- Teacher attendance
- Parent fee payment
- Parent leave request
- Admissions follow-up
- Timetable conflict resolution
- Student assignment submission
- AI read → proposed action → confirmation → audit

---

## 30. Design north star

The product should feel like:

> **“The operating system of the school, personalized to the responsibility of the person holding the phone.”**

The school owns one data model.  
Every user sees a different, permission-scoped view of that same reality.
