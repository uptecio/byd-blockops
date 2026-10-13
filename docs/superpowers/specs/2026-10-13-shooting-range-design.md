# Solo shooting range

Date: 2026-10-13

Status: gameplay choices agreed in conversation; written specification awaiting user review. This document is not an implementation or a live update.

Baseline: the current `feat/offline-arena` checkout, including the existing Minigun and teammate-map changes. Preserve unrelated work, player saves, release artifacts and running games. This specification does not authorize a public deployment or server restart.

## Intent and agreed choices

Give the player a relaxed, offline place to practise aiming and try every gun, while earning real saved XP and using the existing secret-code powers.

- A **Shooting Range** button on Home opens a separate solo practice map.
- Stationary blocky dummies and flat bullseye targets are available at close, medium and far distances.
- Destroyed targets return after **five seconds**.
- All **29 guns**, including the Minigun, are available through Loadout.
- Spare ammunition is unlimited, but magazines and reloading work normally unless the unlimited-ammo cheat is enabled.
- Show damage numbers, headshot feedback and an accuracy counter.
- Use the existing walking, jumping, aiming, firing and touch controls. There are no attacking enemies and no round timer.
- A normal target kill earns **10 XP**. A headshot kill or bullseye-centre kill earns **20 XP total**, not 10 plus 20.
- XP and legitimately unlocked cosmetics save through the existing progression system, including when cheats are active.
- The existing PIN-gated invincibility, unlimited ammunition without reloading, and 2x–5x super speed work in the range. Keep their current access and reset rules.

The user's later XP-and-cheats choices replace the earlier no-XP proposal. Do not suppress practice rewards or assisted rewards as an anti-farming measure.

## Scope and approach

Use a dedicated practice runtime with small integration points into the existing world renderer, player controls, weapon handling and progression system. This preserves real gun behaviour without disguising the range as an ordinary Free For All match. A separate duplicated game would risk divergent controls and gun balance; adding practice targets directly to normal maps would blur the requested separate practice experience.

Keep the practice map and session type out of public map/mode selectors and multiplayer configuration. Normal matches retain their existing eight maps, online modes, finite ammo rules and rewards.

The following defaults complete the design and are subject to approval with this document:

- Six targets: one dummy and one bullseye in each of three clearly labelled distance areas.
- Targets have 100 health. Each visit begins with full-health targets and zero session statistics.
- Accuracy measures fired shots that hit an active target, not pellet count.
- Target respawn uses five seconds of active simulation time; menus and background pauses stop that clock.
- Practice gun selection is temporary. Returning Home restores the previous normal-match map, mode and gun selection.

Moving targets, timed challenges, multiplayer practice, leaderboards, weapon racks, grenade practice, new cheats and new generated art are outside this first version. The separately requested temporary all-skins PIN unlock remains pending; “existing cheats” does not silently implement that feature. Cosmetics genuinely earned through range XP remain permanently earned under the ordinary save rules.

## Player experience

### Enter, practise and leave

Home gains a touch-friendly Shooting Range action without changing the selected normal map or mode. Enter only from a safe Home state with no online connection or join in progress. Start with the player's normal selected gun and current earned skin/finish. Any powers prepared through the existing Home PIN menu transfer to this new solo session as they do for a normal solo match.

The practice arena uses the game's blocky style: a flat walkable area, safe boundaries, clear distance labels, target stands and a backdrop that makes hits easy to see. Players can walk between areas and jump. No new climbing, hiding or traversal subsystem is needed.

Replace the normal round score/timer presentation with **Shooting Range**, session target kills, accuracy and session XP. Show accuracy as `0% (0/0)` before the first shot. Keep Home, Loadout and Pause reachable, and preserve the existing gun/ammo presentation. Do not show a teammate-map action in this solo practice session. Reuse the existing XP/unlock notifications and save-status presentation.

Loadout offers all guns from the real weapon catalogue. Switching is unlimited, including switching back to the starting gun; the normal loot rule that removes a replaced starter gun must not block this. Retain each practice gun's current magazine during switches, initialize newly selected guns with a full magazine, and cancel an unfinished reload when switching. Loadout does not write practice gun choices into normal-match settings.

