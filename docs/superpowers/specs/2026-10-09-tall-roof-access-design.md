# Tall roof access across all eight maps

Date: 2026-10-09

Status: written specification approved by the user on 2026-10-09. Approval permits implementation planning, not coding or a live-server restart. The implementation plan requires a separate review before execution.

Baseline: Block Ops 0.8.0, Android version code 10, protocol 6. Feature source is `3142c1a`; release documentation is committed through `af5968f` on `feat/offline-arena`. Preserve existing saves, unrelated working-tree changes, release artifacts and the running public game.

## Intent and approved choices

Make the original tall roofs visible in the arenas genuinely reachable, including the sandstone buildings in the user's Dust Town screenshot. The previous release's low annex roofs are not a substitute for this request. Each building must have one understandable approach that a player can guard, while each map has its own themed access style.

The user selected all eight maps and these entrances:

| Map | Entrance style | Required movement |
| --- | --- | --- |
| Sunlit Courtyard | Brick stairs | Walk up and down without jumping |
| Dust Town | Wooden crates and ledges | Normal jumps |
| Neon City | Metal fire-escape stairs | Walk up and down without jumping |
| Snow Base | Stacked ice blocks | Normal jumps |
| Jungle Ruins | Broken stone blocks | Normal jumps |
| Harbor | Ladders | Automatic joystick or keyboard climbing |
| Desert Fort | Stone stairs | Walk up and down without jumping |
| Space Station | Raised metal platforms | Normal jumps |

The agreed approach uses visible exterior routes attached to existing structures. Indoor stairs were considered but would require new interiors and broader layout changes. Do not introduce them in this feature.

Other approved behavior:

- Exactly one approach per building, without a second route from a neighboring roof.
- Harbor ladders need no Climb button. Up/down movement climbs; neutral input holds position; Jump lets go.
- Aiming and shooting remain available while climbing and do not detach the player.
- Preserve normal jump height, no fall damage and existing hiding spots.
- Support Solo bots, solo Zombies and the existing online modes. Bots and zombies physically follow the same routes.
- Preserve XP, cosmetics, inventory and saved server settings; verify touch controls, geometry and multiplayer movement.

The short gameplay loop is: spot the map's themed entrance, climb to the roof, fight or guard the approach, then descend or drop back into the arena. Route readability and forgiving landings support touchscreen play; no anti-camping penalty is added. Climbing gives no new XP, ammunition or healing rewards.

## Roof coverage and concrete defaults for review

The following scope and mechanical details complete the conversational design. These defaults were approved with this written specification, rather than answered individually in chat.

Include the main original structures below, plus both existing annex roofs on every map. Maps without conventional buildings use their substantial ruin, cargo or machinery platforms as roof destinations.

| Map | Original destinations | Count before annexes |
| --- | --- | --- |
| Sunlit Courtyard | All four colorful main buildings | 4 |
| Dust Town | All four sandstone buildings | 4 |
| Neon City | Four tall towers and two substantial side service structures | 6 |
| Snow Base | Central research shelter, four corner huts and two side structures | 7 |
| Jungle Ruins | Four tall ruin-wall platforms | 4 |
| Harbor | All six large cargo containers | 6 |
| Desert Fort | Four towers and both large gate-wall platforms | 6 |
| Space Station | Central reactor pedestal deck and eight large chamber-partition platforms | 9 |

This is 46 original destinations and 16 retained annex roofs, for 62 roof destinations. Each needs explicit stable identity, a usable standing area and its own entrance route. Exclude vegetation, cranes, antennas, perimeter walls, small ground-cover crates and small ornaments sitting on a larger roof. Excluded scenery must not become a bypass onto a destination.

For narrow ruin/partition tops, add visible supported caps or landings providing a usable platform; do not call an inaccessible decorative rail a completed roof. Preserve the underlying ground passages. A reactor deck is the broad base-top surface around its central structure, not a promise to climb every glowing ornament or antenna.

Retain the two annex hiding rooms on each map, their Hide/Exit behavior and clear ground-door access. Convert each annex's roof approach to that map's selected style as well: Harbor annex roofs use ladders, for example, rather than keeping the previous generic jump steps. Existing entrance/hiding anchors should stay where practical; any necessary movement must preserve safe entry, exit, view and loot/objective clearance and be recorded in the implementation evidence.

Keep map IDs, themes, bounds, bases, spawn positions and recognizable principal ground lanes. Routes may wrap around a building through switchbacks to fit the arena. Do not shorten a tower to avoid implementing its full-height route. Do not add unrelated rooms, new maps or a new renderer.

