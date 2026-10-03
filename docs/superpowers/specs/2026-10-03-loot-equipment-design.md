# Block Ops loot and equipment design

Add usable guns, a knife, and explosive, smoke and flash grenades to the existing touch-controlled arena game. Players start fighting with their chosen gun, collect equipment while moving through the map, and lose collected equipment when eliminated. The intended loop is fight, collect, choose equipment, and fight again without a backpack-management screen.

The user approved the gameplay summary on 2026-10-03. This written specification is a draft for review, not an implementation approval or a completed release. The approved choices are recorded below. Sections labelled Proposed make the remaining behaviour and balance decisions explicit for review.

## Approved gameplay

- Loot works in offline solo with bots and online multiplayer.
- Players start with their selected gun and automatically collect nearby loot by walking over it.
- Players can carry every gun collected, one knife, and three grenades total across all types.
- Loot appears around the map and drops from defeated players and bots.
- The Armory still allows choosing other guns during a match. Replacing the original starting gun removes it from the carried inventory; it must be found as loot before it can be used again during that life.
- Include explosive, smoke and flash grenades.
- Death drops the held gun and remaining grenades, clears collected equipment, and restores the original starting gun on respawn.
- Picking up an item does not automatically switch the player's held weapon.
- Knives and grenades come from loot and have touchscreen controls. Smoke and flash affect bots as well as human opponents.
- Preserve the 500-round starting supply for guns, current maps and current character skins.

## Proposed equipment rules

Record the original starting gun when the round starts. A player joining an active online round uses the gun selected when joining. Menu selections during that round do not change this original gun; selections made for a future round may still be saved normally.

Keep four separate concepts: the original starting gun, guns currently owned with their ammunition, the active gun, and the currently held item. Holding a knife does not replace or remove the active gun. Each gun ID occupies at most one inventory entry, so carrying every available gun means at most 28 different guns, not unlimited duplicate models.

On the first actual equip of a different gun during a life, remove the original starting gun and mark it as requiring loot. This applies whether the new gun is chosen in the Armory or from collected guns. Merely previewing a gun, collecting one, equipping the knife, or throwing a grenade does not trigger removal. The removed gun does not become a ground drop: only death creates equipment drops.

This removal happens once per life. For example, start with an AK-47, equip an MP5, then find an AK-47: the collected AK-47 stays owned through later weapon switches. The Armory shows the original gun as unavailable with the message “Find this gun as loot” until that pickup. The server enforces this restriction independently of the menu.

Other Armory guns remain freely selectable. Choosing a gun not yet owned grants its normal fresh supply once for that life. Switching to an owned gun preserves its ammunition and reload state; it never recreates a fresh supply. Collected guns and freely selected guns appear together in the carried-guns view.

Each new life resets the original-gun restriction, clears all collected guns, knife and grenades, and equips the original starting gun with its normal magazine and reserve totalling 500. Existing respawn timing, spawn protection and pending-skin behaviour remain intact. New rounds capture the newly selected starting loadout.

## Proposed ammunition and duplicate pickups

Fresh map guns contain 500 rounds total, including their normal magazine. A gun dropped on death contains only its remaining magazine and reserve; picking it up must not replenish it. Cancel any unfinished reload on a dropped gun without transferring or creating ammunition.

Skip a gun pickup when that gun ID is already owned, leaving it available to someone else. This first version does not add ammunition boxes or refill ammunition from duplicate guns. A removed original gun is no longer owned, so its pickup is eligible and uses the ammunition stored in that pickup.

Skip knives if the actor already has one, and leave grenades on the ground when the shared three-grenade capacity is full. A missed or rejected pickup never destroys the item. The three-grenade limit is combined, not three of each kind.

## Proposed loot placement and lifetime

