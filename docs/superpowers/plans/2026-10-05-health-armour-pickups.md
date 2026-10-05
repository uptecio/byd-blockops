# Health and Armour Pickups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add carried health/armour packs to all eight maps and applicable solo/online modes, with five-second use, fair bot behaviour and the existing single numbered inventory.

**Architecture:** Extend shared equipment and loot with strict supply state, and share pure vitals/use rules between the solo simulation and authoritative room server. Runtime adapters own time, death and recovery ordering; the existing inventory/HUD and lightweight loot models present acknowledged state. No account, dependency, new inventory screen or unrelated gameplay system is introduced.

**Tech Stack:** JavaScript ES modules, Three.js 0.160.1, ws 8.21.0, Node test runner, Playwright 1.58.2 and installed Playwright CLI, esbuild 0.25.12, Android Java 17/Gradle WebView wrapper.

**Spec:** `docs/superpowers/specs/2026-10-05-health-armour-pickups-design.md` (user approved 2026-10-05).

## Global Constraints

- Health pack: carry limit 3; use time 5 simulation seconds; restore health to 100.
- Armour pack: carry limit 3; use time 5 simulation seconds; add 50 armour, capped at 100.
- Full health does not stop collecting health packs; the capacity is the collection limit.
- Getting hit does not interrupt the five-second timer. Damage still applies normally and can kill the user.
- Armour takes damage before health; knife 50, explosive maximum 90, gun headshots exactly 10,000,000,000, zombie damage `10 + 5 * (wave - 1)` with no cap remain unchanged.
- Two health-pack slots and two armour-pack slots per map; 20-second map respawn; 20 map slots, 48 drops, 68 total loot records; retain other world bounds.
- Reuse pickup radius 1.2, vertical reach 0.75, drop unlock 0.5 seconds and expiry 30 seconds. Preserve all existing loot coordinates/identities and starter-gun rules.
- Same top-left numbered inventory; movement and looking available during use; guns, knife swings, grenade throws and starting reloads blocked. Successful equipment selection cancels without spending.
- All eight maps, solo FFA/TDM/CTF and Zombies, online FFA/TDM/CTF. No online zombies/bots, map redesign, skin changes or later roadmap features.
- Preserve ES2017 output, WebGL1 and legacy CSS/DOM fallback paths; Android minSdk 26, target/compileSdk 36, INTERNET only, existing signing identity.
- Wire protocol 4; incompatible clients get the existing update-required message. The server owns inventory, elapsed use time, health, armour and damage.
- Respect the current-checkout preference, but inspect the execution environment through using-git-worktrees before work. Baseline at planning: source `171367c`, approved-spec commit `734f864`; record the actual execution base anew.
- Preserve unrelated `.gitignore`, `README.md`, skill directories/lockfile, Playwright files and photographs. No broad staging, destructive reset, remote push or merge.
- No implementation/build/deploy until the user reviews this plan and chooses an execution method. Tasks below describe future work, not completed checks.

## Review Focus

1. A held Fire pointer/key plus a moving joystick when use begins: movement must continue and held/repeated attack input must not replay on completion (Tasks 3, 5).
2. A stale inventory gesture or acknowledgement crossing death, respawn or room change: it must not use a new life's pack or play an old completion cue (Tasks 4, 5).
3. A final-zombie kill, recovery heal and due pack on the same step, or fatal damage during that step: no wasted health pack and no revival (Task 3).
4. Twenty map pickups plus 48 death drops: the renderer must show all 68 permitted records, including supplies beyond the old index-64 cutoff (Tasks 2, 5).
5. Pause/background and variable frame lengths: five seconds means simulation time offline and server time online; no early completion, double ticking or wall-clock catch-up (Tasks 1, 3, 4, 6).

## File map and execution boundaries

| Owner | Files / responsibility |
| --- | --- |
| Task 1 | New `src/vitals.js`, `src/supplies.js`: pure damage/use/bot-choice contracts; corresponding unit tests |
| Task 2 | `src/equipment.js`, `src/equipment-catalog.js`, `src/loot.js`, `src/loot-spawns.js`, new `src/loot-labels.js`: supply ownership, DTOs, map slots, drops, labels and shared world bounds |
| Task 3 | `src/game.js`, `src/zombie-runtime.js`, `src/bot-brain.js`, `src/input.js`: solo/bot integration, input latches and recovery ordering |
| Task 4 | `server/rooms.js`, `src/protocol.js`, `src/gear-protocol.js`, `src/network.js`, `src/online-game.js`: authority, strict wire compatibility and reconciliation |
| Task 5 | `src/equipment-ui.js`, `src/main.js`, `index.html`, `src/styles.css`, `src/gear-view.js`, `src/audio.js`: HUD, supply art, feedback and touch interaction |
| Task 6 | New browser/native supply acceptance, existing compatibility/version fixtures, `package.json`, `package-lock.json`, `android/app/build.gradle`: verified 0.6.0 candidate / Android code 8 |
| Task 7 | New release verification document and isolated operational evidence: whole-change review, candidate validation, controlled delivery and handoff |

Tasks run in order; their shared interfaces make parallel source edits unattractive. Independent read-only checks and isolated test processes can run concurrently where ownership permits. Shared Android build outputs and adb forward 9228 require serial access. Read both the spec and this plan before executing a task.

