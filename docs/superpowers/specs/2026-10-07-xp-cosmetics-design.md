# XP and cosmetic unlocks

Date: 2026-10-07

Status: written design and implementation plan approved on 2026-10-07; user selected Native execution. Implementation underway. Public deployment has not started.

Baseline: Block Ops 0.6.0, source `f9a1261`, Android version code 8, network protocol 4. Work stays in the existing checkout; unrelated files, the published game and previous release artifacts remain untouched during design.

## Intent and approved choices

Give players a lasting reward for playing: earn XP, level up, unlock new appearances, and find that progress still there after closing and reopening the game. The main target remains touchscreen play on the parked BYD, with browser support, offline solo play and online friends.

The user chose:

- Both character skins and gun colours, with no damage, health or hitbox advantages.
- Separate local progress on each device, without accounts or cloud synchronisation.
- Keep earned action XP when leaving early, with an extra bonus for finishing.
- Quick first rewards, targeting roughly one or two typical matches, then progressively longer between unlocks.
- Automatic rewards at fixed levels, alternating character skins and gun finishes; no reward picker, currency or shop.
- Eight new character looks and eight gun finishes in the current blocky style. Existing skins stay available and visually unchanged.
- Automatically save XP, levels, unlocked cosmetics and equipped looks so fully closing the game or restarting the BYD does not normally reset progress.

Alternatives discussed were character-only or gun-only rewards, account-based cross-device progress, completion-only XP, slower initial progression and choosing a reward at each level. The selected design keeps offline play and predictable unlocks without accounts or a second currency. The game-design skill informs the short play/reward loop, early attainable milestones and cosmetic-only progression.

## Play loop and XP rules

Play any existing solo bot mode, solo Zombies, or online FFA/TDM/CTF. Earn action XP as legitimate scoring actions occur. Apply each gain to the local profile immediately, show a compact notification, and unlock every level crossed by that gain. Returning Home, leaving a room or closing the app never deliberately deducts credited XP. Starting a new life or match does not reset lifetime progress.

Initial values:

| Action | XP | Who receives it |
| --- | ---: | --- |
| Enemy bot or online-player elimination | 10 | Credited killer only |
| Zombie elimination | 2 | Local player |
| Flag capture | 50 | Player who actually captures |
| Manual return of the team's dropped flag | 10 | Player who returns it |
| Complete a zombie wave | 25 | Local player |
| Finish a qualifying match or zombie run | 50 | Eligible local participant |
| Win a qualifying FFA or team match | 25 additional | Winner or eligible member of the winning team |

Normal-match completion requires the player to have earned at least one action award in that match and still be participating at the natural end. A draw can earn completion XP but not win XP. A zombie run earns its completion bonus on game-over after clearing at least one wave; there is no zombie win bonus. Leaving early keeps action XP but grants neither completion nor win bonuses. Joining an already-ended room grants no past awards. This also prevents a player who scored nothing from earning bonuses merely by being left alone in an online room.

All normal bot difficulty choices use the same rates in this release. No XP is awarded for damage alone, headshots separately, friendly fire, self-damage, dying, collecting loot, picking up or dropping a flag, automatic flag returns, waiting in a lobby, or merely opening a results screen. A grenade multi-kill awards each valid enemy elimination once; repeated reporting of the same victim life does not. New respawned lives remain valid new kills. Zombie kills and wave completion stack; reporting cumulative zombie records repeatedly must not award them repeatedly.

There are no daily caps, streak penalties, random rewards or real-money purchases. This is a local prototype progression system, not a competitive economy or tamper-proof account service.

## Levels and fixed reward track

Start at level 1 with zero XP. The cost to advance from level `L` is `150 + 50 × (L - 1)` XP for levels 1 through 16. Thus level 2 requires 150 lifetime XP, level 3 requires 350, and level 17 requires 8,400. The first-reward timing is a playtest target, not a guarantee regardless of performance.

Level 17 is the end of this release's reward track. Lifetime XP continues to be recorded, but the level remains 17 and the next-reward panel says **All rewards unlocked**. Progress does not reset and there is no prestige system. Counts are nonnegative integers, saturating at 2,147,483,647 rather than overflowing. Levels and ownership are derived from validated lifetime XP and the fixed catalogue, not separately editable persisted counters.

