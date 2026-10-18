# Development reference

- Use the repository's `School_Operations_Blueprint.pdf` (v1.0, 15 September 2026)
  as the primary product and engineering blueprint. Read the relevant sections
  before planning or implementing a domain; do not rely only on conversation memory.
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
- Preserve the established theme, shared headers, navigation, and UX. The blueprint
  guides capabilities and architecture; it is not permission to redesign the app.
- Prefer substantial, end-to-end workflows with real database relationships,
  authorization, audit/event handling, and tests over isolated cosmetic features.
- Ask the user to validate working UI after substantial UI changes. Keep the local
  preview available for review and verify its health after relevant deployments.
- Follow explicit user decisions where they clarify or supersede the blueprint;
  record material deviations and ask before resolving consequential ambiguity.
- Do not represent a proposed target, untested behavior, or incomplete release gate
  as implemented, measured, or production-ready.

## Current-system branch boundary — 18 October 2026

- `main` is the authority for the current product experience and architecture. New
  work intended for the current product must preserve Main's shells, navigation,
  design tokens, domain ownership, authorization and audit/outbox patterns.
- The Campus Digital Twin, simulator, Campus View and responsibility-composed
  workspace remain preserved separately on `codex/campus-digital-twin` for later
  exploration. Do not merge or re-create those dependencies in Main-based work
  unless the owner explicitly reopens that direction.
- `Stage` may contain useful product behavior interleaved with the Digital Twin
  exploration. Port only the required behavior, tests and data changes; do not
  merge Stage wholesale or import a Stage-only runtime dependency.
