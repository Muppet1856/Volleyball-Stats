// js/ui/opponentName.js
import { debounce } from '../utils/debounce.js';
import { state, updateState } from '../state.js';

export const debouncedOpponentUpdate = debounce(() => {
  updateOpponentName();
}, 800);

export function updateOpponentName() {
  const OPP_TEAM_FALLBACK = 'Opponent';
  const pattern = /\{oppTeam\}/g;
  const opponentInput = document.getElementById('opponent');
  const rawInput = opponentInput ? opponentInput.value : undefined;
  const trimmed = rawInput ? rawInput.trim() : '';
  const nextOpponent = trimmed || state.opponent || OPP_TEAM_FALLBACK;

  document.querySelectorAll('[data-opp-team-template]').forEach(el => {
    const tmpl = el.getAttribute('data-opp-team-template');
    if (tmpl) el.textContent = tmpl.replace(pattern, nextOpponent);
  });

  if (state.opponent !== nextOpponent) {
    updateState({ opponent: nextOpponent });
  }
}
