# Loot and Equipment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic world loot, carried guns, a melee knife and three grenade types to solo and online Block Ops, with the approved starting-gun and death rules.

**Architecture:** Share plain-data equipment, loot and attack rules between `ArenaGame` and the authoritative `RoomManager`. Keep rendering, touch controls and network serialization as adapters; do not merge the existing combat engines. Change client and server together to protocol 3 and stage everything before a coordinated release.

**Tech Stack:** JavaScript ES modules, Node test runner, Three.js 0.160.1, ws 8.21.0, esbuild, Playwright and Playwright CLI, existing Android Java 17 WebView wrapper.

**Spec:** `docs/superpowers/specs/2026-10-03-loot-equipment-design.md` — approved on 2026-10-03. Read it in full before executing this plan.

## Global Constraints

- Automatic pickups; all 28 distinct guns may be carried, one knife, and three grenades total across types.
- The original starting gun is removed on the first actual equip of a different gun per life and requires loot to recover. Preview, pickup, knife toggle and grenade throws do not remove it.
- Fresh guns start with 500 rounds total. Switching never refills ammo; dropped guns retain remaining ammo. Duplicate owned-gun pickups are skipped.
- Death drops the active gun and remaining grenades, clears collected equipment and restores the original starting gun on respawn. A held knife does not change which gun drops.
- All eight maps and all three modes support loot in solo and online. Preserve current skins, hitboxes, map geometry, scores, spawn protection and Android lifecycle behaviour.
- Each map has 16 fixed locations: eight guns, two knives, six grenades including two of each type. Map respawn is 20 seconds; death drops unlock after 0.5 seconds, expire after 30 seconds and are capped at 48.
- Pickup distance is 1.2 horizontal units, with at most 0.75 vertical feet separation and no intervening wall. Nearest eligible actor wins, then stable ID for ties.
- Knife: 50 damage, 1.8-unit reach, 30-degree half-angle and 0.6-second interval. Grenade values and team/effect rules are exactly those in the approved spec.
- Throw cooldown is 0.65 seconds; attack suppression is 0.25 seconds. At most 32 live grenades and 16 combined active smoke areas plus in-flight smoke grenades.
- Support 854 by 480 and larger landscape touch layouts. Q toggles knife, G throws, T opens grenade selection; key repeat must not duplicate actions.
- Retain bundled offline assets, secure public WSS, inbound 4096-byte limit, 100 messages/second limit and 256 KiB socket backpressure protection. No new engine, external asset dependency or paid service.
- Preserve the Android package, minimum SDK 26, target/compile SDK 36 and debug signing workflow. Physical BYD verification remains outstanding unless actually performed.
- Preserve unrelated `.gitignore`, README and installed-skill changes. Never restart the live server, publish `dist/`, clear rooms or replace the latest APK during intermediate tasks.
- This is one cohesive feature plan: ownership, death drops and grenade consumption share state across runtimes. Implementing them as separately released features would leave incomplete rules.

## Review Focus

1. Returning from an unchanged menu, or receiving a delayed equip after death, must not remove the starting gun or change the next life. Pin in Tasks 5, 6 and 8.
2. A late joiner's starting gun must remain obtainable even when all eight gun slots have assignments or one is respawning. Pin in Task 2 and the real-socket tests in Task 5.
3. A grenade thrown in an earlier life must resolve once without replaying the throw, duplicating death drops or scoring past the round limit. Pin in Tasks 3–5.
4. Smoke and flashes must not reveal otherwise hidden opponents through name labels, or let bots aim using hidden current positions. Pin in Tasks 4 and 7–9.
5. Overlapping touch pointers, modal transitions and a blocked grenade release point must never leave firing held or consume a grenade for an invalid throw. Pin in Tasks 3, 8 and 9.

## File and interface map

| Files | Responsibility |
| --- | --- |
| `src/equipment.js`, `src/equipment-catalog.js` | Ownership transactions, ammo preservation, knife/grenade balances and cooldowns |
| `src/loot.js`, `src/loot-spawns.js` | Fixed placements, starter coverage, contested collection, death drops and timers |
| `src/gear-combat.js` | Melee selection, grenade motion, smoke visibility, flash strength and ordered effect intents |
| `src/game.js`, `src/bot-brain.js` | Solo integration, bot decisions and one elimination path |
| `server/rooms.js`, `server/server.mjs` | Authoritative actions, public world snapshots and per-player equipment |
| `src/gear-protocol.js`, `src/protocol.js`, `src/network.js`, `src/online-game.js` | Protocol 3 validation, action sequencing and reconciliation |
| `src/gear-view.js`, `src/avatar.js`, `src/audio.js` | Pickup/effect/held-item visuals, concealment and sounds without skin changes |
| `src/equipment-ui.js`, `src/input.js`, `src/main.js`, `src/multiplayer-ui.js`, `index.html`, `src/styles.css` | Touch controls, carried guns, explicit equipment selection versus resume |

New shared record names used throughout this plan:

