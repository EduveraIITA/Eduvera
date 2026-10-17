# THATCAMPUS — Product Functionality Specification

> Authority: [Product blueprint v2](docs/blueprint/PRODUCT_BLUEPRINT_V2.md) and its
> [current normative contracts](docs/blueprint/README.md) take precedence. This
> broader proposal contains historical and future design choices; it is not a
> statement that every described stack, screen or workflow is implemented. Read
> the current owning code and implementation evidence before extending it.

**Document:** 03_PRODUCT_FUNCTIONALITY.md  
**Scope:** Web + Android + iOS school operating system  
**Basis:** Functional concepts present in the uploaded THATCAMPUS JSX prototype, expanded into a production product specification.

---

## 1. Product definition

THATCAMPUS is a unified operating platform for an education provider, in any country.

Blueprint v2 defines the platform as a living digital twin of the campus rather
than a conventional ERP. An institution can activate one bounded capability first
and expand without re-creating people, classes, places or resources. The backend
connects those identities and workflows; each frontend remains entirely in the
language and interaction model of its domain.

Target institutions:

- schools — primary, secondary, K-12,
- playschools — nursery, preschool, early years, daycare,
- coaching and tutoring centres — test preparation, skills and vocational training,
- colleges and higher education institutions.

It connects:

- institution leadership,
- administration,
- admissions,
- accounts and finance,
- teachers, tutors and faculty,
- guardians,
- learners,

through one authoritative institution data model.

These institution types share the same domain model and differ by capability profile, vocabulary and fee shape rather than by codebase. What a user sees is resolved from the tenant's institution type, jurisdiction, currency, calendar and locale.

The platform should replace fragmented workflows spread across:

- spreadsheets,
- paper registers,
- payment portals,
- WhatsApp groups,
- isolated school ERP screens,
- email,
- separate learning portals.

The key differentiator is not simply “all modules in one app.”

The product should provide:

> **A permission-aware operating system where each user sees the school through their responsibility, with AI able to reason across the records they are already allowed to access.**

---

## 2. User personas

### School leadership

#### Principal

Needs:

- whole-school status,
- exceptions,
- approvals,
- trends,
- communication,
- reports,
- AI summaries.

#### Vice Principal / Academic Head

Needs:

- attendance,
- academics,
- timetable,
- teacher workload,
- assessments,
- interventions.

---

### Operations

#### School administrator

Needs broad operational access.

#### Admissions officer

Needs:

- enquiries,
- application pipeline,
- documents,
- assessment scheduling,
- follow-ups,
- offers,
- enrollment.

#### Accounts officer

Needs:

- fee plans,
- invoices,
- payments,
- reconciliation,
- concessions,
- refunds,
- receipts,
- reminders.

#### Timetable coordinator

Needs:

- teachers,
- rooms,
- periods,
- conflicts,
- substitutions.

---

### Teaching

#### Teacher

Needs:

- own schedule,
- class rosters,
- attendance,
- assignments,
- marks,
- messages,
- announcements.

#### Class teacher

Also needs:

- class-level parent communication,
- leave review,
- student overview,
- attendance issues.

---

### Family

#### Parent/guardian

Needs:

- all linked children,
- attendance,
- fees,
- leave,
- timetable,
- assignments,
- results,
- messages,
- notices,
- AI explanation.

#### Adult learner

College and coaching learners are frequently adults and are the data subject for their own records.

Needs:

- self-managed account and consent,
- own fee, invoice and payment history,
- control over whether a guardian or sponsor sees academic or financial records, granted separately,
- course, credit and transcript visibility.

Where a learner is over the age of majority in the tenant's jurisdiction, guardian access is off by default and can only be granted by the learner. A sponsor who pays fees may hold financial visibility without academic visibility.

#### Student

Needs:

- schedule,
- attendance,
- assignments,
- submissions,
- results,
- messages,
- notices,
- AI study assistance.

---

### SaaS operator

#### ThatCampus super administrator

