# Solo Secret Powers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved hidden, PIN-gated solo powers menu without changing multiplayer or losing player progress.

**Architecture:** Keep strict local power configuration, PIN verification and modal interaction in focused modules. `ArenaGame` applies powers only to its live solo player; Home prepares one-round settings and Pause changes the current round. Keep progression, equipment DTOs, server messages and shared weapon/movement definitions unchanged.

**Tech Stack:** Existing JavaScript ES modules, Three.js 0.160.1, esbuild targeting ES2017, Node test runner, Playwright 1.58.2 and the existing Android WebView wrapper. Use built-in Web Crypto; no added product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-solo-secret-powers-design.md` (approved 2026-10-12).

**Status:** User approved the plan and selected option 1 (native inline implementation) on 2026-10-12. Execution evidence is tracked separately; unchecked steps are not completion claims.

## Global Constraints

- Works in every existing solo mode: Free For All, Team Deathmatch, Capture the Flag and Zombies, on all eight maps.
- Separate switches for invincibility, unlimited gun ammunition without reloading, and super speed. Super speed has a 2x–5x slider.
- The slider ranges from 2.0x to 5.0x in 0.1x steps, initially 2.0x; turning super speed off restores the normal movement rate.
- Five activations of the same logo within three seconds open the gate. PIN creation requires confirmation of 4–8 digits, including leading zeroes. Five incorrect submissions cause a 30-second, app-session-local delay before another attempt.
- Create a separate versioned key, `block-ops-solo-powers-pin-v1`. The stored object contains exactly `schemaVersion: 1`, `kdf: 'PBKDF2-SHA256'`, `iterations: 100000`, `salt` (32 lowercase hexadecimal characters) and `verifier` (64 lowercase hexadecimal characters).
- Version 1 uses Web Crypto PBKDF2-HMAC-SHA-256, 100,000 iterations, a random 16-byte salt and a 32-byte derived verifier. Reject oversized serialized records above 1,024 characters before parsing.
- Only the local human receives powers. Teammate bots, enemy bots and zombies keep normal abilities. Grenades remain normal collected loot.
- Normal XP and cosmetic unlocks still count and save. Assisted Zombie runs also count toward the ordinary per-map best-wave record.
- Powers turn off on match completion, confirmed departure from a match and app restart. The PIN, existing progress and legitimately earned progress remain saved.
- Opening the menu during a match keeps solo gameplay paused. Neither Apply nor Cancel resumes play.
- Jump velocity, gravity and ladder climbing speed remain unchanged. No flying, teleporting, rapid fire or new inventory grants.
- No room-schema or network-protocol-version change. No PIN or power data in settings/progression schemas, equipment DTOs, sockets, logs or URLs.
- Keep Android package `au.local.blockops`, minSdk 26, targetSdk 36, existing signer and `https://appassets.androidplatform.net/assets/index.html` unchanged. Keep network permissions unchanged.
- Do not implement the separate custom-match-rules discussion. Do not modify or restart public services, empty rooms, overwrite release artifacts or clear installed/browser player data.
- Preserve existing dirty work, especially teammate-map changes and native-test changes. Work in the current checkout chosen by the user; inspect isolation/state at execution time without silently moving to a clean checkout that drops those changes.

## Review Focus

- Delayed crypto completion after backgrounding, changing round or entering online must not reopen or apply the panel; a completed PIN setup may remain saved (Tasks 2, 4, 5).
- Denied storage getters, future/bloated/malformed records and missing/rejecting Web Crypto must lock only the secret feature, preserve bytes and leave ordinary play usable (Tasks 2, 5).
- Rapid ammo toggles, gun switches, reloads and respawns must not bypass firing cooldowns, corrupt the 500-ammo invariant or grant grenade resources (Tasks 1, 3, 5).
- Maximum speed against short stairs, narrow roof supports, hiding-room walls and frame spikes must preserve collisions and measured speed rather than reducing the setting silently (Tasks 3, 6).
- Reopening at the same origin and upgrading the APK must retain PIN/XP/cosmetics/records while powers reset; a different origin must not appear to overwrite that save (Tasks 5, 7).

---

## Execution safety and file map

Before Task 1, capture `git status --short`, branch/HEAD, index state and a read-only inventory of the files below. The planning baseline is `f15a83e` plus the existing dirty checkout; execution also includes the subsequent documentation-only approval/plan commit. Do not reset, stash away, overwrite or automatically commit old changes. Stage only feature-owned hunks in already-modified files, and explicitly named new files; never use `git add .` or `git commit -a`.

Capture a fresh unit baseline before implementing, in an execution-owned evidence directory. Previous session test results are context, not current proof. If a failure predates this feature, record it and investigate without silently changing unrelated functionality.

