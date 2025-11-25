// js/ui/resultSummary.js
import { state, updateState, subscribe } from '../state.js';

function syncMatchResults(matchWins = state.matchWins) {
  const homeSelect = document.getElementById('resultHome');
  const oppSelect = document.getElementById('resultOpp');
  const homeValue = Number(matchWins?.home) || 0;
  const oppValue = Number(matchWins?.opp) || 0;
  if (homeSelect) homeSelect.value = homeValue.toString();
  if (oppSelect) oppSelect.value = oppValue.toString();
}

function calculateOverallWinner(matchWins = state.matchWins) {
  let winner = null;
  const homeWins = Number(matchWins?.home) || 0;
  const oppWins = Number(matchWins?.opp) || 0;

  if (homeWins >= 3 && oppWins < 3) {
    winner = 'home';
  } else if (oppWins >= 3 && homeWins < 3) {
    winner = 'opp';
  }
  return winner;
}

function applyOverallWinner(matchWins = state.matchWins) {
  const winner = calculateOverallWinner(matchWins);
  if (state.overallWinner !== winner) {
    updateState({ overallWinner: winner });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  syncMatchResults();
  applyOverallWinner(); // Initial check

  const homeSelect = document.getElementById('resultHome');
  const oppSelect = document.getElementById('resultOpp');

  if (homeSelect) {
    homeSelect.addEventListener('change', () => {
      const value = parseInt(homeSelect.value, 10) || 0;
      updateState({ matchWins: { home: value } });
    });
  }

  if (oppSelect) {
    oppSelect.addEventListener('change', () => {
      const value = parseInt(oppSelect.value, 10) || 0;
      updateState({ matchWins: { opp: value } });
    });
  }

  subscribe((nextState) => {
    syncMatchResults(nextState.matchWins);
    applyOverallWinner(nextState.matchWins);
  });
});

export { syncMatchResults };