Every task records its actual red/green commands and exit status, then commits only its explicit files after review. Intermediate commits are not deployable releases; focused tests establish each deliverable, and the complete cross-mode regression gate is mandatory before delivery. Do not weaken existing tests to conceal an integration failure.

Before Task 1's first test, create an evidence root with `mktemp -d /home/alex/Documents/git/bydgame/artifacts/health-armour-XXXXXX` and record its exact absolute path as `SUPPLY_REVIEW_DIR`. Every subsequent shell invocation must receive that recorded path explicitly; never assume variables persist between tools. After Task 2 adds its test-output override, all unit-test commands below also receive `LOOT_ARTIFACTS="$SUPPLY_REVIEW_DIR/unit-loot/<run-name>"`, using a new named directory for each run. This prevents the real-socket saturation test from overwriting prior release evidence. These are test/build output variables, not system directory variables.

### Task 1: Shared vitals and supply-use rules

**Files:** Create `src/vitals.js`, `src/supplies.js`, `tests/vitals.test.js`, `tests/supplies.test.js`.

**Interfaces:**

- `damageVitals(vitals, amount) -> { ok:true, healthDamage, armourDamage, killed } | { ok:false, reason }`, in `vitals.js`. Mutates only `vitals.health/armour` for accepted finite non-negative damage. Missing armour means zero for existing zombie actors; invalid present vitals reject without mutation. Health/armour stay within 0–100.
- `SUPPLY_TYPES = ['health','armour']`, frozen `SUPPLY_BALANCE = { capacity:3, useSeconds:5, armourGain:50 }`, `SUPPLY_NAMES = { health:'Health Pack', armour:'Armour Pack' }`.
- `createSupplyState() -> { supplies:{ health:0, armour:0 }, supplyUse:null }` returns detached mutable state.
- `startSupplyUse(equipment, vitals, supplyType, { active, alive }) -> { ok:true } | { ok:false, reason }`. Requires ownership/need, active living actor, active-gun reload zero, `attackLockRemaining` zero and `meleeRemaining` zero. A valid other-type start replaces the operation atomically; same-type repeat rejects without resetting.
- `cancelSupplyUse(equipment) -> { ok:true, changed:boolean }`; safe no-op when idle.
- `advanceSupplyUse(equipment, vitals, dt, { active, alive }) -> { status:'idle'|'pending'|'completed'|'cancelled', supplyType:null|'health'|'armour' }`. Advances and commits once, after runtime damage/recovery. Invalid/non-positive dt does not advance; inactive/dead state cancels without consumption. No zero-remaining active state escapes. Floating-point tolerance must not grant meaningful time early.
- `isUsingSupply(equipment) -> boolean`; `chooseBotSupply(actor) -> 'health'|'armour'|null`, with health-first threshold 50, armour threshold 50, no decision while flashed/dead/already using. Actor contains health, armour, alive, flashRemaining and equipment. Bot policy does not move, grant loot or bypass start validation.
- No module here imports UI, Three.js, sockets or equipment.js. Use plain equipment shapes and constants to avoid a circular import when Task 2 imports these helpers.

- [x] **Step 1: Add failing rule tests with literal expectations.** Construct real baseline equipment using `createEquipment('m4a1')` and merge `createSupplyState()` in the test; grant counts only in unit fixtures. Include these assertions in named tests:

```js
// 'damage consumes armour before health'
const v = { health:100, armour:20 };
assert.equal(damageVitals(v, 30).ok, true);
assert.deepEqual(v, { health:90, armour:0 });
// 'five seconds consumes one health pack once'
const e = Object.assign(createEquipment('m4a1'), createSupplyState());
e.supplies.health = 2; const hurt = { health:12, armour:0 };
const live = { active:true, alive:true };
assert.equal(startSupplyUse(e, hurt, 'health', live).ok, true);
assert.equal(advanceSupplyUse(e, hurt, 4.999, live).status, 'pending');
assert.equal(hurt.health, 12); assert.equal(e.supplies.health, 2);
assert.equal(advanceSupplyUse(e, hurt, .001, live).status, 'completed');
assert.equal(hurt.health, 100); assert.equal(e.supplies.health, 1);
assert.equal(advanceSupplyUse(e, hurt, 5, live).status, 'idle');
```

Add named table tests: `'armour adds fifty and caps'` expects 0→50, 50→100 and 90→100; `'invalid damage is inert'` rejects -1/NaN/Infinity; `'fatal headshot through armour'` expects health=0/armour=0 for 10,000,000,000; `'no resource waste'` retains count at full start/completion; `'hit preserves use'` retains operation after nonfatal damage; `'dead completion cannot heal'` retains zero health; `'cancel and type switch'` retains counts, new timer=5, invalid switch preserves old timer; `'duplicate start cannot postpone finish'` preserves remaining time; `'reload/melee/throw gate'` rejects positive relevant timers; `'bot priority and exclusions'` checks thresholds 50/51 and flash/active/dead. Compare one 5-second advance with 100×0.05; test zero, negative and non-finite dt explicitly.