## Geometry and one approach per roof

Visible surfaces and gameplay collision must agree. Many current roof caps and rooftop ornaments are cosmetic boxes above the solid building body. Convert playable caps, route supports and solid-looking roof obstacles into matching collision geometry. Players must stand on the visible surface, not inside it, and bullets must not pass through cover that looks solid.

Use the existing procedural box style, shared flat materials and explicit lower/upper solid bounds. Raised platforms are fixed, not moving elevators. Ice blocks do not introduce sliding or slippery movement. Keep rooftop cover modest enough to preserve useful firing and standing space.

An entrance is a continuous ground-to-roof approach, not merely one metadata link. A player must pass through that building's authored final landing or ladder exit to reach the roof. Multiple players may use the same approach; this is not hiding-style exclusive occupancy and introduces no reservations, queues or player-body barricades.

Validate both declared routes and unintended physical alternatives. Specifically inspect:

- Harbor's adjacent container roofs and Space Station's neighboring partition tops.
- Existing annex roofs, their former approach blocks, roof decorations and nearby cover.
- Taller-to-lower roof transfers, jumps from perimeter walls and shortcuts across switchback runs.
- Ascents possible at the fastest current movement speed, not only the speed used by a test driver.

Where necessary, use visible solid side screens, railings or route layout adjustments to stop bypasses. Do not use invisible barriers, increase jump height, remove the intended approach, or make all roofs inaccessible to satisfy the check. Rails and screens must themselves be checked as potential stepping surfaces. Falling away from an unblocked outer edge remains allowed with no fall damage; it must not create a second entrance onto another protected roof. Ground exits from retained hiding rooms stay clear.

At authoring time, disabling a destination's own access route must make its roof unreachable from ground and from other normally reachable roofs. Keep negative fixtures that deliberately add a second physical path so the validator cannot pass by merely counting route records.

## Jump routes

Dust Town, Snow Base, Jungle Ruins and Space Station keep the current normal jump: vertical velocity 4.3 and gravity 13. No double jump, mantle, super-jump or precision sprint requirement is added.

Use deliberate stepping sequences with rises no greater than 0.55 world units, clear route width at least 1.6 and landing depth at least 1.2. Measure clear space after adding screens or trim. Validate the actual trajectory at the slowest existing human movement speed, including aiming, and with both zombie types. Wide or tall original roofs may need longer switchbacks; preserve ground connectivity rather than pushing an entrance into a spawn, base or hiding doorway.

The physical mover, not a navigation label, must prove each transition. Descending or missing a step uses ordinary collision and falling. These jump routes must not become automatically walkable when stair support is added elsewhere.

## Walkable stairs

Courtyard, Neon City and Desert Fort have discrete solid treads that can be walked both up and down without pressing Jump. Stair climbing applies only within a declared staircase corridor, between its declared neighboring tread supports. Ordinary crates, cover, ice blocks, broken-stone routes and metal jump platforms retain their current collision behavior.

Use tread rises of at most 0.25 world units, clear width at least 1.6 and at least 0.35 of tread run. Provide full-body landings at turns and at the roof, with at least 1.2 depth. Change visual construction to match these smaller risers rather than silently applying automatic stepping to the old 0.44-high jump blocks.

For each supported step, check the entire body through the rise and horizontal motion, including head clearance, under-roof ceilings and side walls. Do not lift a player through a slab or up the side of a staircase. Downward steps settle on the next supported tread; walking off an outside edge falls normally. When obstructed, stop at the last valid position instead of teleporting or clipping.

Stair assistance operates only while supported, not as an extra upward correction during a jump. Jumping still uses normal physics and may land on a tread. No global auto-step height allowance or sloped-support model is required.

## Harbor ladder controls and movement

Each ladder has a visible shaft and a collision-checked authored path from the bottom landing, up the outside of the structure, and over its edge onto the roof. The body stays upright and outside the building. Climbing progresses continuously along that path; entering and leaving must not teleport through roof trim or walls.

Concrete control defaults:

