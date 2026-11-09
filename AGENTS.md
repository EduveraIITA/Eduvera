# Development reference

## Repository-wide authority and session entry

These instructions apply to every directory in this repository unless a more
specific tracked `AGENTS.md` adds compatible domain instructions. Do not maintain
a competing local agent policy or copy the blueprint into session-only instructions.

- Work from the active branch and its owning contracts. For Digital Twin work on
  `codex/campus-digital-twin`, the owner's 19 October decision explicitly forbids
  reading, borrowing from or merging `Stage`: it implements a different ERP concept
  and is not an authority for this branch. Do not automatically merge, reset or
  overwrite a working tree to synchronize it with any other branch.
- Local-host storage direction, 23 October: leave
  `/Users/abhishekyadav/Documents/omnischool` in its current state; do not modify,
  offload, delete or explicitly re-download it. This Digital Twin worktree's
  `.git` points into that folder. Defer Git operations and tools that invoke Git
  against it until the owner authorizes them; work only in the active ThatCampus
  folder and distinguish deferred Git-dependent checks from passing tests.
- Read `docs/blueprint/README.md` for the authority order and current contract map.
  Blueprint v2 and its normative companions take precedence over archived earlier
  proposals. An implementation checkpoint is evidence, not authority
  to reverse a newer accepted decision.
- Owner documentation cleanup direction, 29 October: keep one current contract
  per concern, the concise `IMPLEMENTATION_PLAN.md` delivery status and
  `docs/VERIFICATION.md` evidence/testing guide. Update these in place; do not add
  a dated Markdown report for every fix, duplicate root proposals, or append a
  chronological transcript to the implementation plan. Preserve raw verification
  artifacts separately and link exact receipts. Superseded documents are recoverable
  outside this project through the archive recorded in the verification guide;
  they are not current instructions. Consolidation must retain active requirements,
  legal notices, operational commands and unresolved acceptance gates.
- Inspect the owning code, migrations, ports and tests before extending a workflow.
  Distinguish target architecture from implemented contracts; do not copy a known
  transitional gap as the pattern for a new feature.
- Owner cleanup direction, 24 October: when replacing an implementation, migrate
  its callers and tests and remove the superseded page, wrapper and styles in the
  same change. Do not accumulate parallel editors or compatibility aliases without
  an explicit, bounded migration need. Preserve active domain adapters, historical
  migrations and operating records; code cleanup is not authority to delete data
  or the protected development/simulation capabilities below.
- Owner frontend direction, 29 October: React Native/Expo in `mobile/` is the
  sole actively developed frontend for browser, iPhone, iPad and Android. Freeze
  `frontend/` as bounded migration reference/rollback source; do not duplicate new
  features or fixes there. Finish the active screen and functionality ports and
  remove their old-frontend runtime/type/build dependencies before reporting that
  the old implementation can be retired. Preserve canonical links, data/history,
  current backend/domain owners, Simulation and the development harness. The
  owner cannot perform physical-device checks and explicitly waives them as a
  retirement prerequisite. Use available browser, iPhone/iPad simulator and Android
  emulator checks; record hardware-only limitations without claiming they passed.
  Screen-port completion, functional cutover evidence and production/store
  acceptance remain distinct. Retirement follows the owner's review; this is not
  permission to delete the retained old source prematurely.
- Owner polish direction,30October: focus rendered UI iteration on iOS while the
  shared React Native app is being polished. Do not repeat iOS, Android and web UI
  tours for each shared cosmetic edit. Keep shared source/type and relevant logic
  checks; perform the deferred Android and browser visual/interaction pass together
  before release. This does not turn untested platforms into accepted ones or
  waive domain, data-isolation, recovery or release gates.
- Owner database clarification, 24 October: use one PostgreSQL17 server, separate
  Omnischool and ThatCampus application databases, and the explicitly retained
  isolated Simulation store on that same server. Do not create an application-
  specific server/process tree. Disposable integration databases may exist during
  bounded tests but must not accumulate as permanent development environments.
  The owner confirmed generated development data need not be preserved: retire
  obsolete ThatCampus test databases/worlds and old runtime copies after checking
  exact targets. This is not permission to delete unrelated applications or touch
  the protected Omnischool folder, weaken domain immutability, remove historical
  migrations, or delete the maintained Campus Lab/Simulation source.
  Fresh seeds reuse current owning services; never restore obsolete view writers
  or fabricate attendance merely to make older tests pass.

## Development rules

