# Solo secret powers

Date: 2026-10-12

Status: gameplay design approved in conversation; this written specification is awaiting user review. Written-spec approval permits implementation planning, not coding. The written plan and its execution method must be reviewed before implementation.

Baseline: current `feat/offline-arena` checkout at `7a4c036`, including the existing uncommitted teammate-map work. Preserve all unrelated changes, saved player data, release artifacts and running games. This document does not authorize a public-server restart or deployment.

## Intent and approved choices

Give the owner a hidden, PIN-gated menu for playful solo matches without losing earned progress or changing multiplayer. The user asked for questions first and approved the following gameplay design:

- Works in every existing solo mode: Free For All, Team Deathmatch, Capture the Flag and Zombies, on all eight maps.
- Open from Home or the solo Pause screen by tapping the game logo five times, then entering a locally saved PIN chosen inside the app. There is no preset or universal PIN, and the user must not send their PIN through chat.
- Separate switches for invincibility, unlimited gun ammunition without reloading, and super speed. Super speed has a 2x–5x slider.
- Only the local human receives powers. Teammate bots, enemy bots and zombies keep normal abilities.
- Grenades remain normal collected loot. The feature does not grant weapons, grenades, armour or other inventory items.
- Normal XP and cosmetic unlocks still count and save. Assisted Zombie runs also count toward the ordinary per-map best-wave record; do not create a separate assisted leaderboard or suppress records.
- Powers turn off on match completion, confirmed departure from a match and app restart. The PIN, existing progress and legitimately earned progress remain saved.
- Opening the menu during a match keeps solo gameplay paused.

The loop remains enter a solo match, fight and collect loot, earn rewards, then return Home or replay. Powers change challenge and movement freedom, not the reward system or art style. Use the existing visual language and touch-friendly controls; no new generated art or sound is required.

## Scope and approach

The user considered Home-only setup versus Home plus Pause controls and chose both. Home-only is simpler but cannot adjust powers during a run. Home plus Pause gives the desired control and requires careful pause, focus and session handling.

Use a separate local powers controller and PIN gate, with narrow integration into the existing solo simulation. Do not add powers to ordinary settings, inventory DTOs, room configuration or server messages. This avoids accidentally applying them through the shared online arena.

The earlier custom-match-rules discussion is a separate unfinished design: weapon restrictions, moon gravity and selectable match duration are not implemented by this feature. Preserve those decisions, but do not silently include them here. Co-op Zombies, online owner permissions, flying, extra loot, automatic aiming and progression multipliers are outside scope.

The following implementation defaults complete the conversational design and are proposed for approval with this specification.

## Hidden access and PIN

### Gesture and setup

- Use the existing Home logo and add the same small logo to the solo Pause dialog. Do not add an openly labelled Cheats button to the main screens. Make the logo an accessible control with at least a 44 CSS-pixel touch target.
- Five activations of the same logo within three seconds open the gate. A single activation or an incomplete sequence does nothing else. Reset the sequence on timeout, screen change or backgrounding. A touch activation must not count twice from pointer and synthetic click events; keyboard activation uses the same count.
- When no PIN has ever been saved at this origin, the gate asks the user to create and confirm a 4–8 digit PIN. Preserve leading zeroes; reject non-digit input and mismatched confirmation. Use masked inputs with numeric-keyboard hints.
- Later openings require the saved PIN. Each entry into the menu requires verification; closing the panel clears its unlocked state and input fields. The same stored PIN works at Home and Pause.
- Five incorrect submissions cause a 30-second, app-session-local delay before another attempt. Closing and reopening the dialog does not bypass that delay. This is a convenience deterrent, not tamper-resistant account security.
- First setup opens the controls only after the PIN record has been successfully written and read back. It does not enable any power automatically.

Only Home with no online connection/join in progress, or Pause for a still-live solo round, can open the gate. Attempts from other screens, online rooms or ended rounds do nothing. The dialog traps focus, has an accessible name, and returns focus to the originating logo on normal close. Keep buttons reachable with the on-screen keyboard open and at compact BYD-style landscape sizes; provide scrolling rather than clipping controls.

### Persistence and security boundary

Create a separate versioned key, `block-ops-solo-powers-pin-v1`. Do not add fields to `block-ops-v1`, the strict progression profile, its backup or Zombie records. Never clear any of those stores to reset powers or handle PIN errors.

