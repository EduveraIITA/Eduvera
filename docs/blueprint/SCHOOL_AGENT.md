# School agent — implementation and release contract

## Product decision (9 October 2026)

The user requested a working, model-independent assistant across principal, staff,
parent and student views, replacing the local dummy chat. It should read authorized
records, propose app actions, and bring the user to the corresponding screen.
This extends blueprint §18's initial read-only phase; it does not remove its
prohibitions on automated collection authorization, physical handover, safeguarding
decisions, biometrics or unexplained attendance reconciliation.

Keep the existing compact reply, full conversation transition, theme and navigation.
Routine reads need no confirmation. Every record-changing command needs a concrete,
immutable preview and an explicit Confirm in the UI. Asking in chat is not approval
of model-invented recipients, dates, amounts or marks. Missing facts must be asked for.

## Architecture

1. Persist owner-, school-, portal- and child-scoped threads and bounded runs in
   PostgreSQL. Poll for progress; this works through the current HTTPS quick tunnel.
2. A provider adapter handles model protocol only. Start with installed Ollama
   `qwen3:8b`; native OpenAI Responses, Anthropic Messages, Gemini generateContent
   and OpenAI-compatible Chat Completions are alternative adapters. No cloud
   credentials or remote fallback by default. Native provider tool-call state and
   opaque reasoning signatures stay within the current run, not the user-visible
   answer or conversation database.
3. A versioned capability catalogue is the only tool boundary. The model cannot
   execute URLs, SQL, shell commands, arbitrary JavaScript or credentials.
4. Execute catalogue reads through the existing authenticated application API,
   including its session, role, relationship and domain guards. School/child scope
   comes from the session and validated thread, never from the model.
5. Writes become expiring proposals, grounded in a preceding read. On confirmation,
   reload authorization and the read snapshot, reject stale proposals, claim the
   command once, and dispatch through the same guarded API. Existing revision and
   business validation still apply. A crash at an ambiguous write boundary requires
   human verification, not blind retry.
6. Evidence and action receipts are server-generated: operation, time, result and
   allowlisted screen. Model-written links or claims are not execution receipts.
7. Keep sensitive physical/safety/security workflows in their normal human UI.
   Unsupported capabilities are disclosed as handoffs, never simulated successes.
8. Revalidate historical sources both before displaying old answers and before
   placing them in model context. Losing record access must not leave conversation
   memory as a back door. A source returning a narrower record set hides the old
   answer conservatively; this can also hide answers when records leave pagination.
9. Rebuild minimal, typed record references from those freshly authorized sources.
   Resolve exact unique names/admission numbers inside the app; do not make users
   provide database UUIDs. Tool selection uses whole words and conversation domain
   context, so attendance "presence" and academic "marks" stay distinct. The
   school timezone owns "today". Routine record revisions are also app-owned:
   34 ID-based commands bind their revision to the exact freshly read target.

### Single-student attendance

`student_attendance` looks up an authorized learner by name, admission number or
known internal reference. Multiple matches require a name/class choice. The
`record_student_attendance` command performs that lookup and binds the class,
student and register revision itself. A follow-up such as "mark his presence
today" can therefore prepare the correct observation without exposing internal
IDs or asking the model to construct a whole-class submission.

The user reviews the learner, class, date, previous/new status and any supplied
reason before Confirm. Only that learner changes; other records and omitted notes
are preserved. An open register stays **draft**, even if all learners are now
marked; a correction to a submitted register preserves its submitted state.
Submitting the whole class is still a separate explicit action. This is a product
clarification for the user's individual-attendance request, not relaxed attendance
authorization: dated roster, staff/cover permissions, instructional-day checks,
revision locks, required correction reasons, idempotency, audits and events share
the existing attendance transaction. Locked registers must be reopened in the app.

Model-invented class filters and correction reasons are rejected/removed; the app
preserves the user's actual reason and leaves existing notes alone unless the user
explicitly supplies or clears a note. The receipt opens the dated register focused
on that student, with Clear search returning to the full roster. This bounded
English-language grounding is not multilingual or arbitrary-language certification.

## Implemented coverage

`backend/src/agent/catalogue.ts` is authoritative. As verified on 9 October, it
contains **137 capabilities: 50 reads, 77 reviewed writes, 10 human handoffs**.
These counts describe the catalogue, not 135 individually certified end-to-end
workflows. Portal visibility, staff grants and the underlying API narrow the tools
offered to each account. A tool is not an independent authorization grant.

