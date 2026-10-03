import { chromium } from 'playwright';
import { startServer } from '../server/server.mjs';
import assert from 'node:assert/strict';

const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, hasTouch: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const session = await page.context().newCDPSession(page);
const touch = (type, touchPoints = []) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
const point = async (selector, id) => {
  const bounds = await page.locator(selector).boundingBox();
  assert.ok(bounds, `${selector} is visible`);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id };
};
const ammo = async () => Number(await page.locator('#ammo-count').textContent());
const waitRoundSeconds = async seconds => {
  const initial = await page.locator('#timer').textContent();
  const [minutes, remainder] = initial.split(':').map(Number);
  await page.waitForFunction(({ start, seconds }) => {
    const [minutes, remainder] = document.getElementById('timer').textContent.split(':').map(Number);
    return start - (minutes * 60 + remainder) >= seconds;
  }, { start: minutes * 60 + remainder, seconds }, { timeout: 15000 });
};
const stableAmmo = async message => {
  await page.waitForTimeout(250);
  const stopped = await ammo();
  await page.waitForTimeout(750);
  assert.equal(await ammo(), stopped, message);
  return stopped;
};
const equip = async (classId, weaponId) => {
  await page.locator('#loadout-button').click();
  await page.locator(`[data-class="${classId}"]`).click();
  await page.locator(`[data-weapon="${weaponId}"]`).click();
  await page.locator('#play-button').click();
  await page.waitForSelector('body[data-mode="playing"]');
};