| File(s) | Responsibility |
| --- | --- |
| New `src/solo-powers.js` | Strict configuration, defaults, finite ammunition helper. |
| New `src/solo-powers-pin.js` | Local PIN record, crypto, attempt delay, storage failure results. |
| New `src/solo-powers-ui.js` | Logo sequence, PIN forms, modal draft, focus and cancellation. |
| Existing `src/game.js` | Per-round state, local damage/ammo/speed hooks and resets. |
| Existing `src/main.js`, `src/equipment-ui.js` | Home/Pause lifecycle integration and local-only ammo presentation. |
| Existing `index.html`, `src/styles.css` | Accessible logos/modal and compact legacy-compatible layout. |
| New `tests/solo-powers*.test.js`, `tests/helpers/solo-powers-ui.js` | Policy, PIN, simulation, interaction and integration tests. |
| New `tests/helpers/solo-powers-browser.js`, `tests/solo-powers*.browser.mjs` | Reusable real-UI controls, persistent browser, layout and online isolation checks. |
| Existing `package.json`, `package-lock.json`, `android/app/build.gradle` | Test commands and explicitly versioned candidate, not dependency upgrades. |
| Existing `android/tests/package-smoke.mjs`; new `android/tests/solo-powers-smoke.mjs` | Explicit candidate packaging and save-retaining native checks. |
| New `docs/releases/2026-10-12-solo-secret-powers-verification.md` | Actual evidence, artifact hashes, results and device limitations. |

Task 1 and Task 2 have no code dependency on each other. Task 3 consumes Task 1. Task 4 consumes Tasks 1–2. Task 5 joins Tasks 3–4. Task 6 exercises the integrated candidate; Task 7 packages those exact tested assets. Do not concurrently edit `src/main.js`, `src/game.js`, shared HTML/CSS or shared build directories.

### Task 1: Strict power values and finite ammo policy

**Files:** Create `src/solo-powers.js`, `tests/solo-powers.test.js`.

**Interfaces:**

- Consumes: `getWeapon`, `WEAPONS` and `TOTAL_AMMO` from `src/weapons.js`; existing `WeaponState` fields `weaponId`, `ammo`, `reserve`, `cooldown`, `reloadRemaining`.
- `PowerConfig = { invincible: boolean, unlimitedAmmo: boolean, superSpeed: boolean, speedMultiplier: number }`.
- `defaultSoloPowers() -> PowerConfig`: a fresh `{invincible:false, unlimitedAmmo:false, superSpeed:false, speedMultiplier:2}`.
- `normalizeSoloPowers(value: unknown) -> PowerConfig | null`: require exactly those own keys, actual booleans and a finite number in [2,5]; round valid speed to nearest 0.1; never coerce strings or inherited properties.
- `replenishPoweredMagazine(state: WeaponState) -> void`: existing valid gun state in, full finite magazine out; cap reserve at `TOTAL_AMMO - magazine`, clear `reloadRemaining`, preserve cooldown and weapon ID. It is called only at solo-gated sites in Task 3. Import weapon definitions rather than duplicating capacities.

- [ ] **Step 1: Write failing policy tests**, including these assertions and independent fresh-default copies:

```js
// Test: strict solo defaults, numeric range, rounding and exact own keys.
assert.deepEqual(defaultSoloPowers(), {invincible:false, unlimitedAmmo:false, superSpeed:false, speedMultiplier:2});
for (const speedMultiplier of [NaN, Infinity, 1.9, 5.1, '3'])
  assert.equal(normalizeSoloPowers({...defaultSoloPowers(), speedMultiplier}), null);
assert.equal(normalizeSoloPowers({...defaultSoloPowers(), speedMultiplier:2.34}).speedMultiplier, 2.3);
assert.equal(normalizeSoloPowers({...defaultSoloPowers(), extra:true}), null);
assert.equal(normalizeSoloPowers(Object.create(defaultSoloPowers())), null);
```

Also reject symbol/extra keys and throwing property getters without throwing out of validation. For each of the 28 weapons, assert that replenishing empty/part-used valid state preserves `cooldown`, sets magazine to its own capacity, sets reload to zero, and keeps integer `ammo + reserve <= 500`. Include a valid `ammo:0,reserve:500` boundary case. No gear/grenade object is an input to this helper.

- [ ] **Step 2: Run red:** `node --test tests/solo-powers.test.js`. Expect missing exports/module or failing required behaviour, not a syntax error.
- [ ] **Step 3: Implement the three exports** with the exact interfaces above. Use legacy-compatible own-key checks; avoid `Object.hasOwn`.
- [ ] **Step 4: Run green:** `node --test tests/solo-powers.test.js tests/equipment.test.js`. Expect zero failures and no shared weapon-definition changes.
- [ ] **Step 5: Commit only Task 1 files:** `feat: add validated solo power policy`.

