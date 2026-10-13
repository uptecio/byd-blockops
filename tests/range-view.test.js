import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RANGE_TARGETS } from '../src/range-map.js';
import { createRangeState, rangeSnapshot, applyRangeHit, tickRangeTargets, traceRangeRay } from '../src/range-rules.js';
const viewModule = await import('../src/range-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

function canvasFactory() {
  const canvases = [];
  const createCanvas = () => {
    const canvas = { width: 0, height: 0, texts: [], getContext(type) {
      assert.equal(type, '2d');
      return { clearRect() { canvas.texts = []; }, fillRect() {}, fillText(text) { canvas.texts.push(text); },
        measureText(text) { return { width: text.length * 12 }; } };
    } };
    canvases.push(canvas); return canvas;
  };
  return { canvases, createCanvas };
}
function setup(three = THREE, scene = new THREE.Scene(), options = {}) {
  assert.equal(typeof viewModule.createRangeView, 'function', 'procedural range view exists');
  const factory = canvasFactory();
  const view = viewModule.createRangeView(three, scene, { targets: RANGE_TARGETS, createCanvas: factory.createCanvas, ...options });
  return { scene, view, ...factory };
}
const damageSprites = scene => {
  const sprites = []; scene.traverse(object => { if (object.isSprite && object.name === 'Range damage label') sprites.push(object); }); return sprites;
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function assertBounds(object, min, max) {
  const bounds = new THREE.Box3().setFromObject(object);
  bounds.min.toArray().forEach((value, i) => close(value, min[i]));
  bounds.max.toArray().forEach((value, i) => close(value, max[i]));
}
function trackedThree() {
  const allocations = [], counts = new Map(), three = { ...THREE };
  for (const key of ['BoxGeometry', 'MeshBasicMaterial', 'SpriteMaterial', 'CanvasTexture']) three[key] = class extends THREE[key] {
    constructor(...args) { super(...args); allocations.push(this); this.addEventListener('dispose', () => counts.set(this, (counts.get(this) || 0) + 1)); }
  };
  return { three, allocations, counts };
}

// Wrong target extents or visual precision thresholds make a visible shot disagree with the rules.
test('all six procedural targets align with rule ray bounds and precision surfaces', () => {
  const { scene, view, canvases } = setup();
  const fixtures = [
    ['close-dummy', -10.3, 16], ['close-bullseye', -7.7, 16],
    ['medium-dummy', -1.3, 4], ['medium-bullseye', 1.3, 4],
    ['far-dummy', 7.7, -16], ['far-bullseye', 10.3, -16],
  ];
  for (const [id, x, z] of fixtures) {
    const model = scene.getObjectByName(id);
    assert.ok(model, id);
    assert.equal(model.parent.name, 'Range targets');
    if (id.endsWith('dummy')) {
      assertBounds(model, [x - .32, .05, z - .32], [x + .32, 1.84, z + .32]);
      assertBounds(model.getObjectByName('head'), [x - .32, 1.48, z - .32], [x + .32, 1.84, z + .32]);
    } else {
      assertBounds(model, [x - .6, .75, z - .05], [x + .6, 1.95, z + .05]);
      const centre = model.getObjectByName('centre');
      const bounds = new THREE.Box3().setFromObject(centre);
      close(bounds.min.x, x - .15); close(bounds.max.x, x + .15);
      close(bounds.min.y, 1.2); close(bounds.max.y, 1.5);
      assert.notEqual(centre.material.color.getHex(), model.children.find(child => child !== centre).material.color.getHex());
    }
    scene.updateMatrixWorld(true);
    const y = id.endsWith('dummy') ? 1.7 : 1.35;
    const origin = new THREE.Vector3(x, y, z + 2), direction = new THREE.Vector3(0, 0, -1);
    const visible = new THREE.Raycaster(origin, direction).intersectObject(model, true)[0];
    const rule = traceRangeRay(createRangeState(RANGE_TARGETS.filter(target => target.id === id)), { origin, direction, range: 3, solids: [] });
    close(visible.point.z, rule.point.z);
    assert.equal(rule.region, id.endsWith('dummy') ? 'head' : 'centre');
  }
  assert.deepEqual(canvases.flatMap(canvas => canvas.texts).sort(), ['CLOSE', 'FAR', 'MEDIUM']);
  view.dispose();
});

test('snapshot sync hides deaths and shows respawns without changing health or session statistics', () => {
  const { scene, view } = setup(), state = createRangeState();
  applyRangeHit(state, { targetId: 'close-dummy', lifeId: 1, point: { x: -10.3, y: 1.7, z: 16.32 }, distance: 1, region: 'head' }, 20);
  const snapshot = rangeSnapshot(state), before = structuredClone(snapshot);
  view.sync(snapshot);
  assert.equal(scene.getObjectByName('close-dummy').visible, false);
  view.hit({ targetId: 'close-dummy', point: { x: -10.3, y: 1.7, z: 16.32 }, damage: 1e10, region: 'head' });
  view.update(.8, new THREE.PerspectiveCamera());
  assert.deepEqual(snapshot, before);
  tickRangeTargets(state, 5); view.sync(rangeSnapshot(state));
  assert.equal(scene.getObjectByName('close-dummy').visible, true);
  view.dispose();
});

test('1000 hits reuse twelve sprites, canvases and textures and replace the oldest label', () => {
  const { scene, view, canvases } = setup();
  const sprites = damageSprites(scene), textures = sprites.map(sprite => sprite.material.map);
  assert.equal(sprites.length, 12);
  for (let i = 0; i < 1000; i++) view.hit({ targetId: 'close-dummy', point: { x: i, y: 1, z: 16 }, damage: i + .4, region: 'body' });
  assert.equal(damageSprites(scene).length, 12);
  assert.equal(canvases.length, 15, 'three lane canvases and twelve reusable feedback canvases');
  assert.deepEqual(sprites.map(sprite => sprite.material.map), textures);
  assert.equal(sprites.filter(sprite => sprite.visible).length, 12);
  assert.deepEqual(sprites.map(sprite => sprite.position.x).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 988));
  assert.deepEqual(sprites.map(sprite => sprite.material.map.image.texts.at(-1)).sort((a,b) => Number(a)-Number(b)), Array.from({ length: 12 }, (_, i) => String(i + 988)));
  view.dispose();
});

test('labels use ordinary rounding and precision wording then expire at exactly 0.8 active seconds', () => {
  const { scene, view } = setup();
  for (const [region, damage, id] of [['body', 23.6, 'close-dummy'], ['head', 1e10, 'close-dummy'], ['centre', 1e10, 'close-bullseye']]) {
    view.hit({ targetId: id, point: { x: 0, y: 1, z: 0 }, damage, region });
  }
  const visible = damageSprites(scene).filter(sprite => sprite.visible);
  assert.deepEqual(visible.map(sprite => sprite.material.map.image.texts.at(-1)).sort(), ['10B HEADSHOT', '10B HEADSHOT · CENTRE', '24']);
  const camera = new THREE.PerspectiveCamera(); camera.rotation.set(.2, .3, .1);
  view.update(0, camera);
  assert.equal(visible.every(sprite => sprite.visible), true);
  view.update(.79, camera);
  assert.equal(visible.every(sprite => sprite.visible), true);
  assert.ok(visible.every(sprite => 1 - Math.abs(sprite.quaternion.dot(camera.quaternion)) < 1e-12));
  view.update(.01, camera);
  assert.equal(damageSprites(scene).some(sprite => sprite.visible), false);
  view.hit({ targetId: 'far-dummy', point: { x: 0, y: 1, z: 0 }, damage: 5, region: 'body' });
  for (let i = 0; i < 80; i++) view.update(.01, camera);
  assert.equal(damageSprites(scene).some(sprite => sprite.visible), false);
  view.dispose();
});

test('invalid or duplicate target descriptors fail before canvas allocation or attachment', () => {
  for (const targets of [[{ ...RANGE_TARGETS[0], x: Infinity }], [RANGE_TARGETS[0], RANGE_TARGETS[0]], [{ ...RANGE_TARGETS[0], kind: 'other' }]]) {
    assert.equal(typeof viewModule.createRangeView, 'function');
    const scene = new THREE.Scene(); let canvasCount = 0;
    assert.throws(() => viewModule.createRangeView(THREE, scene, { targets, createCanvas() { canvasCount++; throw new Error('unexpected canvas'); } }), RangeError);
    assert.equal(scene.children.length, 0); assert.equal(canvasCount, 0);
  }
});

test('view disposal frees every owned allocation once and leaves unrelated scene objects', () => {
  const tracker = trackedThree(), scene = new THREE.Scene(), light = new THREE.AmbientLight(); scene.add(light);
  const { view } = setup(tracker.three, scene), groups = scene.children.filter(child => child !== light);
  view.dispose(); view.dispose(); view.sync(rangeSnapshot(createRangeState())); view.update(1, new THREE.PerspectiveCamera());
  view.hit({ targetId: 'close-dummy', point: { x: 0, y: 1, z: 0 }, damage: 1, region: 'body' });
  assert.deepEqual(scene.children, [light]);
  assert.ok(groups.every(group => group.parent === null && group.children.length === 0));
  for (const resource of tracker.allocations) assert.equal(tracker.counts.get(resource), 1);
});

test('view attachment failure cleans all partially attached groups and allocations', () => {
  const tracker = trackedThree(), scene = new THREE.Scene();
  scene.add = function (...objects) { THREE.Scene.prototype.add.call(this, ...objects); throw new Error('attachment failure'); };
  assert.throws(() => setup(tracker.three, scene), /attachment failure/);
  assert.equal(scene.children.length, 0);
  assert.ok(tracker.allocations.length > 20);
  for (const resource of tracker.allocations) assert.equal(tracker.counts.get(resource), 1);
});

test('view canvas allocation failure releases earlier resources without attaching objects', () => {
  const tracker = trackedThree(), scene = new THREE.Scene(), factory = canvasFactory(); let calls = 0;
  assert.throws(() => setup(tracker.three, scene, { createCanvas() { if (++calls === 5) throw new Error('canvas failure'); return factory.createCanvas(); } }), /canvas failure/);
  assert.equal(scene.children.length, 0);
  assert.ok(tracker.allocations.length > 0);
  for (const resource of tracker.allocations) assert.equal(tracker.counts.get(resource), 1);
});
