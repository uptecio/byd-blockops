import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateUI } from '../src/update-ui.js';
import { execFileSync } from 'node:child_process';

function fixture(bridge = true) {
  const nodes = Object.fromEntries(['home-updates', 'update-status', 'update-check', 'update-open'].map(id => [id, {
    hidden: true, textContent: '', disabled: false, events: {},
    addEventListener(name, fn) { this.events[name] = fn; }, removeEventListener(name) { delete this.events[name]; },
    click() { this.events.click?.(); },
  }]));
  const calls = [], modals = [], events = {};
  const document = { hidden: false, getElementById: id => nodes[id], querySelectorAll: () => modals,
    addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener: name => { delete events[name]; } };
  let changed;
  const window = { fetch() { throw Error('Unexpected network'); }, MutationObserver: class {
    constructor(fn) { changed = fn; } observe() {} disconnect() { changed = null; }
  } };
  if (bridge) window.BlockOpsUpdates = { homeState: value => calls.push(['homeState', value]), check: () => calls.push(['check']), open: () => calls.push(['open']) };
  const ui = createUpdateUI({ window, document });
  return { ui, nodes, window, document, calls, modals, changed: () => changed?.() };
}
const snapshot = (patch = {}) => ({ revision: 1, phase: 'available', installedVersion: '0.10.0', availableVersion: '0.11.0', totalBytes: 200, downloadedBytes: 0, message: 'An update is available.', dismissed: false, ...patch });
test('noBridgeNoUpdater', () => {
  const f = fixture(false); f.ui.setHomeVisible(true);
  assert.equal(f.nodes['home-updates'].hidden, true); assert.deepEqual(f.calls, []); f.ui.dispose();
});
test('threeCommandContract', () => {
  const f = fixture(); f.ui.setHomeVisible(true); f.window.receiveBlockOpsUpdate(snapshot());
  f.nodes['update-check'].click(); f.nodes['update-open'].click();
  assert.deepEqual(f.calls, [['homeState', 'home'], ['check'], ['open']]);
  f.ui.dispose(); assert.deepEqual(f.calls.at(-1), ['homeState', 'hidden']);
  assert.equal(f.window.receiveBlockOpsUpdate, undefined);
});
test('staleAndMalformedStatusIgnored', () => {
  const f = fixture(); f.ui.setHomeVisible(true); f.window.receiveBlockOpsUpdate(snapshot({ revision: 4 }));
  const text = f.nodes['update-status'].textContent;
  for (const patch of [{ revision: 3 }, { revision: 4 }, { revision: -1 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { totalBytes: -1 }, { totalBytes: 1.5 }, { totalBytes: 104857601 }, { downloadedBytes: 201 }, { downloadedBytes: NaN }, { phase: 'script' }, { message: {} }, { dismissed: 'false' }, { installedVersion: null }, { availableVersion: 2 }]) {
    f.window.receiveBlockOpsUpdate(snapshot({ revision: 5, message: 'bad', ...patch }));
    assert.equal(f.nodes['update-status'].textContent, text, JSON.stringify(patch));
  }
  f.window.receiveBlockOpsUpdate(null); f.window.receiveBlockOpsUpdate(snapshot({ revision: 5, phase: 'error', message: 'Try again' }));
  assert.match(f.nodes['update-status'].textContent, /Try again/);
});
test('releaseTextIsNotMarkup', () => {
  const f = fixture(); f.ui.setHomeVisible(true);
  const message = '<img src=x onerror=alert(1)> "\\\u2028\u2029';
  f.window.receiveBlockOpsUpdate(snapshot({ message })); assert.ok(f.nodes['update-status'].textContent.includes(message));
  assert.equal(f.nodes['update-status'].innerHTML, undefined);
});
test('homeOnlyVisibility', () => {
  const f = fixture(); f.ui.setHomeVisible(true); f.window.receiveBlockOpsUpdate(snapshot());
  assert.equal(f.nodes['home-updates'].hidden, false);
  f.modals.push({ hidden: false }); f.changed(); assert.equal(f.nodes['home-updates'].hidden, true);
  f.nodes['update-open'].click(); assert.deepEqual(f.calls.at(-1), ['homeState', 'hidden']);
  f.modals[0].hidden = true; f.changed(); assert.equal(f.nodes['home-updates'].hidden, false);
  f.ui.setHomeVisible(false); assert.equal(f.nodes['home-updates'].hidden, true);
  f.ui.setHomeVisible(true); f.window.receiveBlockOpsUpdate(snapshot({ revision: 2, dismissed: true }));
  assert.equal(f.nodes['update-open'].hidden, true); assert.equal(f.nodes['update-check'].hidden, false);
});
test('bridgeFailureDisablesOnlyUpdater', () => {
  const f = fixture(); f.window.BlockOpsUpdates.check = () => { throw Error('detached'); };
  f.ui.setHomeVisible(true); assert.doesNotThrow(() => f.nodes['update-check'].click());
  assert.equal(f.nodes['home-updates'].hidden, true);
});

// These inputs come from real controller lifecycle/results, not informative hand-built snapshots.
test('controller results explain older/equal/newer versions and keep pending recovery reachable', () => {
  const output = execFileSync(process.execPath, ['android/tests/updater-jvm.mjs', 'controller', 'presentationSnapshots'], { encoding: 'utf8' });
  const states = Object.fromEntries(output.split('\n').filter(line => line.startsWith('SNAPSHOT ')).map(line => {
    const [, label, json] = line.match(/^SNAPSHOT (\S+) (.*)$/);
    return [label, JSON.parse(json)];
  }));
  for (const minor of [9, 10, 11]) {
    const f = fixture(); f.ui.setHomeVisible(true);
    f.window.receiveBlockOpsUpdate(states[`version-${minor}`]);
    const status = f.nodes['update-status'].textContent;
    assert.match(status, minor > 10 ? /Update available/i : /up to date/i);
    assert.match(status, /Installed: v0\.10\.0/);
    assert.equal(f.nodes['update-open'].hidden, minor <= 10);
    if (minor > 10) assert.match(status, /Available: v0\.11\.0/);
    else assert.doesNotMatch(status, /Available:/);
  }
  const f = fixture(); f.ui.setHomeVisible(true);
  f.window.receiveBlockOpsUpdate(states['pending-dismissed']);
  for (let entry = 0; entry < 2; entry++) {
    assert.equal(f.nodes['update-open'].hidden, false, 'Pending native recovery must remain reachable after Later');
    f.nodes['update-open'].click(); assert.deepEqual(f.calls.at(-1), ['open']);
    f.ui.setHomeVisible(false); f.ui.setHomeVisible(true);
  }
});
