# ThatCampus AI — conversation and execution contract

The conversational assistant reads authorized records, proposes supported actions
and opens their owning screens. It is one bounded software-agent interface, not the
Campus Model Core or the source of campus truth. Identified humans, teams, devices
and integrations remain agents in the broader DT model; conversational AI does not
replace them or receive direct Core/database access.

This is the maintained behavior/configuration contract. Current source, focused
tests and the delivery record establish implementation; historical release totals,
expired tunnel URLs and installed-model observations are not current readiness.

## Domain authority and effects

The versioned capability catalogue and `capability-contract.ts` own supported tools,
effect class, execution control, presentation, required reads and app destinations.
No model may execute arbitrary SQL, URLs, shell, JavaScript or credentials. Every
tool uses the existing authenticated domain API and its membership, relationship,
scope, time, revision and workflow rules. Tenant/person/child scope is injected
from the validated session/thread, never chosen by the model.

| Effect | Control |
| --- | --- |
| Authorized read | May run autonomously through the owning API. |
| Explicitly classified reversible low-impact effect | Fresh grounded read and validation; execute once with monitored receipt. |
| Consequential effect | Expiring immutable review and explicit Confirm; repeat source/access checks before dispatch. |
| Physical handover, safety, safeguarding, institutional authority or account-security decision | Human owning workflow; no inferred evidence or automatic decision. |

The initial monitored effects are homework complete/reopen, not an automatic
classification of all writes. Attendance, marks, messages, fees and transport
planning retain reviewed controls. One assistant run causes at most one domain
effect. A pending review must be confirmed/dismissed before continuation.
Unsupported voice/upload/printing/import, authority or physical workflows are
honest app handoffs, not simulated successes. A request to chat never authorizes
invented recipients, dates, amounts, marks, physical observations or audit reasons.

Every effect binds a preceding authorized source and its hash/revision. Confirmed
commands are claimed atomically; duplicate confirmations never dispatch twice.
A crash or ambiguous network result at the write boundary becomes uncertain and
requires exact receipt/domain verification, not blind replay. Domain idempotency
is used where supported, never claimed universally. Only app-generated receipts
prove effects; model completion wording is not evidence.

Keep original owner/person/world and command commitments through recovery. A
failed refresh after acceptance must not offer a fresh write. Permission loss,
Pro disable, expiry and source changes fail closed. Physical attendance,
captured funds, account access and institutional consent are never inferred from
a command proposal or its software completion.

## Conversation, privacy and memory

PostgreSQL owns durable threads/runs scoped to owner, campus, persisted actor
context and selected child. Legacy portal keys are storage/scope details, not a
reason to create new persona portals in the shared application shell. History
returns the latest 20 threads and 50 turns per selected thread; older retained
history is not a claim that older-history pagination or deletion UI is complete.

Before displaying an old answer or placing it in model context, refresh its sources
through current APIs. Revoked or narrowed access hides old answer/chart evidence;
a narrower paged result may conservatively hide it. Conversation memory must not
become a way around record permissions. Native protocol state and opaque reasoning
signatures stay within the bounded run, not the user-visible transcript.

Prompts separate stable policy, current authorization/time scope, intent, relevant
domain skill, response style, permission-filtered tool schemas and untrusted data.
Human-facing titles are separate from instructions; internal prompts, probes and
provider errors are not ordinary user conversation. Rejected/expired/stale/failed/
uncertain proposals become truthful app-owned outcomes, never reusable arguments
or authorization. Preserve natural user turns and their newest explicit corrections;
do not require magic retry phrases or infer intent from a historical assistant
refusal. Topic routing preloads tools but cannot force a write.

At a conservative estimate above 30% of configured context, the same configured
provider summarizes the oldest chunk into goals, preferences, corrections, open
questions and receipt-level outcomes. Exclude school-record facts, identifiers and
tool arguments; label the summary non-evidence. Keep recent turns verbatim.
Compaction failure preserves unsummarized turns rather than inventing authority.
The app still refreshes every source before a record answer or effect.

### Compact and expanded presentation

With Pro enabled, the Assistant control in shared navigation toggles the compact
conversation over the retained workspace. The latest reply opens the full
conversation when activated and copies the full plain-text reply on a long
press. A screen-reader copy action and full conversation copy control use the
same acknowledged clipboard path. When there is no reply, the idle composer
offers a small conversation control beside Send. It hides as soon as text is
entered. While a request or local app action is working, the composer centers
current progress and its animated Assistant mark beside Stop. An idle reply
shows its Assistant mark outside the top-left corner. During a mounted UI
action, the pointer marks the relevant control. Stop interrupts local actions
and asks the server to cancel a running request using its exact confirmed
identity.

