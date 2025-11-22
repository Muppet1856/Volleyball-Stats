// ui/opponentName.js (updated to sync with state)
import { debounce } from '../utils/debounce.js';
import { state, updateState } from '../state.js'; // New import
import { renderModal } from './renderScoringModal.js'; // New import for re-render if modal open

export const debouncedOpponentUpdate = debounce(() => {
  updateOpponentName();
}, 800);

export function updateOpponentName() {
  const OPP_TEAM_FALLBACK = 'Opponent';
  const pattern = /\{oppTeam\}/g;
  const opponentInput = document.getElementById('opponent');
  let oppName = opponentInput ? opponentInput.value.trim() : OPP_TEAM_FALLBACK;
  if (!oppName) oppName = OPP_TEAM_FALLBACK;

  // Update central state with new opponent name
  updateState({ opponent: oppName });

  document.querySelectorAll('[data-opp-team-template]').forEach(el => {
    const tmpl = el.getAttribute('data-opp-team-template');
    if (tmpl) el.textContent = tmpl.replace(pattern, oppName);
  });

  // If modal is open, re-render to reflect name change
  if (state.isModalOpen) {
    renderModal();
  }
}