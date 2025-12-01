// js/api/matchLiveSync.js
// Keeps the active match view in sync with server broadcasts.
import {
  state,
  subscribe as subscribeToState,
  loadMatchPlayers,
  updateState,
  upsertMatchPlayer,
  removeMatchPlayer,
} from '../state.js';
import { getMatch, onUpdate, subscribeToMatch, unsubscribeFromMatch } from './ws.js';
import { getActiveMatchId, hydrateMatchMeta } from './matchMetaAutosave.js';
import { hydrateScores } from './scoring.js';
import { applyFinalizedMap } from '../ui/finalizedSets.js';

const HYDRATE_DEBOUNCE_MS = 150;

let subscribedMatchId = null;
let unsubscribeUpdate = null;
let unsubscribeState = null;
let scoreHydrateTimer = null;

function normalizeMatchId(raw) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getCurrentMatchId() {
  return normalizeMatchId(getActiveMatchId() ?? state.matchId);
}

async function updateSubscription(nextMatchId) {
  const normalized = normalizeMatchId(nextMatchId);
  if (normalized === subscribedMatchId) return;

  if (subscribedMatchId !== null) {
    try {
      await unsubscribeFromMatch(subscribedMatchId);
    } catch {
      // noop
    }
  }

  subscribedMatchId = normalized;
  if (normalized !== null) {
    try {
      await subscribeToMatch(normalized);
    } catch {
      // noop
    }
  }
}

function scheduleMatchHydrate(matchId) {
  // Deprecated: no-op to avoid extra match fetches.
}

function scheduleScoreHydrate(matchId) {
  if (scoreHydrateTimer) {
    clearTimeout(scoreHydrateTimer);
  }
  scoreHydrateTimer = setTimeout(() => {
    scoreHydrateTimer = null;
    hydrateScores(matchId, { force: true });
  }, HYDRATE_DEBOUNCE_MS);
}

function applyMatchResult(match) {
  const home = normalizeScore(match.result_home ?? match.resultHome);
  const opp = normalizeScore(match.result_opp ?? match.resultOpp);
  const next = {};
  if (home !== null) next.home = home;
  if (opp !== null) next.opp = opp;
  if (Object.keys(next).length) {
    updateState({ matchWins: { ...state.matchWins, ...next } });
  }
}

