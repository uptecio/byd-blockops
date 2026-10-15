import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SKINS, DEFAULT_SKIN_ID, getSkin } from '../src/skins.js';
import { AVATAR_HITBOX, createAvatarModel } from '../src/avatar.js';
import { WEAPONS, getWeapon } from '../src/weapons.js';
import { createWeaponModel } from '../src/world.js';
import { disposeModel } from '../src/game.js';
import { createHash } from 'node:crypto';

const ids = ['ranger', 'desert-ops', 'arctic-scout', 'jungle-scout', 'neon-runner', 'shadow-ninja', 'robo-unit', 'space-guard'];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const bounds = model => new THREE.Box3().setFromObject(model);
test('optional knife preserves the complete existing gun anatomy and every skin/team/hitbox', () => {
  const signatures = [];
  for (const skinId of ids) for (const teamId of [null, 'red', 'blue']) for (const weapon of WEAPONS) {
    const gun = createAvatarModel(THREE, { skinId, teamId, weaponId: weapon.id, heldItem: 'gun' });
    const rows = []; gun.traverse(o => rows.push([o.name, o.position.toArray(), o.scale.toArray(), o.rotation.toArray(), o.material?.color?.getHexString(), o.userData]));
    // Keep the original 28-weapon golden unchanged; new weapons still undergo
    // the per-model anatomy, hitbox and knife-equivalence checks above/below.
    if (weapon.id !== 'minigun') signatures.push(rows);
    const knife = createAvatarModel(THREE, { skinId, teamId, weaponId: weapon.id, heldItem: 'knife' });
    assert.equal(knife.userData.hitbox, AVATAR_HITBOX);
    assert.equal(knife.getObjectByName('weapon').children[0].name, 'Knife');
    const attachment = gun.getObjectByName('weapon'); attachment.removeFromParent();
    const knifeAttachment = knife.getObjectByName('weapon'); knifeAttachment.removeFromParent();
    assert.equal(meshSignature(gun), meshSignature(knife));
    gun.add(attachment); knife.add(knifeAttachment); disposeModel(gun); disposeModel(knife);
  }
  // Captured from all 672 original models before optional held-item support.
  assert.equal(createHash('sha256').update(JSON.stringify(signatures)).digest('hex'), 'f2b0171a213b8d1c6cb67f7dfdf2d367e6478646541cca518c64be8bad7819fb');
});
function meshSignature(model, includeColours = true) {
  const result = [];
  model.traverse(object => {
    if (!object.isMesh) return;
    result.push([object.position.toArray(), object.scale.toArray(), object.rotation.toArray(),
      ...(includeColours ? [object.material.color.getHexString()] : [])]);
  });
  return JSON.stringify(result);
}

test('original eight skins remain first and all sixteen have strict immutable cosmetic definitions', () => {
  assert.deepEqual(SKINS.slice(0,8).map(skin => skin.id), ids);
  assert.equal(SKINS.length,16);
  assert.equal(DEFAULT_SKIN_ID, 'ranger');
  assert.equal(new Set(SKINS.map(skin => skin.name)).size, 16);
  assert.equal(Object.isFrozen(SKINS), true);
  for (const id of ids) {
    const skin = getSkin(id);
    assert.equal(Object.isFrozen(skin), true);
    assert.equal(Object.isFrozen(skin.palette), true);
    assert.throws(() => { skin.palette.body = '#000000'; }, TypeError);
  }
  for (const invalid of ['missing', '', 'Ranger', null, undefined, {}, '__proto__']) {
    assert.throws(() => getSkin(invalid), /Unknown skin/);
    assert.throws(() => createAvatarModel(THREE, { skinId: invalid }), /Unknown skin/);
  }
  assert.throws(() => createAvatarModel(THREE, { skinId: 'ranger', teamId: 'green' }), /Unknown team/);
});

test('every avatar shares the same immutable combat hitbox regardless of cosmetics or team', () => {
  assert.deepEqual(AVATAR_HITBOX, { halfWidth: .32, height: 1.84 });
  assert.equal(Object.isFrozen(AVATAR_HITBOX), true);
  for (const skinId of ids) for (const teamId of [null, 'red', 'blue']) {
    const model = createAvatarModel(THREE, { skinId, teamId });
    assert.equal(model.userData.skinId, skinId);
    assert.equal(model.userData.teamId, teamId);
    assert.equal(model.userData.hitbox, AVATAR_HITBOX);
    assert.throws(() => { model.userData.hitbox.height = 4; }, TypeError);
    assert.throws(() => { model.userData.hitbox = { halfWidth: 5, height: 5 }; }, TypeError);
    disposeModel(model);
  }
});

