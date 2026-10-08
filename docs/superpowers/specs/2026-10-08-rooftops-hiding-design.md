# Rooftop routes and hiding spots

Date: 2026-10-08

Status: written specification approved by the user on 2026-10-08, including its concrete defaults. The implementation plan must still be reviewed and an execution method selected before coding. Public deployment requires a separately coordinated window.

Baseline: Block Ops 0.7.0 at source `28859c3`, Android version code 9, network protocol 5. Preserve unrelated working-tree changes, existing release artifacts and the running public game.

## Intent and agreed choices

Make the existing arenas more useful for exploring, hiding and defending a position. Players should be able to enter selected rooms, jump along understandable routes onto buildings, and hold a single entrance if they want. Touchscreen play in the parked BYD, offline play and browser play remain supported.

The user explicitly chose:

- Upgrade all eight existing maps, retaining their themes and familiar layouts.
- Normal jumps using crates, steps and ledges, not a super-jump.
- Both ordinary walk-in rooms/cover and special tap-to-hide spots.
- Support solo bot matches, solo Zombies and existing online multiplayer modes. This does not add online Zombies.
- Bots and zombies can follow the same physical rooftop routes as the player.
- No fall damage.
- Single-entrance defensible positions are intentional. Do not require a second approach or add an anti-camping timer, forced movement or escalating punishment for staying still.
- Entering a special hiding spot makes bots and zombies lose track, even if they watched the player enter.
- Human multiplayer opponents can attack hiding spots. A damaging hit damages the occupant and forces them out.
- Pressing Fire while hidden exits the spot before the attack is resolved.
- Keep Jump and add a contextual touch **Hide / Exit** control.
- The online server validates movement, hiding and damage. Death or leaving releases occupancy.
- Test all maps and mode families in the browser and Android build; preserve saved XP and cosmetics.

The approaches discussed were adding these areas to the existing maps or rebuilding all eight layouts. Use the former. Existing geometry needs real movement/collision changes, not merely decorative stairs: today movement is X/Z-only and jumps land only at ground level.

The game-design skill informs readable routes, touch-friendly landings, clear hiding feedback and playtesting. It does not override the user's preference for camping or for forgiving AI concealment.

## Defaults approved in written review

The following fill in details not individually selected in chat. They were accepted through approval of this written specification, not through separate earlier answers:

- Each map gets at least two accessible elevated defensive positions, one reachable from each team's side, at least one walk-in sheltered room/alcove, and two special hiding spots. These may share structures; not every building becomes enterable or climbable.
- At least one elevated defensive position per map has only one ground-to-position approach. Dropping off a roof is still allowed and is not a mandatory second entrance. No alternate normal-jump approach should accidentally defeat that position's single-entrance design.
- One living player occupies a special hiding spot at a time. Bots and zombies do not themselves enter special hiding spots in this release.
- Hiding freezes movement, not looking around. It has no duration limit, automatic healing, invulnerability or entry/exit cooldown. Existing round timers, ammunition, supply limits and death rules remain unchanged.
- Existing five-second health/armour supply use and ordinary reloading are allowed while hidden. Hiding itself neither consumes a supply nor cancels its use. Existing damage/attack cancellation rules still apply.
- A flag carrier may hide. The carried flag's world model is concealed with the avatar, but the team status can still say the flag is carried. The carrier cannot pick up, return or capture a flag while hidden; exiting restores normal objective interactions.
- Hidden occupants remain vulnerable to incidental valid damage, including an already-thrown grenade. Making AI forget does not delete projectiles or provide immunity. They must exit before collecting nearby ground loot.

## Player experience

The short loop is: find a crate/step route, climb to a useful firing position, defend it or drop down, retreat into ordinary cover or a special hiding spot, then exit to continue fighting. No XP is granted for climbing, hiding, waiting or damaging an empty hiding prop. Existing legitimate combat/objective XP continues normally.

Ordinary rooms, alleys and cover use normal visibility and damage rules. Merely walking into a room does not activate magical concealment or erase enemy memory. The immediate AI-forgetting rule applies only after a successful special Hide action.

Approaching an available special spot within 1.5 world units of its entrance, on the same walkable level with an unobstructed path, shows **Hide**. The player must be alive, grounded and in an active match. An occupied spot shows **Occupied** when inspected nearby, without exposing who is inside or adding a distant marker. A failed entry leaves the player where they were and displays a short reason.