- Owner collaboration preference,30October: act as a thoughtful, candid partner,
  not an agreeable order-taker. Evaluate proposals against the user's goal,
  evidence, usability, consistency, accessibility and maintainability; state
  meaningful disagreements and tradeoffs plainly and recommend a better approach
  when justified. Do not invent objections or argue for its own sake. Separate
  facts, recommendations, assumptions and verified results; revise your position
  when better evidence appears. Never call an implementation complete merely to
  reassure the owner. Apply this judgment proactively within authorized work.
  Inspect rendered screenshots critically: cramped icon/chevron insets, clipping,
  overlap, alignment, contrast and hierarchy are defects to fix, not details to
  ignore after passing source tests. Record observed limitations honestly.
- Use `docs/blueprint/PRODUCT_BLUEPRINT_V2.md` as the primary product and
  engineering blueprint. Read its linked domain/architecture contracts before
  planning or implementing a domain; do not rely only on conversation memory.
- Earlier blueprints are archived provenance, not current product authority.
  A historical constraint remains binding only where Blueprint v2 or a linked
  current contract explicitly retains it.
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
- Work outside-in for every substantial product workflow. Before extending schemas,
  APIs, Model Core primitives or automation, define the concrete person,
  responsibility, operating context and desired outcome; the normal and important
  exception journeys; what each screen must help the person understand and do; and
  the correction or hand-off path. Validate the smallest understandable mobile
  experience, then derive the minimum domain and backend contracts needed to make it
  truthful, authorized and extensible. This is experience-first, not decoration-first:
  do not let a table, generic form, infrastructure primitive or visual mock-up dictate
  the user's mental model or bypass domain invariants.
- Owner research-first direction, 28 October: before implementing a feature, inspect
  the current owning flow and research relevant primary technical documentation and
  UX evidence. Record the options considered, chosen approach and practical limits
  with the owning work. Prefer familiar shared controls, reuse, bulk review and
  optional detail that reduce input, time and repeated decisions. Research must
  support the actual person's task; novelty, extra configuration or a polished
  screen alone does not justify an implementation.
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
- Owner burden constraint, 25 October: follow Blueprint v2 section2.8. Detailed DT
  modelling does not justify detailed compulsory user input. For each proposed
  step, state the real decision/coordination/evidence need and work saved; prefer
  existing sources, stable arrangements, bulk actions and exceptions. Do not make
  per-person/per-occurrence tracking or extra configuration the default merely
  because the model supports it. Preserve explicit authority and honest unknowns.
- Owner compatibility direction, 9 November: design and test features across
  relevant school and college configurations. Drive behavior from configured
  capabilities, data and current authority. For academic changes, exercise a
  class-led school, a course-led
  college and coexistence when the workflow supports both. Cover relevant
  optional data and report which configurations actually passed.
- Follow explicit user decisions where they clarify or supersede the blueprint;
  record material deviations and ask before resolving consequential ambiguity.
- Owner visual direction, 20 October: keep a calm, readable, minimal product with
  restrained green/yellow accents drawn from the supplied ThatCampus logo. It
  should feel warm and enjoyable without weakening operational seriousness.
  Avoid decorative blue side stripes, repeated Now/Next badges and unnecessary
  metadata. Live actions remain blue and the complete Simulation theme remains
  amber. Verify the rendered mobile composition, not only shared CSS or tests;
  do not call a style premium or approved on the owner's behalf.
- Read `docs/blueprint/THATCAMPUS_THEME.md` before UI work. Apply the shared theme
  across Light, Dark, Live and Simulation; use stable area colours with softened,
  contrast-checked accents and distinct glyphs, without individual icon boxes.
  Child choices share their area's colour; cross-links use the destination area.
  Give dock anchors and Profile/Notifications stable restrained colours; keep other
  utilities neutral, status/action colours meaningful and original brand
  artwork unchanged. Keep utility/status icons precise. The owner
  rejected 3D icons and explicitly protected the original ThatCampus Assistant
  icon. Do not replace that artwork with a generic icon-pack symbol.
- Do not represent a proposed target, untested behavior, or incomplete release gate
  as implemented, measured, or production-ready.

## Unified scheduling and attendance

Owner clarification, 20 October 2026: read
`docs/blueprint/PEOPLE_SCHEDULING_AND_ATTENDANCE.md` before changing Timetable,
Attendance or their onboarding. Build one activity/person/context foundation, not
student versus staff/guard planners or attendance engines. Purpose-specific adapters
retain owning-domain rules; people, groups and places are reused, passive participants
need no app account, and scheduling never silently grants authority. Migrate existing
academic implementations through reviewed compatibility contracts rather than leaving
a second writable engine. Preserve the model-mediated command/observation/outcome
path and same-delivery Simulation acceptance. The contract remains a target until
concrete end-to-end migration and UI evidence establish delivery.

## Unified People identity and relationships

