# Health and armour pickups

Date: 2026-10-05

Status: conversational design approved; written spec awaiting user review.

Baseline: `171367c` / Block Ops 0.5.1. No implementation or deployment is approved by this document alone.

## Intent and delivery scope

Add useful survival supplies to the existing explore, fight, collect and equip loop without creating another inventory screen. The player should recognise pickups, carry them alongside guns and grenades, and choose when to spend five vulnerable seconds recovering. Touchscreen play on the parked BYD remains the primary interaction; browser and Android builds must retain offline and legacy WebView support.

This is the first of five remaining upgrades requested for **all applicable modes**: health/armour pickups, minimap, optional touch aim assist, improved gun effects, and XP with new cosmetic unlocks. Solo Zombies is already delivered. The other four upgrades remain in the requested roadmap but are not implemented by this spec; each needs its own focused design and plan. Existing skins remain available and unchanged.

This feature covers all eight existing maps, solo FFA/TDM/CTF, solo Zombies, and online FFA/TDM/CTF. It does not add online zombies or online bots.

The game-design skill informs the recovery choice, clear feedback, predictable supply locations and preservation of the existing single-inventory loop. Armour provides survivability, not extra damage or permanent progression.

## Approved gameplay

| Item | Carry limit | Use time | Result |
| --- | --- | --- | --- |
| Health pack | 3 | 5 simulation seconds | Restore health to 100 |
| Armour pack | 3 | 5 simulation seconds | Add 50 armour, capped at 100 |

- Walking over an eligible pickup adds one pack to its inventory stack; it does not apply the effect or change the equipped weapon.
- Both stacks appear in the existing top-left numbered inventory, alongside the other loot. No separate supplies screen or tab.
- Tap a stack to start using one pack. Movement and looking remain available, but shooting is blocked during use.
- Getting hit does not interrupt the five-second timer. Damage still applies normally and can kill the user.
- Switching equipment cancels use without spending the pack. A pack is not spent when its corresponding resource is already full.
- Unused packs drop on death in solo bot and online matches and can be collected by others. Zombie runs start fresh on replay.
- Regular bots collect and use packs under the same capacity, timing and damage rules. Zombies never collect or use them.
- Armour takes damage before health. Its bar and a small use-progress indicator are part of the existing HUD.
- Supply locations are fixed and spread out on every map.

Alternatives considered: immediate-use pickups versus carried packs; random versus fixed supply locations. Carried packs were selected by the user to match the inventory. Fixed locations were approved for learnable emergency routes, accepting less location variety between matches.

## Detailed rules proposed for written-spec approval

The following make the approved behaviour precise. Values not separately selected in conversation are implementation defaults presented for review here, not claims that they have shipped.

### Vitals and damage

- A new life starts at 100 health, 0 armour and no packs. Armour is a separate finite resource in the range 0–100, not health above 100 or a percentage resistance.
- After existing friendly-fire, spawn-protection, alive and active-round checks, apply damage point-for-point to armour first and then health. For example, 30 damage at 20 armour and 100 health leaves 0 armour and 90 health.
- Guns, knives, explosives and zombie attacks all use that rule. Armour-only hits still produce hit feedback, but not an elimination.
- Existing weapon damage is unchanged: knife 50, explosive maximum 90, and gun headshots exactly 10,000,000,000. A headshot remains fatal through full armour.
- Zombie damage remains `10 + 5 * (wave - 1)` with no cap. Armour adds protection without changing that formula: a wave-19 hit still deals 100, which full armour can absorb; an unarmoured player still dies at 100 health.
- Armour never regenerates, drops as an applied resource, or persists through respawn/replay. Only unused armour packs are loot. Reject non-finite or negative damage at the shared damage boundary.

### Use lifecycle