### Task 2: Saved PIN gate with bounded failures

**Files:** Create `src/solo-powers-pin.js`, `tests/solo-powers-pin.test.js`.

**Interfaces:**

- `createSoloPowersPinGate({getStorage, getCrypto, now} = {}) -> PinGate`; default getters access browser globals lazily, never at module import. `now` returns milliseconds.
- Consumes no power-model or game state; injectable getters return ordinary Storage/Web Crypto interfaces, and tests provide those interfaces directly.
- `gate.status() -> {kind:'missing'|'ready'|'protected'|'unavailable', reason:string, retryAfterMs:number}`. A successful read returning null is missing; malformed/newer data is protected; storage/crypto capability failure is unavailable.
- `gate.setup(pin:string, confirmation:string) -> Promise<PinResult>`; saves only if still missing, writes and reads back the exact approved record. It does not unlock a UI by itself.
- `gate.verify(pin:string) -> Promise<PinResult>`; rereads/validates the existing record, does not write it, and enforces the app-session attempt delay.
- `PinResult = {ok:true} | {ok:false, reason:string, retryAfterMs:number}`. Expected environmental/validation failures resolve as failures rather than escaping as unhandled rejections. Keep attempt state in the same gate instance across dialog closes; reject concurrent submissions as busy without counting extra failures.

- [ ] **Step 1: Write failing tests** using an injected Map-backed storage, fake clock and Node Web Crypto. Test setup/verify, wrong confirmation, leading zeroes, exact record fields/lengths, non-plaintext storage, re-creation with the same storage, and verification with a read-only store. Use test-only fixture PINs; never inspect a user's real record.

```js
// Test: leading-zero PIN and five-attempt delay survive dialog lifetimes.
assert.equal((await gate.setup('0427', '0427')).ok, true);
assert.equal((await gate.verify('0427')).ok, true);
for (let i=0; i<5; i++) assert.equal((await gate.verify('1111')).ok, false);
assert.equal((await gate.verify('0427')).ok, false);
clock += 30000;
assert.equal((await gate.verify('0427')).ok, true);
```

Add throwing getter/getItem/setItem, failed readback, >1,024-character record, unexpected own keys, future version, bad hex/lengths/iterations, undefined `crypto.subtle`, rejecting `importKey`/`deriveBits`, and a second setup arriving during the first derivation. Assert protected data and unrelated save keys remain byte-identical. Hold a mocked derivation promise to prove no success is returned before write/readback.

- [ ] **Step 2: Run red:** `node --test tests/solo-powers-pin.test.js`. Expect absent service/behaviour failures.
- [ ] **Step 3: Implement `PinGate`.** Use `getRandomValues`, `subtle.importKey('raw', ...)` and `deriveBits` for the approved PBKDF2 parameters. Digits are ASCII/UTF-8; encode with a `Uint8Array` without requiring a newer encoding/polyfill API. Recheck the stored record before a setup write so another completed setup cannot be overwritten. Never log inputs or use a plaintext/Math.random fallback. A failed crypto operation does not count as a wrong PIN.
- [ ] **Step 4: Run green:** `node --test tests/solo-powers-pin.test.js tests/profile-store.test.js tests/zombie-records.test.js`. Expect zero failures. Inspect new source for accidental PIN logging or writes to existing save keys.
- [ ] **Step 5: Commit only Task 2 files:** `feat: add isolated saved PIN gate for solo powers`.

### Task 3: Per-round solo simulation and online exclusion

**Files:** Modify `src/game.js`; create `tests/solo-powers-game.test.js`. Use existing `tests/helpers/game-fixture.js`, `tests/progression-solo.test.js`, `src/online-game.js` and `src/zombie-runtime.js` as references; do not add production test hooks.

**Interfaces:**

- Extend `ArenaGame.start(id, settings = {}, powers = null)` and `tryStart(id, settings = {}, powers = null)` with a separate optional third argument. Do not put powers inside `settings` or change existing two-argument callers.
- Consumes `defaultSoloPowers()`, `normalizeSoloPowers(value)` and `replenishPoweredMagazine(state)` from Task 1; existing `tryFire`, `startReload`, equipment and movement paths remain authoritative for everything else.
- `game.getSoloPowers() -> PowerConfig`: return a copy; effective all-off for non-solo, absent or ended rounds.
- `game.setSoloPowers(config, roundId = game.modeState) -> {ok:boolean, reason?:string}`: reject stale round identities, invalid configuration, ended/inactive-round contexts and online sources; paused live solo rounds are allowed.
- `game.resetSoloPowers() -> void`: clear the internal configuration only, leaving player saves and inventory intact.

