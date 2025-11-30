// js/state.js
function createDefaultSetState() {
  return {
    id: null,
    scores: { home: 0, opp: 0 },
    timeouts: { home: [false, false], opp: [false, false] },
    finalized: false,
    winner: null,
  };
}

function createDefaultSets() {
  const sets = {};
  for (let set = 1; set <= 5; set++) {
    sets[set] = createDefaultSetState();
  }
  return sets;
}

export let state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
  matchId: null,
  matchWins: { home: 0, opp: 0 },
  overallWinner: null,
  players: [],
  matchPlayers: [],
  sets: createDefaultSets(),
  isDisplaySwapped: false,
  isTimeoutColorSwapped: false,
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

  // Ensure each set has the expected shape for new fields like id.
  for (let setNumber = 1; setNumber <= 5; setNumber++) {
    if (!state.sets[setNumber] || typeof state.sets[setNumber] !== 'object') {
      state.sets[setNumber] = {
        id: null,
        scores: { home: 0, opp: 0 },
        timeouts: { home: [false, false], opp: [false, false] },
        finalized: false,
        winner: null,
      };
      continue;
    }
    const setState = state.sets[setNumber];
    if (setState.id === undefined) setState.id = null;
    if (!setState.scores) setState.scores = { home: 0, opp: 0 };
    if (setState.scores.home === undefined) setState.scores.home = 0;
    if (setState.scores.opp === undefined) setState.scores.opp = 0;
    if (!setState.timeouts || typeof setState.timeouts !== 'object') {
      setState.timeouts = { home: [false, false], opp: [false, false] };
    } else {
      setState.timeouts.home = Array.isArray(setState.timeouts.home) ? setState.timeouts.home : [false, false];
      setState.timeouts.opp = Array.isArray(setState.timeouts.opp) ? setState.timeouts.opp : [false, false];
    }
    if (setState.finalized === undefined) setState.finalized = false;
    if (setState.winner === undefined) setState.winner = null;
  }

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
      legacyMatchPlayers.push({ playerId: player.id, tempNumber: parsedTemp, appeared: true });
    }

    return base;
  });

  const normalizedExisting = Array.isArray(state.matchPlayers)
    ? state.matchPlayers.map(normalizeMatchPlayer).filter(Boolean)
    : [];

  if (legacyMatchPlayers.length) {
    const merged = new Map(normalizedExisting.map((entry) => [entry.playerId, entry]));
    legacyMatchPlayers.forEach((entry) => {
      if (entry.playerId) {
        merged.set(entry.playerId, entry);
      }
    });
    state.matchPlayers = Array.from(merged.values());
  } else {
    state.matchPlayers = normalizedExisting;
  }

  const parsedMatchId = Number(state.matchId);
  state.matchId = Number.isFinite(parsedMatchId) && parsedMatchId > 0 ? parsedMatchId : null;

  if (state.isDisplaySwapped === undefined) {
    state.isDisplaySwapped = false;
  }
  if (state.isTimeoutColorSwapped === undefined) {
    state.isTimeoutColorSwapped = false;
  }
}

export function updateState(partialState) {
  deepMerge(state, partialState);
  saveStateToStorage();
  notifyListeners();
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
  } catch (_error) {
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

  const playerId = entry.playerId ?? entry.player_id ?? entry.id;
  if (!playerId) return null;

  const temp = entry.tempNumber ?? entry.temp_number;
  const parsedTemp = temp === undefined || temp === null || temp === '' ? null : Number(temp);
  if (parsedTemp !== null && Number.isNaN(parsedTemp)) {
    return null;
  }

  const appearedValue = entry.appeared ?? entry.active ?? entry.selected;
  const appeared = appearedValue === undefined ? true : Boolean(appearedValue);

  return parsedTemp === null
    ? { playerId, appeared }
    : { playerId, appeared, tempNumber: parsedTemp };
}

export function setMatchPlayers(matchPlayers = []) {
  if (!Array.isArray(matchPlayers)) return state.matchPlayers;

  const normalized = matchPlayers
    .map(normalizeMatchPlayer)
    .filter(Boolean)
    .reduce((acc, entry) => {
      acc.set(entry.playerId, entry);
      return acc;
    }, new Map());

  state.matchPlayers = Array.from(normalized.values());
  saveStateToStorage();
  notifyListeners();
  return state.matchPlayers;
}

export function upsertMatchPlayer(playerId, tempNumber = null, appeared = true) {
  if (!playerId) return state.matchPlayers;

  const parsedTemp = tempNumber === undefined || tempNumber === null || tempNumber === ''
    ? null
    : Number(tempNumber);
  if (parsedTemp !== null && Number.isNaN(parsedTemp)) {
    return state.matchPlayers;
  }

  const existingIndex = state.matchPlayers.findIndex((entry) => entry.playerId === playerId);
  const entry = parsedTemp === null
    ? { playerId, appeared: Boolean(appeared) }
    : { playerId, tempNumber: parsedTemp, appeared: Boolean(appeared) };

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
    } catch (_error) {
      parsed = [];
    }
  }

  if (!Array.isArray(parsed)) {
    parsed = [];
  }

  return setMatchPlayers(parsed);
}

export function serializeMatchPlayersForApi() {
  return state.matchPlayers.map(({ playerId, tempNumber, appeared }) => ({
    player_id: playerId,
    temp_number: tempNumber ?? null,
    appeared: appeared ?? true,
  }));
}

export function serializeMatchPlayersJson() {
  return JSON.stringify(serializeMatchPlayersForApi());
}

export function resetMatchState() {
  state.matchId = null;
  state.matchWins = { home: 0, opp: 0 };
  state.overallWinner = null;
  state.opponent = 'Opponent';
  state.location = null;
  state.date = null;
  state.matchTypes = {};
  state.firstServer = null;
  state.jerseyColorHome = null;
  state.jerseyColorOpp = null;
  state.matchPlayers = [];
  state.sets = createDefaultSets();
  saveStateToStorage();
  notifyListeners();
  return state;
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