- [x] **Step 2: Run red.** `node --test tests/vitals.test.js tests/supplies.test.js` must fail for missing exports/behaviour, not a broken fixture.
- [x] **Step 3: Implement exactly the interfaces above.** Apply armour before health; defer pack consumption until successful completion; use new operation objects for accepted starts so runtimes can identify operations created mid-step.
- [x] **Step 4: Run green.** Repeat the focused command; all assertions pass, including no mutation on rejected calls. Inspect dependency direction.
- [x] **Step 5: Commit explicit Task 1 files.** Message: `feat: add shared armour and timed supply rules`.

### Task 2: Carried supplies, authored pickup slots and bounded drops

**Files:** Modify `src/equipment.js`, `src/equipment-catalog.js`, `src/loot.js`, `src/loot-spawns.js`, `src/game.js` and `src/online-game.js` (pickup-label branches only), `tests/equipment.test.js`, `tests/loot.test.js`, `tests/loot-placement.test.js`, `tests/loot-saturation.test.js`; create `src/loot-labels.js`, `tests/supply-loot.test.js`.

**Interfaces:** Consume Task 1 state/constants and cancellation. Existing `createEquipment`, `pickupEquipment`, `equipmentDTO`, `equipmentFromDTO`, `clearEquipment`, `resetEquipment`, `deathItems`, `equipGun`, `setHeldItem`, `selectGrenade` retain signatures, adding `supplies` and `supplyUse` as specified. Existing `createLootState`, `collectLoot`, `lootDTO` retain signatures and support exact `{ kind:'supply', supplyType }` items. Add `GEAR_BALANCE.maxMapLoot=20` and `GEAR_BALANCE.maxLoot=68`, retaining `maxDrops=48`; validators/renderers use these names in later tasks.

`lootItemLabel(item) -> string` in `loot-labels.js` explicitly handles all known kinds, returning `HEALTH PACK` / `ARMOUR PACK` for supplies and retaining old gun/knife/grenade labels. Invalid kinds throw rather than silently becoming grenades. This is needed before runtime pickup tests, not deferred to the HUD task.

- [x] **Step 1: Write failing ownership, DTO and collection tests.** Named assertions:

```js
// 'supplies stack independently without equipping'
const e = createEquipment('m4a1');
for (let i=0;i<3;i++) assert.equal(pickupEquipment(e,{kind:'supply',supplyType:'health'}).ok,true);
assert.equal(pickupEquipment(e,{kind:'supply',supplyType:'health'}).ok,false);
assert.equal(pickupEquipment(e,{kind:'supply',supplyType:'armour'}).ok,true);
assert.deepEqual(e.supplies,{health:3,armour:1});
assert.equal(e.activeGunId,'m4a1'); assert.equal(e.startingGunRemoved,false);
assert.equal(deathItems(e).filter(i=>i.kind==='supply').length,4);
```

`'strict detached DTOs'`: round-trip active use at 2.5 seconds, mutate returned counts/use and assert source unchanged; reject extra/missing keys, unknown types, counts -1/1.5/4, timers 0/5.001/NaN and active use with zero stock. `'empty inventory has no supplies/use'`: dead DTO with remaining packs/use rejects. `'successful selection cancels, denied selection preserves'`: cover gun, knife and grenade. `'refill preserves supplies/use'`: recovery ammo refill retains both fields. `'nearest eligible winner'`: full nearest actor loses to eligible next actor; reversed actor order does not duplicate a pack. `'pending pack occupies capacity'`: capacity remains three until completion. `'one-life death drops'`: pending use drops all unused packs once, 0.5-second unlock/30-second expiry, 48-drop saturation enforced.

- [x] **Step 2: Add all-map red placement checks.** Expect 20 unique frozen slots, counts `[8,2,6,4]` for gun/knife/grenade/supply, and two of each supply. Check radius 0.42 clearance, reachability, >1.2 distance from all spawns/bases, >=3 distance from other loot, >=10 same-type spacing, rotated counterpart, and <=4 sorted red/blue walking-distance difference per supply type. Keep old-coordinate tests, changing their filter to knife/grenade explicitly rather than deleting assertions. Test 19.999 seconds absent / 20 seconds restored. Add `'supply labels do not use grenade fallback'`, asserting `lootItemLabel({kind:'supply',supplyType:'health'})==='HEALTH PACK'` and the armour equivalent. Make saturation's output root `process.env.LOOT_ARTIFACTS || 'artifacts/loot-review'` before running it, preserving all gameplay assertions. Run `node --test tests/equipment.test.js tests/loot.test.js tests/loot-placement.test.js tests/loot-saturation.test.js tests/supply-loot.test.js` with the explicit artifact override; capture real failures.
- [x] **Step 3: Extend state and item branches.** Deep-copy/strictly validate supply DTO fields; clear state on death/reset; append supply death items without dropping applied armour. Perform cancellation only after successful existing selection. Keep grenade capacity separate. Author four valid fixed locations per map under the tested constraints; do not move existing records. Do not tick supply use inside `tickEquipment`. Implement shared labels and replace both runtime pickup-toast fallbacks so supply collection cannot call `undefined.toUpperCase()` before the later visual task.
- [x] **Step 4: Run the focused command green.** Preserve previous gun spacing, seeded assignments, grenade, starter coverage and saturation assertions; record selected coordinates as source data, not a runtime search.
- [x] **Step 5: Commit explicit Task 2 files.** Message: `feat: add carried supply loot across all maps`.

