import { RoomClient } from './network.js';
import { OnlineArena } from './online-game.js';
import { GAME_SERVER_URL } from './config.js';

const $ = id => document.getElementById(id);
export class MultiplayerUI {
  constructor({ getGame, getSettings, getSelected, onMode, onLoadout, onToast }) {
    Object.assign(this, { getGame, getSettings, getSelected, onMode, onLoadout, onToast });
    this.arena = null; this.room = null; this.busy = false;
    this.client = new RoomClient({ onRoom: room => this.receive(room), onError: message => this.status(message, true), onDisconnect: () => this.disconnected() });
    document.querySelector('.health-panel .eyebrow').id = 'hud-mode';
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('block-ops-online') || '{}') || {}; } catch {}
    $('player-name').value = typeof saved.name === 'string' ? saved.name.slice(0, 16) : 'Ranger';
    const browserOrigin = location.hostname === 'appassets.androidplatform.net' ? '' : location.origin;
    const invite = new URLSearchParams(location.search).get('room');
    const hostedOrigin = browserOrigin && !['localhost', '127.0.0.1'].includes(location.hostname) ? browserOrigin : '';
    $('server-address').value = invite && browserOrigin ? browserOrigin : saved.server || hostedOrigin || GAME_SERVER_URL || browserOrigin;
    if (invite && /^[A-Za-z0-9]{6}$/.test(invite)) { $('room-code-input').value = invite.toUpperCase(); queueMicrotask(() => this.open()); }
    $('online-button').addEventListener('click', () => this.open());
    $('online-back').addEventListener('click', () => this.onLoadout());
    $('create-room').addEventListener('click', () => this.connect('create'));
    $('join-room').addEventListener('click', () => this.connect('join'));
    $('room-code-input').addEventListener('input', () => { $('room-code-input').value = $('room-code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('start-online').addEventListener('click', () => {
      if (this.room && this.room.phase === 'playing') this.deploy(this.getSelected().id);
      else this.client.send({ type: 'start' });
    });
    $('room-loadout').addEventListener('click', () => this.onLoadout());
    $('leave-room').addEventListener('click', () => { this.leave(); this.open(); });
    $('copy-invite').addEventListener('click', () => this.copyInvite());
  }
  isConnected() { return Boolean(this.client.connected && this.room); }
  isActive() { return Boolean(this.arena); }
  status(message, error = false) { $('connection-status').textContent = String(message || '').slice(0, 220); $('connection-status').classList.toggle('error', error); }
  open() {
    this.onMode('lobby');
    $('online-setup').hidden = this.isConnected(); $('room-lobby').hidden = !this.isConnected();
    if (this.room) this.renderRoom();
  }
  async connect(type) {
    if (this.busy) return;
    const name = $('player-name').value.trim() || 'Ranger';
    const code = $('room-code-input').value.trim().toUpperCase();
    if (type === 'join' && !/^[A-Z0-9]{6}$/.test(code)) { this.status('Enter the six-character room code from your friend.', true); return; }
    this.busy = true; $('create-room').disabled = $('join-room').disabled = true; this.status('Connecting to the game server…');
    try {
      const server = $('server-address').value.trim();
      await this.client.connect(server, { type, code, name, weaponId: this.getSelected().id });
      try { localStorage.setItem('block-ops-online', JSON.stringify({ name, server })); } catch {}
      this.status('Connected · Share your room code or invite link.');
    } catch (error) { this.status(error.message || 'Could not connect. Check your connection and server address.', true); }
    finally { this.busy = false; $('create-room').disabled = $('join-room').disabled = false; }
  }
  receive(room) {
    const previous = this.room;
    this.room = room; this.renderRoom();
    $('mode-badge').textContent = `ONLINE / ${room.code}`;
    $('hud-mode').textContent = `ONLINE / ${room.code}`;
    $('online-setup').hidden = true; $('room-lobby').hidden = false;
    if (room.phase === 'playing' && (!this.arena || !previous || previous.phase !== 'playing')) {
      if (this.arena) this.arena.stop();
      const game = this.getGame();
      this.arena = new OnlineArena(game, this.client, {
        onToast: this.onToast,
        onEnd: ended => this.showResults(ended || this.room),
      });
      this.arena.start(room, this.client.id, this.getSettings());
      this.onMode('playing'); game.audio.unlock();
    } else if (this.arena) this.arena.sync(room);
    if (room.phase === 'ended' && (!previous || previous.phase !== 'ended')) this.showResults(room);
  }
  renderRoom() {
    const room = this.room; if (!room) return;
    $('room-code').textContent = room.code; $('room-player-count').textContent = `${room.players.length} / 8`;
    $('room-phase').textContent = room.phase === 'playing' ? 'MATCH IN PROGRESS' : room.phase === 'ended' ? 'ROUND COMPLETE' : 'WAITING FOR FRIENDS';
    const host = room.hostId === this.client.id;
    const sorted = [...room.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    $('room-roster').replaceChildren(); $('online-scoreboard').replaceChildren();
    for (const player of sorted) {
      const row = document.createElement('div'); row.className = 'roster-player';
      const name = document.createElement('span'); name.textContent = `${player.name}${player.id === this.client.id ? ' (YOU)' : ''}`;
      const badge = document.createElement('small'); badge.textContent = player.id === room.hostId ? 'HOST' : 'READY';
      row.append(name, badge); $('room-roster').append(row);
      const score = document.createElement('div'); score.classList.toggle('is-you', player.id === this.client.id);
      const scoreName = document.createElement('span'); scoreName.textContent = player.name;
      const count = document.createElement('b'); count.textContent = `${player.kills} / ${player.deaths}`; score.append(scoreName, count); $('online-scoreboard').append(score);
    }
    $('online-scoreboard').hidden = room.phase !== 'playing';
    const canStart = host && room.players.length >= 2;
    $('start-online').disabled = room.phase !== 'playing' && !canStart;
    $('start-online').textContent = room.phase === 'playing' ? 'RETURN TO MATCH ↗' : !host ? 'WAITING FOR HOST' : room.players.length < 2 ? 'WAITING FOR A FRIEND' : room.phase === 'ended' ? 'PLAY AGAIN ↗' : 'START MATCH ↗';
    $('room-help').textContent = room.phase === 'playing' ? 'The match continues while menus are open. Your character remains in the arena.' : 'Share the invite link. Friends can play in their browser or the APK. At least two players are needed to start.';
  }
  showResults(room) {
    room = room && Array.isArray(room.players) ? room : this.room;
    if (!room) return;
    const own = room.players.find(player => player.id === this.client.id);
    const winner = room.players.find(player => player.id === room.winnerId);
    $('result-kills').textContent = own ? own.kills : 0; $('result-deaths').textContent = own ? own.deaths : 0;
    $('result-title').textContent = winner && winner.id === this.client.id ? 'YOU WON.' : winner ? `${winner.name.toUpperCase()} WINS.` : 'ROUND COMPLETE.';
    $('again-button').textContent = 'BACK TO ROOM ↗';
    this.onMode('results');
  }
  deploy(weaponId) {
    if (!this.room) { this.open(); return; }
    this.client.send({ type: 'equip', weaponId });
    if (this.room.phase !== 'playing') { this.open(); return; }
    this.resume(); this.onMode('playing'); this.getGame().audio.unlock();
  }
  pause() { if (this.arena) this.arena.pause(); }
  resume() { if (this.arena) this.arena.resume(); }
  update(dt) { if (this.arena) this.arena.update(dt); }
  leave() {
    this.client.send({ type: 'leave' }); this.client.close();
    if (this.arena) this.arena.stop(); this.arena = null; this.room = null;
    const game = this.getGame(); if (game) game.quit();
    $('online-scoreboard').hidden = true; $('mode-badge').innerHTML = '<i></i> SOLO / OFFLINE'; $('hud-mode').textContent = 'SOLO / BOTS';
    $('again-button').innerHTML = 'PLAY AGAIN <span>↗</span>';
  }
  disconnected() { this.leave(); this.open(); this.status('Connection lost. Check your internet connection, then rejoin using the room code.', true); }
  async copyInvite() {
    if (!this.room) return;
    let url;
    try { url = new URL($('server-address').value); } catch { return; }
    url.pathname = '/'; url.search = `room=${this.room.code}`; url.hash = '';
    try { await navigator.clipboard.writeText(url.href); this.status('Invite link copied. Send it to your friends.'); }
    catch { this.status(`Room ${this.room.code} · Invite: ${url.href}`); }
  }
}