Needs:

- tenant provisioning,
- module enablement,
- plans/billing,
- support,
- feature flags,
- system health.

Must not casually access school content. Support access requires explicit controlled workflows and audit.

---

## 3. Functional module map

| Module | Staff | Parent | Student |
|---|---:|---:|---:|
| Home/Dashboard | Yes | Yes | Yes |
| Admissions | Authorized staff | Application/status later | No |
| Students | Authorized staff | Linked children only | Self only |
| Fees | Authorized staff | Linked children | Read-only optional |
| Attendance | Authorized staff/teacher | Linked children | Self |
| Leave | Approve/manage | Request | View |
| Timetable | Manage/read | Child | Self |
| Conversations | Yes | Yes | Yes |
| Announcements | Publish/read | Read | Read |
| Academics | Manage | Child | Self |
| Assignments | Manage | Child | Self |
| Results | Manage | Child | Self |
| Staff | Authorized staff | No | No |
| Reports | Leadership/admin | Limited docs | Limited docs |
| AI | Permission-scoped | Linked children | Self |
| Settings | Authorized admins | Preferences | Preferences |

---

## 4. Authentication and onboarding

### 4.1 School staff

Possible flow:

1. School creates staff account or syncs directory.
2. Staff receives invite.
3. Verify email/phone.
4. Set authentication method.
5. MFA if required.
6. Select school/campus if user belongs to multiple.
7. Backend resolves roles/scopes.
8. App builds navigation.

---

### 4.2 Parent

Flow:

1. School creates or invites guardian.
2. Parent verifies phone/email.
3. System links guardian to student records.
4. Parent confirms linked children.
5. Consent/notices shown where required.
6. Parent lands on family home.

A parent must never gain access to a child only because names/phone numbers happen to match.

---

### 4.3 Student

Flow depends on school policy:

- school-issued account,
- student ID + activation,
- managed SSO,
- guardian-assisted activation for younger students.

Student permissions remain self-scoped.

---

## 5. Capability and role administration

Administrators can create roles such as:

- Principal
- Admissions
- Accounts
- Teacher
- Class Teacher
- Academic Coordinator
- Timetable Coordinator
- Counselor
- Transport Manager

Permissions are granular.

Example:

```text
fees.read
fees.invoice.create
fees.concession.request
fees.concession.approve
fees.refund
fees.export
```

Scope can be:

- entire school,
- one campus,
- grades,
- sections,
- assigned classes,
- linked children,
- self.

---

## 6. Home / dashboard

### Staff

Widgets are permission-aware.

Possible widgets:

- students on roll
- attendance today
- fee collection
- open applications
- upcoming events
- missing attendance registers
- overdue invoices
- timetable conflicts
- unread priority conversations
- approvals
- scheduled reports

The prototype’s “Needs attention” concept should become central.

---

### Parent

Home combines family status.

Child-scoped cards:

- attendance
- timetable
- assignments
- academic results

Family/action cards:

- fees
- messages
- notices
- upcoming events

---

### Student

- next class
- rest of today
- due soon
- attendance
- current academic average
- results
- announcements
- study assistant

---

## 7. Admissions

The prototype includes a pipeline with stages such as:

- New
- Contacted
- Assessment
- Offer
- Enrolled

Production should make stages configurable.

### 7.1 Enquiry

Capture:

- parent/guardian details
- applicant
- grade
- source
- preferred campus
- contact consent
- notes

Sources:

- website
- referral
- walk-in
- campaign
- open house
- import/API

---

### 7.2 Applicant record

Includes:

- personal data
- guardians
- prior school
- applying grade/stream
- source
- owner
- current stage
- notes
- tasks/follow-ups
- documents
- assessment
- interview
- offer
- fee/token state

---

### 7.3 Pipeline

Views:

- Kanban
- table
- funnel
- overdue follow-ups

Actions:

- assign owner
- change stage
- add note
- call/message
- request document
- schedule assessment
- schedule interview
- create offer
- mark withdrawn
- enroll

