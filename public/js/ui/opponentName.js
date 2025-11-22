import { debounce } from '../utils/debounce.js';
import { updateState } from '../state.js';

export const debouncedOpponentUpdate = debounce(() => {
  updateOpponentName();
}, 800);

export function updateOpponentName() {
  const OPP_TEAM_FALLBACK = 'Opponent';
  const pattern = /\{oppTeam\}/g;
  const opponentInput = document.getElementById('opponent');
  const currentValue = opponentInput ? opponentInput.value : 'No input';  // Snapshot here
  let oppName = opponentInput ? opponentInput.value.trim() : OPP_TEAM_FALLBACK;
  if (!oppName) oppName = OPP_TEAM_FALLBACK;
  document.querySelectorAll('[data-opp-team-template]').forEach(el => {
    const tmpl = el.getAttribute('data-opp-team-template');
    if (tmpl) el.textContent = tmpl.replace(pattern, oppName);
  });
<<<<<<< Updated upstream
}
=======
  updateState({ opponent: oppName });
}
>>>>>>> Stashed changes