- Only a living actor in an active round can start use, with an owned pack and a resource below its maximum. Full health does not stop collecting health packs; the capacity is the collection limit.
- Only one use operation can be active. Its state contains the supply type and remaining simulation time. It retains the current gun/knife selection; using a pack never triggers starter-gun removal.
- Starting use requires the active gun's reload and any melee/throw attack lock to have finished. While using, block guns, knife swings, grenade throws and starting reloads. Movement, jumping and looking remain available; aiming/zoom stays under the existing movement rules.
- Spend one pack only when five seconds have elapsed since the accepted start and the effect is committed. Do not count simulation time from before that start or use wall-clock catch-up after an offline pause. The pack remains in its stack and counts against capacity while use is pending.
- Recheck alive state, round state, ownership and resource need at completion. If full, cancel without consumption. A successful completion applies the effect and decrements the stack exactly once.
- Tapping the active supply stack again cancels. Tapping the other supply type switches to a fresh five-second use only if that new use is valid; an invalid request leaves the current operation alone.
- The UI sends a distinct cancellation intention for that second tap. A repeated start intention for the already-active type is rejected without resetting its timer; cancelling when nothing is active is a harmless no-op. This separates deliberate cancellation from duplicated start requests.
- A successful gun, knife or grenade-selection action cancels use. Invalid or rejected equipment actions do not cancel it. Equipment selection does not fire or throw automatically.
- Starting, completing or cancelling use must not replay queued attack inputs. Clear attack/reload latches without clearing movement input. Existing equipment and recovery attack locks remain additive; the HUD must not accidentally re-enable Fire.
- Damage is resolved before due supply effects are committed for that simulation step. A fatal hit wins over healing due on the same step; there is no resurrection. Clear pending use on death and terminal round transitions. Do not subtract time twice through equipment and runtime updates.
- Offline pause, settings, loadout menus and background suspension freeze simulation time and therefore use progress. Resume is explicit. An equipment change in a menu can still cancel use.
- Online menus/background suspension pause controls, not the server match: an already-started use continues on the server, as other timed gameplay does. New use requests are disabled in suspended client UI. Death, leaving, disconnect or round end clears that player's operation; no operation transfers to a new life or room.

### Maps, collection and drops

- Add two health-pack slots and two armour-pack slots per map, for 20 authored map slots instead of 16. Each slot provides one pack and uses the existing 20-second map respawn timer.
- Preserve the positions and identities of all eight guns, two knives and six grenades per map. Do not undo the earlier spread-out-guns change.
- Author each new supply pair on opposite team ends using rotated counterparts. New supply points must be ground-level, inside bounds, clear for radius 0.42, reachable from the map's player/team spawns, and outside the 1.2-unit interaction radius of spawns and flag bases.
- Require at least 3 units between a new point and any other loot point, and at least 10 units between the two points of each supply type. Compare sorted minimum walking distances from red and blue team spawns for each supply type: corresponding distances must differ by no more than 4 units. Coordinate authoring and all-map placement tests belong to implementation.
- Reuse the shared pickup radius (1.2), vertical reach (0.75), line-of-sight and stable nearest-eligible-actor arbitration. A full stack leaves the pickup on the ground and does not prevent another eligible actor collecting it.
- In respawning modes, death emits one world pickup per unused pack, including a pack in an unfinished use. It follows existing drop unlock (0.5 seconds), expiry (30 seconds), duplicate-life prevention and oldest-first world-cap eviction. Retain the 48-drop bound; under saturation, older world drops can expire early through the existing eviction rule.
- In ordinary respawning modes, clear the victim's packs, pending use and armour after collecting its drop items. Respawn grants no free packs. Zombie human death ends the run rather than producing a playable respawn/drop phase; replay clears run inventory and armour. Zombies still drop nothing.

### Regular bots

- Bots use the same pickup eligibility and shared supply operations as humans; no granted packs, shortened timer, damage immunity or instant healing.
- Keep existing enemy/CTF movement intent. This first version collects supplies encountered along those routes; it does not introduce a new scavenging/pathfinding subsystem or abandon flag objectives to seek packs.
- When not already using a pack, a bot chooses health first if health is at most 50 and a pack is carried; otherwise armour if armour is at most 50 and a pack is carried. It starts only when the same reload/attack eligibility checks pass. An unsuccessful attempt must not consume supplies or lock combat.
- While using, continue normal permitted movement but suppress automatic equipment switching, reloads and attacks. Otherwise existing per-step weapon selection could repeatedly cancel the operation. Ordinary combat/equipment decisions resume after completion; no queued attack is replayed.
- Flash does not interrupt an already-started use, but a flashed bot does not initiate new supply decisions. Existing flash/smoke movement and targeting restrictions remain intact.

### Zombie recovery

