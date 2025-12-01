// js/follower.js
// Read-only follower view that mirrors the live scoreboard without input controls.
import { state, subscribe } from './state.js';
import { loadMatchFromUrl, getActiveMatchId } from './api/matchMetaAutosave.js';
import { hydrateScores } from './api/scoring.js';
import { initMatchLiveSync } from './api/matchLiveSync.js';
import { connect, getConnectionState, onConnectionStateChange } from './api/ws.js';
import { initSavedMatchesModal } from './api/matches.js';

const SET_COUNT = 5;
const TIMEOUT_DURATION_SECONDS = 60;

let activeSet = 1;
let manualSelection = null;
let suppressedManualSelection = null;
let countdownInterval = null;
let countdownKey = null;
let matchModalInstance = null;

const els = {
  wsIndicator: null,
  setCarouselTrack: null,
  setCarouselPrev: null,
  setCarouselNext: null,
  homeLabel: null,
  oppLabel: null,
  homeScore: null,
  oppScore: null,
  swapBtn: null,
  setMessage: null,
  timeoutBoxes: null,
  timeoutDisplay: null,
  timeoutContainer: null,
  timeoutBar: null,
  timeoutLabel: null,
};

function cacheElements() {
  els.wsIndicator = document.getElementById('wsConnectionIndicator');
  els.setCarouselTrack = document.getElementById('setCarouselTrack');
  els.setCarouselPrev = document.getElementById('setCarouselPrev');
  els.setCarouselNext = document.getElementById('setCarouselNext');
  els.homeLabel = document.getElementById('followerHomeLabel');
  els.oppLabel = document.getElementById('followerOppLabel');
  els.homeScore = document.getElementById('scoreGameHomeDisplay');
  els.oppScore = document.getElementById('scoreGameOppDisplay');
  els.swapBtn = document.getElementById('scoreModalSwapBtn');
  els.setMessage = document.getElementById('setMessage');
  els.timeoutBoxes = document.querySelectorAll('.timeout-box');
  els.timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
  els.timeoutContainer = document.getElementById('timeoutContainer');
  els.timeoutBar = document.getElementById('scoreGameTimeoutSrStatus');
  els.timeoutLabel = document.getElementById('timeoutCenteredLabel');
}

function setWsIndicator(state = 'disconnected') {
  if (!els.wsIndicator) return;
  const iconWrapper = els.wsIndicator.querySelector('.ws-indicator-icon');
  const icon = iconWrapper?.querySelector('i');
  const label = els.wsIndicator.querySelector('.ws-indicator-label');

  els.wsIndicator.classList.remove('status-connected', 'status-reconnecting', 'status-disconnected');
  els.wsIndicator.classList.add(`status-${state}`);

  if (iconWrapper) {
    iconWrapper.classList.remove('spin', 'pulse', 'text-danger', 'text-warning', 'text-success');
  }
  if (icon) {
    icon.className = 'bi';
  }

  switch (state) {
    case 'connected':
      iconWrapper?.classList.add('pulse');
      icon?.classList.add('bi-arrow-left-right');
      label && (label.textContent = 'Connected');
      break;
    case 'reconnecting':
      iconWrapper?.classList.add('spin');
      icon?.classList.add('bi-arrow-repeat');
      label && (label.textContent = 'Retrying...');
      break;
    default:
      iconWrapper?.classList.add('pulse');
      icon?.classList.add('bi-dash-circle');
      label && (label.textContent = 'Disconnected');
      break;
  }
}

function padScore(score) {
  const value = Number.isFinite(Number(score)) ? Number(score) : 0;
  return String(value).padStart(2, '0');
}

function normalizeSetNumber(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > SET_COUNT) return null;
  return parsed;
}

function getSetState(setNumber) {
  return state.sets?.[setNumber] || {
    scores: { home: 0, opp: 0 },
    timeouts: { home: [false, false], opp: [false, false] },
    finalized: false,
  };
}

function hasNonNullScores(setState) {
  if (!setState || typeof setState !== 'object') return false;
  const homeScore = setState.scores?.home;
  const oppScore = setState.scores?.opp;
  return homeScore !== null && homeScore !== undefined && oppScore !== null && oppScore !== undefined;
}

function computePreferredSet() {
  for (let set = SET_COUNT; set >= 1; set--) {
    const setState = state.sets?.[set];
    if (setState && !setState.finalized && hasNonNullScores(setState)) {
      return set;
    }
  }

  for (let set = SET_COUNT; set >= 1; set--) {
    const setState = state.sets?.[set];
    if (setState && !setState.finalized) {
      return set;
    }
  }

  return SET_COUNT;
}

function updateActiveSet(nextSet, { manual = false } = {}) {
  const normalized = normalizeSetNumber(nextSet) ?? computePreferredSet();
  const changed = normalized !== activeSet;
  activeSet = normalized;
  if (manual) {
    manualSelection = normalized;
  }
  const scoreModal = document.getElementById('scoreGameModal');
  if (scoreModal) {
    scoreModal.dataset.currentSet = String(normalized);
  }
  return changed;
}