Store a salted verifier rather than the entered PIN: version 1 uses Web Crypto PBKDF2-HMAC-SHA-256, 100,000 iterations, a random 16-byte salt and a 32-byte derived verifier. Validate the exact versioned record shape, algorithm parameters and byte lengths before use; do not accept arbitrary work factors from saved data. Keep PIN text out of logs, URLs, network requests, result summaries and screenshots. Clear form values and release credential-operation references when the gate closes; do not claim secure erasure of JavaScript memory.

The stored object contains exactly `schemaVersion: 1`, `kdf: 'PBKDF2-SHA256'`, `iterations: 100000`, `salt` (32 lowercase hexadecimal characters) and `verifier` (64 lowercase hexadecimal characters). PIN input is encoded as UTF-8 digits. Reject oversized serialized records above 1,024 characters before parsing. Crypto capability or record-validation failure must never be treated as a successful PIN match.

Guard access to the storage getter, reads, parsing, writes and cryptographic operations. A missing key is first setup only after a successful storage read. An unreadable, malformed or newer-version record stays preserved and locked; never overwrite it with a fresh PIN automatically. A valid existing record can be verified without another storage write. Failed setup writes or rejected cryptographic operations show a local error and leave the gate locked. Ordinary play remains available.

Use capability detection when opening the gate, not an unguarded cryptographic call during game startup. If Web Crypto is absent or unusable, explain that the secret menu is unavailable in that browser/WebView; do not store a plaintext fallback or break the game. Current Android packaging uses the bundled HTTPS origin `https://appassets.androidplatform.net/assets/index.html`, and local browser development uses loopback HTTP. Keep the Android origin unchanged. Actual PBKDF2 support on the physical BYD has not been established and must be tested before claiming device compatibility. No new product dependency is proposed.

The PIN is per app installation/browser origin, like the existing local saves. It does not sync between the APK and browser, or between different preview ports. On an installation with no PIN, the first person completing setup chooses it. This is a hidden local convenience gate, not proof of ownership, an account login, or protection against someone inspecting/modifying the APK or browser storage. No master PIN, recovery backdoor or automatic lost-PIN reset is included. Recovery must never be implemented by erasing the player's app data.

## Controls and session lifecycle

After verification, show one panel with three independent switches, the speed slider, Apply and Cancel. The slider ranges from 2.0x to 5.0x in 0.1x steps, initially 2.0x; turning super speed off restores the normal movement rate. Validate numeric input as finite and within that range, then normalize to the nearest 0.1x; reject non-numbers and out-of-range values. Use a visible numeric value and proper slider labelling.

At Home, Apply prepares an in-memory selection for the next solo match. Starting a match transfers a validated copy to that new solo round and clears the pending selection. Changing map, skin or loadout while still at Home does not discard the prepared selection. A failed start clears powers and returns to a usable Home screen with the existing error message.

During a solo pause, the panel starts from the active round's settings. Apply atomically updates that same still-live round, then returns to Pause. Cancel discards uncommitted panel changes and returns to its origin. Neither action resumes play; the player explicitly presses Resume. Closing with Escape or Back acts like Cancel, not Resume.

All powers and the speed preference are memory-only. After a completed or abandoned match, the next configuration is all switches off and speed 2.0x. Replay does not inherit powers. Pausing, opening Loadout, opening the teammate map and ordinary background/foreground transitions do not end the round or erase its active powers. An actual app restart does.

| Transition | Required behaviour |
| --- | --- |
| Ordinary pause/menu access | Pause solo simulation; clear held movement, aiming, firing and throw inputs. Keep active-round powers. |
| Verified Home Apply | Store pending powers in memory only; no gameplay or profile mutation. |
| Verified Pause Apply | Require the captured live solo round; apply valid values and stay paused. |
| Match naturally ends | Award existing rewards first; clear active and pending powers; show normal results. |
| Confirmed Home/quit | Preserve already-earned rewards and records through existing paths; clear powers. |
| Cancel Home confirmation | Keep the same run and its powers; follow existing resume behaviour. |
| Open online flow or receive an online start | Close/invalidate secret UI and clear pending/active powers before any online arena starts. No PIN or power fields are sent. |
| Background or native pause while gate/panel is open | Clear gesture, PIN inputs, panel draft and unlock state. Return to Home or Pause as appropriate; require explicit Resume for a live round. |
| Failed start, fatal error or app restart | Clear powers, UI drafts and unlock state. Preserve saved PIN/progress; do not auto-resume. |

