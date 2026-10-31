# Universal React Native implementation map

This records the React Native/Expo source shared by web, iPhone, iPad and Android.
It is not full workflow or production acceptance. Screens use the server-composed
Today / Work / Areas / More contracts and owning APIs, without embedding the old
web application. Any remaining browser handoff does not satisfy migration parity.

Use [native setup](README.md) for tools/builds and
[current verification](../docs/VERIFICATION.md#native) for source, installed-build,
iPhone/iPad, Android and Simulation evidence. A newer backend or web release does
not automatically ship native UI or validate old native flows.

## Current migration scope

Owner decision, 29 October 2026: React Native/Expo is now the sole actively
developed frontend for web, iPhone, iPad and Android. Implement new features and
fixes there once; do not duplicate them in the old React/Vite application.
Replicate the **active current** web screens, reachable workflows and corrections,
retaining appropriate Apple/native controls. Do not
copy unused persona pages, retired editors, abandoned experiments or unreachable
legacy UI merely because their source still exists. A canonical route may still
reuse an older owning adapter; its live capability must be reviewed rather than
removed based on the adapter's name. Preserve current data, immutable history,
Simulation, Campus Model Core and the maintained development harness.

The old React/Vite source is frozen for reference and reviewed rollback only;
the maintained public preview already serves the universal app. The owner will
retire the old implementation after the active-screen/action port audit and
browser, iOS simulator and Android emulator functionality, data links/history,
recovery and rollback review. Missing active ports, browser handoffs and read-only
substitutes for current actions do **not** satisfy migration parity.
React Native Web dependencies, responsive browser chrome and cookie/session
adapters have a bounded implementation; their presence alone is not full browser
acceptance.

Physical-device checks cannot be performed in this migration. The owner explicitly
removed them as an old-web retirement prerequisite; keep hardware-only behavior
marked untested. This does not waive active functionality, source review or
browser/simulator/emulator checks, and does not establish hardware, store or
distribution readiness.

Owner polish direction, 30 October: focus rendered shared-UI iteration on iOS,
retaining source/type and relevant logic checks. Perform the deferred Android and
browser visual/interaction review together before release; this does not waive
platform, domain, Simulation, recovery or release gates.

## Active web retirement gate

The maintained [active inventory](parity/active-web.json) records **129 mounted
canonical legacy paths and 29 capability groups** from
`frontend/src/App.tsx`, `canonicalMoreRouteDefinitions` and
`canonicalSetupRouteDefinitions`. The original 78 capability entries are retained;
two new `implemented-unverified` universal visitor capabilities bring the reviewed
capability total to **80**. Their native-only `/visit-join` entry and group-link/own-
participant owners do not enlarge the frozen 129-route migration denominator.
The inventory expands the mapped Insights topics and records
current query/local modes, source owners, implementation limits and pending
acceptance. Redirect-only persona/bookmark URLs and unmounted abandoned pages are
excluded from the flow denominator. Current immutable history, Model Core and the
maintained Campus Lab source remain explicitly retained; product Simulation remains
part of the parity target.

**Retirement is blocked.** The current source now includes Company, public
account/invitation/onboarding continuations, account Pro/memory/connections,
Governance, People/academic import and setup, Schedule and Calendar editors,
academic attendance/offline/photo/follow-ups, Learning authoring, assessments,
finance arrangements, room/menu/visit/transport configuration, campus topology
and Simulation Saved/History/Compare/behaviour/effects. Reports and Restricted
Care retain their source ports and privacy/recovery boundaries. Source presence
is recorded as `implemented-unverified`; no group is marked verified.

Configured Google sign-in now has web GIS and native state/PKCE source owners;
actual provider configuration and device ceremonies remain unverified. Assistant
tool calls retain the original native session through ordinary owning HTTP guards.
Provider interaction, memory and channel account links in Simulation are deliberate
Live control-plane exclusions, rather than missing campus implementations.
Campus editor/viewer, Dining/Accommodation recovery/time, current
visit history and Departure journey continuations now have source ports. All
browser/iOS/Android, meaningful Live/isolated Simulation writes, recovery and visual
gates remain open unless an
exact existing receipt covers that bounded flow. The frozen old frontend remains
available for reference/rollback; absent server APIs are not fabricated to make
the inventory complete.

The bounded current-source coverage audit is complete for this denominator:
the [72-route review](../artifacts/native-web-ui-20261029/source-port-completeness-half-a.json)
and [57-route review](../artifacts/native-web-ui-20261029/active-operating-port-source-audit.json)
cover all **129 canonical routes**, with no overlap or omitted inventory path.
Review followed mounted screen bodies, query/local modes and actual controls,
rather than counting a route mapping as a port. All missing screen/control ports
identified by those reviews now have universal implementations: email verification
entry and safe account/security continuation, manual-token password reset and
post-reset sign-in, the browser Insights date control, authorized Care Message
reports discovery, and Gate management/operator controls. The
[four-port closure](../artifacts/native-web-ui-20261029/four-port-source-completion.json),
[Gate management port](../artifacts/native-web-ui-20261029/gate-management-source-review.json)
with [root review](../artifacts/native-web-ui-20261029/gate-management-root-review.json),
and [Gate operator port](../artifacts/native-web-ui-20261029/gate-operator-source-review/review.json)
record the exact source and focused checks. This establishes bounded source-port
coverage, not exhaustive correctness or functional acceptance. The
[original operator camera review](../artifacts/native-web-ui-20261029/gate-operator-independent-review.json)
identified private-photo cleanup and retained-preview P2s. The
[corrected delta review](../artifacts/native-web-ui-20261029/gate-operator-camera-delta-independent-review.json)
closes those exact findings with source review and 109 independently rerun tests,
including 11 camera lifecycle checks. Actual camera interoperability remains untested.

The active app no longer imports the frozen frontend's runtime or type modules.
The [shared-wire extraction](../artifacts/native-web-ui-20261029/shared-wire-extraction-source-review.json)
redirects 195 type references to 48 shared declaration modules, preserves the
required definitions and removes old frontend files from the mobile TypeScript
program. The [independent transition review](../artifacts/native-web-ui-20261029/native-only-transition-independent-review.json)
records native/shared ownership of Metro/build inputs, test dependencies and
unchanged [theme tokens](../artifacts/native-web-ui-20261029/native-only-theme-value-proof.json);
active [brand comparison assets](../artifacts/native-web-ui-20261029/native-only-brand-source-proof.json)
are native-owned byte-identical originals. Old CSS generation and test runtime
imports are removed. The parity audit still reads frozen registrations as migration
evidence; the old source remains retained for comparison/rollback. **All 29 groups
remain `implemented-unverified`, and the functional retirement gate remains blocked.**

The historical [native-only checkpoint](../artifacts/native-web-ui-20261029/native-only-final-verification.json)
records 1604 passing mobile tests, whole-mobile TypeScript and web/iOS/Android
exports at that boundary. Its [bounded reconciliation](../artifacts/native-web-ui-20261029/native-only-source-reconciliation.json)
and [independent review](../artifacts/native-web-ui-20261029/native-only-inventory-independent-review.json)
verified 1424 source fingerprints at that checkpoint. The newer
[In & Out source/build verification](../artifacts/native-web-ui-20261029/in-out-live-final-verification.json)
records **1630 passing mobile tests**, whole-mobile TypeScript and successful
web/iOS/Android exports. The earlier
[source reconciliation](../artifacts/native-web-ui-20261029/gate-raw-text-source-reconciliation-supplement.json)
watched **1426 sources**, with zero drift, ten passing inventory tests and the
same 29 retirement blockers. All statuses and acceptance arrays remain unchanged;
the [factual metadata correction](../artifacts/native-web-ui-20261029/live-development-parity-description-delta.json)
updates descriptions without rewriting those historical proofs.

The [visitor source reconciliation checkpoint](../artifacts/native-web-ui-20261029/visitor-active-parity-reconciliation/review.json)
watched **1440 sources**, including the explicit shared onboarding contract. It
reviews 14 changed and 14 newly watched owners, preserves all 129 legacy route
records, all 29 group statuses, every existing capability status and every
acceptance array, and adds only the two unverified native capabilities above.
[Manager source/mounted checks](../artifacts/native-web-ui-20261029/visit-onboarding-manager-source-review/review.json),
[public registration source review](../artifacts/native-web-ui-20261029/visit-join-source-review.json)
with [independent correction checks](../artifacts/native-web-ui-20261029/visit-join-independent-review/corrected-review.json),
and the [bounded integration review](../artifacts/native-web-ui-20261029/visit-detail-reference/integration-independent-review.json)
cover their exact source slices. The
[public host receipt](../artifacts/native-web-ui-20261029/visit-detail-reference/public-join-host.json)
proves exact `/visit-join` HTTP admission and rejection of lookalikes, not a
completed registration. The
[backend source freeze](../artifacts/native-web-ui-20261029/visit-onboarding-backend/source-freeze.json)
records isolated PostgreSQL/COW and compiled HTTP checks. The later
[activation 205 proof](../artifacts/native-web-ui-20261029/visit-onboarding205-activation-verification.json)
confirms the ready normal backend/schema 278, unchanged 277 checksums, retained domain
rows, both protected worlds and configuration, with rollback 204/private backups
retained. Email delivery remains off. Rendered browser/simulator/emulator and
mailbox/workflow acceptance remain separate. The later
[icon/dock reconciliation](../artifacts/native-web-ui-20261029/icon-polish/active-parity-reconciliation.json)
reviews **1443 source fingerprints** with the same 129 legacy routes, 29 groups, 80
capabilities and unchanged acceptance arrays; its ten inventory tests pass and all
29 retirement blockers remain.
No functional status or retirement gate is promoted by this reconciliation.

The shared [feature icon changes](../artifacts/native-web-ui-20261029/icon-feature-source-review.json)
and [independent semantic-icon review](../artifacts/native-web-ui-20261029/icon-polish/independent-review.json)
use destination-specific glyphs and existing theme colors, keeping utility controls
and the original Assistant artwork. Unknown/prototype-named values fall back safely.
The [dock owner review](../artifacts/native-web-ui-20261029/assistant-dock-glass-source-review.json)
and [independent dock review](../artifacts/native-web-ui-20261029/assistant-dock-glass-independent-review.json)
cover Today/Work/Areas/More in the main capsule, a separate conditional right-hand
Assistant bubble and one measured native-glass selection with reduced-motion and
opaque accessibility fallbacks. Existing routes, guards and retained owners remain.
The bounded [iPhone rendered review](../artifacts/native-web-ui-20261029/icon-polish/ios-rendered-review.json)
adds changed-menu screenshots, actual glass-selection video,36pt Assistant bubble
and retained-tab/reselect/open/expand/collapse/close checks. Current rendered
validation is scoped to this portrait iPhone; Android/browser visual and interaction
review stays deferred together before release. All Dynamic Type/rotation layouts
and whole-app acceptance remain unverified.

The current [area-colour review](../artifacts/native-web-ui-20261029/icon-polish/area-colour-review.json)
replaces the intermediate neutral/purpose-colour iterations with stable area accents,
softened Light/Dark inks and flat symbols without individual icon boxes. Child
choices share their area; cross-links follow destination identity. Dock anchors,
Profile and Notifications also use restrained colours; status, action tint and
original Assistant artwork remain independent. Twenty-four focused checks and
whole-mobile TypeScript pass. Portrait iPhone Light/Dark screenshots establish the
bounded rendered review; four-theme contrast is source-tested, not a new isolated
Simulation workflow tour. This presentation-only change does not alter domain
queries, commands, stores, clocks or effects, or promote any retirement gate.
Deferred Android/browser UI review and whole-app workflow acceptance remain open.


The current Cloudflare preview uses the reviewed Metro development host, not a
frozen export. The [activation receipt](../artifacts/native-web-ui-20261029/live-development-public-activation.json)
records the same port 5173, API 8000 and tunnel with web-only Metro routing to `[::1]:8084`;
the [rendered Fast Refresh probe](../artifacts/native-web-ui-20261029/live-development-hmr-source-probe.json)
retained input through one component edit and its exact restoration. Refresh an
old frozen client once; subsequent supported source edits use Fast Refresh.
Static mode remains for reviewed release exports and rollback. This development
preview does not establish production or functional retirement acceptance.

Source ports do not authorize an automatic `reviewedSources` refresh. A final
owner review must reconcile the current import closure, capability descriptions
and evidence before accepting new fingerprints. Expected drift is not a passing
check and does not close any retirement gate.

From `mobile/`, run:

```sh
node scripts/active-parity.mjs --check
node --test scripts/active-parity.test.mjs
node scripts/active-parity.mjs --retirement
```

The first command checks inventory drift and always prints the independent
retirement status; a zero exit there means only that the review is current. The
retirement command exits nonzero while any group/capability is incomplete or lacks
inspectable browser, iOS simulator, Android emulator, Simulation, recovery and
visual receipts. Physical hardware is excluded from this retirement prerequisite.
Route presence, a shared component, a browser handoff or source/build tests cannot turn
that gate green. `--json` provides the blocking paths and capabilities.

The check follows current local runtime/style imports and platform variants from
reviewed owners, so leaf-control/query-mode changes also require review. This
dependency watch is conservative; a watched file is not another active workflow.
After reviewing changed owners, modes, limits and evidence, `--review-hashes`
prints candidate fingerprints without writing them. Do not refresh fingerprints
to conceal an unresolved drift or treat them as functional acceptance.

The current iPhone dock uses Expo NativeTabs/ UIKit, with original coloured glyphs
and a separate prominent Assistant toggle on the tested iOS27 simulator. Compact
Assistant wrappers pass touches through outside the bubble and composer; its
conversation stays pinned while the operating page scrolls or opens an activity.
The [rendered activity with Assistant open](../artifacts/native-web-ui-20261029/profile-polish/native-dock-background-tap.png)
records the resulting screen after a successful background scroll and activity tap;
the owner independently confirmed this interaction. The
[46 focused checks](../artifacts/native-web-ui-20261029/profile-polish/native-dock-tests.log)
and [TypeScript check](../artifacts/native-web-ui-20261029/profile-polish/native-tabs-typecheck.log)
pass. This supersedes the earlier custom iOS dock-selection implementation. Older
iOS prominent-control behavior, iPad regressions, remote Pro availability changes
and the deferred Android/browser interaction pass remain unverified. Explicit iOS
Pro changes guard affected editors before the native tab catalogue can remount.
These bounded UI checks do not establish whole-app or retirement acceptance.
The current [Visit review](../artifacts/native-web-ui-20261029/profile-polish/visit-campus-review.json)
binds visible management/observations/history, the sectioned editor, categorized
complete place choices and the shared visual campus/building/floor/room picker.
The [iPhone overview](../artifacts/native-web-ui-20261029/profile-polish/visit-campus-overview-conflicts.png)
shows yellow published-schedule conflict geometry and Choose entire campus.
The same canonical selection returns to an unsaved form after current Gate
eligibility is rechecked; it is not a reservation. 193 focused frontend checks,
27 real PostgreSQL/COW checks without skips, whole-mobile/backend types and 8
ordinary native Bearer HTTP checks pass. Release209/schema280 retains explicit
campus-or-place destinations and the private account profile API; 24 isolated
profile checks pass, with SMS still disconnected. Existing normal visit/history
and protected worlds are unchanged by activation and this read-only/unsaved tour.
These are bounded source, domain/API and iPhone checks, not a new Android/browser,
rendered Simulation/recovery or retirement acceptance. Full booking/closure
availability is not supplied by the published timetable projection.


The [current In & Out review](../artifacts/inout-journey-20261030/review.json)
closes a concrete history-detail port gap: saved plan and observation snapshots
are inspectable without using current labels. It also binds 186 shared checks,
mobile types,48 backend cases (19 unit/29 actual PostgreSQL-COW-HTTP) and bounded
current iPhone validation/Back/history/invitation checks. These counts overlap
older selections and are not additive. No normal command was submitted, and no
all-platform, rendered Simulation/process-loss, real mailbox/OS share or whole
journey acceptance is implied. All 29 groups remain implemented-unverified; source
fingerprint drift remains explicit and no acceptance arrays were promoted.

The [visitor follow-through](../artifacts/visitor-journey-20261030/review.json)
adds224 focused checks/mobile types and bounded isolated iPhone invitation,
normal-login/self-join, own-view, cancellation, revocation, replaced-link and
unavailable-mail evidence. It fixes native fragment loss before routing, refreshes
returning previews, shares the grouped detail card and corrects existing-campus
starting-goal requests. Native Copy and Share chooser/dismissal are observed;
chooser opening does not prove delivery. Two fixture accounts joined two separate
visits, not a rendered multi-visitor same-link tour. Normal API/account were
restored and both zero-client disposable stores removed. Rendered Simulation,
process loss, actual mailbox delivery, touch scrolling and final cross-platform
presentation remain open. The retirement check still reports source drift and
29 blocked groups; no inventory fingerprint or acceptance label was promoted.



## Shared authority and contracts

- Workspace types and wire normalization: [`packages/contracts/src/workspace.ts`](../packages/contracts/src/workspace.ts), [`workspace-normalizer.ts`](../packages/contracts/src/workspace-normalizer.ts). The web reexports these contracts.
- Workspace API: `GET /api/v1/workspace`. Native domain boundaries verify the account, institution and Live/Simulation namespace before using the manifest. A contribution supplies a destination and context; the owning endpoint still decides authority for each read and command.
- Native routing: [`src/features/NativeRoute.tsx`](src/features/NativeRoute.tsx), [`src/lib/navigation.ts`](src/lib/navigation.ts), [`src/lib/route-state.ts`](src/lib/route-state.ts). Routes keep the canonical web path and relationship query parameters.
- Visitor onboarding wire types: [`visit-onboarding.ts`](../packages/contracts/src/visit-onboarding.ts). Group plan size, actual self-registrations and observed Gate movements remain distinct; the participant projection explicitly grants neither entry permission nor presence confirmation.
- Session and transport: [`src/auth/SessionProvider.tsx`](src/auth/SessionProvider.tsx), [`src/lib/api-client.ts`](src/lib/api-client.ts). The transport binds account/world credentials and rejects responses made obsolete by a context change. `useApi` keys reads by account, campus and world.
- Browser session variants: [`SessionProvider.web.tsx`](src/auth/SessionProvider.web.tsx), [`api.web.ts`](src/lib/api.web.ts) use the existing same-origin httpOnly session cookie and signed readable CSRF cookie; no native Bearer is stored or sent in the browser. Cookie-changing ceremonies are serialized within a tab, and peer/focus signals trigger server revalidation. Same-identity verification retains mounted drafts behind a blocking shell; changed/revoked identity clears old query data. A cookie shared by peer tabs still requires cross-tab/runtime acceptance. The pure environment wire validator is shared in [`packages/contracts/src/execution-environment.ts`](../packages/contracts/src/execution-environment.ts).
- The shared shell uses UIKit NativeTabs on iOS and JavaScript Tabs/Glass on Android/browser. Native domain stacks retain platform headers and gestures; Assistant is a toggle rather than a selected workspace. Glass uses the supported platform material with solid content/form surfaces and accessibility fallbacks. Campus maps use the shared Skia renderer; there is no WebView map fallback.

## Shared Back behavior

The sole history is the installed Expo router tree and the browser's real entries.
`BackNavigation.tsx` supplies one top control whose label names the actual return
context. Detail/editor navigation adds a level; ordinary filters update the current
view. Work and header utility links retain their real origin, tabs retain their
mounted child. Tapping the already selected tab deliberately resets that tab to
its base page, checking every removed mounted editor for unsaved or busy work.
Other tabs keep their mounted state. Direct links use a reviewed semantic parent. Returns remove a
level rather than pushing another parent. Confirmed completion replaces the editor
presentation only after its owning accepted result; navigation never replays a save.

Shared losing-exit guards protect the integrated domain editors, including
Attendance, Event, Learning, Assessment, Message, Repairs, Leave, Reports, Care,
canonical setup, membership and invitation forms. Persistent exact
submitted intents remain recoverable; volatile edits receive one confirmation when
the actual route is removed. Switching retained tabs does not claim to discard their
draft. A cancelled active-tab reset also keeps that draft. Visible Back controls
use an arrow and the actual destination; the full “Back to…” phrase remains an
accessibility label. Detail headers hide institution branding and the duplicate
page title, leaving the owning heading in the content. Coverage of every older form/modal is still an acceptance gap. Same-identity
session checks keep mounted screens hidden and blocked until verified; changed
actor/campus/world/access clears the presentation without changing durable journal
identity.

The [browser receipt](../artifacts/native-web-ui-20261029/back-browser-acceptance.json)
records the tested hierarchy, retained Scheduled assessment filter, Work return,
header/browser Back cancellation, approved leave with valid Forward, retained-tab
draft and clean cold-link anchors. The [native receipt](../artifacts/native-web-ui-20261029/back-native-acceptance.json)
records actual iPhone/iPad simulator hierarchy and Account-origin returns, the
iPad's retained Scheduled filter and portrait bottom tabs. The titled stock iOS
Back item keeps system navigation; cross-tab/local actions use a titled UIKit
control. Native swipe acceptance is still open: Device Hub edge-drag attempts did
not navigate. Android runtime, native dirty-exit dialogs, large text, keyboard,
scroll position and amber checks remain separate acceptance gaps.

Protected browser Back uses exact Navigation API entry keys after SDK rollback;
current Chromium, Safari26.2+ and Firefox147+ support this. Older browsers retain
the form and direct the person to the shared top Back control. There is no copied
app history stack or guessed return URL. See the owning
[interaction contract](../docs/blueprint/THATCAMPUS_OPERATING_EXPERIENCE.md#44-predictable-back-and-dismissal).

## Current universal workflows

The matrix records source behavior. Every newly ported flow remains unverified on
its actual browser/device, ordinary Live and isolated Simulation runtime, failure
and relaunch paths. `partial` identifies a concrete source or owning-contract gap.

| Canonical destination | Universal owner | Current source behavior | Remaining source / acceptance limits |
| --- | --- | --- | --- |
| `/today`, `/work`, `/areas`, `/more` | `WorkspaceScreen.tsx` · `implemented-unverified` | Server-composed current/next/attention work, completed automatic work, Needs me/Waiting, kind/search filters and pages, Areas, grouped More. Domain contributions still depend on backend availability. A contributed link alone does not imply its destination has a native implementation. | Contributions depend on current backend availability; a contributed destination alone does not prove a mounted native implementation. Full all-platform acceptance remains open. |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/demo` | `AuthEntryScreen.tsx`, `LoginScreen.tsx`, `PublicDemoScreen.tsx`, Google owners · `implemented-unverified` | Cookie/browser and Keychain native entry, MFA/register/logout/reset, manual reset token and password confirmation, fresh-link recovery and canonical post-reset sign-in, safe continuation, demo entry/profile switching and configured Google GIS/native state-S256 PKCE exchange use existing account/session owners. Cold or foreign callback grants are scrubbed before navigation. | Google is unconfigured in the current runtime; actual configured provider/device return, MFA/email/reset, cookie cross-tab, Keychain, continuation and all-platform visual/recovery acceptance remain open. |
| `/onboarding/start`, `/join`, `/workspace` | `OnboardingScreen.tsx`, `setup/*`, `JoinScreen.tsx` · `implemented-unverified` | Current purpose/start and progressive setup, exact invitation Join and workspace-unavailable repair have universal source owners. Company, account-security and already connected membership continuations resolve their current destination. Multiple starting goals plus primary first activity, create/reuse private workspace, whole-campus entry, verification and source-owned useful next actions are implemented; new workspace creation never occurs in Simulation. | Recipient email delivery/proof, wrong-account transitions, accepted-but-refresh-failed recovery, onboarding resume and all-platform visual/keyboard acceptance remain open. These Live control-plane workflows do not create app access inside a selected Simulation. |
| `/company`, `/company/institutions/:id` | `CompanyScreen.tsx`, `company/*` · `implemented-unverified` | Current Live Company console provides institution directory/detail/create, exact revision-based organization application approve/reject/request-information, administrator invitation/status/resend/revoke, demo enquiries and account security links. Company controls do not grant campus operational authority. | Company authorization, application/institution creation, invitation delivery/unknown-result inspection and all-platform runtime/visual acceptance remain open. No real institution or administrator invitation was created by this port. |
| `/more/account`, `/more/account/security`, `/account/security` | `AccountScreen.tsx`, `AccountPreferences.tsx`, `AccountSecurityScreen.tsx`, `AccountSecurityEntryScreen.tsx` · `implemented-unverified` | Account identity/name, current-campus switch, device appearance, sign-out, email verification, authenticator QR/key enrollment and confirmation, one-time recovery codes, signed-in sessions and revoke-other-sessions use current owners. Pro preference, Live memory read/forget/clear even with Pro off, and conditional demo-profile switching have source ports. Memory and external channel control-plane actions remain withheld in Simulation. Missing authenticator removal/code-rotation APIs are platform limits, not unported current editors. The incoming verification-email route preserves one validated proof through safe sign-in into the canonical security owner. Safe account/onboarding/email return, local authenticator QR and conditional demo-profile switching are implemented. | Security ceremonies, QR scanning, retained account state, campus switches and keyless preference/memory recovery require actual all-platform acceptance. |
| `/more/connections`, `/more/policies`, `/more/feedback`, `/more/verification`, `/more/governance` | `AccountConnectionsScreen.tsx`, `AccountCalendarConnections.tsx`, current More owners · `implemented-unverified` | Exact Calendar subscriptions/replace/disconnect, ICS export and selected-run preview; Live provider connections; published policies/version attention; current teaching-feedback and organization-verification flows; Governance authority map, policy drafts/review/publication, regulatory profile and audit history. | Calendar/provider/clipboard/share, governance independent policy review, Feedback privacy and organization verification authority need all-platform runtime acceptance. Keyless Account/Calendar/channel actions remain inspect-first after uncertainty; lost one-time private links cannot be reconstructed. |
| `/more/setup/*` | `PeopleSetupScreen.tsx`, `PeopleAccessScreen.tsx`, `InvitationsScreen.tsx`, `InstitutionSetupScreen.tsx`, topology/academic/organization/staff owners · `implemented-unverified` | Current manifest setup/People hub; private workspace and starting-point continuation; institution topology, academic catalogue/rules/history/promotion; organization hierarchy; staff responsibilities; exact account membership and Live invitation directory; whole-campus guide and mounted campus layout editor. Membership only edits active state; scoped roles remain in Responsibilities. | People setup/account-access/invitation source ports require runtime acceptance. Account access only changes current administrator/staff active state; scoped roles remain in Responsibilities. Generic access/invitation endpoints lack atomic revisions/replay receipts; unknown actions remain retained. Student/guardian invitation target IDs are preflight-checked because the current exact detail wire does not expose those legacy IDs. Whole-campus source intake, canonical place links, observation-source review/activation and published layout changes require actual all-platform Live/isolated Simulation acceptance. No real source was registered by this source port. |
| `/more/simulation` | `SimulationScreen.tsx`, `SimulationHistory.tsx`, `SimulationBehaviour.tsx`, `SimulationRunTools.tsx` · `implemented-unverified` | Baseline/scenario capture and exact saved-run opening, selected-world active settings/overview/results, start/pause/resume/stop, speed/end, original-snapshot duplicate, pin/unpin, reviewed discard/removal and Return to Live have source implementations. Current owner-paged Saved (five per page), latest-ten History including removed worlds, explicit 2–10-run controlled/exploratory comparison, recorded changes, paged contained effects/resource evidence and approved behaviour configuration are implemented in source. Unknown unkeyed lifecycle responses remain inspect-only. | Simulation control-plane lifecycle, behaviour edits, comparison provenance, storage/removal guards and ordinary domain changes need Live/isolated-run runtime acceptance. No world was created, started or removed by this source port. |
| `/more/virtual-campus`, `/areas/campus-view/*` | `CampusScreen.tsx`, `campus/*` · `implemented-unverified` | Published campus scene now uses retained Skia v2 pictures, detailed programmable assets, UI-thread pan/pinch and bounded people atlases with exact DT resource-state overlays. Zoom/pan/fullscreen, authored building floors and room/furniture plans, place/resource search, personal campus day, current source-linked operations/KPI panels and reviewed walking/step-free routes have universal source implementations. Published server scene changes appear after a successful refresh. Canonical scene editor now provides draft/history/reopen, source/GeoJSON/image/floorplan intake, capability-gated assistance or manual tracing, reviewed canonical place batches, geometry/floors/interiors/furniture/resources, undo/redo, explicit layout review and publication. Missing geometry/navigation/presence remains unknown and is never fabricated. Current journey/context/directions, campus_space, campus_focus/view, classes/events/maintenance layers, publication-bound asset context, floor/place/map controls and exact fullscreen return state have source implementations. Stale or foreign context does not become another person/world selection. Current edit=1, whole-campus setup steps and focused element guidance now mount the source-aware editor through the authorized campus directory. Save/import/publish require their actual owning capabilities and exact command/source recovery. | Current source/geometry import, tracing, floorplan editing, guided links, publication/reopen, current deep-link selectors, fullscreen/keyboard and all-platform visual/recovery acceptance remain open. Source tests and a rendered published map do not establish editor acceptance. Unknown imported geometry or physical location/occupancy is never inferred. Unsupported image assistance stays unavailable; manual tracing remains an explicit capability. |
| `/areas/people/participants*`, `/areas/people/groups*`, `/areas/people/records`, `/areas/people/import`, `/areas/people/classes/:id` | `PeopleScreen.tsx`, `PeopleAcademic*.tsx` · `implemented-unverified` | Canonical person/group search and pagination, reviewed one-person and bulk paste/CSV/TSV/XLSX creation, explicit duplicate identity choices, profile/contact correction, mentoring/family links, dated membership/containment/history and Live app invitation controls are implemented. Canonical learner enrollment and reviewed class move/withdraw/transfer, work-profile attachment/checks, guardian signing authority, record discovery, CSV enrollment import, assigned classes/dated notes and term promotion have source ports. The separate setup invitation directory is now ported; returned tokens are deliberately not displayed. Absent general employment/offboarding/group-closing APIs are not fabricated. | Bulk/import review, duplicate identities, canonical attachment, promotion and current assigned-class authority need device/browser and isolated-run acceptance. Current API limits on general employment/offboarding/group closing are not claimed complete. |
| `/areas/calendar`, `/areas/timetable/*` | `CalendarScreen.tsx`, `CalendarDateEditor.tsx`, `ScheduleScreen.tsx`, `SchedulePlanning.tsx`, `ScheduleAcademic.tsx`, `ScheduleDailyPlan.tsx` · `implemented-unverified` | Exact relationship Month/List Calendar and daily/week timetable reads, important-date publication/correction/cancellation, activity plan create/edit/publish, canonical People/place selection, academic year/pattern/teaching targets/closure setup and one-date Daily Plan review/publication/history have source ports. Calendar attention checks exact owning evidence; current date/view/search/type/entry/pagination/context continuations and academic coverage are implemented in source. | Source tests do not establish rendered attention acknowledgement. Native/browser date and zone/DST behavior, published-plan conflict recovery and all-platform Live/isolated Simulation acceptance remain open. Personal-deadline/term feeds absent from the current owning web/server contract remain unknown. |
| `/areas/attendance/*` | Attendance, Records, Evidence, Leave, Insights, Continuity, Offline and Photo owners · `implemented-unverified` | Participation registers retain encrypted exact drafts and save/submit/finalize/reopen. Academic daily and scheduled sessions now support four-status capture, observed-source notes, bulk marks, reasoned correction, finalization/reopening, paper/offline observation review and protected photo-assisted suggestions requiring human review. Current family/assigned records, comparisons, evidence/report decisions, eligibility/copilot, observation continuity and school/family leave flows have source ports. Signed daily roster/device observations use the scoped encrypted store and explicit sync; unknown commands retain exact originals. Existing 200-record leave history and keyless legacy leave receipt/revision limits remain. Family follow-up creation/response/history and institutional threshold controls have source implementations, with exact actor/learner responsibility and current owner responses. Follow-up attention and original-question recovery do not infer attendance. | Daily/offline/photo capture, exact correction/finalization, family evidence, question/threshold writers and access-change/relaunch tours need all-platform Live/isolated Simulation acceptance. Physical attendance is never inferred from a device signal or photo suggestion. A first scheduled prestart refusal can retain the original command conservatively; older leave APIs still lack atomic expected revisions/exact receipts. |
| `/areas/messages/conversations*`, message-report Care section | `MessagesScreen.tsx`, message moderation owner · `implemented-unverified` | Current-world direct/group creation, canonical contact/learner context, exact conversation/relaunch recovery, keyboard-aware footer composer, text/files/private downloads, own-message edits and private reporting/moderation have source implementations. Thread reads refresh every four seconds and directory/detail every ten seconds while focused/foreground; older cursor pages retain the slower read. Explicit earlier/newer pages differ from merged web scroll history. The report queue retains its 100-record cap; keyless legacy edits/moderation remain inspect-only after uncertainty. Group rename/membership/removal APIs are absent and are not invented. | Cursor navigation/scroll retention, media permissions, keyboard behavior, moderation/privacy and unknown legacy writes require all-platform runtime acceptance. Protected Care is implemented by its separate owner. |
| `/areas/care/concerns` | `CareScreen.tsx`, `CareForms.tsx`, `CareTeam.tsx`, `care-command.ts` · `implemented-unverified` | Current protected assigned-case discovery, intake, handling/evidence/reporting decisions, care-team and metadata-only owner recovery have a universal source port. Exact safeguarding.review/manage contributions now expose Message reports; its moderation writer remains separate. | 31 focused source tests cover strict case/access/source identity, protected narratives in session memory only, opaque durable receipt references and uncertain-result recovery. Actual browser/iOS/Android rendering, access-change, keyboard/accessibility, emergency dialer, Live/isolated Simulation writers and relaunch tours remain unverified. |
| `/areas/messages/updates*` | `UpdatesScreen.tsx`, `UpdatesFollowUp.tsx` · `implemented-unverified` | Exact responsibility/dependent list/detail, acknowledgements/choices, source-owned attention, multi-audience draft editing and reviewed publication have source implementations. Published-update cancellation, per-recipient filtering/follow-up, assisted responses, factual manual delivery recording and recipient delivery/audit history now use current endpoints and source revisions. No unsupported question/reply/resolution workflow is invented. | Recipient identity/revision conflicts retain typed entries for review. Delivery records are factual reports, not proof a channel delivered. Writer/recovery, keyboard and Live/Simulation runtime acceptance remain open. |
| `/areas/resources*` | `ResourcesScreen.tsx`, `ResourceCatalog.tsx`, `ResourceCustody.tsx` · `implemented-unverified` | Loans/items/mine, exact receipt history, issue/accessories/confirmed custody, partial/missed-return correction including empty replacement, due-date changes, questions and claimed returns retain existing journals. In-context one/bulk People creation and 1–100 exact item copies keep mounted issue choices. Named custodian handover/server-declared orphan recovery, current item campus/location/type, catalogue types/holdings and campus topology now have source ports. Individual items retain tag/quantity-one rules; pooled holdings do not inherit individual tags. Keyless setup uncertainty permits inspection only, not matching-row acceptance. | Loan history is capped at 200 receipts with no separate older-receipt read. Catalogue reads are unpaged owners shown in ten-row views. Unsubmitted issue entries are local. Custody handover, catalogue changes and isolated-run/relaunch acceptance remain open. |
| `/areas/facilities*` | `FacilitiesScreen.tsx`, `FacilitiesExternal.tsx`, `OperationsWorkInvitation.tsx` · `implemented-unverified` | Problem reporting, location/item, urgency/impact, accept/update/wait/complete/verify/reopen, handler/verifier/coordinator changes and history retain exact sources. JPEG/PNG camera/Files evidence up to 5MiB uses original verified bytes and private download/share. Manager-assisted reporter selection, metadata-only orphan routing, canonical technician creation and external technician grant/activate/end/expiry recovery are implemented. Accepting an external job requires separately confirmed activation followed by a fresh accept command. Live-only work-app invitations never send from Simulation. | Camera/Files permission and cancellation, selected-photo sharing, external technician activation/expiry, live invitation delivery and interrupted/relaunch recovery require runtime acceptance. Minimal recovery must not reveal private problem/history bytes. |
| `/areas/dining*` | `DiningScreen.tsx`, `DiningWeekly.tsx`, `DiningDate.tsx`, `DiningTimeFields.tsx` · `implemented-unverified` | Published hours, one-date session drafts/publication/state changes, cumulative counts/corrections and shortage handling use current owners. Weekly composition includes per-day menu/operator/place/hours, copying, optional end, campus zone/DST fold, preview and reviewed publication; derived-date open/change/cancel and weekly revise/stop/recovery retain exact source revisions. Ordinary session/issue recovery-only views now support explicit operator/coordinator/handler transfer with minimal metadata. Failed reads hide private content while retaining mounted editors; source revisions require review without clearing typed notes/count/menu. New observations/opening recheck the selected-world clock and exact current source. Canonical place creation is available in place choices, and responsible-person choices require current app eligibility. | Current server history/option windows remain bounded. Weekly/derived-date DST folds, fresh-clock count/opening, minimal orphan recovery, canonical place callbacks and all-platform Live/isolated Simulation interrupted/relaunch acceptance remain open. |
| `/areas/accommodation*` | `AccommodationScreen.tsx`, `AccommodationSetup.tsx`, `CanonicalSpaceCreate.tsx` · `implemented-unverified` | Room/stay list/detail, offer/allocation, resident/assisted responses, observed move-in/out/correction, extension/end, reassignment, linked existing access-loan, closure and history retain current owners. Room-type defaults/capacity/allocation/status, residential uses, optional named places and exact bed holding use canonical setup editors. Stay creation/action times require the verified selected-world clock with no host fallback; actual observation and planned intervals are checked again before save. Failed/stale stay reads retain mounted form entries and require current-source review. Resident choices now reuse canonical bulk People creation, and the mounted arrangement can create a room use through the existing room/place writer, selecting only a fresh eligible returned identity. Responsibility transfer refreshes the current queue without demanding former private detail. | Physical move evidence, response authority, room/type/place setup, capacity conflicts, linked resource custody, canonical creator callbacks and all-platform Live/isolated Simulation writer/relaunch acceptance remain open. A stay, room or named bed does not imply occupancy, furniture issue or key handover. |
| `/areas/responsibilities/*`, `/work/staff-leave`, `/more/setup/responsibilities*` | `StaffWorkScreen.tsx`, `StaffManagement.tsx`, `StaffRoles.tsx` · `implemented-unverified` | Current personal assignment/offers, leave balances/impact/application/withdrawal, cover responses and reviewer approve/decline/reroute retain owning scopes. Review never silently grants coverage. Staff directory/profile/checks, work types and permitted actions, scoped dated role assignments/change/end, policies/balance adjustment, coverage board/offers, review routes and fallback policy now have source implementations. Canonical work attachment remains owned by People. | Role/access effects, independent leave/review routing, cover outcomes, keyless setup uncertainty and Live/isolated Simulation visual/recovery acceptance remain open. |
| `/areas/in-out*`, `/work/in-out/approvals` | `GateScreen.tsx`, `GateManagement.tsx`, `GateVisitorEntry.tsx`, `GateVisitEditor.tsx`, `GateVisitSharing.tsx`, `GateVisitDetails.tsx`, `GateVisitOnboarding.tsx`, `GateVisitParticipant.tsx` · `implemented-unverified` | Management now has source-owned student/pickup/visitor pass issuance, volatile QR/expiry and explicit download/share. Operate restores Hindi/English, section continuations, office call and exact authorized identity references. Native QR/exact identity, observed entry/exit, pickup authority, approvals/movement, visits/cancel/arrival/exit and private questions remain separate from attendance and planned visits. No-host visitor/photo capture, arranged visit create/edit, canonical organiser selection and exact sharing grant/renew/revoke/takeover have source ports. Shared guest changes history now renders the actual minimized latest-25 safe plan snapshots with timezone/expiry, and uses the owner latest-50 private question bound. No absent older-page API or private canonical revision is invented. Live-only app invitations and exact sharing receipt/source/root/revision recovery remain explicit. Manager detail now has the shared reference presentation and one group visitor-link source with explicit issue/reveal/replace/revoke and Share/Email/Copy. Its own-participant view exposes minimized registration/plan data, never private organiser data or entry/presence authority. | Backend209/schema280 activates campus-or-place destinations and the topology-metadata safeguard; wider group-link/participant runtime, mailbox, OS share and rendered recovery acceptance remain open. Legacy visitor movement still lacks a separate exact receipt lookup; unknown responses cannot be accepted from matching current movement state. Private-photo cleanup and retained camera-preview P2s are source/test-closed by the corrected independent delta review; actual camera interoperability remains unverified. Camera/QR/original-photo recovery, sharing renewal/takeover/access loss and all-platform Live/isolated Simulation acceptance remain open. |
| Native-only `/visit-join` (outside the 129 legacy routes) | `VisitJoinScreen.tsx`, `visit-join-continuation.ts`, `visit-onboarding-request.ts`, normal Session/Account Security owners · `implemented-unverified` | Credential-scrubbed memory nonce, current visit preview, email-proof/neutral account entry, normal Login/MFA continuation and exact actor-bound join/recovery have source and mounted checks. Foreground completion selects only the exact campus/participant destination. | The reviewed checkpoint has no usable SMTP mailbox delivery; native HTTPS associated-link launch is unconfigured. Cold process loss needs the original link. Backend activation, host availability and isolated tests do not establish browser/iOS/Android functional acceptance. |
| `/areas/fees*`, `/work/fee-reviews/:id` | `FeesScreen.tsx`, `FeesAuthoring.tsx`, `FeesArrangements.tsx`, `FeesLegacy.tsx`, `FeeOnlineCheckout.tsx` · `implemented-unverified` | Authorized ledgers/accounts/invoices/receipts, exact payment reports/questions, independent reviewer decisions/withdrawal, review recovery and private receipt downloads retain current owners. Charge batch review/issuance/correction, recorded receipt correction/reversal, payment settings, manual receipts, legacy review and provider reconciliation have source implementations. Payment-date proposals/decision/withdrawal, dated self-payer access and Finance mandate adoption use current authority. Sandbox online checkout is linked-guardian/config gated: native lazy react-native-razorpay3.0.0 and web hosted Checkout use server order/status/verify. Only exact captured server status plus receipt is acceptance; cancel/unknown keeps the original order/amount. Simulation records its ordinary pending-only isolated order without opening a provider or inventing capture. | Gateway is disabled by default and requires non-production test-key/server-secret configuration. No flags, credentials or real payment were changed. SDK dependency/pods are present; a new native binary plus actual open/cancel/return/status/private receipt acceptance remains required. Payment callbacks/signatures stay volatile; only whitelisted scoped checkout metadata is encrypted. Keyless legacy finance APIs require inspect-first recovery. All-platform independent finance review, receipt/reconciliation, isolated Simulation and relaunch acceptance remain open. |
| `/areas/assessments*`, `/areas/results*` | `AssessmentsScreen.tsx`, `AssessmentAuthoringScreen.tsx`, Evidence and Exam Day owners · `implemented-unverified` | Family results/published reports, exact assessment result marking/correction, moderation/publication, exam start/complete and invigilation responses retain current sources. Assessment/cycle authoring, current arrangement review, immutable evidence upload/private download, candidate attendance, incident recording/resolution and exam duties now have source implementations. Academic report composition uses the separate Reports owner. | Candidate attendance remains an actual observation. Evidence/file recovery, examination revision conflicts, independent publication and all-platform Live/isolated Simulation acceptance remain open. |
| `/areas/reports`, `/areas/reports/progress`, `/areas/reports/remarks` | `ReportsScreen.tsx`, `reports/*`, report policy/command/print helpers · `implemented-unverified` | Source-verified issued progress/marksheets, grading policies/GPA lineage, native/browser Print/Save PDF, policy/scheme mapping, draft generation/correction, teacher/principal remarks, independent review and publication use current owner APIs. | New canonical Reports source port has 23 focused local tests but no current all-platform visual, writer, private print, independent-review or Live/Simulation runtime acceptance. Print registration is present in the rebuilt iPhone/iPad client and Android Debug APK; OS print/share interaction remains unverified. Exact grading idempotency receipts support replay, but a generic409 or refusal after prior uncertainty cannot release retained intent because the current API has no typed absent-receipt proof. Unknown current state is never treated as accepted. |
| `/areas/departure*` | `DepartureScreen.tsx`, `DepartureTransport.tsx`, `DeparturePickup.tsx` · `implemented-unverified` | Exact self/dependent plans/requests/withdrawal, collector trip response/boarding/start/complete, observed rider outcomes/concerns and factual handover retain current owners. Routes/stops, effective learner stop assignment, weekly patterns/bounded generation, dated duties, cover/exchange decisions, managed reconciliation, pickup authority and assisted plans/requests have source ports. Collector cancellation now rechecks actual assignment/date/window and on-board/exception constraints, retains the original reason and uses inspect-only recovery for unknown keyless results. The embedded native map supports pan/zoom/recenter/stops and source-configured tiles. Manual/location stop focus uses the shared exact clock/source policy; linked plan/student/date, request and duty/trip continuations fail closed when changed/unavailable. Foreground sharing stops on blur/background/callback drift; family coordinates are hidden outside the exact in-progress boarded journey. | Location remains foreground-only; background/locked-screen tracking is not claimed. Current source/provider tile coverage and map gestures, factual boarding/handover/cancellation, duty/reconciliation receipts and all-platform Live/isolated Simulation interrupted/relaunch acceptance remain open. Keyless legacy changes remain inspect-only after uncertainty. Missing or stale locations remain unknown, not a promised live position. |
| `/areas/events*` | `EventsScreen.tsx`, Editor/Finance/Register/Administration/Attention owners · `implemented-unverified` | Exact operations/self/dependent directory/detail, RSVP/consent/preparation, reviewed draft arrangement/publication/cancel/complete, manual paid withdrawal/refund evidence and physically observed session registers retain current owners. Saved draft discard, exact source/version attention, verified consent-authority grant/revoke and current attendance-policy rules now have source implementations. Published arrangements remain immutable; no absent per-session registration API is fabricated. Administrator discovery still requires actual work-profile/organizer authority. | Earlier representative iPad event-draft acceptance does not cover new authority/rules/attention, paid withdrawal/refund or register workflows. All-platform Live/isolated Simulation and interrupted/relaunch writer acceptance remain open. |
| Teaching sessions, assignments, diary and `/areas/learning*` | `LearningScreen.tsx`, `LearningOfferings.tsx`, `LearningAssignmentComposer.tsx`, Practice/Work Link owners · `implemented-unverified` | Saved-lesson-first teaching sessions, optional mounted preparation/report, exact private materials/history, text/link/file and version replacement, assignment private drafts/uploads/submission/receipts/feedback and personal diary controls retain current sources. Current learning-group creation, roster/instructor management, reviewed assignment create/edit/publication, class-practice publication/private instructor replies and teaching-work linking have source ports. Canonical People identity/revisions are reviewed; published audience/instructions are fixed and earlier material versions remain history. | File selection/hash/recovery, late/submitted work, instructor changes, private replies, material version history and all-platform Live/isolated Simulation writer acceptance remain open. |
| `/areas/insights*` | `InsightsScreen.tsx`, `insights/InstitutionInsights.tsx` · `implemented-unverified` | Contribution-derived institution/assigned/self/dependent views, five analytics topics and six institution reviews retain exact filters, paging, source links and honest unavailable data. Review periods use the universal browser/native civil-date control bounded by the verified selected-world campus date. Release203 fixes administrator assigned-work eligibility without broad institution access. Actual Director web My work, populated Results and labelled Back return pass. | Family/isolated Simulation, iPhone/iPad/Android topic/drilldown and exhaustive visual/recovery acceptance remain open. No native domain writer. |
| `/areas/assistant*` | `AssistantScreen.tsx`, policy/command and shared entry owners · `implemented-unverified` | Original artwork, Live history/run/status, structured source charts, pinned composer, proposed confirm/reject and exact retained-command recovery use current owners. Native tool requests retain the original verified Bearer through internal owning HTTP with fresh session/domain checks and actor/world fencing; browser CSRF and channel delegation remain separate. Account owns Pro, memory and connections. | An actual iPhone read-only provider question and owning Assessment tool/source/labelled-Back journey pass. Consequential approval/reject, permission-change, provider-failure and interrupted/relaunch acceptance remain open. Simulation deliberately excludes Live provider execution, memory and channel account links; negative isolation and all-platform accessibility/keyboard checks remain open. |

Notifications use `NotificationsScreen.tsx` and exact source links. The list is
not a universal approval/completion mechanism; the destination owns attention.

## Scope and result recovery

- Calendar and Timetable relationship selection is pure-tested in [`test/schedule-access.test.ts`](test/schedule-access.test.ts). An explicit child route cannot fall back to the actor's activity endpoint, even when the actor also manages the campus. Responses must identify the selected learner.
- Resources, Facilities, Dining and Accommodation use [`src/lib/recorded-command.ts`](src/lib/recorded-command.ts): one subscribed secure journal per account/campus/world/domain prevents retained native stack screens from overwriting an unknown action. Retain the exact original source, applicable revision, body and command ID before dispatch; check the owning confirmation; retry the identical command only. A generic conflict does not unlock the form. Resource item creation has no loan confirmation: recovery replays only the exact idempotent item request, verifies the original count and every deterministic ordered copy ID, and accepts valid current copies after later inventory edits. Accepted recovery only refreshes its source. Legacy catalogue writes have no exact command receipt and remain inspect-only after a lost response; a matching catalogue row cannot clear the retained action.
- Facilities settings and photos use [`src/lib/native-pending-action.ts`](src/lib/native-pending-action.ts) with exact actor/campus/world/origin, reviewed source/revision and owning receipt. Photo recovery retains verified file bytes/hash, original key/body and exact repair; clearing requires the accepted receipt's exact ID, original revision plus one and `photo_added` action. A saved report remains saved if its separate photo upload fails. Simulation source-omitted evidence cannot be exported or borrowed from Live.
- Fees uses [`src/lib/fee-action-policy.ts`](src/lib/fee-action-policy.ts): a definite first refusal lets the user correct entries; an ordinary refusal after an earlier unknown POST retains the command. Only the exact Finance `native_fee_review_obsolete` proof with an absent receipt can release an obsolete action. Proven acceptance survives refresh/storage failure. Recovery withdrawals confirm through their own private recovery endpoint.
- Gate uses [`src/lib/gate-command.ts`](src/lib/gate-command.ts): all Gate screens in a retained native stack share one secure journal per account/campus/world. Recovery/query refusals keep the exact original command. Visit receipts must match the visit/revision; sharing receipts also match the share, root, question, action and revision. Exact owner `visit_changed` / `visit_sharing_changed` absent-receipt proof requires a current source review. Legacy visitor movement has no separate owner receipt endpoint: if its accepted response was lost, a later generic conflict remains unresolved rather than being labelled success from the latest visitor state.
- Group visitor-link issue/revoke uses the exact Gate allowlist in [`gate-visit-onboarding.ts`](src/lib/gate-visit-onboarding.ts) and `native-pending-action.ts`, separately from older Gate command receipts. Its actor/campus/world/origin/source/revision/body and opaque receipt must match; a lost response cannot create a replacement intent. Pure current-link reveal is unjournalled. The URL stays volatile and clears on close, blur/background, scope/authority/source change or expiry; explicit Share/Email/Copy opens the user's chosen surface and proves no delivery. Simulation never falls back to a Live public link.
- Public visitor continuation retains only an origin-bound memory locator/nonce, bounded to 30 minutes and four entries. A cold process must reopen the original link. Account creation does not manufacture a session; normal Login/MFA precedes joining. Unknown join dispatch retains the authenticated actor and original command across remount; accepted completion resumes only in foreground and does not repeat the mutation. The [public handoff](../artifacts/native-web-ui-20261029/visit-join-final-review-handoff.json) distinguishes these source checks from mailbox and associated-link limitations.
- Events and Learning retain exact commands/files for permitted replay across launches through [`src/lib/native-pending-action.ts`](src/lib/native-pending-action.ts). Assessment invigilation and Departure duty swaps retain their actual command IDs. Keyless legacy Departure/Assessment writers stay inspect-only after uncertainty. They do not replay an unkeyed observation automatically.
- Reports uses [`academic-report-command.ts`](src/lib/academic-report-command.ts) and the encrypted `academic-reports` device journal: one exact actor/campus/world/server request, source revision, body and idempotency key is committed before dispatch. Current policy/scheme/subject/remark/release writers all accept that key. A lost response retries only the original request; an accepted receipt retains its exact target and recovers by reads. No generic409 clears an unresolved command. Unsubmitted edits remain local and use the shared losing-exit guard.
- People review commits retain the immutable server review URL, exact empty request and fingerprint; the server authorizes the actor/campus and returns its saved commit receipt before expiry checks. Guardian authority retains its current source/revision and explicit verified decision. Work onboarding without an exact receipt remains inspect-only after a lost reply.
- Native mutation preparation captures the transport binding before storage/file work and checks it again before dispatch. An account, campus, world, origin or credential rebind during preparation cannot send the old intent through the new binding; it also cannot discard an earlier unknown result.
- Durable recovery coverage varies by domain. Inspect each screen's command mechanism when adding new writes; do not infer cross-launch recovery from a visible retry button or from another domain's helper. There is no general offline mutation queue.
- Private download bytes use the authenticated transport and a temporary local file/native share sheet or bounded browser Blob download. Simulation source-omitted placeholders are refused. Native uploads retain Expo’s verified-byte file-part interface; browsers use real named Blob parts with the same captured fields and bytes.

## Operations and guarded sandbox checkout

Current operations ports add custodian handover/orphan recovery; assisted repairs
and exact external technician grant/activate/end; room/type and reusable canonical
place setup; weekly menus and derived dates; observed visitor creation/photos,
arranged visits/sharing; routes, service patterns, collector duty changes, pickup
authority and rider reconciliation. Campus topology reuses the same catalogue and
place writers for campuses/spaces/resources/holdings, dated class/staff placements
and explicit observation sources. A place, visit, device signal or staffing change
does not manufacture authority, attendance, occupancy or physical handover.

Time-sensitive operations sample the verified ordinary workspace virtual clock
and campus zone through `use-operation-clock.ts`; they do not borrow Live/device
time when a Simulation sample is missing. Dining cumulative counts/opening and
Accommodation offers/observations also recheck that clock immediately before
dispatch. Empty temporal fields no longer render a host-time default. Local form
values stay mounted on failed reads, hide private content while access is
unconfirmed and require explicit review of source revision changes. Only the
correlated accepted result closes an editor. Minimal Dining responsibility
recovery changes only the explicit handler/operator/coordinator; Accommodation
transfers refresh its queue without requiring former private detail. Canonical
Dining place and Accommodation resident/room creation retain the parent draft
and accept only fresh eligible owning-option identities.

The checkout port uses the existing linked-guardian invoice owner, server sandbox
flag/test key, server order/status/verify endpoints and exact private receipt.
The gateway remains disabled by default; no key, flag or real payment was changed.
`react-native-razorpay` 3.0.0 is lazy-loaded only on native; browser Checkout uses the
current hosted SDK through its separate adapter. A missing native ABI blocks order
creation. The installed dependency and successful pods do not establish a loaded
SDK: its registration in the installed binary and actual open/cancel/return
checks still require acceptance.

Callbacks and signatures stay in volatile memory. The encrypted retained attempt
contains only the exact scope, original invoice/order identity, amount and phase.
A callback does not create a receipt: the server must verify the signature, and
the exact order status must report captured money and the receipt identity.
Cancellation, interrupted verification or a lost refresh retains the original
order for inspection; retries do not silently replace its amount/order. Simulation
uses the ordinary run-local pending-only order and never opens the provider,
invents capture or claims money moved. See the primary
[Razorpay Android](https://razorpay.com/docs/payments/payment-gateway/react-native-integration/standard/integration-steps-android/)
and [iOS integration](https://razorpay.com/docs/payments/payment-gateway/react-native-integration/standard/integration-steps-ios/)
docs and [Expo native dependency boundary](https://docs.expo.dev/develop/development-builds/faq/).

The owned combined operations source selection passed 117 tests in
[`operations-final-tests.log`](../artifacts/native-web-ui-20261029/operations-final-tests.log).
The subsequent checkout selection passed 12 tests in
[`fee-checkout-tests.log`](../artifacts/native-web-ui-20261029/fee-checkout-tests.log).
The later recovery/clock/setup/command selection passed 51 tests in
[`operations-recovery-tests.log`](../artifacts/native-web-ui-20261029/operations-recovery-tests.log);
the matching direct mobile TypeScript check is clean in
[`operations-recovery-typecheck.log`](../artifacts/native-web-ui-20261029/operations-recovery-typecheck.log).
Invitations/Access and journal/source checks passed 35 tests in
[`people-access-tests.log`](../artifacts/native-web-ui-20261029/people-access-tests.log).
These selections overlap and are not a suite total. They are source/controller
tests; no payment, real registration, invitation, device or domain write was
performed by this port.

The current People setup hub derives its rows from the normalized exact manifest.
Account access ports only the mounted current administrator/staff membership
active-state editor; Invitations has its own create/status/history/resend/revoke
owner, and Responsibilities owns scoped roles. Both generic writers preserve the
original source and use inspect-only recovery after uncertainty. An acknowledged
invitation ID is read through its exact owning detail before journal release;
returned one-time credentials are neither displayed, cached nor persisted. The
legacy detail wire omits student/guardian target IDs, so those IDs are checked
against the fresh owning workspace before submission rather than inferred from
matching names/email later. Last-administrator protection remains server-owned;
self-deactivation can remove access to a later recovery read.

## Universal device storage

Journal callers use [`device-storage.ts`](src/lib/device-storage.ts). iOS and
Android delegate unchanged to Expo SecureStore with the same keys, options and
chunk manifests. Browser callers resolve [`device-storage.web.ts`](src/lib/device-storage.web.ts):
only existing scope-hashed journal namespaces are accepted; session/bearer
credentials and appearance preferences do not use this store. Each value is
AES-GCM encrypted with its exact key as authenticated context. A nonextractable
CryptoKey is structured-cloned into the same origin's IndexedDB key store.
There is no localStorage key, plaintext/memory fallback or background replay.
Missing keys beside retained records, unreadable bytes, quota/permission failures
and unsupported native authentication options reject instead of looking empty.
Writes/deletions resolve only after their IndexedDB transaction completes.

The shared attendance draft policy keeps the exact actor/campus/world/server/
register identity, revision and pending request bytes. Native attendance remains
SQLCipher with its device Keychain key; [`attendance-draft.web.ts`](src/lib/attendance-draft.web.ts)
uses the encrypted browser store and ordered draft writes/deletion. Browser
storage is origin protected and may be denied or evicted; it does not provide
hardware Keychain/device-lock guarantees or defend against same-origin script
compromise. Browser auth is a separate cookie transport concern. The choice
follows the [IndexedDB transaction contract](https://www.w3.org/TR/IndexedDB/) and
[Web Crypto key serialization contract](https://www.w3.org/TR/webcrypto/).
Actual browser reload/quota/private-mode behavior remains a separate acceptance
gate from the fake-indexeddb/WebCrypto tests.

## Universal private files and temporal inputs

[`private-file.ts`](src/lib/private-file.ts) keeps the native DocumentPicker,
app-private staging folders, size/hash checks and verified-byte upload contract.
The browser adapter uses the actual selected File object. Selected handles stay
in memory until staged; they cannot hydrate as retained actions. Before dispatch,
immutable bytes are encrypted in the journal store under a durable handle bound
to the exact actor/campus/world/server scope and pending/leave purpose. Reloads
verify their original size and SHA-256; missing, corrupt, foreign or denied bytes
block dispatch. There is no fake `file://` URI or different-file substitution.
Chat, Learning, Facilities photos and Attendance leave documents share the platform
adapter while retaining each owning media policy, limit, source and receipt guard.

Browser multipart parts are actual named Blobs copied from the verified bytes;
native multipart remains unchanged. Local photo previews allocate and revoke Blob
URLs. Authenticated private downloads retain the bounded transport's origin,
context, MIME and Simulation-omission checks, present a temporary Blob URL and
release it after presentation/failure; downloaded bytes are never journaled.
This follows the browser [File API](https://www.w3.org/TR/FileAPI/).

Resources/Facilities/Accommodation's shared time field, Dining, Staff work,
Learning, Updates, Events and Simulation now resolve explicit HTML date or
datetime-local controls on web. Native branches retain their existing pickers.
Calendar dates retain their civil day; local date/time conversion retains seconds,
milliseconds and exact min/max constraints and refuses nonexistent DST times.
The controls follow the [HTML local date/time model](https://html.spec.whatwg.org/multipage/input.html#local-date-and-time-state-(type=datetime-local)).

Pure browser adapter tests and TypeScript do not accept actual browser file
dialogs, save behavior, interrupted reload recovery or cross-platform
visual/keyboard behavior. These remain browser/simulator/emulator checks.
Physical camera/device permissions remain untested hardware limitations, not
old-web retirement prerequisites.

## Account preferences and connections

Pro is an account-wide optional preview, including when viewed from Simulation.
Turning it off dismisses pending AI work through the existing Auth owner. The
accepted setting updates only the same actor/server's actual nested session cache
keys, removes Assistant caches and refreshes workspace contributions; ordinary
Messages remain separate. Live memory is inspectable/deletable with Pro off, as
required by [the Assistant contract](../docs/blueprint/SCHOOL_AGENT.md#bounded-long-term-personalization),
correcting the current web Profile's conditional-display drift. Simulation never
mounts a memory/channel read or writer and never presents cached Live memory.

Connection contexts come from current manifest contributions and exact learner
relationships, without inferring authority from membership labels. An explicitly
revoked selection requires a new choice. Calendar responses validate the selected
context and reject contradictory evidence markers. The current status owner omits
Simulation markers, so its absence is accepted only under the already confirmed
selected-world transport; Simulation creation requires explicit isolated evidence
and the exact authenticated preview route. Public feed links may use the server's
configured HTTPS public host rather than a local API proxy; only the exact owning
token-feed path is accepted. Private URLs stay in local component state, are never
journaled/logged, and disappear on context change/blur. Browser clipboard and
external-link actions retain the initiating tap rather than awaiting a network read.

The current Pro, memory, Calendar and channel writers have no command-ID/exact
receipt contract. [`AccountCommandGate`](src/lib/account-command.ts) shares one
in-process gate per exact scope/action family across retained screens, snapshots
the original request and never automatically replays an unknown result.
Acknowledged writes with failed refresh recover by read only. An unknown result
requires a fresh current-state inspection and an explicit new choice; Calendar
replacement warns that the old link stops working, while a lost one-time private
URL cannot be recovered. Source fingerprints/id/revision are rechecked before
destructive/replacing calls, but these APIs lack server expected-revision guards;
that remaining race/receipt limitation is not a cross-launch recovery guarantee.

The chosen presentation uses native switches/choice sheets, restrained grouped
settings and existing reduced-motion-aware disclosures. Clear-all and replacement
receive a distinct review step; routine reads and individual Forget actions stay
compact. Research: [Apple toggles](https://developer.apple.com/design/human-interface-guidelines/toggles),
[Apple alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
and [React Native Linking](https://reactnative.dev/docs/linking).

## Restricted Care privacy and recovery

The current [Restricted Care workflow](../docs/blueprint/RESTRICTED_CARE_WORKFLOW.md)
owns applicability, authority, evidence and operational review. The universal port
uses its ordinary institution endpoints and selected-world transport. It does not
grant case access from an administrator title or care-team label. Reporter-only
reads reject later notes and privileged sections; owner recovery projects routing
metadata without exposing allegations. Captured original protected bodies remain
explicitly omitted in Simulation. Temporal controls use the verified workspace's
virtual clock sample and campus zone; missing values do not borrow device/Live time.

The dedicated [`CareCommandJournal`](src/lib/care-command.ts) persists a strict
whitelist of opaque scope, command/case identity, kind, expected revision, phase
and native receipt metadata in the encrypted `care-receipts` namespace. It rejects
unexpected fields instead of silently admitting a protected note, request body or
callable operation. Private immutable request closures and narrative fields live
only in the active Care session. Confirmed losing exits, last-owner unmount and
account/campus/world changes discard those private bytes. A full restart retains
only the exact reference to check; it cannot reconstruct or replace a concern.

Uncertain saves require exact confirmation. An explicit same-session retry uses
the unchanged original command/body only after an owning `not_found` result;
another pending/failed confirmation withdraws that option. Typed exact refusal or
the owning `not_accepted` result requires source review before a new intent. A later
generic access error cannot discard an earlier uncertain command. Accepted saves
drop private retry bytes before refreshed views load; failed refresh/storage clear
keeps read-only recovery. A confirmed handover never requires the former owner's
full case access. Keyless team APIs use a local, opaque-path-only inspection gate
and retain no protected reason in a global or persistent retry journal.

Protected reads are memory-only, focus/foreground gated and require a fresh source
read after re-entry. Current read failures hide protected content and disable new
actions while preserving mounted session drafts. Invalid/changed identity or
capability removes the protected workspace. Single top navigation uses the shared
exit guard; successful correlated intake/handover completion retires the completed
editor through the shared navigation API. There are no page-body Back controls.

The chosen approach retains the active mounted web workflow rather than adding
offline narrative storage or copying older unused case pages. The native fields
disable autofill/autocorrection/spellcheck using the supported
[React Native TextInput controls](https://reactnative.dev/docs/textinput).
The explicit emergency action follows the current owning procedure and India's
[ERSS 112 route](https://112.gov.in/). Device dialer, app-switcher/privacy behavior,
screen readers, Light/Dark/amber layouts and institution operating approval still
require runtime acceptance. A recorded external reference is not an external filing
or proof of statutory compliance.

## Acceptance and remaining gaps

The Reports source port passes23 focused policy, command, print and attention
tests. The source-backed print renderer escapes user content, has no remote
assets or scripts, and refetches the exact authenticated learner/publication
before printing. Native Print passes HTML directly to the OS; Save PDF uses only
the app-private cache and removes its temporary file after the share sheet.
Browser Print/Save PDF reserves an isolated window in the explicit click gesture;
it does not print application chrome or save private HTML in the workspace.
An interrupted process can still leave an Expo-generated private cache PDF;
device cleanup/relaunch behavior needs runtime acceptance. The OS/browser owns
the final print dialog, and opening it is not proof of physical printing.
The reviewed technical option is [Expo Print](https://docs.expo.dev/versions/latest/sdk/print/):
its web implementation prints the current page, which is why the universal app
uses an isolated source document for browser marksheets. A browser fallback to
the old web app was rejected for these current canonical flows.

Representative iPhone/iPad Live and isolated Simulation checks exist for the
workspace, attendance, People, resource catalogue, Facilities and Events, plus
campus-scene rendering and Insights reads. They do not cover every writer, paid
workflow, permission, failure state or device. Current bounded evidence and remaining
role/platform gates are in [verification](../docs/VERIFICATION.md#native).

Native source, platform exports and installed-binary checks are separate from
workflow acceptance. Android is authenticated and has bounded Today, Areas,
Attendance-read and Assistant checks. The shared Assistant now uses one retained
bubble over the actual workspace, an expanded iPad conversation beside the usable
app, full-screen phone presentation and Copy beside Expand/Collapse. The single
Glass composer, draft and conversation remain mounted through mode and rotation. These checks close none of the29 groups' remaining runtime gates.
Browser/simulator/emulator accessibility, broader domain parity and recovery
checks remain open. Physical hardware, release signing/store distribution,
push/background delivery and exhaustive performance remain separately untested;
physical-device checks do not block old-web retirement under the owner decision.
Original Assistant artwork uses explicit Light/Dark feather colors and native
motion; interactive busy/loading, amber and Reduce Motion require their own checks.
Do not infer these from a source test or an older preview APK.

Run `npm test` for the current test total. Historical counts and preview hashes
remain in the external documentation recovery archive, not as current release claims.
