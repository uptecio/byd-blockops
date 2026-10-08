# Rooftops and hiding — candidate verification

Status: **reviewed candidate verified; awaiting fresh public deployment approval**. Version 0.8.0 / Android code 10 / protocol 6. The public 0.7 release and previous APK have not been replaced. Parked-BYD hardware acceptance is still required.

## Scope

All eight existing maps have low, themed rooftop routes reached by normal jumps and walk-in shelters containing contextual Hide/Exit spots. Solo bots and Zombies use physical routes and forget concealed players. In online matches, other players can attack an occupied spot to damage/eject its occupant. Camping a single entrance remains allowed. Hidden occupants can reload/heal, and raw Fire exits before resource gates. Loot/flag interactions respect elevation. Existing XP and cosmetic saves are retained.

## Evidence locations

Working source base: `b45061a`; feature commits and task gates are recorded in the execution ledger. Owned artifacts: `artifacts/rooftops-hiding-zQylUE`. Intermediate browser builds `candidate-dist`, `candidate-r2`, `candidate-r3` are diagnostic builds, not final release byte verification.

- Baseline: `baseline-capture/README.md` and `eight-zombies-README.md`; raw frame intervals, screenshots and live actor counts retained.
- Final unit regression: 955/955 (`task-10-unit-handoff.log`); package 3/3 (`task-10-package-handoff.log`).
- Final modern/legacy all-map traversal: 16/16 real climb/hide cycles each (`final-modern2/roofs` and `final-legacy/roofs`). Repeated GPU resources are bounded at equivalent fresh FFA checkpoints (`final-modern2/roofs`, `final-legacy2/resources`), not compared across unlike modes.
- Final modern/legacy online: FFA/TDM gun, knife and grenade ejection; CTF concealment, hidden departure/drop, floor separation, rejoin/rematch. Both complete with rooms empty and explicit owned-browser/server cleanup (`final-modern3-online.log`, `final-legacy4-online.log`).
- All seven existing final-byte browser groups pass: touch, WebView startup/layout and seven runtime-diagnostic cases, inventory, Zombies, supplies, progression and online progression (`final-existing-*.log`). Zombies/supplies include separately labelled supplemental source-renderer layout fixtures.
- Genuine 375 XP browser progression and 450 XP online progression pass; full-browser restarts retain earned XP/cosmetics and settings. Intermediate r3 additionally checks equality of all saved storage after genuine earning and a full browser restart.
- Final modern/legacy Hide layouts pass all six size/scale profiles, covering 854×480, 1200×700, 1280×720 and control scales 1/1.3 (`final-modern2/layout`, `final-legacy2/layout`).

## Corrections found during acceptance

An early dependency-validation exception could precede startup error-handler installation; the handler now installs before map/render imports. A zombie reaching an unobstructed old player sighting could wait forever; it now resumes patrol without tracking the unseen current position. Both have failing-before/passing-after regression evidence.

Later visual-controller timeouts were independently traced to the test player circling a corner while enemies actively patrolled. The test now uses passive navigation observations for real exploratory movement; combat, two-wave recovery, death/replay and exact XP assertions remain unchanged. No game-state grants or production automation hook were added.

## Frozen candidate package

Rebuilt from source `3142c1a` into `artifacts/rooftops-hiding-zQylUE/reviewed-dist` with the retained default server `https://myth-referring-tablets-venture.trycloudflare.com`. Saved server preferences remain authoritative. Package checks 3/3 pass (`review-package-green.log`): 0.8.0/code10, package `au.local.blockops`, min26/target36, only INTERNET permission, existing signing certificate and exact bundled bytes. Earlier `final-*` and `native-*` evidence refers to the pre-review candidate; its assets remain in `final-dist`, and its APK/manifest are retained as `pre-review-candidate.apk` / `pre-review-manifest.json`. Post-fix evidence is explicitly prefixed `review-`.

