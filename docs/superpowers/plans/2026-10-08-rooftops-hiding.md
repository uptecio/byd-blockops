# Rooftop Routes and Hiding Spots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add usable rooftop routes, ordinary shelters and special hiding spots to all eight maps in solo bots, solo Zombies and online multiplayer, with the user's camping and concealment rules.

**Architecture:** Shared explicit-height spatial queries and a pure character mover become the physical authority for players, AI and the server. Authored surfaces/routes and a separate hiding state machine feed navigation, combat, objectives and a thin touch/network presentation layer. Existing scoring, inventory and progression remain the only authorities for their own state.

**Tech Stack:** JavaScript ES modules, Three.js 0.160.1, Node `node:test`, ws 8.21.0, Playwright 1.58.2, esbuild 0.25.12, existing Android WebView wrapper/Gradle/ADB. No new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-rooftops-hiding-design.md` (approved 2026-10-08).

Status: written plan awaiting user review and execution-method selection. No implementation steps have run. Planning baseline: `f793eb0`, product version 0.7.0/protocol 5/code 9.

## Global Constraints

- Upgrade all eight existing maps, retaining their themes and familiar layouts.
- Normal jumps using crates, steps and ledges, not a super-jump.
- No fall damage.
- Single-entrance defensible positions are intentional. Do not require a second approach or add an anti-camping timer, forced movement or escalating punishment for staying still.
- Entering a special hiding spot makes bots and zombies lose track, even if they watched the player enter.
- Human multiplayer opponents can attack hiding spots. A damaging hit damages the occupant and forces them out.
- Pressing Fire while hidden exits the spot before the attack is resolved.
- One living player occupies a special hiding spot at a time. Bots and zombies do not themselves enter special hiding spots in this release.
- Existing five-second health/armour supply use and ordinary reloading are allowed while hidden.
- A flag carrier may hide; no flag interaction or ground-loot collection while hidden. Incidental damage still applies.
- At least two elevated defensive positions, one sheltered room/alcove and two special hiding spots per map; at least one position per map has a single ground-to-position approach.
- Risers no higher than 0.55 units, landing depth at least 1.2 units and route width at least 1.6 units. Jump velocity 4.3 and gravity 13.
- Keyboard H hides/exits; preserve E zoom, Space jump and numbered inventory shortcuts.
- Target release 0.8.0, Android version code 10 and network protocol 6.
- Preserve the existing ES2017 build target, WebGL1 fallback, Android minimum/target SDK, app identity, signing identity and permissions. Current Android values are minSdk 26, targetSdk 36 and package `au.local.blockops`; keep the existing signer.
- Preserve saved XP, cosmetics, local settings, server preferences and all unrelated working-tree changes. No live restarts, tunnel changes, user-data clearing or broad cleanup during implementation/testing.
- No minimap, online Zombies, ladders/mantling, destruction, weapon rebalance, new reward track or vehicle-safety changes.

## Review Focus

1. Fire/throw pressed during healing, reloading or with an empty gun must still expose a hidden player before ordinary attack gating (Tasks 5, 7, 8).
2. Delayed/repeated hide acknowledgements from a previous life/round must not hide, eject or move the current life (Task 8).
3. A low ceiling, one long frame or arena-edge roof must not clip the camera/body through geometry or eject a player outside bounds (Tasks 1, 2, 9).
4. Roof/ground overlap must not cause ghost pickups, flag captures, melee hits or lost death drops across floors (Tasks 2, 6, 8).
5. Holding Hide, cancelling a pointer or losing focus during simultaneous Move/Fire must not repeat a hide toggle, leak input to aim, or leave controls stuck (Tasks 7, 9).

---

## File structure and shared contracts

New production modules:

| File | Responsibility |
| --- | --- |
| `src/spatial.js` | Normalised 3D box bounds, body occupancy, supports, segment/ray queries, interaction reach |
| `src/character-movement.js` | Pure grounded/jumping/falling movement and shared human speed calculation |
| `src/map-traversal.js` | Box-only room/step/hide authoring primitives and metadata validation |
| `src/map-traversal-layouts.js` | Eight map-specific additions and explicit retained/converted structure selection |
| `src/actor-perception.js` | Hidden/smoke/flash/wall visibility and target-memory clearing |
| `src/hiding.js` | Occupancy/life-bound transitions, contextual eligibility and safe exit/drop anchors |
| `src/hiding-combat.js` | Occupied-spot damage proxies and external-cover-aware hit/exposure queries |
| `src/hiding-ui.js` | Contextual button/status and pending-request UI, no simulation authority |
| `src/hiding-protocol.js` | Strict hide request/result validation, no socket or renderer dependency |

Existing integration files are listed under each task. Do not create duplicate inventory, combat, profile or rendering systems.

Use these names consistently (JSDoc types in the owning modules, not a new TypeScript toolchain):

- `Point3 = {x:number,y:number,z:number}`; feet Y, not eye/model-bob Y.
- `Solid3 = {id:string,x,z,w,d,minY,maxY,height:number,hideSpotId?:string}`. `height = maxY - minY` remains a geometry-size alias; no consumer may treat it as absolute top. Legacy boxes with only `height` normalise to `minY=0,maxY=height`.
- `SpatialWorld = {mapId:string,bounds:{min,max},solids:readonly Solid3[],maxFeetY:number}`. Ground is Y=0 inside bounds; `maxFeetY` is the highest collider top plus jump apex and a small numerical tolerance, computed rather than supplied by clients.
- `BodyState = Point3 & {velocityY:number,grounded:boolean,supportId:string|null}`. Ground support ID is `ground`; other support IDs are solid IDs. Radius and height are mover options, not client-controlled state.
- `MoveIntent = {vx:number,vz:number,jump:boolean}` uses world-units/second. Runtime adapters translate the existing local movement/yaw once. `MoveResult = {body:BodyState,invalid:boolean}` never modifies its input.
- `RouteLink = {id,from:Point3,to:Point3,kind:'walk'|'jump'|'drop'}`; endpoints lie on validated supports. `Waypoint = Point3 & {kind:'walk'|'jump'|'drop',linkId:string|null}`.
- `HideSpot = {id,kind,entry:Point3,occupant:Point3,view:Point3,exit:Point3,recovery:Point3,proxy:{min:Point3,max:Point3},shellIds:string[]}`. Entry/exit/recovery are clear and supported; view is a clear opening. `shellIds` only exempts that prop from proxy occlusion, never an unrelated wall or roof.
- Maps gain `traversal:{roofs:[{id,point:Point3,singleEntrance:boolean,entryLinkId:string|null}],shelters:[{id,point:Point3}],links:RouteLink[],patrolPoints:Point3[]}` and `hideSpots:HideSpot[]`. Stable IDs are map-local. All definitions remain deeply frozen.
- Gameplay actor DTOs gain `grounded`, `supportId`, `hiddenSpotId:string|null`. Full BodyState belongs to simulation, not animated meshes. Local `player.jump` remains a compatibility presentation alias for feet Y until all existing callers are deliberately migrated; it is not a second physics integrator.
- `HidingState = {occupants:Map<spotId,{actorId,lifeId}>,actors:Map<actorId,{lifeId,spotId}>}`. Pure rules mutate only this owned state and return a transition; the runtime applies the resulting body once. A transition is `{ok:boolean,reason:string|null,changed:boolean,hiddenSpotId:string|null,position:Point3|null}`.

Dependency order: 1 → 2 → 3 → 4; 5 consumes 1/3; 6 consumes 1/3/5; 7 consumes 2/4/5/6; 8 consumes 2–7; 9 → 10 → 11 are verification/delivery gates. Tasks 4 and 5 can be independently reviewed but should not edit shared runtime files concurrently.

Execution preflight, after plan approval: invoke the chosen execution skill and workspace/isolation workflow; record exact branch/status and preserve user dirt. Create a task-owned artifact directory with `mktemp -d` under `artifacts`, retain a frozen 0.7.0 baseline and record environment versions. Run `npm test` and capture baseline rendering/raw-frame timings before product edits. Do not count a historical test run as the baseline. Commands below run from the selected repository checkout; replace named artifact destinations only with the explicitly recorded owned paths.

## Task 1: Explicit-height spatial queries and pure character movement

**Files:** Create `src/spatial.js`, `src/character-movement.js`, `tests/spatial.test.js`, `tests/character-movement.test.js`, `tests/helpers/traversal-fixture.js`. Modify `src/collision.js` only to share the height-aware LOS implementation while preserving existing 2D helper callers until Task 2.

**Interfaces:**

- `createSpatialWorld(map) -> SpatialWorld`, `solidBounds(solid) -> {min:Point3,max:Point3}`; validate finite positive boxes and unique IDs.
- `canOccupyBody(position,radius,height,world) -> boolean` allows touching a supporting top but no interior overlap.
- `supportBelow(position,radius,world) -> {id,y}|null` returns the highest valid support at or below feet, including ground; candidates require full-body clearance where used for landing/recovery.
- `segmentClear(a,b,world,{ignoreSolidIds=[]}={}) -> boolean` and `rayBoxHit(origin,direction,range,bounds) -> {point,distance}|null` share explicit Y bounds.
- `createBody(position,world,{radius=.4,height=1.84}={}) -> BodyState` throws for an invalid initial body.
- `moveCharacter(body,intent,dt,{world,radius=.4,height=1.84}) -> MoveResult`; `humanMoveSpeed(classId,zoom) -> number` retains 4.4 LMG, 6 sidearm/SMG, 5.3 otherwise, times .65 when zoomed.
- Test helper `stackedFixture()` returns `{world,ground:Point3,roof:Point3,underRoof:Point3,ceilingPoint:Point3}` with a roof slab at Y=3; `advanceBody(body,intent,seconds,world,options={}) -> BodyState` repeatedly invokes the mover at 1/120 seconds, passing a requested jump edge only on its first step.

- [ ] **Step 1 — Write failing contract tests.** Use Node tests/imports and a slab fixture with empty space below, a .55 step, a thin side wall and arena bounds. Pin the following assertions in named tests:

```js
assert.equal(supportBelow(roof, .4, world).y, 3);
assert.equal(canOccupyBody(underRoof, .4, 1.84, world), true);
assert.equal(segmentClear(underRoof, roof, world), false);
assert.equal(humanMoveSpeed('lmg', true), 4.4 * .65);
assert.equal(advanceBody(createBody(roof, world), {vx:0,vz:0,jump:false}, 1, world).y, 3);
```

Also assert one jump lands on a .55 step, no jump from mid-air, upward head collision stops velocity, falling finds the first support, long frames cannot cross a thin wall, feet stay within radius-inset bounds above the perimeter, and NaN/Infinity/negative dt return `invalid:true` without contaminating the body. A jump input is consumed once even when a long frame is substepped.

- [ ] **Step 2 — Run red.** `node --test tests/spatial.test.js tests/character-movement.test.js`; expect missing new module/export or the exact unimplemented height behavior, not an unrelated fixture error.
- [ ] **Step 3 — Implement the stated interfaces.** Bound physics substeps by both time (at most 1/120 second) and swept displacement (at most .1 unit); cap a single accepted frame duration at .25 seconds. Resolve horizontal side sweep, upward ceiling and downward support crossings; never step automatically up a .55 obstacle without Jump. Export `MOVEMENT={jumpVelocity:4.3,gravity:13,maxFrame:.25,maxStep:1/120}`. Invalid moves retain the last valid body. Legacy solids without IDs receive deterministic `${map.id}:solid:${index}` IDs during normalisation; Task 3 authoring supplies explicit stable IDs. `hasLineOfSight(a,b,solids)` retains its 2D behavior when neither endpoint has Y; 3D callers delegate explicit-height queries.
- [ ] **Step 4 — Run green/regression.** `node --test tests/spatial.test.js tests/character-movement.test.js tests/collision.test.js`; then `npm test`. Expected: zero failures, existing ground-only behavior preserved.
- [ ] **Step 5 — Commit.** Stage only the six Task 1 files; `git commit -m "feat: add shared height-aware character movement"`.

## Task 2: Integrate shared movement and vertical combat geometry

**Files:** Modify `src/game.js`, `src/world.js`, `server/rooms.js`, `src/gear-combat.js`, `src/online-game.js`, `tests/helpers/game-fixture.js`, `tests/collision.test.js`, `tests/combat.test.js`, `tests/gear-combat.test.js`. Create `tests/vertical-runtime.test.js`.

**Interfaces:** Consume Task 1. `createWorld(...)` additionally returns `spatial:createSpatialWorld(definition)`. Server `physicsFor(map)` uses the same SpatialWorld and `solidBounds` for Three.js ray boxes. Existing `ArenaGame`/`RoomManager` public methods remain intact. Preserve current radii: solo human .34, online human .4, ordinary bot .4 and zombie .4; physical height is 1.84. Conservative authored clearance remains .42. Camera eye remains feet +1.65; gear eye +1.6 and gun hitbox dimensions remain unchanged.

- [ ] **Step 1 — Add failing runtime tests.** Use `createHeadlessGame()` and a deterministic RoomManager pair. Feed identical yaw/movement/jump/dt traces in unobstructed space from the same valid body and compare position/velocity within 1e-8. Separately assert side-wall clearance using each runtime's existing radius; pure mover parity uses identical radius/options, not a silent radius rebalance. Assert a roof remains a valid landing after repeated updates; body/mesh bob do not change hitbox height. Test gun, knife and grenade separation between a room and its roof, plus an unobstructed shot over low cover. Assert a .25-second stall cannot escape a wall/ceiling and a fall does not alter health.

```js
// Tests: "solo and server share a movement trace", "roof blocks cross-floor attacks".
assert.ok(Math.hypot(solo.x-server.x, solo.y-server.y, solo.z-server.z) < 1e-8);
assert.ok(Math.abs(solo.velocityY-server.velocityY) < 1e-8);
assert.equal(roofVictim.health, 100);
assert.equal(fallenPlayer.health, healthBeforeFall);
```

- [ ] **Step 2 — Run red.** `node --test tests/vertical-runtime.test.js`; expect ground-clamping, mismatched gravity or old ray-box failures.
- [ ] **Step 3 — Wire one physics path.** Replace local/server jump/gravity blocks with `moveCharacter`, retaining runtime fixed-step clocks and existing speed/zoom behavior. Initialise/reset velocity/support on spawn; validate externally changed test positions explicitly. Separate bot physical fields from cosmetic mesh bob. Use `solidBounds` in hitscan, grenade sweep/rest/inside tests and all 3D LOS. Online remains server-driven; expose/interpolate feet Y normally, with no client physics authority or new packet keys yet. Route map errors through the existing visible runtime-error path, not HUD-only success.
- [ ] **Step 4 — Run green.** `node --test tests/vertical-runtime.test.js tests/combat.test.js tests/gear-combat.test.js tests/headshots.test.js tests/rooms.test.js tests/zombie-game.test.js`; then `npm test`. Existing tests that intentionally position bots must position physical state as well as models; retain their gameplay assertions.
- [ ] **Step 5 — Commit.** Stage only Task 2 changed files; `git commit -m "feat: share vertical physics across solo and online simulation"`.

## Task 3: Author and validate rooftop/shelter/hide geometry on all eight maps

**Files:** Create `src/map-traversal.js`, `src/map-traversal-layouts.js`, `tests/map-traversal.test.js`. Modify `src/maps.js`, `src/map-preview.js`, `src/loot-spawns.js`, `tests/maps.test.js`, `tests/loot-placement.test.js`, `tests/zombie-maps.test.js`.

**Interfaces:**

- `addRoom(builder,{id,x,z,w,d,floorY,roofY,doorSide,colour,trim})`, `addStepRoute(builder,{id,points,width,depth,colour})`, `addHideSpot(builder,spot,{colour,trim})` emit matching blocks/solids and metadata, not runtime entities.
- `addTraversalLayout(builder,mapId) -> void` chooses one explicit layout from the approved map table; identify converted legacy structures by stable author IDs, never floating-point coordinate guesses in runtime code.
- `validateTraversal(map) -> {ok:boolean,errors:string[]}` checks structural/anchor constraints using Task 1, with no renderer dependency. Map builder exports frozen new fields from the shared contracts.

- [ ] **Step 1 — Add failing all-map tests.** For each map assert roof count ≥2, shelter count ≥1, hide count ≥2, unique IDs, both team sides can reach a route start, at least one `singleEntrance`, clear supported entry/exit/recovery, visible collider bounds exactly matching render blocks and preserved spawn/base/loot connectivity. Assert `maxY-minY===height`, replacing the old ground-anchored render assertion. Reject duplicate IDs, blocked exits, impossible risers, insufficient landing width/depth and obstructed viewing points. Use the real mover to replay every authored jump at zoomed-LMG speed and at zombie speeds 2.1/3.4; do not accept a declared link as proof.

```js
// Test each map: "authored routes and hiding anchors are physically valid".
assert.equal(validateTraversal(map).ok, true);
assert.ok(map.traversal.roofs.length >= 2 && map.hideSpots.length >= 2);
assert.ok(map.traversal.shelters.length >= 1);
assert.ok(map.traversal.roofs.some(roof => roof.singleEntrance));
assert.equal(validateTraversal(mapWithBlockedExit).ok, false);
```

- [ ] **Step 2 — Run red.** `node --test tests/map-traversal.test.js`; expect absent metadata/content on current maps.
- [ ] **Step 3 — Implement the eight explicit layouts.** Apply the spec's per-map visual table and minimums; open selected existing solids into real walls/ceilings, retain lanes and IDs. Keep hide props' occupancy visually neutral. Supply stable authored entry/view/exit/recovery/proxy anchors. Low terraces are acceptable on Neon City; do not make tower-top super-jumps. Preserve procedural box materials and preview scaling. Relocate a ground loot slot only when necessary to retain existing count, spacing and accessibility. Validate the physical neighborhood around every single-entrance roof: removing its one approach must leave no alternative reachable normal-jump chain; drops downward do not count as entry routes.
- [ ] **Step 4 — Run green.** `node --test tests/map-traversal.test.js tests/maps.test.js tests/loot-placement.test.js tests/zombie-maps.test.js`; then `npm test`. Update obsolete test assumptions to explicit-height collision without weakening all-map/spawn/loot assertions. Runtime AI route behavior is implemented in Task 4, not claimed here.
- [ ] **Step 5 — Commit.** Stage only Task 3 files; `git commit -m "feat: add rooftop routes and shelters to eight arenas"`.

## Task 4: Level-aware navigation, AI movement and perception

**Files:** Create `src/actor-perception.js`, `tests/vertical-navigation.test.js`, `tests/actor-perception.test.js`. Modify `src/navigation.js`, `src/bot-brain.js`, `src/zombie-brain.js`, `src/zombie-runtime.js`, `src/game.js`, `tests/bot-brain.test.js`, `tests/zombie-brain.test.js`, `tests/zombie-recovery.test.js`.

**Interfaces:**

- `createNavigation(map,{radius=.42,height=1.84}={})` retains `nextWaypoint`, `nextApproachWaypoint`, `reachable`, `clearCache`; points are now Point3 (legacy omitted Y means 0), and returned waypoints include Task 1/3 transition metadata. Add `patrolPoint(actorId,position,sequence) -> Point3|null`, selected independently of concealed target position.
- `navigationIntent(body,waypoint,speed,world) -> MoveIntent` exported from `src/navigation.js`; initiates a jump only at its take-off region and after grounding. A stalled/failed transition triggers replan, not teleport.
- `canPerceive(observer,target,{world,smokes}) -> boolean`, `forgetTarget(brain,targetId) -> void` in `actor-perception.js`. Hidden targets always fail perception; smoke, flash and wall LOS apply. The forget helper clears target-specific memory/intent/path state, not unrelated objectives.
- `stepZombieBrain(...)` returns its existing yaw/attack result plus `body:BodyState`; bot/zombie runtimes keep that physical state. Hidden targets are supported now even though their entry UI comes later.

- [ ] **Step 1 — Write failing routes/perception tests.** Build stacked floor/roof fixtures; assert the same X/Z with different Y produces different destinations, bots/walkers/runners climb and descend every map's authored routes through the mover, no unreachable teleport, no cross-floor crowd shove or melee, and stable progress around a failed jump. Set a player `hiddenSpotId`, seed witnessed memory/waypoints, call the real perception/brain path and assert target/memory cleared, patrol continues and no intentional attack occurs. A hidden flag carrier must not become a CTF pursuit target; exiting behind a wall does not restore tracking. Retain smoke/flash regressions.

```js
// Tests: "route reaches the selected support", "witnessed hiding erases pursuit".
assert.ok(Math.abs(arrivedBody.y - route.to.y) < 1e-8);
assert.equal(arrivedBody.grounded, true);
assert.equal(canPerceive(observer, hiddenPlayer, {world, smokes:[]}), false);
assert.equal(brain.lastKnownTargets.has(hiddenPlayer.id), false);
assert.equal(zombieStep.attack, false);
```

- [ ] **Step 2 — Run red.** `node --test tests/vertical-navigation.test.js tests/actor-perception.test.js`; expect height loss and hidden-target tracking failures.
- [ ] **Step 3 — Implement the level graph and adapters.** Use .5-unit walkable sampling per authored support surface and validated walk/jump/drop links, with bounded 32-field LRU path caching. Always insert validated route-endpoint nodes even when a short landing has no grid centre; connect only across clear supported segments. Do not reconstruct navigation each frame. Retain cardinal safe ground movement; keep separate levels in node/cache keys. Use 3D range/pitch for bot equipment/attacks and actual physical feet Y for zombies. Clear memory on hide even if witnessed; patrol from map patrol points without using hidden coordinates. Spawn validation uses the hidden spot's accessible entry anchor only for connectivity, never as pursuit, so wave spawning continues. Preserve maxAlive 8 and damage `10 + (wave-1)*5`.
- [ ] **Step 4 — Run green.** `node --test tests/vertical-navigation.test.js tests/actor-perception.test.js tests/bot-brain.test.js tests/zombie-brain.test.js tests/zombie-game.test.js tests/zombie-recovery.test.js`; then `npm test`. Test all eight maps and both zombie speeds, not only Courtyard.
- [ ] **Step 5 — Commit.** Stage only Task 4 files; `git commit -m "feat: let bots and zombies traverse rooftops and respect concealment"`.

## Task 5: Pure hiding transitions and occupied-spot combat proxies

**Files:** Create `src/hiding.js`, `src/hiding-combat.js`, `tests/hiding.test.js`, `tests/hiding-combat.test.js`. Modify `src/gear-combat.js`, `tests/gear-combat.test.js`.

**Interfaces:**

- `createHidingState() -> HidingState`; `requestHide(state,actor,action,{map,world,active}) -> Transition` where action is `{kind:'enter'|'exit',spotId,lifeId}`.
- `exitHiding(state,actor,{map,world,reason}) -> Transition`; `releaseHiding(state,actorId,lifeId) -> void`; `hidingContext(state,actor,{map,world,active}) -> {spotId:string|null,label:'Hide'|'Exit'|'Occupied'|null,enabled:boolean}`.
- `attackExit(state,actor,rawIntent,{map,world}) -> Transition|null` handles fire, firePressed and an actual throw request, not equipment selection. `hidingDropPosition(state,actor,map) -> Point3` returns the clear exit before occupancy is released.
- `spotDamageTargets(state,actors,map) -> [{actorId,lifeId,spotId,bounds,shellIds}]`; `raySpotHit(origin,direction,range,targets,world) -> {actorId,lifeId,spotId,point,distance}|null`; `spotBlastExposure(origin,target,world) -> {point:Point3,distance:number,visible:boolean}`.
- `meleeTarget` and `stepGearCombat` gain optional `hiding:{state,map,world}` in their existing options; they map proxies to ordinary actor IDs rather than creating duplicate actors. Default absence preserves existing tests/callers.

- [ ] **Step 1 — Add failing pure tests.** Assert entry at 1.5 units succeeds while 1.5001, different floor, airborne/dead/inactive/wrong-life and obstructed entry fail without movement. Two simultaneous requests admit exactly one; duplicate enter/exit is idempotent. Assert no time limit, jump/move cannot exit, and `attackExit` succeeds with empty ammo, reload or active supply use without granting a shot. Test shell-only occlusion exemption, external wall/roof blocking, empty spot no hit, knife reach/cone, frag range, body-only gun damage, protected/friendly filtering and one target per bullet. Health/armour application remains the existing runtime's responsibility.

```js
// Test: "raw Fire exits a hidden player even while healing".
const entered = requestHide(state, actor, {kind:'enter',spotId:spot.id,lifeId:actor.lifeId}, {map,world,active:true});
assert.equal(entered.ok, true);
const exposed = attackExit(state, actor, {fire:true,firePressed:true}, {map,world});
assert.equal(exposed.hiddenSpotId, null);
assert.deepEqual(exposed.position, spot.exit);
assert.equal(actor.equipment.supplies.health, suppliesBefore);
```

- [ ] **Step 2 — Run red.** `node --test tests/hiding.test.js tests/hiding-combat.test.js`; expect missing interfaces.
- [ ] **Step 3 — Implement state/proxy rules.** Validate all anchors through Task 1 and map metadata; return safe positions in transitions. Tag occupancy by actor+life, map IDs never client coordinates. Choose nearest eligible entrance, breaking ties by spot ID. Exit uses the authored clear exit/recovery, never searches through a wall. Proxy ray hits use normal body damage, not `gunHitDamage`'s head zone; physical prop geometry remains for all unrelated purposes. Flash/smoke alone do not eject, and existing projectiles survive hide entry.
- [ ] **Step 4 — Run green.** `node --test tests/hiding.test.js tests/hiding-combat.test.js tests/gear-combat.test.js tests/headshots.test.js tests/actor-perception.test.js`; then `npm test`.
- [ ] **Step 5 — Commit.** Stage only Task 5 files; `git commit -m "feat: define life-safe hiding and damageable spot proxies"`.

## Task 6: Height-correct loot, flags and safe drop locations

**Files:** Modify `src/spatial.js`, `src/loot.js`, `src/loot-spawns.js`, `src/modes.js`, `src/objectives.js`, `src/game.js`, `server/rooms.js`, `src/network.js`, `tests/loot.test.js`, `tests/modes.test.js`, `tests/network-client.test.js`, `tests/carried-flag-visibility.test.js`. Create `tests/vertical-interactions.test.js`.

**Interfaces:**

- `interactionReach(a,b,world,{horizontal=1.2,vertical=.75}={}) -> boolean` in `spatial.js` uses finite 3D points, those reach limits and LOS between points raised .1 above support, avoiding ground-contact self-occlusion.
- `dropAnchor(position,world,{radius=.34,height=.2}={}) -> Point3|null` finds the first valid support below and validates small-item clearance, retaining the current .34 drop radius. Hidden runtime callers pass `hidingDropPosition` before releasing occupancy.
- `collectLoot(state,actors,{solids,world})`, `addDeathDrops(state,{actorId,lifeId,position,items,solids,world})` retain return values and legacy `solids` fallback for old ground-only fixtures. Production always supplies `world`.
- `createModeState` caches SpatialWorld privately from its map; existing `tickMode`, `recordElimination` and `removeParticipant` signatures remain. Flag snapshots add Y to home/carried/dropped states. Update the strict current flag schema on both ends now; the coordinated protocol bump and final shape occur in Task 8, with no intermediate release.

- [ ] **Step 1 — Write failing floor-overlap tests.** In a fixture with roof Y=3, ground loot/flag directly below and an unobstructed same-roof item, verify these representative assertions and their reverse directions:

```js
assert.equal(interactionReach({x:0,y:3,z:0}, {x:0,y:0,z:0}, world), false);
assert.equal(interactionReach({x:0,y:3,z:0}, {x:.5,y:3,z:0}, world), true);
assert.equal(roofDeathDrops.every(item => item.y === 3), true);
assert.equal(droppedFlag.y, 3);
assert.equal(returnedFlag.y, 0);
assert.equal(hiddenCarrierCaptureEvents.length, 0);
```

Derive drops/events from the real APIs, not handmade expected objects. Also test aerial drops selecting the first support, blocked spread falling back to the anchor, hidden death/disconnect drops at exit, hidden loot ineligibility, automatic flag return, expiry, capacity, starter coverage, supply count and one-drop-per-life.
- [ ] **Step 2 — Run red.** `node --test tests/vertical-interactions.test.js`; expect lost drop Y and horizontal-only flag/pickup failures.
- [ ] **Step 3 — Implement reach/drop/flag behavior.** Preserve all existing ammo, supply counts, item spread/unlock/expiry and scoring. Hidden actors remain participants/carriers but are excluded from pickup/return/capture loops. Carry flag Y through snapshots/rendering; conceal the carried flag when its carrier is hidden. No hidden-state leak into bot objective goals. Use shell-free exit coordinates for hidden drops; do not use an occupied prop's interior as an item support.
- [ ] **Step 4 — Run green.** `node --test tests/vertical-interactions.test.js tests/loot.test.js tests/loot-placement.test.js tests/loot-saturation.test.js tests/modes.test.js tests/carried-flag-visibility.test.js tests/network-client.test.js tests/progression-rooms.test.js`; then `npm test`.
- [ ] **Step 5 — Commit.** Stage only Task 6 files; `git commit -m "fix: preserve elevation for loot drops and flag interactions"`.

## Task 7: Offline hiding, touch controls and honest presentation

**Files:** Create `src/hiding-ui.js`, `tests/hiding-solo.test.js`, `tests/hiding-input.test.js`, `tests/hiding-ui.test.js`. Modify `src/game.js`, `src/input.js`, `src/main.js`, `src/gear-view.js`, `src/objectives.js`, `src/zombie-runtime.js`, `index.html`, `src/styles.css`, `tests/helpers/game-fixture.js`, `tests/helpers/input-fixture.js`.

**Interfaces:**

- `Input.read()` adds `hidePressed:boolean`, cleared on read/blur/cancel; existing `knifePressed` selects equipment and is not itself a knife attack.
- `ArenaGame.requestHide(action) -> Transition`, `ArenaGame.getHidingView() -> {label,enabled,hidden,pending,spotId,reason}`. Hiding state is fresh per round, cleared on quit/map replacement/death and never stored in a profile.
- `HidingUI({button,status})` exposes `render(view)` and `dispose()`, only updates DOM and binds no input listeners. Use `#hide-button` and `#hiding-status`; exact labels: Hide, Exit, Occupied, Hiding, Waiting…. Touch/keyboard enqueue one input edge through Input, not both an input edge and direct state mutation.
- Runtime applies a successful transition's body/hidden identity, invokes `forgetTarget` across relevant brains on entry, snaps the local camera to/from `spot.view`, and updates model/flag/label visibility. Existing health/equipment/progression methods remain the only mutation paths for damage/items/XP.

