import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../../src/protocol.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanupOwnedOnlineSession } from './online-cleanup.mjs';

// Run after installing the debug APK on a disposable emulator. Uses the real
// explicitly selected WSS server, a second independent peer, and raw WebView CDP (no focus
// emulation, injected game state, or production-only test hooks).
const serial = process.env.ANDROID_TEST_SERIAL;
const artifacts = process.env.ANDROID_TEST_ARTIFACTS || 'artifacts/loot-review';
assert.ok(serial && process.env.ANDROID_TEST_AVD, 'Explicit task-owned emulator serial and AVD name are required');
assert.match(serial, /^emulator-\d+$/, 'Only disposable emulators are in scope');
const configuration = JSON.parse(await readFile('game-server.json', 'utf8'));
const bundledServer = process.env.GAME_SERVER_URL || configuration.url;
const server = process.env.GAME_TEST_SERVER_URL || bundledServer;
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
let socket, peer, incompatible, forwarded = false, evaluate, verifyDeparture, originalError, ownedApp = false;
const transportErrors = [];
try {
  const avdName = (await command('emu', 'avd', 'name')).stdout.trim().split('\n')[0].trim();
  assert.equal(avdName, process.env.ANDROID_TEST_AVD, 'Native smoke must use its explicitly owned disposable AVD');
  ownedApp = true;
  await shell('svc', 'wifi', 'enable');
  await until(async () => (await shell('dumpsys', 'connectivity')).stdout,
    value => /Active default network:\s*\d+/.test(value) && /ni\{WIFI CONNECTED/.test(value),
    'Owned emulator Wi-Fi has a default route after offline smoke');
  // Android can publish the Wi-Fi route before its DNS resolver is usable.
  // A resolved ping header is enough; the destination need not answer ICMP.
  await until(async () => {
    try { return (await shell('ping', '-c', '1', '-W', '1', new URL(server).hostname)).stdout; }
    catch (error) { return error.stdout || ''; }
  }, value => /^PING .*\([0-9a-f:.]+\)/mi.test(value), 'Owned emulator resolves the configured public server');
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
  const pending = new Map(), errors = [], sockets = [], remote = [], nativePackets = [], nativeSent = [];
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
    } else if (message.method === 'Network.webSocketFrameError') transportErrors.push(message.params.errorMessage);
    else if (message.method === 'Network.webSocketFrameReceived') {
      try { nativePackets.push(JSON.parse(message.params.response.payloadData)); } catch {}
    }
    else if (message.method === 'Network.webSocketFrameSent') {
      try { nativeSent.push(JSON.parse(message.params.response.payloadData)); } catch {}
    }
    else if (message.method === 'Network.webSocketCreated') sockets.push(message.params.url);
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
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(id.startsWith('[') ? id : '#'+id)}).getBoundingClientRect(); return { x: (r.x + r.width / 2) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio }; })()`);
    await shell('input', 'tap', String(Math.round(point.x)), String(Math.round(point.y)));
  };
  const state = () => evaluate('document.getElementById("room-code") ? ({mode:document.body.dataset.mode,hidden:document.hidden,code:document.getElementById("room-code").textContent,players:document.querySelectorAll(".roster-player").length,status:document.getElementById("connection-status").textContent,ammo:Number(document.getElementById("ammo-count").textContent),reserve:Number(document.getElementById("reserve-count").textContent),pauseTitle:document.querySelector("#pause-screen h2").textContent}) : ({mode:"loading"})');
  const key = (type, code, key) => send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: key.charCodeAt(0) });
  const roomAfterInputBarrier = async () => {
    await until(() => nativeSent.findLast(packet => packet.type === 'input'),
      input => input && input.x === 0 && input.y === 0 && !input.fire && !input.firePressed,
      'Actual native UI sends neutral input before the ordering barrier');
    const marker = `native-input-barrier-${Date.now()}`;
    await evaluate(`window.__nativeRoomSocket.send(JSON.stringify({type:'ping',at:${JSON.stringify(marker)}}))`);
    await until(() => nativePackets.findIndex(packet => packet.type === 'pong' && packet.at === marker),
      index => index >= 0, 'Native server acknowledges the ordinary ping after neutral input');
    const index = nativePackets.findIndex(packet => packet.type === 'pong' && packet.at === marker);
    return (await until(() => nativePackets.slice(index + 1).find(packet => packet.room),
      packet => Boolean(packet?.room), 'Native receives authoritative state after the neutral-input pong')).room;
  };
  const screenshot = async name => {
    await mkdir(artifacts, { recursive: true });
    const shot = await run(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 10000000, timeout: 10000 });
    await writeFile(`${artifacts}/${name}`, shot.stdout);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
  // Test-local access to the real wire for an ordinary ping, as in browser
  // acceptance. No gameplay state, position or input packets are injected.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {
      constructor(...args){super(...args);window.__nativeRoomSocket=this;}
    };
  })()` });
  // A staging override never probes or creates a room on the bundled live default.
  // Live-default acceptance belongs to a separately authorized rollout window.
  for (const modeId of ['ffa', 'tdm', 'ctf']) {
  verifyDeparture = undefined;
  await evaluate('localStorage.removeItem("block-ops-online")');
  await reload();
  await until(state, current => current.mode === 'home', 'Home loaded');
  await until(() => evaluate('document.getElementById("server-address")?.value'), value => Boolean(value), 'Multiplayer UI initialized');
  const mapId = modeId === 'ffa' ? 'courtyard' : 'space-station';
  await evaluate(`document.querySelector('[data-map=${mapId}]').click(); document.querySelector('[data-mode-id=${modeId}]').click(); document.querySelector('[data-skin=space-guard]').click()`);
  await click('home-online');
  assert.equal(await evaluate('document.getElementById("server-address").value'), bundledServer, 'Bundled default server must be current');
  if (server !== bundledServer) {
    await evaluate('document.querySelector(".server-settings").open=true');
    await tap('server-address');
    await evaluate(`document.getElementById('server-address').value=${JSON.stringify(server)}; document.getElementById('server-address').dispatchEvent(new Event('input',{bubbles:true}))`);
  }
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
  peerSend({ type: 'join', protocol: PROTOCOL_VERSION, code: lobby.code, name: 'SocketFriend', weaponId: 'm4a1', skinId: 'robo-unit' });
  await until(() => latest, room => room?.players.length === 2, 'Independent real peer joins');
  const hostNativeId = latest.players.find(player => player.id !== peerId).id;
  verifyDeparture = () => until(() => latest, room => room?.code === lobby.code && !room.players.some(player => player.id === hostNativeId), 'Observer verifies owned native host departure before teardown');
  assert.equal(latest.mapId, mapId); assert.equal(latest.modeId, modeId);
  assert.ok(nativePackets.some(packet => packet.type === 'welcome' && packet.protocol === PROTOCOL_VERSION), 'Real native client completes protocol-4 handshake');
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
  assert.equal(await evaluate('document.getElementById("room-map").value'), mapId);
  assert.equal(await evaluate('document.getElementById("room-mode").value'), modeId);
  if (modeId === 'ctf') {
    assert.equal(latest.flags.red.status, 'home'); assert.equal(latest.flags.blue.status, 'home');
    assert.match(await evaluate('document.getElementById("objective-status").textContent'), /RED FLAG: HOME.*BLUE FLAG: HOME/);
  }
  const before = { ...native() };
  const equipment = () => nativePackets.findLast(packet => packet.equipment?.equipment)?.equipment.equipment;
  const drive = async (axis, target, positive, negative) => {
      // Remote snapshots lag real native inputs. Short pulses, followed by
      // neutral settling, bound overshoot without injecting actor positions.
      const deadline = Date.now() + 30000;
      while (Math.abs(target - native()[axis]) > .6 && Date.now() < deadline) {
        const difference = target - native()[axis];
        const code = difference > 0 ? positive : negative;
        await key('keyDown', code, code.slice(-1).toLowerCase());
        try { await delay(Math.min(300, Math.abs(difference) / 5.3 * 1000)); }
        finally { await key('keyUp', code, code.slice(-1).toLowerCase()); }
        await delay(650);
      }
      assert.ok(Math.abs(target - native()[axis]) <= .6, `Native real walk settles at ${axis}=${target}: ${JSON.stringify(native())}`);
  };
  // Use real Android touch swipes. Back-to-back CDP mouse gestures can be
  // coalesced in the WebView; observe actual outgoing aim before another swipe.
  const alignNative=async()=>{
    const outgoing=()=>nativeSent.findLast(packet=>packet.type==='input'&&packet.lifeId===native().lifeId);
    await until(outgoing,packet=>Boolean(packet),'current native life sends actual controls before aim');
    const deadline=Date.now()+30000,ratio=await evaluate('devicePixelRatio');
    while(Math.abs(outgoing().yaw)>.025&&Date.now()<deadline) {
      const yaw=outgoing().yaw,pixels=Math.max(-150,Math.min(150,yaw/.0026));
      await shell('input','swipe',String(Math.round(600*ratio)),String(Math.round(180*ratio)),String(Math.round((600+pixels)*ratio)),String(Math.round(180*ratio)),'300');
      await until(outgoing,packet=>Math.abs(packet.yaw-yaw)>.002,'real Android aim swipe reaches outgoing controls');
    }
    assert.ok(Math.abs(outgoing().yaw)<.03,'real Android swipes face the central lane');
    await until(native,player=>Math.abs(player.yaw)<.03,'independent peer observes settled native aim');
  };
  await alignNative();
  await drive('x',0,'KeyD','KeyA');await drive('z',17,'KeyS','KeyW');
  await drive('x',-5,'KeyD','KeyA');await until(equipment,e=>e?.supplies.health>=1,'native health pack collected');
  await drive('x',5,'KeyD','KeyA');await until(equipment,e=>e?.supplies.armour>=1,'native armour pack collected');
  await drive('x',0,'KeyD','KeyA');const armourStock=equipment().supplies.armour;
  await tap('[data-inventory-key="supply:armour"]');await until(equipment,e=>e?.supplyUse?.type==='armour','native starts authoritative supply use');
  await shell('input','keyevent','KEYCODE_BACK');await until(state,s=>s.mode==='paused','real Back keeps online use live');
  await until(native,p=>p.armour===50,'independent peer sees applied armour during native menu');
  await until(equipment,e=>e.supplies.armour===armourStock-1&&!e.supplyUse,'native acknowledges exactly one used armour pack');
  await tap('resume-button');await until(state,s=>s.mode==='playing','resume supply match');
  if(modeId==='ffa') {
    const friend=()=>latest.players.find(p=>p.id===peerId);
    const drivePeer=async(x,z)=>{
      const deadline=Date.now()+20000;
      while(Date.now()<deadline) {
        const p=friend(),dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz);
        if(d<.25){peerSend({type:'input',x:0,y:0,yaw:0,pitch:0});return;}
        peerSend({type:'input',x:dx/d,y:-dz/d,yaw:0,pitch:0});await delay(80);
      }
      assert.fail('independent peer failed ordinary movement to firing position');
    };
    await drivePeer(0,15);
    peerSend({type:'equipment-action',seq:1,lifeId:friend().lifeId,kind:'equip-gun',weaponId:'g17',source:'armory'});
    await until(friend,p=>p.weaponId==='g17','independent peer selects single-fire pistol');
    for(const [armour,health] of [[27,100],[4,100],[0,81]]) {
      const p=friend(),target=native(),dx=target.x-p.x,dz=target.z-p.z;
      const aim={yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(target.y+1-(p.y+1.65),Math.hypot(dx,dz))};
      peerSend({type:'input',lifeId:p.lifeId,...aim,x:0,y:0,fire:true,firePressed:true});await delay(40);
      peerSend({type:'input',lifeId:p.lifeId,...aim,x:0,y:0,fire:false,firePressed:false});
      await until(native,p=>p.armour===armour&&p.health===health,'native and independent peer agree armour damage');await delay(240);
    }
    const healthStock=equipment().supplies.health;
    await tap('[data-inventory-key="supply:health"]');await until(equipment,e=>e?.supplyUse?.type==='health','native starts injured healing');
    await until(native,p=>p.health===100,'authoritative native health effect');
    await until(equipment,e=>e.supplies.health===healthStock-1,'one native health pack consumed');
    await drive('x',-5,'KeyD','KeyA');await until(equipment,e=>e.supplies.health>=1,'unused pack recollected for death drop');await drive('x',0,'KeyD','KeyA');
    const p=friend(),target=native(),life=target.lifeId;
    peerSend({type:'input',lifeId:p.lifeId,x:0,y:0,yaw:Math.atan2(p.x-target.x,p.z-target.z),pitch:0,fire:true,firePressed:true});await delay(40);
    peerSend({type:'input',lifeId:p.lifeId,x:0,y:0,yaw:Math.atan2(p.x-target.x,p.z-target.z),pitch:0,fire:false,firePressed:false});
    await until(()=>latest.gear.loot,loot=>loot.some(l=>l.source==='drop'&&l.item.kind==='supply'&&l.item.supplyType==='health'),'independent peer sees unused supply drop');
    await until(native,p=>p.lifeId>life,'native respawns with a new life');
    // The independent peer can see a respawn before the WebView does. Wait
    // for its real outbound input to acknowledge the life, then order a state
    // snapshot after that input before aiming the newly spawned camera.
    await until(()=>nativeSent.findLast(packet=>packet.type==='input'),
      packet=>packet?.lifeId===native().lifeId,'native client reconciles respawn before real aim');
    const reconciledRoom=await roomAfterInputBarrier();
    const reconciled=reconciledRoom.players.find(player=>player.id===hostNativeId);
    await until(native,p=>p.lifeId===reconciled.lifeId&&Math.abs(p.yaw-reconciled.yaw)<.025,'peer observes reconciled native respawn aim');
    await until(equipment,e=>e.supplies.health===0&&e.supplies.armour===0&&!e.supplyUse,'native life clears supply inventory');
    assert.equal(native().armour,0);
    await alignNative();
  }
  console.log(`PASS native supplies ${modeId}: real pickup/use/menu and authoritative armour${modeId==='ffa'?', damage/heal/drop/death':''}`);
  if (modeId === 'ffa') {
    const events = [];
    const receive = event => { const packet = JSON.parse(event.data); if (packet.room?.events) events.push(...packet.room.events); };
    peer.addEventListener('message', receive);
    await drive('z', 12, 'KeyS', 'KeyW'); await drive('x', -6, 'KeyD', 'KeyA');
    await until(equipment, value => value?.grenades.frag === 1, 'Native real walk receives authoritative grenade inventory');
    await until(() => events, value => value.some(event => event.type === 'pickup' && event.playerId === hostNativeId && event.itemId === 'map:courtyard:frag:1'), 'Independent peer observes identical native pickup');
    assert.ok(!latest.gear.loot.some(item => item.id === 'map:courtyard:frag:1'), 'Independent authoritative state removes collected pickup');
    await tap('throw-button');
    await until(equipment, value => value?.grenades.frag === 0, 'Real native Throw control consumes collected grenade once');
    await until(() => events, value => value.some(event => event.type === 'grenade-throw' && event.playerId === hostNativeId), 'Independent peer observes native equipment action');
    await until(() => latest.gear.projectiles, value => value.some(item => item.ownerId === hostNativeId), 'Independent peer observes authoritative native projectile');
    await drive('x', -3, 'KeyD', 'KeyA'); await drive('z', 0, 'KeyS', 'KeyW');
    await until(equipment, value => value?.knife, 'Native real walk collects knife');
    await tap('knife-button'); await until(native, value => value.heldItem === 'knife', 'Independent peer sees native held knife');
    await tap('knife-button'); await until(native, value => value.heldItem === 'gun', 'Native returns to its gun');
    peer.removeEventListener('message', receive);
    console.log('PASS native protocol-4 pickup, Throw/knife controls and independent authoritative pickup/projectile/held-item state.');
  }
  await key('keyDown', 'KeyW', 'w'); await delay(700); await key('keyUp', 'KeyW', 'w');
  await until(native, player => Math.hypot(player.x - before.x, player.z - before.z) > .4, 'Native input moves authoritative player');
  await key('keyDown', 'KeyF', 'f'); await delay(300); await key('keyUp', 'KeyF', 'f');
  await until(native, player => player.ammo < before.ammo, 'Native firing consumes server-observed ammo');
  await until(state, current => current.ammo < before.ammo, 'Native HUD reflects authoritative firing');
  await screenshot(`android-online-${modeId}-gameplay.png`);

  await key('keyDown', 'KeyW', 'w');
  await click('home-button');
  const confirmationRoom = await roomAfterInputBarrier();
  await key('keyUp', 'KeyW', 'w');
  const confirming = { ...confirmationRoom.players.find(player => player.id === hostNativeId) }, confirmationTime = confirmationRoom.timeLeft;
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
  await key('keyUp', 'KeyW', 'w');
  const pauseRoom = await roomAfterInputBarrier();
  const paused = { ...pauseRoom.players.find(player => player.id === hostNativeId) }, pausedTime = pauseRoom.timeLeft;
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

  peerSend({ type: 'leave' }); latest = undefined; peerCode = null; verifyDeparture = undefined;
  peerSend({ type: 'create', protocol: PROTOCOL_VERSION, name: 'SocketHost', weaponId: 'm4a1', mapId: 'space-station', modeId, skinId: 'robo-unit' });
  const friendRoom = await until(() => latest, room => room?.players.length === 1 && room.phase === 'lobby' && room.code !== lobby.code, 'Peer creates independent room');
  await click('home-online');
  await evaluate(`document.getElementById("room-code-input").value=${JSON.stringify(friendRoom.code)}`);
  await click('join-room');
  await until(state, current => current.players === 2 && current.code === friendRoom.code, 'Native joins existing room');
  await until(() => latest, room => room?.code === friendRoom.code && room.players.length === 2, 'Independent host observes native guest');
  const guestNativeId = latest.players.find(player => player.id !== peerId).id;
  verifyDeparture = () => until(() => latest, room => room?.code === friendRoom.code && !room.players.some(player => player.id === guestNativeId), 'Observer verifies owned native guest departure before teardown');
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
  console.log(`Native online configuration passed: ${mapId}/${modeId}, distinct skins/teams, real peer, input and lifecycle.`);
  }
  incompatible = new WebSocket(wsURL);
  let rejection;
  incompatible.onmessage = event => { const packet = JSON.parse(event.data); if (packet.type === 'error') rejection = packet.message; };
  await opened(incompatible);
  incompatible.send(JSON.stringify({ type: 'create', protocol: 3, name: 'Outdated', weaponId: 'm4a1' }));
  await until(() => rejection, value => /update required/i.test(value || ''), 'Old client must be rejected clearly');
  assert.deepEqual(errors, [], 'No JavaScript or CSP errors');
  assert.ok(sockets.length >= 2 && sockets.every(url => url === wsURL), 'Only the explicitly selected secure WebSocket endpoint is opened');
  assert.deepEqual(remote, [], 'No remote HTTP assets or requests');
} catch (error) {
  originalError = error;
  if (transportErrors.length) console.error(`Native WebSocket transport errors: ${JSON.stringify(transportErrors)}`);
  throw error;
} finally {
  await cleanupOwnedOnlineSession({
    stopApp: async () => {
      if (!ownedApp) return;
      await shell('am', 'force-stop', 'au.local.blockops');
      const running = await shell('pidof', 'au.local.blockops').catch(error => {
        if (error.code === 1) return { stdout: '' };
        throw error;
      });
      assert.equal(running.stdout.trim(), '', 'Only the owned app process must be stopped');
    },
    verifyDeparture: async () => { if (peer?.readyState === WebSocket.OPEN && verifyDeparture) await verifyDeparture(); },
    closePeers: () => { peer?.close(); incompatible?.close(); },
    closeCdp: () => socket?.close(),
    removeForward: async () => { if (forwarded) await command('forward', '--remove', 'tcp:9228'); },
    originalError,
  });
}
console.log('Native online smoke passed: protocol 4 WSS, real pickups/equipment actions/shared peer state, all modes, teams/flags, create/join, authoritative input, Home cancel/leave, live lifecycle clock, incompatible client rejection and verified owned cleanup.');
