# Razorpay sandbox fee payments

User decision, 9 October 2026: add Razorpay sandbox to the existing family fee flow.
This extends the future gateway boundary in FEE_PAY_REVIEW.md and implements the
capture/evidence requirements of School Operations Blueprint section 17.

## Runtime setup

User override, 9 October 2026: the supplied test credentials are temporary server-side defaults when `DEPLOYMENT_ENVIRONMENT=stage`. Sandbox checkout defaults to enabled in that scope. Environment variables override the defaults; set `RAZORPAY_ENABLED=false` to disable it. Payment sandbox access is independent of demo login access; managed deployments keep `DEMO_MODE=false`.

Optional **server environment overrides** on the existing Eduera Stage service:

- `RAZORPAY_ENABLED=true`
- `RAZORPAY_KEY_ID`: the account's `rzp_test_...` key
- `RAZORPAY_KEY_SECRET`: the paired private test secret
- `DEMO_MODE=false` (required for managed deployments)
- Optional `RAZORPAY_WEBHOOK_SECRET`: an independent randomly generated secret
  shared with the Razorpay dashboard webhook configuration.

The temporary test credentials are in backend configuration only, as explicitly requested. They are not in frontend variables or the example file.
Live keys and the production deployment environment are rejected. Disabled remains the default outside Stage. Apply migration `057_razorpay_sandbox.sql` before starting the updated app.

In Razorpay **Test mode**, enable automatic capture. Configure a webhook for
`payment.captured` and `order.paid` at:
`<Google Cloud Stage service origin>/api/v1/payments/razorpay/webhook/`.
Use the independent webhook secret, not the API secret. Webhooks are optional for
sandbox operation: a bounded background poll runs every minute and the family has
an explicit **Check payment status** recovery button.

## Behavior and limits

- Parent → Fees & receipts → invoice → **Pay with Razorpay**. Existing styling,
  navigation, fee questions and offline reporting remain available.
- Orders use integer paise and the current server balance. The minimum is ₹1.
  Active linked guardians only; students cannot initiate or verify a payment.
- One active provider order per invoice is reused across retries/guardians. A
  different requested amount is rejected until the existing checkout is resolved.
  Changing an amount on an unpaid order is not supported in this first sandbox slice.
- Verify the signature using the stored order ID, then fetch authoritative payment
  details. An authorized payment is not a receipt: only a captured payment matching
  order, amount and currency can be posted.
- Concurrent callbacks/webhooks/polls serialize using the existing school lock and
  invoice row lock. Provider order/payment IDs are unique. Receipts, audit and
  authorized outbox events commit atomically. Browser closure does not lose payment.
- Raw webhook bytes are signature verified. Event IDs and payload hashes deduplicate
  delivery; unknown account orders are ignored. Background checks retain failed orders
  for retry without logging provider responses or credentials.
- Receipts explicitly use `razorpay_test`; they affect the configured non-production ledger.
  Sandbox screens explicitly say no real money is collected.
- If cash/credit/another adjustment changes the balance during checkout, preserve
  the captured payment as `review_required` without over-allocating it. It is visible
  in principal Fees → Reviews. Reconciliation/refund is an operator/provider task;
  no automated refunds or bank settlement claims are made.
- An order created immediately before a network/database failure can be unpaid and
  orphaned at the provider. Only persisted orders are returned to Checkout.
- Credential rotation with pending orders requires operator reconciliation using the
  previous key; the app does not silently switch an existing order to another account.

## Payment status and email receipts (9 October 2026)

Invoice details restore saved payment history and refresh every 30 seconds while
visible. Captured payments link to a guardian-authorized PDF download; the parent
receipt detail also exposes that download. Failed/pending attempts never issue a
receipt. The wallet popup compatibility change uses `same-origin-allow-popups`
when Razorpay is enabled and permits form posts to the exact Razorpay API origin.
The previously deployed headers used `same-origin` and `form-action 'self'`.
This is a compatibility fix; live wallet completion still requires verification.

Apply migration `059_payment_email.sql`. Confirmed capture, review-required,
provider-verified failure and pending confirmation enqueue deduplicated messages
inside their database transaction. A worker checks committed jobs every 15 seconds,
using the existing configured invitation email provider/sender. Sending is enabled
by `INVITATION_EMAIL_ENABLED`; it requires a verified email and an active linked
guardian account for the checkout creator. Old payments are not automatically emailed.
Only allocated captures attach an actual PDF test receipt. The font and license
are packaged with the runtime. All templates and PDFs label test mode explicitly.

Provider acceptance is shown separately from payment status and does not prove
inbox delivery. Ambiguous sends become `unknown`, never silently retried; stale
pending/failed notices are skipped after capture. Receipt downloads remain
available independently of email delivery. Subscribe optional webhooks to
`payment.authorized` and `payment.failed` as well as captured events; polling also
recovers these states. No new SMTP credentials are needed.

### Verification

Focused tests cover exact-byte signature tampering, provider failures, checkout
verification UI, family/tenant authorization, amount validation, reusable orders,
concurrent receipt posting, pending authorization, balance-change reconciliation,
webhook replay, and recovery after missed callbacks. Database tests require the
repository's isolated PostgreSQL test environment and run in the Stage PR workflow.

Actual browser checkout against Razorpay and Stage runtime activation remain release
checks after merge/deployment. Stage sandbox activation does not require new Google Cloud variables. Webhook configuration still requires dashboard access; polling provides recovery without it.
No live payments, settlement or production-readiness claims are made.

Reference: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
