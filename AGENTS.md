# Development reference

- Use the repository's `School_Operations_Blueprint.pdf` (v1.0, 15 September 2026)
  as the primary product and engineering blueprint. Read the relevant sections
  before planning or implementing a domain; do not rely only on conversation memory.
- Read `docs/blueprint/IMPLEMENTATION_PLAN.md` for the current delivery state,
  dependency order, accepted architecture decisions, missing companion artifacts,
  and remaining acceptance gaps. Keep that record updated with verified evidence.
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
