# Solo secret powers verification

Candidate: Block Ops **0.9.1**, Android version code **12**, network protocol **7**. Modern/legacy browser powers suites, exact APK packaging, Android emulator acceptance, segmented rooftop follow-up and the final full unit suite pass. Independent whole-change review found no actionable issues. This is not a physical-BYD compatibility claim or a live deployment.

## Feature and access

Five taps on the Home logo or the solo Pause logo within three seconds open a locally saved PIN gate. First use asks for a chosen 4–8 digit PIN and confirmation; there is no preset PIN. The controls independently enable invincibility, unlimited gun ammo without reload, and horizontal speed from 2× to 5×. Pause Apply and Cancel remain paused.

Powers are solo-only, memory-only and reset when a round ends, the player confirms departure, enters online, or restarts the app. Ordinary XP, cosmetics and Zombie records still save. The PIN is local to the APK installation or browser origin, not synced between them. No PIN or power fields are added to multiplayer packets.

## Verified checks

| Check | Result and evidence |
| --- | --- |
| Full unit suite | Final committed-candidate gate: 1,301 passed, 0 failed/skipped; `final-suite.log`, 137,703 ms. Task6 gate also passed1,301 in135,339 ms (`task-6-tests.log`); earlier full run passed1,301 in150,401 ms (`task-6-unit-full-second.log`). |
| Independent whole-change review | No Critical, Important or Minor findings, and no declined-to-judge items. Fresh reviewer checks: 181/181 focused tests, clean `git diff --check`, all247 source/test hashes matched. All five specified review-focus classes assessed. |
| Home/Pause browser integration | Real held fire, cancellation, explicit Resume, native-pause callback, fatal callback, failed join, a genuine 15-kill round, earned skin, and persistent-browser reopening passed. |
| Capability failures | Missing crypto, throwing crypto getter and throwing storage getter leave the secret gate locked while ordinary Solo starts. |
| Touch layouts | All eight viewport/scale cases passed in modern and capability-masked legacy Chromium: 1280×720, 1024×600, 854×480 and keyboard-reduced 854×300; scales 0.8 and 1.3. Five actual taps, focus containment/wrapping, 44px targets, scrolling and touch slider tested. |
| Arena coverage | All eight maps with powers enabled/disabled, covering all four solo modes. Real firing, measured 2×/5× movement, outer and low walls, stairs/roof edge and Harbor ladder passed. |
| Zombie rewards | A real first-wave clear earned 35 XP and the ordinary `{waves:1,kills:5}` Neon City record; early quit retained them without a finish bonus. |
| Online isolation | Two independent clients passed normal ammo consumption, body damage and movement, genuine CTF rematch, departure/rejoin, absent online secret access and subsequent Solo reset. Sent/received packet keys contained no credentials or powers. |
| Package selector regression | Unknown/conflicting release selectors rejected; the retained code11 APK is rejected as the solo-powers candidate. |
| Historical packaging checks | Both retained releases remain valid with their own selectors: code10 and code11 each passed 3/3 metadata, signer and exact-asset checks. |
| Candidate packaging | Offline Gradle assemble and lint passed. Explicit solo-powers package validation passed 3/3: code12/name0.9.1, existing signer, exact four frozen asset bytes, package/minSdk/targetSdk, INTERNET-only permission and no ABI restriction. |
| Existing browser regressions | Touch, WebView startup/layout/errors, inventory, Zombies, supplies, progression, progression modes, online progression, teammate-map and online-rooftop scripts passed against frozen assets. Solo roofs passed as segmented coverage, not a clean monolithic batch; see below. |
| Native Android | Full scenario passed on the third fresh owned AVD: signed upgrade retention, offline PIN/PBKDF2, all powers, native Back/background/explicit Resume, real assisted XP/records, relaunch and same-version replacement. |

Initial evidence is under `artifacts/solo-powers-vs7OYB/`: `browser-fourth`, `task6-first/layout`, `task6-layout-legacy/layout`, `task6-arena-first/arena`, and `task6-online-first/online`. Final frozen-asset checks are recorded separately under `final-browser`; initial runs are not substituted for final acceptance.