Entry moves the player to the spot's authored occupant anchor and marks them hidden. The camera uses a fixed, authored viewing point with a clear opening; players can look but cannot slide the camera through walls or above cover. Keep a readable **Hiding** status and the **Exit** button; do not open another screen, replace the loot inventory or obscure aim/fire controls. Hide geometry must not produce a blank first-person view.

While hidden, movement and Jump do not move the player. Exit returns them to the spot's nearby, same-level clear exit anchor. Fire exits first, updates the attack origin, then follows normal gun/knife cooldown, ammunition and supply-use rules. A dry gun still causes exit; hiding does not bypass a reload or attack lock. Throwing a grenade follows the same exit-before-attack rule. Merely selecting equipment does not exit.

Use the existing control scale setting. The contextual control must fit alongside the right-hand action cluster without covering the joystick, Fire, Jump, health or top-left numbered inventory. Provide keyboard **H** for the same Hide/Exit action; consume only a new press, not key repeat. Existing E-to-zoom, Space and numbered inventory shortcuts retain their meanings. UI interaction must not also turn into an aim drag or extra shot.

## Maps, geometry and movement

Keep map IDs, names, bounds, bases and main travel lanes. Add structures in the existing low-cost procedural box style with flat materials; no generated art, downloaded textures, physics engine or new renderer is needed. Geometry and collision must agree, including visible rooftop trim, doors, ceilings and landing edges.

| Map | Elevated route / ordinary shelter | Special hiding appearance |
| --- | --- | --- |
| Sunlit Courtyard | Crate/ledge routes onto selected colourful buildings; an opened ground-floor room | Storage locker and blocky shrub |
| Dust Town | Stacked supplies and sandstone steps to selected roofs; market storeroom | Supply cabinet and covered storage nook |
| Neon City | Service steps/ledges to low rooftop terraces; street-level service room | Utility locker and service recess |
| Snow Base | Supply steps to research huts; a sheltered hut interior | Equipment locker and snow-camouflaged supply nook |
| Jungle Ruins | Broken-stone steps to broad ruin platforms; roofed stone alcove | Dense blocky bushes |
| Harbor | Cargo steps onto selected containers; an open container interior | Cargo locker and storage recess |
| Desert Fort | Stone steps/ledges to defensive platforms; a tower-base shelter | Supply cupboard and screened alcove |
| Space Station | Machinery steps to maintenance decks; a side chamber | Maintenance locker and equipment recess |

Terraces/platforms satisfy rooftop traversal where climbing an entire tall tower would require rebuilding the map. Selected defensive roofs have usable standing/firing room, not just narrow decorative rails. Author routes with risers no higher than 0.55 units, landing depth at least 1.2 units and route width at least 1.6 units. Validate gap transitions with the slowest existing player weapon movement speed as well as both zombie types. No sprint-only precision jump is required.

Represent collision boxes with explicit lower and upper Y bounds, rather than assuming every object starts at ground zero. Split converted buildings into actual walls, doorway openings and suspended ceiling/roof slabs. The same spatial representation feeds actor movement, support queries, line of sight, gun ray tests, grenade sweeps, navigation and interaction reach. Decorative-only objects must not misleadingly appear to be necessary route supports or solid cover.

Use a shared pure character movement module for offline humans, bots, zombies and the online server. Its state includes feet position, vertical velocity and grounded/support identity; inputs include intended horizontal movement and a jump edge. Grounded is determined by support under the feet, never by `y === 0`. Initial tuning retains jump velocity 4.3 and uses gravity 13 consistently, preserving the existing solo jump feel. No automatic mantling, climbing through walls, double jump or increased jump height is added.

Resolve side collisions, upward head/ceiling collisions and downward landings with bounded swept substeps. Walking off a ledge initiates falling; landing does not inflict damage. A grounded actor may jump from a roof or step. Use the established actor radii/height and separate cosmetic walking bob from physical feet height. Respect arena X/Z bounds at every elevation so climbing above a perimeter wall cannot escape the arena.

The shared mover returns authoritative physical state, not camera or mesh changes. Runtime adapters position actors/models and place the camera at feet height plus its normal eye offset. Normal round/respawn resets return to existing supported spawn locations with no hidden state or inherited vertical velocity. Unexpected invalid movement is rejected or restored to the last valid supported state; it must not silently teleport a player through a building to ground level.

## Navigation and AI concealment

Extend navigation to distinguish walkable levels at the same X/Z position. Use connected walkable surface regions with validated walk, jump and drop transitions. Keep ground routes and authored roof transitions in one connected graph. Cache bounded path results by level-aware goals; do not build an unbounded full three-dimensional voxel world or run a full search per actor per frame.

