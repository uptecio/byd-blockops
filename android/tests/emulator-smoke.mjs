import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Raw CDP avoids browser automation's artificial document visibility override.
// Install the debug APK on a disposable emulator before running this test.
const serial = process.env.ANDROID_TEST_SERIAL || 'emulator-5582';
assert.match(serial, /^emulator-\d+$/, 'Only disposable emulators are in scope');
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || `${process.env.HOME}/Android/Sdk`;
const adb = process.env.ADB_BINARY || `${sdk}/platform-tools/adb`;
const run = promisify(execFile);
const command = (...args) => run(adb, ['-s', serial, ...args], { timeout: 10000 });
const shell = (...args) => command('shell', ...args);
let socket, forwarded = false;

try {
  await shell('svc', 'wifi', 'disable');
  await shell('svc', 'data', 'disable');
  await shell('am', 'start', '-n', 'au.local.blockops/.MainActivity');
  const pid = (await shell('pidof', 'au.local.blockops')).stdout.trim();
  assert.match(pid, /^\d+$/);
  await command('forward', 'tcp:9228', `localabstract:webview_devtools_remote_${pid}`);
  forwarded = true;
  const targets = await (await fetch('http://127.0.0.1:9228/json', { signal: AbortSignal.timeout(5000) })).json();
  const target = targets.find(item => item.url === 'https://appassets.androidplatform.net/assets/index.html');
  assert.ok(target, 'Game must load from packaged local HTTPS assets');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const pending = new Map(), errors = [], remote = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timeout);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      // Chromium probes a favicon automatically; the exact asset whitelist
      // intentionally blocks that optional browser icon with a local 403.
      if (!(entry.source === 'network' && entry.url === 'https://appassets.androidplatform.net/favicon.ico')) errors.push(JSON.stringify(entry));
    }
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
  const state = () => evaluate('({hidden:document.hidden,mode:document.body.dataset.mode,timer:document.getElementById("timer").textContent,fatal:!document.getElementById("fatal-screen").hidden,pause:!document.getElementById("pause-screen").hidden,classes:document.querySelectorAll(".class-tab").length})');
  const wait = async predicate => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const current = await state();
      if (predicate(current)) return current;
      await delay(100);
    }
    assert.fail(`Native state timeout: ${JSON.stringify(await state())}`);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await evaluate('location.reload()');
  await wait(current => !current.hidden && !current.fatal && current.classes === 7);
  assert.equal(await evaluate('innerWidth > innerHeight'), true);
  assert.equal(await evaluate('document.querySelectorAll(".weapon-card").length'), 4);
  await evaluate('document.getElementById("play-button").click()');
  await wait(current => current.mode === 'playing' && current.timer !== '03:00');
  await mkdir('artifacts', { recursive: true });
  const shot = await run(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 10000000, timeout: 10000 });
  await writeFile('artifacts/android-gameplay.png', shot.stdout);
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
  assert.deepEqual(errors, [], 'No JavaScript or CSP errors');
  assert.deepEqual(remote, [], 'No external runtime requests');
  console.log('Native emulator smoke passed: offline menu, deploy, landscape, Android back/background pause, explicit resume required.');
} finally {
  if (socket) socket.close();
  if (forwarded) await command('forward', '--remove', 'tcp:9228');
}