- [ ] **Step 1 — Add failing solo/input/UI tests.** Run a real headless game on every map, move to a validated entry and request Hide. Capture the entry position, hold movement/Jump, then verify:

```js
assert.equal(game.player.hiddenSpotId, spot.id);
assert.deepEqual(game.getActors()[0].equipment, equipmentBefore);
assert.equal(game.getHidingView().label, 'Exit');
assert.equal(game.getActors()[0].y, spot.occupant.y);
assert.equal(game.player.hiddenSpotId, null); // after raw Fire with an empty gun
```

Use separate tests for frozen X/Z, witnessed AI forgetting, 5-second supply completion, Fire during supply/reload, grenade release from exit, armour-only damage exit, lethal proxy hit/one XP award, menu neutralisation, death/quit cleanup and invalid map setup returning usable Home. Real Input fixture tests press H twice with repeat/cancel/blur and assert one edge per fresh press, no fire/look leakage, E still zooms and number keys keep inventory behavior. Render tests assert all hidden avatar/label/weapon/flag children disappear while the spot remains and no occupied-specific visual is created.
- [ ] **Step 2 — Run red.** `node --test tests/hiding-solo.test.js tests/hiding-input.test.js tests/hiding-ui.test.js`; expect absent control/runtime integration.
- [ ] **Step 3 — Wire the offline lifecycle and UI.** Process raw attack exit before any healing/reload suppression; apply move freeze only while hidden and keep looking enabled. Map proxy hits to `damageActor`, exit on any consumed armour/health, and preserve the pre-release safe drop anchor for a lethal hit. Prevent a single ray hitting both proxy and newly exposed body. Place control using legacy-compatible CSS with literal fallbacks, scale setting and no overlap with top-left inventory or right-hand Fire/Jump. Keep health/armour/XP save UI untouched.

