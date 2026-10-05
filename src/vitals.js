import { hasOwn } from './has-own.js';

const validPool = value => Number.isFinite(value) && value >= 0 && value <= 100;

export function damageVitals(vitals, amount) {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: 'Invalid damage' };
  if (!vitals || !validPool(vitals.health) || (hasOwn(vitals, 'armour') && !validPool(vitals.armour))) {
    return { ok: false, reason: 'Invalid vitals' };
  }
  const armour = vitals.armour ?? 0;
  const armourDamage = Math.min(armour, amount);
  const healthDamage = Math.min(vitals.health, amount - armourDamage);
  vitals.armour = armour - armourDamage;
  vitals.health -= healthDamage;
  return { ok: true, healthDamage, armourDamage, killed: vitals.health === 0 };
}
