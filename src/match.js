export function createMatch() { return { timeLeft: 180, kills: 0, deaths: 0, ended: false }; }
export function tickMatch(match, dt) {
  if (match.ended || !Number.isFinite(dt) || dt <= 0) return;
  match.timeLeft = Math.max(0, match.timeLeft - dt);
  if (match.timeLeft === 0) match.ended = true;
}
export function recordKill(match) {
  if (match.ended) return;
  match.kills++;
  if (match.kills >= 15) match.ended = true;
}
export function recordDeath(match) { if (!match.ended) match.deaths++; }
