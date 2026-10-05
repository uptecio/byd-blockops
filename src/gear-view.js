import { createWeaponModel } from './world.js';
import { getWeapon } from './weapons.js';
import { smokeBlocksSight } from './gear-combat.js';
import { GEAR_BALANCE } from './equipment-catalog.js';
import { lootItemLabel } from './loot-labels.js';

// Standalone models own their resources; a view's cached templates own theirs.
export function createKnifeModel(THREE) {
  const model = new THREE.Group(); model.name = 'Knife';
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const steel = new THREE.MeshLambertMaterial({ color: '#c4d2d9' });
  const dark = new THREE.MeshLambertMaterial({ color: '#283e48' });
  for (const [name, z, width, height, depth, material] of [
    ['grip', .04, .08, .1, .23, dark], ['guard', -.095, .2, .045, .05, dark],
    ['blade', -.3, .095, .035, .36, steel], ['tip', -.49, .045, .035, .08, steel],
  ]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.position.z = z; mesh.scale.set(width, height, depth); model.add(mesh);
  }
  return model;
}

const grenadeColours = { frag: '#c68b48', smoke: '#689b79', flash: '#b5c6e8' };
const itemKey = item => item.kind === 'gun' ? `gun:${item.weaponId}`
  : item.kind === 'grenade' ? `grenade:${item.grenadeType}` : item.kind === 'supply' ? `supply:${item.supplyType}` : 'knife';

