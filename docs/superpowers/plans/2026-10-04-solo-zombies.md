# Solo Zombie Survival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add offline endless zombie survival on the eight existing maps, retaining the current guns, loot inventory and BYD compatibility, then deliver a tested browser release and APK.

**Architecture:** Keep survival state and zombie decisions in small offline-only modules. A ZombieRuntime delegate integrates them with ArenaGame's existing movement, combat, equipment and rendering; ordinary mode rules and the online protocol remain unchanged. A separate solo catalog and explicit survival HUD avoid treating zombies as another timed team match.

**Tech Stack:** JavaScript ES modules, Node test runner, Three.js 0.160.1, esbuild targeting ES2017, existing Playwright and Playwright CLI, Android Java 17 WebView wrapper with minimum SDK 26 and compile/target SDK 36. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-solo-zombies-design.md`, approved 2026-10-04. Read it in full before execution. This plan is awaiting user review and an execution-method choice; its unchecked tasks are not claims of work performed.

## Global Constraints

- Endless waves, with no three-minute limit or final victory wave.
- All eight current maps, the selected player skin, and the chosen starting gun.
- Five walkers in wave 1; later waves add more enemies. Runners appear from wave 3.
- For wave number n, the total is 5 + 2 × (n − 1). From wave 3, the runner fraction is min(0.5, 0.25 + 0.025 × (n − 3)); the runner count is floor(total × fraction), with the rest walkers.
- Limit living zombies to eight at once. Spawn intervals and failed-spawn retries are one simulation second.
- A ten-second recovery break between waves restores full health and refills every owned gun to 500 total rounds, including its magazine.
- Player death ends the run without respawning. Results show waves survived and zombie kills.
- Preserve instant-kill gun headshots, including the existing exact damage value of 10000000000.
- Walkers have 100 health, speed 2.1, slash damage 20 and interval 1.2 seconds; runners have 100 health, speed 3.4, slash damage 15 and interval 0.9 seconds.
- Keep the numbered top-left inventory, current player damage, grenade capacity, original-starter removal/recovery rule, player skins, map geometry and solo pause behaviour.
- Zombies are unarmed, cannot collect/drop loot and target only the human. No online zombies or wire-protocol change.
- Preserve ES2017, WebGL1, legacy DOM/CSS fallbacks, Android permissions and debug signing. No Object.hasOwn, Element.replaceChildren, unguarded newer APIs, downloaded art or paid services.
- Use the already-selected current checkout; inspect it again at execution. Preserve user changes to `.gitignore`, `README.md`, skill folders/lockfile and private photos. Stage only explicit task files.
- Intermediate builds use `artifacts/zombies-review/dev-dist`, never the public release directory or old APK paths. No live restart before final verification and an empty-room check.
- Test landscape sizes 854 by 480, 1200 by 700 and 1280 by 720, including large controls and legacy profiles. Browser/emulator evidence is not physical BYD validation.

## Review Focus

1. A final shotgun pellet, delayed grenade hit or duplicate death must not count the same zombie twice or heal a player who has already died. Pin in Tasks 1 and 4.
2. Legal player wall-contact, occupied spawns and smoke concealment must not cause an impossible wave, wall clipping or hidden-position tracking. Pin in Tasks 2 and 4.
3. Pause, backgrounding, a long frame and holding Fire at a wave transition must not fast-forward the break or leak an attack through menus. Pin in Tasks 1, 4 and 6.
4. Starting ordinary Solo or Online after Zombies must not retain zombie entities, labels, record callbacks or a survival clock. Pin in Tasks 4–6.
5. Very long runs, malformed/throwing storage and the older WebView must remain bounded and playable rather than silently resetting inventory or blanking the arena. Pin in Tasks 1, 4–7.

## Files and interfaces

| Create or modify | Responsibility |
| --- | --- |
| Create `src/zombie-survival.js`; modify `src/equipment.js` | Pure wave state, immutable balance and inventory-preserving refill |
| Create `src/zombie-brain.js` | Spawn selection, remembered pursuit, collision-safe separation and slash decisions |
| Create `src/zombie-avatar.js`; modify `src/audio.js` | Lightweight unarmed models, animation and short wave cues |
| Create `src/zombie-runtime.js`; modify `src/game.js` and `tests/helpers/game-fixture.js` | Bounded entities, combat/lifecycle integration and production-fixture cleanup |
| Create `src/solo-modes.js`, `src/zombie-records.js`; modify `src/home-ui.js`, `src/main.js`, `src/match-ui.js`, `src/multiplayer-ui.js`, `index.html`, `src/styles.css` | Offline selection, HUD/results, records, online-selection guard and touch layout |
| Create the tests named below; modify existing catalog/layout assertions only where required | New behaviour and preserved regressions |
| Modify `package.json`, `package-lock.json`, `android/app/build.gradle`, `android/tests/package-smoke.mjs`; create `android/tests/zombies-smoke.mjs` | Test command, release identity and exact-asset/native validation |

Keep `src/modes.js`, `src/protocol.js`, `server/rooms.js` and ordinary bot decision rules unchanged unless a demonstrated integration defect requires a narrowly reviewed adjustment. Never add zombies to the shared MODES list.

Shared names used in this plan:

- `SurvivalState`: `{modeId:'zombies', mapId, phase, ended, wave, completedWaves, kills, elapsed, queued, spawned, activeIds, spawnRemaining, recoveryRemaining, nextId}`. `activeIds` is a Set of at most eight current identities; phase is fighting, recovery or ended. No historical actor list or preallocated wave queue.
- `SpawnCandidate`: `{id, kind}`, where kind is walker or runner; identities are monotonically allocated within one run. A proposed identity is not consumed until a successful spawn.
- `SurvivalView`: detached plain `{phase,wave,completedWaves,kills,elapsed,remaining,alive,queued,recoveryRemaining}`. Remaining equals alive plus queued.
- `ZombieEntity`: `{id,kind,lifeId:1,model,bar,health,respawn:0,protected:0,flashRemaining,slashRemaining,brain,yaw}`. No equipment or weapon model. Entity position is `model.position`; slashRemaining is a cosmetic 0.2-second animation timer, not the attack cooldown.
- `ZombieActor`: existing actor position/liveness fields plus `kind`; use `teamId:null`, `equipment:null`, `skinId:null`, feet-height y, finite yaw/pitch, protection and flash fields. A runtime enemy predicate distinguishes human/zombie instead of teams.
- `SurvivalEvent`: `{type:'wave-start',wave}`, `{type:'recovery',completedWaves}` or `{type:'ended'}`. The runtime handles each returned event once.
- A zombie match view uses the existing outer view keys with `modeId:'zombies'`, finite `timeLeft:0`, flags null, zero team scores, no winner, only the human in `players`, and a `survival: SurvivalView` field. The HUD branches before ordinary mode/time formatting. `game.match.ended` always agrees with survival.

Dependencies: Task 1 precedes Tasks 2–4; Tasks 2 and 3 can be built independently after Task 1 if the chosen execution method permits. Task 4 owns game integration, Task 5 owns menus/HUD, Task 6 proves the combined game, and Task 7 releases it. Do not assign overlapping files to concurrent writers. Self-review of this plan remains the primary agent's responsibility.

### Task 1: Pure wave lifecycle and safe recovery

**Files:** Create `src/zombie-survival.js`, `tests/zombie-survival.test.js`, `tests/zombie-recovery.test.js`; modify `src/equipment.js`.

**Interfaces:** Export immutable `ZOMBIE_BALANCE`, `waveConfig(wave) -> {total,walkers,runners}`, `createSurvival(mapId) -> SurvivalState`, `tickSurvival(state,dt) -> SurvivalEvent[]`, `nextZombieSpawn(state) -> SpawnCandidate|null`, `resolveZombieSpawn(state,id,accepted) -> boolean`, `recordZombieDeath(state,id) -> boolean`, `settleSurvival(state,playerAlive) -> SurvivalEvent[]`, and `survivalView(state) -> SurvivalView`. Add `refillOwnedAmmo(equipment) -> void` to equipment.js. Helpers accept internal trusted state; malformed dt does not mutate it. Invalid wave/map inputs fail explicitly.

`ZOMBIE_BALANCE` has keys `maxAlive:8`, `spawnInterval:1`, `recoverySeconds:10`, `spawnDistance:8`, `separation:.8`, `pathInterval:.15`, and `walker`/`runner` records with keys `health`, `speed`, `damage`, `interval` using the exact values in Global Constraints.

- [ ] At execution, read the worktree skill, confirm the approved current checkout, inspect dirt and run `npm test`. Record the actual baseline (previous release had 554 passing tests; do not assume that count). Build a baseline with `BUILD_DIR=artifacts/zombies-review/baseline-dist npm run build`; keep live files untouched.
- [ ] Write failing wave tests, including these exact assertions:

```js
assert.deepEqual(waveConfig(1), {total:5,walkers:5,runners:0});
assert.deepEqual(waveConfig(2), {total:7,walkers:7,runners:0});
assert.deepEqual(waveConfig(3), {total:9,walkers:7,runners:2});
const s = createSurvival('courtyard');
const candidate = nextZombieSpawn(s);
assert.equal(candidate.kind, 'walker');
assert.equal(resolveZombieSpawn(s, candidate.id, false), false);
assert.equal(s.queued, 5);
assert.equal(nextZombieSpawn(s), null);
tickSurvival(s, 1);
assert.equal(nextZombieSpawn(s).id, candidate.id);
```

- [ ] Add named tests `queued enemies prevent early recovery`, `death wins over a pending wave clear`, `duplicate identity death scores once`, `ten seconds advances exactly one wave`, `late frame does not burst all queued spawns`, and `one thousand wave cycles retain no history`. Assert eight active maximum, recovery equals 10, recovery/ended phases cannot spawn, NaN/Infinity/nonpositive dt is ignored, and snapshots cannot mutate active state. At a due spawn allow at most one request per step; missed time cannot create a burst. Runtime pause does not call tickSurvival at all. Use safe-integer validation for configuration/counters rather than silently overflowing into invalid values.
- [ ] Write recovery tests covering all 28 gun IDs and this retained-state case:

```js
const e = createEquipment('m4a1');
equipGun(e, 'mp5', {source:'armory'});
pickupEquipment(e, {kind:'knife'});
pickupEquipment(e, {kind:'grenade',grenadeType:'smoke'});
setHeldItem(e, 'knife');
e.owned.get('mp5').ammo = 0;
e.owned.get('mp5').reserve = 2;
refillOwnedAmmo(e);
assert.equal(e.owned.get('mp5').ammo + e.owned.get('mp5').reserve, 500);
assert.equal(e.owned.has('m4a1'), false);
assert.equal(e.startingGunRemoved, true);
assert.equal(e.heldItem, 'knife');
assert.equal(e.grenades.smoke, 1);
```

- [ ] Run `node --test tests/zombie-survival.test.js tests/zombie-recovery.test.js`; require intended missing-behaviour failures before implementation.
- [ ] Implement the interfaces. `tickSurvival` only advances clocks and starts a wave when recovery expires; `settleSurvival` first ends on dead player, otherwise awards recovery only when queued and active are zero. `recordZombieDeath` removes an active identity immediately and ignores later repeats. Interleave runners at spawn index i when `floor((i+1)*runners/total) > floor(i*runners/total)`. A failed valid spawn sets a one-second retry without consuming identity/count. Successful spawn sets the same interval. Refill existing weapon-state objects from `createWeaponState(id)` without replacing the owned Map or any ownership flags, then zero transient attack timers.
- [ ] Run `node --test tests/zombie-survival.test.js tests/zombie-recovery.test.js tests/equipment.test.js tests/weapons.test.js`; require all passing. Review the diff and commit only Task 1 files as `feat: add offline zombie wave and recovery rules`.

### Task 2: Safe spawning and melee pursuit

**Files:** Create `src/zombie-brain.js`, `tests/zombie-brain.test.js`; consume `src/navigation.js`, `src/collision.js`, `src/gear-combat.js` unchanged.

**Interfaces:** Consume Task 1 balance. Export `selectZombieSpawn({map,navigation,player,zombies,fovRadians}) -> {x,z}|null`, `createZombieBrain(kind) -> {goal,waypoint,pathRemaining,attackRemaining}`, and `stepZombieBrain(brain,{actor,player,zombies,navigation,solids,smokes,dt}) -> {x,z,yaw,attack}`. Inputs are detached actor records, not models. Only brain memory/timers mutate. Return attack true at most once per call and consume that type's interval; runtime applies damage.

- [ ] Write failing tests for eight-unit player distance, 0.8-unit zombie separation, bounds/solids, deterministic outside-view preference and no valid candidate returning null. Across every map test authored spawn points and legal player wall-contact with `nextApproachWaypoint(from,player,.34)`, not strict reachability to the player centre. Test candidate occupancy again at actual spawn acceptance in Task 4.
- [ ] Write tests `smoke preserves remembered goal while human moves`, `flash freezes motion and slash`, `slash respects jump height cover and protection`, and `separation cannot cross a thin wall`. Assert walker speed 2.1 and runner speed 3.4, damage configuration 20/15, intervals 1.2/.9 and navigation retry throttle .15 seconds. Use finite actor records in these assertions:

```js
const brain = createZombieBrain('walker');
assert.equal(brain.attackRemaining, 1.2);
const blinded = stepZombieBrain(brain, {
  actor:{...zombieActor,flashRemaining:1}, player, zombies:[zombieActor],
  navigation, solids:[], smokes:[], dt:.05,
});
assert.equal(blinded.attack, false);
assert.equal(blinded.x, zombieActor.x);
assert.equal(blinded.z, zombieActor.z);
```

  Construct zombieActor/player as complete local finite records in this test; navigation is a real `createNavigation` for map cases and a call-counting stub only in the throttle unit test.
- [ ] Run `node --test tests/zombie-brain.test.js`; confirm intended failures.
- [ ] Implement the interfaces using `moveCircle`, `nextApproachWaypoint` and `meleeTarget(actor,[player],...)` with a human-only enemy predicate. Combine map.spawns, map.playerSpawn and team spawn locations, deduplicated and collision validated. Store the unconcealed goal; while smoke blocks 1.6-height sight, never replace it from live player coordinates. Clamp movement to waypoint distance and apply a bounded separation adjustment with another collision check. No routes, equipment choices or targets involving other zombies.
- [ ] Run `node --test tests/zombie-brain.test.js tests/bot-brain.test.js tests/collision.test.js tests/maps.test.js`; require all pass. Commit as `feat: add zombie spawning and melee pursuit`.

### Task 3: Unarmed block models and wave sounds

**Files:** Create `src/zombie-avatar.js`, `tests/zombie-avatar.test.js`, `tests/zombie-audio.test.js`; modify `src/audio.js`.

**Interfaces:** Export `createZombieModel(THREE,kind) -> Group` and `animateZombieModel(model,{time,moving,slashing}) -> void`; moving and slashing are booleans. Named model nodes include head, left-arm, right-arm, left-leg, right-leg and health-bar; no weapon attachment. Model owns all geometry/materials for `disposeModel`. Add `GameAudio.zombieWave()` and `GameAudio.zombieRecovery()` using existing `tone`; both obey enabled/context checks.

- [ ] Write failing model tests for both kinds: finite geometry with torso/head aligned to the existing hitbox, aimable face above the strict 1.48 head threshold, distinct palettes, absent weapon attachment and a health-bar mesh above the body. Do not include the floating health bar in body-hitbox bounds. Assert animation changes limb transforms without allocating meshes, geometry or materials. Traverse resources and assert `disposeModel` disposes each owned resource once. Test audio by observing tone calls and verifying muted/unavailable audio never throws or creates resources.

```js
const model = createZombieModel(THREE, 'walker');
assert.equal(model.getObjectByName('weapon'), undefined);
assert.ok(model.getObjectByName('health-bar').isMesh);
const count = model.children.length;
animateZombieModel(model, {time:1,moving:true,slashing:true});
assert.equal(model.children.length, count);
```
- [ ] Run `node --test tests/zombie-avatar.test.js tests/zombie-audio.test.js`; confirm intended failures.
- [ ] Build the original green block models with reusable box geometry within each model, warm runner outfit accents and two-arm reach/slash poses. Keep headshot/body dimensions consistent with `AVATAR_HITBOX`; do not edit normal player skins or `createAvatarModel`. Add short synthesized cues, with no repeated strobe or external asset download.
- [ ] Run `node --test tests/zombie-avatar.test.js tests/zombie-audio.test.js tests/skins.test.js tests/gear-view.test.js tests/headshots.test.js`; require all pass. Commit as `feat: add block zombie models and wave cues`.

### Task 4: Integrate survival into the production solo game

**Files:** Create `src/zombie-runtime.js`, `tests/zombie-game.test.js`, `tests/zombie-maps.test.js`; modify `src/game.js`, `tests/helpers/game-fixture.js`.

**Interfaces:** Export `class ZombieRuntime` with `constructor(game)`, `start(weaponId,settings)`, `beginStep(dt)`, `updateEnemies(dt,actors)`, `finishStep()`, `canAttack() -> boolean`, `isEnemy(sourceId,targetId) -> boolean`, `actors() -> ZombieActor[]`, `onEliminated(victim,actors?)`, `refreshView()`, `dispose()`. Runtime exposes its pure `state`, assigned to `game.modeState` for existing session identity checks. `game.bots` holds only current zombie entities during this mode, preserving existing entity resolution/hitscan iteration. Add `ArenaGame.isEnemy(sourceId,targetId)` delegating to runtime or unchanged `areEnemies`. Existing `start`, `getActors`, `requestEquipment`, `damageActor`, `shoot`, `slash` and lifecycle signatures stay supported, including omitted actor snapshots. Emit `events.onSurvivalRecord?.({mapId,waves,kills})` at recovery, death and confirmed quit only.

- [ ] Write failing tests through `createHeadlessGame()` and production methods. Assert `start('m4a1',{modeId:'zombies'})` yields wave 1 with no armed bots; real time can exceed 180 seconds without expiry; zombie death removes exactly one queued/live contribution without drops or respawn; human death calls onEnd once and cannot resume. Check headless construction bypasses ArenaGame's constructor, so initialization must occur in start.

```js
const game = createHeadlessGame();
try {
  game.start('m4a1', {modeId:'zombies',mapId:'courtyard'});
  const identity = game.modeState;
  game.update(.05);
  assert.equal(game.getMatchView().survival.wave, 1);
  assert.equal(game.getMatchView().survival.remaining, 5);
  assert.ok(game.bots.every(z => !z.equipment));
  game.pause();
  const before = game.getMatchView().survival.elapsed;
  game.update(1);
  assert.equal(game.getMatchView().survival.elapsed, before);
  assert.equal(game.modeState, identity);
} finally { cleanupGame(game); }
```
- [ ] Pin combat/recovery with real methods: observe damageActor receiving exactly 10000000000 on a head ray; two knife hits kill; a central frag does not exceed 90; repeated shotgun pellets cannot hit a dead retained model. Clear a wave after carrying several guns and a knife/grenades, then assert unchanged equipment membership, active choice and run identity, full health, 500 per gun and ten-second recovery. Attempt firing/knife/throw during recovery and assert no ammo/grenade expenditure or projectile. Ordinary owned-gun switching still does not refill.
- [ ] Add regression assertions for pause/background-equivalent pause, occupied spawn retry, final-death/recovery priority, no zombie pickup, smoke/flash, and current actor positions after movement. Across eight maps complete a real wave through damage/combat, checking routes and collision. Exercise 20 full runtime waves with at most eight scene actors and no growing dead-ID/stat arrays; Task 1 provides the longer pure-state stress test. Check Zombies → FFA → Zombies → online adapter start: old models detached/disposed, old runtime cleared, no stale input, ordinary respawn/timer restored. Assert protected players cannot be slashed and corpse models cannot absorb later shots.
- [ ] Run `node --test tests/zombie-game.test.js tests/zombie-maps.test.js`; require intended failures before integration.
- [ ] Implement runtime start before `assignTeams/createModeState` in ArenaGame.start. Dispose any previous zombie runtime before every new start, including the zero-bot OnlineArena adapter. Runtime calls existing map load and initial player reset only with no zombies yet; recovery never calls resetPlayer. Runtime owns removal/disposal of zombie meshes, clears game.bots, and is idempotent so subsequent ordinary loadMap cannot double-dispose them.
- [ ] Integrate per-step ordering: beginStep ticks survival and accepts at most one safe spawn before building actors; existing player movement/equipment runs; gate player attacks and throws by canAttack; updateEnemies replaces ordinary updateBots; grenades use the delegated enemy predicate; only the human collects loot; finishStep removes marked dead models and settles recovery after combat. Damage updates health and liveness once through damageActor, then calls onEliminated before ordinary drops/scoring/respawn side effects. Human elimination immediately settles terminal state and stops the step; enemy elimination updates counts but defers recovery until finishStep.
- [ ] Keep shared attack validation and hit feedback. Add `health > 0` to zombie hitscan eligibility, including later shotgun pellets. Branch match projection before stats/time logic, skip `tickMode` and its time clamp for survival, and branch `refreshGearView` before dereferencing armed equipment. Runtime actors remain available until safe cleanup for grenade/flash resolution. Quit records progress, pauses input and disposes runtime; normal and online starts leave none behind. Extend fixture cleanup to call runtime disposal safely.
- [ ] Run `node --test tests/zombie-game.test.js tests/zombie-maps.test.js tests/offline-modes.test.js tests/loot-solo.test.js tests/headshots.test.js tests/carried-flag-visibility.test.js tests/online-modes.test.js` and `npm test`; require all pass. Commit as `feat: integrate offline zombie survival runtime`.

### Task 5: Home selection, wave HUD and local best records

**Files:** Create `src/solo-modes.js`, `src/zombie-records.js`, `tests/solo-modes.test.js`, `tests/zombie-records.test.js`, `tests/zombie-ui.test.js`; modify `src/home-ui.js`, `src/main.js`, `src/match-ui.js`, `src/multiplayer-ui.js`, `index.html`, `src/styles.css`. Update minimal-DOM fixtures in `tests/home.browser.mjs` only where new label IDs require them.

**Interfaces:** Export `SOLO_MODES`, `getSoloMode(id)` and `onlineSelection(selection) -> copiedSelection` from solo-modes.js. Existing IDs return existing metadata; zombies adds `{id:'zombies',name:'Zombie Survival',soloOnly:true}` with no fake duration/score limit. `onlineSelection` maps only zombies to ffa and never mutates the Home choice. Export `createZombieRecords(storage) -> {best(mapId),record(mapId,{waves,kills})}`, returning detached `{waves,kills}` records. Use key `block-ops-zombies-v1`, strict known map IDs and finite nonnegative safe integers. Extend `renderMatchResults(view,ownId,{best}={})` without breaking old callers; keep `renderMatchHud(view,ownId)`.

- [ ] Write failing catalog and record tests. Assert shared MODES remains exactly ffa/tdm/ctf, getMode rejects zombies, SOLO_MODES includes four, onlineSelection maps zombie create to ffa preserving gun/map/skin, and original selection is unchanged. Test corrupt JSON, arrays, unknown maps, negative/non-finite/unsafe numbers, read and write exceptions, copied records and waves-first/kills-second ordering:

```js
const throwing = {getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
const records = createZombieRecords(throwing);
assert.deepEqual(records.best('courtyard'), {waves:0,kills:0});
assert.deepEqual(records.record('courtyard',{waves:2,kills:14}), {waves:2,kills:14});
assert.deepEqual(records.best('courtyard'), {waves:2,kills:14});
```

- [ ] Write DOM fixture tests for wave/remaining counts, recovery countdown, zero-wave death results, best record, and restoring ordinary HUD/results labels. IDs added to markup: `home-mode-help`, `session-duration`, `session-duration-label`, `result-kills-label`, `result-deaths-label`, `zombie-best`, `bot-settings-note`. Assert HUD displays `WAVE 3`, `9 LEFT` before queued enemies spawn, then `NEXT WAVE IN 10` in recovery; results label completed waves, not the current unfinished wave. Optional labels tolerate the existing minimal result fixture, while shipped markup must contain all labels.
- [ ] Run `node --test tests/solo-modes.test.js tests/zombie-records.test.js tests/zombie-ui.test.js`; confirm intended failures.
- [ ] Implement storage with an in-memory fallback and guarded reads/writes; also guard access to window.localStorage itself in main, because its getter can throw before getItem is called. Wire the runtime record callback in main; pass best records into zombie results. Home validation accepts SOLO_MODES, uses no team badge for Zombies, displays Solo only and Endless waves, and uses Play Zombies. Armory descriptions, targets and settings distinguish survival from the three-minute modes; label bot settings as not applying to Zombies. Keep existing saved selections compatible.
- [ ] Use the solo catalog in presentation only. Existing shared mode lookups remain for server/online simulation. In MultiplayerUI.connect, copy and sanitize outbound create selection; display `Zombies is solo only. Your online room uses Free For All.` when applicable. Joining and configuring normal rooms remain unchanged. Do not change live Home selection merely by computing a packet.
- [ ] Branch HUD/results before timed/team formatting. Reuse the current score area for waves/remaining/break; keep the inventory and touch actions in place. Restore all modified text/classes on normal modes. A four-card Home mode grid must fit or wrap without hiding map/skin/Play controls, with physical CSS fallbacks intact. Recovery attacks remain visibly unavailable but equipment selection remains usable.
- [ ] Run the three new test files, `npm test`, build to dev-dist and run `DIST_DIR=artifacts/zombies-review/dev-dist node tests/home.browser.mjs`; require all pass. Commit as `feat: add zombie selection wave HUD and best records`.

### Task 6: Real browser, touch and compatibility acceptance

**Files:** Create `tests/zombies.browser.mjs`, `tests/zombies-layout.browser.mjs`; modify `tests/home.browser.mjs` catalog assertions and `package.json` to add `test:zombies` (`node tests/zombies.browser.mjs && node tests/zombies-layout.browser.mjs`). Keep existing three-mode regression coverage explicit rather than blindly iterating new offline metadata in online tests.

**Interfaces:** Reuse `fixture(viewport)`, `walkSolo`, `until` and real controls from `tests/helpers/loot-browser.js`; reuse `emulateLegacyWebView(context)`. New suites read `DIST_DIR`, `LEGACY_WEBVIEW` and `ZOMBIE_ARTIFACTS` (default `artifacts/zombies-review`). Browser interaction uses shipped UI; no product globals that grant loot, teleport, kill enemies or skip waves. Separate DOM fixture screenshots are labelled as fixtures.

- [ ] Write acceptance assertions that fail against the preserved baseline: four Home mode cards, Zombies selectable, start on each map without errors, visible wave HUD and inventory, no ordinary clock, legitimate pickup/selection, pause with stable state, terminal death and Play Again. Use real keyboard/touch actions and observed HUD/screenshots, with bounded condition waits. A real-play wave-clear check must observe kills and recovery; injected result snapshots do not count as gameplay evidence.

```js
await page.locator('[data-mode-id="zombies"]').click();
await page.locator('#home-solo').tap();
await page.waitForSelector('body[data-mode="playing"]');
assert.match(await page.locator('#hud-mode').textContent(), /ZOMBIE/);
assert.equal(await page.locator('#loot-inventory').isVisible(), true);
assert.equal(await page.locator('#fatal-screen').isHidden(), true);
assert.notEqual(await page.locator('#timer').textContent(), '03:00');
```
- [ ] Write layout assertions for three viewports × control sizes 1/1.3 × modern/legacy × ordinary/safe-area profiles. Assert Play/Home/Pause/inventory/fire are in bounds, important controls do not overlap, inventory swipes do not turn/fire, and the four-mode Home layout is navigable. Check zombie recovery/results and return-to-FFA labels using isolated production-renderer fixtures where necessary. Add a browser context whose localStorage getter throws and assert a fresh zombie run remains playable. Retain the main-loop .05-second frame clamp and verify a long animation-frame gap does not consume the whole recovery; held Fire and extra touches must not escape pause or recovery attack suppression.
- [ ] Run the new tests against `artifacts/zombies-review/baseline-dist`, requiring failure specifically for absent zombie UI; then run against dev-dist and fix only demonstrated defects using new red/green cases. Do not weaken unrelated assertions or replace real gameplay checks with direct state mutation.
- [ ] Read the installed Playwright CLI skill and its session-management/running-code references before using it. Start only a task-owned local candidate server and named session `zombies-review`. Play the actual game: select Zombies, collect and select loot, kill a walker, clear a wave, observe refills, reach runners, pause/resume, die/replay and return Home. Record screenshots and console/network errors. Repeat critical startup/inventory checks with legacy API masks. Use real aim/fire controls; visual review checks model pose, head alignment and visibility. Close only owned sessions/processes.
- [ ] Run `npm test`, the new browser suites with both LEGACY_WEBVIEW values, and these existing suites against dev-dist: `npm run test:home`, `npm run test:touch`, `npm run test:inventory`, `node tests/inventory-layout.browser.mjs`, `npm run test:webview`, `npm run test:configurations`, `npm run test:multiplayer`, `npm run test:loot`, `npm run test:loot:touch`. Repeat inventory browser checks with LEGACY_WEBVIEW=1. Require no uncaught exceptions or failed game assets. Record logs and distinguish automated/headless, real browser and visual evidence.
- [ ] Verify two independent clients can still create/join/play ordinary rooms after a zombie selection, and the server rejects a raw zombie-mode request. Confirm cleanup leaves no test rooms. Commit test scripts and any verified fixes as `test: verify zombies touch lifecycle and legacy WebView`.

### Task 7: Build and publish the reviewed browser and APK

**Files:** Modify `package.json`, `package-lock.json`, `index.html`, `android/app/build.gradle`, `android/tests/package-smoke.mjs`; create `android/tests/zombies-smoke.mjs` and `docs/releases/2026-10-04-solo-zombies-verification.md`. Artifact paths below are untracked outputs, not source commits.

**Interfaces:** Release version 0.5.0, Android versionCode 6, unchanged package `au.local.blockops`. Candidate assets: `artifacts/zombies-review/dist`. New APK: `artifacts/block-ops-v0.5.0-zombies.apk`. Preserve `artifacts/block-ops-v0.4.1-byd-test.apk`, older APKs and the currently hosted snapshot. Native smoke accepts the existing `ANDROID_TEST_SERIAL`, `ANDROID_TEST_AVD`, `ANDROID_TEST_ARTIFACTS` contracts and validates an owned emulator before any device changes.

- [ ] Update version assertions in package-smoke for 0.5.0/code 6 and default candidate/APK paths, retaining package/permissions/SDK/signature/asset-byte checks. Run against the existing BYD APK with its matching old dist and verify only the intended version assertions fail. Add native zombie smoke using the established raw-CDP and adb pattern: no WebView visibility override or state injection; run only on a verified task-owned emulator.
- [ ] Bump source package/lockfile, Android version and visible footer to `v0.5.0 SOLO ZOMBIES`. Build once with `BUILD_DIR=artifacts/zombies-review/dist npm run build`. Rerun the Task 6 final matrix against this exact DIST_DIR; store test logs and hashes of all four files. If code/assets change afterwards, rebuild and rerun affected verification before packaging.
- [ ] Request an independent whole-change review with the approved spec, plan and fresh test evidence. Resolve findings with regression tests; do not merely claim agent approval. Require no unresolved blocking findings and commit reviewed source/version changes before taking the immutable release snapshot. No PR, merge or remote push is required; any GitHub work uses gh.
- [ ] Run `DIST_DIR=artifacts/zombies-review/dist APK_OUTPUT_PATH=artifacts/block-ops-v0.5.0-zombies.apk bash scripts/build-apk.sh`, then `DIST_DIR=artifacts/zombies-review/dist ANDROID_APK_PATH=artifacts/block-ops-v0.5.0-zombies.apk node android/tests/package-smoke.mjs`. Require all metadata/signature/exact-byte tests pass. Compare signing certificate identity with the previous BYD test APK so an upgrade does not unexpectedly require uninstalling it.
- [ ] Discover installed SDK, available AVDs and active emulators read-only. Use or create a disposable task-owned AVD, verify its identity and install the new APK only there. With explicit serial/AVD and artifacts environment values, run the existing `android/tests/emulator-smoke.mjs` and new `android/tests/zombies-smoke.mjs`. The latter disables networking only on that emulator and verifies packaged zombie startup, drawing, movement/fire, wave HUD, death/replay and native Back/background pause/resume. Keep that emulator until the later online check is finished, then stop only the task-owned process and preserve its AVD files. Report unavailable Android tooling as a real verification gap, not a pass.
- [ ] Stage a new immutable release directory with mktemp under artifacts, using the committed source/server/package files and copying the exact reviewed dist bytes. Validate assets and `/health` with an ephemeral server on port 0. Identify the actual current public origin, hosting PID/cmdline, port and rollback directory read-only; do not trust old PIDs from this document or a previous turn.
- [ ] Immediately before replacement, require `/health` rooms=0 and revalidate the exact server process. If occupied, wait without kicking players and continue communicating. Stop only that server, start the reviewed snapshot with a persistent task log, leave the existing tunnel intact, and keep rollback available. If the tunnel is unhealthy, diagnose it explicitly instead of claiming a deployment works.
- [ ] Verify public asset bytes, no-store headers, footer/version and an actual zombie round through Playwright CLI. Verify a two-client public online round and run existing native online smoke against the verified public TLS server when the emulator is available. Clean up owned peers/rooms; require healthy endpoint afterwards. Any failed new deployment must be recovered to the verified old snapshot using the same targeted process checks.
- [ ] Record commit, commands/results, visual evidence, browser/APK SHA-256 values, release and rollback paths, and the physical BYD limitation in the verification document. Run `git diff --check`, inspect tracked/untracked status, commit only owned release documentation and hand off the browser link plus absolute new APK path. Do not call the feature complete with a failed required check or pending deployment silently omitted.

## Execution handoff

The recommended approach for this plan is **Native**: the primary agent implements tasks in this session, then obtains an independent whole-change review before release. Runtime, combat and UI integration share several interfaces, so one implementer reduces handoffs; bounded read-only investigations and final review can still use other agents.

The alternative is **Subagent-driven**: separate implementers and reviewers handle each testable task, with task-by-task review gates and a final whole-change review. This adds independent checks earlier but more coordination and fresh contexts.

The user must review this plan and choose the execution approach before product implementation begins.