For hitscan, compare exposed actor hits with `raySpotHit` results by distance; test occlusion for each proxy excluding only its own shell. Do not keep the old nearest-shell hit as a global blocker that makes every locker invulnerable. Apply one chosen hit through the existing body/headshot damage path as appropriate; online uses the same selection rule in Task 8.

- [ ] **Step 4 — Run green.** `node --test tests/hiding-solo.test.js tests/hiding-input.test.js tests/hiding-ui.test.js tests/equipment-input.test.js tests/supply-solo.test.js tests/zombie-game.test.js tests/progression-solo.test.js`; then `npm test`. Offline flags, FFA/TDM and Zombies all retain their normal round logic.
- [ ] **Step 5 — Commit.** Stage only Task 7 files; `git commit -m "feat: add touch hiding and solo concealment gameplay"`.

## Task 8: Authoritative multiplayer hiding and protocol 6

**Files:** Create `src/hiding-protocol.js`, `tests/hiding-protocol.test.js`, `tests/hiding-rooms.test.js`, `tests/hiding-network.test.js`. Modify `server/rooms.js`, `server/server.mjs`, `src/network.js`, `src/online-game.js`, `src/protocol.js`, `src/main.js`, `tests/network.test.js`, `tests/network-client.test.js`, `tests/rooms.test.js`.

