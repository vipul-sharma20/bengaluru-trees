import test from 'node:test';
import assert from 'node:assert/strict';
import { embedParentOrigin } from '../src/embed.js';

test('embed height messages target the production blog or an explicit secure or local origin', () => {
  assert.equal(embedParentOrigin('?embed=1'), 'https://vipul.xyz');
  assert.equal(embedParentOrigin('?embed=1&parentOrigin=https%3A%2F%2Freview.onamp.dev'), 'https://review.onamp.dev');
  for (const origin of ['http://localhost:8080', 'http://127.0.0.1:3000', 'http://[::1]:3000',
    'http://192.168.1.7:3000', 'http://10.0.0.0', 'http://10.255.255.255',
    'http://172.16.0.0', 'http://172.31.255.255', 'http://192.168.0.0', 'http://192.168.255.255',
    'http://[fc00::]', 'http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]:3000']) {
    assert.equal(embedParentOrigin(`?embed=1&parentOrigin=${encodeURIComponent(origin)}`), origin, origin);
  }
});

test('invalid parent origins disable height messages rather than using a wildcard', () => {
  for (const origin of ['', '*', 'null', 'javascript:alert(1)', 'https://example.com/path',
    'https://example.com/', 'https://user@example.com', 'http://example.com',
    'http://9.255.255.255', 'http://11.0.0.0', 'http://172.15.255.255', 'http://172.32.0.0',
    'http://192.167.255.255', 'http://192.169.0.0', 'http://169.254.1.7', 'http://0.0.0.0',
    'http://224.0.0.1', 'http://[fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]', 'http://[fe00::]',
    'http://[fe80::1]', 'http://[::]', 'http://[::ffff:c0a8:107]',
    'http://192.168.1.7:3000/', 'http://user@192.168.1.7:3000', 'http://192.168.1.7#fragment',
    'http://192.168.1.7?query=1', 'http://192.168.1.7:65536', 'http://192.168.1.256',
    'http://192.168.1', 'http://0xc0a80107', 'http://192.168.1.7.evil.example', 'http://10.foo.bar.baz',
    'ftp://192.168.1.7', '//192.168.1.7', 'http://[FD00::1]', 'http://[fd00:0:0:0:0:0:0:1]']) {
    assert.equal(embedParentOrigin(`?embed=1&parentOrigin=${encodeURIComponent(origin)}`), null, origin);
  }
});

