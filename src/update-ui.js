const phases = ['idle', 'checking', 'current', 'available', 'downloading', 'verifying', 'ready', 'permission', 'installing', 'error'];
const busy = ['checking', 'downloading', 'verifying', 'installing'];
const text = value => typeof value === 'string' && value.length <= 240;
function valid(state) {
  return state && Number.isSafeInteger(state.revision) && state.revision >= 0 && phases.includes(state.phase)
    && text(state.installedVersion) && (state.availableVersion === null || text(state.availableVersion))
    && Number.isSafeInteger(state.totalBytes) && state.totalBytes >= 0 && state.totalBytes <= 104857600
    && Number.isSafeInteger(state.downloadedBytes) && state.downloadedBytes >= 0 && state.downloadedBytes <= state.totalBytes
    && text(state.message) && typeof state.dismissed === 'boolean';
}

/** Optional native notice. No browser networking, download, or installation authority. */
export function createUpdateUI({ window, document }) {
  const panel = document.getElementById('home-updates'), status = document.getElementById('update-status');
  const check = document.getElementById('update-check'), open = document.getElementById('update-open');
  let bridge, observer, home = false, eligible = false, disposed = false, state = null;
  const inert = { setHomeVisible() {}, dispose() {} };
  if (panel) panel.hidden = true;
  try { bridge = window.BlockOpsUpdates; } catch { return inert; }
  if (!panel || !status || !check || !open || !bridge || !['homeState', 'check', 'open'].every(key => typeof bridge[key] === 'function')) return inert;
  function disable() {
    disposed = true; panel.hidden = true; observer?.disconnect();
    document.removeEventListener('visibilitychange', refresh);
    check.removeEventListener('click', onCheck); open.removeEventListener('click', onOpen);
    if (window.receiveBlockOpsUpdate === receive) delete window.receiveBlockOpsUpdate;
  }
  function call(command, value) { try { bridge[command](...(value === undefined ? [] : [value])); } catch { disable(); } }
  function render() {
    panel.hidden = !eligible || disposed;
    check.hidden = false; check.disabled = !!state && busy.includes(state.phase);
    open.hidden = !state || state.dismissed || ['idle', 'current'].includes(state.phase);
    status.textContent = state && !state.dismissed ? `${state.availableVersion ? `v${state.availableVersion} · ` : ''}${state.message}` : 'Optional app updates';
  }
  function refresh() {
    if (disposed) return;
    const next = home && !document.hidden && !Array.from(document.querySelectorAll('.modal-screen')).some(modal => !modal.hidden);
    if (next !== eligible) { eligible = next; call('homeState', next ? 'home' : 'hidden'); }
    render();
  }
  function receive(snapshot) {
    if (disposed || !valid(snapshot) || (state && snapshot.revision <= state.revision)) return;
    state = { ...snapshot }; render();
  }
  function onCheck() { refresh(); if (eligible && !disposed && !check.disabled) call('check'); }
  function onOpen() { refresh(); if (eligible && !disposed && !open.hidden) call('open'); }
  try {
    window.receiveBlockOpsUpdate = receive;
    check.addEventListener('click', onCheck); open.addEventListener('click', onOpen);
    document.addEventListener('visibilitychange', refresh);
    observer = new window.MutationObserver(refresh);
    for (const modal of document.querySelectorAll('.modal-screen')) observer.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  } catch { disable(); }
  return { setHomeVisible(value) { home = value === true; refresh(); }, dispose() { if (!disposed) { call('homeState', 'hidden'); disable(); } } };
}
