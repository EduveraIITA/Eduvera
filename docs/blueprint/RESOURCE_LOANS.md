# Resources and borrowing

Status: implementation contract for owner-approved story18, 24 October 2026.
This contract is not delivery evidence. See the implementation plan for acceptance.

## Person and outcome

A custodian can start with one exact book or equipment item and one campus person,
record issue and due time, inspect a complete or partial return, and correct a
recording mistake. A borrower can see their own record, question an overdue item or
report a missed return. The custodian investigates and replies against that same
loan. Everyone can distinguish outstanding custody, a report awaiting review and
accepted recorded return. No academic programme, enrollment, app account for a
passive borrower, Finance setup or full inventory configuration is required.

## Ordinary mobile experience

- **Resources:** compact Loans / Items views, with My borrowing where the acting
  account explicitly links to a canonical borrower. Short finite pages and scoped
  search; Out, Overdue, Returned and All are useful filters, not separate engines.
  Opening a card goes to the ordinary exact loan; no swipe or extra overflow button.
- **Issue an item:** select/reuse one exact item, a canonical person and due time.
  Existing People quick-add/import retains the unfinished issue. Explain and confirm
  that the concrete signer takes the custodian responsibility for this loan.
  Optional kit parts remain beside the item. Review the actual item/person/parts,
  due time and responsibility before accepting the issue.
- **Add item:** reuse the topology owner's resource type/holding. Choose an existing
  campus (one choice may be preselected visibly); if none exists, explicitly create
  the smallest named location through its owning service in context. Never silently
  manufacture a campus or require buildings, floors, classes and departments.
  Owner clarification,24 October: Name plus Quantity10 creates ten independent
  individually tracked copies, each with its own stable UUID and asset tag, not
  one pooled holding ofquantity10. Quantity defaults toone. Tags are generated
  automatically unless an optional exact tag (one copy) or prefix (several) is given;
  a prefix produces `CAM-001` through `CAM-010` without silently truncating it.
  A batch of1–100 copies is one user save and one atomic native transaction, using
  the existing per-copy prepared command/projection/event chain. An exact retry
  returns the same ordered copy IDs; any collision/failure rolls the entire batch
  back. This per-save bound is not a campus inventory limit. The first copy is
  visibly selected on returning to the unfinished issue; adding ten never issues ten.
- **Loan:** item, borrower, due time, recorded issue and outstanding parts share a
  compact summary. Record return selects quantities and usable/damaged/held condition.
  A partial return names what remains outstanding and keeps the loan open. Full
  return settles custody, but does not override a damage/hold or retired item.
- **Question this record:** the borrower reports the issue/claimed return and its
  observed date. This creates custodian Needs me and borrower Waiting, not a return.
  Native private replies and explicit resolution remain attached to the same loan.
  Reading a message or replying alone never proves the item has been received.
- **Correct:** an identified current custodian records a missed return or corrects
  an exact prior return with a reason. Original evidence remains visible. Due-date
  changes are explicit, reasoned and historical; they are not automatic renewals.
- **Change responsibility:** the existing loan asks for one eligible successor and
  a reason. The current named custodian may hand handling responsibility to another
  active, canonical app-enabled Resources operator. If no eligible endpoint remains
  for the named custodian, a current Resources operator may explicitly recover that
  exact orphaned responsibility. An unrelated manager cannot take over while the
  custodian remains eligible. An unavailable successor is never guessed or granted
  access by this action. Native immutable history retains both people, signer and
  handover versus orphan-recovery basis. The borrower, physical parts, due date,
  observed returns and linked accommodation stay are unchanged.

An open borrowing question continues with the successor through an explicit
retire-and-reissue protocol. The exact old event/message and correlation remain
retained; a partial return or reply between the original question and the handover
does not fabricate an adjacent source revision. Its current native route records
the successor, accepted source revision and message. The previous custodian loses
private question access and physical-return authority immediately. Linked required
keys stay outstanding until their actual accepted return; handover alone cannot
close accommodation. An original signer who remains currently authorized can
confirm or exactly replay their accepted handover receipt after a lost response,
but cannot use it to perform a new current-custodian operation.

Use the shared theme, viewport-aware sheets and date controls in all four appearance/
world combinations. Loading, empty, permission denied, revoked, stale revision,
unknown write and accepted-but-refresh-failed states need truthful recovery. A timed-
out write retains its exact command and blocks blind duplicate submission.

## Ownership and bounded first adapter

