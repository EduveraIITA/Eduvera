# School agent — implementation and release contract

## Product decision (9 October 2026)

The user requested a working, model-independent assistant across principal, staff,
parent and student views, replacing the local dummy chat. It should read authorized
records, propose app actions, and bring the user to the corresponding screen.
This extends blueprint §18's initial read-only phase; it does not remove its
prohibitions on automated collection authorization, physical handover, safeguarding
decisions, biometrics or unexplained attendance reconciliation.

Keep the existing compact reply, full conversation transition, theme and navigation.
The effect contract, rather than a blanket restriction, owns intervention: reads are
autonomous; explicitly classified reversible, low-impact effects execute once after
fresh validation and return a monitored receipt; consequential effects use a concrete,
immutable review and explicit Confirm; physical, safety, authority and security
decisions stay human-only. Asking in chat is never permission to invent recipients,
dates, amounts, observations or marks. Natural conversation supplies the goal—there
are no special retry phrases or UI copy masquerading as agent instructions.

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
5. Every effect is classified in one machine-readable contract used by model tool
   descriptions, server execution, stored policy evidence, receipts and UI. A
   monitored low-impact effect is grounded in a preceding read, refreshes access and
   the source, executes at most once and returns a receipt. A consequential effect
   becomes an expiring review; confirmation repeats those checks before dispatch.
   Existing revision and business validation still apply. A crash at an ambiguous
   write boundary requires human verification, not blind retry.
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
10. Compose prompts in independently testable layers: stable operating policy,
    current authorization/time scope, relevant domain skill, concise response style,
    permission-scoped tool schemas and untrusted tool data. Human-facing titles and
    outcome summaries are separate fields, so safety instructions cannot leak into
    an approval heading.
11. Treat the PostgreSQL thread as durable state. Preserve recent natural user turns
    verbatim. Once estimated conversation use exceeds 30% of the configured model
    context, the configured LLM summarizes the oldest chunk into goals, preferences,
    corrections, open questions and receipt-level outcomes. The summary excludes
    record facts, identifiers and tool arguments and can never authorize an action;
    current facts are re-read through the normal APIs.

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
contains **137 capabilities: 50 autonomous reads, 2 monitored low-impact effects,
75 reviewed consequential effects and 10 human handoffs**.
These counts describe the catalogue, not 135 individually certified end-to-end
workflows. Portal visibility, staff grants and the underlying API narrow the tools
offered to each account. A tool is not an independent authorization grant.

| Domain | Autonomous reads | Monitored effects | Reviewed effects | Human handoffs |
| --- | ---: | ---: | ---: | ---: |
| Home overview | 4 | 0 | 0 | 0 |
| Attendance | 7 | 0 | 3 | 1 |
| Timetable and academic-year planning | 5 | 0 | 12 | 0 |
| Diary and homework | 1 | 2 | 2 | 0 |
| Learner leave | 2 | 0 | 2 | 1 |
| Follow-up conversations | 2 | 0 | 1 | 0 |
| Messages and notifications | 4 | 0 | 6 | 0 |
| Events | 3 | 0 | 7 | 1 |
| Assessments and result registers | 3 | 0 | 10 | 0 |
| Report-card schemes and releases | 4 | 0 | 9 | 0 |
| Insights | 4 | 0 | 0 | 0 |
| Staff leave, cover and responsibilities | 1 | 0 | 8 | 1 |
| School and student records | 3 | 0 | 5 | 1 |
| Fees and payment reviews | 2 | 0 | 5 | 0 |
| Published policies | 1 | 0 | 0 | 1 |
| Transport planning and duty requests | 4 | 0 | 5 | 1 |
| Safety, account security and files | 0 | 0 | 0 | 3 |

Examples include explicit attendance observations, homework completion, diary
notes, class conversations, dated timetable drafts, assessment marks, report-card
comments, fee queries and recurring transport schedules. The agent can record a
payment reported as already received; it cannot transfer money. Planning a ride
does not start it or attest that a child boarded it.

One run can cause at most **one** effect. A reviewed effect must be confirmed or
dismissed before continuing; a monitored effect finishes with a receipt. Voice,
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
- Every effect uses fresh authorization and a source hash, the original domain
  validator and API, and a server-generated idempotency key. Consequential effects
  add an immutable 10-minute review. The currently monitored effects are only the
  reciprocal homework complete/reopen flags. Existing domain revision/audit/event
  behavior remains authoritative. Changed sources fail closed.
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
- Model context size is provider-aware and can be explicitly configured with
  `AGENT_CONTEXT_WINDOW_TOKENS`. At 30%, older turns are compacted by the same
  configured provider under the same usage reservation and audit trail. Recent
  turns remain natural conversation; rejected model arguments are never recycled
  as user intent. Compaction failure leaves the unsummarized turns in place and
  cannot silently promote a proposal into a fact.
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

