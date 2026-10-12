import { defaultSoloPowers, normalizeSoloPowers } from './solo-powers.js';

export function createSoloPowersUI({document, pinGate, getContext, onApply,
  onOpen = () => {}, onClose = () => {}, now = () => Date.now()}) {
  const $ = name => document.getElementById(`solo-powers-${name}`);
  const logos = {home:document.getElementById('home-secret-logo'), paused:document.getElementById('pause-secret-logo')};
  const screen = $('screen'), pin = $('pin'), confirmation = $('pin-confirm');
  const bindings = [];
  let captured = null, gesture = null, generation = 0, phase = 'closed', busy = false, timer = null, destroyed = false;
  function listen(target, name, handler, capture = false) {
    target.addEventListener(name, handler, capture);
    bindings.push(() => target.removeEventListener(name, handler, capture));
  }
  function context() {
    try {
      const value = getContext();
      if (value?.allowed !== true || !['home','paused'].includes(value.origin)
        || (value.origin === 'paused' && (!value.roundId || typeof value.roundId !== 'object'))) return null;
      return value;
    } catch { return null; }
  }
  const same = (a, b) => !!a && !!b && a.origin === b.origin && a.token === b.token && a.roundId === b.roundId;
  function clearDigits() { pin.value = ''; confirmation.value = ''; }
  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function fillControls(config) {
    $('invincible').checked = config.invincible; $('ammo').checked = config.unlimitedAmmo;
    $('speed').checked = config.superSpeed; $('speed-multiplier').value = String(config.speedMultiplier);
    speedLabel();
  }
  function speedLabel() {
    const number = Number($('speed-multiplier').value);
    $('speed-value').textContent = Number.isFinite(number) ? `${number.toFixed(1)}×` : '—';
    $('speed-multiplier').disabled = !$('speed').checked;
  }
  function invalidate({restoreFocus = false} = {}) {
    const previous = captured;
    generation++; gesture = null; captured = null; busy = false; phase = 'closed';
    clearTimer(); clearDigits(); fillControls(defaultSoloPowers());
    screen.hidden = true; $('controls').hidden = true; $('pin-form').hidden = true;
    $('status').textContent = '';
    if (previous) {
      onClose(previous);
      if (restoreFocus && same(previous, context())) logos[previous.origin].focus();
    }
  }
  function gateStatus() {
    try { return pinGate.status(); }
    catch { return {kind:'unavailable',reason:'The secret menu is unavailable here. Ordinary play is still available.',retryAfterMs:0}; }
  }
  function renderGate(message = '') {
    clearTimer();
    const status = gateStatus(), setup = status.kind === 'missing';
    const usable = setup || status.kind === 'ready';
    $('title').textContent = setup ? 'CREATE YOUR PIN' : 'ENTER YOUR PIN';
    $('confirm-row').hidden = !setup;
    $('pin-form').hidden = false; $('controls').hidden = true;
    pin.disabled = confirmation.disabled = !usable || busy;
    $('pin-submit').textContent = setup ? 'SAVE PIN' : 'UNLOCK';
    $('pin-submit').disabled = !usable || busy || status.retryAfterMs > 0;
    $('status').textContent = status.retryAfterMs > 0 ? `Try again in ${Math.ceil(status.retryAfterMs / 1000)} seconds.`
      : status.reason || message || (setup ? 'Choose 4–8 digits. Saved only on this device/browser.' : 'Enter your saved 4–8 digit PIN.');
    if (status.retryAfterMs > 0) timer = setTimeout(() => {
      timer = null;
      if (!captured || phase !== 'gate') return;
      if (!same(captured, context())) invalidate(); else renderGate();
    }, Math.min(1000, status.retryAfterMs));
  }
  function activate(origin) {
    if (destroyed || captured) return;
    const current = context(), time = now();
    if (!current || current.origin !== origin) { gesture = null; return; }
    if (!gesture || !same(gesture.context, current) || time - gesture.started > 3000 || time < gesture.started)
      gesture = {context:{...current}, started:time, count:0};
    if (++gesture.count < 5) return;
    gesture = null; generation++; busy = false; phase = 'gate';
    captured = {...current, config:normalizeSoloPowers(current.config) || defaultSoloPowers()};
    clearDigits(); fillControls(captured.config); screen.hidden = false; renderGate();
    onOpen(captured);
    if (captured && same(captured, context())) (pin.disabled ? $('cancel') : pin).focus();
    else invalidate();
  }
  async function submit(event) {
    event.preventDefault();
    if (!captured || phase !== 'gate' || busy) return;
    if (!same(captured, context())) { invalidate(); return; }
    const status = gateStatus();
    if (!['missing','ready'].includes(status.kind) || status.retryAfterMs > 0) { clearDigits(); renderGate(); return; }
    const started = generation;
    busy = true; renderGate();
    let result;
    try {
      const pending = status.kind === 'missing' ? pinGate.setup(pin.value, confirmation.value) : pinGate.verify(pin.value);
      clearDigits();
      result = await pending;
    } catch { result = {ok:false, reason:'PIN check unavailable. Please try again.'}; }
    // A completion from an older dialog must not touch a newer dialog either.
    if (started !== generation) return;
    clearDigits(); busy = false;
    if (!same(captured, context())) { invalidate(); return; }
    if (result?.ok !== true) { renderGate(result?.reason || 'Unable to unlock.'); if (!pin.disabled) pin.focus(); return; }
    phase = 'controls'; clearTimer();
    $('title').textContent = 'SOLO POWERS'; $('status').textContent = 'Solo only · Powers reset when this round ends · XP still saves';
    $('pin-form').hidden = true; $('controls').hidden = false;
    fillControls(captured.config); $('invincible').focus();
  }
  function apply() {
    if (!captured || phase !== 'controls') return;
    if (!same(captured, context())) { invalidate(); return; }
    const config = normalizeSoloPowers({invincible:$('invincible').checked, unlimitedAmmo:$('ammo').checked,
      superSpeed:$('speed').checked, speedMultiplier:Number($('speed-multiplier').value)});
    if (!config) { $('status').textContent = 'Choose a speed between 2.0× and 5.0×.'; return; }
    const result = onApply(config, captured);
    if (result?.ok !== true) { $('status').textContent = result?.reason || 'These settings could not be applied.'; return; }
    invalidate({restoreFocus:true});
  }
  function focusable() {
    const controls = phase === 'controls' ? ['invincible','ammo','speed','speed-multiplier','apply']
      : ['pin', ...($('confirm-row').hidden ? [] : ['pin-confirm']), 'pin-submit'];
    return [...controls.map($), $('cancel')].filter(element => !element.disabled && !element.hidden);
  }
  function keyboard(event) {
    if (!captured) return;
    if (!same(captured, context())) { invalidate(); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); invalidate({restoreFocus:true});
    } else if (event.key === 'Tab') {
      const items = focusable(), index = items.indexOf(document.activeElement);
      if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus();
      }
    }
  }
  for (const [origin, logo] of Object.entries(logos)) listen(logo, 'click', () => activate(origin));
  listen($('pin-form'), 'submit', submit);
  listen($('speed'), 'change', speedLabel); listen($('speed-multiplier'), 'input', speedLabel);
  listen($('apply'), 'click', apply); listen($('cancel'), 'click', () => invalidate({restoreFocus:true}));
  listen(document, 'keydown', keyboard, true);
  listen(document, 'focusin', event => {
    if (captured && !screen.contains(event.target)) focusable()[0].focus();
  }, true);
  invalidate();
  return {invalidate, isOpen:() => captured !== null, destroy() { destroyed = true; invalidate(); for (const remove of bindings) remove(); }};
}