- Keep the existing wave-clear heal to 100, ammo refill and ten-second preparation break. Do not replace them with packs or grant packs for clearing waves.
- Settle wave-clear recovery before committing supply effects due on the same step. Cancel an active health-pack use without spending it when recovery restores health.
- Preserve the current armour value and both inventory stacks across waves. Recovery does not refill armour. An active armour-pack use continues normally, and armour packs can be used during the preparation break.
- Player death remains terminal and takes priority over both recovery and supply completion. Preserve the existing damage scaling, enemy count, speed, spawn and ammo rules.

## Architecture and state ownership

Extend the existing shared loot/equipment pipeline, not independent solo and online copies. The current integration points are `src/equipment.js`, `src/loot.js`, `src/game.js`, `server/rooms.js`, `src/gear-protocol.js`, `src/network.js`, `src/online-game.js` and `src/equipment-ui.js`.

Focused shared modules keep responsibilities separate:

- `src/vitals.js`: armour limits, validation and point-for-point damage calculation. It has no Three.js, DOM, network, enemy or mode dependency. Runtime adapters retain responsibility for protection, enemy checks, death, scoring and feedback.
- `src/supplies.js`: supply constants, start/cancel/progress/complete rules and bot supply choice. It operates on explicit equipment and vitals references, uses injected simulation time, and reports results instead of accessing UI or sockets. Inventory serialisation remains in the equipment module; avoid a circular import.
- Existing equipment state gains `supplies: { health, armour }` with integer counts 0–3, and `supplyUse: null | { type, remaining }`. Active use requires a positive count of its type and a finite remaining time above 0 and at most 5. Resolve or cancel due operations before exposing snapshots, so zero-remaining active states are never serialized.
- Loot items gain the exact shape `{ kind: 'supply', supplyType: 'health' | 'armour' }`. Extend explicit item-kind branches; current grenade fallbacks must not interpret supplies as grenades. Supply amount and effect are catalog rules, not arbitrary item payloads.
- Authoritative actor entities gain `armour`; projections include vitals needed for decisions but never become accidental copies on which healing is lost. Refresh actor projections after changing authoritative vitals. Zombies have no supply equipment and default to zero armour when taking damage.
- Solo game and room-manager adapters advance operations once, route shared effects to actual entities, retain combat order and handle terminal transitions. Reuse a single attack-eligibility predicate where practical without unrelated game-loop rewrites.

Map models and UI read state; they do not determine eligibility or apply health. No new dependencies, accounts, services, persistent pack storage or cloud writes are required.

## Online contract and compatibility

- The server owns pack acquisition, counts, use progress, effect completion, armour and damage. Clients send intentions, never health/armour totals or elapsed-time claims.
- Bump the shared wire protocol from 3 to 4 because item kinds, equipment DTOs and exact-key player snapshots change. Old and new peers receive the existing explicit update-required response rather than silently accepting incompatible snapshots. Offline old APKs remain usable.
- Extend existing life-scoped, monotonically sequenced equipment actions with `use-supply` plus `supplyType`, and `cancel-supply` without additional payload fields. Apply the existing exact-key, active-room, alive, life-ID and duplicate-action checks. Count/effect mutation happens only on validated server state.
- Add public `armour` to player snapshots, including 0 for lobby/dead players. Counts and `supplyUse` remain in the recipient's private equipment snapshot; this version does not broadcast other players' inventory or use animation.
- Validate armour as finite 0–100, counts as integers 0–3, active use against ownership and remaining time, and dead-player empty inventory/no active use. Reject malformed or inconsistent snapshots instead of producing a blank play screen.
- Reconcile armour and use progress into the online local-player model from snapshots, including while menus are open. Display progress from acknowledged state; never decrement inventory or grant healing speculatively. Repeated taps may send intents but cannot produce multiple simultaneous operations or duplicate completion.
- Retain existing pickup events, now supporting the new item shape. Supply completion feedback can use acknowledged same-life state transitions; ignore old-life/old-round transitions and initial connection when deciding to play completion feedback.
- Increase the map-item validation bound from 16 to 20 and the total loot-array bound from 64 to 68. Retain drop/projectile/smoke limits and strict schemas. Centralise shared world-cap constants to prevent server/client disagreement.
- Maintain the server's existing bounded action handling and stale input rules. A forged attack packet during active use cannot bypass the server combat gate. Pause is not a server freeze or protection mechanism.

## Presentation and compatibility

