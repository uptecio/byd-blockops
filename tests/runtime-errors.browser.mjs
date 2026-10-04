import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { WebSocketServer } from 'ws';
import { startServer } from '../server/server.mjs';

// Serve fresh source in memory by default, or verify exact packaged bytes with
// DIST_DIR. This suite never changes packaged dist files.
const assetDir = process.env.DIST_DIR && resolve(process.env.DIST_DIR);
const script = assetDir ? await readFile(resolve(assetDir, 'game.js'), 'utf8')
  : (await build({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', target: 'es2017', define: { __GAME_SERVER_URL__: '""' } })).outputFiles[0].text;
const [html, css] = await Promise.all([readFile(assetDir ? resolve(assetDir, 'index.html') : 'index.html', 'utf8'), readFile(assetDir ? resolve(assetDir, 'styles.css') : 'src/styles.css', 'utf8')]);
const server = await startServer({ port: 0, distDir: assetDir || 'dist' });
const base = `http://127.0.0.1:${server.port}`;
const pendingServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise(resolve => pendingServer.once('listening', resolve));
let browser;
const userAgent = 'Mozilla/5.0 (Linux; Android 9; BYD) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.186 Safari/537.36';

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 853, height: 480 }, userAgent });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${base}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (path === '/game.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    if (path === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
    return route.continue();
  });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame;
    window.scheduledFrames = 0;
    window.requestAnimationFrame = callback => {
      window.scheduledFrames++;
      return requestFrame.call(window, callback);
    };
    window.addEventListener('test-runtime-error', event => { throw new Error(event.detail); });
    window.addEventListener('test-runtime-rejection', event => { Promise.reject(new Error(event.detail)); });
  });
  return { page, errors };
}

async function expectFatal(page, message) {
  await page.waitForSelector('#fatal-screen:not([hidden])', { timeout: 3000 });
  assert.match(await page.locator('#fatal-details').textContent(), new RegExp(message));
  assert.ok((await page.locator('#fatal-details').textContent()).includes(userAgent), 'the photo includes the actual WebView version');
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'fatal');
  assert.equal(await page.locator('#retry-button').isEnabled(), true, 'reload remains usable');
  const scheduled = await page.evaluate(() => window.scheduledFrames);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.scheduledFrames), scheduled, 'fatal errors stop scheduling game frames');
}

