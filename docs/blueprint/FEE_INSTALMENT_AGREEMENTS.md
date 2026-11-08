# Fees, receipts and payment agreements

Accepted first delivery contract, 23 October 2026. Finance extends an existing
invoice with a private proposed payment schedule and an authorized decision. It
does not create another charge, treat a request as money received or replace the
existing ledger/payment-review owner. Full story9 also needs payment-query/Core
convergence, scoped payer sharing and reminder policy support.

## Person and outcome

An authorized payer opens an existing invoice, proposes dated positive amounts
against its actual balance and optionally explains why. The app derives the current
Finance reviewer and shows who must act next. The reviewer approves the exact
proposal or rejects with an explanation. The payer sees the agreed dates, actual
remaining balance and a separate payment/receipt status. Pending requests can be
withdrawn without decision authority, including when the reviewer route changes.

Do not require a term, department, timetable or full campus setup to operate fees.
Reuse the existing person/invoice and ask for missing facts in context. Routing,
Core subscriptions and command metadata stay internal. Never demand a workflow-
builder form from the payer or repeatedly ask staff for known responsibilities.

## Supported variation and authority

The first supported agreement mode is **approval required**, using the institution's
confirmed `fee_instalment_decision` route. It is not a universal assumption that
every payment plan is a discretionary concession. Self-enrollment, automatic
rebalancing, penalties, discounts and reminders need their own reviewed effective
policies and tests before enablement. No two-instalment, monthly, school-year or
guardian-only rule is hard-coded as the universal campus model.

Existing current guardians may request a plan for their linked learner's invoice.
Adult learner self-service requires an explicit invoice-scoped, dated entitlement
from current Finance authority. The enabling staff member confirms the adult/self-
payer basis; age inferred from a name, job title or birth date does not grant access.
Keep enabling/revoking it beside the invoice, not in a student-facing role wizard.
Expiry/revocation changes future actions, never financial history or read evidence.

Approval, rejection and self-payer entitlement decisions require current identity,
`fees.manage` and the source-backed institutional Finance decision route. A technical
administrator or principal label alone is insufficient. Missing, ambiguous or
changed authority fails closed with an understandable recovery path. Existing
authority can be reused; new authority is never activated by a hidden template.
The exact retained reviewer receives the request; a replacement never silently
inherits an old message or decision.

When an existing mandate already covers payment-plan decisions, its current holder
can confirm it in the fee workspace. Show the person and office, with source details
behind an information disclosure. That explicit confirmation also approves delivery
of payment-plan requests to that holder, without timers, reminders or autonomous
decisions. It creates no mandate, appointment, source or permission. Current source
revisions and any enforceable amount limit are retained and rechecked; unsupported
conditions fail closed. A missing delivery route can be repaired through the same
confirmation without rewriting the already-adopted authority or taking over another
office's route. Accepted-but-unrefreshed outcomes require exact receipt discovery,
not another confirmation. A genuinely new campus still needs a reviewed initial
authority-establishment path; a technical administrator is not that authority by
default.

## Records and financial truth

Finance owns immutable instalment requests, decisions, withdrawals and self-payer
grant/revocation evidence. Serialize the per-invoice stream with an expected revision
and exact ledger-basis commitment. Concurrent approval, changed charges/credits/
payments/refunds and duplicate submission are rechecked in the owning transaction.

An approved plan changes the authorized schedule, not the original amount,
payment entries or receipts. Compute scheduled progress only from actual ledger
allocations, deterministically against the oldest outstanding instalment. Normal
payments reduce the balance once. Changed credit/refund basis needs explicit review
rather than silent rebalancing or invented money. Original charge, adjusted charge,
received/allocated amount, agreement and remaining balance stay distinct.

Use integer paise and bounded positive amounts/dates. The proposed total must equal
the current outstanding balance at the accepted basis. Approval accepts that exact
proposal; counterproposal negotiation remains a separate supported mode. Preserve
entered amounts when stale-basis recovery requires a fresh review.

## Core and Work

