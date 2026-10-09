# Tall Roof Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 62 approved original and annex roofs accessible through one guardable, map-themed approach in Solo, Zombies and multiplayer.

**Architecture:** Author stable roof/access records alongside matching visible solids. Extend the existing shared spatial world, mover and navigation with corridor-limited stairs and continuous ladder paths, then carry authoritative attachment through runtime adapters and strict snapshots. Keep content validation, movement and presentation separate; prove routes using actual movement and frozen browser/APK acceptance.

**Tech Stack:** Existing JavaScript ES modules, Three.js 0.160.1, Node test runner, Playwright 1.58.2, ws 8.21.0, esbuild 0.25.12, Android WebView/Gradle. No new dependencies or artwork service.

**Spec:** `docs/superpowers/specs/2026-10-09-tall-roof-access-design.md` — written specification approved 2026-10-09.

## Global Constraints

- Scope: 46 original destinations plus 16 retained annex roofs = 62; original counts in map order are 4, 4, 6, 7, 4, 6, 6, 9.
- Courtyard brick stairs; Dust Town wooden crate/ledge jumps; Neon City metal fire-escape stairs; Snow Base ice-block jumps; Jungle Ruins broken-stone jumps; Harbor ladders; Desert Fort stone stairs; Space Station metal-platform jumps.
- Exactly one continuous approach per destination; no neighboring-roof, scenery, perimeter or switchback bypass; no invisible barriers.
- Preserve map IDs, bounds, bases, spawns, principal ground lanes, hiding rooms, XP, cosmetics, inventory, preferences and saved server overrides.
- Normal jump velocity 4.3; gravity 13; no fall damage, mantle, double jump, slippery ice or climbing rewards.
- Jump risers at most 0.55; clear width at least 1.6; landing depth at least 1.2.
- Stair risers at most 0.25; tread run at least 0.35; clear width at least 1.6; turn/end landing depth at least 1.2.
- Ladder entry threshold 0.25; entry zone at most 0.6; neutral dead zone 0.1; full-axis speed 2.4 world units/second.
- Ladder attachment is grounded-endpoint-only; raw up/down remains independent of aim; Fire/reload/nonlethal damage do not detach; Jump releases without an upward boost.
- Attached bodies have nullable `ladderId`, `velocityY: 0`, `grounded: false`, `supportId: null`; snapshot path tolerance is 0.0001.
- Online stale-input timeout remains 0.3 seconds; stale-life traversal input cannot affect a new life.
- Preserve bounded movement steps, the 40,000-node navigation limit and 32 cached fields; no per-frame geometry allocation.
- Release target: 0.9.0, Android code 11, protocol 7; ES2017, WebGL1 fallback, app ID/SDK/permissions/signing identity unchanged.
- Browser matrix: modern and legacy paths; 854×480, 1200×700, 1280×720; control scales 1 and 1.3.
- Preserve the 0.8.0 release. Build/package exact frozen assets. Native migration must prove signed 10→11 retention without uninstalling/clearing data.
- Candidate creation does not authorize deployment. Obtain fresh empty-room maintenance approval before public replacement; no merge/push/PR is authorized.
- Physical BYD acceptance requires the user's parked-vehicle test; no vehicle safety bypass.

## Review Focus

1. Delayed old-life movement/Jump around death or rematch must not attach/detach the new body (Task 9).
2. Turning the camera, dragging diagonally and releasing only the joystick while Fire stays held must not reverse climbing or cancel independent Fire (Tasks 3, 10).
3. A fast diagonal jump, higher-to-lower drop or jump off a guard screen must not create an undeclared approach (Tasks 5–7).
4. Thin roof trim, a blocked ladder exit and two actors sharing a ladder must not cause wall clipping or unsafe interpolation (Tasks 3, 9).
5. Repeated map changes, long frames and Android background/relaunch must not retain ladder IDs, held input, graphics resources or match state in saves (Tasks 8, 10, 11).

---

## Execution boundaries and file ownership

This is one coupled feature: geometry needs the new mover, AI needs those paths, and online clients need matching maps/protocol. Tasks 1–5 establish reusable interfaces; 6–7 author maps; 8–9 integrate runtime/authority; 10–12 verify and deliver. Do not expose partial map conversions publicly.

Before execution, inspect `git status`, preserve unrelated changes, and confirm checkout/isolation using the worktree skill and the user's selected execution method. Planning changed only this document and its spec. Do not treat prior 0.8 maintenance permission as current authorization.

New focused modules:

| File | Responsibility |
| --- | --- |
| `src/access-schema.js` | Pure access metadata validation and path sampling/projection; imports no maps or spatial world |
| `src/stair-movement.js` | Collision-checked assistance between declared neighboring treads |
| `src/ladder-movement.js` | Endpoint engagement, continuous travel, release and regrab suppression |
| `src/roof-access-validation.js` | Conservative physical alternative-approach audit, separate from navigation |
| `src/roof-access-catalog.js` | Data-only stable destination IDs and authored route descriptions |
| `src/map-roof-access.js` | Build caps, themed routes and visible guards from catalog records |
| `src/climb-presentation.js` | Ladder-aware snapshot interpolation and contextual hint state |

Extend existing files at their current ownership points, without general refactoring. Import direction: `maps → builders/validation → spatial/movement → access-schema`; movement never imports `maps`, navigation or map validation. Keep two annex hiding rooms per map in `map-traversal-layouts.js`.

### Task 1: Validated access records and reusable physical fixtures

