// js/api/matchCreate.js
import { state, resetMatchState } from '../state.js';
import { createMatch } from './ws.js';
import { refreshMatches } from './matches.js';
import { setActiveMatchId } from './matchMetaAutosave.js';
import { setDefaultDate } from '../init/date.js';
import { collectMatchPayload } from './matchPayload.js';
import { removeMatchParamsFromUrl, updateUrlWithMatchId } from './matchUrl.js';
import { setAutoSaveStatus, clearAutoSaveStatus } from '../ui/autoSaveStatus.js';
import { updateOpponentName } from '../ui/opponentName.js';

const NEW_MATCH_BUTTON_ID = 'newGameButton';
const FORM_ID = 'matchForm';
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
  clearAutoSaveStatus();
  updateOpponentName();
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
    setAutoSaveStatus('Please fix the highlighted fields before creating a match.', 'danger');
    return;
  }

  const payload = collectMatchPayload();

  toggleButtonLoading(true);
  setAutoSaveStatus('Creating match...', 'muted');

  try {
    const response = await createMatch(payload);
    if (!response || response.status >= 300) {
      const message = response?.body?.message || 'Request failed';
      throw new Error(message);
    }

    const matchId = response.body?.id ?? response.body?.match_id;
    setActiveMatchId(matchId);
    const successMsg = matchId ? `Match #${matchId} created.` : 'Match created.';
    setAutoSaveStatus(successMsg, 'success');
    if (matchId) {
      updateUrlWithMatchId(matchId);
    }
    refreshMatches();
  } catch (_error) {
    setAutoSaveStatus('Could not create match. Please try again.', 'danger');
  } finally {
    toggleButtonLoading(false);
  }
}

export function initMatchCreate() {
  clearAutoSaveStatus();
  const button = document.getElementById(NEW_MATCH_BUTTON_ID);
  if (!button) return;
  button.addEventListener('click', handleCreateMatch);
}