Every adopted request/decision/withdraw/entitlement mutation prepares an exact typed
Finance command before native effects, checks current identity/authority/revisions
and retains a correlated outcome. Stable IDs and payload commitments support receipt
discovery; changed payloads conflict and unknown outcomes require refresh/recovery.
Read recovery addresses the exact current actor, invoice, handler and command in
the selected world. Pending or unknown results keep the proposal locked. A proven
missing receipt permits only the same retained command/payload, never a new key
based on a generic refresh. After exact receipt lookup, a monotonic native stream
revision or immutable ledger-entry divergence may prove an old command permanently
inapplicable; only that typed proof allows a refreshed basis and a new reviewed
proposal. Accepted receipts take precedence over later changes. Navigation and
late callbacks preserve actor/world boundaries throughout recovery.

The institution-approved named route supplies a reviewer Needs me item and requester
Waiting. Decision or withdrawal closes both from native source state. No review
deadline is inferred from the invoice due date. Generic Work and Core safe context
contain IDs and neutral status, not private explanations, transaction references or
financial evidence. No default notifications, payer invitations, provider capture,
reminders or late penalties are activated.

## Course-change financial review

A reviewed elective change is a bounded Finance impact classification, separate
from an instalment agreement or a new fee engine. The academic coordinator reviews
the person, source/destination course, future effective date, dated timetable impact
and catch-up disposition. They explicitly select an eligible named Finance recorder
and confirm delivery. A missing route remains visibly unassigned with a supported
assignment action; it never receives a hidden seed reviewer or an inferred approval.

Only the retained currently eligible recorder with current institution-scoped
`fees.manage` access can open the private review and classify its exact invoice and
ledger basis, with a reason. No linked legacy student/invoice is not evidence of no
financial impact; a person UUID must never fill a missing legacy student key.
`Requires financial review` records progress and keeps the handoff open. Only an
explicit `No financial change` decision on the current basis can permit academic
apply. Any needed charge, credit, refund, waiver or concession still belongs to its
ordinary authorized Finance workflow; this classification neither performs it nor
grants financial governance authority or a `fee_instalment_decision` mandate.

The named recorder opens the existing Finance review from its exact Today or Work
task. Link resolution reads only current source/delivery metadata in a batch,
checks the current campus, recorder and message/source revision, and constructs the
canonical Finance destination. It never follows an arbitrary message payload URL
or loads private ledgers merely to compose Work. A source or responsibility that
cannot be confirmed stays explicitly unavailable; opening and classifying still
repeat the owning Finance authority, route and ledger checks.

An accepted no-change classification closes its original Finance task through the
owning protocol. After exact command confirmation and a matching fresh authorized
detail read, refresh the current same-origin actor/campus/world's active Today,
Work, badge and related course/Finance/schedule/calendar projections. Do not use an unknown outcome
or a mismatched receipt as completion evidence. A failed refresh retains the accepted
command for read-only recovery, without recording the financial decision again. The
[scoped cache recovery](../../artifacts/core-completeness-2/parity/elective-cache-source.json)
keeps the receipt and display refresh boundaries separate.

From the current enrollment's Change elective action, the academic coordinator can
continue one of its twenty most recent open reviews, showing its destination,
effective date and neutral progress before creating another proposal. This is
bounded discovery, not complete historical search or an automatic coordinator
approval. Applied or withdrawn reviews leave that list; the immutable review and
its current detail remain authoritative. After apply, show the recorded
**No financial change** classification and its retained decision identity as history.
Closing its task must
not relabel that accepted decision as an unavailable route, reopen Finance work or
claim that today's ledger/recorder is still the accepted basis. Terminal academic
writer actions remain unavailable; the
[terminal projection](../../artifacts/core-completeness-2/academic/elective-terminal-source.json)
preserves that distinction.

Apply rechecks the named recorder, current authority, exact immutable decision and
person ledger/invoice commitment before Learning and Activity atomically accept the
reviewed dated enrollments and future plan successors. A changed financial basis
requires fresh Finance review; an absent link or stale no-change label cannot pass.
Earlier money, attendance, submissions and issued results remain unchanged. Private
ledger detail and decision reasons stay in Finance; academic detail and generic
Work receive only purpose-scoped identity, references and neutral progress.

The source-owned proposal, actions, Finance decisions and known refusal evidence
retain exact command/revision/world scope. Accepted recovery confirms the retained
receipt without resending. Only the owning typed terminal refusal or exact obsolete
proof permits a new review; a generic conflict or unknown server result does not
clear a pending action. A catch-up summary is a coordinator-reviewed plan, not proof
that a teacher or learner accepted or completed remediation. Live and Simulation
share these owners, with meaningful branch changes isolated from Live and siblings.