**Files:** Create `src/access-schema.js`, `tests/helpers/access-fixture.js`, `tests/access-schema.test.js`. Modify `src/spatial.js`, `src/map-traversal.js`, `tests/spatial.test.js`, `tests/map-traversal.test.js`.

**Interfaces:**

- `Point = {x,y,z}`; `Rect = {minX,maxX,minZ,maxZ}`; all coordinates finite.
- `Stair = {id,routeId,treads,links}`; each tread `{supportId,point,clearWidth,run,landing}`; each adjacent link `{fromSupportId,toSupportId,corridor:Rect}`. Both directions use the same link. Landings mark turns and ends.
- `Ladder = {id,routeId,path:Point[],bottom:{point,supportId,zone:Rect},top:{point,supportId,zone:Rect},width}`. Endpoints equal first/last path points; segments have positive length. All route widths are clear dimensions.
- `normalizeAccess(map) → {stairs:Stair[],ladders:Ladder[]}` reads `map.traversal.stairs` and `map.traversal.ladders`, validates structure/dimensions/IDs or throws a useful error. Absent metadata means empty arrays, not invalid legacy fixtures.
- `ladderLength(ladder) → number`; `sampleLadder(ladder,distance) → Point`; `projectLadder(ladder,point) → {distance,error}`. Clamp finite distances to path bounds; reject malformed numeric inputs.
- `createSpatialWorld(map)` retains its current fields and adds validated `stairs` and `ladders`; full-body clearance/end support validation remains in `validateTraversal(map) → {ok,errors}`.
- Test-only `accessFixture({kind='ladder',blocked=false}={}) → {map,world,start,goal,ladderId}` creates isolated stairs/ladder/jump geometry. Ladder path is `(0,0,-1.5) → (0,2.4,-1.5) → (0,2.4,-2.7)` beside a roof whose front is z=-2. Existing `advanceBody(body,intent,seconds,world,options) → Body` remains the bounded-step replay helper.

- [ ] **Write named failing tests** for normalized metadata, exact vertical segments, duplicate IDs, nonfinite points, zero-length segments, oversized entry zones, unsupported endpoints, obstructed shaft/head/exit, and a .35 stair tread versus a 1.2 turn landing. Core assertions:

  ```js
  const f = accessFixture();
  assert.equal(f.world.ladders[0].id, f.ladderId);
  assert.equal(ladderLength(f.world.ladders[0]), 3.6);
  assert.deepEqual(sampleLadder(f.world.ladders[0], 1.2), {x:0,y:1.2,z:-1.5});
  assert.equal(validateTraversal(accessFixture({blocked:true}).map).ok, false);
  ```

- [ ] **Run red:** `node --test tests/access-schema.test.js tests/spatial.test.js tests/map-traversal.test.js`. Expected: new assertions fail on missing access exports/metadata; existing regressions stay identifiable.
- [ ] **Implement the interfaces** above. Validate whole upright-body paths, not ray-only clearance. Add typed `stair`/`ladder` links: ordinary links retain `{id,from,to,kind,width,depth,routeId}`, ladder links additionally have `ladderId`; stair links identify their neighboring supports. Validate ladder endpoint support separately from airborne path interiors. Stair treads use .35 run; turn/end landings retain 1.2. Synthetic validation fixtures include the existing required shelters/hide metadata rather than disabling that validation.
- [ ] **Run green:** repeat the focused command and `npm test`; expected all pass with unchanged current-map content.
- [ ] **Commit:** stage only the seven listed files; `git commit -m "feat: define validated stairs and ladder access metadata"`.

### Task 2: Corridor-limited walkable stairs

**Files:** Create `src/stair-movement.js`, `tests/stair-movement.test.js`. Modify `src/character-movement.js`, `tests/helpers/access-fixture.js`, `tests/character-movement.test.js`.

**Interfaces:** `stepStair(body,candidate,{world,radius,height}) → Body|null` consumes world stairs and the proposed horizontal substep; returns a complete supported body only for a valid declared adjacent-tread transition, otherwise null. `moveCharacter(body,intent,dt,context) → {body,invalid}` remains the public mover.

- [ ] **Write failing tests:** `walks both directions without Jump`, `ordinary ice/crates never autostep`, `cannot step sideways into stairs`, `airborne ascent gets no lift`, `ceiling and blocked turn stop safely`, `outside edge falls`. Use the stair fixture and `advanceBody`; assert the achieved goal/support and no jump input:

  ```js
  assert.equal(up.supportId, f.world.stairs[0].treads.at(-1).supportId);
  assert.equal(up.grounded, true);
  assert.equal(down.y, 0);
  assert.equal(crateAttempt.y, 0);
  assert.equal(canOccupyBody(blocked,.42,1.84,blockedWorld), true);
  ```

  Here `up/down/crateAttempt/blocked` are bodies returned by `advanceBody` using the corresponding fixture. Keep `.at()` confined to Node tests; product code must retain legacy-WebView compatibility.
- [ ] **Run red:** `node --test tests/stair-movement.test.js`; expected upward no-Jump replay fails.
- [ ] **Implement `stepStair`** and call it inside existing bounded horizontal substeps. Require grounded support, an authored adjacent pair and movement through its corridor. Sweep rise then horizontal motion, checking the whole body; settle downward on the next tread. Preserve last valid body on obstruction and existing frame/sweep limits. No global .25 auto-step allowance and no assistance during a jump.
- [ ] **Run green:** `node --test tests/stair-movement.test.js tests/character-movement.test.js` and `npm test`; expected pass, including ordinary jumping/ceilings.
- [ ] **Commit:** stage the five listed files; `git commit -m "feat: walk supported authored stairs without jumping"`.

