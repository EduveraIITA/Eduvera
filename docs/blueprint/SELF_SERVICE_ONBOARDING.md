# Self-service institution onboarding

Status: first end-to-end slice implemented locally, 4 October 2026. This document records
the product decision and implemented contract; it is not Stage deployment evidence.

## Product decision

Eduvera supports two explicit creation models. They are not different labels for the same
workflow and the UI must not imply that an unreviewed coaching workspace is a verified school.

### Model A — Onboard your institution

Audience: schools, colleges, trusts/societies and organised education groups.

1. An authenticated account submits organisation, authority and official registration or
   affiliation details. Aadhaar and other personal identity numbers are explicitly excluded.
2. Submission creates an `institution_onboarding_application`, not a tenant.
3. A current company operator can request information, reject, or approve. Each transition is
   locked, validated and audited. The applicant may resubmit only from `needs_information`.
4. Approval atomically creates the school tenant, updates its regulatory/capability profile,
   creates the applicant's administrator membership, links the application and activates the
   new tenant in the applicant's existing sessions.
5. Company access remains metadata-only and does not grant school-record access.

State machine:

`submitted → needs_information → submitted → approved | rejected`

`submitted → approved | rejected`

Approved and rejected decisions are terminal in this slice. Reopening requires a separately
designed appeal or operator-correction command; direct row editing is not an application feature.

### Model B — Create your coaching workspace

Audience: an independent tutor or small coaching group that may have no formal institution
registration and needs a low-friction operational workspace.

1. An authenticated account enters a workspace name, unique code, timezone, teaching mode and
   whether minors are enrolled.
2. Creation atomically provisions one `coaching` tenant, an administrator membership and a
   coaching regulatory profile with `coaching_core` capability pack.
3. The tenant is permanently labelled `onboarding_model=self_service_coaching` and
   `verification_status=not_required`; the UI says it is not a verified school or college.
4. The active session switches to the new workspace and routes to the existing institution setup.

The initial abuse boundary is one self-service coaching workspace per account. Multiple centres,
ownership transfer and conversion to a verified institution need explicit commands rather than
workarounds around this guard.

## Shared rules

- Account authentication is required before either path. "No verification" for coaching means
  no Eduvera organisation verification; it does not disable account/session protections.
- Tenant codes remain globally unique and lowercase; collisions are rejected at PostgreSQL.
- PostgreSQL also serializes the one-coaching-workspace-per-creator boundary with a partial
  unique index, so concurrent requests cannot bypass the service pre-check.
- The existing `schools` row is the tenancy anchor. Institution type, onboarding model,
  verification state and creator provenance are separate fields so future packs can vary without
  branching every domain by brand name.
- Company review and applicant actions have append-only onboarding audits. Global audit events
  record the security-relevant submission/provisioning boundary.
- Direct Supabase Data API access is not used. The two new tables enable RLS and revoke PUBLIC,
  `anon` and `authenticated`; the owner-backed Nest service remains the command authority.
- Neither workflow automatically creates students, terms, classes, attendance, invoices or
  fabricated compliance evidence.

## Implemented surfaces

- Signup now includes **Institution owner** without granting institution authority by itself.
- `/onboarding/start` presents the two models, existing application status, information-request
  resubmission and the coaching creation form. `/onboarding/pending` redirects to it.
- `/company` includes a verification queue and review decision panel alongside the existing
  company-managed provisioning flow.
- API: `GET /api/v1/onboarding/workspace/`,
  `POST /api/v1/onboarding/institution-applications/`,
  `POST /api/v1/onboarding/coaching-workspaces/`, and
  `POST /api/v1/company/institution-applications/:id/review/`.

## Open acceptance and next slices

- Company verification operating policy: evidence checklist, reviewer SLA, escalation,
  duplicate/legal-name handling and an appeal/correction workflow need company-owner sign-off.
- Account email verification, recovery and privileged MFA remain auth release gates; organisation
  review does not substitute for them.
- Coaching ownership transfer, additional centres, verified conversion, data export/deletion and
  dormant-workspace retention are not yet implemented.
- `coaching_core` and `india_college_core` need their own evidence-backed policy catalogues and
  product acceptance. The current governance catalogue remains India-school-first.
- Notification delivery for application decisions is in-app on refresh in this slice; email/SMS
  delivery and attempts require a separate provider-backed workflow.
- The responsive UI requires user review before release. Stage migration, seed and Railway smoke
  evidence are still outstanding.