PIN verification is asynchronous. Capture a UI generation and, when applicable, the solo round identity. Recheck them after every awaited operation and before opening/applying controls. A stale success must not unlock a new screen, change a different match or resume a backgrounded game. First-setup writes may finish after cancellation, but their completion must not reopen the UI or enable powers; the next opening reads the saved record normally.

## Power semantics

### Invincibility

While enabled, reject damage to the local solo player before changing health or armour. Cover bot bullets, knife attacks, Zombie attacks and applicable explosive damage through the existing damage path. Do not restore health in a later frame after a lethal hit has already ended a run.

Enabling the switch does not heal, refill armour, revive a dead player, grant spawn protection to others or change the damage the player deals. Existing normal respawn rules still apply if invincibility was enabled while awaiting a bot-mode respawn. Zombies already at results cannot be resumed through this menu. Flash/smoke effects, supply-use rules and other non-damage mechanics remain normal. Disabling the power resumes normal damage without fabricating missed damage.

### Unlimited gun ammo without reloading

Every gun the player uses while the switch is active can fire indefinitely without reloading, including guns collected or selected after activation. Keep normal fire interval, automatic/single-shot behaviour, recoil, aim, damage and action locks; this is not rapid fire.

Cancel a pending reload on activation. Reload input during the power is a no-op and does not play misleading reload feedback. Sustain a finite full magazine for the active gun; keep reserve and total ammunition within the existing equipment validation bounds, clamping reserve if necessary when replenishing the magazine. Do not place numeric `Infinity` or additional power fields in weapon state, inventory DTOs or drops.

Show an infinity indicator in the local gun HUD and owned-gun inventory presentation while active. Grenade quantities and other loot counts remain normal numbers. Turning the switch off leaves the current valid finite ammunition state in place; normal consumption and reloading resume. Do not grant a new 500-round reserve or reconstruct an earlier inventory. Existing death/respawn inventory rules remain intact, but the power still applies to the respawned player's active gun until the round ends.

### Super speed

Multiply only the local solo player's normal horizontal movement speed by the selected 2x–5x factor. Preserve the normal weapon-class and aiming modifiers. Apply the multiplier to ordinary horizontal movement on ground and in the air, not to time, enemy movement, weapon cooldowns or input sensitivity.

Jump velocity, gravity and ladder climbing speed remain unchanged. Continue to use the existing collision and map-boundary checks, stairs, roof supports and hiding restrictions. Do not teleport through walls, cross closed hiding-room boundaries or bypass the movement solver. At 5x, correctness and frame cost on a constrained viewport/runtime need explicit tests; do not silently reduce the selected multiplier to make tests pass.

## Architecture and data flow

Use focused modules rather than expanding the large bootstrap/game files with all gate logic:

- `src/solo-powers.js`: pure configuration validation, defaults and solo power policy helpers. Accept only the three booleans plus the finite bounded speed multiplier. Unknown or malformed fields cannot activate powers.
- `src/solo-powers-pin.js`: guarded versioned PIN storage, verifier setup/checking and capability/error results, independently testable with injected storage/crypto.
- `src/solo-powers-ui.js`: logo activation counting, gated panel state, PIN attempts, form draft, focus and input cleanup. It receives narrow context/apply callbacks rather than owning match simulation.
- `src/main.js`: connect Home/Pause, pending configuration, round identity, background handling and explicit resets. Keep progression and teammate-map logic intact.
- `src/game.js`: per-round solo power state and narrow hooks for local damage, firing and movement; reset in start failure, completion and quit paths. `src/zombie-runtime.js` continues to use the same local player hooks.
- `index.html` and `src/styles.css`: logo controls and a touch-safe modal matching existing dialogs; legacy-WebView-compatible layout and focus handling.

Names are the planned boundaries; the implementation plan will specify exact APIs and tests. The data flow is local logo activation -> PIN gate -> validated menu draft -> pending or current solo configuration -> local simulation and presentation. XP and records continue down their existing, separate event/save paths.