### Task 3: Shared ladder state machine

**Files:** Create `src/ladder-movement.js`, `tests/ladder-movement.test.js`. Modify `src/character-movement.js`, `src/game.js`, `src/zombie-brain.js`, `server/rooms.js`, `tests/helpers/access-fixture.js`, `tests/character-movement.test.js`, `tests/vertical-runtime.test.js`.

**Interfaces:**

- Body extends existing fields with `ladderId:null|string`, `ladderDistance:0|number`, `ladderBlockedId:null|string`. `createBody` initializes all three. `clearClimb(body) → Body`, exported from `character-movement.js`, copies a body with these fields reset; no profile persistence.
- Movement intent adds `climb:number` (normalized raw up/down, default 0). `stepLadder(body,intent,dt,{world,radius,height}) → {body,handled,invalid,consumeJump}` operates on one bounded substep. `handled` means ladder motion replaced ordinary horizontal/gravity movement; released bodies continue ordinary movement with Jump consumed for the entire public call.

- [ ] **Write failing tests** for bottom/top engagement, entry threshold/zone, no airborne or sideways grab, both directions, zero-horizontal shaft, hold, camera-independent climb, blocked exit, .25/oversized frames, NaN/unknown IDs, shared occupancy, Jump release and held-input regrab guard:

  ```js
  assert.ok(Math.abs(afterHalfSecond.y - 1.2) < 1e-8);
  assert.equal(afterHalfSecond.ladderId, f.ladderId);
  assert.deepEqual([held.y,held.velocityY,held.grounded,held.supportId],[1.2,0,false,null]);
  assert.equal(released.ladderId, null);
  assert.ok(released.velocityY <= 0);
  assert.equal(stillHeld.ladderId, null);
  assert.equal(reattached.ladderId, f.ladderId);
  ```

  Replay in 1/120 steps from fixture start using `climb:1`; hold uses 0; release is one Jump edge; reattach test returns neutral and reaches an eligible grounded landing first. Assert exact position continuity across entry/exit, not just eventual height.
- [ ] **Run red:** `node --test tests/ladder-movement.test.js`; expected missing attachment/travel assertions fail.
- [ ] **Implement state handling** using Task 1 path functions. Entry alignment advances continuously through collision-safe motion, never snaps .6 units; engage only with valid endpoint support and the appropriate axis sign. Once attached ignore sideways displacement, retain neutral attachment, and use signed 2.4×axis path distance independently of gun/zoom. Jump sets the blocked ladder ID, grants no upward impulse and clears attachment; clear that guard only at neutral or outside its attachment zone. Clamp at blocked geometry and permit reverse/release. Treat invalid state as failure with last safe position; no partial/NaN publication.
  Propagate complete Body fields through existing game/zombie/server movement adapters now, so later map conversions do not break runtime route regressions. Pass `climb:input.y` from the already-normalized result of `Input.read()` (keyboard and touch), or the server's accepted normalized axes. Do not read touch-only `input.move.y` or call `read()` twice. Add a synthetic runtime trace test that retains attachment across successive ticks. Wire snapshots and life-authority rules remain Task 9; richer perception/lifecycle tests remain Task 8.
- [ ] **Run green:** focused test plus `npm test`; expected all pass, existing constructors now initialize fields explicitly.
- [ ] **Commit:** stage the nine listed files; `git commit -m "feat: add collision-safe aim-independent ladder movement"`.

### Task 4: Navigation understands stairs and intermediate ladder goals

**Files:** Modify `src/navigation.js`, `tests/vertical-navigation.test.js`, `tests/helpers/access-fixture.js`. Create `tests/access-navigation.test.js`.

**Interfaces:** Existing `createNavigation` methods stay public. Waypoints remain `{x,y,z,kind,linkId}` with `ladderId` and `ladderDistance` on ladder waypoints. `navigationIntent(body,waypoint,speed,world) → {vx,vz,jump,climb}` uses the same mover; visible actor goals may include `ladderId`. Add read-only `navigation.stats() → {nodes,cachedFields}` for bounded-resource assertions.

- [ ] **Write failing tests:** replay both directions at speeds 1.6, 2.1, 3.4, 4.4×.65 and 6; stairs send no Jump, jump routes do, ladders send climb and stay attached until landing. Pursuit to a visible halfway-up actor must reach its actual height. Test blocked transitions and zero horizontal distance. Assertions include:

  ```js
  assert.equal(trace.every(s => !s.invalid), true);
  assert.ok(Math.abs(trace.at(-1).body.y - goal.y) < .01);
  assert.equal(stairIntents.some(i => i.jump), false);
  assert.equal(ladderIntents.some(i => i.climb > .25), true);
  assert.ok(nav.stats().nodes <= 40000);
  assert.ok(nav.stats().cachedFields <= 32);
  ```

  Build traces by repeatedly calling `nextWaypoint`, `navigationIntent` and `moveCharacter`; never set height after starting the fixture.
- [ ] **Run red:** `node --test tests/access-navigation.test.js tests/vertical-navigation.test.js`; expected missing typed transitions/intermediate-goal failures.
- [ ] **Implement typed graph edges** and reverse behavior explicitly. Add authored tread endpoints even when the .5 grid misses a .35 tread. Track ladder progress by path distance, not horizontal squared length. Project attached goals onto their identified path, not ground; preserve ordinary floor goals and invalid-input handling. Keep graph/field limits and cache lifecycle, with no actor reservations.
- [ ] **Run green:** focused command and `npm test`; expected pass including interrupted-transition replanning.
- [ ] **Commit:** stage the four listed files; `git commit -m "feat: navigate stairs and continuous ladder routes"`.

