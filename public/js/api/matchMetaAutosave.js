// js/api/matchMetaAutosave.js
// Hooks inputs to debounced match metadata writers.
import {
  writeDate,
  writeFirstServer,
  writeHomeJerseyColor,
  writeLocation,
  writeOpponent,
  writeOppJerseyColor,
  writeType,
} from './matchMetaWrite.js';
import { debouncedOpponentUpdate, updateOpponentName } from '../ui/opponentName.js';
import { state, updateState, loadMatchPlayers, setMatchPlayers } from '../state.js';
import { collectMatchPayload } from './matchPayload.js';
import { createMatch, getMatch } from './ws.js';
import { removeMatchParamsFromUrl, updateUrlWithMatchId } from './matchUrl.js';
import { setAutoSaveStatus } from '../ui/autoSaveStatus.js';

function coerceMatchId(raw) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function parseTypes(rawTypes) {
  if (!rawTypes) return {};
  if (typeof rawTypes === 'string') {
    try {
      return parseTypes(JSON.parse(rawTypes));
    } catch (_error) {
      return {};
    }
  }
  if (typeof rawTypes !== 'object') return {};
  return rawTypes;
}

function pickTypeKey(typesObj) {
  const keys = Object.entries(parseTypes(typesObj))
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  return keys[0] || null;
}

function toDatetimeLocal(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function getUrlMatchId() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('match') ?? params.get('matchId') ?? params.get('matchid');
  return coerceMatchId(fromUrl);
}

const initialMatchId = getUrlMatchId();
let activeMatchId = coerceMatchId(initialMatchId) ?? null;
if (activeMatchId !== null) {
  updateState({ matchId: activeMatchId });
}

let suppressMetaWrites = false;
let matchCreationPromise = null;

async function ensureMatchExists() {
  if (activeMatchId) {
    return activeMatchId;
  }
  if (matchCreationPromise) {
    return matchCreationPromise;
  }

  matchCreationPromise = (async () => {
    setAutoSaveStatus('Creating match...', 'muted');
    const response = await createMatch(collectMatchPayload());
    if (!response || response.status >= 300 || !response.body) {
      const message = response?.body?.message || 'Match creation failed';
      throw new Error(message);
    }
    const matchId = coerceMatchId(response.body.id ?? response.body.match_id ?? response.body.matchId);
    if (!matchId) {
      throw new Error('Match ID missing from response');
    }
    setActiveMatchId(matchId);
    updateUrlWithMatchId(matchId);
    setAutoSaveStatus(`Match #${matchId} created.`, 'success');
    return matchId;
  })();

  try {
    return await matchCreationPromise;
  } catch (_error) {
    setAutoSaveStatus('Could not create match automatically. Please use the New Game button.', 'danger');
    return null;
  } finally {
    matchCreationPromise = null;
  }
}

export function setActiveMatchId(matchId) {
  activeMatchId = coerceMatchId(matchId);
  updateState({ matchId: activeMatchId });
  return activeMatchId;
}

export function getActiveMatchId() {
  return activeMatchId;
}

async function handleLocationInput(event) {
  if (suppressMetaWrites) return;
  const matchId = await ensureMatchExists();
  if (!matchId) return;
  writeLocation(matchId, event.target?.value);
}

async function handleOpponentInput(event) {
  if (suppressMetaWrites) return;
  debouncedOpponentUpdate();
  const matchId = await ensureMatchExists();
  if (!matchId) return;
  writeOpponent(matchId, event.target?.value);
}

async function handleDateInput(event) {
  if (suppressMetaWrites) return;
  const matchId = await ensureMatchExists();
  if (!matchId) return;
  writeDate(matchId, event.target?.value);
}

async function handleTypeChange(event) {
  if (suppressMetaWrites) return;
  if (!event.target?.checked) return;
  const matchId = await ensureMatchExists();
  if (!matchId) return;
  writeType(matchId, event.target.value);
}

async function handleFirstServerChange(event) {
  if (suppressMetaWrites) return;
  const matchId = await ensureMatchExists();
  if (!matchId) return;
  writeFirstServer(matchId, event.target?.value);
}

async function handleJerseyChange(event) {
  if (suppressMetaWrites) return;
  const matchId = await ensureMatchExists();
  if (!matchId) return;
  const { id, value } = event.target || {};
  if (id === 'jerseyColorHome') {
    writeHomeJerseyColor(matchId, value);
  } else if (id === 'jerseyColorOpp') {
    writeOppJerseyColor(matchId, value);
  }
}