Task logs, final suite output, baseline and tested-working-tree diffs, the execution ledger and the independent review report are archived under `artifacts/solo-powers-vs7OYB/execution-evidence/`. This preserves the evidence while removing only this plan's active scratch workspace. The reviewed implementation range is `08b0a4394488f0e3092f25be4e5dc6e33662cf23..a861db6072493c329ee879647ee81d2a0e213daa`, supplemented by the retained dirty working-tree changes. `reviewed-working-tree.json` records all247 actual source/test files, not just committed files. Only verification documentation changed after the review; no runtime source, frozen asset or APK changed.

The reviewer explicitly assessed delayed crypto/lifecycle cancellation, storage and crypto failures, ammo invariants, collision-constrained movement, and persistence/online isolation. No fix pass or deferred minors were required. The reviewer agreed that physical-BYD testing, the interrupted monolithic rooftop batch and the limited performance workload remain evidence boundaries, not demonstrated feature defects. Review approval does not authorize a merge or deployment.

The final modern run completed all three powers scripts successfully in 806,688 ms (`final-browser/powers-modern.log`); legacy completed in 831,238 ms (`final-browser/powers-legacy.log`). Complete map/movement/Zombie evidence and raw frame rows are in each run's `arena/evidence.json`. Three warmed 30-second normal/5× pairs on each map gave median paired p95 ratios **1.021 for Courtyard / 0.989 for Harbor (modern)** and **1.016 / 1.006 (legacy)**, below the planned 1.25 investigation threshold. Median frame intervals were 16.6–16.8 ms. One legacy Harbor 5× trial had a 69 ms p95 versus its paired 18 ms baseline; the other two pairs were 17.8/17.8 and 17.8/17.9 ms. The raw outlier is retained, not discarded. These measurements describe this software-rendered desktop runner, not a vehicle head unit.

Performance conditions: 1024×600, one Easy bot, AWP, identical invincibility/ammo settings in both samples, with only the horizontal speed switch changed. Each fresh round first walks north to the outer wall to warm the movement/collision/render path, then holds forward for the 30-second sample. Pair order alternates. These are matched collision-path measurements, not a claim about every map viewpoint or workload.

The first full unit attempt ended with signal 143 before completion and reported two old release-label assertions. A focused reproduction showed both expected 0.9.0 after the approved 0.9.1 metadata change. The label assertion was updated without changing build/preview/isolation assertions; the subsequent complete run passed all 1,301 tests.

The initial full rooftop regression passed 15 destinations, then stopped on Dust Town north-east descent after the automated player landed on a stair and was killed (health 100→50→0 at unchanged support/position/life). Bot knife attacks are the likely cause, inferred from damage/timing and the adjacent bot screenshot; attack events were not captured. Movement/collision/map/bot/combat source and the route test match the execution baseline exactly. The same alive-assertion failure exists in retained 0.9.0 evidence. This failure remains under `final-regressions/tall-roofs`; the initial runner's exit1 is not relabelled as a pass.

The focused north-east route subsequently passed on retained0.9.0 and the candidate. All47 remaining candidate destinations then passed in isolated serial processes, on the first attempt, using the unchanged test and real controls. The union with the15 initial completed routes was checked against the exact62 authored IDs. All6 ladder layout cases also passed (854×480,1200×700,1280×720 at scales1/1.3), including hold, aim, simultaneous climb/Fire, reload, cancellation and Jump. `artifacts/solo-powers-vs7OYB/roof-followup/results.json` records every run and the exact coverage union. This is complete segmented route coverage; it does not prove a single uninterrupted62-route browser session.

Native test debugging did not change production code or APK bytes. The initial movement sampler included idle native command latency and reported 20.48 m/s; sampling two position/simulation-time endpoints while KeyW stayed held gave the intended 26.5 m/s, using the unchanged 23.5–28 bound. A second run passed upgrade/PIN/movement/wall checks but tried to leave before verifying Resume. A passive lifecycle probe confirmed actual Resume interaction; the test now waits for foreground focus and playing mode. The complete third run passed. Earlier AVD data was retained, not cleared or downgraded.

