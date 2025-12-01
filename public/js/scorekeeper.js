// js/scorekeeper.js
import { state, updateState, subscribe } from './state.js';
import { initializeHomeTeam } from './init/homeTeam.js';
import {
  hydrateMatchMeta,
  loadMatchFromUrl,
  setActiveMatchId,
  getActiveMatchId,
} from './api/matchMetaAutosave.js';
import { hydrateScores, saveScore } from './api/scoring.js';
import {
  connect,
  getConnectionState,
  getMatch,
  onConnectionStateChange,
  setIsFinal,
} from './api/ws.js';
import { initMatchLiveSync } from './api/matchLiveSync.js';
import { applyFinalizedMap, recalcMatchWins } from './ui/finalizedSets.js';
import { resetTimeoutCountdown } from './ui/timeOut.js';
import { initSavedMatchesModal } from './api/matches.js';
import { updateOpponentName } from './ui/opponentName.js';
import { mainSwap, swapConfig } from './ui/swap.js';

const SET_COUNT = 5;
const CAROUSEL_LOOP_COUNT = 3;
const MIDDLE_LOOP_INDEX = Math.floor(CAROUSEL_LOOP_COUNT / 2);
const DEFAULT_SET_STATE = {
  id: null,
  scores: { home: 0, opp: 0 },
  timeouts: { home: [false, false], opp: [false, false] },
  timeoutStartedAt: null,
  timeoutActiveTeam: null,
  timeoutActiveIndex: null,
  finalized: false,
  winner: null,
};

let activeSet = 1;
let manualSelection = null;
let isBootstrapping = true;
let carouselScrollTimeout = null;
let pendingCarouselScrollOptions = null;

const els = {
  setCarouselTrack: null,
  setCarouselViewport: null,
  setCarouselPrev: null,
  setCarouselNext: null,
  finalizeBtn: null,
  scoreModal: null,
  homeDisplay: null,
  oppDisplay: null,
  setMessage: null,
  homeName: null,
  oppName: null,
  modalSwapBtn: null,
  wsIndicator: null,
};

let finalizePopover = null;

function cacheElements() {
  els.setCarouselTrack = document.getElementById('setCarouselTrack');
  els.setCarouselViewport = document.getElementById('setCarouselViewport');
  els.setCarouselPrev = document.getElementById('setCarouselPrev');
  els.setCarouselNext = document.getElementById('setCarouselNext');
  els.finalizeBtn = document.getElementById('finalizeSetBtn');
  els.scoreModal = document.getElementById('scoreGameModal');
  els.homeDisplay = document.getElementById('scoreGameHomeDisplay');
  els.oppDisplay = document.getElementById('scoreGameOppDisplay');
  els.setMessage = document.getElementById('setMessage');
  els.homeName = document.getElementById('scorekeeperHomeName');
  els.oppName = document.getElementById('scorekeeperOppName');
  els.modalSwapBtn = document.getElementById('scoreModalSwapBtn');
  els.wsIndicator = document.getElementById('wsConnectionIndicator');
}

function initFinalizePopover() {
  const Popover = window.bootstrap?.Popover;
  if (!Popover || !els.finalizeBtn) return;
  finalizePopover = Popover.getOrCreateInstance(els.finalizeBtn, { trigger: 'manual' });
}

function hideFinalizePopover() {
  if (!finalizePopover) return;
  finalizePopover.hide();
}

function hasMatchQueryParam() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return ['match', 'matchId', 'matchid'].some((key) => params.has(key));
}

function openMatchSelectModal() {
  const modalEl = document.getElementById('matchIndexModal');
  const bootstrapModal = window.bootstrap?.Modal;
  if (!modalEl || !bootstrapModal) return;

  const modal = bootstrapModal.getOrCreateInstance(modalEl);
  modal.show();
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
      if (label) label.textContent = 'Connected';
      break;
    case 'reconnecting':
      iconWrapper?.classList.add('spin');
      icon?.classList.add('bi-arrow-repeat');
      if (label) label.textContent = 'Retrying...';
      break;
    default:
      iconWrapper?.classList.add('pulse');
      icon?.classList.add('bi-dash-circle');
      if (label) label.textContent = 'Disconnected';
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
  return state.sets?.[setNumber] || DEFAULT_SET_STATE;
}

function computeFirstOpenSet() {
  for (let set = 1; set <= SET_COUNT; set++) {
    if (!state.sets?.[set]?.finalized) {
      return set;
    }
  }
  return SET_COUNT;
}