## Live and Simulation acceptance

Use the same owning services and native tables with selected-world authority,
clock, configuration, events and command/outcome receipts. Prove request/approval/
withdraw and entitlement expiry/revocation, exact replay, changed payload and stale
basis, independent reviewer/current endpoint gates, own Waiting and reviewer closure,
and meaningful branch changes with unchanged Live/sibling ledger and agreement.
All payment/provider examples remain synthetic; approval never proves settlement.

The mobile account and ledger reuse the current theme, show one next action and
retain actor/world source context. Verify loaded, empty, pending, denied, stale and
accepted-but-unrefreshed states. Adult self-service must be discoverable only under
the proper relationship/entitlement; an invoice URL grants no access.

## Person based Fees first operation

Owner-approved extension, 23 October 2026. This is the implementation contract;
verified delivery and remaining acceptance gates belong in the implementation plan.

An accounts operator starts in Fees, selects an existing campus person or adds
one through the shared People sheet, and records a real charge with its reference,
description, amount and due date. A concise review identifies the person and exact
charge before posting. Neither admission, student enrollment, class nor term is a
prerequisite. Recording an obligation does not establish that the person has paid.

The account keeps charges, actual receipts, balance and any approved payment dates
together. Existing student/guardian accounts keep their current identifiers,
permissions and history. A person account is a distinct typed invoice context,
not a person ID passed as a student ID. Existing immutable invoices and their
retained ledger-basis hashes are not rewritten or eagerly backfilled.

A currently entitled payer, or an explicitly authorized operator assisting them,
can report a payment or question a charge. They choose an eligible named Finance
reviewer and confirm delivery of this specific request. The reviewer sees their
own Needs me item; the sender sees Waiting. No recipient is selected from a job
title or an all-administrator fallback, and no response deadline is invented.
Private explanations and transaction references remain in Finance, not generic
Work, Core payloads or realtime notifications.

Reporting money leaves the balance unchanged. A different currently authorized
reviewer checks the funds independently and confirms the exact amount/reference.
Only accepted verification posts one native payment and its printable receipt.
Rejection permits a corrected report; answering a charge question changes no
money or due date. Current balance, duplicate references, current identity/access,
retained recipient and source revision are rechecked at execution. A changed or
revoked reviewer requires visible recovery, not silent reassignment.

The screen distinguishes permission to record a charge or verify a reported fact
from institutional authority to decide a payment plan. Existing operational
Finance permissions remain scoped technical access; they do not appoint an
officeholder or create a mandate. Self-service disclosure and payer actions still
require explicit dated invoice access. A linked app account or matching name is
not that access. Existing payment-plan adoption can confirm only an already
current source-backed mandate. Missing plan authority blocks the plan decision
alone, not charge recording or other accepted work. The initial authority ceremony
remains a separate delivery gate; this extension must not fabricate it.

Owner clarification, 23 October 2026: a bounded private-workspace exception is
permitted for a founder who explicitly self-attests limited payment-plan decision
authority. This is a policy decision, not an implemented grant at checkpoint 81.
The eventual flow must visibly identify the source as self-attested, never verified
institutional authority; prove private-workspace founder eligibility from an
authoritative source rather than an administrator title; limit the domain,
actions, context and duration; retain the explicit attestation and audit evidence;
and prevent reuse after the workspace becomes managed or institutionally verified.
It must not authorize self-verification of payments, automatically grant payer
access, or confer authority over another institution. The source, revocation and
transition contract must be reviewed before implementing this exception.

New charge, report and verification commands use source-, actor-, handler- and
world-bound receipts. An ambiguous response remains locked pending exact lookup;
an accepted command followed by failed refresh remains accepted and read-only
until current truth loads. Changed payloads cannot reuse a key. Replaying an
accepted charge or verification after the ledger advances returns its original
receipt without creating another financial entry. Temporary failures preserve
input; explicit revocation fails closed without disclosing cached private data.

