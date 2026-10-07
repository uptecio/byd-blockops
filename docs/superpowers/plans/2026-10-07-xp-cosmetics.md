# XP and Cosmetic Unlocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cosmetic-only XP progression that saves immediately, survives reopening, and works in solo bots, Zombies and online matches.

**Architecture:** Pure reward/accounting rules feed a local versioned profile through an active-participation reconciler. Solo gameplay and the authoritative online server supply cumulative receipts, independently of HUD/results rendering. Procedural cosmetic models and a small UI adapter consume derived ownership and saved desired appearance.

**Tech Stack:** Existing JavaScript ES modules, Three.js 0.160.1, Node test runner, WebSocket server, Playwright, Android WebView/Gradle. No new dependencies or generated assets.

**Spec:** `docs/superpowers/specs/2026-10-07-xp-cosmetics-design.md` (approved 2026-10-07).

**Status:** Approved on 2026-10-07; user selected Native execution. Implementation underway; public deployment remains separately gated.

## Global Constraints

- Existing checkout and `feat/offline-arena`; preserve unrelated dirty files. No merge, push or broad staging. Read the approved spec before execution.
- Cosmetic-only progression: original eight skins and all 28 guns remain free; original skins, combat, hitboxes, loot inventory and ordinary bots remain unchanged.
- Eight new characters, eight new global gun finishes, Standard free; no accounts, currency, purchases, transfer or cloud saves.
- Action XP: enemy elimination 10, zombie kill 2, capture 50, manual flag return 10, cleared wave 25. Eligible natural finish 50; eligible normal-match win another 25. Early exit keeps action XP only.
- Level 1 starts at 0. Advancing from level L costs `150 + 50 * (L - 1)` for L=1..16; level 17 at 8,400. Lifetime XP/counters saturate at 2,147,483,647. All rewards unlocked at level 17; no prestige.
- Progress, desired appearance and duplicate-receipt high-water marks save together immediately. Keep 64 receipts; do not rely on unload. Browser saves are origin/profile-local; APK saves use its existing stable packaged origin.
- During live play both appearances apply next respawn, or next run in Zombies. Remote current appearance must not overwrite the locally saved desired choice.
- Target protocol 5, package/browser 0.7.0, Android versionCode 9. Retain `au.local.blockops`, signer, minSdk 26, targetSdk 36, INTERNET-only permissions, ES2017 and WebGL1 fallback.
- No public service/tunnel mutation during implementation or tests. Separate owned local/TLS staging only. Public rollout requires fresh empty-room coordination; old maintenance approval and historical PIDs are not authority.
- Actual parked-BYD rendering and power-cycle checks remain user acceptance; emulator results are not proof of car hardware behavior.

## Review Focus

1. A primary write fails after an in-memory award, then the same receipt/retry arrives: save the whole pending profile once, never double XP or claim it was saved prematurely (Task 2, `quota retry is atomic and duplicate safe`).
2. A final snapshot is followed immediately by a same-map rematch, or an ended-room join: old results cannot award again and legitimate participants cannot inherit another participation's XP (Tasks 2/5, `evicted stale session stays inactive` and `final receipt precedes immediate rematch`).
3. Cosmetic selection while dead, holding a knife or using a supply: next-life appearance changes without replenishing ammo, losing inventory, interrupting supply rules or overwriting saved preference (Tasks 4/6, `pending appearance is not equipment` and `authoritative old look cannot revert preference`).
4. Denied storage getter, malformed receipts or a newer save schema on legacy WebView: gameplay remains usable, unreadable data is preserved, and a warning distinguishes temporary progress from a confirmed save (Tasks 2/7, `protected records are never overwritten` and storage-failure browser cases).
5. Repeated model swaps share/dispose materials incorrectly or hide team badges: original Standard visuals stay identical, all finishes remain independent, and hitboxes/markers survive (Task 3, `all finishes preserve geometry and ownership`).

---

## File map and dependency order

| Files | Responsibility / owning task |
| --- | --- |
| New `src/progression.js`, `tests/progression.test.js` | Reward track, rank, ownership, cumulative award rules (1) |
| New `src/profile-store.js`, `src/progression-session.js`, `tests/profile-store.test.js`, `tests/progression-session.test.js` | Save validation/recovery, atomic credit, active-session gate (2) |
| New `src/cosmetics.js`, `tests/cosmetics.test.js`; modify `src/skins.js`, `src/avatar.js`, `src/world.js`, `tests/skins.test.js` | New palettes/parts and optional model finish (3) |
| New `src/solo-progression.js`, `tests/progression-solo.test.js`; modify `src/game.js`, `src/zombie-runtime.js`, `src/online-game.js`, `tests/helpers/game-fixture.js` | Authoritative offline award events, next-life appearance and online exclusion flag (4) |
| New `src/progression-protocol.js`, `tests/progression-rooms.test.js`, `tests/progression-protocol.test.js`; modify `server/rooms.js`, `server/server.mjs`, `src/protocol.js`, `src/network.js`, `src/online-game.js`, `tests/network.test.js`, `tests/network-client.test.js`, `tests/online-modes.test.js`, `tests/gear-protocol.test.js` | Private online receipts, round identities, appearance protocol (5) |
| New `src/progression-ui.js`, `tests/progression-ui.test.js`; modify `index.html`, `src/styles.css`, `src/main.js`, `src/home-ui.js`, `src/character-preview.js`, `src/multiplayer-ui.js` | Save/XP feedback, cosmetic controls and wiring (6) |
| New `tests/progression.browser.mjs`, `tests/progression-layout.browser.mjs`, `tests/helpers/progression-browser.js`, `android/tests/progression-smoke.mjs`; modify `package.json`, `package-lock.json`, `android/app/build.gradle`, `android/tests/package-smoke.mjs` | Persistent browser/native acceptance and versioned candidate (7) |
| New `docs/releases/2026-10-07-xp-cosmetics.md`; conditional `game-server.json` only after separate release authority | Frozen evidence, full regression, handoff and coordinated release gate (8) |

