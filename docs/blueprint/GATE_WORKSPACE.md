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

Local typecheck, lint and production build are verified as completed in the
implementation record. Focused UI coverage includes QR identity checks, Hindi,
gate-only home, mixed staff shell, permission-gated navigation, automatic search,
retry, cancellation and fresh selected-student detail. Native PostgreSQL coverage
checks bounded matches, literal wildcard characters, case/whitespace handling,
school isolation and current movement detail. Hosted database tests and release
verification remain pending at this implementation checkpoint. Real-browser
responsive review remains an acceptance item: the local browser runtime could
not launch because its sandbox denies sockets. No responsive screenshot evidence
is claimed from that failed attempt.
