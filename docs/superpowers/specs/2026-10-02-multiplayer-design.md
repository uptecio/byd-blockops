# Internet rooms and 500 ammunition

The user requested real-player games that other people can join, then chose internet play with room codes. Preserve solo bots. All 28 guns start with 500 total rounds (magazine included), retain magazine capacities and ammo conservation.

## Experience

Armory offers Solo bots and Online friends. Online opens nickname, Create room and Join code. Up to eight players join a lobby using a six-character code on the same server. Host starts when at least two are present; matches are free-for-all, 180 seconds or 15 kills. Room roster, room code, connection status, leaderboard and host start/play-again controls remain clear. Room codes can be shared with the game link. Joining an in-progress round is allowed. Leaving removes the player and transfers host to another player. Empty rooms expire. No accounts, chat or persistent personal data.

The online match continues while someone opens a menu. Their input stops but their character remains vulnerable; the UI must say this. Leaving/backgrounding stops local input immediately; stale input also expires server-side. Disconnect returns the player to an honest connection message, with no fake bots as other people. Rejoin uses the room code; abandoned sessions are removed.

## Networking

A small Node.js WebSocket room server owns movement/collision, shots, cooldowns, reloads, ammunition, health, respawns, scores and match time. Clients send controls and selected gun, never damage, health, position or kills. Server validates finite controls, limits message size/rate and room/player counts. All movement and visibility share the current arena geometry. Snapshot stream is 15Hz, simulation 30Hz. Clients render remote block characters and reconcile their own position. Both browser and APK connect to the same secure WSS endpoint.

Protocol: client create/join/name/weapon as below, then start/input/equip/leave/ping. Server welcome/state/error/pong. Browser uses the current HTTP(S) host by default; the APK embeds the tested HTTPS server base URL through build configuration. A configurable server address supports later hosting changes. No insecure WebSocket permission is needed in the APK. Android adds INTERNET permission, permits WSS connections in CSP, and continues to block remote documents/scripts and mixed content.

For immediate internet testing use a temporary HTTPS tunnel exposing only the game HTTP/WebSocket server. It has no account or cost requirement but depends on this computer/server/tunnel staying running. State clearly that this is temporary, not durable production hosting. Supply a standard start command and container definition for later stable hosting; no paid service or permanent system daemon.

## Wire contract

Client packets: `{type:'create',name,weaponId}`, `{type:'join',code,name,weaponId}`, `{type:'start'}`, `{type:'input',x,y,yaw,pitch,fire,firePressed,jump,reload,zoom}`, `{type:'equip',weaponId}`, `{type:'leave'}`, `{type:'ping',at}`. x/y are normalized movement axes (y forward); angles radians. Each new firePressed/jump/reload is a one-shot pulse, not retained between server ticks.

Server `{type:'welcome',id,room}` or `{type:'state',room}`. Room `{code,hostId,phase,timeLeft,winnerId,players,events}`; phase `lobby|playing|ended`. Player `{id,name,x,z,y,yaw,pitch,health,kills,deaths,weaponId,ammo,reserve,reloadRemaining,respawnRemaining,protectedRemaining}`; y is jump height (feet), camera y+1.65. Events `{id,type:'shot'|'hit'|'kill',playerId,targetId?,from?:{x,y,z},to?:{x,y,z}}`, ephemeral each snapshot; id monotonically increasing per room so client can deduplicate. Private welcome id identifies local player. Error `{type:'error',message}`. Pong echoes at. At least 2 players to start, max8; 500 ammunition at spawn; changing guns preserves each gun's state until respawn/round reset. Unknown names sanitised, weapon ids rejected if invalid, malformed packets error safely. Match winner is highest kills (then fewest deaths) at timeout or first15. A lobby/ended start resets all combat.

## Verification

Unit/integration tests cover room code create/join, invalid/full rooms, host start rules, movement and cover, server-owned ammo/health, stale input, death/respawn, round end, leave/host transfer, malformed messages and two independent sockets. Two browser contexts join one room, start, see each other, move/fire and remain synchronized; opening a menu must not freeze shared time. Test real HTTPS/WSS tunnel and packaged APK connectivity. Solo and existing touch suites must still pass.