- Two distinct low-cost blocky world pickups: a light medical case with a green health symbol, and a blue armour-plate case with a shield symbol. Add text labels in inventory so colour is not the only distinction. Use the existing geometry/material pipeline, not generated art or expensive effects.
- Append non-empty Health Pack and Armour Pack stacks after existing gun/knife/grenade entries, in that order. Show `x1`–`x3`; preserve the existing contiguous slot numbering, horizontal scroll, gesture cancellation and life/round-safe touch handling.
- Active use highlights its stack and shows `HEALING` or `ADDING ARMOUR`, seconds remaining and a simple progress bar. Tapping the active stack cancels; no additional full-screen UI. Display server-acknowledged progress online and simulation progress offline.
- Show a labelled numeric armour bar next to/below health without covering the top-left inventory or Home/Loadout/Pause controls. Keep Fire/Throw/Reload disabled while using without disabling movement or valid inventory cancellation.
- Lower the existing held model during use and restore it on cancellation/completion/death. No new character skins or remote healing animation are part of this update.
- Reuse pickup sound and add a short lightweight completion cue, respecting sound-off settings. Supply labels replace existing grenade-only fallback messages in both solo and online paths.
- Preserve ES2017 output, WebGL1 and legacy CSS/DOM fallback paths. Check small landscape layouts and large-control settings, especially inventory scrolling with both new stacks present.

## Error handling and acceptance evidence

Rejected full-resource, missing-pack, incompatible-action or inactive-life requests return a short reason without changing state. No failure may spend a pack, cancel an unrelated valid operation, grant health, change the starter gun, or erase existing loot. A use operation cannot outlive its actor's life or round. Storage denial must not affect this session-only feature.

Required verification after implementation:

- Test-first shared rules: 4.999 seconds versus completion, cancellation/restart, repeated start, simultaneous effects, cap/full-resource handling, pending-pack capacity, negative/non-finite values, fatal damage on completion, armour overflow into health, protected/friendly damage, and exact existing headshots/zombie scaling.
- All-map placement tests: 20 stable slots, unchanged existing loot coordinates, valid reachability/clearance, spread/fairness bounds, two packs of each type, deterministic contested collection, no through-wall/vertical pickup, and 20-second respawns.
- Real headless solo game: human and bot collection/use, movement during use, no gun/knife/grenade/reload bypass, bot switching suppression, death drops/respawn reset, pause/resume, results and replay.
- Zombie integration: no zombie packs/armour acquisition, five-second use during combat, death priority, recovery cancelling health use without consumption, continuing armour use, armour/inventory preservation across waves and fresh replay.
- Server/protocol tests: one winner for contested supplies, concurrent/repeated/stale-life actions, invalid fields/types/counts/timers/armour, max inventory/world bounds, armour damage and synchronized two-client observation, mixed-version update messaging, round-end/disconnect cleanup and no trust in client effect claims.
- Browser acceptance using repository automation and the installed Playwright CLI: real pickups and taps, scroll versus select gestures, complete/cancel/use effects, full-resource feedback, all modes, two-client online play and screenshots/console review. No production state-injection hooks solely to pass acceptance tests.
- Layout/compatibility checks at 854x480, 1200x700 and 1280x720, including touch, large controls and the legacy WebView profile. Run the existing unit and relevant home, input, loot, inventory, configuration, multiplayer, zombie and WebView regressions.
- Build the APK from the same verified browser assets; verify embedded assets, version, signature and upgrade install. Exercise offline rendering, real touch interactions, Back/background lifecycle and online play in an owned Android emulator. A physical parked-BYD check remains necessary; browser/emulator evidence cannot establish device performance.

## Delivery boundary

This is design-only work. The written spec needs user approval before writing the implementation plan; the written plan then needs review and an execution-method choice before code changes. Do not rebuild the APK, mutate the running browser server, restart a tunnel, install dependencies or publish a release during spec review.

The later implementation plan must include candidate build/version/hash evidence and an explicit browser/APK handoff. Preserve existing release artifacts and rollback snapshots. At an authorized release, revalidate the exact server and hosting identity, wait for rooms to be empty, and never kick players or restart the tunnel merely to update assets. Do not merge, push or include unrelated dirty worktree files without authority.

No changes to vehicle driving restrictions, existing skin appearance, damage tuning, online mode selection, authentication, payments or unrelated systems are in scope.