- `EquipmentState`: `{startingGunId, activeGunId, heldItem, startingGunRemoved, owned, knife, grenades, selectedGrenade, throwRemaining, attackLockRemaining, meleeRemaining}`. `heldItem` is `gun` or `knife`; `owned` is a Map from gun ID to the existing weapon-state record; grenade counts use `frag`, `smoke`, `flash`.
- `LootItem`: `{kind:'gun', weaponId, ammo, reserve}` or `{kind:'knife'}` or `{kind:'grenade', grenadeType}`. There are no arbitrary item IDs outside these catalogs.
- `ActorRecord`: `{id, lifeId, teamId, x, y, z, yaw, pitch, alive, protectedRemaining, flashRemaining, equipment}`; y is feet height. Both runtime adapters construct this shape. Runtime adapters decrement `flashRemaining` once per simulation step and apply flashes as `min(3,max(current,duration))`.
- `ActionResult`: `{ok:true}` or `{ok:false,reason:string}`. Invalid requests do not partially mutate state. Original-gun denial uses the exact copy `Find this gun as loot`.
- `EquipmentDTO`: a detached JSON form of EquipmentState with `owned` as an array of weapon-state records. Living actors must own their active gun. Dead actors may have empty `owned` and a remembered valid active-gun ID; their public ammo/reload fields are zero. No Map, reference alias, client-supplied extra key or non-finite number crosses the wire.
- `LootRecord`: `{id,x,y,z,item,source,availableRemaining,expiresRemaining}`; source is `map` or `drop`, and map-item expiry is null. `ProjectileDTO`: `{id,grenadeType,ownerId,ownerTeamId,ownerLifeId,x,y,z,vx,vy,vz,fuseRemaining}`. `SmokeDTO`: `{id,ownerId,x,y,z,radius,remaining}`. World arrays contain only currently present entities, not absent map slots.
- Shared rule event payloads are `pickup {playerId,itemId,item}`, `melee {playerId}`, `grenade-throw {playerId,grenadeId,grenadeType}`, and `grenade-burst {playerId,grenadeId,grenadeType,position}` with a `type` field. Runtime adapters add the existing monotonic event `id`; payloads never grant inventory on the receiving client. Combat's `isEnemy(sourceId,targetId)` callback accepts IDs, not actor objects.

Tasks 2 and 3 depend on Task 1 and can be developed independently with fixed interfaces. Integration tasks follow their dependencies; do not assign overlapping adapters to concurrent writers. Each task below has its own red/green check and commit.

### Task 1: Equipment ownership and ammunition transactions

**Files:** Create `src/equipment-catalog.js`, `src/equipment.js`, `tests/equipment.test.js`, `tests/helpers/equipment-fixture.js`; reuse `src/weapons.js` without changing existing gun balance.

**Interfaces:** Export `createEquipment(startingGunId) -> EquipmentState`, `equipGun(e, weaponId, {source}) -> ActionResult` where source is `armory` or `inventory`, `pickupEquipment(e, item) -> ActionResult`, `setHeldItem(e, heldItem) -> ActionResult`, `selectGrenade(e, grenadeType) -> ActionResult`, `tickEquipment(e, dt) -> void`, `consumeGrenade(e, grenadeType) -> ActionResult`, `beginMelee(e) -> ActionResult`, `deathItems(e) -> LootItem[]`, `clearEquipment(e) -> void`, `resetEquipment(e) -> void`, `equipmentDTO(e) -> EquipmentDTO`, and `equipmentFromDTO(dto) -> EquipmentState`. Export immutable `GRENADE_TYPES` and `GEAR_BALANCE` from the catalog. The test-only helper `createGearActor(id,overrides={})` returns a complete ActorRecord at the origin, alive/unprotected, life 1, zero angles/flash, null team, and independent M4A1 equipment unless overridden.

- [ ] Establish an approved execution workspace using `superpowers:using-git-worktrees`; inspect dirty files and run `npm test` before edits. Baseline is currently 238 passing tests; do not erase unrelated changes or silently accept an unexpected baseline failure. Build the unchanged client with `BUILD_DIR=artifacts/loot-review/baseline-dist npm run build` for Task 9's red UI checks, leaving live assets alone.
- [ ] Write failing transaction tests. The central test uses only the interfaces above:

```js
const e = createEquipment('ak47');
assert.equal(equipGun(e, 'mp5', {source:'armory'}).ok, true);
assert.equal(e.owned.has('ak47'), false);
assert.deepEqual(equipGun(e, 'ak47', {source:'armory'}), {ok:false, reason:'Find this gun as loot'});
assert.equal(pickupEquipment(e, {kind:'gun', weaponId:'ak47', ammo:7, reserve:19}).ok, true);
assert.equal(e.activeGunId, 'mp5');
assert.equal(equipGun(e, 'ak47', {source:'inventory'}).ok, true);
assert.equal(e.owned.get('ak47').ammo + e.owned.get('ak47').reserve, 26);
resetEquipment(e);
assert.equal(e.activeGunId, 'ak47');
assert.equal(e.owned.get('ak47').ammo + e.owned.get('ak47').reserve, 500);
```

  Add cases for all 28 guns, invalid IDs, inventory-only unowned selection, one-time original removal, duplicate pickup leaving state unchanged, one knife, three mixed grenades, no throw/melee without stock, invalid dt, gun/knife timers, death while holding knife, and DTO copies not aliasing state. Dropped reloads are cancelled without ammo transfer; switching owned guns retains ammo and reload progress.
