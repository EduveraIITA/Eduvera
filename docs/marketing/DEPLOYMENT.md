# ThatCampus marketing service

The explicit 14 October 2026 brief is the authority for this marketing increment.
The blueprint's institution onboarding pipeline remains distinct from sales enquiries.
No login, cookie, role, authenticated dashboard route or app origin is replaced.

## Source and local checks

`marketing/` is a separate React + TypeScript + Vite site, prerendered for search
engines. A small Node HTTP service serves it and handles the same-origin form.
The original transparent Eduera logo is reused. No student images or credentials
are included. Constructed product previews are explicitly labelled sample data.
The footer policies describe this marketing service; obtain business/legal review
before treating them as an institution subscription agreement.

```sh
cd marketing
npm ci
npm run typecheck
npm run lint
npm test
npm run build
# Inject DATABASE_URL and FORM_SECRET through your development secret manager.
# Apply backend migration 094 with the normal migration runner first.
npm start
```

`LOGIN_URL` is a runtime environment variable; default is the verified-designated
Stage `/login` route. Only an exact HTTPS URL ending in `/login` is accepted.
Do not change it to app.thatcampus.com until the production application is verified.
`ALLOWED_ORIGINS` is an exact comma-separated allowlist for POST requests.
`FORM_SECRET` is independent of application session/cookie keys.

## Enquiry storage, notification and review

Migration `094_marketing_enquiries.sql` creates separate enquiries, rate buckets
and notification outbox tables. The ordinary Stage migrator applies it. The website
uses the server-side Secret Manager database reference; no database key reaches the
browser. The initial separate Cloud Run service reuses the existing Stage runtime
identity and Cloud SQL connection. For production, provision a table-limited DB role
and separate service account before placing production enquiries alongside live
institution records. Do not add anonymous/public RLS policies to these tables.

A transaction persists the enquiry and one notification job. The form validates
server-side length/type/range/email/phone/consent, a honeypot, a two-second minimum
fill time, exact Origin and signed double-submit CSRF. Hourly network buckets live
in PostgreSQL, so restarts cannot reset limits. Raw IP addresses are not stored.
Identical enquiries are idempotent; all text is rendered through React escaping.
Expired buckets are deleted; enquiries older than 12 months are purged by the
backend worker. Configure operational logs with an appropriate retention policy.

Company operators sign in normally and open `/company` → **Demo enquiries**.
School admins and other non-company accounts cannot read or change this queue.
Review status changes are CSRF-protected and audited.

Set `MARKETING_NOTIFY_TO` on the **existing application service** to the actual sales
inbox, and use its existing configured SMTP/Resend settings with
`INVITATION_EMAIL_ENABLED=true`. No recipient is invented. The backend worker polls
at 30-second intervals on the existing continuously allocated CPU service. Email
contains an enquiry reference and protected-console link, not form PII. Provider
acceptance is recorded as accepted; crashes/timeouts become unknown and are not
blindly retried. Queued/unknown notifications remain visible in the review queue.
The enquiry succeeds independently of mail acceptance. Notification delivery cannot
be called verified until a real inbox is configured and a delivery is observed.

## Automatic Cloud Run delivery

`.github/workflows/thatcampus.yml` runs type checks, lint, build, Node HTTP tests,
real PostgreSQL form storage and Chromium checks at 1440, 768 and 360 pixels.
Viewport screenshots and the saved-enquiry state are uploaded as a CI artifact.
The existing trusted `.github/workflows/google-cloud-stage.yml` release deploys
the separate **thatcampus-web** service in `eduera-511111`, `asia-south1` only after
its normal Stage application migration and verification succeed. It reuses the
existing `gcp-stage` OIDC workflow identity, without widening workload trust to a
new workflow. The standalone website workflow verifies pull requests; publication
is owned by the existing release workflow.
No workflow or script changes registrar DNS or app traffic.

The deploy script creates an independent Secret Manager `thatcampus-form-secret`
if the deploy identity is permitted; the random value goes through stdin, never
logs/arguments/source. Otherwise a project administrator must run:

```sh
openssl rand -base64 48 | gcloud secrets create thatcampus-form-secret \
  --project=eduera-511111 --replication-policy=automatic --data-file=-
gcloud secrets add-iam-policy-binding thatcampus-form-secret \
  --project=eduera-511111 \
  --member=serviceAccount:stage-runtime@eduera-511111.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

If the secret already exists, grant the accessor policy without recreating it.
The GitHub deploy identity also needs Cloud Run deployment/create/IAM access for
thatcampus-web, artifact upload, serviceAccountUser on stage-runtime and metadata
access to the existing service. Do not grant broad owner/editor permissions.
If an org policy prevents public Run services, use the approved public load balancer
and keep the backend protected rather than weakening the organization policy.

The deployment probes a tagged candidate and database table before promotion,
retains existing marketing traffic until verified, rolls back an unsuccessful
promotion and checks the existing app login's HTTP availability. On first deployment
the new Run URL exists before candidate verification; do not point DNS at it until
verification passes. Default capacity is one CPU, 256 MiB, min zero, max one.
The expected standard URL is not evidence of deployment; use the literal URL
returned by Cloud Run and the workflow summary. Set its exact origin in the
allowlist if Cloud Run returns a different standard origin.

## Domain / HTTPS — no speculative DNS records

1. Open Google Cloud → Cloud Run → thatcampus-web. Confirm the temporary URL,
   `/readyz`, enquiries, Login destination and existing application are healthy.
2. In the supported Google domain mapping or external HTTPS load balancer flow,
   verify ownership of **thatcampus.com**. Use the exact ownership TXT record
   returned by Google in the authoritative DNS provider. One Cloudflare nameserver
   alone does not establish the full nameserver pair or DNS ownership.
3. Cloud Run managed custom-domain mapping availability varies by region. If
   asia-south1 is unsupported for direct mapping, put the service behind a global
   external Application Load Balancer with a serverless NEG and Google-managed
   certificate for thatcampus.com and www.thatcampus.com. Reserve its IP first.
4. Only after Google supplies the mapping records or the reserved load-balancer IP,
   add the exact A/AAAA/CNAME records returned. Preserve MX/TXT and unrelated records.
   Do not guess IPs, copy arbitrary Run CNAMEs or replace nameservers without the
   complete assigned pair. Wait for certificate ACTIVE and DNS propagation.
5. Map both names to the website frontend. The service sends a permanent 308 from
   www.thatcampus.com to https://thatcampus.com while preserving path/query.
   If a load balancer rewrites Host, implement the same redirect at its URL map.
6. Verify apex/www HTTPS and redirect, legal routes, form, sample-data labels and
   existing app login again. app.thatcampus.com remains reserved for a separately
   verified production app deployment; do not map it to Stage or change Login yet.

The custom domain requires Google account/domain ownership and authoritative DNS
write access. Neither an expected URL nor a prepared script proves a live domain.

## Optional analytics

Analytics are disabled by default and no external tracker is loaded. An approved
provider can subscribe to the `thatcampus:analytics` window event (allowlisted
`login_clicked` and `demo_enquiry_saved`, with no form data) through
`marketing/src/main.tsx`; obtain the required consent,
update the privacy notice and explicitly allow its script/connect origins in CSP.
Do not include form values, email, phone or student data in analytics events.