### Task 5: Physically audit single approaches without confusing samples with proof

**Files:** Create `src/roof-access-validation.js`, `tests/roof-access-validation.test.js`. Modify `src/map-traversal.js`, `tests/helpers/access-fixture.js`, `tests/map-traversal.test.js`.

**Interfaces:** `auditRoofApproaches(map,{radius=.42,height=1.84,maxSpeed=6}={}) → {ok,errors,byRoof}`; each `byRoof` record `{id,bypassPossible}`. `validateTraversal` calls it after structural checks. Destination records retain existing fields and add `routeId`, `guardSolidIds`, `standingArea:Rect`, `style:'jump'|'stair'|'ladder'`, `theme` and `source:'original'|'annex'`. Until Tasks 6–7 migrate a map, derive missing route IDs from its entry link and conservatively use the whole support footprint instead of requiring new catalog fields immediately.

- [ ] **Write failing tests** named `declared-single but physical-double entrance fails`, `neighbor/higher roof bypass fails`, `screen top and ladder-shaft release count as launch positions`, `blocked screen detour is certified`, `opening a small gap fails again`, `removing own route keeps guards and other routes`. Assert:

  ```js
  assert.equal(auditRoofApproaches(doubleRouteMap).ok, false);
  assert.equal(auditRoofApproaches(screenedMap).ok, true);
  assert.equal(auditRoofApproaches(openScreenMap).ok, false);
  assert.equal(auditRoofApproaches(highDropMap).ok, false);
  ```

  Define these synthetic maps in the access fixture module; retain two roofs/shelters/hides where full traversal validation is invoked. Add near-epsilon gaps and fastest diagonal movement cases.
- [ ] **Run red:** `node --test tests/roof-access-validation.test.js tests/map-traversal.test.js`; expected obstruction-aware certification and ladder-launch cases fail under the old footprint-only graph.
- [ ] **Implement a conservative potential-reachability audit**, not a sampled-success assertion. Disable only the destination's route solids and its stair/ladder/link metadata; retain support, guards and every other route. Seed ground and other roof standing regions. Include all remaining solid tops (guards/ornaments too), legal stair transitions and reachable ladder segments as potential launch regions. Cache geometry/broad-phase data per map instead of rebuilding all pairs for every roof.

  Retain an over-approximation: expand source/target footprint regions to include all radius-overlap support positions; for rise `h`, maximum flight time is `(4.3 + sqrt(4.3**2 - 26*h))/13`, horizontal travel ≤`6*time`. For variable-height ladder launch segments use their enclosing position/height interval and its maximum flight budget, deliberately granting even the normal jump impulse although release grants none. Reject upward candidates above the maximum apex. For remaining candidates, certify a barrier only when its vertical span intersects the upright body at **every** possible feet height over that transition. In horizontal space compute a shortest-path lower bound between source/target regions around the union of these certified rectangles; using uninflated, slightly shrunken barrier rectangles is conservative for a circular body. Rectangle-union visibility graph paths include union vertices and closest visible region-boundary points. If this lower bound exceeds the flight budget, the edge is impossible; otherwise retain it as possible. Keep ambiguous/numerically unresolved edges. Reachability of the target therefore fails the audit; never resolve uncertainty by passing it.

  Full-route movement replays remain a separate positive test. Do not claim finite launch samples prove absence. If conservative checks cannot certify a layout, adjust visible guards/routes; if doing so would materially change the approved look or gameplay, stop for design clarification instead of weakening validation.
- [ ] **Run green:** focused command and `npm test`; expected positive fixtures and deliberately broken negatives pass. Record audit time per map in test diagnostics.
- [ ] **Commit:** stage the five listed files; `git commit -m "feat: audit physical alternative roof approaches"`.

### Task 6: Author the four jump-map families and stable roof catalog

**Files:** Create `src/roof-access-catalog.js`, `src/map-roof-access.js`, `tests/roof-access-content.test.js`, `tests/helpers/roof-route-replay.js`. Modify `src/maps.js`, `src/map-traversal-layouts.js`, `src/map-traversal.js`, `tests/maps.test.js`, `tests/map-traversal.test.js`, `tests/vertical-navigation.test.js`, `tests/zombie-maps.test.js`, `tests/loot-placement.test.js`.

**Interfaces:**

- `ROOF_ACCESS` data keyed by map ID, with `{style,theme,destinations}`; `style` is the movement enum from Task 5, `theme` is the map-specific material/access label. Each destination has `{id,source,supportId,standingArea,point,routeId,entryLinkId,routeSolidIds,guardSolidIds,solids,route}`; stable original IDs use `${mapId}:original:${name}`, existing annex identities remain unchanged. `solids` are coloured prism records `{id,x,z,w,d,minY,maxY,colour}` for caps/guards/obstacles. Route shapes are `{kind:'jump',points,width,depth,colour}`, `{kind:'stair',access:Stair,solids}` or `{kind:'ladder',access:Ladder,solids}`. Builders copy map style/theme to each produced roof record.
- `addRoofAccess(builder,mapId) → void` emits caps, obstacles, routes, guards and traversal records; called once from `finish` after annex shells are built. Existing builder primitives remain the geometry interface. `addTraversalLayout` retains shelters/hide props, with legacy approaches only for map families not yet migrated in this task.
- Test-only `replayRoof(map,roof,{speed,radius=.42,direction='up'}) → {body,intents,trace,seconds}` starts at an authored supported endpoint, then uses navigation and shared movement without teleporting; every trace item has `{body,invalid}`.

