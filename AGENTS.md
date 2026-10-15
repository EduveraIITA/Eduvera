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
