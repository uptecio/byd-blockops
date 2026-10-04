# Solo Zombies 0.5.0 verification

Release 0.5.0 is published at <https://emerald-arctic-thanks-settings.trycloudflare.com/?v=0.5.0>. Browser, packaged Android-emulator and public multiplayer acceptance passed. Physical BYD testing remains a separate required user check, while parked.

## Scope

Offline endless Zombie Survival on all eight maps, walkers and wave-three runners, ten-second recovery, retained loot and 500 rounds per owned gun, numbered inventory, per-map best records. Existing online modes remain FFA, TDM and CTF. No vehicle restrictions, permissions, player skins or multiplayer protocol changed.

## Browser evidence

Task 6: 643 unit/integration tests passed; modern and masked-legacy browser playthroughs used actual input to clear two waves, recover, reach wave three, die and replay. All eight maps started. Twenty-four layout profiles passed (three landscape sizes, two control scales, modern/legacy, normal/safe-area). Recovery/results layout screenshots are explicitly labelled renderer fixtures, not gameplay evidence.

Playwright CLI: actual loot pickup/selection, two cleared waves, health/ammo recovery, pause/resume, wave three, death, saved 2-wave/12-kill best, replay and Home. Legacy CLI startup/inventory used WebGL1, observed 15,849 draw calls and no context loss. Screenshots are in `artifacts/zombies-review/cli`. Only optional favicon 404s and expected Three.js WebGL1 deprecation warnings appeared; no game JavaScript failures.

Existing Home, touch, inventory, inventory-layout, WebView, configurations, multiplayer, loot and loot-touch regressions passed, including legacy inventory. Recurrent inventory timeouts were subsequently diagnosed and fixed, as detailed below. Two demonstrated grenade-selector ambiguities were repaired in tests, retaining their original actions/assertions.

Task 7 repeated the matrix on the final HUD-fixed 0.5.0 bytes. All eleven commands passed on their first unchanged attempt: unit suite (645/645), Home, touch, modern inventory, inventory layout, WebView startup/layout/runtime errors, configurations (24 ordinary map/mode combinations in solo and with two browser peers), multiplayer, loot, loot-touch and legacy inventory. Modern and legacy zombie playthroughs and all 24 zombie layouts also passed again. The final matrix used frozen `hud-fixed-dist`, byte-identical to canonical `dist`; the four asset hashes were rechecked afterwards. Earlier candidates are preserved separately. No running test saw its assets replaced.

## Android and release gates

The prior BYD APK remains preserved at `artifacts/block-ops-v0.4.1-byd-test.apk` (SHA-256 `7b79121da4e9bbfed3cd39a9e0f04c49063b4e751643e0a35dc8252eb28dc013`). The updated package test rejects its old version while its signature and matching old bundled assets pass.

Final bundle: `artifacts/zombies-review/dist`. APK: `artifacts/block-ops-v0.5.0-zombies.apk`, package `au.local.blockops`, versionCode 6, minimum SDK 26, target SDK 36, INTERNET permission only. It is debug-signed, as were the earlier test APKs.

Task-owned emulator: `BlockOpsZombiesTask`, serial `emulator-5582`, registry under `artifacts/zombies-review/avds`. Existing AVDs are not modified. Native testing uses raw CDP and genuine Android Back/background events without visibility or game-state overrides.

Rollback snapshot: `artifacts/release-v0.4.2-c8bcaa3-z41jAt`. Existing tunnel stays in place; release replacement requires rooms=0 and exact process checks.

## Limitations

Browser capability masks and an Android emulator do not establish rendering or frame rate on the physical BYD. Install and test while parked. The public trycloudflare address is temporary and depends on this computer and tunnel remaining online.

## Final evidence

