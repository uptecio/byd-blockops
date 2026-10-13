import { getMode } from './modes.js';

const $ = id => document.getElementById(id);
export function renderMatchHud(view, ownId) {
  if (!view) return;
  const practice = !!view.range;
  document.querySelector('.score-panel').hidden = practice;
  $('timer').hidden = practice;
  if ($('range-stats')) $('range-stats').hidden = !practice;
  if (practice) {
    $('hud-mode').textContent = 'Shooting Range';
    for (const [id, value] of [['range-kills', view.range.targetKills], ['range-xp', view.range.earnedXP],
      ['range-accuracy', `${view.range.accuracy}% (${view.range.shotsHit}/${view.range.shotsFired})`]]) {
      if ($(id)) $(id).textContent = value;
    }
    document.querySelector('.score-panel').classList.toggle('zombie-score', false);
    document.querySelector('.score-panel').classList.toggle('team-score', false);
    $('objective-status').textContent = ''; $('objective-status').hidden = true;
    return;
  }
  const zombies = view.modeId === 'zombies';
  document.querySelector('.score-panel').classList.toggle('zombie-score', zombies);
  if (zombies) {
    const state = view.survival, recovery = state.phase === 'recovery';
    $('hud-mode').textContent = 'SOLO / ZOMBIE SURVIVAL';
    $('kills').textContent = `WAVE ${state.wave}`;
    document.querySelector('.score-target').textContent = recovery ? 'WAVE CLEAR' : `${state.remaining} LEFT`;
    document.querySelector('.score-panel').classList.toggle('team-score', false);
    $('timer').textContent = recovery ? `NEXT WAVE IN ${Math.ceil(state.recoveryRemaining)}` : `${state.kills} KILLS`;
    $('objective-status').textContent = recovery ? 'HEALTH + AMMO RESTORED · MOVE, LOOT & EQUIP' : '';
    $('objective-status').hidden = !recovery;
    return;
  }
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
export function renderMatchResults(view, ownId, { best } = {}) {
  if (!view) return;
  const zombies = view.modeId === 'zombies';
  document.querySelector('.results-dialog')?.classList.toggle('zombie-results', zombies);
  if ($('result-kills-label')) $('result-kills-label').textContent = zombies ? 'WAVES COMPLETED' : 'ELIMINATIONS';
  if ($('result-deaths-label')) $('result-deaths-label').textContent = zombies ? 'ZOMBIES DEFEATED' : 'DEATHS';
  if ($('zombie-best')) $('zombie-best').hidden = !zombies;
  if (zombies) {
    $('result-title').textContent = 'RUN OVER.';
    $('result-mode').textContent = 'ZOMBIE SURVIVAL';
    $('result-kills').textContent = view.survival.completedWaves;
    $('result-deaths').textContent = view.survival.kills;
    if ($('zombie-best')) $('zombie-best').textContent = `MAP BEST · ${best?.waves ?? 0} WAVES · ${best?.kills ?? 0} KILLS`;
    return;
  }
  const own = view.players.find(player => player.id === ownId), winner = view.players.find(player => player.id === view.winnerId);
  $('result-kills').textContent = own?.kills || 0; $('result-deaths').textContent = own?.deaths || 0;
  let title = 'DRAW.';
  if (view.winnerTeamId != null) title = `${view.winnerTeamId.toUpperCase()} TEAM WINS.`;
  else if (view.winnerId != null) title = view.winnerId === ownId ? 'YOU WON.' : `${(view.winnerName || winner?.name || 'Player').toUpperCase()} WINS.`;
  $('result-title').textContent = title;
  $('result-mode').textContent = getMode(view.modeId).name.toUpperCase();
}