| Level | Reward type | Reward |
| ---: | --- | --- |
| 2 | Character | Crimson Ninja |
| 3 | Gun finish | Crimson Red |
| 4 | Character | Midnight Ops |
| 5 | Gun finish | Ice Blue |
| 6 | Character | Frost Unit |
| 7 | Gun finish | Forest Camo |
| 8 | Character | Solar Guard |
| 9 | Gun finish | Violet |
| 10 | Character | Golden Ninja |
| 11 | Gun finish | Orange |
| 12 | Character | Urban Ranger |
| 13 | Gun finish | Arctic White |
| 14 | Character | Lava Unit |
| 15 | Gun finish | Stealth Black |
| 16 | Character | Void Guard |
| 17 | Gun finish | Gold |

The original eight characters and a **Standard** gun finish are always available. Standard reproduces each gun's existing appearance. Unlocks do not automatically equip themselves: the player keeps their selected look until they choose another unlocked one. Crossing several thresholds grants all intervening rewards exactly once, without blocking gameplay with several dialogs.

## Cosmetic appearance and selection

Use the existing procedural box-based avatar parts, lighting and weapon shapes. New looks combine existing headgear/accessory parts with distinct palettes; do not redesign the existing Ninja or other original skins. Suggested combinations are Crimson Ninja with tied hood/pouches, Midnight Ops with patrol helmet/radio, Frost Unit with sensor antenna/bedroll, Solar Guard with sealed helmet/power pack, Golden Ninja with tied hood/light strips, Urban Ranger with field hat/pouches, Lava Unit with sensor antenna/air tanks, and Void Guard with sealed helmet/light strips. Keep team badges visible from all existing tested directions and retain the shared combat hitbox.

Gun finishes are a single global appearance preference applied to every gun the player holds, including collected guns. They are not separately unlocked or selected for each of the 28 guns. Use flat, contrasting colour treatments; Forest Camo is a green/tan block-colour treatment, not a realistic or animated texture. No generated images, external asset downloads, shader effects, added particle systems or geometry inflation are required. Standard must preserve the old materials and geometry visually.

Show the selected appearance in the Home character preview, Armory weapon preview, first-person gun and online peers' held weapons/avatars. First-person hands, knives, grenades, zombie appearances and ordinary bot cosmetics are unchanged. Ground loot and death-drop gun models keep their ordinary neutral appearance; when collected, the holder's selected finish applies. Finishes never transfer an ownership unlock through a dropped gun and never alter inventory contents, gun identity, ammunition, damage or physics.

Extend the existing Home skin selector with locked/unlocked cards and required-level labels. Put the global gun-finish selector beside the existing Armory preview, separate from the numbered gameplay loot inventory. Do not introduce another inventory screen or put persistent cosmetics into loot slots. Locked items can be inspected with their name and level requirement but cannot become equipped. Keep the selected preview and selected card consistent.

Appearance selections outside a live match apply immediately to previews and the next match. During a live match they are saved as **Next respawn** choices, following the existing character-skin rule; in Zombies, which has no respawn, label this **Next run**. Both skin and finish use this rule. Respawning or starting a fresh match applies the saved choice. Closing and reopening the app retains it. Online peers see the authoritative current appearance, not a locally predicted or still-pending one.

## Automatic saves and recovery

Create one versioned progression profile in local storage, separate from existing settings, online address/name and zombie personal-best records. Its authoritative fields are lifetime XP, equipped character/finish IDs, a schema version, and a bounded recent-receipt ledger used to reject duplicate XP. Derive the displayed level and unlock set from XP so those values cannot disagree. Existing selected skin migrates into a new profile on first use; old settings, loadout and zombie records are preserved.

The stored appearance IDs represent the player's desired choices, including a pending next-respawn choice. Reconciliation of a current online avatar must not replace a newer saved preference with its older still-active look.

Save synchronously whenever credited XP changes or an equipped cosmetic is changed. Save the XP total and its receipt high-water mark together as one serialised primary record. A duplicated callback after a successful save must not credit again. Do not rely on unload, quitting, Android Back or a match-end callback for persistence. UI completion acknowledges a persisted save only after its write succeeds.

Maintain a best-effort previous valid profile as a backup in a second local-storage key. Never replace the backup with malformed data. On startup use a valid primary; otherwise recover a valid backup and show **Recovered previous save**. Recovery may lose changes after that backup. If no readable valid save exists, keep gameplay available with a clearly identified temporary session, preserve any unreadable stored records and do not silently overwrite them. Missing save data on a genuine first run starts normally at level 1. Unsupported future schema versions are not silently downgraded or overwritten.