function refreshActiveSetFromState() {
  const fallback = computePreferredSet();
  let targetSet = manualSelection ?? fallback;

  if (manualSelection !== null) {
    const manualState = state.sets?.[manualSelection];
    const shouldFallback = !manualState || (manualState.finalized && fallback !== manualSelection);
    if (shouldFallback) {
      if (manualState?.finalized) {
        suppressedManualSelection = manualSelection;
      } else {
        suppressedManualSelection = null;
      }
      manualSelection = null;
      targetSet = fallback;
    }
  } else if (suppressedManualSelection !== null) {
    const suppressedState = state.sets?.[suppressedManualSelection];
    if (suppressedState && !suppressedState.finalized) {
      manualSelection = suppressedManualSelection;
      suppressedManualSelection = null;
      targetSet = manualSelection;
    }
  }

  updateActiveSet(targetSet, { manual: manualSelection !== null });
}

function renderSetCarousel() {
  if (!els.setCarouselTrack) return;
  els.setCarouselTrack.innerHTML = '';

  for (let set = 1; set <= SET_COUNT; set++) {
    const setState = getSetState(set);
    const homeScore = Number(setState.scores?.home) || 0;
    const oppScore = Number(setState.scores?.opp) || 0;
    const scoreDisplay =
      homeScore === 0 && oppScore === 0 && !setState.finalized ? '—' : `${homeScore} - ${oppScore}`;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.dataset.set = String(set);
    pill.className = 'set-pill';
    if (setState.finalized) pill.classList.add('finalized');

    const isActive = set === activeSet;
    if (isActive) pill.classList.add('active');
    pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    pill.setAttribute('role', 'option');

    const statusLabel = setState.finalized ? 'Final' : isActive ? 'Live' : 'Score';
    pill.innerHTML = `
      <span class="set-pill-label">Set ${set}</span>
      <span class="set-pill-score">${scoreDisplay}</span>
      <span class="set-pill-state">${statusLabel}</span>
    `;

    pill.addEventListener('click', () => {
      updateActiveSet(set, { manual: true });
      renderAll();
    });

    els.setCarouselTrack.appendChild(pill);
  }
}

function getDisplayOrder() {
  return state.isDisplaySwapped ? ['opp', 'home'] : ['home', 'opp'];
}

function updateNames() {
  if (!els.homeLabel || !els.oppLabel) return;
  const [leftKey, rightKey] = getDisplayOrder();
  els.homeLabel.textContent = leftKey === 'home' ? state.homeTeam || 'Home Team' : state.opponent || 'Opponent';
  els.oppLabel.textContent = rightKey === 'opp' ? state.opponent || 'Opponent' : state.homeTeam || 'Home Team';
}

function updateScores() {
  const [leftKey, rightKey] = getDisplayOrder();
  const setState = getSetState(activeSet);
  const leftScore = Number(setState.scores?.[leftKey]) || 0;
  const rightScore = Number(setState.scores?.[rightKey]) || 0;
  if (els.homeScore) els.homeScore.textContent = padScore(leftScore);
  if (els.oppScore) els.oppScore.textContent = padScore(rightScore);

  if (els.setMessage) {
    const prefix = `Set ${activeSet}`;
    els.setMessage.textContent = setState.finalized ? `${prefix} is final` : `${prefix} in progress`;
  }
}

function getTimeoutColorMap() {
  const base = { home: '#0d6efd', opp: '#dc3545' };
  if (state.isTimeoutColorSwapped) {
    return { home: base.opp, opp: base.home };
  }
  return base;
}

