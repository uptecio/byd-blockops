import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';

import { teammateMapState, projectTeammateMapPosition, teammateMapHeading } from '../src/teammate-map.js';
const actor = (id, teamId = 'red', extra = {}) => ({ id, name: id, teamId, x: 1, z: 2, yaw: 0, alive: true, ...extra });
const state = (actors, extra = {}) => teammateMapState({ mapId: 'courtyard', modeId: 'tdm', selfId: 'self', actors, ...extra });

test('team map exposes only the live self and live friendly actors', () => {
  const result = state([actor('self'), actor('friendly'), actor('enemy', 'blue'), actor('neutral', null), actor('dead', 'red', { alive: false })]);
  assert.deepEqual(result, {
    mapId: 'courtyard', visible: true,
    markers: [
      { id: 'self', name: 'self', x: 1, z: 2, yaw: 0, kind: 'self' },
      { id: 'friendly', name: 'friendly', x: 1, z: 2, yaw: 0, kind: 'teammate' },
    ],
  });
});

test('team map stays visible for dead self but removes the dead marker', () => {
  assert.deepEqual(state([actor('self', 'blue', { alive: false }), actor('friend', 'blue')]).markers.map(marker => marker.id), ['friend']);
  assert.equal(state([actor('self', 'blue', { alive: false })]).visible, true);
});

test('FFA, survival, unknown modes and missing teams hide all markers', () => {
  for (const modeId of ['ffa', 'zombies', 'unknown', null]) {
    assert.deepEqual(state([actor('self'), actor('friend')], { modeId }), { mapId: 'courtyard', visible: false, markers: [] });
  }
  for (const teamId of [null, undefined, 'green', '']) {
    assert.equal(state([actor('self', 'red', { teamId })]).visible, false);
  }
  assert.equal(state([actor('other')]).visible, false);
  assert.equal(state([actor(undefined), actor('friend')], { selfId: undefined }).visible, false);
});

test('malformed actors never create markers or leak an opposing actor', () => {
  const result = state([
    null, undefined, actor('self'), actor('nan', 'red', { x: NaN }),
    actor('infinite', 'red', { z: Infinity }), actor('text', 'red', { x: '2' }),
    actor('invalid-yaw', 'red', { yaw: NaN }), actor('no-life', 'red', { alive: undefined }),
    actor('', 'red'), actor('self', 'blue'), actor('friend', 'red', { name: '<img onerror=alert(1)>' }),
    actor('friend', 'red', { x: 19 }),
  ]);
  assert.deepEqual(result.markers.map(marker => marker.id), ['self', 'friend']);
  assert.equal(result.markers[1].name, '<img onerror=alert(1)>');
  assert.deepEqual(state(null), { mapId: 'courtyard', visible: false, markers: [] });
  assert.equal(state([actor('self')], { mapId: 'missing' }).visible, false);
  assert.deepEqual(state([actor('self', 'red', { x: Infinity }), actor('friend')]).markers.map(marker => marker.id), ['friend']);
});

test('live updates replace positions and team membership without mutating actors', () => {
  const actors = [actor('self'), actor('friend')];
  const before = structuredClone(actors);
  const first = state(actors);
  assert.deepEqual(actors, before);
  actors[1].x = 12;
  assert.equal(state(actors).markers[1].x, 12);
  assert.equal(first.markers[1].x, 1);
  actors[1].teamId = 'blue';
  assert.deepEqual(state(actors).markers.map(marker => marker.id), ['self']);
});

test('all eight arenas support team modes and share a fixed overhead projection', () => {
  assert.equal(MAPS.length, 8);
  for (const map of MAPS) {
    for (const modeId of ['tdm', 'ctf']) assert.equal(state([actor('self')], { mapId: map.id, modeId }).visible, true);
    assert.deepEqual(projectTeammateMapPosition(map.id, -22, -22, 144), { x: 12, y: 12 });
    assert.deepEqual(projectTeammateMapPosition(map.id, 0, 0, 144), { x: 72, y: 72 });
    assert.deepEqual(projectTeammateMapPosition(map.id, 22, 22, 144), { x: 132, y: 132 });
    assert.deepEqual(projectTeammateMapPosition(map.id, 0, 0, 600), { x: 300, y: 300 });
  }
});

test('map heading follows game forward direction at the four cardinal yaws', () => {
  for (const [yaw, x, y] of [[0, 0, -1], [Math.PI / 2, -1, 0], [Math.PI, 0, 1], [-Math.PI / 2, 1, 0]]) {
    const heading = teammateMapHeading(yaw);
    assert.ok(Math.abs(heading.x - x) < 1e-12);
    assert.ok(Math.abs(heading.y - y) < 1e-12);
  }
});
