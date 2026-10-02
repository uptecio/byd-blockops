# Block Ops home maps skins and game modes

This design extends the existing touch-controlled Android game with a Home screen, eight original block-style maps, selectable character skins, and Free-for-All, Team Deathmatch and Capture the Flag. The user confirmed that all modes must support both offline bots and online friends. The update preserves the 28 guns, 500 starting rounds per gun, and internet room codes.

The user approved this written design on 2026-10-02. The map themes, skin names, match rules and Home behaviour below are the implementation requirements. This document does not represent a completed implementation or a new APK.

## Home and navigation

The app opens on Home, with a large rotating preview of the selected character holding the selected gun. Touch-friendly controls open Skins, Maps, Game mode, Armory, Solo bots, Online friends and Settings. A valid invite link still opens its room-joining screen directly.

Add a labelled Home button to the in-game HUD and pause screen. During a live solo round, Home asks whether to end that round. In an online room it asks whether to leave; the shared match continues, and host ownership transfers if necessary. Confirming returns to Home and clears held input. Cancelling restores the preceding screen; cancelling from gameplay resumes controls. Opening a confirmation pauses solo time but only suspends local controls online. Do not silently return an online player to bot play.

Pause remains a separate action for resuming the same round. Android Back and backgrounding retain their existing pause behaviour. Returning to the foreground does not resume controls automatically. Any remote start, results or disconnect transition dismisses obsolete local overlays before enabling controls or showing its destination.

Map, mode, skin, gun and existing settings persist locally. Invalid stored values fall back to supported defaults. Changing a map or mode starts a new solo round; it must never silently replace a paused round. Existing loadout changes retain each weapon's ammunition.

## Eight maps

Use eight maps in total, including the current Courtyard. They share the colourful, low-detail block aesthetic requested by the user, with original layouts and art rather than copied game assets. Each has different obstacle placement and routes, not just a different palette.

| Map | Appearance | Layout identity |
| --- | --- | --- |
| Courtyard | Colourful buildings, trees and crates | Existing central lane with side cover |
| Dust Town | Sandstone streets and market awnings | Offset streets and a sheltered central square |
| Neon City | Dark buildings with bright signs and trims | Cross streets and alternating side passages |
| Snow Base | Snow, blue ice and research shelters | Central shelter with two broad flanking routes |
| Jungle Ruins | Stone ruins and blocky vegetation | Broken walls and winding connected paths |
| Harbor | Cargo containers, cranes and water scenery | Container lanes and a diagonal open yard |
| Desert Fort | Warm fort walls and towers | Two defensive courtyards linked by three routes |
| Space Station | Metallic panels and glowing equipment | Connected chambers around a central reactor landmark |

All eight support all three modes. Each map provides safe free-for-all spawns, red and blue team spawn pools with at least five distinct safe points each, and two reachable flag bases. Team bases have comparable access and cover. Playable ground stays flat and within the current arena footprint; raised structures are scenery or solid cover, not accessible second floors. Water is scenery outside playable boundaries. This avoids introducing new climbing, falling or vehicle physics.

Map selection shows a name and lightweight thumbnail. Solo uses the local choice. Online uses the host's choice, shown to everyone in the room. Only the host may change map or mode while waiting or after a completed round; neither changes during an active match. Different rooms may run different maps simultaneously.

## Eight character skins

All skins are unlocked: Ranger, Desert Ops, Arctic Scout, Jungle Scout, Neon Runner, Shadow Ninja, Robo Unit and Space Guard. Distinct colours, headgear, visors and small accessories distinguish them. Their movement, health and hitboxes remain identical; cosmetics confer no advantage.

The Home preview and multiplayer avatars use the same skin models. The selected skin is saved and sent when creating or joining a room. Online peers see that skin. Team badges, name colours and clear red or blue markers remain visible regardless of cosmetic colours. Offline bots use varied skins with equally clear teammate markers.

Skin changes apply to the next spawn or new match, including the initial spawn after a lobby change. The Home preview updates immediately. No purchases, account system, progression or locked skins are introduced.

## Match rules

All modes last three minutes unless their winning target is reached sooner. Final results identify the winning player or team, or a draw, and show personal eliminations and deaths. Once a round ends, further damage and objective scoring stop.

| Mode | Winning target | Scoring |
| --- | --- | --- |
| Free-for-All | 15 eliminations | Each player's eliminations count independently |
| Team Deathmatch | 30 team eliminations | Every enemy elimination contributes to the killer's team |
| Capture the Flag | Three captures | Bring the enemy flag to your base while your own flag is home |

At timeout, the highest mode score wins; tied leading scores are a draw. Team modes disable friendly fire, and teammates do not intercept damage rays. Personal kills still appear in Capture the Flag but do not decide its winner.

Online rooms retain the existing limit of two to eight humans, with no bots impersonating people. Assign new participants to the smaller team. Rebalance teams between rounds, not by moving an active flag carrier midway through a round. Leaving does not force a forfeit; remaining players can continue and friends may join in progress. New arrivals receive the current map, mode, team, scores and flag state.

Offline retains the one-to-eight bot setting. The human begins on Red in team modes, and bots fill both teams with a size difference of at most one. Free-for-All has no teams. The bot difficulty setting remains meaningful for reaction, aim and movement.

## Capture the Flag details