Dependencies: 1 → 2; 3 consumes the reward IDs from 1; 4 consumes 1/3; 5 consumes 1/3/4; 6 integrates 2/4/5; 7/8 verify the integrated result. Do not broadly refactor the existing large game/UI files. Update existing fixture DTOs in their owning tests when protocol changes; preserve all prior assertions.

### Task 1: Pure progression and cumulative award contracts

**Files:** Create `src/progression.js`, `tests/progression.test.js`.

**Interfaces:**
- `MAX_XP = 2147483647`; `REWARDS`: frozen entries `{ level, kind: 'skin'|'finish', id, name }` in the approved order, kebab-case IDs. Finish IDs: `standard`, `crimson-red`, `ice-blue`, `forest-camo`, `violet`, `orange`, `arctic-white`, `stealth-black`, `gold`.
- `rankForXP(xp) -> { level, intoLevel, levelCost, nextReward }`; at cap use `intoLevel:0, levelCost:0, nextReward:null` while retaining lifetime XP elsewhere.
- `ownsCosmetic(xp, kind, id) -> boolean`; original skin IDs and Standard are free; unknown IDs false. `rewardsBetween(beforeXP, afterXP) -> Reward[]`.
- `emptyTally() -> Tally`, where Tally has exact fields `{ eliminations, zombieKills, flagCaptures, flagReturns, wavesCleared, completed, won, earnedTotal }`. Counts are bounded integers; markers booleans.
- `awardTally(tally, modeId, action, count=1) -> Tally`, returning a fresh tally for action names matching the five count fields; reject invalid actions/counts/mode combinations with RangeError. `finishTally(tally, { modeId, naturalEnd, won }) -> Tally` sets eligible once-only markers; no action credit means no normal finish, Zombies requires at least one cleared wave and never wins.
- `validateTally(value, modeId) -> boolean`: exact keys/types, compatible actions, win implies eligible completion, weighted saturating sum equals earnedTotal. Normal modes allow eliminations, CTF also captures/returns; Zombies only kills/waves. Modules import no DOM/render/socket code.

- [x] **Write failing `progression.test.js` tests**, including these exact boundary assertions and table-driven tests for every action/non-action in the spec:

```js
assert.equal(rankForXP(149).level, 1);
assert.equal(rankForXP(150).level, 2);
assert.equal(rankForXP(350).level, 3);
assert.equal(rankForXP(8400).level, 17);
assert.equal(rankForXP(MAX_XP).nextReward, null);
assert.equal(awardTally(emptyTally(), 'ctf', 'flagCaptures').earnedTotal, 50);
assert.equal(finishTally(awardTally(emptyTally(), 'ffa', 'eliminations'),
  { modeId:'ffa', naturalEnd:true, won:true }).earnedTotal, 85);
assert.equal(finishTally(emptyTally(), { modeId:'ffa', naturalEnd:true, won:true }).earnedTotal, 0);
assert.equal(rewardsBetween(0, 8400).length, 16);
assert.equal(ownsCosmetic(0, 'skin', 'shadow-ninja'), true);
assert.equal(ownsCosmetic(149, 'skin', 'crimson-ninja'), false);
```

Also pin the full reward order/thresholds, exact 2/10/25 rates, draw vs win, repeated finish, early quit, Zombies death before/after a wave, multi-level gains, all integer boundaries and malformed/extra fields. Damage/headshot/loot/auto-return are not accepted action names.

- [x] **Run RED:** `node --test tests/progression.test.js`. Expected: failure for missing exports/behavior, not unrelated environment setup.
- [x] **Implement the interfaces** in `src/progression.js`. Clamp sums, not input validation; invalid negative/fractional/non-finite XP is rejected. Keep reward ownership derived, with no persisted level or unlock list.
- [x] **Run GREEN:** same command; all new cases pass. Run `npm test` for baseline integration.
- [x] **Commit only Task 1 files:** `feat: define cosmetic XP progression and reward rules`.

