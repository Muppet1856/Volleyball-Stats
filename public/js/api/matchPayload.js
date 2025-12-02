import { state, serializeMatchPlayersForApi } from '../state.js';

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTrimmedValue(id) {
  const el = document.getElementById(id);
  if (!el || typeof el.value !== 'string') return null;
  const value = el.value.trim();
  return value === '' ? null : value;
}

function getTypesPayload() {
  const selected = document.querySelector('input[name="gameType"]:checked');
  if (!selected?.value) return {};
  return { [selected.value]: true };
}

function getFinalizedSetsPayload() {
  return Object.entries(state.sets || {}).reduce((acc, [setNumber, setState]) => {
    acc[setNumber] = Boolean(setState?.finalized);
    return acc;
  }, {});
}

export function collectMatchPayload() {
  const jerseyHome = document.getElementById('jerseyColorHome');
  const jerseyOpp = document.getElementById('jerseyColorOpp');
  const firstServer = document.getElementById('firstServer');

  return {
    date: getTrimmedValue('date'),
    location: getTrimmedValue('location'),
    opponent: getTrimmedValue('opponent'),
    types: getTypesPayload(),
    jersey_color_home: jerseyHome?.value || null,
    jersey_color_opp: jerseyOpp?.value || null,
    result_home: normalizeNumber(state.matchWins?.home),
    result_opp: normalizeNumber(state.matchWins?.opp),
    first_server: firstServer?.value || null,
    players: serializeMatchPlayersForApi(),
    finalized_sets: getFinalizedSetsPayload(),
    deleted: false,
  };
}

export default {
  collectMatchPayload,
};