| Domain | Reads | Reviewed writes | Human handoffs |
| --- | ---: | ---: | ---: |
| Home overview | 4 | 0 | 0 |
| Attendance | 7 | 3 | 1 |
| Timetable and academic-year planning | 5 | 12 | 0 |
| Diary and homework | 1 | 4 | 0 |
| Learner leave | 2 | 2 | 1 |
| Follow-up conversations | 2 | 1 | 0 |
| Messages and notifications | 4 | 6 | 0 |
| Events | 3 | 7 | 1 |
| Assessments and result registers | 3 | 10 | 0 |
| Report-card schemes and releases | 4 | 9 | 0 |
| Insights | 4 | 0 | 0 |
| Staff leave, cover and responsibilities | 1 | 8 | 1 |
| School and student records | 3 | 5 | 1 |
| Fees and payment reviews | 2 | 5 | 0 |
| Published policies | 1 | 0 | 1 |
| Transport planning and duty requests | 4 | 5 | 1 |
| Safety, account security and files | 0 | 0 | 3 |

Examples include explicit attendance observations, homework completion, diary
notes, class conversations, dated timetable drafts, assessment marks, report-card
comments, fee queries and recurring transport schedules. The agent can record a
payment reported as already received; it cannot transfer money. Planning a ride
does not start it or attest that a child boarded it.

One run can prepare **one** action. Confirm or dismiss it before continuing. Voice,
file upload/printing, bulk imports, account/guardian authority, policy publication,
physical transport observations and safety decisions remain app handoffs. Some
other app operations still need dedicated catalogue entries. This is not literal
complete parity with every UI command or an unattended multi-action executor.

## Provider setup

The defaults work with the already-installed Mac Ollama service and `qwen3:8b`:

```dotenv
AGENT_PROVIDER=ollama
AGENT_MODEL=qwen3:8b
AGENT_BASE_URL=http://127.0.0.1:11434
```

Choose a model supporting the provider's native function/tool-calling protocol.
Protocol compatibility does not establish that every model reasons or follows
instructions reliably. The service does not download models. Keep Ollama running;
the status endpoint checks that the configured local model is installed.

