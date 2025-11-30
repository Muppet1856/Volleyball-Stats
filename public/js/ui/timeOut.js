// js/ui/timeOut.js
import { state, subscribe, updateState } from '../state.js';
import { ensureSetIdForMatch } from '../api/scoring.js';
import { getActiveMatchId } from '../api/matchMetaAutosave.js';
import { setHomeTimeout, setOppTimeout } from '../api/ws.js';

const TIMEOUT_DURATION_SECONDS = 60;

let countdownInterval = null;
let currentActiveButton = null;
let activeTimeoutStartedAt = null;

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

function calculateRemainingSeconds(startedAt, duration = TIMEOUT_DURATION_SECONDS) {
  if (!startedAt) return 0;
  const parsed = new Date(startedAt);
  if (Number.isNaN(parsed.getTime())) return 0;
  const elapsedSeconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
  return Math.max(0, duration - elapsedSeconds);
}

function findTimeoutBox(team, index) {
  return document.querySelector(`.timeout-box[data-team="${team}"][data-timeout-index="${index}"]`);
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
  activeTimeoutStartedAt = null;
  const container = document.getElementById('timeoutContainer');
  const bar = document.getElementById('scoreGameTimeoutSrStatus');
  const label = document.getElementById('timeoutCenteredLabel');
  const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
  if (container) {
    container.style.display = 'none';
  }
  if (bar && label) {
    updateDisplay(bar, label, TIMEOUT_DURATION_SECONDS, TIMEOUT_DURATION_SECONDS);  // Reset to full
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

export function startTimeoutCountdown({ button, team, startedAt, setNumber, timeoutIndex }) {
  const activeButton = button || (team !== undefined && timeoutIndex !== undefined ? findTimeoutBox(team, timeoutIndex) : null);
  const timeoutTeam = team || activeButton?.dataset.team;
  if (!timeoutTeam || !startedAt) return;

  const remaining = calculateRemainingSeconds(startedAt, TIMEOUT_DURATION_SECONDS);
  if (remaining <= 0) {
    handleTimeoutExpired(setNumber, timeoutTeam, timeoutIndex);
    return;
  }

  resetTimeoutCountdown();  // Clear any existing
  currentActiveButton = activeButton;
  activeTimeoutStartedAt = startedAt;

  const bar = document.getElementById('scoreGameTimeoutSrStatus');
  const label = document.getElementById('timeoutCenteredLabel');
  const container = document.getElementById('timeoutContainer');
  const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
  const teamName = timeoutTeam === 'home' ? state.homeTeam : state.opponent;

  if (container && bar && label && timeoutDisplay) {
    container.style.display = 'block';
    applyTimeoutTeamColor(timeoutTeam, getTimeoutTeamColorMap());
    updateDisplay(bar, label, remaining, TIMEOUT_DURATION_SECONDS);
    timeoutDisplay.textContent = `Timeout: ${teamName}`;

    countdownInterval = setInterval(() => {
      const nextRemaining = calculateRemainingSeconds(startedAt, TIMEOUT_DURATION_SECONDS);
      updateDisplay(bar, label, nextRemaining, TIMEOUT_DURATION_SECONDS);

      if (nextRemaining <= 0) {
        resetTimeoutCountdown();
        handleTimeoutExpired(setNumber, timeoutTeam, timeoutIndex);
      }
    }, 1000);
  }
}

async function handleTimeoutExpired(setNumber, team, timeoutIndex) {
  if (!setNumber || timeoutIndex === undefined || timeoutIndex === null) return;

  updateState({
    sets: {
      [setNumber]: {
        timeoutStartedAt: null,
        timeoutActiveTeam: null,
        timeoutActiveIndex: null,
      },
    },
  });

  const matchId = getActiveMatchId() ?? state.matchId;
  const normalizedMatchId = Number(matchId);
  if (!Number.isFinite(normalizedMatchId) || normalizedMatchId <= 0) return;

  const setId = state.sets?.[setNumber]?.id ?? (await ensureSetIdForMatch(normalizedMatchId, setNumber));
  if (!setId) return;

  const teamTimeouts = state.sets?.[setNumber]?.timeouts?.[team];
  const value = Array.isArray(teamTimeouts) && teamTimeouts[timeoutIndex] ? 1 : 0;

  if (team === 'home') {
    setHomeTimeout(setId, timeoutIndex + 1, value, normalizedMatchId, null);
  } else if (team === 'opp') {
    setOppTimeout(setId, timeoutIndex + 1, value, normalizedMatchId, null);
  }
}

function syncTimeoutCountdownForSet(setNumber, setState) {
  if (!setState) {
    resetTimeoutCountdown();
    return;
  }

  const { timeoutStartedAt, timeoutActiveTeam, timeoutActiveIndex } = setState;

  if (
    !timeoutStartedAt ||
    timeoutActiveTeam === null ||
    timeoutActiveIndex === null ||
    timeoutActiveIndex === undefined
  ) {
    if (countdownInterval) {
      resetTimeoutCountdown();
    }
    return;
  }

  if (activeTimeoutStartedAt === timeoutStartedAt) {
    return; // Already running for this timestamp
  }

  startTimeoutCountdown({
    button: findTimeoutBox(timeoutActiveTeam, timeoutActiveIndex),
    team: timeoutActiveTeam,
    startedAt: timeoutStartedAt,
    setNumber,
    timeoutIndex: timeoutActiveIndex,
  });
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

  const setState = state.sets[setNumber];
  const { timeouts, timeoutStartedAt, timeoutActiveTeam, timeoutActiveIndex } = setState;
  const timeoutBoxes = document.querySelectorAll('.timeout-box');

  timeoutBoxes.forEach((box) => {
    const team = box.dataset.team;
    const index = parseInt(box.dataset.timeoutIndex);
    const used = Boolean(timeouts?.[team]?.[index]);
    box.setAttribute('aria-pressed', used ? 'true' : 'false');
    box.classList.toggle('used', used);
    box.classList.toggle('available', !used);
    const isActive =
      used && timeoutStartedAt && timeoutActiveTeam === team && timeoutActiveIndex === index;
    box.classList.toggle('active', Boolean(isActive));
    if (isActive) {
      currentActiveButton = box;
    }
    const teamName = team === 'home' ? state.homeTeam : state.opponent;
    const ord = (index + 1 === 1) ? 'first' : 'second';
    box.setAttribute('aria-label', `${teamName} ${ord} timeout ${used ? 'used' : 'available'}`);
  });

  syncTimeoutCountdownForSet(setNumber, setState);
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
          timeouts: { [team]: nextTimeouts },
          timeoutStartedAt: null,
          timeoutActiveTeam: null,
          timeoutActiveIndex: null,
        }
      }
    });

    const value = 0;
    if (hasMatchId && setId) {
      if (team === 'home') {
        setHomeTimeout(setId, index + 1, value, normalizedMatchId, null);
      } else {
        setOppTimeout(setId, index + 1, value, normalizedMatchId, null);
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
    const startedAt = new Date().toISOString();
    startTimeoutCountdown({ button: box, team, startedAt, setNumber, timeoutIndex: index });
    box.setAttribute('aria-label', `${teamName} ${ord} timeout used`);

    // Sync to state
    const nextTimeouts = [...state.sets[setNumber].timeouts[team]];
    nextTimeouts[index] = true;
    updateState({
      sets: {
        [setNumber]: {
          timeouts: { [team]: nextTimeouts },
          timeoutStartedAt: startedAt,
          timeoutActiveTeam: team,
          timeoutActiveIndex: index,
        }
      }
    });

    const value = 1;
    if (hasMatchId && setId) {
      if (team === 'home') {
        setHomeTimeout(setId, index + 1, value, normalizedMatchId, startedAt);
      } else {
        setOppTimeout(setId, index + 1, value, normalizedMatchId, startedAt);
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
