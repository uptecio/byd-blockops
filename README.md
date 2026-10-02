# Block Ops — offline arena

A playable Android prototype for the BYD Shark 6: a colourful original block-style first-person arena, offline bots, touchscreen controls, and 28 unlocked guns across seven classes. No account, ads, network connection, external assets or vehicle integration.

## Try it

The built APK is `artifacts/block-ops-debug.apk`. It is signed with an Android **debug** certificate for personal testing. Android 8.0 or later and a WebGL-capable Android System WebView are required. It contains no native CPU-specific libraries and requests no Android permissions.

Transfer the APK using an installation method supported by your vehicle. Whether a particular Shark 6 firmware allows APK installation needs to be checked on that vehicle. This app has not been tested on a physical BYD head unit. Play while parked; the app does not detect the vehicle's motion.

Select a class, tap a weapon, and tap **Deploy**. To swap during a round, tap **Loadout**, select a gun, and return to the match. The menu pauses combat. Each gun retains its own ammo within a round, including when switching away and back. New rounds and respawning replenish ammunition. Your selected gun and settings save on the device.

Touch controls: left joystick moves; drag the arena to aim; hold Fire for automatic guns, tap for single-shot guns; drag on Fire to aim while shooting. Separate Aim, Jump and Reload buttons. Aim magnifies the view, with a scope for sniper rifles. The round ends at 15 eliminations or three minutes. Bots respawn; the player respawns after 2.5 seconds with brief protection.

Settings include sensitivity, control size, sound, bot count (1–8) and difficulty. Bot count/difficulty apply to the next round. Pause/Android Back/backgrounding stops gameplay; returning to the app does not resume automatically.

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

Models are original stylised interpretations; statistics are fictional game balance values. This project is not affiliated with BYD, Poxel.io or weapon manufacturers. One original courtyard map is included; there is no online multiplayer.

## Browser preview

Requires Node.js 20 or later:

```sh
npm ci
npm run build
npm run dev
```

Open http://localhost:4173. Desktop controls: WASD/arrows move, drag to aim, F fires, R reloads, Space jumps, E aims, Esc pauses. Touch controls also work in the browser. WebGL must be available.

## Build the APK

Requires Java 17, Android SDK platform 36 / build tools 36 and Gradle 8.13 or later in the 8.x series. The build script finds a system or cached Gradle installation; set `GRADLE_BINARY` if needed. Set `ANDROID_SDK_ROOT` if the SDK is outside `~/Android/Sdk`.

```sh
npm ci
npm run apk
```

Output: `artifacts/block-ops-debug.apk`. Native Android sources live in `android/`; built web assets in `dist/` are copied into the APK. Build dependencies need downloading once. The installed game itself works entirely offline. For a cached build, use `npm run build` followed by `bash scripts/build-apk.sh --offline`.

## Check the game

```sh
npm test
npm run build
npm run test:browser
npm run test:touch
```

The browser checks need Playwright Chromium (`npx playwright install chromium` if not already installed). Screenshots are written to `artifacts/`. JavaScript unit tests cover reload/ammo conservation, firing cooldowns, arena collision/visibility, spawn locations and round transitions. Browser checks exercise actual controls, class filters, saved selection, firing/reload, pause and responsive layout.

`npm run test:touch` uses actual browser multi-touch events to check simultaneous movement/aim/fire, pointer cancellation, quick single shots, ammo preservation when switching weapons, and pausing with a finger held down. Combat tests exercise cover blocking both player and bot damage, death state, and the fifteenth elimination ending a round.

Third-party rendering library: [Three.js](https://threejs.org/), MIT licensed. Its copyright/license notice is bundled in `dist/THREE-LICENSE.txt` and the generated game JavaScript. Version 0.160.1 retains WebGL1 support for older head-unit WebViews.
