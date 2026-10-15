import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeaponModel } from '../src/world.js';

const minigun = { id: 'minigun', classId: 'lmg', name: 'Minigun', colour: '#ba9965' };

// A fallback to the ordinary LMG, hidden barrel tips, or an oversized cluster
// should fail this visual contract shared by the camera, loot and previews.
test('minigun has six visible static box barrels in a compact shared model', () => {
  const model = createWeaponModel(THREE, minigun);
  const meshes = [];
  model.traverse(object => { if (object.isMesh) meshes.push(object); });
  const barrels = meshes.filter(mesh => mesh.scale.z >= .4 && mesh.scale.x <= .06 && mesh.scale.y <= .06);
  assert.equal(barrels.length, 6, 'six individual narrow forward barrels');
  assert.equal(new Set(barrels.map(mesh => `${mesh.position.x},${mesh.position.y}`)).size, 6);
  model.updateMatrixWorld(true);
  for (const barrel of barrels) {
    assert.deepEqual(barrel.rotation.toArray().slice(0, 3), [0, 0, 0]);
    const origin = new THREE.Vector3(barrel.position.x, barrel.position.y, -1.5);
    const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, 1)).intersectObject(model, true)[0];
    assert.equal(hit?.object, barrel, 'each muzzle is visible from the front');
    assert.ok(hit.point.z < -.65, 'barrels extend forward along the existing camera axis');
  }
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x <= .4 && size.y <= .55 && size.z <= 1.1, `compact bounds: ${size.toArray()}`);
  assert.ok(bounds.max.z <= .3, 'rear stock fits the existing first-person mount');
  assert.ok(meshes.length <= 24, 'small mesh budget for repeated loot and avatar models');
  assert.equal(new Set(meshes.map(mesh => mesh.geometry)).size, 1);
  assert.ok(meshes.every(mesh => mesh.geometry.type === 'BoxGeometry'));
});
