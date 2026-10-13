import * as THREE from 'three';
import { ArenaGame, disposeModel } from '../../src/game.js';
import { Input } from '../../src/input.js';
import { createWorld } from '../../src/world.js';
import { getWeapon } from '../../src/weapons.js';
import { createSpatialWorld } from '../../src/spatial.js';

// Explicit setup for tests which deliberately reposition a physical actor.
export function positionBot(bot, x, y, z) {
  if (![x, y, z].every(Number.isFinite)) throw new Error('Invalid test position');
  if (bot.body) Object.assign(bot.body, { x, y, z, velocityY: 0, grounded: y === 0, supportId: y === 0 ? 'ground' : null });
  bot.model.position.set(x, y, z);
}

export function setWorldSolids(game, solids) {
  game.world.spatial = createSpatialWorld({ ...game.world.definition, solids });
  game.world.solids = game.world.spatial.solids;
}

// Real input methods, scene, world and combat; only DOM/GPU/audio sinks omitted.
export function createHeadlessGame() {
  const input = Object.assign(Object.create(Input.prototype), {
    enabled: false, keys: new Set(), combatBlockedKeys: new Set(), pointers: new Map(), move: { x: 0, y: 0 },
    look: { x: 0, y: 0 }, knob: { style: {} }, fire: false, firePressed: false,
    jump: false, reload: false, zoom: false, knifePressed: false, throwPressed: false, grenadePickerPressed: false, hidePressed: false, hidePointers: new Set(),
  });
  const game = Object.create(ArenaGame.prototype);
  Object.assign(game, {
    input, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(75, 1, .05, 180),
    renderer: { render() {} }, audio: { shoot() {}, reload() {}, hit() {}, kill() {} },
    events: { onToast() {}, onHud() {}, onEnd() {} },
    player: { id: 'local', lifeId: 0, jump: 0, y: 0, velocityY: 0, grounded: true, supportId: 'ground', health: 100, dead: 0, protected: 0 },
    active: false, hasRound: false, bots: [], effects: [], inventory: new Map(), weapon: getWeapon('m4a1'),
    match: {}, settings: {}, time: 0, yaw: 0, pitch: 0, recoil: 0,
    muzzle: new THREE.Group(), shotFlash: 0, hitFlash: 0, damageFlash: 0, hudTimer: 0,
  });
  game.camera.rotation.order = 'YXZ'; game.scene.add(game.camera);
  game.world = createWorld(THREE, game.scene);
  return game;
}

export function cleanupGame(game) {
  game.rangeRuntime?.dispose();
  game.zombieRuntime?.dispose();
  game.clearEffects();
  for (const bot of game.bots) disposeModel(bot.model);
  disposeModel(game.weaponModel);
  game.objectives?.dispose(); game.world?.dispose();
  game.gearView?.dispose();
}
