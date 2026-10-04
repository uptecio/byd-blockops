# Block Ops solo zombie survival design

Add an offline Zombie Survival mode to Block Ops. Play alone on any existing map, collect and switch weapons using the current inventory, clear increasingly large zombie waves, recover between waves, and survive until death. Keep existing solo bot matches and online multiplayer working as they do now.

The user approved the gameplay summary, this written specification and its implementation plan on 2026-10-04, choosing Native execution. Details labelled Proposed are the initial design and playtest defaults included in that approval. Implementation progress is recorded separately; this design is not a release claim.

Approved balance amendment (0.5.1): both zombie types now deal `10 + 5 × (wave − 1)` damage per successful hit, without a cap. The user confirmed the resulting one-hit kill from full health at wave 19. Movement speed, attack intervals and all other rules stay unchanged; this supersedes the original fixed 20/15 damage values.

## Approved gameplay

- Endless waves, with no three-minute limit or final victory wave.
- All eight current maps, the selected player skin, and the chosen starting gun.
- Five walkers in wave 1; later waves add more enemies. Runners appear from wave 3.
- Zombies chase and slash the player. They do not shoot guns.
- A ten-second recovery break between waves restores full health and refills every owned gun to 500 total rounds, including its magazine.
- Collected guns, knife and grenades remain owned between waves. Keep the numbered top-left inventory and current touchscreen controls.
- Preserve instant-kill gun headshots, including the existing exact damage value of 10000000000.
- Player death ends the run without respawning. Results show waves survived and zombie kills.
- This update adds solo zombies only. Existing multiplayer rules remain unchanged.

## Proposed player flow

Add a Zombie Survival card to the Home game-mode choices, labelled Solo only and Endless waves. Selecting it keeps the current map, skin and weapon choices. The Solo button becomes Play Zombies. Deploying from Home or the Armory starts the same zombie run.

The core loop is move and collect loot, aim and fight, clear a wave, recover and prepare, then face a larger wave. Use the game-design principles of early wins and recovery time between intense fights. No purchases, accounts, external downloads or new input gestures are required.

Show the current wave and enemies remaining during combat. Remaining means enemies alive plus enemies still waiting to spawn, so a wave cannot appear finished while reinforcements are queued. During recovery show Next wave in 10 and the countdown. Replace the normal match score target and three-minute timer; do not add a second inventory screen or cover the existing top-left inventory.

Results show fully completed waves, total zombie kills and the best completed-wave record for that map. Death during wave 1 means zero completed waves. A tie on completed waves uses kills as the best-record tiebreaker. Update the local record after each completed wave and when a run ends by death or confirmed return Home. Unavailable or corrupt storage must not prevent play. There is no saved in-progress run after an app restart.

Play Again starts a clean run at wave 1 with the current starting selection. Returning Home uses the existing end-round confirmation. Cancelling that confirmation preserves the run. Pause, Loadout, settings, Android Back and backgrounding retain the existing solo pause and explicit-resume behaviour.

## Proposed wave rules

Use one authoritative survival state with fighting, recovery and ended phases. Wave 1 starts in fighting; the first zombie can spawn immediately, then further zombies arrive at one-second intervals.

For wave number n, the total is 5 + 2 × (n − 1). Waves 1 and 2 contain only walkers. From wave 3, the runner fraction is min(0.5, 0.25 + 0.025 × (n − 3)); the runner count is floor(total × fraction), with the rest walkers. Interleave runners through the spawn queue rather than spawning all of them together.

Limit living zombies to eight at once. A large wave uses a numeric queue and staggered reinforcements, not a large collection of inactive models. The wave number and total can keep increasing without retaining all previous enemies. These limits control scene and navigation work; actual BYD frame rate still requires device testing.

A wave is complete only when its spawn queue is empty and all its spawned zombies are dead. Award one completed wave and start one ten-second recovery break. Repeated death notifications cannot award extra kills, clear a wave twice or start multiple breaks. Survival time, spawning and countdowns advance only with active simulation, never wall-clock timers.

Entering recovery removes remaining transient combat effects and performs healing and ammo restoration once. The player can move, collect loot, switch equipment and use menus during the break; firing, slashing and throwing are disabled until the next wave. Map-loot respawn timers continue during an unpaused break. The next wave begins when the countdown reaches zero, retaining the player's position and equipment.

If player death and the final zombie death occur in one simulation step, player death takes priority over recovery: never revive a dead player by awarding a wave refill. End the run once and stop further damage, pickups, spawning and scoring.

## Proposed zombies and combat

Use these initial balance values, separate from ordinary bot difficulty settings:

| Type | Health | Movement speed in game units per second | Slash damage | Minimum interval between hits |
| --- | --- | --- | --- | --- |
| Walker | 100 | 2.1 | 10 + 5 × (wave − 1) | 1.2 seconds |
| Runner | 100 | 3.4 | 10 + 5 × (wave − 1) | 0.9 seconds |

