// js/api/matchLiveSync.js
// Keeps the active match view in sync with server broadcasts.
import { state, subscribe as subscribeToState, loadMatchPlayers, updateState } from '../state.js';
import { onUpdate, subscribeToMatch, unsubscribeFromMatch, getMatch } from './ws.js';
import { getActiveMatchId, hydrateMatchMeta } from './matchMetaAutosave.js';
import { hydrateScores } from './scoring.js';

const HYDRATE_DEBOUNCE_MS = 150;

let subscribedMatchId = null;
let unsubscribeUpdate = null;
let unsubscribeState = null;
let matchHydrateTimer = null;
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
  if (matchHydrateTimer) {
    clearTimeout(matchHydrateTimer);
  }
  matchHydrateTimer = setTimeout(() => {
    matchHydrateTimer = null;
    hydrateMatchDetails(matchId);
  }, HYDRATE_DEBOUNCE_MS);
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

async function hydrateMatchDetails(matchId) {
  const normalized = normalizeMatchId(matchId);
  if (!normalized) return;
  try {
    const response = await getMatch(normalized);
    if (!response || response.status >= 300 || !response.body) return;
    const match = response.body;
    hydrateMatchMeta(match);
    applyMatchResult(match);
    loadMatchPlayers(match.players ?? []);
  } catch (error) {
    console.error('Failed to hydrate match metadata from update', error);
  }
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

function handleUpdate(message) {
  if (!message || message.type !== 'update') return;

  const activeMatchId = getCurrentMatchId();
  const messageMatchId = normalizeMatchId(message.matchId ?? message.data?.matchId ?? message.data?.match_id ?? message.id);

  if (!activeMatchId || !messageMatchId || activeMatchId !== messageMatchId) {
    return;
  }

  if (message.resource === 'match') {
    scheduleMatchHydrate(activeMatchId);
    return;
  }

  if (message.resource === 'set' || message.resource === 'sets') {
    scheduleScoreHydrate(activeMatchId);
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
  if (matchHydrateTimer) clearTimeout(matchHydrateTimer);
  if (scoreHydrateTimer) clearTimeout(scoreHydrateTimer);
  matchHydrateTimer = null;
  scoreHydrateTimer = null;
  unsubscribeUpdate = null;
  unsubscribeState = null;
}
