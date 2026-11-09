# Verification and development tour

Maintained summary, 8 November 2026. This replaces the active reading burden of
dated QA logs and duplicate fixture tours. It is an evidence index and reusable
check guide, not product authority or a new whole-system audit. The documentation
cleanup itself did not run product tests, change data, deploy code or certify a
device. Use the [contract map](blueprint/README.md) for the owning requirements and
the [implementation plan](blueprint/IMPLEMENTATION_PLAN.md) for current priorities.

<a id="documentation-recovery"></a>

## Documentation recovery

The original 161 documents and six QA JSON receipts are recoverable on this development host from
`/Volumes/MacSSD/Archives/ThatCampus/documentation-20261029-3bbf68b2/documents-before-cleanup.tar.gz`;
the adjacent `manifest.json` records their exact paths and hashes. This archive is
historical provenance, not another active specification.

The cleanup retired 96 obsolete documents after merging unique requirements into
their current owners. Six raw JSON receipts moved byte-for-byte to
[historical evidence](../artifacts/documentation-history-20261029/). The retained
surface is 66 maintained documents; a new Native Calendar receipt created by
concurrent work brings the observed count to 67. That active work was not deleted.
Licences and required operational text files remain. The cleanup checked local
links/anchors, archive integrity and relocated receipt hashes; it did not rerun
product suites. `cleanup-manifest.json` beside the recovery archive records exact
retirements and replacement owners.

## Evidence rules