### Task 2: Durable profile and active-session reconciliation

**Files:** Create `src/profile-store.js`, `src/progression-session.js`, `tests/profile-store.test.js`, `tests/progression-session.test.js`.

**Interfaces:**
- Profile keys `block-ops-progression-v1` and `block-ops-progression-v1-backup`; schema record `{ schemaVersion:1, lifetimeXP, skinId, finishId, receipts:[{key,total}] }`. Newest receipt last, maximum 64; reject serialized records over 131072 characters and receipt keys over 1024 characters. Exact record/entry keys; IDs from Task 1. Duplicate receipt keys or invalid core/receipt fields invalidate the record. Invalid cosmetic IDs fall back without erasing valid XP.
- `createProfileStore({ getStorage, legacySkinId='ranger' }) -> store`; getStorage is an injected function returning synchronous `getItem/setItem` storage, or throwing. Call it inside error handling, not as an argument evaluated during app boot.
- `store.view() -> ProfileView { lifetimeXP, skinId, finishId, rank, saveStatus, saveMessage }`, snapshots detached from internal state. Status is `saved`, `recovered`, `unavailable` or `temporary`.
- `store.credit(key, earnedTotal) -> Delta { creditedXP, newRewards, saved }` applies only positive excess over that receipt's high-water, saturating lifetime XP; malformed keys/totals throw RangeError. `store.equip({skinId?,finishId?}) -> {ok,saved,reason?}` rejects unknown/locked selections. `store.retrySave() -> boolean` attempts the whole dirty record, not its XP delta again.
- `createProgressionSession(store) -> session`: `begin(key,modeId)` activates a trusted new participation (same key is idempotent; invalid key/mode throws RangeError); `accept(key,tally) -> Delta` validates mode/tally and accepts only the active key, otherwise zero credit. `end(key)` deactivates without bonus. `summary() -> null | {key,modeId,tally,creditedXP,newRewards}` returns detached presentation-only data, retained after end and reset on a genuine new begin. Repeated/lower receipts never downgrade the summary tally or repeat unlock notifications.
- Offline keys are `JSON.stringify(['solo',runId])`; online keys `JSON.stringify(['online',normalizedServerOrigin,roundId,playerId])`. IDs are nonempty ASCII `[A-Za-z0-9_-]`, max 96; normalized origin max 512. Only trusted start/accepted-network lifecycle activates a key; receipt/results callbacks cannot activate themselves.

- [x] **Write failing storage/session tests.** Use separate store instances over shared fake storage and a child Node process reading the serialized record for restart verification. Named cases include `quota retry is atomic and duplicate safe`, `protected records are never overwritten`, and `evicted stale session stays inactive`.

```js
// Given shared fake storage and a store with an active valid receipt key:
assert.equal(store.credit(key, 150).creditedXP, 150);
assert.equal(reopened.view().lifetimeXP, 150); // reopened constructed after write
assert.equal(reopened.credit(key, 150).creditedXP, 0);
assert.equal(reopened.credit(key, 140).creditedXP, 0);
assert.equal(reopened.equip({skinId:'crimson-ninja'}).ok, true);
assert.equal(reopened.equip({finishId:'gold'}).ok, false);
// After one failed primary write, duplicate receipt, then retry:
assert.equal(store.view().lifetimeXP, 150);
assert.equal(store.retrySave(), true);
assert.equal(afterRetryReopen.view().lifetimeXP, 150);
// After 65 newer sessions evict oldKey, callbacks never reactivate it:
assert.equal(session.accept(oldKey, oldTally).creditedXP, 0);
```

Pin getter/read/primary-write/backup-write failures separately; genuine absent keys; legacy original skin migration; valid-primary precedence; valid-backup recovery; invalid appearances with valid XP; malformed/oversized/future records; session stop/rematch; saturated total with receipt still saved; current-summary immutability; unchanged settings/online/zombie keys. For a denied initial read that later succeeds, assert existing 100 XP plus 150 newly earned XP becomes 250 once, not 150 or 400; overlapping pending keys keep the stored base untouched.

- [x] **Run RED:** `node --test tests/profile-store.test.js tests/progression-session.test.js`. Expected: new module/contract failures.
- [x] **Implement save/recovery and active gating.** Write previous confirmed valid primary as best-effort backup, then one complete primary JSON write containing XP and receipts. Backup failure never blocks primary success. Retain in-memory high-water after failure; even a duplicate receipt retries a dirty write without recrediting.

Use a valid backup when primary is invalid/missing and show `Recovered previous save`. With no usable save, preserve unreadable records and run temporary in memory; unsupported future schema protects stored keys from overwrite even if a readable backup is available. Storage unavailable copy is exactly `Progress is not saved — storage unavailable`; unrecoverable/future data uses an explicit temporary-session/newer-save explanation instead. If the initial read was denied, track the unsaved session's XP increment and fresh receipt keys separately. On retry, first read/validate the stored base; only disjoint fresh participations can merge their accumulated increment and receipt ledger into it, once, before the atomic write. Apply explicitly changed valid desired appearances; otherwise retain the base's preferences. On overlap, corruption or unsupported schema keep the base untouched and explain temporary/conflicting progress. This is not multi-tab synchronization. Missing keys after a successful read are a valid zero base; a failed read is not.