Pause, Loadout and background transitions stop simulation and clear held movement/fire inputs. Resume is explicit. Confirmed Home departure disposes of the practice session, resets active/pending powers under the existing rules and keeps already-earned XP. There is no completion or victory bonus. Starting another range visit resets targets and session statistics, not lifetime progression.

### Targets, damage and feedback

Use actual weapon timing, spread, pellets, recoil, aiming, range and body-damage falloff. Do not tune shared gun definitions to make the range easier. A dummy's head uses the existing headshot boundary from `src/gun-damage.js`; its body uses ordinary damage. The visibly marked central square of a bullseye is its precision region; other hittable parts are ordinary body hits. Align rendered regions with tested hit regions, including their edges.

Both precision regions use the existing 10,000,000,000 headshot damage. Show a compact label such as `10B` and **HEADSHOT**, with centre hits also visibly identifiable. Damage labels are brief and bounded in number so sustained Minigun fire cannot accumulate unbounded UI work.

For each bullet/pellet ray, only the nearest unobstructed valid hit receives damage. Walls/backstops block shots. An alive target becomes destroyed once, becomes unhittable, then returns to full health after five active simulation seconds with a new life identity. Hitting an already destroyed target grants no damage, accuracy hit or XP. Leaving the range invalidates all remaining target callbacks and timers.

Accuracy is `shots hitting at least one active target / shots fired`. Each fired automatic bullet counts as a shot; each shotgun shell counts as one shot even when several pellets hit. A shot may hit multiple distinct targets without increasing the accuracy numerator more than once. Empty trigger pulls and reload inputs are not shots. Accuracy can never exceed 100%.

### Ammunition and powers

Without the ammo cheat, every gun consumes its magazine normally and takes its real reload duration. Refill spare ammunition locally as needed so it never runs out; show an infinity reserve indicator in practice. Keep magazines and internal equipment values finite and valid. Do not store numeric `Infinity` or practice-only fields in shared inventory DTOs or network messages.

With the existing unlimited-ammo cheat enabled, retain its current no-reload behaviour, finite equipment-state handling and normal fire rate. Turning it off returns to the range's unlimited-reserve, normal-reload rule. Other modes retain their existing finite ammunition behaviour when the cheat is off.

Invincibility remains available even though the targets do not attack. Super speed retains collision, boundaries, jump/gravity rules and its normal 2x–5x range. Powers do not increase XP rates. The Home/Pause logo gesture, saved PIN, stale-verification guards, storage/crypto failure behaviour and reset lifecycle remain unchanged. Ordinary range play must still work when the PIN menu is unavailable.

## Saved XP and duplicate protection

Determine the reward from the hit that destroys the target:

| Destruction event | XP |
| --- | ---: |
| Dummy body or non-centre bullseye killing hit | 10 |
| Dummy head or bullseye-centre killing hit | 20 total |
| Miss, nonlethal hit or hit on an already destroyed target | 0 |

Mixed hits use the killing hit, not an earlier body hit. If one shotgun shell destroys multiple distinct targets, each target life can award once; repeated pellets cannot award the same life twice. The player can earn the reward again after a genuine respawn.

Use a separate, strictly validated local range tally containing `targetKills`, `precisionKills` and `earnedTotal`. Precision kills are a subset of target kills, and the cumulative total is `10 * targetKills + 10 * precisionKills`, saturated at the existing maximum XP. Counts are bounded nonnegative integers and `precisionKills <= targetKills`. Do not represent a headshot as two ordinary eliminations, fabricate wins or modify the existing normal-mode tally schema.

Each visit gets a unique local run receipt using the existing solo receipt format; never reactivate an old visit's key after leaving. The trusted target alive-to-destroyed transition emits one reward per target/life identity. Carry the killing hit's explicit body/head/centre classification through damage resolution, rather than trying to recover it from a damage number afterward. Feed cumulative validated totals through the existing local progression controller/session and profile-store credit path. Adapt the local session's tally initialization/validation for range runs while preserving monotonicity, receipt deduplication and rejection of stale/closed sessions. Rendering and UI callbacks cannot award XP.

Persist earned XP as it is credited, not only on Home or exit. Reloading must neither replay awards nor erase saved rewards. Reuse current rank thresholds, cosmetic unlocks, profile backups, recovery and retry behaviour. Do not change the strict profile schema or add powers/target state to it. Session accuracy and target state need not survive an app restart.

