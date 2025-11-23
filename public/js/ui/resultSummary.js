// js/ui/resultSummary.js
import { state, updateState } from '../state.js';

function syncMatchResults() {
  const homeSelect = document.getElementById('resultHome');
  const oppSelect = document.getElementById('resultOpp');
  if (homeSelect) homeSelect.value = state.matchWins.home.toString();
  if (oppSelect) oppSelect.value = state.matchWins.opp.toString();
}

function checkOverallWinner() {
  let winner = null;
  if (state.matchWins.home >= 3 && state.matchWins.opp < 3) {
    winner = 'home';
  } else if (state.matchWins.opp >= 3 && state.matchWins.home < 3) {
    winner = 'opp';
  }
  updateState({ overallWinner: winner });
}

window.addEventListener('DOMContentLoaded', () => {
  syncMatchResults();
  checkOverallWinner(); // Initial check

  const homeSelect = document.getElementById('resultHome');
  const oppSelect = document.getElementById('resultOpp');

  if (homeSelect) {
    homeSelect.addEventListener('change', () => {
      const value = parseInt(homeSelect.value, 10) || 0;
      updateState({ matchWins: { home: value } });
      checkOverallWinner();
    });
  }

  if (oppSelect) {
    oppSelect.addEventListener('change', () => {
      const value = parseInt(oppSelect.value, 10) || 0;
      updateState({ matchWins: { opp: value } });
      checkOverallWinner();
    });
  }
});

export { syncMatchResults };