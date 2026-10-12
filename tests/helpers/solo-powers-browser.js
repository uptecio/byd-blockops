import assert from 'node:assert/strict';

// Fixture PINs only. These helpers drive visible controls, never storage or
// gameplay state, and also use the small native fixture's locator API.
export async function openPowers(page,{origin='home',pin,firstSetup=false}={}) {
  const logo=page.locator(origin==='home'?'#home-secret-logo':'#pause-secret-logo');
  for(let i=0;i<5;i++)await logo.click();
  await page.waitForSelector('#solo-powers-screen:not([hidden])',{timeout:5000});
  assert.equal(await page.locator('#solo-powers-controls').isVisible(),false);
  assert.equal(await page.locator('#solo-powers-pin').getAttribute('type'),'password');
  await page.locator('#solo-powers-pin').fill(pin);
  if(firstSetup)await page.locator('#solo-powers-pin-confirm').fill(pin);
  await page.locator('#solo-powers-pin-submit').click();
  await page.waitForSelector('#solo-powers-controls:not([hidden])',{timeout:10000});
}

export async function choosePowers(page,config) {
  for(const [name,key] of [['invincible','invincible'],['ammo','unlimitedAmmo'],['speed','superSpeed']]) {
    const control=page.locator(`#solo-powers-${name}`);
    if(await control.evaluate(element=>element.checked)!==config[key])await control.click();
  }
  if(config.superSpeed)await page.locator('#solo-powers-speed-multiplier').fill(String(config.speedMultiplier));
  await page.locator('#solo-powers-apply').click();
  await page.waitForSelector('#solo-powers-screen[hidden]',{state:'attached'});
}
