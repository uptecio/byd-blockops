# Home Maps Skins and Game Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an updated APK with a character-preview Home screen, eight maps, eight skins, and Free-for-All, Team Deathmatch and Capture the Flag against offline bots or online friends.

**Architecture:** Keep the existing Three.js renderer, solo game and authoritative room server. Share immutable map/skin definitions and pure match rules across both runtimes; generalize bot targeting/navigation and render authoritative online objectives. Extend the existing menus and lifecycle instead of replacing the Android wrapper or networking stack.

**Tech Stack:** JavaScript ES modules, Three.js 0.160.1, Node.js, ws 8.21.0, esbuild, Node test runner, Playwright, Java 17 Android WebView wrapper. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-02-home-maps-skins-modes-design.md`, approved by the user on 2026-10-02.

## Global Constraints

- Eight maps in total, including Courtyard; different layouts, not merely palettes. Flat playable ground within the current arena footprint.
- Eight unlocked skins; identical movement, health and hitboxes across skins.
- All three modes work offline and online. All modes last three minutes; targets are 15 individual eliminations, 30 team eliminations and three captures respectively. Ties at timeout are draws.
- Team modes disable friendly fire, and teammates do not intercept damage rays.
- Capture interaction radius is 1.2 units; dropped flags return after 15 seconds. Own flag must be home to capture; dead/protected actors cannot steal a flag.
- Preserve 28 weapons, 500 initial total rounds including the magazine, reload conservation, per-weapon ammunition across switches, and replenishment on respawn/new round.
- Online rooms contain two to eight humans, no bots. Offline retains one to eight bots; team sizes differ by at most one, with the human on Red.
- Host-only map/mode changes outside active rounds. Home asks before ending/leaving; Pause resumes. Backgrounding never resumes automatically.
- Maps and skins are bundled offline. Preserve WSS-only Android connections, strict packaged assets, minimum Android API 26 and parked-play messaging.
- Keep existing uncommitted multiplayer work. Do not reset the workspace, replace its history, restart the live server during development, or publish/merge without authorization.

## Review Focus

- Home confirmation interrupted by a remote start, death, results or disconnect must not leave hidden gameplay controls enabled or resume an ended round. Test in Tasks 7 and 8.
- Simultaneous flag contact, repeated death notifications and a departing carrier must not duplicate captures, resurrect ownership or change final scores. Test in Tasks 3 and 6.
- Multiple rooms using different maps must never share mutable collision, flags, teams or settings; unknown IDs must not partially create sessions. Test in Task 6.
- Every bot goal and spawn must remain reachable with the actual actor radius; map switching must release the previous world's models and navigation. Test in Tasks 1, 4 and 5.
- Corrupt local preferences, old APK protocols and smaller landscape displays must produce safe defaults, an explicit update message or usable navigation, respectively. Test in Tasks 7, 8 and 9.

## File ownership and dependency order

`src/maps.js` owns plain map records; `src/world.js` renders them while retaining weapon-model exports. `src/skins.js` and `src/avatar.js` own cosmetic definitions and avatar geometry. `src/modes.js` owns rules without Three.js, DOM or sockets. `src/navigation.js` and `src/bot-brain.js` own pathing and objective selection. `src/objectives.js` renders flags and bases. `src/game.js` integrates solo combat; `server/rooms.js` integrates server combat. `src/protocol.js` defines wire compatibility; `src/network.js` validates it and `src/online-game.js` renders it. `src/home-ui.js`, `src/character-preview.js`, `src/map-preview.js` and `src/match-ui.js` keep new interface responsibilities outside the existing armory orchestration in `src/main.js`.

Tasks 1, 2 and 3 are independent foundation work. Task 4 consumes 1 and 3. Task 5 consumes 1–4. Task 6 consumes 1–3 and may run independently of 4–5. Task 7 consumes 5–6. Task 8 consumes 1–3 and 7. Task 9 verifies the integrated deliverable. If parallel workers are selected, never assign overlapping files concurrently; the shared interfaces below are mandatory.

Before execution, use the worktree skill to determine isolation safely. This branch contains the completed v0.2 multiplayer update as uncommitted tracked and untracked files; a new worktree from HEAD alone would omit them. Preserve/carry that exact baseline or continue safely in the existing tree if permitted by the skill. Record baseline test results before changes. Any task commit includes only its owned changes, with the existing baseline handled explicitly, not swept into an unrelated commit.

## Task 1: Eight shared map definitions and rendering

**Files:** Create `src/maps.js`, `tests/maps.test.js`; modify `src/world.js`, map assertions in `tests/collision.test.js`.

**Interfaces:** Export `MAPS`, `DEFAULT_MAP_ID = 'courtyard'`, and strict `getMap(id) -> MapDefinition`. IDs are `courtyard`, `dust-town`, `neon-city`, `snow-base`, `jungle-ruins`, `harbor`, `desert-fort`, `space-station`. A definition is `{id,name,description,environment:{sky,fog,ground,accent},bounds:{min:-22,max:22},blocks,solids,playerSpawn,spawns,teamSpawns:{red,blue},bases:{red,blue}}`. Points are `{x,z}`; solids retain `{x,z,w,d,height}`; blocks are `{x,y,z,w,h,d,colour}`. Definition-building helpers emit both geometry and collision for solid objects. Definitions are immutable. Extend `createWorld(THREE, scene, mapId = DEFAULT_MAP_ID)` to return the existing methods/groups plus `mapId` and `definition`; it must not change weapon or legacy bot model exports.

- [ ] Write `tests/maps.test.js` asserting exactly eight IDs and eight distinct serialized solid layouts; finite positive geometry; at least five clear, distinct points per team; all spawn/base points pass `canOccupy(x,z,.42,solids)`; boundary containment; and a flood-fill route joins all spawns and bases. Preserve Courtyard's existing spawn/sightline regression rather than imposing it on other maps.

```js
test('eight maps have distinct collision layouts', () => {
  assert.equal(MAPS.length, 8);
  assert.equal(new Set(MAPS.map(map => JSON.stringify(map.solids))).size, 8);
});
```

- [ ] Run `node --test tests/maps.test.js`; expect missing registry exports or map-count assertions to fail before implementation.
- [ ] Implement immutable map records and the generic renderer using shared box geometry/materials per world. Preserve the Courtyard layout. Use the eight approved visual themes and routes; keep tall details outside traversable routes or include their ground footprint in collision.
- [ ] Add a real Three.js scene test for each map: rendered world solids equal the definition, disposal detaches world/groups, and eight repeated create/dispose operations do not retain scene children. Run `node --test tests/maps.test.js tests/collision.test.js`; expect all pass.
- [ ] Review and commit only Task 1 files with message `feat: add eight shared block arena maps`.

## Task 2: Skin catalog and consistent avatars

**Files:** Create `src/skins.js`, `src/avatar.js`, `tests/skins.test.js`. Consume `createWeaponModel` from `src/world.js` without editing it in parallel.

**Interfaces:** Export `SKINS`, `DEFAULT_SKIN_ID = 'ranger'`, strict `getSkin(id)`. IDs are `ranger`, `desert-ops`, `arctic-scout`, `jungle-scout`, `neon-runner`, `shadow-ninja`, `robo-unit`, `space-guard`. Export `createAvatarModel(THREE,{skinId,teamId=null,weaponId='m4a1'}) -> THREE.Group` and `AVATAR_HITBOX = {halfWidth:.32,height:1.84}` from `src/avatar.js`. Avatars stand at y=0 and face +Z; their selected weapon faces the same direction. Cosmetics never modify the hitbox. Team IDs are `red`, `blue` or null.

- [ ] Write catalog/model tests for eight distinct appearances, unknown-ID rejection, matching immutable hitboxes, feet at ground, correct forward orientation, selected weapon identity, and a visible team marker for every skin/team pair.

```js
test('eight skins share one combat hitbox', () => {
  assert.equal(SKINS.length, 8);
  assert.deepEqual(AVATAR_HITBOX, { halfWidth: .32, height: 1.84 });
  assert.throws(() => getSkin('missing'));
});
```

- [ ] Run `node --test tests/skins.test.js`; expect missing modules/exports before implementation.
- [ ] Implement skin colours and distinct approved headgear/accessories, avatar assembly, selected weapon attachment and red/blue markers. Keep model-owned resources disposable with existing `disposeModel`; do not create a circular import between world and avatar modules.
- [ ] Run `node --test tests/skins.test.js tests/collision.test.js`; expect pass. Inspect representative model bounds numerically; browser appearance is checked in Task 8.
- [ ] Review and commit Task 2 files as `feat: add eight selectable character skins`.

## Task 3: Shared team and objective rules

**Files:** Create `src/modes.js`, `tests/modes.test.js`. Leave legacy `src/match.js` unchanged until runtime migration in Task 5.

**Interfaces:** Export `MODES`, strict `getMode(id)` and the functions below. Mode records are `{id,name,duration,scoreLimit}`; IDs are `ffa`, `tdm`, `ctf`. `Actor` is `{id,teamId,x,y,z,alive,protectedRemaining,lifeId}`; `lifeId` is a nonnegative spawn counter. `ModeState` is `{modeId,mapId,timeLeft,ended,winnerId,winnerTeamId,teamScores:{red,blue},stats,flags}` plus private elimination-deduplication state. `stats` is an object keyed by participant ID with `{teamId,kills,deaths}`. `flags` is null outside CTF; in CTF it is `{red,blue}`, each flag `{teamId,status:'home'|'carried'|'dropped',x,z,carrierId,returnRemaining}`.

- `assignTeams(ids,modeId) -> object` alternates Red/Blue from Red, or assigns null for FFA.
- `createModeState({modeId,map,participants}) -> ModeState`; participants are `{id,teamId}` with zero initial scores.
- `addParticipant(state,{id}) -> teamId` joins the smaller team, Red on ties, without changing existing teams.
- `areEnemies(state,attackerId,targetId) -> boolean` requires distinct registered participants and applies mode teams.
- `recordElimination(state,{killerId,victimId,position,lifeId}) -> ModeEvent[]` deduplicates a victim's life, updates scores, drops flags and checks limits.
- `tickMode(state,dt,actors) -> ModeEvent[]` owns clock and flag interactions, then timeout result.
- `removeParticipant(state,id,position) -> ModeEvent[]` drops carried flags before removing participant stats; accrued team scores remain.
- `getModeSnapshot(state) -> object` copies the public fields excluding stats/private deduplication. Returned nested data cannot mutate the rules state.

`ModeEvent` is `{type:'flag-pickup'|'flag-drop'|'flag-return'|'flag-capture',teamId,playerId}`. `playerId` is null only for automatic returns. Adapters assign event IDs and still emit ordinary shot/hit/kill events. Process flag auto-returns, own-flag touch returns, enemy pickups, then captures; within a stage use participant-ID order. Stop immediately when ended. Ignore invalid/nonpositive dt and disallow duplicate/self/friendly eliminations.

- [ ] Write tests pinning three modes to 180 seconds and limits 15/30/3; balanced teams; teammate immunity; independent FFA scores; timeout draws; and no score/timer changes after ending. For duplicate notification call `recordElimination` twice with the same victim/life and assert one death/score; a new life can score again.

```js
test('modes use the approved time and score limits', () => {
  assert.deepEqual(MODES.map(({ id, duration, scoreLimit }) => [id, duration, scoreLimit]),
    [['ffa', 180, 15], ['tdm', 180, 30], ['ctf', 180, 3]]);
  assert.deepEqual(assignTeams(['local', 'bot-0', 'bot-1'], 'ctf'),
    { local: 'red', 'bot-0': 'blue', 'bot-1': 'red' });
});
```

- [ ] Write CTF tests for 1.2-unit pickup/capture boundaries, own flag missing, dropped-flag touch return, 15-second auto-return, death/disconnect drops, no dead/protected theft, one flag per actor, simultaneous contacts and exact third-capture termination. Assert a dropped flag remains dropped at 14.99 seconds and is home after another .01.
- [ ] Run `node --test tests/modes.test.js`; expect missing exports before implementing the pure rules. Implement the stated interfaces without rendering, I/O or runtime combat dependencies.
- [ ] Run `node --test tests/modes.test.js tests/weapons.test.js`; expect all pass, including snapshot-copy isolation and invalid-ID/input cases.
- [ ] Review and commit Task 3 files as `feat: share free for all team and flag match rules`.

## Task 4: Goal navigation and offline bot decisions

**Files:** Create `src/navigation.js`, `src/bot-brain.js`, `tests/bot-brain.test.js`; consume Tasks 1 and 3.

**Interfaces:** `createNavigation(map,{radius=.42}={}) -> {nextWaypoint(from,goal),reachable(from,goal),clearCache()}`. Build the grid from map bounds, not duplicated literal offsets. `nextWaypoint` returns a valid `{x,z}` or null. Cache at most 32 reverse breadth-first fields by goal cell; reject diagonal corner cutting and return null for unreachable goals. `chooseBotIntent(actor,{actors,state,map,role}) -> {goal,targetId}` is pure; role is `attack` or `defend`, targetId is an enemy ID or null. Visible-enemy selection uses actual map cover. Movement goal and shooting target are separate so carriers can return while fighting.

- [ ] Write tests for paths from every spawn to both bases on all eight maps, wall/corner avoidance, an unreachable fixture, and independent navigation caches for different maps.

```js
test('all team spawns can reach the opposing flag base', () => {
  for (const map of MAPS) {
    const nav = createNavigation(map);
    for (const point of map.teamSpawns.red) assert.equal(nav.reachable(point, map.bases.blue), true);
    for (const point of map.teamSpawns.blue) assert.equal(nav.reachable(point, map.bases.red), true);
  }
});
```

- [ ] Write decision tests: FFA pursues another living actor; TDM excludes teammates; CTF attackers seek the enemy flag, defenders recover their own dropped flag/intercept a nearby carrier, carriers return home or seek their missing flag; a one-bot team always has an attacker. Test targets without a directly visible enemy still produce an objective goal.
- [ ] Run `node --test tests/bot-brain.test.js`; expect missing exports. Implement navigation and the priority rules. When multiple goals/targets tie, use stable IDs rather than frame-to-frame randomness.
- [ ] Run `node --test tests/bot-brain.test.js tests/maps.test.js`; expect pass. Ensure cached arrays are bounded and test changing goals after a flag drop.
- [ ] Review and commit Task 4 files as `feat: add objective navigation for offline bots`.

## Task 5: Integrate all modes into offline play

**Files:** Modify `src/game.js`, `tests/combat.test.js`, `tests/match.test.js`; delete the superseded `src/match.js` only after migrating all callers; create `src/objectives.js`, `tests/offline-modes.test.js`, `tests/helpers/game-fixture.js`.

**Interfaces:** Keep `ArenaGame.start(weaponId,settings)`, extending settings with `{mapId,modeId,skinId}`. Add `loadMap(mapId)`, `getActors() -> Actor[]`, `getMatchView()`, and `setPendingSkin(skinId)`. `getMatchView()` returns `game.matchView`, a public mode snapshot extended with `players:[{id,name,teamId,kills,deaths,skinId}]`. Offline regenerates this view after a rules update; online replaces it from server snapshots. Runtime state is `game.modeState`; retain `game.match` as a local-player HUD compatibility projection until Task 8, never as a second clock. Human ID is `local`; bot IDs are `bot-0` onward. Each actor has a spawn-incremented lifeId and pending/active skin. `ObjectiveView(THREE,scene,map)` exposes `update({flags,actors,viewerId})` and `dispose()` for shared offline/online flag/base rendering. It places carried flags from the actor's current visible position, including jump height. The test helper exports `createHeadlessGame() -> ArenaGame`, constructed with real scene/input/combat objects and stubbed GPU/audio/event sinks.

- [ ] Extend the headless fixture to exercise production methods without a GPU. Write failing tests that start all 24 map/mode combinations, reuse one game through repeated map changes, and assert valid positions, correctly rebuilt navigation, correct mode timer and no old bots/objectives/effects.
- [ ] Write combat regressions for human-to-ally and bot-to-ally immunity, bot-versus-bot damage credited to the attacker, team respawn pools, full 500-round supply, and no extra pellet/bot damage after the winning score. Preserve cover, moving-player accuracy and respawn tests; update fixtures to carry stable IDs/teams/life IDs rather than deleting earlier coverage.
- [ ] Implement map loading, shared rule integration and generalized bot targets. Bot difficulty retains existing reaction/accuracy/speed tuning. Bots use M4A1 ammunition/reload state starting at 500 total; retain existing difficulty damage values. Choose attackers before defenders, ensuring one attacker per team. Maintain independent bot scores and update pending skins only on spawn. Remove obsolete single-human navigation. Migrate all legacy match callers and equivalent assertions to shared rules, then remove `src/match.js`; do not run duplicate scoring paths.
- [ ] Implement `ObjectiveView` and an offline production-method simulation test with deterministic aim disabled: a bot navigates, steals, returns and scores a flag without directly editing positions or scores during the run. Test each team's decisions and recovery when its own flag is missing. Add base/flag disposal and carrier-following geometry tests.
- [ ] Run `node --test tests/offline-modes.test.js tests/combat.test.js tests/match.test.js tests/bot-brain.test.js tests/weapons.test.js`; expect pass. Run `npm run build` to verify browser bundling remains free of Node-only imports. Review and commit as `feat: play all arena modes with objective aware bots`.

## Task 6: Authoritative online maps teams flags and skins

**Files:** Create `src/protocol.js`; modify `server/rooms.js`, `server/server.mjs`, `tests/rooms.test.js`, `tests/network.test.js`; create `tests/online-modes.test.js`.

**Interfaces:** Export `PROTOCOL_VERSION = 2`. Extend `RoomManager.create(id,name,weaponId,{mapId='courtyard',modeId='ffa',skinId='ranger'}={})`, `join(id,code,name,weaponId,{skinId='ranger'}={})`; add `configure(id,{mapId,modeId})` and `setSkin(id,skinId)`. Keep existing input/equip/start/leave APIs. Rooms own `modeState`, map collision/raycast caches and per-player life/pending-skin state. Reject invalid configuration before mutating room/session membership.

Wire create is `{type:'create',protocol:2,name,weaponId,skinId,mapId,modeId}`; join is `{type:'join',protocol:2,code,name,weaponId,skinId}`. New packets are `{type:'configure',mapId,modeId}` and `{type:'skin',skinId}`. Input/equip/start/leave/ping retain their current shapes. Initial packets without exact protocol 2 receive `Update required: install the latest Block Ops APK or reload the game.` and never join a room. Successful welcome/state packets include `protocol:2`. Room snapshots retain existing fields and add `mapId,modeId,teamScores,winnerTeamId,flags`; player snapshots add `teamId,skinId,pendingSkinId`. Extend event types with Task 3's flag events, assigning the existing monotonically increasing room event ID.

- [ ] Write authoritative tests for all 24 configurations, host-only configure before/after rounds, blocked in-round changes, balancing/late joins, per-map spawns/walls/hitscan, active versus pending skin, and unknown IDs leaving sessions unchanged. Test two rooms with different maps and independent nested state.
- [ ] Write real-socket protocol tests for version rejection, create/join settings, late-join current flags/scores, carrier disconnect/drop and host transfer, friendly-fire immunity, duplicate/stale input and paused clients not stopping shared time. Retain 4 KB/100-message abuse tests.
- [ ] Run `node --test tests/online-modes.test.js tests/network.test.js`; expect failure before implementation. Replace global Courtyard physics with immutable per-map caches, integrate Task 3 rules and ignore friendly targets in raycasts. Apply pending skins on spawn, rebalance teams on round start, and use each actor's team spawn pool on join/start/respawn. Update snapshot generation without exposing mutable inventories or private rule state.
- [ ] Run `node --test tests/rooms.test.js tests/network.test.js tests/online-modes.test.js tests/modes.test.js`; expect pass. Ensure winning shotgun blasts stop immediately, lobby input cannot steal flags, and reconfiguration clears prior round objectives and scores.
- [ ] Review and commit as `feat: add authoritative team and flag multiplayer modes`. Do not restart the publicly exposed server in this task.

## Task 7: Network client and online presentation

**Files:** Modify `src/network.js`, `src/online-game.js`, `tests/network-client.test.js`; consume Tasks 2, 3, 5 and 6.

**Interfaces:** `RoomClient.connect(base,request)` automatically adds protocol 2 and forwards the approved create/join fields, supplying catalog defaults for omitted map/mode/skin choices. Keep callbacks and connection API unchanged. `OnlineArena.start(room,id,settings)` loads room.mapId and uses room.modeId before reconciling authoritative positions. `sync(room)` replaces `game.matchView` with the authoritative view, renders avatar skin/team and calls the shared `ObjectiveView`; it never runs local objective scoring. Preserve neutral input on pause, queued pulses, cosmetic-only recoil and snapshot event deduplication.

- [ ] Extend mock-socket tests with valid protocol-2 fixtures, rejected old/malformed snapshots, unknown map/mode/skin/team IDs, impossible flag carriers and score/position NaNs. Assert an invalid update cannot replace the last valid room. Both old-server replies and old-client errors produce an update-required message before gameplay starts.
- [ ] Write adapter tests for loading a nondefault map before positions, remote skin/team changes at respawn, carried/dropped flags, late join and team/flag HUD state, event replay deduplication, map changes between rounds and full disposal on leave. Preserve current pause/recoil tests.
- [ ] Run `node --test tests/network-client.test.js`; expect new assertions to fail before implementation. Implement strict validation, authoritative view projections and shared avatar/objective rendering. Team badges must remain readable for every skin.
- [ ] Test ended/disconnected snapshots while locally suspended and while a Home confirmation is pending via callback fixtures; updates must not revive controls. Run `node --test tests/network-client.test.js tests/skins.test.js`; expect pass. Run `npm run build` and verify no bundling errors.
- [ ] Review and commit as `feat: render shared maps skins teams and flags online`.

## Task 8: Home preview selectors and mode aware HUD

**Files:** Create `src/home-ui.js`, `src/character-preview.js`, `src/map-preview.js`, `src/match-ui.js`, `tests/home.browser.mjs`; modify `index.html`, `src/styles.css`, `src/main.js`, `src/multiplayer-ui.js`, `tests/browser.mjs`, `tests/input.browser.mjs`, `tests/multiplayer.browser.mjs`, `package.json`.

**Interfaces:** `CharacterPreview(canvas)` exposes `equip({skinId,weaponId,teamId=null})`, `render(time)` and `dispose()`. `drawMapPreview(canvas,mapId)` draws a small top-down block thumbnail, not a bitmap download. `HomeUI({getSelection,onSelection,onSolo,onOnline,onArmory,onSettings})` exposes `render()` and `renderPreview(time)`; selection is `{mapId,modeId,skinId,weaponId}`. `renderMatchHud(view,ownId)` and `renderMatchResults(view,ownId)` in match-ui consume public mode state plus `players:[{id,name,teamId,kills,deaths}]` and replace hardcoded FFA labels. Preserve health/ammo updates in existing main orchestration.

Extend the existing `MultiplayerUI` constructor callbacks with `getSelection` and `onHome`; keep its existing gameplay/loadout callbacks. `getSelection` supplies create/join choices and pending skins; host room selectors send `configure` packets. Leaving explicitly for Home invokes `onHome`, while an unexpected disconnect retains the connection-error screen.

DOM IDs: `home-screen`, `character-preview`, `home-solo`, `home-online`, `home-armory`, `home-settings`, `map-grid`, `mode-grid`, `skin-grid`, `home-button`, `pause-home`, `armory-home`, `confirm-home-screen`, `confirm-home`, `cancel-home`, `room-map`, `room-mode`, `objective-status`. Cards use `data-map`, `data-mode-id`, `data-skin`; modes are never conflated with `body[data-mode]` UI navigation. Retain existing armory/play/room/control IDs for regression tests.

- [ ] Write browser tests starting at `body[data-mode='home']`: eight map cards, three modes, eight skins, model preview, selection persistence and corrupt-ID fallback. Navigate through Armory without losing selections, then start a nondefault solo configuration. Update existing tests to navigate explicitly rather than expecting Armory at startup. Run `node tests/home.browser.mjs` against a build before UI implementation; expect missing Home selectors.
- [ ] Implement Home, selectors and shared preview. Store selections alongside existing `block-ops-v1` preferences with validation and migration defaults. Home uses selected skin immediately; active runtime skins change only at spawn. Frame loop renders only visible previews. Online create receives selected settings; room host controls are editable only outside play, with all guests seeing authoritative values. Room skin requests are separate from host map/mode settings.
- [ ] Implement Home confirmation with a saved origin/session token. Confirm leaves/quits once; cancel resumes only the same still-live gameplay session. A round ending, disconnect or remote start invalidates stale confirmation callbacks. Settings/other overlays close on remote transitions. A map/mode selection while a solo round is retained requires confirmation before discarding it. Clear input on every exit.
- [ ] Add real two-browser checks for Home cancel/confirm with held input, host transfer, live online clock, settings/confirmation interrupted by remote start/end/disconnect, team/flag labels and changing host settings between rounds. Add 960×540/1200×700 bounds checks and screenshots of Home, all eight maps and all eight skins; inspect readability, distinct layouts and team markers.
- [ ] Run `npm run build`, `node tests/home.browser.mjs`, `npm run test:browser`, `npm run test:touch`, `npm run test:multiplayer`; expect all pass with no page exceptions. Review and commit as `feat: add character home screen map selection and mode HUD`.

## Task 9: Full acceptance updated APK and coordinated release

**Files:** Modify `README.md`, `package.json`, `package-lock.json`, `android/app/build.gradle`, `android/tests/emulator-smoke.mjs`, `android/tests/emulator-online-smoke.mjs`; create `tests/configurations.browser.mjs`; update `game-server.json` only if the verified public address changes. No expected manifest/MainActivity changes.

**Interfaces:** App/package version becomes `0.3.0`, Android versionCode `3`; wire protocol remains `2`. Add scripts `test:home` and `test:configurations`. Output stays `artifacts/block-ops-debug.apk`. The live server must serve the exact tested bundled version. Existing build scripts remain the asset-packaging path.

- [ ] Add a browser configuration matrix that launches each of eight maps in each mode, checks the correct HUD/spawn configuration and returns through Home cleanly. Server integration tests cover the same 24 cases without UI-only shortcuts. Extend actual multi-touch checks with Home confirmation while a finger is held; no stuck movement/fire is allowed after cancel or a new round.
- [ ] Update native smoke selectors for Home and protocol-2 peers. With networking disabled, check Home/preview persistence and solo startup in all three modes with nondefault map/skin and zero HTTP/WebSocket requests. With a real secure server and independent peer, test create/join/host start, configuration/team/skin agreement, movement/fire, flags, Home cancel/leave, Back/background live clock, explicit resume and incompatible-client rejection. Preserve stale-room-code filtering in the harness.
- [ ] Run `npm test`, `npm run build`, all browser/touch/home/multiplayer/configuration suites, `npm audit` and `git diff --check`. Expected: all tests pass, no audit vulnerabilities or whitespace errors. Request an independent code review, reproduce/fix findings with tests, then rerun affected suites.
- [ ] Before public deployment, inspect the exact running server process and `/health`. Announce the required protocol update/restart; do not terminate active player rooms without the user's go-ahead. If rooms are empty, restart only the owned game server after client/server validation; preserve the tunnel if healthy. Test `TEST_GAME_URL=<verified HTTPS origin> npm run test:multiplayer`. If the tunnel has stopped, create another temporary one within the existing hosting scope, update `game-server.json`, rebuild and clearly report the changed link.
- [ ] Run `bash scripts/build-apk.sh --offline lintDebug`, verify with `/home/alex/Android/Sdk/build-tools/36.0.0/apksigner verify --verbose artifacts/block-ops-debug.apk`, and compare each packaged asset against `dist/`. Install only on an owned disposable emulator and run both native smoke scripts. Suppress its fullscreen tutorial and automatic WebView updates; stop only that emulator/remove its CDP forwards afterward. Keep the user-required server/tunnel running.
- [ ] Update README with Home, eight maps/skins, the three modes, bot objectives, version-2 compatibility, the current temporary-server caveat and test commands. Record actual test results and APK hash in this plan. Review and commit only the completed release changes as `feat: release block ops maps skins and game modes`. Deliver APK, browser link and brief instructions; disclose that physical BYD testing remains outstanding. Do not claim permanent hosting.

## Execution handoff

The written design is approved; this implementation plan awaits user review and an execution-method choice. Recommended: subagent-driven implementation with independent task reviews, because shared map/rule/protocol interfaces must stay consistent across bots, browser peers and the Android APK. Native implementation in the current session with one final independent review is also available with less review overhead. No product code, server process or APK has changed during planning.
