import { Input } from '../../src/input.js';

export class InputElement extends EventTarget {
  constructor() { super(); this.style = {}; this.dataset = {}; this.children = []; this.parentNode = null; this.hidden = false; this.disabled = false; this.offsetWidth = 100; this.classList = { toggle() {} }; }
  setPointerCapture() {}
  getContext() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setAttribute(key, value) { this[key] = String(value); }
  append(...items) { for (const item of items) this.insertBefore(item, null); }
  insertBefore(item, reference) {
    if (item === reference) return item;
    if (item.parentNode) item.parentNode.removeChild(item);
    const index = reference === null ? this.children.length : this.children.indexOf(reference);
    if (index < 0) throw new Error('Reference node is not a child');
    this.children.splice(index, 0, item); item.parentNode = this; return item;
  }
  removeChild(item) {
    const index = this.children.indexOf(item);
    if (index < 0) throw new Error('Node is not a child');
    this.children.splice(index, 1); item.parentNode = null; return item;
  }
  set textContent(value) { this.text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; }
  get textContent() { return this.text || ''; }
  replaceChildren(...items) { this.textContent = ''; this.append(...items); }
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