## Frozen browser assets

Build command: `GAME_SERVER_URL="" BUILD_DIR=/home/alex/Documents/git/bydgame/artifacts/solo-powers-vs7OYB/reviewed-dist npm run build`.

| Asset | SHA-256 |
| --- | --- |
| `index.html` | `bc92e571ed19e223fe29ae6f37b81995039690f50a7d94ca9fe832a89625ab13` |
| `game.js` | `11fbf2f0b8a183910e82bd9cb9cf1a081e9b7a752efc98a9d70ca312da89c5bd` |
| `styles.css` | `fa499396fe9051866c66b5b8985b4ce96fe100a4414443958ee10092a6763a5d` |
| `THREE-LICENSE.txt` | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |

The frozen build includes the existing uncommitted teammate-map work. Those unrelated changes remain separate from the feature commits. Packaging must use these same four asset bytes without rebuilding them.

## APK candidate

`artifacts/solo-powers-vs7OYB/block-ops-v0.9.1-solo-powers.apk`

SHA-256: `54f5db19c936353e74e1255c843d5526c43b9948738a2ed792ac0a234ab35eb2`.

The explicit source allowlist and per-file hashes are in `artifacts/solo-powers-vs7OYB/source-manifest.json`; the owned packaging checkout is `package-source-8d2rE7` in that directory. Build: `DIST_DIR=<reviewed-dist> APK_OUTPUT_PATH=<candidate> bash scripts/build-apk.sh --offline lintDebug`. The snapshot includes existing teammate-map source and native helper improvements, but not credentials, generated build directories or caches. It packages the frozen assets without rebuilding them. Existing debug signing certificate SHA-256: `6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49`.

## Native acceptance

Evidence: `artifacts/solo-powers-vs7OYB/final-native-third/native-powers-evidence.json`, `retained-after-replacement.png`, and `task-7-native-third.log` (exit0).

Environment: owned `SoloPowersgnj2GU`, serial `emulator-5592`, Android16/API36, WebView133.0.6943.137, software-rendered emulator, 1280×720 at160dpi. Wi-Fi and mobile data were disabled. The fixture validated the exact AVD name before changing anything; all three owned emulators were stopped afterward and their data retained.

The baseline earned10XP through gameplay and saved Shadow Ninja, AWP and control scale1.3. The signed code11→12 upgrade retained exact values of all five relevant save keys before new actions. PIN setup changed only its dedicated key. Real 5× movement measured26.5m/s and stopped at the expected north boundary z=-21.66. A real Zombie hit reduced health100→90; enabling invincibility kept health90 without healing through continued contact/combat. A genuine15-kill match added225XP, and a first Zombie wave added35XP and the ordinary Neon City record `{waves:1,kills:5}`. Final270XP, equipped Crimson Ninja, PIN and all saved bytes survived force-stop/relaunch and signed same-version `install -r`; the PIN still verified while all powers reset off.

The native test ran from the working checkout after two test-only measurement/synchronization corrections; the packaging snapshot predates those corrections. Game source, four bundled assets and APK bytes did not change. Tested `android/tests/solo-powers-smoke.mjs` SHA-256: `154eb635e24ffc7eff1988d4b577d43c001885afaf4db41f0114e40e2fa9458f`; preserved native helper SHA-256: `9237f8877c6656c212582ccfcbfe18c4215f976fde3692b4245f1d4391daeee6`.

## Compatibility boundary

Capability-masked Chromium and Android16's emulator are not the BYD browser engine/GPU. Physical head-unit Web Crypto/PBKDF2, touch interaction and 5× frame performance remain unverified. No player saves, old APKs or public game rooms were cleared, and no public server was restarted.

## Local preview

An isolated Solo preview is serving `reviewed-dist` at `http://localhost:35359`; all four HTTP responses were checked byte-for-byte against the frozen assets. It is localhost-only and does not replace the public multiplayer server. This new browser origin has separate local saves/PIN from previous URLs and the APK; no existing save was overwritten or migrated.