Enable loot on all eight maps in Free For All, Team Deathmatch and Capture The Flag. Author 16 safe, reachable pickup locations per map: eight gun locations, two knives and six grenades, including two of each grenade type. Give both teams comparable access and keep pickups away from exact spawn and flag interaction points. Do not change the existing map geometry.

Include at least one gun location for each distinct original starting gun of the current participants, so the removed starting gun can actually be found. Choose the remaining locations' gun IDs from the existing 28-gun catalog with a seeded per-round selection. Fixed, comparably accessible locations keep exploration understandable while weapon variety changes between rounds. A collected map item reappears after 20 seconds of match time.

Keep each location's assigned gun for the round unless a late join introduces an uncovered starting gun. In that case, reassign a location not needed for another participant's starting-gun coverage. Replace an available item atomically, or use the new ID when its existing respawn timer completes. With at most eight online humans, or one human and bots sharing their existing starting gun, eight gun locations suffice.

Automatically collect eligible items within 1.2 horizontal game units when the actor's feet are within 0.75 vertical units of the ground pickup and no wall separates them. Only living actors in active rounds collect loot. Spawn protection does not prevent equipment collection; existing protected-player flag restrictions are unchanged.

Resolve contested pickups by nearest eligible actor, then stable actor ID for exact ties. Removing an item and granting it form one simulation operation. A single item can never be awarded to two players. Pickup acknowledgement uses a short label and sound; it does not open a menu or change the held weapon.

Each death drops one active gun and each remaining grenade once at the victim's valid ground position. If the knife is held, drop the remembered active gun rather than inventing another gun. A carried knife and non-active guns disappear on death. Spread drops slightly to keep them visible, with every position checked against collision. Drops become collectible after 0.5 seconds and expire after 30 seconds. They do not respawn.

Limit death drops to 48 per arena, in addition to the 16 fixed map locations. Discard the oldest death drops when necessary; never evict a fixed map location. Leaving or disconnecting does not produce equipment drops, while existing flag-drop behaviour still applies. A new round removes all old pickups, projectiles and temporary effects.

## Proposed knife and grenade balance

The initial knife is one original block-style melee weapon, with no durability or ammunition. It deals 50 damage per successful swing, has a 0.6-second interval and reaches 1.8 game units. A swing hits the nearest visible opponent within 30 degrees of the aim direction, cannot reach through walls, has no headshot bonus, and respects spawn protection and team rules.

These are proposed starting values for playtesting, not claims about real equipment:

| Item | Fuse after throwing | Effect |
| --- | --- | --- |
| Explosive grenade | 2 seconds | Up to 90 damage, falling linearly to zero at 5 game units; solid cover blocks blast damage |
| Smoke grenade | 2 seconds | A smoke area with a 4-unit radius lasting 8 seconds; obscures every player's view and blocks bot sight through it |
| Flash grenade | 1.25 seconds | Up to 3 seconds of visual impairment within 10 game units, reduced by distance and looking away; solid cover blocks it |

Grenades throw in the player's aim direction, follow a shared lightweight ballistic simulation, collide with world geometry and can bounce. There is no cooking, charging or throwable-knife mechanic in this version. A blocked release point must not create a grenade on the far side of a wall.

An accepted throw consumes exactly one grenade and has a 0.65-second throw cooldown. The throw briefly suppresses gun/knife firing for 0.25 seconds without changing the active gun, then returns to normal combat. Limit live grenade projectiles to 32 per arena. Also limit the combined count of live smoke areas and in-flight smoke grenades to 16, reserving an area slot when a smoke grenade is thrown. Reject a throw that would exceed either limit without spending the grenade, and show a short message.

Explosions and knife attacks damage enemies only in this first version, with no self-damage or friendly fire. Flashes impair opponents, not teammates or the thrower; smoke obscures everyone. Spawn protection blocks damage and flash impairment. Smoke is visibility cover, not a bulletproof wall: players can still shoot through it without seeing their target.

