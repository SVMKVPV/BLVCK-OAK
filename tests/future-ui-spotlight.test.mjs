import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../future-ui.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../future-ui.css', import.meta.url), 'utf8');

const dataName = (attribute) => attribute
  .slice(5)
  .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

class ClassList {
  #names = new Set();

  set value(value) {
    this.#names = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  add(...names) { names.forEach((name) => this.#names.add(name)); }
  remove(...names) { names.forEach((name) => this.#names.delete(name)); }
  contains(name) { return this.#names.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : force;
    if (enabled) this.add(name);
    else this.remove(name);
    return enabled;
  }
}

class StyleDeclaration {
  #properties = new Map();

  setProperty(name, value) { this.#properties.set(name, value); }
  removeProperty(name) { this.#properties.delete(name); }
  getPropertyValue(name) { return this.#properties.get(name) || ''; }
}

function selectorMatches(element, selector) {
  return selector.split(',').some((part) => {
    const token = part.trim();
    if (!token || token === ':popover-open') return false;
    if (token === ':disabled') return Boolean(element.disabled);
    if (token === ':focus-within') return Boolean(element.focusWithin);

    const tag = token.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && element.tagName !== tag.toUpperCase()) return false;

    const className = token.match(/^\.([\w-]+)/)?.[1];
    if (className && !element.classList.contains(className)) return false;

    for (const match of token.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const [, name, value] = match;
      if (!element.hasAttribute(name)) return false;
      if (value !== undefined && element.getAttribute(name) !== value) return false;
    }

    return Boolean(tag || className || token.startsWith('['));
  });
}

class FakeElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.classList = new ClassList();
    this.style = new StyleDeclaration();
    this.isConnected = false;
    this.disabled = false;
    this.focusWithin = false;
    this.bounds = { left: 0, top: 0, width: 100, height: 100 };
    this.listeners = new Map();
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
  }

  set className(value) { this.classList.value = value; }
  get className() { return ''; }

  setAttribute(name, value = '') {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === 'class') this.classList.value = text;
    if (name.startsWith('data-')) this.dataset[dataName(name)] = text;
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      child.setConnected(this.isConnected);
      this.children.push(child);
    }
  }

  setConnected(connected) {
    this.isConnected = connected;
    this.children.forEach((child) => child.setConnected(connected));
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    this.parentElement = null;
    this.setConnected(false);
  }

  matches(selector) { return selectorMatches(this, selector); }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  getBoundingClientRect() { return this.bounds; }
}

class FakeButton extends FakeElement {
  constructor(attributes = {}) { super('button', attributes); }
}

class FakeIFrame extends FakeElement {
  constructor(attributes = {}) { super('iframe', attributes); }
}

class MediaQuery {
  constructor(matches = false) {
    this.matches = matches;
    this.listeners = [];
  }

  addEventListener(name, listener) {
    if (name === 'change') this.listeners.push(listener);
  }

  change(matches) {
    this.matches = matches;
    this.listeners.forEach((listener) => listener({ matches }));
  }
}

class Observer {
  constructor(callback) { this.callback = callback; }
  observe() {}
  disconnect() {}
}

function setup() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const frames = new Map();
  let frameId = 0;

  const body = new FakeElement('body', { 'data-future-ui': '' });
  body.setConnected(true);
  const eligible = new FakeButton({ 'data-future-card': '', 'data-future-cursor': 'Choose' });
  eligible.bounds = { left: 100, top: 20, width: 200, height: 120 };
  const secondEligible = new FakeElement('article', { class: 'portfolio-card' });
  const formCard = new FakeElement('article', { 'data-future-card': '' });
  formCard.append(new FakeElement('form'));
  const effectsOff = new FakeElement('section', { 'data-future-effects': 'off' });
  const optedOutCard = new FakeElement('article', { 'data-future-card': '' });
  effectsOff.append(optedOutCard);
  const motionToggle = new FakeButton({ 'data-motion-toggle': '' });
  motionToggle.append(new FakeElement('span', { 'data-motion-label': '' }));
  body.append(eligible, secondEligible, formCard, effectsOff, motionToggle);