try {
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.locator('#home-armory').click();
  await page.locator('#play-button').waitFor();
  await page.locator('#armory .settings-open').click();
  await page.locator('#bots').fill('1');
  await page.locator('#difficulty').selectOption('easy');
  await page.locator('#sound').uncheck();
  await page.locator('#settings-done').click();
  assert.match(await page.locator('#bot-count-label').textContent(), /1 BOT/);
  await page.reload();
  await page.locator('#home-armory').click();
  await page.locator('#armory .settings-open').click();
  assert.equal(await page.locator('#bots').inputValue(), '1', 'bot count persists');
  assert.equal(await page.locator('#difficulty').inputValue(), 'easy', 'difficulty persists');
  assert.equal(await page.locator('#sound').isChecked(), false, 'sound preference persists');
  await page.locator('#settings-done').click();
  await page.locator('#play-button').click();
  await page.waitForSelector('body[data-mode="playing"]');

  // Keep the original-gun restriction separate from ammo conservation:
  // M4A1 is the original; AK-47 and AWP are non-starting owned guns.
  await equip('assault', 'ak47');
  await page.locator('#loadout-button').click();
  await page.locator('[data-class="assault"]').click();
  await page.waitForFunction(() => document.querySelector('[data-weapon="m4a1"]').getAttribute('aria-disabled') === 'true');
  assert.match(await page.locator('[data-weapon="m4a1"]').textContent(), /Find this gun as loot/, 'replacing the starting gun requires loot before returning to it');
  await page.locator('#armory-cancel').click(); await page.locator('#resume-button').click();

  // These observation listeners inspect actual browser pointer delivery; they
  // do not replace application listeners or synthesize application events.
  await page.evaluate(() => {
    window.touchObservations = { aimMoves: 0, aimCancels: 0 };
    document.getElementById('aim-zone').addEventListener('pointermove', () => window.touchObservations.aimMoves++);
    document.getElementById('aim-zone').addEventListener('pointercancel', () => window.touchObservations.aimCancels++);
  });
  const joystick = await point('#joystick', 1);
  const aim = { x: 570, y: 200, id: 2 };
  const fire = await point('#fire-button', 3);
  const initial = await ammo();
  await touch('touchStart', [joystick]);
  await touch('touchStart', [joystick, aim]);
  await touch('touchStart', [joystick, aim, fire]);
  await touch('touchMove', [{ ...joystick, x: joystick.x + 30 }, { ...aim, x: aim.x + 45 }, fire]);
  await page.waitForTimeout(500);
  assert.ok(await ammo() < initial, 'three simultaneous touches can fire while moving and aiming');
  assert.notEqual(await page.locator('#joystick-knob').evaluate(element => element.style.transform), '', 'joystick receives its own drag');
  assert.ok(await page.evaluate(() => window.touchObservations.aimMoves) > 0, 'independent aim pointer receives movement');
  await touch('touchEnd');
  assert.equal(await page.locator('#joystick-knob').evaluate(element => element.style.transform), '', 'all touch releases center the joystick');
  const preserved = await stableAmmo('releasing every touch stops automatic fire');
  console.log('PASS simultaneous move/aim/fire and complete release');

  await touch('touchStart', [joystick, aim, fire]);
  await touch('touchMove', [{ ...joystick, y: joystick.y - 30 }, { ...aim, x: aim.x - 35 }, { ...fire, x: fire.x - 20 }]);
  await page.waitForTimeout(150);
  await touch('touchCancel');
  await page.waitForFunction(() => window.touchObservations.aimCancels > 0, null, { timeout: 5000 });
  assert.ok(await page.evaluate(() => window.touchObservations.aimCancels) > 0, 'aim drag receives browser cancellation');
  assert.equal(await page.locator('#joystick-knob').evaluate(element => element.style.transform), '', 'cancellation centers joystick');
  await stableAmmo('canceling aim/fire drag clears held firing');
  await touch('touchStart', [aim]);
  await touch('touchMove', [{ ...aim, x: aim.x + 20 }]);
  await touch('touchEnd');
  await stableAmmo('new aim gesture after cancel does not revive old fire');
  console.log('PASS drag cancellation and fresh gesture');

  // A round-trip through the armory preserves this weapon's depleted ammo.
  const beforeSwap = await ammo();
  assert.ok(beforeSwap <= preserved);
  await equip('sniper', 'awp');
  assert.equal(await ammo(), 5);
  const sniperFire = await point('#fire-button', 4);
  await touch('touchStart', [sniperFire]);
  await touch('touchEnd');
  await page.waitForFunction(() => document.getElementById('ammo-count').textContent === '4');
  await waitRoundSeconds(3);
  await touch('touchStart', [sniperFire]);
  await page.waitForFunction(() => document.getElementById('ammo-count').textContent === '3');
  // Wait in round time so slow WebGL machines still pass a full cooldown.
  await waitRoundSeconds(3);
  assert.equal(await ammo(), 3, 'holding semi-automatic fire does not shoot again after cooldown');
  await touch('touchEnd');
  await equip('assault', 'ak47');
  assert.equal(await ammo(), beforeSwap, 'switching back restores depleted magazine');
  console.log('PASS quick semi-auto taps, held semi-auto, and preserved weapon ammo');

  const pauseFire = await point('#fire-button', 5);
  await touch('touchStart', [pauseFire]);
  await page.waitForTimeout(180);
  await page.evaluate(() => window.pauseGame());
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'paused');
  const pausedAmmo = await ammo();
  const pausedTime = await page.locator('#timer').textContent();
  await page.waitForTimeout(800);
  assert.equal(await ammo(), pausedAmmo, 'native pause stops fire while the touch is still down');
  assert.equal(await page.locator('#timer').textContent(), pausedTime, 'native pause freezes round');
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'paused', 'pause persists until explicit resume');
  await page.locator('#resume-button').click();
  await stableAmmo('resume clears the previously held fire touch');
  await touch('touchEnd');
  await stableAmmo('late release after resume cannot restart firing');
  console.log('PASS native pause with held pointer and explicit clean resume');

  await page.locator('#pause-button').click();
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'paused');
  await page.locator('#pause-screen .settings-open').click();
  await page.locator('#bots').fill('8');
  await page.locator('#difficulty').selectOption('hard');
  await page.locator('#settings-done').click();
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'paused', 'closing in-round settings stays paused');
  await page.locator('#resume-button').click();
  await stableAmmo('settings resume carries no stale held input');

  // Keep real held fingers down across Home cancel and across a fresh round.
  const homeStick = await point('#joystick', 11), homeFire = await point('#fire-button', 12);
  await touch('touchStart', [homeStick, homeFire]);
  await touch('touchMove', [{ ...homeStick, x: homeStick.x + 25 }, homeFire]);
  await page.waitForTimeout(150);
  await page.locator('#home-button').click();
  assert.equal(await page.locator('#confirm-home-screen').isVisible(), true);
  const homeTime = await page.locator('#timer').textContent();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#timer').textContent(), homeTime, 'Home dialog pauses solo clock with fingers held');
  assert.equal(await page.locator('#joystick-knob').evaluate(element => element.style.transform), '', 'Home clears held joystick');
  await page.locator('#cancel-home').click();
  await stableAmmo('Home cancel resumes without held fire');
  await touch('touchEnd');
  await stableAmmo('late releases after Home cancel remain neutral');
  await touch('touchStart', [homeStick, homeFire]);
  await page.waitForTimeout(100);
  await page.locator('#home-button').click();
  await page.locator('#confirm-home').click();
  await page.waitForSelector('body[data-mode="home"]');
  await page.locator('#home-solo').click();
  await page.waitForSelector('body[data-mode="playing"]');
  assert.equal(await ammo(), 30, 'new round restores the original M4A1 magazine');
  await stableAmmo('new solo round does not revive held fire');
  assert.equal(await page.locator('#joystick-knob').evaluate(element => element.style.transform), '', 'new round keeps old joystick neutral');
  await touch('touchEnd');
  await stableAmmo('late releases from departed round stay neutral');
  console.log('PASS held-finger Home cancel/confirm and fresh-round input');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log('Touch acceptance passed: settings, multitouch, release/cancel, single shots, ammo preservation, native/UI pause.');
} finally {
  await session.detach();
  await browser.close();
  await server.close();
}
