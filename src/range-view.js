import { RANGE_TARGET_DIMENSIONS, rangeTargetBounds } from './range-rules.js';

const LABEL_COUNT = 12, LABEL_SECONDS = .8;
const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);

// The view owns only rendering resources. Simulation snapshots remain caller-owned.
export function createRangeView(THREE, scene, { targets, createCanvas = () => document.createElement('canvas') }) {
  if (!Array.isArray(targets)) throw new RangeError('Invalid range targets');
  const ids = new Set();
  for (const target of targets) {
    rangeTargetBounds(target);
    if (ids.has(target.id) || typeof target.label !== 'string' || !target.label.trim()) throw new RangeError('Invalid range targets');
    ids.add(target.id);
  }
  const root = new THREE.Group(); root.name = 'Range view';
  const targetGroup = new THREE.Group(); targetGroup.name = 'Range targets';
  const laneGroup = new THREE.Group(); laneGroup.name = 'Range lanes';
  const labelGroup = new THREE.Group(); labelGroup.name = 'Range damage labels';
  root.add(targetGroup, laneGroup, labelGroup);
  const resources = new Set(), models = new Map(), labels = [];
  let disposed = false, nextLabel = 0;
  const own = resource => { resources.add(resource); return resource; };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const resource of resources) resource.dispose();
    resources.clear();
    const groups = []; root.traverse(object => { if (object.isGroup) groups.push(object); });
    for (const group of groups.reverse()) group.clear();
    models.clear(); labels.length = 0;
  };
  try {
    const geometry = own(new THREE.BoxGeometry(1, 1, 1)), materials = new Map();
    const box = (group, name, x, y, z, w, h, d, colour, precision = false) => {
      if (!materials.has(colour)) materials.set(colour, own(new THREE.MeshBasicMaterial({
        color: colour, polygonOffset: precision, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      })));
      const mesh = new THREE.Mesh(geometry, materials.get(colour)); mesh.name = name;
      mesh.position.set(x, y, z); mesh.scale.set(w, h, d); group.add(mesh); return mesh;
    };
    const makeLabel = (name, group, width, height) => {
      const canvas = createCanvas(); canvas.width = 512; canvas.height = 96;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Range labels need a 2D canvas');
      const texture = own(new THREE.CanvasTexture(canvas));
      const material = own(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      const sprite = new THREE.Sprite(material); sprite.name = name; sprite.scale.set(width, height, 1); group.add(sprite);
      const draw = (text, colour) => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#182635'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = 'bold 34px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillStyle = colour; context.fillText(text, canvas.width / 2, canvas.height / 2);
        texture.needsUpdate = true;
      };
      return { sprite, draw, elapsed: 0, correction: 0, baseY: 0 };
    };
    const lanes = new Map();
    for (const target of targets) {
      const dimensions = RANGE_TARGET_DIMENSIONS[target.kind];
      const model = new THREE.Group(); model.name = target.id; model.position.set(target.x, target.y, target.z);
      targetGroup.add(model); models.set(target.id, model);
      const width = dimensions.halfWidth * 2, depth = dimensions.halfDepth * 2;
      if (target.kind === 'dummy') {
        box(model, 'body', 0, (dimensions.minY + dimensions.headAboveY) / 2, 0,
          width, dimensions.headAboveY - dimensions.minY, depth, '#4385a0');
        box(model, 'head', 0, (dimensions.headAboveY + dimensions.maxY) / 2, 0,
          width, dimensions.maxY - dimensions.headAboveY, depth, '#ffe59b');
      } else {
        box(model, 'body', 0, (dimensions.minY + dimensions.maxY) / 2, 0,
          width, dimensions.maxY - dimensions.minY, depth, '#f2eee2');
        box(model, 'centre', 0, (dimensions.centreMinY + dimensions.centreMaxY) / 2, 0,
          dimensions.centreHalfWidth * 2, dimensions.centreMaxY - dimensions.centreMinY, depth, '#d64949', true);
      }
      if (!lanes.has(target.label)) lanes.set(target.label, []);
      lanes.get(target.label).push(target);
    }
    for (const [text, laneTargets] of lanes) {
      const label = makeLabel('Range lane label', laneGroup, 2.8, .525);
      const x = laneTargets.reduce((sum, target) => sum + target.x, 0) / laneTargets.length;
      const z = laneTargets.reduce((sum, target) => sum + target.z, 0) / laneTargets.length;
      label.sprite.position.set(x, Math.max(...laneTargets.map(target => target.y + RANGE_TARGET_DIMENSIONS[target.kind].maxY)) + .6, z);
      label.draw(text, '#ffffff');
    }
    for (let i = 0; i < LABEL_COUNT; i++) {
      const label = makeLabel('Range damage label', labelGroup, 3.6, .675);
      label.sprite.visible = false; labels.push(label);
    }
    scene.add(root);
    return {
      sync(snapshot) {
        if (disposed) return;
        for (const target of snapshot.targets) {
          const model = models.get(target.id);
          if (model) model.visible = target.health > 0;
        }
      },
      hit({ targetId, point, damage, region }) {
        if (disposed || !models.has(targetId) || !finitePoint(point) || !Number.isFinite(damage) || damage < 0
          || !['body', 'head', 'centre'].includes(region)) return;
        const label = labels[nextLabel]; nextLabel = (nextLabel + 1) % LABEL_COUNT;
        label.elapsed = 0; label.correction = 0; label.baseY = point.y + .25;
        label.sprite.position.set(point.x, label.baseY, point.z);
        label.sprite.visible = true; label.sprite.material.opacity = 1;
        const text = region === 'centre' ? '10B HEADSHOT · CENTRE' : region === 'head' ? '10B HEADSHOT' : String(Math.round(damage));
        label.draw(text, region === 'body' ? '#ffffff' : '#ffe59b');
      },
      update(dt, camera) {
        if (disposed) return;
        if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid range view delta');
        for (const label of labels) {
          if (!label.sprite.visible) continue;
          const step = dt - label.correction, elapsed = label.elapsed + step;
          label.correction = (elapsed - label.elapsed) - step; label.elapsed = elapsed;
          if (elapsed >= LABEL_SECONDS) { label.sprite.visible = false; continue; }
          label.sprite.position.y = label.baseY + elapsed * .5;
          label.sprite.material.opacity = 1 - elapsed / LABEL_SECONDS;
          if (camera) camera.getWorldQuaternion(label.sprite.quaternion);
        }
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
