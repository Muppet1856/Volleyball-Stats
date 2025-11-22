// timeOut.js (updated for state integration and declarative renders)
import { state, updateState } from '../state.js'; // New: Required for state access
import { renderModal } from './renderScoringModal.js'; // New: For re-renders on timer tick

let countdownInterval = null;
let currentActiveButton = null;
let remaining = 0;  // Transient remaining seconds

export function resetTimeoutCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  remaining = 0;
  currentActiveButton = null;
  renderModal(); // Re-render to clear UI
}

export function startTimeoutCountdown(button) {
  const duration = 60;
  remaining = duration;
  currentActiveButton = button;

  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  countdownInterval = setInterval(() => {
    remaining = Math.max(remaining - 1, 0);
    renderModal(); // Re-render on each tick (updates bar/label)

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      currentActiveButton = null;
      renderModal(); // Final render to hide/clear
    }
  }, 1000);

  renderModal(); // Initial render to show start
}

// New exports unchanged...
export function getActiveTimeout() {
  if (!currentActiveButton) return null;
  return {
    team: currentActiveButton.dataset.team,
    index: parseInt(currentActiveButton.dataset.timeoutIndex),
    isBlue: currentActiveButton.classList.contains('team-blue')
  };
}

export function getRemaining() {
  return remaining;
}

function handleTimeoutClick(e) {
  const box = e.target.closest('.timeout-box');
  if (!box) return;

  const setNumber = state.currentSet;
  if (!setNumber) return;

  const team = box.dataset.team;
  const index = parseInt(box.dataset.timeoutIndex);
  const isPressed = box.getAttribute('aria-pressed') === 'true';

  if (isPressed) {
    // Deselect, update state, reset timer
    updateState({
      sets: {
        ...state.sets,
        [setNumber]: {
          ...state.sets[setNumber],
          timeouts: {
            ...state.sets[setNumber].timeouts,
            [team]: state.sets[setNumber].timeouts[team].map((val, i) => i === index ? false : val)
          }
        }
      }
    }, renderModal);
    resetTimeoutCountdown();
  } else {
    // Select, update state, start timer
    updateState({
      sets: {
        ...state.sets,
        [setNumber]: {
          ...state.sets[setNumber],
          timeouts: {
            ...state.sets[setNumber].timeouts,
            [team]: state.sets[setNumber].timeouts[team].map((val, i) => i === index ? true : val)
          }
        }
      }
    }, renderModal);
    startTimeoutCountdown(box);
  }
}

// Event listeners (add to DOMContentLoaded or ensure they're attached)
window.addEventListener("DOMContentLoaded", () => {
  const timeoutBoxes = document.querySelectorAll('.timeout-box');
  timeoutBoxes.forEach(box => {
    box.classList.add('available');
    box.addEventListener('click', handleTimeoutClick);
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest('.timeout-box') || e.target.closest('#timeoutContainer')) {
      return;
    }
    resetTimeoutCountdown();
  });
});