export function initMatchMetaAutosave() {
  const locationInput = document.getElementById('location');
  const opponentInput = document.getElementById('opponent');
  const dateInput = document.getElementById('date');
  const firstServerSelect = document.getElementById('firstServer');
  const jerseyHomeSelect = document.getElementById('jerseyColorHome');
  const jerseyOppSelect = document.getElementById('jerseyColorOpp');
  const typeRadios = Array.from(document.querySelectorAll('input[name="gameType"]'));

  if (locationInput) {
    locationInput.addEventListener('input', handleLocationInput);
  }
  if (opponentInput) {
    opponentInput.addEventListener('input', handleOpponentInput);
  }
  if (dateInput) {
    dateInput.addEventListener('input', handleDateInput);
  }
  if (firstServerSelect) {
    firstServerSelect.addEventListener('change', handleFirstServerChange);
  }
  if (jerseyHomeSelect) {
    jerseyHomeSelect.addEventListener('change', handleJerseyChange);
  }
  if (jerseyOppSelect) {
    jerseyOppSelect.addEventListener('change', handleJerseyChange);
  }
  if (typeRadios.length) {
    typeRadios.forEach((radio) => {
      radio.addEventListener('change', handleTypeChange);
    });
  }
}

function setRadioSelection(typeKey) {
  if (!typeKey) return;
  const target = document.querySelector(`input[name="gameType"][value="${typeKey}"]`);
  if (target) {
    target.checked = true;
  }
}

function setSelectValue(select, value) {
  if (!select) return;
  const next = value ?? '';
  if (select.value !== next) {
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function hydrateMatchMeta(match = {}) {
  suppressMetaWrites = true;
  try {
    const matchId = coerceMatchId(match.id ?? match.match_id ?? match.matchId);
    if (matchId !== null) {
      setActiveMatchId(matchId);
    }

    const locationValue = normalizeText(match.location) ?? '';
    const opponentValue = normalizeText(match.opponent) ?? '';
    const dateValue = toDatetimeLocal(match.date);
    const typeKey = pickTypeKey(match.types);
    const firstServerValue = normalizeText(match.first_server ?? match.firstServer) ?? '';
    const homeJerseyValue = normalizeText(match.jersey_color_home ?? match.jerseyColorHome) ?? '';
    const oppJerseyValue = normalizeText(match.jersey_color_opp ?? match.jerseyColorOpp) ?? '';

    const locationInput = document.getElementById('location');
    const opponentInput = document.getElementById('opponent');
    const dateInput = document.getElementById('date');
    const firstServerSelect = document.getElementById('firstServer');
    const jerseyHomeSelect = document.getElementById('jerseyColorHome');
    const jerseyOppSelect = document.getElementById('jerseyColorOpp');

    if (locationInput) locationInput.value = locationValue;
    if (opponentInput) opponentInput.value = opponentValue;
    if (dateInput && dateValue) dateInput.value = dateValue;
    if (typeKey) setRadioSelection(typeKey);
    setSelectValue(firstServerSelect, firstServerValue);
    setSelectValue(jerseyHomeSelect, homeJerseyValue);
    setSelectValue(jerseyOppSelect, oppJerseyValue);

    updateState({
      opponent: opponentValue || state.opponent,
      location: locationValue || null,
      date: dateValue || null,
      matchTypes: parseTypes(match.types),
      firstServer: firstServerValue || null,
      jerseyColorHome: homeJerseyValue || null,
      jerseyColorOpp: oppJerseyValue || null,
    });

    updateOpponentName();

    // Load match players (including temp numbers) into state for UI rendering.
    const mergedPlayers = mergePlayersWithTemps(match.players ?? [], match.temp_numbers ?? match.tempNumbers);
    loadMatchPlayers(mergedPlayers);
  } finally {
    suppressMetaWrites = false;
  }
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

export async function loadMatchFromUrl() {
  const matchId = getActiveMatchId();
  if (!matchId) {
    // No match selected; clear any stale matchId in state.
    setActiveMatchId(null);
    setMatchPlayers([]);
    return null;
  }

  const clearActiveMatch = () => {
    setActiveMatchId(null);
    removeMatchParamsFromUrl();
    setMatchPlayers([]);
  };

  try {
    const response = await getMatch(matchId);
    if (!response || response.status >= 300 || !response.body) {
      clearActiveMatch();
      return null;
    }
    const match = response.body;
    // Reset and repopulate match players explicitly to avoid stale/local data.
    setMatchPlayers([]);
    hydrateMatchMeta(match);
    const mergedPlayers = mergePlayersWithTemps(match.players ?? [], match.temp_numbers ?? match.tempNumbers);
    setMatchPlayers(mergedPlayers);
    loadMatchPlayers(mergedPlayers);
    return match;
  } catch (_error) {
    clearActiveMatch();
    return null;
  }
}

export default {
  initMatchMetaAutosave,
  setActiveMatchId,
  getActiveMatchId,
  hydrateMatchMeta,
  loadMatchFromUrl,
};