- [ ] **Write failing tests** for Dust Town (6 total roofs), Snow Base (9), Jungle Ruins (6), Space Station (11). Assert original/annex counts, themes, 0.55/1.6/1.2 dimensions, matching cap/obstacle blocks and solids, full-body standing area, unchanged bounds/spawns/bases and clear hiding anchors. Loop every destination/profile:

  ```js
  assert.equal(map.traversal.roofs.length, expectedCount);
  assert.equal(auditRoofApproaches(map).ok, true);
  assert.equal(replay.body.supportId, roof.supportId);
  assert.equal(replay.intents.some(i => i.jump), true);
  assert.equal(replay.trace.every(s => !s.invalid), true);
  ```

  Pin ground connectivity between all spawns/bases/hiding doors/loot anchors; compare to a retained baseline fixture and list any unavoidable safe loot/anchor relocation in evidence.
- [ ] **Run red:** `node --test tests/roof-access-content.test.js`; expected insufficient original-roof coverage.
- [ ] **Author these four map families**, using the approved catalog in the spec: do not shorten existing buildings. Convert cosmetic roof caps/solid-looking ornaments to matching collision geometry; widen narrow ruin/partition tops visibly while preserving passages. Replace annex jump approaches where needed to fit full routes. Add visible guards for Space partition gaps, route switchbacks and annex shortcuts. Preserve clear landing widths after trim. Extend map-dependent tests to select shelter/hide IDs explicitly instead of assuming every roof has a corresponding room or height 2.2; retain all old hiding assertions. Populate other catalog families in Task 7, not placeholder routes.
- [ ] **Run green:** focused content command and `npm test`; expected all tests pass. Replays cover up/down at 1.6, 2.1, 3.4, 2.86, 5.3 and 6 units/second, radii .34/.4/.42, plus no-Jump negative climbs for jump routes. Record geometry/audit/navigation costs. Update additional map-dependent unit fixtures only when the changed authored map invalidates a setup assumption; preserve their behavioral assertions and record the exact files in the task evidence.
- [ ] **Commit:** stage only the twelve listed files; `git commit -m "feat: reach original roofs on all four jump maps"`.

### Task 7: Author the three stair maps and Harbor ladders

**Files:** Modify `src/roof-access-catalog.js`, `src/map-roof-access.js`, `src/maps.js`, `src/map-traversal-layouts.js`, `tests/roof-access-content.test.js`, `tests/vertical-navigation.test.js`, `tests/map-traversal.test.js`, `tests/loot-placement.test.js`.

**Interfaces:** Complete Task 6 catalog: Courtyard 6 total roofs, Neon City 8, Desert Fort 8, Harbor 8. Builder emits Task 1 stair/ladder records and exactly one final entry link for each destination. Remove temporary legacy-approach branch once all maps use the catalog.

- [ ] **Write failing tests** for all remaining destinations and the global count:

  ```js
  assert.equal(MAPS.reduce((n,m) => n + m.traversal.roofs.length,0), 62);
  assert.deepEqual(MAPS.map(m => m.traversal.roofs.filter(r => r.source==='original').length), [4,4,6,7,4,6,6,9]);
  assert.equal(stairReplay.intents.some(i => i.jump), false);
  assert.equal(harborReplay.trace.some(s => s.body.ladderId !== null), true);
  assert.equal(harborReplay.body.ladderId, null);
  ```

  Test adjacent Harbor containers, Neon towers, Fort gate walls and all annex conversions; keep deliberately introduced roof-hop, switchback and screen-top negatives.
- [ ] **Run red:** `node --test tests/roof-access-content.test.js`; expected counts/style/replay failures for unconverted families.
- [ ] **Author stair treads/turns and Harbor paths** with exact global dimensions and visible materials. Routes may wrap, but no entry lies in a spawn/base/doorway. Clear head/roof-trim envelopes; retain useful standing/firing areas and ordinary drop edges. Finish all 62 destination records and remove old generic approach blocks. Preserve validated hiding anchors or explicitly record safe necessary relocations. Keep renderer geometry sourced from the same collision primitives.
- [ ] **Run green:** `node --test tests/roof-access-content.test.js tests/vertical-navigation.test.js tests/map-traversal.test.js tests/loot-placement.test.js` and `npm test`; expected all 62 up/down profile replays, negative bypass fixtures and previous content regressions pass. No node/cache limit increase.
- [ ] **Commit:** stage the eight listed files; `git commit -m "feat: add themed walk stairs and Harbor ladders to every roof"`.

### Task 8: Solo humans, bots and Zombies retain complete movement state

**Files:** Modify `src/game.js`, `src/zombie-brain.js`, `src/zombie-runtime.js`, `tests/vertical-runtime.test.js`, `tests/zombie-brain.test.js`, `tests/zombie-recovery.test.js`, `tests/hiding-solo.test.js`. Create `tests/access-runtime.test.js`.

**Interfaces:** Retain Task 3 adapter behavior: Game player keeps its `jump` height alias and every Body field; actor views expose current `ladderId`. `Input.read().y` is the normalized climb axis before yaw conversion. Bot `body` and zombie body adapters consume/produce full Body records. Perception goal copies may carry `ladderId` only for actually perceived targets.