---

### 7.4 Document checklist

Configurable by grade/campus.

Examples:

- birth certificate
- previous report card
- transfer certificate
- address proof
- photograph
- medical information

Statuses:

- required
- uploaded
- verified
- rejected
- waived

---

### 7.5 Assessment

- assessment slot
- subject/component
- marks
- reviewer
- result
- remarks

---

### 7.6 Offer

- offered grade
- stream
- validity
- token fee
- fee plan
- concessions
- special conditions

Offer communications are generated from templates and recorded.

---

### 7.7 Enrollment conversion

When admitted:

1. validate mandatory documents,
2. create Student,
3. create guardian links,
4. create enrollment,
5. allocate student ID,
6. assign grade/section,
7. apply fee plan,
8. optionally assign transport,
9. create portal accounts,
10. send onboarding communication.

This should be transactional/idempotent.

---

## 8. Student Information System

Student profile:

### Identity

- student ID
- name
- date of birth
- photo
- gender where required
- contact details where appropriate

### Academic placement

- academic year
- campus
- grade
- section
- roll
- house
- stream/electives

### Guardians

- relationship
- contact
- access rights
- primary contact
- billing contact
- emergency contact

### Operational

- transport
- status
- admission date
- documents

### Linked summaries

- attendance
- fees
- academics
- messages
- leave
- incidents/interventions if school uses them

Sensitive modules should have separate permissions.

---

## 9. Fees and billing

The uploaded prototype already emphasizes transparent fee structure, invoice breakdown, overdue status, payment history and reminders.

Production functionality:

### 9.1 Fee plans

Every fee plan is denominated in an explicit currency and carries a tax treatment per component. Neither is ever implied by the deployment.

By:

- enrolment period — academic year, semester, term or batch
- class group — grade, year group, batch, programme or course
- campus
- stream or specialization
- learner category

Components, by institution type:

```text
school / playschool   admission, tuition, technology/lab, activity,
                      examination, transport, meals, uniform, optional services
coaching centre       course or batch fee, material fee, mock test series,
                      registration, instalment surcharge
college               tuition, per-credit charges, laboratory, library,
                      hostel/accommodation, examination, convocation
```

Frequency:

- one-time
- annual
- semester or term
- monthly
- per-credit or per-course
- custom schedule

Each component carries:

- currency,
- tax treatment (exempt, zero-rated, reduced, standard) resolved from the tenant tax profile,
- whether the displayed price is tax-inclusive or tax-exclusive,
- refundability, which differs by component and by jurisdiction.

Tuition is exempt or zero-rated for tax in many jurisdictions while transport, meals, uniforms and commercial short courses are not. Tax treatment must therefore be set per component, never per invoice.

---

### 9.2 Student fee assignment

Supports:

- base fee plan
- concessions
- scholarships
- sibling discount
- transport
- optional services
- manual adjustment with approval

Every change should retain history.

---

### 9.3 Invoice

Fields:

- invoice number, allocated from a tenant invoice series at issue
- document type — invoice, credit note, proforma
- learner
- bill-to party — guardian, sponsor, employer or the adult learner
- issuer identity — legal entity, address, tax registration number
- issue date
- supply/service date, where the jurisdiction requires it
- due date
- currency
- line items, each with quantity, unit price, tax treatment, tax rate and tax amount
- discount/concession
- tax summary by rate
- total, tax total and grand total
- rounding applied
- amount paid
- balance
- status
- locale used for rendering

Statuses:

- Draft — editable, no allocated number
- Issued — immutable and numbered
- Partly paid
- Paid
- Due
- Overdue
- Cancelled — retained with its number, never deleted
- Credited / Partly credited

### 9.3.1 Issued invoices are immutable

An issued invoice is never edited, re-priced or deleted. Corrections are made by issuing a linked credit note, and where necessary a replacement invoice.

This is a legal requirement in most jurisdictions and the only basis on which reconciliation, tax reporting and audit can be trusted.