| File | SHA256 |
| --- | --- |
| index.html | `5baef19b9156c380519207142d4398d953eb1e030d8f4918a8ff4c67840293a6` |
| game.js | `a74e1e9ce34e7827110e8310b6cf99e25ad3f5380d36b39b6a315bce0a1dd21c` |
| styles.css | `1016c04a0b814c8887ccbd0be84de1b1ec33bfdb4e06d7e7ac5fd8aa262b151b` |
| THREE-LICENSE.txt | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |
| block-ops-v0.8.0-rooftops-hiding.apk | `a0169627a13c9a6ff2815122cbeb15b98a31cc87adce78ce2b12a3fc4126f70f` |

Signer SHA256: `6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49`. Previous0.7 APK retained unchanged.

## Raw performance observations

Desktop Chromium145/SwiftShader,1200×700, easy difficulty, sound off. Timing was run alone with no owned emulator or competing browser tests. This is **not a BYD benchmark**.

| Four-second scenario | Baseline median / p95 | Candidate median / p95 |
| --- | --- | --- |
| Eight live bots |17.3 /43.5ms|16.7 /50.7ms|
| Eight live zombies (seven walkers, one runner) |16.7 /17.1ms|16.7 /18.4ms|

Raw intervals, actors and health are retained in`baseline-capture` and`r3-performance-matched/evidence.json`. The zombie player faced north and retained80HP in both; the candidate reached the north boundary before sampling, while baseline reached it during sampling. Short samples, different exact positions and software-renderer scheduling limit precise comparisons. Sustained medians did not regress; bot p95 was about17% higher. Earlier ten-second candidate attempts naturally ended with six living bots and are retained separately, not presented as matched eight-bot samples (p9550.2–59.3ms, versus baseline53.5ms).

## Native evidence

Only the copied disposable AVD`BlockOpsRooftopsTask` (`emulator-5586`,1280×720) was changed; original historical userdata remains untouched. No data clear/uninstall was used. Offline attachment disables Wi-Fi and mobile data; screenshots use actual ADB display capture.

- `native-baseline-red`: original code9 fails on absent Hide control, as expected.
- `native-offline`: genuine old-version XP880→890, full saved-storage equality after same-signed9→10 upgrade, then all eight maps pass physical climb, Hide/Fire exit and rendered roof/room checks. Its later Zombie setup failed because it waited unseen behind a wall; subsequent focused tests corrected the controls, not gameplay.
- `native-zombies3`: four genuine shots/eliminations leave one walker; direct LOS before Hide, erased pursuit, collected health and armour used while concealed, raw Fire exit, and the live walker physically reaches roof Y2.2. Full-storage equality survives background/foreground and force-stop/relaunch; a new match starts exposed; same-signed10→10 replacement retains the save. End XP998.
- `native-online2`: owned TLS staging and independent browser verify native elevation, concealed avatar/name/flag, exact23-health proxy ejection and exit-coordinate flag drop on native departure. Observer remains alive until departure is verified. An earlier attempt correctly auto-returned the flag because the observing defender stood on its drop point; moving the defender out of pickup range fixes that setup.
- `native-progression`: 355 genuine new XP (998→1353), earned Crimson Ninja/Crimson Red, force-stop/relaunch, background/foreground and same-signed update save retention all pass.
- `native-progression-online2`: genuine private 10 XP, both peers' rendered skin/gun palettes, pending appearance through an open Loadout menu and respawn, and force-stop retention pass. The prior setup overshot a waypoint through TLS; bounded real-key pulses with neutral snapshot settling fixed that test controller.
- `native-full-final`: supplemental single-run all-eight-map climb/Hide/Fire/world, witnessed Zombie forgetting, concealed healing/armour, physical rooftop pursuit and lifecycle/full-storage/install-r acceptance passes with exit 0. This resumes code 10; the separate genuine 9→10 upgrade evidence remains `native-offline`.

## Pending release gates

The independent whole-branch review found two Important defects, now fixed in one TDD pass (`3142c1a`): acknowledgement-before-snapshot raw Fire/Throw while healing, including touch control availability; and multiple same-frame grenade bursts using stale concealed geometry after ejection. Six targeted assertions failed before and pass after; final full suite 960/960 and package 3/3 pass (`final-handoff-unit.log`, `final-handoff-package.log`). Consecutive-burst tests now leave 55.45771566246195 health in both one-frame and split-frame simulations, instead of incorrect 20 health in one frame. Rebuilt browser/native acceptance passes.

