// ui/scoreModals.js
import { startTimeoutCountdown, resetTimeoutCountdown } from './timeOut.js'; // Adjust path if needed
// Function to pad scores to two digits
function padScore(score) {
  return String(score).padStart(2, '0');
}

// Handle modal show event to load scores from the calling set
const scoreGameModal = document.getElementById('scoreGameModal');
if (scoreGameModal) {
  scoreGameModal.addEventListener('show.bs.modal', (event) => {
    const button = event.relatedTarget; // The button that triggered the modal
    const setNumber = button.getAttribute('data-set');
    if (!setNumber) return;

    // Store the current set on the modal for later reference
    scoreGameModal.dataset.currentSet = setNumber;

    // Load scores from the table inputs
    const homeInput = document.getElementById(`set${setNumber}Home`);
    const oppInput = document.getElementById(`set${setNumber}Opp`);
    const homeDisplay = document.getElementById('scoreGameHomeDisplay');
    const oppDisplay = document.getElementById('scoreGameOppDisplay');

    if (homeInput && oppInput && homeDisplay && oppDisplay) {
      homeDisplay.textContent = padScore(homeInput.value || 0);
      oppDisplay.textContent = padScore(oppInput.value || 0);
    }

    // Initialize global state if not present
    if (!window.setTimeouts) window.setTimeouts = {};
    if (!window.setTimeouts[setNumber]) {
      window.setTimeouts[setNumber] = {
        home: [false, false],
        opp: [false, false]
      };
    }

    // Load timeout states
    const timeoutBoxes = scoreGameModal.querySelectorAll('.timeout-box');
    timeoutBoxes.forEach((box) => {
      const team = box.dataset.team;
      const index = parseInt(box.dataset.timeoutIndex);
      const used = window.setTimeouts[setNumber][team][index];
      box.setAttribute('aria-pressed', used ? 'true' : 'false');
      box.classList.toggle('used', used);
      box.classList.toggle('available', !used);
      box.classList.remove('active'); // active only during timer
      const teamName = team === 'home' ? 'Home Team' : 'Opponent';
      const ord = index + 1 === 1 ? 'first' : 'second';
      box.setAttribute('aria-label', `${teamName} ${ord} timeout ${used ? 'used' : 'available'}`);
    });

    // Optional: Reset timeout display
    const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
    if (timeoutDisplay) {
      timeoutDisplay.textContent = '';
    }
  });

  scoreGameModal.addEventListener('hide.bs.modal', () => {
    resetTimeoutCountdown();
  });
}

// Handle score changes via increment/decrement zones
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

  display.textContent = padScore(score);
  input.value = score;

  // Optional: Trigger input event for any bound listeners (e.g., validation or auto-save)
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Attach event listeners to score zones
const scoreZones = document.querySelectorAll('.score-zone');
scoreZones.forEach((zone) => {
  zone.addEventListener('click', handleScoreChange);
  // Optional: Add keydown for accessibility (e.g., Enter/Space to trigger)
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleScoreChange(event);
    }
  });
});

// Note: Timeout click handlers are now in timeOut.js

// Note: If timeouts need to be persisted per set (e.g., which ones are used), 
// you can extend this by storing state in a global object or using state.js.
// For example, on modal show, load pressed states from data attributes on the set row.

// To integrate: Add the following line to volleyball_stats.js inside the DOMContentLoaded listener:
// import './ui/scoreModals.js';

// Regarding Cloudflare Workers integration:
// This client-side logic runs in the browser and doesn't directly interact with the Workers or Durable Objects.
// To persist match data (including scores), you'll need to add save/load logic that sends data to your Worker endpoint,
// using atomic operations (e.g., transactions in SQLite via D1) to avoid clobbering updates.
// For example, on score change, debounce and send a PATCH request to update the specific set's score in the DO.