- [x] **Run GREEN:** both files plus `npm test`; require reopened-store and subprocess assertions to pass, not only same-instance reads.
- [x] **Commit only Task 2 files:** `feat: persist XP and cosmetic preferences with safe recovery`.

### Task 3: New procedural skins and global gun finishes

**Files:** Create `src/cosmetics.js`, `tests/cosmetics.test.js`; modify `src/skins.js`, `src/avatar.js`, `src/world.js`, `tests/skins.test.js`.

**Interfaces:**
- `EXTRA_SKINS`: eight frozen definitions using the existing skin shape; `GUN_FINISHES`: nine frozen `{id,name,palette}` entries; `getGunFinish(id)` is strict. Standard palette is null, preserving the existing per-gun colors.
- Extend `createWeaponModel(THREE, weapon, {finishId='standard'}={})` and `createAvatarModel(THREE, {skinId,teamId,weaponId,heldItem,finishId='standard'})`. Avatar userData exposes finishId only when nonstandard; consumers read `userData.finishId ?? 'standard'`, preserving the existing original-model golden metadata.
- New skin IDs/parts: crimson-ninja tied-hood/utility-pouches; midnight-ops patrol-helmet/radio; frost-unit sensor-antenna/bedroll; solar-guard sealed-helmet/power-pack; golden-ninja tied-hood/light-strips; urban-ranger field-hat/utility-pouches; lava-unit sensor-antenna/air-tanks; void-guard sealed-helmet/light-strips. Append after original eight, do not reorder them.
- Use flat palettes, with body/trim/face/visor/boots respectively: Crimson `#8f2038/#dfad45/#d9aa7d/#ffda63/#211b27`; Midnight `#172638/#536681/#bd8f70/#60bfd8/#111923`; Frost `#dbeaf0/#5fa7c0/#bc9078/#8ef3ff/#526778`; Solar `#db8b2b/#f5df8a/#a16c46/#56dcf0/#483d31`; Golden `#c99b34/#24202d/#d3a27e/#fff1ad/#1a1923`; Urban `#63717c/#a6b2b8/#bc8c68/#8bd0bc/#303943`; Lava `#943326/#ef8740/#563b32/#ffe17a/#2a2329`; Void `#38284f/#9379b6/#55526e/#b59dff/#1b1928`.
- Finish palettes replace existing weapon body/steel/light slots, retaining black grips/barrels: Crimson `#ae2943/#4e2631/#e6a077`; Ice `#74c8ed/#36546a/#e7f7ff`; Forest `#557447/#6d644b/#c9bb82`; Violet `#9256cc/#493757/#dac0fa`; Orange `#eb8431/#604a38/#ffd797`; Arctic `#e5edf0/#788e9e/#ffffff`; Stealth `#222831/#353e49/#687481`; Gold `#d5ab43/#70582f/#fff0ad`.

- [x] **Write failing catalogue/model tests**, retaining the original eight-skin/Standard signature assertion and adding `all finishes preserve geometry and ownership`:

```js
assert.equal(SKINS.length, 16);
assert.equal(GUN_FINISHES.length, 9);
assert.equal(originalStandardSignature,
  'f2b0171a213b8d1c6cb67f7dfdf2d367e6478646541cca518c64be8bad7819fb');
assert.deepEqual(finishedGeometry, standardGeometry);
assert.deepEqual(newAvatar.userData.hitbox, oldAvatar.userData.hitbox);
assert.equal(otherModelMaterialDisposed, false);
assert.deepEqual(weaponCatalogueAfter, weaponCatalogueBefore);
```

Iterate all 28 guns × nine finishes; all 16 characters × null/red/blue teams; ray-test existing badge directions, distinct palettes, knife independence and disposal. Reuse `tests/skins.test.js` signatures, do not replace its original golden with a new unchecked hash.

- [x] **Run RED:** `node --test tests/cosmetics.test.js tests/skins.test.js`. Expected: missing new looks/finish behavior, originals still intact.
- [x] **Implement catalogue/model extensions** with existing boxes/material ownership, no geometry increase or new renderer. Color slots may be named locally to avoid global color replacement accidentally tinting badges, face or knife.
- [x] **Run GREEN:** same command plus `npm test`. Original free visuals, hitboxes and per-model disposal stay unchanged.
- [x] **Commit only Task 3 files:** `feat: add unlockable block skins and gun finishes`.

### Task 4: Offline earning and pending appearance lifecycle

**Files:** Create `src/solo-progression.js`, `tests/progression-solo.test.js`; modify `src/game.js`, `src/zombie-runtime.js`, `src/online-game.js` (online exclusion flag only), `tests/helpers/game-fixture.js`.