Staff-facing wording must make this explicit: the action is "issue a credit note", not "edit invoice".

### 9.3.2 Numbering

Invoice numbers come from a configured series per tenant, and where required per campus, jurisdiction or document type. Several jurisdictions require the sequence to be gapless. Numbers are allocated at issue, never at draft creation, and are never reused after cancellation.

Credit notes use their own series.

### 9.3.3 Presentation

The invoice document is rendered in the recipient's language and locale, with the tenant's legal entity details, tax registration and any statutory wording required by the jurisdiction. Currency is always displayed with an explicit currency indicator — an unlabelled amount is ambiguous to an international audience.

Where a jurisdiction mandates electronic invoicing or fiscal clearance, issue additionally submits the document through that channel and records the authority reference against the invoice.

---

### 9.4 Payer experience

The payer may be a guardian, a sponsor, an employer or the adult learner.

The payer sees:

- exact payable amount, with an explicit currency
- breakdown, including tax where applicable
- due date in their own timezone
- any payment fee, where surcharging is lawful in that market
- the payment methods available in their country
- instalment option if allowed

Flow:

1. select invoice,
2. inspect amount,
3. choose a payment method available for the tenant's country and the payer's,
4. initiate payment,
5. complete authentication where required — 3-D Secure, bank redirect, or mandate confirmation,
6. webhook confirmation,
7. ledger allocation,
8. receipt generated in the payer's language,
9. payer notified.

Rules:

- Step 5 is not optional. Strong Customer Authentication is mandatory in several major markets, and a flow that assumes a single-step charge will fail there outright.
- Asynchronous and delayed-settlement methods — bank transfer, direct debit, cash voucher — can take days to confirm. The invoice must express "payment initiated" as a state distinct from "paid", and the payer must see it.
- A payment can be reversed weeks later on direct debit rails. Receipt issuance must not assume finality; reversal moves the invoice back to an unpaid state and is auditable.
- Payment method availability is resolved from country, never hard-coded into the UI.

---

### 9.5 Installment request

Parent can request.

Workflow:

```text
Requested
 -> Accounts review
 -> Approved / Rejected
 -> Schedule created
 -> Parent notified
```

---

### 9.6 Concession

Workflow can require approval.

Example:

```text
Accounts proposes concession
 -> Principal approves
 -> Student fee plan updated
 -> Future/open invoice recalculated according to policy
 -> Audit entry
```

---

### 9.7 Reminders and dunning

Segments:

- overdue
- due today
- due this week
- partial payment
- instalment due
- failed or reversed payment

Channels:

- in-app
- push
- email
- SMS/WhatsApp, where the channel is available and lawful in the recipient's country

Bulk campaigns require preview and audit.

Rules:

- Send time is evaluated in the recipient's timezone and respects local quiet hours. A tenant-timezone schedule will message international families overnight.
- Reminder content is rendered in the recipient's language, with amounts in the invoice currency and dates in the recipient's locale format.
- Fee reminders are transactional, but escalating collection messaging is regulated in some jurisdictions. Escalation policy is a per-jurisdiction setting.
- Late fees and interest are lawful in some markets and capped or prohibited in others. Late-fee rules belong to the tenant's jurisdiction profile, not to global defaults.
- Every recipient can be suppressed, and suppression is honoured across all channels immediately.

---

### 9.8 Reconciliation

Accounts view:

- gateway transactions
- bank settlement
- internal payment records
- unmatched transactions
- duplicates
- reversals
- failed webhooks

Reconciliation must handle a settlement currency that differs from the invoice currency, and record provider fees and any FX spread as their own entries rather than netting them against the invoice balance.

---

### 9.9 Credit notes, refunds and withdrawals

Corrections never edit an issued invoice.

```text
over-billed / error       -> credit note against the original invoice
learner withdraws         -> credit note for the unconsumed portion,
                             then refund of any surplus paid
duplicate payment         -> refund, no credit note (the invoice was correct)
concession applied late   -> credit note, then revised invoice if still payable
```