For flash strength, use clear line of sight, distance falloff, and a facing factor: full strength within 60 degrees of the view direction, tapering to one quarter strength behind the target. Multiply those factors by the three-second maximum. Use a desaturated screen veil and gradual recovery, without repeated bright flashes or strobing. Hide opponent name tags and outlines when smoke or a full-strength flash obscures them.

Repeated flashes refresh or extend the remaining impairment only up to the three-second maximum; do not add an unlimited stack. Smoke areas overlap visually but do not multiply damage or flash strength. Fuses, effects and loot timers pause with solo gameplay; online simulation continues while a player is in menus or backgrounded.

Thrown grenades retain their thrower, team and life identifiers. If the thrower dies but remains in the match, the grenade still resolves and valid eliminations are credited once. If the thrower has disconnected, its remaining projectile is visual-only and cannot damage, flash or award scores; any smoke it creates still follows normal expiry. Ending a round stops subsequent damage, pickups and scoring.

## Proposed bot behaviour

Bots use the same inventory capacity, pickup eligibility, hit validation, team, protection and effect rules as humans. They automatically collect nearby equipment on their existing routes rather than abandoning flag duties to chase every item. Keep their existing M4A1 starting gun and restore it on their respawn.

Bots may equip a collected gun appropriate to their current engagement range and use a collected knife at melee range. Keep existing difficulty tuning for firearm accuracy and damage; do not silently replace it with full player damage. New grenade and knife damage uses the common values above, with bot opportunity and reaction timing controlling difficulty instead.

Bots cannot acquire or fire at targets hidden by smoke and cannot attack during their flash impairment. They may continue moving toward objectives or a last known target position. Limit bot grenade attempts to one every six seconds: use explosives against a visible enemy at a safe throw distance, flashes before attacking a visible enemy, and smoke while retreating or carrying a flag. Bots must actually own and spend each grenade, and cannot create equipment out of their targeting logic.

## Proposed touchscreen controls and presentation

Keep the existing joystick, drag-to-aim, Fire, Aim, Jump, Reload, Home and Pause behaviour. Extend the existing Loadout screen with a carried-guns view alongside Armory; selecting either view must preserve solo pause and online neutral-input behaviour. Show which guns are owned and explain the starting-gun restriction in plain language.

Add a knife toggle that appears enabled only after collecting a knife. With the knife selected, Fire becomes Slash; toggling again returns to the active gun. Grenades use a clearly labelled selected-type control and a separate Throw button with remaining count. Opening the type picker clears held combat input; selecting a type does not throw it. When a type runs out, Throw is disabled until another carried type is selected or collected.

All new controls must remain usable at 854 by 480 and larger landscape sizes without covering Home, existing combat controls, ammo or CTF status. Inventory/type overlays use the existing pause and explicit-resume rules; cancelling, changing screens, Android Back and backgrounding must clear held movement, attack and throw actions. Desktop equivalents are Q to toggle knife, G to throw, and T to open grenade selection, with no repeat-key throws.

Use simple original block-style pickups, visible item labels and distinct grenade shapes/colours. Reuse the existing gun appearance language. Do not alter character bodies, skins, hitboxes, map appearance or Home styling. Pickups and temporary effects use shared/poolable resources and capped counts suitable for the head-unit target. No generated art, paid services, accounts, rarity tiers, loot boxes, health/armour items or permanent progression are included.

Use short bundled or synthesized pickup, swing and grenade sounds under the current sound setting. A denied action provides a readable reason without closing the match or changing inventory. Knives, grenades, models and audio must remain available offline in the APK.

## Proposed technical approach

Keep the existing Three.js renderer, Android wrapper, solo runtime and authoritative Node room server. Add shared plain-data equipment, loot and grenade rules so both runtimes enforce the same outcomes. This is the recommended approach because it supports the requested feature without first replacing the game engine.