Zombie health stays at 100; challenge grows through wave size, the runner mixture and uncapped per-hit damage. A valid headshot stays lethal. Preserve all existing player gun, knife and grenade damage. In particular, a knife still deals 50 and an explosive grenade still deals at most 90; do not silently strengthen grenades for this mode.

Zombies target only the human. They do not fight each other, collect loot, carry inventory, create gun death drops or respawn after death. New spawn identities must not reuse a dead enemy's identity during the run. Use zombie-specific slash timers and damage, not the player's equipment-dependent knife action.

Validate slashes using the existing melee contact rules: face the player, check the 1.8-unit three-dimensional reach, aim cone/body contact and solid cover. Respect the player's normal initial spawn protection. No damage through walls or from dead, blinded or inactive zombies. Validate after movement using current actor positions. Avoid overlapping attack bursts from a newly created enemy by applying its normal attack interval before its first possible hit.

Reuse the navigation grid and collision-safe movement with the existing zombie/bot radius of 0.4 and player radius of 0.34. Recalculate routes at a throttled interval, including failed routes. Use the approach-to-smaller-actor navigation path so players standing legally close to walls remain reachable; strict reachability to the player's centre alone is not sufficient.

Zombies ordinarily pursue the player's current position through navigable routes, even when solid cover requires a detour. Smoke interrupts that tracking: hold the last unconcealed pursuit position, move towards it and wait there instead of tracking concealed movement. Do not slash through smoke. If there is no remembered position, wait until concealment clears. Use consistent 1.6-unit sight-height checks for smoke. Flash grenades freeze a zombie's movement and attacks for the existing calculated effect duration, at most three seconds; reacquire the player afterwards.

Spawns use the map's authored spawn locations. A candidate must be inside map bounds, clear of solids, at least eight units from the player, at least 0.8 units from every living zombie and have a valid approach route towards the player. Prefer candidates outside the camera's view when otherwise valid. If none qualify, retry after one simulation second without spending a queued enemy or relaxing collision and distance rules. Test these constraints on every map.

Use a small deterministic separation adjustment between nearby zombies, followed by normal world-collision validation, to reduce crowd stacking. It must not push the player, move enemies through walls or introduce a new general physics engine. A zombie unable to advance retries its route; it never teleports onto the player or scores an automatic kill.

## Proposed equipment recovery

Refill each gun already in the owned Map to its normal magazine size plus enough reserve to total 500. Clear its reload and fire-cooldown timers. Preserve ownership order, active gun, held knife or gun, knife ownership, grenade counts, selected grenade and the starting-gun-removal flag. Reset transient attack timers, not the inventory.

Do not call resetEquipment for a wave change: that existing function clears collected gear. Refilling does not grant a missing gun, restore a removed starter or supply free knives and grenades. The existing rule still removes the original starter on the first actual switch to a different gun; the removed starter remains available from map loot. Duplicate owned-gun pickups remain on the ground as today.

Reuse the current spaced-out map loot, automatic pickup rules, grenade capacity and Armory behaviour. Only the human collects loot in this mode. Picking something up does not automatically equip it. Each new run creates fresh map loot; changing waves does not reroll or duplicate loot locations.

## Proposed visuals and audio

Create original, lightweight blocky zombie models directly in the existing Three.js style. Walkers have green skin and a worn dark outfit; runners have a distinct warmer outfit accent and faster movement. Both use cube heads, block limbs, simple faces and an unarmed reaching pose. Do not change the player's existing skins or copy artwork from another game.

Align the visible head and body with the existing hitbox dimensions and the strict headshot threshold above feet height plus 1.48 units. Keep health indicators and existing smoke/flash visibility rules. Zombie rendering must not assume the normal armed-avatar weapon attachment exists.

Use small procedural walk/slash motions, existing hit and kill feedback, and short synthesized wave-start and recovery cues under the current sound setting. No gore, downloaded art, paid generation, new rendering library or WebGL version upgrade is needed. Release removed enemy geometry and materials promptly, with bounded effects throughout a long run.

## Proposed technical boundaries

Keep the existing renderer, touch input, world maps, collision, weapons, equipment, loot and grenade simulation. Introduce small solo-specific modules rather than adding wave state to the online protocol or turning ordinary FFA into an untimed match.

| Responsibility | Boundary and integration |
| --- | --- |
| Mode metadata | A solo-mode catalog combines the existing three modes with zombies for Home and shared presentation. Keep src/modes.js and its server-facing validation restricted to existing modes. |
| Survival rules | A pure zombie-survival module owns phase, wave, queued count, active enemy identities, completed waves, kills and countdown. It has no DOM, renderer or network dependencies. |
| Zombie decisions | A zombie-brain module owns target memory, throttled pursuit, spawn eligibility, separation and slash eligibility using existing navigation/collision helpers. |
| Zombie presentation | A zombie-avatar module creates and animates the bounded block models, without player-skin catalog or armed-avatar changes. |
| Runtime adapter | A focused zombie-runtime module connects rule events to enemy entities, recovery, combat and cleanup. src/game.js delegates solo-zombie lifecycle work to it while preserving the ordinary bot path. |
| UI and local record | src/home-ui.js, src/main.js, src/match-ui.js, index.html and src/styles.css display the new selection, wave HUD and results. Local best-record persistence tolerates storage failure. |

