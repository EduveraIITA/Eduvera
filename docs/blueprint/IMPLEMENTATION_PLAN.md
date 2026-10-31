# Current delivery and next work

Updated 31 October 2026. This is current bounded delivery status, not a release diary
or a claim that the full product blueprint is complete. Requirements live in the
[contract index](README.md); repeatable checks, exact receipts and fixture tours
live in [Verification](../VERIFICATION.md). The original chronological record is
recoverable through its [archive manifest](../VERIFICATION.md#documentation-recovery).

## Verified local baseline

The latest normal activation is **release209/schema280**, fingerprint
`sha256:9d26530bb392241b87758aa195c387216b2ac8bf79277f58d18e81e66b2d2e9e`. The
[reviewed stage](../../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-reviewed-stage.json),
[activation receipt](../../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-activation-verification.json)
and [native Bearer check](../../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-native-http.json)
bind the source-only campus-metadata correction, strict types/conformance and
preserved existing domain rows. The
[208 activation](../../artifacts/native-web-ui-20261029/profile-polish/visit-campus208-activation-verification.json)
retains migration279/280 proof, with
checksums through278, two protected worlds and unchanged environment/public origin.
The sole API supervisor remains ready. The regression proves campus metadata and
identity revisions stay unchanged; normal had no entire-campus visits before the
fix. Private Live/Simulation backups and prior205/208
binaries are retained. 208 contains the reproduced metadata defect; prefer repair
forward. 205 binary fallback is safe only before any whole-campus
visit is saved. Afterwards preserve current data and repair forward; no automatic
schema/data downgrade is authorized or claimed tested. Fresh209 captures are
required for the new destination shape; protected older worlds stay unchanged.
Coverage remains incomplete. Email remains off and the SMS adapter disconnected.
The profile API is now active, with 24 isolated private-profile checks; current
rendered profile/photo/phone-flow acceptance remains separate.

Live development is active at
[the same temporary HTTPS origin](https://quit-cloth-shore-listing.trycloudflare.com).
The managed Mac web host runs `mobile/scripts/serve-web-preview.cjs --mode
development --metro-origin 'http://[::1]:8084'`, using the SSD checkout, normal
`dev.thatcampus.web` job and existing port 5173/Cloudflare process. The same-origin
API 8000 cookie/CSRF ceremony and campus history remain unchanged; no Vite server
is involved. [18 HTTP/WebSocket checks](../../artifacts/native-web-ui-20261029/live-development-host-tests.log),
the [real Metro probe](../../artifacts/native-web-ui-20261029/live-development-existing-metro-probe.json)
and [isolated candidate](../../artifacts/native-web-ui-20261029/live-development-host-root-candidate.json)
verify local routing/HMR protocol boundaries. The
[public activation](../../artifacts/native-web-ui-20261029/live-development-public-activation.json)
and [rendered source probe](../../artifacts/native-web-ui-20261029/live-development-hmr-source-probe.json)
confirm the signed-in app and a component edit/restoration without reload, with
input retained and the owned test input cleared. Refresh an old frozen client
once; subsequent supported universal edits use Fast Refresh. Hook/signature
changes can still reset state. The eager development graph has a larger initial load and is not a
production deployment. Static exports remain for release review and rollback;
the [previous routing evidence](../../artifacts/native-web-ui-20261029/native-web-cloudflare-preview.json)
covers public authentication/data, map rendering, deep reload and Copy. Quick
Tunnel remains temporary and SSE-limited; the app continues ordinary polling.
One PostgreSQL 17 server hosts distinct application databases and
the explicitly retained isolated Simulation store. See the root [README](../../README.md)
and [backend operations](../../backend/README.md); do not start a second preview
supervisor over the maintained jobs. The [supervisor receipt](../../artifacts/native-web-ui-20261029/visit-onboarding205-supervisor.json)
records the sole normal launchd API service, `dev.thatcampus.api`, with its existing
plist and environment retained, one normal listener, rollback 204 and both private
database backups retained.
A Quick Tunnel URL is temporary, not a product
deployment promise. Git-dependent validation/push remains deferred while metadata
points into the protected Omnischool directory.

Owner decision, 29 October 2026: React Native/Expo is the sole actively developed
frontend across browser, iPhone, iPad and Android. Put new features and fixes there
once; freeze the old React/Vite implementation as reference/rollback only. The
bounded source audit covers all129 active routes and every identified screen/control
omission now has a universal source port. The app has no old-frontend runtime/type/
build dependency. The [native-only checkpoint](../../artifacts/native-web-ui-20261029/native-only-final-verification.json)
records 1604 passing mobile tests, TypeScript and web/iOS/Android exports at that
boundary. The earlier In & Out checkpoint records1630 tests; the visitor checkpoint
and its narrower later recovery checks are bounded separately below.
The [independent inventory review](../../artifacts/native-web-ui-20261029/native-only-inventory-independent-review.json)
verified1424 source fingerprints at that boundary. The earlier
[In & Out reconciliation](../../artifacts/native-web-ui-20261029/gate-raw-text-source-reconciliation-supplement.json)
verified1426 sources with unchanged routes, statuses and acceptance. The
[visitor reconciliation](../../artifacts/native-web-ui-20261029/visitor-active-parity-reconciliation/review.json)
records a later 1440-source boundary, 129 unchanged legacy routes and 80 capability
entries, including two unverified native-only visitor additions. The later
[icon/dock reconciliation](../../artifacts/native-web-ui-20261029/icon-polish/active-parity-reconciliation.json)
reviews 1443 sources, with unchanged 129 routes/29 groups/80 capabilities and all
acceptance arrays. Ten inventory tests and the source check pass; retirement
remains blocked by 29 groups.
Retirement still needs the owner's review of actual browser/simulator/emulator functionality,
data links/history and rollback. Physical-device checks are unavailable and are
explicitly removed as an old-web retirement prerequisite; hardware-only behavior
remains untested, separately from store/distribution readiness.

Owner polish direction, 30 October: validate shared UI iteration on iOS now. Keep
source/type and relevant logic checks; defer the Android and browser visual and
interaction pass together until before release. This sequencing does not waive
platform, domain, Simulation, recovery or release acceptance.

## Isolated app2 release

Conformance 213 is live at `https://app2.thatcampus.com`. Actions run 41187716645 succeeded for release `15b86e827de90cf9a8db3e80e5685286133f82bb`, revision `thatcampus-dt-r-15b86e827de9-41187716645-1`, digest `sha256:7e578f191a40e623e907fdd7d784d7fbae0e5c33b053c4422a0f8632f15ce75e`. The [full receipt](../../artifacts/app2-cloud-deployment/ci-213/digital-twin-release-41187716645-1/release.json) records one successful migration execution, `thatcampus-dt-migrate-g2f8c`, and candidate/public smoke. [CI verification](../../artifacts/app2-cloud-deployment/ci-213-verify.log) passes 99 PostgreSQL cases with zero skipped/todo tests, 519 fast backend tests and 1822 mobile tests. [Existing-target proof](../../artifacts/app2-cloud-deployment/old-deployments-preserved-213.json) retains all 4 old serving revisions/settings unchanged with ERP readiness 200 and marketing 200. Shared SQL capacity remains separate. Maintained Mac development is a separate target; operations belong to the [DT runbook](../../deploy/dt/README.md).

The reviewed attendance query screens impossible candidates without shortening the 56-day comparison; occurrence hydration batches retained details while preserving authority, snapshots and world isolation. [Native API checks](../../artifacts/app2-cloud-deployment/native-read-213.json) pass all 15 reads/authentication checks, including workspace 2652ms, In & Out 344ms, visit options 186ms and scene 378ms. With restore stopped for both samples, the [212 baseline](../../artifacts/app2-cloud-deployment/workspace-baseline212-timing.json) is 3642ms and [213](../../artifacts/app2-cloud-deployment/workspace-optimized213-timing.json) is 2362ms, one sample each. [Eight browser/navigation checks](../../artifacts/app2-cloud-deployment/browser-cloud-213.json) cover Today after Retry, In & Out, Visits/arrange, 218 places, Administration’s 2 floors/119 resources, linked interior/computer, report prefill and exact Back selection context; no form was submitted. The right panel restores its floor/room/computer context, but the floor canvas becomes blank after Back. This visual round-trip defect remains open; navigation/accessibility checks do not close it. Published DT data includes 3 mapped buildings, 84 rooms, 261 fixtures and 269 states. These observations are bounded API/browser evidence, not physical iPhone or sustained-load acceptance.

[Migration 281 verification](../../artifacts/app2-cloud-deployment/role-source-forward-migration-receipt.json) retains the 5/6 before, 6/6 after and 42/42 PostgreSQL checks, unchanged role-trigger identity/15 bindings and safe refusal of unchanged old 211 worlds. It is not an automatic world upgrade. The [CI-only removal of two redundant test assertions](../../artifacts/app2-cloud-deployment/ci-213-test-assertions-review.json) emits identical JavaScript and preserves the strict 213 fingerprint. Lint accepts 58 unchanged errors against 66 exact baseline entries; ordinary lint is not clean. Existing 49 unrelated source errors and 29 unfinished groups remain.

Permanent-origin native Release build 2 is [installed](../../artifacts/app2-cloud-deployment/ios-install.json). The owner unlocked the phone and attempted sign-in; [subsequent native session/auth reads failed with pool acquisition timeouts](../../artifacts/app2-cloud-deployment/native-pool-recovery-213.json), so authenticated physical workflows, mutations and smooth rendering remain unaccepted. The recorded Personal Team profile expires 7 November 2026; cloud hosting does not extend it. No Expo Updates delivery is configured. Apple Support shows a case confirmation; paid enrollment/App Store Connect/TestFlight remain unconfirmed.

**214 source preparation, not serving acceptance:** [read-only DB review](../../artifacts/app2-cloud-deployment/shared-db-connection-review.json) identifies four API clients plus a listener, no restore/lock blocker, and a progressing academic expansion transaction retaining one client over 206 seconds. Activity-horizon extension is now activity-scoped while retained finalization remains source-neutral and policy-checked; [9/9 PG cases](../../artifacts/app2-cloud-deployment/bridge-native-tests-final.json) include an actual mixed-source COW checkpoint with unchanged Live/sibling. The [notification/recovery review](../../artifacts/app2-cloud-deployment/notification-recovery-review.json) records one-statement current-visibility/count reuse, 7/7 real PG parity cases, 39 existing notification checks, 207 focused mobile tests including 11 recovery cases, types/lint and exact source hashes. [Local four-client load proof](../../artifacts/app2-cloud-deployment/notifications-concurrency-local.json) runs 20 bell reads plus four native session restores: identical results, 4 bell/4 restore acquisition failures before and zero after. The [owned disposable DB was removed](../../artifacts/app2-cloud-deployment/notifications-cleanup.json). Campus errors stop automatic polling; explicit recovery remains. Explicit Campus navigation clears stale resource intent while Report Back keeps interior context. The prepared CI floor is 107 real PG cases with zero skips/todo; cloud 213 remains serving until 214 is verified/promoted. Native rebuild/recovery and the separate blank-floor rendering defect remain unaccepted.

Simulation continuation 22wz4 failed at its bounded run limit. The [remaining-only plan](../../artifacts/app2-cloud-deployment/simulation-postdata-continuation-plan-20261031.json) matches 4597 table counts/238 sequence states and selects 17905 missing DDL entries (14707 foreign keys/3198 RLS flags). [Independent review and 12 offline probes](../../artifacts/app2-cloud-deployment/simulation-postdata-independent-review.json) found no integrity blocker; upload/execution remain held for capacity clearance and continuous target quiescence. Session preflight alone cannot prevent later connections. Further partial progress/failure requires a fresh catalogue comparison and reviewed remaining-only plan. Retain private archives/worlds; counts do not establish full row-content equivalence or restored-world readiness.

The owner chose to retain the existing shared SQL server and limits; no new server, resize or pool/concurrency increase is authorized. Memory pressure remains recorded, and heavy transfer interference was a major timing factor: about 85 seconds during restore versus 3.642 seconds after stopping. Heavy restore remains held for a safe bounded window and continuous target quiescence. The bounded persistent-file probe passes; ordinary attachment upload/download remains open. The approved provider window ends `2026-11-08T00:00:00Z` without cloud inference acceptance. Hosting and bounded checks do not close workflow, Simulation, parity, physical performance or store gates.

## Product and architecture invariants

- One responsibility-composed application, canonical people/groups/places and
  native domain owners; no job-title portals or parallel writable legacy editors.
- Typed Model Core command/observation→current authority/rule/context→domain
  execution→correlated evidence/outcome→explicit handoff. Do not substitute a
  reporting mirror or generic graph/EAV writer for domain semantics.
- Buildings contain spaces; people and resources relate to canonical spaces with
  effective-time/provenance. A scene, schedule or reported presence is not physical
  occupancy evidence.
- Live and Simulation use the same owners/screens with server-selected stores,
  clocks, actors, caches, streams and sink-only external effects. Missing coverage
  fails closed, never reads Live. Every material platform change includes its
  matching Simulation checks and conformance update.
- Real operator burden governs granularity. Reuse stable arrangements, assist/bulk
  review and exceptions; do not demand a fictional complete campus or repeated
  person-by-person decisions merely because the model supports them.
- Institution configuration owns mutable automation; no hidden rules, inferred
  consent, fabricated payments, authority, attendance or physical handovers.
- Preserve Campus Model Core, Campus View, product Simulation and the Cambridge
  development harness until an explicit market-release cleanup decision.

## Current capability status

“Bounded” means the named paths have implementation/evidence, not that every
institutional policy, client, provider or all 22 lifecycle stories are accepted.
Read the owning contract before extending a workflow and inspect its exact receipts.

| Area | Current bounded implementation | Important remaining limits |
| --- | --- | --- |
| Shared application | Today/Work/Areas/More; effective responsibility and relationship composition; neutral domain routes; distinct Requests/Tasks/Offers and informational Updates | Genuine institution authority adoption and all-role/all-client journey acceptance remain separate from fictional fixtures. |
| People and setup | Canonical people/groups/connections, explicit app access, reviewed import/enrollment and progressive capability/whole-campus guidance | Names/contact details never authorize automatic merges; capability readiness is not a universal campus-completion percentage. |
| Authority and governance | Scoped, dated role/permission and governance records with revocation and decision evidence | Existing accounts/demo assignments do not prove a real institution adopted its authority policy. Support/company access remains separately scoped. |
| Timetable and Attendance | One activity/person-oriented foundation with native academic/duty specializations, published schedule lineage, registers, corrections and source-owned detail | Teaching-preference Requests and bounded generation remain targets, not a delivered general solver. Do not infer attendance from gate scans, completed work or visualization. Complete migration/parity must be proved per adapter, not assumed from the shared UI. |
| Calendar | Distinct important-date lookahead; Month/List, authorized source detail and native member-public dates | Direct personal fee/assignment deadlines, term/admission and public-facility feeds are incomplete. Assessment cancellation/overnight overlap require owning-feed work. |
| Learning and results | Dated teaching preparation/materials/reported coverage, individual assignments, offline assessment operations, grading and issued report evidence | Full curriculum/course-completion/admissions/placement stories are not implied. A claimed file or mark needs native artifact/revision evidence. |
| Staff leave and continuity | Task-first application, affected-work preview, assigned review and coverage/conflict/authority handling | Wider contractual staff calendars and real policy adoption are not complete. Review does not establish actual physical cover. |
| Finance | Person/group collections, posted-record correction, private instalment proposals and native ledger/provider reconciliation boundaries | Claimed payments, gateway success and reconciled receipts are different facts; arbitrary ERP cutover, refunds and all financial-aid stories are not implied. |
| Resources | Exact copies, quantity1–100 creation, loans, partial/claimed returns, custody correction and questions | Issue/return records are reported handovers, not independent physical proof; broad asset-accounting/procurement remains outside this slice. |
| Repairs and external work | Assisted report, accountable handling, claimed completion, independent verification/reopening; exact dated technician grants | Invitation/acceptance/job progress are not gate entry, broad contractor authority or procurement. |
| Accommodation | Canonical room types/places/capacity, stays, moves, responsibility continuity and linked resource custody | Assignment, planned dates and observed moves stay distinct. Do not require per-person confirmations without a real decision need. |
| Dining and coexistence | Native/reference service modes, weekly menus/hours, dated exceptions, counts and shortage handling | General provider connectors, payments/entitlements/billing, verified serving evidence and replacement cutover remain scoped targets. |
| Visits, gate and transport | Campus-created guest/group plans, optional boundary observations, neutral joining and scoped gate/departure/transport owners | A visit arrangement grants neither general campus work authority nor proof of arrival. Public discovery and every international/regulatory variant are not complete. |
| Restricted Care | Exact case/handler authority, privacy-minimized discovery and continuity/recovery evidence | No general staff case feed; real safeguarding/institutional outcomes require their own acceptance. |
| Campus visualization | Reviewed map/floor-plan drafts, canonical place links, publications and authored interiors; native Skia v2 retained scenery, UI-thread camera/people atlases and exact resource-condition overlays. Installed iPad rendering and an isolated resource report→map change with unchanged Live are verified. Physical iPhone checks show campus/floor/room/resource exploration, recorded availability and improved floor sizing/local focus. The final installed Release shows building/floor actions above the dock. | Image inference is a proposal, not surveyed topology. Planned motion/sparse observations never establish continuous actual location. Fullscreen destination/report handoff, low-end frame pacing, sustained heat/battery and all-platform interaction remain open. See [rendering verification](../VERIFICATION.md#campus-rendering). |
| Assistant and messaging | Authorized domain tools, deterministic reviewed writes/recovery, provider abstraction, source visibility and scoped channel/bridge contracts | Provider credentials/readiness are deployment state, not permanent availability. Inbound Matrix/E2EE/real calling and unsupported side effects remain explicit gaps. |
| Universal app migration | React Native/Expo is the sole active frontend for browser, iPhone, iPad and Android. New features/fixes are not duplicated into the frozen React/Vite reference. The final physical iPhone15 Release passed signing/ABI and unchanged682-source checks, installed/launched with session retained. Native login, bounded campus exploration, Areas/sheet dock clearance and email-login/recovery keyboard layout have bounded hardware evidence. See [device evidence](../VERIFICATION.md). | [Native parity](../../mobile/PARITY.md) retains broader workflow/platform gaps. Registration lower-field keyboard layout is not accepted from its redacted capture; reset has mounted tests only. Fullscreen destination/report and physical mutations/performance remain open. Local signing expires7November2026. Apple enrollment remains unresolved; the Support tab now shows a case confirmation and no TestFlight upload is confirmed. |
| Simulation | Institution-neutral capture/run, same-app amber context, virtual workers, isolated effects, owner capacity/retention, unified Saved/History/Compare and guarded draft discard | Safety readiness is not exhaustive capability evidence. Cold large-campus first-open reads still took14–38seconds; universal performance remains under review. Physical iPhone Simulation mutations remain unverified; hardware checks are not an old-web retirement prerequisite. |
| Cambridge Campus Lab | Retained synthetic development/sales reference and guarded normal-domain actor harness | Local-only conformance tooling, not a separate product route or production authority. Hosted enablement requires reviewed isolation/credentials. |

## Latest accepted changes

### Universal navigation and current workflow ports

The React Native/Expo target now uses one destination-labelled top Back control,
actual router/browser history, retained tab origins and shared losing-exit guards
for the integrated editors. Read filters update the current view; return removes
a level rather than pushing duplicate parents. Same-identity session rechecks
preserve blocked mounted presentation, while access/scope changes clear it.
Browser and iPhone/iPad simulator checks cover hierarchy, origin and retained
filters; the browser also covers cancelled/approved unsaved exits and Forward.
The earlier Assistant [mobile test/build/export check](../../artifacts/native-web-ui-20261029/assistant-overlay-build-export-validation.json)
passes1544 TypeScript tests and9 theme tests, whole-mobile TypeScript and web,
iOS and Android exports. Switching tabs retains context; reselecting the active
workspace tab resets it after checking removed dirty/busy editors. One retained
Assistant body now overlays the actual workspace page. Compact mode keeps the
bottom navigation visible. Expansion on iPad keeps a usable operating app beside
its conversation pane; portrait retains navigation under the app. iPhone keeps
full-screen expansion. Both use the retained native Glass composer. Copy sits beside Expand/Collapse
and copies the latest displayed answer. Account Pro changes guard only the affected
Assistant state, preserving unrelated mounted drafts. The previous native-tab shim
and generated Assistant tab images are retired; actual domain native stacks and
shared navigation/exit owners remain.

In & Out now uses compact shared Visits/operator search, filters and wrapping
actions; form pickers retain their parent draft. The
[UI owner review](../../artifacts/native-web-ui-20261029/in-out-ui-root-source-review.json)
and [independent count-label closure](../../artifacts/native-web-ui-20261029/in-out-ui-independent-source-review/count-label-review.json)
bind the bounded layout changes. Explicit local `preservesDraft` Back retains
route-removal protection; parent guards remain active while a chooser/camera is
visible, nested person/import discard checks its exact source/instance, and
unsent-note handoffs require a separate keep/discard choice. Existing sharing
confirmation dialogs conditionally disclose note loss. The
[current verification](../VERIFICATION.md#in-out-ui) links exact caller, Back,
independent copy and bounded browser/iPhone rendering evidence. That earlier full mobile
suite records1630 passing tests and whole-mobile TypeScript. Its
[final verification](../../artifacts/native-web-ui-20261029/in-out-live-final-verification.json)
binds successful web/iOS/Android exports and exact bundle hashes to unchanged
reviewed sources, with current public/iPhone navigation and rendering evidence.
Two unintended text children in records/recovery have a mounted regression and
clean renderer recheck. Earlier checkpoint hashes are historical. Final Android gestures,
all-workflow Live/Simulation/recovery acceptance stay open; all 29 groups remain
implemented-unverified. Physical-device checks remain waived as a retirement
prerequisite and untested.

Current visit detail includes the grouped reference card, Invite visitors, visible
management/observation/history sections, and a sectioned editor with readable
native date/time controls. The
[Visit review](../../artifacts/native-web-ui-20261029/profile-polish/visit-campus-review.json)
binds193 focused shared checks,27 real PostgreSQL/COW checks without skips,
whole-mobile/backend TypeScript and bounded iPhone rendering. Destination preview,
categorized complete choices and visual building/floor/room or entire-campus
selection all use shared React Native owners. Yellow mapped geometry identifies
published timetable conflicts; this is advisory, not general room availability or
a reservation. The iPhone returned an exact campus choice to the unsaved form;
normal visit/movement/cancellation/link records were not changed by the tour.
Registered visitors retain minimized views and acquire no general campus-map
access. Deferred Android/browser presentation, full rendered Simulation/recovery,
mailbox/OS share and whole-app retirement acceptance remain open. Email stays off.
The [In & Out follow-through](../../artifacts/inout-journey-20261030/review.json)
binds historical snapshots, revision-bound observations, stale-edit review and
48 backend cases (19 unit/29 actual PostgreSQL-COW-HTTP). The current
[visitor journey review](../../artifacts/visitor-journey-20261030/review.json)
binds224 shared checks/mobile types and a bounded isolated iPhone tour. Native
invitation fragments now survive routing as volatile origin-bound nonces; the
preview rechecks returning access and reuses the grouped visit card. Existing
campus starting goals use the correct strict update endpoint. Two verified fixture
accounts signed in and explicitly joined their own separate visits; cancellation,
revoked workspace access, replaced-link refusal, Copy and dismissed native Share
were inspected. Email drafting/delivery remained unavailable. Both disposable
stores and private credentials were removed; normal API/account were restored and
no normal visit command was submitted. Multiple visitors on one link, real mailbox
proof, rendered Simulation/process-loss and deferred platform presentation remain
open; this is not whole-journey or retirement acceptance.
The shared
[feature icons](../../artifacts/native-web-ui-20261029/icon-feature-source-review.json)
and [independent semantic review](../../artifacts/native-web-ui-20261029/icon-polish/independent-review.json)
use distinct owning-destination glyphs and the established theme; original Assistant
artwork and utility controls remain. The
[dock source review](../../artifacts/native-web-ui-20261029/assistant-dock-glass-source-review.json)
and [independent review](../../artifacts/native-web-ui-20261029/assistant-dock-glass-independent-review.json)
cover four main destinations, the separate right Assistant bubble and measured
native-glass selection with accessibility fallbacks. The bounded
[iPhone rendered proof](../../artifacts/native-web-ui-20261029/icon-polish/ios-rendered-review.json)
shows the changed menus,36pt Assistant mark, moving glass selection and preserved
tab/Assistant presentation behavior. Current rendered polish is iOS-only;
Android/browser visual and interaction review is deferred together before release.
Wider UI and complete workflow acceptance remain open.

The current [area-colour review](../../artifacts/native-web-ui-20261029/icon-polish/area-colour-review.json)
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


The [iPad source reconciliation](../../artifacts/native-web-ui-20261029/assistant-ipad-split-parity-reconciliation.json)
records the earlier1354-path boundary. The [public-host addition](../../artifacts/native-web-ui-20261029/native-web-cloudflare-parity-reconciliation.json)
extends this to1355 watched runtime/style/build-input paths,129 canonical routes and no
source drift. It preserves every existing acceptance reference. At that checkpoint all 29 groups and
78 capabilities remained implemented-unverified; successful source/build checks
close none of their remaining runtime retirement gates.

The [current native binary receipt](../../artifacts/native-web-ui-20261029/assistant-overlay-native-binary-verification.json)
records data-preserving iPhone/iPad/Android installs with Clipboard support, matching
compiled/installed executable bytes, valid deep iOS signing and17 checked ARM64
binaries with1323 strong inter-Expo imports and no missing symbols. Native Print
continues to build from source; Razorpay3 and SQLCipher remain installed. The Android
emulator now supports bounded authenticated checks after the cold GLES workaround:
Today, Areas, Attendance reads and the retained Assistant conversation render.
Earlier host crashes/sign-in-control failures remain historical diagnostics, not
the current authenticated status. Both Debug clients still require Metro. Final
Android shared-host gestures remain unverified: the emulator is docked, but CUA
returns `noWindowsAvailable` despite rebinding, Raise and session reset.

Actual browser checks cover the real compact backdrop, full-answer clipboard
copy, full-screen presentation, lossless draft collapse/close/reopen, owning source
navigation with Back to Assistant, and tab retention/reselect. Native-specific
keyboard, rotation and Glass acceptance remain bounded by their rendered receipts.
An actual earlier iPhone provider question completed through the owning Assessment
tool; consequential action and interruption/relaunch recovery remain open.
Complete screen-by-screen browser, iPhone/iPad/Android, Live/Simulation, permissions,
accessibility and failure/recovery checks remain open. All29 active capability
groups still block web retirement. See [the parity map](../../mobile/PARITY.md) and
[bounded verification](../VERIFICATION.md#native-app).

Release203/schema277 activates the reviewed assigned-Insights eligibility,
bounded CampusView read admission, native Assistant tool-session forwarding and
configured Google sign-in protocol. Actual PostgreSQL tests reproduce and repair
the native MFA finalizer's foreign-key lock inversion while preserving enrollment
serialization. Activation retains the sole normal API supervisor, configuration,
both protected worlds, publication21 and canonical place/resource hashes. Google
is unconfigured in this runtime and remains availability-gated; no provider was
enabled. Release204 adds bounded64-subject temporal batches through the same Model Core resolver, with110 focused and 12 actual PostgreSQL tests, six conformance checks and unchanged schema/configuration/Live records at activation. Strict native30second concurrent cold campus acceptance now passes38/38 checks: first selected-Simulation mine/admin/operations reads take4.10/11.22/11.23seconds. Exact217spaces/269mappedassets, report/replay/map outcome and unchanged Live pass; the exact owned test draft/session were cleaned up. Prior203 diagnostic34.56/31.89second reads failed the app deadline and are retained as before-fix evidence. Full device, isolated-world and interrupted/relaunch acceptance remains separate from source and boundary checks.

### Simulation controls and storage

Release199 corrected the managed PostgreSQL17 snapshot-tool path and rejects an
unavailable/mismatched tool before reserving a new run, while preserving accepted
exact retry. One owner-paged Saved list replaces separate managers. History alone
shows removed worlds without consuming capacity; comparison requires explicit
selection mode. Draft discard uses exact revision/status-guarded Stop followed by
native fenced cleanup, with honest uncertain-result reconciliation.

Pause/Stop now wait at a bounded control admission gate for an existing fenced
checkpoint; pending recovery can finish and other institutions retain bounded
claim progress. Authority is rechecked at the final write. Independent Requests
readers use the existing FIFO3 before acquiring clients; pools/timeouts/locks were
not weakened. Actual public checks started/advanced20× worlds and exercised
Pause/Resume/Stop and ordinary amber Today. A fresh real-COW draft was discarded
through native HTTP with exact replay and other-run equality. Only root-owned
disposable worlds were removed; their history remains.

### Aaranya Calendar and connected fixtures

Release198/schema277 introduced native member-public dates without turning
instructional overrides into announcements or generic editors. Aaranya has56
published July2026–June2027 dates,19 linked to the two actual terms. Repeat import
created zero duplicates. Four Events, two Assessments, six Dining weeks and three
exceptions were authored through native owners with existing people/cohort/places.
No enrollment, marks, money, participation or physical observations were fabricated.

Director/Learner/Faculty/Operations APIs and bounded phone/tablet browser review
preserve public-date agreement and distinct academic source scope. Physical
keyboard/screen-reader and complete rendered Calendar amber acceptance remain
separate. Aaranya is a fictional, public-source-informed fixture, not official
IIITA information. See the [fixture tour](../VERIFICATION.md#aaranya).

### Map, continuity and shared interface

The owner's30October hardware-free venue-navigation direction is now recorded as a
[product target](CAMPUS_VISUAL_SCENES.md#phone-only-facility-navigation-target-and-provider-gate)
with [provider/source review](../../artifacts/indoor-navigation-planning-20261030/review.json).
Existing floor-plan intake, canonical places and authored wayfinding are reusable;
automatic positioning, survey/version binding, public-safe visitor publications
and operational closure/recovery remain new work. No supplier is selected, no SDK
or connector is activated and no live-positioning accuracy is accepted. The
owner has [resolved the camera constraint](../../artifacts/indoor-navigation-planning-20261030/staff-survey-camera-decision.json):
mapping staff may use a camera during the one-time setup survey; visitor navigation
must remain camera-free, and installed positioning hardware remains rejected.
The [refined research brief](CAMPUS_VISUAL_SCENES.md#research-problem-and-completion-goal)
requires ordinary workers to map alone/collaboratively using ordinary phones,
optional rather than mandatory plans, and independently verified sub-metre
camera-free visitor navigation. It records nine research workstreams, proposed
speed/usability budgets and strict evidence gates; no feasibility, physical
accuracy or novice-worker acceptance has yet been established. See the
[brief receipt](../../artifacts/indoor-navigation-planning-20261030/research-brief.json).

The [venue-generality audit](../../artifacts/venue-generality-audit-20261030/review.json)
finds an education-first delivered product with a reusable neutral foundation,
not an accepted general mall/facility product. Private provisioning starts with
an unspecified kind and no education packs; visits, generic activities, topology
and neutral membership need no academic scaffold. Material restrictions remain:
company “Other” creation becomes School, formal verification is education-only,
Assistant/channel perspectives still infer academic personas, and academic setup
contributions are not consistently capability-conditioned. Name-based map lookup
is school/college/university-only; place catalogues and public-safe map audiences
also need extension. The navigation-only starting outcome remains planned.
Keep existing academic domains optional and preserve compatibility identities;
renaming `school_id` alone cannot fix these restrictions. The audit changed no
application behavior or data. Its121 passing unit/policy/schema checks and pure
function reproductions do not establish a rendered noneducation Live/Simulation
journey. Resolve truthful venue identity and capability composition before
claiming general facility support; prove an empty mall fixture without academic
records, including recovery and isolated Simulation.

The retained evidence covers reviewed floor-plan intake/publication, authored
interiors, messaging/academic evidence repair and Care/Resources/Dining continuity.
It does not close every old whole-system audit finding. Shared controls keep
established Light/Dark blue Live and amber Simulation themes; swipe-only actions,
redundant card menus and prior portal/duplicate-editor experiments are not active
requirements. Theme, operating-experience and domain contracts remain separate
from historical screenshots.

## Work order and open acceptance

1. Finish predictable Back acceptance across active universal workflows: native
   gestures/hardware, dirty exits, deep links, retained view state, access changes,
   keyboard/accessibility and isolated Simulation. Audit older forms and complete
   active web parity before retiring the retained React web application.
2. Reduce measured large-campus Simulation cold-open latency without increasing
   connection pressure, weakening COW locks or inventing readiness. Preserve the
   successful control/uncertain-result/retention paths and compare actual workloads.
3. Verify active workflows in the browser, iPhone/iPad simulators and Android
   emulator, including empty/loading/failure/recovery, keyboard, focus, theme and
   real data links/history. Record unavailable hardware behavior as untested;
   physical-device checks are not an old-web retirement prerequisite.
4. Complete the next real campus journey outside-in with the minimum user burden,
   genuine institution authority adoption and evidence-backed handoffs. The
   [22-story target](END_TO_END_CAMPUS_WORKFLOWS.md) is a backlog, not delivery proof.
5. Extend Calendar only through complete authorized owning feeds; do not fabricate
   personal obligations from general dates. Keep Calendar and Timetable purposes clear.
6. Close explicit domain/provider/Core capability-evidence gaps as those workflows
   are implemented. General integration replacement, hosted fixture actors,
   physical outcomes and production scale are independently gated.
7. Run risk-proportionate checks from [Verification](../VERIFICATION.md#tests),
   preserve exact authority/tenant/world/retry/artifact evidence and update current
   status in place. Re-run broad/native suites only when the change warrants them.

## Documentation maintenance

Keep current requirements in their owning contract; update this status and
`docs/VERIFICATION.md` rather than adding per-fix dated reports or duplicating raw
test output. Add a new contract only for a genuinely separate maintained concern.
Preserve exact raw evidence under `artifacts/`; old reports remain recoverable
outside the active project. Do not turn an old passing test count, staging receipt
or proposed target into current release/physical-workflow acceptance.