- From the bottom landing, intentional forward/up input toward the ladder engages it. From its marked roof landing, intentional backward/down input starts descent. Simply walking sideways past a ladder, looking at one, or firing does not attach.
- Require a living, exposed, grounded player in the clear landing/entry region. Mid-air automatic attachment is excluded; this avoids unexpected catches after a deliberate drop.
- Use an entry threshold of 0.25 on the normalized up/down axis. The initial attachment zone extends at most 0.6 world units from the clear entry centerline and must be reachable without crossing geometry. Move into alignment through ordinary collision-checked movement, not a remote snap.
- Once attached, use the raw joystick up/down axis or W/S independently of camera yaw. Turning around or looking up/down must not reverse climbing. Sideways input does not drag the body off the ladder; Jump is the deliberate release control.
- Initial climb speed is 2.4 world units per second at full input, scaled by the up/down axis and independent of selected gun and aiming zoom. This is a traversal tuning default, not a change to ground weapon movement speeds.
- Input within a 0.1 neutral dead zone holds position. No gravity drift occurs while attached. Releasing the joystick stops climbing while an independently held Fire control may continue shooting. Pointer cancellation, opening a menu or an online input timeout clears controls under existing cancellation rules and holds the attachment safely.
- Jump detaches, resumes ordinary gravity and grants no extra upward boost. Consume that press so it cannot also trigger a ground jump in the same update. Apply normal horizontal movement after release. Suppress reattachment until climb input has returned neutral or the player has left the attachment zone, so holding forward cannot immediately re-grab the ladder.
- At either end, continued movement completes the short authored exit onto its supported landing. A blocked exit holds at the last collision-safe position; reversing input or letting go remains possible. Normal actors are not newly made into solid blockers.

The path includes entry and exit segments rather than treating the vertical shaft as a point-to-point horizontal jump. Top trim must allow the player's complete body to rise clear before moving over the roof edge. Reverse travel uses the same safe path in reverse.

Retain the existing touch layout and keyboard controls. No Climb button or separate screen is added. Show a compact contextual hint near a ladder, such as `Up / down to climb`, and a `Climbing · Jump to let go` status while attached. Keep the top-left loot inventory, Hide/Exit, aim, Fire and Jump controls unobstructed at both control scales.

## Combat and existing interactions

A climbing player is fully visible and damageable at their real elevation, with ordinary body/head hitboxes, weapon origin, armour, friendly-fire and spawn-protection rules. Ladders do not count as hiding. Other players and bots may aim at climbers; zombies may attack only when their existing reach and line-of-sight rules allow it.

Free aiming, firing and normal ammunition/reload behavior remain available during climbing. Fire does not detach. Existing equipment actions retain their own eligibility, cooldown and supply-use rules; do not add a new blanket ladder attack lock or grant extra ammunition. Damage interrupts supplies under the existing rules, but nonlethal damage does not automatically detach a climber. Death releases attachment once and goes through normal scoring, XP and drop handling.

Keep flag carrying, loot reach and projectile collision height-aware. A ladder does not permit collection or capture through a roof or wall. A mid-climb death or disconnect projects drops to a valid support below the actual position, not automatically onto the destination roof. Completed rooftop landings use established supported-drop rules. The previously documented narrow roof-edge drop-anchor discrepancy is not claimed fixed by this feature; new route geometry must not create additional lost or unreachable drops.

Hide entry remains a separate explicit action requiring a valid grounded entry. Attachment and hiding cannot coexist. Preserve immediate AI forgetting after successful Hide, hidden damage proxies, raw Fire/Throw exit ordering and the reviewed consecutive-grenade damage fix. Approaching or climbing a ladder does not itself erase enemy memory.

Keep offline pause versus online live-clock behavior, current inventory/ammo totals, five-second supply timing, zombie waves/damage, XP receipts and cosmetics unchanged. No climbing state is saved into a permanent profile.

## Shared movement and authoritative state

Use one pure movement implementation for solo humans, bots, zombies and the online server. Extend the existing body/intent/world interfaces deliberately rather than deriving physical position from meshes or adding separate client-only ladder rules.

The world must include validated authored stair corridors and ladder paths in addition to solid geometry. The movement intent needs the original normalized climb axis alongside ordinary horizontal velocity and jump intent. The body retains a nullable `ladderId`; attached bodies have zero free-fall velocity, `grounded: false` and `supportId: null`. Ladder progress is measured along its finite authored path. Internal progress and reattachment guards are match-local, resettable state, not client-authoritative requests.

Movement returns either a complete valid new state or the last valid state with a failure result. Keep the current bounded time steps and sweep checks; malformed coordinates, invalid path IDs or invalid metadata must not produce NaN positions, unbounded loops or a blank world. Invalid authored maps fail validation before entering a match and use the existing visible startup/runtime error handling, with Home recoverable.