async function syncFinalizedSets(matchId, payload = {}) {
  const finalizedRaw = payload.finalized_sets ?? payload.finalizedSets;
  if (finalizedRaw !== undefined) {
    applyFinalizedMap(finalizedRaw);
    return true;
  }

  try {
    const response = await getMatch(matchId);
    const finalizedMap = response?.body?.finalized_sets ?? response?.body?.finalizedSets;
    if (finalizedMap !== undefined) {
      applyFinalizedMap(finalizedMap);
      return true;
    }
  } catch (_error) {
    // noop
  }

  return false;
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMaybeJson(raw, fallback = []) {
  if (raw === undefined || raw === null) return fallback;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseDelta(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

function mergePlayersWithTemps(players = [], tempNumbers = []) {
  const parsedPlayers = parseMaybeJson(players, []);
  const parsedTemps = parseMaybeJson(tempNumbers, []);

  const tempMap = new Map();
  parsedTemps.forEach((entry) => {
    const playerId = entry?.player_id ?? entry?.playerId ?? entry?.id;
    const temp = entry?.temp_number ?? entry?.tempNumber;
    if (typeof playerId === 'number' && temp !== undefined) {
      tempMap.set(playerId, temp);
    }
  });

  const merged = [];
  parsedPlayers.forEach((entry) => {
    const playerId = entry?.player_id ?? entry?.playerId ?? entry?.id;
    if (typeof playerId !== 'number') return;
    const appeared = entry?.appeared ?? entry?.active ?? entry?.selected;
    const temp = tempMap.has(playerId) ? tempMap.get(playerId) : entry?.temp_number ?? entry?.tempNumber;
    const payload = appeared === undefined ? { player_id: playerId } : { player_id: playerId, appeared };
    if (temp !== undefined) {
      payload.temp_number = temp;
    }
    merged.push(payload);
    tempMap.delete(playerId);
  });

  tempMap.forEach((temp, playerId) => {
    merged.push({ player_id: playerId, temp_number: temp });
  });

  return merged;
}

function applyPlayerDelta(rawDelta) {
  const delta = parseDelta(rawDelta);
  if (!delta) return false;

  const playerId = delta.player_id ?? delta.playerId ?? delta.id;
  if (typeof playerId !== 'number') return false;

  const existing = state.matchPlayers.find((entry) => entry.playerId === playerId);
  const removed = delta.deleted || delta.remove || delta.removed;
  const appearedRaw = delta.appeared ?? delta.active ?? delta.selected;
  const appeared = appearedRaw === undefined ? existing?.appeared ?? true : Boolean(appearedRaw);

  const tempRaw = delta.temp_number ?? delta.tempNumber;
  let tempNumber = existing?.tempNumber ?? null;
  if (removed) {
    removeMatchPlayer(playerId);
    return true;
  }
  if (tempRaw !== undefined) {
    tempNumber = tempRaw === null || tempRaw === '' ? null : Number(tempRaw);
    if (tempNumber !== null && Number.isNaN(tempNumber)) {
      tempNumber = existing?.tempNumber ?? null;
    }
  }

  upsertMatchPlayer(playerId, tempNumber, appeared);
  return true;
}

function applyTempDelta(rawDelta) {
  const delta = parseDelta(rawDelta);
  if (!delta) return false;
  const playerId = delta.player_id ?? delta.playerId ?? delta.id;
  if (typeof playerId !== 'number') return false;

  const existing = state.matchPlayers.find((entry) => entry.playerId === playerId);
  const removed = delta.deleted || delta.remove || delta.removed;
  const tempRaw = delta.temp_number ?? delta.tempNumber;

  if (removed || tempRaw === null) {
    if (existing) {
      const appeared = existing.appeared ?? true;
      upsertMatchPlayer(playerId, null, appeared);
    }
    return true;
  }

  if (tempRaw === undefined) return false;
  const tempNumber = Number(tempRaw);
  if (Number.isNaN(tempNumber)) return false;

  const appeared = existing?.appeared ?? true;
  upsertMatchPlayer(playerId, tempNumber, appeared);
  return true;
}

function normalizeTimeoutFlag(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.trim() === '') return false;
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return Boolean(parsed);
    }
    return Boolean(value);
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return Boolean(value);
}

function findSetNumberById(setId) {
  for (let set = 1; set <= 5; set++) {
    if (state.sets?.[set]?.id === setId) {
      return set;
    }
  }
  return null;
}

function applyTimeoutChanges(setId, changes) {
  if (!setId || !changes) return false;
  const setNumber = findSetNumberById(setId);
  if (!setNumber) return false;

  const setState = state.sets?.[setNumber];
  const baseTimeouts = setState?.timeouts || { home: [false, false], opp: [false, false] };
  const updated = {
    home: [...baseTimeouts.home],
    opp: [...baseTimeouts.opp],
  };
  let mutated = false;
  const normalizeTimestamp = (value) => {
    if (value === null || value === undefined) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  let nextTimeoutStartedAt = setState?.timeoutStartedAt ?? null;
  let nextTimeoutActiveTeam = setState?.timeoutActiveTeam ?? null;
  let nextTimeoutActiveIndex = setState?.timeoutActiveIndex ?? null;
  const hasStartedAtChange =
    Object.prototype.hasOwnProperty.call(changes, 'timeout_started_at') ||
    Object.prototype.hasOwnProperty.call(changes, 'timeoutStartedAt');
  if (hasStartedAtChange) {
    nextTimeoutStartedAt = normalizeTimestamp(changes.timeout_started_at ?? changes.timeoutStartedAt);
    if (!nextTimeoutStartedAt) {
      nextTimeoutActiveTeam = null;
      nextTimeoutActiveIndex = null;
    }
  }

  const applyChange = (team, index, key) => {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) return;
    const nextValue = normalizeTimeoutFlag(changes[key]);
    if (updated[team][index] !== nextValue) {
      updated[team][index] = nextValue;
      mutated = true;
    }

    if (nextTimeoutStartedAt && Object.prototype.hasOwnProperty.call(changes, key)) {
      nextTimeoutActiveTeam = team;
      nextTimeoutActiveIndex = index;
    }
  };

  applyChange('home', 0, 'home_timeout_1');
  applyChange('home', 1, 'home_timeout_2');
  applyChange('opp', 0, 'opp_timeout_1');
  applyChange('opp', 1, 'opp_timeout_2');

  const timestampChanged =
    nextTimeoutStartedAt !== (setState?.timeoutStartedAt ?? null) ||
    nextTimeoutActiveTeam !== (setState?.timeoutActiveTeam ?? null) ||
    nextTimeoutActiveIndex !== (setState?.timeoutActiveIndex ?? null);

  if (mutated || timestampChanged) {
    updateState({
      sets: {
        [setNumber]: {
          timeouts: updated,
          timeoutStartedAt: nextTimeoutStartedAt,
          timeoutActiveTeam: nextTimeoutActiveTeam,
          timeoutActiveIndex: nextTimeoutActiveIndex,
        },
      },
    });
  }

  return mutated || timestampChanged;
}

async function handleUpdate(message) {
  if (!message || message.type !== 'update') return;

  const activeMatchId = getCurrentMatchId();
  const messageMatchId = normalizeMatchId(message.matchId ?? message.data?.matchId ?? message.data?.match_id ?? message.id);

  if (!activeMatchId || !messageMatchId || activeMatchId !== messageMatchId) {
    return;
  }

  if (message.resource === 'match') {
    applyMatchBroadcast(message);
    return;
  }

  if (message.resource === 'set') {
    const applied = applyTimeoutChanges(message.id ?? message.data?.id ?? null, message.changes ?? message.data ?? {});
    if (!applied) {
      scheduleScoreHydrate(activeMatchId);
    }
    return;
  }

  if (message.resource === 'sets') {
    if (message.action === 'set-is-final') {
      await syncFinalizedSets(activeMatchId, message.data ?? message.changes ?? {});
    }
    scheduleScoreHydrate(activeMatchId);
    return;
  }
}

function applyMatchBroadcast(message) {
  const payload = message.changes ?? message.data ?? {};

  const resultHome = payload.result_home ?? payload.resultHome;
  const resultOpp = payload.result_opp ?? payload.resultOpp;
  const nextWins = {};
  if (resultHome !== undefined) {
    const parsedHome = normalizeScore(resultHome);
    if (parsedHome !== null) nextWins.home = parsedHome;
  }
  if (resultOpp !== undefined) {
    const parsedOpp = normalizeScore(resultOpp);
    if (parsedOpp !== null) nextWins.opp = parsedOpp;
  }
  if (Object.keys(nextWins).length) {
    updateState({ matchWins: { ...state.matchWins, ...nextWins } });
  }

  const playerDelta = payload.player_delta ?? payload.playerDelta ?? null;
  const tempDelta = payload.temp_number_delta ?? payload.tempNumberDelta ?? payload.temp_delta ?? null;
  let appliedDelta = false;

  if (playerDelta) {
    appliedDelta = applyPlayerDelta(playerDelta) || appliedDelta;
  }
  if (tempDelta) {
    appliedDelta = applyTempDelta(tempDelta) || appliedDelta;
  }

  if (!appliedDelta) {
    const players = payload.players ?? null;
    const temps = payload.temp_numbers ?? payload.tempNumbers ?? null;
    if (players !== null || temps !== null) {
      const merged = mergePlayersWithTemps(players ?? [], temps ?? []);
      loadMatchPlayers(merged);
    }
  }
}

export function initMatchLiveSync() {
  // Keep the subscription aligned with the active matchId.
  unsubscribeState = subscribeToState((nextState) => {
    updateSubscription(nextState.matchId);
  });

  // Initial subscription (if a match is already active).
  updateSubscription(getCurrentMatchId());

  // Listen for broadcast updates.
  unsubscribeUpdate = onUpdate(handleUpdate);
}

export function teardownMatchLiveSync() {
  if (unsubscribeUpdate) unsubscribeUpdate();
  if (unsubscribeState) unsubscribeState();
  if (scoreHydrateTimer) clearTimeout(scoreHydrateTimer);
  scoreHydrateTimer = null;
  unsubscribeUpdate = null;
  unsubscribeState = null;
}