- [ ] **Step 1: Write failing headless tests.** A representative invincibility case uses the real arena path:

```js
// Test: invincibility rejects lethal damage before the defeat path runs.
game.start('m4a1', {bots:1}, {...defaultSoloPowers(), invincible:true});
game.player.protected=0;
const before={health:game.player.health, armour:game.player.armour};
game.damageActor(game.bots[0].id, game.player, 10000000000, game.getActors());
assert.deepEqual({health:game.player.health, armour:game.player.armour}, before);
game.setSoloPowers(defaultSoloPowers(), game.modeState);
assert.equal(game.damageActor(game.bots[0].id, game.player, 10, game.getActors()), true);
```

Add real simulation assertions for bot bullets/knife/explosives and Zombie attacks; no healing/revival; other actors remain damageable under their normal team rules. Loop all weapons through real input/fire intervals, reload-on/off, gun pickups/switches and respawn. Assert `equipmentFromDTO(equipmentDTO(...))` stays valid, cooldown remains in effect, semiauto still needs a fresh press, and supplies/recovery still block attacks. For FFA/TDM/CTF/Zombies, assert finish/quit/failed start/replay clear powers, pause/respawn preserve them, and normal XP/records events are unchanged. Invalid third-argument values start a normal all-off round rather than enabling powers.

Use known empty physical space in a headless fixture to compare normal/2x/5x displacement, including aiming and weapon class. Use real authored spatial worlds for walls, stairs, roof edges, hiding and Harbor ladder cases on all eight maps. Test `dt` values 1/120, 1/30 and .25; coordinates stay finite and occupiable, with no ground/roof tunnelling. Ladder speed, jump velocity and gravity match the baseline.

Start `OnlineArena` with real `RoomManager` snapshots after a powered solo round. Assert all powers off and updates rejected; online damage/ammo/position still follow snapshots. Changing room/rematch must not reactivate a stale solo configuration.

- [ ] **Step 2: Run red:** `node --test tests/solo-powers-game.test.js`. Expect the absent methods or actual power-behaviour assertions to fail.
- [ ] **Step 3: Implement the arena hooks.** Reset on entry to every start; normalize/apply the third argument after the local round exists in both ordinary and Zombie start branches, explicitly ignoring it for online. Recheck `progressionSource === 'solo'`, live round and the local player at use sites. Block damage before `damageVitals`; multiply only the local horizontal speed; replenish the active magazine at equipment synchronization and around the existing `tryFire` path without resetting cooldown. Ignore Reload while powered. Preserve grenade, supply, recovery and attack-lock gates. Clear state on `finishRound` after rewards, `quit` and `tryStart` failure; constructor-bypassing headless fixtures must still start all-off safely.
- [ ] **Step 4: Run green:** `node --test tests/solo-powers*.test.js tests/progression-solo.test.js tests/webview-compatibility.test.js tests/loot-solo.test.js tests/supply-solo.test.js tests/headshots.test.js tests/zombie-game.test.js`. Expect zero failures; no shared constants, server logic or DTO field changes.
- [ ] **Step 5: Commit only Task 3 changes:** `feat: apply secret powers only to live solo rounds`.

### Task 4: Touch-safe hidden menu and cancellation

**Files:** Create `src/solo-powers-ui.js`, `tests/solo-powers-ui.test.js`, `tests/helpers/solo-powers-ui.js`; modify `index.html`, `src/styles.css` with narrowly scoped additions.

**Interfaces:**

- `createSoloPowersUI({document, pinGate, getContext, onApply, onOpen, onClose, now}) -> {invalidate({restoreFocus=false} = {}):void, isOpen():boolean, destroy():void}`.
- Consumes Task 1's defaults/normalizer and Task 2's `status()`, `setup(pin, confirmation)`, `verify(pin)` methods. Task 4 does not import `ArenaGame` or `main.js`.
- `getContext() -> {allowed:boolean, origin:'home'|'paused'|null, token:unknown, roundId:object|null, config:PowerConfig}`. Tokens are compared by identity; the bootstrap increments/replaces its screen token on mode changes. `roundId` is the current `game.modeState` for Pause and null for Home. Recheck both token and round identity after an asynchronous operation.
- `onApply(config, capturedContext) -> {ok:boolean, reason?:string}`; `onOpen(capturedContext)` clears gameplay input; `onClose(capturedContext)` never resumes simulation. Defaults are no-op for optional callbacks, not for validation.
- DOM IDs: `home-secret-logo`, `pause-secret-logo`, `solo-powers-screen`, `solo-powers-title`, `solo-powers-status`, `solo-powers-pin-form`, `solo-powers-pin`, `solo-powers-pin-confirm`, `solo-powers-pin-submit`, `solo-powers-controls`, `solo-powers-invincible`, `solo-powers-ammo`, `solo-powers-speed`, `solo-powers-speed-value`, `solo-powers-speed-multiplier`, `solo-powers-apply`, `solo-powers-cancel`. One modal contains gate and controls, never both exposed at once.