Refund workflow:

```text
Requested
 -> Eligibility check against the tenant's refund policy and jurisdiction
 -> Approval by an authorized role
 -> Refund issued to the original payment method where the rail allows
 -> Ledger updated, credit note linked
 -> Payer notified
```

Rules:

- Refund eligibility is a policy resolved from tenant jurisdiction and fee component, not a global rule. Statutory cooling-off and withdrawal rights apply in several markets, particularly to coaching and short courses sold to consumers.
- Refunds return to the original instrument wherever the rail supports it. Where it does not, the alternative payout path and its authorization are recorded.
- Partial refunds must specify which invoice lines they relate to, because tax treatment differs per line.
- Tax already reported to an authority is reversed through the credit note, and through the fiscal channel where the jurisdiction requires it.
- Every refund is audited with requester, approver, reason and amount.

### 9.10 Multi-currency and cross-border

- Each invoice is denominated in one currency, fixed at issue and never re-denominated.
- An institution may bill different learner populations in different currencies — for example local currency for domestic families and a second currency for international ones. Currency is therefore a property of the fee plan and the invoice, not of the tenant alone.
- Amounts are never displayed without a currency indicator.
- Consolidated multi-campus or group reporting across currencies must state the conversion rate and date used, and must never present a mixed-currency total as a single unlabelled figure.
- Where the payer is charged in a currency other than the invoice currency, the invoice currency remains authoritative for the balance. The charge currency, rate and any spread are recorded against the payment.

---

## 10. Attendance

### 10.1 Attendance setup

- attendance policy
- school days
- holidays
- statuses
- late threshold
- exam eligibility threshold

---

### 10.2 Teacher register

Teacher selects:

- class
- date/session

Roster loads.

Actions:

- Present
- Absent
- Late
- Leave
- optional reason/note

Features:

- bulk present
- search
- offline marking
- submit
- reopen/correct based on permission

---

### 10.3 Missing register monitoring

Leadership gets alerts:

- register not started,
- not submitted by cutoff,
- incomplete.

---

### 10.4 Parent attendance

- calendar
- percentage
- absence detail
- leave state
- policy threshold
- alerts

---

### 10.5 Leave request

Parent:

- from/to
- reason
- attachment

School:

- review
- approve/reject
- comment

Approved leave updates attendance according to policy.

---

### 10.6 Attendance correction

Must record:

- original value
- new value
- reason
- actor
- time

---

## 11. Timetable

### Configuration

- working days
- periods
- breaks
- subjects
- rooms
- labs
- teacher availability
- class requirements

### Timetable creation

- manual
- assisted
- future automated solver

### Conflict engine

Detect:

- teacher double-book
- room double-book
- class double-book
- unavailable teacher
- unavailable room
- consecutive-load rules
- required lab/room constraints

The prototype already demonstrates conflict suggestions; production should make this a formal rules engine.

---

### Substitution

Workflow:

1. mark teacher absent/unavailable,
2. find impacted periods,
3. rank possible substitutes,
4. assign,
5. notify substitute/class/parents if necessary,
6. audit change.

---

## 12. Conversations and messaging

Conversation types:

- direct guardian conversation
- direct student conversation where school permits
- staff-to-staff
- class group
- grade group
- administrative thread
- support thread

Thread metadata:

- subject
- participants
- context
- priority
- labels
- linked student/applicant
- unread status
- attachments

---

### 12.1 Internal vs external notes

Staff should be able to create internal notes that parents/students cannot see.

This must be visually unmistakable.

---

### 12.2 Templates

Templates for:

- fee reminders
- admission follow-up
- attendance warning
- event notice
- assignment notice

---

### 12.3 Announcement

Publish to:

- whole school
- campus
- grade
- section
- staff
- selected cohort

Options:

- schedule
- expiry
- attachment
- acknowledgement required
- channel selection

---

## 13. Academics

