# Block Ops — solo + online arena

A playable Android prototype for the BYD Shark 6: a colourful original block-style first-person arena with eight maps, eight unlocked character skins, three match modes, offline bots, internet rooms for 2–8 real players, touchscreen controls, and 28 unlocked guns across seven classes. Every gun starts with 500 total rounds. Maps and skins are bundled for offline play. No account, ads, downloaded game assets or vehicle integration.

## Try it

The built APK is `artifacts/block-ops-debug.apk` (v0.3.0, Android version code 3). It is signed with an Android **debug** certificate for personal testing. Android 8.0 or later and a WebGL-capable Android System WebView are required. It contains no native CPU-specific libraries. The only Android permission is INTERNET, for optional multiplayer.

Verified release APK SHA-256: `f675052600bad71d41e58b87a3ffe6b55f7158d3f7cafbe434ff93b56c3b1b8f`.

Transfer the APK using an installation method supported by your vehicle. Whether a particular Shark 6 firmware allows APK installation needs to be checked on that vehicle. This app has not been tested on a physical BYD head unit. Play while parked; the app does not detect the vehicle's motion.

Start at **Home**: preview your character, select a map, match mode and skin, then tap **Solo** or **Online Friends**. **Armory** offers weapon classes and loadouts; **Settings** adjusts controls and bots. Home choices, gun and settings save on the device. All skins have identical movement, health and hitboxes; team markers remain visible regardless of skin.

To swap during a round, tap **Loadout**, select a gun, and return to the match. Menus pause solo combat only. **Home** asks before ending a solo round or leaving an online room; Cancel returns to your previous screen and clears held controls. Pause resumes the same round. Each gun retains its own ammo within a round, including when switching away and back. New rounds and respawning replenish ammunition.

Every gun starts with **500 rounds total**, including its magazine. Magazine sizes remain distinct: the M4A1 starts with 30 loaded + 470 reserve, the AWP with 5 + 495, and the MG42 with 100 + 400. Reloading transfers ammunition from reserve; it does not add ammunition. Switching guns preserves each gun's remaining supply.

Touch controls: left joystick moves; drag the arena to aim; hold Fire for automatic guns, tap for single-shot guns; drag on Fire to aim while shooting. Separate Aim, Jump and Reload buttons. Aim magnifies the view, with a scope for sniper rifles. Bots respawn; the player respawns after 2.5 seconds with brief protection.

Settings include sensitivity, control size, sound, bot count (1–8) and difficulty. Bot count/difficulty apply to the next solo round. Pause/Android Back/backgrounding stops solo gameplay; returning to the app does not resume automatically. In online matches these actions stop your controls, **not the shared match**. Your character remains vulnerable.

## Play with friends over the internet

Prototype browser link: https://heat-graphic-pubmed-culture.trycloudflare.com

1. Open **Online Friends**, enter a callsign, then **Create Room**.
2. Use **Copy Invite Link**, or share the six-character room code.
3. Friends open the link in their browser, or select **Online Friends → Join Room** in the APK. Everyone must use the same game server.
4. Once at least two people have joined, the host taps **Start Match**. You can change loadouts before or during the round.

The host chooses the map/mode outside active rounds; guests see the authoritative choices. Skins can be requested in a room and take effect at the next spawn. No fake players or bots are added to online rooms. Friends can join an ongoing match. If the host disconnects, hosting transfers to the next player. Leaving and rejoining creates a new player; scores are not recovered. Anyone with the room code can join: this is a small friends-only prototype, not an authenticated competitive service.

Online play uses **protocol 2**. All players must reload the current browser game or install the v0.3 APK, and the server must also support version 2. Old clients are rejected with an update message. The public link serves the verified v0.3 release; real public browser multiplayer and Android emulator online checks passed on 2026-10-02.

**The current internet link is temporary.** This computer's Node server and Cloudflare tunnel must remain running and connected. Stopping/restarting the tunnel can change the URL. The APK includes this address; **Online Friends → Server settings** lets you replace it without reinstalling. Solo mode keeps working without the server or internet. Stable always-on hosting has not been configured.

## Weapons

| Class | Guns |
| --- | --- |
| Assault | AK-47, M4A1, SCAR-H, FAMAS |
| SMG | MP5, MP7, P90, Vector |
| Shotgun | M870, SPAS-12, AA-12, Double Barrel |
| Sniper | AWP, Scout, Barrett .50, L96 |
| Marksman | SKS, MK14, SVD, FAL |
| LMG | M249, PKM, RPK, MG42 |
| Sidearm | G17, M1911, Desert Eagle, Revolver |

Models are original stylised interpretations; statistics are fictional game balance values. This project is not affiliated with BYD, Poxel.io or weapon manufacturers.

## Maps, skins and modes

Maps: Sunlit Courtyard, Dust Town, Neon City, Snow Base, Jungle Ruins, Harbor, Desert Fort and Space Station. Each has a different block layout on flat playable ground.

