import { hasLineOfSight } from './collision.js';
import { areEnemies } from './modes.js';

const point = ({ x, z }) => ({ x, z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const validPoint = actor => actor && Number.isFinite(actor.x) && Number.isFinite(actor.z);
const stableNearest = (origin, actors) => actors.slice().sort((a, b) => distance(origin, a) - distance(origin, b)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];

export function chooseBotIntent(actor, { actors, state, map, role }) {
  if (!validPoint(actor) || !actor.alive || state.ended || !Object.hasOwn(state.stats, actor.id)) {
    return { goal: null, targetId: null };
  }
  const living = actors.filter(a => validPoint(a) && a.alive && Object.hasOwn(state.stats, a.id)
    && a.teamId === state.stats[a.id].teamId);
  const enemies = living.filter(enemy => areEnemies(state, actor.id, enemy.id));
  // Ground-level actor Y becomes a chest-height shooting ray, including jumps.
  const eye = a => ({ x: a.x, y: (a.y ?? 0) + 1.35, z: a.z });
  const target = stableNearest(actor, enemies.filter(enemy => enemy.protectedRemaining <= 0
    && hasLineOfSight(eye(actor), eye(enemy), map.solids)));
  const targetId = target?.id ?? null;

  if (state.modeId !== 'ctf') {
    const opponent = stableNearest(actor, enemies);
    return { goal: opponent ? point(opponent) : null, targetId };
  }

  const ownTeam = state.stats[actor.id].teamId;
  const ownFlag = state.flags[ownTeam], enemyFlag = state.flags[ownTeam === 'red' ? 'blue' : 'red'];
  const flagPosition = flag => living.find(a => a.id === flag.carrierId) ?? flag;
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
      const intruder = stableNearest(actor, enemies.filter(enemy => distance(base, enemy) <= 10));
      goal = ownFlag.status !== 'home' ? flagPosition(ownFlag) : intruder ?? base;
    } else goal = flagPosition(enemyFlag);
  }
  return { goal: point(goal), targetId };
}
