// Ordinary API26 launch and read-only CDP evidence; no injected runtime capabilities or saves.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import WebSocket from 'ws';

const serial = process.env.ANDROID_TEST_SERIAL, avd = process.env.ANDROID_TEST_AVD;
assert.equal(serial, 'emulator-5584'); assert.equal(avd, 'bydgame_updater_api26_google');
const root = resolve(import.meta.dirname, '../..');
const artifacts = resolve(process.env.ANDROID_TEST_ARTIFACTS || '');
assert.ok(artifacts.startsWith(resolve(root, 'artifacts') + sep));
await mkdir(artifacts, { recursive: true });
assert.ok((await realpath(artifacts)).startsWith((await realpath(resolve(root, 'artifacts'))) + sep));
const apk = process.env.ANDROID_TEST_CANDIDATE;
assert.ok(apk, 'Explicit candidate APK required');
function run(command, args, binary = false) {
  const result = spawnSync(command, args, { encoding: binary ? undefined : 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command}: ${result.error || result.stderr}`); return result.stdout;
}
const adb = args => run('/usr/bin/adb', ['-s', serial, ...args]);
function identity() {
  assert.equal(adb(['emu', 'avd', 'name']).split('\n')[0].trim(), avd);
  assert.equal(adb(['shell', 'getprop', 'ro.build.version.sdk']).trim(), '26');
  assert.equal(adb(['shell', 'getprop', 'sys.boot_completed']).trim(), '1');
}
const signer = run('/home/alex/Android/Sdk/build-tools/36.0.0/apksigner', ['verify', '--print-certs', apk]);
assert.ok(signer.includes('6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49'));
const metadata = run('/home/alex/Android/Sdk/build-tools/36.0.0/aapt2', ['dump', 'badging', apk]);
assert.match(metadata, /package: name='au.local.blockops' versionCode='14' versionName='0.10.0'/);
identity(); const install = adb(['install', '-r', apk]);
identity(); const launch = adb(['shell', 'am', 'start', '-W', '-n', 'au.local.blockops/.MainActivity']);
const pid = adb(['shell', 'pidof', 'au.local.blockops']).trim(); assert.match(pid, /^\d+$/);
const socket = `localabstract:webview_devtools_remote_${pid}`;
let port, ws;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (adb(['shell', 'cat', '/proc/net/unix']).includes(`@webview_devtools_remote_${pid}`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  identity(); port = adb(['forward', 'tcp:0', socket]).trim(); assert.match(port, /^\d+$/);
  let pages;
  for (let attempt = 0; attempt < 100; attempt++) {
    pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    if (pages.length) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(pages.length, 1); assert.equal(pages[0].url, 'https://appassets.androidplatform.net/assets/index.html');
  ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let next = 1; const pending = new Map();
  ws.on('message', data => { const message = JSON.parse(data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = next++, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP read timeout')); }, 10000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  let observed;
  // Compatible syntax; all expressions only read existing page/API state.
  const expression = "JSON.stringify({url:location.href,ua:navigator.userAgent,fromEntries:typeof Object.fromEntries,mode:document.body.dataset.mode,homeHidden:document.getElementById('home-screen').hidden,updaterHidden:document.getElementById('home-updates').hidden,fatalHidden:document.getElementById('fatal-screen').hidden,fatal:document.getElementById('fatal-details').textContent,bridge:typeof window.BlockOpsUpdates,callback:typeof window.receiveBlockOpsUpdate,width:innerWidth,height:innerHeight,buttons:['update-check','home-solo','home-online','home-range','home-settings','home-armory'].map(function(id){var b=document.getElementById(id).getBoundingClientRect();return {id:id,x:b.x,y:b.y,width:b.width,height:b.height};})})";
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await evaluate(expression);
    if (response.result?.result?.value) observed = JSON.parse(response.result.result.value);
    if (observed?.callback === 'function' && observed.updaterHidden === false && observed.width > observed.height) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const log = adb(['logcat', '-d', `--pid=${pid}`]);
  await writeFile(resolve(artifacts, 'startup-logcat.txt'), log);
  await writeFile(resolve(artifacts, 'ordinary-startup.json'), JSON.stringify({ serial, avd, pid,
    candidateSha256: createHash('sha256').update(await readFile(apk)).digest('hex'), metadata, signer, install, launch, observed }, null, 2));
  // Let the compositor present its next frames; the first fullscreen education overlay may remain.
  await new Promise(resolve => setTimeout(resolve, 1500));
  identity(); await writeFile(resolve(artifacts, 'ordinary-home.png'), run('/usr/bin/adb', ['-s', serial, 'exec-out', 'screencap', '-p'], true));
  assert.equal(observed.mode, 'home'); assert.equal(observed.homeHidden, false); assert.equal(observed.updaterHidden, false);
  assert.equal(observed.fatalHidden, true); assert.equal(observed.fatal, ''); assert.equal(observed.fromEntries, 'undefined');
  assert.match(observed.ua, /Chrome\/69\./); assert.doesNotMatch(log, /Uncaught (?:TypeError|SyntaxError|ReferenceError)|FATAL EXCEPTION/);
  for (const button of observed.buttons) assert.ok(button.width >= 44 && button.height >= 44 && button.x >= 0 && button.y >= 0
    && button.x + button.width <= observed.width + 1 && button.y + button.height <= observed.height + 1, `${button.id} outside actual ${observed.width}x${observed.height}: ${JSON.stringify(button)}`);
  console.log('PASS ordinary API26 Chrome69 Home startup: code14 candidate, original signer, missing fromEntries remains absent, no runtime injection');
} finally { if (ws) ws.close(); if (port) { identity(); adb(['forward', '--remove', `tcp:${port}`]); } }