Final product/test source commit: `9872b34fba9a03c96250c41b99a218b6d99f78c4`. One fresh independent whole-change review found two Important issues, no Critical or Minor findings. A production regression reproduced smoke/projectiles surviving recovery; cleanup now removes combat transients while preserving loot presentation and equipment. The native test's release-footer selector was also corrected after reproducing its failure against shipped HTML. Both were red→green, with 644/644 tests at that stage. No review findings remain deferred.

The subsequent acceptance run exposed another real issue: main's recovery HUD overwrote EquipmentUI's existing Fire disabled state. Passive diagnostic #2 captured Throw at simulation8.3998, Fire at8.6498 during suppression while the UI was wrongly enabled, unchanged ammo8, falling health, then death at28.5649. Death changed ammo to0 and correctly cleared loot, advancing the test's ammo wait before the missing-knife check. This was not a gun-switch inventory deletion. The old browser baseline passed unchanged. The corrected HUD only adds recovery suppression; it cannot undo death/cooldown suppression. A production-callback regression is red→green and the full suite passes645/645. Browser/native checks are repeated on rebuilt bytes; original inventory actions/assertions stay unchanged.

Final APK build and package tests pass (3/3): `26b85a9872a618ad3c49be59c076a33744c97bb27c66047804cbdf6129b7d741`. Its signing certificate matches the old BYD APK: `6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49`. Upgrade installation on the owned emulator passed without uninstalling the older build. The superseded pre-HUD-fix APK is preserved separately in `artifacts/zombies-review/pre-hud-fix.apk`; it is not the deliverable.

Existing native offline smoke passes: Home persistence and preview, real gun/grenade/knife pickups and equipment actions, all ordinary modes, Home cancellation/confirmation, 500 rounds, landscape and real Back/background pause. New zombie native smoke also passes: packaged rendering, real movement/pickup/numbered inventory/fire, wave HUD, Back/background pause, death, replay and Home. No external requests or WebSockets occurred.

The first new native run reached death/replay but raced the final Home-confirmation tap while its button was still hidden. The test now waits for the actual `confirm-home` state before computing the tap coordinates; the complete unchanged gameplay assertions then pass. This is test synchronization, not a product timing workaround. Test-only follow-up commit: `2623218`.

Immutable live snapshot: `artifacts/release-v0.5.0-9872b34-Xr1Fr1`, including the final HUD guard fix. Ephemeral port-0 health, exact asset bytes and no-store checks passed. The release switch verified the old public bytes and exact old Node process, required rooms=0, and replaced only that server. New Node PID at deployment: `1235613`. The existing Cloudflare process `859138` was left running. Local and public health, no-store headers and all four exact asset bytes passed after replacement. Rollback remains `artifacts/release-v0.4.2-c8bcaa3-z41jAt`; it was not deleted or overwritten.

Public Playwright CLI acceptance passed against the live URL: actual zombie round, movement, frag pickup/numbered inventory, gun firing, pause/resume, death/results, replay and confirmed Home. Its three document/game/CSS requests returned 200, with no page exceptions or failed game assets. Console messages were only two optional favicon 404s. Public screenshots `public-home.png`, `public-zombies.png` and `public-results.png` are under `artifacts/zombies-review`; gameplay and results were visually inspected. The owned `zombies-review` browser session was closed after capture.

Hosted multiplayer passed with two real browser clients: settings/skins, movement/fire/ammo, team/flag HUD, host transfer, Home, authoritative lifecycle and remote-start suspension. Native online smoke passed against the same public TLS server using the packaged APK and an independent peer: FFA, TDM and CTF, real pickups/throw/knife, shared authoritative state, distinct skins/teams, flags, input, Home, background/Back handling and incompatible-client rejection. Native CTF gameplay was also visually inspected. Both commands exited 0 and cleaned only their owned peers/rooms.

Final read-only audit at `2026-10-04T10:52:21.527Z` verified local and public health (`rooms:0`), final asset bytes, `no-store`, release footer and APK hash. The task-owned emulator was identity-checked and stopped; its AVD files are preserved and no adb forwards remained. No other preview, emulator or tunnel was stopped. The current branch `feat/offline-arena` and checkout are retained as approved; nothing was pushed or merged.

