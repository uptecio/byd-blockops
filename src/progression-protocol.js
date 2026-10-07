import { validateTally } from './progression.js';

export const validProgressionId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = ['roundId', 'playerId', 'modeId', 'tally'];

export function validProgressionReceipt(value, room, playerId) {
  if (!room || !['ffa', 'tdm', 'ctf'].includes(room.modeId) || !validProgressionId(playerId)) return false;
  const own = Array.isArray(room.players) && room.players.find(player => player.id === playerId);
  if (!own) return false;
  if (room.roundId === null) return room.phase === 'lobby' && value === null;
  if (!validProgressionId(room.roundId) || !['playing', 'ended'].includes(room.phase) || !plain(value)
    || Reflect.ownKeys(value).length !== fields.length || !fields.every(key => Object.prototype.hasOwnProperty.call(value, key))
    || value.roundId !== room.roundId || value.playerId !== playerId || value.modeId !== room.modeId
    || !plain(value.tally) || !validateTally(value.tally, room.modeId)) return false;
  if (value.tally.completed && room.phase !== 'ended') return false;
  const winner = room.modeId === 'ffa' ? room.winnerId === playerId : own.teamId !== null && room.winnerTeamId === own.teamId;
  return !value.tally.won || winner;
}
