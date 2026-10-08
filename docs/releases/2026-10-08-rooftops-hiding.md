# Rooftops and hiding — candidate verification

Status: **in progress; not publicly deployed**. Target0.8.0 / Android code10 / protocol6. The public0.7 release and previous APK have not been replaced.

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

Built `artifacts/rooftops-hiding-zQylUE/final-dist` with the retained default server `https://myth-referring-tablets-venture.trycloudflare.com`. Saved server preferences remain authoritative. Package checks3/3 pass:0.8.0/code10, package`au.local.blockops`, min26/target36, only INTERNET permission, existing signing certificate and exact bundled bytes.

| File | SHA256 |
| --- | --- |
| index.html | `5baef19b9156c380519207142d4398d953eb1e030d8f4918a8ff4c67840293a6` |
| game.js | `43c2bf647b54fba3ad69f0c46fcb3acf706147f31f288c43db2c15219d392c28` |
| styles.css | `1016c04a0b814c8887ccbd0be84de1b1ec33bfdb4e06d7e7ac5fd8aa262b151b` |
| THREE-LICENSE.txt | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |
| block-ops-v0.8.0-rooftops-hiding.apk | `bf1f26bb0580aa65acc9a5926e1e0831768ae9155de04e16b927e203c73064c4` |

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

## Pending release gates

Fresh whole-branch review remains. All candidate acceptance gates above have passing evidence; the native all-map/upgrade and focused Zombie/lifecycle evidence are split across explicitly named runs. No physical BYD acceptance is claimed from software-renderer or emulator results.

Public cutover requires a freshly approved empty-room maintenance window. Saved browser data is origin-specific; APK server preferences override the build default. Preserve the existing origin and previous release for rollback. Parked-BYD map loading, jumping, hiding and touch responsiveness remain a user hardware check.
