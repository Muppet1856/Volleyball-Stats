import { VolleyballStatsDurableObject } from '../durable/volleyball-stats.js';

const BINDING_CANDIDATES = [
  'VOLLEYBALL_STATS_DO',
  'VOLLEYBALL_STATS_DURABLE_OBJECT',
  'VOLLEYBALL_STATS',
  'volleyballStatsDO',
  'volleyball_stats_do',
  'statsDo'
];

let inMemoryStub;

function getBinding(env) {
  for (const name of BINDING_CANDIDATES) {
    if (env && env[name]) {
      return env[name];
    }
  }
  return undefined;
}

export function getStatsDurableObjectStub(env) {
  const binding = getBinding(env);

  if (!binding) {
    return getInMemoryStub();
  }

  if (typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') {
    throw new Error('Configured Durable Object binding does not provide idFromName()/get().');
  }

  const id = binding.idFromName('primary');
  return binding.get(id);
}

export async function callStatsDurableObject(env, path, init = {}) {
  const stub = getStatsDurableObjectStub(env);
  const urlPath = path.startsWith('/') ? path : `/${path}`;
  const requestInit = { ...init };
  const headers = new Headers(init.headers || {});

  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body === 'string') {
      requestInit.body = init.body;
    } else {
      requestInit.body = JSON.stringify(init.body);
    }
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  if (headers.size > 0) {
    requestInit.headers = headers;
  }

  return stub.fetch(`https://volleyball-stats.internal${urlPath}`, requestInit);
}

function getInMemoryStub() {
  if (!inMemoryStub) {
    inMemoryStub = createInMemoryStub();
  }
  return inMemoryStub;
}

function createInMemoryStub() {
  const state = new InMemoryDurableObjectState();
  const durableObject = new VolleyballStatsDurableObject(state, {});

  return {
    fetch(input, init = {}) {
      if (input instanceof Request) {
        return durableObject.fetch(input);
      }
      return durableObject.fetch(new Request(input, init));
    }
  };
}

function cloneValue(value) {
  if (value === undefined) {
    return value;
  }

  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch (error) {
      // Fallback to JSON cloning below
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

class InMemoryDurableObjectState {
  constructor() {
    this.storage = new InMemoryStorage();
    this._pending = Promise.resolve();
  }

  blockConcurrencyWhile(callback) {
    const run = async () => callback();
    this._pending = this._pending.then(run, run);
    return this._pending;
  }
}

class InMemoryStorage {
  constructor() {
    this._data = new Map();
  }

  async get(key) {
    return cloneValue(this._data.get(key));
  }

  async put(key, value) {
    this._data.set(key, cloneValue(value));
  }
}