Post-review rebuilt-byte results:

- `review-native-full`: all eight maps plus Zombie forgetting, hidden healing, physical pursuit, lifecycle saves and same-signed install-r; errors empty, exit 0.
- `review-native-online`: independent browser receives native rooftop elevation, invisible avatar/name/flag, 23-damage body-only ejection and departure flag drop; errors empty, exit 0.
- `review-legacy-online`: all FFA/TDM/CTF scenarios, owned rooms empty and explicit cleanup, exit 0.
- `review-touch`, `review-supplies`, `review-webview`, `review-modern-layout`, `review-legacy-layout`: gameplay, legacy startup, seven diagnostics and both six-profile hiding/touch layout runs; chain exit 0. Supplemental supply source-renderer layout checks remain separately labelled.
- `review-modern-online`: FFA passed, then TDM test-controller entrance alignment timed out under concurrent software rendering; failed evidence retained. Unchanged lower-load `review-modern-online2` passes all three modes, rejoin/rematch and explicit owned cleanup with exit 0.

Owned native staging server/tunnel and disposable emulator were stopped after their identity and empty-room checks. AVD userdata and all artifacts are retained. The public server/tunnel remain untouched.

The candidate APK is `artifacts/block-ops-v0.8.0-rooftops-hiding.apk`. Solo is ready for testing; online requires the separately approved protocol-6 server cutover. Browser refresh/older-client APK update will be required after that cutover. Saved server overrides and the existing browser origin must be preserved; do not clear app/browser data. Frozen deployable source is `artifacts/rooftops-hiding-zQylUE/release-source` from commit `3142c1a`, with the exact reviewed assets. The latest read-only public health check still showed zero rooms, but this must be checked again immediately before an approved restart.

One Minor issue is deferred: at a narrow roof-edge band, an online body can still stand on its .4-radius support while the .34-radius dropped-item anchor falls to the ground below. Loot/flags remain recoverable; an improvement should preserve the grounded support and choose a valid nearby rooftop anchor. No physical BYD acceptance is claimed from software-renderer or emulator results.

Public cutover requires a freshly approved empty-room maintenance window. Saved browser data is origin-specific; APK server preferences override the build default. Preserve the existing origin and previous release for rollback. Parked-BYD map loading, jumping, hiding and touch responsiveness remain a user hardware check.

## Pre-cutover identity and rollback

Read-only discovery on 2026-10-08 around 10:13 UTC confirms the public server still runs `artifacts/xp-cosmetics-live-dEhwLP/release-source/server/server.mjs` (PID 620214), bound to `127.0.0.1:4185`, with its own `dist` assets. Tunnel PID 21648 still serves `https://myth-referring-tablets-venture.trycloudflare.com`. Local/public health returned 200 with zero rooms; all four asset responses were `no-store` and matched the live disk bytes. This observation is not maintenance approval, and identity/room count must be checked again immediately before an approved cutover.

The live release remains 0.7.0 / protocol 5. Its server does not expose an APK download route; APK delivery is the local artifact link, not an invented public URL. The separate owned test server on port 38861 is not production.

Rollback copies retained under `artifacts/rooftops-hiding-zQylUE`:

- `rollback-source.tar` includes exact live source/assets and dereferenced installed dependencies: SHA256 `15a4bf2fdee7f35451ccaa02de39f68dff4b83ac96b311ff9556e97262e4f66e`.
- `rollback-v0.7.0.apk`: SHA256 `faa2f4f2cf0252b9f9f135344c748664572c16de0c1ebfe841a679b9e6e152ed`.
- Live HTML SHA256 `93943a5d0c7d7ff4d224c3d2efec8cbda4655c04e52e1ba51138f5753d772ab4`; live game.js SHA256 `1bd2d7d0241a5dcd241cf957e1da4fda400dd682b93f55a6128665e890573636`.