Fees can be chosen as a starting outcome only with truthful operation-specific
readiness and a normal Fees destination. A first posted charge is not a confirmed
payment or completion of story9. Continuation must resolve the exact actor-owned
invoice in the selected world; unrelated administrators' records cannot replace
it. Manual receipts do not claim provider settlement, gateway integration or a
statutory numbering policy. Scoped third-party payer sharing, reviewed reminders,
refunds and the complete first-authority ceremony are not supplied by this slice.

The normal mobile workspace uses the shared depth, short copy, visible person
identity, one primary action and finite results. It retains the current Light,
Dark and amber variants, keyboard-aware sheets and inset saved/action bars. Native
ledger and receipt workflows must pass legacy, independent-review, duplicate,
privacy, revocation and meaningful isolated Simulation tests before completion.

## Charging several people or a group

Owner direction, 23 October 2026: Record charge must accept several existing people
or an existing group without repeating the charge form. An accounts operator
selects People and/or Groups, adds or imports missing people in context, supplies
one charge description, amount per person, reference and due date, then reviews
the exact unique recipients, individual references and total before posting.
Selections persist across search and pages. Optional roster detail is finite and
does not displace the charge fields or primary action on a phone.

Each canonical person receives an independent invoice in the existing ledger.
Overlapping direct/group selections count that person once; equal names never
merge identities. This is a shared charge specification, not one pooled balance,
joint liability, money received, or permission to disclose one person's account
to other group members. Group membership confers no payer access or authority.

Finance reads only minimal beneficiary/group identity through purpose-specific
owning adapters under current institution-scoped Finance access. It must not grant
`sis.manage` merely to select recipients. Descriptive participation groups,
current academic classes, native learning groups and administrator-visible
organization groups retain their own membership dates and privacy boundaries.
Only direct current members are selected: no descendant expansion, inferred
accounts, instructors-as-learners or historical/future membership. Unsupported or
oversized selections fail visibly, never truncate or silently split into chunks.
Organization's current adapter has undated direct membership rows; row existence
is its membership fact. Do not infer that descriptive membership starts or ends
from a person's employment status or joining date. Canonical retirement still
excludes that person, and organization-group disclosure remains administrator-only.
The initial operational bound is 500 unique recipients and 20 selected groups;
these are execution limits, not universal institution policies.

The server produces one coherent selected-world audience commitment including
the campus date, explicit selection, exact source/membership facts and canonical
person revisions. Posting re-resolves that commitment in a consistent transaction.
A changed roster, retired person or changed identity requires a new visible
review; new members are never silently charged. A snapshot is the reviewed
membership at that operation, not a recurring rule: later membership changes
neither create new charges nor erase posted ones.

One typed Finance batch command commits the immutable collection manifest,
individual invoices, audits, per-invoice events and accepted outcome atomically,
or creates none. Stable batch/command identities and deterministic per-person
invoice IDs prevent partial retry duplication. Exact retained acceptance wins
before mutable membership validation; a changed payload cannot reuse its key.
Unknown outcomes stay locked for exact confirmation, and accepted-but-unrefreshed
results reload without posting again. Definitive pre-acceptance validation may
permit correction. A changed or unavailable audience leaves an exact terminal
rejected command with no financial effects; confirmation can therefore unlock a
new review even after an earlier response was lost. That rejected key can never
later create charges if membership changes back. A group hash alone is not an
irreversible obsolete proof. Existing single-person command contracts and historical hashes
remain unchanged.

The result returns to the ordinary Fees ledger with the recorded collection's
charges and count, not an arbitrarily selected first person. Individual payment
reports, independent verification, receipts and payment plans keep their existing
owners and permissions. Live and Simulation use the same batch command and owning
read adapters. Acceptance includes overlapping selections, all-or-nothing rollback,
concurrent retries, stale/differently dated groups, same-name distinct people,
cross-campus/access denial, exact recovery and unchanged Live/sibling records.

### Browsing posted collections

Owner direction, 23 October 2026: the main Finance ledger shows one tile for a
recorded collection, not one repeated activity title for every person. Group only
by the authoritative issued batch ID; equal titles, reference prefixes or current
group membership never merge separate obligations. Standalone charges remain
standalone. The tile gives its immutable title/reference and recorded people count,
with current outstanding and cancelled state derived from all issued invoices.
Missing members or inconsistent metadata show an unavailable aggregate, not a
partial total, paid status or zero. Cancellation does not reduce the posted count.

