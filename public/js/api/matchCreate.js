// js/api/matchCreate.js
import { state, serializeMatchPlayersForApi, resetMatchState } from '../state.js';
import { createMatch } from './ws.js';
import { refreshMatches } from './matches.js';
import { setActiveMatchId } from './matchMetaAutosave.js';
import { setDefaultDate } from '../init/date.js';

const NEW_MATCH_BUTTON_ID = 'newGameButton';
const STATUS_ELEMENT_ID = 'autoSaveStatus';
const FORM_ID = 'matchForm';
const MATCH_QUERY_KEYS = ['match', 'matchId', 'matchid'];

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

function removeMatchParamsFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  let changed = false;
  MATCH_QUERY_KEYS.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) {
    const next = `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}`;
    window.history.replaceState({}, document.title, next);
  }
}

function updateUrlWithMatchId(matchId) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const normalized = Number(matchId);
  if (!Number.isFinite(normalized) || normalized <= 0) return;
  const url = new URL(window.location.href);
  MATCH_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.set('match', normalized);
  const next = `${url.pathname}?${url.searchParams.toString()}`;
  window.history.replaceState({}, document.title, next);
}

function resetSetUi() {
  for (let set = 1; set <= 5; set++) {
    const row = document.querySelector(`#scoring-table tr:nth-child(${set + 1})`);
    row?.classList.remove('set-finalized', 'set-locked');

    const homeInput = document.getElementById(`set${set}Home`);
    const oppInput = document.getElementById(`set${set}Opp`);
    [homeInput, oppInput].forEach((input) => {
      if (!input) return;
      input.value = '';
      input.disabled = false;
      input.parentElement?.classList.remove('set-winner', 'set-loser');
    });

    const scoreBtn = document.querySelector(`.score-game-btn[data-set="${set}"]`);
    if (scoreBtn) scoreBtn.disabled = false;

    const finalizeBtn = document.querySelector(`.finalize-button[data-set="${set}"]`);
    if (finalizeBtn) {
      finalizeBtn.disabled = false;
      finalizeBtn.classList.remove('active');
      finalizeBtn.setAttribute('aria-pressed', 'false');
    }
  }

  const homeDisplay = document.getElementById('scoreGameHomeDisplay');
  const oppDisplay = document.getElementById('scoreGameOppDisplay');
  if (homeDisplay) homeDisplay.textContent = '00';
  if (oppDisplay) oppDisplay.textContent = '00';

  const timeoutContainer = document.getElementById('timeoutContainer');
  if (timeoutContainer) timeoutContainer.style.display = 'none';

  const timeoutStatus = document.getElementById('scoreGameTimeoutDisplay');
  if (timeoutStatus) timeoutStatus.textContent = '';

  const timeoutBar = document.getElementById('scoreGameTimeoutSrStatus');
  if (timeoutBar) {
    timeoutBar.style.width = '100%';
    timeoutBar.setAttribute('aria-valuenow', '60');
    timeoutBar.classList.add('bg-primary');
    timeoutBar.style.backgroundColor = '';
  }

  const timeoutLabel = document.getElementById('timeoutCenteredLabel');
  if (timeoutLabel) timeoutLabel.textContent = '1:00';

  document.querySelectorAll('.timeout-box').forEach((box) => {
    box.classList.add('available');
    box.classList.remove('used', 'active');
    box.setAttribute('aria-pressed', 'false');
  });
}

function resetFormForNewMatch() {
  removeMatchParamsFromUrl();
  resetMatchState();
  setActiveMatchId(null);

  const form = document.getElementById(FORM_ID);
  if (form) {
    form.reset();
    form.classList.remove('was-validated');
  }

  setDefaultDate();
  resetSetUi();
  clearStatus();
  document.dispatchEvent(new CustomEvent('volleyball:new-match-reset'));
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

  const hadExistingMatch = Boolean(state.matchId);
  if (hadExistingMatch) {
    resetFormForNewMatch();
  }

  const form = document.getElementById(FORM_ID);
  if (!hadExistingMatch && form && !form.checkValidity()) {
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
    if (matchId) {
      updateUrlWithMatchId(matchId);
    }
    refreshMatches();
  } catch (_error) {
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