Skins: Ranger, Desert Ops, Arctic Scout, Jungle Scout, Neon Runner, Shadow Ninja, Robo Unit and Space Guard. Character and map previews work offline without image downloads.

All three modes work solo and online and last three minutes. Free For All targets 15 individual eliminations; Team Deathmatch targets 30 team eliminations; Capture The Flag targets three captures. At timeout the highest score wins; tied scores are draws. Team modes balance Red/Blue teams, disable friendly fire and allow damage rays past teammates. Solo places you on Red with 1–8 bots; online has 2–8 humans.

CTF pickup/return/capture radius is 1.2 units. A dropped flag returns after 15 seconds; your own flag must be home before you can capture. Dead or spawn-protected players cannot steal flags. Bots navigate around cover: FFA/TDM pursue enemies; CTF attackers steal/carry home, defenders guard/intercept/recover flags, and carriers recover a missing own flag before capturing.

## Browser preview

Requires Node.js 20 or later:

```sh
npm ci
npm run build
npm run dev
```

Open http://localhost:4173. Desktop controls: WASD/arrows move, drag to aim, F fires, R reloads, Space jumps, E aims, Esc pauses. Touch controls also work in the browser. WebGL must be available.

## Run the multiplayer server

```sh
npm ci
npm run build
npm run server
```

The game and WebSocket server listen at `http://127.0.0.1:4185`; health is `/health`, WebSocket endpoint `/ws`. For local browser testing set Server settings to this address. Public and Android connections require HTTPS/WSS.

For a temporary public link, run Cloudflare Tunnel separately:

```sh
cloudflared tunnel --url http://127.0.0.1:4185 --no-autoupdate
```

Only the built game assets, WebSocket endpoint and health endpoint are served—not workspace files. Stop the foreground server/tunnel with Ctrl+C. Rooms exist only in memory and disappear when the server stops. Maximum eight players per room, 32 rooms; movement/combat/ammo are authoritative on the server, inputs expire after 300 ms, messages are size/rate limited, and idle/dead sockets are cleaned up.

For permanent hosting, deploy this Node server behind HTTPS with WebSocket upgrade support and a stable domain. Set `HOST=0.0.0.0` and optionally `PORT` for your hosting platform. A Dockerfile is provided (`docker build -f server/Dockerfile -t block-ops .` after building web assets). No paid service or hosting account is created by this project.

The APK's default server comes from `game-server.json`. Override it when building with `GAME_SERVER_URL=https://your-server.example npm run apk`. Public browser invite links use the server that served the page. No secret keys are needed or bundled.

## Build the APK

Requires Java 17, Android SDK platform 36 / build tools 36 and Gradle 8.13 or later in the 8.x series. The build script finds a system or cached Gradle installation; set `GRADLE_BINARY` if needed. Set `ANDROID_SDK_ROOT` if the SDK is outside `~/Android/Sdk`.

```sh
npm ci
npm run apk
```

Output: `artifacts/block-ops-debug.apk`. Native Android sources live in `android/`; built web assets in `dist/` are copied into the APK. Build dependencies need downloading once. Solo play works entirely offline; multiplayer requires the server and internet. For a cached build, use `npm run build` followed by `bash scripts/build-apk.sh --offline`.

To validate an update while preserving assets served by a running server, use a separate output directory for both building and testing, then package those exact assets:

```sh
BUILD_DIR=/tmp/block-ops-release npm run build
DIST_DIR=/tmp/block-ops-release npm run test:configurations
DIST_DIR=/tmp/block-ops-release bash scripts/build-apk.sh --offline lintDebug
```

`DIST_DIR` also selects assets for preview/browser tests; leaving it unset preserves the default `dist/` behavior. Packaging rejects missing/empty/non-file assets before copying.

## Check the game

```sh
npm test
npm run build
npm run test:browser
npm run test:home
npm run test:touch
npm run test:multiplayer
npm run test:configurations
npm audit
```

The browser checks need Playwright Chromium (`npx playwright install chromium` if not already installed). Screenshots are written to `artifacts/` and the task workspace. JavaScript unit tests cover reload/ammo conservation, firing cooldowns, arena collision/visibility, navigation, bots, mode rules, skins, spawn locations and round transitions. Browser checks exercise actual controls, Home previews/persistence/fallback, class filters, firing/reload, pause and responsive layout. Configuration tests launch all 24 map/mode combinations in solo and with two independent browser peers, checking HUD, team/skin/spawn agreement and clean Home returns.

`npm run test:touch` uses actual browser multi-touch events to check simultaneous movement/aim/fire, pointer cancellation, quick single shots, ammo preservation when switching weapons, and pausing/Home confirmation with fingers held down. Cancel and a fresh round must clear held movement/fire. Combat tests exercise cover blocking both player and bot damage, death state, and mode score limits.

Multiplayer tests use separate real WebSockets and two independent browser contexts to verify room codes, host-only starts, lobby loadout changes, shared movement/shots/ammo, live clocks during menus, gun changes and disconnections. Run against a public server with `TEST_GAME_URL=https://your-server.example npm run test:multiplayer`. Tests create their own temporary rooms. Server tests cover authoritative damage/respawns, collision, input expiry, 500-round conservation, malformed messages and abuse limits.