Topology owns `campus_resource_types` and `campus_resource_holdings`; Resource Loans
does not create another catalogue. The first adapter lends exact individually tracked
copies. Existing pooled holdings remain visible with an explicit nonissuable reason,
not invented copy identities or misleading availability. Kit parts are typed physical
parts of that one exact item, not independently loanable parallel inventory.

The custody owner uses five typed relational stores: loan, immutable part definition,
append-only typed receipt, receipt part quantities/condition and exact loan question.
The closed receipt vocabulary owns issue, return, return correction, due-date change,
responsibility handover/recovery, question, reply and resolution. This is not a generic
Case/EAV/event-sourced business engine. Core coordinates and retains command/outcome/hand-off evidence; native domain
rows remain authoritative.

Availability combines the topology's active/available status with current accepted
custody, all kit parts and their accepted condition. Full return never implicitly
clears damage/hold or makes an unavailable/retired item issuable. There is currently
no physical resource-reservation owner to borrow from; do not invent accepted bookings.
Future reservation/repair/Finance adapters must join these sources before advertising
availability, settlement or release. Fines, lost-item settlement, renewals, reservations,
waitlists, barcode hardware and automated reminders are not this first adapter.

## Invariants and authority

- Tenant-qualified references bind exact holding, person, loan, part and question.
  Source identity and immutable receipt rows cannot be updated or deleted normally.
  Topology cannot change historical copy identity/type/quantity around its custody.
- Lock the holding before the loan in a consistent order. Competing issues cannot
  lend the same copy twice. Quantities are bounded positive integers; returns cannot
  exceed issued parts, and a correction cannot reopen custody over a later issue.
- Preserve observed/effective versus recorded time. A late-recorded return cannot
  pretend the system knew it earlier. Future or pre-issue return observations fail.
  Overdue is derived from accepted outstanding state and the selected execution clock,
  not a worker-written flag or a negative inference from a borrower report.
- `resources.manage` is explicit institution-scoped technical access, excluded from
  default Staff grants. It does not make an administrator custodian of every loan.
  New issue requires explicit concrete custodian declaration and stable human identity;
  existing-loan mutations recheck the exact current custodian and purpose permission.
  Borrower self access uses the current explicit canonical account/person link, not
  student status, names or a family relationship. Passive people need no account.
- Every material operation uses the existing prepared command/receipt ports, native
  transaction, journal, audit and transactional outbox. Retained replay rechecks current
  authority and exact actor/source/payload/world commitments. No workflow-local command
  runtime or direct Core-table writes.
- Question submission explicitly confirms its exact custodian route; replies return
  through the exact requester's current endpoint. Missing/revoked routing is a visible
  recovery state, never a guessed administrator. Native Work suppresses only the exact
  matching protocol mirror. Resolution removes stale attention, not historical evidence.
- Private question/reply bodies stay in native storage and authorized loan detail.
  Generic Work, Core metadata and refresh events carry only source IDs, revision and
  minimum safe context. Audience membership cannot create access.

## Progressive operation and Simulation

Resources is additive to the existing starting-goal catalogue and Areas. Choosing it
does not grant custody or require unrelated setup. Readiness is actor/world-qualified:
available to begin, exact accepted own issue/borrowed context, or access unavailable.
Creating an item or visiting the page is not first-operation completion. Whole-campus
and one-subsystem starts converge on the same ordinary workspace and native records.

The same service, controller, permission checks, native state and UI bind to the
server-selected Live or copy-on-write Simulation store/clock. Snapshot capture must
include the new native tables and canonical topology/People dependencies. There is no
Live fallback, real connector or separate simulated loan service. Real COW acceptance
must prove issue/partial return/question/correction and closure in one branch, exact
retry, virtual overdue and unchanged Live/sibling state. Record service, HTTP, rendered
UI and actual physical/device evidence separately. No application record certifies
that software independently witnessed a physical handover.

## Research informing the adapter

Primary campus sources illustrate differing practices, not ThatCampus defaults:

- [Curtin's claimed-return process](https://www.curtin.edu.au/study/help-support/app/answers/detail/a-id/2126/why-do-i-have-items-that-i-returned-or-never-borrowed-on-my-borrower-record/)
  separates the borrower's report and staff investigation from final account clearance.
  ThatCampus keeps the claim and accepted return as different native facts.
- [Edinburgh equipment conditions](https://edwebcontent.ed.ac.uk/sites/default/files/atoms/files/terms_and_conditions_updated_nov22.pdf)
  use bounded equipment periods and staff-controlled extensions, while
  [UCL's book policy](https://library-help.ucl.ac.uk/faq/282952) describes conditional
  automatic renewal. ThatCampus therefore does not hard-code one universal renewal,
  eligibility, fine or reminder policy into the custody kernel.
