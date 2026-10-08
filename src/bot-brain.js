import { areEnemies } from './modes.js';
import { getWeapon } from './weapons.js';
import { hasOwn } from './has-own.js';
import { isUsingSupply } from './supplies.js';
import { canPerceive } from './actor-perception.js';

const point = ({ x, y = 0, z }) => ({ x, y, z });
const distance = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
const validPoint = actor => actor && Number.isFinite(actor.x) && Number.isFinite(actor.z);
const stableNearest = (origin, actors) => actors.slice().sort((a, b) => distance(origin, a) - distance(origin, b)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];

export function chooseBotIntent(actor, { actors, state, map, role, smokes = [], lastKnownTargets = new Map() }) {
  if (!validPoint(actor) || !actor.alive || state.ended || !hasOwn(state.stats, actor.id)) {
    return { goal: null, targetId: null };
  }
  const living = actors.filter(a => validPoint(a) && a.alive && hasOwn(state.stats, a.id)
    && a.teamId === state.stats[a.id].teamId);
  const enemies = living.filter(enemy => areEnemies(state, actor.id, enemy.id));
  // Ground-level actor Y becomes a chest-height shooting ray, including jumps.
  const concealed = enemy => !canPerceive(actor, enemy, { world: map, smokes });
  const target = stableNearest(actor, enemies.filter(enemy => enemy.protectedRemaining <= 0
    && !concealed(enemy)));
  const targetId = target?.id ?? null;
  const knownEnemies = enemies.flatMap(enemy => {
    if (enemy.hiddenSpotId) return [];
    if (!concealed(enemy)) return [enemy];
    const known = lastKnownTargets.get(enemy.id);
    return validPoint(known) && known.lifeId === enemy.lifeId ? [{ ...point(known), id: enemy.id }] : [];
  });

  if (state.modeId !== 'ctf') {
    const opponent = stableNearest(actor, knownEnemies);
    return { goal: opponent ? point(opponent) : null, targetId };
  }

  const ownTeam = state.stats[actor.id].teamId;
  const ownFlag = state.flags[ownTeam], enemyFlag = state.flags[ownTeam === 'red' ? 'blue' : 'red'];
  const flagPosition = flag => {
    if (flag.status !== 'carried') return flag;
    const carrier = living.find(a => a.id === flag.carrierId);
    if (carrier && !areEnemies(state, actor.id, carrier.id)) return carrier;
    // Carried flag coordinates also follow a concealed enemy; use only memory.
    return knownEnemies.find(enemy => enemy.id === flag.carrierId) ?? map.bases[flag.teamId];
  };
  let goal;
  if (enemyFlag.status === 'carried' && enemyFlag.carrierId === actor.id) {
    goal = ownFlag.status === 'home' ? map.bases[ownTeam] : flagPosition(ownFlag);
  } else {
    // Runtime chooses roles; this pure fallback prevents a lone bot from
    // defending forever. Human ID is local and offline bot IDs are bot-N.
    const anotherBot = Object.keys(state.stats).some(id => id !== actor.id && id.startsWith('bot-')
      && state.stats[id].teamId === ownTeam);
    if (role === 'defend' && anotherBot) {
      const base = map.bases[ownTeam];
      const intruder = stableNearest(actor, knownEnemies.filter(enemy => distance(base, enemy) <= 10));
      goal = ownFlag.status !== 'home' ? flagPosition(ownFlag) : intruder ?? base;
    } else goal = flagPosition(enemyFlag);
  }
  return { goal: point(goal), targetId };
}

export function chooseBotEquipment(actor, { actors, intent, smokes = [], solids, now }) {
  const equipment = actor.equipment;
  if (!actor.alive || !equipment?.owned.has(equipment.activeGunId) || actor.flashRemaining > 0 || isUsingSupply(equipment)) return null;
  const target = actors.find(other => other.id === intent?.targetId && other.alive && other.protectedRemaining <= 0
    && other.id !== actor.id && (actor.teamId === null || other.teamId !== actor.teamId));
  const visible = target && canPerceive(actor, target, { world: { solids }, smokes });
  const range = visible ? distance(actor, target) : Infinity;
  if (now - (actor.lastGrenadeAttempt ?? -Infinity) >= 6 && equipment.throwRemaining <= 0) {
    if (equipment.grenades.smoke > 0 && (actor.health <= 35 || actor.carryingFlag)) return { kind: 'throw', grenadeType: 'smoke' };
    if (visible && range >= 6 && range <= 22 && equipment.grenades.frag > 0) return { kind: 'throw', grenadeType: 'frag' };
    if (visible && range >= 3 && range <= 10 && equipment.grenades.flash > 0) return { kind: 'throw', grenadeType: 'flash' };
  }
  if (visible && range <= 1.8 && equipment.knife) return equipment.heldItem === 'knife' ? null : { kind: 'held-item', heldItem: 'knife' };
  if (equipment.heldItem === 'knife') return { kind: 'held-item', heldItem: 'gun' };
  if (!visible) return null;
  const score = id => {
    const gun = getWeapon(id);
    if (gun.range < range) return -1;
    const preferred = range < 8 ? 'shotgun' : range < 18 ? 'smg' : range > 35 ? 'sniper' : 'assault';
    return Number(gun.classId === preferred) * 2 + Number(id === equipment.activeGunId);
  };
  const best = [...equipment.owned.keys()].filter(id => equipment.owned.get(id).ammo + equipment.owned.get(id).reserve > 0)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
  return best && score(best) >= 0 && best !== equipment.activeGunId ? { kind: 'equip-gun', weaponId: best, source: 'inventory' } : null;
}