  const media = {
    reduced: new MediaQuery(false),
    fine: new MediaQuery(true),
    forced: new MediaQuery(false),
  };
  const mediaFor = (query) => {
    if (query.includes('prefers-reduced-motion')) return media.reduced;
    if (query.includes('forced-colors')) return media.forced;
    return media.fine;
  };
  const addListener = (store) => (name, listener) => {
    const listeners = store.get(name) || [];
    listeners.push(listener);
    store.set(name, listeners);
  };
  const document = {
    body,
    hidden: false,
    createElement(tagName) { return tagName === 'button' ? new FakeButton() : new FakeElement(tagName); },
    querySelector(selector) { return body.querySelector(selector); },
    addEventListener: addListener(documentListeners),
  };
  const window = {
    matchMedia: mediaFor,
    addEventListener: addListener(windowListeners),
    dispatchEvent() {},
    getSelection: () => ({ isCollapsed: true }),
  };
  const context = {
    AbortController,
    CustomEvent,
    Element: FakeElement,
    HTMLButtonElement: FakeButton,
    HTMLIFrameElement: FakeIFrame,
    MutationObserver: Observer,
    cancelAnimationFrame(id) { frames.delete(id); },
    document,
    getComputedStyle: () => ({ getPropertyValue: (name) => name === '--future-cursor-enabled' ? '1' : '' }),
    innerHeight: 800,
    requestAnimationFrame(listener) { frames.set(++frameId, listener); return frameId; },
    sessionStorage: { getItem: () => null, setItem() {} },
    window,
  };

  const dispatch = (store, name, event = {}) => {
    for (const listener of store.get(name) || []) listener(event);
  };
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((listener) => listener());
  };

  runInNewContext(source, context);
  return {
    body,
    context,
    documentListeners,
    eligible,
    formCard,
    optedOutCard,
    secondEligible,
    frames,
    media,
    dispatchDocument: (name, event) => dispatch(documentListeners, name, event),
    flushFrames,
  };
}

test('registers eligible spotlight cards once while preserving opt-outs', () => {
  const state = setup();

  assert.equal(state.documentListeners.get('pointermove')?.length, 1, 'one document listener serves every card');
  for (const card of [state.eligible, state.secondEligible]) {
    const lights = card.querySelectorAll('.future-card-light');
    assert.equal(lights.length, 1);
    assert.equal(lights[0].getAttribute('aria-hidden'), 'true');
  }
  assert.equal(state.formCard.querySelectorAll('.future-card-light').length, 0, 'cards containing forms stay unmodified');
  assert.equal(state.optedOutCard.querySelectorAll('.future-card-light').length, 0, 'effects-off ancestors are respected');

  runInNewContext(source, state.context);
  assert.equal(state.documentListeners.get('pointermove')?.length, 1, 'a second load does not register another global listener');
  assert.equal(state.eligible.querySelectorAll('.future-card-light').length, 1, 'a second load does not duplicate the light');
});

test('updates local spotlight coordinates in one frame and resets for focus or reduced motion', () => {
  const state = setup();
  const move = { pointerType: 'mouse', clientX: 150, clientY: 80, target: state.eligible };

  state.dispatchDocument('pointermove', move);
  state.dispatchDocument('pointermove', move);
  assert.equal(state.frames.size, 1, 'pointer work is coalesced into one animation frame');
  state.flushFrames();
  assert.equal(state.eligible.style.getPropertyValue('--future-pointer-x'), '50.0px');
  assert.equal(state.eligible.style.getPropertyValue('--future-pointer-y'), '60.0px');
  assert.equal(state.eligible.classList.contains('future-card-hover'), true);

  state.dispatchDocument('focusin', { target: state.eligible });
  assert.equal(state.eligible.classList.contains('future-card-hover'), false);
  assert.equal(state.eligible.style.getPropertyValue('--future-pointer-x'), '');
  assert.equal(state.eligible.style.getPropertyValue('--future-pointer-y'), '');

  state.dispatchDocument('pointermove', move);
  state.flushFrames();
  assert.equal(state.eligible.classList.contains('future-card-hover'), true);
  state.media.reduced.change(true);
  assert.equal(state.body.dataset.motionPaused, 'true');
  assert.equal(state.eligible.classList.contains('future-card-hover'), false);
  assert.equal(state.eligible.style.getPropertyValue('--future-pointer-x'), '');
  assert.equal(state.eligible.style.getPropertyValue('--future-pointer-y'), '');

  state.dispatchDocument('pointermove', move);
  assert.equal(state.frames.size, 0, 'reduced motion blocks further spotlight work');
});

test('scopes the stronger border trace to gold package spotlights and keeps accessibility fallbacks', () => {
  assert.match(styles, /\[data-future-card\]\[data-future-spotlight='gold'\]\s*>\s*\.future-card-light/);
  assert.match(styles, /\.future-card-light\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(styles, /-webkit-mask-composite:\s*xor/);
  assert.match(styles, /mask-composite:\s*exclude/);
  assert.match(styles, /@media \(hover:\s*none\), \(pointer:\s*coarse\)[\s\S]*?\.future-card-light\s*\{\s*display:\s*none/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.future-card-light\)\s*\{\s*display:\s*none\s*!important/);
  assert.match(styles, /@media \(forced-colors:\s*active\)[\s\S]*?\.future-card-light\s*\{\s*display:\s*none\s*!important/);
});