The prototype includes academics, assignments, results and upcoming assessments.

Production model:

- subjects
- curriculum
- terms
- assessments
- assignments
- submissions
- marks
- grades
- report cards

---

## 14. Assignments

Teacher:

- create assignment
- class/subject
- instructions
- attachments
- due date
- rubric/marks
- publish

Student:

- view
- attach submission
- submit
- replace before deadline if policy permits
- view feedback/grade

Parent:

- see assignment and submission status
- no submission on behalf of student by default unless school enables it

---

## 15. Assessment and results

Assessment definition:

- name
- subject
- class
- maximum marks
- date
- components
- grading rule

Teacher enters/imports marks.

Validation before publish.

Parent/student only see published results.

Support:

- class average
- subject trend
- grade
- comments
- report card

---

## 16. Staff module

Staff record:

- name
- employee ID
- department
- designation
- subjects
- assigned classes
- contact
- attendance/leave if enabled
- permissions/roles

Operational views:

- present today
- on leave
- workload
- substitution availability
- open positions (optional HR integration)

Avoid turning THATCAMPUS into a full HR/payroll system in the first release unless strategically required.

---

## 17. Reports

Core reports:

- attendance by grade/class/student
- chronic absenteeism
- fee collection
- ageing
- reconciliation
- admissions funnel
- source conversion
- academic result analysis
- staff workload
- timetable conflicts/utilization

Functions:

- filters
- saved report
- scheduled report
- PDF
- XLSX
- CSV
- authorized recipients

Reports inherit the requester’s permission scope.

---

## 18. Notifications

Events can generate notification policies.

Examples:

```text
Invoice issued
Payment received
Invoice overdue
Leave approved
Attendance below threshold
New message
Assignment published
Assignment due
Result published
Timetable changed
Substitution assigned
Admission stage changed
Offer expiring
```

Users configure preferences within school policy.

---

## 19. Restricted records and safeguarding

Some information must not be visible to every member of staff, and in several jurisdictions its handling carries statutory duties.

Restricted categories:

- safeguarding and child protection concerns,
- medical conditions, allergies, medication and care plans,
- special educational needs and disability assessments,
- counselling and wellbeing notes,
- behavioural and disciplinary records,
- legal orders affecting contact, custody or collection,
- financial hardship or free-meal eligibility.

Functionality:

- Each category is its own permission scope. Access to a learner record never implies access to a restricted category on it.
- Raising a concern is quick, private and always available to staff — a difficult reporting flow is a safeguarding failure in itself.
- A concern record has a designated lead, a status, a chronology and controlled sharing, with a full history that is never editable in place.
- Every access to a restricted record is logged with reason capture, and the institution's designated lead can review that log.
- Restricted records are excluded from search, exports, bulk reports, analytics and AI context unless the requester holds the specific scope.
- Contact and custody restrictions are expressed on the guardian link itself, so messaging, collection and visibility all honour them.
- Retention and transfer of these records follow the institution's statutory policy, separately from ordinary academic data.

The product records and evidences concerns. It does not assess or adjudicate them.

---

## 20. Consent and data rights

Institutions must be able to discharge their own legal obligations inside the product rather than by asking support.

Consent management:

- consent purposes are defined per tenant and per jurisdiction,
- capture, renewal, withdrawal and the source of each consent are recorded,
- withdrawal takes effect immediately across every channel and feature,
- where the learner is a minor, consent is held by the guardian; where the learner has reached the age of majority, it transfers to the learner, with notice to both.

Data subject requests:

```text
Received
 -> Identity verified
 -> Scope determined across modules
 -> Compiled / corrected / exported / deleted
 -> Reviewed and released
 -> Closed, with the whole chain audited
```

- Statutory response clocks are tracked and visible, because deadlines differ by jurisdiction.
- Deletion is per purpose. Academic records may be erasable while the invoices referencing them must be retained, and the workflow must express that outcome rather than failing.
- Export is available on demand and at contract termination, in a documented format.
- An institution can review its own access logs without contacting ThatCampus.