### Task 3: Solo, bot and zombie runtime integration

**Files:** Modify `src/game.js`, `src/bot-brain.js`, `src/zombie-runtime.js`, `src/input.js`, `tests/helpers/game-fixture.js`, `tests/equipment-input.test.js`, `tests/bot-brain.test.js`, `tests/zombie-game.test.js`, `tests/zombie-recovery.test.js`; create `tests/supply-solo.test.js`.

**Interfaces:** Consume Task 1 helpers and Task 2 equipment/loot. Extend `ArenaGame.requestEquipment(action)` / `applyEquipmentAction(actor, action)` with `{kind:'use-supply',supplyType}` and `{kind:'cancel-supply'}` while retaining the `{ok,reason?}` result. `getActors()` adds health/armour projections; mutations target `actorEntity(id)`, never the projection. Add `Input.clearCombat() -> void`: clear queued/held attacks and reload, preserve joystick/movement/look/jump/zoom, and require release/new press before a previously held combat key/pointer can fire again. Existing full `clear()` still resets all input.

- [x] **Step 1: Write failing real-runtime tests using `createHeadlessGame()` and `cleanupGame(game)`.** Name and assertions:

```js
// 'moving supply use keeps the starter and completes after five seconds'
game.start('m4a1',{bots:0}); game.player.health=10;
pickupEquipment(game.player.equipment,{kind:'supply',supplyType:'health'});
assert.equal(game.requestEquipment({kind:'use-supply',supplyType:'health'}).ok,true);
game.input.keys.add('KeyW'); const beforeZ=game.player.z;
game.update(4.999); assert.equal(game.player.health,10);
assert.notEqual(game.player.z,beforeZ); assert.equal(game.weaponState.ammo,30);
game.update(.001); assert.equal(game.player.health,100);
assert.equal(game.player.equipment.supplies.health,0);
assert.equal(game.player.equipment.startingGunRemoved,false);
```

Use fixture-controlled vitals/positions only in headless tests, never browser production hooks. Add `'all attacks blocked during use'` for gun/knife/throw/reload plus direct request paths; `'pause preserves remaining'` expects 3 seconds after 2 seconds play + 20 paused; `'bot start does not count prior slice time'` proves no completion before five elapsed seconds; `'bot use does not self-cancel'` proves movement continues while equipment choice/attacks do not; `'death drops pending pack and respawns empty'` checks counts and armour=0. Test protected/friendly armour, knife/frag/headshot and wave-19 hit through armour with actual runtime adapters.

Preserve the literal uncapped zombie-damage regression for both kinds at waves 1,2,3,4,18,19,20,100. Its old fixtures use health 150/1000 to observe excess damage; the new vitals boundary rejects those impossible states. Replace only that measurement technique: wrap and forward the real `game.damageActor` to record incoming amounts `[10,15,20,25,95,100,105,505]`, use legal health 100/armour 0, and assert the corresponding real damage/death plus attack-interval checks. Do not delete late waves or reduce the expected uncapped amounts.

- [x] **Step 2: Add failing lifecycle/input cases.** Using `createInputFixture()`, hold a joystick and Fire, call `clearCombat()`, then repeat Fire keydown and release another pointer: assert movement unchanged and `read().fire===false` until release/new press. `'last-zombie recovery preserves due pack'`: final enemy killed by a real timed grenade when health use is due, result health=100 and pack unchanged. `'fatal damage wins same-step completion'`: health remains zero/results, no use. `'armour use survives recovery'`: timer continues, armour unchanged by automatic recovery, completes +50 once. `'new zombie run is fresh'`: no packs/armour; ammo recovery remains 500 per owned gun. Run `node --test tests/supply-solo.test.js tests/equipment-input.test.js tests/bot-brain.test.js tests/zombie-recovery.test.js tests/zombie-game.test.js` and inspect failures.
- [x] **Step 3: Integrate the shared operations.** Initialise/reset armour; add use actions and partial input clearing. At each simulation slice capture existing operation references before bot actions; after attacks, deaths and zombie recovery, advance only still-current captured operations. A bot-created operation starts counting on the following slice. Route all accepted damage through `damageVitals` while preserving existing protection/scoring/feedback. Never let an active use tick in both equipment and runtime paths. Snapshot/synchronise armour/health after mutation.
- [x] **Step 4: Integrate bot and recovery behaviour.** Let regular bots collect along unchanged movement routes, attempt the health-first/armour policy before combat, and skip automatic equipment/attacks while using. Zombie actors remain equipment-null/non-collectors. Recovery cancels health use before automatic healing and preserves armour use/counts/value. Death/stop/results/new life clear operations; ordinary death captures unused packs before clearing. Starting/ending/cancelling a use clears combat latches only; add key-release suppression and fire-button disabled handling without changing movement cancellation semantics.
- [x] **Step 5: Run green plus combat regressions.** Repeat focused command, then `node --test tests/loot-solo.test.js tests/headshots.test.js tests/combat.test.js tests/zombie-survival.test.js tests/zombie-brain.test.js tests/zombie-maps.test.js tests/equipment.test.js`. No base-damage changes to make tests easier.
- [x] **Step 6: Commit explicit Task 3 files.** Message: `feat: integrate supply use with solo combat and zombies`.

