import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Raw CDP avoids browser automation's artificial document visibility override.
// Install the debug APK on a disposable emulator before running this test.
const serial = process.env.ANDROID_TEST_SERIAL;
assert.ok(serial && process.env.ANDROID_TEST_AVD, 'Explicit task-owned emulator serial and AVD name are required');
assert.match(serial, /^emulator-\d+$/, 'Only disposable emulators are in scope');
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || `${process.env.HOME}/Android/Sdk`;
const adb = process.env.ADB_BINARY || `${sdk}/platform-tools/adb`;
const run = promisify(execFile);
const command = (...args) => run(adb, ['-s', serial, ...args], { timeout: 10000 });
const shell = (...args) => command('shell', ...args);
let socket, forwarded = false;

try {
  const avdName = (await command('emu', 'avd', 'name')).stdout.trim().split('\n')[0].trim();
  assert.equal(avdName, process.env.ANDROID_TEST_AVD, 'Offline smoke must use its explicitly owned disposable AVD');
  await shell('svc', 'wifi', 'disable');
  await shell('svc', 'data', 'disable');
  // Fresh disposable AVDs otherwise show Android's first-run fullscreen
  // tutorial above the app, consuming Back before it reaches the activity.
  await shell('settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed');
  await shell('am', 'start', '-W', '-n', 'au.local.blockops/.MainActivity');
  const pid = (await shell('pidof', 'au.local.blockops')).stdout.trim();
  assert.match(pid, /^\d+$/);
  await command('forward', 'tcp:9228', `localabstract:webview_devtools_remote_${pid}`);
  forwarded = true;
  const targets = await (await fetch('http://127.0.0.1:9228/json', { signal: AbortSignal.timeout(5000) })).json();
  const target = targets.find(item => item.url === 'https://appassets.androidplatform.net/assets/index.html');
  assert.ok(target, 'Game must load from packaged local HTTPS assets');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0, pageLoaded;
  const pending = new Map(), errors = [], remote = [], webSockets = [];
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
      // Chromium probes a favicon automatically; the exact asset whitelist
      // intentionally blocks that optional browser icon with a local 403.
      if (!(entry.source === 'network' && entry.url === 'https://appassets.androidplatform.net/favicon.ico')) errors.push(JSON.stringify(entry));
    }
    else if (message.method === 'Network.webSocketCreated') webSockets.push(message.params.url);
    else if (message.method === 'Network.requestWillBeSent' && !message.params.request.url.startsWith('https://appassets.androidplatform.net/')) remote.push(message.params.request.url);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
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
  const tap = async id => {
    const point = await evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: (r.x + r.width / 2) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio }; })()`);
    await shell('input', 'tap', String(Math.round(point.x)), String(Math.round(point.y)));
  };
  const state = () => evaluate('document.getElementById("timer") ? ({hidden:document.hidden,mode:document.body.dataset.mode,timer:document.getElementById("timer").textContent,fatal:!document.getElementById("fatal-screen").hidden,pause:!document.getElementById("pause-screen").hidden,classes:document.querySelectorAll(".class-tab").length}) : ({mode:"loading"})');
  const wait = async predicate => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const current = await state();
      if (predicate(current)) return current;
      await delay(100);
    }
    assert.fail(`Native state timeout: ${JSON.stringify(await state())}`);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
  await reload();
  await wait(current => current.mode === 'home' && !current.hidden && !current.fatal && current.classes === 7);
  assert.equal(await evaluate('innerWidth > innerHeight'), true);
  assert.equal(await evaluate('document.querySelectorAll("[data-map]").length'), 8);
  assert.equal(await evaluate('document.querySelectorAll("[data-skin]").length'), 8);
  await evaluate('document.querySelector("[data-map=space-station]").click(); document.querySelector("[data-skin=space-guard]").click()');
  await reload();
  await wait(current => current.mode === 'home');
  assert.equal(await evaluate('document.querySelector("[data-map=space-station]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('document.querySelector("[data-skin=space-guard]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('document.getElementById("character-preview").width > 1'), true);
  for (const id of ['home-solo', 'home-online', 'home-armory', 'home-settings']) {
    const bounds = await evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, viewportWidth:innerWidth, viewportHeight:innerHeight, footerTop:document.querySelector('#home-screen .app-footer').getBoundingClientRect().top }; })()`);
    assert.ok(bounds.width >= 44 && bounds.height >= 44, `${id} remains a native touch target`);
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= bounds.viewportWidth && bounds.y + bounds.height <= Math.min(bounds.viewportHeight, bounds.footerTop), `${id} fits the actual native viewport above its footer`);
  }
  await mkdir('artifacts/loot-review', { recursive: true });
  const homeShot = await run(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 10000000, timeout: 10000 });
  await writeFile('artifacts/loot-review/android-home.png', homeShot.stdout);
  await evaluate('document.querySelector("[data-mode-id=ffa]").click(); document.getElementById("home-armory").click()');
  assert.equal(await evaluate('document.querySelectorAll(".weapon-card").length'), 4);
  await evaluate('document.getElementById("armory-home").click()');
  await wait(current => current.mode === 'home');
  await evaluate(`document.querySelector('[data-map="courtyard"]').click(); document.getElementById('home-settings').click(); document.getElementById('bots').value='1'; document.getElementById('difficulty').value='easy'; document.getElementById('settings-done').click()`);
  // Observe animation time only; inputs and equipment use the shipped UI.
  await evaluate(`(() => { window.__nativeSeconds=0; const raf=window.requestAnimationFrame.bind(window); let previous; window.requestAnimationFrame=callback=>raf(now=>{ if(previous!==undefined && document.body.dataset.mode==='playing') window.__nativeSeconds+=Math.min(.05,(now-previous)/1000); previous=now; callback(now); }); })()`);
  await tap('home-solo');
  await wait(current => current.mode === 'playing' && current.timer !== '03:00');
  assert.equal(await evaluate('Number(document.getElementById("ammo-count").textContent)+Number(document.getElementById("reserve-count").textContent)'), 500, 'Solo starts with 500 total rounds');
  assert.equal(await evaluate('Boolean(document.getElementById("knife-button"))'), true, 'Candidate exposes the reviewed loot equipment controls');
  assert.equal(await evaluate('document.getElementById("knife-button").disabled'), true, 'Fresh life has no knife');
  const key = (type, code) => send('Input.dispatchKeyEvent', { type, code, key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.slice(-1).charCodeAt(0) });
  const walk = async (code, distance) => {
    const start = await evaluate('window.__nativeSeconds');
    await key('keyDown', code);
    try {
      const deadline = Date.now() + 30000;
      while (await evaluate('window.__nativeSeconds') - start < distance / 5.3) {
        assert.ok(Date.now() < deadline, `Native ${code} movement progresses`); await delay(60);
      }
    } finally { await key('keyUp', code); }
  };
  await walk('KeyW', 3); await walk('KeyA', 6);
  assert.match(await evaluate('document.getElementById("grenade-type-button").textContent'), /1\/3/, 'Real solo walk automatically picks up a grenade');
  // Cross the gun's center at (-2,6), then approach the knife at (-3,0).
  await walk('KeyD', 12); await walk('KeyA', 8); await walk('KeyW', 2); await walk('KeyW', 6); await walk('KeyA', 1); await walk('KeyW', 4);
  assert.equal(await evaluate('document.getElementById("knife-button").disabled'), false, 'Real solo walk collects a knife');
  await tap('knife-button');
  assert.equal(await evaluate('document.querySelector("#fire-button small").textContent'), 'SLASH', 'Actual equipment control equips the collected knife');
  await tap('knife-button');
  await evaluate('document.getElementById("loadout-button").click(); document.querySelector(\'[data-equipment-tab="carried"]\').click()');
  assert.ok(await evaluate('document.querySelectorAll("[data-carried-weapon]").length') > 1, 'Real solo walk collects a distinct gun');
  await evaluate('document.getElementById("armory-cancel").click(); document.getElementById("resume-button").click()');
  await mkdir('artifacts/loot-review', { recursive: true });
  const shot = await run(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 10000000, timeout: 10000 });
  await writeFile('artifacts/loot-review/android-gameplay.png', shot.stdout);
  await shell('input', 'keyevent', 'KEYCODE_BACK');
  const paused = await wait(current => current.mode === 'paused' && current.pause);
  await delay(1500); assert.equal((await state()).timer, paused.timer, 'Back freezes combat');
  await evaluate('document.getElementById("resume-button").click()');
  await wait(current => current.mode === 'playing');
  await shell('input', 'keyevent', 'KEYCODE_HOME');
  const background = await wait(current => current.hidden && current.mode === 'paused');
  await delay(1500); assert.equal((await state()).timer, background.timer, 'Background freezes combat');
  await shell('am', 'start', '-n', 'au.local.blockops/.MainActivity');
  const foreground = await wait(current => !current.hidden);
  assert.equal(foreground.mode, 'paused', 'Foregrounding requires explicit resume');
  assert.equal(foreground.pause, true); assert.equal(foreground.timer, background.timer);
  await tap('pause-home');
  await evaluate('document.getElementById("confirm-home").click()');
  await wait(current => current.mode === 'home');
  for (const [modeId, label, target] of [['ffa', 'FREE FOR ALL', '15'], ['tdm', 'TEAM DEATHMATCH', '30'], ['ctf', 'CAPTURE THE FLAG', '3 CAPTURES']]) {
    await evaluate(`document.querySelector('[data-mode-id=${modeId}]').click(); document.getElementById('home-solo').click()`);
    await wait(current => current.mode === 'playing');
    assert.match(await evaluate('document.getElementById("hud-mode").textContent'), new RegExp(label));
    assert.equal((await evaluate('document.querySelector(".score-target").textContent')).trim(), `/ ${target}`);
    assert.equal(await evaluate('Number(document.getElementById("ammo-count").textContent)+Number(document.getElementById("reserve-count").textContent)'), 500);
    if (modeId === 'ctf') assert.match(await evaluate('document.getElementById("objective-status").textContent'), /RED FLAG: HOME.*BLUE FLAG: HOME/);
    if (modeId !== 'ffa') assert.match(await evaluate('document.getElementById("hud-mode").textContent'), /RED/);
    await evaluate('document.getElementById("home-button").click()');
    const confirmation = await state();
    await delay(1100); assert.equal((await state()).timer, confirmation.timer, 'Home confirmation freezes solo clock');
    await evaluate('document.getElementById("cancel-home").click()');
    await wait(current => current.mode === 'playing');
    await evaluate('document.getElementById("home-button").click(); document.getElementById("confirm-home").click()');
    await wait(current => current.mode === 'home');
  }
  assert.deepEqual(errors, [], 'No JavaScript or CSP errors');
  assert.deepEqual(remote, [], 'No external runtime requests');
  assert.deepEqual(webSockets, [], 'Offline Home/solo never opens a WebSocket');
  console.log('Native emulator smoke passed: offline Home/persistence/preview, authored gun/grenade/knife pickups and real knife equipment action, all modes, Home cancel/confirm, 500 rounds, landscape, Back/background pause, no external requests or WebSockets.');
} finally {
  if (socket) socket.close();
  if (forwarded) await command('forward', '--remove', 'tcp:9228');
}