- [ ] Run `node --test tests/equipment.test.js`; verify failure is the missing implementation or intended behaviour, not broken test setup.
- [ ] Implement the named contracts using strict catalog validation, existing `createWeaponState`/`tickWeapon`, and atomic guards before mutations. Clear equipment on death without granting a new gun until reset. Use the spec values in `GEAR_BALANCE`, including expiry and entity caps reused later.
- [ ] Run `node --test tests/equipment.test.js tests/weapons.test.js`; expect all pass. Commit only these task files as `feat: add shared equipment transactions`.

### Task 2: Map loot, starter coverage and death drops

**Files:** Create `src/loot-spawns.js`, `src/loot.js`, `tests/loot.test.js`; reuse `src/maps.js`, `src/collision.js`, `src/navigation.js`.

**Interfaces:** Export immutable `LOOT_SPAWNS[mapId]`, containing 16 `{id,x,z,kind,grenadeType?}` records. Export `createLootState({mapId,seed,startingGunIds})`, `reconcileStartingGuns(state, startingGunIds)`, `tickLoot(state,dt)`, `collectLoot(state,actors,{solids}) -> pickupEvents[]`, `addDeathDrops(state,{actorId,lifeId,position,items,solids})`, and `lootDTO(state) -> lootRecords[]`. Each visible loot record has stable `id`, position, item, source (`map` or `drop`), pickup delay and expiry. Internal state owns fixed-slot assignments/respawn timers, drop order and per-actor last dropped life.

- [ ] Write failing tests in `tests/loot.test.js`, including assertions `locations.length === 16`, kind counts `8/2/6`, two of each grenade, `drops.length <= 48`, and identical DTOs for identical seeds. Across every map verify collision clearance, navigation reachability and more than 1.2 units from flag/spawn interaction centres. Pin `collectLoot` awarding one contested item to the nearest actor, then stable ID on equal distance; reverse actor array order and assert the winner does not change.
- [ ] Pin starter coverage with eight distinct human starting IDs, repeated IDs, a respawning slot, and a late join introducing a missing ID. Assert existing participants keep coverage and a reassigned respawning slot retains its timer. Test exact 1.2/0.75 boundaries, walls, dead actors, duplicate owned items, capacity-full grenades, 20-second map respawn, 0.5/30-second drop timing, eviction order and duplicate same-life drops.

  Test name: `nearest contested pickup is awarded once`:

```js
const loot = createLootState({mapId:'courtyard',seed:1,startingGunIds:['ak47']});
const item = lootDTO(loot).find(p => p.item.weaponId === 'ak47');
const a = createGearActor('a',{x:item.x+.2,z:item.z});
const b = createGearActor('b',{x:item.x+.4,z:item.z});
const events = collectLoot(loot,[b,a],{solids:[]});
assert.equal(events.filter(e => e.itemId === item.id).length,1);
assert.equal(a.equipment.owned.has('ak47'),true);
assert.equal(b.equipment.owned.has('ak47'),false);
```

- [ ] Run `node --test tests/loot.test.js`; expect the new behaviour to fail before implementation.
- [ ] Implement placements as authored data, not per-frame searching or changes to map solids. Use `pickupEquipment` only after resolving each item's eligible winner; re-check capacity after each award. Drop gun ammo comes from `deathItems`, with safe positions and no drops on ordinary equip. Limit gun assignment changes to starter coverage as specified.
- [ ] Run `node --test tests/loot.test.js tests/maps.test.js tests/bot-brain.test.js`; expect all pass. Commit as `feat: add automatic arena loot and death drops`.

### Task 3: Shared melee, grenade physics and status effects

**Files:** Create `src/gear-combat.js`, `tests/gear-combat.test.js`; modify `src/equipment-catalog.js` only for the shared physics constants below.

**Interfaces:** Export `createGearCombatState()`, `meleeTarget(actor, actors, {solids,isEnemy}) -> actorId|null`, `throwGrenade(state,actor,grenadeType,{solids}) -> ActionResult`, `stepGearCombat(state,actors,dt,{solids,isEnemy}) -> {damage,flashes,events}`, `smokeBlocksSight(from,to,smokes) -> boolean`, and `gearCombatDTO(state) -> {projectiles,smokes}`. Damage intents are `{sourceId,sourceLifeId,targetId,amount}`; flash intents are `{targetId,duration}`. Callers apply intents in stable order and stop at round end. State owns active projectiles, smoke, IDs and reserved smoke capacity; it never owns Three.js objects.

- [ ] Write failing tests asserting knife damage configuration `50`, reach `1.8`, half-angle `Math.PI/6` and cooldown `.6`; test nearest enemy versus teammate, vertical separation, wall occlusion and spawn protection. Assert explosive configuration `fuse:2, radius:5, maxDamage:90`, smoke `fuse:2, radius:4, duration:8`, flash `fuse:1.25, radius:10, maxDuration:3`.
- [ ] Add numerical tests for linear blast falloff, full/side/behind flash strength, walls, overlapping smoke, bounded flash refresh, owner death versus disconnect, delayed old-life grenades, rejected release inside a wall, 32 projectiles, and 16 active/reserved smoke slots. Assert rejected throws preserve stock and accepted throws spend one with `.65` cooldown and `.25` attack lock. A large dt must not tunnel through cover or detonate twice.

  Test name: `accepted throw consumes one item and starts both locks`:

