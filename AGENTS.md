# Development reference

## Repository-wide authority and session entry

These instructions apply to every directory in this repository unless a more
specific tracked `AGENTS.md` adds compatible domain instructions. Do not maintain
a competing local agent policy or copy the blueprint into session-only instructions.

- Fetch and inspect the active shared branch before substantial work. `Stage` is
  the current integration branch; `main` may lag accepted product/code changes.
  Compare both heads and their documentation. Do not automatically merge, reset or
  overwrite a working tree to synchronize them.
- Read `docs/blueprint/README.md` for the authority order and current contract map.
  Blueprint v2 and its normative companions take precedence over historical root
  proposals and the v1 PDF. An implementation checkpoint is evidence, not authority
  to reverse a newer accepted decision.
- Inspect the owning code, migrations, ports and tests before extending a workflow.
  Distinguish target architecture from implemented contracts; do not copy a known
  transitional gap as the pattern for a new feature.

## Development rules

- Use `docs/blueprint/PRODUCT_BLUEPRINT_V2.md` as the primary product and
  engineering blueprint. Read its linked domain/architecture contracts before
  planning or implementing a domain; do not rely only on conversation memory.
- Treat `School_Operations_Blueprint.pdf` (v1.0, 15 September 2026) as historical
  provenance, not the current product authority. A v1 constraint remains binding
  only where Blueprint v2 or a linked current contract explicitly retains it.
- Read `docs/blueprint/IMPLEMENTATION_PLAN.md` for the current delivery state,
  dependency order, accepted architecture decisions, missing companion artifacts,
  and remaining acceptance gaps. Keep that record updated with verified evidence.
- Treat this file, the blueprint, the implementation plan, and the referenced
  companion artifacts as shared version-controlled context. When a product
  decision, architecture contract, delivery state, or agent rule materially
  changes, commit and push the relevant document with the owning work; do not
  leave project knowledge only in a conversation or one agent's local checkout.
- Before starting substantial work, compare the current checkout with the shared
  branch and read the latest versions of these references. Reconcile concurrent
  documentation changes without discarding another agent's evidence or unresolved
  acceptance gates.
- Keep the Campus Model Core separate and API/contract-driven. Domain modules own
  authoritative rules and records; frontend features call domain APIs and use only
  domain-specific language. Never expose model-core persistence or graph concepts
  directly to UI code.
- Read `docs/blueprint/THATCAMPUS_MODEL_CORE_BLUEPRINT.md` before adding a core
  primitive, domain adapter, event/observation/message/command schema, projection,
  automation runtime or simulation feature. Extend the reviewed contracts rather than
  creating a workflow-specific parallel runtime.
- Treat the Campus Model Core as the operating coordination kernel, not an
  after-the-fact analytics mirror. Every real person who acts through the app or an
  approved channel maps to one stable human agent linked to their person/account
  identity. Material workflows must retain a model-mediated chain from typed agent
  command or observation through current authority/rule/context evaluation, owning
  domain execution and evidence, correlated outcome, and explicit next-agent
  hand-off. Do not bypass domain invariants or replace typed evidence with a generic
  graph/ERP schema.
- Model material coordination as an event-reactive agent loop: an immutable typed
  event is matched to effective subscriptions; an identified human, team, device,
  integration or bounded software agent receives a durable typed message/work item;
  its reaction emits a message, observation or command; the owning domain records the
  outcome; and resulting events continue the trace. Delivery is not acknowledgement,
  acknowledgement is not acceptance, and a command outcome is not physical evidence.
  Treat operational agent messages as protocol records, not as the AI chat transcript
  or a generic notification. Require correlation/causation, idempotent effects,
  authority rechecks, rule/version evidence, retry/expiry/escalation/loop limits and a
  human correction path. Use the finest granularity needed for an authorized campus
  decision, not indiscriminate surveillance or inferred human intent.
- Keep the model runtime behaviour-neutral. Do not hard-code an agent's goals,
  subscriptions, reaction mapping, message recipient, timing, escalation, autonomy,
  tool access or adaptive/learning behaviour in the core. All mutable behaviour comes
  from validated, versioned, effective-dated institution configuration and Operating
  rules, and every reaction snapshots the versions it used. Agents cannot rewrite or
  self-activate their own configuration; proposed adaptations remain drafts until an
  authorized administrator approves them. Code may enforce schemas, deterministic
  execution semantics, domain invariants and non-weakenable safety/privacy floors.
  Missing or invalid behaviour configuration fails closed or routes to its explicit
  human fallback; it never activates a hidden default automation.
- Preserve the established theme, shared headers, navigation, and UX. Blueprint v2
  guides capabilities and architecture; it is not permission to redesign the app.
- Read `docs/blueprint/THATCAMPUS_OPERATING_EXPERIENCE.md` before changing shared
  navigation, Today/Overview, Requests, Notifications, attention/badges, Operating
  rules or a domain workspace. Treat Today as a projection, keep Requests/Tasks/Offers
  distinct from informational Updates, and preserve one authoritative domain action
  path rather than creating duplicate editors.
- Prefer substantial, end-to-end workflows with real database relationships,
  authorization, audit/event handling, and tests over isolated cosmetic features.
- Reduce operator burden through bounded automation. Routine automatic actions must
  be driven by institution-level Operating rules that authorized administrators can
  review and edit, with clear timing, scope, fallback, explanation, audit evidence,
  and a safe correction or override path. Do not hard-code mutable operating choices
  into individual records, and do not automate authority, consent, safeguarding,
  financial reconciliation, or physical handover beyond their explicit domain rules.
- Ask the user to validate working UI after substantial UI changes. Keep the local
  preview available for review and verify its health after relevant deployments.
- Follow explicit user decisions where they clarify or supersede the blueprint;
  record material deviations and ask before resolving consequential ambiguity.
- Do not represent a proposed target, untested behavior, or incomplete release gate
  as implemented, measured, or production-ready.
