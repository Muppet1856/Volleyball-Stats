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
import { getMatch, setIsFinal } from './api/ws.js';
import { initMatchLiveSync } from './api/matchLiveSync.js';
import { resetTimeoutCountdown } from './ui/timeOut.js';

const SET_COUNT = 5;
const DEFAULT_SET_STATE = {
  id: null,
  scores: { home: 0, opp: 0 },
  timeouts: { home: [false, false], opp: [false, false] },
  finalized: false,
  winner: null,
};

let activeSet = 1;
let manualSelection = null;
let isBootstrapping = true;

const els = {
  matchForm: null,
  matchIdInput: null,
  refreshBtn: null,
  status: null,
  setPills: null,
  setStatusText: null,
  finalizeBtn: null,
  scoreModal: null,
  homeDisplay: null,
  oppDisplay: null,
  setMessage: null,
  activeSetChip: null,
  homeName: null,
  oppName: null,
};

function cacheElements() {
  els.matchForm = document.getElementById('scorekeeperMatchForm');
  els.matchIdInput = document.getElementById('scorekeeperMatchId');
  els.refreshBtn = document.getElementById('refreshScoresBtn');
  els.status = document.getElementById('scorekeeperStatus');
  els.setPills = document.getElementById('setPills');
  els.setStatusText = document.getElementById('setStatusText');
  els.finalizeBtn = document.getElementById('finalizeSetBtn');
  els.scoreModal = document.getElementById('scoreGameModal');
  els.homeDisplay = document.getElementById('scoreGameHomeDisplay');
  els.oppDisplay = document.getElementById('scoreGameOppDisplay');
  els.setMessage = document.getElementById('setMessage');
  els.activeSetChip = document.getElementById('activeSetChip');
  els.homeName = document.getElementById('scorekeeperHomeName');
  els.oppName = document.getElementById('scorekeeperOppName');
}