On iPhone, the expanded conversation hides workspace navigation and header.
iPad opens the conversation beside the app when the window can fit both and
stacks the panes in narrower multitasking windows. The composer uses Liquid
Glass on supported Apple systems and respects the system transparency setting.
Collapse restores the compact view and retains the conversation, unsent question
and pending-request recovery. Native phone Back collapses the full conversation.
App Back and Assistant source links follow the guarded navigation chronology.
The full conversation contains approval and report details.

Assistant replies, report charts, source links and approval controls in the
conversation use a bounded A2UI 1.0 catalog. The renderer binds report source and
decision events to the exact current server-owned evidence or action. Chart
data, available routes and authority still come from the existing owners.
Virtual Campus facility review and room description open as a task inside the same
Assistant surface when enabled. Map pins are placed on the exact retained map
and the app can resume the task without choosing a new campus or floor.
The Assistant can use the current authorized Virtual Campus directory to open
setup. Further settings and actions need their own contract, scope and review.

### App copilot protocol

The authenticated Assistant exposes ordered AG-UI 1.0 run events through the
existing mobile request and refresh path. This app binding uses event batches for
the current owned run. A2UI remains the presentation catalog for the conversation.
The client advertises only named controls from the active application route and
its local permissions. Shared context contains an allowlisted screen, registered
tool names, the exact currently selected virtual campus when available, and the
previous tool receipt status. Form contents, arbitrary routes and account
credentials stay in the owning screen.

The server revalidates the current owner and source before emitting AG-UI tool
events. The app checks the complete ordered batch, highlights each applied
control and uses the same UI event path as a person. The Virtual Campus registry
opens the workspace or a verified campus and interior, opens its campus picker,
fills place search and focuses an exact published place. Campus creation opens
the existing account form. When the name is missing, A2UI collects it in the
same chat and fills the owned form. The user confirms creation in that form.
Additional modules register scoped handlers with their owning route and source.
A later tool in the same run can cross a route only through a declared handoff.

Mounted tools can register exact visual targets before or after a step. The
owning screen reveals a target in its own scroll view when necessary. An inert
Assistant marker follows measured controls and published map geometry. Its
motion follows the system preference and it never takes input focus. The
composer names the current step while it is running. Stop and manual workspace
interaction revoke pending UI actions. A changed scope or target invalidates
the original action. The next turn can receive the exact applied, blocked or
stopped result.

The global Assistant remains available across supported navigation. The shell
measures the compact dock so app actions remain reachable. On iOS the UIKit
tray retains its full-height navigator, and the active page reserves space for
the compact Assistant. The Assistant itself sits above the measured tray.
Pages reserve the current compact height so their final controls can scroll
fully above the chat. An Assistant reveal uses the current visible viewport. Campus setup renders
A2UI controls inside the conversation and returns to the retained map for
placement. The fullscreen backdrop uses supported UIKit Liquid Glass or browser
blur and honors reduced transparency.

### Public web browsing