### Task 4: Authoritative online supplies and protocol 4

**Files:** Modify `server/rooms.js`, `src/protocol.js`, `src/gear-protocol.js`, `src/network.js`, `src/online-game.js`, `tests/gear-protocol.test.js`, `tests/network.test.js`, `tests/network-client.test.js`, `tests/loot-saturation.test.js`; create `tests/supply-rooms.test.js`. Update positive wire-version fixtures in `tests/zombies.browser.mjs`, `tests/native-online-cleanup.browser.mjs`, `android/tests/emulator-online-smoke.mjs` to import the shared version; keep explicit old version 3 rejection tests.

**Interfaces:** Existing `RoomManager.equipmentAction(id, packet)` accepts exact packets `{type:'equipment-action',seq,lifeId,kind:'use-supply',supplyType}` and `{type:'equipment-action',seq,lifeId,kind:'cancel-supply'}`. Existing `equipmentSnapshot(id)` includes Task 2 fields privately. Public `snapshot(room)` adds armour only, not other players' supplies. `OnlineArena.requestEquipment`, `sync`, `pause` retain signatures. `PROTOCOL_VERSION=4`; existing `validEquipmentAction`, `validEquipmentSnapshot`, `validGearWorld`, `validGearEvent` retain boolean contracts.

- [x] **Step 1: Write server red tests using real `RoomManager`.** Make local `pair(modeId='ffa')` and `action(player,seq,fields)` fixtures using the existing patterns in `loot-rooms.test.js`. Assert:

```js
// 'server completes one acknowledged pack after five seconds'
const manager = new RoomManager({random:()=>.5});
const room = manager.create('p1','Host','m4a1');
manager.join('p2',room.code,'Guest','m4a1'); manager.start('p1');
const a=room.players.get('p1'); a.health=20;
pickupEquipment(a.equipment,{kind:'supply',supplyType:'health'});
const packet={type:'equipment-action',seq:1,lifeId:a.lifeId,kind:'use-supply',supplyType:'health'};
assert.equal(manager.equipmentAction(a.id,packet).ok,true);
assert.equal(manager.equipmentAction(a.id,packet).ok,false);
manager.tick(4.999); assert.equal(a.health,20);
manager.tick(.001); assert.equal(a.health,100); assert.equal(a.equipment.supplies.health,0);
```

Add `'forged combat while using is inert'` for fire, reload, melee and direct grenade actions; `'enemy damage precedes due heal'`; `'spawn/team protection covers armour'`; `'private supply counts stay private'`; `'nearest contested supply awarded once'`; `'old life/room sequence cannot consume'`; `'online neutral controls do not freeze use'`; `'round end/departure clears use'`. Assert armour-only damage produces hit but not kill; armour overflow/death produces one existing elimination/drop path.

- [x] **Step 2: Add strict client/packet red cases.** Use production RoomManager snapshots in tests. Reject unknown supply types, supplied effect/time/amount keys, counts -1/4/fractions, timer 0/5.001, armour -1/100.001/null, active use without stock, dead stock/use, 21 map items or 69 total records. Accept a 20-map/48-drop snapshot. Wrong-recipient/old-life snapshots must not replace valid state; a new-life snapshot must clear pending input and not play completion audio. Test current-version success and both directions of 3↔4 mismatch, asserting the existing update-required text. Run `node --test tests/supply-rooms.test.js tests/gear-protocol.test.js tests/network.test.js tests/network-client.test.js tests/loot-saturation.test.js` red.
- [x] **Step 3: Implement authority and DTO changes together.** Initialise armour on spawn/lobby/death; retain existing seq/life/phase validation. Route damage without setting health=0 before calling the existing `eliminate` guard: calculate accepted new vitals on a detached temporary, assign survivor vitals or set armour then call elimination while target health is still positive. Finalise use after all actors' attacks/projectiles and mode terminal checks, with existing-operation identity capture as in Task 3. Clearing/denying use cannot create attack edges. Increase strict world limits via shared constants, never loosen arbitrary keys.
- [x] **Step 4: Reconcile clients and complete compatibility fixtures.** Copy authoritative armour and private use state during all syncs, including menus. Block suspended UI starts and client combat while active use, but do not pause server progress. Never optimistically heal or spend counts; suppress combat latches on acknowledged operation/life transitions. Derive optional completion feedback only from same-life, same-round acknowledged effect transitions; no initial/dead/reordered cue. Import the shared version in positive fixtures and keep literal protocol 3 for deliberate incompatibility. Do not contact production servers in unit or staging tests.
- [x] **Step 5: Run green and server regressions.** Repeat focused command, then `node --test tests/rooms.test.js tests/loot-rooms.test.js tests/online-modes.test.js tests/equipment-input.test.js tests/inventory-ui.test.js`. Update only changed-contract fixture expectations, preserving malformed-packet and lifecycle assertions.
- [x] **Step 6: Commit explicit Task 4 files.** Message: `feat: sync authoritative supplies and armour over protocol four`.

### Task 5: One-inventory HUD, supply models and feedback

