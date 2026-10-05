# Health and armour 0.6.0 candidate verification

Status: **verified candidate; public deployment awaits a coordinated maintenance window**. The public browser remains 0.5.1. Physical BYD testing remains a user check, while parked.

## Scope

Two health and two armour pickups on each of eight maps, carried in the existing numbered top-left inventory. Each type stacks to three. Five simulation seconds restores health to 100 or adds 50 armour (maximum 100); cancelling or selecting a weapon retains the pack. Movement and looking continue, combat is blocked during use, and ordinary damage does not interrupt use. Armour absorbs damage first. Existing headshot, knife, grenade and uncapped zombie damage are unchanged.

Solo FFA/TDM/CTF, Zombies and online FFA/TDM/CTF are covered. Bots collect supplies incidentally along existing routes. Zombie recovery preserves unused health packs, and new lives/runs start without supplies or armour. Protocol 4 rejects incompatible older clients explicitly. No separate inventory screen, dependency, permission, skin or map redesign was added.

Minimap, aim assist, gun effects and XP/new cosmetics remain later upgrades; this is not completion of all six recommendations.

## Candidate identity

- Implementation base: `0591340f2c575a7bedb61aa78b8db8f1201f8744`.
- Tasks 1–6 source/test commit: `eb0c4d6ffce4880aed4d3140366692c4a1e2ec90`.
- Final product/test source: `17cda6f0231d7b99eb398a963a490eb3fb58aee3`; subsequent changes are documentation only. Only native/configuration test files changed after eb0c4d6; product bytes did not.
- Evidence root: `artifacts/health-armour-Jwzb4x`.
- Frozen browser bytes: `artifacts/health-armour-Jwzb4x/dist`.
- APK: `artifacts/health-armour-Jwzb4x/block-ops-v0.6.0-health-armour.apk`.
- Handoff copy: `artifacts/block-ops-v0.6.0-health-armour.apk`, created without overwriting any existing file and verified byte-identical by SHA-256.
- Accepted source/assets snapshot: `artifacts/health-armour-Jwzb4x/accepted-source-SXgiIj` (archive of 17cda6f, copied frozen assets, pinned installed dependencies linked). A fresh port-0 server passed health, no-store and four exact served-asset checks, then closed.
- Package `au.local.blockops`, version 0.6.0 / code 8, minSdk 26 / targetSdk 36, INTERNET permission only; debug signing retained.
- APK SHA-256: `5bdc9216f6b9af008ed276962a9884f026bd5ffc3e611be8349cc7f723f96e96`.
- Signing certificate SHA-256: `6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49`, matching retained 0.5.1.

| Asset | SHA-256 |
| --- | --- |
| index.html | `649cbd1087163803dd0964ed4573736e5f7b4fdac6e974cdd49e697c3fc54006` |
| game.js | `d18276d96a42a97d2d188e0a2b037603505107abdcdcf61fc4371246b346efdd` |
| styles.css | `bd3c951ab091fa101085f95e568b0ad156de7a84abbfa93a2052d1c5477ad63f` |
| THREE-LICENSE.txt | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |

## Completed acceptance before final review

Tasks 1–5 followed focused red/green tests; complete unit/integration counts grew from baseline 662 to 740. Task 6's final unit suite passed 740/740. Package checks rejected the retained old metadata before the version bump, then passed 3/3 against the candidate, including exact equality of all four bundled assets. The old APK was not relabelled or overwritten.

Modern and capability-masked legacy browsers passed real-input pickup, use, cancellation, full-resource rejection, three-pack capacity with a fourth pack left for the other player, authoritative damage/overflow/drop, online-menu use, TDM/CTF and all eight map startups. The actual last zombie was weakened with body shots and killed by a timed grenade while healing was pending: automatic recovery restored health without consuming the health pack. Death and replay reset supplies/armour. No game state or clock was accelerated/injected for these playthroughs.

Twelve isolated renderer profiles passed: 854×480, 1200×700 and 1280×720, control scales 1 and 1.3, modern and legacy. These extreme-inventory fixtures establish layout, not gameplay. A named Playwright CLI session also performed real pickup/use/cancel; its screenshot was inspected, game assets returned 200, and console output contained only optional favicon 404s and software-render readback warnings. The session was closed.

Owned AVD `BlockOpsHealthArmourTask`, registry `artifacts/health-armour-Jwzb4x/avds`, serial `emulator-5582`, was verified before use. The candidate was installed with `install -r` over the retained signed 0.5.1 APK, without uninstalling. Native ordinary and zombie smoke suites passed. Native supply acceptance passed real pickups/taps, cancellation, armour, Back/Home/background freeze, explicit resume and a fresh round. Passive HUD timing measured 4.9825 simulation seconds. No unintended HTTP/WebSocket requests occurred in offline suites.