- [ ] **Step 1: Write failing controller tests** using a task-specific fixture layered over `InputElement`/`createInputFixture`, not a rewrite of shared fixture behaviour. Test five clicks versus four, timeout at 3,001ms, changed origin/token, rejected contexts, keyboard activation and a single click event per touch. Use deferred fake PIN results to test cancellation, background invalidation, stale round and online replacement. Assert focus trapping, Escape/Back cancellation, Apply validates a copy, and closing clears entered digits/drafts/unlock state without clearing the gate's failure counter.

```js
// Test: fifth activation opens; cancelled asynchronous success stays closed.
for (let i=0; i<4; i++) logo.dispatchEvent(new Event('click'));
assert.equal(ui.isOpen(), false);
logo.dispatchEvent(new Event('click'));
assert.equal(ui.isOpen(), true);
ui.invalidate();
resolvePendingPin({ok:true});
await Promise.resolve();
assert.equal(ui.isOpen(), false);
assert.equal(applied.length, 0);
```

- [ ] **Step 2: Run red:** `node --test tests/solo-powers-ui.test.js`. Expect missing module/selectors or specific state assertions to fail.
- [ ] **Step 3: Implement the controller, logos and modal.** Use `click` for activation counting (do not also count pointer events), `type="password"`/numeric hints for PINs, labelled checkbox switches and the approved slider. The only logo shown on Pause is the solo one; bootstrap eligibility is still authoritative. Provide a 44px minimum target, responsive scrollable panel, keyboard-safe height and fallback-friendly CSS. Masked input must not be copied to status text. Recheck context/generation after every await; clear any UI refresh timer on invalidation/destroy. Avoid adding an unrequested always-visible cheat HUD/banner.
- [ ] **Step 4: Run green:** `node --test tests/solo-powers-ui.test.js tests/solo-powers-pin.test.js tests/inventory-ui.test.js`. Expect zero failures and the existing inventory controls unchanged.
- [ ] **Step 5: Commit Task 4's new files and only its HTML/CSS hunks:** `feat: add hidden Home and Pause power controls`.

### Task 5: Bootstrap wiring, saved progress and ammo presentation

**Files:** Modify `src/main.js`, `src/equipment-ui.js`; create `tests/solo-powers-presentation.test.js`, `tests/helpers/solo-powers-browser.js`, `tests/solo-powers.browser.mjs`. Update only relevant fake contexts in existing HUD tests if genuinely needed; retain their assertions.

**Interfaces:**

- Add optional `isUnlimitedAmmo: () => boolean = () => false` to `EquipmentUI` constructor. It affects gun count labels and Reload availability only, never view DTOs or grenade/supply quantities.
- Bootstrap owns `pendingSoloPowers`, a changing screen token, one instance returned by `createSoloPowersPinGate` and one returned by `createSoloPowersUI`. It consumes the factories from Tasks 2/4 and game methods from Task 3. UI context returns copies, never the mutable pending object. Home Apply replaces pending config; Pause Apply calls `game.setSoloPowers(config, capturedContext.roundId)` after checking the captured screen token as well.
- Browser helper `openPowers(page, {origin='home', pin, firstSetup=false}) -> Promise<void>` uses five real logo taps and masked form inputs. `choosePowers(page, config) -> Promise<void>` changes real switches/slider and presses Apply. Helpers never alter storage or simulation and never log `pin`.

- [ ] **Step 1: Write failing presentation and browser tests.** Verify `isUnlimitedAmmo` yields `∞` only for gun entries and leaves slot ordering, scrolling and grenade/supply numbers intact. Extract/execute the actual `onHud` callback as existing tests do; use `current.getSoloPowers?.()` with a safe all-off absence case so old minimal fixtures remain valid.

```js
// Browser scenario: menu-applied ammo power survives real held fire.
await openPowers(page, {pin:fixturePin, firstSetup:true});
await choosePowers(page, {...defaultSoloPowers(), unlimitedAmmo:true});
await page.locator('#home-solo').click();
assert.equal(await page.locator('#ammo-count').textContent(), '∞');
await page.keyboard.down('KeyF');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyF');
assert.equal(await page.locator('#ammo-count').textContent(), '∞');
```

