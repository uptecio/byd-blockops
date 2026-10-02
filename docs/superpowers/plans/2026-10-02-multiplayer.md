# Internet Multiplayer Implementation Plan

**Goal:** Real-player room-code matches accessible over the internet, preserving solo play, with 500 total ammo per weapon.
**Spec:** ../specs/2026-10-02-multiplayer-design.md
**Architecture:** Shared authoritative Node simulation, WSS client, existing Three.js renderer and Android local assets.

## Global Constraints

- 28 guns, seven classes, 500 initial total rounds including magazine.
- 2–8 humans, 180-second / 15-kill free-for-all, no online bots.
- Secure WSS on Android; remote scripts/documents remain blocked.
- Temporary test hosting must be labelled, no paid service or permanent daemon.

## Review Focus

- No client-authoritative ammo, damage, position or scores.
- Pausing/backgrounding clears input without pausing everyone else's game.
- Stale connections/held input expire, room ownership transfers correctly.
- Joining and disconnecting never silently falls back to simulated people.
- Both APK and browser use the same server; solo still works offline.

## Tasks

- [x] Ammo: tests red/green; derive reserve as 500-magazine; update armory total and HUD checks.
- [x] Server: implement `server/rooms.js`, `server/server.mjs`, `tests/rooms.test.js`, `tests/network.test.js` against the exact wire contract in the spec. Node `ws` dependency; `startServer({port,host,distDir})` resolves `{port,close}`. Own rooms/simulation/server tests.
- [x] Client: implement `src/network.js`, `src/online-game.js`, lobby/mode UI and online-specific pause/results behavior; preserve solo runtime. Primary agent integrates with existing `ArenaGame` for rendering.
- [x] Android: INTERNET permission and WSS-only CSP/network setting; keep asset navigation restrictions. Rebuild and test actual WSS on disposable emulator.
- [x] Deploy temporary tunnel to game-only local server, embed server URL in APK, provide browser game link and reproducible hosting instructions.
- [x] Verify unit/network/two-player browser/solo/touch/native tests; independent review; package updated APK.

## Verification evidence

- Node suite: 58/58 passing, including server authority, room lifecycle, abuse limits and all 28 weapons' 500-round conservation.
- Local and public two-browser checks: host creation, room-code joining, pre-match loadouts, start authority, settings dismissal on remote start, replicated movement/ammo, actual player elimination/respawn, live timers during menus, gun switching, disconnect and return to solo.
- Solo browser and multi-touch suites pass after integration.
- Independent review corrections reproduced with failing tests before fixes: cosmetic-only online recoil, strict fifteenth-kill termination for multi-target shots, and asynchronous starts dismissing stale settings dialogs.
- Upgraded WebSocket dependency to patched ws 8.21.0; npm audit reports zero vulnerabilities.
- Temporary public server: https://heat-graphic-pubmed-culture.trycloudflare.com. Not permanent hosting; computer, server and tunnel must stay running.
- Final Android v0.2.0 APK: offline smoke and public-WSS smoke pass on disposable emulator, including create/join, real peer, authoritative movement/fire, 500 initial rounds, Back/background live clock and explicit resume. APK signature verifies, packaged JS matches final dist. No physical BYD head-unit testing performed.
- APK SHA256: `c259bdef3e3fd6f86ab7b7dfd0d1ab84b1c4991654c14b1276d323eb1782070c`.