Earlier failed acceptance attempts are retained, not hidden. Native observation failures came from checking immediately after adb returned, reading two snapshots across completion, and timing before the physical tap. Browser timing similarly included command latency; passive HUD boundaries corrected the measurement. Zombie test navigation originally walked back into the pursuing horde; the corrected real-input route stays in the clear west lane. These were harness changes; frozen product bytes did not change.

Key pre-review logs are in the execution ledger directory `.superpowers/sdd/2026-10-05-health-armour-pickups` (archived at handoff): `task-6-suite.log`, `task-6-modern-accepted.log`, `task-6-legacy-accepted-second.log`, `task-6-layout-final.log`, `task-6-apk-build.log`, `task-6-package-{red,green}.log`. Native logs/screenshots are under the evidence root's `native/`; accepted supply log is `supplies-smoke-fourth.log` and passive timing is `supplies-fourth/passive-duration.json`.

## Final review, regression and staging

One fresh independent whole-change review (gpt-6-astra, range 0591340..eb0c4d6) found no Critical or Minor issues and one Important native-test defect. The simulated peer's new attack packets lacked the current life ID, so the server correctly rejected them. The real native run reproduced armour remaining at 50; a direct RoomManager reproduction confirmed adding the life ID allows the expected 23 damage. A subsequent test-ordering issue required waiting for the WebView's actual new-life input acknowledgement before aiming after respawn; the peer can observe that respawn earlier. Compressed CDP mouse gestures did not all produce aim changes; passive diagnostics recorded five effective changes over twelve attempts. The test now uses genuine timed adb swipes and waits for real outbound aim changes, retaining the independent peer's final-aim assertion.

The complete corrected native TLS run passed (exit 0): FFA/TDM/CTF, supplies, authoritative armour damage and healing, unused death drops, respawn reset, guns/grenades/knife, distinct skins/teams, actual flag capture, Home cancellation/leave, physical Back/background/foreground, remote-started guest remaining paused until explicit Resume, and protocol-3 update guidance. No unexpected remote HTTP or unselected WebSocket connection occurred. Owned room departure and forward cleanup passed and were independently rechecked. Native test fix commit: `01ac8c3`. No product-code change was requested by the review; no second review was dispatched. Independent focused review tests passed 141/141, and root's post-fix full suite passed 740/740 (`task-7-fix-suite.log`). Deferred minor findings: none.

Source snapshot `artifacts/health-armour-Jwzb4x/final-source-zyASip` contains exact commit eb0c4d6 and dependency linkage, with frozen external DIST_DIR. Older suites with hard-coded output paths ran only inside that snapshot, preserving previous releases' evidence. The complete final regression matrix passed after the documented fixture correction: every required command has exit 0, all 24 configurations ran solo and with two independent peers, and both initial/final unit runs passed 740/740 with no skips. The initial configurations failure (old expected total 16) remains preserved. Its corrected fixture requires 20 and also checks two of each supply while retaining gun/knife/grenade checks. `fix-source-fNEFYX` preserves a separate test-only corrected copy used for that rerun. Frozen product/Android bytes remained identical before and after the entire matrix.

The final matrix includes 24 inventory layout profiles, 9 WebView layouts and 7 runtime-error tests, 24 zombie layout profiles, and 12 supply layout profiles, plus actual modern/legacy inventory, zombie and supply playthroughs. Each of 18 executions has its own JSON exit record and log. Fifteen original commands passed; the one stale configurations assertion failed, then corrected configurations and post-fix units passed. No failed command was silently relabelled as passing.

Raw final-matrix logs and per-command exit-code records: `artifacts/health-armour-Jwzb4x/final-regression-matrix-yz7w1t`. Native attempts: `native/online-first.log` (missing life ID), `native/online-second.log` (supply assertions pass, follow-on respawn-route observation race), `native/online-third.log`, `native/online-aim-diagnostic.log` and `native/aim-diagnostic.log` (aim-driver diagnostics), and accepted `native/online-touch.log` with screenshots in `native/online-touch/`. Failed attempts remain preserved. Solo armour and native CTF screenshots were visually inspected. Final package smoke again passed 3/3 with the same hash (`task-7-package-final.log`).

Staging was separate from production: task-owned server PID 2236994, port 36329, working directory the source snapshot; task-owned tunnel PID 2237277 to `https://proceedings-fancy-urls-formerly.trycloudflare.com`. Native online acceptance contacted only staging, never the APK's bundled production default. After exact identity and rooms=0 checks, both were stopped and their exits confirmed. The earlier owned CLI server on 41081 was also stopped. The owned emulator was revalidated by AVD name, command and registry, then stopped; AVD data and all evidence are retained. No adb forwards or owned listeners on 9228/36329/41081/20242 remained. These process IDs are historical evidence, not authority for future cleanup.

