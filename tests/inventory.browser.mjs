import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fixture, freshSolo, soloLoot, onlinePair, moveTo, lookAt, until } from './helpers/loot-browser.js';
import { emulateLegacyWebView } from './helpers/legacy-webview.js';

// Drive shipped pickup and selection controls; do not grant equipment or move
// actors by injecting state. Missing/incorrect HUD integration must fail here.
const legacy = process.env.LEGACY_WEBVIEW === '1';
const artifacts = process.env.INVENTORY_ARTIFACTS || 'artifacts/loot-inventory';
const f = await fixture({ width:854, height:480 });
const slot = (page, key) => page.locator(`[data-inventory-key="${key}"]`);
const playing = async page => {
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'playing');
  assert.equal(await page.locator('#fatal-screen').isHidden(), true);
  assert.equal(await page.locator('#armory').isHidden(), true);
  assert.equal(await page.locator('#grenade-picker').isHidden(), true);
};
const numbered = async page => {
  const labels = await page.locator('#inventory-slots .inventory-number').allTextContents();
  assert.deepEqual(labels.map(Number), Array.from({length:labels.length}, (_, i) => i + 1));
};
try {
  await mkdir(artifacts, {recursive:true});
  if (legacy) for (const page of f.pages) await emulateLegacyWebView(page.context());
  const page = f.pages[0];
  await freshSolo(page, f.base);
  assert.equal(await page.locator('#loot-inventory').isVisible(), true, 'Collected loot must be visible in the gameplay HUD');
  assert.equal(await page.locator('#inventory-slots button').count(), 1, 'A fresh life shows only its starting gun');
  assert.match(await slot(page, 'gun:m4a1').textContent(), /M4A1/);
  await numbered(page);
  await soloLoot(page);
  assert.equal(await page.locator('#hud-weapon').textContent(), 'M4A1', 'Pickups do not auto-equip');
  for (const key of ['knife','grenade:frag','grenade:smoke','grenade:flash']) assert.equal(await slot(page,key).count(), 1, `${key} shares the gun inventory`);
  assert.ok(await page.locator('[data-inventory-kind="gun"]').count() > 1);
  await numbered(page);
  await slot(page, 'knife').tap();
  await page.waitForFunction(() => document.querySelector('#fire-button small').textContent === 'SLASH');
  await playing(page);
  await slot(page, 'grenade:smoke').tap();
  await page.waitForFunction(() => document.getElementById('grenade-type-button').textContent.startsWith('Smoke'));
  assert.match(await slot(page, 'grenade:smoke').locator('.inventory-count').textContent(), /1/);
  await playing(page);
  await page.locator('#throw-button').tap();
  await page.waitForFunction(() => !document.querySelector('[data-inventory-key="grenade:smoke"]'));
  assert.equal(await slot(page, 'grenade:frag').count(), 1);
  assert.equal(await slot(page, 'grenade:flash').count(), 1);
  const otherKey = await page.locator('[data-inventory-kind="gun"]:not([data-inventory-key="gun:m4a1"])').first().getAttribute('data-inventory-key');
  const name = await slot(page, otherKey).locator('.inventory-name').textContent();
  await slot(page, otherKey).tap();
  await page.waitForFunction(name => document.getElementById('hud-weapon').textContent === name, name);
  assert.equal(await slot(page, 'gun:m4a1').count(), 0, 'First different gun still removes the starter');
  await playing(page);
  const ammo = Number(await page.locator('#ammo-count').textContent());
  await page.locator('#fire-button').tap();
  await page.waitForFunction(ammo => Number(document.getElementById('ammo-count').textContent) < ammo, ammo);
  const remaining = await page.locator('#ammo-count').textContent();
  await slot(page,'knife').tap(); await slot(page,otherKey).tap();
  assert.equal(await page.locator('#ammo-count').textContent(), remaining, 'Inventory switching does not refill ammo');
  await numbered(page);
  await page.screenshot({path:`${artifacts}/inventory-solo-${legacy ? 'legacy' : 'modern'}.png`});
  await page.locator('#pause-button').tap();
  await slot(page,'knife').evaluate(button => button.click());
  assert.equal(await page.locator('#fire-button small').textContent(), 'FIRE', 'Paused inventory cannot change held equipment');
  await page.locator('#pause-home').tap(); await page.locator('#confirm-home').tap();
  await page.locator('#home-solo').tap();
  await page.waitForSelector('body[data-mode="playing"]');
  assert.equal(await page.locator('#inventory-slots button').count(),1,'New round clears old collected slots');
  assert.equal(await slot(page,'gun:m4a1').count(),1);
  console.log('PASS Solo: collected guns/knife/grenades share numbered HUD, tap equips/selects without menus, real Throw updates counts, starter rule/ammo/reset preserved.');

  const peers = await onlinePair(f), peer = peers[0], friend = peers[1];
  for (const [x,z] of [[0,12],[-6,12],[6,12],[-2,12],[-2,4],[-3,4],[-3,0]]) await moveTo(page,peer,x,z);
  await until(() => peer.equipment.knife && peer.equipment.owned.length > 1 && peer.equipment.grenades.flash === 1, 'Real online walk collects mixed loot');
  for (const key of ['knife','grenade:frag','grenade:smoke','grenade:flash']) await slot(page,key).waitFor({state:'attached'});
  await numbered(page);
  assert.equal(peer.equipment.activeGunId,'m4a1');
  // A real horizontal touch swipe must scroll rather than equip/fire/aim.
  await page.locator('#inventory-slots').evaluate(element => {element.scrollLeft=0;});
  await page.evaluate(() => {
    window.__inventoryAimMoves=0;
    document.getElementById('aim-zone').addEventListener('pointermove',()=>window.__inventoryAimMoves++);
  });
  const strip = await page.locator('#inventory-slots').boundingBox();
  const beforeSwipe = {...peer.player};
  const cdp=await page.context().newCDPSession(page);
  try {
    const point={x:strip.x+strip.width-20,y:strip.y+strip.height/2,id:9};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    for(let step=1;step<=8;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:point.x-step*25}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(() => document.getElementById('inventory-slots').scrollLeft > 10);
  } finally {await cdp.detach();}
  assert.equal(peer.player.weaponId,beforeSwipe.weaponId); assert.equal(peer.player.heldItem,beforeSwipe.heldItem);
  assert.equal(peer.player.ammo,beforeSwipe.ammo);
  assert.equal(await page.evaluate(()=>window.__inventoryAimMoves),0,'Inventory swipe is not an aiming gesture');
  await slot(page,'knife').tap();
  await until(()=>peers.every(p=>p.room.players.find(player=>player.id===peer.id).heldItem==='knife'),'Both real peers see HUD knife selection');
  await playing(page);
  await slot(page,'grenade:flash').tap();
  await until(()=>peer.equipment.selectedGrenade==='flash','HUD grenade selection acknowledged');
  assert.equal(peer.equipment.grenades.flash,1,'Selecting does not throw');
  await page.locator('#throw-button').tap();
  await until(()=>peer.equipment.grenades.flash===0,'One Throw consumes selected flash');
  await page.waitForFunction(()=>!document.querySelector('[data-inventory-key="grenade:flash"]'));
  const gunKey=await page.locator('[data-inventory-kind="gun"]:not([data-inventory-key="gun:m4a1"])').first().getAttribute('data-inventory-key');
  await slot(page,gunKey).tap();
  await until(()=>peer.equipment.activeGunId===gunKey.slice(4),'HUD owned-gun action acknowledged without Armory');
  await until(()=>peers.every(p=>p.room.players.find(player=>player.id===peer.id).weaponId===gunKey.slice(4)),'Remote player sees same held gun');
  await playing(page);
  await page.screenshot({path:`${artifacts}/inventory-online-${legacy ? 'legacy' : 'modern'}.png`});
  // Existing death rule must reconcile the visible inventory as well as stock.
  await moveTo(page,peer,0,0); await moveTo(f.pages[1],friend,0,-.8);
  await lookAt(f.pages[1],friend,peer);
  const life=peer.player.lifeId;
  await f.pages[1].keyboard.press('KeyF');
  await until(()=>peer.player.lifeId>life,'Real headshot respawns inventory holder');
  await page.waitForFunction(()=>document.querySelectorAll('#inventory-slots button').length===1 && document.querySelector('[data-inventory-key="gun:m4a1"]'));
  assert.equal(await slot(page,'knife').count(),0); assert.equal(await page.locator('[data-inventory-kind="grenade"]').count(),0);
  assert.equal(peer.equipment.owned[0].ammo+peer.equipment.owned[0].reserve,500);
  console.log('PASS Online: real pickups, numbered HUD, touch swipe isolation, acknowledged gun/knife/grenade actions, independent peer agreement and death reset.');
  f.clean();
} finally {await f.close();}