**Interfaces:**
- `createSoloProgression({runId,modeId,onEvent})` owns one tally and returns `elimination({killerId,victimId,victimLifeId,enemy})`, `objectives(events)`, `survival({kills,wavesCleared,ended})`, `finish({winnerId,winnerTeamId,teamId})`, `close()`. Local actor ID remains `local`; all methods after close are no-ops. Keep per-victim highest accepted life, not an unbounded death-event set.
- `onEvent` receives `{type:'start'|'update'|'stop',key,modeId,tally}`; start synchronously once, stop with latest tally but no bonus. Survival consumes cumulative counts by positive difference, never sums whole repeated reports.
- `ArenaGame.start(id, settings)` adds `settings.progressionSource: 'solo'|'online'` (default solo) and `finishId` (default Standard); create a collision-resistant runId on each actual solo start. Online adapter explicitly passes online and creates no solo progression. Use crypto.getRandomValues for legacy-compatible random IDs; do not require crypto.randomUUID.
- `ArenaGame.setPendingAppearance({skinId,finishId})` validates known IDs and stores player pending fields without inventory mutation; keep `setPendingSkin(skinId)` as a wrapper preserving `pendingFinishId ?? finishId ?? 'standard'`. Reset applies both current fields, before equipment/model refresh. `events.onProgression` is optional for existing callers.

- [x] **Write failing headless integration tests** via `createHeadlessGame/cleanupGame`. Named case `pending appearance is not equipment` covers live/dead/knife/supply states. Exact outcomes:

```js
assert.equal(afterEnemyKill.earnedTotal, 10);
assert.equal(afterSameCorpseAgain.earnedTotal, 10);
assert.equal(afterRespawnedEnemyKill.earnedTotal, 20);
assert.equal(afterFiveZombieKillsAndWave.earnedTotal, 35);
assert.equal(afterQualifyingZombieDeath.earnedTotal, 85);
assert.equal(afterManualReturnThenCapture.earnedTotal, 60);
assert.equal(afterQuit.completed, false);
assert.equal(onlineAdapterSoloEvents.length, 0);
assert.deepEqual(equipmentAfterAppearanceSelection, equipmentBefore);
assert.equal(game.player.finishId, 'standard'); // pending only
assert.equal(game.player.pendingFinishId, 'crimson-red');
```

Exercise gun/knife/grenade multi-kill, self/team/protected/no-kill damage, no headshot double bonus, both flag return types, capture ending round before completion, all bot difficulties, normal win/draw/idle finish, repeated finish/records, replay and stale closed adapter. For Zombies cover early death, wave recovery without applying pending choices, and next-run application.

- [x] **Run RED:** `node --test tests/progression-solo.test.js`. Expected: missing event/accounting/pending-finish behavior.
- [x] **Implement offline adapter hooks.** Accepted normal kills enter before `finishRound`; consume `tickMode` objective events before ending. Zombies report kill gains immediately at accepted death, wave gains at recovery, completion only at natural game-over. `quit()` never calls completion. Keep existing personal-best callback independent.

Include current finish in first-person weapon presentation cache checks. Respawn appearance rebuild alone must not refill weapons; existing respawn equipment reset retains its own original behavior. Original bots use the first eight skins/Standard. Neutral ground/death-drop models do not receive holder preferences.

- [x] **Run GREEN:** new tests plus `node --test tests/zombie-*.test.js tests/loot-solo.test.js tests/supply-solo.test.js tests/offline-modes.test.js tests/headshots.test.js`, then `npm test`.
- [x] **Commit only Task 4 files:** `feat: earn persistent progression from solo match actions`.

### Task 5: Authoritative online receipts and cosmetic replication

**Files:** Create `src/progression-protocol.js`, `tests/progression-rooms.test.js`, `tests/progression-protocol.test.js`; modify server, protocol, network, online adapter and fixture tests listed in the file map.

**Interfaces:**
- Public room adds `roundId: null|string`; null in lobby, fresh UUID on each successful `RoomManager.start`, retained through ended. Configuration resets it to null after flushing the ended state; it does not generate an identity. Public players add `finishId:string,pendingFinishId:null|string`, mirroring the existing server skin convention; spawn applies then clears pending finish. Existing skin/current-life/gear fields remain strict.
- Recipient packet adds `progression: null|{roundId,playerId,modeId,tally}` beside `equipment` in both welcome/state. Null only when room.roundId is null. `RoomManager.progressionSnapshot(playerId)` returns only that participation's detached receipt. No lifetime XP/ownership broadcast.
- `validProgressionReceipt(value, room, playerId) -> boolean` in `src/progression-protocol.js`: exact keys, IDs, mode/current recipient relation, Task 1 tally rules; completed only in ended phase, and win must match recipient's actual FFA/team winner. Ended late join has zero tally, completed false.
- `RoomClient` atomically validates receipt, room and equipment, then exposes `room.selfProgression`; immutable validated connection origin is available as `client.serverOrigin`. Use roundId to permit legitimate new-round clock/award resets without weakening existing monotonically increasing connection life IDs or equipment action sequences.
- Create/join include desired finishId. Retain existing `{type:'skin',skinId}`; add exact `{type:'finish',finishId}` and `RoomManager.setFinish(id,finishId)`. Known IDs only, existing size/rate limits; no claim of secure unlock proof. During playing defer until respawn, outside playing apply immediately.