AI executes route transitions through the same mover as the human, including an actual jump request and subsequent landing. Store height in targets, memories, waypoints and actor state. If a route is blocked or a jump fails, replan from the actual position; never teleport up, walk through a floor, or hit a target through the roof. Zombie crowd separation only pushes actors sharing overlapping vertical space and must not push a human or an enemy through geometry. Existing enemy speed/damage progression remains unchanged.

On successful special hide entry, clear that target's bot/zombie target reference, last-known position, cached pursuit goal and pending target-specific attack. Do this even when entry was witnessed. Do not refill those fields from a hidden player's position, a carried flag, a marker or a shared actor list. Bots pursue other visible/known targets or their team objective; otherwise they patrol reachable points. Zombies similarly wander reachable points rather than deliberately gathering at or attacking the occupied spot. Hiding is not an automatic wave clear and does not stop the zombie run clock.

Zombie spawn validation must still find valid connected spawn locations when the player is on a roof or occupying a hiding prop. Use the appropriate reachable support/entry anchor for connectivity validation without handing that anchor to zombie pursuit as a hidden target. Retain existing spawn distance/visibility safeguards; hiding must not accidentally prevent remaining wave enemies from spawning.

When the player exits, enemies may acquire them again through the normal visible-target check. A hidden-to-visible transition alone must not reveal a player behind a wall. Existing smoke/flash concealment combines with the new hide predicate. Ordinary wall cover may retain last-seen pursuit, but must not immediately refill the just-cleared hide memory from an unseen current position.

A shared perception helper should supply the relevant targeting/visibility decisions to bot intent, target memory updates, equipment selection and ongoing attacks. Render visibility also respects hidden state: remove the hidden avatar, held weapon, name label, team marker and carried flag world model from other players' normal view. Keep the spot itself visible and attackable. Do not create an occupied-specific glow, animation or distant name label; the nearby Occupied message is the explicit interaction feedback exception.

## Damage and hiding-state lifecycle

Give each special spot a damage proxy mapped to its occupant. A direct gun or knife hit against an occupied spot resolves ordinary body damage against that occupant. The proxy has no hidden headshot bonus; normal exposed avatar headshots retain their current damage. An empty spot awards no damage, hit-confirmation or XP. Props are not destructible in this release.

Spot hits must use actual range, aim and geometry. The prop's own concealment shell must not block all attacks against its proxy; unrelated walls, intervening roofs and nearer cover still block them. Grenade blast exposure/distance uses the spot's damage proxy and the same external-cover rule. Flash/smoke can apply their existing effects but do not force exit without damage. Existing team/friendly-fire and spawn-protection policies remain in force.

Apply damage once through the ordinary damage path, including armour, interruption of supplies where already required, kill credit, loot drops and XP. Any positive damage absorbed by health or armour forces exit. Resolve that exit before later attacks in the same simulation step. A lethal hit clears occupancy and records one death without briefly firing a queued attack or granting a second hit/kill. A proxy must not let one bullet also hit the newly exited avatar a second time.

For online players, validate all transitions on the server: enter, voluntary exit, attack-triggered exit, damage-triggered exit, death, respawn, leave/disconnect and round/map reset. Offline adapters call the same pure hiding rules. Each spot has a stable map-local ID, occupant anchor, viewing point, entry/exit anchor and damage bounds. Occupancy belongs to actor ID plus life ID so an old request cannot hide or eject a new life.

At map-validation time, require a supported, in-bounds entry/exit with clear full-body space and a short unobstructed connection to the viewing/occupant region. Maps are static and existing actors do not become new solid barricades in this feature; retain that behavior so another player cannot trap the hidden occupant by standing on the exit. If entry validation fails, deny entry. If a corrupt/stale state still requires exit, use a validated same-level nearby recovery anchor, never an arbitrary point through a wall. A map with no valid recovery must fail validation before a match begins.

Online simultaneous entries are resolved once by the server's accepted action order. Duplicate requests cannot toggle repeatedly or claim two spots. Requests from dead players, other floors, excessive distances, wrong maps or stale lives are rejected without movement or inventory mutation. A pending request disables repeated local submission until the authoritative reply/state or timeout; a timeout clears the pending UI and reports failure, not invented occupancy.

## Existing systems and height-sensitive interactions

