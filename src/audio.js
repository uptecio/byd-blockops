export class GameAudio {
  constructor() { this.enabled = true; this.context = null; }
  unlock() {
    if (!this.enabled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!this.context && Context) this.context = new Context();
      if (this.context && this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* Audio is optional on head units. */ }
  }
  tone(frequency, duration, volume = .05, type = 'sine', slide = 1) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    const now = ctx.currentTime;
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * slide), now + duration);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(now); oscillator.stop(now + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  shoot(weapon) {
    const heavy = ['sniper', 'shotgun', 'lmg'].includes(weapon.classId);
    this.tone(heavy ? 115 : 170, heavy ? .16 : .09, heavy ? .075 : .045, 'sawtooth', .3);
    this.tone(950, .025, .025, 'square', .15);
  }
  hit() { this.tone(780, .08, .045, 'triangle', 1.5); }
  kill() { this.tone(520, .18, .07, 'triangle', 2); }
  reload() { this.tone(230, .12, .025, 'square', .5); }
  pickup() { this.tone(660, .13, .035, 'triangle', 1.6); }
  swing() { this.tone(260, .14, .025, 'sawtooth', .25); }
  zombieWave() { this.tone(150, .35, .045, 'triangle', .55); }
  zombieRecovery() { this.tone(440, .28, .035, 'triangle', 1.8); }
  grenade(type) {
    if (type === 'frag') this.tone(85, .3, .07, 'sawtooth', .25);
    else if (type === 'smoke') this.tone(180, .24, .025, 'triangle', .4);
    else if (type === 'flash') this.tone(740, .18, .025, 'sine', .6);
  }
}
