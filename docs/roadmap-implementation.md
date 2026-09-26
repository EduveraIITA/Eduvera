# Eduera roadmap implementation

## Release 1: administration and offline collection foundation

Implemented in this release:

- Isolated PostgreSQL CI service, migrations and seeded fixtures. CI no longer reads or mutates the Railway/Supabase database.
- Session school selection for legacy school screens, explicit school-scoped administration and fee APIs, and active-session review/revocation.
- School provisioning by an existing administrator; term, class and subject creation/editing.
- Student creation/editing with enrollment; guardian creation/linking; enrollment in later terms.
- Validated CSV imports with preview and atomic confirmation (maximum 200 students).
- Class promotion preview/confirmation preserving historical enrollments.
- Expiring, revocable, hashed, single-use invitations. Codes are manually shared; no email delivery claim.
- Delegated `sis.manage` and `fees.manage` permissions for staff; last-administrator protection; school membership activation/deactivation.
- Transactional administration audit records.
- Immutable INR invoices and offline payment records, partial payments, retry idempotency, overpayment checks and parent/student-scoped statements.
- Responsive console screens under `/staff/administration`, `/staff/fees`, `/staff/security` and `/staff/join`. Mobile account menu links to these screens.
- The intentional class attendance leaderboard is unchanged.

## First-use sequence

1. Sign in as an existing school administrator; open **School administration** from the mobile account menu or desktop navigation.
2. Optionally provision a new school. Select the school using the desktop school selector.
3. Create a term and classes with exactly matching academic-year labels, then subjects.
4. Add students and their enrollments, or validate and confirm a CSV import.
5. Link guardians. Existing accounts belonging elsewhere must first accept a guardian invitation for this school.
6. Issue invitations and privately share the code and `/staff/join` URL. Accounts created through the SIS have no usable initial password.
7. Open Fees, post an invoice, then record only received/cleared offline payments. Invoice/receipt references must be unique. Print the statement through the browser.

Posted financial records cannot be edited or deleted. This initial ledger is suitable for controlled pilot testing, not a full accounting or payment-processing replacement. Refunds and corrections require a subsequent credit-note/refund implementation; do not use real-money collection operations until that workflow and operating controls are approved.

## Tests

Run backend typecheck, lint and build. Unit validation: `npx vitest run test/operations.unit.test.ts`.

Integration tests require a fresh disposable PostgreSQL database with migrations and fixtures. Set `TEST_DATABASE_ISOLATED=true` for the operations integration suite. Never point it at production/staging: tests intentionally create immutable financial records and leave them until the disposable database is removed. GitHub Stage CI supplies this automatically.

## Still required from the original roadmap

This release is **not the complete 28-week roadmap**.

### Hardening

- Rotate the previously exposed database credential through the database provider; confirm removal/history remediation separately. This release neither reads nor uses `secret.txt`.
- Class-scoped permissions across legacy attendance/chat/safeguarding and restricted medical views. New SIS/fees permissions do not replace every pre-existing broad staff check.
- Consistent active-school semantics in chat/AI/notification endpoints; the current chat context remains conversation scoped.
- Email verification, password recovery and staff MFA, plus outbound mail provider configuration.
- Durable object storage, signed downloads, content validation, malware scanning and retention policy.
- Branch protection and security scanning; demo clock/reset strategy; complete product rename.

### Administration

- First-operator bootstrap remains a deployment task. Self-service school signup is not enabled.
- Larger background imports, richer error downloads, school onboarding checklist, archival workflows and configurable academic policies.
- Edit/deactivate guardian links and explicit reallocation of existing same-term enrollments.

### Fees

- Fee heads/plans, installment generation, opening balances, concession approval, immutable credit notes/refunds, numbered standalone receipts and ageing/export reports.
- Approved payment provider, school merchant onboarding, signed webhooks, settlement reconciliation and refund handling. Online payments are explicitly disabled.
- Reminder policies and outbound delivery preferences.

### Later product phases

- Assessments, marks entry, gradebook and configurable report cards.
- Teacher assignment authoring, submissions, grading and feedback.
- Cross-module Action Centre and outbound notifications.
- Admissions CRM, then transport/library/inventory/HR integrations as validated by pilots.

## Deployment

`Stage` pushes run isolated verification before Railway deployment. The existing container entrypoint applies pending migrations. Migration 007 is additive and does not remove school records. External provider credentials are never committed. A successful Git push is not, by itself, confirmation that Railway has deployed the commit.