**Interfaces and ordering:**

- `validHideAction(packet,map) -> boolean` validates exactly `{type:'hide-action',seq,roundId,lifeId,kind:'enter'|'exit',spotId}`. Sequence/life are nonnegative safe integers, seq >0, round ID uses the existing progression identity validator, spot ID belongs to the current map. Exit identifies the expected spot; no client positions or vitals accepted.
- `validHideResult(packet,map) -> boolean` validates exactly `{type:'hide-result',protocol:6,seq,roundId,lifeId,ok,reason,hiddenSpotId}`; reason is null on success or a bounded string (max 160) on failure, hiddenSpotId is null or current-map ID. This private acknowledgement is not added to the public event array.
- `RoomManager.hideAction(id,packet) -> HideResult` resolves synchronously in accepted socket order between ticks, before the next combat pass. Track per-participation monotonic hide seq independently from equipment seq; cache the last result for duplicate retransmission without reapplying a transition. Reject stale seq/life/round/spot.
- `RoomClient.sendHideAction({kind,spotId}) -> number|false` returns the sent seq, using authoritative life/round; `onHideResult` callback receives validated results. `OnlineArena.requestHide(action)` and `getHidingView()` match the solo UI adapter.
- Public player DTOs add only `grounded:boolean`, `supportId:string|null`, `hiddenSpotId:string|null`; flag DTOs contain Y. Validate consistent current-map support/hide IDs and finite Y within SpatialWorld bounds. Keep private equipment/progression envelopes unchanged.
- Pending UI is keyed by connection/round/life/seq, with a two-second timeout. Matching acknowledgements clear pending but never independently teleport; authoritative snapshots control physical/hidden state. A later valid snapshot after timeout still reconciles normally. Old replies/snapshots cannot change a new life.

