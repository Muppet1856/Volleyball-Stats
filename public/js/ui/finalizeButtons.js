// ui/finalizeButtons.js
import { state, updateState } from '../state.js';

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.finalize-button').forEach(btn => {
    const setNumber = btn.dataset.set;
    // Initial state sync (if loaded from saved match)
    if (state.sets[setNumber].finalized) {
      btn.classList.add('active');
      applyFinalizedStyles(setNumber);
    }

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

      applyFinalizedStyles(setNumber);
      updateSetAccess();  // Recompute access after change
    });
  });

  updateSetAccess();  // Initial access setup
});

function updateSetAccess() {
  let previousFinalized = true;  // Set 1 always unlocked

  for (let set = 1; set <= 5; set++) {
    const unlocked = previousFinalized;
    const finalized = state.sets[set].finalized;

    const row = document.querySelector(`#scoring-table tr:nth-child(${set + 1})`);
    const scoreBtn = row ? row.querySelector('.score-game-btn') : null;
    const finalizeBtn = row ? row.querySelector('.finalize-button') : null;
    const homeInput = document.getElementById(`set${set}Home`);
    const oppInput = document.getElementById(`set${set}Opp`);

    if (row) {
      row.classList.toggle('set-locked', !unlocked);
    }

    if (unlocked) {
      if (scoreBtn) scoreBtn.disabled = finalized;
      if (homeInput) homeInput.disabled = finalized;
      if (oppInput) oppInput.disabled = finalized;
      if (finalizeBtn) finalizeBtn.disabled = false;
    } else {
      if (scoreBtn) scoreBtn.disabled = true;
      if (homeInput) homeInput.disabled = true;
      if (oppInput) oppInput.disabled = true;
      if (finalizeBtn) finalizeBtn.disabled = true;
    }

    previousFinalized = finalized;
  }
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