- [ ] **Write failing tests** for actual game tick ladder movement, bot/walker/runner pursuit across every route family and to intermediate ladder height, shared ladders without separation pushes, pause/resume/Hide/death/respawn/rematch/map switch and invalid-map recovery. Assert real body/model/camera heights, valid support, no stale fields:

  ```js
  assert.equal(game.player.ladderId, ladder.id);
  assert.equal(game.camera.position.y, game.player.jump + 1.65);
  assert.deepEqual([reset.ladderId,reset.ladderDistance,reset.ladderBlockedId],[null,0,null]);
  assert.equal(hiddenTargetBrain.targetId, null);
  assert.equal(new Set(spawnedZombies.map(z => nav.reachable(z,goal))).has(false), false);
  ```

  Test maximum supported Zombies across waves while player is climbing; fail stalled pursuit/waves rather than accepting roof teleports. Repeat map changes with old attachment IDs.
- [ ] **Run red:** `node --test tests/access-runtime.test.js tests/vertical-runtime.test.js tests/zombie-brain.test.js tests/zombie-recovery.test.js`; expected intermediate-goal, separation or lifecycle failures beyond Task 3's basic adapter trace.
- [ ] **Update runtime adapters**, preserving gun/zoom movement speeds on ground. Use full bodies in flash/neutral paths; suppress crowd separation only while attached. Check full 3D/path progress for target arrival. Use connected ladder endpoints for spawn connectivity without leaking hidden positions. Reset climb state/held controls at each lifecycle boundary; pause freezes solo, menus retain existing cancellation semantics. Startup/runtime errors remain visible with recoverable Home, not a blank world.
- [ ] **Run green:** focused command and `npm test`; expected all pass, including immediate forgetting after actual Hide and unchanged zombie damage/waves.
- [ ] **Commit:** stage the eight listed files; `git commit -m "feat: integrate roof traversal with solo actors and enemy pursuit"`.

### Task 9: Authoritative online climbing, combat, presentation and compatibility

**Files:** Create `src/climb-presentation.js`, `tests/ladder-protocol.test.js`, `tests/ladder-rooms.test.js`, `tests/climb-presentation.test.js`. Modify `server/rooms.js`, `src/network.js`, `src/online-game.js`, `src/hiding-protocol.js`, `src/protocol.js`, `src/game.js`, `src/main.js`, `src/styles.css`, `index.html`, `package.json`, `package-lock.json`, `android/app/build.gradle`, `android/tests/package-smoke.mjs`, `tests/vertical-runtime.test.js`, `tests/hiding-protocol.test.js`, `tests/hiding-network.test.js`, `tests/network.test.js`, `tests/network-client.test.js`, `tests/build-output.test.js`.

**Interfaces:** Snapshots add only nullable `ladderId` to actor spatial state; internal distance/regrab guards remain server-local. Extend `validPlayerSpatial(player,map) → boolean` and strict exact-key validators. Input schema stays movement/aim/buttons/life identity, never requested coordinates/ladder IDs. `climbHint(body,world) → {text,visible}` returns compact copy; `renderClimbHint(element,view) → void` sets the dedicated HUD element's text/hidden state, wired from `main.js`. `interpolateClimber(previous,next,alpha,world) → Point` interpolates distance on the same ladder; attachment changes accept the authoritative safe state without a straight line through geometry. All three new presentation helpers live in `climb-presentation.js`.

- [ ] **Write failing tests** for solo/server trace equality, strict valid/forged/stale-map/dead/hidden snapshots, late join, up/down reconciliation, reordered stale-life movement/Jump, .3-second timeout, death/leave/respawn/rematch. Exercise shooting/reload/knife/grenades/armour/teams/protection/supplies/flags/loot at real ladder height. Assert:

  ```js
  assert.equal(validPlayerSpatial(attached,map), true);
  assert.equal(validPlayerSpatial({...attached,x:attached.x+.001},map), false);
  assert.equal(validPlayerSpatial({...attached,health:0},map), false);
  assert.equal(afterStaleInput.ladderId, null);
  assert.equal(afterFire.ladderId, beforeFire.ladderId);
  assert.equal(deathReceipts.length, 1);
  assert.ok(drop.y <= deathPosition.y);
  assert.equal(PROTOCOL_VERSION, 7);
  ```

  Offset perpendicular to a straight fixture shaft for the tolerance test. Explicitly test Fire continuing after joystick-only release, nonlethal damage holding attachment, supplies interrupted under old rules, cross-floor collection/capture rejected, mid-climb drops supported below actual position, and two actors at one ladder. Existing hide/proxy/consecutive-grenade and XP/ammo assertions remain.
- [ ] **Run red:** `node --test tests/ladder-protocol.test.js tests/ladder-rooms.test.js tests/climb-presentation.test.js`; expected attachment/schema/lifecycle failures.
- [ ] **Implement server authority and client presentation.** Reject stale-life traversal before storing controls; preserve accepted current-life packets and rate/size limits. Neutral timeout holds attachment but clears held actions. Reset all new fields at lifecycle boundaries and project drops through existing physical drop rules, never to a target roof. Validate on-path distance ≤.0001, occupancy and exposed living state. Interpolate attached path distance, use safe authoritative changes across attach/detach and map changes; no optimistic elevation. Add `Up / down to climb` and `Climbing · Jump to let go` hints without new controls. Bump package/lock/Android/protocol and footer to `v0.9.0 TALL ROOFS`; preserve update-required guidance for protocol 6. Update named protocol fixtures/labels without loosening validation. Package smoke expects code11/0.9.0 and retained signer, with explicit separate old-baseline expectations.
- [ ] **Run green:** focused command, `npm test`, `npm run build`; expected pass, protocol-6 client receives clear update-required rejection before room entry. Inspect generated ES2017 output; no dependency/SDK/permission change.
- [ ] **Commit:** stage the listed files only, adding any other strict snapshot fixture only when the regression identifies it and documenting that addition; `git commit -m "feat: synchronize authoritative climbing and release protocol seven"`.