- [x] **Write failing room/protocol/socket tests**, using existing RoomManager and fake Socket helpers. Include `final receipt precedes immediate rematch` with a real owned WebSocket server and new-start request between simulation broadcasts:

```js
assert.equal(killerReceipt.tally.earnedTotal, 10);
assert.equal(victimReceipt.tally.earnedTotal, 0);
assert.equal(afterDrainingPublicEvents.tally.earnedTotal, 10);
assert.equal(eligibleWinnerReceipt.tally.earnedTotal, 85);
assert.equal(endedLateJoinReceipt.tally.earnedTotal, 0);
assert.notEqual(rematch.roundId, endedRound.roundId);
assert.equal(rematchOwnReceipt.tally.earnedTotal, 0);
assert.equal(rejoinedOwnReceipt.playerId === oldPlayerId, false);
assert.equal(validProgressionReceipt(wrongPlayerReceipt, room, ownId), false);
assert.equal(validProgressionReceipt(forgedWeightedTotal, room, ownId), false);
assert.equal(receivedPhasesBeforeNewRound.at(-1), 'ended');
```

Also pin all online modes/objectives, scoring-kill end order, no-action survivor bonus exclusion, repeated/lower receipts, gaps in event arrays, menu-time packets, player leave/new participation, duplicate victim life, config without new round, atomic rejection preserving previous valid state, prototype/extra-key/non-finite/wrong-mode/future totals, 4→5 update guidance, and malformed appearance messages. Every client fixture must include the deliberate new exact shape.

- [x] **Run RED:** `node --test tests/progression-rooms.test.js tests/progression-protocol.test.js tests/network.test.js tests/network-client.test.js`. Expected: missing new protocol fields/behavior.
- [x] **Implement server accounting before transient events.** Initialize tally on start/new participation. In `eliminate`, credit only the accepted killer-stat increment before `syncMode`; count actor-attributed flag events before queue consumption. Finalize eligible present players only on the transition to ended. `broadcast`/welcome attach private receipts. Before configuration or start replaces an ended round, broadcast its finalized state first; no history replay or acknowledgement service is added.

Update OnlineArena to pass progressionSource online; replicate current/pending finish and include finish in remote/first-person model cache identity. Same-map rematches key off roundId, not only phase/map. Keep authoritative appearance out of the profile store; Task 6 handles desired choices. Protocol validators reject malformed whole packets rather than partially applying cosmetics or XP.

- [x] **Run GREEN:** targeted command, `node --test tests/online-modes.test.js tests/rooms.test.js tests/gear-protocol.test.js`, then `npm test`. Old-protocol rejection must be a clear update message, not silent failure.
- [x] **Commit only Task 5 files:** `feat: replicate round-scoped XP receipts and gun finishes`.

### Task 6: Profile-bound UI, unlock controls and results

**Files:** Create `src/progression-ui.js`, `tests/progression-ui.test.js`; modify the UI files listed in the file map. Do not add another gameplay inventory screen.

**Interfaces:**
- `createProgressionUI({document,onEquip}) -> ui`, with `render(profile,context)`, `renderResults(summary,profile)`, `notify(delta,profile)`, `dispose()`. `onEquip(patch)` uses Task 2 store.equip; `context` is `{live,modeId,currentSkinId,currentFinishId}`. UI never credits a receipt.
- Stable regions: `#home-progression`, `#progression-save-status`, `#finish-grid`, `#armory-skin`, `#appearance-timing`, `#results-progression`, `#progression-toast`. Keep `data-skin`; finishes use `data-finish`. A compact character selector in the existing Armory permits next-respawn skin changes without leaving a solo match; it is not a new screen. Locked entries expose required level and accessible disabled state; text inspection does not replace the equipped preview/card.
- `WeaponPreview.equip(weapon,{finishId='standard'}={})` in main passes through to model. Home/CharacterPreview equipment keys and labels include finish. Main's existing `selectConfiguration(next)` calls store.equip for changed appearance and returns without changing selection when rejected; Home and room selectors use that guarded route, Armory calls the same onEquip callback.
- Keep `renderMatchResults` unchanged, including its existing `best` option. After it renders, call `ui.renderResults(session.summary(),store.view())`. MultiplayerUI gains `onResults()` for that presentation callback, plus `onProgressionRoom(room,client)` and `onProgressionStop()`, invoked after accepted network state but before render/end handling, including menus.
- Main owns one store/session/UI. Boot validates legacy selection, migrates skin, then overlays profile desired appearance. Solo start/update/stop wire to begin/accept/end. Online keys derive from accepted own receipt + validated origin; activate only on new accepted round/participation, reconcile before results; deactivate on lobby reconfiguration/leave/disconnect. Results read summary only.