- [ ] **Step 1 — Add failing protocol/room/socket tests.** Use two/three real manager participants and `startServer({port:0})` websocket tests. Assert strict key/type/bounds checking, protocol-5 rejection, one winner on simultaneous entry, idempotent duplicate seq, stale action rejection and late-join hidden state. Representative observations:

```js
assert.equal(results.filter(result => result.ok && result.hiddenSpotId === spot.id).length, 1);
assert.equal(snapshot.players.find(p => p.id === occupantId).hiddenSpotId, spot.id);
assert.equal(afterDamagingSpot.hiddenSpotId, null);
assert.equal(afterOldLifeResult.lifeId, currentLifeId);
assert.deepEqual(afterOldLifeResult, beforeOldLifeResult);
```

Add ordering cases: raw Fire while healing/dry/reloading; throw between 50ms input sends; Hide and Fire same tick; invalid throws cannot invent ammo; lethal hit clears occupancy once; damage/headshot/XP parity; rooftop/hidden flag drops on disconnect; rematch/respawn clears pending. Rejected hide replies do not depend on generic unrelated error packets. Test server bounds against NaN/Infinity/negative and client-authored teleport/health fields.
- [ ] **Step 2 — Run red.** `node --test tests/hiding-protocol.test.js tests/hiding-rooms.test.js tests/hiding-network.test.js`; expect unsupported message type/state and old protocol behavior.
- [ ] **Step 3 — Implement coordinated wire/runtime changes.** Add separate socket action/result handling. Retain ws maxPayload 4096, 100 messages/second and existing buffering limits. Handle entry/exit synchronously; at input receipt preserve raw Fire for exit before the existing `combatAllowed` filter, and repeat the exposure guard at the combat step so later Hide cannot allow a queued hidden shot. For equipment throws, validate action identity then exit before actor construction, supply gating and grenade release. Remove the client's pre-send raw attack filtering only as needed to preserve exit intent; server retains damage/ammo authority. Neutralise stale/paused input normally.
- [ ] **Step 4 — Reconcile presentation/lifecycle.** Snap camera/physical presentation on hide/life transitions rather than smoothing through the prop; smooth ordinary movement as before. Combine respawn, smoke and hide visibility in remote meshes/labels/carried flags. Release occupancy in damage/eliminate/spawn/rebuildMode/leave; obtain hidden drop anchors before release. Fix strict packet validators and all exact-shape fixtures together; increment protocol to 6.
- [ ] **Step 5 — Run green.** `node --test tests/hiding-protocol.test.js tests/hiding-rooms.test.js tests/hiding-network.test.js tests/network.test.js tests/network-client.test.js tests/rooms.test.js tests/online-modes.test.js tests/loot-rooms.test.js tests/supply-rooms.test.js tests/progression-rooms.test.js`; then `npm test`. No deployed server is restarted.
- [ ] **Step 6 — Commit.** Stage only Task 8 files; `git commit -m "feat: synchronise authoritative hiding with protocol 6"`.

