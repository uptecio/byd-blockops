import { createEquipment } from '../../src/equipment.js';

export function createGearActor(id, overrides = {}) {
  return {
    id, lifeId: 1, teamId: null,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    alive: true, protectedRemaining: 0, flashRemaining: 0,
    equipment: createEquipment('m4a1'),
    ...overrides,
  };
}
