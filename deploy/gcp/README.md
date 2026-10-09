# Google Cloud Stage

Target: `eduera-511111`, Mumbai (`asia-south1`). Reuse the team's Cloud SQL
instance **`eduera-db`** and Artifact Registry **`eduera/web`**. Do not create a
second database. Google Cloud is the verified Stage deployment target. The
old Railway application was retired at the user's request on 9 October. Its
external database, detached upload volume and private migration snapshot were
preserved for recovery; they do not synchronize with Google Cloud. Cloudflare is
retained separately for personal testing, including its local demo access.

## Delivery

`Stage` pushes run the existing isolated PostgreSQL tests, frontend tests, lint,
typechecks, builds and secret scan. The reusable Google Cloud job then builds an
amd64 container on GitHub and pushes its commit tag. Authentication uses OIDC,
not a downloadable service-account key. Trust is restricted to numeric repository
and owner IDs, the Stage ref, the Stage workflow and push/manual events. The
`gcp-stage` GitHub environment only allows the Stage branch.

When `GCP_STAGE_DEPLOY_ENABLED=true` in that environment, the job checks the
existing runtime limits, updates/runs the schema-migration job, deploys a candidate
without production traffic, verifies both applications and the exact release,
then promotes it. A post-promotion failure restores the previous application
revision. It never reverses database migrations or seeds demo data automatically.

The runtime must already have its database secrets, SQL connector, private upload
bucket mount, one-CPU/1-GiB limit, one-instance service cap and continuous CPU for
the background event worker. A missing or unsafe runtime fails closed. CI cannot
create databases, change IAM, expose buckets or upgrade billing.

The migration job must be `eduvera-stage-migrate`, one task, no retries, command
`node dist/database/migrate.js`, using `stage-migrator` and a Secret Manager
reference for `MIGRATION_DATABASE_URL`. The application uses `stage-runtime`.
Cloud SQL connections must point to `eduera-511111:asia-south1:eduera-db`.

## Trial safety

The user authorises using the existing $300 credit, not upgrading to a paid
account, GPUs or Marketplace products. `GCP_TRIAL_DEPLOY_UNTIL` is a reviewed
deployment-window deadline (initially 8 November 2026), **not** proof of the
account's trial expiry and **not** an automatic shutdown or spending cap.
Renew it only after reviewing remaining credit. Budget alerts are not hard caps.
The authenticated account cannot view the linked account's remaining trial credit.
The user confirmed the credit and authorised provisioning. A project-only monthly
**INR 250 early-usage alert** now exists, excluding credits, at 50/80/100 percent.
This deliberately small alert is not a USD 250 budget or a spending limit.
Runtime, storage and network costs continue independently of CI.

## Completed one-time migration (historical)

The one-time migration copied Railway connection URLs, cookie/metrics secrets and
the encryption key into pre-created Google secrets without logging values. Its
temporary secret-write grants are revoked. The bootstrap and Railway deployment
jobs have now been removed from Stage CI; its Railway token and obsolete service
and URL variables are deleted. The remaining pipeline verifies and deploys only
to Google Cloud. Scripts retained in `deploy/` describe historical recovery work,
not an enabled deployment path.

Database copying, attachment inventory/copy, and consistency verification are
separate from the recurring release. Retain the existing encryption key when
copying encrypted records. Never overwrite the team's database or existing
schemas without checking them. Record snapshot time and any source-write gap;
an initial copy is not proof that two live databases remain synchronized.

## Current state

- App: https://eduvera-stage-367469594690.asia-south1.run.app (private Stage accounts).
- The team's `eduera-db` now contains an initial, verified point-in-time copy of
  all 183 public application tables, 200 students and 64 migration records. All
  table row counts matched the exported consistent snapshot. No stored attachment
  rows existed. The source was not modified or continuously replicated.
- The initial database backup completed successfully (`1791548387012`). Database
  deletion protection and encrypted-only connections are enabled. Connections
  use the Cloud SQL connector, not a public IP allowlist.
- Private GCS upload storage passed create/exclusive-write/rename/read checks.
  The temporary probe files were removed, and its one-off job was deleted.
- Principal, teacher, parent and student WebKit checks passed private login,
  navigation, 320/390/1024px overflow checks and no page/server errors. Vertex
  Gemini is now enabled and verified across all four portals under the controls
  below. No GPU or paid billing upgrade was provisioned.