Every constructor/reset adapter must initialize new fields explicitly. Clear attachment/progress/reattachment guards on death, respawn, leave, map changes, rematches and fresh game creation. Clear stale held inputs independently. A hide transition also resets climbing fields, even though normal entry cannot happen from a ladder. After Android force-stop/relaunch, restore profile data normally but never restore a mid-ladder match body.

Online input continues to send normalized movement axes, aim and buttons, not a requested position or client-selected authoritative ladder. The server chooses attachment using accepted position, map, current life and eligible input. Reject stale-life traversal controls so delayed movement or Jump cannot attach or detach a new life. Retain current message size/rate limits and the 0.3-second stale-input neutralization.

Add nullable `ladderId` to authoritative actor snapshots and strict validators. Validate that it belongs to the current map, the living exposed body lies on its collision-safe path within 0.0001 world units, and grounded/support combinations are consistent. A dead, respawning or hidden actor cannot claim attachment. Keep validation for all existing equipment, progression, health and appearance fields equally strict.

The online client renders server positions and attachment, including late joins and both ascending/descending players. Reconcile attachment changes without interpolating the local camera or remote body through a wall or roof cap. Public/private snapshot separation and current prediction policy remain unchanged; no optimistic client-only attach or inventory mutation is introduced.

## Navigation and enemy behavior

Extend route metadata and navigation to distinguish walkable stairs, jumps, drops and ladders, including valid reverse transitions. Stair traversal uses the same supported-step assistance as humans. Ladder traversal supplies a climb axis to the same mover and retains the selected ladder until a real landing or deliberate release; it cannot use a zero-length horizontal direction as its progress measure.

Bots and both zombie types must reach every destination through actual movement. An enemy pursuing someone halfway up a ladder uses that connected ladder route rather than projecting the target onto ground or teleporting to the roof. Do not add special hiding behavior for enemies or disclose hidden target coordinates through navigation.

Crowd separation must not displace attached actors sideways into a wall or off a ladder. Retain the existing lack of hard player-body blocking; sharing a ladder does not reserve it or prevent an opponent from climbing. If a transition is blocked by actual solid geometry, wait or replan from the accepted position. Preserve pursuit/visibility decisions and guardable approaches; do not invent an alternate route to bypass camping.

Zombie spawns and patrol goals must stay connected when the human is climbing or on a newly reachable roof. Connectivity checks may use the ladder's supported endpoints, but cannot expose a specially hidden player to enemy perception. Keep population limits, ordinary attack ranges and existing wave progression.

Maintain bounded surface graphs and path caches. The existing 40,000-node graph limit and 32 cached fields remain safeguards; do not silently remove them to accommodate poor route geometry. Author compact routes and profile graph creation, validation and active play. Any necessary budget change must be justified with measured memory and load time, not an assumption that more is harmless on the BYD.

## Component boundaries

Keep these responsibilities independently testable:

1. **Roof catalog and authored geometry:** stable destination IDs, actual roof surfaces, per-map entrances, route guards and preserved hiding rooms. Integrates with `maps.js` and the existing traversal builders.
2. **Traversal validation and spatial world:** supported treads, collision-safe ladder paths, malformed-data rejection and physical single-approach checks.
3. **Shared movement:** supported stair assistance, ladder attach/travel/exit/release, normal jumps and lifecycle-safe body defaults.
4. **Navigation and runtime adapters:** enemy route execution, raw climb intent, body-state propagation and camera/model presentation.
5. **Online protocol and controls:** authoritative attachment, strict snapshots, late-join reconciliation and small contextual touch hints.

Extract cohesive helpers where needed; do not grow a second physics implementation inside `game.js`, `online-game.js` or `server/rooms.js`. No dependency, downloaded texture, physics engine or asset-generation service is required.

## Compatibility and release defaults

Target version 0.9.0, Android version code 11 and network protocol 7. Changed map geometry and movement require coordinated browser/server/APK compatibility even if ordinary input packet fields can be reused. Protocol-6 clients must receive the existing clear update-required guidance before entering new rooms; do not let old assets simulate the new geometry silently.

Keep the ES2017 build target, WebGL1 fallback, app ID, Android SDK settings, permissions and existing signing identity. Offline maps, bots, Zombies and traversal must require no network. Keep geometry/material lifetime bounded across map changes and rematches; do not create new mesh resources every frame.

Use a new candidate artifact such as `artifacts/block-ops-v0.9.0-tall-roofs.apk`, preserve 0.8.0 and record exact source, browser-asset and APK hashes. Same-signed installation must retain earned XP, unlocked skins, selected cosmetics, preferences and saved server overrides without uninstalling or clearing data.

