# ThatCampus universal app

One React Native / Expo SDK58 application targets web, Android, iPhone and iPad. It
uses the existing ThatCampus API and server-composed Today / Work / Areas / More
workspace. Domain rules, campus selection and Simulation authority stay on the
server. Shared TypeScript contracts live in `../packages/contracts`; native
screens and navigation live here.

Owner decision, 29 October 2026: this universal app is the sole frontend under
active development. New features and fixes belong here once. The old React/Vite
application is frozen reference/rollback source, with no parallel feature, fix or
Vite maintenance work. Its removal waits for the owner's active-port and
browser/simulator/emulator functionality, data/history and rollback review;
current route presence does not prove that review complete. Physical devices were
unavailable at that decision and remain excluded as an old-web retirement prerequisite.
Hardware-only behavior stays untested; store/distribution readiness is separate.

The implemented source and remaining current-flow/acceptance gaps are recorded in [PARITY.md](PARITY.md);
[current acceptance](../docs/VERIFICATION.md#native) separates source, bundles,
installed builds and device evidence. Store release and full platform acceptance
remain open. There is no general offline mutation queue or background push delivery.

## Shared design and updates

Compatible backend records, permissions and rules are shared by all targets.
Every target sees compatible record or published campus-layout changes after a
successful refresh. Focused, foreground API screens normally poll every 60
seconds and also support refresh/invalidation. This is not instant delivery of
every change. The server-composed workspace can update existing labels, counts
and available work, while a new native workflow still needs its native screen.

The universal browser and native targets now use the same React Native domain
screens, with platform adapters for controls, sessions, private files and storage.
The canonical [theme tokens](src/ui/theme-tokens.ts) now belong to this sole
frontend. They preserve all four accepted Light/Dark and Live/Simulation palettes
and radii exactly, including separate filled-action and foreground-link colors.
Change these shared tokens once for every target. The old CSS generator, parser
dependency and build hooks were removed; native styling no longer requires edits
to the frozen frontend. Migration audits may still read frozen reference
registrations; universal runtime, types and builds now resolve mobile/shared-owned
modules without importing the old frontend.

From the repository root:

```sh
npm --prefix mobile run typecheck
npm --prefix mobile test
```

The mobile tests include readable body, link, action and semantic contrast checks
in all four theme modes. Shared React Native screens, contracts, pure helpers and
theme tokens become part of the next
platform bundle. Metro can refresh development clients, including the managed
browser preview through Fast Refresh. Static/release browser delivery requires a
new served export; an installed standalone mobile app does not receive source-file
changes automatically. Backend records/rules can
refresh through compatible APIs independently of UI delivery.

No `expo-updates` delivery is configured. The standalone Android preview embeds
Hermes JavaScript, so updating its screens or tokens currently requires a new
build and installation. A future [EAS Update](https://docs.expo.dev/eas-update/introduction/)
setup would first require new binaries, then explicit staged publication of
compatible JavaScript/assets using a
[runtime-version policy](https://docs.expo.dev/eas-update/runtime-versions/).
Native dependencies, permissions and native configuration still require new
binaries. These delivery options do not establish production or store readiness.

## Dependencies and local browser

From the repository root, install both exact lockfiles used by the universal app:

```sh
node mobile/scripts/install-dependencies.mjs
```

This installs `packages/contracts` dependencies first, then `mobile`, with install
scripts disabled. Installing only `mobile` misses the shared import/parser runtime.
No Git operation is required. Native project preparation/build remains explicit.
Frozen reference registrations may still be read by migration audits; they are
not universal runtime, type or build dependencies.

With the existing local backend running on port 8000:

```sh
cd mobile
EXPO_NO_GIT_STATUS=1 EXPO_NO_TELEMETRY=1 npm run web -- --port 8082
```

Metro serves the universal browser entry and proxies only same-origin `/api/`
requests to the loopback backend; `EXPO_WEB_API_PROXY_URL` may select another local
HTTP backend origin. Browser auth uses the existing httpOnly cookie and CSRF
ceremonies, never a native bearer token. A deployed browser app needs reviewed
same-origin API routing. The maintained Mac preview below supplies that routing
for its exact temporary origin; Metro remains the local development host. The
retained frontend source remains available for reference and rollback until
[cutover gates](PARITY.md) pass.

### This Mac's managed public preview

Live React Native Web development is active at the existing
[Cloudflare URL](https://quit-cloth-shore-listing.trycloudflare.com), through the
normal `dev.thatcampus.web` LaunchAgent and the command below from the repository
root. The [public activation receipt](../artifacts/native-web-ui-20261029/live-development-public-activation.json)
records the running development host, signed-in app and bounded public route
checks. The [rendered Fast Refresh probe](../artifacts/native-web-ui-20261029/live-development-hmr-source-probe.json)
observed a temporary component edit and exact source restoration without reload;
the input survived both updates, then the owned test input was cleared.

```sh
/usr/local/bin/node mobile/scripts/serve-web-preview.cjs \
  --mode development \
  --metro-origin 'http://[::1]:8084' \
  --port 5173 \
  --public-origin https://quit-cloth-shore-listing.trycloudflare.com
```

The host binds only `127.0.0.1`; the existing Cloudflare process continues to
forward port 5173, and the same-origin API proxy continues to use API 8000 with
its browser cookie/CSRF ceremony. Only the reviewed web bundle, assets and bounded
`/hot` WebSocket protocol reach the existing Metro on `[::1]:8084`; native bundles,
inspector and development-control routes are denied. No Vite server is involved.
Installed native clients use a separate cookie-free API transport through this
same host: explicit native account JSON ceremonies, or an explicitly presented
native Bearer credential validated by the API. These requests have no browser
Origin, Referer or Fetch Metadata and cannot carry browser cookies or CSRF tokens;
the bridge neither invents a browser Origin nor returns Set-Cookie for them.
Ordinary browser actions retain their exact-Origin and CSRF checks, including the
separate Google browser proof. A bearer-shaped header grants no authority at the
proxy; current session, school/world and domain checks remain with the API.
The [18 HTTP/WebSocket checks](../artifacts/native-web-ui-20261029/live-development-host-tests.log),
[real Metro probe](../artifacts/native-web-ui-20261029/live-development-existing-metro-probe.json)
and [isolated candidate receipt](../artifacts/native-web-ui-20261029/live-development-host-root-candidate.json)
verify local protocol/routing behavior. The
[source review](../artifacts/native-web-ui-20261029/live-development-host-source-review.json)
and [independent review](../artifacts/native-web-ui-20261029/live-development-host-independent-review.json)
record the security boundaries and remaining limits. Run the maintained checks with
`node --test mobile/scripts/serve-web-preview.test.cjs` from the repository root.

Refresh an already-open frozen client once to load the development client.
Subsequent supported `mobile/` source edits use Expo Fast
Refresh; they do not require an export or web-host restart. Changes that require a
full reload or native binary still follow Expo's normal delivery rules. The
reviewed recipe eagerly loads one web graph (about 16.7 MB in the candidate), so
its initial load is larger than a release export. This is development-only, not a
production-ready hosting configuration. Keep the shared Metro process running;
do not restart it while native clients have drafts.

The [latest In & Out verification](../artifacts/native-web-ui-20261029/in-out-live-final-verification.json)
records 1630 passing mobile tests, TypeScript and successful web/iOS/Android
exports with exact source/bundle hashes. The
[rendered tour](../artifacts/native-web-ui-20261029/in-out-rendered-verification.json)
covers compact controls, retained drafts and accurate Back destinations in the
browser and iPhone simulator. This does not establish complete workflow or final
iPad/Android gesture acceptance; all 29 retirement groups remain unverified.

Static mode is retained for rollback and reviewed release exports. Create a new
export with
`EXPO_NO_GIT_STATUS=1 EXPO_NO_TELEMETRY=1 npm --prefix mobile run export:web -- --output-dir /absolute/new-export-directory`,
review its assets and checks, then configure the same host with `--mode static`
and `--dir /absolute/reviewed-export-directory`. The historical activated static export is
`artifacts/native-web-ui-20261029/native-only-ports-final-universal-export`; its
[routing receipt](../artifacts/native-web-ui-20261029/native-web-cloudflare-preview.json)
records public authentication, data, campus-map rendering, deep reload and Copy.
Do not overwrite a live export. Standalone mobile UI delivery remains separate.

For a managed web-job replacement or rollback, stop only the web job with
`launchctl bootout gui/501/dev.thatcampus.web`, then wait until
`launchctl print gui/501/dev.thatcampus.web` reports the service absent with exit 113.
Only then install the reviewed development or static job at
`/Users/abhishekyadav/Library/LaunchAgents/dev.thatcampus.web.plist` and run
`launchctl bootstrap gui/501 /Users/abhishekyadav/Library/LaunchAgents/dev.thatcampus.web.plist`.
Bootout teardown is asynchronous; bootstrapping before removal can return 5 with
an underlying 37, Operation already in progress. Leave API, Metro and tunnel jobs
unchanged, and do not run another host on port 5173.

The original Vite job remains a historical rollback backup at
`.runtime/native-web-cloudflare/web-launchagent.previous.plist`; its frontend source
is frozen, not an active development owner. That legacy rollback has not been
executed. Quick Tunnel addresses remain temporary, SSE is unavailable and ordinary
app polling is retained.

All 29 groups remain implemented-unverified, with Live/Simulation, recovery and
full cutover gates still open.

## Local iPhone and iPad

Requirements: Node 22+, Xcode with an iOS simulator runtime, CocoaPods and the
ThatCampus backend running on port 8000. The helper discovers installed Xcode,
including this Mac's `~/Downloads/Xcode 2.app`, and the existing CocoaPods 1.16.2
under the user's Ruby 3.2.2 installation. It configures child processes only;
`DEVELOPER_DIR` can explicitly select another valid Xcode installation.

```sh
node mobile/scripts/install-dependencies.mjs
cd mobile
npm run ios:prepare
npm run ios -- --device="iPhone 18 Pro"
```

Choose a simulator by exact name or UUID from `xcrun simctl list devices available`.
To use the tablet layout:

```sh
npm run ios -- --device="iPad Pro 13-inch (M5)"
```

The helper builds with two compiler jobs, installs the development client, starts
Metro on port 8081 and opens the client once Metro is ready. Xcode 27 calls its
simulator UI **Device Hub**. `npm run ios:build` installs without starting Metro.
`npm start -- --host localhost --max-workers 2` runs Metro alone after installation.
`node scripts/ios-simulator.mjs --check` checks the local tooling without generating
projects, building or changing a simulator. Simulator app signing stays enabled
with an ad hoc identity so device-only Keychain sessions work correctly.

Native API defaults are `http://127.0.0.1:8000` on iOS and
`http://10.0.2.2:8000` on Android emulator, in development only. For another host,
copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL`. A physical phone
needs an API origin reachable from that phone. This variable is public build
configuration; never put passwords, tokens or server secrets in it. Production
EAS builds reject a missing/non-HTTPS API origin.

This Mac's Documents folder attaches Finder metadata that interferes with the
ExpoModulesJSI intermediate framework signer. `ios:prepare` applies a bounded,
version-checked compatibility adjustment to the installed dependency: the nested
intermediate framework build disables its own signing, while final app signing
remains owned by Xcode/EAS. Compiler working files and app DerivedData live under
`~/Library/Caches/ThatCampus`. CocoaPods' vendored `Products` directory stays local
because its framework discovery does not traverse a symlinked parent. The helper
reapplies the adjustment after dependency installation. Generated `ios/` and `android/` projects
follow Expo Continuous Native Generation; `app.config.ts` is their configuration.

The installed ExpoPrint 58.0.8 precompiled iOS framework imports obsolete Core/JSI
Swift ABI symbols against this SDK's installed Core 58.0.26/JSI 58.0.19. The reviewed
`expo.autolinking.ios.buildFromSource: ["expo-print"]` in package.json compiles only
Print against those installed interfaces; package versions stay unchanged. This is
the [supported per-module opt-out](https://docs.expo.dev/guides/prebuilt-expo-modules/#disabling-specific-modules-via-expo-autolinking).
After building, verify the actual embedded binary bindings as well as its signature:

```sh
DEVELOPER_DIR='/Volumes/MacSSD/Downloads/Xcode 2.app/Contents/Developer' \
  node scripts/verify-ios-expo-symbols.mjs /absolute/path/ThatCampus.app
codesign --verify --deep --strict /absolute/path/ThatCampus.app
```

A compile/signature success alone does not prove the dynamic loader can launch the
app. The [current ABI receipt](../artifacts/native-web-ui-20261029/ios-print-abi-after.json)
passes and this client has launched on both iPhone/iPad simulators. The
[navigation receipt](../artifacts/native-web-ui-20261029/back-native-acceptance.json)
records the bounded rendered checks and remaining device acceptance gaps.

### Connected iPhone

The simulator helper does not install on a physical phone. Pair the connected
iPhone, enable its Developer Mode and select the existing Apple Development team.
Use a Release device build to embed JavaScript and assets so opening the app does
not require Metro. Its HTTPS API origin must still be reachable from the phone.
From `mobile/`, with the actual device and team identifiers:

```sh
EXPO_NO_GIT_STATUS=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 \
EXPO_PUBLIC_API_URL=https://your-current-api-origin.example \
DEVELOPER_DIR='/Volumes/MacSSD/Downloads/Xcode 2.app/Contents/Developer' \
xcodebuild -workspace ios/ThatCampus.xcworkspace -scheme ThatCampus \
  -configuration Release -sdk iphoneos -destination 'id=<phone-UDID>' \
  -derivedDataPath "$HOME/Library/Caches/ThatCampus/iOSDeviceBuild" -jobs 2 \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM='<Apple-team-ID>'
```

Verify the resulting `Build/Products/Release-iphoneos/ThatCampus.app` with the
ABI checker above and `codesign --verify --deep --strict`. Install it with
`xcrun devicectl device install app --device <phone-UDID> <app-path>` and launch
`app.thatcampus.mobile` with `devicectl device process launch`. On first launch,
iOS may require the owner to trust that Apple Development profile in Settings →
General → VPN & Device Management. Check the embedded provisioning profile's
expiration; a local development installation may need renewal. The earlier
temporary HTTPS review backend required the Mac's API and tunnel to remain
running; the permanent app2 Release below uses its cloud origin. This local
installation does not change the store-release gates.

Earlier Mac-tunnel [physical-device evidence](../docs/VERIFICATION.md#native) covers native
login, campus/floor/room/resource exploration and recorded resource availability.
The final installed replacement passed strict signing, Expo ABI and unchanged682-source
checks, launched with its session retained, and shows larger/readable floor views
with building/floor actions above the dock. Areas' final Student care row clears
the dock. Signed-out checks reach the last sample-campus link and keep Password
and Sign in above the email software keyboard; interactive dismissal restores
scrolling. Recovery keyboard layout was checked without submission. Registration's
static form was inspected, but its secure-keyboard capture is redacted; lower-field
layout is not accepted from it. Reset has mounted tests only. Fullscreen
destination/report handoff, broader mutations and sustained performance remain open.

### app2 cloud origin and installed updates

The first closure wave includes exact accepted/refused term/class/subject recovery with fresh review, assignment review handover, future examination amendments and truthful unavailable-email handling. Shared source tests and local web/iOS bundles pass; rendered multi-account review and a newly signed iPhone install remain open. The production origin is `https://app2.thatcampus.com`; operations/rollback use the [DT runbook](../deploy/dt/README.md). Conformance **217** is live at `https://app2.thatcampus.com`, release `1d20692fde6fd981d9dfc2d48eaff3bd5b02e2c1`, revision `thatcampus-dt-r-1d20692fde6f-42467414526-1`, image digest `sha256:1c3763aa9ac8c6b8859f2f664f2b1a04dabb21f93a977cfc0ff602e84670094f`. [Actions run 42467414526](https://github.com/EduveraIITA/Eduvera/actions/runs/42467414526) and the [release receipt](../artifacts/core-functionality-fixes/ci-release-42467414526/release.json) record successful one-attempt migration check `thatcampus-dt-migrate-h7nvw` and candidate/public smoke. [CI](../artifacts/core-functionality-fixes/ci-217-verify.log) passes 159 actual PostgreSQL cases across 27 files with zero skipped/todo cases, 540 fast backend cases, 40 source/auth cases, 1870 mobile cases and 43 deployment guards, plus strict conformance/types/build/web-export checks. The lint gate accepts 47 exact unchanged prior errors; it is not clean ordinary lint. [Live reads](../artifacts/core-functionality-fixes/cloud-read-217.json) pass for director, faculty and student: handover setup is allowed only for the director's current authority, with all probe-owned sessions revoked and then refused. These are bounded automated/API checks, not rendered, physical-device or sustained-capacity acceptance.

Source218's authorized setup-entry repair is pending release. With the Mac now unlocked, a [bounded Safari217 check](../artifacts/core-functionality-fixes/rendered-browser-217.json) signed in the director and read People records, then reproduced a false denial at Campus setup. The [entry repair proof](../artifacts/core-functionality-fixes/email/more-tool-entry-source.json) retains the failing mounted regression, 19 passing focused checks and whole-mobile TypeScript. It resolves an explicit setup child through the current grouped setup launcher, retaining actor/campus/world/error and backend permission guards. Its source fingerprint is `sha256:c86fe454fbdabc457db08a1f158e667979bd9d7624d467e3011fcf29f0fadd39`. This is pending navigation work, not rendered218 or renewed native-install acceptance; the [native review](../artifacts/core-functionality-fixes/parity218/review.json) keeps all 53 source findings and 80 capability-evidence slots unchanged.

The [8 November functional audit](../artifacts/core-functionality-audit/review.json) records the pre-closure serving release215. Director, student and faculty [ordinary native-API tours](../artifacts/core-functionality-audit/cloud-personas.json) pass with five/four/four concurrent map reads in 3154/2768/3165ms, expected management refusals and owned-session revocation. Main-pool metrics show zero held/waiting clients at both observations and zero recorded acquisition failures; these counters do not cover every Simulation pool or establish uninterrupted availability. The [readiness probe](../artifacts/core-functionality-audit/cloud-readiness.json) returns onboarding/profile successfully, optional SMS unavailable and Assistant `ready=false`. [Current flags](../artifacts/core-functionality-audit/provider-config.json) show transactional email disabled and the Vertex allowance expired at `2026-11-08T00:00:00Z`. No email, SMS, inference or domain command was dispatched. Distribution is deferred by the owner while core closure is prioritized.

The [first 214 native login failed](../artifacts/app2-cloud-deployment/concurrent-native-214-transition.json) during the transition. [Read-only diagnosis](../artifacts/app2-cloud-deployment/pool-214-diagnostic-review.json) records pool acquisition failure, old/new process overlap, an older progressing transaction and a nested notification timeout. The older group had drained by 10:52 UTC. Afterward, [three six-request native API waves](../artifacts/app2-cloud-deployment/concurrent-native-214.json) all pass in 2636/2553/2476ms with pool 4 unchanged and owned-session revocation/refusal. [Fifteen native API checks](../artifacts/app2-cloud-deployment/native-read-214.json) pass, including workspace 2437ms, In & Out 103ms, visit options 189ms, scene 350ms, login/logout and revoked-session refusal. These are bounded recovery samples, not uninterrupted availability, sustained-load or physical frame-rate acceptance. The scene reports 3 mapped buildings, 84 rooms, 261 fixtures and 269 recorded states; it does not prove actual occupancy.

A later failure at 11:06 UTC occurred after the old process had drained: map and personal-context requests again timed out waiting for a pooled client. The [later diagnostic review](../artifacts/app2-cloud-deployment/pool-214-later-diagnostic-review.json) retains both request IDs and unsuccessful reproduction attempts. Fresh map/mine/bell reads, a fair JIT on/off pair and 90-second periodic-worker sampling subsequently passed; they do not identify the cause or close intermittent reliability. Idle PostgreSQL sessions alone do not prove clients were returned to the application pool. No persistent JIT or capacity setting was changed.

[Six rendered browser checks](../artifacts/app2-cloud-deployment/browser-cloud-214.json) pass for a fresh floor canvas, mapped computer/status, exact report holding/room prefill, Report Back with visible canvas/exact selection, Campus clearing stale resource/interior intent and canonical first-floor selection. No report was submitted. This verifies the reproduced floor/Back correction in that browser scope; the historical transient outdoor issue and physical rendering acceptance remain open.

Permanent-origin native Release build 3, version 0.1.0, is [installed](../artifacts/app2-cloud-deployment/ios-build3-install.json). [Origin/version](../artifacts/app2-cloud-deployment/ios-build3-origin.json), [ABI](../artifacts/app2-cloud-deployment/ios-build3-abi.json) and [code-signing](../artifacts/app2-cloud-deployment/ios-build3-codesign.log) checks pass: app2 is embedded, the tunnel is absent and the app replaced the prior install without uninstalling. Recorded iPhone checks showed Today and the campus map loading. Device Hub coordinate input did not reliably reach the phone; the owner's In & Out/Arrange visit check remains pending. Full physical touring, mutations, sustained frame-rate, thermal and battery behavior remain unaccepted. Earlier hardware checks above belong to the Mac-tunnel Release. Build 3's Personal Team profile expired `2026-11-07T04:18:20Z`; cloud hosting does not renew signing.

The [214 source review](../artifacts/app2-cloud-deployment/notification-recovery-review.json) retains 207 focused mobile checks, including 11 real QueryObserver recovery cases, full mobile types and 7 real PG notification parity cases. Campus snapshot polling stops after terminal errors while explicit refresh/foreground recovery and scope isolation remain. Explicit Campus/floor navigation clears stale resource intent; Report Back preserves floor/room/resource context. Backend notification reads use one client/current snapshot, and activity horizon extension no longer expands unrelated academic schedules. These source checks complement the listed hosted API/browser evidence; they do not imply complete physical or all-platform acceptance.

Build Release with `EXPO_PUBLIC_API_URL=https://app2.thatcampus.com` and `EXPO_NO_DOTENV=1`. Stored-session restoration accepts only the binary's normalized configured origin. Replacing a tunnel build forgets the old credential locally and starts at sign-in; it never forwards it to app2, revokes it on the old server or changes the password. Development retains its explicit server override. The permanent-origin Release needs the cloud API without Metro or a running Mac tunnel. Compatible backend changes refresh through the API; no Expo Updates delivery is configured, so native JavaScript/UI changes require a rebuilt/reinstalled binary.

Simulation restoration remains incomplete after failed continuation `22wz4`. The [bounded shared-capacity packet](../artifacts/app2-cloud-deployment/bounded-postdata-shared-capacity-plan.json), review `b1be4c07e1463bc874ab9ff9aacfa8b608c0223177dd70fd2c354c12277d24d9`, is [independently reviewed](../artifacts/app2-cloud-deployment/bounded-postdata-independent-review.json), with 18 policy cases and three extra failure probes. Its 900-second hard job limit retains an eight-minute/1000-entry work ceiling, one restore connection, short transactions, health-paced pauses and an admission fence. The exact reviewed packet has been uploaded and job `thatcampus-dt-bounded-postdata` created with a 900-second timeout; it has never been executed; fresh target/job/controller/catalogue/admission/health checks remain required, with a new reviewed remaining-only plan after every invocation/partial failure. Retained worlds/private archives stay protected. The owner chose to retain shared SQL and current limits, without a new server, resize or pool increase. Ordinary attachment upload/download remains pending. The [provider window](../deploy/dt/README.md#exact-ci-release-sequence) ended `2026-11-08T00:00:00Z` without cloud inference acceptance. Apple Support shows a case confirmation; paid membership/App Store Connect/TestFlight remain unconfirmed.

### TestFlight

Owner direction, 8 November: defer distribution work while closing [core functionality](../docs/blueprint/IMPLEMENTATION_PLAN.md#core-functionality-closure). This does not establish signing or store readiness.

TestFlight requires an active paid Apple Developer Program membership and an
App Store Connect app record matching the bundle identifier. The local Apple
Development installation above and EAS `preview` ad-hoc distribution do not provide
TestFlight delivery.

Owner-account enrollment remains unresolved after **Unable to Continue**. The
existing Apple Support tab now shows a case confirmation; no paid membership,
App Store Connect app or TestFlight upload is confirmed. The earlier
[enrollment checkpoint](../artifacts/iphone-login-testflight-20261031/status.json)
retains the prior draft state as historical evidence.

Use the existing Xcode workspace; no EAS project or Git operation is required.
From `mobile/`, replace the origin and paid-team placeholder:

```sh
EXPO_NO_GIT_STATUS=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 \
EAS_BUILD_PROFILE=production \
EXPO_PUBLIC_API_URL=https://your-current-api-origin.example \
DEVELOPER_DIR='/Volumes/MacSSD/Downloads/Xcode 2.app/Contents/Developer' \
xcodebuild -workspace ios/ThatCampus.xcworkspace -scheme ThatCampus \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -archivePath "$HOME/Library/Caches/ThatCampus/TestFlight/ThatCampus.xcarchive" \
  -derivedDataPath "$HOME/Library/Caches/ThatCampus/TestFlight/DerivedData" \
  -jobs 2 -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM='<paid-Apple-team-ID>' archive
```

`EAS_BUILD_PROFILE=production` enables the app config's HTTPS-origin check for this
local archive too. Release embeds JavaScript and assets; the API must still be
reachable. Open the archive in Xcode Organizer, validate it, then choose
**Distribute App → TestFlight & App Store** with automatic signing and upload.
Check the next unused build number in App Store Connect or let Organizer manage
build numbers; EAS auto-increment does not manage this local archive. Choose
**TestFlight Internal Only** only when that uploaded build must never reach
external testers or the App Store.

After processing, complete Apple's encryption questionnaire with the actual
SQLCipher/CommonCrypto and other encryption use; keep SQLCipher enabled and do
not assume an exemption. Add the build and eligible App Store Connect users to an
internal testing group, then accept the invitation in the iPhone's TestFlight app.
Internal testing supports up to 100 testers; each build expires after 90 days.
See Apple's [archive and distribution workflow](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases),
[internal testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
and [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

## Local Android

The official command-line SDK is installed at
`/Volumes/MacSSD/Developer/Android/sdk` under the owner's accepted Google SDK
terms. Official Android Studio Rabbit 2 (2026.2.2) is installed at
`/Volumes/MacSSD/Applications/Android Studio.app`; its downloaded ARM image was
checked against Google's published SHA256. Studio reuses the SSD SDK and AVD
directory. It remains optional for the command-line build. The bounded helper
uses an installed Java 21 Gradle launcher and Java 17 React Native compiler, two
Gradle workers and a two-job native compile/link pool. Its Gradle cache lives on
the SSD at `/Volumes/MacSSD/Caches/ThatCampus/Gradle` on this Mac. No global Java
selection is changed. The helper does not accept licenses or download SDK/JDK
packages automatically.

```sh
node scripts/android-build.mjs --check
npm run android:build
```

This produces `android/app/build/outputs/apk/debug/app-debug.apk` for ARM64. The
debug app requires Metro. `npm run android` is the ordinary Expo launch command
for an already configured emulator or connected device. `ANDROID_HOME`,
`JAVA_HOME`, `JAVA17_HOME` and `GRADLE_USER_HOME` can select other installed tools;
conflicting SDK configuration fails before the build.

For a local preview with JavaScript bundled inside it, select a reachable HTTPS
review backend explicitly:

```sh
EXPO_PUBLIC_API_URL=https://your-api.example.com npm run android:preview -- --prepare
```

Replace that example origin with the intended backend. The preview helper checks
the embedded Hermes bundle, API origin, signature, ARM64 ABI and 16 KiB alignment,
and rejects source changes during the build. It copies the checked APK and a
receipt to Downloads. The release-only manifest denies cleartext and removes
development overlay access; debug local-network development keeps its own policy.
This local preview uses the generated development certificate. A temporary review
tunnel and this certificate do not establish a production deployment or Play
distribution identity.

The owned `ThatCampus_Native_QA` Pixel 8 AVD lives at
`/Volumes/MacSSD/Developer/Android/user/avd`, using stable AOSP ARM64 API 37,
2 CPUs and 2048 MiB RAM. On this Mac, `ADB_USB=0 ADB_MDNS=0` avoids a local
USB-enumeration hang without changing devices or OS permissions. Embedded-preview
build/byte checks and emulator startup do not prove complete Android flows.
Bounded authenticated checks are recorded in [acceptance](../docs/VERIFICATION.md#native).
The emulator is already docked in Android Studio; final shared-host gestures remain
unverified because CUA returns `noWindowsAvailable` despite a fresh app binding,
Raise and session reset. This is not awaiting a docking action.

## Platform behavior

- Workspace navigation uses the shared Expo tab state and Glass controls; domain
  pages retain native stacks, gestures and removal guards. Portrait iPad uses the
  bottom bar; a wide landscape operating pane uses the sidebar. On iPad, expanded
  Assistant shares the screen with the usable app, adapting each pane to its real
  size. iPhone keeps full-screen expansion. Content and form surfaces remain
  readable; Glass respects Reduce Transparency and OS support.
- In & Out uses compact shared search/filter controls and form actions, one
  heading, retained form pickers and explicitly guarded local Back returns.
  Nested person/import discard and unsent-note handoffs preserve the other
  mounted draft. The [current evidence](../docs/VERIFICATION.md#in-out-ui) separates
  source/mounted checks and bounded browser/iPhone rendering from all-workflow
  acceptance; final Android gestures remain unverified.
- Light/Dark and Live blue/Simulation amber use the existing ThatCampus theme.
  The root supplies the same resolved palette to Expo Router's navigation theme,
  so native header glass follows the page appearance. The
  [rendered checks](../artifacts/native-web-ui-20261029/assistant-overlay-rendered-acceptance.json)
  bound the accepted Glass, compact/split/full presentation and navigation behavior
  separately from build and source checks.
- Simulation screens show the selected run's last confirmed virtual time and
  recovery controls. A paused or backgrounded device never invents clock progress.
- Sessions use server-issued opaque bearer tokens stored in device-only Keychain
  storage. Cookie/CSRF browser sessions remain separate. API responses and durable
  commands are bound to the account, origin, campus and selected world.
- Native Attendance observations use SQLCipher. Supported native pending commands
  retain their exact intent in device-only secure storage. The browser variants use
  scoped AES-GCM records and a nonextractable key in IndexedDB; denial/corruption
  fails closed. Browser storage does not have device-lock/Keychain guarantees.
  Protected Care narratives and callable retries remain session-memory-only.
  Unknown outcomes stay unknown;
  recovery never infers a physical observation or duplicates a financial action.
- Private downloads use authenticated bounded transport and temporary native files
  or bounded browser Blob downloads. Browser staged upload bytes remain encrypted
  and exact-scope/hash checked across reloads.
  Foreground journey sharing stops on background/lock; it is not background tracking.
- Unrecognized destinations resolve through the current server workspace and
  show a scoped unavailable state when no current app screen exists. Native
  credentials stay in their selected transport.

## Sandbox checkout dependency and limits

`react-native-razorpay` 3.0.0 is installed for the guarded native sandbox adapter;
web keeps the current hosted Checkout adapter. Expo Go does not supply this native
SDK. A development/release client must be rebuilt with the dependency before the
checkout can open; JavaScript export alone does not add its native module. The
adapter checks SDK availability before requesting a new provider order. Native
Print also requires its compiled module; authenticator QR uses local `qrcode` 1.5.4
and does not send the enrollment secret to an external image service.

The current server disables online payments by default and accepts only a
non-production Razorpay test configuration. Linked-guardian eligibility and exact
invoice authority come from the owner API. No gateway flag/key or payment was
activated by this port. Callback success is not a receipt: server signature
verification and the exact captured order/receipt must agree. Cancellation or an
uncertain response retains the original amount/order for status recovery.
Simulation uses its run-local pending-only order without opening the provider or
claiming money moved. Actual SDK open/cancel/return, relaunch/status recovery and
private receipt behavior remain acceptance gates even after a binary builds.

See the current [Razorpay iOS](https://razorpay.com/docs/payments/payment-gateway/react-native-integration/standard/integration-steps-ios/)
and [Android integration](https://razorpay.com/docs/payments/payment-gateway/react-native-integration/standard/integration-steps-android/)
docs and [Expo development-build requirements](https://docs.expo.dev/develop/development-builds/faq/).

## Verification and release

```sh
npm run typecheck
npm test
npx expo-doctor
npm run export:web
npm run export:ios
npm run export:android
```

Android sources share the same app; an ARM64 native debug build has passed.
An exported JavaScript/assets bundle neither rebuilds the installed native client
nor establishes workflow/device acceptance. The current parity inventory keeps
source-only ports `implemented-unverified` and retains every unfinished platform,
Simulation, recovery and visual gate. Reviewed source fingerprints require a
separate final review; do not refresh them just to hide drift. Release profiles
are in `eas.json`; a local Apple Development identity and device profile are
available on this Mac. No EAS project, App Store Connect or Play Console upload
is configured.
Before distribution, finish the applicable release and Simulation acceptance,
configure the real HTTPS API, review privacy/encryption declarations and push
delivery, and obtain separate signed-build/hardware evidence when available.
Store/distribution work remains distinct from old-web retirement: unavailable
physical-device checks do not block that retirement. Active ports, real data
links/history and browser/simulator/emulator functionality still require review.

No Git operation is needed for these commands. Repository Git work remains
deferred by the owner's protected-folder instruction in `../AGENTS.md`.

Original Assistant artwork and native motion follow
[brand rules](../design/brand/README.md). Web SVG SMIL does not execute in the native
renderer; loading, amber and Reduce Motion need native acceptance, not a web-only pass.