try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  // Removing the global exception listener must fail this: the real DOM event
  // callback throws after deployment, beyond the initialisation try/catch.
  await test('callback failures preserve first diagnostics and stop the app until reload', async () => {
    const { page, errors } = await openPage();
    await page.goto(base);
    await page.locator('#home-solo').click();
    await page.keyboard.down('KeyF');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-runtime-error', { detail: 'First callback failure <img src=x onerror=alert(1)>' })));
    await expectFatal(page, 'First callback failure');
    assert.ok(errors.some(message => message.includes('First callback failure')), 'a real uncaught callback exception was raised');
    assert.equal(await page.locator('#fatal-details img').count(), 0, 'exception text cannot become HTML');
    assert.equal(await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true, cancelable: true });
      window.dispatchEvent(event); return event.defaultPrevented;
    }), false, 'game controls no longer consume fire input after fatal shutdown');
    const original = await page.locator('#fatal-details').textContent();
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('test-runtime-error', { detail: 'Later callback failure' }));
      window.pauseGame();
      document.getElementById('resume-button').click();
    });
    assert.equal(await page.locator('#fatal-details').textContent(), original, 'later errors preserve the first diagnostic');
    assert.equal(await page.locator('body').getAttribute('data-mode'), 'fatal', 'native pause and stale menu actions cannot resume a failed game');
    await page.locator('#retry-button').click();
    await page.waitForSelector('body[data-mode="home"]');
    assert.equal(await page.locator('#fatal-screen').isHidden(), true, 'reload starts a fresh app');
    await page.close();
    console.log('Runtime error: callback failure, safe text, first error, stopped frames and reload passed.');
  });

  await test('long diagnostics wrap within the compact BYD display with reachable reload', async () => {
    const { page } = await openPage();
    await page.goto(base);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-runtime-error', { detail: 'Long diagnostic: ' + 'SomeUnexpectedFailure'.repeat(45) })));
    await expectFatal(page, 'Long diagnostic');
    assert.equal(await page.locator('#fatal-details').evaluate(element => element.scrollWidth > element.clientWidth), false, 'long first error and WebView details wrap without horizontal scrolling');
    await page.locator('#retry-button').scrollIntoViewIfNeeded();
    const bounds = await page.locator('#retry-button').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 853 && bounds.y + bounds.height <= 480, 'reload fits inside the compact display');
    await page.close();
  });

  // Removing the rejection listener must fail: no synchronous catch sees this.
  await test('unhandled promise rejection shows a fatal diagnostic', async () => {
    const { page } = await openPage();
    await page.goto(base);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-runtime-rejection', { detail: 'Unhandled promise failure' })));
    await expectFatal(page, 'Unhandled promise failure');
    await page.close();
    console.log('Runtime error: unhandled promise rejection passed.');
  });

  // An early, non-WebGL exception must retain its actual cause and Reload.
  await test('early startup failures show their actual cause and a working reload', async () => {
    const { page } = await openPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { return { getItem() { return '{"settings":{"sensitivity":1}}'; } }; } });
      Number.isFinite = () => { throw new TypeError('Settings initialisation failed'); };
    });
    await page.goto(base);
    await expectFatal(page, 'Settings initialisation failed');
    assert.doesNotMatch(await page.locator('#fatal-message').textContent(), /needs a working WebGL/i, 'unrelated startup errors are not diagnosed as missing WebGL');
    await page.close();
    console.log('Runtime error: early setup failure passed.');
  });

  // Throw from the real renderer called by an animation frame. If frame
  // handling is removed, the diagnostic or frame shutdown assertions fail.
  await test('an exception during the real renderer frame stops the frame loop', async () => {
    const { page } = await openPage();
    await page.addInitScript(() => {
      for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!Context) continue;
        const draw = Context.prototype.drawElements;
        Context.prototype.drawElements = function (...args) {
          if (window.failNextDraw) { window.failNextDraw = false; throw new Error('Arena frame rendering failed'); }
          return draw.apply(this, args);
        };
      }
    });
    await page.goto(base);
    await page.locator('#home-solo').click();
    await page.evaluate(() => { window.failNextDraw = true; });
    await expectFatal(page, 'Arena frame rendering failed');
    await page.close();
    console.log('Runtime error: live frame exception passed.');
  });

  // Resource failures are not runtime exceptions and must not halt a game.
  await test('missing unrelated resources do not stop gameplay', async () => {
    const { page, errors } = await openPage();
    await page.goto(base);
    await page.evaluate(() => new Promise(resolve => {
      const image = document.createElement('img'); image.onload = image.onerror = resolve;
      image.src = '/missing-runtime-test-image.png'; document.body.appendChild(image);
    }));
    assert.equal(await page.locator('#fatal-screen').isHidden(), true);
    await page.locator('#home-solo').click();
    assert.equal(await page.locator('body').getAttribute('data-mode'), 'playing');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('Runtime error: unrelated resource errors remain nonfatal.');
  });

  // Fatal cleanup must close even a not-yet-welcomed real socket. An input
  // cleanup exception cannot hide the original failure or skip cancellation.
  await test('fatal shutdown cancels pending connections even when input cleanup throws', async () => {
    const { page } = await openPage();
    await page.goto(base);
    await page.locator('#home-online').click();
    await page.locator('.server-settings').evaluate(element => { element.open = true; });
    await page.locator('#server-address').fill(`http://127.0.0.1:${pendingServer.address().port}`);
    const connected = new Promise(resolve => pendingServer.once('connection', resolve));
    await page.locator('#create-room').click();
    const socket = await connected;
    const disconnected = new Promise(resolve => socket.once('close', resolve));
    await page.evaluate(() => {
      Object.defineProperty(document.getElementById('joystick-knob').style, 'transform', { set() { throw new Error('Secondary input cleanup failure'); } });
      window.dispatchEvent(new CustomEvent('test-runtime-error', { detail: 'Original pending connection failure' }));
    });
    await expectFatal(page, 'Original pending connection failure');
    await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(new Error('Fatal cleanup left pending socket open')), 3000))]);
    assert.doesNotMatch(await page.locator('#fatal-details').textContent(), /Secondary input cleanup failure/);
    await page.close();
    console.log('Runtime error: throwing cleanup preserves diagnostics and cancels pending connection.');
  });
} finally {
  await browser?.close();
  for (const socket of pendingServer.clients) socket.terminate();
  await new Promise(resolve => pendingServer.close(resolve));
  await server.close();
}
