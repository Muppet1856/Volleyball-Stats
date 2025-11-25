// js/api/matchLiveSync.js
// Keeps the active match view in sync with server broadcasts.
import { state, subscribe as subscribeToState, loadMatchPlayers, updateState } from '../state.js';
import { onUpdate, subscribeToMatch, unsubscribeFromMatch } from './ws.js';
import { getActiveMatchId, hydrateMatchMeta } from './matchMetaAutosave.js';
import { hydrateScores } from './scoring.js';

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
    } catch (error) {
      console.warn('Failed to unsubscribe from match updates', error);
    }
  }

  subscribedMatchId = normalized;
  if (normalized !== null) {
    try {
      await subscribeToMatch(normalized);
    } catch (error) {
      console.warn('Failed to subscribe to match updates', error);
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

function handleUpdate(message) {
  if (!message || message.type !== 'update') return;

  const activeMatchId = getCurrentMatchId();
  const messageMatchId = normalizeMatchId(message.matchId ?? message.data?.matchId ?? message.data?.match_id ?? message.id);

  if (!activeMatchId || !messageMatchId || activeMatchId !== messageMatchId) {
    return;
  }

  if (message.resource === 'match') {
    console.log('[matchLiveSync] apply match broadcast', message);
    applyMatchBroadcast(message);
    return;
  }

  if (message.resource === 'set' || message.resource === 'sets') {
    scheduleScoreHydrate(activeMatchId);
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

  const players = payload.players ?? null;
  const temps = payload.temp_numbers ?? payload.tempNumbers ?? null;
  if (players !== null || temps !== null) {
    const merged = mergePlayersWithTemps(players ?? [], temps ?? []);
    console.log('[matchLiveSync] merged players from broadcast', merged);
    loadMatchPlayers(merged);
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