```js
const state = createGearCombatState(), actor = createGearActor('a');
pickupEquipment(actor.equipment,{kind:'grenade',grenadeType:'smoke'});
assert.equal(throwGrenade(state,actor,'smoke',{solids:[]}).ok,true);
assert.equal(actor.equipment.grenades.smoke,0);
assert.equal(actor.equipment.throwRemaining,.65);
assert.equal(actor.equipment.attackLockRemaining,.25);
assert.equal(gearCombatDTO(state).projectiles.length,1);
```

- [ ] Run `node --test tests/gear-combat.test.js`; confirm intended red cases.
- [ ] Implement swept/substepped sphere motion against the existing AABB solids and ground. Initial implementation constants: projectile radius `.12`, launch velocity `12 * aimDirection + (0,3,0)`, gravity `14`, normal restitution `.35`, tangential collision multiplier `.7`. Clamp resting vertical motion rather than endless micro-bounces. Smoke is a sphere centred two units above its detonation point, and both view and bot tests use that same volume. Flash distance factor is `max(0,1-distance/10)`; facing factor is 1 through 60 degrees then linear to .25 at 180 degrees. Validate release path before consuming a grenade.
- [ ] Run `node --test tests/gear-combat.test.js tests/equipment.test.js tests/collision.test.js`; expect all pass. Commit as `feat: add shared melee and grenade rules`.

### Task 4: Solo combat and fair bot integration

**Files:** Modify `src/game.js`, `src/bot-brain.js`, `tests/helpers/game-fixture.js`; create `tests/loot-solo.test.js`; extend `tests/combat.test.js`, `tests/offline-modes.test.js`, `tests/bot-brain.test.js`.

**Interfaces:** `ArenaGame.requestEquipment(action) -> ActionResult` accepts `{kind:'equip-gun',weaponId,source}`, `{kind:'held-item',heldItem}`, `{kind:'select-grenade',grenadeType}` or `{kind:'throw',grenadeType}`. Add `ArenaGame.getEquipmentView() -> EquipmentDTO` and `presentHeldItem(weaponId,heldItem) -> void`; the latter updates presentation only and must not grant ownership. Extend `chooseBotIntent(actor,{actors,state,map,role,smokes,lastKnownTargets})`; concealed targets may not supply their current position to pursuit. Add `chooseBotEquipment(actor,{actors,intent,smokes,solids,now}) -> action|null` in `src/bot-brain.js`.

- [ ] Use `createHeadlessGame`/`cleanupGame` for failing full-simulation tests: original-gun removal/loot restoration; one drop after gun, knife or grenade death; knife-held death drops remembered gun; respawn restores original gun rather than last equipped; solo pause freezes loot/fuses/flash; all 24 map/mode combinations initialise cleanly. Keep headless fixtures on production methods, mocking only GPU/DOM/audio sinks.
- [ ] Test a winning explosive hit stops later victim damage and duplicate drops; CTF carrier death drops its flag once. Assert bots keep M4A1 starts and difficulty firearm damage, spend collected grenades at most once per six seconds, spare teammates, and cannot shoot or track hidden current positions through smoke/flash. Objective routes remain active while blinded.

  Test name: `respawn restores original gun rather than last selected gun`:

```js
const game = createHeadlessGame();
game.start('ak47',{bots:0});
assert.equal(game.requestEquipment({kind:'equip-gun',weaponId:'mp5',source:'armory'}).ok,true);
game.resetPlayer();
assert.equal(game.getEquipmentView().activeGunId,'ak47');
assert.deepEqual(game.getEquipmentView().owned.map(w => w.weaponId),['ak47']);
cleanupGame(game);
```

- [ ] Run `node --test tests/loot-solo.test.js tests/combat.test.js tests/offline-modes.test.js tests/bot-brain.test.js`; verify new assertions fail.
- [ ] Wire the three shared modules into the simulation; construct ActorRecords once per substep and tick equipment once. Capture drops in `damageActor` on the alive-to-dead transition, clear inventory, then reset only on spawn. Record last seen enemy positions for pursuit and invalidate stale targets on death/map changes. Bot weapon choice uses existing catalog range and owned guns; smoke is considered for low health or flag carrying. Leave CTF navigation intent priority intact.
- [ ] Run the command above plus `npm test`; expect all pass. Update old tests only where the approved starting-gun rule changes their expectation; retain ammo conservation coverage with non-starting guns. Commit as `feat: integrate loot and grenades into solo play`.

### Task 5: Authoritative multiplayer and protocol 3

**Files:** Modify `server/rooms.js`, `server/server.mjs`, `src/protocol.js`; create `src/gear-protocol.js`, `tests/loot-rooms.test.js`, `tests/gear-protocol.test.js`; extend `tests/network.test.js`, `tests/rooms.test.js`, `tests/online-modes.test.js`.

