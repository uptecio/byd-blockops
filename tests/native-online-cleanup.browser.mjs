import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../server/server.mjs';
import { cleanupOwnedOnlineSession } from '../android/tests/online-cleanup.mjs';

const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
const base = `http://127.0.0.1:${server.port}`;
let browser, peer;
const until = async predicate => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Room cleanup observation timed out');
};
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const openConfirmation of [false, true]) {
    const page = await browser.newPage();
    let ownId, code, observed, peerId;
    page.on('websocket', socket => socket.on('framereceived', frame => {
      const packet = JSON.parse(String(frame.payload));
      if (packet.type === 'welcome') { ownId = packet.id; code = packet.room.code; }
    }));
    await page.goto(base); await page.locator('#home-online').click();
    await page.locator('.server-settings').evaluate(element => { element.open = true; });
    await page.locator('#server-address').fill(base); await page.locator('#create-room').click();
    await until(() => ownId && code);
    peer = new WebSocket(`${base.replace('http:', 'ws:')}/ws`);
    peer.onmessage = event => {
      const packet = JSON.parse(event.data);
      if (packet.type === 'welcome') peerId = packet.id;
      if (packet.room?.code === code) observed = packet.room;
    };
    await new Promise((resolve, reject) => { peer.onopen = resolve; peer.onerror = reject; });
    peer.send(JSON.stringify({ type: 'join', protocol: 3, code, name: 'CleanupObserver', weaponId: 'm4a1', skinId: 'robo-unit' }));
    await until(() => observed?.players.length === 2);
    if (openConfirmation) {
      await page.locator('#leave-room').click();
      await page.waitForSelector('#confirm-home-screen:not([hidden])');
    }
    const originalError = new Error('Original acceptance failure');
    const laterError = new Error('Forward removal failed');
    const reported = [];
    await assert.rejects(async () => {
      try { throw originalError; }
      finally {
        await cleanupOwnedOnlineSession({
          stopApp: process.env.TEST_OLD_NATIVE_CLEANUP
            ? () => page.evaluate(() => document.getElementById('leave-room').click())
            : () => page.close(), // Actual renderer shutdown closes its socket.
          verifyDeparture: async () => {
            assert.equal(peer.readyState, WebSocket.OPEN, 'observer stays connected through departure verification');
            await until(() => observed?.players.length === 1 && observed.players[0].id === peerId && !observed.players.some(player => player.id === ownId));
          },
          closePeers: () => peer.close(),
          closeCdp: () => assert.equal(page.isClosed(), true),
          removeForward: () => { throw laterError; },
          originalError,
          onCleanupError: error => reported.push(error),
        });
      }
    }, error => error === originalError, 'cleanup must preserve the exact original acceptance failure');
    assert.deepEqual(reported, [laterError], 'cleanup reports its failure without replacing the original acceptance error');
    peer = undefined;
    console.log(`Cleanup passed: live native-equivalent renderer departure observed with confirmation ${openConfirmation ? 'open' : 'closed'}, remaining cleanup preserved.`);
  }
  let continued = false;
  await assert.rejects(cleanupOwnedOnlineSession({
    stopApp: () => { throw new Error('App shutdown failed'); },
    removeForward: () => { continued = true; },
  }), AggregateError);
  assert.equal(continued, true, 'all cleanup steps run even when an earlier step fails');
} finally {
  peer?.close();
  await browser?.close();
  await server.close();
}
