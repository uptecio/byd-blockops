import assert from 'node:assert/strict';

// Minimal DOM boundary for EquipmentUI; equipment/game/network behavior stays real.
class Element extends EventTarget {
  constructor(document) {
    super(); this.document = document; this.dataset = {}; this.style = {}; this.children = [];
    this.hidden = false; this.disabled = false; this.scrollLeft = 0; this.className = '';
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name); this.className = [...names].join(' ');
    } };
  }
  get firstChild() { return this.children[0] || null; }
  set textContent(value) { this.text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  append(...items) { for (const item of items) this.appendChild(item); }
  appendChild(item) { return this.insertBefore(item, null); }
  insertBefore(item, before) {
    if (item === before) return item;
    if (item.parentNode?.children) item.parentNode.removeChild(item);
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, item); item.parentNode = this; return item;
  }
  removeChild(item) { this.children.splice(this.children.indexOf(item), 1); item.parentNode = null; return item; }
  contains(item) { return item === this || this.children.some(child => child.contains(item)); }
  matches(selector) {
    if (selector[0] === '.') return this.className.split(' ').includes(selector.slice(1));
    const match = /^\[data-([a-z-]+)\]$/.exec(selector);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return this.dataset[key] !== undefined;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest?.(selector) || null; }
  querySelector(selector) {
    for (const child of this.children) { if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; }
    if (selector === 'small' || selector === '.weapon-type') {
      const label = new Element(this.document); label.className = selector.slice(1); this.append(label); return label;
    }
    return null;
  }
  focus() { this.document.activeElement = this; }
  getContext() { return null; }
}

export function createInventoryDOM(t) {
  const previous = globalThis.document;
  const document = new EventTarget(), elements = new Map();
  document.getElementById = id => {
    if (!elements.has(id)) { const element = new Element(document); element.id = id; element.parentNode = document; elements.set(id, element); }
    return elements.get(id);
  };
  document.createElement = () => new Element(document);
  document.querySelectorAll = selector => [...elements.values()].filter(element => element.matches(selector));
  globalThis.document = document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const slots = document.getElementById('inventory-slots');
  function send(target, type, values = {}) {
    assert.ok(target, `The ${type} target must exist`);
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    Object.assign(event, { pointerId: 1, clientX: 20, clientY: 20, detail: 1 }, values);
    for (let node = target; node; node = node.parentNode) node.dispatchEvent(event);
    return event;
  }
  function slot(key) { return slots.children.find(button => button.dataset.inventoryKey === key); }
  function tap(key) {
    const button = slot(key); assert.ok(button, `Inventory must render the owned entry ${key}`);
    send(button, 'pointerdown'); send(button, 'pointerup'); send(button, 'click'); return button;
  }
  return { document, elements, slots, slot, tap, send };
}
