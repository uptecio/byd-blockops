import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Raw CDP avoids browser automation's artificial document visibility override.
// Install the debug APK on a disposable emulator before running this test.
const serial = process.env.ANDROID_TEST_SERIAL;
const artifacts = process.env.ANDROID_TEST_ARTIFACTS || 'artifacts/zombies-review/android';
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
  const wait = async (predicate, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const current = await state();
      if (predicate(current)) return current;
      await delay(100);
    }
    assert.fail(`Native state timeout: ${JSON.stringify(await state())}`);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
  await reload();
  await wait(s => s.mode === 'home' && !s.hidden && !s.fatal);
  assert.equal(await evaluate('document.querySelectorAll("[data-mode-id]").length'), 4);
  assert.match(await evaluate('document.querySelector(".app-footer").textContent'), /v0\.5\.0 SOLO ZOMBIES/);
  // Passive observations only. No game state, visibility or progression overrides.
  await evaluate(`(() => {
    window.__nativeSeconds=0; window.__nativeDraws=0;
    const raf=window.requestAnimationFrame.bind(window); let previous;
    window.requestAnimationFrame=callback=>raf(now=>{
      if(previous!==undefined && document.body.dataset.mode==='playing')window.__nativeSeconds+=Math.min(.05,(now-previous)/1000);
      previous=now;callback(now);
    });
    for(const constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
      if(!constructor)continue;
      for(const name of ['drawElements','drawArrays']) {
        const original=constructor.prototype[name];
        constructor.prototype[name]=function(...args){if(this.canvas.id==='arena')window.__nativeDraws++;return original.apply(this,args);};
      }
    }
  })()`);
  await evaluate('document.querySelector("[data-map=courtyard]").click(); document.querySelector("[data-mode-id=zombies]").click()');
  await tap('home-solo'); await wait(s => s.mode === 'playing');
  assert.equal(await evaluate('document.getElementById("kills").textContent'), 'WAVE 1');
  assert.notEqual((await state()).timer, '03:00');
  const key = (type, code) => send('Input.dispatchKeyEvent', {type,code,key:code.slice(-1).toLowerCase(),windowsVirtualKeyCode:code.slice(-1).charCodeAt(0)});
  const walk = async (code,distance) => {
    const start=await evaluate('window.__nativeSeconds'), deadline=Date.now()+30000;
    await key('keyDown',code);
    try { while(await evaluate('window.__nativeSeconds')-start < distance/5.3) {
      assert.ok(Date.now()<deadline,'Native movement progresses'); await delay(60);
    }} finally {await key('keyUp',code);}
  };
  await walk('KeyW',3); await walk('KeyA',6);
  assert.equal(await evaluate('document.querySelectorAll("[data-inventory-key=\"grenade:frag\"]").length'),1,'Real movement collects visible numbered loot');
  await evaluate(`document.querySelector('[data-inventory-key="grenade:frag"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-inventory-key="grenade:frag"]').getAttribute('aria-pressed')`),'true');
  const ammo=()=>evaluate('Number(document.getElementById("ammo-count").textContent)');
  const before=await ammo(); await key('keyDown','KeyF'); await delay(350); await key('keyUp','KeyF');
  assert.ok(await ammo()<before,'Real controls shoot the packaged gun');
  assert.ok(await evaluate('window.__nativeDraws')>0,'Packaged arena issues WebGL draw calls');
  await mkdir(artifacts,{recursive:true});
  const capture=async name=>{const result=await run(adb,['-s',serial,'exec-out','screencap','-p'],{encoding:'buffer',maxBuffer:10000000,timeout:10000});await writeFile(`${artifacts}/${name}.png`,result.stdout);};
  await capture('android-zombies-playing');
  await shell('input','keyevent','KEYCODE_BACK');
  await wait(s=>s.mode==='paused'&&s.pause);
  const frozen=await evaluate('window.__nativeSeconds'),pausedAmmo=await ammo();
  await key('keyDown','KeyF');await delay(1000);await key('keyUp','KeyF');
  assert.equal(await evaluate('window.__nativeSeconds'),frozen);assert.equal(await ammo(),pausedAmmo);
  await tap('resume-button');await wait(s=>s.mode==='playing');
  await shell('input','keyevent','KEYCODE_HOME');
  await wait(s=>s.hidden&&s.mode==='paused');
  const background=await evaluate('window.__nativeSeconds');await delay(1200);
  assert.equal(await evaluate('window.__nativeSeconds'),background,'Background pauses zombie simulation');
  await shell('am','start','-n','au.local.blockops/.MainActivity');await wait(s=>!s.hidden);
  assert.equal((await state()).mode,'paused','Foreground requires deliberate resume');
  await tap('resume-button');await wait(s=>s.mode==='playing');
  await wait(s=>s.mode==='results',90000);
  assert.equal(await evaluate('document.getElementById("result-kills").textContent'),'0','Death in wave one completes zero waves');
  assert.match(await evaluate('document.getElementById("zombie-best").textContent'),/MAP BEST/);
  await capture('android-zombies-results');
  await tap('again-button');await wait(s=>s.mode==='playing');
  assert.equal(await evaluate('document.getElementById("kills").textContent'),'WAVE 1');
  assert.equal(await evaluate('document.getElementById("health-count").textContent'),'100');
  await tap('home-button');await tap('confirm-home');await wait(s=>s.mode==='home');
  assert.deepEqual(errors,[],'No JavaScript or CSP errors');
  assert.deepEqual(remote,[],'Zombie mode loads no remote resources');
  assert.deepEqual(webSockets,[],'Zombie mode never connects online');
  console.log('Native zombies passed: packaged offline drawing, real movement/pickup/inventory/fire, wave HUD, Back/background pause, death, replay and Home.');
} finally {
  if(socket)socket.close();
  if(forwarded)await command('forward','--remove','tcp:9228');
}