**Files:** Modify `src/equipment-ui.js`, `src/main.js`, `index.html`, `src/styles.css`, `src/gear-view.js`, `src/audio.js`, `src/game.js`, `src/online-game.js`, `tests/inventory-ui.test.js`, `tests/gear-view.test.js`, `tests/zombie-ui.test.js`; create `tests/supply-ui.test.js`, `tests/supply-audio.test.js`. Extend `tests/helpers/inventory-dom-fixture.js` only for DOM methods genuinely used by the production UI.

**Interfaces:** Consume Task 2's `lootItemLabel(item)` rather than duplicating labels in the renderer. `GameAudio.supplyComplete(supplyType) -> void` respects `enabled`. Existing inventory view gains authoritative `health`/`armour` alongside equipment/life/round/alive. Add DOM IDs `armour-count`, `armour-bar`, `supply-use-status`, `supply-use-label`, `supply-use-progress`; existing Fire/Throw/Reload IDs remain unchanged. Inventory keys are `supply:health` and `supply:armour`.

- [x] **Step 1: Write failing DOM/model/audio tests.** Use `createInventoryDOM(t)` and the real EquipmentUI/runtime path. Named assertions:

```js
// 'supplies append in the same inventory'
assert.deepEqual(slots.children.slice(-2).map(b=>b.dataset.inventoryKey),['supply:health','supply:armour']);
assert.equal(slot('supply:health').querySelector('.inventory-count').textContent,'x3');
// 'tap starts then explicitly cancels'
tap('supply:health'); assert.deepEqual(actions.at(-1),{kind:'use-supply',supplyType:'health'});
ui.render(); tap('supply:health'); assert.deepEqual(actions.at(-1),{kind:'cancel-supply'});
assert.equal(game.player.equipment.supplies.health,3);
```

`'scroll is not use'` and `'old-life gesture is ignored'` retain zero actions; `'full health explains rejection'` retains count and displays reason; `'HUD cannot undo attack locks'` exercises the real main HUD callback with use/recovery/death/throw suppression; `'supply models are distinct and bounded'` checks named models, labels and <=0.34 horizontal footprint; `'all sixty-eight records render'` expects `view.loot.size===68`, including final supply records; `'dispose once'` checks shared cached geometry/material ownership; `'sound disabled is silent'` asserts zero tone calls when disabled.

- [x] **Step 2: Run red.** `node --test tests/supply-ui.test.js tests/supply-audio.test.js tests/inventory-ui.test.js tests/gear-view.test.js tests/zombie-ui.test.js` must expose absent presentation/guards.
- [x] **Step 3: Implement inventory/HUD wiring.** Append nonzero stacks after grenades, preserve contiguous numbering and gesture/identity guards, show count/name and active state. Tap uses the correct life-scoped action; repeat-active tap cancels. Disable attacks/reload but keep movement and valid inventory selection. Render armour numerically/bar plus `HEALING` or `ADDING ARMOUR` with remaining seconds/progress. Compose disabled states; never overwrite an existing stronger lock. Use existing flex/legacy CSS conventions and avoid covering HUD buttons or scroll area.
- [x] **Step 4: Implement low-cost models and effect feedback.** Add explicit supply template/key branches with medical/shield block shapes, extend render cap to shared 68, use shared labels in both pickup-toast paths. Lower the existing held model while using, restore on operation/round/life changes, and retain reload/knife/scope presentation behaviour. Add completion cue without new remote animation, shaders, assets or dependencies. Tests must verify no replay after stale acknowledgements or resets.
- [x] **Step 5: Run green plus full units.** Repeat focused command, then `npm test`; every unit/integration test passes. Record actual totals, not an assumed count. Fix real integration failures with targeted red tests before accepting them.
- [x] **Step 6: Commit explicit Task 5 files.** Message: `feat: present health and armour in the existing loot HUD`.

### Task 6: Browser, touch and packaged-Android acceptance candidate

**Files:** Create `tests/supplies.browser.mjs`, `tests/supplies-layout.browser.mjs`, `android/tests/supplies-smoke.mjs`. Modify `tests/helpers/loot-browser.js` only for backward-compatible fixture options, `tests/helpers/legacy-webview.js` only if new probes require it, `package.json`, `package-lock.json`, `android/app/build.gradle`, `index.html`, `android/tests/package-smoke.mjs`, `android/tests/zombies-smoke.mjs`, `android/tests/emulator-online-smoke.mjs`, `tests/webview-compatibility.test.js`, `tests/home.browser.mjs` for changed literal version expectations. Reuse existing helpers; do not fabricate exports from native scripts, whose CDP helpers are local.

**Interfaces:** Add npm `test:supplies` running the two new browser scripts. New suites use `SUPPLY_ARTIFACTS` for all evidence. Extend `fixture(viewport, { legacy=false }={})` compatibly to apply the existing `emulateLegacyWebView(context)` before navigation when requested; safely probe WebGL prototypes when WebGL2 is absent. Preserve existing callers. New native test uses existing `ANDROID_TEST_SERIAL`, `ANDROID_TEST_AVD`, `ANDROID_TEST_ARTIFACTS` identity checks. Candidate release is 0.6.0 / versionCode 8; footer `v0.6.0 HEALTH + ARMOUR`.

