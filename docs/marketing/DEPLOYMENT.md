# Public website operations

The public marketing website is separate from the authenticated Digital Twin
application. Its sales enquiry is not campus onboarding. This runbook preserves
website-only release/capture rules; it is not evidence that a current Digital Twin
release is deployed to Stage or that any external service is healthy today.

## Source and checks

`marketing/` contains React/TypeScript/Vite pages, prerendering and a small Node
HTTP service. From that directory:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

Inject `DATABASE_URL` and independent `FORM_SECRET` through private server
configuration. Apply the owning backend migration before starting enquiry storage.
`LOGIN_URL` must be a reviewed exact HTTPS login destination, not a guessed
hostname; `ALLOWED_ORIGINS` is an exact POST allowlist. Do not change app traffic,
cookies, accounts or permissions as part of a website update.

## Presentation and capture

The latest recorded owner decision restores the walkthrough-based video
presentation with the original spring ribbon, elastic grid and orbital backgrounds.
The later particle/cropped-screen composition was rejected; do not reintroduce it
without a new decision. Retain the approved logo, protected original gallery/style
bytes and the existing enquiry/legal/Login destinations. Do not invent testimonials,
customer metrics, compliance or payment-readiness claims.

Videos and screenshots show the local synthetic Cambridge fixture, not live
customer records or current Digital Twin acceptance. Historical timetable/payment
previews retain their original Experimental/sandbox disclosures. Existing media is
historical evidence; never retouch record values or present old captures as current.

`marketing/capture-motion.mjs` reproduces the attendance, timetable and family
recordings. With the compatible synthetic app on localhost:8000, marketing
dependencies, Playwright Chromium and ffmpeg installed:

```sh
node capture-motion.mjs
# Optional exact scene: attendance, timetable or family
node capture-motion.mjs attendance
```

`CAPTURE_ORIGIN` accepts localhost/127.0.0.1 only.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may select installed Chromium. Capture
bootstraps a synthetic demo session, then blocks non-read campus API requests and
fails on API/JavaScript errors. For the missing historical development portrait,
it serves the exact repository synthetic image without modifying any record.
Raw output belongs under ignored `marketing/screenshots/`; current clips/posters
are in `public/demos/`. The scripts' historical route/selectors may need deliberate
migration before recapture against a newer application; this cleanup did not
recapture media or prove those old flows still work.

Static capture uses `capture-product.mjs` then `encode-screens.mjs`.
`capture-story.mjs` and retained region manifests describe the rejected historical
experiment, not the active presentation. Review real pixels, asset identity and
labels after any intentional recapture. Playback must respect reduced motion/data
saving, stop offscreen/in hidden tabs and offer pause/native controls.

## Enquiry and security

The owning database migration creates separate enquiry, rate-bucket and notification
outbox records. Server validation covers length/type/email/phone/consent, honeypot,
minimum fill time, exact Origin and signed double-submit CSRF. Persistent network
rate buckets store no raw IP; identical enquiries are idempotent. Enquiries older
than 12 months and expired buckets use the owning cleanup policy.

A saved enquiry and notification job commit together. Company operators review the
protected Demo enquiries queue; campus admins gain no access merely by being admins.
Status updates are CSRF-protected and audited. Configure the real sales inbox as
`MARKETING_NOTIFY_TO` on the application service using its approved mail transport.
Email carries a reference/protected link, not form PII. Provider acceptance is not
delivery; unknown outcomes are not blindly replayed. Storage succeeds independently
of mail, and real inbox delivery requires its own verification.

Production enquiries require a table-limited database identity and separate
service account review. No database/provider secret reaches the browser. Analytics
are off by default; an approved provider may consume allowlisted
`thatcampus:analytics` events without form values. Review consent/privacy/CSP before
enabling any external tracker. Footer policies still require business/legal review.

## Release gates

The retained Stage workflow is a separate deployment boundary:
`.github/workflows/thatcampus.yml` verifies the website;
`google-cloud-stage.yml` owns promotion. Website-only releases use the bounded
`[website-only]` path guard, not a full application release. Do not execute Stage
deployment or Git operations from this checkout without explicit authorization.

The configured website target is `thatcampus-web`, project `eduera-511111`,
region `asia-south1`. Release tooling uses existing OIDC trust; secrets go through
Secret Manager, never arguments or source. `marketing/deploy.mjs` can require an
administrator to provision `thatcampus-form-secret` and scoped accessor/deployer
permissions. Do not grant broad project owner/editor access to bypass a refusal.

Before promotion, require the intended immutable release ID, a no-traffic candidate,
ready database/form configuration, original media hashes, HTTPS routes, responsive
Light/Dark/reduced-motion checks, navigation/Login, keyboard/modal behavior and
isolated enquiry/outbox persistence. After promotion, verify the literal returned
public URL and hashes; failure restores the previous website revision, not database
history. Existing app specification/traffic must remain unchanged. Never send a
synthetic lead to a production inbox just to prove deployment.

Cloudflare keeps marketing and application hosts separate; see
[edge routing](../../deploy/cloudflare/README.md). DNS/HTTPS changes require exact
provider-supplied ownership/mapping records, reviewed authority and preservation of
unrelated MX/TXT records. Do not infer a working domain from an expected hostname.
Historical release/test totals are archived; [current verification](../VERIFICATION.md)
separates source, local preview, hosted delivery and owner/device acceptance.