| Provider | `AGENT_PROVIDER` | Default base if `AGENT_BASE_URL` is unset |
| --- | --- | --- |
| Ollama | `ollama` | `http://127.0.0.1:11434` |
| OpenAI Responses | `openai` | `https://api.openai.com/v1` |
| Anthropic Messages | `anthropic` | `https://api.anthropic.com/v1` |
| Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta` |
| OpenAI-compatible server | `openai-compatible` | Set the server's `/v1` endpoint explicitly |

For cloud providers set an explicit `AGENT_MODEL` and server-side `AGENT_API_KEY`.
When switching from an existing Ollama environment, change or unset its base URL
too. A compatible local endpoint can omit the key. Non-loopback endpoints require
HTTPS; embedded URL credentials and redirects are rejected. Do not put provider
keys in the frontend, source control, chat or action previews. Cloud status reports
configuration readiness, not a successful live inference. Before enabling cloud,
approve its data handling and assess the chosen provider/model using synthetic
fixtures; source data sent to it can still contain authorized school records.

These `AGENT_*` settings are separate from the older `AI_PROVIDER`/`OLLAMA_MODEL`
attendance copilot and photo-attendance configuration. No provider fallback occurs.

## Execution, access and operational limits

- Staff need the existing **Use AI assistance** (`ai.use`) grant in addition to
  the permission for each underlying operation. The main demo teacher currently
  lacks it; enabling it is awaiting the user's approval. Do not silently widen
  staff roles because Chat is visible in navigation.
- Threads are scoped by owner, active school, portal and selected child. Persistent
  history returns the latest 20 threads and 50 turns per selected thread. Older
  rows are retained, but older-history pagination and deletion UI are not shipped.
- Every write uses an immutable 10-minute preview, fresh authorization and source
  hash, the original domain validator and API, and a server-generated idempotency
  key. Existing domain revision/audit/event behavior remains authoritative.
  Changed sources fail closed; a user asks for a new preview.
- A confirmed command is claimed atomically. Duplicate confirmation does not
  dispatch again. A crash/network failure with an ambiguous outcome becomes
  **uncertain** and links to the app; it is never blindly replayed. Existing API
  idempotency is used where the domain supports it, not claimed universally.
- A run is bounded to 240 seconds, 10 model turns and 12 tool calls, with at most
  two concurrent runs across the database and one per account; 60 runs/account/hour.
  Expired five-minute worker leases fail closed on retrieval. No job is scheduled
  for later execution by chatting, and pending proposals never auto-execute.
- Model output is capped at 256 KB; model context and result arrays/text are bounded
  and partial data is labelled. Credentials, offline capture tokens, precise GPS
  and sensitive medical/biometric keys are excluded. Authorized snapshots and
  action history are persisted; retention, backup/erasure policy and storage-level
  access hardening must be completed before production.
- The app owns source links, labels, timestamps and receipts. Model content is
  rendered as text with limited emphasis, never executable HTML or clickable
  model-supplied URLs. Receipts link to created/changed records where a supported
  app deep link exists, otherwise the relevant module.

## Extending a workflow

1. Implement and test its authenticated domain API first, including authorization,
   revision/idempotency semantics, audit/events and safe failure handling.
2. Add a strict schema, portal/permission rule, app-owned request and verification
   destination to the capability catalogue. Reuse the domain's exported validator.
3. Add a scoped read that supplies the target IDs and current version. Never let
   the model supply school scope, credentials, arbitrary URLs or evidence binding.
4. Add tests for valid execution, wrong owner/child/permission, changed evidence,
   duplicate approval, uncertain outcomes and the receipt's actual destination.
5. Test a real local model plus the UI. Adding a schema alone is not acceptance.

## Migration and local verification

Migration `055_school_agent.sql` adds four tables: `agent_threads`, `agent_runs`,
`agent_tool_steps` and `agent_actions`. No existing transport or learner records
are reset. Locally, the normal migration command encountered a **pre-existing 033
checksum mismatch**; only additive 055 was applied under an advisory-locked
transaction and its exact checksum recorded. The runtime role `omnischool` received
explicit SELECT/INSERT/UPDATE/DELETE grants on these four tables. Earlier migration
tracking drift was not rewritten. Resolve migration-history drift and perform a
fresh PostgreSQL 17 deployment test before a managed release.

Agent integration tests must target an explicitly isolated database accepted by
`test/test-database.ts`, with current migrations and demo fixtures. Never point
their fixture resets at the development or production database. The local clone
used here is `omnischool_agent_test_20261009`.

Stage release preparation adds **056_school_agent_access.sql**, leaving applied
055 unchanged. It enables RLS, revokes browser/PUBLIC table privileges and adopts
the established application-table owner for agent storage. A dedicated integration
test checks all four tables' ownership, RLS and grants. Fresh PostgreSQL 17
migrations passed locally, including the independently merged teacher-feedback
055. Per-user/non-owner runtime RLS remains a separate architectural release gate.
Use the repository migration runner: its keys are full filenames, not prefixes.

Railway does not inherit the Mac's local Ollama endpoint. App deployment alone
does not make inference available there: configure an approved reachable provider
separately. Never expose the unauthenticated local Ollama service as a workaround.

```sh
# From backend, with DATABASE_URL already set to the isolated test database:
npm test -- --run test/agent.integration.test.ts test/agent-contracts.test.ts test/agent-providers.test.ts
npm run typecheck
npx eslint src/agent test/agent*.ts

# Real installed Ollama model; starts/stops its own isolated API on port 8139.
# By default, proposals are dismissed. This option confirms one test-authored
# single-student observation in the isolated database only:
AGENT_EVAL_CONFIRM=true node --import tsx test/agent-live.eval.ts