Validate record size, field types, known IDs, bounds and ownership. Malformed receipt entries cannot grant XP; an unusable core record uses the recovery path. An unknown or locked equipped appearance falls back to an available original skin/Standard, without erasing valid XP. Blocked storage, quota errors and a denied storage getter must not crash startup or gameplay. Keep session progress in memory and show **Progress is not saved — storage unavailable** until a complete write can succeed. A failed backup write alone does not falsely mark a successful primary write as lost, nor does it block that primary write.

The persistence promise covers normal app/browser close, force-stop/relaunch after a confirmed save, offline restart and signed APK upgrade-install without clearing data. No software-only local save can promise survival of uninstalling, clearing app/browser data, device failure or abrupt power loss before storage is durably flushed. Browser progress belongs to the same browser profile and website origin: a new temporary tunnel hostname does not automatically inherit the old website's save. The APK uses its stable packaged origin, so changing its configured multiplayer server does not reset its local XP. No export/import or cross-device transfer is included. Simultaneous sessions writing one browser profile are outside this first release's supported use; no cross-tab merge guarantee is made.

## Duplicate-safe match accounting

Separate award accounting from results, HUDs, notifications and animation events. Each real solo round/zombie run receives a unique session identity, and each online start receives a fresh server round identity. A rematch is a new round; returning to a menu or re-rendering a result is not.

Track cumulative earned XP for one participation, including single-use completion/win markers. The local profile applies only the positive difference above that participation's previously credited amount. Retain the 64 most recently updated participation receipts, with bounded IDs/counters. Only the active gameplay session's receipt can enter the reconciler; stale UI work from an older round cannot create a new award when an older ledger entry has been evicted. Offline restart starts a new run, not a replay of an old run's credit callbacks.

For online play, receipt identity includes server origin, server round ID and player participation ID. A disconnect/rejoin creates a new participation, even if the room is still on the same round; start its counters at zero. Late joiners do not inherit other players' kills or pre-join objectives. Generate the round ID on an actual start, not merely when the host reconfigures a lobby. Award round-end bonuses only on the actual transition to ended for eligible participants, not whenever an ended snapshot is requested.

The server computes online awards from accepted eliminations and actor-attributed flag events before transient render events are consumed. Send the recipient's cumulative receipt alongside their existing private equipment in welcome/state packets. Include the cumulative action-count breakdown and completion/win markers as well as the earned total, so results can explain the award without reconstructing missing events. Validate that their weighted, saturating sum equals the claimed total and that the fields are possible for the mode. The client validates the receipt against the room and its own player identity, then reconciles/saves it even when a menu is open. Missing an intermediate snapshot is safe because the next cumulative receipt includes the earlier awards. Repeated and lower totals cannot add XP. Do not derive durable earnings from the capped/transient public event array or from `showResults()`, which currently has more than one call path for the same end transition.

Leaving or disconnecting retains all received and successfully saved awards. An action whose final server receipt never reaches the device before an abrupt disconnect cannot be guaranteed; do not invent retrospective XP from local hit effects. No account-backed recovery service, persistent online player identity, reconnect resume or guarantee of unreceived XP is added.

## Components and protocol

- A pure XP/rank/reward module owns award values, level thresholds, reward ownership, integer bounds and cumulative accounting. It imports no renderer, DOM or socket code.
- A profile-store module owns schema validation, migration, atomic primary writes, backup recovery and save-status reporting. Inject storage for deterministic error/restart tests; use no account service.
- A cosmetic catalogue defines stable IDs and palette/part combinations. Existing avatar/weapon constructors consume validated appearance choices, own/dispose their resources, and do not mutate the shared gun statistics catalogue or another model's materials.
- A small progression UI adapter renders Home XP/next reward, lock labels, selectors and results summaries. Game and server adapters provide authoritative scoring facts; result rendering itself never grants an award. Keep this logic out of the already large `main.js` except for wiring.
- Online room state adds the round identity and current/pending gun finish; private packets add the cumulative own receipt. Cosmetic requests accept known IDs only and retain message-size/rate limits. Upgrade all exact-shape validators deliberately, without weakening existing health, equipment, life-ID or event validation.

Target network protocol 5, browser/package version 0.7.0 and Android version code 9. Older protocol-4 clients receive clear update guidance rather than joining incompatible rooms. Retain the package ID, signing identity, minimum Android version, permissions, ES2017 build target and WebGL1 fallback.

