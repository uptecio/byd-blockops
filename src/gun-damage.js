// Gun impacts share Solo's existing anatomical threshold. Body balance and
// falloff remain the caller's responsibility; head hits use the approved amount.
export const HEADSHOT_DAMAGE = 10000000000;
export function gunHitDamage(bodyDamage, hitY, feetY) {
  return hitY > feetY + 1.48 ? HEADSHOT_DAMAGE : bodyDamage;
}
