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
  plan state for the existing administrator pass controls and the latest movement
  direction for only those 30 matches; collecting-person details remain excluded.
- View details fetches `/students/:studentId/` afresh. The owner's subsequent
  explicit one-click entry decision adds Mark entry directly to each search result.
  The instruction requires checking identity before tapping; that deliberate entry
  action attests identity and sends a stable command UUID without a detail round trip.
  The server still checks current authority, school scope and current movement state
  transactionally. Inside students have a disabled entry action. Exit retains the
  existing detail, identity and pickup QR safeguards.

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

## Visitor approval and one-click entry follow-up — 15 October 2026

Visitor entry and the pending/approved/inside list now use the shared theme with
clear status badges, host details, filters and only the action permitted by the
current state. Successful entry immediately changes the action to Confirm Exit.
The creation form retains its request UUID across uncertain retries; duplicate
requests do not create duplicate notifications. API responses whitelist public
visitor fields and omit internal token hashes.

A selected active staff/admin host sees an in-app Approve / Decline popup after
login, even without gate.manage. Review later postpones the popup for that login
session and leaves the request pending; its notification can reopen it. School
admins retain fallback decision authority. Other staff and gate operators cannot
approve somebody else's request. Gate operators still need gate.manage for
physical entry/exit. Pending and approved requests expire after eight hours; an
inside visitor can still be checked out.

Migration 098 adds request idempotency, revision and expiry fields plus current
relationship checks for gate.visitor.updated event/notification visibility.
Creation, decisions, movements, audit and outbox writes share their transaction.
Decisions and movement controls submit the displayed revision, serialize on the
visitor row and reject stale/conflicting actions. Notifications target the host
on creation and the recording operator after a decision. Live events invalidate
the gate, approval and notification queries; focus refresh and a 30-second poll
recover missed events. Notifications are in-app, not background OS push.

Local frontend/backend typecheck and lint, frontend production build and 49
focused UI tests passed. Headless browser checks with synthetic fixtures passed
one-click entry without a student-detail request, visitor creation, immediate
entry/exit state updates and login-time Approve/Decline at 320/768/1024/1440 px
without overflow or page errors. Phone/tablet renders were visually inspected.
Native database coverage exercises durable publisher delivery, retry deduplication,
current host revocation, school isolation, expiry and concurrent decisions. Hosted
CI and deployment passed as recorded below; these local fixtures are not live account evidence.


Release verification: PR #50 passed hosted CI run `38764776642` (832 backend
and 971 frontend tests, both client builds and security/deployment contracts).
Merge `585fc55c45f55460528fa894c6629c7fe51bf1f8` deployed successfully in Stage
run `38765399927`. Private migration `eduvera-stage-migrate-d65b2` completed at
16:08:56 UTC. App revision `eduvera-stage-00166-hop` passed candidate checks and
was promoted; the trusted release verifier confirmed the exact public SHA,
Stage environment, readiness and both apps at 16:09:59 UTC. The separate website
release succeeded; IndexNow accepted eight canonical URLs at 16:11:08 UTC.
No existing account or permission assignments changed. Owner device review and
a real host/guard visitor-request walkthrough remain requested. Local fixture QA
and native isolated database tests do not represent that live account walkthrough.

## Home-only approval popup and decision feedback — 15 October 2026

The owner narrowed the popup location: pending guest approvals appear only on the
authenticated user's actual home from authDestination, including permissionless
staff home, gate-only home and principal home. They do not interrupt other tools,
profile, login, security or institution activation. The approval query and polling
are disabled away from home, even if its queue is already cached. A valid visitor
notification link opens that same home with the request marker; closing, Review
later, Approve and Decline clear the marker/notification return state and stay home.
Review later does not change the request and it can be reopened from notifications.

Successful decisions show a short checkmark or cross confirmation, then dismiss
after 1.2 seconds (or immediately with Done/Close). Animation starts only after
the server confirms the decision; failures retain the review/retry UI. Shared
theme tokens, native modal focus management, live status announcements and the
device's reduced-motion preference are preserved. No backend authority, expiry,
revision, gate movement or permission assignments change.

Local production build, typecheck, focused lint and 24 approval/notification tests
passed. Tests exercise real notification-panel taps from a tool, home-only cached
queues, staff/principal/gate home destinations, close/Escape, decision feedback,
retry and session restrictions. Headless checks of the actual local app with
synthetic API fixtures passed at 320/768/1024/1440 px, with no page errors or
overflow; both decision animations, auto-dismiss and reduced motion were checked.
Hosted CI and release verification passed as recorded below; owner-device review remains pending.


Home-only approval release verification: PR #52 passed CI run `38774800786`
with 832 backend and 986 frontend tests, both client builds and deployment/security
contracts. Merge `45ddb3e53fc53e15063e93f89543bfefcbbc0586` deployed successfully
in Stage run `38775411724`. Migration/guard execution `eduvera-stage-migrate-9b75h`
completed at 17:20:34 UTC (no new schema migration in this UI change). App revision
`eduvera-stage-00175-nip` passed candidate checks, promotion and exact public SHA,
environment, readiness and both-app verification at 17:21:38 UTC. The website
release also succeeded; IndexNow accepted eight URLs at 17:22:53 UTC. The local
review preview returned HTTP 200. Owner device/live-account review remains open;
local synthetic browser fixtures do not establish that acceptance.

## Visitor photos and direct arrivals — 17 October 2026

Owner supplied three Gate & Safety HTML references and requested the existing theme,
direct student search without class selection, visitor photo capture/attachment,
photo review in the host's approval popup, and direct entry when no host is selected.
The reference's sample people, live-location claims, auto-SMS promise and decorative
filters are not operational data. Search uses real institution-scoped students,
name/admission substrings or exact roll number; class is displayed, never a prerequisite.
The last gate movement is labelled as a gate record, not continuous campus location.
Pickup QR, current readiness/authority and physical identity checks remain required.

Visitor creation accepts one optional JPEG/PNG photo (2 MB maximum), visitor category
and an optional host. A selected active host creates a pending request; no host records
an explicit gate-operator arrival with a check-in timestamp and no fabricated host
approval. A direct visit can be checked out through the existing authorized flow.
Photos are stored under the private persistent upload directory and served only through
a current school/host/admin/gate-authorized, no-store endpoint. Photos and storage keys
are excluded from notification/event payloads. The photo hash is part of request retry
comparison so an existing request cannot silently acquire a different photo. The native
mobile capture control and file picker support preview, replacement and removal.

This extends the existing gate domain state machine and transactional audit/outbox.
It does not claim a new Model Core visitor-command adapter or automated decision policy.
Real host/guard walkthrough and owner-device photo-capture review remain acceptance steps.