Touching an enemy flag picks it up automatically, whether at its base or dropped. The carrier has a visible flag and an on-screen return-to-base objective. No extra touch button is needed. A living player can carry at most one flag; spawn-protected players cannot pick up an enemy flag.

To score, carry the enemy flag within the base's interaction radius while your own flag is home. A capture returns the enemy flag to its base and increments the team score once. If your flag is missing, the HUD says to recover it. Use a 1.2-unit horizontal interaction radius for pickup, return and capture on the flat playfield.

Death or disconnect drops a carried flag at the carrier's valid ground position. A teammate touching their own dropped flag returns it immediately; an opponent may pick it up. A dropped flag returns automatically after 15 seconds if untouched. Dead players cannot interact with flags. Round restart resets flags, scores, ammunition and spawn protection. Flag ownership and all scoring remain controlled by the simulation, never by client claims.

## Offline bot behaviour

Bots must fight other bots as well as the human. They select living enemies, respect cover and friendly-fire rules, credit eliminations to the actual attacker, and use the same mode-scoring rules as humans.

Free-for-All bots seek enemies. Team Deathmatch bots engage the opposing team. Capture the Flag bots split between attack and defence: attackers seek the enemy flag, carriers return to their base, and defenders pursue threats or recover their dropped flag. Carriers whose own flag is missing prioritise recovery or remain near their base until a teammate returns it. Objective movement continues even when an enemy is not directly visible.

The current navigation grid must support several targets instead of a single field aimed at the human. Cache navigation fields for active objectives and selected targets, reuse them between bots and limit recalculation frequency. Test that every base and spawn is reachable on every map.

## Technical approach

The recommended approach keeps the existing Three.js renderer, Android wrapper, solo runtime and authoritative room server, and adds shared map definitions, skin definitions and pure mode rules. It limits changes to the parts needed for this update, though both combat runtimes still need explicit integration tests.

The alternative is to merge solo and online combat into one complete simulation engine first. That would reduce duplicated combat logic but require a larger migration and broader regression testing. It is not required for this feature set; shared mode rules provide consistent objectives and team scores without that rewrite.

Map definitions contain plain geometry records, palette/environment, collision solids, spawns and bases. Rendering and server physics consume the same records. Server collision and raycast data are cached per map, not held in a single module-wide Courtyard instance. Map loading disposes old geometry, bots, remote avatars and transient effects, then rebuilds navigation before spawning anyone.

Skin definitions and avatar construction are shared by the Home preview, bots and remote players. Reuse the existing preview-rendering pattern and release unused resources. Do not require downloaded textures or additional game-engine dependencies. All maps and skins remain bundled for offline use.

Shared mode rules receive plain participant records with stable IDs, teams, positions, alive state and spawn protection. They own the clock, personal and team scores, flags, elimination consequences, disconnect cleanup and match result. The offline game and online server call these same rules. Rendered objects and network connections do not belong in rule state.

Online room state gains map ID, mode ID, team scores, winning team and flag state. Player snapshots gain skin and team IDs. Validated room settings and cosmetic requests are separate from movement input; clients cannot assign themselves teams, claim captures or update scores. Only the host can change room settings outside active play. Preserve existing message-size/rate limits and safe handling of invalid IDs.

The HUD adapts to the mode: personal kills in Free-for-All, team score in Team Deathmatch, and captures plus both flag statuses in Capture the Flag. Keep health, ammo, joystick, aim, jump, reload and firing controls available on smaller landscape displays.

## Compatibility and release

Preserve 500 initial total rounds for all 28 weapons, existing magazine sizes and reload conservation. Switching guns cannot replenish ammunition. Respawn and new rounds replenish it as before. Keep secure WSS, packaged Android assets and the parked-play reminder.

The existing public link remains temporary; this update does not create permanent hosting. Coordinate any required server restart, and deliver a rebuilt debug APK containing the same tested game version. Older multiplayer clients must receive a clear update-required error if their protocol is incompatible, not enter a room with the wrong world or rules. Keep offline play usable independently of server availability.

## Acceptance checks

- Eight distinct layouts render, with clear spawns, connected bases, collision parity and no stale resources after repeated switching.
- Home confirmation cancels cleanly or ends/leaves the correct session; existing Pause and Android lifecycle behaviour remain correct.
- All skins preview, persist and appear on other clients without changing hitboxes or hiding team affiliation.
- All 24 map-and-mode combinations start offline and online. Automated coverage checks configuration and rules; screenshots inspect each map's appearance.
- Offline bots attack enemies, spare teammates, score for their teams and complete flag pickup, return and capture objectives.
- Mode tests cover scoring limits, draws, repeated events, flag drops on death/disconnect, automatic returns, protected/dead-player restrictions and no scoring after a round ends.
- Independent clients agree on map, mode, skins, teams, scores and flags. Host-only settings, late joins, host transfer, room isolation and incompatible-client errors are tested.
- Existing ammunition, weapon, touch and offline tests still pass. Native smoke checks verify offline startup and a real secure multiplayer connection in the final APK.
- Inspect Home and HUD at 960 by 540 and larger landscape resolutions. Test on a disposable Android emulator and state that physical BYD head-unit testing remains outstanding.

## Review status

The written design is approved. The next step is review of the implementation plan and an execution-method choice required by the Superpowers architectural workflow. Product code, the live server and the APK are unchanged by this design step.