Add Home prepared selection, changed map/skin/loadout, Pause Apply/Cancel, explicit Resume, cancelled/confirmed Home, replay, native pause, fatal callback, failed online join and delayed gate-result cases. Use persistent real profiles for setup then browser reopen: PIN and earned profile persist, all switches are off. Add dedicated fault-injection browser contexts for absent/throwing crypto and blocked storage, confirming normal solo still starts and plays. Use existing genuine-kill helpers to earn XP/unlock a skin before restart; do not inject XP.

- [ ] **Step 2: Run red:** `node --test tests/solo-powers-presentation.test.js`; build an execution-owned candidate with `GAME_SERVER_URL="" BUILD_DIR="$powers_dist" npm run build`, then `DIST_DIR="$powers_dist" ARTIFACT_DIR="$powers_evidence/browser" node tests/solo-powers.browser.mjs`. Expect absent integration to fail at the actual UI/state assertion. Define these task-specific absolute paths from a new `mktemp -d` directory under `artifacts` before running; do not use a shared `dist` or old preview directory.
- [ ] **Step 3: Wire bootstrap and presentation.** Add gate invalidation to `setMode`, settings/other overlay openings, `suspendForBackground` and fatal stop. Keep the powers modal over the existing Home/Pause mode rather than inventing a playing mode that might advance the simulation. Opening is rejected with a competing overlay active (exclude the origin Pause dialog and the powers modal itself), online connected/busy, hidden/backgrounded or fatal. Clear pending powers on online entry (including failed joins), finish, quit and failed start. Pass the pending copy as the third `tryStart` argument; consume it once. Do not attach it to `settings`. Pause context carries both screen generation and round identity so stale Apply is rejected at bootstrap and game levels.

Keep `onHud`'s recovery/input guards intact; `∞` is presentation only and the ordinary numeric display returns when disabled or online. The inventory callback requires both a live solo context and effective ammo power. Opening settings, another overlay, switching screens or native Back must not expose two active dialogs or auto-resume. Handle modal Escape at capture phase and stop propagation while open so `Input`'s existing window keydown handler cannot also run; cancel to the origin. Android Back already calls `window.pauseGame`, so that path invalidates the modal and clears input without any new native bridge or automatic resume.

- [ ] **Step 4: Run green** with the same unit/browser commands plus `node --test tests/zombie-ui.test.js tests/supply-ui.test.js tests/inventory-ui.test.js tests/progression-solo.test.js`. Confirm raw saved progression/settings/records are not rewritten merely by opening the secret gate, and existing round reward formulas still match the test helpers.
- [ ] **Step 5: Commit only Task 5 changes:** `feat: connect secret powers to solo sessions and HUD`.

### Task 6: Full browser, layout, movement and online acceptance

**Files:** Extend `tests/solo-powers.browser.mjs`; create `tests/solo-powers-layout.browser.mjs`, `tests/solo-powers-online.browser.mjs`; modify `package.json`, `package-lock.json`, `android/app/build.gradle` and the visible version label in `index.html` only for the intended candidate identity. Add evidence to `docs/releases/2026-10-12-solo-secret-powers-verification.md`.

**Interfaces:** New browser scripts accept `DIST_DIR`, `ARTIFACT_DIR` and `LEGACY_WEBVIEW=1`; use isolated fixtures. Add `test:solo-powers` running all three scripts. Candidate identity is package version `0.9.1`, Android code `12`, name `0.9.1`, visible footer `v0.9.1 SOLO POWERS`; network protocol remains unchanged. If another release has advanced these fields at execution time, stop to reconcile identity rather than downgrading it.

- [ ] **Step 1: Write the acceptance scenarios before any needed adjustments.** Run every map with powers enabled and disabled across representative bot/team/Zombie rounds, covering all four modes. Use real controls plus passive `observeGame`/socket readings, not teleports/resource grants. Measure 2x and 5x displacement in clear routes against simulation time; also traverse at 5x into walls/edges and Harbor ladder approaches. Add paired normal/5x frame measurements with identical settings on the same runner and report median/p95. Use three warmed 30-second trials in Courtyard and Harbor; investigate a median paired p95 ratio above 1.25 instead of silently changing speed or raising an acceptance threshold. Physical BYD performance remains a separate check.

Layout assertions cover 1280x720, 1024x600, 854x480 and a keyboard-reduced 854x300 viewport, control scales .8/1.3, modern/legacy masks, both PIN and controls panels: buttons at least 44px, all controls reachable by scrolling/focus, no background activation. Test five actual taps, tab wrapping and slider touch movement; screenshots must not expose PIN text.

Online assertions use two independent real browsers after one has used all powers. Join/start/rematch/leave/reconnect, observe normal ammo decrement, actual incoming damage and authoritative movement, and assert no PIN/power fields in sent or received packets. The pause logo is absent/ineligible online and return to solo starts all-off. Include full persistent-browser reopening at the same origin and a second-origin separation check. Complete a real assisted Zombie wave and confirm both ordinary best record and the normal XP formula are saved.

