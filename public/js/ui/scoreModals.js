// ui/scoreModals.js (updated)
import { state, updateState } from '../state.js';  // Add this import
import { startTimeoutCountdown, resetTimeoutCountdown } from './timeOut.js';

function padScore(score) {
  return String(score).padStart(2, '0');
}

const scoreGameModal = document.getElementById('scoreGameModal');
if (scoreGameModal) {
  scoreGameModal.addEventListener('show.bs.modal', (event) => {
    const button = event.relatedTarget;
    const setNumber = button.getAttribute('data-set');
    if (!setNumber) return;

    scoreGameModal.dataset.currentSet = setNumber;

    // Keep loading scores from DOM (table inputs)
    const homeInput = document.getElementById(`set${setNumber}Home`);
    const oppInput = document.getElementById(`set${setNumber}Opp`);
    const homeDisplay = document.getElementById('scoreGameHomeDisplay');
    const oppDisplay = document.getElementById('scoreGameOppDisplay');

    if (homeInput && oppInput && homeDisplay && oppDisplay) {
      homeDisplay.textContent = padScore(homeInput.value || 0);
      oppDisplay.textContent = padScore(oppInput.value || 0);
    }

    // Remove window.setTimeouts init (migrated to timeOut.js)
    // Load timeouts UI from state (minimal init; see timeOut.js for details)

    const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
    if (timeoutDisplay) {
      timeoutDisplay.textContent = '';
    }
  });

  scoreGameModal.addEventListener('hide.bs.modal', () => {
    resetTimeoutCountdown();
  });
}

function handleScoreChange(event) {
  const zone = event.currentTarget;
  const team = zone.dataset.team;
  const action = zone.dataset.action;
  const modal = document.getElementById('scoreGameModal');
  const setNumber = modal.dataset.currentSet;

  if (!setNumber) return;

  const displayId = (team === 'home') ? 'scoreGameHomeDisplay' : 'scoreGameOppDisplay';
  const inputId = (team === 'home') ? `set${setNumber}Home` : `set${setNumber}Opp`;
  const display = document.getElementById(displayId);
  const input = document.getElementById(inputId);

  if (!display || !input) return;

  let score = parseInt(display.textContent, 10) || 0;

  if (action === 'increment') {
    score += 1;
  } else if (action === 'decrement' && score > 0) {
    score -= 1;
  }

  // Keep direct UI updates
  display.textContent = padScore(score);
  input.value = score;
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // Add: Sync to state (no UI change here)
  updateState({
    sets: {
      [setNumber]: {
        scores: { [team]: score }
      }
    }
  });
}

// Attach event listeners (unchanged)
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