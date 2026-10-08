import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HidingUI } from '../src/hiding-ui.js';
import { InputElement } from './helpers/input-fixture.js';
import { GearView } from '../src/gear-view.js';

test('hiding UI only renders contextual labels and does not install input handlers', () => {
  const button = new InputElement(), status = new InputElement();
  button.addEventListener = () => assert.fail('Input owns interaction');
  const ui = new HidingUI({ button, status });
  ui.render({ label: null, enabled: false, hidden: false, pending: false }); assert.equal(button.hidden, true);
  for (const label of ['Hide', 'Exit', 'Occupied']) {
    ui.render({ label, enabled: label !== 'Occupied', hidden: label === 'Exit', pending: false });
    assert.equal(button.hidden, false); assert.equal(button.textContent, label); assert.equal(button.disabled, label === 'Occupied');
    assert.equal(status.textContent, label === 'Exit' ? 'Hiding' : '');
  }
  ui.render({ label: 'Hide', enabled: false, hidden: false, pending: true }); assert.equal(button.textContent, 'Waiting…');
  ui.dispose(); assert.equal(button.hidden, true); assert.equal(status.textContent, '');
  const html = readFileSync('index.html', 'utf8'); assert.match(html, /id="hide-button"/); assert.match(html, /id="hiding-status"/);
});

test('concealment hides the whole avatar attachment and label but leaves the prop unchanged', () => {
  const scene = new THREE.Scene(), view = new GearView(THREE, scene), model = new THREE.Group(), label = new THREE.Group(), prop = new THREE.Group();
  model.add(new THREE.Group()); scene.add(model, label, prop); const count = scene.children.length;
  const actor = { id: 'enemy', teamId: null, x: 0, y: 0, z: 1, alive: true, model, label, hiddenSpotId: 'locker' };
  const visibility = view.update({ viewer: { id: 'viewer', x: 0, y: 0, z: 0 }, actors: [actor] });
  assert.equal(visibility.get('enemy'), false); assert.equal(model.visible, false); assert.equal(label.visible, false);
  assert.equal(prop.visible, true); assert.equal(scene.children.length, count);
  actor.hiddenSpotId = null; view.update({ viewer: { id: 'viewer', x: 0, y: 0, z: 0 }, actors: [actor] }); assert.equal(model.visible, true);
  view.dispose();
});