## Task 9: Browser acceptance, legacy layout and resource/performance evidence

**Files:** Create `tests/helpers/traversal-browser.js`, `tests/rooftops.browser.mjs`, `tests/hiding-online.browser.mjs`, `tests/hiding-layout.browser.mjs`. Modify `tests/helpers/game-fixture.js`, `tests/helpers/input-fixture.js` only if integration requires it, and add package scripts in `package.json`.

**Interfaces:** Reuse `fixture`, `observer`, `until`, `lookTo`, `lookAt`, `equip` from `tests/helpers/loot-browser.js` and `persistentFixture`/`readProfile` from `tests/helpers/progression-browser.js`; reuse `emulateLegacyWebView`. New helper `followRoute(page,readActor,route,{speed,touch=false})` issues real move/jump inputs and waits for observed landings; `readActor` is passive observation, not teleport authority. `recordFrames(page,seconds) -> {medianMs,p95Ms,count}` measures raw requestAnimationFrame deltas, not simulation-clamped elapsed time. New harnesses honor `DIST_DIR`, `LEGACY_WEBVIEW=1`, `ARTIFACT_DIR`.

- [ ] **Step 1 — Write acceptance assertions and demonstrate baseline failure.** Against the isolated frozen 0.7.0 assets, assert that `#hide-button` and climb/hide behavior are missing; record expected baseline failure separately. Candidate tests must cover every map, each solo mode family and both zombie types; route replay uses real keys/taps. For each map record actual supported roof Y, room view, visible geometry/draw calls and no page errors. Two browser peers verify witnessed entry conceals avatar/label/flag, shooting a spot damages/ejects, knife/grenade handling, occupied rejection, both host/guest roles, late join/leave/rematch and no capture through floors. Do not directly grant success by mutating game state.
- [ ] **Step 2 — Implement passive harnesses and controls.** Custom-configure `#room-map`/`#room-mode` before start (existing `onlinePair` starts defaults immediately). Do not use old X/Z `moveTo` as proof of roof climbing. Persist and reopen an isolated profile at the same origin; compare XP, cosmetic choice and server settings before/after real play and reloading. Use `finally` to leave owned rooms/close browsers/servers without hiding the original failure.
- [ ] **Step 3 — Pin layout/input/legacy assertions.** At 854×480, 1200×700 and 1280×720, scales 1 and 1.3, assert Hide/Exit on-screen and non-overlapping with Fire, Jump, joystick, inventory and health. Real multitouch Move+Jump/Hide+Fire, held H, pointercancel, blur and background events produce no repeated toggles or stuck actions. Legacy tests assert `__legacyProbe.arenaDraws > 0`, no context loss and no blank room/hide camera. Measure GPU resource live/peak counts across repeated all-map enter/exit cycles and raw-frame timings versus a matched baseline, including eight live zombies; investigate regressions and record software-renderer limits.
- [ ] **Step 4 — Build/test candidate.** Add `test:rooftops`, `test:hiding:online`, `test:hiding:layout` scripts pointing to the three new harnesses. Run:

