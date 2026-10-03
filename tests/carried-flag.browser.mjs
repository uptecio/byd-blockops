import assert from 'node:assert/strict';
import { fixture, observer, moveTo, lookTo, selectGrenade, until } from './helpers/loot-browser.js';

const f = await fixture();
try {
  // Observe real scene objects at their ordinary attachment boundary. Never
  // mutate objects, gameplay state, inventories, positions, or network packets.
  for (const page of f.pages) await page.addInitScript(() => {
    const objects = new Set(), push = Array.prototype.push;
    window.__ctfSceneRead = () => [...objects].filter(object => object.parent).map(object => ({
      name: object.name, teamId: object.userData.teamId, visible: object.visible,
      x: object.position.x, y: object.position.y, z: object.position.z,
    }));
    Array.prototype.push = function (...items) {
      for (const object of items) if (object?.isObject3D &&
        (object.name === 'red-flag' || object.name === 'blue-flag' || object.userData?.skinId)) objects.add(object);
      return push.apply(this, items);
    };
  });
  for (let i = 0; i < 2; i++) {
    const page = f.pages[i]; await page.goto(f.base); await page.locator('#home-online').click();
    await page.locator('#player-name').fill(`CTFPeer${i}`);
    await page.locator('.server-settings').evaluate(element => { element.open = true; });
    await page.locator('#server-address').fill(f.base);
  }
  await f.pages[0].locator('#create-room').click();
  await f.pages[0].locator('#room-lobby:not([hidden])').waitFor();
  await f.pages[0].locator('#room-mode').selectOption('ctf');
  const code = await f.pages[0].locator('#room-code').textContent();
  await f.pages[1].locator('#room-code-input').fill(code); await f.pages[1].locator('#join-room').click();
  await until(async () => await f.pages[0].locator('#room-roster .roster-player').count() === 2, 'CTF peers joined');
  await f.pages[0].locator('#start-online').click();
  await Promise.all(f.pages.map(page => page.waitForSelector('body[data-mode="playing"]')));
  const viewer = observer(f, 0), carrier = observer(f, 1);
  await until(() => viewer.player && carrier.player, 'CTF authoritative snapshots');
  await moveTo(f.pages[1], carrier, 0, 12); await moveTo(f.pages[1], carrier, 6, 12);
  await moveTo(f.pages[1], carrier, -2, 10);
  await until(() => carrier.equipment.grenades.smoke === 1 && carrier.equipment.grenades.flash === 1, 'real CTF grenade pickups');
  await moveTo(f.pages[0], viewer, 0, -4);
  await moveTo(f.pages[1], carrier, 0, 18);
  await until(() => viewer.room.flags.red.carrierId === carrier.id, 'opponent physically steals red flag');
  await moveTo(f.pages[1], carrier, 0, 8); await lookTo(f.pages[0], viewer, Math.PI);
  const read = async () => {
    const objects = await f.pages[0].evaluate(() => window.__ctfSceneRead());
    return { flag: objects.find(object => object.name === 'red-flag'), avatar: objects.find(object => object.teamId === 'blue') };
  };
  await until(async () => { const { flag, avatar } = await read(); return flag?.visible && avatar?.visible; }, 'carried flag initially visible');
  for (const type of ['flash', 'smoke']) {
    await lookTo(f.pages[1], carrier, 0); await selectGrenade(f.pages[1], type);
    await f.pages[1].locator('#throw-button').click();
    await until(() => carrier.events('grenade-burst').some(event => event.grenadeType === type), `real CTF ${type} burst`);
    await until(async () => {
      const { flag, avatar } = await read(); return flag?.visible === false && avatar?.visible === false;
    }, `CTF carried flag and carrier conceal together under ${type}`);
    const hidden = await read();
    assert.equal(hidden.flag.x, hidden.avatar.x); assert.equal(hidden.flag.z, hidden.avatar.z);
    assert.equal(viewer.room.flags.red.carrierId, carrier.id, 'concealment preserves authority');
    await f.pages[0].screenshot({ path: `artifacts/loot-review/ctf-carried-${type}-hidden.png` });
    await until(async () => {
      const { flag, avatar } = await read(); return flag?.visible && avatar?.visible;
    }, `CTF carried flag and carrier recover together after ${type}`, 12000);
    await f.pages[0].screenshot({ path: `artifacts/loot-review/ctf-carried-${type}-recovered.png` });
    console.log(`PASS final-byte real CTF controls: stolen carried flag ${type} concealment and recovery`);
  }
  f.clean();
} finally { await f.close(); }