---

## 21. Documents

Central document capability.

Objects can attach documents to:

- student
- admission
- leave
- invoice/payment
- message
- assignment
- report card

Functions:

- upload
- preview
- download
- verify
- replace/version
- expire
- permission-controlled access

---

## 22. AI assistant

AI is cross-module and permission-scoped.

### Staff read use cases

- Find low-attendance students.
- Explain fee collection changes.
- Summarize admissions pipeline.
- Find timetable conflicts.
- Summarize a conversation.
- Prepare morning brief.
- Compare sections/grades.

### Staff drafting

- fee reminder
- admissions follow-up
- parent announcement
- meeting note
- report summary

### Staff action proposals

- approve leave
- send messages
- flag students
- move timetable slot
- publish announcement

User confirmation is mandatory for write actions.

---

### Parent AI

Can access only linked children and allowed school information.

Examples:

- Why did the payable fee change?
- Summarize attendance.
- What is due next week?
- When is the PTM?
- Explain this report-card trend.
- Draft a message to the teacher.

It cannot access another child.

---

### Student AI

Examples:

- What is my next class?
- What is due?
- Explain a syllabus topic.
- Summarize teacher instructions.
- Make a study plan using upcoming deadlines.

Academic-integrity policy:

- explain and tutor,
- help plan,
- provide examples,
- do not impersonate the student or submit graded work automatically.

---

## 23. AI daily brief

For leadership, an optional generated brief:

```text
Attendance
- 94.8% today
- Grade 9B register missing
- 3 Grade 8 students below threshold

Fees
- 4.62M collected (tenant currency)
- 12 overdue invoices

Admissions
- 2 new applications
- 2 offers need follow-up

Timetable
- 1 room conflict tomorrow

Messages
- 3 priority unread threads
```

Every line links to the underlying records.

---

## 24. Approvals

Create a common approvals inbox.

Possible items:

- concession
- refund
- attendance correction
- leave
- admission exception
- timetable exception
- AI action requiring confirmation

Approval card:

- requester
- type
- affected student/object
- reason
- before/after
- approve/reject
- audit trail

---

## 25. Public website

The prototype includes:

- Home
- About
- Academics
- Admissions
- Fees
- News
- Contact
- Login

Production functionality:

### CMS-driven items

- notices/news
- events
- admission open/closed
- fee documents
- contact information
- homepage announcements

### Admissions lead capture

Website forms create actual admission enquiries in the pipeline.

No duplicate manual entry.

---

## 26. School configuration

Administrators configure:

- school profile
- logo/branding
- campuses
- academic years
- terms
- grades
- sections
- subjects
- periods
- rooms
- houses
- fee heads
- attendance policy
- notification policy
- roles/permissions
- integrations
- modules enabled

Configuration is progressive and capability-driven. Creating an account does not
force the administrator to configure every item above. Each enabled capability
declares the minimum prerequisites it needs, reuses existing campus identities and
asks for missing information in domain language. Readiness is evaluated per
capability, not as one misleading universal setup percentage.

---

## 27. Multi-school / multi-campus

A user may belong to:

- one school,
- multiple campuses,
- multiple schools in a group.

All screens must clearly indicate active context when ambiguity is possible.

Never silently aggregate schools for transactional actions.

---

## 28. Transport — optional expansion

The current prototype contains route information but not a full transport module.

Future module:

- routes
- stops
- vehicles
- drivers/attendants
- student assignments
- route fees
- GPS integration
- pickup/drop alerts

This should be feature-flagged rather than forced into MVP.

---

## 29. Parent-teacher meeting — optional expansion

Functions:

- school publishes available slots,
- parent books,
- reminders,
- teacher agenda,
- meeting notes,
- follow-up tasks.

---

## 30. Help and support

In-app help:

- searchable help
- school contact
- report issue
- payment support
- account recovery

For SaaS deployments:

