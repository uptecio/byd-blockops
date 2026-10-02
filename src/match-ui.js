import { getMode } from './modes.js';

const $ = id => document.getElementById(id);
export function renderMatchHud(view, ownId) {
  if (!view) return;
  const mode = getMode(view.modeId), own = view.players.find(player => player.id === ownId);
  const remaining = Math.max(0, Math.ceil(view.timeLeft));
  $('timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  $('hud-mode').textContent = `${ownId === 'local' ? 'SOLO' : 'ONLINE'} / ${mode.name.toUpperCase()}${own?.teamId ? ` / ${own.teamId.toUpperCase()}` : ''}`;
  $('kills').textContent = view.modeId === 'ffa' ? own?.kills || 0 : `RED ${view.teamScores.red} · BLUE ${view.teamScores.blue}`;
  document.querySelector('.score-target').textContent = ` / ${mode.scoreLimit}${view.modeId === 'ctf' ? ' CAPTURES' : ''}`;
  document.querySelector('.score-panel').classList.toggle('team-score', view.modeId !== 'ffa');
  let objective = '';
  if (view.flags) {
    objective = ['red', 'blue'].map(teamId => `${teamId.toUpperCase()} FLAG: ${view.flags[teamId].status.toUpperCase()}${view.flags[teamId].status === 'dropped' ? ` ${Math.ceil(view.flags[teamId].returnRemaining)}s` : ''}`).join(' · ');
    const carried = Object.values(view.flags).find(flag => flag.carrierId === ownId);
    if (carried && own?.teamId) objective = `${view.flags[own.teamId].status === 'home' ? 'RETURN TO YOUR BASE' : 'RECOVER YOUR FLAG TO CAPTURE'} · ${objective}`;
  }
  $('objective-status').textContent = objective;
  $('objective-status').hidden = !objective;
}
export function renderMatchResults(view, ownId) {
  if (!view) return;
  const own = view.players.find(player => player.id === ownId), winner = view.players.find(player => player.id === view.winnerId);
  $('result-kills').textContent = own?.kills || 0; $('result-deaths').textContent = own?.deaths || 0;
  let title = 'DRAW.';
  if (view.winnerTeamId != null) title = `${view.winnerTeamId.toUpperCase()} TEAM WINS.`;
  else if (view.winnerId != null) title = view.winnerId === ownId ? 'YOU WON.' : `${(view.winnerName || winner?.name || 'Player').toUpperCase()} WINS.`;
  $('result-title').textContent = title;
  $('result-mode').textContent = getMode(view.modeId).name.toUpperCase();
}