export class GearView {
  constructor(THREE, scene) {
    this.THREE = THREE; this.group = new THREE.Group(); this.group.name = 'Gear'; scene.add(this.group);
    this.loot = new Map(); this.projectiles = new Map(); this.smokes = new Map(); this.bursts = new Map();
    // Clones borrow bounded, view-local templates/labels. Removal and clear
    // detach entities; only dispose releases this view's cached resources.
    this.templates = new Map(); this.labels = new Map(); this.geometries = new Set(); this.materials = new Set(); this.textures = new Set();
    this.smokeRecords = []; this.disposed = false; this.lastEventId = -1;
    this.box = this.ownGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.sphere = this.ownGeometry(new THREE.SphereGeometry(1, 12, 8));
    this.smokeMaterial = this.ownMaterial(new THREE.MeshBasicMaterial({ color: '#a2aaa9', transparent: true, opacity: .78, depthWrite: false, side: THREE.DoubleSide }));
    this.flash = new THREE.Mesh(this.ownGeometry(new THREE.PlaneGeometry(2, 2)),
      this.ownMaterial(new THREE.MeshBasicMaterial({ color: '#bcbcbc', transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false })));
    this.flash.name = 'Flash veil'; this.flash.position.z = -.06; this.flash.visible = false; this.flash.renderOrder = 1000;
  }
  ownGeometry(geometry) { this.geometries.add(geometry); return geometry; }
  ownMaterial(material) { this.materials.add(material); return material; }
  template(item) {
    const key = itemKey(item); if (this.templates.has(key)) return this.templates.get(key);
    const THREE = this.THREE;
    let model;
    if (item.kind === 'gun') model = createWeaponModel(THREE, getWeapon(item.weaponId));
    else if (item.kind === 'knife') model = createKnifeModel(THREE);
    else if (item.kind === 'supply') {
      model = new THREE.Group(); model.name = lootItemLabel(item);
      const health = item.supplyType === 'health';
      const body = this.ownMaterial(new THREE.MeshLambertMaterial({ color: health ? '#e6eee2' : '#2568b5' }));
      const symbol = this.ownMaterial(new THREE.MeshLambertMaterial({ color: health ? '#238347' : '#d4ebff' }));
      const addBox = (name, material, size, position) => {
        const box = new THREE.Mesh(this.box, material); box.name = name;
        box.scale.set(...size); box.position.set(...position); model.add(box);
      };
      addBox('case', body, [.48,.36,.24], [0,0,0]);
      addBox('handle', symbol, [.2,.055,.1], [0,.2,0]);
      for (const z of [-.125,.125]) {
        if (health) {
          addBox('health-symbol', symbol, [.24,.075,.015], [0,0,z]);
          addBox('health-symbol-vertical', symbol, [.075,.24,.015], [0,0,z]);
        } else {
          addBox('shield-symbol', symbol, [.24,.1,.015], [0,.065,z]);
          addBox('shield-middle', symbol, [.18,.075,.015], [0,-.02,z]);
          addBox('shield-tip', symbol, [.08,.065,.015], [0,-.085,z]);
        }
      }
    }
    else {
      model = new THREE.Group(); model.name = `${item.grenadeType} grenade`;
      const material = this.ownMaterial(new THREE.MeshLambertMaterial({ color: grenadeColours[item.grenadeType] }));
      const body = new THREE.Mesh(this.box, material);
      // Block proportions distinguish the three types even without colour.
      const size = { frag: [.2, .25, .2], smoke: [.16, .36, .16], flash: [.24, .16, .16] }[item.grenadeType];
      body.scale.set(...size); model.add(body);
      const cap = new THREE.Mesh(this.box, this.ownMaterial(new THREE.MeshLambertMaterial({ color: '#354653' })));
      cap.scale.set(.1, .055, .1); cap.position.y = size[1] / 2 + .02; model.add(cap);
    }
    model.traverse(object => { if (object.geometry) this.ownGeometry(object.geometry);
      for (const material of object.material ? [].concat(object.material) : []) this.ownMaterial(material);
    });
    this.templates.set(key, model); return model;
  }
  label(text) {
    if (typeof document === 'undefined') return null;
    if (!this.labels.has(text)) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
      const context = canvas.getContext('2d'); if (!context) return null;
      context.fillStyle = '#142735e8'; context.fillRect(0, 0, 512, 64);
      context.font = 'bold 28px sans-serif'; context.fillStyle = '#ffffff'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(text, 256, 32, 490);
      const texture = new this.THREE.CanvasTexture(canvas); this.textures.add(texture);
      this.labels.set(text, this.ownMaterial(new this.THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true })));
    }
    const label = new this.THREE.Sprite(this.labels.get(text)); label.name = 'item-label'; label.position.y = .7; label.scale.set(1.9, .2375, 1);
    return label;
  }
  reconcile(records, visuals, create, position) {
    const present = new Set();
    for (const record of records) {
      present.add(record.id); let visual = visuals.get(record.id);
      const key = record.item ? itemKey(record.item) : record.grenadeType;
      if (visual && visual.userData.key !== key) { visual.removeFromParent(); visuals.delete(record.id); visual = null; }
      if (!visual) {
        visual = create(record); visual.userData.id = record.id; visual.userData.key = key;
        visuals.set(record.id, visual); this.group.add(visual);
      }
      position(visual, record);
    }
    for (const [id, visual] of visuals) if (!present.has(id)) { visual.removeFromParent(); visuals.delete(id); }
  }
  sync({ loot = [], projectiles = [], smokes = [] }) {
    if (this.disposed) return;
    this.reconcile(loot.slice(0, GEAR_BALANCE.maxLoot), this.loot, record => {
      const model = new this.THREE.Group(); model.userData.label = lootItemLabel(record.item);
      const item = this.template(record.item).clone(); item.position.y = .25;
      item.scale.setScalar(record.item.kind === 'gun' ? .4 : record.item.kind === 'knife' ? .6 : 1);
      model.add(item); const label = this.label(model.userData.label); if (label) model.add(label);
      return model;
    }, (model, record) => model.position.set(record.x, record.y, record.z));
    this.reconcile(projectiles.slice(0, GEAR_BALANCE.maxProjectiles), this.projectiles,
      record => this.template({ kind: 'grenade', grenadeType: record.grenadeType }).clone(),
      (model, record) => model.position.set(record.x, record.y, record.z));
    this.smokeRecords = smokes.slice(0, GEAR_BALANCE.maxSmoke);
    this.reconcile(this.smokeRecords, this.smokes, () => {
      const cloud = new this.THREE.Mesh(this.sphere, this.smokeMaterial);
      cloud.name = 'Smoke'; cloud.raycast = () => {}; return cloud;
    }, (model, record) => { model.position.set(record.x, record.y, record.z); model.scale.setScalar(record.radius); });
  }
  update({ viewer, actors, flashRemaining = 0, dt = 0 }) {
    if (this.disposed) return;
    // Actor/viewer y is feet height; an optional camera supplies the rendered eye.
    const eye = actor => ({ x: actor.x, y: actor.y + GEAR_BALANCE.eyeHeight, z: actor.z });
    const origin = viewer.camera?.position ?? eye(viewer);
    const actorVisibility = new Map();
    for (const actor of actors) {
      const enemy = actor.id !== viewer.id && (viewer.teamId == null || actor.teamId !== viewer.teamId);
      const visible = actor.alive !== false && !(enemy && flashRemaining > 0) && !smokeBlocksSight(origin, eye(actor), this.smokeRecords);
      actorVisibility.set(actor.id, visible);
      if (actor.model) actor.model.visible = visible;
      if (actor.label) actor.label.visible = visible;
    }
    this.flash.material.opacity = .86 * Math.sqrt(Math.max(0, Math.min(3, flashRemaining)) / 3);
    this.flash.visible = flashRemaining > 0;
    if (viewer.camera && this.flash.parent !== viewer.camera) viewer.camera.add(this.flash);
    for (const [id, burst] of this.bursts) {
      burst.userData.remaining -= Math.max(0, dt);
      if (burst.userData.remaining <= 0) { burst.removeFromParent(); this.bursts.delete(id); }
      else burst.scale.setScalar(.3 + (1 - burst.userData.remaining / .35) * 2);
    }
    return actorVisibility;
  }
  event(event) {
    if (this.disposed || event.id <= this.lastEventId) return;
    this.lastEventId = event.id;
    // Smoke is authoritative persistent state; flash uses only the viewer's impairment.
    if (event.type !== 'grenade-burst' || event.grenadeType !== 'frag') return;
    if (this.bursts.size >= GEAR_BALANCE.maxProjectiles) {
      const [id, oldest] = this.bursts.entries().next().value; oldest.removeFromParent(); this.bursts.delete(id);
    }
    if (!this.burstMaterial) this.burstMaterial = this.ownMaterial(new this.THREE.MeshBasicMaterial({ color: '#cb8645', wireframe: true, transparent: true, opacity: .65, depthWrite: false }));
    const burst = new this.THREE.Mesh(this.sphere, this.burstMaterial); burst.name = 'Grenade burst';
    burst.position.set(event.position.x, event.position.y, event.position.z); burst.scale.setScalar(.3); burst.userData.remaining = .35;
    this.group.add(burst); this.bursts.set(event.id, burst);
  }
  clear() {
    this.group.clear(); this.flash.removeFromParent(); this.flash.visible = false;
    for (const map of [this.loot, this.projectiles, this.smokes, this.bursts]) map.clear();
    this.smokeRecords = []; this.lastEventId = -1;
  }
  dispose() {
    if (this.disposed) return;
    this.clear(); this.group.removeFromParent(); this.disposed = true;
    for (const resource of [...this.geometries, ...this.materials, ...this.textures]) resource.dispose();
    this.geometries.clear(); this.materials.clear(); this.textures.clear(); this.templates.clear(); this.labels.clear();
  }
}