Representative named assertions (measure values from the real control routes and passive observations described above):

```js
// Scenario: high-speed clear-route displacement follows simulation time.
assert.ok(Math.abs(poweredDistance / poweredSeconds / (normalDistance / normalSeconds) - 5) < 0.5);
// Scenario: online pause has no secret access after a powered solo match.
assert.equal(await onlinePage.locator('#pause-secret-logo').isVisible(), false);
// Scenario: keyboard-reduced modal keeps Apply reachable by scrolling.
await page.locator('#solo-powers-apply').scrollIntoViewIfNeeded();
assert.ok((await page.locator('#solo-powers-apply').boundingBox()).height >= 44);
```

- [ ] **Step 2: Run new scenarios against the current candidate.** Record failures with screenshots/observations. Tests that already pass are useful acceptance coverage, not a fabricated red cycle. Any production fix requires a reproducible failure before the fix.
- [ ] **Step 3: Apply only demonstrated feature fixes and the candidate identity/test-script changes.** Do not replace existing test expectations to hide regressions, lower speed or suppress XP/records. Keep lockfile dependency versions untouched. Build a new unique candidate directory after the final metadata change; record source and all four asset hashes so APK packaging uses these same bytes.
- [ ] **Step 4: Verify the final candidate:**

```bash
npm test
GAME_SERVER_URL="" BUILD_DIR="$powers_dist" npm run build
DIST_DIR="$powers_dist" ARTIFACT_DIR="$powers_evidence/modern" npm run test:solo-powers
DIST_DIR="$powers_dist" ARTIFACT_DIR="$powers_evidence/legacy" LEGACY_WEBVIEW=1 npm run test:solo-powers
DIST_DIR="$powers_dist" npm run test:touch
DIST_DIR="$powers_dist" npm run test:webview
DIST_DIR="$powers_dist" npm run test:inventory
DIST_DIR="$powers_dist" npm run test:zombies
DIST_DIR="$powers_dist" npm run test:supplies
DIST_DIR="$powers_dist" npm run test:progression
DIST_DIR="$powers_dist" npm run test:progression:modes
DIST_DIR="$powers_dist" npm run test:progression:online
DIST_DIR="$powers_dist" npm run test:teammate-map
DIST_DIR="$powers_dist" npm run test:tall-roofs
DIST_DIR="$powers_dist" npm run test:tall-roofs:online
git diff --check
```

Expect exit zero, no runtime/asset errors and each acceptance assertion satisfied. Assign the scripts' existing artifact-directory overrides to new execution-owned paths where supported. Historical `test:traversal:performance` pins old 0.8/0.9 baselines; do not relabel its result as a 0.9.1 comparison. The new paired measurements supply this feature's performance evidence. Run heavyweight suites serially or with controlled concurrency so competing renderers do not invalidate measurements.

- [ ] **Step 5: Commit feature tests, metadata hunks and actual evidence:** `test: verify solo powers and online isolation`. Record test counts/output paths and unresolved limitations honestly; do not claim native or physical-BYD acceptance here.

### Task 7: Exact APK packaging, save-retaining native check and handoff

**Files:** Modify `android/tests/package-smoke.mjs`; create `android/tests/solo-powers-smoke.mjs`; extend the verification document. Reuse `android/tests/helpers/progression-native.js` without overwriting its current dirty improvements.

**Interfaces:**

- Add explicit `ANDROID_PACKAGE_RELEASE=solo-powers` selection to the package smoke script, with expected 0.9.1/code12/footer from Task 6. Preserve the historical default tall-roofs and `ANDROID_PACKAGE_BASELINE=1` paths/expectations; reject conflicting selectors or unknown release names. Do not infer the expected version or signer from the tested APK.
- New native script requires `ANDROID_TEST_SERIAL=emulator-N`, matching `ANDROID_TEST_AVD`, `ANDROID_APK_PATH`, `ANDROID_TEST_ARTIFACTS` and `ANDROID_BASELINE_APK_PATH` (retained 0.9.0/code11). Use `nativeProgressionFixture`; do not reinterpret old `ANDROID_RESUME_CODE11` flags as this feature's acceptance.

- [ ] **Step 1: Write candidate-package and native assertions.** The retained 0.9.0 APK must fail the explicit solo-powers metadata check. Native upgrade test starts on a separately owned disposable AVD with the retained baseline, earns real XP and saves selection/settings, then captures exact relevant save values. It upgrades with `install -r` to code12, verifies preservation, sets a fixture PIN via controls, uses the powers, earns additional XP/records, relaunches and checks PIN retention with powers off. Reinstall the same candidate with `-r` and verify PIN/progress again. Test native pause/Resume, actual offline PBKDF2, three powers, a real Zombie encounter and 5x collision movement. Never write profile/XP/PIN records directly to make the scenario pass.