### Task 10: Real browser/touch acceptance and frozen release evidence

**Files:** Create `tests/tall-roofs.browser.mjs`, `tests/tall-roofs-online.browser.mjs`, `tests/traversal-performance.mjs`. Modify `tests/helpers/traversal-browser.js`, `tests/rooftops.browser.mjs`, `tests/hiding-online.browser.mjs`, `tests/hiding-layout.browser.mjs`, `tests/zombies.browser.mjs`, `package.json`, `package-lock.json`.

**Interfaces:** Extend passive `observeGame` actor records with attachment. `followRoute` keeps its existing API and returns `{samples,inputs}`; samples contain actual body/attachment; inputs contain delivered movement/Jump/Fire. Support typed route order both ways without test hooks/teleports. Add scripts `test:tall-roofs`, `test:tall-roofs:online`, `test:traversal:performance`. All consume `DIST_DIR`, `ARTIFACT_DIR`; browser suites additionally honor `LEGACY_WEBVIEW`.

- [ ] **Write failing acceptance cases** using isolated owned profiles/rooms: every destination up/down through real keyboard/touch, original roofs included; stairs without Jump; jumps required; ladder hold/free aim/Fire/reload/release/cancel; map/rematch/resource reset. Assert traces and delivered input, rendered geometry and zero unexpected console/page/network errors. Two peers cover FFA/TDM/CTF, both host/guest roles, late join, damage, depart/rejoin and rematch. For each completed route:

  ```js
  assert.equal(samples.at(-1).supportId, roof.supportId);
  assert.equal(inputs.some(i => i.jump), roof.style === 'jump');
  assert.equal(errors.length, 0);
  assert.ok(Math.abs(localPeer.y - remotePeer.y) < .1);
  ```

  Scope the Jump assertion to the ascent portion (ordinary navigation to its entrance may jump over unrelated cover). Use Task 5 style enums and separate theme labels. Update all existing helper consumers to the `{samples,inputs}` return shape; keep hiding tests selected by IDs instead of roof-array indexes. Add all viewport/control-scale combinations and independent pointer release/cancel cases.
- [ ] **Run red before driver extension:** `npm run test:tall-roofs`; expected old helper cannot complete ladder/no-Jump stair evidence. Fail missing coverage instead of silently skipping maps or unavailable browser paths.
- [ ] **Implement drivers/evidence** with existing passive heap observer and real controls. Retain representative screenshots for every map/style, all62 trace results, two-peer messages and exact build/source hashes. Performance script records matched baseline/candidate map validation/navigation times, frame percentiles at maximum supported populations and GPU geometry/material counts over repeated map cycles; assert configured graph/cache limits and post-warmup resource counts return to steady bounds. Report raw measurements and software-renderer limitations, not an invented BYD FPS guarantee. Fix regressions at their owning task and repeat affected checks.
- [ ] **Run green on one frozen candidate:** create a unique release artifact directory with `mktemp -d artifacts/tall-roofs-XXXXXX`, record its resolved path as task-specific `roof_release_dir`, and freeze the reviewed source SHA in it. Build with `BUILD_DIR="$roof_release_dir/reviewed-dist" GAME_SERVER_URL="$roof_server_url" npm run build` only after reading the intended server configuration. Set `DIST_DIR` to that output and `ARTIFACT_DIR` under the same unique directory. Run the three new scripts; repeat roof/online tests with `LEGACY_WEBVIEW=1`. Run `npm test`, `npm run test:touch`, `npm run test:webview`, `npm run test:inventory`, `npm run test:loot:touch`, `npm run test:zombies`, `npm run test:supplies`, `npm run test:progression`, `npm run test:progression:modes`, `npm run test:progression:online`, `npm run test:rooftops`, `npm run test:hiding:online`, `npm run test:hiding:layout`. Expected all pass; exact source/asset alignment is mandatory when helpers import catalog metadata. Private candidate servers use owned ports/processes and matching protocol, never the public server. Record process/room cleanup. If source changes, discard acceptance status and rebuild/repeat impacted evidence against new hashes.
- [ ] **Commit:** stage the ten listed files; `git commit -m "test: verify tall roof access with real browser controls"`. Candidate manifest identifies the final tested commit; rebuild/retest if commit content differs from tested source.

### Task 11: Exact APK and genuine same-signed save migration

**Files:** Create `android/tests/tall-roofs-smoke.mjs`, `android/tests/tall-roofs-online-smoke.mjs`. Modify `android/tests/helpers/progression-native.js`, `android/tests/progression-smoke.mjs`, `android/tests/progression-online-smoke.mjs`, `android/tests/rooftops-smoke.mjs`, `android/tests/rooftops-online-smoke.mjs`, `android/tests/package-smoke.mjs`, `package.json`, `package-lock.json`.

**Interfaces:** Reuse `nativeProgressionFixture({artifactDir,serverOrigin})` and its real-touch page adapter. Add scripts `test:tall-roofs:android` and `test:tall-roofs:android:online`. Consume `ANDROID_TEST_SERIAL`/`ANDROID_TEST_AVD`, `ANDROID_TEST_ARTIFACTS`, `ANDROID_APK_PATH`, `DIST_DIR`, and private `GAME_TEST_SERVER_URL`. Version assertions distinguish baseline10 from candidate11 explicitly; a resumed candidate run must not count as migration evidence.