**Interfaces:** Add `RoomManager.setLoadout(id,weaponId)` for lobby/results only and `RoomManager.equipmentAction(id,packet) -> ActionResult` for active-life actions. Keep `snapshot(room,consumeEvents=true)` as the shared public snapshot; add `equipmentSnapshot(id) -> {playerId,lifeId,lastActionSeq,equipment:EquipmentDTO}`. Public player records add `lifeId`, `heldItem`, `flashRemaining`; room adds `gear:{loot,projectiles,smokes}`. Welcome/state packets add a top-level `equipment` field specific to their recipient. Export `validEquipmentSnapshot(value, ownPlayer)`, `validGearWorld(value)`, `validGearEvent(event)`, `validEquipmentAction(packet)` from `src/gear-protocol.js`.

- [ ] Write failing real-manager tests covering the Task 1 sequence, exactly one death drop, current-life guards, ordered unique actions, capacity rejection, CTF/protection/team rules, late starter coverage and posthumous effects. Example core assertions: `assert.equal(PROTOCOL_VERSION,3)`, `assert.equal(secondPickupGranted,false)`, and deep equality of equipment before/after a repeated action sequence. Use `RoomManager` directly for physics scenarios and existing `connect(port)`/`moveTo(...)` patterns for real-socket tests.
- [ ] Test protocol validation with duplicate entity/weapon IDs, missing current-life ownership, negative/NaN counts, ammo above 500, over-cap entities, unknown types, wrong recipient and stale life. Validate nested DTO bounds and consistency, not only outer array lengths. Tests must reject protocols 2 and 4 and accept 3; remove old negative tests that assumed 3 was unsupported.

  Test name: `duplicate equipment action cannot alter inventory`:

```js
const manager = new RoomManager(), room = manager.create('p1','Host','ak47');
manager.join('p2',room.code,'Guest'); manager.start('p1');
const action = {type:'equipment-action',seq:1,lifeId:room.players.get('p1').lifeId,
  kind:'equip-gun',weaponId:'mp5',source:'armory'};
assert.equal(manager.equipmentAction('p1',action).ok,true);
const once = manager.equipmentSnapshot('p1');
assert.equal(manager.equipmentAction('p1',action).ok,false);
assert.deepEqual(manager.equipmentSnapshot('p1'),once);
```

- [ ] Run `node --test tests/loot-rooms.test.js tests/gear-protocol.test.js tests/network.test.js`; confirm expected red cases before adapting handlers.
- [ ] Implement active messages `{type:'equipment-action',seq,lifeId,...action}` using Task 4 action kinds. `seq` is a strictly increasing safe integer shared across action kinds for one connection, not reset on respawn. Ignore/reject duplicates without mutations; reject old-life/dead/out-of-phase requests. Clear actions on life/round transitions. Elimination centralisation must serve gunfire and effect intents without altering mode rules.
- [ ] Preserve existing motion packets, but life-bind queued attack edges so an old fire/throw cannot execute after respawn. A `loadout` message changes the future starting selection only in lobby/results. Never use active `weaponId` as the next round's original gun. Initialise starter coverage after all participants' starting IDs are captured.
- [ ] Remove the old unsequenced `equip` wire handler rather than keeping it as a bypass. Migrate relevant manager/socket tests to `setLoadout` or life-bound equipment actions. Assert a dead actor with cleared inventory still serializes a valid snapshot with zero ammo/reload, without dereferencing a missing weapon state.
- [ ] Broadcast one common room snapshot and event batch, attaching each recipient's equipment separately. Welcome uses `snapshot(room,false)`; do not consume events once per recipient. Disconnect removes the actor from harmful grenade eligibility, retains normal smoke expiry and does not manufacture death loot. Keep limits/backpressure unchanged.
- [ ] Run `node --test tests/loot-rooms.test.js tests/gear-protocol.test.js tests/network.test.js tests/rooms.test.js tests/online-modes.test.js`; expect all pass. Commit as `feat: synchronise authoritative loot with protocol 3`.

### Task 6: Client reconciliation and explicit menu actions

**Files:** Modify `src/network.js`, `src/online-game.js`, `src/multiplayer-ui.js`; extend `tests/network-client.test.js`; create `tests/equipment-menu.test.js`.

**Interfaces:** Add `RoomClient.sendEquipmentAction(action) -> boolean` with one connection-level sequence allocator. After validating a welcome/state packet, attach its recipient equipment as `room.selfEquipment` before `onRoom`. Add `OnlineArena.requestEquipment(action) -> ActionResult` and `getEquipmentView() -> EquipmentDTO`. Online `{ok:true}` means queued, not granted; only the authoritative snapshot changes equipment. Change `MultiplayerUI.deploy({equipWeaponId=null,source='armory'}={})`: no equip request on a plain resume. Keep lobby selection separate through `setLoadout` messages.

- [ ] Write failing tests using the existing `Socket`, `player()`, `room()`, `ctfRoom()` and `fixture()` helpers. Assert `sendEquipmentAction` sequences increase across UI and grenade actions, include current life, and reset only on reconnect. Replayed state must not regrant stock or replay effects; malformed recipient equipment must leave the previous complete snapshot unchanged.
- [ ] Pin Review Focus 1: open and close an unchanged menu, resume a guest after a remote start, or receive a stale equip after respawn; assert no unintended original-gun removal and no premature resume. Denied equipment actions must show a visible in-game toast, not only the hidden lobby status. A late join sees existing loot/smoke without replaying old pickup sounds.

  Extend the existing `malformed snapshots never replace a valid room` test after its valid connection setup:

