import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../previews/wedding-invitation.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../previews/wedding-invitation.css', import.meta.url), 'utf8');

function preview({ readyState = 'complete', reduced = false, hasFrame = true, hasMatchMedia = true } = {}) {
  const classes = new Set();
  const events = {};
  const preference = { matches: reduced, addEventListener(name, handler) { events[name] = handler; } };
  const orbit = { style: { removeProperty(name) { delete this[name]; } } };
  const frame = { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } };
  const window = { scrollY: 100, addEventListener(name, handler) { events[name] = handler; } };
  if (hasMatchMedia) window.matchMedia = () => preference;
  const document = {
    readyState,
    querySelector(selector) { return selector === '.w-frame' ? hasFrame && frame : orbit; },
    addEventListener(name, handler, options) { events[name] = handler; events[`${name}Options`] = options; }
  };
  runInNewContext(script, { window, document });
  return { classes, events, preference, orbit, window };
}

test('invitation content is visible before JavaScript enhancement', () => {
  const frame = css.match(/\.w-frame\{([^}]+)\}/)?.[1];
  assert.ok(frame);
  assert.match(frame, /(?:^|;)opacity:1(?:;|$)/);
  assert.match(frame, /(?:^|;)transform:none(?:;|$)/);
  assert.doesNotMatch(css, /\.ready\s+\.w-frame/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test('enhancement starts immediately when DOMContentLoaded has already fired', () => {
  const state = preview();
  assert.ok(state.classes.has('w-frame-enter'));
  assert.equal(state.orbit.style.transform, 'rotate(12deg)');
  assert.equal(state.events.DOMContentLoaded, undefined);
});

test('enhancement waits for a loading document without hiding its content', () => {
  const state = preview({ readyState: 'loading' });
  assert.equal(state.classes.size, 0);
  assert.equal(state.events.DOMContentLoadedOptions.once, true);
  state.events.DOMContentLoaded();
  assert.ok(state.classes.has('w-frame-enter'));
});

test('reduced motion disables entry and scroll effects, including preference changes', () => {
  const state = preview({ reduced: true });
  assert.equal(state.classes.size, 0);
  state.events.scroll();
  assert.equal(state.orbit.style.transform, undefined);
  state.preference.matches = false;
  state.events.change();
  assert.ok(state.classes.has('w-frame-enter'));
  assert.equal(state.orbit.style.transform, 'rotate(12deg)');
  state.preference.matches = true;
  state.events.change();
  assert.equal(state.classes.size, 0);
  assert.equal(state.orbit.style.transform, undefined);
});

test('missing optional capabilities or elements leave a visible static invitation', () => {
  assert.equal(preview({ hasMatchMedia: false }).classes.size, 0);
  assert.equal(preview({ hasFrame: false }).classes.size, 0);
});