Owner clarification, 20 October 2026: read
`docs/blueprint/PEOPLE_GROUPS_AND_CONNECTIONS.md` before adding a person category,
directory, group, relationship, hierarchy or person-creation/import path. Reuse
one canonical campus person and their DT entity; attach contextual enrollment,
employment, family and app-access records through their owning services. Existing
person attachment is explicit and revision-checked, never inferred from a name,
email or phone. A descriptive tag, membership or hierarchy edge grants no
authority, and passive person creation does not invent an account or autonomous
agent behavior. Extend the same selected-world command/evidence path and test
meaningful Simulation changes. Record unresolved legacy adapters honestly rather
than treating a new directory as proof that every older writer has converged.

## Simulation parity is part of every platform change

Owner rule, 19 October 2026: Simulation is a maintained product capability, not a
one-time demo, frozen fork or optional follow-up. A platform change is not complete
until its Simulation impact has been implemented and verified in the same change.

- Review Simulation whenever changing a domain schema, API, permission, Operating
  rule, event, background worker, time-dependent calculation, file/evidence flow,
  connector, device, projection, realtime subscription or frontend data hook. Record
  either the matching adapter/test update or a specific, reviewed no-impact reason.
- Keep the same domain services, authority/invariant checks, typed Model Core paths
  and ordinary application screens. Bind their stores, clock, actors, deterministic
  input models, artifacts and effects to the selected environment; never maintain a
  second ERP or hard-coded Simulation version of business logic.
- New eligible agents receive run-local counterparts at capture or creation within
  a scenario. New behaviour requires explicit versioned approval; no agent invents
  intent, consent, authority, physical evidence or a real-world financial outcome.
- Add or update privacy-safe snapshot coverage, virtual-time worker execution,
  isolated queries/commands/events/realtime and run-local connector/artifact adapters
  together. Simulation cannot read Live after capture, reach Live credentials/files,
  send to real recipients or silently borrow Live data when coverage is missing.
- Update the executable Simulation conformance catalogue, compatibility fingerprint
  and owning tests when the platform changes. A stale/unregistered adapter or source
  version must fail verification and block readiness; do not regenerate a lock merely
  to silence a failure without reviewing and testing the changed behaviour.
- Test the new feature in Live and one isolated run, including a meaningful mutation
  or worker transition, unchanged Live state, tenant/run separation, idempotency and
  failure/recovery. Verify the common UI in amber and blue when affected. Declaration
  coverage or a passing source scan is not evidence that a workflow works.
- Include resource, retention and recovery implications in the same work. Active
  unbounded runs never acquire an arbitrary TTL; storage/admission pressure must be
  explicit and safe. Never delete an active, pinned, leased or selected world.
- Any intentionally excluded platform control-plane function must have an explicit
  classification and safe explanation. An unsupported campus workflow is an open
  product gap, not permission to leave Simulation stale or call parity complete.
- Update `docs/blueprint/IMPLEMENTATION_PLAN.md` with concrete evidence and remaining
  limits. Do not mark the platform feature complete while its Simulation work is
  deferred, disabled without explanation, untested or stale.

## Active development-fixture decision

- Product Simulation is institution-neutral and distinct from the Cambridge-only
  development actor harness. Every active administrator can create continuous
  baseline/scenario worlds from their own Live snapshot. The restrictions below on
  fixture actors do not restrict approved run-local product counterpart modelling.
  Follow the continuous-run contract in `CAMPUS_SCENARIO_SIMULATION.md`.

- Until the owner explicitly asks to **clean for real market release**, retain and
  push the complete Campus Model Core, Campus View, isolated scenario runtime,
  Cambridge synthetic-campus fixture and simulated-human Campus Lab source with the
  owning work. They are shared development and sales-demonstration capability, not
  disposable local scratch code. Do not delete, revert, minimize or silently omit
  them merely because they are synthetic or not suitable for a customer tenant.
- Cambridge International School (`cis`) is a wholly dummy campus created for this
  project. Continue expanding and correcting its people, agents, roles, spaces,
  resources, timetable, operating rules and activity whenever that is useful for
  exercising or demonstrating a real capability. Keep stable fixture identities,
  synthetic provenance and repeat-safe seeds; never treat Cambridge fixture records
  as real people, production evidence or defaults for another institution.
- Synthetic actors must still use normal authenticated domain APIs and the reviewed
  Model Core coordination path. Keep them visibly labelled and restricted to the
  Cambridge fixture, with external side effects disabled. Do not weaken tenant,
  authority, evidence or connector safety merely to make a demo act automatically.
- The currently implemented Campus Lab actor runner is local-only; its source is
  nevertheless required in Git. A hosted development/showcase runner needs its own
  reviewed isolation and credentials before enablement. This is an open deployment
  boundary, not permission to remove the simulator. Only the owner's explicit real-
  market cleanup instruction can authorize a release-removal pass.
