# Block Ops — solo + online arena

A playable Android prototype for the BYD Shark 6: a colourful original block-style first-person arena, offline bots, internet rooms for 2–8 real players, touchscreen controls, and 28 unlocked guns across seven classes. Every gun starts with 500 total rounds. No account, ads, downloaded game assets or vehicle integration.

## Try it

The built APK is `artifacts/block-ops-debug.apk` (v0.2.0). It is signed with an Android **debug** certificate for personal testing. Android 8.0 or later and a WebGL-capable Android System WebView are required. It contains no native CPU-specific libraries. The only Android permission is INTERNET, for optional multiplayer.

Transfer the APK using an installation method supported by your vehicle. Whether a particular Shark 6 firmware allows APK installation needs to be checked on that vehicle. This app has not been tested on a physical BYD head unit. Play while parked; the app does not detect the vehicle's motion.

Select a class, tap a weapon, and tap **Deploy** to play offline bots. To swap during a round, tap **Loadout**, select a gun, and return to the match. Menus pause solo combat only. Each gun retains its own ammo within a round, including when switching away and back. New rounds and respawning replenish ammunition. Your selected gun and settings save on the device.

Every gun starts with **500 rounds total**, including its magazine. Magazine sizes remain distinct: the M4A1 starts with 30 loaded + 470 reserve, the AWP with 5 + 495, and the MG42 with 100 + 400. Reloading transfers ammunition from reserve; it does not add ammunition. Switching guns preserves each gun's remaining supply.

Touch controls: left joystick moves; drag the arena to aim; hold Fire for automatic guns, tap for single-shot guns; drag on Fire to aim while shooting. Separate Aim, Jump and Reload buttons. Aim magnifies the view, with a scope for sniper rifles. The round ends at 15 eliminations or three minutes. Bots respawn; the player respawns after 2.5 seconds with brief protection.

Settings include sensitivity, control size, sound, bot count (1–8) and difficulty. Bot count/difficulty apply to the next solo round. Pause/Android Back/backgrounding stops solo gameplay; returning to the app does not resume automatically. In online matches these actions stop your controls, **not the shared match**. Your character remains vulnerable.

## Play with friends over the internet

Prototype browser link: https://heat-graphic-pubmed-culture.trycloudflare.com

1. Open **Online Friends**, enter a callsign, then **Create Room**.
2. Use **Copy Invite Link**, or share the six-character room code.
3. Friends open the link in their browser, or select **Online Friends → Join Room** in the APK. Everyone must use the same game server.
4. Once at least two people have joined, the host taps **Start Match**. You can change loadouts before or during the round.

Matches are free-for-all: first to 15 eliminations or highest score after three minutes. No fake players or bots are added to online rooms. Friends can join an ongoing match. If the host disconnects, hosting transfers to the next player. Leaving and rejoining creates a new player; scores are not recovered. Anyone with the room code can join: this is a small friends-only prototype, not an authenticated competitive service.

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

Models are original stylised interpretations; statistics are fictional game balance values. This project is not affiliated with BYD, Poxel.io or weapon manufacturers. One original courtyard map is included.

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

## Check the game

```sh
npm test
npm run build
npm run test:browser
npm run test:touch
npm run test:multiplayer
```

The browser checks need Playwright Chromium (`npx playwright install chromium` if not already installed). Screenshots are written to `artifacts/`. JavaScript unit tests cover reload/ammo conservation, firing cooldowns, arena collision/visibility, spawn locations and round transitions. Browser checks exercise actual controls, class filters, saved selection, firing/reload, pause and responsive layout.

`npm run test:touch` uses actual browser multi-touch events to check simultaneous movement/aim/fire, pointer cancellation, quick single shots, ammo preservation when switching weapons, and pausing with a finger held down. Combat tests exercise cover blocking both player and bot damage, death state, and the fifteenth elimination ending a round.

Multiplayer tests use separate real WebSockets and two independent browser contexts to verify room codes, host-only starts, lobby loadout changes, shared movement/shots/ammo, live clocks during menus, gun changes and disconnections. Run against a public server with `TEST_GAME_URL=https://your-server.example npm run test:multiplayer`. Tests create their own temporary rooms. Server tests cover authoritative damage/respawns, collision, input expiry, 500-round conservation, malformed messages and abuse limits.

Native smoke scripts are in `android/tests/`. After installing the debug APK on a disposable emulator, run `ANDROID_TEST_SERIAL=emulator-5582 node android/tests/emulator-online-smoke.mjs` for packaged-origin/WSS, create/join, independent peer, authoritative input, and Android Back/background behavior. It reads the public server address from `game-server.json` (or `GAME_SERVER_URL`). `emulator-smoke.mjs` covers offline startup and lifecycle. Use disposable emulators, not a physical vehicle, for these automated checks.

Third-party rendering library: [Three.js](https://threejs.org/), MIT licensed. Its copyright/license notice is bundled in `dist/THREE-LICENSE.txt` and the generated game JavaScript. Version 0.160.1 retains WebGL1 support for older head-unit WebViews.
