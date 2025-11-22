// ui/finalizeButtons.js
import { state, updateState } from '../state.js';
import { syncMatchResults } from './resultSummary.js';

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.finalize-button').forEach(btn => {
    const setNumber = btn.dataset.set;
    // Initial state sync (if loaded from saved match)
    if (state.sets[setNumber].finalized) {
      btn.classList.add('active');
      toggleSetElements(setNumber, true);
      applyFinalizedStyles(setNumber);
    }
    // Initial sync for results (called per button but idempotent)
    syncMatchResults();

    btn.addEventListener('click', () => {
      const finalized = btn.classList.contains('active');
      const scores = state.sets[setNumber].scores;
      let winner = null;

      if (finalized) {
        if (scores.home > scores.opp) {
          winner = 'home';
        } else if (scores.opp > scores.home) {
          winner = 'opp';
        }
        // If tie, winner remains null, no increment
        if (winner) {
          updateState({
            matchWins: { [winner]: state.matchWins[winner] + 1 }
          });
        }
        updateState({
          sets: {
            [setNumber]: { winner, finalized: true }
          }
        });
      } else {
        const prevWinner = state.sets[setNumber].winner;
        if (prevWinner) {
          updateState({
            matchWins: { [prevWinner]: state.matchWins[prevWinner] - 1 }
          });
        }
        updateState({
          sets: {
            [setNumber]: { winner: null, finalized: false }
          }
        });
      }

      toggleSetElements(setNumber, finalized);
      applyFinalizedStyles(setNumber);
      syncMatchResults();  // Sync dropdowns after change
    });
  });
});

function toggleSetElements(setNumber, disable) {
  const scoreBtn = document.querySelector(`[data-set="${setNumber}"].score-game-btn`);
  if (scoreBtn) {
    scoreBtn.disabled = disable;
  }
  const homeInput = document.getElementById(`set${setNumber}Home`);
  const oppInput = document.getElementById(`set${setNumber}Opp`);
  if (homeInput) homeInput.disabled = disable;
  if (oppInput) oppInput.disabled = disable;
}

function applyFinalizedStyles(setNumber) {
  const row = document.querySelector(`#scoring-table tr:nth-child(${parseInt(setNumber) + 1})`);
  if (!row) return;

  const finalized = state.sets[setNumber].finalized;
  const winner = state.sets[setNumber].winner;

  row.classList.toggle('set-finalized', finalized);

  const homeCell = row.querySelector(`#set${setNumber}Home`).parentElement;
  const oppCell = row.querySelector(`#set${setNumber}Opp`).parentElement;

  homeCell.classList.remove('set-winner', 'set-loser');
  oppCell.classList.remove('set-winner', 'set-loser');

  if (finalized && winner) {
    if (winner === 'home') {
      homeCell.classList.add('set-winner');
      oppCell.classList.add('set-loser');
    } else {
      oppCell.classList.add('set-winner');
      homeCell.classList.add('set-loser');
    }
  }
}