```js
const previous = client.room;
socket.message({type:'state',protocol:3,room:room(),equipment:{playerId:'wrong-recipient'}});
assert.equal(client.room,previous);
```

- [ ] Run `node --test tests/network-client.test.js tests/equipment-menu.test.js`; confirm new failures.
- [ ] Validate public world and private equipment together before replacing client state. Reconcile owned ammo using `equipmentFromDTO` and `presentHeldItem`, never `equipGun` or a granting `setWeapon`. Maintain pending one-shot input only until sent, clear it on pause/death/round change, and use snapshots as authority. World removal must release visuals even while local input is suspended.
- [ ] Run `node --test tests/network-client.test.js tests/equipment-menu.test.js tests/network.test.js`; expect all pass. Commit as `feat: reconcile collected equipment and safe menu returns`.

### Task 7: Pickup and held-item visuals, concealment and audio

**Files:** Create `src/gear-view.js`, `tests/gear-view.test.js`; modify `src/game.js`, `src/online-game.js`, `src/avatar.js`, `src/audio.js`; extend `tests/skins.test.js`.

**Interfaces:** Export `createKnifeModel(THREE) -> Group` and `GearView(THREE,scene)` with `sync({loot,projectiles,smokes})`, `update({viewer,actors,flashRemaining})`, `clear()` and `dispose()`. Add optional `heldItem='gun'` to `createAvatarModel` without changing existing gun anatomy. Add `GameAudio.pickup()`, `swing()` and `grenade(type)` using existing optional audio context.

- [ ] Write failing geometry/disposal tests: every spawned visual is keyed by authoritative ID, syncing twice does not duplicate resources, removing an item removes its visual, map switch clears all entities, and disposing one view does not corrupt another. Compare every existing skin/gun/team combination before/after adding optional knife presentation; assert unchanged anatomy, hitbox and gun attachment for `heldItem:'gun'`.
- [ ] Test concealment with both clear and smoke-intersecting sight lines and with flash impairment. Hidden enemies' labels must be hidden too, while bullets still traverse smoke. Flash presentation must be a gradual desaturated veil without a recurring bright pulse. Audio methods must be harmless with sound disabled or no audio context.

  Test name: `view disposal preserves unrelated scene contents`:

```js
const scene = new THREE.Scene(), sentinel = new THREE.Group(); scene.add(sentinel);
const view = new GearView(THREE,scene);
view.sync({loot:lootDTO(createLootState({mapId:'courtyard',seed:1,startingGunIds:['ak47']})),projectiles:[],smokes:[]});
view.dispose();
assert.deepEqual(scene.children,[sentinel]);
```

- [ ] Run `node --test tests/gear-view.test.js tests/skins.test.js`; confirm expected failures.
- [ ] Implement original low-detail block pickup/knife/grenade meshes, shared materials where ownership is explicit, bounded smoke rendering and readable type labels. Drive local/remote held-item visuals from equipment snapshots. Do not call SpriteCook/image generation or change any skin. Keep physics and pickup grants outside render code.
- [ ] Run the command above plus `npm test`; expect all pass. Commit as `feat: render arena loot and grenade effects`.

### Task 8: Touch controls and carried-gun selection

**Files:** Create `src/equipment-ui.js`, `tests/equipment-input.test.js`, `tests/helpers/input-fixture.js`; modify `index.html`, `src/styles.css`, `src/input.js`, `src/main.js`, `src/multiplayer-ui.js`; extend `tests/equipment-menu.test.js` and `tests/helpers/game-fixture.js`.

**Interfaces:** `EquipmentUI({getView,onAction,onPicker,onToast})` exposes `render()` and `close()`. Add controls `#knife-button`, `#grenade-type-button`, `#throw-button`, `#grenade-picker`, and carried/Armory tabs using `data-equipment-tab` and `data-carried-weapon`. `Input.read()` adds one-shot `knifePressed`, `throwPressed`, `grenadePickerPressed`; `clear()` resets them. Gameplay actions always route through the active runtime's `requestEquipment`. Test-only `createInputFixture()` constructs the real Input with EventTarget-backed DOM/window shims and returns `{input,buttons,restore}`; restore must reinstate any original globals.

- [ ] Write failing tests asserting a quick tap or G press produces exactly one throw, held/repeated G does not repeat, Q toggles only an owned knife, and pointer cancellation clears all pending actions. Opening a picker/Loadout, Home confirmation, Android Back and backgrounding clear combat input. T opens selection but spends no grenade.
- [ ] Test explicit versus implicit selection: changing preview then cancelling causes no equip, Return to Match with no choice causes no equip, confirming an owned gun preserves ammo, original gun shows `Find this gun as loot`, and selecting a grenade type never throws. Keep home/future loadout persistence distinct from the round's original gun.

  Test name: `one pointer tap creates exactly one throw edge`:

