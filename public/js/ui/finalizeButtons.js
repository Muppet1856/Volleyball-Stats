// js/ui/finalizeButtons.js
import { state, subscribe, updateState } from '../state.js';

function syncFinalizeUiFromState() {
  document.querySelectorAll('.finalize-button').forEach((btn) => {
    const setNumber = btn.dataset.set;
    const isFinalized = Boolean(state.sets?.[setNumber]?.finalized);

    applyFinalizedStyles(setNumber);
    setButtonState(btn, isFinalized);
  });

  updateSetAccess();
}

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.finalize-button').forEach(btn => {
    const setNumber = btn.dataset.set;

    btn.addEventListener('click', () => {
      // Derive desired state from our source of truth (state), not from Bootstrap's class toggling order.
      const isCurrentlyFinalized = state.sets[setNumber].finalized;
      const willFinalize = !isCurrentlyFinalized;
      if (willFinalize) {
        const scores = getValidatedScores(setNumber);
        if (!scores) {
          // Invalid attempt: keep the button unselected/unchanged.
          setButtonState(btn, isCurrentlyFinalized);
          return;
        }

        const winner = scores.home > scores.opp ? 'home' : 'opp';
        updateState({
          sets: {
            [setNumber]: {
              scores,
              winner,
              finalized: true,
            },
          },
        });
      } else {
        updateState({
          sets: {
            [setNumber]: { winner: null, finalized: false }
          }
        });
      }

      recalculateMatchWinsFromSets();
      applyFinalizedStyles(setNumber);
      updateSetAccess();  // Recompute access after change
      setButtonState(btn, state.sets[setNumber].finalized);
    });
  });

  recalculateMatchWinsFromSets(); // Ensure totals align with any pre-finalized sets on load
  syncFinalizeUiFromState();
  subscribe(syncFinalizeUiFromState);
});

function updateSetAccess() {
  const currentSet = getCurrentSetNumber();

  for (let set = 1; set <= 5; set++) {
    const isCurrent = currentSet === set;
    const finalized = state.sets[set].finalized;

    const row = document.querySelector(`#scoring-table tr:nth-child(${set + 1})`);
    const scoreBtn = row ? row.querySelector('.score-game-btn') : null;
    const finalizeBtn = row ? row.querySelector('.finalize-button') : null;
    const homeInput = document.getElementById(`set${set}Home`);
    const oppInput = document.getElementById(`set${set}Opp`);

    if (row) {
      row.classList.toggle('set-locked', !isCurrent);
    }

    const disableScores = !isCurrent || finalized;
    if (scoreBtn) scoreBtn.disabled = !isCurrent;
    if (homeInput) homeInput.disabled = disableScores;
    if (oppInput) oppInput.disabled = disableScores;

    // Allow recalculation on finalized sets, but block future sets.
    if (finalizeBtn) finalizeBtn.disabled = !isCurrent && !finalized;
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

function readScoreFromInput(setNumber, team) {
  const input = document.getElementById(`set${setNumber}${team === 'home' ? 'Home' : 'Opp'}`);
  if (!input) {
    return { value: null, present: false, empty: true };
  }
  const raw = input.value;
  if (raw === '') {
    return { value: null, present: true, empty: true };
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? { value: parsed, present: true, empty: false }
    : { value: null, present: true, empty: true };
}

function getValidatedScores(setNumber) {
  const homeInput = readScoreFromInput(setNumber, 'home');
  const oppInput = readScoreFromInput(setNumber, 'opp');
  const stateScores = state.sets[setNumber]?.scores || {};

  const homeScore = homeInput.value ?? stateScores.home;
  const oppScore = oppInput.value ?? stateScores.opp;

  const missing = (homeInput.present && homeInput.empty) || (oppInput.present && oppInput.empty);
  const invalid = !Number.isFinite(homeScore) || !Number.isFinite(oppScore);

  if (missing || invalid) {
    window.alert('Enter a score for both teams before marking the set final.');
    return null;
  }

  if (homeScore === oppScore) {
    window.alert('Sets cannot end in a tie. Adjust the scores before marking final.');
    return null;
  }

  return { home: Number(homeScore), opp: Number(oppScore) };
}

function getCurrentSetNumber() {
  for (let set = 1; set <= 5; set++) {
    if (!state.sets[set].finalized) {
      return set;
    }
  }
  return null;
}

function recalculateMatchWinsFromSets() {
  const totals = { home: 0, opp: 0 };
  for (let set = 1; set <= 5; set++) {
    const setState = state.sets[set];
    if (setState.finalized && setState.winner) {
      totals[setState.winner] += 1;
    }
  }
  updateState({ matchWins: totals });
}

function setButtonState(btn, isActive) {
  btn.classList.toggle('active', isActive);
  btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
}
