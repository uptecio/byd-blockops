import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Run after installing the debug APK on a disposable emulator. Uses the real
// public WSS server, a second independent peer, and raw WebView CDP (no focus
// emulation, injected game state, or production-only test hooks).
const serial = process.env.ANDROID_TEST_SERIAL || 'emulator-5582';
assert.match(serial, /^emulator-\d+$/, 'Only disposable emulators are in scope');
const configuration = JSON.parse(await readFile('game-server.json', 'utf8'));
const server = process.env.GAME_SERVER_URL || configuration.url;
assert.equal(new URL(server).protocol, 'https:', 'Native multiplayer requires TLS');
const wsURL = `${server.replace(/^https:/, 'wss:').replace(/\/$/, '')}/ws`;
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || `${process.env.HOME}/Android/Sdk`;
const adb = process.env.ADB_BINARY || `${sdk}/platform-tools/adb`;
const run = promisify(execFile);
const command = (...args) => run(adb, ['-s', serial, ...args], { timeout: 10000 });
const shell = (...args) => command('shell', ...args);
const until = async (read, predicate, description) => {
  const deadline = Date.now() + 15000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(100);
  }
  assert.fail(`${description}: ${JSON.stringify(value)}`);
};
const opened = socket => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('WebSocket open timeout')), 12000);
  socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket open failed')); }, { once: true });
});
let socket, peer, incompatible, forwarded = false, evaluate;
try {
  await shell('svc', 'wifi', 'enable');
  await shell('settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed');
  await shell('am', 'start', '-W', '-n', 'au.local.blockops/.MainActivity');
  const pid = (await shell('pidof', 'au.local.blockops')).stdout.trim();
  assert.match(pid, /^\d+$/);
  await command('forward', 'tcp:9228', `localabstract:webview_devtools_remote_${pid}`);
  forwarded = true;
  const targets = await (await fetch('http://127.0.0.1:9228/json', { signal: AbortSignal.timeout(5000) })).json();
  const target = targets.find(item => item.url === 'https://appassets.androidplatform.net/assets/index.html');
  assert.ok(target, 'APK must retain its packaged HTTPS origin');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await opened(socket);
  let next = 0, pageLoaded;
  const pending = new Map(), errors = [], sockets = [], remote = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timeout);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    } else if (message.method === 'Page.loadEventFired') pageLoaded?.();
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      if (!(entry.source === 'network' && entry.url === 'https://appassets.androidplatform.net/favicon.ico')) errors.push(JSON.stringify(entry));
    } else if (message.method === 'Network.webSocketCreated') sockets.push(message.params.url);
    else if (message.method === 'Network.requestWillBeSent' && !message.params.request.url.startsWith('https://appassets.androidplatform.net/')) remote.push(message.params.request.url);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const reload = async () => {
    let timeout;
    const loaded = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Native document reload timed out')), 10000);
      pageLoaded = resolve;
    });
    try { await send('Page.reload'); await loaded; }
    finally { clearTimeout(timeout); pageLoaded = undefined; }
  };
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const tap = async id => {
    const point = await evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: (r.x + r.width / 2) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio }; })()`);
    await shell('input', 'tap', String(Math.round(point.x)), String(Math.round(point.y)));
  };
  const state = () => evaluate('document.getElementById("room-code") ? ({mode:document.body.dataset.mode,hidden:document.hidden,code:document.getElementById("room-code").textContent,players:document.querySelectorAll(".roster-player").length,status:document.getElementById("connection-status").textContent,ammo:Number(document.getElementById("ammo-count").textContent),reserve:Number(document.getElementById("reserve-count").textContent),pauseTitle:document.querySelector("#pause-screen h2").textContent}) : ({mode:"loading"})');
  const key = (type, code, key) => send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: key.charCodeAt(0) });
  const screenshot = async name => {
    await mkdir('artifacts', { recursive: true });
    const shot = await run(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 10000000, timeout: 10000 });
    await writeFile(`artifacts/${name}`, shot.stdout);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
  for (const modeId of ['ffa', 'tdm', 'ctf']) {
  await evaluate('localStorage.removeItem("block-ops-online")');
  await reload();
  await until(state, current => current.mode === 'home', 'Home loaded');
  await until(() => evaluate('document.getElementById("server-address")?.value'), value => Boolean(value), 'Multiplayer UI initialized');
  await evaluate(`document.querySelector('[data-map=space-station]').click(); document.querySelector('[data-mode-id=${modeId}]').click(); document.querySelector('[data-skin=space-guard]').click()`);
  await click('home-online');
  assert.equal(await evaluate('document.getElementById("server-address").value'), server, 'Bundled default server must be current');
  await evaluate('document.getElementById("player-name").value="NativeHost"');
  await click('create-room');
  const lobby = await until(state, current => /^[A-Z0-9]{6}$/.test(current.code) && current.players === 1, 'Native WSS room create');
  assert.equal(await evaluate('document.getElementById("start-online").disabled'), true, 'Cannot start alone');

  let latest, peerId, peerCode = lobby.code;
  const peerErrors = [];
  peer = new WebSocket(wsURL);
  peer.onmessage = event => {
    const packet = JSON.parse(event.data);
    if (packet.type === 'welcome') { peerId = packet.id; if (!peerCode) peerCode = packet.room.code; }
    if (packet.room && packet.room.code === peerCode) latest = packet.room;
    if (packet.type === 'error') peerErrors.push(packet.message);
  };
  await opened(peer);
  const peerSend = packet => peer.send(JSON.stringify(packet));
  peerSend({ type: 'join', protocol: 2, code: lobby.code, name: 'SocketFriend', weaponId: 'm4a1', skinId: 'robo-unit' });
  await until(() => latest, room => room?.players.length === 2, 'Independent real peer joins');
  assert.equal(latest.mapId, 'space-station'); assert.equal(latest.modeId, modeId);
  assert.equal(latest.players.find(player => player.id === peerId).skinId, 'robo-unit');
  assert.equal(latest.players.find(player => player.id !== peerId).skinId, 'space-guard');
  await until(state, current => current.players === 2, 'Native roster reflects peer');
  await screenshot(`android-online-${modeId}-lobby.png`);
  await click('start-online');
  await until(state, current => current.mode === 'playing' && current.ammo + current.reserve === 500, 'Native online match starts with 500 rounds');
  await until(() => latest, room => room?.phase === 'playing', 'Peer observes host start');
  const native = () => latest.players.find(player => player.id !== peerId);
  assert.equal(native().teamId, modeId === 'ffa' ? null : 'red');
  assert.equal(latest.players.find(player => player.id === peerId).teamId, modeId === 'ffa' ? null : 'blue');
  assert.equal(await evaluate('document.getElementById("room-map").value'), 'space-station');
  assert.equal(await evaluate('document.getElementById("room-mode").value'), modeId);
  if (modeId === 'ctf') {
    assert.equal(latest.flags.red.status, 'home'); assert.equal(latest.flags.blue.status, 'home');
    assert.match(await evaluate('document.getElementById("objective-status").textContent'), /RED FLAG: HOME.*BLUE FLAG: HOME/);
  }
  const before = { ...native() };
  await key('keyDown', 'KeyW', 'w'); await delay(700); await key('keyUp', 'KeyW', 'w');
  await until(native, player => Math.hypot(player.x - before.x, player.z - before.z) > .4, 'Native input moves authoritative player');
  await key('keyDown', 'KeyF', 'f'); await delay(300); await key('keyUp', 'KeyF', 'f');
  await until(native, player => player.ammo < before.ammo, 'Native firing consumes server-observed ammo');
  await until(state, current => current.ammo < before.ammo, 'Native HUD reflects authoritative firing');
  await screenshot(`android-online-${modeId}-gameplay.png`);

  await key('keyDown', 'KeyW', 'w');
  await click('home-button'); await key('keyUp', 'KeyW', 'w'); await delay(250);
  const confirming = { ...native() }, confirmationTime = latest.timeLeft;
  await delay(1200);
  assert.ok(latest.timeLeft < confirmationTime - .8, 'Online Home confirmation leaves server clock running');
  assert.ok(Math.hypot(native().x - confirming.x, native().z - confirming.z) < .1, 'Home confirmation stops movement');
  await click('cancel-home');
  await until(state, current => current.mode === 'playing', 'Cancel returns to same online match');
  const cancelled = { ...native() }; await delay(400);
  assert.ok(Math.hypot(native().x - cancelled.x, native().z - cancelled.z) < .1, 'Cancel never restores held movement');
  if (modeId === 'ctf') {
    // Space Station has an open perimeter. Move the real Blue peer around
    // partitions using ordinary input packets, then return the captured flag.
    const drive = async (x, z) => {
      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        const player = latest.players.find(item => item.id === peerId);
        const dx = x - player.x, dz = z - player.z, distance = Math.hypot(dx, dz);
        if (distance < .45) {
          peerSend({ type: 'input', x: 0, y: 0, yaw: 0, pitch: 0 });
          return;
        }
        peerSend({ type: 'input', x: dx / distance, y: -dz / distance, yaw: 0, pitch: 0 });
        await delay(100);
      }
      assert.fail(`CTF peer failed to reach ${x},${z}: ${JSON.stringify(latest.players.find(item => item.id === peerId))}`);
    };
    const friend = latest.players.find(item => item.id === peerId);
    for (const [x, z] of [[friend.x, -20], [20, -20], [20, 20], [0, 20], [0, 18]]) await drive(x, z);
    await until(() => latest.flags.red, flag => flag.status === 'carried' && flag.carrierId === peerId, 'Real peer steals Red flag');
    await until(() => evaluate('document.getElementById("objective-status").textContent'), text => /RED FLAG: CARRIED/.test(text), 'Native HUD observes carried flag');
    for (const [x, z] of [[0, 20], [20, 20], [20, -20], [0, -20], [0, -18]]) await drive(x, z);
    await until(() => latest, room => room.teamScores.blue === 1 && room.flags.red.status === 'home', 'Real Blue capture scores and resets flag');
    await until(() => evaluate('document.getElementById("kills").textContent'), text => /BLUE 1/.test(text), 'Native HUD reflects capture score');
  }

  await key('keyDown', 'KeyW', 'w'); await delay(200);
  await shell('input', 'keyevent', 'KEYCODE_BACK');
  await until(state, current => current.mode === 'paused', 'Native back pauses local controls');
  assert.equal((await state()).pauseTitle, 'MATCH STILL LIVE');
  await key('keyUp', 'KeyW', 'w'); await delay(250);
  const paused = { ...native() }, pausedTime = latest.timeLeft;
  await delay(1700);
  assert.ok(latest.timeLeft < pausedTime - 1, 'Online room clock continues during local pause');
  assert.ok(Math.hypot(native().x - paused.x, native().z - paused.z) < .1, 'Paused local movement stops');
  await click('resume-button');
  await until(state, current => current.mode === 'playing', 'Explicit native resume');
  await shell('input', 'keyevent', 'KEYCODE_HOME');
  await until(state, current => current.mode === 'paused', 'Background stops local controls');
  const backgroundTime = latest.timeLeft;
  await delay(1500);
  assert.ok(latest.timeLeft < backgroundTime - 1, 'Server match continues while APK is backgrounded');
  await shell('am', 'start', '-n', 'au.local.blockops/.MainActivity');
  await until(state, current => !current.hidden, 'Native foreground');
  assert.equal((await state()).mode, 'paused', 'Foreground must not auto-resume controls');
  await click('pause-home'); await click('confirm-home');
  await until(state, current => current.mode === 'home', 'Confirmed leave returns Home');
  await until(() => latest, room => room?.players.length === 1, 'Peer observes native departure');

  peerSend({ type: 'leave' }); latest = undefined; peerCode = null;
  peerSend({ type: 'create', protocol: 2, name: 'SocketHost', weaponId: 'm4a1', mapId: 'space-station', modeId, skinId: 'robo-unit' });
  const friendRoom = await until(() => latest, room => room?.players.length === 1 && room.phase === 'lobby' && room.code !== lobby.code, 'Peer creates independent room');
  await click('home-online');
  await evaluate(`document.getElementById("room-code-input").value=${JSON.stringify(friendRoom.code)}`);
  await click('join-room');
  await until(state, current => current.players === 2 && current.code === friendRoom.code, 'Native joins existing room');
  assert.equal(await evaluate('document.getElementById("start-online").disabled'), true, 'Joining non-host cannot start');
  // Actual Android lifecycle: a remote host must not arm guest controls while
  // its APK is behind the launcher, even when it was only in a lobby before.
  await shell('input', 'keyevent', 'KEYCODE_HOME');
  await until(state, current => current.hidden, 'Guest APK genuinely backgrounded in lobby');
  peerSend({ type: 'start' });
  await until(() => latest, room => room?.code === friendRoom.code && room.phase === 'playing', 'Independent host starts while guest APK is hidden');
  const remoteStart = { ...native() }, remoteStartTime = latest.timeLeft;
  await delay(1400);
  assert.ok(latest.timeLeft < remoteStartTime - 1, 'Remote match clock progresses with guest backgrounded');
  assert.ok(Math.hypot(native().x - remoteStart.x, native().z - remoteStart.z) < .1, 'Backgrounded guest remains neutral after remote start');
  assert.equal(native().ammo, remoteStart.ammo, 'Backgrounded guest never fires after remote start');
  await shell('am', 'start', '-n', 'au.local.blockops/.MainActivity');
  await until(state, current => !current.hidden && current.mode === 'paused', 'Foreground after remote start requires explicit Resume');
  assert.equal(await evaluate('document.getElementById("pause-screen").hidden'), false, 'Native resume overlay is visible');
  assert.equal((await state()).pauseTitle, 'MATCH STILL LIVE');
  await delay(200);
  const guestPaused = { ...native() }, guestPausedTime = latest.timeLeft;
  await key('keyDown', 'KeyW', 'w'); await key('keyDown', 'KeyF', 'f');
  await delay(1200);
  await key('keyUp', 'KeyW', 'w'); await key('keyUp', 'KeyF', 'f');
  assert.ok(latest.timeLeft < guestPausedTime - .8, 'Foreground pause keeps shared clock progressing');
  assert.ok(Math.hypot(native().x - guestPaused.x, native().z - guestPaused.z) < .1, 'Paused guest ignores movement until Resume');
  assert.equal(native().ammo, guestPaused.ammo, 'Paused guest ignores firing until Resume');
  await screenshot(`android-online-${modeId}-guest-remote-start-paused.png`);
  await tap('resume-button');
  await until(state, current => current.mode === 'playing' && !current.hidden, 'Explicit physical Resume enables guest controls after remote start');
  const guestResumed = { ...native() };
  await key('keyDown', 'KeyW', 'w'); await delay(600); await key('keyUp', 'KeyW', 'w');
  await until(native, player => Math.hypot(player.x - guestResumed.x, player.z - guestResumed.z) > .3, 'Resumed guest movement reaches independent host');
  await key('keyDown', 'KeyF', 'f'); await delay(300); await key('keyUp', 'KeyF', 'f');
  await until(native, player => player.ammo < guestResumed.ammo, 'Resumed guest can explicitly fire');
  await click('home-button'); await click('confirm-home');
  await until(state, current => current.mode === 'home', 'Guest leaves remote-started match through Home');
  await until(() => latest, room => room?.code === friendRoom.code && room.players.length === 1, 'Independent host observes guest departure');
  peer.close(); peer = undefined;
  assert.deepEqual(peerErrors, []);
  console.log(`Native online configuration passed: space-station/${modeId}, distinct skins/teams, real peer, input and lifecycle.`);
  }
  incompatible = new WebSocket(wsURL);
  let rejection;
  incompatible.onmessage = event => { const packet = JSON.parse(event.data); if (packet.type === 'error') rejection = packet.message; };
  await opened(incompatible);
  incompatible.send(JSON.stringify({ type: 'create', protocol: 1, name: 'Outdated', weaponId: 'm4a1' }));
  await until(() => rejection, value => /update required/i.test(value || ''), 'Old client must be rejected clearly');
  assert.deepEqual(errors, [], 'No JavaScript or CSP errors');
  assert.ok(sockets.length >= 2 && sockets.every(url => url === wsURL), 'Only configured secure WebSockets are opened');
  assert.deepEqual(remote, [], 'No remote HTTP assets or requests');
  console.log('Native online smoke passed: protocol 2 WSS, all modes, nondefault map/skins, teams/flags, create/join, authoritative input, Home cancel/leave, live lifecycle clock, incompatible client rejection.');
} finally {
  if (evaluate) await evaluate('document.getElementById("leave-room").click()').catch(() => {});
  if (peer) peer.close();
  if (incompatible) incompatible.close();
  if (socket) socket.close();
  if (forwarded) await command('forward', '--remove', 'tcp:9228');
}