```js
const {input,buttons,restore} = createInputFixture();
input.setEnabled(true);
buttons.get('throw-button').dispatchEvent(Object.assign(new Event('pointerdown',{cancelable:true}),{pointerId:7}));
assert.equal(input.read().throwPressed,true);
assert.equal(input.read().throwPressed,false);
input.clear(); assert.equal(input.read().throwPressed,false);
restore();
```

- [ ] Run `node --test tests/equipment-input.test.js tests/equipment-menu.test.js`; confirm red cases.
- [ ] Implement labelled touch targets, disabled/full/empty states, count display, picker focus and a carried-gun list using the existing loadout layout. Knife changes Fire to Slash and disables gun-only Aim/Reload without losing the active gun. An accepted throw suppresses attacks for the shared lock interval; it never switches the active gun. Preserve existing explicit-resume and online-neutral-input handling.
- [ ] Run the new tests plus `npm test`; expect all pass. Build only a staged directory and visually inspect 854×480 and 1200×700 before committing as `feat: add touch equipment controls`.

### Task 9: Browser proof, complete regressions and visual review

**Files:** Create `tests/loot.browser.mjs`, `tests/loot-touch.browser.mjs`; modify `tests/browser.mjs`, `tests/home.browser.mjs`, `tests/input.browser.mjs`, `tests/multiplayer.browser.mjs`, `tests/configurations.browser.mjs`, `package.json` as required by approved rule changes. Save generated evidence only under `artifacts/loot-review/`.

**Interfaces:** Add npm commands `test:loot` and `test:loot:touch`; `test:loot -- --solo` skips online cases for the pre-feature red check. Honour `DIST_DIR`; tests start an owned ephemeral server with `startServer({port:0,distDir})` and close only their own browser contexts/server. Reuse real input and passive WebSocket observations; add no product debug API or direct browser inventory/position mutation.

- [ ] Write end-to-end assertions for walking onto known authored loot, no auto equip, original-gun lock/recovery, grenade counts, knife hit, and death/reset. Two independent peers must agree on contested loot and see all three grenade effects. Drive movement through real controls; server unit tests own precisely arranged damage edge cases. Assert page exceptions and failed game assets are absent, treating an unrelated favicon 404 separately.

  Scenario name: `new match exposes disabled loot controls before collecting equipment`, after actual Home → Solo navigation:

```js
await page.locator('#knife-button').waitFor({state:'visible'});
assert.equal(await page.locator('#knife-button').isDisabled(),true);
assert.equal(await page.locator('#throw-button').isDisabled(),true);
assert.equal(Number(await page.locator('#ammo-count').textContent()) + Number(await page.locator('#reserve-count').textContent()),500);
```

- [ ] Run `DIST_DIR=artifacts/loot-review/baseline-dist npm run test:loot -- --solo` and `DIST_DIR=artifacts/loot-review/baseline-dist npm run test:loot:touch` to witness missing-loot/control failures, not merely a protocol mismatch. Then build `BUILD_DIR=artifacts/loot-review/dist npm run build` and run against that candidate, without changing the public game.
- [ ] Extend multi-touch tests for simultaneous move/aim/throw, hold/release/cancel, modal transitions and Android-style background suspension. Update old ammo-switch tests to use non-starting guns for conservation while separately asserting the new starting-gun restriction; do not weaken or delete existing protections.
- [ ] Run `npm test`, then `DIST_DIR=artifacts/loot-review/dist npm run test:browser`, `test:home`, `test:touch`, `test:multiplayer`, `test:configurations`, `test:loot` and `test:loot:touch` with that same environment. Expect every suite to pass, including all 24 map/mode combinations. Add real-socket saturation checks that entity counts and packet sizes remain bounded and the existing backpressure guard is still active; record typical and maximum serialized bytes.
- [ ] Use the installed Playwright CLI in named owned sessions for an independent manual-flow check and screenshots at 854×480 and 1200×700. Inspect loot labels, flash recovery, smoke/name-tag concealment and all new buttons. Repeat map/skin/weapon changes and inspect resource cleanup; report software-renderer measurements as browser evidence, not physical BYD performance.
- [ ] Share the staged screenshots or browser preview for the specified control-layout review before public rollout. Resolve requested in-scope layout changes and rerun affected checks. Commit test changes as `test: verify loot touch and multiplayer flows`.

### Task 10: Package a verified Android candidate

**Files:** Create `android/tests/package-smoke.mjs`; modify `android/app/build.gradle`, `package.json`, `package-lock.json`, `game-server.json`, `README.md`, `android/tests/emulator-smoke.mjs`, `android/tests/emulator-online-smoke.mjs`; preserve user edits when touching README. Generated files remain under `artifacts/loot-review/` until final release.

**Interfaces:** Target version `0.4.0`, Android version code `4`, protocol `3`, unchanged package `au.local.blockops`. Build output is `artifacts/block-ops-v0.4.0-debug.apk`. `package-smoke.mjs` accepts `ANDROID_APK_PATH` and `DIST_DIR`, uses the detected SDK's aapt/apksigner and unzip to assert metadata/signing/bundled-byte equality, and prints the APK hash. Native online smoke also accepts `GAME_TEST_SERVER_URL` to set a staging origin through the real Server settings UI without changing the APK's bundled default.