When public browsing is enabled, an authorized Live user can ask
“Search the web for …” or “Read this public page …”. The Assistant calls
[Exa’s keyless public search and page reader](https://exa.ai/mcp) with the exact
user-provided search terms or public HTTPS address. Browsing is independent of
model availability and shares a daily limit of 20 requests with public
floor-plan discovery. Sources are returned in A2UI with links that open on
request. Source excerpts are transient data and are never executed, passed to a
model or applied to a campus. Signed addresses and account or record context
are excluded. Simulation makes no public browsing requests.

### Bounded long-term personalization

Only an explicit durable statement in the current user message can change a
communication preference, recurring app-workflow preference or self-described app
familiarity. Retain an exact current-message evidence quote. One-off requests,
model inferences, assistant/tool text, record facts, action instructions, permissions,
contacts, health/care data, credentials, identifiers and precise location are
ineligible. Preferences affect wording/suggestions, never identity or authority.

Private PostgreSQL memory is owner/campus/context/category/topic scoped, not a
provider memory service or semantic record cache. Default bounds are 1,200 estimated
tokens, 32 items, 96 tokens per item and 365-day expiry, with deterministic
priority/recency eviction, revisioned topic updates and expiry cleanup. Runtime
configuration may lower/change permitted limits through the validated owner.
The owner can inspect/delete one or all memories via authenticated APIs and Profile
even when Pro is off. Audits retain category/count/contract, not private memory text.

Minimal live display-name/account/context data may personalize a turn; email/phone
are excluded. Identity and memory enter as explicitly untrusted user-role data.
Current record facts and actions still require fresh APIs. A vector index needs
an approved unstructured corpus and demonstrated permission-filtered retrieval;
it is not the source of transactional attendance, marks, money or action state.

## Grounding, answers and charts

Resolve exact unique names/admission numbers through the app; ambiguity requires
a human choice. Never demand database UUIDs or let the model invent scope/revisions.
The campus timezone owns today. Distinguish attendance presence from academic marks.
User-authored reasons/notes remain grounded in the user transcript; generated
explanations cannot populate audit fields. English grounding is not arbitrary-
language or universal intent certification.

The single-student attendance command binds learner, class, date and register
revision from authorized lookup. Review shows previous/new status and actual
reason. Only that learner changes; omitted notes/classmates remain untouched.
A draft stays draft even if every learner is marked; a submitted correction stays
submitted. Whole-register submission is a separate action. Dated roster,
instructional-day, correction-reason, lock/reopen, revision, idempotency and audit/
event rules remain native. The receipt opens that dated learner-focused register,
with Clear search returning to the full roster. Locked records require native reopening.

Keep a short natural opening; do not announce role, campus or date unless useful.
Later turns do not repeatedly greet or narrate account context. Decision makers
need exceptions/impact/next action; other people need their scoped practical task.
Simple answers use one or two sentences; ordinary replies target fewer than 80
words unless detail is requested. Role/context influences presentation, never access.

The model chooses an allowlisted chart preset, not numbers/code/HTML. Server
aggregates preserve denominator, scope, period, units, gaps and uncapped totals
despite pagination. Use complete partitions for donuts and label partial data;
subject attendance can be a daily-record projection, not independent lesson evidence.
Compact chat shows one latest chart with at most four bars; full chat retains
source charts, definitions and accessible tables. App-owned links preserve exact
learner/class/period/context; source revocation hides answer and chart together.
Render bounded text/limited emphasis, never executable HTML or clickable
model-invented URLs. Fee projections label INR and convert integer paise in code.

Principal-only analytics/review tools reuse the authenticated scoped aggregate
APIs. Ambiguous learners/classes require selection; no DOB, guardian contacts,
private feedback or SQL enters those projections. Charts and advisory review make
no intervention decision or communication by themselves.

## Provider configuration and readiness

`backend/src/agent/providers.ts` is the provider contract. The active deployment
must explicitly configure its approved provider; a code default is not evidence
that an on-device model is installed. There is no silent remote/local fallback,
automatic model download or public tunnel to unauthenticated Ollama.

| Provider | `AGENT_PROVIDER` | Configuration |
| --- | --- | --- |
| Gemini through Vertex | `vertex` | Explicit `AGENT_GOOGLE_PROJECT`, `AGENT_GOOGLE_LOCATION=global`, `AGENT_MODEL=gemini-3.1-flash-lite`; service identity/ADC, no custom base or API key. |
| Gemini API | `gemini` | Explicit model/key; default API base `https://generativelanguage.googleapis.com/v1beta`. |
| OpenAI Responses | `openai` | Explicit model/key; default `https://api.openai.com/v1`. |
| Anthropic Messages | `anthropic` | Explicit model/key; default `https://api.anthropic.com/v1`. |
| OpenAI-compatible | `openai-compatible` | Explicit model and compatible endpoint; remote credentials where required. |
| Optional local Ollama | `ollama` | Existing local service/model; code fallback is `qwen3:8b` at loopback port 11434, not the deployment recommendation. |

These settings are separate from older `AI_PROVIDER`/`OLLAMA_MODEL` copilot/photo
configuration. Non-loopback endpoints require HTTPS, no embedded URL credentials
or redirects. Keys, ADC and tokens remain server-only, outside source/chat/logs/UI.
Vertex permits only the currently reviewed project/model/region shape enforced by
`vertex-auth.ts`; it also needs an unexpired `AGENT_ENABLED_UNTIL` allowance.

Cloud/provider status must distinguish configuration/auth readiness from an actual
successful inference. Before use, approve data handling and evaluate the exact
model against synthetic authorized workflows; authorized records can still be
sent to the configured provider. Protocol support is not reliability certification.
A missing cloud provider must not be described as an unavailable local model.

Gemini/Vertex uses official `@google/genai` with native response parts and thought
signatures, object-shaped function responses and grouped consecutive tool results.
SDK automatic tool execution is disabled; application validation owns every effect.
Bounded jittered generation retries use `p-retry`, at most three attempts per
generation within the same total model-call allowance. SDK retries are disabled so
each billable attempt has a durable reservation. Never automatically retry writes,
blocked content, permission/identity failure or permanent request errors.
Diagnostics retain safe failure categories, not provider bodies or credentials.

## Access, resource and deployment limits

Staff require `ai.use` plus each underlying permission. The per-user Pro preview
preference is not billing or entitlement: off hides/denies Assistant and protected
specialist AI endpoints, cancels active work and invalidates pending effects;
re-enabling cannot revive them. Future paid entitlement requires an independent
server gate. Do not silently widen a staff role to enable chat.

Current limits are validated in `limits.ts`, not historical test totals: default
ten model calls, twelve tool calls and a four-tool read batch, with configured
bounds. Runs remain time-bounded and concurrency/lease/rate controlled. A model
response is capped at 256 KB; context, arrays and text are bounded and partial results
labelled. Consequential review expires after ten minutes. Inspect current code and
deployment limits before changing a value; do not interpret a usage reservation
as a provider invoice or a project-wide billing cap.

Cloud reservations occur before each attempted billable call, survive restart/
concurrency and are not refunded merely because a response failed or was cancelled.
Shared configured allowance covers other participating model callers, including
campus-scene import. Hour/day/account limits, trial expiry and deployment billing
controls remain distinct. Missing/expired allowance fails closed without disabling
ordinary campus tools.

Exclude credentials, capture tokens, precise GPS and sensitive medical/biometric
keys from model projections. Persisted authorized snapshots and action history
still require an approved retention, backup/erasure and storage-access policy.
Private agent tables retain RLS and revoked direct browser/PUBLIC grants; a
non-owner production runtime/RLS validation remains a separate gate, not implied
by successful application permission tests.

Use the official SDK, typed schemas and PostgreSQL state unless measured golden
multi-turn traces justify another orchestration framework. ADK/LangGraph cannot
repair business contracts; pgvector and MCP require a specific approved retrieval/
external-integration need, not implementation for appearance.

## External messaging transport

Telegram is an optional adapter, not a second assistant. Provider normalization and
delivery reuse `AgentService`, thread state, tools, memory, budgets and action review.
External identity is a locator, never campus authority. A signed-in user consumes a
short-lived single-use link in private chat; binding snapshots owner/campus/context/
selected child, then every turn reconstructs current scope/Pro/permission. Revoked
membership or child access applies without relinking. Groups are ignored; the bot
cannot initiate before a user starts it.

Provider update IDs deduplicate a leased PostgreSQL inbound queue. Do not retain raw
payloads or raw link tokens; store token hashes. Delete transport text after terminal
handling; canonical authorized threads and metadata-only delivery hashes/counts/
provider IDs remain. Tokens and webhook secrets are server-only.

Reads and monitored low-impact effects use one-use 15-second in-process delegation
to existing internal HTTP contracts, not stored browser cookies or bypassed API
guards. Consequential effects await app review at the exact thread; provider reply
text is never confirmation. Web and channels share AI limits.

Telegram is disabled by default. Enable only with `TELEGRAM_BOT_ENABLED`,
`TELEGRAM_BOT_TOKEN`, random `TELEGRAM_WEBHOOK_SECRET`, trusted HTTPS `PUBLIC_URL`
and explicit registration or `TELEGRAM_AUTO_REGISTER_WEBHOOK=true`. Verify token/
bot identity with `getMe`; `TELEGRAM_BOT_USERNAME` is only an optional override.
Do not carry forward an old Stage enablement claim as current deployment evidence.
WhatsApp needs its own reviewed business identity, policies, webhook, conversation
window and template implementation behind the same interface.

## Verification and unresolved gates

Extend the authenticated domain API first. Then add strict catalogue schemas,
permission/context rules, app-owned request/revision binding, classification and
verification destination. Test the read that grounds it, current authority, stale
and changed evidence, rejected/uncertain outcomes, duplicate approval and the
receipt's actual screen. Never treat a schema or mocked tool call as end-to-end proof.

Use fresh current PostgreSQL17 migrations and an explicitly disposable loopback
test database accepted by `backend/test/test-database.ts`. Never target Live,
a user's preview or another application's database. Focused agent integration,
contract, provider, memory, budget and channel tests are the baseline. Opt-in real
model evaluations must use synthetic data and approved spending, with test threads
kept out of normal users' history. No temporary broad permissions may survive.
Local Ollama, Vertex and conversation evaluation harnesses exercise different
providers and need their own explicit prerequisites.

Verify compact/full conversation, retained context, progress/cancel/restart,
confirmation/receipts, source revocation, error recovery, charts and narrow-screen
keyboard/focus/motion behavior in ordinary Live and selected-world surfaces.
Simulation must use its reviewed run-local state/effects policy; never infer that a
Live provider check proves isolated side-effect parity.

Remaining release gates include domain-by-domain action acceptance, adversarial/
multilingual and interruption/recovery evaluation, actual configured-cloud
inference, load/latency/failure drills, user/physical-device acceptance, retention/
deletion and provider-data approval, production non-owner RLS/backup validation,
and each external channel's signed-in link/private-chat acceptance. Framework,
deployment or historical passing totals do not close these gates.

## Primary references

[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling),
[Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling),
[Google GenAI SDK](https://googleapis.github.io/js-genai/release_docs/classes/client.GoogleGenAI.html),
[Vertex function calling](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling),
[Anthropic tool handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls),
[Ollama tools](https://docs.ollama.com/capabilities/tool-calling) and
[Google ADC](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)
inform provider protocol and identity. They do not establish application authority
or certify ThatCampus's current model quality.