- tenant administrator support console.

---

## 31. Audit and history

Users with permission can inspect history.

Examples:

### Invoice history

- created
- concession applied
- payment received
- receipt generated

### Attendance

- marked absent
- corrected to leave
- approved by teacher

### Timetable

- room changed
- substitute assigned

### AI

- AI proposed action
- user confirmed
- command executed

---

## 32. Core cross-module workflows

### 30.1 Admission to active student

```text
Enquiry
 -> Application
 -> Documents
 -> Assessment
 -> Offer
 -> Token payment
 -> Enrollment
 -> Student record
 -> Class assignment
 -> Fee plan
 -> Guardian portal
```

---

### 30.2 Attendance intervention

```text
Teacher marks attendance
 -> Attendance stored
 -> Threshold evaluated
 -> Alert created
 -> Parent notified
 -> Parent leave/document flow if applicable
 -> Class teacher/leadership follows up
```

---

### 30.3 Fee collection

```text
Fee plan
 -> Invoice
 -> Parent notification
 -> Payment
 -> Gateway confirmation
 -> Internal reconciliation
 -> Receipt
 -> Dashboard/report update
```

---

### 30.4 Timetable substitution

```text
Teacher unavailable
 -> impacted slots
 -> candidate substitutes
 -> coordinator assigns
 -> timetable updated
 -> notifications
 -> audit
```

---

### 30.5 AI-to-action

```text
Question
 -> AI retrieves authorized records
 -> answer + citations
 -> AI proposes action
 -> user confirms
 -> permission/state revalidated
 -> domain action
 -> audit
 -> result
```

---

## 33. MVP definition

### MVP 1 — Operational foundation

#### Platform

- authentication
- school tenancy
- users/roles/permissions
- audit
- notifications
- documents

#### Staff

- dashboard
- students
- admissions
- fees
- attendance
- timetable read/basic management
- conversations
- notices

#### Parent

- child switcher
- fees
- online payment
- attendance
- leave
- timetable
- messages
- notices

#### Student

- schedule
- attendance
- assignments read
- results read
- messages
- notices

#### AI

- read-only Q&A with source citations

---

## 34. MVP 2 — Workflow intelligence

Add:

- full assignment submission
- marks/results publishing
- report cards
- saved/scheduled reports
- reconciliation tooling
- installment workflow
- concession/refund approvals
- timetable substitutions
- AI drafting
- AI structured action proposals

---

## 35. MVP 3 — Automation

Add:

- AI confirmed actions
- advanced analytics
- admissions automation
- rule-based alerts
- timetable optimization
- external integrations
- transport
- PTM booking
- configurable workflows

---

## 36. Product metrics

### School adoption

- weekly active staff
- parent activation rate
- student activation rate
- module adoption by school

### Operational efficiency

- attendance submitted by cutoff
- payment reconciliation time
- admission follow-up SLA
- average parent response time
- timetable conflict resolution time

### Parent experience

- online payment success
- message response SLA
- number of office visits avoided
- notification engagement

### AI

- questions answered with citations
- action proposal acceptance rate
- tool failure rate
- confirmed action success
- user-reported incorrect answers

Do not optimize AI usage volume as the primary success metric.

---

## 37. Non-goals for the first release

Avoid trying to build everything schools might ever need.

Do not initially become:

- full payroll/HRMS,
- full accounting ERP,
- full video LMS,
- proctoring platform,
- school bus GPS hardware company,
- biometric hardware platform,
- generic social network.

Integrate or add later where strategically justified.

---

## 38. Product north star

A good THATCAMPUS session should let each person answer:

### Principal

“What needs attention?”

### Teacher

“What do I need to do for my classes today?”

### Accounts

“What money needs action?”

### Admissions

“Which family needs the next touch?”

### Parent

“What is happening with my child, and do I need to do anything?”

### Student

“What happens next, and what do I need to finish?”

### AI

“What can I safely answer or help accomplish using only what this person is allowed to access?”