- [ ] Add package and native smoke assertions before changing release metadata: versionName 0.4.0, versionCode 4, minimum SDK 26, target 36, INTERNET-only permission, bundled offline assets, protocol-3 online connection. Native scripts exercise pickup, a real equipment action, background/resume and shared authoritative state with an independent peer.

  Check name: `loot APK metadata matches the reviewed release`, using `badging` read from SDK aapt in `package-smoke.mjs`:

```js
assert.match(badging,/versionCode='4'/);
assert.match(badging,/versionName='0\.4\.0'/);
assert.match(badging,/sdkVersion:'26'/);
assert.match(badging,/targetSdkVersion:'36'/);
```

- [ ] Resolve the validated previous APK path as `task_previous_apk` and run `ANDROID_APK_PATH="$task_previous_apk" DIST_DIR=artifacts/loot-review/baseline-dist node android/tests/package-smoke.mjs`; verify the version mismatch. Resolve the currently working public origin as `task_server_url` and check its `/health` before updating metadata/default URL. The last known origin is `https://emerald-arctic-thanks-settings.trycloudflare.com`; do not blindly use the obsolete `game-server.json` value. Stage with `BUILD_DIR=artifacts/loot-review/apk-dist GAME_SERVER_URL="$task_server_url" npm run build`. Rerun browser tests with that `DIST_DIR` so the final packaged bytes are the tested bytes.
- [ ] Preserve the current `artifacts/block-ops-debug.apk` under a validated non-overwriting backup path before calling the existing packaging script, because that script overwrites the latest APK. Package using `DIST_DIR=artifacts/loot-review/apk-dist bash scripts/build-apk.sh --offline lintDebug`, with the detected cached Gradle/SDK environment. Copy the candidate to its versioned filename and restore the previous latest APK until rollout.
- [ ] Run `ANDROID_APK_PATH=artifacts/block-ops-v0.4.0-debug.apk DIST_DIR=artifacts/loot-review/apk-dist node android/tests/package-smoke.mjs`; expect signing, metadata and all four bundled-byte comparisons to pass. Run native smoke scripts sequentially on an explicitly owned disposable emulator. Use `GAME_TEST_SERVER_URL` for a candidate protocol-3 server/tunnel while the live origin remains protocol 2; test the bundled default separately, without rebuilding a different APK. If no emulator is available, state native checks were not run rather than fabricating evidence or touching a physical vehicle.
- [ ] Record commands, results and limitations in `artifacts/loot-review/verification.json`; update release documentation without claiming publication. Commit metadata/test/docs changes as `build: package Block Ops loot release candidate`.

### Task 11: Final review and coordinated release

**Files:** No additional product behaviour. Preserve rollback assets and release evidence; update README only with verified final artifact/link information.

**Interfaces:** Live HTTP `/health` reports `rooms`; public static assets and WebSocket protocol must be switched together. Final deliverables are the browser link, latest and versioned APK, and verification evidence. Do not change the Cloudflare tunnel process unless its actual health requires separate recovery.

- [ ] Use `superpowers:requesting-code-review` for the complete change and `superpowers:verification-before-completion` before success claims. Fix blocking findings, rerun affected tests and confirm the reviewed source equals the packaged source. If execution used an isolated worktree, integrate only this feature's changes into the approved release checkout without overwriting the user's unrelated files.
- [ ] Confirm the control-layout review is complete and check live room count immediately before release. If occupied, wait for rooms to empty; do not empty them by force. Announce the short coordinated maintenance window. Preserve validated previous source revision, static assets and latest APK for recovery.
- [ ] Stop only the identified game-server process after the empty-room gate, publish the tested assets, and start the reviewed protocol-3 server on the existing origin port. Leave the existing tunnel running. If health or handshake checks fail, use a preserved prior release checkout and validated asset backup to restore service; do not use destructive git resets or overwrite user work to roll back.
- [ ] Check public `/health`, compare downloaded public assets with the staged files, and use two fresh real browser peers to create a private test room, collect loot and throw grenades. Verify a protocol-2 client gets the update message. Close only the test peers/room. Install/promote the already verified candidate as the latest APK, keeping previous versioned artifacts.
- [ ] Report what shipped, browser refresh/APK update instructions, test evidence and any native/device limits. Follow `superpowers:finishing-a-development-branch` for integration handoff; do not delete the active release checkout, running server or tunnel as cleanup. Commit only the final verified documentation if it changed.

## Plan self review

Spec coverage maps equipment/ammo to Task 1; location, expiry and death drops to Task 2; melee/grenades/status to Task 3; bots/solo to Task 4; authority/protocol to Task 5; reconciliation/menu safety to Task 6; art/audio/concealment to Task 7; controls/lifecycle to Task 8; all-map/browser review to Task 9; native packaging to Task 10; and safe release to Task 11. The five Review Focus cases are explicitly assigned above. Shared names and DTO ownership must remain consistent across task implementations; changes to a contract require updating its consumers and this plan.

## Approval and execution

The written design is approved. This implementation plan awaits review and an execution-method choice; no product changes are authorised by merely creating this file. Recommend subagent-driven execution because equipment ownership, delayed grenade effects and online authority cross several independently testable boundaries. Native execution with one final independent review is the alternative with fewer review steps.
