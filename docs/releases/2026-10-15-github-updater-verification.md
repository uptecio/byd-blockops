# GitHub updater v0.11.0 — local verification

This is a local candidate, not a published release. The published download remains v0.10.0. No GitHub release, push, live server restart or physical BYD test was performed as part of this verification.

## Package

`block-ops-v0.11.0-github-updater.apk`: package `au.local.blockops`, version 0.11.0, Android code 15, minSdk 26, targetSdk 36, multiplayer protocol 8.

APK SHA-256: `91f44e8b89c3352398673c940e9f2693ba5cfa8e4f96cff1928f18968ce3bb82`.

Original signer SHA-256: `6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49`. The original key was checked before building. Exactly INTERNET and REQUEST_INSTALL_PACKAGES are requested. The APK has no CPU-specific native libraries and contains exactly four game assets, compared byte-for-byte with the tested browser build. Instrumentation and updater fixture classes are excluded from delivered DEX.

| Packaged asset | SHA-256 |
| --- | --- |
| game.js | `5bd62cdf41d710a5cc8c895477adb9509e201061af486502ab8c11ac70a2f325` |
| index.html | `45d62e8163ec1e967da56641c315e94c5f910be8ceb16845662228ea7f901422` |
| styles.css | `2b805142aaf7f771c443259b806e742d9926a6f791d6d35f735f7769fd376a57` |
| THREE-LICENSE.txt | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |

The final release-script APK is frozen and explicitly bound to the native acceptance manifest. Regenerated code-16 fixture SHA-256 is `ebea05ffc11f90cec731bc7f0990c3efc387d764f983dfb36262143c7d0c5a49`. Independent source comparison confirms identical Java, manifest and build inputs, except the fixture's explicit version 0.11.1/code16. Its packaged game assets equal the final candidate. The fixture is for testing and is not a published update.

## Automated verification

The final full JavaScript suite passed 1,502 tests, with no failures or skips, including fifteen focused tests for conservative native security-screen observation. All three updater JVM suites passed. Package smoke passed its four checks. Browser regression groups passed without retries: updater UI/layout (including 915×412 and legacy runtime cases), Home, touch, WebView startup/layout, runtime-error recovery, progression/layout/modes/online, Shooting Range/layout/online, and multiplayer. These ran against the exact packaged assets.

Required Android lint initially found four NewApi errors where a supplied SDK test seam hid the actual platform guard from lint. The verifier now checks the actual platform too and rejects unsupported modern identity decoding. Lint then passed with zero errors and seven warnings. Existing legacy API26/27 behavior remains covered.

Warnings are not treated as a pristine build: inherited manifest/orientation/backup, JavaScript-enabling and text-resource advisories remain; updater storage-space and dialog-text advisories also remain. The inherited Gradle namespace syntax warning and updater legacy signature/version deprecation notes are recorded separately. No warnings were suppressed and no new lint baseline was created.

## Evidence boundaries

On the fresh API36 device, immutable published14 earned genuine Shooting Range XP, a cosmetic, a Zombie record and a private PIN-backed save. Manual installation of the exact final15 preserved all five save strings; the app-originating original-signer15→16 replacement also preserved them exactly. The pulled installed16 matches the regenerated fixture hash and original signer. Real permission denial/grant, Android cancellation and explicit Retry, sealed-session process-death recovery without double commit, unrelated-session preservation, rejected candidates and connected TLS cases passed. Actual archive/installed-identity checks passed on36.

Play Protect's actual Scan app control was tapped under explicit test authorization. Its observed result was “This app looks safe,” followed by a separate normal Install confirmation. No protection was disabled and no Install anyway action occurred. Final installation used the same original sealed session; a surviving host observed the safe Install tap, actual process replacement and post-install save checks. The original download/submission observer and the scan observer each stopped at previously unrecognized accessibility states, so there is no claim of one uninterrupted host spanning Download→Scan→replacement. Retained failures also include an emulator abort/restart without wiping data and a bounded Retry-render observation correction. These were test-host/environment issues; frozen product/fixture bytes did not change.

On the fresh API26 device, Android's first-run fullscreen onboarding initially obscured the old APK's fatal-error screen. After an ordinary observed GOT IT dismissal, the exact old startup failure was captured. One explicitly authorized same-byte14 refresh preceded any earned gameplay. Manual exact15 reached Home, earned genuine progress/cosmetic/PIN/Zombie data and persisted it across restart. A single subsequent host passed all rejection, cancellation, recreation, permission, sealed-session recovery and connected TLS cases, then observed the real app-originating15→16 replacement and exact five-save retention. No Play Protect prompt appeared on26. Its pulled16 bytes/signature match the same final fixture, and actual installed/archive identity plus bridge regressions passed. No15 refresh or extra16 adb installation was used on either final device.

| Final device | Retention and installation proof | Qualification |
| --- | --- | --- |
| API36 / WebView133 | Earned14→manual exact15→app-originating16; original signer and five saves preserved; actual safe Google scan | Separate submission, scan and final-confirmation observers; no uninterrupted Download→Scan→end claim |
| API26 / Chrome69 | Manual exact15 Home; earned/persisted15→app-originating16 in one surviving host; original signer and five saves preserved | Published14 cannot start; no earned14→15 proof; direct staged readback unavailable |

API26 gameplay used measured physical adb input; API36 gameplay used guarded WebView touch input because of the emulator cutout offset. Native updater, Settings, installation and security controls used actual accessibility-observed physical taps. These adapters do not prove physical BYD input behavior.

Scripted releases and network/storage failures exercise the real controller, private candidate store, Android verifier and installer through test-only instrumentation. They do not demonstrate internet TLS. Real loopback TLS cancellation and real fixed-endpoint GitHub/default-platform-trust checks are recorded separately from injected cases. Browser bridge mocks demonstrate UI only. Ordinary browser builds have no APK controls or GitHub update traffic.

On the stock API26 Chrome69 image, the immutable published code14 fails during startup because `Object.fromEntries` is unavailable. Earned-save14→15 retention cannot be claimed for that combination. The accepted API26 matrix is exact14 startup failure, manual same-signer15 reaching Home, genuine earned/persisted15 data, and a real app-originating update to16. API26 also denies direct staged-session readback through SELinux; native ownership/write/fsync/recovery checks remain, and pulled installed APK hashes/signatures provide a separate final-byte check. No policy/provider workaround was used.

Task6's historical API36 update completed after a platform verification timeout during an approval pause; that was not a successful Google scan or an uninterrupted final-byte chain. Fresh Task7 evidence must stand on its own. The earlier Task5 native WebView evaluation timeout remains unexplained; later passes do not establish contention as its cause.

Android installation and additional security prompts remain under the user's control. Test-only authorization permits the visible Play Protect **Scan app** action for these APKs; it does not permit protection changes, Install anyway, or overriding a harmful-app finding. Production code never approves security prompts automatically.

Physical BYD Shark 6/head-unit testing is unperformed. Emulator and desktop browser results do not establish vehicle firmware installation support, touch mapping or real-device compatibility. Play while parked.

Local evidence is retained under `artifacts/updater-task7/` and the named API26/API36 artifact directories; the full execution report is `.superpowers/sdd/2026-10-15-github-apk-updater/task-7-report.md`. Frozen source manifest SHA-256: `6439020136cf291d7ce6d62da6604abac5c7dfe89657a286c10997804e542155`. Test-host-only revisions have a separate manifest; product/fixture bytes remained frozen. Final audits found the original checkout, live distribution, release assets and live server processes unchanged.