- **Loot and supplies:** preserve current counts, inventory behavior and spread rules. Check pickup range and occlusion in three dimensions, preventing collection through a floor or wall. Relocate authored slots only where changed geometry requires it; this feature does not add a new rooftop loot economy.
- **Death drops:** retain the victim's supported level. A grounded rooftop death drops loot on that roof, not at Y=0 or inside the building. For a mid-air death, resolve the first valid support below the death location. A death inside a hiding prop uses its clear exit anchor on the same level so loot is not trapped inside the prop. Spread drops over supported visible locations on that level without clipping walls or being pushed off the map. Carry item height through existing loot rendering/network fields.
- **Flags:** give flags a real Y coordinate, including carried, dropped and returned states. Pickups, manual returns and base captures require appropriate vertical reach and an unobstructed same-level interaction. A rooftop carrier death/disconnect drops the flag on that roof; an airborne drop resolves a support below. Returning resets to the original base support. No capture or ground-flag pickup from an overhead roof.
- **Hidden flag carriers:** retain possession without a world flag model, cannot interact with objectives until exposed, and drop at the spot's clear same-level exit anchor on death/disconnect. AI must not use flag coordinates to defeat the approved forgetting behavior.
- **Healing/reloading:** retain established supply duration, stack caps, consumption and interruption rules. No refill or regeneration is introduced by hiding, and selecting a different weapon does not grant new ammo.
- **Menus and pause:** preserve offline pause versus online live-clock behavior. Opening a menu neutralises controls without secretly unhiding. Leaving the match frees occupancy; late joining reconstructs authoritative current state.
- **Progression:** no profile-schema change or new reward track. Preserve XP receipts, selected/current/pending cosmetics and saved multiplayer URL. Hiding state is match-local and never restored from a saved profile after relaunch.

## Component boundaries and online data flow

Keep these responsibilities separate and testable; filenames for new modules can be finalised in the implementation plan:

1. **Map traversal metadata:** shared static geometry, support surfaces, route links, hide spots and validation. Consumed by rendering and simulations, with no DOM/network dependency.
2. **Spatial queries and character movement:** pure bounded collision, support/visibility queries and physical movement. One implementation used by solo and the server; no Three.js model state as physical authority.
3. **Navigation and perception:** level-aware paths and target visibility/memory rules. Existing bot/zombie decisions consume these without inspecting renderer visibility.
4. **Hiding state machine and combat adapter:** authoritative occupancy, transitions and proxy-hit mapping, calling existing health/equipment/scoring paths rather than duplicating them.
5. **Input/presentation adapters:** touch/keyboard intent, contextual button/status, camera/mesh visibility and interpolation. They render accepted state and cannot grant entry/damage locally in online play.

Relevant integration files include `src/maps.js`, `src/collision.js`, `src/navigation.js`, `src/world.js`, `src/game.js`, `src/bot-brain.js`, `src/zombie-brain.js`, `src/zombie-runtime.js`, `src/input.js`, `src/gear-combat.js`, `src/gear-view.js`, `src/loot.js`, `src/loot-spawns.js`, `src/modes.js`, `src/objectives.js`, `src/network.js`, `src/online-game.js`, `src/protocol.js` and `server/rooms.js`. Extract the new cohesive rules instead of growing another large branch inside `game.js`, `main.js` or `rooms.js`; avoid unrelated refactoring.

Online flow: input sends enter/exit intent with spot identity and current life identity; the room checks its map, accepted position, life and occupancy; accepted physical/hiding state enters the next authoritative snapshot; the client updates camera, visibility and controls from that state. Resolve accepted hide transitions before target selection and combat in the same tick. Fire/knife/throw exits before resolving that attack. Existing neutral-input timeouts, rate limits and message-size limits remain in force.

Preserve raw attack intent for the exit decision before ordinary supply, reload or ammunition gating. In particular, the current server suppresses Fire while supplies are in use; that suppression must not swallow the new exit action. If Hide and an attack arrive in the same step, the attack leaves the player exposed rather than allowing a hidden shot. Apply the ordinary attack/cancellation rules only after the exposure transition, consistently offline and online.

Extend strict packet validators deliberately for hide actions, authoritative actor hide identity, supported elevation bounds and flag Y. Keep private equipment/progression receipts private and preserve their validation. A malformed hide field must not weaken validation for health, inventory, cosmetics or scoring. A late joiner sees the same occupied spots, concealed actors and current elevations as existing peers. A respawn/rematch clears stale pending hide actions.

Target release 0.8.0, Android version code 10 and network protocol 6. Version 5 clients receive update guidance rather than entering rooms whose geometry/flag/hide semantics they cannot understand. Upgrade browser/server/APK together. This is not a competitive anti-cheat or secrecy rewrite: a modified client may inspect replicated hidden-state information, but the normal client must not reveal it visually and cannot authoritatively invent damage or occupancy.

## Compatibility and failure handling

