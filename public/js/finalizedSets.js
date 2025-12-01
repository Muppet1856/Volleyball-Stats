// js/finalizedSets.js
// Shared helpers for syncing finalized sets and recalculating match wins.
import { state, updateState } from './state.js';

const DEFAULT_SET_COUNT = 5;

function parseFinalizedMap(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (_err) {
      return {};
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

function getTrackedSetCount(preferredCount = DEFAULT_SET_COUNT) {
  const currentSets = state.sets ? Object.keys(state.sets).length : 0;
  return Math.max(preferredCount, currentSets, DEFAULT_SET_COUNT);
}

export function recalcMatchWins({ setCount = DEFAULT_SET_COUNT } = {}) {
  const totals = { home: 0, opp: 0 };
  const totalSets = getTrackedSetCount(setCount);

  for (let set = 1; set <= totalSets; set++) {
    const setState = state.sets?.[set];
    if (setState?.finalized && setState.winner) {
      totals[setState.winner] += 1;
    }
  }

  updateState({ matchWins: totals });
}

export function applyFinalizedMap(raw, { setCount = DEFAULT_SET_COUNT } = {}) {
  const parsed = parseFinalizedMap(raw);
  const patch = {};
  const totalSets = getTrackedSetCount(setCount);

  for (let set = 1; set <= totalSets; set++) {
    const value = parsed[set] ?? parsed[String(set)] ?? false;
    patch[set] = { finalized: Boolean(value) };
  }

  updateState({ sets: patch });
  recalcMatchWins({ setCount: totalSets });
}
