import { Input } from '../../src/input.js';

export class InputElement extends EventTarget {
  constructor() { super(); this.style = {}; this.dataset = {}; this.children = []; this.hidden = false; this.disabled = false; this.offsetWidth = 100; this.classList = { toggle() {} }; }
  setPointerCapture() {}
  getContext() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setAttribute(key, value) { this[key] = String(value); }
  append(...items) { this.children.push(...items); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text || ''; }
  replaceChildren(...items) { this.children = items; }
  querySelector() { return this.label ||= new InputElement(); }
  focus() { globalThis.document.activeElement = this; }
}

export function createInputFixture(onPause = () => {}) {
  const previous = Object.fromEntries(['document', 'window'].map(key => [key, globalThis[key]]));
  const buttons = new Map();
  const window = new EventTarget(), document = new EventTarget();
  document.getElementById = id => { if (!buttons.has(id)) buttons.set(id, new InputElement()); return buttons.get(id); };
  document.createElement = () => new InputElement();
  document.querySelectorAll = selector => [...buttons.values()].filter(element => selector === '[data-weapon]' ? !!element.dataset.weapon : selector === '[data-equipment-tab]' ? !!element.dataset.equipmentTab : false);
  globalThis.document = document; globalThis.window = window;
  const input = new Input(onPause);
  return { input, buttons, window, document, restore() { for (const key of Object.keys(previous)) if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } };
}