Preserve the existing ES2017 build target, WebGL1 fallback, Android minimum/target SDK, app identity, signing identity and permissions. Do not require online services for map geometry, movement, hiding, bots or Zombies. Keep procedural materials shared/disposed correctly and avoid per-frame geometry rebuilds.

Reject malformed map metadata, unreachable authored routes, invalid support heights or hide exits in automated validation. Runtime/network errors should use the existing visible error handling and leave Home usable; do not allow a failed map setup to show only a HUD over a blank scene. Invalid or obsolete requests are rejected without resetting saves or dropping the room's valid state.

Use bounded map/navigation caches and measure frame time on representative scenes with the existing maximum actors, especially Zombies. Retain baseline screenshots/timings for comparison. Do not claim BYD performance from desktop tests alone. Actual parked-car rendering, responsiveness and input comfort remain a user hardware acceptance check.

## Acceptance and delivery

Verification is required before reporting the feature finished; none of the following has been run for this new feature yet.

- Pure tests cover ground/step/roof support, head bumps, side walls, edge falls, repeated jumps, arena bounds, long-frame substeps, malformed positions and identical solo/server movement results. Test a room below a roof at the same X/Z.
- Validate all eight maps' content minimums, spawn/base/loot clearance, single-entrance positions, hide entry/exits and physical route reachability. Exercise the actual mover along authored route links for humans, both zombie types and ordinary bots, not just a graph edge labelled reachable.
- Test AI forgetting witnessed hide entry, clearing all pursuit/memory paths, no hidden-carrier information leak, patrol while hidden, and reacquisition only after a visible exit. Test pursuit and crowd behavior across floors.
- Test free/occupied/invalid entry, repeated requests, two players entering simultaneously, stale life requests, voluntary exit, Fire/knife/grenade exit ordering, reload/dry-fire behavior, partial-armour damage exit, lethal hits, empty props, friendly fire, protection and incidental grenade damage.
- Test roof/floor blocking for bullets, melee and grenades, and direct attacks against hide proxies. Preserve existing exposed headshot damage and zombie damage scaling. Prevent duplicate damage/XP from one shot through a proxy.
- Test rooftop loot/death drops, pickup occlusion, height-correct flag pickup/return/capture/drop, hidden carrier rules, supplies while hidden, menus, death/respawn, leave/disconnect, late join and rematch cleanup.
- Use isolated Playwright browser profiles and real control actions to climb, enter a room, hide, exit and attack a spot across all eight maps. Inspect world rendering and console errors, not just successful HUD updates. Cover touch controls at 854×480, 1200×700 and 1280×720, with control scales 1 and 1.3.
- Run two real browser peers for online elevation/visibility agreement and spot combat, including both host/guest roles, late join, disconnect and incompatible-client handling. Keep these in owned local/staging rooms; do not disrupt public users for a test.
- Verify the actual APK on an explicitly owned Android emulator: offline map loading, touch jump/Hide/Exit, roof/interior rendering, Zombie pursuit, online peer interaction and background/foreground behavior. Same-signed upgrade installation and force-stop/relaunch must retain existing XP, unlocks, selected cosmetics and server settings. Never clear the user's app data to make a test pass.
- Run the full regression suite and relevant browser/native checks against frozen candidate assets; verify APK version/signer and bundled asset equality. Retain screenshots, logs and any unresolved limitations. Have the user check the actual BYD while parked before claiming physical-device acceptance.

Building/testing a candidate does not authorise a public restart. Discover current live processes/URL afresh, preserve exact rollback source/assets/APK, and obtain a newly coordinated empty-room deployment window. Do not reuse previous maintenance approval or historical PIDs. Preserve the existing browser origin where possible because local saves are origin-specific, and do not overwrite saved server preferences. Only report the browser updated after checking the actual live assets and protocol. Release the APK with a clear new filename and retained previous artifact.

## Scope and next gate

No minimap, new map count, super-jump, mantling, ladders, fall damage, destructible buildings, anti-camping mechanic, new guns, weapon rebalance, online Zombies, new XP rewards, cloud saves, new artwork service or permanent-hosting project. Bots can traverse routes and forget hidden players; teaching them to use special hiding spots is outside this release. Do not alter vehicle safety restrictions.

This is one cohesive architectural feature: map geometry, shared movement, AI traversal and concealment must agree before it can ship. Implementation may be split into dependency-ordered tasks, but all eight maps and the approved mode coverage are the delivery scope, not an optional later phase.

Next: prepare the implementation plan for user review. This written specification is approved; coding begins only after the plan is reviewed and its execution method is selected.