Crucially, `OnlineArena.start` already reuses `ArenaGame.start` with `progressionSource: 'online'`. Enforce all-off state at that boundary and make online-source games reject power updates. Recheck the solo predicate inside damage, ammo and movement behaviour. UI hiding alone is insufficient. Never mutate shared weapon definitions, global movement constants or server-side damage logic. No room-schema or network-protocol-version change is needed for a feature that remains wholly local and solo-only; normal application build/release versioning is separate.

## Progression and saves

Leave normal progression events, rates, receipt identities and duplicate protection unchanged. Earn action XP as today; finishing a qualifying match still gives the existing completion reward. Early departure keeps earned action XP but does not create a completion/win bonus. Invincibility does not make an endless Zombie run finish automatically.

Continue using ordinary per-map Zombie records, including the existing wave/kill ordering and recording at wave clear, defeat and quit. Do not add assisted labels or separate records as an unrequested policy change.

The progression profile validates an exact field set. Keep the PIN and power state out of it so existing cosmetics and XP do not need migration. Preserve current backup/retry/save-status handling and report actual storage failures; do not promise persistence when the runtime denies it. Changing powers or losing PIN access must never delete progress.

## Validation and acceptance

Use test-driven implementation and fresh evidence before calling the feature ready. Planned checks, not claims of tests already run:

| Area | Required evidence |
| --- | --- |
| Configuration and lifecycle | Strict values; all-off defaults; every switch independent; slider endpoints; pending-to-round transfer; failure, finish, quit, replay and restart reset; pause/cancel retain current powers. |
| PIN and storage | First setup/confirmation, leading zeroes, correct/wrong PIN, attempt delay, restart persistence, isolated origins, failed reads/writes, malformed/newer records preserved, missing/rejected Web Crypto, no plaintext logging and stale async completion. |
| Damage | Local player takes no health/armour damage with power on, takes normal damage when off; enemies and teammate bots unaffected; no revival or late-frame defeat race; test Zombie and bot damage sources. |
| Ammunition | All 28 guns; empty and partial magazines; active reload; normal fire interval; no reload/consumption while powered; gun switching, pickups and respawn; finite valid equipment after disabling; grenade/supply counts unchanged. |
| Movement | 2x and 5x displacement with class/aim modifiers; walls, boundaries, stairs, roof edges, ladders, hiding and air movement on all eight maps; bounded-frame and low-frame-rate cases. |
| Browser interaction | Real touch/keyboard logo activation, PIN setup/unlock, accessible modal focus, speed slider, Home/Pause transitions, cancellation, native/background pause, loot HUD/inventory and explicit Resume. Do not satisfy gameplay acceptance only by mutating test state. |
| Progression | Real assisted bot kills and Zombie wave rewards, ordinary best record updates, early quit versus completion, repeated results not double-awarding, XP/cosmetics/PIN surviving reload while powers are off. |
| Online isolation | Enter/create/join online after enabling powers; failed joins and reconnects; fresh/rematch online starts; malformed/stale local updates rejected; normal online movement, damage, ammo and DTOs with two real browser players. |
| Compatibility and regressions | Existing full unit suite and relevant touch, legacy-WebView, progression, equipment, Zombie, traversal, runtime-error and teammate-map browser suites. No new fatal startup dependency on storage or crypto. |

Browser checks use isolated test servers/profiles. Do not restart or overwrite the user's preview or public server as test setup. Keep real PINs out of screenshots and logs; use disposable fixture PINs only in test profiles.

For APK handoff, build a separately named candidate and verify packaging, same-signature upgrade/save retention, local origin, menu access and offline operation in the available Android test environment. Preserve installed data and existing artifacts. A browser test or modern Android emulator does not establish physical BYD compatibility: actual head-unit testing, including Web Crypto, touch handling and 5x movement performance, must be reported separately. If the device cannot be tested, state that limitation rather than claiming BYD verification. Do not fold unrelated unfinished release/native-test failures into a claimed successful release.

## Review and handoff

This is a design artifact only. No powers, PIN, browser deployment or APK update have been implemented by writing it. After user review and approval, write and review the implementation plan, then obtain the execution-method choice before coding. Keep the separate custom-match-rules design pending rather than marking it completed.
