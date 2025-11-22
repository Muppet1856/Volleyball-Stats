<<<<<<< Updated upstream
// Updated timeOut.js (full replacement with remaining param and auto-unpress on end)
import { state } from '../state.js'; // Add this import if needed for save, but since called from scoreModals, optional
=======
// timeOut.js
import { state, updateState } from '../state.js';  // Add this import
let countdownInterval = null;
let currentActiveButton = null;
>>>>>>> Stashed changes

let countdownInterval = null;
const defaultTeamColorMap = {
  home: 'bg-primary',
  opp: 'bg-danger',
};

const swappedTeamColorMap = {
  home: 'bg-danger',
  opp: 'bg-primary',
};

export function getTimeoutTeamColorMap(isSwapped = state.isTimeoutColorSwapped) {
  return isSwapped ? swappedTeamColorMap : defaultTeamColorMap;
}

function applyTimeoutColorClass(bar, team, teamColorMap = defaultTeamColorMap) {
  if (!bar || !team) return;

  const colorsToRemove = new Set(Object.values(defaultTeamColorMap));
  Object.values(teamColorMap || {}).forEach(colorClass => colorsToRemove.add(colorClass));

  bar.classList.remove(...colorsToRemove);

  const colorClass = (teamColorMap && teamColorMap[team]) || defaultTeamColorMap[team];
  if (colorClass) {
    bar.classList.add(colorClass);
  }
}

export function resetTimeoutCountdown() {
  const container = document.getElementById("timeoutContainer");
  const bar = document.getElementById("scoreGameTimeoutSrStatus");
  const label = document.getElementById("timeoutCenteredLabel");

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  if (bar) {
    bar.style.width = "0%";
    bar.setAttribute("aria-valuenow", 0);
  }

  if (label) {
    label.textContent = "";
  }

  if (container) {
    container.style.display = "none";
  }
}

export function applyTimeoutTeamColor(team, teamColorMap = getTimeoutTeamColorMap()) {
  const bar = document.getElementById("scoreGameTimeoutSrStatus");
  applyTimeoutColorClass(bar, team, teamColorMap);
}

export function startTimeoutCountdown(team, remaining = 60, teamColorMap) {
  if (!team) return;
  let currentRemaining = remaining;

  const colorMap = teamColorMap || getTimeoutTeamColorMap();

  const container = document.getElementById("timeoutContainer");
  const bar = document.getElementById("scoreGameTimeoutSrStatus");
  const label = document.getElementById("timeoutCenteredLabel");

  if (!container || !bar || !label) return;

  // Show container when starting
  container.style.display = "block";

  applyTimeoutColorClass(bar, team, colorMap);

  // Set initial bar
  const pct = (currentRemaining / 60) * 100;
  bar.style.width = pct + "%";
  bar.setAttribute("aria-valuenow", currentRemaining);

  const mm = Math.floor(currentRemaining / 60);
  const ss = String(currentRemaining % 60).padStart(2, "0");
  label.textContent = `${mm}:${ss}`;

  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    currentRemaining--;

    if (currentRemaining < 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;

      const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
      if (timeoutDisplay) timeoutDisplay.textContent = '';

      const activeBox = document.querySelector('.timeout-box.active');
      if (activeBox) {
        activeBox.setAttribute('aria-pressed', 'false');
        activeBox.classList.remove('active');
        const team = activeBox.dataset.team === 'home' ? 'Home Team' : 'Opponent';
        activeBox.setAttribute('aria-label', `${team} timeout used`);
      }

      // Save after auto-end
      const setNumber = document.getElementById('scoreGameModal').dataset.currentSet;
      if (setNumber) {
        state.setTimeoutStates[setNumber].remaining = 0;
        state.setTimeoutStates[setNumber].activeTeam = null;
        state.setTimeoutStates[setNumber].activeIndex = null;
        // Call save if needed, but since active changed and UI updated, can call saveTimeoutStates from scoreModals.js if exported
      }

      return;
    }

    const pct = (currentRemaining / 60) * 100;
    bar.style.width = pct + "%";
    bar.setAttribute("aria-valuenow", currentRemaining);

    const mm = Math.floor(currentRemaining / 60);
    const ss = String(currentRemaining % 60).padStart(2, "0");
    const formatted = `${mm}:${ss}`;

    label.textContent = formatted;

    if (currentRemaining === 0) {
      bar.style.width = "0%";
      label.textContent = "0:00";
    }
  }, 1000);
}

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    // Don't cancel if the click is on a timeout box or inside the timeout container
    if (e.target.closest('.timeout-box') || e.target.closest('#timeoutContainer')) {
      return;
    }

    // Any other click cancels/hides the timer
    resetTimeoutCountdown();
  });
});