```js
// Native scenario: explicit version and exact save preservation at upgrade.
assert.deepEqual(await f.version(), {code:12, name:'0.9.1'});
assert.deepEqual(afterUpgradeSave, beforeUpgradeSave);
// afterUpgradeSave/beforeUpgradeSave are read-only captures of the same keys,
// taken before any new gameplay or first PIN setup changes them.
```

- [ ] **Step 2: Run red checks on the explicitly selected old artifact/device.** Expect wrong version or absent menu, not a disconnected device or wrong AVD. Confirm baseline identity before any device mutation; no existing user device or save may be cleared/uninstalled.
- [ ] **Step 3: Implement only the new test/release-selection logic and any separately reproduced feature fixes.** Freeze an explicit source allowlist into a fresh execution-owned packaging directory: package manifests, index, src, server, scripts, Android source/build files and required test helpers. Include the approved dirty teammate-map code in that snapshot, exclude credentials/config caches/generated Android build directories, and record file hashes. `build-apk.sh` mutates Android assets/build directories, so invoke it from this snapshot, not a shared or historical release source. Use the already verified Task 6 asset directory; do not run `npm run apk` or rebuild different web assets during packaging.
- [ ] **Step 4: Run package/native verification using validated absolute paths:**

```bash
DIST_DIR="$powers_dist" APK_OUTPUT_PATH="$powers_apk" bash scripts/build-apk.sh --offline lintDebug
DIST_DIR="$powers_dist" ANDROID_APK_PATH="$powers_apk" ANDROID_PACKAGE_RELEASE=solo-powers node android/tests/package-smoke.mjs
ANDROID_TEST_SERIAL="$powers_serial" ANDROID_TEST_AVD="$powers_avd" ANDROID_APK_PATH="$powers_apk" ANDROID_BASELINE_APK_PATH="$powers_baseline_apk" ANDROID_TEST_ARTIFACTS="$powers_evidence/android" node android/tests/solo-powers-smoke.mjs
```

The first two commands run from the packaging snapshot; all variables name task-owned or inspected retained paths. Verify all four bundled assets byte-for-byte, existing signer, package/minSdk/targetSdk, INTERNET-only permissions and no native ABI restriction. Verify old packaging selectors still validate their own retained releases. Never stop other emulators, remove unrelated forwards or restart shared servers during cleanup. Document the new APK path and SHA-256, tested source/asset hashes and exact environment.

If the SDK, owned AVD, real device or an unrelated baseline failure prevents a check, report that check as incomplete; do not weaken save assertions or claim the APK is BYD-tested. Physical head-unit verification requires the user's available BYD and separate evidence of Web Crypto, touch and 5x performance. A working browser preview can be handed off separately with that limitation.

- [ ] **Step 5: Commit only native test/evidence changes:** `test: package and verify solo powers candidate`. Run the selected workflow's whole-change review against the recorded execution baseline and the actual tested working-tree snapshot, including its retained teammate-map dependency, not just HEAD. Address findings with reproducing tests and rerun affected verification. Only then hand over the isolated browser candidate and APK, clearly distinguishing browser, emulator and actual-BYD results. Do not publish/restart the live game automatically.

## Plan self-review and approval handoff

Self-review must map every spec section to these tasks, check method/field/selector consistency, include all five Review Focus cases and remove placeholders or commands for nonexistent files. The plan author performs this check; do not outsource it as a separate review task.

Author's coverage check: configuration/ammo invariants -> Task 1; PIN persistence/failure boundary -> Task 2; all three powers and round reset/online rejection -> Task 3; gesture/dialog/async cancellation -> Task 4; Home/Pause integration and presentation/save continuity -> Task 5; all-map/browser/online/layout/performance acceptance -> Task 6; exact APK, migration and truthful device handoff -> Task 7. All five Review Focus items have explicit test owners above. Existing test paths and npm scripts were checked locally; new test files/commands are labelled as future deliverables. This is a plan review, not a claim of implementation or passing gameplay tests.

After this document is reviewed by the user, choose one execution method:

1. **Native, recommended for this plan:** the main agent implements the seven tasks in this session, then a fresh independent reviewer checks the whole change. The game, lifecycle and modal work share tightly coupled interfaces, so this avoids repeated context handoffs while retaining final review.
2. **Subagent-driven:** fresh task implementers and reviewers validate each task, followed by whole-change review. This adds earlier independent checks and more handoff overhead.

No implementation begins until the user has reviewed this written plan and selected the method. The existing custom-match-rules discussion remains pending after this feature; it is not silently completed by this plan.