Building a candidate does not authorize deployment. Discover the current live identity and URL afresh, preserve exact rollback source/assets/APK, obtain a new empty-room maintenance approval and recheck rooms immediately before replacement. Keep the existing browser origin where possible because local saves are origin-specific. Do not reuse earlier approval to restart or evict rooms. No merge, push or PR is authorized by this feature approval.

## Verification and acceptance

The implementation plan must turn these requirements into failing-before/passing-after tests and retained acceptance evidence:

- **Content:** all 62 specified destinations have the correct map style, stable IDs, matching visible/collision roof surfaces and one valid approach. Preserve every spawn, base, principal ground lane, loot position or explicitly documented safe relocation, and all existing hiding entries/exits.
- **Physical routes:** replay every full route upward and downward through shared movement for human and enemy movement profiles. Test stairs without Jump and jump routes that still require Jump. Cover ceilings, side collisions, turns, narrow-edge landings, bounds and deliberately injected physical bypasses.
- **Ladders:** bottom/top engagement, both directions, partial travel, neutral hold, free-aim turns while climbing, simultaneous fire, reload, release, reattachment suppression, blocked endpoints, long frames, invalid metadata and collision-safe transitions. Include exact zero-horizontal-distance vertical segments.
- **Lifecycle and authority:** stale life/input, pause/menu neutralization, pointer cancellation, death, respawn, hide transitions, room leave, disconnect, rematch, map change and incompatible clients. Prove no old attachment or climb input reaches a new life and no client packet grants arbitrary elevation.
- **Combat and objectives:** exposed body/head hits at real climbing height, blocked gun/knife/grenade paths, flags and loot above/below floors, mid-climb death/departure drops, hide/proxy regressions, correct kill/XP receipts and no duplicate rewards.
- **Enemies:** ordinary bots and walker/runner zombies physically complete all route types, pursue at intermediate ladder heights, lose track after actual Hide, preserve valid spawns and recover from interrupted transitions without teleports or stuck waves.
- **Browser:** use isolated Playwright profiles and real keyboard/touch controls on all eight maps, explicitly reaching original tall structures rather than only annex roofs. Exercise every destination in automated coverage and retain representative screenshots of each entrance style and map, rendered world geometry and console/network errors. Test modern and legacy-WebView paths at 854×480, 1200×700 and 1280×720 with control scales 1 and 1.3.
- **Multiplayer:** two independent browser peers in owned rooms observe matching ladder/roof positions, shooting while climbing, damage, late join, depart/rejoin and rematch. Cover FFA, TDM and CTF and both host/guest roles. Clean owned rooms and processes without touching public users.
- **Android:** test the exact frozen APK on an explicitly owned emulator, with real touch input, offline map access, all eight map families, ladder combat, a separate browser peer, background/foreground and force-stop/relaunch. Prove genuine profile retention across a same-signed 0.8.0-to-0.9.0 upgrade; never clear user app data.
- **Regression and performance:** run the full suite and relevant existing browser/native progression, inventory, supply, Zombies, hiding and startup checks against final assets. Compare matched baseline/candidate scenes, map load/navigation cost, maximum supported actors, frame intervals and resource counts. Report software-renderer limitations rather than calling those measurements BYD performance.
- **Delivery:** verify APK metadata/signer and exact bundled assets. Only after separately approved public cutover, verify the actual live no-store asset bytes and protocol with a private two-peer smoke test. Roll back the captured prior release on a genuine delivery verification failure, without clearing profiles.

Actual BYD map loading, tall-roof access, ladder aiming/shooting and touch responsiveness require the user's parked-vehicle test. Emulator or desktop results do not establish physical-device acceptance.

## Exclusions and next approval

No super-jump, double jump, general mantling, grappling hook, moving platforms, slippery ice, fall damage, destructible entrances, anti-camping rule, new map count, new weapon balance, climbing XP, online Zombies, enemy use of special hiding spots, cloud saves, new artwork service or permanent-hosting project. Vehicle safety restrictions remain unchanged.

This specification supersedes only the previous roof-coverage and access restrictions in [the 0.8 rooftop and hiding design](2026-10-08-rooftops-hiding-design.md): original tall destinations are now required, and authored stairs/ladders are added. Existing approved hiding, combat, save and safety rules otherwise remain in force.

Next gate: review [the implementation plan](../plans/2026-10-09-tall-roof-access.md) and confirm the execution method. Do not begin implementation until that review; deployment still requires fresh maintenance approval.