Two alternatives were considered. Separate solo and online implementations would change fewer interfaces initially but duplicate every inventory, pickup and grenade rule. Merging all existing combat into one new simulation engine would reduce longer-term duplication but substantially enlarge this update. Neither is necessary; share the new rules and extract only the existing damage/death paths needed for consistent consequences.

Suggested module boundaries are `equipment` for ownership and equip rules, `loot` for placement and atomic collection, `grenades` for throws and temporary effects, and rendering adapters for pickups and equipped items. Keep balance/catalog data separate from mutable match state. These modules do not own DOM nodes, Three.js objects or network connections.

Integrate the shared rules into `src/game.js` and `server/rooms.js`. Centralize each runtime's elimination consequences so gunfire, knives and explosives cannot create duplicate deaths, loot, score or flag drops. Stop processing further damaging actions immediately when the winning score ends the round. Preserve the existing authoritative mode and collision definitions.

Capture player requests as validated actions, then let the simulation update movement, equipment, projectiles, damage, pickups and objectives. Each throw and equip request carries an action sequence and current life identity; stale, repeated, malformed, dead-player or out-of-phase actions cannot spend equipment or alter another life. Never accept a client's claimed pickup, inventory, grenade position, damage or score.

Extend snapshots with inventory/starting-gun state, knife/grenade counts, current held item, loot entities, projectiles and temporary effects. Late joiners receive the current complete world state; event messages only drive deduplicated audiovisual feedback and cannot grant items. A rejected snapshot leaves the last valid state intact. Reconciliation releases entities removed from the world and cannot award a pickup twice.

Update `src/protocol.js`, network validators, client requests and server handling together to protocol 3. Old clients receive an update-required message before joining, rather than running without loot or receiving silently incompatible state. Keep existing secure WSS, message-size/rate limits, room limits, host transfer and room isolation. If snapshots grow too large, use bounded records and measure traffic rather than weakening validation.

## Proposed verification and release

Use tests before implementation for the shared ownership, pickup, melee, projectile and effect rules. Required cases include the exact original-gun sequence, cancelled previews, reacquiring the original gun, switching without ammo refill, death/reset, mixed grenade capacity, duplicate pickups, walls, contested pickups, expiry, entity caps, and rejected actions that must not consume an item.

Exercise both runtime integrations: one elimination/drop across all damage sources, correct CTF flag handling, friendly-fire and spawn-protection rules, posthumous grenade credit, round-end freezing, smoke/flash bot behaviour, and normal difficulty preservation. Validate safe and reachable loot locations on all eight maps and their use in all three modes.

Use independent real WebSocket peers for shared pickups, simultaneous contests, server-enforced Armory restrictions, grenades/effects, late joins, respawn, disconnect and protocol mismatch. Extend the existing network tests to reject invalid inventories/entities and ignore repeated action/effect messages.

Use Playwright CLI and the existing browser suites to check the actual pickup, carried-gun, knife and grenade controls at compact and large landscape sizes. Test movement plus aim plus throw, pointer cancellation, leaving/returning through Home, and background/resume. Two browser peers must see the same collected item, visible grenade and resulting effects. A browser mockup/review of new controls precedes public rollout.

Build the APK from the same tested staged assets used for the browser release, verify its signing and packaged bytes, and run native smoke checks if an owned disposable emulator is available. State any native test limitation and continue to identify physical BYD head-unit testing as outstanding until actually performed.

Do not change the live game while designing or testing. Back up the previous assets/APK. This update requires coordinated client/server deployment, unlike the reverted cosmetic change. Check active rooms before rollout and wait for them to empty; do not kick players without fresh explicit permission. Publish protocol-3 client and server together and explain that browser users must refresh and APK users must install the update. The temporary tunnel address and saved server settings must remain usable; permanent hosting is outside this task.

## Review status

The gameplay summary is approved. The proposed details in this written specification await user review. After that approval, write the implementation plan for review and execution-method selection required by Superpowers. No product code, live assets, server process or APK is changed by this design document.