Additive migration `059_agent_effect_contract.sql` stores the contract version,
effect class and control mode on each action, plus the compacted-memory text,
cursor and timestamp on each thread. Historical actions default to the earlier
review policy; no old record is reclassified as an automatically executed effect.

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
- [Vertex AI function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling):
  use detailed typed declarations, expose a small relevant tool set, include current
  time when it affects behavior and keep business execution in application code.
- [Vertex AI agent evaluation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/evaluate)
  and [Google ADK evaluation](https://google.github.io/agents-cli/guide/evaluation/):
  evaluate final answers, tool trajectories, groundedness, safety and traces against
  golden multi-turn cases; prompt edits without regression data are not hardening.
- [LangGraph durable execution](https://langchain-ai.github.io/langgraph/concepts/durable_execution/)
  and [tool-call review](https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/review-tool-calls/):
  distinguish short-term checkpoints from durable memory and interrupt only the
  effects that actually require human review.
- [pgvector](https://github.com/pgvector/pgvector) is appropriate for filtered
  semantic retrieval over an approved unstructured corpus, not as the source of
  transactional attendance, marks, money or current action state. No vector layer
  is added until such a corpus and permission-filter recall evaluation exist.
- [MCP release guidance](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
  informs a later external-system boundary with the same consent/audit path. It is
  not an internal authorization bypass and is unnecessary for existing app APIs.

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
$1/day and $1/month in conservative reservations, 10 requests/hour and 30/day,
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
not billing or an entitlement. The later explicit product decision supersedes the
original basic-chat fallback: when off, Chat navigation, compact chat and the full
assistant page are absent, and every direct agent/specialist AI endpoint is denied.
Student attendance Copilot and the optional photo local-AI cross-check are also
hidden and denied. Existing role, record and school permissions are still checked
when enabled. Disabling Pro cancels an active run and invalidates pending effects;
re-enabling cannot revive one. Future paid plans need a separate server entitlement
gate combined with this preference. Additive migration: `058_user_pro_features.sql`. The
implementation has clean-database backend tests (337 passed, 153
intentional skips) and a 640-test frontend suite. Both production builds and
linters pass. Stage workflow `37948358227` deployed commit `5d1f452` after the
existing SMTP Secret Manager binding was corrected from a whitespace-prefixed
environment name. Migration 058 completed, revision `eduvera-stage-00024-jer`
has 100% traffic, and release/readiness/root checks returned HTTP 200. User/device
visual acceptance remains required.

## Contract, prompt and memory hardening — 9 October 2026

The reported failure was not treated as a request for a larger prompt. Inspection
of the exact persisted conversation found three coupled defects: a rejected model
proposal was eligible for later context, a long safety description was also used
as the human approval title, and continuation depended too heavily on the latest
surface wording. This increment fixes the state and contracts that the model sees:

- Rejected, expired, stale, failed and uncertain proposals enter subsequent turns
  only as truthful app-owned outcomes such as “nothing changed”; their model tool
  arguments never become memory or authority. Natural user messages remain in
  order, so “continue with that correction” is interpreted from conversation
  context without an application branch for a magic phrase. The newest explicit
  user-supplied learner/status wins over stale or invented model arguments.
- `capability-contract.ts` is the common source for effect class, execution control,
  presentation type, concise user outcome, reversal and required read. `find_tools`
  returns that permission-filtered manifest instead of a loose list. Detailed model
  instructions and concise UI labels are now separate values.
- The system prompt is decomposed into a stable operating policy, current scope,
  intent policy, relevant domain skill and response contract. Retrieved records are
  explicitly untrusted data. Tool scope is selected dynamically and the app—not the
  model—owns IDs, tenant/child scope, authorization, revisions, idempotency, source
  links, charts, effect policy and receipts.
- The first monitored effects are homework complete and reopen because they are
  narrow, reversible and idempotent. Attendance, marks, messages, fees, transport
  planning and the other consequential writes remain reviewed. Physical handover,
  location/biometric claims, safeguarding, guardian authority and account security
  remain human-only. This is progressive autonomy, not a claim that every existing
  write has already earned automatic execution.
- Thread compaction starts only after a conservative token estimate exceeds 30% of
  the configured context window. The LLM summary preserves user goals and verified
  outcome state, excludes school-record facts and tool arguments, and is labelled
  non-evidence in every future prompt. Every record answer/effect still re-reads the
  authorized API. The summary cursor and audit event make the transition traceable.

The current implementation deliberately keeps the official `@google/genai` adapter,
Zod/JSON Schema capability definitions and PostgreSQL state instead of adopting a
framework solely for appearance. Google ADK and LangGraph are candidates for a
measured orchestration spike, but a migration is accepted only if the same golden
multi-turn traces improve tool selection, groundedness, interrupted-action recovery
or operability without weakening model portability. A framework cannot repair an
incorrect business contract. pgvector and MCP are therefore deferred to the
specific retrieval/external-integration needs described above.

Verified locally against the isolated `omnischool_agent_test_20261009` database:
**31/31 agent integration scenarios** and **29/29 capability/prompt/memory contract
tests** pass, alongside **22/22 mocked provider-protocol tests** and **17/17 focused
assistant UI tests**. Coverage now includes rejected-proposal isolation, free-form natural
continuation, one-student versus whole-register protection, 30% LLM compaction,
preservation of all unsummarized turns below that threshold, compacted-memory
non-authority, and an autonomously monitored homework completion
with fresh validation and an audit receipt. Full backend lint plus backend
typecheck/build pass. The shared workspace's frontend typecheck remains obstructed by
pre-existing untracked duplicate `* 2.tsx` tests with missing matcher augmentation;
those user files were not modified. Live Vertex evaluation, browser UI and deployment
remain separate gates; these local tests are not production certification.

A bounded real-Vertex smoke check then used the principal's existing local demo
scope for three read-only turns. “Give me a concise overview of attendance recording
gaps today” read `class_registers`, returned the eight-class status breakdown and
created no action. The natural follow-up “Which class should I check first?” refreshed
the same source and identified the sole in-progress register. A final independent
two-bullet check passed after prompt version `2026-10-09.layered-v3` moved compacted
memory out of system-role authority. The test threads were archived; no school
record was changed. Local and
Cloudflare readiness returned HTTP 200 and the public status reported capability
contract `2026-10-09.2` with the configured model ready. This two-turn observation
is not a broad accuracy, latency or adversarial certification. Current review URL:
**https://verde-too-independent-bargains.trycloudflare.com**.

## Bounded long-term personalization — 10 October 2026

The agent now has a separate, user-controlled long-term personalization layer.
It is intentionally not a transcript archive and not a semantic cache of school
records. Only an explicit durable statement in the **current** user message can
create or revise one of three memory types: communication preference, recurring
app workflow preference, or self-described app familiarity. A matching exact
quote is required. One-off requests, model inferences, assistant text, retrieved
records, attendance, marks, fees, safeguarding/health data, contacts, credentials,
identifiers and precise locations are ineligible.

The first implementation uses ordinary PostgreSQL rather than pgvector or a
provider-owned memory service. At the deliberately small cap, exact
owner/school/portal/category/topic retrieval is complete, deterministic, cheap,
inspectable and portable across Vertex and local Ollama. Similarity search would
add embedding cost, filtered-recall behavior and a new poisoning surface without
improving this bounded set. A vector index remains an upgrade seam only if an
approved unstructured corpus grows beyond the prompt cap and permission-filtered
retrieval is proven with evaluation data.

Migration `060_agent_user_memory.sql` adds private, row-level-security-enabled
`agent_user_memories`. The default active budget is **1,200 estimated tokens**, at
most **32 items**, at most **96 estimated tokens per item**, with **365-day expiry**.
Updating the same topic increments its revision; deterministic priority/recency
eviction enforces the cap, and an expiry worker removes stale rows. The owner can
list, delete one, or clear all memories through authenticated APIs and the Profile
screen even while Pro AI is disabled. Mutation audits contain category/count and
contract metadata, never the private memory text.

Every model turn also receives minimal live account context—display name, account
role, current portal, institution and selected learner when applicable. Email,
phone and other contact data are excluded. Identity and memory are passed as
explicitly untrusted user-role data: they can improve wording, terminology,
explanation depth and workflow suggestions, but cannot establish identity,
permissions, record facts, action intent or tool arguments. The newest explicit
request wins, and every school fact/action still uses a fresh authorized app read.

Verified locally on 10 October against isolated
`omnischool_agent_test_20261009`: **32/32 agent integration**, **30/30
capability/prompt/memory contract**, **22/22 provider-protocol** and **1/1 storage
tests** passed (**85/85 total**). The Profile memory UI passed **2/2 focused tests**;
changed frontend files and all changed backend files pass focused lint, and backend
typecheck/build pass. Full frontend build remains blocked only by preserved,
pre-existing untracked duplicate `* 2.tsx` test files whose jest-dom matchers are
not augmented; they were not altered or deleted. Browser/device acceptance, live
Vertex memory behavior and deployment remain open gates.

## Role-aware human conversation — 10 October 2026

The assistant response layer now treats live identity and role as silent
conversation context rather than text to announce. This follows blueprint sections
6 and 18: keep the daily human experience simple while retaining permission-scoped,
tool-mediated AI. A new thread opens with one short, named greeting. A greeting-only
message uses the form **“Hello, Meera. What can I help with?”**; it does not recite
the account role, institution, portal, date or product domain. Later turns do not
greet or reintroduce the assistant again. Direct questions about the signed-in
person's name or role are answered from app-provided identity context.

The versioned response contract now describes the assistant as a trusted, discreet
school colleague: warm, calm, precise and official without helpdesk language.
Principal responses prioritize the decision, exception, school-wide impact or next
step. Staff responses prioritize assigned work, class/learner context, timing and
the next practical step. Parent and student responses retain their own scoped,
plain-language focus. Simple answers use one or two sentences; ordinary answers
target fewer than 80 words unless the user explicitly asks for detail. Account
context remains untrusted data for authorization purposes and never expands tools
or access.

Prompt contract `2026-10-10.layered-v5` is covered by the focused contract suite,
including opening versus continuing turns, principal/staff focus, preferred-name
context and prohibited account-narration phrases. Backend typecheck/build, focused
lint, **30/30 contract**, **22/22 provider**, **32/32 isolated integration** and
**1/1 storage** tests pass. A paid, read-only Vertex evaluation against a temporary
synthetic database passed five connected principal turns plus one separately
authorized staff opening. The principal greeting was exactly **“Hello, Meera. What
can I help with?”**, the name follow-up returned **“Your name is Meera Kapoor.”**,
and the staff greeting was **“Hello, Kavita. What can I help with?”**. Subsequent
analytics and review turns did not re-greet and kept verified app sources. The run
made nine model calls and conservatively reserved 127,041 micro-USD in the isolated
ledger; this is not a Google invoice or broad tone/accuracy certification. The
temporary access grant and database were removed afterward. Physical-device review
and deployment remain open gates.

## Conversation-first correction — 10 October 2026

Current prompt: `2026-10-10.api-owned-v7`. The assistant chooses conversation,
reads, clarification and operations from the full scoped transcript. Topic routing
only preloads relevant tools; it does not force writes or interpret permission.
Domain-less follow-ups retain the recent topic without a retry-phrase allowlist.
Older assistant refusals are not evidence of current access restrictions.

The application no longer substitutes regex-derived names, dates or statuses for
structured model arguments. Name resolution, exact record scope, state checks,
correction reasons, revision binding and confirmation remain in the APIs. Human
review is the check on interpreted consequential intent; the system does not claim
that English keyword parsing can prove a user's intent. Reasons and non-empty notes
must occur in user-authored messages; generated explanations cannot populate audit
fields. No proposal executes merely because the model calls its tool.

`find_tools` returns operation descriptions, and the next model round receives their
schemas. Effect/control contracts remain available to the server/UI, without repeating
approval prohibitions in every tool's model description. Gemini receives object-shaped
function responses, including for array-returning tools. Errors carry typed categories
so a missing field or temporary service failure is not presented as an authorization
policy. The new `student_fees` read uses the existing scoped fee API and is not exposed
to family roles; their existing server-injected child scope remains unchanged.
Fee tool projections convert integer paise to labelled INR amounts and compute
outstanding totals in application code. Persisted source evidence is unchanged;
the model does not need to infer units or sum the ledger itself.

`backend/test/agent-conversation.eval.ts` is an opt-in paid Vertex conversation test.
It requires a loopback disposable database whose name contains `test` or `ci`, uses
synthetic data, exercises clarification/discussion/resumption/approval and a historical
false refusal, and never targets Stage or the personal preview database. The ordinary
integration suite covers permission, Pro-off, CSRF, stale revisions, rejection and
idempotent confirmation independently of the model.
