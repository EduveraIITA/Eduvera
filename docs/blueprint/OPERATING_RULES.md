# Operating rules inventory

13 October 2026. Operating rules describe how the application behaves, not the
school's academic policies, published governance documents or employee entitlements.
The admin entry point is Institute settings → Operating rules.

## Centralized editable rules

| Category | Controls | Existing enforcement |
| --- | --- | --- |
| Event attendance | Observation hours before/after a session | School-scoped database rule, active-admin authorization, revision conflict check, audit; used by register validation |
| Leave cover | Automatic resolution enabled, deadline, fallback kind/label, responsible staff | Staff operations coverage rule and resolution engine; existing revision and authorization checks |
| Departure & transport | Enabled arrangements, same-day change cutoff, location retention and stale-location threshold | Departure coordination policy API and journey/location workflows |
| Messaging | Student/parent direct messaging and group replies, attachments, communication hours, message retention | Messaging policy API and relationship-based access checks |
| Daily attendance | Submission deadline in institution timezone | Existing school deadline drives overdue requests/notifications; central editor now available |
| Event operating windows | Entry opens 0–168 hours before; staff entry/locking closes 0–720 hours after | Event detail, register capabilities, write gates and Requests projection use the same stored rules |
| Journey window | Boarding lead time 0–240 minutes; duty changes close at that boundary | Server journey controls/duty-swap gates and UI availability use the same calculation |
| Messaging limits | Edit window 0–60 minutes (zero disables); attachment size 1–10 MB | Message API publishes editable-until; server enforces edit and upload limits |

Editors use the existing domain APIs rather than a generic unvalidated settings
blob. Register screens no longer edit institution rules. Staff entitlement settings,
transport setup and messaging privacy help link to the central editors.
Messaging currently uses the signed-in active institution; the central editor blocks
editing if that scope differs from the selected institution. Messaging does not yet
have optimistic revision checking like event attendance, coverage and departure.

## Platform-owned configuration and protected invariants

| Area | Behaviour / source | Current ownership / gap |
| --- | --- | --- |
| Register continuity | Signed roster snapshot, replay/expiry, observation vs receipt, correction provenance | Attendance services; safety constraints, not unrestricted admin switches |
| Event workflow | Publication, consent and cancellation lifecycle restrictions | State invariants remain enforced; configurable timing above does not permit retroactive consent or cancellation of an in-progress event |
| Journey workflow | Lifecycle transitions and unresolved-rider closure checks | Safety invariants remain enforced; configurable boarding lead time does not bypass rider reconciliation |
| Attention navigation | Outstanding-item eligibility, priority, expiry and resolution propagation | Requests and school-event services; domain-specific, not one global notification switch |
| Messaging | Attachment type validation, reporting/relationship safeguards | Approved formats and safety constraints remain enforced; size/edit limits are configurable above |
| AI operations | Daily/monthly budgets, rate/step limits, context compaction and memory caps | Deployment-managed configuration below; school admins cannot raise shared billing caps |
| Sessions / uploads / workers | Session expiry, request/upload bounds, worker intervals | Backend config and domain validation; deployment-managed |
| Data retention | Transport location and chat retention editable above; audit and other record retention | Other retention is service-managed; do not expose destructive cleanup as a casual setting |

This is an inventory of the reviewed configuration surfaces, not a claim that every
numeric constant has been migrated. Each remaining candidate needs a defined scope,
allowed range, safe default, permission, audit, concurrency behaviour and regression
tests before becoming admin editable. Security invariants remain enforced in APIs.

## Configuration contract (migration 083)

New institution controls use typed columns with database bounds, strict API input,
active-admin/current-institution checks, optimistic revision checks and transactional
before/after audit. Defaults preserve existing behaviour. Updates apply immediately to
open workflows; they do not rewrite past attendance or handover records. Event saves
include the operating-rule snapshot in their audit. Rule changes do not proactively
push a cross-device refresh yet; fresh API reads enforce the current rule.

Deployment owners can configure (restart/redeploy required):

- AI calls/run: `AGENT_MAX_MODEL_CALLS` (1–20, default 10).
- AI tools/run: `AGENT_MAX_TOOL_CALLS` (1–40, default 12).
- AI tools/model response: `AGENT_MAX_TOOL_BATCH` (1–4, default 4); writes still serialize.
- Existing AI spend/rate controls: `AGENT_DAILY_BUDGET_MICROS`,
  `AGENT_MONTHLY_BUDGET_MICROS`, `AGENT_USER_HOURLY_LIMIT`, `AGENT_USER_DAILY_LIMIT`.
- Existing memory controls: `AGENT_MEMORY_TOKEN_BUDGET`, `AGENT_MEMORY_MAX_ITEMS`,
  `AGENT_MEMORY_ITEM_TOKEN_LIMIT`, `AGENT_MEMORY_TTL_DAYS`, `AGENT_CONTEXT_WINDOW_TOKENS`.
- Existing session/worker controls: `SESSION_TTL_SECONDS`, `EVENT_WORKER_INTERVAL_MS`,
  `EVENT_BATCH_SIZE`, `EVENT_CLEANUP_BATCH_SIZE`, `EVENT_REPLAY_LIMIT`, and SSE limits.

No deployment values or credit allowances were changed by this implementation. Model
output/reservation bounds, the requested 30% compaction trigger, security floors and
transport state invariants are intentionally not arbitrary school-admin switches.

## Deliberately separate

- Academic attendance minimums and eligibility: Academic setup / school policies.
- Leave allowances and entitlements: Staff leave settings.
- Published policies, acknowledgements and approvals: Governance.
- Terms, periods, routes, stops and dated assignments: Operational planning data.
- Payment destinations, verified accounts and collection instructions: Finance setup.
- Account permissions and memberships: Account access.

Immediate operating-rule updates do not implement the blueprint's proposed full
draft/rehearsal/approval/scheduled-policy lifecycle. Existing records are not rewritten
when observation windows change. Cloud rollout and phone acceptance remain separate gates.