function setStatus(message = '', tone = 'muted') {
  if (!els.status) return;
  els.status.textContent = message;
  els.status.classList.remove('text-muted', 'text-success', 'text-danger');
  const toneClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-muted';
  els.status.classList.add(toneClass);
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

function renderSetPills() {
  if (!els.setPills) return;
  els.setPills.innerHTML = '';

  for (let set = 1; set <= SET_COUNT; set++) {
    const setState = getSetState(set);
    const homeScore = Number(setState.scores?.home) || 0;
    const oppScore = Number(setState.scores?.opp) || 0;
    const scoreDisplay = homeScore === 0 && oppScore === 0 && !setState.finalized ? '—' : `${homeScore} - ${oppScore}`;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.dataset.set = String(set);
    pill.className = 'set-pill btn';
    if (set === activeSet) pill.classList.add('active');
    if (setState.finalized) pill.classList.add('finalized');

    const statusLabel = setState.finalized ? 'Final' : set === activeSet ? 'Live' : 'Open';
    pill.innerHTML = `
      <span class="set-pill-label">Set ${set}</span>
      <span class="set-pill-score">${scoreDisplay}</span>
      <span class="set-pill-state">${statusLabel}</span>
    `;
    els.setPills.appendChild(pill);
  }
}

function updateActiveSet(nextSet, { manual = false } = {}) {
  const normalized = normalizeSetNumber(nextSet) ?? computeFirstOpenSet();
  activeSet = normalized;
  if (manual) {
    manualSelection = normalized;
  }
  if (els.scoreModal) {
    els.scoreModal.dataset.currentSet = String(normalized);
    // Reuse timeout UI hydration hook
    els.scoreModal.dispatchEvent(new Event('show.bs.modal'));
  }
}

function refreshActiveSetFromState() {
  const fallback = computeFirstOpenSet();
  if (manualSelection === null) {
    updateActiveSet(fallback);
    return;
  }
  const manualState = getSetState(manualSelection);
  if (!manualState) {
    manualSelection = null;
    updateActiveSet(fallback);
    return;
  }
  if (manualState.finalized && fallback !== manualSelection) {
    manualSelection = null;
    updateActiveSet(fallback);
    return;
  }
  updateActiveSet(manualSelection);
}

function recalcMatchWins() {
  const totals = { home: 0, opp: 0 };
  for (let set = 1; set <= SET_COUNT; set++) {
    const setState = state.sets?.[set];
    if (setState?.finalized && setState.winner) {
      totals[setState.winner] += 1;
    }
  }
  updateState({ matchWins: totals });
}

function parseFinalizedMap(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (_err) {
      return {};
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

function applyFinalizedMap(raw) {
  const parsed = parseFinalizedMap(raw);
  const patch = {};
  for (let set = 1; set <= SET_COUNT; set++) {
    const value = parsed[set] ?? parsed[String(set)] ?? false;
    patch[set] = { finalized: Boolean(value) };
  }
  updateState({ sets: patch });
  recalcMatchWins();
}

function renderBoard() {
  const setState = getSetState(activeSet);
  const homeScore = Number(setState.scores?.home) || 0;
  const oppScore = Number(setState.scores?.opp) || 0;
  const isFinal = Boolean(setState.finalized);
  const winner = setState.winner;
  const allFinal = Array.from({ length: SET_COUNT }).every((_, idx) => state.sets?.[idx + 1]?.finalized);

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

  if (els.setStatusText) {
    if (isFinal) {
      const winnerLabel = winner === 'home' ? state.homeTeam || 'Home' : winner === 'opp' ? state.opponent || 'Opponent' : 'Set';
      els.setStatusText.textContent = `Set ${activeSet} final • ${winnerLabel} won`;
    } else if (allFinal) {
      els.setStatusText.textContent = 'All sets finalized';
    } else {
      els.setStatusText.textContent = `Set ${activeSet} in progress`;
    }
  }

  if (els.activeSetChip) {
    els.activeSetChip.textContent = allFinal ? 'Match complete' : `Set ${activeSet} • ${isFinal ? 'Final' : 'Live'}`;
    els.activeSetChip.classList.toggle('chip-final', allFinal || isFinal);
  }

  if (els.setMessage) {
    els.setMessage.textContent = isFinal
      ? 'Set is locked. Undo final to keep scoring.'
      : 'Use the touch zones or keyboard to adjust the live score.';
  }
}

function renderAll() {
  syncNames();
  renderSetPills();
  renderBoard();
  if (els.matchIdInput) {
    const currentMatchId = getActiveMatchId() ?? state.matchId;
    if (currentMatchId) {
      els.matchIdInput.value = currentMatchId;
    }
  }
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
    setStatus('Set marked final locally. Sync will retry when connection is available.', 'danger');
  }
}

async function handleFinalizeClick() {
  const setState = getSetState(activeSet);
  const willFinalize = !setState.finalized;
  const homeScore = Number(setState.scores?.home);
  const oppScore = Number(setState.scores?.opp);

  if (!Number.isFinite(homeScore) || !Number.isFinite(oppScore) || homeScore === oppScore) {
    setStatus('Enter valid, non-tied scores before finalizing.', 'danger');
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
    refreshActiveSetFromState();
    setStatus(`Set ${activeSet} finalized.`, 'success');
  } else {
    updateState({ sets: { [activeSet]: { finalized: false, winner: null } } });
    recalcMatchWins();
    await persistFinalizedSets();
    setStatus(`Set ${activeSet} reopened.`, 'muted');
  }

  resetTimeoutCountdown();
  renderAll();
}

function handleSetPillClick(event) {
  const button = event.target.closest('[data-set]');
  if (!button) return;
  const setNumber = normalizeSetNumber(button.dataset.set);
  if (!setNumber) return;
  updateActiveSet(setNumber, { manual: true });
  renderAll();
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
    setStatus('Enter a valid match ID to sync scoring.', 'danger');
    return;
  }

  setActiveMatchId(normalized);
  updateUrlMatchParam(normalized);
  setStatus(`Loading match #${normalized}...`, 'muted');

  try {
    const response = await getMatch(normalized);
    if (!response || response.status >= 300 || !response.body) {
      throw new Error('not found');
    }
    hydrateMatchMeta(response.body);
    applyFinalizedMap(response.body.finalized_sets ?? response.body.finalizedSets);
    await hydrateScores(normalized, { force: forceScores });
    refreshActiveSetFromState();
    renderAll();
    setStatus(`Match #${normalized} loaded.`, 'success');
  } catch (_err) {
    setStatus('Could not load that match. Check the ID and try again.', 'danger');
  }
}

async function bootstrap() {
  cacheElements();
  wireScoreZones();
  if (els.matchForm) {
    els.matchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const matchId = els.matchIdInput?.value;
      loadMatch(matchId, { forceScores: true });
    });
  }
  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', () => {
      const matchId = getActiveMatchId() ?? state.matchId;
      hydrateScores(matchId, { force: true });
      setStatus('Scores refreshed from the server.', 'muted');
    });
  }
  if (els.finalizeBtn) {
    els.finalizeBtn.addEventListener('click', handleFinalizeClick);
  }
  if (els.setPills) {
    els.setPills.addEventListener('click', handleSetPillClick);
  }

  await initializeHomeTeam();
  initMatchLiveSync();

  const initialMatch = await loadMatchFromUrl();
  if (initialMatch) {
    applyFinalizedMap(initialMatch.finalized_sets ?? initialMatch.finalizedSets);
    await hydrateScores(initialMatch.id, { force: true });
    setStatus(`Loaded match #${initialMatch.id}.`, 'success');
  } else {
    await hydrateScores();
  }

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
