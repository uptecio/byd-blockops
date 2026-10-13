# Shooting Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline solo shooting range with all 29 guns, five-second target respawns, saved 10/20 XP rewards and existing secret powers.

**Architecture:** A private range runtime shares the current player controls, weapon firing and world renderer without entering the public map/mode catalogues. Pure target rules, practice equipment and a local progression adapter isolate range behaviour from normal matches and multiplayer. Home, Loadout and HUD use the active session type without persisting practice selections.

**Tech Stack:** Existing JavaScript ES modules, Three.js 0.160.1, Node test runner, esbuild 0.25.12, Playwright 1.58.2 and the Android WebView wrapper. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-shooting-range-design.md`, approved 2026-10-13.

## Global Constraints

- All **29 guns**, including the Minigun, are available through Loadout.
- A normal target kill earns **10 XP**. A headshot kill or bullseye-centre kill earns **20 XP total**, not 10 plus 20.
- Target respawn uses five seconds of active simulation time; menus and background pauses stop that clock.
- Targets have 100 health. Each visit begins with full-health targets and zero session statistics.
- Practice gun selection is temporary. Returning Home restores the previous normal-match map, mode and gun selection.
- Both precision regions use the existing 10,000,000,000 headshot damage.
- Keep magazines and internal equipment values finite and valid.
- Do not change the strict profile schema or add powers/target state to it.
- No attacking enemies, timer, completion bonus, new cheats, generated art, multiplayer range or temporary all-skins unlock.
- Preserve existing PIN rules, assisted XP, 2x–5x speed and power reset behaviour; do not weaken online validation.
- Use isolated test profiles and servers. Do not overwrite release artifacts, delete app data or interrupt live rooms to run tests.

## Review Focus

1. A callback from an abandoned visit arrives after its receipt has fallen out of the 64-entry save window: no credit or session reactivation (Task 2).
2. Storage becomes unavailable or contains a newer save: play continues, saved data stays intact and the UI reports temporary/unsaved progress (Tasks 2 and 7).
3. The player switches during reload, then returns to the starter while holding FIRE: magazines/cooldowns remain valid and menus do not leak held input (Tasks 3, 5 and 7).
4. Range startup fails after world attachment: partial resources, progression and powers are cleaned up, and Home remains usable (Tasks 4–6).
5. The same game instance cycles through range, Zombies and online play: no private map, targets, ammo refill, power or stale HUD leaks into another session (Tasks 5–7).

## Workspace and task sequencing

Use the current checkout as previously chosen. Before implementation, record `git status`, HEAD and the current contents/diff of every overlapping file in a new owned evidence directory. HEAD at planning is `47d406f`; the working tree also contains uncommitted Minigun, teammate-map and Android/test changes. These are the implementation baseline, not changes to revert or claim as new range work.

Tasks 1–3 produce independently testable modules; Task 4 adds rendering; Task 5 integrates gameplay; Task 6 exposes it in the app; Tasks 7–8 verify and package it. Task 5 consumes all four earlier tasks, so shared-file integration must be serial. Do not run parallel workers editing `src/game.js`, `src/main.js` or package metadata.

For every task commit, inspect the staged diff and stage only new task files and task-owned hunks. Never `git add .`, stash the baseline, reset it, or include unrelated dirty hunks. If overlapping changes cannot be committed independently, leave them intact and report that integration constraint instead of sweeping them into a commit. The final review covers the range delta against the captured working baseline as well as the resulting whole checkout.

### File responsibilities

| Files | Responsibility |
| --- | --- |
| New `src/range-map.js`, `src/range-rules.js` | Private geometry descriptors; pure ray hits, target lives, respawns and shot statistics. |
| New `src/range-progression.js`; modified `src/progression-session.js` | Strict local range tally, target-life reward deduplication and existing save integration. |
| New `src/range-equipment.js` | Temporary all-gun selection and finite unlimited reserves. |
| New `src/range-view.js`; modified `src/world.js` | Procedural targets, pooled feedback and render-from-definition seam. |
| New `src/range-runtime.js`; modified `src/game.js` | Local session lifecycle, shared player controls and actual firing integration. |
| Modified `src/home-ui.js`, `src/main.js`, `src/match-ui.js`, `src/equipment-ui.js`, `src/progression-ui.js`, `index.html`, `src/styles.css` | Entry, session-aware UI, infinity reserve display and appearance timing. |
| New range tests; modified fixture/package tests and release metadata | Automated coverage and a separately named browser/APK candidate. |

## Task 1: Private map and target rules

**Files:** Create `src/range-map.js`, `src/range-rules.js`, `tests/range-rules.test.js`, `tests/range-map.test.js`; modify `src/gun-damage.js` only to name/export its existing headshot damage constant.

**Interfaces:**

- `RANGE_MAP` is an unregistered map definition with ID `shooting-range`, square bounds `[-30,30]`, flat ground, walls/backstops, spawn `{x:-9,z:24}`, empty `hideSpots` and traversal/access collections, and no bot spawns.
- `RANGE_TARGETS` contains six `{id,kind,x,y,z}` descriptors: lane centres x = -9/0/9, target depths z = 16/4/-16, dummy x = lane-1.3, bullseye x = lane+1.3, feet y = 0. Labels are CLOSE/MEDIUM/FAR, not misleading exact distances from a roaming player.
- `rangeTargetBounds(target) -> {min:{x,y,z},max:{x,y,z}}`; `rangeHitRegion(target, point) -> 'body'|'head'|'centre'`. Share dimensions with the renderer: dummy local x/z ±0.32, y 0.05–1.84, head strictly above 1.48; bullseye local x ±0.6, y 0.75–1.95, z ±0.05, centre x ±0.15/y 1.20–1.50 inclusive.
- `createRangeState(targets=RANGE_TARGETS) -> state` owns target health/life/respawn and counters. `rangeSnapshot(state) -> detached snapshot` exposes targets (descriptor fields plus `health`, `lifeId`, `respawnRemaining`) and `shotsFired`, `shotsHit`, `targetKills`, `precisionKills` and `accuracy` (0–100).
- `src/gun-damage.js` exports `HEADSHOT_DAMAGE=10000000000`; its existing `gunHitDamage` behaviour remains unchanged and both normal/range precision damage use this value.
- `traceRangeRay(state,{origin,direction,range,solids}) -> null|{targetId,lifeId,point,distance,region}`; `applyRangeHit(state,hit,bodyDamage) -> {landed,killed,damage,kill}` where `kill` is null or `{targetId,lifeId,region}`. `recordRangeShot(state,landed)` counts one fired shot; `tickRangeTargets(state,dt)` advances respawns only when called by active simulation.

- [ ] **Write failing rules/map tests.** Name cases `100 health and killing-hit precision`, `five active seconds per life`, `nearest target respects cover`, `pellets cannot duplicate a life`, `one accuracy hit per shot`, `invalid numeric inputs are rejected`, `private map stays out of public selectors`. Assert exact boundaries and results:

```js
assert.equal(rangeHitRegion(dummy, {x:dummy.x,y:1.48,z:dummy.z}), 'body');
assert.equal(rangeHitRegion(dummy, {x:dummy.x,y:1.481,z:dummy.z}), 'head');
assert.equal(applyRangeHit(state, bodyHit, 25).damage, 25);
assert.equal(applyRangeHit(state, headHit, 25).damage, 10000000000);
// In separate fresh cases: destroyed at t=0; still absent at 4.999; alive at 5.
assert.equal(rangeSnapshot(state).targets[0].health, 100);
assert.equal(MAPS.length, 8);
assert.equal(MAPS.some(map => map.id === 'shooting-range'), false);
```

- [ ] **Run red:** `node --test tests/range-rules.test.js tests/range-map.test.js`; expect missing exports/modules, then meaningful failing assertions, not a broken fixture.
- [ ] **Implement the declared map and rule interfaces.** Use existing `rayBoxHit`/`solidBounds` numeric helpers for occlusion. Apply damage only to a matching active life, mark destruction before returning its event, and advance life ID on respawn. Precision uses `HEADSHOT_DAMAGE`; ordinary damage is supplied after weapon falloff. Zero time is a no-op; malformed/nonfinite/negative inputs throw `RangeError` before mutation, while stale/inactive hits return `{landed:false,killed:false,damage:0,kill:null}`. Saturate integer statistics at `MAX_XP`, keeping precision≤kills and hits≤shots. Return copied snapshots. Geometry and rules have no DOM, timer or storage dependency.
- [ ] **Run green:** the new tests plus `node --test tests/maps.test.js tests/spatial.test.js`. Verify shared public map data is unchanged.
- [ ] **Commit reviewed task-only files:** `feat: add private range targets and rules`.

## Task 2: Saved range XP through local progression

**Files:** Create `src/range-progression.js`, `tests/range-progression.test.js`; modify `src/progression-session.js`, `tests/progression-session.test.js`.

**Interfaces:**

- `emptyRangeTally() -> {targetKills:0,precisionKills:0,earnedTotal:0}`; `validateRangeTally(value) -> boolean`; `awardRangeKill(tally,region) -> new tally`. Exact fields only; weighted total is capped at `MAX_XP`; unknown regions throw without mutation.
- `createRangeProgression({runId,targetIds,onEvent}) -> {kill({targetId,lifeId,region}),snapshot(),close()}` emits the existing `start/update/stop` event envelope with `modeId:'range'` and key `JSON.stringify(['solo',runId])`. `snapshot()` returns a detached tally. Target IDs are a fixed six-item allowlist; keep only the highest credited life per target.
- Existing `createProgressionSession(store).begin(key,modeId)`/`accept(key,tally)` retain their signatures. Only local solo receipt keys may begin `'range'`; dispatch their tally initialization/validation to this module. Keep `src/progression.js`, online receipt validators, profile schema and controller public API unchanged.

- [ ] **Write failing tests** for killing-hit rewards, duplicate/lower lives, close, max-XP, unknown/symbol fields, forged totals and Review Focus items 1–2. Connect the real profile store, session and controller using a Map-backed storage fixture; no renderer is required.

```js
const first = awardRangeKill(emptyRangeTally(), 'body');
assert.deepEqual(first, {targetKills:1,precisionKills:0,earnedTotal:10});
assert.equal(awardRangeKill(first, 'head').earnedTotal, 30);
assert.equal(awardRangeKill(first, 'centre').earnedTotal, 30);
assert.equal(validateRangeTally({...first, earnedTotal:20}), false);
// After duplicate kill/close/reload: store XP remains 10; a new head kill makes 30.
assert.equal(store.view().lifetimeXP, 30);
```

- [ ] **Run red:** `node --test tests/range-progression.test.js tests/progression-session.test.js`.
- [ ] **Implement the declared adapter and local validator dispatch.** Emit `start` before any kill and `stop` exactly once. Reject events for closed/unknown target lives; do not call `finishTally`. Credit each cumulative update immediately through `progression.solo(event)`. Test an abandoned producer after 65 newer sessions: it emits nothing and cannot replay an evicted receipt. Test storage throwing then recovering, failed writes, backup recovery and future-save preservation through unchanged store APIs. A new store using the same saved bytes must show identical XP and cosmetic ownership.
- [ ] **Run green:** `node --test tests/range-progression.test.js tests/progression*.test.js tests/profile*.test.js`; normal and network tallies must still reject `'range'` and range-only fields.
- [ ] **Commit task-owned hunks:** `feat: persist shooting range rewards without match bonuses`.

## Task 3: All-gun practice inventory and ammunition

**Files:** Create `src/range-equipment.js`, `tests/range-equipment.test.js`.

**Interfaces:** `createRangeEquipment(startingGunId) -> Equipment`; `equipRangeGun(equipment,weaponId,{source}) -> {ok,reason?}`; `replenishRangeReserves(equipment) -> void`. Use current Equipment and weapon state shapes, with no added DTO fields.

- [ ] **Write failing tests:** iterate all 29 `WEAPONS`; ordinary firing empties magazines, `startReload` plus `tickEquipment` takes exactly each gun's `reloadTime`, and repeated reloads never exhaust reserves. Test starter→Minigun→starter, unknown gun/source, outgoing partial reload cancellation and normal powered/unpowered transitions.

```js
assert.equal(WEAPONS.length, 29);
assert.equal(equipRangeGun(e, 'minigun', {source:'armory'}).ok, true);
assert.equal(equipRangeGun(e, 'm4a1', {source:'armory'}).ok, true);
assert.equal(e.owned.get('m4a1').ammo, remainingStarterAmmo);
assert.deepEqual(equipmentDTO(equipmentFromDTO(equipmentDTO(e))), equipmentDTO(e));
assert.ok([...e.owned.values()].every(s => Number.isFinite(s.reserve) && s.ammo+s.reserve<=500));
```

- [ ] **Run red:** `node --test tests/range-equipment.test.js`.
- [ ] **Implement the adapter.** Validate IDs against the catalogue rather than `getWeapon`'s fallback. Lazily create states with full magazines; switching cancels unfinished reloads but preserves ammo and cooldowns. Retain the starter in `owned`; set the existing `startingGunRemoved` flag on the first nonstarter switch to satisfy current DTO invariants. Inventory-source selection still requires ownership. Set reserve to `TOTAL_AMMO-ammo`, never refill magazines here. Keep normal `equipGun`, `tickEquipment`, fire/reload functions and `replenishPoweredMagazine` unchanged.
- [ ] **Run green:** `node --test tests/range-equipment.test.js tests/equipment.test.js tests/weapons.test.js tests/solo-powers.test.js tests/minigun.test.js`.
- [ ] **Commit task-only files:** `feat: add finite unlimited-reserve practice equipment`.

## Task 4: Private world rendering and bounded hit feedback

**Files:** Modify `src/world.js`; create `src/range-view.js`, `tests/range-view.test.js`, `tests/range-world.test.js`.

**Interfaces:** `createWorldFromDefinition(THREE,scene,definition) -> existing world return shape`; existing `createWorld(THREE,scene,mapId)` delegates after `getMap`. `createRangeView(THREE,scene,{targets,createCanvas=()=>document.createElement('canvas')}) -> {sync(snapshot),hit({targetId,point,damage,region}),update(dt,camera),dispose()}` consumes Task 1 descriptors/snapshots. No render method may change target health or emit XP. Canvas creation is a dependency seam, not a gameplay hook.

- [ ] **Write failing tests** using real Three.js math/scene objects, not a WebGL renderer. Assert public world output remains equivalent, all six target models align with rule bounds/precision regions, dead models hide, respawns show, and repeated disposal is safe. Assert no more than 12 damage labels exist after 1,000 hits and all expire after 0.8 active seconds. Test an attachment failure cleans partial objects and allocated resources.
- [ ] **Run red:** `node --test tests/range-view.test.js tests/range-world.test.js`.
- [ ] **Implement the renderer seam and view.** Use procedural boxes, flat contrasting bullseye squares and labelled lanes. Validate spatial data before attaching. Pool 12 reusable label sprites/canvases; reuse textures, replacing the oldest label when full. Labels show rounded ordinary damage, `10B HEADSHOT` or `10B HEADSHOT · CENTRE`. Avoid any canvas/DOM work during module import; headless tests inject a canvas stub at view construction. Dispose owned geometry, materials, textures and groups exactly once, including failed construction. Keep targets outside `world.botGroup` and explicitly owned by the view.
- [ ] **Run green:** new tests and `node --test tests/minigun-model.test.js tests/skins.test.js tests/maps.test.js`.
- [ ] **Commit only task-owned hunks:** `feat: render practice arena and pooled damage feedback`.

## Task 5: Integrate the live solo range runtime

**Files:** Create `src/range-runtime.js`, `tests/range-game.test.js`; modify `src/game.js`, `tests/helpers/game-fixture.js`.

**Interfaces:**

- `RangeRuntime(game)` exposes `start(weaponId,settings)`, `update(dt)`, `beginShot()`, `resolvePellet({origin,direction,weapon}) -> {landed,killed,hitPoint}`, `finishShot()`, `requestEquipment(action)`, `refreshView()`, `dispose()`.
- Add `ArenaGame.startRange(weaponId,settings={},powers=null)` and catching `tryStartRange(...) -> {ok,reason?}`. Private runtime session identity is `game.modeState={kind:'range',ended:false}`; settings are local `modeId:'range',mapId:'shooting-range',progressionSource:'solo'`. Do not add `'range'` to normal mode constructors/catalogues.
- Extract existing `stepPlayerControls(dt,input,actors,{allowGear=true,wasHidden=false}={})` and `stepCombatFeedback(dt)` methods. The first owns the existing live-player movement/aim/reload/fire/held-model block; the second owns muzzle/hit/damage flashes and tracer aging. Normal `simulateStep` calls both at their existing positions.
- Range `matchView` uses `modeId:'range',mapId:'shooting-range'`, keeps existing wrapper fields (`players`, empty `flags`, scores, `ended:false`) and adds `range:{targetKills,shotsFired,shotsHit,accuracy,earnedXP}`; `match` stays nonended without a countdown. `earnedXP` comes from Task 2's tally, not a second reward implementation.

- [ ] **Write failing headless integration tests** using `createHeadlessGame` and real Input. Exercise every gun via successful `tryFire`, real rays, wall blocking, body/head/centre kills, pause and five-second respawn. Assert no bots/loot/objectives, no timer finish after 181 active seconds, 10/20 credit, cheats on/off, unchanged normal modes and online rejection. Add Review Focus startup failure and range→Zombies→online→range cycles. Pin core assertions:

```js
assert.equal(game.tryStartRange('m4a1', {progressionSource:'solo'}).ok, true);
assert.equal(game.bots.length, 0);
assert.equal(game.lootState, null);
assert.equal(game.modeState.kind, 'range');
assert.equal(game.tryStartRange('m4a1', {progressionSource:'online'}).ok, false);
// Fresh independent case after active range updates totalling 181 seconds:
assert.equal(game.match.ended, false);
```

- [ ] **Run red:** `node --test tests/range-game.test.js`.
- [ ] **Implement shared seams and runtime startup/disposal.** Validate solo source and gun/appearance before attaching resources. Refactor existing map-load cleanup into `loadWorldDefinition(definition,{practice=false}={})`; normal `loadMap(mapId)` validates via `getMap` then delegates. Practice creates the private world but no navigation/objectives/loot. Initialize player/equipment directly with `createBody`, skin/finish, health 100, armour 0, dead 0, life 1, no hiding/climbing, reset view/input/gear counters, then open progression and apply powers to the exact live session identity. Dispose any previous range at normal start, range start and quit. Close its progression and never call normal `finishRound` on practice exit. Make cleanup idempotent, including world/target disposal after partial failures; a subsequent start must build a fresh world successfully. In headless tests install/restore a test-only document/canvas stub during view construction; in view unit tests use the explicit canvas factory seam.
- [ ] **Implement range simulation and firing integration.** Active range updates use substeps no larger than `min(.05, weapon.fireInterval)`. Advance respawns and weapon cooldown/reload, replenish reserves, then call shared player controls with `allowGear:false`; retain common rendering/HUD and normal powers. Do not call bot/loot/objective/timer code. `update` dispatches to the range runtime and skips ordinary `refreshGearView` (which assumes objectives exist); `refreshMatchView` dispatches to range `refreshView`, and `finishRound` is a no-op for practice. `shoot` retains actual spread, pellets, audio, tracer and recoil; bracket its pellet loop with range `beginShot`/`finishShot`, and use `resolvePellet` only instead of bot/proxy hit resolution. Apply existing shotgun/SMG falloff before Task 1 damage, emit Task 2 kills synchronously and count accuracy once per fired shell/bullet. Clear held controls on pause/exit; do not simulate background wall-clock gaps. Reject practice configuration at ordinary/online start seams and return false for practice enemy checks.
- [ ] **Run green and regression:** `node --test tests/range-game.test.js tests/solo-powers-game.test.js tests/zombie-game.test.js tests/zombie-recovery.test.js tests/vertical-runtime.test.js tests/access-runtime.test.js`. Check each new test really exercises the live hooks, not a parallel fake simulation. Add range cleanup to `cleanupGame` without changing other fixtures' behaviour.
- [ ] **Commit reviewed runtime hunks:** `feat: integrate offline shooting range with real gun controls`.

## Task 6: Home entry, Loadout and practice HUD

**Files:** Modify `src/home-ui.js`, `src/main.js`, `src/match-ui.js`, `src/equipment-ui.js`, `src/progression-ui.js`, `index.html`, `src/styles.css`; create `tests/range-ui.test.js`; extend `tests/equipment-menu.test.js`, `tests/progression-ui.test.js`.

**Interfaces:** `HomeUI` receives `onRange`; new control ID `home-range`. `deployRange()` is a local main.js handler. `match-ui` recognizes `view.range` before public mode lookup. `EquipmentUI` gains optional `isUnlimitedReserve:()=>boolean` (default false), separate from existing `isUnlimitedAmmo`. Range HUD IDs: `range-stats`, `range-kills`, `range-accuracy`, `range-xp`.

- [ ] **Write failing UI tests** asserting Home action binding, practice bypass of public map/mode lookups, controls reset when leaving, all-gun selection availability and the separate ammo indicators. Use existing menu/DOM fixtures. For a range view with zero shots/kills/XP expect `Shooting Range`, `0% (0/0)` and no timer; for 2 hits/4 shots expect `50% (2/4)`. Reload remains enabled with unlimited reserves but not with the no-reload power. Appearance selected mid-range is labelled `Next visit`, not `Next respawn`.
- [ ] **Run red:** `node --test tests/range-ui.test.js tests/equipment-menu.test.js tests/progression-ui.test.js`.
- [ ] **Implement entry and session-aware presentation.** Guard `deployRange` for focused Home, no fatal/background/live/online/busy state; consume pending powers exactly as normal solo start does. Never mutate persisted `selection`. On failure restore Home and show the existing error toast. Add early practice branches in HUD, Armory and teammate-map rendering; hide team map, normal score/timer, grenades/knife and empty loot strip while practising. Show target kills, session XP, accuracy, normal magazine and infinity reserve; leave no-reload presentation tied to its actual power. Pause/Loadout keep existing explicit Resume/Equip & Return behaviour. Home confirmation says ending practice and keeping earned XP. On departure restore `selected`/`activeClass` from normal selection as well as the preview; new cosmetic choices may still persist through normal ownership checks. Use existing accessible buttons/focus rules, minimum 44px targets and legacy-safe CSS; do not cover fire/aim controls with feedback.
- [ ] **Run green:** new tests plus `node --test tests/equipment-input.test.js tests/solo-powers-presentation.test.js tests/teammate-map.test.js`; build isolated assets for Task 7.
- [ ] **Commit reviewed task hunks:** `feat: expose shooting range and practice stats on Home`.

## Task 7: Real browser acceptance and regression evidence

**Files:** Create `tests/shooting-range.browser.mjs`, `tests/shooting-range-layout.browser.mjs`, `tests/shooting-range-online.browser.mjs`, `tests/helpers/range-browser.js`; modify `package.json` to add `test:shooting-range`; update `README.md` with user-facing access/reward/save rules.

**Interfaces:** Tests accept `DIST_DIR`, `ARTIFACT_DIR`, `LEGACY_WEBVIEW=1`. Reuse `persistentFixture`, `readProfile`, `goHome`, `equip`, `touchControls`, `openPowers`, `choosePowers`, `fixture` and `onlinePair` from current helpers. New `enterRange(page)`, `aimAtRangeTarget(page,targetId,region)` and `fireRangeKill(page,targetId,region)` use real UI/input and passive target/camera observations only; no teleporting, forcing kills, seeding XP or production automation hook.

- [ ] **Write acceptance tests before fixing any integration gaps.** Assert a real normal kill adds 10, dummy head adds 20 and bullseye centre adds 20; XP reads 50 after those three kills. Repeat real kills to cross level 2 at 150 XP, equip the legitimately unlocked skin, and verify reload plus full persistent-context reopen retains XP/skin/PIN but resets powers. Test actual menu/background pause, five active-second respawn, switching all 29 guns/back to starter, sustained Minigun touch fire/release/reload, no-reload cheat, 5x movement against a wall, accuracy≤100, no exit bonus and restored normal map/mode/gun. Inject storage failures only at the storage seam and assert unsaved status without losing saved bytes. Verify Home and normal play recover after a one-shot range view allocation failure in an isolated test fixture.
- [ ] **Run tests against the first integrated build and record failures.** Use an owned directory, retaining its resolved absolute path for all later steps:

```bash
range_evidence="$(mktemp -d /home/alex/Documents/git/bydgame/artifacts/shooting-range-XXXXXX)"
range_dist="$range_evidence/reviewed-dist"
GAME_SERVER_URL="" BUILD_DIR="$range_dist" npm run build
DIST_DIR="$range_dist" ARTIFACT_DIR="$range_evidence/range-modern" node tests/shooting-range.browser.mjs
```

- [ ] **Add layout/online scenarios and resolve proven gaps.** Layout tests use 854x480 and 1024x600, control scales 0.8/1.3, touch FIRE/MOVE/JUMP together, reachable modal controls, overlap/focus checks and screenshots. Legacy masking must show real WebGL1 draw calls with no lost contexts. Visit range then normal solo/Zombies and a two-player online room: normal ammo/damage/protocol 8, eight public maps, no range mode/packets, no powers or labels leaking. Cycle range 20 times and assert live GPU resources and feedback node counts return to a stable plateau, not growth each visit. Online peers and servers are test-owned and closed in `finally`.
- [ ] **Run acceptance green on modern and legacy builds.** Run all three new scripts with unique artifact directories; repeat with `LEGACY_WEBVIEW=1`. Capture exact command/exit/result logs, screenshots and asset hashes. Use native background callback tests as well as browser visibility/focus transitions; masking is not a physical BYD test.
- [ ] **Run fresh regression commands against `DIST_DIR="$range_dist"`:** `npm test`, then existing `test:minigun`, `test:solo-powers`, `test:progression`, `test:progression:modes`, `test:progression:online`, `test:inventory`, `test:loot`, `test:loot:touch`, `test:zombies`, `test:teammate-map`, `test:rooftops`, `test:tall-roofs`, `test:tall-roofs:online`, `test:hiding:online`, `test:hiding:layout`, `test:multiplayer`, `test:configurations`, `test:webview`. Use each suite's supported artifact option or a fresh owned source snapshot for hardcoded output paths. Run GPU-heavy suites serially. Do not describe the old 1,328-test Minigun result as fresh range evidence.
- [ ] **Commit test/documentation hunks:** `test: verify range XP controls saves and online isolation`.

## Task 8: Versioned candidate, offline Android and delivery review

**Files:** Modify `package.json`, `package-lock.json`, `android/app/build.gradle`, `index.html`, `android/tests/package-smoke.mjs`, relevant assertions in `tests/build-output.test.js`; create `android/tests/shooting-range-smoke.mjs`. Preserve existing package release selectors.

**Interfaces:** Candidate application version `0.10.0`, Android versionCode 14 and footer `v0.10.0 · SHOOTING RANGE`, provided the execution-time metadata is still 0.9.2/code 13; resolve any intervening release before assigning a conflicting identity. Network protocol stays 8. Add `ANDROID_PACKAGE_RELEASE=shooting-range`. Native test reads `ANDROID_TEST_SERIAL`, `ANDROID_TEST_AVD`, `ANDROID_APK_PATH`, `ANDROID_BASELINE_APK_PATH`, `ANDROID_TEST_ARTIFACTS`.

- [ ] **Write failing packaging/native assertions.** Package smoke must require candidate metadata, exactly the four tested assets, unchanged minSdk26/targetSdk36, INTERNET-only permission, existing signer and local appassets origin. Keep baseline/solo-powers/minigun selectors and rejection of conflicting selectors. Native scenario uses `nativeProgressionFixture`: baseline install→earn XP/save selections/PIN via UI→candidate `install -r`→byte-identical previous saves→real range rewards→offline force-stop/relaunch. Reinstalling the same candidate retains earned saves; powers reset while XP/skin/PIN remain.
- [ ] **Run package-selector/unit assertions red, then update release identity and selectors.** Do not weaken old selectors to accept arbitrary versions. Do not run old metadata-hardcoded native scenarios unchanged and label them range coverage.
- [ ] **Freeze the final source and build fresh reviewed assets.** Create a new owned packaging snapshot from an explicit allowlist including required dirty-baseline sources, excluding secrets, profiles, caches and Android outputs. Record hashes and the range baseline/delta. Build and rerun Task 7 acceptance plus affected/full unit tests against these final assets. Preserve both previous artifacts and the 0.9.2 baseline APK at `artifacts/minigun-sdh0NU/block-ops-v0.9.2-minigun.apk`; verify its identity/hash before use. No `npm run apk` because it silently rebuilds default `dist`.
- [ ] **Package from the owned snapshot, using resolved paths from this run:**

```bash
DIST_DIR="$range_dist" APK_OUTPUT_PATH="$range_apk" bash scripts/build-apk.sh --offline lintDebug
DIST_DIR="$range_dist" ANDROID_APK_PATH="$range_apk" ANDROID_PACKAGE_RELEASE=shooting-range node android/tests/package-smoke.mjs
```

`range_apk` is a new absolute path ending `block-ops-v0.10.0-shooting-range.apk`. `range_dist` points to the final reviewed assets, not Task7's superseded pre-version build. `build-apk.sh` writes Android asset/build directories, so APK_OUTPUT_PATH alone is not isolation. Require successful packaging, lint and byte/signature checks before installation.

- [ ] **Run Android acceptance on an explicitly owned AVD.** Verify the emulator serial/AVD pair before any install; never use an attached physical head unit or clear existing app data. With validated owned `range_serial`, `range_avd` and baseline path:

```bash
ANDROID_TEST_SERIAL="$range_serial" ANDROID_TEST_AVD="$range_avd" ANDROID_APK_PATH="$range_apk" ANDROID_BASELINE_APK_PATH="$range_baseline_apk" ANDROID_TEST_ARTIFACTS="$range_evidence/android" node android/tests/shooting-range-smoke.mjs
```

Assert packaged `https://appassets.androidplatform.net/assets/index.html`, Wi-Fi/mobile data off, visible map/targets, real 10/20 rewards with powers on/off, touch/reload/Loadout, Android Back and actual background/foreground requiring Resume, saved progression after relaunch and restored normal selections. Report unsupported environment/device checks explicitly; emulator success does not establish physical BYD compatibility.

- [ ] **Review and deliver only verified artifacts.** Run `git diff --check`, inspect the range delta, obtain independent whole-change review and address findings with regression tests. Record exact APK/browser hashes, signatures, command outcomes and known limitations; rebuild/retest anything changed after freezing. Commit task-owned release/test hunks as `release: package verified shooting range candidate`. Link the candidate APK and isolated browser preview, with physical BYD testing still separate. Do not restart the live server, publish, push or merge without the required separate direction.

## Plan review and execution choice

This plan awaits user review. Recommended approach: **subagent-driven**, with independent reviews of target rewards, save handling and shared-runtime integration before packaging; these changes touch persistent progress and a game engine also used online. Native execution remains available if the user prefers one implementer and a final independent review. No product implementation begins until the user confirms the plan and execution method.
