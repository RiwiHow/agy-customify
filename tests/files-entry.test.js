import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/injections/files-entry.js', import.meta.url), 'utf8');
function setup() {
  const listeners = new Map(), observers = [], opened = [];
  const label = { textContent: 'Open File' };
  const button = { querySelector: () => label };
  const document = {
    body: {},
    querySelectorAll: () => [button],
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const window = { __agyNativeFiles: { context: el => ({ open: () => opened.push(el) }) } };
  const sandbox = vm.createContext({ window, document, console, MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  } });
  vm.runInContext(source, sandbox);
  function click(target = button) {
    const event = {
      target: { closest: () => target },
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    listeners.get('click')(event);
    return event;
  }
  return { sandbox, window, listeners, observers, opened, label, button, click };
}

test('Files entry opens native Files and blocks the original file picker, including nested targets', () => {
  const s = setup();
  assert.equal(s.label.textContent, 'Files');
  const event = s.click();
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.deepEqual(s.opened, [s.button]);
});

test('unrelated and disabled buttons retain their behavior', () => {
  const s = setup();
  assert.equal(s.click(null).prevented, undefined);
  s.button.disabled = true;
  assert.equal(s.click().prevented, undefined);
  assert.equal(s.opened.length, 0);
});

test('rerender and reinjection keep a single working handler', () => {
  const s = setup();
  s.label.textContent = 'Open File';
  s.observers[0].callback();
  assert.equal(s.label.textContent, 'Files');
  vm.runInContext(source, s.sandbox);
  assert.equal(s.observers[0].disconnected, true);
  s.click();
  assert.equal(s.opened.length, 1);
  s.window.__agyFilesEntry.dispose();
  assert.equal(s.listeners.has('click'), false);
});