- [x] **Write failing UI/wiring tests** with minimal DOM stubs patterned after the existing inventory fixture. Name `authoritative old look cannot revert preference`; no new DOM dependency. Assertions include:

```js
assert.equal(lockedChoiceResult.ok, false);
assert.equal(savedDesiredSkin, 'crimson-ninja');
assert.equal(currentRemoteSkin, 'ranger'); // before respawn
assert.equal(store.view().skinId, 'crimson-ninja'); // after old current snapshot
assert.equal(timingForLiveFFA, 'Next respawn');
assert.equal(timingForLiveZombies, 'Next run');
assert.equal(profileWritesAfterRenderingResultsTwice, profileWritesBefore);
assert.equal(level17NextRewardText, 'All rewards unlocked');
assert.equal(toastComputedPointerEvents, 'none');
```

Cover Home/Armory/room selector gates, save failure/success announcements, all levels crossed coalesced once, no auto-equip, pending preference across restart, ordinary weapon selection unchanged, session lifecycle callback ordering, denied storage boot, and large XP formatting.

- [x] **Run RED:** `node --test tests/progression-ui.test.js`. Expected: missing UI/bindings rather than fixture errors.
- [x] **Implement adapter and narrow wiring.** Show level/next reward, lock requirements, warnings, desired/current timing and breakdown. Remove misleading `ALL SKINS UNLOCKED` text. Reuse existing preview renderers; no per-card WebGL contexts. Selection saves even while pending; online authoritative current/pending updates affect gameplay display only.

Retry dirty saves on subsequent accepted receipts, cosmetic actions and foreground/Home return; do not depend on those for initial write. Coalesce gameplay XP/unlock notices in a pointer-transparent, nonmodal region away from crosshair/controls/inventory. Omit an extra unlock sound in this release (the spec makes it optional); Sound off remains silent. Preserve offline pause and online neutral-input/live-clock behavior.

- [x] **Run GREEN:** new unit file and `npm test`; build then run existing `npm run test:home`, `npm run test:inventory`, `npm run test:multiplayer`. Expectations: controls/previews remain usable, no page/runtime errors.
- [x] **Commit only Task 6 files:** `feat: show saved XP and unlockable cosmetic selections`.

### Task 7: Persistent browser/native acceptance and candidate packaging

**Files:** Create browser helpers/smokes and Android progression smoke; modify package/version/package-smoke files listed in file map. Existing browser helper code is reused, not broadly rewritten.

**Interfaces:**
- `tests/helpers/progression-browser.js` exports `persistentFixture({legacy=false,viewport,artifactDir}) -> {page,origin,reopen,close}`. It owns a unique temporary browser data directory and local server; `reopen()` fully closes/relaunches the persistent context at the unchanged origin. Cleanup removes only owned live resources, retaining evidence.
- New scripts: `test:progression` runs progression.browser and progression-layout; `test:progression:android` runs android/tests/progression-smoke.mjs. Tests use `ARTIFACT_DIR`, `DIST_DIR`, and Android `ANDROID_APK_PATH`, `ANDROID_SERIAL`, `GAME_TEST_SERVER_URL` (owned TLS only).
- Native harness refuses a serial not explicitly identified as an owned test emulator. Use a unique CDP forward; never target a physical device automatically, uninstall, or clear app data. UI input/observations may use existing helpers; no product debug hooks or artificial XP injection for earning gates.

- [x] **Write acceptance tests and run RED against current integrated assets.** Add concrete assertions before missing harness/version updates. A deterministic real-play route is solo FFA: earn 14 eliminations (140 XP), quit; earn one in the next round (150), select Crimson Ninja as pending, quit and reopen. Then win a fresh FFA (150 action +50 finish +25 win =225) to reach 375, unlock/select Crimson Red, and reopen again. Use actual aim/fire/respawn controls with one Easy bot; no forced score or simulated time advancement.

```js
assert.equal(afterEarlyExitXP, 150);
assert.equal(afterFullContextReopenXP, 150);
assert.equal(reopenedDesiredSkin, 'crimson-ninja');
assert.equal(naturalWinSummaryXP, 225);
assert.equal(afterNaturalWinXP, 375);
assert.equal(afterResultsReopenXP, 375);
assert.equal(afterSecondRestartFinish, 'crimson-red');
assert.equal(afterAndroidForceStopXP, beforeAndroidForceStopXP);
assert.equal(afterSignedUpdateXP, beforeSignedUpdateXP);
```

Other cases: genuine zombie wave/finish credit, solo TDM/CTF objectives, online two-peer XP and current/pending appearance (observe actual models plus labels), server restart/new participation, cross-origin browser isolation, corrupt/denied/future save warnings, and pending preference while an online menu is open. Synthetic max-XP profiles are permitted only in separate catalogue/layout cases, never as the earning/restart evidence.