let embedImport = 0;
async function heightReporter(t, { search = '?embed=1', sameWindow = false } = {}) {
  const messages = [];
  const timers = [];
  const listeners = new Map();
  const observers = [];
  let bottom = 400.2;
  const element = {
    getBoundingClientRect() {
      return { bottom };
    },
  };
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const window = {
    location: { search }, scrollY: 10, parent,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
  };
  if (sameWindow) window.parent = window;
  class Observer {
    constructor(callback) { observers.push(callback); }
    observe() {}
  }
  const globals = {
    window,
    document: { documentElement: { classList: { add() {} } } },
    ResizeObserver: Observer,
    MutationObserver: Observer,
    setTimeout(callback) { timers.push(callback); return timers.length; },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  const { reportEmbedHeight } = await import(`../src/embed.js?height-test=${++embedImport}`);
  reportEmbedHeight(element);
  return {
    messages, listeners, observers, window,
    set bottom(value) { bottom = value; },
    flush() { for (const callback of timers.splice(0)) callback(); },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
    request(event = {}) {
      this.dispatch('message', {
        source: parent, origin: embedParentOrigin(search),
        data: { type: 'tree-census:request-resize' }, ...event,
      });
    },
  };
}

test('parent resize requests resend the same public height after the initial notification', async (t) => {
  const reporter = await heightReporter(t);
  reporter.flush();
  assert.deepEqual(reporter.messages, [{
    data: { type: 'tree-census:resize', height: 411 }, origin: 'https://vipul.xyz',
  }]);
  reporter.request();
  assert.equal(reporter.messages.length, 1, 'requests use the scheduled timer');
  reporter.flush();
  assert.equal(reporter.messages.length, 2);
  assert.deepEqual(reporter.messages[1], reporter.messages[0]);
});

test('resize requests measure the latest height at timer delivery instead of replaying a value', async (t) => {
  const reporter = await heightReporter(t, {
    search: '?embed=1&parentOrigin=http%3A%2F%2F192.168.1.7%3A3000',
  });
  reporter.flush();
  reporter.request();
  reporter.bottom = 725.3;
  reporter.window.scrollY = 20;
  reporter.flush();
  assert.equal(reporter.messages.length, 2);
  assert.deepEqual(reporter.messages[1], {
    data: { type: 'tree-census:resize', height: 746 }, origin: 'http://192.168.1.7:3000',
  });
});

test('requests coalesce with observers in either order without making ordinary notifications repeat', async (t) => {
  const reporter = await heightReporter(t);
  reporter.flush();
  for (const requestFirst of [false, true]) {
    const previous = reporter.messages.length;
    if (requestFirst) reporter.request();
    for (const notify of reporter.observers) notify();
    reporter.dispatch('resize');
    reporter.request();
    reporter.request();
    reporter.flush();
    assert.equal(reporter.messages.length, previous + 1);
    assert.deepEqual(reporter.messages.at(-1), {
      data: { type: 'tree-census:resize', height: 411 }, origin: 'https://vipul.xyz',
    });
    for (const notify of reporter.observers) notify();
    reporter.dispatch('resize');
    reporter.flush();
    assert.equal(reporter.messages.length, previous + 1, 'forced reporting resets after delivery');
  }
  reporter.bottom = 500;
  for (const notify of reporter.observers) notify();
  reporter.flush();
  assert.deepEqual(reporter.messages.at(-1), {
    data: { type: 'tree-census:resize', height: 510 }, origin: 'https://vipul.xyz',
  });
  assert.equal(reporter.messages.length, 4);
});

test('requests during the initial scheduled measurement produce only one response', async (t) => {
  const reporter = await heightReporter(t);
  reporter.request();
  for (const notify of reporter.observers) notify();
  reporter.flush();
  assert.deepEqual(reporter.messages, [{
    data: { type: 'tree-census:resize', height: 411 }, origin: 'https://vipul.xyz',
  }]);
});

test('wrong request sources, origins and message types are ignored', async (t) => {
  const reporter = await heightReporter(t, {
    search: '?embed=1&parentOrigin=https%3A%2F%2Freview.onamp.dev',
  });
  reporter.flush();
  for (const event of [
    { source: {} }, { source: reporter.window }, { source: null },
    { origin: 'https://vipul.xyz' }, { origin: 'https://evil.example' }, { origin: 'null' },
    { data: null }, { data: 'tree-census:request-resize' }, { data: {} },
    { data: { type: 'tree-census:resize' } }, { data: { type: 'other' } },
  ]) {
    reporter.request(event);
    reporter.flush();
    assert.deepEqual(reporter.messages, [{
      data: { type: 'tree-census:resize', height: 411 }, origin: 'https://review.onamp.dev',
    }]);
  }
  reporter.request();
  reporter.flush();
  assert.equal(reporter.messages.length, 2, 'the exact configured parent is accepted');
  assert.deepEqual(reporter.messages[1], reporter.messages[0]);
});

test('standalone, same-window and invalid-origin pages do not install height reporting listeners', async (t) => {
  for (const options of [
    { search: '' }, { search: '?embed=0' }, { sameWindow: true },
    { search: '?embed=1&parentOrigin=*' },
    { search: '?embed=1&parentOrigin=http%3A%2F%2Fexample.com' },
  ]) {
    await t.test(JSON.stringify(options), async (t) => {
      const reporter = await heightReporter(t, options);
      assert.equal(reporter.listeners.has('message'), false);
      reporter.request();
      reporter.flush();
      assert.deepEqual(reporter.messages, []);
    });
  }
});
