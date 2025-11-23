// js/state.js
export let state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
  matchWins: { home: 0, opp: 0 },
  overallWinner: null,
  players: [],
  matchPlayers: [],
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

function sanitizeLoadedState() {
  const legacyMatchPlayers = [];

  if (!Array.isArray(state.players)) {
    state.players = [];
  }

  state.players = state.players.map((player) => {
    const base = {
      id: player.id,
      number: player.number,
      lastName: player.lastName,
      ...(player.initial ? { initial: player.initial } : {}),
    };

    const temp = player.tempNumber ?? player.temp_number;
    const parsedTemp = temp === undefined || temp === null || temp === '' ? null : Number(temp);
    if (parsedTemp !== null && !Number.isNaN(parsedTemp)) {
      legacyMatchPlayers.push({ playerId: player.id, tempNumber: parsedTemp });
    }

    return base;
  });

  if (!Array.isArray(state.matchPlayers)) {
    state.matchPlayers = [];
  }

  if (legacyMatchPlayers.length) {
    const merged = new Map(state.matchPlayers.map((entry) => [entry.playerId, entry]));
    legacyMatchPlayers.forEach((entry) => {
      if (entry.playerId) {
        merged.set(entry.playerId, entry);
      }
    });
    state.matchPlayers = Array.from(merged.values());
  }
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
    sanitizeLoadedState();
    saveStateToStorage();
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
    }));
    saveStateToStorage();
    notifyListeners();
  }
  return state.players;
}

function normalizeMatchPlayer(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const playerId = entry.playerId ?? entry.id;
  if (!playerId) return null;

  const temp = entry.tempNumber ?? entry.temp_number;
  const parsedTemp = temp === undefined || temp === null || temp === '' ? null : Number(temp);
  if (parsedTemp !== null && Number.isNaN(parsedTemp)) {
    return null;
  }

  return parsedTemp === null ? { playerId } : { playerId, tempNumber: parsedTemp };
}

export function setMatchPlayers(matchPlayers = []) {
  if (!Array.isArray(matchPlayers)) return state.matchPlayers;

  const normalized = matchPlayers
    .map(normalizeMatchPlayer)
    .filter(Boolean);

  state.matchPlayers = normalized;
  saveStateToStorage();
  notifyListeners();
  return state.matchPlayers;
}

export function upsertMatchPlayer(playerId, tempNumber = null) {
  if (!playerId) return state.matchPlayers;

  const parsedTemp = tempNumber === undefined || tempNumber === null || tempNumber === ''
    ? null
    : Number(tempNumber);
  if (parsedTemp !== null && Number.isNaN(parsedTemp)) {
    return state.matchPlayers;
  }

  const existingIndex = state.matchPlayers.findIndex((entry) => entry.playerId === playerId);
  const entry = parsedTemp === null ? { playerId } : { playerId, tempNumber: parsedTemp };

  if (existingIndex >= 0) {
    state.matchPlayers[existingIndex] = entry;
  } else {
    state.matchPlayers.push(entry);
  }

  saveStateToStorage();
  notifyListeners();
  return state.matchPlayers;
}

export function removeMatchPlayer(playerId) {
  if (!playerId) return state.matchPlayers;

  const next = state.matchPlayers.filter((entry) => entry.playerId !== playerId);
  if (next.length !== state.matchPlayers.length) {
    state.matchPlayers = next;
    saveStateToStorage();
    notifyListeners();
  }
  return state.matchPlayers;
}

export function loadMatchPlayers(rawPlayers) {
  if (rawPlayers === undefined || rawPlayers === null) {
    return state.matchPlayers;
  }

  let parsed = rawPlayers;
  if (typeof rawPlayers === 'string') {
    try {
      parsed = JSON.parse(rawPlayers);
    } catch (error) {
      console.warn('Failed to parse match players payload', error);
      parsed = [];
    }
  }

  if (!Array.isArray(parsed)) {
    parsed = [];
  }

  return setMatchPlayers(parsed);
}

export function serializeMatchPlayersForApi() {
  return state.matchPlayers.map(({ playerId, tempNumber }) => ({
    player_id: playerId,
    temp_number: tempNumber ?? null,
  }));
}

export function serializeMatchPlayersJson() {
  return JSON.stringify(serializeMatchPlayersForApi());
}

// Expose for console debugging (keep this)
window.state = state;
window.updateState = updateState;
window.loadStateFromStorage = loadStateFromStorage;
window.saveStateToStorage = saveStateToStorage;
window.subscribeToState = subscribe;
window.setPlayers = setPlayers;
window.setMatchPlayers = setMatchPlayers;
window.loadMatchPlayers = loadMatchPlayers;
window.serializeMatchPlayersForApi = serializeMatchPlayersForApi;

loadStateFromStorage();