## Reproduction commands

Browser tests used `DIST_DIR=/home/alex/Documents/git/bydgame/artifacts/health-armour-Jwzb4x/dist`. The matrix's JSON records contain exact working directories, environment and exit codes. New supply tests used distinct `SUPPLY_ARTIFACTS` paths for modern/legacy; unit runs used distinct `LOOT_ARTIFACTS` paths.

```sh
npm test
npm run test:browser
npm run test:home
npm run test:touch
npm run test:configurations
npm run test:multiplayer
npm run test:loot
npm run test:loot:touch
npm run test:inventory
node tests/inventory-layout.browser.mjs
npm run test:webview
npm run test:zombies
LEGACY_WEBVIEW=1 npm run test:inventory
LEGACY_WEBVIEW=1 node tests/zombies.browser.mjs
npm run test:supplies
LEGACY_WEBVIEW=1 node tests/supplies.browser.mjs
```

Build: `BUILD_DIR=<frozen-dist> npm run build`, then `DIST_DIR=<frozen-dist> APK_OUTPUT_PATH=<candidate-apk> bash scripts/build-apk.sh` with the recorded local Gradle 8.14.3 binary. Package checks: `DIST_DIR=<frozen-dist> ANDROID_APK_PATH=<candidate-apk> node android/tests/package-smoke.mjs`. APK build access was serialised.

Native scripts: `android/tests/emulator-smoke.mjs`, `android/tests/zombies-smoke.mjs`, `android/tests/supplies-smoke.mjs`, `android/tests/emulator-online-smoke.mjs`. Each required `ANDROID_TEST_SERIAL=emulator-5582`, `ANDROID_TEST_AVD=BlockOpsHealthArmourTask` and its own `ANDROID_TEST_ARTIFACTS`; the online run additionally set `GAME_TEST_SERVER_URL` to the now-closed owned TLS staging origin. Never reuse these serial/PID values without renewed ownership checks.

Additional evidence: `signer-final.log`, `accepted-source-check.log`, `accepted-server-check.log`, `staging-cleanup.log`, and `live-unchanged-confirmed.log`. One initial read-only audit command had an extra closing brace and made no requests; its syntax failure is retained in `live-unchanged-final.log` before the corrected audit.

## Executor rulings and deferred findings

1. Review before release, so defects are caught before shipping; operational verification still needs separate checks.
2. Preserve execution evidence instead of deleting it, because this plan requires reproducibility; cost: extra disk usage.
3. Bring strict loot validation, shared bounds/labels and supply models forward into Task 2 so the integrated tree stays testable; cost: a broader Task 2 diff, without extra gameplay scope.
4. Update old 16-pickup fixtures to the approved 20 while retaining all other checks; counts alone are insufficient, so separate placement/clearance/fairness tests remain required and passed.
5. The reviewer deferred actual TLS/native/full-matrix execution: require successful runs, not inspection; otherwise supported play paths could remain unverified. These runs are now complete.
6. The reviewer deferred cutover/rollback/documentation: keep public service unchanged until the maintenance precondition and identify this as a candidate; otherwise users could mistake it for a published update.
7. The reviewer deferred physical BYD performance: require a parked-device test; device-specific rendering/input issues may remain despite emulator success.
8. The reviewer deferred the other four roadmap features: keep them outside this approved feature; delivery expectations for those upgrades remain to be agreed.
9. The reviewer excluded unrelated dirty files: preserve and do not stage them; unrelated problems remain outside this verification.

Deferred minor findings: none. The one Important review finding is fixed and verified red→green; no product-code change resulted from final review.

## Release boundary and limitations

Read-only discovery at 2026-10-05 20:35:54 AWST found the public 0.5.1 server at `artifacts/release-v0.5.1-Tn1Hla`, PID 1247182, 127.0.0.1:4185, behind existing tunnel PID 859138. Local/public health returned rooms=0 and no-store; browser footer remained `v0.5.1 SOLO ZOMBIES`. No live state was changed. The server has no admission/drain gate, so an empty check alone cannot prevent a new join racing a restart. Publishing requires a user-coordinated maintenance window; do not kick players or invent an admin API.

The APK bundles the existing public server address. Until the matching protocol-4 server is published, online play against that older server should show update guidance; offline modes are independent. Temporary tunnel addresses depend on the computer/tunnel staying online. Browser capability masks and emulator success do not prove physical BYD GPU compatibility or frame rate.

No public cutover, rollback execution, push, merge or branch removal was performed. Tasks 1–6 and Task 7 candidate gates are complete; public replacement and post-release acceptance remain pending maintenance coordination. The current branch/checkout and unrelated user files are preserved. Execution evidence is copied to `artifacts/health-armour-Jwzb4x/execution-evidence-candidate`; the active ledger remains in place so release work can resume without repeating implementation.
