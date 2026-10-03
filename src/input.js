export class Input {
  constructor(onPause) {
    this.enabled = false;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.fire = false;
    this.firePressed = false;
    this.jump = false;
    this.reload = false;
    this.zoom = false;
    this.knifePressed = this.throwPressed = this.grenadePickerPressed = false;
    this.pointers = new Map();
    const stick = document.getElementById('joystick');
    this.knob = document.getElementById('joystick-knob');
    let stickPointer = null;
    const updateStick = e => {
      const bounds = stick.getBoundingClientRect();
      const radius = bounds.width * .34;
      let dx = e.clientX - (bounds.left + bounds.width / 2);
      let dy = e.clientY - (bounds.top + bounds.height / 2);
      const length = Math.hypot(dx, dy);
      if (length > radius) { dx *= radius / length; dy *= radius / length; }
      this.move.x = dx / radius; this.move.y = -dy / radius;
      this.knob.style.transform = `translate(${dx / (bounds.width / stick.offsetWidth)}px,${dy / (bounds.width / stick.offsetWidth)}px)`;
    };
    stick.addEventListener('pointerdown', e => {
      if (!this.enabled || stickPointer !== null) return;
      e.preventDefault(); stickPointer = e.pointerId; stick.setPointerCapture(e.pointerId); updateStick(e);
    });
    stick.addEventListener('pointermove', e => { if (this.enabled && e.pointerId === stickPointer) updateStick(e); });
    const stopStick = e => {
      if (e.pointerId !== stickPointer) return;
      stickPointer = null; this.move.x = this.move.y = 0; this.knob.style.transform = '';
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(event, stopStick);
    stick.addEventListener('pointercancel', () => this.clear());
    for (const id of ['aim-zone', 'fire-button']) {
      const element = document.getElementById(id);
      element.addEventListener('pointerdown', e => {
        if (!this.enabled) return;
        e.preventDefault(); element.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, fire: id === 'fire-button' });
        if (id === 'fire-button') { this.fire = true; this.firePressed = true; }
      });
      element.addEventListener('pointermove', e => {
        const last = this.pointers.get(e.pointerId);
        if (!last || !this.enabled) return;
        this.look.x += e.clientX - last.x; this.look.y += e.clientY - last.y;
        last.x = e.clientX; last.y = e.clientY;
      });
      const release = e => {
        this.pointers.delete(e.pointerId);
        this.fire = this.keys.has('KeyF') || [...this.pointers.values()].some(p => p.fire);
      };
      element.addEventListener('pointerup', release);
      for (const event of ['pointercancel', 'lostpointercapture']) element.addEventListener(event, e => {
        if (event === 'pointercancel' || this.pointers.has(e.pointerId)) this.clear();
      });
    }
    for (const [id, action] of [['jump-button', 'jump'], ['reload-button', 'reload']]) {
      document.getElementById(id).addEventListener('pointerdown', e => {
        if (this.enabled && !e.currentTarget.disabled) { e.preventDefault(); this[action] = true; }
      });
    }
    for (const [id, action] of [['knife-button', 'knifePressed'], ['throw-button', 'throwPressed'], ['grenade-type-button', 'grenadePickerPressed']]) {
      const button = document.getElementById(id);
      button.addEventListener('pointerdown', e => { if (this.enabled && !button.disabled) { e.preventDefault(); button.setPointerCapture(e.pointerId); this[action] = true; } });
      button.addEventListener('pointercancel', () => this.clear());
    }
    document.getElementById('zoom-button').addEventListener('click', () => { if (this.enabled) this.zoom = !this.zoom; });
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') { onPause(); return; }
      if (!this.enabled) return;
      if (['KeyW','KeyA','KeyS','KeyD','KeyF','KeyR','Space','KeyE','KeyQ','KeyG','KeyT','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
      const fresh = !e.repeat && !this.keys.has(e.code);
      this.keys.add(e.code);
      if (fresh && e.code === 'KeyQ') this.knifePressed = true;
      if (fresh && e.code === 'KeyG') this.throwPressed = true;
      if (fresh && e.code === 'KeyT') this.grenadePickerPressed = true;
      if (e.code === 'KeyF') { this.fire = true; if (!e.repeat) this.firePressed = true; }
      if (e.code === 'KeyR' && !e.repeat) this.reload = true;
      if (e.code === 'Space' && !e.repeat) this.jump = true;
      if (e.code === 'KeyE' && !e.repeat) this.zoom = !this.zoom;
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'KeyF') this.fire = [...this.pointers.values()].some(p => p.fire); });
    window.addEventListener('blur', () => { stickPointer = null; this.clear(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    document.addEventListener('pointercancel', () => this.clear());
    this.resetStick = () => { stickPointer = null; };
  }
  clear() {
    this.keys.clear(); this.pointers.clear(); this.fire = this.firePressed = this.jump = this.reload = this.zoom = false;
    this.knifePressed = this.throwPressed = this.grenadePickerPressed = false;
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
    this.knob.style.transform = ''; if (this.resetStick) this.resetStick();
  }
  setEnabled(value) { this.enabled = value; if (!value) this.clear(); }
  read() {
    let x = this.move.x + Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    let y = this.move.y + Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    const result = { x, y, lookX: this.look.x, lookY: this.look.y, fire: this.fire || this.firePressed, firePressed: this.firePressed, jump: this.jump, reload: this.reload, zoom: this.zoom, knifePressed: this.knifePressed, throwPressed: this.throwPressed, grenadePickerPressed: this.grenadePickerPressed };
    this.look.x = this.look.y = 0; this.jump = this.reload = this.firePressed = false;
    this.knifePressed = this.throwPressed = this.grenadePickerPressed = false;
    return result;
  }
}
