import test from 'node:test';
import assert from 'node:assert/strict';
import { playProtectState, settledPlayProtect } from '../android/tests/helpers/updater-native.js';

const focus = 'window u0 com.android.vending/com.google.android.finsky.protectdialogs.activity.PlayProtectDialogsActivity';
const home = '<hierarchy><node package="au.local.blockops" text="Home" /></hierarchy>';
const prompt = text => `<hierarchy><node package="com.android.vending" text="${text}" /><node text="Block Ops" /><node text="Scan app" /></hierarchy>`;
function fixture(snapshots) {
  let elapsed = 0, reads = 0, waits = 0;
  return {
    ports: {
      readFocus: async () => focus,
      readHierarchy: async () => snapshots[Math.min(reads++, snapshots.length - 1)],
      now: () => elapsed,
      pause: async () => { waits++; elapsed += 100; },
      timeout: 300,
    },
    counts: () => ({ reads, waits }),
  };
}

test('Play Protect waits for its own hierarchy after focus changes from the game', async () => {
  const f = fixture([home, prompt('App scan recommended')]);
  assert.equal((await settledPlayProtect(f.ports)).state, 'recommendation');
  assert.deepEqual(f.counts(), { reads: 2, waits: 1 });
});

test('a persistent focus/hierarchy mismatch times out without an actionable observation', async () => {
  const f = fixture([home]);
  await assert.rejects(settledPlayProtect(f.ports), /hierarchy did not match the focused Play Protect window/);
  assert.equal(f.counts().reads, 3);
});

for (const text of ['Unknown security finding', 'Harmful app blocked', "Couldn't scan app"]) {
  test(`matching ${text} stops immediately`, async () => {
    const f = fixture([prompt(text)]);
    assert.equal((await settledPlayProtect(f.ports)).state, 'security-boundary');
    assert.deepEqual(f.counts(), { reads: 1, waits: 0 });
  });
}

test('leaving Play Protect returns no actionable observation', async () => {
  const f = fixture([prompt('App scan recommended')]);
  let calls = 0;
  f.ports.readFocus = async () => ++calls === 1 ? focus : 'window au.local.blockops/.MainActivity';
  assert.equal(await settledPlayProtect(f.ports), null);
});

const safe = labels => '<hierarchy>'+labels.map(text=>`<node package="com.android.vending" text="${text}" />`).join('')+'</hierarchy>';
const safeLabels = ['This app looks safe','Block Ops','You can continue to install it','Install'];
test('the exact successful Block Ops scan result permits the separate normal Install confirmation', () => {
  assert.equal(playProtectState(safe(safeLabels),focus),'safe');
});
for(const labels of [safeLabels.slice(1),safeLabels.filter(x=>x!=='Block Ops'),safeLabels.map(x=>x==='Install'?'Install anyway':x),[...safeLabels,'Harmful app blocked'],[...safeLabels,"Couldn't scan app"],[...safeLabels,'Unknown security finding'],['Unknown result','Block Ops','Install']]){
  test(`incomplete, deceptive or negative safe-result labels remain blocked: ${labels.join(' / ')}`, () => {
    assert.equal(playProtectState(safe(labels),focus),'security-boundary');
  });
}
test('safe-looking labels in another package do not authorize installation', () => {
  assert.equal(playProtectState(safe(safeLabels).replaceAll('com.android.vending','au.local.blockops'),focus),'security-boundary');
});