function updateUrlMatchParam(matchId) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (matchId) {
    url.searchParams.set('match', matchId);
  } else {
    url.searchParams.delete('match');
  }
  const next = `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
  window.history.replaceState({}, document.title, next);
}

function syncNames() {
  const home = state.homeTeam || 'Home Team';
  const opp = state.opponent || 'Opponent';
  if (els.homeName) els.homeName.textContent = home;
  if (els.oppName) els.oppName.textContent = opp;
}

function getCarouselItems() {
  if (!els.setCarouselTrack) return [];
  return Array.from(els.setCarouselTrack.querySelectorAll('[data-set]'));
}

function findCarouselItem(setNumber, loopIndex = MIDDLE_LOOP_INDEX) {
  const items = getCarouselItems();
  return (
    items.find((item) => Number(item.dataset.set) === setNumber && Number(item.dataset.loopIndex) === loopIndex) ||
    items.find((item) => Number(item.dataset.set) === setNumber)
  );
}

function scrollToSet(setNumber, { animate = true } = {}) {
  if (!els.setCarouselViewport) return;
  const target = findCarouselItem(setNumber);
  if (!target) return;
  target.scrollIntoView({ behavior: animate ? 'smooth' : 'auto', block: 'nearest', inline: 'center' });
}

function syncCarouselActiveState() {
  const items = getCarouselItems();
  items.forEach((item) => {
    const isActive = Number(item.dataset.set) === activeSet && Number(item.dataset.loopIndex) === MIDDLE_LOOP_INDEX;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function getClosestSetItem() {
  if (!els.setCarouselViewport) return null;
  const viewportRect = els.setCarouselViewport.getBoundingClientRect();
  const viewportCenter = viewportRect.left + viewportRect.width / 2;
  let closest = null;
  let minDistance = Infinity;

  getCarouselItems().forEach((item) => {
    const rect = item.getBoundingClientRect();
    const itemCenter = rect.left + rect.width / 2;
    const distance = Math.abs(itemCenter - viewportCenter);
    if (distance < minDistance) {
      closest = item;
      minDistance = distance;
    }
  });

  return closest;
}

function queueScrollToActiveSet(options = {}) {
  pendingCarouselScrollOptions = { animate: true, ...pendingCarouselScrollOptions, ...options };
}

function renderSetCarousel() {
  if (!els.setCarouselTrack) return;
  els.setCarouselTrack.innerHTML = '';

  for (let loop = 0; loop < CAROUSEL_LOOP_COUNT; loop++) {
    for (let set = 1; set <= SET_COUNT; set++) {
      const setState = getSetState(set);
      const homeScore = Number(setState.scores?.home) || 0;
      const oppScore = Number(setState.scores?.opp) || 0;
      const scoreDisplay =
        homeScore === 0 && oppScore === 0 && !setState.finalized ? '—' : `${homeScore} - ${oppScore}`;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.dataset.set = String(set);
      pill.dataset.loopIndex = String(loop);
      pill.className = 'set-pill';
      if (setState.finalized) pill.classList.add('finalized');

      const isActive = set === activeSet && loop === MIDDLE_LOOP_INDEX;
      if (isActive) pill.classList.add('active');
      pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      pill.setAttribute('role', 'option');

      const statusLabel = setState.finalized ? 'Final' : isActive ? 'Live' : 'Score';
      pill.innerHTML = `
        <span class="set-pill-label">Set ${set}</span>
        <span class="set-pill-score">${scoreDisplay}</span>
        <span class="set-pill-state">${statusLabel}</span>
      `;
      els.setCarouselTrack.appendChild(pill);
    }
  }

  const scrollOptions = pendingCarouselScrollOptions ?? { animate: false };
  pendingCarouselScrollOptions = null;

  requestAnimationFrame(() => {
    scrollToSet(activeSet, scrollOptions);
    syncCarouselActiveState();
  });
}

function updateActiveSet(nextSet, { manual = false } = {}) {
  const normalized = normalizeSetNumber(nextSet) ?? computeFirstOpenSet();
  const changed = normalized !== activeSet;
  activeSet = normalized;
  if (manual) {
    manualSelection = normalized;
  }
  if (els.scoreModal) {
    els.scoreModal.dataset.currentSet = String(normalized);
    // Reuse timeout UI hydration hook
    els.scoreModal.dispatchEvent(new Event('show.bs.modal'));
  }

  return changed;
}

function refreshActiveSetFromState() {
  const fallback = computeFirstOpenSet();
  let targetSet = manualSelection ?? fallback;

  if (manualSelection !== null) {
    const manualState = getSetState(manualSelection);
    const shouldFallback = !manualState || (manualState.finalized && fallback !== manualSelection);
    if (shouldFallback) {
      manualSelection = null;
      targetSet = fallback;
    }
  }

  const changed = updateActiveSet(targetSet, { manual: manualSelection !== null });

  if (changed && manualSelection === null) {
    queueScrollToActiveSet({ animate: true });
  }
}

function renderBoard() {
  const setState = getSetState(activeSet);
  const homeScore = Number(setState.scores?.home) || 0;
  const oppScore = Number(setState.scores?.opp) || 0;
  const isFinal = Boolean(setState.finalized);
  const winner = setState.winner;
  const allFinal = Array.from({ length: SET_COUNT }).every((_, idx) => state.sets?.[idx + 1]?.finalized);

  if (finalizePopover && homeScore !== oppScore) {
    hideFinalizePopover();
  }

  if (els.homeDisplay) els.homeDisplay.textContent = padScore(homeScore);
  if (els.oppDisplay) els.oppDisplay.textContent = padScore(oppScore);

  if (els.scoreModal) {
    els.scoreModal.classList.toggle('is-finalized', isFinal);
  }

  if (els.finalizeBtn) {
    els.finalizeBtn.textContent = isFinal ? 'Undo final' : 'Finalize set';
    els.finalizeBtn.classList.toggle('btn-success', !isFinal);
    els.finalizeBtn.classList.toggle('btn-outline-warning', isFinal);
  }

  if (els.setMessage) {
    els.setMessage.textContent = isFinal
      ? 'Set is locked. Undo final to keep scoring.'
      : 'Use the touch zones to adjust the score.';
  }
}

function renderAll() {
  syncNames();
  renderSetCarousel();
  renderBoard();
  updateSwapButtonState();
}

function updateSwapButtonState() {
  if (!els.modalSwapBtn) return;
  const pressed = Boolean(state.isDisplaySwapped);
  els.modalSwapBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

function changeScore(team, delta) {
  if (!team) return;
  const setState = getSetState(activeSet);
  if (setState.finalized) return;

  const current = Number(setState.scores?.[team]) || 0;
  const next = Math.max(0, current + delta);
  const scores = { ...setState.scores, [team]: next };

  updateState({
    sets: {
      [activeSet]: { scores },
    },
  });
  saveScore(team, activeSet, next);
}

async function persistFinalizedSets() {
  const matchId = getActiveMatchId() ?? state.matchId;
  const normalized = Number(matchId);
  if (!Number.isFinite(normalized) || normalized <= 0) return;

  const finalizedSets = {};
  for (let set = 1; set <= SET_COUNT; set++) {
    finalizedSets[set] = Boolean(state.sets?.[set]?.finalized);
  }

  try {
    await setIsFinal(normalized, JSON.stringify(finalizedSets));
  } catch (_err) {
  }
}

async function handleFinalizeClick() {
  const setState = getSetState(activeSet);
  const willFinalize = !setState.finalized;
  const homeScore = Number(setState.scores?.home);
  const oppScore = Number(setState.scores?.opp);

  if (homeScore !== oppScore) {
    hideFinalizePopover();
  }

  if (!Number.isFinite(homeScore) || !Number.isFinite(oppScore)) {
    return;
  }

  if (homeScore === oppScore) {
    initFinalizePopover();
    finalizePopover?.show();
    return;
  }

  if (willFinalize) {
    const winner = homeScore > oppScore ? 'home' : 'opp';
    updateState({
      sets: {
        [activeSet]: {
          scores: { home: homeScore, opp: oppScore },
          winner,
          finalized: true,
        },
      },
    });
    recalcMatchWins();
    await persistFinalizedSets();
    manualSelection = null;
    const previousActiveSet = activeSet;
    refreshActiveSetFromState();
    if (previousActiveSet !== activeSet) {
      queueScrollToActiveSet({ animate: true });
    }
  } else {
    updateState({ sets: { [activeSet]: { finalized: false, winner: null } } });
    recalcMatchWins();
    await persistFinalizedSets();
  }

  resetTimeoutCountdown();
  renderAll();
}

function rerenderAndCenterSet({ animate = true } = {}) {
  queueScrollToActiveSet({ animate });
  renderAll();
}

function handleSetCarouselClick(event) {
  const button = event.target.closest('[data-set]');
  if (!button) return;
  const setNumber = normalizeSetNumber(button.dataset.set);
  if (!setNumber) return;
  updateActiveSet(setNumber, { manual: true });
  rerenderAndCenterSet();
}

function handleSetCarouselScroll() {
  if (carouselScrollTimeout) {
    clearTimeout(carouselScrollTimeout);
  }

  carouselScrollTimeout = window.setTimeout(() => {
    const closest = getClosestSetItem();
    if (!closest) return;
    const setNumber = normalizeSetNumber(closest.dataset.set);
    if (!setNumber) return;
    const loopIndex = Number(closest.dataset.loopIndex);
    if (setNumber === activeSet && loopIndex === MIDDLE_LOOP_INDEX) {
      syncCarouselActiveState();
      return;
    }
    updateActiveSet(setNumber, { manual: true });
    renderAll();
    if (loopIndex !== MIDDLE_LOOP_INDEX) {
      requestAnimationFrame(() => scrollToSet(setNumber, { animate: false }));
    }
  }, 120);
}

function handleCarouselNav(direction) {
  const nextSet = normalizeSetNumber(((activeSet - 1 + direction + SET_COUNT) % SET_COUNT) + 1);
  if (!nextSet) return;
  updateActiveSet(nextSet, { manual: true });
  rerenderAndCenterSet();
}

function handleScoreZone(event) {
  const zone = event.currentTarget;
  const team = zone.dataset.team;
  const action = zone.dataset.action;
  const delta = action === 'increment' ? 1 : -1;
  changeScore(team, delta);
  renderBoard();
}

function wireScoreZones() {
  const zones = document.querySelectorAll('.score-zone');
  zones.forEach((zone) => {
    zone.addEventListener('click', handleScoreZone);
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleScoreZone({ currentTarget: zone });
      }
    });
  });
}

async function loadMatch(matchId, { forceScores = false } = {}) {
  const normalized = Number(matchId);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return;
  }

  setActiveMatchId(normalized);
  updateUrlMatchParam(normalized);

  try {
    const response = await getMatch(normalized);
    if (!response || response.status >= 300 || !response.body) {
      throw new Error('not found');
    }
    hydrateMatchMeta(response.body);
    updateOpponentName();
    applyFinalizedMap(response.body.finalized_sets ?? response.body.finalizedSets);
    await hydrateScores(normalized, { force: forceScores });
    refreshActiveSetFromState();
    renderAll();
  } catch (_err) {
  }
}

async function bootstrap() {
  cacheElements();
  setWsIndicator(getConnectionState());
  onConnectionStateChange(setWsIndicator);
  connect().catch(() => setWsIndicator('disconnected'));
  wireScoreZones();
  if (els.scoreModal) {
    els.scoreModal.addEventListener('show.bs.modal', initFinalizePopover);
    els.scoreModal.addEventListener('hide.bs.modal', hideFinalizePopover);
    els.scoreModal.addEventListener('hidden.bs.modal', () => {
      finalizePopover?.dispose?.();
      finalizePopover = null;
    });
  }
  if (els.finalizeBtn) {
    els.finalizeBtn.addEventListener('click', handleFinalizeClick);
  }
  if (els.setCarouselTrack) {
    els.setCarouselTrack.addEventListener('click', handleSetCarouselClick);
  }
  if (els.setCarouselViewport) {
    els.setCarouselViewport.addEventListener('scroll', handleSetCarouselScroll);
  }
  if (els.setCarouselPrev) {
    els.setCarouselPrev.addEventListener('click', () => handleCarouselNav(-1));
  }
  if (els.setCarouselNext) {
    els.setCarouselNext.addEventListener('click', () => handleCarouselNav(1));
  }
  const swapHandler = () => {
    mainSwap(swapConfig);
    updateSwapButtonState();
  };

  if (els.modalSwapBtn) {
    els.modalSwapBtn.addEventListener('click', swapHandler);
  }
  updateSwapButtonState();

  await initializeHomeTeam();
  initMatchLiveSync();
  initSavedMatchesModal();

  const hadMatchQueryParam = hasMatchQueryParam();
  const initialMatch = await loadMatchFromUrl();
  if (initialMatch) {
    applyFinalizedMap(initialMatch.finalized_sets ?? initialMatch.finalizedSets);
    await hydrateScores(initialMatch.id, { force: true });
  } else {
    await hydrateScores();
    if (hadMatchQueryParam) {
      setStatus('Could not load that match. Please select another match.', 'danger');
      openMatchSelectModal();
    } else if (!hasMatchQueryParam()) {
      openMatchSelectModal();
    }
  }
  updateOpponentName();

  refreshActiveSetFromState();
  renderAll();
  isBootstrapping = false;
}

subscribe(() => {
  if (isBootstrapping) return;
  refreshActiveSetFromState();
  renderAll();
});

document.addEventListener('DOMContentLoaded', bootstrap);
