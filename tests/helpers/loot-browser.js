import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../../server/server.mjs';

export async function fixture(viewport = { width: 1200, height: 700 }) {
  const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], assets = [], packets = [[], []];
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      // Passive timing/resource instrumentation, never arena state or inputs.
      const observation = window.__lootObservation = { seconds: 0, frames: 0, live: {}, peak: {} };
      const native = window.requestAnimationFrame.bind(window);
      let previous;
      window.requestAnimationFrame = callback => native(now => {
        if (previous !== now) {
          if (previous !== undefined && document.body?.dataset.mode === 'playing') observation.seconds += Math.min(.05, (now - previous) / 1000);
          observation.frames++; previous = now;
        }
        callback(now);
      });
      for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        for (const kind of ['Buffer', 'Texture', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer']) {
          const create = prototype[`create${kind}`], remove = prototype[`delete${kind}`];
          if (!create || !remove) continue;
          const resources = new Set();
          prototype[`create${kind}`] = function (...args) {
            const resource = create.apply(this, args); if (resource) resources.add(resource);
            observation.live[kind] = resources.size; observation.peak[kind] = Math.max(observation.peak[kind] || 0, resources.size); return resource;
          };
          prototype[`delete${kind}`] = function (resource) { resources.delete(resource); observation.live[kind] = resources.size; return remove.call(this, resource); };
        }
      }
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) assets.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => assets.push(`${request.failure()?.errorText} ${request.url()}`));
    page.on('websocket', socket => socket.on('framereceived', frame => packets[i].push(JSON.parse(String(frame.payload)))));
    pages.push(page);
  }
  return { server, browser, pages, packets, base: `http://127.0.0.1:${server.port}`,
    clean() { assert.deepEqual(errors, [], 'no page exceptions'); assert.deepEqual(assets, [], 'no failed game assets (favicon is separate)'); },
    async close() { await browser.close(); await server.close(); } };
}

export async function until(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.fail(label);
}

export async function freshSolo(page, base) {
  await page.goto(base);
  await page.locator('#home-settings').click();
  await page.locator('#bots').fill('1');
  await page.locator('#difficulty').selectOption('easy');
  await page.locator('#sound').uncheck();
  await page.locator('#settings-done').click();
  await page.locator('#home-solo').click();
  await page.waitForSelector('body[data-mode="playing"]');
}

export async function emptyControls(page) {
  await page.locator('#knife-button').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.locator('#knife-button').isDisabled(), true);
  assert.equal(await page.locator('#throw-button').isDisabled(), true);
  assert.equal(Number(await page.locator('#ammo-count').textContent()) + Number(await page.locator('#reserve-count').textContent()), 500);
}

export async function walkSolo(page, key, distance, speed = 5.3) {
  const start = await page.evaluate(() => window.__lootObservation.seconds);
  await page.keyboard.down(key);
  try { await page.waitForFunction(({ start, duration }) => window.__lootObservation.seconds - start >= duration,
    { start, duration: distance / speed }, { timeout: 20000 }); }
  finally { await page.keyboard.up(key); }
}

export async function equip(page, classId, id) {
  await page.locator('#loadout-button').click();
  await page.locator('[data-equipment-tab="armory"]').click();
  await page.locator(`[data-class="${classId}"]`).click();
  await page.locator(`[data-weapon="${id}"]`).click();
  const name = await page.locator('#selected-name').textContent();
  await page.locator('#play-button').click();
  await page.waitForSelector('body[data-mode="playing"]');
  await page.waitForFunction(name => document.querySelector('#hud-weapon').textContent === name, name);
}

export async function soloLoot(page) {
  // Hand-authored Courtyard route: (0,15) → (-6,12) → (6,12)
  // → (-2,10) → (-3,0). The central lane avoids the wall at (-6,7).
  await walkSolo(page, 'KeyW', 3);
  await walkSolo(page, 'KeyA', 6);
  await until(async () => /1\/3/.test(await page.locator('#grenade-type-button').textContent()), 'walking onto authored explosive pickup grants one grenade');
  await walkSolo(page, 'KeyD', 12);
  await until(async () => /2\/3/.test(await page.locator('#grenade-type-button').textContent()), 'walking onto authored smoke pickup grants second grenade');
  await walkSolo(page, 'KeyA', 8);
  await walkSolo(page, 'KeyW', 2);
  await until(async () => /3\/3/.test(await page.locator('#grenade-type-button').textContent()), 'walking onto authored flash pickup fills shared capacity');
  await walkSolo(page, 'KeyA', 1);
  await walkSolo(page, 'KeyW', 10);
  await until(async () => !await page.locator('#knife-button').isDisabled(), 'walking onto authored knife pickup enables knife');
}

