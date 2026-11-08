# Current delivery and next work

Updated 8 November 2026. This is current bounded delivery status, not a release diary
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

Conformance **224** serves app2 from source `77cb27766bab5e201f58b0933326e4675f009c90` and revision `thatcampus-dt-r-77cb27766bab-42521304159-1`. The verification and password-reset links carry the proof into the app without a token field. [Actions run 42521304159](https://github.com/EduveraIITA/Eduvera/actions/runs/42521304159).

Conformance **220** shipped to `https://app2.thatcampus.com`, source `b8fac640ce16c56016615ce1a2ebdbc7ed21e7f1`, image digest `sha256:8e31ff71964c84c60e9500a0f73149d0ca61810cae3b1257b2f07fdf37af6101`. [Actions run 42506869281](https://github.com/EduveraIITA/Eduvera/actions/runs/42506869281) and the [release receipt](../../artifacts/core-completeness-2/ci-release-42506869281/release.json) record CI release revision `thatcampus-dt-r-b8fac640ce16-42506869281-1`, one-attempt migration `thatcampus-dt-migrate-jxr4g` and candidate/public smoke. [Actual CI](../../artifacts/core-completeness-2/ci-220-verification.json) passes 217 PostgreSQL cases across 43 files with zero skips/todo, 571 fast backend cases/90 files, 37 source/auth cases/4 files, 1980 mobile cases and 45 release guards, plus strict conformance/types/build/web export. The lint gate accepts 42 exact unchanged prior errors; ordinary whole-backend lint is not clean. [Live reads](../../artifacts/core-completeness-2/cloud-read-220.json) pass for director, faculty and student with every owned session revoked and refused; the bounded first-page course/Calendar reads do not establish a nonzero production course cycle. Email configuration and recipient acceptance are recorded separately below. Physical installation/performance, rendered amber/hosted Simulation, actual printing, all-role journeys and sustained capacity remain open.

The owner chose to keep the existing shared PostgreSQL server and limits: no new server, resize or pool/concurrency increase. Release 214 source-scopes activity horizon expansion, reuses current notification authorization in one statement/client, stops terminal-error campus polling, clears stale resource intent on explicit Campus navigation and corrects the reproduced floor canvas/Back problem. [Local recovery evidence](../../artifacts/app2-cloud-deployment/notification-recovery-review.json) retains exact source hashes, 7 real notification parity cases, 39 existing checks, 207 focused mobile cases including 11 recovery cases, and types/lint. [Nine worker PG cases](../../artifacts/app2-cloud-deployment/bridge-native-tests-final.json) include a real mixed academic/activity COW checkpoint, current-policy refusal and unchanged Live/sibling. [Local four-client load proof](../../artifacts/app2-cloud-deployment/notifications-concurrency-local.json) preserves exact results for 20 bell reads/four native session restores; the [owned test DB was removed](../../artifacts/app2-cloud-deployment/notifications-cleanup.json).

The [first 214 native login failed](../../artifacts/app2-cloud-deployment/concurrent-native-214-transition.json). [Read-only diagnosis](../../artifacts/app2-cloud-deployment/pool-214-diagnostic-review.json) records old/new process overlap, pool acquisition failure and a nested notification timeout; by 10:52 UTC the older group had drained. This failure remains evidence; later passes do not establish an uninterrupted upgrade. After drain, [three six-request hosted waves](../../artifacts/app2-cloud-deployment/concurrent-native-214.json) all pass in 2636/2553/2476ms with pool 4 unchanged and owned-session revocation/refusal. [Fifteen native API checks](../../artifacts/app2-cloud-deployment/native-read-214.json) pass, including workspace 2437ms, In & Out 103ms, visit options 189ms and scene 350ms. Published DT data includes 3 mapped buildings, 84 rooms, 261 fixtures and 269 recorded states. These are bounded API/data checks, not sustained-load, occupancy or physical frame-rate acceptance.

A later failure at 11:06 UTC occurred after the old process had drained: map and personal-context requests again timed out waiting for a pooled client. The [later diagnostic review](../../artifacts/app2-cloud-deployment/pool-214-later-diagnostic-review.json) retains both request IDs and unsuccessful reproduction attempts. Fresh map/mine/bell reads, a fair JIT on/off pair and 90-second periodic-worker sampling subsequently passed; they do not identify the cause or close intermittent reliability. Idle PostgreSQL sessions alone do not prove clients were returned to the application pool. No persistent JIT or capacity setting was changed.

[Six rendered browser checks](../../artifacts/app2-cloud-deployment/browser-cloud-214.json) pass for fresh floor canvas, exact computer/status, report prefill, Report Back with visible canvas/exact floor-room-resource context, Campus clearing prior resource/interior intent and canonical first-floor selection. No report was submitted. This closes the reproduced floor/Back case in the listed browser scope; the historical transient outdoor issue remains unclosed. Native Release build 3 is [installed](../../artifacts/app2-cloud-deployment/ios-build3-install.json), with permanent [origin/version](../../artifacts/app2-cloud-deployment/ios-build3-origin.json), [ABI](../../artifacts/app2-cloud-deployment/ios-build3-abi.json) and [code-signing](../../artifacts/app2-cloud-deployment/ios-build3-codesign.log) evidence. Recorded iPhone checks showed Today and map loading, but remote coordinate input did not reliably reach the phone; the owner's In & Out/Arrange visit check is pending. Full physical touring, mutations, frame-rate, heat and battery remain unaccepted.

[Migration 281 verification](../../artifacts/app2-cloud-deployment/role-source-forward-migration-receipt.json) retains 5/6 before, 6/6 after and 42/42 PG checks, unchanged historical migration/trigger identity and safe refusal of unchanged old 211 captures. No automatic world upgrade is implied. Lint accepts exact existing debt, not clean ordinary lint. The prior inventory retained 49 source-review findings; the current audit records 53 and 29 implemented-unverified groups; deployment does not close retirement or full-workflow acceptance.

Simulation continuation `22wz4` [failed](../../artifacts/app2-cloud-deployment/restore-continuation-result.json). The [remaining-only comparison](../../artifacts/app2-cloud-deployment/simulation-postdata-continuation-plan-20261031.json) matches 4597 table counts/238 sequence states and selects 17905 missing DDL entries (14707 foreign keys/3198 RLS flags), not full row-content equivalence. The newer [bounded shared-capacity packet](../../artifacts/app2-cloud-deployment/bounded-postdata-shared-capacity-plan.json), review `b1be4c07e1463bc874ab9ff9aacfa8b608c0223177dd70fd2c354c12277d24d9`, passes 18 policy cases plus [independent review/three additional failure probes](../../artifacts/app2-cloud-deployment/bounded-postdata-independent-review.json). The hard job limit is 900 seconds; work stays capped at eight minutes/1000 entries with one restore connection, short transactions, health-paced pauses and an admission fence. The exact reviewed packet has been uploaded and job `thatcampus-dt-bounded-postdata` created with a 900-second timeout; it has never been executed. Fresh exact-job/catalogue/target/health and terminal-controller checks remain required. Every bounded invocation or partial failure requires a new reviewed remaining-only plan; an ambiguous fence acknowledgement requires its separate inspected recovery. Retain private archives/worlds; no DDL retry or full hosted Simulation readiness is implied.

Ordinary attachment upload/download remains open after the bounded file probe. Build 3's Personal Team profile expired `2026-11-07T04:18:20Z`; cloud hosting does not extend signing, and no Expo Updates delivery is configured. Apple Support shows a case confirmation, but paid enrollment/App Store Connect/TestFlight remain unconfirmed. The approved provider window ended `2026-11-08T00:00:00Z` without cloud inference acceptance. Wider parity, hosted Simulation, sustained shared-capacity performance and complete physical workflows remain open.

Release 215 restricts teaching-context horizon expansion to activity sources, preserves the caller transaction, adds bounded pool acquisition/lease telemetry, and returns a canonical read-versus-unconfirmed-action 503 for exact acquisition failures, including Fastify's pre-controller rate-limit hook. [Real pool tests](../../artifacts/app2-cloud-deployment/pool-telemetry-validation.json), [source/safety review](../../artifacts/app2-cloud-deployment/215-independent-source-and-seal-review.json), the retained red regression and CI cover these changes. Pool size remains four. The earlier 214 failures below remain evidence; the latest passes do not identify their historical cause.

The [8 November functional audit](../../artifacts/core-functionality-audit/review.json) records the pre-closure serving release215. Director, student and faculty [ordinary native-API tours](../../artifacts/core-functionality-audit/cloud-personas.json) pass with five/four/four concurrent map reads in 3154/2768/3165ms, expected management refusals and owned-session revocation. Main-pool metrics show zero held/waiting clients at both observations and zero recorded acquisition failures; these counters do not cover every Simulation pool or establish uninterrupted availability. The [readiness probe](../../artifacts/core-functionality-audit/cloud-readiness.json) returns onboarding/profile successfully, optional SMS unavailable and Assistant `ready=false`. [Current flags](../../artifacts/core-functionality-audit/provider-config.json) show transactional email disabled and the Vertex allowance expired at `2026-11-08T00:00:00Z`. No email, SMS, inference or domain command was dispatched. Distribution is deferred by the owner while core closure is prioritized.

## Core functionality closure

Owner direction, 8 November: defer TestFlight and finish bounded operating journeys.
The [initial audit](../../artifacts/core-functionality-audit/review.json) remains the
starting evidence. Release 220, actual complete current-source CI and post-release
reads are recorded above. Ten isolated IAB checks exercise the listed operating
journeys; physical-device, hosted Simulation and broader acceptance remain open.

The mobile inventory retains **129 routes, 29 implemented-unverified groups and80
capabilities**. Its source review now retains **52 prior findings**, down from53
only because this change independently reviewed the owned native account-entry
path. These are source/dependency mismatches, not52 reproduced functional defects.
[Exact reconciliation](../../artifacts/core-completeness-2/parity/review.json) changes
only45 current-wave fingerprints/dependencies, preserving every route, gap and acceptance
status. Model Core's **80 unverified capability-evidence slots across24 modules**
are a separate inventory; the current conformance audit still retains all80.

| Person and outcome | Bounded delivery and remaining work |
| --- | --- |
| Administrator safely finishes setup after a lost response | Release 220 retains exact accepted/refused catalogue commands and requires fresh review after typed refusal. It also admits the existing scoped Fees, Event, academic-register and Learning packing browser journals through the same finite encrypted grammar. Actual hooks/storage and all1980 mobile tests pass. Unknown intent remains retained; no credential/native-option fallback is admitted. Broader legacy membership/invitation inspect-only recovery remains open. |
| New user verifies email, accepts an invitation or recovers access | Account issuance commits purpose/address-bound single-use proof and encrypted delivery intent atomically. Reset/session/MFA races, ordinary compiled HTTP, queue uncertainty and canonical browser/native-link privacy pass bounded tests. Resend and its three approved DNS records are verified. The approved Resend sender was enabled with managed secret version 1 in release 220 mail-only revision `thatcampus-dt-mail-b8fac640-1794162217151`; image, non-mail settings and capacity are unchanged. [Actual mail outcome](../../artifacts/core-completeness-2/email/live-acceptance-followup-220.json) records 2 inbox receipts from 2 of three approved sends. The original verification email confirmed the address, and the original invitation gave the same verified account member access. The password-reset email is still unsent pending the user handoff. The invitation code remained in the browser address until the campus opened. Provider acceptance, inbox arrival and recipient action are distinct; no universal delivery guarantee, fresh unverified-invite OTP coverage or fourth message is claimed. Optional SMS remains disconnected. |
| Learner gets a submitted assignment reviewed after staff changes | Release 220 reissues exact pending Tasks to a currently eligible explicit reviewer, retaining original instructions, attempts, signatures and history. Native/COW tests pass. Earlier Safari review opened handover metadata without submitting; completed rendered multi-account handover remains open. No successor Offer or personal acceptance is invented. |
| Exam officer changes a scheduled room/time | Release 220 retains frozen candidates and old schedules, revises future never-started sittings and atomically updates canonical expected participation. Material invigilation changes require renewed current acceptance/readiness. Native/COW tests pass; completed rendered examination amendment remains open. |
| College learner follows parallel courses through teaching and reports | Optional Course details connect canonical People enrollment to Activity plans, teaching preparation/reporting, attendance, nonphysical assessment marking/moderation, configured percentage/grade/GPA reports and safe scheduled Calendar dates. Basic learning groups need no term/subject; configured courses use campus time and term bounds. Current own-person launchers/readers preserve null legacy identities. Assessment/report workspace DATA stays class-only by default unless the caller opts into academic_context=offering_v1; common Workspace discovery metadata has no such opt-in query. Native, compiled HTTP and actual COW assertions pass separately. Final isolated IAB review exercises two-learner letter-grade publication, all three learner report formats and configured GPA/CGPA precision; physical offering exams and actual printing remain open. |
| Coordinator changes an operating elective safely | Exact reviewed impact/catch-up disposition routes a named private Finance classification over the real person ledger basis. Only a current explicit no-financial-change decision permits the atomic dated enrollment and reviewed future-plan successors. Earlier marks, actuals, publications, parallel enrollment and money remain. Native/COW and mounted recovery cases pass. Final isolated IAB review exercises Finance decision/task removal, exact continuation/Back, transfer and pre/post-effective timetable. Catch-up is a plan, not accepted or completed remediation; charges/refunds require ordinary Finance owners. |
| Transport coordinator enables colleague cover in ordinary setup | Explicit colleague/decision routing still depends on the guarded development seed. Reviewed institution-owned routing and independently durable refused-attempt handoff remain open; existing administrator assignment is only a bounded fallback. |

[Current220 CI](../../artifacts/core-completeness-2/ci-220-verification.json) passes all217 PostgreSQL cases/43 files with zero skips/todo,571 fast backend cases/90 files,37 source/auth cases/4 files,1980 mobile tests and45 release guards. Strict conformance/types/build/web export pass;42 exact unchanged lint errors remain. [Manual220](../../artifacts/core-completeness-2/review/manual-seal-220.json) binds `sha256:6273f9bdc7c943497c299d45844694fde9d35f2da4e3adc1ef04423a5d0e9d73`; [local evidence](../../artifacts/core-completeness-2/mobile-final.json) separately includes the iOS export. The [source PG summary](../../artifacts/core-completeness-2/postgres/reviewed-source-final.json) retains earlier overlapping slices without adding their counts. [Ten IAB checks and cleanup](../../artifacts/core-completeness-2/rendered/final-acceptance.json) are isolated393×852 Live-web evidence, not production mutations, provider delivery, native installation, actual printing or rendered amber Simulation.

Current course limits remain explicit: physical offering exams/practicals/vivas
need their existing examination candidate integration; pure operating-course
withdrawal without a replacement has no reviewed owner yet; one report scheme
accepts one offering per course code; complex overlapping future replacements use
the existing Activity resolution. Historical published fixture evidence is not
rewritten to improve presentation. Updated course UI requires a new native binary;
legacy installed clients keep their compatible default projections.

Each slice must preserve current authority/revocation, exact before/after-commit
recovery, immutable history, next-owner handoff and a meaningful isolated-world
change with unchanged Live/sibling state. Hosted historical Simulation restoration,
authenticated attachment roundtrips, complete rendered multi-account journeys,
renewed native distribution and sustained shared-capacity testing remain open.
A read-only production tour never proves a completed mutation workflow.

Other lifecycle backlog remains: legacy QR result recovery, general gate observation
supersession, exact older resource paging, native associated HTTPS links, admissions,
group graded submissions, graduation clearance, scoped payer sharing, mentoring,
aid, placement and general staff takeover. These are not prerequisites for starting
a bounded capability. Mapped resource faults/repairs drive DT visuals; moving people
use expected schedules, while observations remain separate anonymous evidence,
not confirmed personal trajectories.

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
| Universal app migration | React Native/Expo is the sole active frontend for browser, iPhone, iPad and Android. New features/fixes are not duplicated into the frozen React/Vite reference. The final physical iPhone15 Release passed signing/ABI and unchanged682-source checks, installed/launched with session retained. Native login, bounded campus exploration, Areas/sheet dock clearance and email-login/recovery keyboard layout have bounded hardware evidence. See [device evidence](../VERIFICATION.md). | [Native parity](../../mobile/PARITY.md) retains broader workflow/platform gaps. Registration lower-field keyboard layout is not accepted from its redacted capture; reset has mounted tests only. Fullscreen destination/report and physical mutations/performance remain open. Local signing expired 7 November 2026; distribution is deferred. Apple enrollment remains unresolved; the Support tab now shows a case confirmation and no TestFlight upload is confirmed. |
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

Follow the ordered **Core functionality closure** slices above; complete one natural
journey before expanding another module. Distribution is deferred, not accepted.
For every slice preserve predictable Back/dirty-exit/deep-link state, accessibility,
keyboard behavior and failure/recovery; verify the current browser and available
simulators/emulator without making unavailable physical devices an old-web
retirement prerequisite. Complete the owning parity review before retiring the
frozen React source.

In parallel with risk-proportionate verification, keep historical Simulation
restoration and cold-open latency explicit, within the unchanged shared server and
pool limits. Preserve COW locks, uncertain-result/retention protections and protected
worlds. Extend Calendar only through complete authorized owning feeds, and do not
fabricate obligations from general dates. General connectors, provider readiness,
real institutional authority adoption, physical outcomes and production scale have
independent gates. The [22-story target](END_TO_END_CAMPUS_WORKFLOWS.md) is a backlog,
not current delivery proof.

Run the checks in [Verification](../VERIFICATION.md#tests), preserve exact
actor/tenant/world/retry/artifact evidence and update this plan in place. Repeat
broad/native suites when changed code or unresolved risk warrants it.

## Documentation maintenance

Keep current requirements in their owning contract; update this status and
`docs/VERIFICATION.md` rather than adding per-fix dated reports or duplicating raw
test output. Add a new contract only for a genuinely separate maintained concern.
Preserve exact raw evidence under `artifacts/`; old reports remain recoverable
outside the active project. Do not turn an old passing test count, staging receipt
or proposed target into current release/physical-workflow acceptance.