- [x] **Step 1: Write real-input acceptance assertions before final polish.** Reuse `fixture`, `until`, `freshSolo`, `walkSolo`, `onlinePair`, `observer`, `moveTo`, `lookAt`, `emptyControls` from `tests/helpers/loot-browser.js`. Select maps/settings through UI. Walk reachable routes to actual authored supplies; take real body damage or a zombie hit; use actual slot taps. Observe HUD and private packets without editing game state/time. Required named scenarios: `'real five-second heal while moving'`, `'tap cancel and gun-switch cancel preserve stock'`, `'full resource cannot spend'`, `'three-item capacity leaves fourth for peer'`, `'two players observe same armour damage and drop'`, `'active online use continues through menu'`, `'zombie recovery preserves pending health pack'`, `'death/replay clears supply state'`. Offline, check roughly five seconds of passively observed simulation time with a 0.05-second step and 0.1-second observation allowance, and no effect while displayed progress is pending. Online, observe server-acknowledged remaining time/count/effect, not the client's RAF clock; exact 4.999/5 boundaries are proved by Tasks 1 and 4. Do not accelerate `setInterval`/RAF to pass use timing.
- [x] **Step 2: Add layout and native checks.** Check 854x480, 1200x700 and 1280x720 at control scales 1 and 1.3, modern/legacy; inventory scroll, progress, armour, main HUD and controls must not overlap. Isolated renderer fixtures may test extreme layout state but are labelled non-gameplay evidence. Native smoke validates owned emulator identity, packaged appassets origin, offline requests, real adb taps for supply use/cancel, five-second timing, armour, Back/Home/background pause and fresh replay; no state/visibility override. Native online override must contact only its candidate TLS endpoint, not create rooms on the bundled production default when they differ.
- [x] **Step 3: Capture acceptance red where a required path is absent.** Build into a fresh task-owned candidate directory and run new browser assertions; any exposed product failure gets a minimal regression and fix. Add package assertions for code 8/name 0.6.0, demonstrate rejection of retained 0.5.1 metadata, then update source version fields (including lockfile root and packages[""]). This step must not relabel an old APK as current.
- [x] **Step 4: Build an isolated candidate and run browser green.** Use the recorded task-owned `SUPPLY_REVIEW_DIR`, with fresh candidate/output subdirectories for repeated runs. It must be an absolute task-owned path and never an existing release. Commands below show the initial candidate; freeze it once tests start and select a new subdirectory for any rebuild:

```bash
BUILD_DIR="$SUPPLY_REVIEW_DIR/dist" npm run build
DIST_DIR="$SUPPLY_REVIEW_DIR/dist" SUPPLY_ARTIFACTS="$SUPPLY_REVIEW_DIR/modern" npm run test:supplies
DIST_DIR="$SUPPLY_REVIEW_DIR/dist" SUPPLY_ARTIFACTS="$SUPPLY_REVIEW_DIR/legacy" LEGACY_WEBVIEW=1 node tests/supplies.browser.mjs
```

Expect actual supply scenarios, all map startups and all layout profiles to pass with no page errors/failed game assets. Also exercise ordinary TDM/CTF and two-client online use on representative maps; Task 7 retains the all-configuration regression. Read `.claude/skills/playwright-cli/SKILL.md` before CLI work. Use a uniquely named owned CLI session for a real pickup/use/cancel playthrough, screenshot inspection, console and `requests --static` evidence. Close only that session.
- [x] **Step 5: Build and inspect APK from the same frozen bytes.** Serialise Android build access: `scripts/build-apk.sh` writes `android/app/src/main/assets` and `android/app/build` even with an isolated final APK path. Confirm no other build owns them. Do not use `npm run apk`, which rebuilds default dist.

```bash
DIST_DIR="$SUPPLY_REVIEW_DIR/dist" APK_OUTPUT_PATH="$SUPPLY_REVIEW_DIR/block-ops-v0.6.0-health-armour.apk" bash scripts/build-apk.sh
DIST_DIR="$SUPPLY_REVIEW_DIR/dist" ANDROID_APK_PATH="$SUPPLY_REVIEW_DIR/block-ops-v0.6.0-health-armour.apk" node android/tests/package-smoke.mjs
```

Expect metadata/signature/exact four-asset checks to pass; record APK SHA-256 and the four asset hashes. Compare signing certificate to preserved 0.5.1 APK. Never overwrite old artifacts or run concurrent native suites.
- [x] **Step 6: Run owned-emulator acceptance.** Read-only check adb devices, AVD identities, ports and forward 9228 before starting or reusing only the task-owned AVD. Historical `BlockOpsZombiesTask` / `emulator-5582` is a discovery hint, not authorization to mutate whatever now occupies that serial. Use `adb -s <verified-owned-serial> install -r <absolute-candidate-apk>` without uninstalling the old build. Set explicit identity/artifact variables and run `android/tests/emulator-smoke.mjs`, `android/tests/zombies-smoke.mjs`, `android/tests/supplies-smoke.mjs` serially. Expect offline world rendering, real input and lifecycle assertions to pass with no unintended external requests. Native online acceptance is the TLS staging gate in Task 7. Record any inability to run native checks as a blocker, not a pass.
- [x] **Step 7: Commit explicit Task 6 source/test/version files.** Message: `test: verify health and armour in browser and Android candidate`. Rebuild and repeat impacted checks if source changed after a recorded candidate; never replace assets beneath a running test.