export function observer(f, index) {
  const messages = f.packets[index];
  return {
    get id() { return messages.find(packet => packet.type === 'welcome')?.id; },
    get packet() { return messages.findLast(packet => packet.room?.phase === 'playing'); },
    get room() { return this.packet?.room; },
    get equipment() { return this.packet?.equipment?.equipment; },
    get player() { return this.room?.players.find(player => player.id === this.id); },
    events(type) { return [...new Map(messages.flatMap(packet => packet.room?.events || []).filter(event => event.type === type).map(event => [event.id, event])).values()]; },
  };
}

export async function onlinePair(f) {
  for (let i = 0; i < 2; i++) {
    const page = f.pages[i];
    await page.goto(f.base); await page.locator('#home-online').click();
    await page.locator('#player-name').fill(`LootPeer${i}`);
    await page.locator('.server-settings').evaluate(element => { element.open = true; });
    await page.locator('#server-address').fill(f.base);
  }
  await f.pages[0].locator('#create-room').click();
  await f.pages[0].locator('#room-lobby:not([hidden])').waitFor();
  const code = await f.pages[0].locator('#room-code').textContent();
  await f.pages[1].locator('#room-code-input').fill(code); await f.pages[1].locator('#join-room').click();
  await until(async () => await f.pages[0].locator('#room-roster .roster-player').count() === 2, 'two independent browser peers joined');
  await f.pages[0].locator('#start-online').click();
  await Promise.all(f.pages.map(page => page.waitForSelector('body[data-mode="playing"]')));
  const peers = [observer(f, 0), observer(f, 1)];
  await until(() => peers.every(peer => peer.player), 'both peers receive authoritative playing snapshots');
  return peers;
}

export async function lookTo(page, peer, yaw, pitch = 0) {
  // Drag the existing aim surface. Packet observations supply the current aim.
  for (let attempt = 0; attempt < 5; attempt++) {
    const delta = Math.atan2(Math.sin(yaw - peer.player.yaw), Math.cos(yaw - peer.player.yaw));
    const vertical = pitch - peer.player.pitch;
    if (Math.abs(delta) < .015 && Math.abs(vertical) < .015) return;
    const horizontalPixels = -delta / .0026, verticalPixels = -vertical / .0026;
    const segments = Math.ceil(Math.max(Math.abs(horizontalPixels), Math.abs(verticalPixels)) / 190);
    for (let i = 0; i < segments; i++) {
      await page.mouse.move(550, 170); await page.mouse.down();
      await page.mouse.move(550 + horizontalPixels / segments, 170 + verticalPixels / segments, { steps: 3 });
      await page.mouse.up(); await page.waitForTimeout(60);
    }
    await page.waitForTimeout(160);
  }
  assert.ok(Math.abs(Math.atan2(Math.sin(yaw - peer.player.yaw), Math.cos(yaw - peer.player.yaw))) < .03, 'real aim drag reaches target yaw');
}

export async function moveTo(page, peer, x, z) {
  await lookTo(page, peer, 0);
  for (const [axis, target, positive, negative] of [['x', x, 'KeyD', 'KeyA'], ['z', z, 'KeyS', 'KeyW']]) {
    for (let attempt = 0; attempt < 4 && Math.abs(peer.player[axis] - target) > .35; attempt++) {
      const direction = Math.sign(target - peer.player[axis]);
      const key = direction > 0 ? positive : negative;
      await page.keyboard.down(key);
      try { await until(() => direction * (target - peer.player[axis]) < .25, `real ${key} movement reaches (${x},${z}); now ${JSON.stringify(peer.player)}`, 12000); }
      finally { await page.keyboard.up(key); }
      await page.waitForTimeout(120);
    }
    assert.ok(Math.abs(peer.player[axis] - target) < .7, `movement settles at ${axis}=${target}`);
  }
}

export async function selectGrenade(page, type) {
  await page.locator('#grenade-type-button').click();
  await page.locator('#grenade-picker').waitFor({ state: 'visible' });
  await page.locator(`[data-grenade-type="${type}"]`).click();
  await page.locator('#grenade-picker-resume').click();
  await page.waitForSelector('body[data-mode="playing"]');
}
