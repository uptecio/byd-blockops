import { validProgressionReceipt } from './progression-protocol.js';

// Trusted gameplay/network lifecycle adapter. Views/results never activate a run.
export function createProgressionController({ store, session, onChange = () => {}, onDelta = () => {} }) {
  let activeKey = null, lastView = '';
  function publish(delta) {
    const view = store.view(), signature = JSON.stringify(view);
    if (signature !== lastView) { lastView = signature; onChange(view); }
    if (delta?.creditedXP > 0 || delta?.newRewards.length) onDelta(delta, view);
  }
  function stop() { if (activeKey !== null) session.end(activeKey); activeKey = null; }
  function begin(key, modeId) {
    if (activeKey === key) return;
    stop(); session.begin(key, modeId); activeKey = key;
  }
  return {
    solo(event) {
      if (event.type === 'start') begin(event.key, event.modeId);
      if (event.key !== activeKey) return;
      publish(session.accept(event.key, event.tally));
      if (event.type === 'stop') stop();
    },
    room(room, client) {
      if (!client.connected || client.room !== room || !client.serverOrigin
        || !validProgressionReceipt(room.selfProgression, room, client.id)) return;
      const receipt = room.selfProgression;
      if (receipt === null) { stop(); return; }
      const key = JSON.stringify(['online', client.serverOrigin, receipt.roundId, receipt.playerId]);
      begin(key, receipt.modeId); publish(session.accept(key, receipt.tally));
    },
    equip(patch) { const result = store.equip(patch); publish(); return result; },
    retry() { const saved = store.retrySave(); publish(); return saved; },
    stop,
  };
}