test('each skin assembles a distinct silhouette as well as distinct colours', () => {
  const appearances = new Set(), silhouettes = new Set();
  for (const skinId of ids) {
    const model = createAvatarModel(THREE, { skinId });
    appearances.add(meshSignature(model));
    silhouettes.add(meshSignature(model, false));
    assert.ok(model.getObjectByName('headgear').children.length > 0);
    assert.ok(model.getObjectByName('accessory').children.length > 0);
    assert.equal(model.getObjectByName('team-marker'), undefined);
    disposeModel(model);
  }
  assert.equal(appearances.size, 8);
  assert.equal(silhouettes.size, 8);
});

test('all avatars stand on the ground with a face and selected gun pointing along positive Z', () => {
  for (const skinId of ids) {
    const model = createAvatarModel(THREE, { skinId });
    assert.ok(model instanceof THREE.Group);
    close(bounds(model).min.y, 0);
    for (const name of ['left-foot', 'right-foot']) close(bounds(model.getObjectByName(name)).min.y, 0);
    assert.ok(bounds(model).max.y >= 1.8 && bounds(model).max.y <= 2);
    assert.ok(bounds(model.getObjectByName('face')).getCenter(new THREE.Vector3()).z > .2);
    const gun = model.getObjectByName('weapon');
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()));
    close(forward.x, 0); close(forward.y, 0); close(forward.z, 1);
    assert.ok(bounds(gun).max.z > .6);
    disposeModel(model);
  }
});

test('avatar attachment renders the selected model for all 29 weapons', () => {
  for (const weapon of WEAPONS) {
    const model = createAvatarModel(THREE, { skinId: 'ranger', weaponId: weapon.id });
    const attachment = model.getObjectByName('weapon');
    const expected = createWeaponModel(THREE, getWeapon(weapon.id));
    assert.equal(model.userData.weaponId, weapon.id);
    assert.equal(attachment.userData.weaponId, weapon.id);
    assert.equal(attachment.children[0].name, weapon.name);
    assert.equal(meshSignature(attachment.children[0]), meshSignature(expected));
    close(bounds(model).min.y, 0);
    disposeModel(model); disposeModel(expected);
  }
  const defaultModel = createAvatarModel(THREE, { skinId: 'ranger' });
  assert.equal(defaultModel.userData.weaponId, 'm4a1');
  disposeModel(defaultModel);
});

test('red and blue badges are opaque and exposed from front, back and both sides for every skin', () => {
  for (const skinId of ids) for (const [teamId, colour] of [['red', 0xff4141], ['blue', 0x3185ff]]) {
    const model = createAvatarModel(THREE, { skinId, teamId });
    model.updateMatrixWorld(true);
    const views = [
      [new THREE.Vector3(0, 1.25, 3), new THREE.Vector3(0, 0, -1)],
      [new THREE.Vector3(0, 1.25, -3), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(3, 1.25, .02), new THREE.Vector3(-1, 0, 0)],
      [new THREE.Vector3(-3, 1.25, .02), new THREE.Vector3(1, 0, 0)],
    ];
    for (const [origin, direction] of views) {
      const hit = new THREE.Raycaster(origin, direction).intersectObject(model, true)[0];
      assert.ok(hit, `${skinId}/${teamId}: marker must have visible geometry`);
      assert.equal(hit.object.name, 'team-marker', `${skinId}/${teamId}: marker is occluded`);
      assert.equal(hit.object.material.color.getHex(), colour);
      assert.equal(hit.object.material.opacity, 1);
      assert.equal(hit.object.material.transparent, false);
      assert.ok(hit.object.material instanceof THREE.MeshBasicMaterial);
    }
    disposeModel(model);
  }
});

test('disposing one avatar releases all owned geometry and materials without affecting another', () => {
  const first = createAvatarModel(THREE, { skinId: 'space-guard', teamId: 'blue', weaponId: 'awp' });
  const second = createAvatarModel(THREE, { skinId: 'space-guard', teamId: 'blue', weaponId: 'awp' });
  const scene = new THREE.Scene(); scene.add(first, second);
  const resources = new Set(), otherResources = new Set(), disposals = new Map();
  for (const [model, set] of [[first, resources], [second, otherResources]]) model.traverse(object => {
    if (object.geometry) set.add(object.geometry);
    if (object.material) set.add(object.material);
  });
  for (const resource of resources) {
    assert.equal(otherResources.has(resource), false);
    resource.addEventListener('dispose', () => disposals.set(resource, (disposals.get(resource) || 0) + 1));
  }
  disposeModel(first);
  assert.equal(first.parent, null);
  assert.equal(second.parent, scene);
  assert.equal(disposals.size, resources.size);
  for (const count of disposals.values()) assert.equal(count, 1);
  assert.ok(bounds(second).max.y >= 1.8);
  disposeModel(second);
});
