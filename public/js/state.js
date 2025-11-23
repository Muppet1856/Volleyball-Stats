// js/state.js
export let state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
  matchWins: { home: 0, opp: 0 },
  overallWinner: null,
  players: [],
  sets: {
    1: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    2: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    3: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    4: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    5: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
  },
};

const STORAGE_KEY = 'volleyball-stats-state';
const listeners = new Set();

// Mutate target in-place with source values (deep merge)
function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) return target;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (typeof source[key] === 'object' && source[key] !== null) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = Array.isArray(source[key]) ? [] : {};
        }
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  return target;
}

export function updateState(partialState) {
  deepMerge(state, partialState);
  saveStateToStorage();
  notifyListeners();
  // Optional: console.log('Updated state:', state) for debugging
}

export function subscribe(listener) {
  if (typeof listener === 'function') {
    listeners.add(listener);
  }
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach((listener) => listener(state));
}

export function loadStateFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return state;

  try {
    const parsed = JSON.parse(saved);
    deepMerge(state, parsed);
    notifyListeners();
  } catch (error) {
    console.warn('Failed to parse saved state, clearing storage.', error);
    localStorage.removeItem(STORAGE_KEY);
  }
  return state;
}

export function saveStateToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setPlayers(players) {
  if (Array.isArray(players)) {
    state.players = players.map((player) => ({
      id: player.id,
      number: player.number,
      lastName: player.lastName,
      ...(player.initial ? { initial: player.initial } : {}),
      ...(player.tempNumber ? { tempNumber: player.tempNumber } : {}),
    }));
    saveStateToStorage();
    notifyListeners();
  }
  return state.players;
}

// Expose for console debugging (keep this)
window.state = state;
window.updateState = updateState;
window.loadStateFromStorage = loadStateFromStorage;
window.saveStateToStorage = saveStateToStorage;
window.subscribeToState = subscribe;
window.setPlayers = setPlayers;

loadStateFromStorage();
