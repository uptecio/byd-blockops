# XP and cosmetics 0.7.0 release verification

Status: **publicly deployed and verified** on 2026-10-07, after fresh user approval and a second empty-room confirmation. [Play Block Ops](https://myth-referring-tablets-venture.trycloudflare.com). Browser/server are 0.7.0 / protocol 5, using the exact verified APK asset bytes. Physical BYD rendering, responsiveness and restart behaviour remain a parked-device acceptance check.

## What this update adds

Play earns immediately saved XP in solo FFA, Team Deathmatch, Capture the Flag, Zombies and online matches. Levels automatically unlock eight additional characters and eight global gun finishes. Original skins and all guns remain free; cosmetics do not change combat. Live appearance choices apply next respawn, or next run in Zombies, and are saved immediately as the desired appearance.

Progress is local to the device and browser origin, without accounts or cloud synchronisation. Confirmed saves survive normal close, force-stop and same-signed update-install. Uninstalling, clearing app/browser data or changing a browser's temporary tunnel hostname can lose access to the old local save. The APK keeps its stable packaged HTTPS origin when the online server changes. Storage failures or protected newer saves produce visible warnings rather than false save confirmation.

## Candidate identity

- Implementation and acceptance-test commit: `c0a753854dc926f1ad888fce8a85024e218e820c`, based on approved-plan commit `3e7c67c`.
- Subsequent test-only fixture correction: `73c4c4b`, explicitly selecting M4A1 in the native supply test. Its separate archive/extraction is retained as `native-fixture-fix.tar` / `fixture-source-VQpowO` within the frozen snapshot. Product and APK bytes are unchanged.
- Native online fixture correction: `81ddbe827ff6c51651d0da18f55855d8eebec608`, using the existing native smoke's bounded-key movement controller and capturing failure packets/screenshots. Archive/extraction: `native-online-fixture-fix.tar` / `online-fixture-ct4CoF`; archive SHA-256 `f15a0c39ae56029ac64468e2b9c0402d02aeaccddac9d9a6ac5983b9bf34e353`. These two follow-up commits change tests only.
- Frozen source and assets: `artifacts/xp-cosmetics-x2pHsi/frozen-sppocv`. Its source archive SHA-256 is `6b20f6dac4c09a7ad40456995e173759d56a0a1d565c5a05dedea02fc4285cae`.
- APK: [block-ops-v0.7.0-xp-cosmetics.apk](../../artifacts/block-ops-v0.7.0-xp-cosmetics.apk).
- APK SHA-256: `faa2f4f2cf0252b9f9f135344c748664572c16de0c1ebfe841a679b9e6e152ed`.
- Signing certificate SHA-256: `6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49`, unchanged from 0.6.0.
- Package `au.local.blockops`, version 0.7.0 / code 9, minSdk 26, targetSdk 36, INTERNET permission only. The ES2017 target and WebGL1 fallback remain.
- Bundled default server: `https://myth-referring-tablets-venture.trycloudflare.com`, unchanged during publication and now serving protocol 5. Install the 0.7.0 APK for online play; the old protocol-4 APK cannot join the new server.

| Bundled asset | SHA-256 |
| --- | --- |
| index.html | `93943a5d0c7d7ff4d224c3d2efec8cbda4655c04e52e1ba51138f5753d772ab4` |
| game.js | `1bd2d7d0241a5dcd241cf957e1da4fda400dd682b93f55a6128665e890573636` |
| styles.css | `7bc40a68594d8c64c93f4ee24207bf0774417fb1f73fcc9c045ed45caf9ef485` |
| THREE-LICENSE.txt | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |

The canonical APK and preliminary Android-tested APK are byte-identical. Package tests passed version, signer and exact bundled-asset equality, including against the independently built frozen source.

## Genuine earning and save evidence

Task 7 acceptance and its final full unit suite passed: **826/826** tests, no skips. Evidence is under `artifacts/xp-cosmetics-x2pHsi`; `execution-evidence.tar.gz` preserves the execution logs, final-review record and pre-publication ledger. After Task 8 completion, the final execution workspace is archived recoverably at `artifacts/xp-cosmetics-live-dEhwLP/final-execution-workspace`, rather than deleting its logs.

Execution-evidence archive SHA-256: `51217994fd3a5175604c97f47e55d788ca167a37e3ec65c854197eac89e1c378`. Final process inspection found no remaining owned test browsers, scripts or emulator processes.

- Modern and legacy browser runs each earned 140 XP, left early, earned another 10 XP, selected Crimson Ninja, completely closed the persistent browser context and reopened it at the same origin. A subsequent natural FFA win earned exactly 225 more XP, for 375 total. Crimson Red and the character choice survived a second complete restart.
- Real solo Team Deathmatch and flag-capture actions awarded the expected XP. A different website origin in the same browser started separately; returning to the original origin retained its earned profile.
- Modern and legacy real-play tests retained temporary action XP with a denied storage getter, corrupt save, future schema and quota failure. Protected records remained untouched; permitting writes and returning Home saved the quota-blocked profile exactly once.
- Zombies' actual two-wave playthrough verified two XP per kill, 25 per completed wave and one 50-XP natural game-over bonus.
- Two independent browser peers earned 450 XP over two natural CTF wins. The idle player inherited neither actions nor finish bonuses. Tests verified round identity, duplicate-safe result reopening, current versus pending appearance, actual avatar and weapon palettes, respawn, new participation on rejoin and an owned-server restart.
- Android earned 355 new XP in a complete passing run: a 225-XP natural win plus 130 action XP retained after early exit. The test preserved its earlier genuinely earned 120 XP, reaching 475. Crimson Ninja and Crimson Red survived force-stop/relaunch, actual Android background/foreground and same-signed `install -r`. No data was cleared or uninstalled.
- A separate Android/browser-peer TLS test earned another genuine 10 XP, checked both rendered peer palettes, saved pending appearance while the online menu remained open, observed the real respawn applying it, and retained the profile after force-stop.
- The frozen-source Android replay also passed the full earning/save gate, starting with genuine 485 XP and reaching 840; this is an additional run, not synthetic profile seeding.
- The final frozen native online fixture passed again with real earning from 860→870 XP, applying pending cosmetics during a menu-open respawn and retaining the exact record after force-stop. Intermediate diagnostic/corrected runs earned the preceding 20 XP; no save was seeded or reset.

The original versionCode-8 image had no zombie best. The harness earned one real zombie kill on actual 0.6.0, recorded its legacy settings/best, installed code 9 without clearing data, and passed exact migration assertions with initial XP zero. That attempt later failed because a mistakenly overlapping diagnostic harness stopped the app. Its failure log and before-upgrade record are retained. Subsequent complete Android earning/save runs explicitly resumed code 9; they are not represented as XP existing in version 8. The native replacement test is accurately code 9→9 using the same signing identity.

Synthetic max-XP profiles were used only for separate layout/catalogue tests. Those covered all 16 skins, nine finishes, large totals, warnings, previews and touch-control hit testing at 854×480, 1200×700 and 1280×720, scales 1 and 1.3, in modern and legacy modes. Actual unlock/restart gates used real keyboard, mouse or adb controls, not injected XP or actor state.

## Final regression and review

The complete frozen-source browser/native regression matrix passed, including the standalone checks. Raw matrix logs are in `artifacts/xp-cosmetics-x2pHsi/frozen-sppocv/logs`; fixed-path older browser screenshots are isolated inside that snapshot's `source/artifacts`.

- Unit tests: `npm test`, **826/826**, both frozen-source and fresh-root reruns, zero skips.
- Browser package scripts: `test:browser`, `test:home`, `test:touch`, `test:configurations`, `test:multiplayer`, `test:loot`, `test:loot:touch`, `test:webview`, `test:inventory`, `test:zombies`, `test:supplies`, `test:progression`, `test:progression:modes`, `test:progression:online` — all passed.
- Additional legacy runs: `configurations`, `inventory`, `zombies`, `supplies`, `progression`, `progression-modes` browser scripts — all passed. Configuration runs cover 24 map/mode combinations each with solo and two real browser peers, in both modern and legacy modes.
- Standalone `carried-flag.browser.mjs`, `inventory-layout.browser.mjs` and `native-online-cleanup.browser.mjs` — all passed, covering actual CTF smoke/flash concealment, inventory layouts and observable renderer departure with confirmation both open and closed.
- Native scripts: `package-smoke` **3/3**; `progression-smoke`, `emulator-smoke`, `zombies-smoke`, corrected `supplies-smoke`, `emulator-online-smoke` and corrected/frozen `progression-online-smoke` — all passed. Native online covers real TLS, FFA/TDM/CTF, supplies, appearance, lifecycle and owned-room cleanup.
- Full earning/save gates used the actual game and normal controls. Browser and native helpers asserted no runtime exceptions. Separate layout checks covered modern/legacy paths, three screen sizes and both control scales; representative browser and real adb screenshots were inspected.

The single independent whole-feature review checked `3e7c67c..c0a7538`, the supplied evidence, all five requested failure-mode focus areas and the additional test-only fixture correction. Its own focused tests passed **91/91** and its diff check passed. It found no Critical or Important issue, and one deferred Minor: after an initially denied storage getter becomes available, a restored appearance updates the saved preference and selected controls but not the existing previews or pending runtime/server appearance. Reselecting the look or starting a new round refreshes it; XP and the saved preference remain intact. The review permits readiness only after the complete regression gate, not public deployment. No second reviewer or review-driven product change was used.

Failures retained during verification:

- The new screenshot controller initially confused coral roofs with enemy health bars; its colour detector was narrowed to the actual unlit bar colour. Close-range search firing now uses normal controls even when an enemy's bar is above the viewport.
- Android CDP screenshots omitted the hardware-composited WebGL layer. Side-by-side adb capture proved actual rendering was present; the native harness now captures the real display. Aim uses timed adb swipes, avoiding documented WebView coalescing of compressed CDP mouse gestures.
- The denied-storage browser test also denied its saved one-bot difficulty/loadout. Reapplying the setup through the real UI after reload retained the exact XP assertions.
- The configuration matrix's old saved-selection expectation omitted the new Standard finish; the complete 24-case modern matrix passed after including that field.
- The first frozen unit run lacked a `source/dist` path for an older default-path network fixture. Linking it to the exact frozen dist fixed the setup; the subsequent full suite passed 826/826 without source/assertion changes.
- The older native supplies smoke assumed a fresh default M4A1, despite the intentionally retained AWP loadout. Its setup now explicitly selects M4A1 through Armory while retaining all supply/inventory assertions; the corrected full native test passed.
- One frozen native-online setup attempt crossed the walking target but failed to settle after the browser helper's four corrections. A diagnostic rerun passed unchanged gameplay, earning 840→850 XP. The new native test now uses the existing native online smoke's bounded 300-ms key pulses and 650-ms neutral settling, with a stricter 0.6-unit tolerance; its complete run passed 850→860 XP. Delayed-feedback overshoot is the supported diagnosis, although exact latency was not measured in the failed attempt. Failure packets/screenshots are now captured if it recurs. No game, server or APK change was needed.

No failed run is counted as a complete pass. Failure logs remain alongside successful replacements.

## Owned test resources and release boundary

The disposable Android 36 AVD is `BlockOpsXPTask`, serial `emulator-5584`, with all writable disks inside `artifacts/xp-cosmetics-x2pHsi/avds`. It was copied from a stopped historical test AVD and its absolute disk paths were repointed before boot. No physical car/device or personal AVD was targeted. New native helpers use dynamically allocated CDP forwards; older native tests use port 9228 sequentially.

Owned TLS staging used Node port 39523 and `https://glasgow-desirable-walt-bomb.trycloudflare.com`, separate from the public game. After all native checks, fresh command/cwd/DIST_DIR and zero-room checks verified Node PID 571139 and tunnel PID 571255 before graceful termination. The owned AVD name, registry/disk paths and PID 567694/port 5584 were rechecked before `adb emu kill`. All three processes exited; the adb device and forward lists were empty. Disks, saves and evidence were retained. These historical identifiers are not authority for future signalling. Cleanup evidence: `frozen-sppocv/logs/owned-cleanup.log` and execution ledger.

During candidate verification, public tunnel PID 21648 and old Node PID 22931 were left untouched. A read-only HTTPS check returned healthy/zero rooms and the then-current 0.6.0 footer; that observation was not reused as empty-room permission. An independently owned ephemeral server returned each exact frozen asset with `Cache-Control: no-store` and was closed afterward (`logs/served-assets.log`).

Publication used fresh approval, rediscovered identity and an immediately rechecked empty-room window, as recorded below. Any future deployment or rollback must repeat identity and room checks; historical PIDs are not authority to signal a process. If a future tunnel URL changes, rebuild and retest changed bytes under a distinct verified identity. Previous APKs remain available; no push, merge or branch deletion is part of this work.

## Approved public deployment

- Evidence root: `artifacts/xp-cosmetics-live-dEhwLP`. `release-source` is extracted from the frozen source archive plus byte-identical frozen assets; `rollback-source` is an exact copy of the actual 0.6.0 live source/assets. Both retain their dependency link. Old APKs are untouched.
- At 2026-10-07 10:25:05 UTC, `cutover.mjs` verified old PID 22931's exact executable, cwd, serving environment, local/public assets and zero rooms immediately before SIGTERM. It kept tunnel PID 21648 and the same public hostname. Replacement detached Node PID 620214 serves `release-source` on `127.0.0.1:4185`; live readiness/asset verification passed at 10:25:06 UTC. The cutover includes automatic rollback if its asset gate fails; it was not needed.
- `live-browser-corrected.log`: two real public browser clients completed protocol-5 handshakes, two natural CTF wins (host 450 XP, idle guest zero), real elimination (guest 10 XP), pending/respawn cosmetic transitions, actual Crimson Ninja/Crimson Red palettes, rejoin, exact profile retention on reload, and saved-server reconnect. The test never restarted the public server. `browser/evidence.json` and screenshots record the result.
- `live-native-corrected.log`: actual APK SHA-256 on the emulator matched the canonical download. The retained saved-server setting took precedence as intended; reloading the owned default-address fixture selected the current bundled URL without filling it. Actual public TLS play earned 870→880 XP, replicated both peer models, applied pending skin/finish during a menu-open respawn, saved the public server and retained the exact XP/look after force-stop. `native-corrected/native-online-evidence.json` records the result. No progression data was reset or seeded.
- `delivery-final.log` / `delivery-manifest.json`: all four local/public HTTP assets exactly match the frozen candidate and APK; `Cache-Control: no-store`, version, protocol evidence, bundled URL, signer and package checks pass. Package **3/3** and fresh full unit **826/826** passed. No URL change or APK rebuild was needed.
- Failed publication-test attempts remain retained. The first browser cleanup used the gameplay Home selector while Armory was open; the corrected one-off fixture uses each screen's actual Home/Leave button. The first native default fixture immediately force-stopped after manually removing its saved-server property, and the old persisted override returned. Diagnosis proved the installed APK hash correct and a normal page reload selected the current default; the corrected setup reloads and waits for the JavaScript UI, then retains the separate real-play force-stop assertion. An attempted diagnostic fetch of a packaged asset was rejected; on-device APK hashing supplied that evidence instead. No product code or assertions were weakened.
- All test rooms were left, health returned `{ok:true, rooms:0}`, and owned native forwards were removed. Emulator PID 620592 / serial 5584 / `BlockOpsXPTask` was revalidated and stopped; its disks/saves remain. Public Node 620214 and tunnel 21648 remain running. `cleanup.log` records the boundary.

For rollback, first obtain a fresh maintenance window, rediscover and verify the live Node's exact identity, and check rooms. Stop only that verified Node and launch `rollback-source/server/server.mjs` with `HOST=127.0.0.1`, `PORT=4185` and `DIST_DIR` pointing to `rollback-source/dist`; leave the tunnel running. Verify public/local bytes against rollback assets and restore use of the retained 0.6.0 APK. Do not clear any browser/app saves; the older release does not understand the new XP profile.

Reload the browser tab to obtain 0.7.0. If an older installation has a saved **different/expired** server hostname, Online Friends → Server settings must be changed to the current public URL; an app update intentionally does not overwrite that preference. This is a temporary tunnel requiring the host computer and tunnel process to stay running, not permanent hosting.

For local browser testing of the candidate, run this from the repository root, then open the local address printed by the server:

```sh
PORT=0 HOST=127.0.0.1 DIST_DIR=artifacts/xp-cosmetics-x2pHsi/frozen-sppocv/dist node artifacts/xp-cosmetics-x2pHsi/frozen-sppocv/source/server/server.mjs
```

Online testing requires a protocol-5 server; the APK's Online Friends → Server settings can point to an explicitly selected test origin. The temporary TLS staging above has been stopped. Install the APK over the existing same-signed app without uninstalling or clearing data. Real BYD acceptance should be performed while parked: earn XP, choose an unlocked look, close/reopen, then repeat after the car's normal power cycle.

## Executor decisions

1. Keep the existing checkout, as explicitly selected by the user. Cost if wrong: shared-worktree changes could overlap, so unrelated files are preserved and staging is scoped.
2. Add the small `progression-controller.js` lifecycle adapter for testable reconciliation without importing side-effectful `main.js`. Cost if wrong: one extra small module; UI still cannot award XP.
3. Use the repository's `ANDROID_TEST_SERIAL`, `ANDROID_TEST_AVD` and `ANDROID_TEST_ARTIFACTS` conventions. Cost if wrong: callers must use those existing environment names rather than the plan's abbreviated example.
4. Run the one final read-only whole-feature review alongside the independent frozen regression matrix. Readiness requires both gates; material findings require affected rebuild/retest. Cost if wrong: additional verification cycles, never publication on partial results.
5. Concurrent tabs writing one profile remain unsupported. Cost if wrong: simultaneous writers can overwrite progress.
6. Modified clients may edit local XP or request known locked cosmetics; retain the account-free ownership boundary. Cost if wrong: this is not a secure competitive economy.
7. Official clients close/reconnect on leaving, creating fresh participation. Custom same-socket manual leave/rejoin is outside supported UI behaviour. Cost if wrong: custom clients can reuse receipt identities and receive less XP.
8. Keep only server awards actually received and confirmed locally. Cost if wrong: an abrupt disconnect can lose undelivered final actions.
9. Uninstalling, clearing storage and hardware failure remain outside the local-save promise. Cost if wrong: progress can be lost without cloud/export recovery.
10. Require a parked physical-BYD acceptance test. Cost if wrong: emulator checks may miss car-specific rendering, performance or power-cycle issues.
11. Archive the completed execution workspace recoverably rather than erase its logs. Cost if wrong: a small amount of extra disk usage; source checkout and live release are unaffected.

Deferred Minor: the temporary recovered-appearance mismatch described in the review section. No Critical/Important review findings were left unfixed.