Show actual storage failure through the existing save-status path; do not promise persistence when storage is denied. XP remains local to the installation/browser origin, without adding account sync between browser and APK.

## Module boundaries and integration

These are focused boundaries for the implementation plan, not a request for a general game-framework refactor:

- **Range rules module:** pure target health/life state, hit classification, shot-level accuracy, five-second respawn and reward events. A small interface for advancing time and resolving shots hides these rules; tests need no renderer or browser.
- **Range map/rendering adapter:** a private map definition plus procedural targets and damage feedback. Reuse a narrow render-from-definition seam in `src/world.js`; keep public `createWorld(mapId)` and the public map catalogue working as before.
- **Range runtime:** owns this visit's world, target lifecycle and practice-only gun state, and connects real player movement/firing to the rules module. Keep integration in `src/game.js` limited to session lifecycle and required shot/update hooks. Do not spawn bots, normal loot, match objectives or a countdown. Dispose resources/listeners on exit or failed start.
- **Local progression adapter:** handles range tally construction/validation and target-life deduplication, then reuses `src/progression-session.js`, `src/progression-controller.js` and `src/profile-store.js` for credit/save/notifications. Existing mode tallies and online receipt validation stay strict and unchanged.
- **Home and HUD integration:** `src/home-ui.js`/`src/main.js` open practice, show its session label/stats and all-gun Loadout, restore normal selections, and connect existing pause/powers controls. Practice session configuration is not passed through normal selection persistence.

Keep range eligibility explicitly solo at the runtime boundary. `OnlineArena` shares parts of the game implementation, so hiding a Home button is not sufficient isolation. A range session/configuration cannot be started through the online source or included in room messages. No network protocol change is required if the existing wire formats remain unchanged.

Startup errors must dispose partial resources, stop the local progression participation and restore a usable Home screen without altering saved XP or normal selection. Background/resume must not simulate missed wall-clock time, award phantom hits or carry firing input into another screen.

## Acceptance and verification

The following are required checks for implementation, not tests already run:

- Unit tests cover target hit boundaries, ordinary/precision damage, one award per life, multi-pellet kills, stale events, finite counters, 10/20 XP totals and maximum-XP handling.
- Respawn tests prove a target is unavailable before five active seconds, returns at five seconds, and does not advance while paused or after disposal.
- Accuracy tests cover misses, automatic fire, multiple pellets and multiple target hits, always bounded at 100%.
- Ammo/Loadout tests cover all 29 guns, including sustained Minigun fire, reload durations, switches back to the starter, normal reload versus no-reload cheat, and finite equipment invariants.
- Progression tests cover actual kills, duplicate callbacks/receipts, real save/reopen, unlock thresholds, storage failures and no exit/completion bonus. Normal-mode/online progression tests remain passing.
- Real browser interaction covers Home entry, walking/jumping, firing at both target types, body/head/centre XP, Loadout, damage/accuracy UI, Pause/Home, backgrounding, repeated visits and restoring normal selections. Verify XP after a real reload rather than injecting saved XP to satisfy the test.
- Existing PIN/powers browser checks include valid/wrong PIN, stale async results, assisted XP, super speed collisions, ammo toggle during reload and powers reset on leaving/restarting. Use disposable test PINs, never log the user's PIN.
- Run modern and legacy-compatibility browser checks, including compact 854x480 and 1024x600 landscape layouts, real touch controls and runtime-error capture. Keep feedback bounded under sustained Minigun fire.
- Run the full existing unit suite and relevant equipment, progression, Zombies, traversal, teammate-map and two-player online regressions. Online maps/modes, damage, ammo, room receipts and protocol remain unchanged.
- For delivery, build a separately named browser/APK candidate from the same tested source/assets, verify APK packaging and same-signature upgrade/save retention, and test offline startup/practice in the available Android environment. A modern emulator or browser does not prove physical BYD compatibility; report that device check separately.

Use isolated test profiles and servers. Do not overwrite release artifacts, delete app data or interrupt live rooms to run tests. Publishing remains a separate authorized step.

## Review and handoff

Only this design document is produced at this stage. After the user approves the written specification, prepare the implementation plan for review and execution-method selection. The shooting range, XP additions and browser/APK update are not implemented by approving the gameplay choices or writing this file.
