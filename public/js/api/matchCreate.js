// js/api/matchCreate.js
import { state, serializeMatchPlayersForApi } from '../state.js';
import { createMatch } from './ws.js';
import { refreshMatches } from './matches.js';
import { setActiveMatchId } from './matchMetaAutosave.js';

const NEW_MATCH_BUTTON_ID = 'newGameButton';
const STATUS_ELEMENT_ID = 'autoSaveStatus';
const FORM_ID = 'matchForm';

function getStatusElement() {
  return document.getElementById(STATUS_ELEMENT_ID);
}

function setStatus(message, tone = 'muted') {
  const el = getStatusElement();
  if (!el) return;
  el.textContent = message;
  el.classList.remove('d-none', 'text-muted', 'text-success', 'text-danger');
  const toneClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-muted';
  el.classList.add(toneClass);
}

function clearStatus() {
  const el = getStatusElement();
  if (!el) return;
  el.textContent = '';
  el.classList.add('d-none');
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

function buildMatchPayload() {
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

function toggleButtonLoading(isLoading) {
  const button = document.getElementById(NEW_MATCH_BUTTON_ID);
  if (!button) return;
  button.disabled = isLoading;
  if (isLoading) {
    button.dataset.loading = 'true';
  } else {
    delete button.dataset.loading;
  }
}

async function handleCreateMatch(event) {
  const button = event?.currentTarget;
  if (button?.dataset.loading === 'true') return;

  const form = document.getElementById(FORM_ID);
  if (form && !form.checkValidity()) {
    form.classList.add('was-validated');
    form.reportValidity();
    setStatus('Please fix the highlighted fields before creating a match.', 'danger');
    return;
  }

  const payload = buildMatchPayload();

  toggleButtonLoading(true);
  setStatus('Creating match...', 'muted');

  try {
    const response = await createMatch(payload);
    if (!response || response.status >= 300) {
      const message = response?.body?.message || 'Request failed';
      throw new Error(message);
    }

    const matchId = response.body?.id ?? response.body?.match_id;
    setActiveMatchId(matchId);
    const successMsg = matchId ? `Match #${matchId} created.` : 'Match created.';
    setStatus(successMsg, 'success');
    refreshMatches();
  } catch (error) {
    console.error('Match creation failed:', error);
    setStatus('Could not create match. Please try again.', 'danger');
  } finally {
    toggleButtonLoading(false);
  }
}

export function initMatchCreate() {
  clearStatus();
  const button = document.getElementById(NEW_MATCH_BUTTON_ID);
  if (!button) return;
  button.addEventListener('click', handleCreateMatch);
}
