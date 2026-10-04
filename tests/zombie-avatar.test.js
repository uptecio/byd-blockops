import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createZombieModel, animateZombieModel } from '../src/zombie-avatar.js';
import { disposeModel } from '../src/game.js';
import { AVATAR_HITBOX } from '../src/avatar-hitbox.js';

const resources = model => {
  const all=new Set();
  model.traverse(node => { if (node.geometry) all.add(node.geometry); if (node.material) all.add(node.material); });
  return all;
};
for (const kind of ['walker','runner']) test(`${kind} has aimable unarmed block body and owned disposable resources`, () => {
  const model=createZombieModel(THREE,kind);
  assert.equal(model.getObjectByName('weapon'),undefined);
  assert.equal(model.userData.hitbox,AVATAR_HITBOX);
  for (const name of ['head','left-arm','right-arm','left-leg','right-leg','health-bar']) assert.ok(model.getObjectByName(name),name);
  const bar=model.getObjectByName('health-bar');
  assert.ok(bar.isMesh && bar.position.y > AVATAR_HITBOX.height);
  const headBox=new THREE.Box3().setFromObject(model.getObjectByName('head'));
  assert.ok(headBox.max.y <= AVATAR_HITBOX.height);
  const face=new THREE.Box3().setFromObject(model.getObjectByName('left-eye'));
  assert.ok(face.min.y > 1.48);
  bar.removeFromParent();
  const bounds=new THREE.Box3().setFromObject(model);
  for (const axis of ['x','y','z']) assert.ok(Number.isFinite(bounds.min[axis]) && Number.isFinite(bounds.max[axis]));
  assert.ok(bounds.min.y >= -1e-9 && bounds.max.y <= AVATAR_HITBOX.height+1e-9);
  model.add(bar);
  const before=resources(model),count=model.children.length;
  const rotations=['left-arm','right-arm','left-leg','right-leg'].map(n=>model.getObjectByName(n).rotation.x);
  animateZombieModel(model,{ time:1,moving:true,slashing:true });
  assert.equal(model.children.length,count);
  assert.deepEqual(resources(model),before);
  assert.notDeepEqual(['left-arm','right-arm','left-leg','right-leg'].map(n=>model.getObjectByName(n).rotation.x),rotations);
  animateZombieModel(model,{ time:2,moving:false,slashing:false });
  assert.equal(model.getObjectByName('left-leg').rotation.x,0);
  const calls=new Map([...before].map(r=>[r,0]));
  for (const resource of before) resource.addEventListener('dispose',()=>calls.set(resource,calls.get(resource)+1));
  disposeModel(model);
  assert.ok([...calls.values()].every(count=>count===1));
});
test('walker and runner have distinct outfit palettes and reject unknown types', () => {
  const walker=createZombieModel(THREE,'walker'),runner=createZombieModel(THREE,'runner');
  assert.notEqual(walker.getObjectByName('torso').material.color.getHex(),runner.getObjectByName('torso').material.color.getHex());
  assert.throws(()=>createZombieModel(THREE,'armed'),RangeError);
  disposeModel(walker); disposeModel(runner);
});