```bash
BUILD_DIR=artifacts/rooftops-candidate npm run build
DIST_DIR=artifacts/rooftops-candidate node tests/rooftops.browser.mjs
DIST_DIR=artifacts/rooftops-candidate node tests/hiding-online.browser.mjs
DIST_DIR=artifacts/rooftops-candidate node tests/hiding-layout.browser.mjs
DIST_DIR=artifacts/rooftops-candidate LEGACY_WEBVIEW=1 node tests/rooftops.browser.mjs
DIST_DIR=artifacts/rooftops-candidate LEGACY_WEBVIEW=1 node tests/hiding-online.browser.mjs
DIST_DIR=artifacts/rooftops-candidate LEGACY_WEBVIEW=1 node tests/hiding-layout.browser.mjs
```

Expected: all assertions pass, all eight maps appear in evidence, no runtime/asset errors, owned room count returns to zero. Also run existing `npm run test:touch`, `npm run test:webview`, `npm run test:inventory`, `npm run test:zombies`, `npm run test:supplies`, `npm run test:progression` and `npm run test:progression:online` against the recorded candidate directory where each harness supports DIST_DIR. Verify which assets each harness actually loads; do not substitute stale `dist` tests. If a harness hardcodes dist, extend it to honor DIST_DIR without loosening assertions.
- [ ] **Step 5 — Commit.** Stage the named harnesses/package changes and any explicitly reviewed candidate-directory compatibility changes; `git commit -m "test: verify rooftops and hiding across browsers and modes"`.

## Task 10: Versioned APK candidate and native save/online acceptance

**Files:** Create `android/tests/rooftops-smoke.mjs`, `android/tests/rooftops-online-smoke.mjs`. Modify `package.json`, `package-lock.json`, `android/app/build.gradle`, `android/tests/package-smoke.mjs`, and release-specific assertions in `android/tests/emulator-online-smoke.mjs` and `android/tests/progression-smoke.mjs`. Create `docs/releases/2026-10-08-rooftops-hiding.md` as an evidence report, initially candidate-only.

**Interfaces:** Reuse `nativeProgressionFixture({artifactDir,serverOrigin})` from `android/tests/helpers/progression-native.js` and `cleanupOwnedOnlineSession` from `android/tests/online-cleanup.mjs`. Required environment is `ANDROID_TEST_SERIAL`, `ANDROID_TEST_AVD`, `ANDROID_SDK_ROOT`; offline candidate uses `ANDROID_APK_PATH` and `ANDROID_TEST_ARTIFACTS`, online adds an explicitly owned HTTPS `GAME_TEST_SERVER_URL`. No historical serial, PID, port or public URL is assumed.

