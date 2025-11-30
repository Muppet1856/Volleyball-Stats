// js/ui/timeOut.js
import { state, subscribe, updateState } from '../state.js';
import { ensureSetIdForMatch } from '../api/scoring.js';
import { getActiveMatchId } from '../api/matchMetaAutosave.js';
import { setHomeTimeout, setOppTimeout } from '../api/ws.js';

let countdownInterval = null;
let currentActiveButton = null;

function getTimeoutTeamColorMap() {
  const baseMap = {
    home: '#0d6efd',
    opp: '#dc3545',
  };
  if (state.isTimeoutColorSwapped) {
    return {
      home: baseMap.opp,
      opp: baseMap.home,
    };
  }
  return baseMap;
}

function applyTimeoutTeamColor(team, colorMap) {
  const bar = document.getElementById('scoreGameTimeoutSrStatus');
  if (bar) {
    bar.classList.remove('bg-primary');  // Remove default to allow custom color
    bar.style.backgroundColor = colorMap[team] || '#6c757d';  // Fallback gray
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function updateDisplay(bar, label, remaining, duration) {
  if (bar && label) {
    const percentage = (remaining / duration) * 100;
    bar.style.width = `${percentage}%`;
    bar.setAttribute('aria-valuenow', remaining);
    label.textContent = formatTime(remaining);
  }
}

export function resetTimeoutCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  const container = document.getElementById('timeoutContainer');
  const bar = document.getElementById('scoreGameTimeoutSrStatus');
  const label = document.getElementById('timeoutCenteredLabel');
  const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
  if (container) {
    container.style.display = 'none';
  }
  if (bar && label) {
    updateDisplay(bar, label, 60, 60);  // Reset to full
    bar.classList.add('bg-primary');  // Restore default class
    bar.style.backgroundColor = '';   // Clear custom color
  }
  if (timeoutDisplay) {
    timeoutDisplay.textContent = '';
  }
  if (currentActiveButton) {
    currentActiveButton.classList.remove('active');
    currentActiveButton = null;
  }
  // Remove any active classes from all boxes
  document.querySelectorAll('.timeout-box.active').forEach(box => box.classList.remove('active'));
}

export function startTimeoutCountdown(button) {
  resetTimeoutCountdown();  // Clear any existing
  currentActiveButton = button;
  const team = button.dataset.team;
  const duration = 60;  // Matches your HTML
  let remaining = duration;

  const bar = document.getElementById('scoreGameTimeoutSrStatus');
  const label = document.getElementById('timeoutCenteredLabel');
  const container = document.getElementById('timeoutContainer');
  const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
  const teamName = team === 'home' ? state.homeTeam : state.opponent;

  if (container && bar && label && timeoutDisplay) {
    container.style.display = 'block';
    applyTimeoutTeamColor(team, getTimeoutTeamColorMap());
    updateDisplay(bar, label, remaining, duration);
    timeoutDisplay.textContent = `Timeout: ${teamName}`;

    countdownInterval = setInterval(() => {
      remaining--;
      updateDisplay(bar, label, remaining, duration);

      if (remaining <= 0) {
        resetTimeoutCountdown();
        // Optional: Alert or sound for timeout end
        // alert('Timeout over!');
      }
    }, 1000);
  }
}

// Load timeout UI from state on modal show
window.addEventListener('DOMContentLoaded', () => {
  const scoreGameModal = document.getElementById('scoreGameModal');
  if (scoreGameModal) {
    scoreGameModal.addEventListener('show.bs.modal', () => {
      refreshTimeoutBoxes();
    });

    scoreGameModal.addEventListener('hide.bs.modal', () => {
      resetTimeoutCountdown();
    });
  }
});

function refreshTimeoutBoxes() {
  const modal = document.getElementById('scoreGameModal');
  const setNumber = modal ? parseInt(modal.dataset.currentSet, 10) : null;
  if (!setNumber || !state.sets[setNumber]) return;

  const timeouts = state.sets[setNumber].timeouts;
  const timeoutBoxes = document.querySelectorAll('.timeout-box');

  timeoutBoxes.forEach((box) => {
    const team = box.dataset.team;
    const index = parseInt(box.dataset.timeoutIndex);
    const used = Boolean(timeouts?.[team]?.[index]);
    box.setAttribute('aria-pressed', used ? 'true' : 'false');
    box.classList.toggle('used', used);
    box.classList.toggle('available', !used);
    box.classList.remove('active'); // Reset active
    const teamName = team === 'home' ? state.homeTeam : state.opponent;
    const ord = (index + 1 === 1) ? 'first' : 'second';
    box.setAttribute('aria-label', `${teamName} ${ord} timeout ${used ? 'used' : 'available'}`);
  });
}

subscribe(() => {
  const modal = document.getElementById('scoreGameModal');
  if (modal && modal.classList.contains('show')) {
    refreshTimeoutBoxes();
  }
});

async function handleTimeoutClick(e) {
  const box = e.target.closest('.timeout-box');
  if (!box) return;  // Allow clicking used ones to deselect

  const modal = document.getElementById('scoreGameModal');
  const setNumber = parseInt(modal.dataset.currentSet, 10);
  if (!setNumber) return;

  const team = box.dataset.team;
  const index = parseInt(box.dataset.timeoutIndex);
  const teamName = team === 'home' ? state.homeTeam : state.opponent;
  const ord = (index + 1 === 1) ? 'first' : 'second';
  const used = Boolean(state.sets?.[setNumber]?.timeouts?.[team]?.[index]);
  const matchId = getActiveMatchId() ?? state.matchId;
  const normalizedMatchId = Number(matchId);
  const hasMatchId = Number.isFinite(normalizedMatchId) && normalizedMatchId > 0;
  let setId = null;
  if (hasMatchId) {
    setId = await ensureSetIdForMatch(normalizedMatchId, setNumber);
  }

  if (used) {
    // Deselect and reset
    box.setAttribute('aria-pressed', 'false');
    box.classList.remove('used', 'active');
    box.classList.add('available');
    resetTimeoutCountdown();
    box.setAttribute('aria-label', `${teamName} ${ord} timeout available`);

    // Sync to state
    const nextTimeouts = [...state.sets[setNumber].timeouts[team]];
    nextTimeouts[index] = false;
    updateState({
      sets: {
        [setNumber]: {
          timeouts: { [team]: nextTimeouts }
        }
      }
    });

    const value = 0;
    if (hasMatchId && setId) {
      if (team === 'home') {
        setHomeTimeout(setId, index + 1, value, normalizedMatchId);
      } else {
        setOppTimeout(setId, index + 1, value, normalizedMatchId);
      }
    }
  } else if (box.classList.contains('available')) {
    // Select and start only if available
    document.querySelectorAll('.timeout-box').forEach(b => {
      if (b !== box) b.classList.remove('active');
    });
    box.setAttribute('aria-pressed', 'true');
    box.classList.remove('available');
    box.classList.add('used', 'active');
    startTimeoutCountdown(box);
    box.setAttribute('aria-label', `${teamName} ${ord} timeout used`);

    // Sync to state
    const nextTimeouts = [...state.sets[setNumber].timeouts[team]];
    nextTimeouts[index] = true;
    updateState({
      sets: {
        [setNumber]: {
          timeouts: { [team]: nextTimeouts }
        }
      }
    });

    const value = 1;
    if (hasMatchId && setId) {
      if (team === 'home') {
        setHomeTimeout(setId, index + 1, value, normalizedMatchId);
      } else {
        setOppTimeout(setId, index + 1, value, normalizedMatchId);
      }
    }
  }
}

// Attach listeners
window.addEventListener("DOMContentLoaded", () => {
  const timeoutBoxes = document.querySelectorAll('.timeout-box');
  timeoutBoxes.forEach(box => {
    box.classList.add('available');
    box.addEventListener('click', handleTimeoutClick);
  });

  // Click outside to reset (but not on boxes or container)
  document.addEventListener("click", (e) => {
    if (e.target.closest('.timeout-box') || e.target.closest('#timeoutContainer')) {
      return;
    }
    resetTimeoutCountdown();
  });
});
