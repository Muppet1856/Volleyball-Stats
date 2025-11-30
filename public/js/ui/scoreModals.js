// js/ui/scoreModals.js (updated)
import { state, updateState } from '../state.js';  // Add this import
import { saveScore } from '../api/scoring.js';
import { resetTimeoutCountdown } from './timeOut.js';

function padScore(score) {
  return String(score).padStart(2, '0');
}

function ensurePairedScore(setNum, team) {
  const otherTeam = team === 'home' ? 'opp' : 'home';
  const otherInputId = otherTeam === 'home' ? `set${setNum}Home` : `set${setNum}Opp`;
  const otherDisplayId = otherTeam === 'home' ? 'scoreGameHomeDisplay' : 'scoreGameOppDisplay';
  const otherInput = document.getElementById(otherInputId);

  if (!otherInput) return;
  const raw = otherInput.value;
  const parsed = parseInt(raw, 10);
  if (raw === '' || Number.isNaN(parsed)) {
    otherInput.value = 0;
    updateState({
      sets: {
        [setNum]: {
          scores: { [otherTeam]: 0 },
        },
      },
    });
    saveScore(otherTeam, Number(setNum), 0);

    const modal = document.getElementById('scoreGameModal');
    if (modal && modal.classList.contains('show') && modal.dataset.currentSet === String(setNum)) {
      const otherDisplay = document.getElementById(otherDisplayId);
      if (otherDisplay) {
        otherDisplay.textContent = padScore(0);
      }
    }
  }
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
  ensurePairedScore(setNumber, team);
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

// Sync table inputs to state on direct edit or modal update
window.addEventListener('DOMContentLoaded', () => {
  const allSetInputs = document.querySelectorAll('input[id^="set"][id$="Home"], input[id^="set"][id$="Opp"]');
  allSetInputs.forEach(input => {
    input.addEventListener('input', () => {
      const inputId = input.id;
      const match = inputId.match(/set(\d+)(Home|Opp)/);
      if (!match) return;
      const setNum = match[1];
      const side = match[2];
      const team = side.toLowerCase() === 'home' ? 'home' : 'opp';
      const score = parseInt(input.value, 10) || 0;
      input.value = score;  // Normalize input to integer
      updateState({
        sets: {
          [setNum]: {
            scores: { [team]: score }
          }
        }
      });
      saveScore(team, Number(setNum), score);
      ensurePairedScore(setNum, team);
      // If modal is open for this set, sync display
      const modal = document.getElementById('scoreGameModal');
      if (modal && modal.classList.contains('show') && modal.dataset.currentSet === setNum) {
        const displayId = side === 'Home' ? 'scoreGameHomeDisplay' : 'scoreGameOppDisplay';
        const display = document.getElementById(displayId);
        if (display) {
          display.textContent = padScore(score);
        }
      }
    });
  });
});
