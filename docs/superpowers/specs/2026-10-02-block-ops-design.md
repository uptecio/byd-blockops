# Block Ops: offline arena design

The user approved a colourful blocky first-person arena mockup for their BYD Shark 6, solo offline bots and touchscreen controls, then requested implementation with switchable gun classes and popular guns. The current directory is empty. Build a playable prototype and an installable debug APK; hardware compatibility is to be verified on their particular car. No online services, accounts, advertising, purchases, or vehicle integration.

## Experience

Landscape first-person play in one original sunny courtyard with blue/coral buildings, block trees and cover. Left virtual stick moves; right-side drag aims; separate fire, jump, reload and aim buttons. A visible loadout button pauses the match and opens the armory. Sensitivity, sound, difficulty, bot count and touch control size are adjustable. Opening menus, losing focus or Android backgrounding pauses play and clears held input. There is no automatic vehicle motion detection; the menu labels this as a parked-play game.

The armory filters seven classes and offers 28 recognisable weapon types: assault rifles (AK-47, M4A1, SCAR-H, FAMAS), SMGs (MP5, MP7, P90, Vector), shotguns (M870, SPAS-12, AA-12, Double Barrel), sniper rifles (AWP, Scout, Barrett .50, L96), marksman rifles (SKS, MK14, SVD, FAL), LMGs (M249, PKM, RPK, MG42), and sidearms (G17, M1911, Desert Eagle, Revolver). These are stylised, original game models with fictional balance values. All are unlocked. Changing the selected weapon persists locally and replaces the visible model and mechanics. Switching back within a match preserves ammunition. Match start/respawn replenishes loadouts. Reload consumes reserve ammunition; no fire while reloading or paused.

A round runs for 180 seconds or 15 eliminations, whichever comes first. Default five bots, range one to eight. Bots navigate walkable ground, obey cover for shooting and pursue the player. Player and bots respawn. HUD shows health, timer, eliminations, ammunition and active gun. Match results offer play again and loadout. Desktop keyboard/mouse controls support development and preview.

## Architecture and delivery

Three.js 0.160.1, bundled locally with esbuild targeting ES2017, renders an original procedural arena and weapon models. This release retains WebGL1 support for older Android WebViews. HTML/CSS handles menus and touch controls. Pure JavaScript modules own weapon ammunition, timers, match state and collision. No runtime network requests or external assets.

An Android Java Activity hosts the bundled assets through a restricted local HTTPS asset origin, sets landscape immersive presentation, pauses on backgrounding and exposes Android back as pause. APK minSdk 26, compile/target SDK 36, Java 17. No internet or storage permission. Sign a debug APK for personal testing, copy to artifacts/block-ops-debug.apk and verify its signature/manifest. Do not install on external devices without user direction. An isolated emulator created for testing is allowed.

## Validation

Node tests prove weapon cooldown/reload/ammo conservation, class completeness, collision/cover visibility and round transitions. Browser checks exercise menus, all class filters, weapon persistence, firing/reload, pause, touch inputs and responsive layout with captured screenshots. Build and inspect the APK; launch in an emulator if available. Distinguish desktop/emulator evidence from untested BYD compatibility.