The [phone-only navigation research brief](blueprint/CAMPUS_VISUAL_SCENES.md#research-problem-and-completion-goal)
and [receipt](../artifacts/indoor-navigation-planning-20261030/research-brief.json)
define a target and planned experiments, not a measured positioning result.
Ordinary-worker phone-only mapping, camera-free visitor localization below1metre,
independent real-site truth and held-out-device/venue replication remain unproven.
Desk research, component datasets and simulated walks cannot close those gates.

The [venue-generality source audit](../artifacts/venue-generality-audit-20261030/review.json)
records exact source lines/hashes, four test commands and 121 passing existing
unit/policy/schema checks. [Pure-function probes](../artifacts/venue-generality-audit-20261030/policy-probes.json)
reproduce company “Other” becoming School, a repairs-only self scope becoming
“My learning,” and education-based Assistant perspectives; they also confirm a
nonacademic training plan accepts no class or term. Private workspace creation,
generic people/visits/activities and topology are reusable, but official onboarding,
capability contributions, catalogues and public map audiences retain material
noneducation gaps. This is a source audit with no application/service/database
change, no rendered mall journey and no new Live/Simulation or production
acceptance. Inspected database integration assertions were not rerun or counted.

Owner decision, 29 October 2026: React Native/Expo is the sole frontend under
active development for browser, iPhone, iPad and Android. New features and fixes
are implemented once there; the old React/Vite implementation is frozen
reference/rollback only. The bounded 129-route source-port audit and its identified
missing-port implementations are complete; the owner's retirement review still
requires functional browser/simulator/emulator evidence, actual data links/history,
recovery and rollback. At that decision, physical devices were unavailable and
were explicitly excluded as an old-web retirement prerequisite.
Record hardware-only behavior as untested, without claiming hardware or
store/distribution readiness.

Owner polish direction, 30 October: use iOS rendered checks for the current shared
UI iteration. Keep source/type and relevant logic checks; perform deferred Android
and browser visual/interaction review together before release. This does not mark
those platforms accepted or waive domain, Simulation, recovery or release gates.

The initial [physical iPhone installation receipt](../artifacts/iphone-install-20261031/installation-verification.json)
records a development-signed Release build installed and opened on the owner's
iPhone15/iOS27.2. The actual sign-in screen was observed through Device Hub.
Strict deep signature verification and all1282 inspected Expo ABI imports pass;
682 source checkpoint files remained unchanged. JavaScript/assets and the current
HTTPS review API origin are embedded, so Metro is not required to open this app.
The owner enabled Developer Mode and trusted the profile. Its expiry is
7November2026; that earlier Mac-hosted API/tunnel had to remain running. Current
app2 acceptance is recorded in [Isolated app2 deployment](#isolated-app2-deployment). This is bounded
hardware install/launch evidence. The later
[physical sign-in receipt](../artifacts/iphone-login-testflight-20261031/status.json)
records the owner entering the secure password after the agent entered the IIITA
email; the agent then observed the authenticated Aaranya Today and More screens
and opened Virtual campus. Login/session and all five campus read requests returned
200; see the [HTTP completions](../artifacts/iphone-login-testflight-20261031/physical-native-request-results.json).
Subsequent physical checks show the
[campus overview](../artifacts/iphone-login-testflight-20261031/iphone15-campus-overview.png),
Administration Building's two floors and 119 mapped resources, Ground floor,
Academic registry and its exact computer `AIT-INT-ADM-F0-R04-COMPUTER01` with
[recorded Available status](../artifacts/iphone-login-testflight-20261031/iphone15-resource-status.png).
That status is a DT record, not an independent physical inspection. A subsequent
[installed Release](../artifacts/iphone-bottom-cropping-20261031/device-install.json)
shows the [released Areas list end](../artifacts/iphone-bottom-cropping-20261031/iphone15-areas-end.png)
clearing the dock, a [larger floor map](../artifacts/iphone-bottom-cropping-20261031/iphone15-floor-after.png)
and readable local focus. The custom sheet's
[additional inset correction](../artifacts/iphone-bottom-cropping-20261031/campus-panel-insets.json)
is now in the final [installed replacement](../artifacts/iphone-bottom-cropping-20261031/device-install-final.json),
which passed strict signing and [Expo ABI checks](../artifacts/iphone-bottom-cropping-20261031/ios-expo-abi-final.json)
with [all682 checkpoint sources unchanged during the build](../artifacts/iphone-bottom-cropping-20261031/source-comparison-final.json).
It launched with the existing session retained. Final physical screenshots show
the [building's Ground floor action](../artifacts/iphone-bottom-cropping-20261031/iphone15-panel-dock-after.png)
and [floor Building overview/Map controls](../artifacts/iphone-bottom-cropping-20261031/iphone15-floor-dock-final.png)
above the dock.

After sign-out, the [final sample-campus link](../artifacts/iphone-bottom-cropping-20261031/iphone15-login-bottom-final.png)
is reachable. With the email field's [actual software keyboard](../artifacts/iphone-bottom-cropping-20261031/iphone15-login-keyboard-final.png)
open, Password and Sign in remain visible; interactive drag dismissal restores
the scroll range. Recovery focus/keyboard/dismissal was checked without submitting
a request. Registration's static form was inspected, but secure-keyboard capture
was redacted, so lower-field keyboard layout is not accepted from that capture.
Reset has mounted tests only. Fullscreen destination/report handoff, broader
account/workflow coverage, physical mutations and sustained performance remain
open. The owner requested re-login after these signed-out checks. Repeat-device
build/install commands live in the [mobile guide](../mobile/README.md#connected-iphone).

- Report source checks, native database/API execution, activated runtime, rendered
  browser, simulator and physical-device acceptance separately. A declaration or
  mocked provider is not a real workflow/provider result.
- Bind a result to its source/release, schema, exact selected tests and artifact.
  Older checkpoints remain evidence for their original scope, not the latest app.
  Do not add overlapping suite counts, count skips as passes, or rename a failed
  complete run after a passing focused repair.
- Keep source-owned outcomes, authority, immutable history and exact retries.
  A request, schedule, RSVP, plan or map illustration is not physical evidence;
  a reported payment is not reconciliation and a reported repair is not verification.
- For a material workflow change, verify the same owner and screens in Live and
  a real isolated world, meaningful branch change, unchanged Live/sibling state,
  virtual time, authority, stale/duplicate/unknown replies and correction/recovery.
  Never substitute Live data while the app is amber.
- Record failures and practical limits with the result. Local readiness, builds
  and bounded COW proofs do not establish every capability, hosted operation,
  production capacity or institution/owner approval.

<a id="tests"></a>
<a id="data-and-tests"></a>


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


The [current In & Out journey review](../artifacts/inout-journey-20261030/review.json)
adds inspectable saved-plan/observation history, explicit revision-bound observed
counts, visible current-plan review during stale-edit recovery, invitation-load
retry and keyboard space for movement entry. 186 focused shared checks and mobile
TypeScript pass. 48 backend checks comprise 19 identity unit cases and 29 actual
PostgreSQL/COW/HTTP cases; the two disposable stores were dropped with zero clients
and the normal API output was unchanged. The iPhone tour opened saved history,
rejected 5,001, reviewed then declined an exit, inspected expired invitations and
kept a draft through destination Back and a declined losing Back before explicitly
discarding only that unsaved test draft. No normal visit/movement/cancellation or
registration-link command was submitted. Real mailbox delivery, native OS share,
rendered visitor account/join and Simulation/process-loss tours remain open; this
is not whole-journey or retirement acceptance. The first broader frontend run's
one missing test-double export is retained alongside the corrected 186/186 receipt.

The [visitor journey review](../artifacts/visitor-journey-20261030/review.json)
supersedes the earlier untested-native-share/join limit only for its bounded
isolated iPhone tour: two verified fixture accounts completed normal sign-in and
explicit self-join to separate own visits; cancellation remained readable and
revocation removed access. Copy feedback and the native Share chooser/dismissal
were observed, with no recipient selected. Replaced/expired link refusal and
unavailable email proof/draft were truthful. Native URL normalization had dropped
fragments; the exact native entry now retains an origin-bound memory nonce before
routing, with a real-hook regression. Returning previews recheck validity and
terminal refusals remove stale details without discarding pending commands.
224 focused shared checks and mobile TypeScript pass. The ordinary isolated API
used a temporary current-source build, one successful fixture seed and two owned
PostgreSQL stores; zero-client cleanup and unchanged normal dist are linked.
The initial fixture reveal failure was a seed/API encryption-configuration mismatch,
resolved by ordinary API link replacement. Failed setup/test receipts remain.
Actual new-account mailbox delivery, multiple visitors on the same link, touch
scroll-to-bottom, cold custom-origin restoration, rendered amber/process-loss and
deferred platform presentation are not accepted. Normal API8000 and Devika's
account were restored; no normal visit command or second-frontend edit occurred.



## Verification workflow

Choose the smallest owning test selection first; use wider regression for shared
contracts, identity/authority, schema, routing, transport or release changes.
Current commands and isolation requirements are maintained in the
[backend guide](../backend/README.md) and [universal app guide](../mobile/README.md).
The frozen [old web package](../frontend/package.json) is a migration comparison
source, not another feature/fix target. From the relevant active package:

| Purpose | Command / boundary |
| --- | --- |
| Routine owning logic feedback | Focused backend tests or `npm --prefix mobile test`; source checks are not release acceptance. |
| Types | `npm run typecheck` in `backend/` or `mobile/`. |
| Universal active-route review | From `mobile/`: `node scripts/active-parity.mjs --check` and `node --test scripts/active-parity.test.mjs`. An in-sync inventory is not functional parity. |
| Existing web retirement | From `mobile/`: `node scripts/active-parity.mjs --retirement` (add `--json` for exact blocking paths). Required platform proof uses browser/simulator/emulator evidence; physical hardware is not a retirement prerequisite. Missing active capability, Simulation/recovery/visual evidence and owner review remain explicit. |
| Universal frontend owning behavior | From `mobile/`: `node node_modules/tsx/dist/cli.mjs --test test/name.test.ts`; select the actual owning test. |
| Backend owning behavior | `npm test -- test/name.test.ts`; requires the explicit disposable target for native/API cases and builds the backend first. |
| Full regression | `npm test`; backend full/default remains serial with per-file isolation. Prepare a fresh disposable target as CI does; do not reuse an already-populated full-run database as clean-room acceptance. |
| Simulation source audit | `npm run simulation:conformance:audit` from `backend/`; inspect both safety and capability-evidence gaps. Regenerating its lock is not a substitute for testing changed behavior. |
| Database catalogue review | `npm run db:audit` from `backend/`, with the explicitly reviewed database selection; metadata only, not workload performance or permission to drop indexes. |
| Floor-plan joined lifecycle | `node scripts/test-floor-plan-onboarding.mjs` from the root; creates two exact owned disposable PostgreSQL 17 databases, runs native/COW checks without building normal `dist`, and cleans only its own zero-client stores. Read the runner before use. |

Backend native tests require `TEST_DATABASE_ISOLATED=true` and the same explicit
disposable loopback target in `DATABASE_URL`, `MIGRATION_DATABASE_URL` and
`EVENT_DATABASE_URL`. Real COW/product suites additionally need their own distinct
safe source/target variables and opt-in flag documented in the backend guide.
Never infer targets from ambient `.env`, seed Live, enable outbound providers, or
reuse the retained product Simulation database as a test store. Use the existing
PostgreSQL 17 server rather than creating another server. Do not force disconnects
to clean a fixture; retain and report a still-connected exact owned target.

`npm test` and normal backend builds emit `backend/dist`. If a managed preview
watches that tree, use a separately reviewed output/staging process; a test/build
must not silently restart or replace the preview. Preserve current environment,
data and retained worlds during controlled activation. Git-dependent checks remain
deferred while repository metadata points into the protected Omnischool folder.

For affected UI, inspect actual loading, empty, error, pending and recovery states;
320/390px phone and suitable tablet/desktop layouts; Light/Dark and blue/amber;
readable complete dates, focused fields, keyboard/action visibility, overflow and
44px targets. Browser emulation is not physical Safari, keyboard, screen-reader,
Dynamic Type or native permission acceptance. Restore temporary appearance,
viewport, session/world selection and owned fixture processes after the check.

<a id="operations"></a>
<a id="facilities"></a>
<a id="people"></a>
<a id="care"></a>
<a id="brand"></a>
<a id="ui"></a>

## Evidence index

These are retained artifact locations, not claims that every old report passes on
current source. Refer to the exact receipt inside each folder before reusing it.
Raw historical QA also recorded intermediate failures and superseded UI; those
must not be promoted into current instructions.

| Concern | Inspectable evidence and bounded meaning |
| --- | --- |
| System audit and remediation | [system-audit-20261024](../artifacts/system-audit-20261024/), [feature-audit-20261027](../artifacts/feature-audit-20261027/). Original findings are historical; later messaging, academic and continuity closures below do not close every finding. |
| Messaging integrity | [messaging-integrity-20261027](../artifacts/messaging-integrity-20261027/): scoped access/policy/history/replay repairs. |
| Academic evidence and reports | [academic-integrity-20261027](../artifacts/academic-integrity-20261027/): dated roster/publication, exact result scope, remarks concurrency, file availability and actual branch-only remark. |
| Care, Resources and Dining continuity | [continuity-recovery-20261027](../artifacts/continuity-recovery-20261027/), [operational-continuity-20261027](../artifacts/operational-continuity-20261027/): C13–C17 closures; these are not all-campus workflow acceptance. |
| Database ownership and faster feedback | [database-cleanup-20261024](../artifacts/database-cleanup-20261024/), [test-optimization-20261024](../artifacts/test-optimization-20261024/): historical upgrade/provenance/catalogue and test-lane/reduction receipts; old table/test totals are not current inventory. |
| Canonical People and first use | [unified-people-ui-20261020](../artifacts/unified-people-ui-20261020/), [attendance-first-ui-20261020](../artifacts/attendance-first-ui-20261020/), [whole-campus-onboarding-20261026](../artifacts/whole-campus-onboarding-20261026/). Older adapter gaps require present-code review before declaring closure. |
| Fees | [fees-first-ui-20261023](../artifacts/fees-first-ui-20261023/), [fee-batches-ui-20261023](../artifacts/fee-batches-ui-20261023/), [fee-corrections-ui-20261023](../artifacts/fee-corrections-ui-20261023/), [finance-ui-refinement-20261024](../artifacts/finance-ui-refinement-20261024/): scope, collections, correction/history and compact UI. The swipe experiment was subsequently removed; it is not a retained interaction pattern. |
| Borrowing and exact-copy quantity | [resource-loans-20261024](../artifacts/resource-loans-20261024/): issue, partial return, correction, questions and quantity 1–100 creates independent tagged copies; source/COW/HTTP results are distinct from physical handover. |
| Accommodation | [accommodation-refinement-20261025](../artifacts/accommodation-refinement-20261025/) and [room-model browser image](/Users/abhishekyadav/.codex/visualizations/2026/10/18/01a15018-0971-7ba1-a7b6-273477532500/accommodation-room-model-mobile-2026-10-24.png): dedicated rooms/places, explicit allocation versus offer, moves, access custody and compact continuation. A planned end is not an automatically due move-out task. |
| Dining | [Live service image](/Users/abhishekyadav/.codex/visualizations/2026/10/18/01a15018-0971-7ba1-a7b6-273477532500/dining-service-mobile-2026-10-25.jpg) and [isolated service image](/Users/abhishekyadav/.codex/visualizations/2026/10/18/01a15018-0971-7ba1-a7b6-273477532500/dining-simulation-mobile-2026-10-25.jpg): dated/weekly menus, exceptions, explicit serving totals/correction and responsible shortage work. Source-owned services/counts do not establish individual entitlement, food safety or billing. |
| Visits and shared questions | [visitor-joining-20261026](../artifacts/visitor-joining-20261026/), [visitor-arrangements-20261026](../artifacts/visitor-arrangements-20261026/), [visit-guest-20261026](../artifacts/visit-guest-20261026/). Arrangements, mailbox proof, private sharing/question response and optional boundary observations remain separate. |
| External repair work | [external-work-20261026](../artifacts/external-work-20261026/): exact dated job grant, joining/acceptance, progress, campus verification and isolated evidence; not general contractor procurement/access authority. |
| Teaching | [teaching-sessions-20261024](../artifacts/teaching-sessions-20261024/): dated preparation, materials, reported coverage and owning learning links. |
| Campus map, interiors and life | [virtual-campus-20261025](../artifacts/virtual-campus-20261025/), [campus-map-workspace-20261027](../artifacts/campus-map-workspace-20261027/), [campus-map-motion-20261027](../artifacts/campus-map-motion-20261027/), [building-explorer-20261027](../artifacts/building-explorer-20261027/), [aaranya-building-interiors-20261027](../artifacts/aaranya-building-interiors-20261027/), [campus-life-20261027](../artifacts/campus-life-20261027/). Planned people, scan observations, source geometry and illustrative motion are different evidence. |
| Reviewed floor-plan onboarding | [floor-plan-onboarding-20261028](../artifacts/floor-plan-onboarding-20261028/), [floor-plan-activation198-20261028](../artifacts/floor-plan-activation198-20261028/). Release 198 / schema 277 native/COW plus actual provider/browser workflow; image inference is reviewed drafting, not a survey. |
| Annual Calendar and Aaranya | [aaranya-calendar-year-20261028](../artifacts/aaranya-calendar-year-20261028/), [aaranya-leave-20261026](../artifacts/aaranya-leave-20261026/), [iiita-operational-20261025](../artifacts/iiita-operational-20261025/), [iiita-campus-20261025](../artifacts/iiita-campus-20261025/). Fictional operations use source-qualified research; see the tour below. |
| Assistant and shared appearance | [app-theme-20261020](../artifacts/app-theme-20261020/), [assistant-brand-20261027](../artifacts/assistant-brand-20261027/), [radius-consistency-20261027](../artifacts/radius-consistency-20261027/), [native-activation189-20261028](../artifacts/native-activation189-20261028/). Original Assistant artwork is preserved. Historical Vertex/Gemini provider readiness is not a permanent credential/availability guarantee. |
| Latest public Simulation recovery | [simulation-phone-recovery-20261028](../artifacts/simulation-phone-recovery-20261028/); current summarized acceptance is below. The older capacity/entry/removal folders retain prior scope, not a second current manager. |
| Native application | [native-app-20261027](../artifacts/native-app-20261027/), [native-ui-alignment-20261027](../artifacts/native-ui-alignment-20261027/), [native-brand-20261027](../artifacts/native-brand-20261027/), [native-loading-20261027](../artifacts/native-loading-20261027/), [native-campus-layout-20261028](../artifacts/native-campus-layout-20261028/), [native-insights-20261028](../artifacts/native-insights-20261028/). Use the current [native parity map](../mobile/PARITY.md), not an old export's success, to decide what is supported. |

## Simulation

Latest normal Mac activation: **release209/schema280**, fingerprint
`sha256:9d26530bb392241b87758aa195c387216b2ac8bf79277f58d18e81e66b2d2e9e`. The
[reviewed stage](../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-reviewed-stage.json),
[before](../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-before.json),
[after](../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-after.json),
[activation verification](../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-activation-verification.json)
and [supervisor proof](../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-supervisor.json)
confirm the source-only209 correction with no additional migration. The
[208 schema activation](../artifacts/native-web-ui-20261029/profile-polish/visit-campus208-activation-verification.json)
retains the exact279/280 migration proof. Checksums through278 and normalized
retained domain rows, both protected worlds and configuration/public origin
remain unchanged, with one ready normal API listener. The normalization only removes the new null destination
column when comparing pre-existing rows. No history/data/world restore or provider
activation occurred. Prior205/208 binaries and private database backups remain.208 contains the
reproduced metadata defect and should not be restored for ordinary campus writes.
The final 27-test receipt verifies that campus model metadata/kind/labels/revisions
are preserved. Original205 has
an explicit limit: once a whole-campus visit is saved, preserve current data and
repair forward instead of running the place-only205 reader. Rollback was not
exercised and whole-app retirement is not accepted by this activation.

The [stable-source database receipt](../artifacts/native-web-ui-20261029/profile-polish/visit-campus/20261030_84717977/runner.json)
binds 27 passing real PostgreSQL/COW checks, including a room-to-entire-campus
branch change, exact replay/history, unchanged Live/sibling records and minimized
organiser/public/participant views. Both exact disposable databases were dropped
with zero clients; no forced disconnect or retained-world operation was used.
[193 shared frontend checks](../artifacts/native-web-ui-20261029/profile-polish/visit-management-tests.log),
[24 private-account checks](../artifacts/native-web-ui-20261029/profile-polish/profile207-isolated-tests.log),
[mobile types](../artifacts/native-web-ui-20261029/profile-polish/visit-management-typecheck.log),
[backend types](../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-backend-typecheck.log)
and [conformance209](../artifacts/native-web-ui-20261029/profile-polish/visit-campus209-conformance.log)
pass within those exact scopes. Fresh209 captures are required for the destination
schema; protected older captures are unchanged, not relabelled compatible.
The earlier [205 source freeze](../artifacts/native-web-ui-20261029/visit-onboarding-backend/source-freeze.json)
remains evidence for that earlier visitor-registration scope. Public account
ceremonies stay Live-only; the SMS adapter is disconnected, email remains disabled
and `coverage_complete` remains false. Deferred platform, rendered recovery and
full workflow checks remain open.

Migrated TypeScript implementations in `packages/contracts/src` now enter the
semantic conformance seal; changing an implementation invalidates it, while
comments and test-only files do not. The
[combined conformance/domain tests](../artifacts/native-web-ui-20261029/migration203-combined-tests.log)
pass100/100 for203. The204 [temporal batch source/PG receipt](../artifacts/native-web-ui-20261029/temporal-batch-20261029_d9380d89/source-review.json) adds110 focused tests and 12 actual PostgreSQL checks, including COW history/namespace isolation and434→8 acquisitions for217 input positions. These are not217 distinct real campus rooms or an end-to-end latency benchmark. The204 [conformance tests](../artifacts/native-web-ui-20261029/migration204-conformance-tests.log) pass6/6, with its [updated seal](../artifacts/native-web-ui-20261029/migration204-conformance-seal.log)
and [verification](../artifacts/native-web-ui-20261029/migration204-conformance-check.log)
matching the 204 fingerprint at that checkpoint. These earlier temporal proofs remain
bounded to their original scope. No external email, Google or payment configuration
was enabled by the 205 activation.
Google's native configuration endpoint returns200 with availability disabled;
actual Google client/origin credentials were not configured. The
[MFA lock proof](../artifacts/native-web-ui-20261029/native-google-locks-verified-20261029_ca60a802/source-review.json)
includes195 Auth checks and five actual PostgreSQL 17 concurrency schedules after
the old source reproduced40P01. The finalizer's account NO KEY UPDATE lock retains
MFA serialization while permitting foreign-key KEY SHARE. Its controlled-driver
tests separately cover account/membership refusal and rollback; the native PG
receipt does not prove every such concurrent schedule.

[Assistant transport](../artifacts/native-web-ui-20261029/assistant-native-transport-source-review.json)
passes112 guarded HTTP/source checks. The original verified native Bearer remains
inside fixed in-process owning HTTP requests, rechecks normal session/domain
guards, and refuses changed actor/campus/world context; browser signed CSRF and
channel delegation remain distinct. The
[CampusView admission receipt](../artifacts/native-web-ui-20261029/campus-admission-20261029_ccd95c4a/source-review.json)
passes49 source plus seven actual PostgreSQL checks, preserving all ordered places
under a shared two-read budget. Release204 replaces per-place temporal SQL with bounded64-subject batches through the same owner, preserving input order, both clocks and selected-world routing. Pool sizes and native deadlines are unchanged.
[Assigned Insights](../artifacts/native-web-ui-20261029/analytics-eligibility-20261029_02823125/source-review.json)
retains exact dated class/assessment authority rather than administrator bypass.
The [actual iPhone Assistant receipt](../artifacts/native-web-ui-20261029/migration203-iphone-assistant-runtime.json) records one completed Vertex read-only question, one owning Assessment tool, rendered evidence/source navigation and labelled return to the retained answer. Consequential action and interruption/relaunch acceptance remain open. These bounded checks do not establish whole-domain parity.
The [actual release203 native-Bearer HTTP receipt](../artifacts/native-web-ui-20261029/release203-native-api-20261029112949-46855d.json)
passes34 checks across Live and one fresh isolated draft, including Director
assigned Insights, concurrent CampusView/mine/operations, an exact synthetic
Facilities report/replay, correlated outcome/map signal and unchanged Live.
The exact owned draft was fenced-removed and both separate test sessions revoked.
Its diagnostic request bound was45seconds: cold Simulation admin/operations reads
took34.56/31.89seconds, exceeding the app's30second deadline. This remains a native
loading failure despite backend200 responses. The activated204 repair passes the
[strict native30second acceptance](../artifacts/native-web-ui-20261029/release204-native-api-20261029115716-162065.json):38/38 checks, with first cold selected-Simulation mine/admin/operations reads at4.10/11.22/11.23seconds, versus Live0.26/0.05/0.57seconds. All217 spaces and 269 mapped assets match, including exact metadata/publication. One exact synthetic Facilities report/replay produces its correlated outcome/map degradation while Live is unchanged; the owned draft was guarded-stopped/fenced-removed and its separate session revoked. These are actual native-Bearer HTTP checks, not rendered all-device acceptance. Pool or app deadlines were not widened.
The broader runtime isolation acceptance described below remains release199 evidence.

The unified Saved list is owner-paged; Compare runs deliberately enables selection.
Removed worlds live only in Run history and consume no saved-world slot. Discard
draft names the run and performs a revision/authority-guarded Stop followed by
native fenced cleanup. Unknown Stop outcomes reconcile the exact run before any
further action; this is not an atomic-delete promise. Active, pinned, leased or
selected worlds cannot bypass native cleanup protection. Retained history is not
recoverable isolated state and must not be presented as a remaining saved world.

Actual public HTTPS checks started an ordinary baseline, opened amber app screens,
advanced virtual time, paused, resumed, stopped and returned to Live. A separate
owned real COW draft passed conditional Stop, cleanup and accepted replay while
other runs stayed unchanged. Three owned test worlds were permanently removed;
existing authored drafts and their history were preserved. The browser's draft
confirmation/Cancel was inspected separately rather than deleting a user's draft.

Inspect `final-state199.json`, `actual-cow-draft-discard199.json`,
`combined-source199.json`, `05-release199-running-phone.png`,
`06-release199-today-phone.png` and `07-release199-saved-phone.png` under the
[recovery artifacts](../artifacts/simulation-phone-recovery-20261028/).
The managed launcher's PostgreSQL 17 tool path, snapshot preflight,
checkpoint-boundary controls and bounded Work readers address the observed start,
busy-control and connection-pool failures. **Cold large-world first opens still
took 14–38 seconds** in this bounded review. Safety readiness does not imply complete
capability coverage or uniformly fast first-open performance.

For a phone report, verify the current public URL reaches the managed React Native Web host
and API, then check `/readyz` and `/releasez`; HTTP 200 for login alone proves little.
Confirm the actual run's status, snapshot/capture outcome and saved-world quota.
Do not raise quotas, remove authored drafts, clear worker leases or fall back to
Live to disguise an unavailable world. `pg_dump` must be executable by the managed
service and compatible with PostgreSQL 17; a test-shell PATH is not launcher proof.
Use a clearly named owned disposable run for start/control testing and return its
session to Live before guarded terminal-world cleanup.

<a id="native"></a>

## Core functionality audit

The [8 November audit](../artifacts/core-functionality-audit/review.json) is a
bounded source/contracts, pure/local-test and authenticated cloud-read review at
release `3b88a167ac475c44b9b8e93f804f6ab2cb1622c8`. It is not all-workflow acceptance.
[Domain findings](../artifacts/core-functionality-audit/domain-journeys.json),
[mobile recovery/history findings](../artifacts/core-functionality-audit/mobile-functional-audit.json)
and [DT/operations findings](../artifacts/core-functionality-audit/dt-operations-audit.json)
record exact source lines, test references and known limits. Current priorities and
finished-outcome criteria belong to the [delivery plan](blueprint/IMPLEMENTATION_PLAN.md#core-functionality-closure).

Fresh checks pass: 48 local recovery cases, 36 grading/offering contract cases and
18 mocked coordination boundaries; 102 total, zero failed/skipped. No real PG
integration suites were rerun. Existing real COW test sources were inspected but
are not counted as fresh passes. The mobile inventory still reports 129 routes,
29 implemented-unverified groups/80 capabilities, with **53** exact source-review
findings. These are dependency/fingerprint drift, not compiler errors or missing
feature counts. [Core source conformance](../artifacts/core-functionality-audit/dt-conformance-current.json)
is revision 215, safety-ready/no blockers, with 80 unverified capability-evidence
slots across 24 modules; that is a separate ledger, not 80 reproduced defects.

At that audit checkpoint the Mac was locked and no rendered tour was claimed.
It is now unlocked; the bounded Safari217 check reproduced the setup-entry defect
described below, without completing rendered multi-account or device acceptance.
Authentication sessions created by the audit
were revoked and refused afterward; no domain command, provider inference, email,
SMS or restore job was dispatched. Owner direction defers TestFlight to prioritize
functional closure. Do not waive Simulation, recovery or actual user-outcome tests.

The method follows [React Native's testing distinctions](https://reactnative.dev/docs/testing-overview),
[explicit idempotent API request identity](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
and [TanStack's configurable read retry contract](https://tanstack.com/query/latest/docs/framework/react/guides/query-retries).
Existing source behavior, rather than these general references, establishes each
finding. A successful read is not proof an earlier ambiguous write committed.

### Course and class examinations

The local physical-examination path uses the same room, policy, Offer, revision,
attendance, marks and publication owners for a class or configured course.
Migration 288 preserves legacy identifiers and freezes canonical person/enrollment
evidence for course candidates. The PostgreSQL class regression retains Student
selectors and class result provenance. The compiled HTTP course practical
exercises a distinct invigilator, room/date amendment, renewed acceptance,
attendance, incident, examiner, moderation and private learner results. The
isolated COW viva exercises automatic marking, multi-course report publication,
and unchanged Live and sibling state. A reviewed elective transfer after freeze
retains the original candidate and enrollment revision through amended Calendar
and published marks. Fifteen targeted PostgreSQL/API tests pass against a fresh
17 database migrated through the final migration 288. [Backend receipt](../artifacts/core-completeness-2/examinations/backend.json)
· [COW acceptance](../backend/test/academic-offering-worlds.integration.test.ts).

The rendered officer changed the room, the invigilator accepted the replacement
duty and the officer confirmed readiness. The learner saw the revised room and
received 403 from the private sitting endpoint. A second rendered run used a UTC
institution and an Asia/Kolkata device. The officer changed 09:00 to 10:00 UTC
using the date/time control, the invigilator accepted again, and the learner's
Calendar showed 10:00–11:00 UTC. The compiled API regression also checks a
Kathmandu schedule whose institution date differs from UTC. [Room read-back](../artifacts/core-completeness-2/examinations/browser-room-revision.json)
· [Time-zone read-back](../artifacts/core-completeness-2/examinations/browser-time-zone.json)
· [Time-zone HTTP receipt](../artifacts/core-completeness-2/examinations/backend-time-zone.json).

The mounted mobile test switches class and course in one workspace and exercises
exam, practical and viva in both. It checks exact selector identity and review
before dispatch. Mobile type checking, all 2,001 mobile tests, 45 release guards
and strict Simulation conformance revision 229 pass. The app's course
marksheet HTML rendered as a one-page WebKit fixture and was visually reviewed.
The authenticated print dialog and native sharing require separate checks.
[Mounted authoring test](../mobile/test/assessment-authoring-mounted.test.ts)
· [Rendered fixture PDF](../artifacts/core-completeness-2/examinations/marksheet-webkit-fixture.pdf).

The subsequent marksheet redesign uses the same authenticated print path.
Chrome printed the shared template as A4 for a one-course exam, a semester GPA
card with a separate cumulative appendix, and a class percentage report.
A long Simulation fixture checked continued table headers, row completeness and
the per-page watermark. Focused tests cover grades-only and withheld records
alongside percentage and GPA. [Marksheet tests](../mobile/test/published-marksheet.test.ts).

Separate local reliability checks reproduced four-client pool saturation,
queued timeout and recovery on PostgreSQL 17.11. A retained compiled revision
224 Facilities path served 72 signed-in reads across 12 six-request waves
with p50 27 ms, p95 89 ms and max 109 ms. An authenticated 393,916-byte photo
upload, identical-command replay and SHA-256-checked private download passed.
Anonymous download returned 401. The final pool had four idle clients and zero
acquisition failures. This used temporary disk, one warm fixture and disabled
workers. Hosted storage, sustained capacity and old/new revision overlap remain
open. Mid-write failure at the final attachment path is a source-derived
recovery gap and needs a separate test and repair.
[Pool test](../backend/test/database-pool-telemetry.integration.test.ts)
· [File finalization](../backend/src/facilities/facilities-artifacts.ts).

## Isolated app2 deployment

`https://app2.thatcampus.com` serves the isolated DT backend and sole Expo web app through dedicated edge/Cloud Run resources, identities, separate Live/Simulation databases on shared PostgreSQL 17 and private persistent files. The owner chose to retain the shared server and existing limits: no new server, resize or pool/concurrency increase. Old ERP and maintained Mac development remain separate targets. Operations and code-versus-data rollback belong to the [DT runbook](../deploy/dt/README.md).

Release 220 retains catalogue recovery, assignment handover and future examination
amendments, and adds canonical course teaching/results/reports/Calendar, reviewed
elective/Finance transfer, four encrypted browser journal families and durable
account verification/reset intent. Actual mail stages remain separately qualified.
[Current owning status](blueprint/IMPLEMENTATION_PLAN.md#core-functionality-closure)
separates local delivery from serving and rendered acceptance.

The [manual220 seal](../artifacts/core-completeness-2/review/manual-seal-220.json) binds `sha256:6273f9bdc7c943497c299d45844694fde9d35f2da4e3adc1ef04423a5d0e9d73`; actual CI, deployment and post-release reads below identify the same source. These checks do not promote the retained capability or native-retirement inventories.

[Release 220 CI](../artifacts/core-completeness-2/ci-220-verification.json) passes all217 PostgreSQL cases/43 files with zero skips/todo. The [local source summary](../artifacts/core-completeness-2/postgres/reviewed-source-final.json) preserves its earlier217/43 baseline and final overlapping36-,7- and6-case affected native/COW/compiled-HTTP slices with exact zero-client cleanup. Those slices are not added into another matrix total; the earlier [natural-close cleanup](../artifacts/core-completeness-2/postgres/final-cleanup.json) remains retained evidence.

[CI](../artifacts/core-completeness-2/ci-220-verification.json) records571 fast tests/90 files,37 source/auth tests/4 files,1980 mobile cases,45 release guards and strict conformance/types/build/web-export checks. The lint gate retains42 exact unchanged errors, with no new errors or warnings. [Local mobile evidence](../artifacts/core-completeness-2/mobile-final.json) separately includes the production iOS export. [Parity](../artifacts/core-completeness-2/parity/review.json) binds45 current paths at `a86bebdbdbf468f0389a7125c776366ffa08f1ae2ecd05dd97cebdad4ddafc47`, retaining52 older source drifts,129 routes,29 implemented-unverified groups and80 capability entries. Model Core's separate80 unverified evidence slots remain.

[Ten rendered checks](../artifacts/core-completeness-2/rendered/final-acceptance.json) pass in the isolated393×852 IAB Live-web fixture: Finance decision with Today/Work task removal without reload, assessment/report discovery, letter-grade moderation/publication, exact elective continuation and Back, atomic transfer, historical Finance readback, pre/post-effective timetable and learner percentage/grade/GPA reports with frozen precision. Owned accounts were signed out, Metro stopped and the fixture DB dropped with zero clients and no forced disconnect; no production mutation or provider message occurred. Earlier rendered failure screenshots remain beside the final receipt. This is not Safari, a newly installed native build, all-role handover, physical offering-exam amendment, rendered amber/hosted Simulation or actual print/PDF-renderer acceptance. HTML/formatting checks do not close printing.

The approved Resend sender was enabled with managed secret version 1 in release 220 mail-only revision `thatcampus-dt-mail-b8fac640-1794162217151`; image, non-mail settings and capacity are unchanged. [Actual mail outcome](../artifacts/core-completeness-2/email/live-acceptance-followup-220.json) records 2 inbox receipts from 2 of three approved sends. The original verification email confirmed the address, and the original invitation gave the same verified account member access. The password-reset email is still unsent pending the user handoff. In release 220, the invitation code remained in the browser address until the campus opened. Provider acceptance, inbox arrival and recipient action are distinct; no universal delivery guarantee, fresh unverified-invite OTP coverage or fourth message is claimed. Optional SMS remains disconnected.

The predecessor catalogue-refusal [manual conformance217](../artifacts/core-functionality-fixes/review/manual-seal-217.json)
retains fingerprint `sha256:8e3f3ba618058e5b76452f990d032e169d4d1f56c341c82b2940e7e2bdd2e775`.
[Shared tests and web/iOS bundles](../artifacts/core-functionality-fixes/release-local-checks-217.json)
pass; the [source review](../artifacts/core-functionality-fixes/review/catalogue-refusal-217-source-review.json)
and [native review](../artifacts/core-functionality-fixes/parity217/review.json)
preserve their stated limits. All 53 unrelated native findings and 80 capability
evidence slots remain. Old/pinned worlds are not rewritten, standalone indexes are
outside constraint-name preservation, and no provider or worker was introduced.
Email delivery, completed rendered multi-account journeys, the renewed iPhone
install, hosted historical Simulation recovery and broader lifecycle gaps remain open.

Conformance **225** serves app2 from source `182b012b2ea1edd2d01b11c8017637747eecc3f5` and revision `thatcampus-dt-r-182b012b2ea1-42558280411-1`. Campus invitation links clear their proof from the browser address and the join form. [Actions run 42558280411](https://github.com/EduveraIITA/Eduvera/actions/runs/42558280411).

A new recipient completed the actual invitation in a 393 px browser using the compiled API and an isolated TLS mailbox. The mailbox received one invitation and one separate six-digit proof. The verified account opened Work with member access and received 403 for People management. A synthetic link confirmed the cleanup on app2. [Invitation evidence](../artifacts/core-completeness-2/email/invitation-acceptance-225.json) · [Live readback](../artifacts/core-completeness-2/email/invitation-225-live.json).

An isolated assignment journey exercised learner submission, campus administrator handover, the replacement reviewer’s Work task and learner feedback. The original attempt and manifest matched after review. The compiled API denied the former reviewer after revocation. [Browser checks](../artifacts/core-completeness-2/rendered/assignment-handover-4ebd9ec4/browser-ui.json) · [Compiled API and database checks](../artifacts/core-completeness-2/rendered/assignment-handover-4ebd9ec4/journey.json).

Conformance **224** shipped to app2 from source `77cb27766bab5e201f58b0933326e4675f009c90` and revision `thatcampus-dt-r-77cb27766bab-42521304159-1`. The verification and password-reset links carry the proof into the app without a token field. [Actions run 42521304159](https://github.com/EduveraIITA/Eduvera/actions/runs/42521304159).

[Account link checks](../artifacts/core-completeness-2/email/account-link-ui-224-local.json) cover 29 focused cases, mobile type checking and 320/393 px rendered browser checks with synthetic links. The live reset form shows only the two password fields and removes the proof from the address. [Live readback](../artifacts/core-completeness-2/email/account-link-ui-224-live.json).

Conformance **220** shipped to `https://app2.thatcampus.com`, source `b8fac640ce16c56016615ce1a2ebdbc7ed21e7f1`, image digest `sha256:8e31ff71964c84c60e9500a0f73149d0ca61810cae3b1257b2f07fdf37af6101`. [Actions run 42506869281](https://github.com/EduveraIITA/Eduvera/actions/runs/42506869281) and the [release receipt](../artifacts/core-completeness-2/ci-release-42506869281/release.json) record CI release revision `thatcampus-dt-r-b8fac640ce16-42506869281-1`, one-attempt migration `thatcampus-dt-migrate-jxr4g` and candidate/public smoke. [Actual CI](../artifacts/core-completeness-2/ci-220-verification.json) passes 217 PostgreSQL cases across 43 files with zero skips/todo, 571 fast backend cases/90 files, 37 source/auth cases/4 files, 1980 mobile cases and 45 release guards, plus strict conformance/types/build/web export. The lint gate accepts 42 exact unchanged prior errors; ordinary whole-backend lint is not clean. [Live reads](../artifacts/core-completeness-2/cloud-read-220.json) pass for director, faculty and student with every owned session revoked and refused; the bounded first-page course/Calendar reads do not establish a nonzero production course cycle. Email configuration and recipient acceptance are recorded separately below. Physical installation/performance, rendered amber/hosted Simulation, actual printing, all-role journeys and sustained capacity remain open.

The [Safari218 diagnostic](../artifacts/core-functionality-fixes/rendered-browser-218.json) retains the reproduced parent setup-journal warning. Conformance219 admits only its existing SHA256-scoped institution-commands namespace within the finite manifest/chunk grammar; AES-GCM key-bound encryption, nonextractable IndexedDB keys, actor/campus/world/origin validation and credential/native-option denials remain. No journal was renamed and no unknown intent was cleared or replayed. The [actual-hook/storage proof](../artifacts/core-functionality-fixes/email/setup-browser-storage-source.json) records 26 focused passes and mobile types. The [bounded Safari219 check](../artifacts/core-functionality-fixes/rendered-browser-219.json) opens parent setup and the academic form without the storage warning; no values or business changes were submitted, and the owned session was signed out and window closed. [Manual conformance219](../artifacts/core-functionality-fixes/review/manual-seal-219.json) binds `sha256:2dab217f10e110cba760059499157741e95070981dff81cac11d67b1d0c1c278`; [native review](../artifacts/core-functionality-fixes/parity219/review.json) retains all53 findings and80 capability-evidence slots. At that219 checkpoint, the three source-observed prefixes, fees-operations, event-admin and academic-register-action, remained unadmitted; source220 admission is recorded separately above. The predecessor [manual218 seal](../artifacts/core-functionality-fixes/review/manual-seal-218.json), [first218 failed packaging log](../artifacts/core-functionality-fixes/cloud-build-218-first.log) and [reviewed218 build repair](../artifacts/core-functionality-fixes/local-build-repair-218.json) remain distinct evidence. This is read-only director UI acceptance, not successful setup mutations, all-role workflows, native installation or rendered Simulation acceptance.

The [read-only Safari217 handover check](../artifacts/core-functionality-fixes/rendered-handover-217.json) opened five published metadata rows, one pending-review detail and three eligible reviewer choices; no value was selected or submitted. This does not establish a completed handover mutation or multi-account acceptance. The [Safari217 assessment read](../artifacts/core-functionality-fixes/rendered-assessment-217.json) showed a future online assessment with zero learners and existing internal fixture instruction/provenance copy. That confirms the tracked offering-roster integration gap and a product-data cleanup need that must preserve immutable published evidence. No marking or physical schedule amendment was performed; rendered amendment acceptance remains open.

Release 215 restricts teaching-context horizon expansion to activity sources, preserves the caller transaction, adds bounded pool acquisition/lease telemetry, and returns a canonical read-versus-unconfirmed-action 503 for exact acquisition failures, including Fastify's pre-controller rate-limit hook. [Real pool tests](../artifacts/app2-cloud-deployment/pool-telemetry-validation.json), [source/safety review](../artifacts/app2-cloud-deployment/215-independent-source-and-seal-review.json), the retained red regression and CI cover these changes. Pool size remains four. The earlier 214 failures below remain evidence; the latest passes do not identify their historical cause.

The [8 November functional audit](../artifacts/core-functionality-audit/review.json) records the pre-closure serving release215. Director, student and faculty [ordinary native-API tours](../artifacts/core-functionality-audit/cloud-personas.json) pass with five/four/four concurrent map reads in 3154/2768/3165ms, expected management refusals and owned-session revocation. Main-pool metrics show zero held/waiting clients at both observations and zero recorded acquisition failures; these counters do not cover every Simulation pool or establish uninterrupted availability. The [readiness probe](../artifacts/core-functionality-audit/cloud-readiness.json) returns onboarding/profile successfully, optional SMS unavailable and Assistant `ready=false`. [Current flags](../artifacts/core-functionality-audit/provider-config.json) show transactional email disabled and the Vertex allowance expired at `2026-11-08T00:00:00Z`. No email, SMS, inference or domain command was dispatched. Distribution is deferred by the owner while core closure is prioritized.

The serving fixes retain the full 56-day attendance comparison and bounded occurrence hydration from 213; [independent review](../artifacts/app2-cloud-deployment/performance-independent-review.json), [attendance evidence](../artifacts/app2-cloud-deployment/attendance-query-optimization-receipt.json) and [hydration evidence](../artifacts/occurrence-hydration-20261031/validation.json) preserve their scope. The [214 local recovery review](../artifacts/app2-cloud-deployment/notification-recovery-review.json) records exact source hashes, primary PostgreSQL documentation, 7/7 real PG notification parity cases, 39 existing notification checks and 207 focused mobile cases including 11 actual QueryObserver recovery cases. The canonical current-visibility predicate, assigned-work-only gate, complete unread count and filtering before LIMIT remain; one statement/client reuses unread authorization. [Local four-client load proof](../artifacts/app2-cloud-deployment/notifications-concurrency-local.json) preserves identical results for 20 bell reads plus four native session restores. [Nine worker PG cases](../artifacts/app2-cloud-deployment/bridge-native-tests-final.json) include the actual mixed academic/activity COW checkpoint: activity-only horizon expansion, source-neutral retained finalization, current-policy refusal and unchanged Live/sibling. The [owned notification DB was removed](../artifacts/app2-cloud-deployment/notifications-cleanup.json).

**Transition failure is retained.** Earlier [213 physical restore failures](../artifacts/app2-cloud-deployment/native-pool-recovery-213.json) and the [first 214 native login failure](../artifacts/app2-cloud-deployment/concurrent-native-214-transition.json) are not erased by later passes. [Read-only diagnosis](../artifacts/app2-cloud-deployment/pool-214-diagnostic-review.json) correlates the first 214 login with pool acquisition failure, old/new process overlap reaching ten runtime connections, a progressing older transaction and a nested notification statement timeout. [By 10:52 UTC](../artifacts/app2-cloud-deployment/pool-drain-review-214.json), only the current listener/four idle API clients remained without blockers. A [transaction-local JIT-off read](../artifacts/app2-cloud-deployment/bell-jit-readonly-214.json) took 1068ms and rolled back its setting; it is not a same-session on/off causality test. No persistent JIT/server setting or concurrency increase was made. Do not describe the upgrade as uninterrupted.

A later failure at 11:06 UTC occurred after the old process had drained: map and personal-context requests again timed out waiting for a pooled client. The [later diagnostic review](../artifacts/app2-cloud-deployment/pool-214-later-diagnostic-review.json) retains both request IDs and unsuccessful reproduction attempts. Fresh map/mine/bell reads, a fair JIT on/off pair and 90-second periodic-worker sampling subsequently passed; they do not identify the cause or close intermittent reliability. Idle PostgreSQL sessions alone do not prove clients were returned to the application pool. No persistent JIT or capacity setting was changed.

After drain, [three hosted waves of six concurrent native API reads](../artifacts/app2-cloud-deployment/concurrent-native-214.json) all pass in 2636/2553/2476ms with pool 4 unchanged, followed by owned-session revocation/refusal. The [15-check native API tour](../artifacts/app2-cloud-deployment/native-read-214.json) passes: workspace 2437ms, In & Out 103ms, visit options 189ms, scene 350ms, session/me, directory, resources/states, logout and revoked-session refusal. The scene contains 3 mapped buildings, 84 rooms, 261 fixtures and 269 recorded states. Earlier [212/213 stopped-restore samples](../artifacts/app2-cloud-deployment/workspace-baseline212-timing.json) and [213 timing](../artifacts/app2-cloud-deployment/workspace-optimized213-timing.json) remain historical evidence. None is a sustained-load, occupancy or physical frame-rate measurement.

[Six rendered browser checks on 214](../artifacts/app2-cloud-deployment/browser-cloud-214.json) pass for the fresh floor canvas, mapped computer availability/status, exact report holding/room prefill, Report Back with exact floor/room/computer and visible canvas, Campus clearing stale resource/interior intent, and canonical first-floor selection. No report was submitted. This verifies the reproduced blank-floor/Back correction in that browser scope; the historical transient outdoor issue remains unclosed. The earlier [213 browser record](../artifacts/app2-cloud-deployment/browser-cloud-213.json) remains the before-fix evidence. [During-214 existing-target proof](../artifacts/app2-cloud-deployment/old-deployments-preserved-214.json) records all four old serving revisions/traffic unchanged and no old service mutation; the [post-213 health record](../artifacts/app2-cloud-deployment/old-deployments-preserved-213.json) retains its earlier health checkpoint.

Permanent-origin native Release build 3 is [installed](../artifacts/app2-cloud-deployment/ios-build3-install.json), with [origin/version](../artifacts/app2-cloud-deployment/ios-build3-origin.json), [ABI](../artifacts/app2-cloud-deployment/ios-build3-abi.json) and [code-signing](../artifacts/app2-cloud-deployment/ios-build3-codesign.log) checks. Recorded iPhone checks showed Today and the campus map loading. Device Hub coordinate input did not reliably reach the device; the owner's In & Out/Arrange visit check remains pending. There is no full physical tour, mutation, sustained frame-rate, thermal or battery acceptance. The normalized-origin restore policy forgets a credential for another origin locally and never sends it to app2 or resets the password. Earlier Mac-tunnel hardware evidence is distinct. Build 3's Personal Team profile expired `2026-11-07T04:18:20Z`; no Expo Updates delivery is configured, and native UI changes require rebuild/reinstall. Apple Support shows a case confirmation; paid enrollment/App Store Connect/TestFlight remain unconfirmed.

Forward migration 281 fixes migration 270's PL/pgSQL local `source_id` collision during role changes. The [fresh PG receipt](../artifacts/app2-cloud-deployment/role-source-forward-migration-receipt.json) retains 5/6 before, 6/6 after and 42/42 full checks with zero skips. Function identity, privileges, SECURITY INVOKER, search path and 15 triggers remain. Ordinary `SimulationWorldService.open` refuses an old 211 capture with 409 `simulation_snapshot_incompatible` while its stored world/rows/functions remain unchanged; this is not an automatic world upgrade. The [Core identity-port review](../artifacts/app2-cloud-deployment/core-identity-independent-review.json) retains 44 focused checks. [214 lint](../artifacts/app2-cloud-deployment/lint-214.log) accepts exact unchanged existing debt rather than clean ordinary lint. [Historical narrow acceptance](../artifacts/iphone-network-recovery-20261031/narrow-source-acceptance.json) retained 49 source-review findings; the current audit records 53 and 29 implemented-unverified groups; retirement/full-workflow acceptance remains open.

**Simulation restoration remains incomplete.** Continuation `22wz4` [failed](../artifacts/app2-cloud-deployment/restore-continuation-result.json). The [remaining-only plan](../artifacts/app2-cloud-deployment/simulation-postdata-continuation-plan-20261031.json) matches 4597 table counts and 238 sequence states, not full row-content hashes, and selects 17905 missing entries: 14707 foreign keys/3198 RLS flags. The newer [shared-capacity packet](../artifacts/app2-cloud-deployment/bounded-postdata-shared-capacity-plan.json), review hash `b1be4c07e1463bc874ab9ff9aacfa8b608c0223177dd70fd2c354c12277d24d9`, is [independently reviewed](../artifacts/app2-cloud-deployment/bounded-postdata-independent-review.json), with 18 passing policy cases and three additional failure probes. Its 900-second hard job timeout retains the eight-minute/1000-entry work ceiling, one restore connection, short transactions, health-paced pauses and an admission fence; a brief maintenance connection ends before DDL. The exact reviewed packet has been uploaded and job `thatcampus-dt-bounded-postdata` created with a 900-second timeout; it has never been executed. Fresh exact-job/archive/catalogue, terminal-controller, target-backend/prepared-transaction, shared-health and admission checks remain launch prerequisites. A source review or readiness probe does not prove restore capacity or authenticated-flow latency. Every bounded invocation/partial failure requires a fresh catalogue comparison and reviewed remaining-only plan. An ambiguous fence result needs its separate inspected recovery path; never retry DDL automatically. Preserve retained worlds and private archives.

**Still open:** hosted historical Simulation readiness, ordinary authenticated attachment upload/download after the passing [bounded file probe](../artifacts/app2-cloud-deployment/file-storage-verification.json), the owner's pending physical In & Out/Arrange check, full physical workflows/performance, sustained shared-capacity performance, wider parity and distribution. Heavy transfer interference remains recorded; no new server, resize or pool increase is authorized. The [provider window](../deploy/dt/README.md#exact-ci-release-sequence) ended `2026-11-08T00:00:00Z` without cloud inference acceptance.

## Native app

Live development is active at the maintained
[public HTTPS preview](https://quit-cloth-shore-listing.trycloudflare.com). The
normal web job runs `mobile/scripts/serve-web-preview.cjs --mode development
--metro-origin 'http://[::1]:8084'`, retaining the normal `dev.thatcampus.web` job,
loopback port 5173, existing Cloudflare process and same-origin API 8000 cookie/CSRF
ceremony. No Vite server is involved. The
[18 HTTP/WebSocket checks](../artifacts/native-web-ui-20261029/live-development-host-tests.log),
[real Metro probe](../artifacts/native-web-ui-20261029/live-development-existing-metro-probe.json)
and [isolated candidate](../artifacts/native-web-ui-20261029/live-development-host-root-candidate.json)
verify the bounded web recipe, HMR registration, API routing and denied development/
native surfaces. The [source receipt](../artifacts/native-web-ui-20261029/live-development-host-source-review.json)
and [independent review](../artifacts/native-web-ui-20261029/live-development-host-independent-review.json)
state their exact limits. The
[public activation receipt](../artifacts/native-web-ui-20261029/live-development-public-activation.json)
records the running managed development job, signed-in app, public Visits route,
API readiness and denied inspector/control/native-bundle paths. The
[rendered source probe](../artifacts/native-web-ui-20261029/live-development-hmr-source-probe.json)
confirms Fast Refresh without reload for one component edit and exact restoration;
input survived both updates and the owned probe input was then cleared. An
already-open frozen client needs one refresh; subsequent supported source edits
use Fast Refresh. Hook/signature changes can still reset state.
The eager initial web graph is about 16.7 MB in the candidate and is a deliberate
development tradeoff, not production readiness.

The [native proxy transport review](../artifacts/native-device-auth-20261031/native-proxy-source-review.json)
reproduces a cookie-free, no-Origin native login being rejected before the API
with403 plain text. The isolated candidate returns the API's400 JSON validation
for the same empty request. Its24 HTTP/WebSocket/proxy checks preserve exact
browser Origin/CSRF, Host, cookie isolation, selected-world headers and denied
debug/native bundle paths. Explicit native JSON account ceremonies and presented
native Bearer API requests use no invented browser Origin or Set-Cookie; the API
still owns authentication and authority. These source and no-credential probes
are separate from managed-host activation and actual physical sign-in evidence.

The reviewed gateway is now activated on this Mac. A
[public no-credential native probe](../artifacts/iphone-login-testflight-20261031/public-native-proxy.json)
reaches the API's400 JSON validation without cookies, and an ordinary
[IIITA credential probe](../artifacts/iphone-login-testflight-20261031/iiita-credential-probe.json)
authenticates successfully; that temporary probe session was immediately revoked.
This confirms the public native auth path separately from the bounded physical
sign-in evidence above. The owner chose Individual Apple Developer enrollment;
the official Mac app now immediately reports “Unable to Continue” and directs
the account to Apple Developer Support. The existing Support tab now shows a
case confirmation. This does not establish a paid team, App Store Connect app
or TestFlight upload; none has been confirmed. The
[TestFlight runbook](../mobile/README.md#testflight) preserves the local archive
workflow and actual SQLCipher encryption review.

The historical static [routing receipt](../artifacts/native-web-ui-20261029/native-web-cloudflare-preview.json)
records public authentication and authorized data, campus-map rendering, deep-route
reload and Copy, nine host HTTP checks and independent review. That export is
`artifacts/native-web-ui-20261029/native-only-ports-final-universal-export`.
The [static HTTP validation](../artifacts/native-web-ui-20261029/native-only-public-http-validation.json)
verifies20 real local/public requests, including deep routes, exact current entry
scripts and dependency-matched CanvasKit bytes. The
[deployment preparation](../artifacts/native-web-ui-20261029/native-only-final-export-deploy-preparation.json)
records the prior native supervisor backup and33 retained immutable lazy assets
for already-open native-web tabs; no old frontend feature/build maintenance occurred.
Static mode remains for rollback and reviewed release exports; it requires a new
export for source changes. Quick Tunnel addresses are temporary, SSE is unavailable,
and existing ordinary HTTP polling remains. API configuration/history and frozen
old frontend rollback source are retained. The [runbook](../mobile/README.md#this-macs-managed-public-preview)
records the host modes and managed-job replacement procedure, including waiting
for asynchronous removal before bootstrap; legacy rollback was not executed. This preview
routing change closes none of the 29 groups' Live/Simulation, recovery or cutover gates.

One earlier public-campus check produced a blank canvas that survived Close/Fit
and recovered after reload. The repeated map, loaded Assistant bubble and Copy
check passed, but the cause remains unconfirmed. The
[bounded renderer review](../artifacts/native-web-ui-20261029/public-campus-transient-review.json)
records this open issue; no speculative renderer fix or recovery acceptance is claimed.

The universal React Native target has a maintained
[current-active inventory](../mobile/parity/active-web.json):129 mounted canonical
web paths,29 capability groups and78 capability entries. The
[native-only checkpoint](../artifacts/native-web-ui-20261029/native-only-final-verification.json)
records 1604 passing mobile tests, whole-mobile TypeScript and web/iOS/Android
exports at that boundary; the newer In & Out checks below supersede its test count. The [bounded reconciliation](../artifacts/native-web-ui-20261029/native-only-source-reconciliation.json)
and [independent review](../artifacts/native-web-ui-20261029/native-only-inventory-independent-review.json)
verified 1424 watched sources at that checkpoint, zero drift, ten passing maintained gate
tests and the expected retirement exit1/29blockers. No statuses or acceptance
arrays were promoted. Earlier fingerprint receipts below are historical provenance. The [current source closure review](../artifacts/native-web-ui-20261029/current-source-review-reconciliation.json)
reconciles the original1323 paths; the
[current bounded reconciliation](../artifacts/native-web-ui-20261029/google-assistant-parity-source-review.json)
and [parent-control review](../artifacts/native-web-ui-20261029/migration203-insights-parent-button-review.json)
record the earlier1337-path boundary. The [iPad split reconciliation](../artifacts/native-web-ui-20261029/assistant-ipad-split-parity-reconciliation.json)
records the earlier1354-path boundary. The
[public-host reconciliation](../artifacts/native-web-ui-20261029/native-web-cloudflare-parity-reconciliation.json)
adds the independently reviewed host as path1355, preserving every prior source
fingerprint, route and capability status. The
[source check](../artifacts/native-web-ui-20261029/native-web-cloudflare-source-check.json)
reports zero drift; the [retirement check](../artifacts/native-web-ui-20261029/native-web-cloudflare-retirement-check.json)
still blocks all 29 groups.
All 29 groups have source implementations recorded as implemented-unverified. Bounded [web assigned Insights](../artifacts/native-web-ui-20261029/migration204-web-insights-acceptance.json) and [iPhone Assistant](../artifacts/native-web-ui-20261029/migration203-iphone-assistant-runtime.json) receipts now populate their corresponding acceptance references; remaining group capabilities/platforms remain open.
**All 29 groups still block
retirement** through remaining functional acceptance. The active-route check
excludes redirect-only persona URLs and unmounted abandoned pages while retaining
current history, Core and Campus Lab. See the
[retirement gate](../mobile/PARITY.md#active-web-retirement-gate) for commands,
exact blocking paths/modes and required platform/Simulation/recovery/visual receipts.
A passing structural inventory is separate from working browser/native parity.

The final bounded source-port coverage combines the
[72-route account/workspace review](../artifacts/native-web-ui-20261029/source-port-completeness-half-a.json)
and [57-route operating review](../artifacts/native-web-ui-20261029/active-operating-port-source-audit.json):
their disjoint sets exactly cover all 129 inventory paths. These reviews followed
reachable screen bodies, query/local modes, actions and current owning APIs; they
were not route-presence or generic-form checks. All screen/control omissions they
identified now have universal source ports. The
[four-port closure](../artifacts/native-web-ui-20261029/four-port-source-completion.json)
records verification-email/security entry, manual reset/confirmation/fresh-link
and post-reset sign-in continuation, Insights' browser civil-date control and
capability-gated Care Message reports. Its 49 focused checks and direct TypeScript
check pass; [independent auth review](../artifacts/native-web-ui-20261029/auth-port-independent-source-review.json)
closes the post-reset continuation finding. Gate
[management](../artifacts/native-web-ui-20261029/gate-management-source-review.json)
and its [root review](../artifacts/native-web-ui-20261029/gate-management-root-review.json)
cover pass issuance, volatile QR/expiry and explicit export; the
[operator port](../artifacts/native-web-ui-20261029/gate-operator-source-review/review.json)
covers language, section continuations, office call and authorized identity
references. These are source/focused-test results, not actual issuance, camera,
mailbox, provider or Live/Simulation writer acceptance. The
[original operator review](../artifacts/native-web-ui-20261029/gate-operator-independent-review.json)
identified private-photo cleanup and retained-preview P2s. The separate
[corrected camera delta review](../artifacts/native-web-ui-20261029/gate-operator-camera-delta-independent-review.json)
closes those exact findings against six corrected source/test hashes and 109
independently rerun tests, including 11 camera lifecycle checks. Actual
browser/simulator/emulator camera interoperability remains unverified.

<a id="in-out-ui"></a>

### In & Out layout and draft protection

The shared Visits list has a compact Arrange action, integrated search/clear and
one period control; the operator uses localized compact search and counted status
choices. Repeated headings and oversized routine actions are removed. The
[owner UI review](../artifacts/native-web-ui-20261029/in-out-ui-root-source-review.json),
[independent review](../artifacts/native-web-ui-20261029/in-out-ui-independent-source-review/review.json)
and [count-label follow-up](../artifacts/native-web-ui-20261029/in-out-ui-independent-source-review/count-label-review.json)
bind these source changes. The
[form layout receipt](../artifacts/native-web-ui-20261029/in-out-form-layout/review.json)
records compact actions, labelled selections and picker bodies that retain the
parent draft and open at Search.

The [local Back contract](../artifacts/native-web-ui-20261029/back-local-draft-source-review.json)
allows `preservesDraft` only with a reviewed local callback. It keeps busy/source
checks and SDK prevention armed; actual route removal and active-tab reset still
guard the hidden parent. The
[caller correction](../artifacts/native-web-ui-20261029/in-out-draft-guard/review.json)
keeps visit/sharing/visitor dirty guards active during choices or camera use.
Nested person/import Back asks before discarding only that child, checking its
source and exact opening epoch. The ordinary editor labels its actual return as
Visits for a new arrangement and Visit details for an existing one; the
[exact destination review](../artifacts/native-web-ui-20261029/in-out-editor-back-destination-independent-review/review.json)
and bounded rendered new/edit checks cover that label correction. The
[note handoff](../artifacts/native-web-ui-20261029/in-out-note-handoff/review.json)
requires Keep writing or explicit discard before opening sharing settings or an
invitation; changed text, competing attempts and lost world/mode/unmount leases
cannot clear the note. Existing Take over questions/Stop sharing dialogs also
[disclose note loss when relevant](../artifacts/native-web-ui-20261029/in-out-sharing-confirmation-copy-delta.json),
with a separate [independent copy review](../artifacts/native-web-ui-20261029/in-out-sharing-confirmation-copy-independent-review/review.json).
Empty notes add no handoff prompt or extra consequential-action dialog.

Bounded real candidate checks show the
[hidden-draft active-tab reset prompt](../artifacts/native-web-ui-20261029/in-out-hidden-draft-reset-guard.png)
and [compact iPhone Visits view](../artifacts/native-web-ui-20261029/in-out-visits-iphone-compact.png).
These are selected layout/navigation checks, not acceptance of every Gate writer,
QR, camera, person import or invitation. The earlier
[verification receipt](../artifacts/native-web-ui-20261029/in-out-live-final-verification.json)
binds 1630 passing tests, whole-mobile TypeScript and successful web/iOS/Android
exports to unchanged reviewed sources and exact exported bundle hashes. These
exports verify compilation, not new store-signed binaries. The
[rendered tour](../artifacts/native-web-ui-20261029/in-out-rendered-verification.json)
also covers current visit details/editor/sharing, operator, approvals, records,
management and visitor-entry navigation. Two unintended native text children in
records/recovery were removed; the [regression proof](../artifacts/native-web-ui-20261029/gate-raw-text-render-fix/review.json)
and clean public renderer recheck cover that correction. The earlier
[source reconciliation](../artifacts/native-web-ui-20261029/gate-raw-text-source-reconciliation-supplement.json)
watched1426 sources with zero drift, ten passing inventory tests and the same29
retirement blockers. Earlier export/checkpoint hashes are historical. Android's final UI gestures remain
unverified after the earlier `noWindowsAvailable` blocker. No group acceptance or
retirement status is promoted by this bounded work.

The current visit card and group visitor-link source are bounded by the
[manager source/mounted checks (101)](../artifacts/native-web-ui-20261029/visit-onboarding-manager-source-review/review.json),
[manager independent review](../artifacts/native-web-ui-20261029/visit-detail-reference/manager-independent-review.json),
[public registration checks (64)](../artifacts/native-web-ui-20261029/visit-join-source-review.json)
and [independent continuation corrections](../artifacts/native-web-ui-20261029/visit-join-independent-review/corrected-review.json).
Invite visitors opens one group-link owner with explicit issue/reveal/replace/revoke
and user-chosen Share/Email/Copy; planned party size, self-registration and observed
Gate movement remain distinct. The own-participant route is minimized, with no
private organiser fallback or entry authority. Normal Login/MFA follows neutral
account creation; locator credentials stay out of journals and public continuation
is memory-only. The [integration review](../artifacts/native-web-ui-20261029/visit-detail-reference/integration-independent-review.json)
covers the exact source-read/privacy, public401 and host slices.

The [full mobile run](../artifacts/native-web-ui-20261029/visit-detail-reference/full-mobile-tests.log)
passes 1685 tests **before** the final narrow Gate recovery delta. The current
[21 focused tests](../artifacts/native-web-ui-20261029/visit-detail-reference/routing-mounted-tests.log)
cover source-unavailable editor retention with writes paused and definitive access
loss hiding private UI. Whole-mobile TypeScript and the
[universal export log](../artifacts/native-web-ui-20261029/visit-detail-reference/universal-export.log)
record web/iOS/Android compilation to `visit-detail-universal-export` at that
boundary. This is not one frozen 1685-test result after the last delta, a new
installed binary, or complete UI acceptance. Root's bounded iPhone simulator check
rendered the new card and Invite visitors CTA on an expired historical visit;
no link was issued, shared or delivered. The
[exact public host check](../artifacts/native-web-ui-20261029/visit-detail-reference/public-join-host.json)
proves document admission/rejection, not mailbox or registration completion.
[Activation 205](../artifacts/native-web-ui-20261029/visit-onboarding205-activation-verification.json)
now makes the reviewed backend available; email still needs configuration and no
external message was sent. Native associated-link launch, mailbox, OS share,
expiry/access-loss and interruption/relaunch tours remain unverified.

The [visitor parity reconciliation](../artifacts/native-web-ui-20261029/visitor-active-parity-reconciliation/review.json)
preserves all 129 frozen legacy routes, 29 group statuses and all acceptance arrays,
adding only two implemented-unverified native capabilities for80 entries and 1440
watched sources at its checkpoint. Ten inventory tests passed; retirement stayed
blocked by 29 groups. The later
[icon/dock reconciliation](../artifacts/native-web-ui-20261029/icon-polish/active-parity-reconciliation.json)
reviews 1443 fingerprints, preserves 129 routes/29 groups/80 capabilities and all
acceptance arrays, and passes ten inventory tests with zero source drift. The
retirement command still exits 1 for 29 blockers; this is source currency only.

The [feature icon source receipt](../artifacts/native-web-ui-20261029/icon-feature-source-review.json)
and [independent core review](../artifacts/native-web-ui-20261029/icon-polish/independent-review.json)
record semantic glyph/caller changes, existing theme colors, preserved target/label
relationships and the corrected unknown/prototype-name fallback. The
[dock owner receipt](../artifacts/native-web-ui-20261029/assistant-dock-glass-source-review.json)
and [independent dock review](../artifacts/native-web-ui-20261029/assistant-dock-glass-independent-review.json)
cover 33 focused geometry/selection/shell checks and TypeScript, four retained main
destinations plus a separate right-hand Assistant bubble using original artwork.
One measured native clear-glass selection uses public Expo/Reanimated APIs; it
snaps for Reduce Motion and has an opaque transparency/API fallback. These are
source/mounted results, not exact UIKit matched morph or native physics evidence.
The bounded [iPhone rendered review](../artifacts/native-web-ui-20261029/icon-polish/ios-rendered-review.json)
adds current Attendance/Assessments icon screenshots, a simulator video with
decoded selection-motion frames, retained-tab/reselect checks and Assistant
open/expand/collapse/close over the visible operating app. Its original bubble
mark is36pt. This portrait iPhone check is not all-layout/accessibility or workflow
acceptance; Android/browser visual and interaction review remains deferred together
before release.

The [native-only transition review](../artifacts/native-web-ui-20261029/native-only-transition-independent-review.json)
and [shared-wire extraction](../artifacts/native-web-ui-20261029/shared-wire-extraction-source-review.json)
remove active old-frontend runtime/type/build coupling. The extraction moves 195
type references into 48 neutral modules containing 356 required declarations:
354 retain exact declaration text, one gains export visibility and one uses a
private exact readonly tuple with no runtime export. All 157 import-only rewrites
preserved emitted JavaScript at extraction time; the later Gate-owner functional
change is explicitly separate. The current mobile compiler resolves zero old
frontend source files; whole mobile TypeScript and 33 focused shared-contract checks
pass. The [independent extraction review](../artifacts/native-web-ui-20261029/wire-extraction-independent-review.json)
found no actionable extraction P1/P2. Metro/build inputs and test dependencies are
native/shared-owned; the old CSS theme generator is removed, all four palettes and
radii [match exactly](../artifacts/native-web-ui-20261029/native-only-theme-value-proof.json),
and active [brand reference assets](../artifacts/native-web-ui-20261029/native-only-brand-source-proof.json)
are native-owned unchanged originals. The migration audit may still read frozen
registrations as evidence; retained old source is not an active frontend or an app
build dependency. None of this deletes rollback source or establishes functional
retirement: **all 29 groups remain implemented-unverified and the retirement gate
is blocked**. Physical-device checks are explicitly waived as a retirement
prerequisite, not reported as passed; browser/simulator/emulator, data/history,
Simulation/recovery and owner review remain required.

<a id="campus-rendering"></a>

### Campus rendering

The React Native campus renderer uses Skia2.15.2, Reanimated4.7.1,
Worklets0.13.0 and Gesture Handler3.3.0 with Expo58/RN0.88. The
[owning rendering contract](blueprint/CAMPUS_VISUAL_SCENES.md#universal-rendering)
records the primary research, Android surface/clipping choice, DT identity and
clock boundaries. Eight superseded native SVG files and their obsolete target
wrapper tests were removed after caller migration. The browser loads a matching
local CanvasKit WASM and font with their licences; it retains loading/error/retry.

The [actual Skia recording receipt](../artifacts/campus-skia-assets-20261029/render-receipt.json)
covers day/night scenery and interiors. Retained and whole-scene pixels match;
the first lamp fault compiles one element and records one resource picture,
preserving all static pictures. Repeat toggles compile/record nothing. These are
CanvasKit CPU/cache measurements, **not mobile frame-rate measurements**.
Camera oracle tests compare12,240 clamp/zoom results to shared geometry; people
checks retain source precedence, route/floor/closure/occlusion budgets, world
separation, distinct observation rings and confirmed Simulation time.

Physical iPhone follow-through found an expanded details sheet leaving too little
floor-map space and a retained fullscreen Modal covering a destination route.
The [floor/focus review](../artifacts/iphone-login-testflight-20261031/campus-floor-layout-source-review.json)
passes55 layout/camera/navigation checks and mobile TypeScript, including mounted
focus/Back and interior-selection regressions. Indoor details now rest compactly;
room/resource focus uses floor-local padding without moving authored geometry or
changing DT identities. The first rebuilt phone confirms a larger floor and
readable local focus. Its custom sheet exposed a separate dock-clearance issue:
the [panel-inset review](../artifacts/iphone-bottom-cropping-20261031/campus-panel-insets.json)
passes31 overlapping panel/camera checks and TypeScript. It reserves measured dock
space outside the bounded ScrollView instead of counting it as usable sheet
height. The final installed replacement shows the building's Ground floor action
and the floor's Building overview/Map controls above the dock. Fullscreen report
handoff and broader physical interaction/performance remain pending; these
overlapping suites are not an aggregate acceptance count.

The [final source validation](../artifacts/native-campus-skia-20261029/final-validation.json)
passes63 focused rendering/DT/camera checks,7 shared label checks,1432/1432
mobile tests and whole-mobile TypeScript. Web/iOS/Android Expo exports also pass.
Renderer sources stayed stable; the receipt records concurrent Auth changes during
the Android export, so these exports are not one frozen whole-application release.
The [Facilities handoff review](../artifacts/native-campus-skia-20261029/facilities-report-context-review.json)
covers exact resource/place-prefilled reports, invalid-link guidance, context
reset and23 passing checks. The reviewed native fingerprints were accepted
without changing any wider parity or platform-retirement gate.

[iOS](../artifacts/native-campus-skia-20261029/ios-build.log) and
[Android](../artifacts/native-campus-skia-20261029/android-build.log) Debug builds
succeeded with the existing campus-navigation module retained. The updated iPad
client opened the actual campus and exact resource-condition panel; see the
[native rendering capture](../artifacts/native-campus-skia-20261029/ipad-live-resource.png).
This establishes an installed native rendering path. Physical-device, low-end
hardware, sustained frame pacing, thermal and battery behavior remain untested
limitations; unavailable hardware checks do not block old-web retirement. Required
browser/simulator/emulator functionality and migration review remain open. The native preview is
served by the shared Metro on `http://localhost:8084`; `127.0.0.1` is not its bind.

Actual browser checks cover phone-sized search text, selection, building/floor
navigation, detailed room rendering and zoom. Two existing Simulation follow-up
journal namespaces were missing from the browser allowlist; the
[storage correction receipt](../artifacts/native-campus-skia-20261029/simulation-browser-storage-review.json)
covers exact hashed namespaces, encrypted recovery and cross-scope/credential
denial. No credential storage or generic namespace was added. A cold scenario
capture exceeded the original30-second transport budget; exact-original recovery
opened its own amber draft. This is recorded as recovery evidence, not a uniformly
fast capture claim. The concurrent native migration owner handles that bounded
transport correction; no backend seal or normal activation was changed by the
renderer work.

The [actual UI/DT receipt](../artifacts/native-campus-skia-20261029/ui-dt-verification.json)
records an ordinary exact-resource report in an owned isolated draft. The same
lamp changed from checked repair/no open reports to reported-not-working/one
open report on the amber map; its exact Live asset remained byte-for-byte equal
to the captured source. The session returned to Live and its temporary phone
viewport was reset. See the [amber result](../artifacts/native-campus-skia-20261029/simulation-lamp-fault.png)
and [unchanged Live result](../artifacts/native-campus-skia-20261029/live-lamp-unchanged.png).
The first post-report operations read hit a Simulation pool acquisition timeout;
one normal navigation retry succeeded. The backend owner is addressing the
unbounded temporal-lookup fan-out. This is a recorded recovery with an open
backend performance issue, not uniformly fast first-load acceptance. The exact
owned draft was handed to that owner for guarded cleanup; protected worlds were
not changed. Day/night rendering and unavailable-lamp cache tests cover the
visual condition; this actual isolated mutation was inspected in daytime.

The earlier navigation [full mobile source check](../artifacts/native-web-ui-20261029/migration-final-mobile-tests.log)
passes **1312/1312** tests; whole-mobile TypeScript and the web/iOS/Android exports
also pass. The [active-tab browser check](../artifacts/native-web-ui-20261029/migration-tab-reselect-browser-acceptance.json)
verifies different-tab retention, active Areas reset, cancellation, a retained
local policy draft across tab switches and explicit discard of that test draft.
The [rebuilt iPad check](../artifacts/native-web-ui-20261029/migration-tab-reselect-ipad-acceptance.json)
verifies native reselect, the clean destination-labelled header, portrait bottom
tabs and landscape sidebar. No owning domain command was submitted. The earlier
[browser receipt](../artifacts/native-web-ui-20261029/back-browser-acceptance.json)
covers one titled header Back, hierarchy without parent loops, retained filters,
Work origin, real Back/Forward, dirty-exit cancellation/approved leave and retained
tab drafts. The [native receipt](../artifacts/native-web-ui-20261029/back-native-acceptance.json)
covers actual iPhone/iPad simulator hierarchy and Account-origin returns, retained
iPad Scheduled filter and portrait bottom tabs. No Save/Submit/Send action was used;
the protected Attendance draft was not opened or changed. Device Hub edge-drag
attempts did not navigate, so native swipe acceptance remains open alongside
authenticated Android runtime, native dirty-exit dialogs, keyboard/VoiceOver/large text, scroll
position and rendered Simulation checks. These are bounded navigation checks,
not all-screen or all-form acceptance. The owning
[Back contract](blueprint/THATCAMPUS_OPERATING_EXPERIENCE.md#44-predictable-back-and-dismissal)
follows [Apple navigation](https://developer.apple.com/documentation/uikit/uinavigationcontroller),
[Android navigation principles](https://developer.android.com/guide/navigation/principles)
and the installed [Expo removal boundary](https://docs.expo.dev/router/advanced/prevent-screen-removal/).

The final bounded public-entry correction adds an anonymous-safe volatile lease
over the original invitation/form/session, focus and foreground. It prevents proof
or acceptance POSTs after a departed CSRF preparation and suppresses stale success
callbacks; an interrupted dispatched acceptance retains its existing unknown-result
recovery. The [18 focused checks](../artifacts/native-web-ui-20261029/final-public-entry-review-tests.log)
and [clean whole-mobile TypeScript check](../artifacts/native-web-ui-20261029/final-public-entry-review-typecheck.log)
are source proof only. Exact direct-read/hash boundaries are in the
[review receipt](../artifacts/native-web-ui-20261029/operations-calendar-reviewed-sources.json).
These checks performed no real sign-in, invitation or campus mutation and close
none of the 29 capability groups' runtime or retirement gates.

The earlier Assistant [test/build/export validation](../artifacts/native-web-ui-20261029/assistant-overlay-build-export-validation.json)
records1544 TypeScript tests plus9 theme checks, whole-mobile TypeScript and all
three platform exports. The [installed native binary receipt](../artifacts/native-web-ui-20261029/assistant-overlay-native-binary-verification.json)
records successful iOS and ARM64 Android Debug builds with Clipboard, matching
compiled/installed binaries and deep iOS signature validation. The
[ABI check](../artifacts/native-web-ui-20261029/assistant-overlay-ios-abi.json)
checks17 ARM64 binaries and1323 strong inter-Expo imports with zero missing symbols.
Print retains the supported selective build-from-source correction; Razorpay3 and
SQLCipher remain installed. These clients require Metro and are not standalone
store releases.

The [shared split review](../artifacts/native-web-ui-20261029/assistant-ipad-split-source-review.json)
and [body/pane review](../artifacts/native-web-ui-20261029/assistant-body-source-review/tablet-pane-body-review.json)
cover one retained Assistant over or beside the actual mounted workspace,
source-return identity, scoped operation leases and exact dirty/busy exit guards.
iPad expansion keeps both panes usable; app Back/source links follow ordinary app
chronology while the chat stays open. Mode change and rotation retain the editor
and current operation lease; actual app navigation invalidates prepared effects.
Phones retain full-screen expansion. Shared JS Glass navigation replaces the previous native-tab shim and generated
Assistant tab images while retaining domain native stacks. Workspace reselect
uses the existing shared removed-editor guards. Pro changes no longer remount the
tab tree and guard only affected Assistant state. Hidden retained Assistant motion
pauses through its own activity context. The
[bounded parity reconciliation](../artifacts/native-web-ui-20261029/assistant-ipad-split-parity-reconciliation.json)
records1354 watched source/style/build inputs with zero drift; all 29 groups and78
capabilities remain implemented-unverified. Existing acceptance references remain;
the bounded rendered receipt adds web/iOS/visual evidence without changing statuses.

The owner cleared the protected Attendance draft before the earlier update. Latest
installs preserve app data; no Attendance draft was opened or changed in this
Assistant integration. Browser checks verify the actual retained workspace backdrop,
full335-character latest-answer copy, lossless draft collapse/close/reopen, a
full-screen conversation without workspace chrome, and source navigation with
Back to the same retained Assistant. Bounded native layout/keyboard/clipboard
checks have their own [rendered receipt](../artifacts/native-web-ui-20261029/assistant-overlay-rendered-acceptance.json);
they do not prove whole-domain parity. Landscape iPad split checks cover usable app
tabs/filters, ordinary app Back, source and repeated same-source navigation, and
native Copy feedback while the retained conversation remains visible.
The current iPad [portrait split](../artifacts/native-web-ui-20261029/assistant-ipad-split-portrait-final.png)
and [software-keyboard check](../artifacts/native-web-ui-20261029/assistant-ipad-split-portrait-keyboard.png)
show the actual Today/app pane with navigation beneath it and the chat composer
above the keyboard. A temporary unsent question survives app navigation to All
work, the Waiting filter, collapse/re-expansion and landscape rotation. The native
Pro-off flow also checks the Assistant draft guard: Keep editing preserves the
question, enabled preference and split; explicitly discarding only the test
question turns Pro off and removes chat and its navigation action. Restoring Pro
restores the action and original conversation with an empty composer and disabled
Send. No unrelated draft was discarded.

Current iPhone [compact](../artifacts/native-web-ui-20261029/assistant-iphone-shared-host-compact.png)
and [software-keyboard](../artifacts/native-web-ui-20261029/assistant-iphone-shared-host-keyboard.png)
checks cover the actual Today backdrop, dark Glass composer, full-screen expansion
without workspace chrome, and an unsent question retained through collapse. Only
the test question was cleared, leaving Send disabled. These checks used no extra
provider question or domain write; the iPad account Pro preference was restored.
Final Android regression after the shared-host change remains pending. Narrow
iPad multitasking, floating/physical keyboards, VoiceOver/Dynamic Type, negative
Simulation isolation and broader action/interruption/relaunch recovery remain open.

Android is authenticated after the cold GLES workaround. Its bounded
[authenticated receipt](../artifacts/native-web-ui-20261029/migration204-android-native-acceptance.json)
covers Today,18 Areas, Attendance choices and49 registers. The earlier emulator
crash and sign-in input failures remain historical diagnostics. Earlier checks
before the latest split/shared-host change render the singleton bubble over Today,
expand without bottom navigation, and position its composer above the actual
keyboard; native Copy was checked by pasting the answer into a temporary unsent
test question and then explicitly
discarding only that draft. No extra provider question or domain write was sent.
Final shared-host Android emulator regression and complete Android domain
interaction remain open. Physical hardware remains an untested limit, not a
retirement prerequisite. The emulator is already docked in Android Studio;
CUA returns `noWindowsAvailable` despite a fresh binding, Raise and session reset,
so final gesture acceptance is blocked by UI control, not a pending docking step.

The current [native guide](../mobile/README.md) owns build/run commands and the
[parity map](../mobile/PARITY.md) owns per-screen implemented and missing behavior.
Web data updates can appear through shared APIs; web layout changes do not
automatically alter the native bundle. OTA/store release is not established by a
Hermes export, development signature or downloaded APK.

Latest recorded iPhone/iPad simulator evidence covers compact workspace/navigation,
Light/Dark, exact Attendance reads and scoped private Live/Simulation submissions,
campus hierarchy/interiors and bounded Insights reads. Original Assistant artwork
and paired palettes have separate render/export receipts. Release203 repaired the
assigned-Insights eligibility mismatch; [bounded browser checks](../artifacts/native-web-ui-20261029/migration204-web-insights-acceptance.json)
cover permitted personal/institution reads. Other roles, populated trend graphics,
negative isolation and full device acceptance remain open.

Browser/simulator/emulator permissions, files/share, accessible focus/text and
broader domain interaction remain acceptance work. Physical camera/device
permissions, physical keyboards and hardware-only behavior remain untested
limitations rather than old-web retirement prerequisites. Fresh
amber/family Insights and native planned-people motion are not accepted by the
latest relevant checkpoint. Preserve domain-specific exact-command journals;
no general offline mutation queue or universal cross-launch retry is implied.

### Current universal UI work

The29October native/shared presentation pass uses saved loaded web references at
402×874 in [`artifacts/native-web-ui-20261029/`](../artifacts/native-web-ui-20261029/).
Opening-workspace/session-checking captures are rejected evidence. Source checks
are separate from fresh device screenshots and complete active-flow acceptance.

Calendar source checks: `cd mobile && node node_modules/tsx/dist/cli.mjs --test
test/native-calendar.test.ts test/schedule-access.test.ts` passed28 source/date/
access cases. They cover civil dates/DST, cancellations, independent contributions,
exact learner scope, incomplete/denied sources, bounded cursors and focus-gated
source sheets. Direct mobile TypeScript passed at that source checkpoint; no
Calendar UI, browser, Android or amber acceptance was claimed. The chosen approach
ports the current important-date source model, keeps Timetable separate, and uses
native date selection plus a real browser date input; the installed community
picker's web implementation renders no control. Current gaps remain in the
[parity map](../mobile/PARITY.md). Research: [Apple pickers](https://developer.apple.com/design/human-interface-guidelines/pickers),
[UIDatePicker](https://developer.apple.com/documentation/uikit/uidatepicker).

The current universal UI pass has a passing direct mobile TypeScript check.
Focused source selections passed People/Simulation (43), common workflow/recovery/
Resources/Facilities (30), and Communications/Learning/Event policy (49); these
selections overlap and must not be added as a suite total. They do not establish
screen-by-screen visual, keyboard, Android, or Live/Simulation mutation acceptance.
The old web source is frozen for reference/rollback; new features and fixes stay
in the universal frontend. The bounded active-port source audit and its identified
ports are now complete as indexed above; functional cutover review remains open.

Current More owner source port: `MorePoliciesScreen`, `TeachingFeedbackScreen` and
`OrganizationVerificationScreen` implement the reachable published-policy,
teaching-check-in and existing-campus verification flows. They use the exact
actor/campus/world manifest contribution; no title-based portal or legacy screen
was copied. Policies retain the publication ID/revision for informational attention
and validate the explicit acknowledgement's actor/campus/version receipt.
Teaching feedback retains coordination/respond capabilities, current owner
eligibility, exact parameter sets, protected release thresholds, comparable closed
rounds and explicit demo labels. Its labelled charts, sort/count disclosures and
support suggestions do not expose individual responses. Entry fades and native
sheets respect the shared Reduce Motion preference. Verification checks the exact
workspace and resubmission revision, and remains an explicit Live-only function
before any onboarding read/write in Simulation. The current registration-reference
flow has no file-upload contract; none was invented.

More source verification: direct mobile TypeScript passed. `cd mobile && node
node_modules/tsx/dist/cli.mjs --test test/policy-attention.test.ts
test/more-action.test.ts test/teaching-feedback.test.ts
test/organization-verification.test.ts` passed15 guard/privacy/recovery cases.
Private write intent is persisted through the shared chunked native/encrypted
browser storage before dispatch, partitions account/campus/world/server and
retains accepted-but-unrefreshed outcomes. The current feedback-create and new
verification-claim APIs provide no idempotency key or correlated replay receipt;
an unknown creation remains inspect-only and is never matched by similar names
or automatically sent again. Exact-ID accepted creation, existing-review revision
recovery, idempotent feedback closure and one-response-per-account recovery retain
their owning contracts. This is a specific owner API limit, not a complete
cross-launch retry claim. Policies' owning endpoint already deduplicates by
version/account, so its unchanged acknowledgement can be checked or retried.

These are source/test results only. Root routing integration, authenticated
browser/iPhone/iPad/Android actions, actual Live/Simulation isolation, unknown-reply
UI and visual/keyboard/screen-reader acceptance remain separate gates. No runtime,
session, campus data, world, backend or web retirement operation was performed by
this source port.

Universal journal storage has 19 focused passing tests: seven encrypted browser
journal cases, seven browser Attendance draft cases and the five existing draft
policy cases. They use fake-indexeddb and actual Node WebCrypto, covering exact
reload, scope isolation, ciphertext substitution/corruption, missing keys, denied
storage, concurrent initial keys, post-request transaction abort, retained chunk
manifests, ordered writes/deletion and unchanged Attendance command bodies.
Native storage imports now delegate through the SecureStore pass-through; native
SQLCipher remains enabled. No browser UI, existing account/draft, backend data or
normal-world operation was used by these tests. Run from `mobile/`:
`node node_modules/tsx/dist/cli.mjs --test test/device-storage-browser.test.ts test/attendance-draft-browser.test.ts test/attendance-draft.test.ts`.
Browser device-lock semantics, private-mode/quota/eviction and full cookie-auth
reload acceptance remain unverified. The [parity map](../mobile/PARITY.md#universal-device-storage)
records this storage boundary and the active workflow gaps.

Browser private-file and temporal adapters pass 15 focused cases: seven real
File/Blob selection, scoped encrypted staging, corruption/denial, signature/size,
camera-byte normalization, named multipart and MIME-preserving preview cases;
four bounded cookie-transport download/context/omitted-source/cleanup cases; and
four civil-date/local-time/min-max/DST cases. Native upload and leave-journal
regressions passed in the same targeted selection (31 total, overlapping the full
suite). Native filesystem staging and Expo multipart behavior remain unchanged.
These tests use local File/Blob APIs, fake-indexeddb and Node WebCrypto; they do
not open a file dialog, camera, browser UI or contact a domain endpoint.

At this source checkpoint, `cd mobile && node node_modules/tsx/dist/cli.mjs --test
test/*.test.ts` passed **477/477**, and direct mobile `tsc --noEmit` passed. Exact
logs are in [the UI artifact directory](../artifacts/native-web-ui-20261029/):
`universal-files-source-tests.log`, `browser-file-temporal-tests.log` and
`universal-files-typecheck.log`. Actual browser permissions, download presentation,
quota/eviction and interrupted upload/reload recovery remain runtime checks.
Physical-device permissions remain an untested hardware limit, not an old-web
retirement prerequisite. See the
[platform file/input boundary](../mobile/PARITY.md#universal-private-files-and-temporal-inputs).

The Account/Connected apps source port passes **22 focused cases** across
`test/account-capabilities.test.ts`, `test/account-command.test.ts` and
`test/account-calendar.test.ts`. They cover real nested actor/server cache keys,
memory with Pro off and Simulation withholding, exact relationship selection,
malformed wire values, unchanged memory source fingerprints, one-time provider/feed
URL restrictions, stale/consumed/expired link suppression, civil-date exports,
isolated previews, lost responses without replay and acknowledged read-only recovery.
At this checkpoint the complete direct Node selection passed **514/514**, and direct
mobile TypeScript passed. Logs are in
[the existing UI artifact directory](../artifacts/native-web-ui-20261029/):
`account-source-tests.log`, `account-capabilities-tests.log` and
`account-capabilities-typecheck.log`. Source checks performed no UI/session/domain
operations. Calendar/channel providers, copy/share, installed simulator/emulator
apps, screen-by-screen Light/Dark/amber layout and actual Live/Simulation checks
remain open. Physical-device permissions remain an untested hardware limit,
excluded from old-web retirement prerequisites. The old web is frozen for
reference/rollback. Current API receipt/race and
secret-handling limits are in the
[Account boundary](../mobile/PARITY.md#account-preferences-and-connections).

The canonical Reports source port has **23 passing focused tests** in
`mobile/test/academic-report-policy.test.ts`, `academic-report-command.test.ts`,
`published-marksheet.test.ts` and `report-attention.test.ts`. They check exact
manifest learner scope and publication identity; grading band and source mappings;
revision/source-chain matching; encrypted preparation before dispatch; original
key/body/revision replay across relaunch; accepted read-only refresh recovery;
scope changes and uncertain refusals; escaped, source-backed marksheets with
historical classes and honest withheld/absent/incomplete outcomes; and exact
foreground-opening proofs. These are local source tests and performed no
session, browser, domain or ordinary account/draft mutations.

`ReportsScreen.tsx` ports current progress and remarks routes through the owning
APIs. Runtime browser/iPhone/iPad/Android, Dark/amber, keyboard/accessibility,
independent-review authorization, actual Live/Simulation writes and interrupted
print/recovery tours remain **pending**. Expo Print
is present in the rebuilt iPhone/iPad client and Android Debug APK; actual print
and share controls still require device acceptance.
The current API lacks a typed absent-receipt proof for a retained grading409 or
refusal after uncertainty; this remains blocked rather than presenting matching
current state as an accepted command. Private marksheets are not recorded in
workspace artifacts. Native PDF sharing cleans its app-private cache file in
`finally`; crash-orphan cleanup and OS print-dialog behavior still require device
verification. See the current [Reports boundary](../mobile/PARITY.md) for scope,
source ownership and the retirement gate.

The Restricted Care universal source port has **31 passing focused tests** in
`mobile/test/care-native.test.ts` and `mobile/test/care-command.test.ts`. They cover
the actual separate case/access wire shape, exact campus/case routing, malformed
values, intake-only privacy, Simulation body omission and no device-clock fallback,
current student/owner eligibility, reporting/closure/revision rules and exact
visible-case attention. Command tests check strict opaque-only durable metadata,
original intake identity and unchanged-key/body retries, reload without callable
private bytes, typed refusal versus later generic access denial, pending/failed
confirmation withdrawing retry, corrupt/denied storage, accepted refresh/clear
failure and handover recovery without the former owner's case access.

Logs are in [the existing UI artifact directory](../artifacts/native-web-ui-20261029/):
`care-focused-tests.log` and `final-mobile-tests.log`. The latest full direct source
selection passed **744/744**, and the final TypeScript check passed after the shared
navigation work settled. The earlier `care-typecheck-navigation-pending.log` is
superseded by `final-typecheck.log`.
These are local source checks with no UI, session, ordinary account/draft or domain
operations, and no protected narrative was captured in artifacts.

`CareScreen.tsx` is the new source entry for current assigned-case, intake, handling,
team and metadata-only owner-recovery modes. The MessageReports owner remains
separate. Browser/iPhone/iPad/Android rendering, keyboard/accessibility, emergency
dialer, current access changes, actual Live and isolated Simulation mutations,
relaunch/storage loss and institution legal/operating review remain **pending**.
The existing web remains retained. Protected drafts/callable retries are session
memory only; full restart offers exact receipt checks rather than offline narrative
recovery. Team assignment APIs lack command receipts and permit only current-state
inspection after uncertainty. See the [Care privacy and recovery boundary](../mobile/PARITY.md#restricted-care-privacy-and-recovery).

<a id="aaranya"></a>

## Aaranya development tour

Use the current owner-provided preview, choose **Aaranya Institute of Technology**,
and use the private `.runtime/iiita-campus/Aaranya-campus-logins.txt` owner sheet.
Do not copy passwords or session material into documentation/artifacts. Use
separate browser profiles or sign out when changing accounts. Old Quick Tunnel
addresses and old IIITA-branded login guides are not current entry instructions.

Aaranya is fictional. Its natural names, campus plans, timetables, grades, finances,
visits and operations do not assert an actual institute's staffing, authority,
attendance, payments or endorsement. Public-source geography/curriculum has explicit
provenance and uncertainty. Earlier publications and captured worlds may preserve
old labels; never rewrite history merely to improve a demo.

| Person | Useful first journey |
| --- | --- |
| Devika Raman, director | More → Campus setup for structure and actual authority; Areas → Calendar for public-date publication/correction; Virtual campus for reviewed editing/publication. |
| Aditi Vyas, student | Work for exact assignments/room offers; own Fees, Reports and Departure; Calendar defaults to applicable My calendar. No management grant follows from the demo account. |
| Aditi Menon, faculty | Timetable, teaching preparation, assessment/review work and Staff work → My leave. |
| Sanjay Nair, Facilities | Repairs and exact existing borrowing responsibility; progress and campus verification are separate. |
| Ram Pratap Singh, guard | In & Out and Main gate Timetable duty; public Calendar dates do not grant academic access. |
| Meera Kulkarni, warden | Accommodation, exact room offer and current coordinator/recorder scope. Acceptance does not record a move or issue a key. |
| Nandita Joseph, Dining | Published date/service, menu, responsible preparation issue and truthful unknown served counts. |
| Farah Siddiqui, librarian | Resources & borrowing; individual copies and a new controlled loan, not somebody else's private custody action. |
| Suresh Iyer, finance clerk | Prepared fee ledger and authorized correction paths; software access does not supply an institutional mandate. |

For a complete constructed teaching week, inspect **2–8 November 2026**. Semester I
is active; later semesters/plans are not future enrollment or publication. The
**9–11 November** break suppresses teaching. Expected activity is a plan, not tracked
occupancy; recorded scan signals remain distinct. Campus capacities/interiors and
illustrated people are test arrangements, not surveyed/safeguarding conclusions.

<a id="calendar"></a>

The full-year Calendar has 56 published information dates for July 2026–June 2027;
19 link to actual Aaranya Semester I/II records. Four optional Events, two scheduled
nonphysical Assessments, six Dining weeks and three dated Dining changes provide
connected source-owned examples. They add no presence, marks, payment, meal count
or movement observation. Try:

- November List paging versus month navigation; Month → 9 November for the break
  and cancelled lunch, and 14 November for the later Aravali dinner.
- Search November for `research`; the 6 November clinic's accepted time is 17:00–19:00.
- January: an ongoing break through 3 January and 4 January Semester II information;
  March: cross-month programme dates and wrapping long titles.
- Student, faculty, Facilities and director visibility; only actual publication
  authority should expose Add/Correct/Cancel. Routine sessions stay in Timetable,
  menus in Dining and addressed actions in Work. Calendar is not a duplicate inbox.

The leave pilot uses explicitly fictional, self-attested review authority through
31 December 2026, not a generic founder exception. An approved 27 October absence has
accepted cover. Do not reapply over that absence; choose another date with published
work in a fresh owned Simulation. Staff working calendars/half-day boundaries and
genuine first-campus authority adoption remain incomplete.

For researched curriculum/geography, inspect the exact catalogs and independent
reviews in [IIITA source artifacts](../artifacts/iiita-campus-20261025/). Seven IT
and two ECE tracks use 2026 documents; QIT has 2026 programme evidence; BI/BAE linked
curricula are 2023–24; DSA is a historical 2022 reference, not a verified 2026 intake.
QIT row hours differ from its printed total; elective banks are choices. BH4,
GH1–GH3 placement, BH5 association and hostel-annex boundaries need confirmation.
Preserve [OpenStreetMap contributor/ODbL attribution](https://www.openstreetmap.org/copyright).

<a id="dining"></a>
<a id="visits"></a>

## Research basis

The archived research is dated published-source review, not field observation,
legal approval, provider certification or evidence that one workflow is universal.
Current owning contracts retain the applicable decisions:

- [Dining](blueprint/CAMPUS_DINING_AND_SERVICE.md) and
  [external coexistence](blueprint/EXTERNAL_SYSTEM_COEXISTENCE.md): distinguish
  institution oversight, operator/service, menu/time, estimated demand, actual
  service and finance. Walk-in, residence, school meals and external-provider
  ownership need different optional controls. Validate the real service shift,
  shortage/correction path, phone-free operation, privacy and provider API/export
  contract before widening automation. [FSSAI's campus checklist](https://eatrightindia.gov.in/EatRightCampus/checkLists)
  and [UCL catered-hall information](https://www.ucl.ac.uk/study/accommodation/current-residents/food-halls)
  were examples, not imported platform defaults.
- [Visits](blueprint/VISIT_ARRANGEMENTS.md) and
  [external repair work](blueprint/FACILITIES_REPAIRS.md#external-technician-work): one canonical
  person, source engagement, optional visit, exact participation, separately dated
  service/access authority and independent observations/obligations. No Visitor
  portal, universal staff host, account per child or inferred all-campus access.
  [IIT Hyderabad visitor information](https://www.iith.ac.in/faqs-visit-iith/),
  [ETH guest regulations](https://ethz.ch/staffnet/en/employment-and-work/guests/guest-regulations.html)
  and [Oxford visiting-academic guidance](https://www.ox.ac.uk/research/collaborate-with-us/visiting-academics-and-visiting-researchers)
  illustrate variation, including remote work.
- [Campus scenes](blueprint/CAMPUS_VISUAL_SCENES.md): image output remains an
  untrusted reviewable proposal. [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
  helps parseability, not truth; [check answers](https://design-system.service.gov.uk/patterns/check-answers/)
  informs bulk review. Manual tracing remains usable. Furniture is illustration,
  not inventory; inferred doors are not approved access/evacuation routes.

## Remaining acceptance

Carry these forward explicitly; archiving old reports does not resolve them:

- Whole-platform Simulation capability evidence, full 22-story convergence,
  production-size first-open/performance, hosted CI/provider operation and real
  institutional acceptance. The 29 October pool fix does not erase observed cold
  latency or certify every domain.
- Calendar's direct personal fee/assignment deadline feeds and a linked-family
  Aaranya browser journey; current public notices are not private obligations.
- Current-source review of unresolved audit findings, including published Event
  amendments and scheduled physical-exam changes; do not infer closure from
  unrelated native editors or cancellation/replacement.
- Visitor public/anonymous discovery/intake, recurring itineraries, actual
  room/entry/service entitlements, movement correction/retraction, older-history
  paging and sensitive-document retention execution. Real mailbox delivery is
  not established by a synthetic transport; legacy role invitations were not all
  upgraded by the neutral-member proof slice.
- Provider synchronization/payment reconciliation, physical observations and
  field-validated Dining/repair procedures. A reference link is not a connector;
  independently owned app/ERP facts must retain one writer and explicit freshness.
- Functional acceptance of the implemented universal ports, including
  browser/simulator/emulator workflows, authenticated Android, accessibility and
  data/history/recovery. The bounded source-port audit is complete; the camera
  lifecycle findings above still need exact corrected-owner/reviewer closure.
  Broader physical-phone/tablet workflow coverage is unverified and not a retirement prerequisite; hardware-only limits and store/distribution readiness remain
  separate from the owner's old-web retirement decision.

Before closing any item, inspect its current owning code/contract, reproduce the
actual case and add proportionate release-bound evidence. Do not recreate one
dated narrative file per small patch; update this index/active delivery plan and
store machine receipts/screenshots with the owning artifact instead.
