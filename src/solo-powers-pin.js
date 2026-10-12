const KEY = 'block-ops-solo-powers-pin-v1';
const fields = ['schemaVersion', 'kdf', 'iterations', 'salt', 'verifier'];
const ITERATIONS = 100000;
const unavailable = 'Secret menu unavailable: storage or Web Crypto could not be used. Ordinary play is still available.';
const protectedSave = 'The saved PIN cannot be read by this version. It has been preserved.';
const validPin = pin => typeof pin === 'string' && pin.length >= 4 && pin.length <= 8 && !/[^0-9]/.test(pin);
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));

function decode(raw) {
  if (raw === null) return {kind:'missing', reason:''};
  if (typeof raw !== 'string' || raw.length > 1024) return {kind:'protected', reason:protectedSave};
  let value;
  try { value = JSON.parse(raw); } catch { return {kind:'protected', reason:protectedSave}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || !fields.every(key => Object.prototype.hasOwnProperty.call(value, key))
    || value.schemaVersion !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS
    || typeof value.salt !== 'string' || value.salt.length !== 32 || !/^[0-9a-f]+$/.test(value.salt)
    || typeof value.verifier !== 'string' || value.verifier.length !== 64 || !/^[0-9a-f]+$/.test(value.verifier)) {
    return {kind:'protected', reason:protectedSave};
  }
  return {kind:'ready', reason:'', record:value};
}

// This is a local convenience gate, not account authentication. Nothing is
// read at construction/import, and it never writes a game/progression key.
export function createSoloPowersPinGate({getStorage = () => localStorage, getCrypto = () => crypto, now = () => Date.now()} = {}) {
  let busy = false, failures = 0, blockedUntil = 0;
  function retryAfter() {
    const remaining = Math.max(0, blockedUntil - now());
    if (blockedUntil && !remaining) { blockedUntil = 0; failures = 0; }
    return remaining;
  }
  const fail = (reason, retryAfterMs = retryAfter()) => ({ok:false, reason, retryAfterMs});
  function read() {
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== 'function') throw Error('Storage unavailable');
    const raw = storage.getItem(KEY);
    return {...decode(raw), raw, storage};
  }
  function capabilities() {
    const provider = getCrypto();
    if (!provider || typeof provider.getRandomValues !== 'function'
      || !provider.subtle || typeof provider.subtle.importKey !== 'function'
      || typeof provider.subtle.deriveBits !== 'function') throw Error('Web Crypto unavailable');
    return provider;
  }
  function inspect() {
    const saved = read();
    if (saved.kind === 'protected') return saved;
    return {...saved, provider:capabilities()};
  }
  async function derive(provider, pin, salt) {
    // Digits are UTF-8/ASCII, without a TextEncoder requirement on old WebViews.
    const digits = Uint8Array.from(pin, digit => digit.charCodeAt(0));
    const key = await provider.subtle.importKey('raw', digits, 'PBKDF2', false, ['deriveBits']);
    const bytes = new Uint8Array(await provider.subtle.deriveBits(
      {name:'PBKDF2', salt, iterations:ITERATIONS, hash:'SHA-256'}, key, 256));
    if (bytes.length !== 32) throw Error('Invalid verifier result');
    return bytes;
  }
  function wrongPin() {
    failures++;
    if (failures >= 5) blockedUntil = now() + 30000;
    return fail(failures >= 5 ? 'Too many attempts. Wait 30 seconds.' : 'Incorrect PIN.');
  }
  async function submit(kind, pin, confirmation) {
    if (busy) return fail('Please wait for the current PIN check.');
    const remaining = retryAfter();
    if (remaining) return fail('Please wait before trying again.', remaining);
    busy = true;
    try {
      const saved = inspect();
      if (saved.kind === 'protected') return fail(saved.reason);
      if (kind === 'setup') {
        if (saved.kind !== 'missing') return fail('A PIN is already saved. Enter that PIN.');
        if (!validPin(pin)) return fail('Use 4–8 digits for your PIN.');
        if (pin !== confirmation) return fail('The PINs do not match.');
        const salt = new Uint8Array(16);
        saved.provider.getRandomValues(salt);
        const verifier = await derive(saved.provider, pin, salt);
        const serialized = JSON.stringify({schemaVersion:1, kdf:'PBKDF2-SHA256', iterations:ITERATIONS,
          salt:hex(salt), verifier:hex(verifier)});
        // Another tab/gate may have completed setup during the derivation.
        const latest = read();
        if (latest.kind !== 'missing') return fail('A saved PIN appeared during setup. Reopen the menu.');
        latest.storage.setItem(KEY, serialized);
        if (latest.storage.getItem(KEY) !== serialized) return fail('The PIN could not be confirmed saved. Reopen the menu.');
      } else {
        if (saved.kind !== 'ready') return fail('No PIN has been saved. Reopen the menu to create one.');
        if (!validPin(pin)) return wrongPin();
        const actual = await derive(saved.provider, pin, unhex(saved.record.salt));
        if (read().raw !== saved.raw) return fail('The saved PIN changed. Reopen the menu.');
        const expected = unhex(saved.record.verifier);
        let difference = 0;
        for (let i = 0; i < 32; i++) difference |= actual[i] ^ expected[i];
        if (difference !== 0) return wrongPin();
      }
      failures = 0; blockedUntil = 0;
      return {ok:true};
    } catch { return fail(unavailable); }
    finally { busy = false; }
  }
  return {
    status() {
      try {
        const {kind, reason} = inspect();
        return {kind, reason, retryAfterMs:retryAfter()};
      } catch { return {kind:'unavailable', reason:unavailable, retryAfterMs:retryAfter()}; }
    },
    setup:(pin, confirmation) => submit('setup', pin, confirmation),
    verify:pin => submit('verify', pin),
  };
}
