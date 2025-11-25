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
import { state, updateState } from '../state.js';
import { getMatch } from './ws.js';

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
    } catch (error) {
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
let activeMatchId = coerceMatchId(initialMatchId) ?? coerceMatchId(state.matchId);
if (activeMatchId !== null) {
  updateState({ matchId: activeMatchId });
}

let suppressMetaWrites = false;

export function setActiveMatchId(matchId) {
  activeMatchId = coerceMatchId(matchId);
  updateState({ matchId: activeMatchId });
  return activeMatchId;
}

export function getActiveMatchId() {
  return activeMatchId;
}

function handleLocationInput(event) {
  if (suppressMetaWrites) return;
  writeLocation(activeMatchId, event.target?.value);
}

function handleOpponentInput(event) {
  if (suppressMetaWrites) return;
  debouncedOpponentUpdate();
  writeOpponent(activeMatchId, event.target?.value);
}

function handleDateInput(event) {
  if (suppressMetaWrites) return;
  writeDate(activeMatchId, event.target?.value);
}

function handleTypeChange(event) {
  if (suppressMetaWrites) return;
  if (!event.target?.checked) return;
  writeType(activeMatchId, event.target.value);
}

function handleFirstServerChange(event) {
  if (suppressMetaWrites) return;
  writeFirstServer(activeMatchId, event.target?.value);
}

function handleJerseyChange(event) {
  if (suppressMetaWrites) return;
  const { id, value } = event.target || {};
  if (id === 'jerseyColorHome') {
    writeHomeJerseyColor(activeMatchId, value);
  } else if (id === 'jerseyColorOpp') {
    writeOppJerseyColor(activeMatchId, value);
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
  } finally {
    suppressMetaWrites = false;
  }
}

export async function loadMatchFromUrl() {
  const matchId = initialMatchId;
  if (!matchId) return null;

  try {
    const response = await getMatch(matchId);
    if (!response || response.status >= 300 || !response.body) {
      console.warn(`Failed to load match ${matchId} from URL parameter.`);
      return null;
    }
    hydrateMatchMeta(response.body);
    return response.body;
  } catch (error) {
    console.error(`Error loading match ${matchId} from URL:`, error);
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
