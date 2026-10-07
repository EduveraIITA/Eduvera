# Institution activation and first-day readiness

Status: locally implemented, 5 October 2026. This workflow is a release boundary for a newly
created institution; it is not a regulator verification, accreditation decision or claim that an
institution is operationally ready outside the records checked by the product.

## Product contract

Both onboarding lanes converge on the same activation workflow:

- A formal school, college or hybrid institution receives a workspace only after company review.
- A tutor or small coaching operator can create an explicitly unverified coaching workspace
  immediately after verifying the owner account.
- Neither lane grants an active operating workspace merely because the tenant row exists. A current
  administrator must create real operating records, review the computed result and activate it.

Capability packs keep the architecture configurable. `india_school_core`, `india_college_core`
and `coaching_core` define institution language, starter subjects and whether a separate staff
member is required. Readiness requirements are data, not conditionals distributed through the UI.

## State machine

`draft → ready → active`

- `draft`: one or more required checks are incomplete, or no successful review has occurred.
- `ready`: a review transaction recalculated every current requirement and all required checks passed.
- `active`: an administrator submitted the reviewed revision; the activation transaction locked the
  state and recalculated readiness before publishing.

Any activation update increments a database revision. A stale activation command conflicts rather
than publishing an older checklist. Later operating changes use ordinary administration modules;
this slice does not automatically deactivate a live institution.

## Account trust

New account owners must verify their email before either onboarding lane. Privileged activation also
requires authenticator-based TOTP MFA. Secrets are AES-256-GCM encrypted with a purpose-derived key;
codes accept a one-step clock window and reject replay. Eight hashed, single-use recovery codes are
shown once. Password-reset tokens are hashed, single-use and expire after 30 minutes; a successful
reset revokes all existing sessions and pending MFA login challenges. Requests for unknown email
addresses return the same public response.

Existing accounts were marked email-verified during migration to avoid retroactively breaking valid
invited and demo users. Existing operational institutions were backfilled as active only when the
legacy term, class, subject, enrolment and timetable foundation exists. This compatibility backfill
does not claim that the newly introduced owner-MFA check had historically been completed.

## Readiness evidence

The API derives checks from current records each time. There are no user-controlled completion boxes.
Required checks cover owner email, owner MFA, institution profile/capability pack, fallback contact,
active term, class/batch/cohort, subject/course, active-term attendance policy, staff where required,
active learner enrolment and a baseline timetable period.

For an empty workspace, Quick start writes one transaction containing the term, teaching group,
subjects, attendance policy, fallback contact and first-period timetable. It is rejected once any
term, cohort or subject exists, so it cannot overwrite a partly configured institution. Learners and
required staff continue through the existing reviewed people/invitation workflows.

Every quick start, review and activation writes workflow history plus the global operations audit.
Activation also writes an `InstitutionActivated` outbox fact for the activating administrator. New
tables have RLS enabled and direct PUBLIC, `anon` and `authenticated` table grants revoked; access is
through the application permission and active admin membership checks.

## User experience

Principal **More → Institution setup** opens the mobile-first readiness workspace. It shows the
capability pack, progress from computed records, deep links to the existing module responsible for
each gap, optional versus required checks, review/activate actions and read-only history. New principal
sessions with an incomplete activation state land here. Account security is a separate authenticated
screen used by onboarding and by readiness links; password recovery remains public and enumeration-safe.

## Verified scope and remaining gates

Migration 040 applies from scratch on PostgreSQL 17. The PostgreSQL-backed integration covers email
verification, the unverified-onboarding rejection, coaching creation, transactional quick start,
authenticator enrollment, recovery-code login, real learner enrolment, review, optimistic activation,
audit/outbox evidence, password reset and session revocation. The complete backend and frontend suites,
lint, type checking and production builds pass locally. The local development database is migrated and
the running `/readyz` plus authenticated activation API are healthy.

Still required before a production claim: user acceptance of the mobile UI, live mailbox verification,
recovery support ownership, clock-skew/device-loss rehearsal, Stage migration/deployment/smoke evidence,
and institution-specific legal/operational sign-off. TOTP factor replacement/disable and ownership
transfer are intentionally not included and need separate recovery policy and step-up authorization.
