const test = require('node:test');
const assert = require('node:assert/strict');

const noop = () => {};

function createStubElement() {
  const base = {
    style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop,
    removeChild: noop,
    replaceChildren: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: noop,
    removeAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getAttribute: () => null,
    closest: () => null,
    scrollIntoView: noop,
    parentElement: null,
    nextElementSibling: null,
    previousElementSibling: null,
    innerHTML: '',
    textContent: '',
    value: '',
    className: '',
    dataset: {},
    focus: noop
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop === Symbol.iterator) {
        return function* () {};
      }
      if (prop in target) {
        return target[prop];
      }
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return null;
      }
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

const fakeNodeList = [];
fakeNodeList.forEach = function(cb, thisArg) {
  return Array.prototype.forEach.call(this, cb, thisArg);
};

const documentStub = {
  addEventListener: noop,
  querySelectorAll: () => fakeNodeList,
  querySelector: () => null,
  getElementById: () => createStubElement(),
  createElement: () => createStubElement(),
  createDocumentFragment: () => createStubElement(),
  body: createStubElement(),
  documentElement: createStubElement()
};

global.document = documentStub;

global.bootstrap = {
  Modal: class {
    constructor() {}
    show() {}
    hide() {}
  }
};

global.window = {
  addEventListener: noop,
  removeEventListener: noop,
  location: { href: '' },
  history: { replaceState: noop },
  getComputedStyle: () => ({ backgroundColor: '#ffffff', getPropertyValue: () => '' }),
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  setTimeout,
  clearTimeout,
  document: documentStub
};

global.MutationObserver = class {
  constructor() {}
  observe() {}
  disconnect() {}
};

global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
  text: async () => '',
  headers: new Map()
});

global.localStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop
};

global.sessionStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop
};

global.navigator = { userAgent: 'node' };

global.bootstrap.Modal.prototype.toggle = noop;

global.bootstrap.Modal.prototype.dispose = noop;

const { __test__ } = require('../public/js/volleyball_stats.js');
const {
  serializeMatchPlayers,
  serializeMatchMetadata,
  parseMatchRow,
  prepareMatchForStorage
} = __test__;

test('serializeMatchPlayers returns only the roster', () => {
  const payload = serializeMatchPlayers({ players: [{ playerId: '1' }], deleted: true });
  assert.deepStrictEqual(payload, { roster: [{ playerId: '1' }] });
});

test('serializeMatchMetadata includes the deleted flag', () => {
  const metadata = serializeMatchMetadata({ types: { league: true }, deleted: true });
  assert.equal(metadata.deleted, true);
  assert.equal(metadata.league, true);
});

test('prepareMatchForStorage encodes the deleted flag in metadata JSON', () => {
  const { body } = prepareMatchForStorage({ deleted: true });
  const parsed = JSON.parse(body.types);
  assert.equal(parsed.deleted, true);
});

test('parseMatchRow prefers metadata deleted flag when present', () => {
  const row = {
    id: 1,
    date: '',
    location: '',
    types: JSON.stringify({ deleted: true }),
    opponent: '',
    jersey_color_home: '',
    jersey_color_opp: '',
    result_home: null,
    result_opp: null,
    first_server: '',
    players: JSON.stringify({ roster: [], deleted: false }),
    finalized_sets: JSON.stringify({})
  };
  const parsed = parseMatchRow(row);
  assert.equal(parsed._deleted, true);
});

test('parseMatchRow falls back to legacy players.deleted flag', () => {
  const row = {
    id: 2,
    date: '',
    location: '',
    types: JSON.stringify({ flags: { tournament: false } }),
    opponent: '',
    jersey_color_home: '',
    jersey_color_opp: '',
    result_home: null,
    result_opp: null,
    first_server: '',
    players: JSON.stringify({ roster: [], deleted: true }),
    finalized_sets: JSON.stringify({})
  };
  const parsed = parseMatchRow(row);
  assert.equal(parsed._deleted, true);
});
