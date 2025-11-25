// js/api/scoring.js
// Client-side helpers for set scoring. Handles set creation, score writes,
// and hydration of existing scores from the server.
import { state, updateState } from '../state.js';
import { debounce } from '../utils/debounce.js';
import { getSets, createSet, setHomeScore, setOppScore } from './ws.js';
import { getActiveMatchId } from './matchMetaAutosave.js';

const SAVE_DELAY_MS = 500;
const MAX_SET_NUMBER = 5;

// Track in-flight set creations per match/set to avoid duplicates.
const pendingCreates = new Map();
let hydratedMatchId = null;
let hydratePromise = null;

function normalizeMatchId(raw) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSetNumber(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > MAX_SET_NUMBER) return null;
  return parsed;
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSetState(setNumber) {
  return state.sets?.[setNumber] || { scores: {}, timeouts: { home: [], opp: [] } };
}

function updateLocalSet(setNumber, patch) {
  updateState({
    sets: {
      [setNumber]: patch,
    },
  });
}

async function hydrateSetsForMatch(matchId, { force = false } = {}) {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) return [];

  if (!force && hydratedMatchId === normalizedId && hydratePromise) {
    return hydratePromise;
  }

  const promise = (async () => {
    try {
      const response = await getSets(normalizedId);
      const rows = Array.isArray(response?.body) ? response.body : [];
      rows.forEach(applyServerSetRow);
      hydratedMatchId = normalizedId;
      return rows;
    } catch (_error) {
      return [];
    }
  })();

  hydratePromise = promise;
  return promise;
}

function applyServerSetRow(row) {
  const setNumber = normalizeSetNumber(row?.set_number ?? row?.setNumber);
  if (!setNumber) return;

  const homeScore = normalizeScore(row.home_score ?? row.homeScore);
  const oppScore = normalizeScore(row.opp_score ?? row.oppScore);
  const setId = row.id ?? row.set_id ?? row.setId ?? null;

  updateLocalSet(setNumber, {
    id: setId,
    scores: {
      home: homeScore ?? 0,
      opp: oppScore ?? 0,
    },
  });

  // Sync visible inputs if present.
  const homeInput = document.getElementById(`set${setNumber}Home`);
  const oppInput = document.getElementById(`set${setNumber}Opp`);
  if (homeInput && homeScore !== null && homeScore !== undefined) {
    homeInput.value = homeScore;
  }
  if (oppInput && oppScore !== null && oppScore !== undefined) {
    oppInput.value = oppScore;
  }
}

async function ensureSetId(matchId, setNumber) {
  const normalizedMatchId = normalizeMatchId(matchId);
  const normalizedSetNumber = normalizeSetNumber(setNumber);
  if (!normalizedMatchId || !normalizedSetNumber) return null;

  const existingId = getSetState(normalizedSetNumber).id;
  if (existingId) return existingId;

  // Try hydration first to discover an existing set row.
  await hydrateSetsForMatch(normalizedMatchId);
  const hydratedId = getSetState(normalizedSetNumber).id;
  if (hydratedId) return hydratedId;

  // Force refresh once before creating a new set to avoid duplicates.
  await hydrateSetsForMatch(normalizedMatchId, { force: true });
  const refreshedId = getSetState(normalizedSetNumber).id;
  if (refreshedId) return refreshedId;

  const key = `${normalizedMatchId}:${normalizedSetNumber}`;
  if (pendingCreates.has(key)) {
    return pendingCreates.get(key);
  }

  const createPromise = (async () => {
    const scores = getSetState(normalizedSetNumber).scores || {};
    const payload = {
      match_id: normalizedMatchId,
      set_number: normalizedSetNumber,
      home_score: normalizeScore(scores.home),
      opp_score: normalizeScore(scores.opp),
    };
    const response = await createSet(payload);
    if (!response || response.status >= 300) {
      const message = response?.body?.message || 'Unknown error creating set';
      throw new Error(message);
    }
    const newId = response.body?.id ?? response.body?.set_id ?? null;
    if (newId) {
      updateLocalSet(normalizedSetNumber, { id: newId });
    }
    return newId;
  })();

  pendingCreates.set(key, createPromise);
  try {
    return await createPromise;
  } finally {
    pendingCreates.delete(key);
  }
}

async function writeScoreNow(team, setNumber, rawScore) {
  const matchId = getActiveMatchId() ?? state.matchId;
  const normalizedMatchId = normalizeMatchId(matchId);
  const normalizedSetNumber = normalizeSetNumber(setNumber);
  if (!normalizedMatchId || !normalizedSetNumber) {
    return;
  }

  const scoreValue = normalizeScore(rawScore);
  const setId = await ensureSetId(normalizedMatchId, normalizedSetNumber);
  if (!setId) {
    return;
  }

  try {
    if (team === 'home') {
      await setHomeScore(setId, scoreValue, normalizedMatchId);
    } else {
      await setOppScore(setId, scoreValue, normalizedMatchId);
    }
  } catch {
    // noop
  }
}

const debouncedWriters = new Map();
function getDebouncedWriter(team, setNumber) {
  const key = `${team}:${setNumber}`;
  if (!debouncedWriters.has(key)) {
    debouncedWriters.set(
      key,
      debounce((score) => writeScoreNow(team, setNumber, score), SAVE_DELAY_MS),
    );
  }
  return debouncedWriters.get(key);
}

export function saveScore(team, setNumber, score) {
  const writer = getDebouncedWriter(team, setNumber);
  writer(score);
}

export async function hydrateScores(matchId = null, { force = false } = {}) {
  const targetMatchId = normalizeMatchId(matchId ?? getActiveMatchId() ?? state.matchId);
  return hydrateSetsForMatch(targetMatchId, { force });
}

export default {
  hydrateScores,
  saveScore,
};
