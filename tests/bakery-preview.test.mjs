import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../previews/bambis-bakery.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../previews/bambis-bakery.css', import.meta.url), 'utf8');

function setup({ readyState = 'complete', reduced = false, hasCake = true } = {}) {
  const events = new Map();
  const documentEvents = new Map();
  const frames = new Map();
  const properties = new Map();
  const classes = new Set();
  let motionChange;
  let nextFrame = 0;
  const preference = { matches: reduced, addEventListener: (_name, listener) => { motionChange = listener; } };
  const window = {
    scrollY: 100,
    matchMedia: () => preference,
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name, listener) => { if (events.get(name) === listener) events.delete(name); },
    requestAnimationFrame: listener => { frames.set(++nextFrame, listener); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id)
  };
  const document = {
    readyState,
    body: { classList: { add: name => classes.add(name) } },
    querySelector: () => hasCake ? { style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name) } } : null,
    addEventListener: (name, listener) => documentEvents.set(name, listener)
  };
  vm.runInNewContext(source, { window, document });
  return { events, documentEvents, frames, properties, classes, window, preference, changeMotion: () => motionChange(), flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(listener => listener()); } };
}

test('cake is visible before script enhancement', () => {
  const rule = css.match(/\.b-cake\{([^}]+)\}/)[1];
  assert.match(rule, /opacity:1/);
  assert.doesNotMatch(css, /opacity:0/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('enhances an already-ready document without replacing its transform', () => {
  const state = setup();
  assert.ok(state.classes.has('ready'));
  state.flush();
  assert.equal(state.properties.get('--cake-scroll-rotation'), '3.5000000000000004deg');
  state.window.scrollY = 200;
  state.events.get('scroll')();
  state.events.get('scroll')();
  assert.equal(state.frames.size, 1);
  state.flush();
  assert.equal(Number.parseFloat(state.properties.get('--cake-scroll-rotation')), 7.000000000000001);
  assert.doesNotMatch(source, /style\.transform\s*=/);
});

test('waits for DOM readiness when needed and tolerates a missing cake', () => {
  const state = setup({ readyState: 'loading' });
  assert.equal(state.classes.size, 0);
  state.documentEvents.get('DOMContentLoaded')();
  assert.ok(state.classes.has('ready'));
  assert.equal(setup({ hasCake: false }).events.size, 0);
});

test('reduced motion disables scroll work and responds to preference changes', () => {
  const state = setup({ reduced: true });
  assert.equal(state.events.size, 0);
  assert.equal(state.frames.size, 0);
  state.preference.matches = false;
  state.changeMotion();
  assert.ok(state.events.has('scroll'));
  state.flush();
  assert.ok(state.properties.has('--cake-scroll-rotation'));
  state.events.get('scroll')();
  state.preference.matches = true;
  state.changeMotion();
  assert.equal(state.events.size, 0);
  assert.equal(state.frames.size, 0);
  assert.equal(state.properties.size, 0);
});