- [ ] **Write failing native cases** requiring version11, offline original-roof access across all eight maps, Harbor ladder combat with a separate browser peer, two control scales, background/foreground and force-stop/relaunch. Genuine baseline run earns XP/unlocks/selects cosmetics and saves settings on retained code10, then `install -r` upgrades to11:

  ```js
  assert.deepEqual(beforeVersion,{code:10,name:'0.8.0'});
  assert.deepEqual(await f.version(),{code:11,name:'0.9.0'});
  assert.deepEqual(afterUpgradeProfile,beforeUpgradeProfile);
  assert.deepEqual(afterReplacementProfile,beforeReplacementProfile);
  assert.equal(freshMatchActor.ladderId, null);
  ```

  Capture raw persisted profile/settings before/after while ignoring only explicitly documented transient session values; no injected unlocks or cleared data. Reinstall11→11 separately, including force-stop/relaunch saves.
- [ ] **Run red:** new native cases against retained code10 on an explicitly owned emulator; expected version/feature assertions fail. Never uninstall a user's app or clear its data to prepare a fixture.
- [ ] **Implement native route evidence and versioned regression assertions.** Reuse Task10 route observer/driver. Parameterize existing native candidate expectations so old 9→10 tests cannot masquerade as 10→11 evidence; preserve old baseline-specific assertions. Offline test blocks network only on the owned emulator/test fixture, not host/public services. Record exact emulator/WebView/GPU identity and screenshots; actual BYD remains unverified.
- [ ] **Run green:** package frozen Task10 bytes with `DIST_DIR="$roof_release_dir/reviewed-dist" APK_OUTPUT_PATH=artifacts/block-ops-v0.9.0-tall-roofs.apk bash scripts/build-apk.sh` (do not use `npm run apk`, which rebuilds). Set `ANDROID_APK_PATH` to that candidate and run `npm run test:apk`, both new native scripts, `npm run test:progression:android`, `npm run test:progression:android:online`, `npm run test:rooftops:android`, `npm run test:rooftops:android:online`. Run existing `android/tests/supplies-smoke.mjs` and `android/tests/zombies-smoke.mjs` against the candidate as well. Expected pass, same package/permissions/SDK, signer SHA256 `6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49`, and all four bundled assets byte-identical to reviewed-dist. Preserve0.8 and hash both APKs. Native-only test changes still require a final source/evidence manifest; any packaged-source change requires Task10 revalidation.
- [ ] **Commit:** stage the ten listed files; `git commit -m "test: verify tall roofs APK and signed profile retention"`.

### Task 12: Whole-feature review, release gate and honest handoff

**Files:** Create `docs/releases/2026-10-09-tall-roofs.md`. Modify this plan's completed checkboxes only after evidence exists. No unrelated README/gitignore edits.

**Interfaces:** Release record contains tested source SHA, exact browser/APK hashes, retained baseline/rollback paths, test commands/results, performance comparison, known limitations, migration evidence, actual public origin/process identity if deployed, and BYD checks still awaiting the user. No new product API.

- [ ] **Review before calling it complete:** use the selected execution skill's required independent whole-branch reviewer and the requesting-code-review skill. Review approved spec coverage, physical bypass assumptions, actor resets, strict snapshots and frozen evidence. Add a failing named regression for each substantive finding before its correction; do not silence negative cases to obtain green. No pending high-impact findings at handoff.
- [ ] **Reverify the final candidate:** run `git diff --check`, `npm test`, `npm run test:apk` with explicit frozen paths and all affected browser/native cases after review fixes. Expected clean checks and matching manifest hashes. Record limitations instead of claiming tests that were not run. Commit only reviewed fixes and release evidence; never reuse a stale artifact after changing packaged files.
- [ ] **Pause for fresh maintenance approval:** first discover the current live URL/process/source and read-only room count, capture recoverable rollback identity/assets/APK, then ask permission to replace when empty. Existing approvals are not reusable. Without approval, stop with a tested downloadable candidate and leave the public version running; this delivery task stays pending, not falsely complete.
- [ ] **Only after approval, cut over and verify:** immediately recheck rooms; if occupied, wait or ask rather than evicting. Serve the exact frozen source/assets on the existing origin where possible. Fetch actual public HTML/JS/CSS/config with no-store requests and verify manifest hashes/protocol7. Run a private two-peer public roof/ladder smoke, confirm protocol6 update guidance, clean only owned rooms/processes. On a genuine delivery verification failure restore the captured previous release; do not clear profiles.
- [ ] **Deliver concise evidence and commit documentation:** link `artifacts/block-ops-v0.9.0-tall-roofs.apk`, report whether browser deployment actually occurred, and ask for parked-BYD map/ladder/touch acceptance. Distinguish emulator/desktop results from physical-device results and retain the known pre-existing narrow roof-edge drop-anchor limitation. Stage only release documentation and this plan; `git commit -m "docs: record tall roof access release evidence"`. Keep branch as-is; no merge, push or PR.

## Planning self-review and handoff

Coverage: catalog/geometry/one approach (5–7); shared physics (1–3); enemy routes (4,8); combat/objectives/hiding/lifecycle/authority (8–9); UI and legacy compatibility (9–10); saves/frozen artifacts/release permission (10–12). Every Review Focus item has an owning negative or lifecycle test. Interfaces flow from metadata to movement to adapters, without a maps/movement import cycle.

Execution has **not** begun. Ask the user to review this plan and confirm the execution method. Recommended: Native/inline implementation, because these tasks share tightly coupled physics/map/protocol interfaces; retain the required independent whole-feature review before delivery. The alternative is task-by-task subagent implementation and review. Neither choice authorizes a public restart.
