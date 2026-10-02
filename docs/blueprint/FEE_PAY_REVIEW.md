# Fee, payment and review behavior

Decision date: 2 October 2026. User confirmed that “review” means fee/payment
review, not school ratings. This extends the existing Eduera ledger; the primary
product reference is School Operations Blueprint section 17.

## Research and product decisions

| Evidence | Implication for Eduera |
| --- | --- |
| Fedena exposes paid/unpaid fees and historical fee records to families [1] | Keep invoice, balance and receipt history together, scoped to the selected child. |
| Fedena documents partial/full fee payment [2] | Accept positive partial amounts up to the current balance. Do not infer that one receipt clears an invoice. |
| Fedena distinguishes transaction references and restricts receipt access to finance privileges [3,4] | Capture method/reference; only authorized school reviewers post verified receipts. |
| Razorpay creates orders server-side and distinguishes authorized from captured payments [5] | A browser success screen or parent claim cannot reduce a balance. A future gateway adapter needs durable orders and server verification. |
| Razorpay expects repeated and out-of-order webhooks [6] | Use durable idempotency and invoice-level locking. A future gateway must deduplicate provider events and reconcile missed events. |
| Google Pay requires checking the payment result with the bank/payment provider [7] | Opening an external UPI app is only a handoff. No automatic “paid” state follows. |
| Blueprint separates obligations, receipts, credits, refunds and settlement | Reuse immutable posted records. A fee question and the school's response are not financial adjustments. |

The current release supports direct-to-school payment with manual verification.
It does not introduce a gateway, hold funds, store card details, collect PINs, or
claim that a UPI handoff completed. This fits the existing offline ledger without
inventing merchant credentials or treating unverified claims as money received.

## Parent and student behavior

1. Open **Fees & receipts**, choose a child, and review the invoice reference,
   description, original charge, adjusted amount, received amount, due date,
   balance and refund due. Students retain read-only access.
2. A linked active guardian opens **Review fee & pay**. For an outstanding invoice,
   **Pay / report payment** shows the school's published instructions. If an
   administrator has configured a UPI ID, the handoff includes that payee, amount,
   INR currency and invoice note. Device/app support varies; the UPI ID and
   instructions remain visible for manual payment. Check the recipient in the
   payment app. No external app is opened automatically.
3. Report an already-made payment: amount, method, bank/UTR/counter/cheque reference,
   optional explanatory note, and explicit confirmation that payment was made.
   Cash is reported only after paying the school counter. A cheque is not a receipt
   until the school confirms clearance.
4. Show **Awaiting school review** without reducing the balance. One pending payment
   claim per invoice avoids misleading duplicate submissions across guardians.
   Suppress another payment action while this claim is pending.
5. A separate **Question this fee** request covers missing concessions, incorrect
   charges, duplicate/extra payments or refund questions. It can coexist with a
   payment claim. It neither changes the due date nor freezes/waives the obligation.
6. Show the school response and verified/rejected/answered status in history.
   Rejection allows corrected resubmission. Verified receipts stay in the receipt
   register; the family can print the statement.

## School behavior

- Administrators publish verified payment instructions; revision checks prevent
  silent concurrent overwrites. No dummy destination is installed on Stage.
- Principals and explicitly delegated fee managers review claims. A submitter
  cannot approve their own claim, even if they also hold a staff/admin role.
- Verification requires a response and explicit independent-funds confirmation.
  The server rechecks the current collectible balance and transaction reference.
  It creates the payment and decision in one transaction. Retrying the identical
  decision returns the existing result; a competing decision fails visibly.
- Rejection records the reason without changing the ledger. “Answered” is only
  valid for fee questions and never creates a payment.
- Claim, decision, audit and outbox facts persist; invoice/payment records remain
  append-only. Authorization is rechecked for event delivery and replay after
  guardian links or fee grants change. Events contain identifiers, not fee notes
  or payment references.
- The desktop staff ledger has the same review queue. Family desktop users can
  open the responsive payment workflow. The responsive principal view also owns
  payment-instruction configuration.

## Edge cases and acceptance criteria

| Case | Expected result |
| --- | --- |
| Another family, another school, student write, inactive guardian | Denied; no mutation |
| Double-click or network retry | Identical command returns original request/receipt |
| Same submission key with altered details | Conflict |
| Pending claim from another guardian of the child | No second pending claim of the same type |
| Same bank reference with case/whitespace differences | Reject duplicate claim/approval |
| Another staff member records payment while claim waits | Recompute balance; never over-allocate |
| Event cancellation/credit while claim waits | Recompute balance; preserve event credit/refund rules |
| Two reviewers act together | School transaction lock serializes decisions; one immutable result |
| Invalid fractions, zero, negative, excessive amounts | Reject; integer paise throughout |
| Browser closes after reporting | Request survives; visible in history on return |
| UPI app fails/declines/is unavailable | No ledger mutation; use school instructions |
| Review response disputes a fee | Explanation only; no silent financial correction |

## Boundaries and follow-up release gates

- Gateway checkout/capture, automatic bank reconciliation and automatic refunds
  are **not enabled**. Adding credentials alone does not enable them. A future
  adapter needs order/capture/allocation/settlement state, verified raw-body
  signatures, webhook inbox deduplication, retry/reconciliation jobs, and provider
  sandbox/end-to-end release evidence.
- General non-event credit/concession/refund posting remains outside this slice;
  event credits and refunds continue through their existing workflow. The UI calls
  a fee question **answered**, not financially resolved. Existing invoice
  descriptions are not a normalized multi-line fee structure.
- No new email/SMS reminders, automatic late penalties, attached bank screenshots,
  statutory receipt-number scheme or refund permission policy is introduced.
- Unpaid balances never block attendance, emergency communication or family records.
- UPI destination ownership and real banking behavior need school/provider checks;
  automated tests must never transfer real funds.

## Sources checked

1. Fedena, [family fee details](https://support.fedena.com/support/solutions/articles/211497-how-can-i-view-fee-payment-details-in-a-student-s-profile-).
2. Fedena, [partial/full fee payment](https://support.fedena.com/support/solutions/articles/227082-partial-full-online-payment-in-fees).
3. Fedena, [receipt list and privileges](https://support.fedena.com/support/solutions/articles/211461-about-fee-receipts-list).
4. Fedena, [transaction references](https://support.fedena.com/support/solutions/articles/211460-about-fee-transaction-reference-number).
5. Razorpay, [web integration steps](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).
6. Razorpay, [webhook best practices](https://razorpay.com/docs/webhooks/best-practices).
7. Google Pay, [handle payment response](https://developers.google.com/pay/india/api/web/handle-response).