- `GCP_STAGE_DEPLOY_ENABLED=true` and `STAGE_DEPLOY_TARGET=google-cloud` are set.
  Railway is retired, not a second deployment target. The initial
  [push-triggered run 37930186905](https://github.com/EduveraIITA/Eduvera/actions/runs/37930186905)
  passed all checks, migrated, verified a candidate and promoted release
  `41c9aa537701a39fcd4ba635c0387b9468760578` to revision `eduvera-stage-00002-wik`.
  Independent public-release/readiness and four-portal WebKit checks passed on that
  release. Railway deployment was skipped. Normal pushes do not copy data or run
  demo seeds. A later documentation-only `[skip ci]` commit is not a new app release.
- The empty duplicate Cloud SQL instance `eduvera-stage` was **deleted**, with
  operation completion verified, at the user's request. `eduera-db` is preserved.
- The unused empty `eduvera-stage` image repository was also removed; images use
  the team's `eduera/web` repository. Temporary source-connection secret versions
  are disabled and the local migration proxy is stopped. The original source
  credentials and private migration snapshot remain recoverable for rollback.

References: [Google GitHub authentication](https://github.com/google-github-actions/auth),
[Cloud Run runtime contract](https://docs.cloud.google.com/run/docs/container-contract),
[trial restrictions](https://docs.cloud.google.com/free/docs/free-cloud-features),
[budget limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets).

## Private accounts and cloud AI hardening (9 October)

Public demo authentication is now disabled on Cloud Run. The four existing review
accounts are preserved with separate random passwords, delivered privately outside
Git. Other known shared-demo password hashes and existing sessions were retired;
this does not delete school records. Managed deployments now refuse `DEMO_MODE=true`.
Both web login pages remove demo shortcuts. SMTP delivery is disabled: the former
embedded mail credential was removed from configuration, but its owner must revoke
that old app password at the mail provider; removing source is not revocation.

The Vertex adapter uses the runtime's short-lived Google service identity, no
exported key, and only `gemini-3.1-flash-lite`. The API and minimal invocation role
are provisioned; synthetic connectivity and native tool round-trip probes passed.
The application release and all four portal evaluations are verified below.

Reviewed standard pricing: $0.25 / million input tokens and $1.50 / million output
tokens. The model's global endpoint is outside a guaranteed India-only processing
boundary; the application/database remain in Mumbai. No grounding, code execution,
GPU, provisioned throughput or automatic provider fallback is enabled.

Required Cloud Run variables when enabling:
`AGENT_PROVIDER=vertex`, `AGENT_MODEL=gemini-3.1-flash-lite`,
`AGENT_GOOGLE_PROJECT=eduera-511111`, `AGENT_GOOGLE_LOCATION=global`,
`AGENT_ENABLED=true`, `AGENT_ENABLED_UNTIL=2026-11-08T00:00:00Z`,
`AGENT_USER_HOURLY_LIMIT=10`, `AGENT_USER_DAILY_LIMIT=30`,
`AGENT_DAILY_BUDGET_MICROS=500000`, `AGENT_MONTHLY_BUDGET_MICROS=5000000`.
Remove `AGENT_API_KEY` and `AGENT_BASE_URL`. `AGENT_ENABLED=false` stops new inference.
Existing previews still require explicit confirmation and fresh authorization.

Local testing now uses this same Vertex model/project with Application Default
Credentials, not the Gemini Developer API. Authenticate with
`gcloud auth application-default login` and set its quota project with
`gcloud auth application-default set-quota-project eduera-511111`. Never copy ADC
credentials into the repository, browser or Cloud Run; Cloud Run retains its
attached service identity. The local ignored `.env` uses $0.25/day and $1/month
reservations in its own database, with the same account limits and review expiry.
Those allowances are separate from Stage, not a combined billing-project limit.
Migration 057 must exist before local paid inference can proceed.

The pending local agent increment uses Google's official JS SDK with automatic
function execution and hidden retries disabled. App-controlled `p-retry` reserves
every generation attempt, preserves Gemini thought signatures and never replays
a school write. See `docs/blueprint/SCHOOL_AGENT.md` for its verified scope and
the opt-in, paid synthetic evaluation. This paragraph is not a Stage deployment
claim; the deployed release below remains the previously verified application.

Migration 057 adds a private durable reservation ledger. Every generation first
counts input tokens then reserves a conservative upper estimate ($1/M input with
10%/512-token overhead, $5/M maximum output). Reservations are never refunded on
timeout/error, so failed calls cannot evade the limit. The shared app allowance is
$0.50/day and $5/month, counted in UTC; these are conservative reservations, **not
Google billing caps or the total hosting budget**. At most 24k input / 2048 output
tokens, 10 calls/run, two concurrent runs and one/user. Account limits span threads
and survive restarts. Database failure blocks paid generation.

Cloud trial credit can apply to eligible Vertex Google models; the separate AI
Studio/Gemini Developer API is excluded. The remaining credit/actual billing
allocation is not visible to this login. Review billing before the expiry above.

Sources: [trial eligibility](https://docs.cloud.google.com/free/docs/free-cloud-features),
[Gemini API billing exclusion](https://ai.google.dev/gemini-api/docs/billing),
[Flash-Lite model](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite),
[standard pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).

## Verified release and retirement

- [Release run 37935688102](https://github.com/EduveraIITA/Eduvera/actions/runs/37935688102)
  passed 457 backend tests, 630 frontend tests, typechecks, lint, both builds,
  secret scan, migration and candidate/public checks. App release is
  `26dc964d192def75494e8fcbefba51fd6fb16853`; subsequent retirement/docs changes
  are not new application releases. Live Vertex configuration is revision
  `eduvera-stage-00005-2b6`, with 100% traffic and runtime cost guards verified.
- Real authenticated reads completed with source links in principal, teacher,
  parent and student views. Principal lookup → pronoun attendance preview produced
  the correct learner and verification screen; explicitly rejected, never saved.
  Nine model calls reserved **109117 micro-USD ($0.109117)** in the durable ledger;
  this conservative reservation is not an invoice. Model writes still require
  human confirmation and fresh domain authorization.
- Teacher review access is an audited `ai.use` exception through 8 November,
  scoped to existing assigned resources. Other permissions are unchanged.
- [Railway removal 37936914773](https://github.com/EduveraIITA/Eduvera/actions/runs/37936914773)
  deleted only `omnischool` service `bfce4d21-5994-4612-8c7b-8cd28681f7e5` in
  Stage environment `a7f0178b-a47d-4782-b26a-236046512c00`, project
  `e502f870-10b0-4e13-b42e-124e6373a277`. Its old public URL now returns 404.
  [Read-only follow-up 37937246349](https://github.com/EduveraIITA/Eduvera/actions/runs/37937246349)
  confirmed an empty service inventory and retained volume metadata. No database,
  volume or recovery snapshot was deleted. The application deployment itself cannot
  be undeleted; recovery requires recreating the service from preserved configuration.
- Cloudflare personal preview and native backend readiness both remain healthy.
  Their data/passwords remain separate from the four private Google Cloud accounts.
  Historical SMTP credential revocation at its provider is still an owner action.
