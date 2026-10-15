# Gate home and staff navigation

Owner direction, 15 October 2026: the gate workspace must match the shared
ThatCampus theme, be the gatekeeper's home, and be accessible from a bottom tab
for staff who have Manage In & Out. The old oversized standalone buttons are
replaced with shared brand tokens, school identity, clear action cards and concise
Hindi/English copy. Scan QR remains the primary action. Find Student, Visitor
Entry and pending visitor approvals remain directly visible.

Gate-only staff land at `/gate`; opening `/teacher` also redirects there.
Staff with additional permissions keep their current home and receive an
**In & Out** navigation item at `/teacher/gate` in the sidebar and mobile bottom
bar, before More. Their gate workspace stays inside the normal operations shell.
Scoped non-teaching staff also receive an In & Out shortcut on their home.
The tab requires the explicit `gate.manage` permission. Role configuration stays
in Roles & permissions. No account credentials or role assignments are changed.

## Search and current-state boundary

- At least two characters trigger a 250 ms debounced name/admission search.
- Search requests consume an AbortSignal; superseded results are hidden and
  cancelled. Loading, no-match and retry states are explicit. The same term may
  reuse roster matches for 30 seconds, scoped to the current school.
- The authorized server list query matches literal, case-insensitive name or
  admission substrings, deduplicates and caps matches at 30 before enrichment.
  Separate name/admission branches can use the expression trigram indexes added
  by migration `097_gate_student_search.sql`. The list includes class and today's
  plan state for the existing administrator pass controls, but no gate history
  or collecting-person details.
- Selecting a student fetches `/students/:studentId/` afresh through `gate.manage`
  and institution scope checks. Entry/exit confirmation still checks current
  authority in the server transaction; a cached roster match cannot authorize
  a movement. Identity verification and QR pickup safeguards remain required.

## Verification

Local frontend/backend typecheck and lint, the frontend production build and 20
focused UI tests passed. Focused coverage includes QR identity checks, Hindi,
gate-only home, mixed staff shell, permission-gated navigation, automatic search,
retry, cancellation and fresh selected-student detail. Native PostgreSQL coverage
checks bounded matches, literal wildcard characters, case/whitespace handling,
school isolation and current movement detail. PR #46 passed hosted CI in run
`38751807483`: 829 backend tests, all mobile shards, both client builds and
security/deployment contracts. It merged as
`3079cff948d60962aed03e63b533459b344bb091`.

The regular local Chromium launcher failed because it requires an unavailable
Unix socket. The separate headless runtime successfully rendered the actual app
with synthetic API fixtures in its local network context. Checks passed at 320,
768, 1024 and 1440 px for both gate-only and mixed staff: no horizontal overflow,
no page errors, correct gatekeeper-home redirect, active staff In & Out bottom
tab, search selection and disabled confirmation until identity verification.
Tablet and phone renders were also visually inspected. These were local UI
checks, not a login to live school records. Owner device review is still requested.

## Live release — 15 October 2026

Stage run `38752498133` completed successfully for
`3079cff948d60962aed03e63b533459b344bb091`. It passed 829 backend tests and
961 frontend tests, both client builds and the security/deployment contracts.
Private migration execution `eduvera-stage-migrate-62mqr` completed at 14:43:24
UTC. App revision `eduvera-stage-00160-pux` was first verified as a zero-traffic
candidate, then promoted. The trusted release script verified the exact public
release SHA, Stage environment, readiness and both apps after promotion. The
separate website deployment also succeeded; IndexNow accepted its eight URLs at
14:46:09 UTC. No existing account or permission assignments were changed.

A separate local public HTTP recheck returned 403 and the search tool could not
retrieve the health endpoints. Public release confirmation above comes from the
successful trusted release verifier, not those unsuccessful local requests.