Opening the collection leads with people and their individual current obligations;
receipts are available in a separate finite view within that same collection.
Count only effective receipts in received totals while retaining reversed/replaced
originals with their status. Payments, individual corrections and collection
correction keep their owning paths. Search and pages survive contextual Back.
No pooled liability, new financial writer or configuration is introduced.

The latest [card action direction](THATCAMPUS_THEME.md#card-actions) removes swipe
shortcuts and extra action icons. Tapping the compact card opens its ordinary
detail page with Receipts and permitted corrections. Exact selection, reason,
review and acceptance remain unchanged. Stale reads and read-only worlds cannot
retain an enabled correction action. Opening an
untouched, preselected single-charge editor is not itself an unsaved change.

Collection metadata is disclosed only to current institution-scoped Finance
operators in the unfiltered management ledger. Person/student/invoice-scoped and
family/self-payer reads do not reveal other recipients or collection size. Reads
remain coherent in the selected Live/Simulation world. Verification belongs in
the implementation record; this contract alone is not delivery evidence.

## Correcting posted charges and receipts

Checkpoint87 delivery and evidence are recorded in
[posted fee corrections QA](../VERIFICATION.md#operations).
For retained legacy reports, new requests carry an immutable server-derived
correction watermark: charge revision and receipt-correction count. Verification
requires exact current agreement, independent of clock advancement. Historical
NULL-watermark requests keep their hashes and remain compatible only while their
invoice has never been corrected; otherwise reject with an explanation and obtain
a fresh report. Audit metadata is not used as authoritative financial evidence.

Owner direction, 23 October 2026: an ordinary Finance operator must be able to
correct a recording mistake after posting. Immutable history protects the original
evidence; it must not make an erroneous record the unchangeable current truth.
This is the delivery contract; the linked QA record distinguishes verified
behavior from remaining release gates.

The charge or recorded collection exposes a compact **Correct** action under
current institution-scoped Finance recording access and a current canonical
person/account endpoint. The operator selects one charge, selected charges or all
charges in that collection, corrects amount, description or due date, or cancels
the recorded charge. Selection uses the immutable issued invoice IDs, never a new
expansion of today's group membership. The operator gives a short reason, reviews
the exact before/after charge and balance or credit for every affected person,
and explicitly confirms a recording error rather than a concession decision.
Unchanged fields stay unchanged; empty or no-op amendments fail visibly.

The correction appends new authoritative facts linked to each original invoice.
It never rewrites the original issue amount, reference, beneficiary or collection
manifest. Current screens distinguish original charge, corrected charge, cancelled
charge, verified money, remaining balance and any excess credit. Zero because a
charge was cancelled is not described as paid. A reduction below verified net
payments creates a visible credit/refund consequence, not a claim that money has
been returned. Changing a beneficiary or reallocating paid money is not inferred
from an amount correction; cancel and record the right person's charge explicitly.

A receipt exposes its current valid, reversed or replaced state. A currently
authorized operator can reverse a mistaken recorded receipt or replace it with a
fresh linked receipt, after reviewing the effect on that invoice. Replacement
requires explicit verified-funds confirmation. The original native payment-report
submitter's account or canonical person cannot verify their own replacement;
the current independent operator may be the original independent verifier. A
reversal alone asserts no new money received. It is not a bank refund, provider
reversal or transfer. Provider-linked payments remain with their reconciliation
owner rather than being silently detached through this manual path.

Original receipts and payment reports remain in history and printed originals
visibly show reversal/replacement status. Current balances count only effective
receipts. A replacement can retain the actual bank or cash reference when it
replaces that exact reversed entry; never invent a suffix merely to bypass an old
uniqueness constraint. Active payment references remain transactionally unique
across the campus, and an unrelated active receipt cannot reuse the reference.

The first supported correction context is an ordinary non-event invoice, whether
person-based or retained student-based. Event credits, withdrawal, cancellation
and refunds retain their existing owning reconciliation rules. Recording access
does not establish institutional concession/waiver authority, payer disclosure,
automatic money movement or a payment-plan decision mandate.

Preview commits the selected world, exact invoice/payment IDs, changes and current
append-only ledger facts. One typed Finance command applies all selected changes,
history, audits, events and correlated outcome atomically. A stale member rejects
the whole selection and requires a fresh visible review; it must not partially
correct a collection. Exact retained acceptance takes precedence over later
ledger changes. Unknown outcomes remain locked for exact confirmation, known
rejected attempts retain a terminal outcome, and accepted-but-unrefreshed results
retry reads rather than writing again.

Untouched invoice ledger-basis commitments keep their existing version and shape.
Corrected invoices use an explicit new basis that includes amendments and payment
reversals as append-only facts. Old pending payment reports and agreements cannot
silently authorize action against a changed charge or corrected receipt. Agreement
allocation becomes Needs review when its retained basis no longer supports it.
All authorized balances, payment limits, collections and projections use the same
effective financial truth while preserving the original evidence.

Live and Simulation use the same services, current authority checks, native
constraints and command/outcome protocol. Acceptance includes single/selected/all
charges, cancel and later explicit correction, paid and unpaid balances, original
receipt status and replacement, same-reference concurrency, exact retries, stale
and ambiguous outcomes, injected rollback, cross-campus/current-access denial,
old commitment compatibility and a meaningful isolated correction with unchanged
Live and sibling financial records. No provider or real-money operation is part of
the synthetic acceptance run.

## Payment review and receipts

Payment reporting, fee questions and actual receipts are independent native facts.
An authorized payer sees invoice reference, description, original/adjusted charge,
verified received amount, due date, balance and any refund consequence together.
The applicable person/student/payer scope remains explicit; self-payer grants above
extend the retained linked-guardian flow rather than making learner access universal.

Direct payment uses the institution's published verified instructions. An optional
UPI handoff includes the exact payee, amount, INR and invoice note; opening another
app is not a payment result. Device support varies, so instructions and UPI details
remain available manually. Never launch an external app automatically or request
card/PIN credentials. Cash is reported after counter payment; an uncleared cheque
is not a verified receipt.

Report an already-made payment with positive partial/full amount, method, bank/UTR/
counter/cheque reference, optional explanation and explicit made-payment confirmation.
One pending payment claim per invoice prevents duplicate submissions by different
payers. Awaiting review never reduces the balance. A separate charge question may
coexist, but freezes no due date or obligation and applies no concession/refund.
Rejected reports can be corrected; an answered question changes no money. Printable
statements and original verified receipts remain accessible under current authority.

An independent currently authorized Finance reviewer confirms funds and supplies
the decision response. The original submitter cannot verify their own report,
including through another staff/admin capacity. The transaction rechecks collectible
balance and normalized unique reference, then commits payment, decision, audit and
outbox together. Same-key/same-payload retries return the receipt; changed payloads,
stale/competing decisions, zero/negative/fractional/excessive amounts fail visibly.
Use integer paise throughout. A payment posted elsewhere or a credit/cancellation
while review waits requires recomputation, never over-allocation.

Instructions use revision-checked updates. Invitation/role/relation changes affect
current reads, actions, delivery and replay. Shared events carry IDs, not private
notes or transaction references. Paid/unpaid history, pending provider status and
email delivery status must not be conflated. Recording access is not concession,
waiver, refund or payment-plan decision authority. General non-event concessions,
refund posting, bank reconciliation and statutory receipt-number policy remain
separate unless the owning workflow is explicitly delivered. Event financial
changes keep their existing reconciliation owner. Unpaid balances never block
attendance, emergency communication or family records.

Acceptance covers family/tenant/student-write denial, inactive/revoked links,
independent review, same-reference case/whitespace collisions, two-reviewer races,
other receipts/credits while pending, changed retries, durable reports after browser
closure, failed UPI handoff with no mutation, exact receipt status and source-private
event replay. Real bank/payment behavior and destination ownership need institution/
provider checks; automated acceptance must never transfer real money.

## Razorpay sandbox provider

This is the explicitly bounded non-production gateway extension, not a real-money
collection or settlement capability. It supersedes the earlier blanket description
of the gateway as unimplemented while retaining the native payment evidence rules.
Current `backend/src/config.ts` defaults `RAZORPAY_ENABLED` to false, has no embedded
test credentials, and rejects enabled production configuration or non-test keys.
Old Stage-only credential/default-enable instructions are not current operations.

Provide server-only `RAZORPAY_ENABLED=true`, a paired `RAZORPAY_KEY_ID` beginning
`rzp_test_` and `RAZORPAY_KEY_SECRET` in an approved non-production deployment.
Optional `RAZORPAY_WEBHOOK_SECRET` is independent of the API secret. Never place
credentials in frontend variables, docs, logs or source. Use current migrations;
the original provider and payment-email additions were `057_razorpay_sandbox.sql`
and `059_payment_email.sql`, not permission to bypass the migration runner.

Use Test mode automatic capture. Raw-body signature-verified webhooks support
`payment.captured` and `order.paid`; `payment.authorized` and `payment.failed` also
support status recovery. The endpoint is the deployment's trusted HTTPS origin
plus `/api/v1/payments/razorpay/webhook/`. A bounded background check every minute
and explicit Check payment status recover missed callbacks; webhook-dashboard
access and real provider/browser checkout remain separate acceptance gates.

The bounded family flow permits active linked guardians to initiate checkout;
student read access does not grant initiation or verification. Current balance
and integer paise determine an order, minimum ₹1. One active order per invoice is
reused across guardians/retries; a different amount is rejected until it resolves.
The first slice cannot change an unpaid order's amount. Verify the signature
against the stored order ID and fetch authoritative payment details. Authorized
is not captured: only matching captured order/payment/amount/currency can post.

School/invoice locks serialize callbacks, webhooks and polls; unique provider
order/payment IDs prevent duplicate money. Allocation, receipt, audit and authorized
events commit atomically. Raw webhook event IDs plus payload hashes deduplicate
replays; unknown orders are ignored and failed checks remain recoverable without
logging provider bodies/secrets. All native receipts use `razorpay_test`, affect
only that configured non-production ledger and clearly say no real money collected.

If another receipt, cash entry or adjustment changes the balance, preserve the
capture as `review_required` rather than over-allocate. Operator/provider review,
not automatic refund, resolves it; no bank settlement is inferred. A provider order
created immediately before a network/database failure may be unpaid and orphaned;
only persisted orders reach Checkout. Pending orders under rotated credentials
need reconciliation using their original account/key, never silent account swaps.

Saved payment history refreshes every 30 seconds while visible. Only allocated
captured payments expose an authorized PDF test receipt; failed/pending attempts
do not issue one. Wallet compatibility permits exact Razorpay form origin and uses
`same-origin-allow-popups` while enabled; this is not proof of live wallet completion.
Bundled receipt fonts and licenses remain in the runtime.

Capture, review-required, provider-verified failure and pending confirmation enqueue
deduplicated mail inside their native transaction. The worker checks every 15 seconds
through the existing invitation mail provider. `INVITATION_EMAIL_ENABLED`, verified
email and an active linked guardian checkout creator are required; old payments
are not automatically mailed. Only allocated captures attach PDFs. All mail/PDFs
label test mode. Provider acceptance is not inbox delivery. Ambiguous sends become
`unknown`, not automatically retried; stale pending/failed notices are skipped after
capture. Authorized receipt download is independent of email delivery.

Verify raw-byte signature tampering, permission/tenant/current-family boundaries,
amount validation, reused orders, concurrent posting, pending authorization,
changed-balance review, webhook replay and callback-loss recovery in isolated
tests. Actual provider checkout, runtime enablement and institution sign-off are
separate evidence. No live payment, automatic refund or production-readiness claim
follows from a configured key or passing fake-provider test.

### Payment research

Primary provider guidance informs server-owned orders, captured-state checks and
idempotent recovery: [Razorpay integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/),
[webhook practices](https://razorpay.com/docs/webhooks/best-practices/) and
[Google Pay payment-result handling](https://developers.google.com/pay/india/api/web/handle-response).
Earlier product research used Fedena's documented family fee history, partial
payments, receipt privileges and transaction references; those patterns do not
establish ThatCampus delivery or universal institutional finance policy.

## Research informing variation

[MIT Student Financial Services](https://sfs.mit.edu/how-to-pay/paying-your-bill/monthly-payment-plan/)
describes student or authorized-user payment plans and partial upfront payments.
[IIT Madras academics](https://study.iitm.ac.in/ds/academics.html) describes paying
for registered courses. These examples support configurable schedules and charge
contexts, not copying either institution's amounts, providers or authority rules.
The first supported ThatCampus mode above remains explicitly narrower.