Unlocked ownership is enforced by the normal local game's selectors and persistence validation. The server can validate known cosmetic IDs and current/pending replication, but cannot securely prove offline-earned ownership without accounts. Do not claim that modified clients cannot select a known locked cosmetic or edit local XP. Lifetime XP and the full unlock ledger are not broadcast to other players, and no leaderboard or public rank badge is added.

## Feedback and layout

Home shows level, XP towards the next level, next reward and save warnings where necessary. The next-reward preview is clearly labelled, not mistaken for an equipped skin. Results show this match's credited XP breakdown, lifetime level progress and newly unlocked rewards. Reopening results repeats the summary without awarding again. Early exit returns Home with the already-updated total; there is no extra exit bonus.

During gameplay use a short, non-modal XP/unlock toast, coalescing rapid gains. Do not cover the crosshair, health/armour, numbered loot, joystick or fire buttons, and do not steal aim input or pause a match. Use the existing audio system for a restrained optional unlock cue, respecting Sound off; no audio asset dependency. Opening cosmetic controls retains existing offline pause and online neutral-controls/live-clock behavior.

Check Home and Armory with 16 characters and nine finishes, including Standard, at 854×480, 1200×700 and 1280×720 and control sizes 1 and 1.3. Locked labels, save warnings and large XP totals must not clip controls or force a desktop-only layout.

## Acceptance and delivery

Use red/green tests for rank boundaries, multi-level awards, saturation, original-skin ownership, locked selections, duplicate/lower receipts, current-session gating, rematches/late joins and completion eligibility. Cover every XP action and non-action above, including manual versus automatic flag return and zombie cumulative reports. Keep all existing combat, headshot, knife, inventory and supply behavior unchanged.

Persistence tests must use a newly constructed store/runtime after each save, not only read the old in-memory instance. Exercise valid-primary precedence, valid-backup recovery, corrupt or unsupported data preservation, missing/denied storage, quota failure, retry, migration and equipped-look restore. Test profile reset only on explicitly isolated test storage, never the user's browser profile or installed car app.

Browser acceptance must earn a genuine early unlock through real play, select it, leave early, fully close the browser context, reopen a persistent test profile at the same origin and verify XP, level, ownership and appearance. Repeat through normal match completion to demonstrate one bonus. Use separate peers to verify current/pending character and finish replication and actual appearance, not only labels. Test all existing mode families and modern/legacy paths. Synthetic profiles may exercise high-level layout/catalogue boundaries, but do not substitute for actual XP earning/save/relaunch acceptance.

On an explicitly owned Android emulator, verify offline earning, force-stop/relaunch with retained progress and cosmetic choices, background/foreground behavior, and same-signed upgrade-install preserving app data. Never uninstall or clear app data as a shortcut for the persistence gate. Test online XP and both peer cosmetics through a separate owned TLS staging route. Keep real BYD rendering, responsiveness and power-cycle behavior as a parked-device acceptance check by the user; emulator evidence does not prove car hardware behavior.

Preserve original eight-skin/Standard-gun visual baselines, identical combat hitboxes, readable team markers and per-model material/disposal independence. Test all 28 guns against all nine finishes and the new avatar combinations. Run the existing regression suite and relevant browser/Android matrix against frozen final assets, check APK signer/version and bundled asset equality, and retain failure logs and release evidence.

No public restart or tunnel change occurs during design, implementation or ordinary test runs. Delivery requires verified candidate assets/APK, fresh live process/URL discovery, exact rollback snapshots and a newly coordinated empty-room window. Do not reuse the previous feature's maintenance approval, historical PIDs or test ports. Coordinate protocol-5 browser/server/APK deployment, retain old artifacts, validate the current bundled default and preserved saved settings, then verify the live route before reporting it updated.

## Scope boundary and next approval

No new maps, combat upgrades, aim assist, minimap, gun effects, new zombie behavior, cosmetic drops, loot boxes, paid purchases, login, cloud sync, cross-device save transfer, permanent hosting or unrelated refactoring. Those remaining roadmap features are not part of this delivery.

The user approved this written design, including the XP values, level-17 reward-track endpoint, reward list, next-respawn appearance rule and local-save limitations. Written-spec approval permits preparing the implementation plan. Coding begins only after that plan is reviewed and its execution method is selected.