function updateTimeoutBoxes(setState) {
  if (!els.timeoutBoxes) return;
  const [leftKey, rightKey] = getDisplayOrder();
  els.timeoutBoxes.forEach((box) => {
    const team = box.dataset.team === 'home' ? leftKey : rightKey;
    const index = Number(box.dataset.timeoutIndex) || 0;
    const used = Boolean(setState.timeouts?.[team]?.[index]);
    const isActive =
      setState.timeoutActiveTeam === team && Number(setState.timeoutActiveIndex) === index && Boolean(setState.timeoutStartedAt);
    box.setAttribute('aria-pressed', used ? 'true' : 'false');
    box.setAttribute('aria-disabled', 'true');
    box.setAttribute('tabindex', '-1');
    box.classList.toggle('used', used);
    box.classList.toggle('available', !used);
    box.classList.toggle('active', isActive);
  });
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  countdownInterval = null;
  countdownKey = null;
  if (els.timeoutContainer) {
    els.timeoutContainer.style.display = 'none';
  }
  if (els.timeoutBar && els.timeoutLabel) {
    els.timeoutBar.style.width = '100%';
    els.timeoutBar.setAttribute('aria-valuenow', TIMEOUT_DURATION_SECONDS);
    els.timeoutBar.classList.add('bg-primary');
    els.timeoutBar.style.backgroundColor = '';
    els.timeoutLabel.textContent = '1:00';
  }
  if (els.timeoutDisplay) {
    els.timeoutDisplay.textContent = '';
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

function syncCountdown(setNumber, setState) {
  const activeTeam = setState.timeoutActiveTeam;
  const activeIndex = setState.timeoutActiveIndex;
  const startedAt = setState.timeoutStartedAt;
  if (!startedAt || activeTeam === null || activeTeam === undefined || activeIndex === null || activeIndex === undefined) {
    stopCountdown();
    return;
  }

  const key = `${setNumber}-${activeTeam}-${activeIndex}-${startedAt}`;
  if (countdownKey !== key) {
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }
    countdownKey = key;
  }

  const teamName = activeTeam === 'home' ? state.homeTeam || 'Home Team' : state.opponent || 'Opponent';
  const colors = getTimeoutColorMap();
  if (els.timeoutContainer && els.timeoutBar && els.timeoutLabel && els.timeoutDisplay) {
    els.timeoutContainer.style.display = 'block';
    els.timeoutBar.classList.remove('bg-primary');
    els.timeoutBar.style.backgroundColor = colors[activeTeam] || '#6c757d';
    els.timeoutDisplay.textContent = `Timeout: ${teamName}`;

    const updateUi = () => {
      const remaining = calculateRemainingSeconds(startedAt, TIMEOUT_DURATION_SECONDS);
      const percentage = (remaining / TIMEOUT_DURATION_SECONDS) * 100;
      els.timeoutBar.style.width = `${percentage}%`;
      els.timeoutBar.setAttribute('aria-valuenow', remaining);
      els.timeoutLabel.textContent = formatTime(remaining);
      if (remaining <= 0 && countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    };

    updateUi();
    if (!countdownInterval) {
      countdownInterval = setInterval(updateUi, 1000);
    }
  }
}

function renderTimeouts() {
  const setState = getSetState(activeSet);
  updateTimeoutBoxes(setState);
  syncCountdown(activeSet, setState);
}

function updateSwapButtonState() {
  if (!els.swapBtn) return;
  const pressed = Boolean(state.isDisplaySwapped);
  els.swapBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

function handleSwapToggle() {
  state.isDisplaySwapped = !state.isDisplaySwapped;
  state.isTimeoutColorSwapped = state.isDisplaySwapped;
  updateSwapButtonState();
  renderAll();
}

function configureMatchSelectionModal({ dismissible }) {
  const modalEl = document.getElementById('matchIndexModal');
  const bootstrapModal = window.bootstrap?.Modal;
  if (!modalEl || !bootstrapModal) return null;

  const closeBtn = modalEl.querySelector('.btn-close');
  if (closeBtn) {
    closeBtn.classList.toggle('d-none', !dismissible);
    if (dismissible) {
      closeBtn.setAttribute('data-bs-dismiss', 'modal');
      closeBtn.removeAttribute('aria-hidden');
      closeBtn.removeAttribute('tabindex');
    } else {
      closeBtn.removeAttribute('data-bs-dismiss');
      closeBtn.setAttribute('aria-hidden', 'true');
      closeBtn.setAttribute('tabindex', '-1');
    }
  }

  matchModalInstance?.dispose();
  matchModalInstance = new bootstrapModal(modalEl, {
    backdrop: dismissible ? true : 'static',
    keyboard: dismissible,
  });

  return matchModalInstance;
}

function renderAll() {
  updateNames();
  updateScores();
  renderSetCarousel();
  renderTimeouts();
  updateSwapButtonState();
}

function handleCarouselNav(direction) {
  const nextSet = normalizeSetNumber(((activeSet - 1 + direction + SET_COUNT) % SET_COUNT) + 1);
  if (!nextSet) return;
  updateActiveSet(nextSet, { manual: true });
  renderAll();
}

async function bootstrap() {
  cacheElements();
  setWsIndicator(getConnectionState());
  onConnectionStateChange(setWsIndicator);

  els.setCarouselPrev?.addEventListener('click', () => handleCarouselNav(-1));
  els.setCarouselNext?.addEventListener('click', () => handleCarouselNav(1));
  els.swapBtn?.addEventListener('click', handleSwapToggle);

  initSavedMatchesModal({ readOnly: true });

  await connect();
  const match = await loadMatchFromUrl();
  const modal = configureMatchSelectionModal({ dismissible: Boolean(match) });
  if (!match) {
    modal?.show();
  }
  await hydrateScores(getActiveMatchId());
  initMatchLiveSync();
  refreshActiveSetFromState();
  renderAll();
  subscribe(() => {
    refreshActiveSetFromState();
    renderAll();
  });
}

window.addEventListener('DOMContentLoaded', bootstrap);