- [ ] **Step 1 — Write failing package/upgrade assertions.** Pin name 0.8.0, code 10, protocol 6, min26/target36, unchanged signer/package/permission and exact bundled candidate bytes. On an owned emulator with the retained same-signed 0.7.0 APK, earn/save real XP and equip a cosmetic, record the full progression/settings state, then install candidate with `install -r`. The old package must fail new version/feature assertions for the expected reason; preserve baseline save data rather than clearing it.
- [ ] **Step 2 — Implement native acceptance harnesses.** Offline: all-map startup/world rendering, real touch climb/Hide/Exit, a shelter camera, witnessed zombie forgetting, visible rooftop pursuit after exit, health pack while hidden and raw Fire exit. Force-stop/relaunch and background/foreground retain XP/skins/settings and no stale match hide state. Online: separate browser/socket peer on owned TLS staging sees correct elevation, invisible occupant, proxy damage/ejection and hidden flag drop on native departure. Use actual ADB taps and `adb exec-out screencap -p`; CDP-only screenshots can omit WebGL. Wait for populated controls, not static HTML. Only one native controller uses the owned AVD at a time.
- [ ] **Step 3 — Bump/build frozen final candidate.** Update versions without changing package/signing/SDK/permissions. Use `BUILD_DIR`/`GAME_SERVER_URL` with the intended final default (saved settings still win). Build once into the recorded owned artifact directory, then package those exact assets:

```bash
DIST_DIR=artifacts/rooftops-candidate APK_OUTPUT_PATH=artifacts/block-ops-v0.8.0-rooftops-hiding.apk bash scripts/build-apk.sh
ANDROID_APK_PATH=artifacts/block-ops-v0.8.0-rooftops-hiding.apk DIST_DIR=artifacts/rooftops-candidate npm run test:apk
```

Record SHA256 for index.html, game.js, styles.css, THREE-LICENSE.txt and APK. The packaging script modifies Android asset copies; include only intended generated paths if tracked. Retain the 0.7.0 artifact and signer. Never print secrets or replace saved server preferences to force a test to pass.
- [ ] **Step 4 — Verify native/final regressions.** With the required owned-emulator environment, run `node android/tests/rooftops-smoke.mjs` and `node android/tests/rooftops-online-smoke.mjs` against the exact APK above; then full `npm test`, Task 9 browser/legacy matrix, package checks and compatible existing progression/native smoke checks against final assets. Adjust old code8→9 test assumptions to explicit code9→10 and code10→10 scenarios, preserving real upgrade/save assertions. Record actual console/layout/physics/save results and raw timing evidence; do not call emulator evidence BYD acceptance. Teardown keeps an online observer until native departure is verified, then closes only owned sessions/forwards/AVD as appropriate.
- [ ] **Step 5 — Record candidate evidence and commit.** Document build source, hashes, commands/results, known issues, no public deployment yet and the remaining parked-BYD check. `git commit -m "build: verify rooftop and hiding Android candidate"` after staging only listed version/test/report changes and intended generated assets. No live restart belongs to this task.

## Task 11: Reviewed release and separately approved public delivery

**Files:** Update only `docs/releases/2026-10-08-rooftops-hiding.md` and this plan's completion checkboxes/evidence. Owned deployment/rollback artifacts live under the recorded task artifact directory, not arbitrary user folders.

**Interfaces:** Candidate source/assets/APK/hash manifest from Task 10; fresh current-live identity and explicit empty-room deployment approval from the user. The live endpoint is discovered, never copied from historical chat.

- [ ] **Step 1 — Review the complete implementation.** Follow the chosen execution method's independent review requirements (per-task plus whole-branch for subagent-driven; whole-branch fresh review for Native). Run the completion-verification skill. Resolve findings and repeat affected tests plus final asset/package checks; regenerate the manifest if bytes change. No success claim is based solely on another agent's report.
- [ ] **Step 2 — Present the verified candidate and coordinate maintenance.** Discover current process/cwd/port/tunnel/health read-only, retain exact rollback source/assets and saved-origin considerations, and ask for a fresh empty-room restart window. Stop at this gate without restarting if not granted. The old feature's approval to empty rooms is not authority for this release; do not evict users to make health reach zero.
- [ ] **Step 3 — Deliver only after approval.** Recheck room count immediately before cutover. Serve frozen source/assets with protocol 6, preserve current browser origin/tunnel where possible, and test a private owned room through the actual public route with two peers. Fetch live bytes/no-store headers and compare hashes to the manifest; verify the download APK signer/version and bundled assets. If verification fails, restore the exact captured prior release without clearing users' local profiles. Record failed evidence and rollback outcome.
- [ ] **Step 4 — Handoff and clean only owned resources.** Provide live browser URL and clickable APK path, explain update-required for older clients and saved-server overrides, retain rollback artifacts, and ask the user for parked-BYD acceptance of map load/climb/hide/touch performance. Close owned test rooms/processes without touching the tunnel or unrelated work. Record precisely what remains hardware-unverified; do not leave ordinary test rooms running.
- [ ] **Step 5 — Commit release evidence.** Verify final diff and stage only the report/plan; `git commit -m "docs: record verified rooftop and hiding release"`. Use the development-branch finishing workflow without assuming permission to push/merge; any GitHub work uses authenticated `gh`.

## Coverage and execution handoff

| Approved spec area | Owning tasks |
| --- | --- |
| All-eight-map content, single entrances, safe exits, preview/box style | 1, 3, 9 |
| Normal jump/landing/no fall damage, explicit floors/ceilings, bounds | 1, 2, 9, 10 |
| Rooftop AI routes, hidden memory reset, spawning/patrol | 3, 4, 7, 9 |
| Hide/Exit state, touch/keyboard, camera/model/flag concealment | 5, 7, 8, 9 |
| Damage proxies, raw attack ordering, supplies, death cleanup | 2, 5, 7, 8 |
| Loot/drop elevation, flags/carrying/objectives, XP preservation | 6, 7, 8, 9, 10 |
| Strict protocol, authority, lifecycle, mismatch/late joins | 8, 9, 10 |
| WebView/offline/Android/save compatibility and evidence | 9, 10 |
| Safe public cutover, rollback, old artifacts, actual BYD caveat | 10, 11 |

The written spec is approved. This implementation plan is not yet approved, and no execution method has been selected for this feature. Recommend **subagent-driven** execution because physics, map geometry and online hit validation share contracts whose mistakes can break every match; a review gate at each task catches disagreements before they propagate. **Native** remains the faster/lower-overhead option with one whole-branch independent review at the end. Present both choices and wait for plan review/selection before implementation.