### Task 7: Whole-change review, full regression and controlled delivery

**Files:** Create `docs/releases/2026-10-05-health-armour-verification.md`; keep raw operational scripts/logs/screenshots in the recorded task evidence directory. Any review fix touches only its relevant feature files and gets a regression. Update this plan's completed checkboxes from real evidence, not assumptions.

**Interfaces:** Consume the final source commit, verified candidate dist/APK, current hosting/process identities and the shared protocol 4. Produce a reproducible evidence record, immutable release/rollback snapshots, current browser link and versioned APK path/hash. Do not reuse a historical deployment script with hard-coded old process IDs.

- [x] **Step 1: Request the appropriate independent whole-change review.** Follow the chosen execution method: Native uses one fresh most-capable available reviewer over the complete change; Subagent-driven also requires its task reviews. Give reviewers the approved spec/plan, actual base/head commits and evidence paths. Handle findings with receiving-code-review, targeted red/green tests and re-review when warranted. No unresolved material issue proceeds to release.
- [x] **Step 2: Run the complete final candidate matrix.** Freeze a new candidate directory after fixes, then run `npm test` and each command below with `DIST_DIR` set to those exact bytes. Preserve existing test evidence: suites with hard-coded `artifacts/*` outputs run in an isolated task-owned verification snapshot of the final source, with dependency linkage and explicit external DIST_DIR; do not overwrite old logs or user's screenshots. The snapshot is for verification, not an unapproved source worktree switch.

```bash
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

Expect every command exit 0 with retained gameplay assertions. Run browser suites concurrently only with independent port-0 servers, browsers and output paths. Verify hashes before/after. Failures trigger diagnosis and bounded fixes, not silent retries or skipped assertions. Rebuild package and repeat relevant browser/native evidence after any product change.
- [x] **Step 3: Stage TLS and verify native online before live replacement.** Start a task-owned port-0 server from an immutable source/assets snapshot. If no authorized staging TLS route exists, create a separate task-owned temporary Cloudflare tunnel pointed only at that server; do not touch the existing public tunnel. Record exact process identity/port/URL and close only these owned staging resources afterward. Use `GAME_TEST_SERVER_URL` pointing to staging for native online acceptance; test protocol 4, all three online modes, supply pickup/use/armour damage/drop with an independent peer, skins, flags and actual Back/background handling. Old bundled production default checks are deferred to the live post-release step; never let a staging test create unsolicited production rooms. Require all staged/native assertions and cleanup to pass.
- [x] **Step 4: Verify package/release identity and document candidate evidence.** Run package smoke on frozen candidate again; inspect signer comparison, upgrade-install evidence, build/asset/APK hashes and git diff. Confirm all new files needed by the server exist in the immutable snapshot. Record current defaults, version 0.6.0/code 8/protocol 4, source commit and physical BYD limitation. If release authority or access is missing, hand off the tested candidate and request direction; do not claim the browser was updated.
- [ ] **Step 5: At authorized deployment, re-resolve live identity and require empty rooms.** Inspect the actual current server cwd/command/env, port, public origin and tunnel, and capture its exact rollback snapshot/assets. Poll `/health` without blocking communication; never kick players. Require a verified admission gate or user-coordinated empty-room maintenance window so a room cannot join between the empty check and replacement. The current server has no approved drain endpoint: do not invent or implement an admin API under this feature. If that precondition cannot be established, stop at the tested candidate and ask for release coordination. Within the established window, recheck rooms=0 and exact process identity immediately before replacing only the scoped app server. Keep the existing tunnel running; never kill by a remembered PID, broad process pattern or unrelated preview port.
- [ ] **Step 6: Verify delivery, or restore the exact rollback.** Check local/public health, version, no-store headers and byte equality for `index.html`, `game.js`, `styles.css`, `THREE-LICENSE.txt`. Run actual public CLI supply gameplay and two-client online acceptance, plus native online default-server use. Verify older protocol 3 gets clear update guidance. Close only owned test clients/rooms; confirm their departure. On a failed cutover check, restore the preserved server snapshot and report failure. Copy the final verified APK to a new non-overwriting `artifacts/block-ops-v0.6.0-health-armour.apk` only after validating source and target; compare hashes.
- [ ] **Step 7: Finalise evidence and handoff.** Record real test totals, commands, exit codes, artifact paths, screenshots, signer/APK/asset hashes, release/rollback paths and limitations in the verification document. Clean up only owned CLI/emulator/forward/staging resources, preserving AVD data and evidence. Confirm unrelated changes remain untouched, commit only feature documentation, and follow finishing-a-development-branch without inferring push/merge authority. Provide the browser link, APK link/version, concise feature summary and parked-BYD test request. Explicitly retain minimap, aim assist, gun effects and XP/cosmetics as subsequent pending upgrades; this delivery does not claim all six recommendations are finished.

## Plan review handoff

The written spec is approved. This plan now requires user review and an execution-method selection. **Native is recommended for this plan:** seven tightly connected tasks share equipment DTOs, timer ordering and input gates; one implementer can retain that context, with a fresh independent whole-change review before shipping. Subagent-driven is also available for independent review after every task at higher context cost. Neither method begins until the user confirms the plan and choice.
