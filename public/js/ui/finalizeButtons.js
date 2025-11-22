// ui/finalizeButtons.js (updated with volleyball rules)
import { state, updateState } from '../state.js';
import { renderModal } from './renderScoringModal.js';
import { renderMatchResults } from './renderHelpers.js'; // Removed applyDisableLogic from import, defining it here

// Define applyDisableLogic here for completeness
function applyDisableLogic() {
  const isMatchDecided = state.matchWins.home >= 3 || state.matchWins.opp >= 3;
  let activeSet = null;
  for (let i = 1; i <= 5; i++) {
    if (!state.sets[i].finalized) {
      activeSet = i;
      break;
    }
  }

  for (let setNumber = 1; setNumber <= 5; setNumber++) {
    const tr = document.querySelector(`#scoring-table tr:nth-child(${setNumber + 1})`); // Header is first tr
    const homeInput = document.getElementById(`set${setNumber}Home`);
    const oppInput = document.getElementById(`set${setNumber}Opp`);
    const scoreBtn = tr.querySelector('.score-game-btn');
    const finalizeBtn = tr.querySelector('.finalize-button');

    if (state.sets[setNumber].finalized) {
      homeInput.disabled = true;
      oppInput.disabled = true;
      scoreBtn.disabled = true;
      finalizeBtn.disabled = false; // Allow unfinalize
      tr.style.opacity = '1';
    } else {
      const isActive = (setNumber === activeSet) && !isMatchDecided;
      homeInput.disabled = !isActive;
      oppInput.disabled = !isActive;
      scoreBtn.disabled = !isActive;
      finalizeBtn.disabled = !isActive;
      tr.style.opacity = isActive ? '1' : '0.5';
    }
  }
}

// Toggle finalize for a set
function handleFinalizeToggle(event) {
  const setNumber = parseInt(event.target.dataset.set);
  if (!setNumber) return;

  const isFinalized = state.sets[setNumber].finalized;
  const scores = state.sets[setNumber].scores;

  if (isFinalized) {
    // Un-finalize: Decrement wins if applicable
    const setWinner = getSetWinner(scores.home, scores.opp, setNumber);
    updateState({
      sets: {
        ...state.sets,
        [setNumber]: { ...state.sets[setNumber], finalized: false }
      },
      matchWins: {
        home: state.matchWins.home - (setWinner === 'home' ? 1 : 0),
        opp: state.matchWins.opp - (setWinner === 'opp' ? 1 : 0)
      },
      overallWinner: null  // Reset
    });
  } else {
    // Check if match is already decided before finalizing a new set
    if (state.matchWins.home >= 3 || state.matchWins.opp >= 3) {
      alert('The match is already decided. Cannot finalize additional sets.');
      return;
    }

    // Finalize: Check valid win, increment wins
    const setWinner = getSetWinner(scores.home, scores.opp, setNumber);
    if (!setWinner) {
      // Instead of alert, show Bootstrap popover
      const button = event.target;
      button.setAttribute('data-bs-content', 'Cannot finalize: One team must have a higher score (no ties). For full rules, see documentation.');
      button.setAttribute('data-bs-trigger', 'manual');
      button.setAttribute('data-bs-placement', 'top');
      const popover = new bootstrap.Popover(button);
      popover.show();
      setTimeout(() => {
        popover.dispose();
        button.removeAttribute('data-bs-content');
        button.removeAttribute('data-bs-trigger');
        button.removeAttribute('data-bs-placement');
      }, 5000);
      return;
    }
    const newWins = {
      home: state.matchWins.home + (setWinner === 'home' ? 1 : 0),
      opp: state.matchWins.opp + (setWinner === 'opp' ? 1 : 0)
    };
    let overallWinner = null;
    if (newWins.home >= 3 || newWins.opp >= 3) {  // Best of 5: first to 3
      overallWinner = newWins.home > newWins.opp ? 'home' : 'opp';
    }

    updateState({
      sets: {
        ...state.sets,
        [setNumber]: { ...state.sets[setNumber], finalized: true }
      },
      matchWins: newWins,
      overallWinner
    });
  }

  // Re-apply disables, update button UI, re-render
  applyDisableLogic();
  updateFinalizeButtonUI(event.target, !isFinalized);
  renderMatchResults();
  if (state.isModalOpen && state.currentSet === setNumber) {
    renderModal();
  }

  // Update the match result dropdowns
  document.getElementById('resultHome').value = state.matchWins.home.toString();
  document.getElementById('resultOpp').value = state.matchWins.opp.toString();
}

// Volleyball-specific set winner logic (simplified, no point rules enforcement)
function getSetWinner(homeScore, oppScore, setNumber) {
  if (homeScore < 0 || oppScore < 0) return null; // Invalid scores

  if (homeScore > oppScore) {
    return 'home';
  }
  if (oppScore > homeScore) {
    return 'opp';
  }
  return null; // Tie
}

// Add event listeners to all finalize buttons
document.querySelectorAll('.finalize-button').forEach(button => {
  button.addEventListener('click', handleFinalizeToggle);
});

// Apply disable logic on initial load and add input listeners
document.addEventListener('DOMContentLoaded', () => {
  applyDisableLogic();

  // Add event listeners for score inputs to update state
  for (let setNumber = 1; setNumber <= 5; setNumber++) {
    const homeInput = document.getElementById(`set${setNumber}Home`);
    const oppInput = document.getElementById(`set${setNumber}Opp`);

    homeInput.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) || 0;
      updateState({
        sets: {
          ...state.sets,
          [setNumber]: {
            ...state.sets[setNumber],
            scores: {
              ...state.sets[setNumber].scores,
              home: value
            }
          }
        }
      });
      if (oppInput.value === '') {
        oppInput.value = '0';
        oppInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    oppInput.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) || 0;
      updateState({
        sets: {
          ...state.sets,
          [setNumber]: {
            ...state.sets[setNumber],
            scores: {
              ...state.sets[setNumber].scores,
              opp: value
            }
          }
        }
      });
      if (homeInput.value === '') {
        homeInput.value = '0';
        homeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Add blur listeners to set blank to '0'
    homeInput.addEventListener('blur', (e) => {
      if (e.target.value === '') {
        e.target.value = '0';
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    oppInput.addEventListener('blur', (e) => {
      if (e.target.value === '') {
        e.target.value = '0';
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }
});

// Optional: Define updateFinalizeButtonUI if not defined elsewhere
function updateFinalizeButtonUI(button, isFinalized) {
  // Assuming Bootstrap toggle handles it, but can add custom logic if needed
  button.classList.toggle('active', isFinalized);
  button.setAttribute('aria-pressed', isFinalized.toString());
}