The game adapter exposes the same public start, pause, resume, quit, equipment-view and match-view entry points used by the existing UI. Its per-run identity remains stable through wave changes so stale menu actions cannot affect a different run. A zombie view carries explicit wave and phase fields; do not pass Infinity through the ordinary time-left formatter or invent a three-minute countdown.

Input advances movement and player equipment through the existing bounded simulation steps. Player gunfire, knife and grenade hits use one damage/elimination path that delegates zombie deaths to survival rules. The runtime removes dead enemies only at safe iteration boundaries, then reconciles wave transitions once. It exposes live entities to existing hitscan and grenade helpers without manufacturing owned guns for zombies. Branch armed-avatar equipment rendering and human-only loot collection explicitly.

Keep only current enemy entities and bounded identity tracking; do not accumulate ordinary-mode participant statistics, eliminated-life histories or target-memory entries for every zombie ever spawned. New-run, quit, map change and transition back to normal solo or online must clear zombie state, models, queued events and transient effects. Restore ordinary UI labels and controls when leaving the mode.

Ordinary FFA, TDM and CTF still use the existing mode state, timers, team checks, respawns and server messages. Do not widen server validators to accept zombies. The online selector continues to list only the three supported online modes. When creating an online room from a Home selection of Zombies, show an explicit message that online uses Free For All and send ffa, preserving map, skin and gun choices. Joining an existing room uses that room's mode as usual. Never send zombies as a room configuration, and do not change the wire protocol.

## Compatibility and error handling

Preserve the ES2017 build target, pinned Three.js version, WebGL1 support, legacy DOM operations and physical CSS fallback rules added for the BYD WebView. Avoid Object.hasOwn, Element.replaceChildren and unguarded newer APIs. No Android permission or vehicle-behaviour changes are included.

Invalid frame durations do not advance survival. Missing safe spawn positions cause a bounded retry, not a freeze, recursive search or invalid enemy position. Invalid stored best records fall back to zero. Duplicate/stale enemy damage is ignored. Existing fatal-error handling remains active for genuine initialization or graphics failures and must still provide a usable Reload action.

## Verification and release requirements

Implement with tests first after specification and plan approval. Required coverage includes:

- Pure wave rules: five initial walkers; exact growth and runner counts; no runners before wave 3; eight-alive cap; failed spawn retry; queued plus alive completion; ten-second recovery; pause; duplicate deaths; terminal player death and simultaneous-death ordering.
- Recovery: exactly 500 total rounds for every owned gun with normal magazine sizes; no ownership loss or additions; retained knife/grenades/active selection; removed starter stays removed; refill happens once.
- Production headless game: real gun, knife and grenade damage; exact headshots; walls and protected targets; smoke memory; flash pause; no zombie loot collection, guns, drops or respawns; continued play past 180 seconds.
- All eight maps: valid distant spawns, approach routes when the player touches cover, collision-safe pursuit and a completed wave. Long-run checks verify bounded models, identity tracking and effects.
- Lifecycle: death/results, replay, Home confirmation and cancellation, Armory, settings, background/foreground, and switching between zombies and existing solo/online modes without stale input or state.
- Browser automation using the installed Playwright CLI as well as repository tests: select and start zombies, collect loot, use numbered slots, kill enemies, enter recovery, resume, die and replay. Check touch layouts at 854 by 480, 1200 by 700 and 1280 by 720, including large controls and legacy CSS/API profiles. Inspect screenshots and console errors.
- Full existing unit and relevant browser regression suites, plus a two-client online smoke test. Online mode choices and server rejection of zombies remain intact.
- APK packaging from the verified candidate assets, version/hash recording and offline Android emulator launch. Physical BYD smoothness and rendering remain unverified until a device test; emulator and browser simulation do not establish that result.

Prepare the tested browser candidate and updated APK together, including the already-released loot inventory. Keep previous APKs and browser snapshots available for rollback. Do not replace the public server until verification passes and its rooms are empty; do not disconnect players. Publish the browser update through the existing hosting path, verify served bytes/version and a real round, then provide the new APK path and hash. No release, server restart or APK build occurs during this design-review stage.

## Explicit exclusions

No online co-op zombies, bosses, new maps, defence objectives, shops, health/armour pickups, weapon progression, achievements, skin unlocks, difficulty menu, changes to driving restrictions or unrelated refactoring. Existing bot-count and bot-difficulty settings remain for ordinary solo bots and are labelled as not applying to Zombies; this first zombie release uses the single tuning set above.
