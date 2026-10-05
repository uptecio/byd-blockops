// Shared fictional arena balance; distances are game units, angles radians,
// and timers seconds. Weapon balance remains in weapons.js.
export const GRENADE_TYPES = Object.freeze(['frag', 'smoke', 'flash']);

export const GEAR_BALANCE = Object.freeze({
  knife: Object.freeze({ damage: 50, reach: 1.8, halfAngle: Math.PI / 6, interval: 0.6 }),
  grenades: Object.freeze({
    frag: Object.freeze({ fuse: 2, maxDamage: 90, radius: 5 }),
    smoke: Object.freeze({ fuse: 2, radius: 4, duration: 8 }),
    flash: Object.freeze({ fuse: 1.25, radius: 10, maxDuration: 3 }),
  }),
  grenadeCapacity: 3,
  throwCooldown: 0.65,
  attackSuppression: 0.25,
  eyeHeight: 1.6,
  grenadePhysics: Object.freeze({
    radius: 0.12, releaseDistance: 0.45, launchSpeed: 12, launchLift: 3,
    gravity: 14, restitution: 0.35, tangentialMultiplier: 0.7,
    maxStep: 1 / 120, restSpeed: 0.25, smokeHeight: 2,
  }),
  pickupRadius: 1.2,
  pickupVerticalReach: 0.75,
  mapRespawn: 20,
  dropUnlock: 0.5,
  dropExpiry: 30,
  maxDrops: 48,
  maxMapLoot: 20,
  maxLoot: 68,
  maxProjectiles: 32,
  maxSmoke: 16,
});
