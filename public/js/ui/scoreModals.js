// ui/scoreModals.js (fully refactored to state-mapped)
import { state, updateState } from '../state.js'; // New import
import { renderModal } from './renderScoringModal.js'; // New import
import { resetTimeoutCountdown } from './timeOut.js'; // Adjusted (removed start, as it's in timeOut.js)
import { applyDisableLogic } from './renderHelpers.js'; // New import

// Function to pad scores to two digits
function padScore(score) {
  return String(score).padStart(2, '0');
}

// Handle modal show: Sync from table inputs to state, then render
const scoreGameModal = document.getElementById('scoreGameModal');
if (scoreGameModal) {
  scoreGameModal.addEventListener('show.bs.modal', (event) => {
    const button = event.relatedTarget;
    const setNumber = parseInt(button.getAttribute('data-set'));
    if (!setNumber) return;
    if (state.sets[setNumber].finalized) {
      document.querySelectorAll('.score-zone, .timeout-box').forEach(el => el.disabled = true);
    }

    // Load scores from table inputs into state
    const homeInput = document.getElementById(`set${setNumber}Home`);
    const oppInput = document.getElementById(`set${setNumber}Opp`);
    const homeScore = parseInt(homeInput?.value || 0, 10);
    const oppScore = parseInt(oppInput?.value || 0, 10);

    // Initialize or update set in state
    const currentSetData = state.sets[setNumber] || { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] } };
    updateState({
      currentSet: setNumber,
      isModalOpen: true,
      sets: {
        ...state.sets,
        [setNumber]: {
          ...currentSetData,
          scores: { home: homeScore, opp: oppScore }
        }
      }
    }, renderModal); // Render after sync
  });

  scoreGameModal.addEventListener('hide.bs.modal', () => {
    updateState({ isModalOpen: false }, resetTimeoutCountdown);
    
    // On hide, sync state back to table inputs to ensure blanks are set to 0
    const setNumber = state.currentSet;
    if (setNumber) {
      const homeInput = document.getElementById(`set${setNumber}Home`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      const scores = state.sets[setNumber]?.scores || { home: 0, opp: 0 };
      if (homeInput) {
        homeInput.value = scores.home.toString();
      }
      if (oppInput) {
        oppInput.value = scores.opp.toString();
      }
    }
  });
}

// Handle score changes: Update state, then render
function handleScoreChange(event) {
  if (state.sets[state.currentSet]?.finalized) return;

  const team = event.currentTarget.dataset.team;
  const action = event.currentTarget.dataset.action;
  const setNumber = state.currentSet;
  let score = state.sets[setNumber].scores[team];

  if (action === 'increment') {
    score += 1;
  } else if (action === 'decrement' && score > 0) {
    score -= 1;
  }

  // Optional: Prevent invalid scores (e.g., can't decrement below 0)
  score = Math.max(0, score);

  updateState({
    sets: {
      ...state.sets,
      [setNumber]: {
        ...state.sets[setNumber],
        scores: { ...state.sets[setNumber].scores, [team]: score }
      }
    }
  }, renderModal);

  const inputId = (team === 'home') ? `set${setNumber}Home` : `set${setNumber}Opp`;
  const input = document.getElementById(inputId);
  if (input) {
    input.value = score;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Attach event listeners to score zones
const scoreZones = document.querySelectorAll('.score-zone');
scoreZones.forEach((zone) => {
  zone.addEventListener('click', handleScoreChange);
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleScoreChange(event);
    }
  });
});

// Note: Timeout clicks are handled in timeOut.js (no changes here)
// For persistence: Add debounce/save logic here on state updates (e.g., to Cloudflare Worker)