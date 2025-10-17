/** @vitest-environment jsdom */
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(projectRoot, 'public/index.html');
const scriptPath = path.join(projectRoot, 'public/js/volleyball_stats.js');

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.listeners = new Map();
    this.sentMessages = [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((item) => item !== listener)
    );
  }

  dispatch(type, detail = {}) {
    const event = { ...detail, target: this, data: detail.data };
    const list = this.listeners.get(type) || [];
    for (const listener of list) {
      listener(event);
    }
  }

  accept() {
    this.readyState = MockWebSocket.OPEN;
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch('close', { code, reason });
  }

  send(data) {
    this.sentMessages.push(data);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatch('open');
  }

  simulateMessage(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.dispatch('message', { data: payload });
  }
}

describe('live match websocket helper', () => {
  const initialMatch = {
    id: 1,
    date: '2024-05-01T19:00:00Z',
    location: 'Main Gym',
    types: { tournament: false, league: true, postSeason: false, nonLeague: false },
    opponent: 'Rivals',
    jerseyColorSC: 'blue',
    jerseyColorOpp: 'red',
    resultSC: 1,
    resultOpp: 2,
    firstServer: 'Stoney Creek',
    players: ['12 Smith'],
    sets: {
      1: { sc: '25', opp: '23', timeouts: { sc: [false, false], opp: [false, false] } }
    },
    finalizedSets: { 1: true },
    isSwapped: false
  };

  const updatedMatch = {
    ...initialMatch,
    resultSC: 2,
    resultOpp: 0,
    sets: {
      1: { sc: '26', opp: '24', timeouts: { sc: [true, false], opp: [false, false] } },
      2: { sc: '25', opp: '20', timeouts: { sc: [false, false], opp: [false, false] } }
    },
    finalizedSets: { 1: true, 2: true }
  };

  beforeEach(async () => {
    document.documentElement.innerHTML = '';
    MockWebSocket.instances = [];

    const html = await readFile(htmlPath, 'utf8');
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      document.body.innerHTML = bodyMatch[1];
    }

    const matchMediaStub = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    });
    window.matchMedia = matchMediaStub;

    window.bootstrap = {
      Modal: class {
        constructor() {}
        show() {}
        hide() {}
        handleUpdate() {}
        static getInstance() {
          return null;
        }
      },
      Popover: class {
        constructor() {}
        show() {}
        hide() {}
        static getInstance() {
          return null;
        }
      }
    };

    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);

    const mockFetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/api/players')) {
        return new Response(JSON.stringify([{ id: 1, number: '12', lastName: 'Smith', initial: 'S' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/api/matches/1')) {
        return new Response(JSON.stringify(initialMatch), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('Not Found', { status: 404 });
    });
    global.fetch = mockFetch;
    window.fetch = mockFetch;

    global.WebSocket = MockWebSocket;
    window.WebSocket = MockWebSocket;

    const scriptSource = await readFile(scriptPath, 'utf8');
    window.eval(scriptSource);

    window.history.replaceState({}, '', '/?matchId=1');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('updates the score when live updates arrive', async () => {
    expect(MockWebSocket.instances.length).toBe(1);
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe(`ws://${window.location.host}/live/1`);

    socket.simulateOpen();

    const resultSc = document.getElementById('resultSC');
    const set1Sc = document.getElementById('set1SC');
    expect(resultSc.value).toBe('1');
    expect(set1Sc.value).toBe('25');

    socket.simulateMessage({ type: 'broadcastScore', match: updatedMatch });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resultSc.value).toBe('2');
    expect(set1Sc.value).toBe('26');
  });
});