Native smoke scripts are in `android/tests/`. Install the debug APK only on an owned disposable emulator and set both `ANDROID_TEST_SERIAL` and `ANDROID_TEST_AVD` explicitly, as shown in the candidate instructions below. Run offline and online scripts sequentially because they share CDP port 9228. Offline smoke checks Home/preview persistence, all modes on a nondefault map/skin, no external HTTP/WebSockets, and Android Back/background/explicit resume. Online smoke checks secure protocol-3 create/join with an independent peer, skin/team/configuration agreement, movement/fire/flag capture and live-clock lifecycle behavior. Its guest-lobby regression uses actual Android backgrounding while the independent host starts; foreground controls must remain paused until Resume. Old clients must be rejected. Online smoke tests the bundled default from `game-server.json` (or the build's `GAME_SERVER_URL`); `GAME_TEST_SERVER_URL` selects a staging override through the real Server settings UI in the same APK. Use disposable emulators, not a physical vehicle, for these automated checks.

Online native cleanup stops only `au.local.blockops` on the verified owned emulator, checks room departure while its independent peer is still connected, then closes peer/CDP sockets and removes its forward. There is no default AVD name: `ANDROID_TEST_AVD` must identify your explicitly owned disposable AVD. Cleanup preserves the original test failure.

Third-party rendering library: [Three.js](https://threejs.org/), MIT licensed. Its copyright/license notice is bundled in `dist/THREE-LICENSE.txt` and the generated game JavaScript. Version 0.160.1 retains WebGL1 support for older head-unit WebViews.

## Loot release v0.4.0

The released v0.4.0 APK is `artifacts/block-ops-v0.4.0-debug.apk`, also promoted to `artifacts/block-ops-debug.apk` (Android version code 4, unchanged package `au.local.blockops`, debug signing). Both have SHA-256 `8ad658d52640cd2b95bdfaf2e88c1ff9e9e785ce752f267b0cce46c6e331114e`. The previous v0.3.0 APK remains in `artifacts/block-ops-restored-debug.apk` and the protected task backup. Release verification and exact packaged browser assets are in `artifacts/loot-review/verification.json` and `artifacts/loot-review/apk-dist/`.

Play at [the current public browser link](https://emerald-arctic-thanks-settings.trycloudflare.com/). Browser, server and APK now use protocol 3. Refresh an already-open browser page or install the new APK; old protocol-2 clients receive an update-required message. The public files were verified byte-for-byte against the APK assets, two fresh browser peers verified shared pickups/throws, and the same installed APK passed the complete native online checks against its bundled public default. The temporary link requires this computer's server and Cloudflare tunnel to remain running.

The live server uses reviewed source commit `6fa8b33` and an isolated source/assets snapshot at `artifacts/release-v0.4.0-6fa8b33-msdszr/`. Previous source/assets remain at `artifacts/loot-review/recovery-v0.3.0-nocomQ/`. Release occurred after a fresh empty-room check without forcing anyone out. Final verification: 523 unit tests, package checks, seven browser suites, all 24 map/mode configurations, CTF concealment/recovery, Playwright CLI checks, and native offline/online checks. Carried CTF flags now hide and recover with their concealed carriers.

Loot is collected automatically on all maps and modes. Carried Guns lists collected guns; Armory can equip a different gun, after which the original starting gun must be recovered as loot. Duplicate owned guns are skipped. Switching preserves ammo; death drops the active gun and remaining grenades, clears collected equipment, and restores the starting gun on respawn. One knife and three grenades total can be carried. Use Knife/Q to toggle the knife, Throw/G to throw the selected grenade, and the grenade selector/T to choose a type.

Eight gun pickups per map are spread across end lanes, outer flanks and central approaches. Close-range torso knife hits now follow the actual aim ray and show hit feedback; knife damage remains 50. Valid gun headshots deal exactly 10,000,000,000 damage per head hit in Solo and Online, with unchanged body damage, reach, cover and protection rules.

Validate the release package and exact bundled assets with:

```sh
ANDROID_APK_PATH=artifacts/block-ops-v0.4.0-debug.apk DIST_DIR=artifacts/loot-review/apk-dist npm run test:apk
```

Native smoke requires an explicitly owned disposable AVD name and serial. Install the release on that emulator, then run the scripts sequentially against the bundled public default:

```sh
ANDROID_TEST_SERIAL=emulator-5588 ANDROID_TEST_AVD=BlockOpsLootTask10 node android/tests/emulator-smoke.mjs
ANDROID_TEST_SERIAL=emulator-5588 ANDROID_TEST_AVD=BlockOpsLootTask10 node android/tests/emulator-online-smoke.mjs
```

Automated emulator results do not verify a physical BYD head unit. Physical BYD installation, appearance, touch and performance checks remain outstanding.