- [x] **Implement the test harnesses and version bump.** Use passive simulation observations from `tests/helpers/loot-browser.js` for real movement timing; native touch uses actual adb gestures with feedback, not compressed drag sequences. Add exact 0.7.0/code9 assertions to package smoke and compare signer fingerprint to the existing release. Refresh lockfile metadata without dependency upgrades. Canonical new artifact is `artifacts/block-ops-v0.7.0-xp-cosmetics.apk`.

Check 16 skins/nine finishes/save warnings/large totals at 854×480, 1200×700, 1280×720 and control scale 1/1.3 in modern and legacy modes. Check no overlap/input interception at touch controls. Android: test genuine offline earning, force-stop/relaunch, background/foreground, and retained choice/XP through same-signed update-install. Separately verify actual versionCode 8→9 migration preserves old settings/zombie records; version 8 never had XP. To test earned XP across replacement, earn in the preliminary code9 candidate then `adb install -r` the final same-signed code9 candidate; report this accurately as update-install, not invented XP in v0.6.0.

- [x] **Run GREEN:** `npm run build`, `npm run test:progression`, native progression smoke against owned emulator and separate TLS staging. Use `BUILD_DIR` for the browser build, then `DIST_DIR`/`APK_OUTPUT_PATH` for `bash scripts/build-apk.sh`, inside a fresh `mktemp -d` artifact directory; `ANDROID_APK_PATH=... DIST_DIR=... npm run test:apk` must prove exact bundled bytes/version/signer. Capture real screenshots, raw test logs and measured outcomes; failure is not a pass because a screenshot was created.
- [x] **Commit only Task 7 source/test/version files:** `test: verify XP saves across browser and Android restarts`. Retain candidate APK and evidence outside source commits as existing conventions require.

### Task 8: Full regression, independent review and release gate

**Files:** Create `docs/releases/2026-10-07-xp-cosmetics.md`; update this plan's completion checkboxes during execution. No unrelated README edits. Conditional live default changes are a separately approved release action.

**Interfaces:** Release evidence records source commit, exact browser asset hashes, APK path/hash/signer/code, configured default server, tested save scenarios, owned staging/emulator identities, cleanup results and unresolved parked-BYD checks. It distinguishes `candidate verified` from `publicly deployed`.

- [x] **Freeze a unique source/assets snapshot and run the complete gate.** Use test-specific owned ports/origins; never restart the existing public server to run tests. Commands: `npm test`; build-output/WebView checks; all package browser scripts (`test:browser`, `test:home`, `test:touch`, `test:configurations`, `test:multiplayer`, `test:loot`, `test:loot:touch`, `test:webview`, `test:inventory`, `test:zombies`, `test:supplies`, `test:progression`); additional existing carried-flag/inventory-layout/native cleanup smokes; existing native offline/Zombies/supplies/online matrix plus new progression smoke and package smoke against frozen assets. Expected: every assertion passes, no console/runtime errors, no test peers/resources leaked. Preserve failures and their fixes; do not substitute a later untested build.
- [x] **Request independent code review using the required skill.** Review approved spec, commits and real test evidence; fix material findings with regression tests and rerun affected gates. Native execution has this final whole-feature independent review; subagent execution also performs its required per-task reviews. No review changes are accepted blindly.
- [x] **Write and verify candidate evidence.** Read back release document and check all named artifacts/hashes exist. `git diff --check` and scoped diff/status must show no accidental user-file changes. Commit release evidence/checked plan only: `docs: record verified XP and cosmetics candidate`.
- [x] **Stop at the public release boundary and ask for a fresh empty-room window.** Until that authority exists, report candidate ready with its APK and local/staging test instructions; public game remains old. Do not reuse prior “no one is in the lobbys” approval.
- [x] **Only after fresh release approval**, rediscover live route/process/cwd/assets and current room state, preserve an exact rollback snapshot, coordinate protocol-5 server/browser/APK, and verify current default server plus previously saved server settings. If a new default URL changes bundled bytes, rebuild/freeze/retest relevant browser/native online/persistence/package gates before publishing the replacement. Retain old artifacts. Verify live asset hashes, two-peer protocol/appearance/XP, cleanup and health; document rollback/final URLs. Ask the user to validate reopening/progress/rendering on the parked BYD. No push/merge.

## Plan self-review and handoff

Self-reviewed against every approved-spec section: Tasks 1/4/5 own action eligibility and duplicate safety; 2 owns persistence/recovery; 3/4/5 own visual/current-pending behavior; 6 owns feedback and ownership gates; 7/8 own real earning, restart/upgrade, legacy/native verification and release coordination. All five Review Focus conditions have named owning tests. Common tally/profile/receipt/finish names are shared across interfaces; results never award XP. Existing procedural models and preview renderers are reused; unrelated roadmap features remain out of scope.

Recommended execution: **Native** (main agent implements the eight dependent tasks, with final independent review). Profile lifecycle, protocol validation and UI wiring share tight interfaces; one implementer avoids repeated context setup. **Subagent-driven** instead adds fresh implementer/reviewer gates per task at higher context cost. Wait for the user's plan review and method selection before coding.