| Asset | SHA-256 |
| --- | --- |
| index.html | `02c2935c6bf876d85f976401e16db1f7ff2d076534e5f045e053fe1e2a014085` |
| game.js | `b0e0beb1c2e46e4a624ba06227652a13ca0cfc909d8427aad959980dc1e9c574` |
| styles.css | `dc611db13ee3e5294dd339e9952a31b65dc7461358d4f6e96f233041466360c1` |
| THREE-LICENSE.txt | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |

## Commands and evidence

Commands ran from the repository root. Browser commands used `DIST_DIR=artifacts/zombies-review/hud-fixed-dist` (identical final bytes); the final bundle and package checks used `artifacts/zombies-review/dist`.

```sh
BUILD_DIR=artifacts/zombies-review/dist npm run build
npm test
npm run test:home
npm run test:touch
npm run test:inventory
node tests/inventory-layout.browser.mjs
npm run test:webview
npm run test:configurations
npm run test:multiplayer
npm run test:loot
npm run test:loot:touch
LEGACY_WEBVIEW=1 npm run test:inventory
node tests/zombies.browser.mjs
LEGACY_WEBVIEW=1 node tests/zombies.browser.mjs
node tests/zombies-layout.browser.mjs
DIST_DIR=artifacts/zombies-review/dist APK_OUTPUT_PATH=artifacts/block-ops-v0.5.0-zombies.apk bash scripts/build-apk.sh
DIST_DIR=artifacts/zombies-review/dist ANDROID_APK_PATH=artifacts/block-ops-v0.5.0-zombies.apk node android/tests/package-smoke.mjs
TEST_GAME_URL=https://emerald-arctic-thanks-settings.trycloudflare.com npm run test:multiplayer
```

Native commands were `node android/tests/emulator-smoke.mjs`, `node android/tests/zombies-smoke.mjs` and `node android/tests/emulator-online-smoke.mjs`, each with explicit `ANDROID_TEST_SERIAL=emulator-5582`, `ANDROID_TEST_AVD=BlockOpsZombiesTask` and `ANDROID_TEST_ARTIFACTS=artifacts/zombies-review/android`. They validate AVD identity before changing networking or installing/running the app. The certificate comparison and upgrade install are captured separately.

Execution evidence is archived at `artifacts/zombies-review/execution-evidence` after completion, preserving the ledger, red/green regressions and review package. Important final logs:

- `task-7-hud-regression-*.log`: eleven-command final existing-feature matrix.
- `task-7-hud-zombies-modern.log`, `task-7-hud-zombies-legacy.log`, `task-7-hud-zombies-layout.log`: actual survival playthroughs and layout checks.
- `task-7-fire-lock-{red,green,suite}.log`: production Fire guard regression and 645-test suite.
- `task-7-hud-apk-build.log`, `task-7-hud-package-final.log`, `task-7-hud-cert-install.log`: APK build, exact bundle/metadata/signature and upgrade installation.
- `task-7-hud-native-ordinary.log`, `task-7-hud-native-zombies.log`, `task-7-native-online.log`: native acceptance.
- `task-7-snapshot-hud.log`, `task-7-deploy.log`: staged validation and targeted public replacement.
- `task-7-final-release-audit.log`: final local/public health, bytes, headers, version and APK identity.
- `task-7-public-multiplayer.log`, `task-7-cli-public{,-console,-requests}.log`: hosted two-client and actual CLI play evidence.

Native screenshots are in `artifacts/zombies-review/android`. Local CLI evidence is in `artifacts/zombies-review/cli`. Public screenshots are directly in `artifacts/zombies-review`. The previous release, prior APKs and unrelated user changes are preserved. No remote push, merge or PR is part of this release.