# From frontend:
npm test -- --run
npm run typecheck
npm run build
```

## Research informing this implementation

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling):
  the application owns execution; JSON-schema tools are not authorization. Use
  Responses for native OpenAI compatibility, retaining response/tool-call state.
  Keep tool choices coherent and move known identifiers and predictable lookup
  sequences into application code instead of repeatedly asking the model for them.
- [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices):
  test complete multi-turn workflows, ambiguous requests and failure boundaries,
  rather than treating a successful isolated tool call as workflow acceptance.
- [OpenAI guardrails and approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals):
  approvals and checks surround tool execution, independent of model instructions.
- [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling) and
  [Chat API](https://docs.ollama.com/api/chat): native local tool loop, explicit
  non-streaming replies, bounded context and tool results.
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):
  simple composable workflows, bounded loops and well-documented tools before more
  autonomous orchestration.
- [Anthropic tool handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
  and [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling):
  preserve native call/result structures and opaque provider state between steps.

## Verification gates

- Typecheck, lint, provider protocol tests and catalogue/route validation.
- Owner, tenant, child and revoked-permission isolation; no credentials in prompts.
- No mutation before confirmation; replay, stale-state and double-confirm tests.
- Persisted history, cancel/error/restart behavior, source and receipt navigation.
- Real Ollama read plus reviewed write in disposable test data; real browser checks
  of compact/full chat, progress, confirmation and small-screen accessibility.
- Cloud adapters require separate live-provider evaluation before production use.
  A local demonstration is not a measured production SLO or full-model certification.

## Initial baseline — 9 October 2026

- **37 backend tests / 3 files** passed, including **15 real-database integration
  scenarios**. Coverage includes no write before UI approval, CSRF, double confirm,
  stale/expired/rejected previews, owner/portal/child isolation, revoked membership,
  narrower historical sources, unknown tools, message replay, cross-user
  cancellation protection, worker recovery, no replay of an interrupted write,
  full-roster attendance and the staff AI grant. The 10 provider tests are mocked
  protocol tests, not live cloud evaluation.
- Real `qwen3:8b` reads returned recorded student attendance (21.3 seconds) and the
  teacher's actual dated classes (13.2 seconds). A real-model notification proposal
  took 28.9 seconds and changed only after a browser Confirm; its receipt opened
  the notification panel. These are individual local observations, not an SLO.
  Mutation testing used the isolated database, not the user's main ride fixtures.
- WebKit checked all four portals at 320/390/1024px: no horizontal overflow or
  JavaScript errors, full chat hides the bottom navigation, and the composer stays
  in view. Student confirmation/receipt navigation was visually inspected. Teacher
  testing used a test-database-only AI permission exception; the main role remains
  unchanged. Physical-phone keyboard and motion validation remain user acceptance.
- **616 frontend tests / 82 files**, typecheck, targeted lint and production build
  passed. The final copy-only refinement was followed by **18 assistant tests**
  and another successful build. Final public HTTPS WebKit checks loaded all four
  real demo portals at 390px: authorized composers enabled, teacher clearly denied
  by its existing role, no overflow or JavaScript errors. Preview readiness reports
  database/events OK. Additional evidence is in `IMPLEMENTATION_PLAN.md`. Preview:
  **https://procedure-brighton-bush-website.trycloudflare.com** (replaced after
  the later power cut; see the current preview below). Keep this Mac,
  preview services and Ollama running. This temporary tunnel can change hostname
  after restart; polling avoids its lack of SSE support.

## Hardening verification — 9 October 2026

- The reported Aarav lookup succeeded, but the following presence request made
  zero successful reads and no proposal/write. Its admission code was mistaken
  for a UUID. Fresh record references, attendance-specific routing and the new
  single-student command address the underlying multi-turn workflow, not just
  the error wording. Default student lookup now sends only basic identity/class
  fields to the model; richer profile reads remain subject to existing record access.
- **59 backend tests / 3 files** passed: 25 contract tests, 24 isolated real-DB
  integration scenarios and 10 mocked provider-protocol tests. Added coverage
  includes pronoun follow-ups, ambiguous students, school-local dates, correction
  reasons, untouched classmates/notes, draft semantics, locked/stale registers,
  parent denial, generic follow-up source refresh and server-bound revisions.
  **15 selected legacy API/attendance tests** also passed (28 unselected tests
  were skipped, not claimed as verified). Backend typecheck/build/lint passed.
- An initial real-model ambiguity evaluation exposed invented class filters and
  a verb incorrectly included in a student's name. Both were fixed, then the
  actual `qwen3:8b` workflow passed: Aarav lookup → pronoun presence preview,
  ambiguous Sharma → clarification, and a confirmed single-student correction
  in `omnischool_agent_test_20261009`. Main attendance and transport records were
  not changed by testing. Repeatable evaluation is in `test/agent-live.eval.ts`.
  The final rerun also verified the separate correction-reason question → user
  explanation → reviewed write flow. Observed local turns took 12.2–17.3 seconds;
  this small sample is not a latency SLO.
- **618 frontend tests / 82 files** passed. The final fixed-header/composer scroll
  refinement passed **93 focused tests / 6 files**, typecheck, lint and build.
  WebKit tested the real-model attendance preview → Confirm → correct focused
  register → full roster at 320/390/768/1024/1440px without overflow or JavaScript
  errors. The human-readable confirmation clears the fixed header and composer;
  full chat still hides bottom navigation. This is browser emulation, not physical
  phone keyboard/motion acceptance. The frontend engineering guidance preserved
  the established compact theme and emphasized the actual record change.
- Failed tool calls and unverified completion claims now have bounded recovery
  and metadata-only audit events. The completion-claim detector is a conservative
  text check, not a proof of semantic honesty; only a server receipt proves a write.
- After the power cut, the existing preview and Cloudflare jobs were restarted.
  Current preview: **https://verde-too-independent-bargains.trycloudflare.com**.
  Public root and readiness checks returned 200 with database/events healthy;
  installed Ollama is available. The old temporary hostname is no longer current.
  Keep this Mac, preview services and Ollama running. No permanent hostname or
  reboot-persistent service installation is claimed.

This is a working local reviewed-action agent, not production certification.
Remaining release gates include live cloud-model evaluation, adversarial/multilingual
task evaluation, domain-by-domain action acceptance (including nested marks and
report-comment revision workflows not covered by the 34 routine binders),
load/latency and failure drills,
chat retention/deletion and school data-provider approval, fresh-schema/RLS runtime
validation, and physical-device/user sign-off. The implementation/hardening
increments above were local-only; the subsequent Stage release is recorded below.

## Stage release — 9 October 2026

Application **f5c3d7162d7f20162d0ff03acaaf5ae79ddb05f4** is deployed at
**https://omnischool-stage.up.railway.app**. [CI/deploy run 37918047922](https://github.com/EduveraIITA/Eduvera/actions/runs/37918047922)
passed 444 backend and 629 frontend tests, builds/lint/typechecks, fresh PostgreSQL
17 migrations, secret scan and exact-release health checks. Stage successfully
applied 055 agent storage and 056 private-table access protection. Browser checks
verified all four demo portals, five-tab navigation, full-chat navigation hiding
and no overflow/errors at 320/390/1024px. Authorized history reads succeed; the
teacher's existing AI restriction remains unchanged. No full Stage reseed occurred.

**Stage has no reachable model configured.** Its status returns Ollama/qwen3:8b
with `ready:false`; the composer is disabled with an explicit explanation. This
is a verified application/schema deployment, not a live Stage inference claim.
The Mac-backed Cloudflare preview still reports local Ollama ready. Choose an
approved reachable provider before expecting agent replies on Railway. No model
keys or public local-model tunnel were created. Production acceptance remains open.

## Vertex recovery, scoped analytics and verified charts — 9 October 2026

The Railway section above is historical. Stage subsequently moved to Google Cloud
and enabled Vertex; see `deploy/gcp/README.md`. This new increment is **local-only,
not yet pushed or deployed**. It follows blueprint §18 and the user's request to
use established provider tooling and show data charts above the compact composer.

- Gemini/Vertex now uses the official `@google/genai` 2.28.0 SDK and
  `google-auth-library` 11.2.0. Native response parts and thought signatures are
  retained per run, with consecutive function responses grouped correctly.
  `VALIDATED` function calling constrains the model to declared schemas. The SDK's
  automatic tool execution is disabled: application authorization and reviewed
  commands remain the only execution boundary.
- `p-retry` 7.1.0 provides bounded jittered backoff for transient generation
  failures and unusable model responses. SDK retries are disabled so every
  generation attempt gets its own durable reservation. At most three attempts
  per generation, still subject to the existing ten-call/run allowance and
  cancellation. No application write is automatically retried. Blocked content,
  identity/permission failures and permanent request errors fail closed.
- Code-only `agent.model.response_failed` and `agent.run.failed` audit records
  distinguish malformed calls, output limits, refusals, HTTP failures and
  cancellation without storing provider bodies or credentials. The original
  Stage incident reached HTTP 200 but retained no finish reason; its exact
  historic model failure cannot be reconstructed or claimed as proven.
- `GET /schools/:schoolId/analytics/principal/report` provides a strict, bounded,
  principal-only report by learner name/admission number, exact class or school,
  term/30/90 days, attendance/results and subject/class comparisons. Ambiguous
  matches require a choice. Server aggregates preserve denominators, published
  snapshots, missing-data semantics and uncapped totals despite pagination.
  No DOB, guardian contacts, private feedback or arbitrary SQL enters this tool.
- `GET /schools/:schoolId/principal-insights/review` projects one of attendance,
  learning, follow-ups, upcoming coverage/deadlines or aggregate fee ageing from
  the existing authorized repeatable-read model. The response explains its
  period, units and review criteria. It makes no intervention decision and sends
  no communication. Teacher and family callers cannot use principal tools.
- All personas can request charts through their authorized `insights` tool;
  principals also have `principal_analytics`. The model selects an enum preset,
  never chart numbers/code/HTML. The server creates line, bar or complete-partition
  donut data from the actual API result. Missing points remain gaps, subject
  attendance is labelled as a daily-record projection, and truncation is visible.
  Compact chat shows one latest chart (four bars maximum); full chat retains
  all source charts, definitions and accessible data tables. Each chart opens
  its app-owned source, preserving learner, class, period and comparison mode.
  Revoked-source history hides the old answer and chart together.

Local ADC authentication is complete with quota project `eduera-511111`. The
ignored local environment now uses the same approved Vertex model as Stage,
without an API key, paid-account upgrade or GPU. Its separate local ledger allows
$0.25/day and $1/month in conservative reservations, 10 requests/hour and 30/day,
expiring 8 November 2026. Local and Stage allowances are **not** one project-wide
billing cap. Trial credit eligibility depends on the billing account's remaining
credit; its balance is still unverified. Existing local migration drift was not
rewritten: only additive 057 was applied under the migration advisory lock.

Verification: clean PostgreSQL 17 with the CI seed sequence passed all 471 backend
tests; the full frontend suite passed 634, followed by 77 focused tests including
one newly added learner-source test. Both typechecks, full lint and builds passed.
The explicit paid `test/agent-vertex.eval.ts` harness uses disposable synthetic
data, real SDK/ADC, full app authorization and durable budgets. Its final four-turn
run passed greeting, learner attendance bar chart, learner/class/school published
marks comparison and a multi-topic attendance/coverage/follow-up review. The first
run exposed wrong chart selection and an omitted school scope, which informed
clearer tool contracts; a passing sample is not universal model certification.
The eval ledger reserved 162073 micro-USD across 12 calls; local browser chart
verification reserved 26928 across two calls, neither figure is an invoice.

Browser QA verified a real local chart, full conversation, learner source values,
and no page overflow/composer clipping at 320/390/768/1024/1440px. Local and
Cloudflare readiness returned 200. User/physical-device sign-off, Stage deployment
and fresh Stage evaluation are pending. Adversarial/multilingual evaluation,
retention/provider approval and load/latency gates remain open. The dependency
audit still reports pre-existing application/development advisories; this is not
a claim of production readiness or zero AI misuse.

References: [official SDK](https://googleapis.github.io/js-genai/release_docs/classes/client.GoogleGenAI.html),
[function calling](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling),
[thought signatures](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures),
[ADC](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc),
[Google Cloud trial terms](https://docs.cloud.google.com/free/docs/free-cloud-features).

#### Pro preview preference (9 October 2026)

Profile now has a per-user Pro features preview toggle (off by default). This is
not billing or an entitlement. Off means the assistant is limited to scoped
overview/personal-attendance reads, with no agent actions or verified charts;
student attendance Copilot and the optional photo local-AI cross-check are
hidden and denied on direct API access. Existing role, record and school
permissions are still checked when enabled. Disabling Pro masks historical
tool-derived answers and blocks confirming pending actions; rejection remains
available. Future paid plans need a separate server entitlement gate combined
with this preference. Additive migration: `058_user_pro_features.sql`. The
local-only implementation has clean-database backend tests (337 passed, 153
intentional skips) and a 640-test frontend suite. Both production builds and
linters pass. Stage remains unchanged.
