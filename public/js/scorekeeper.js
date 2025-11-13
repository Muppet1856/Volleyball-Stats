(() => {
  const TIMEOUT_COUNT = 2;
  const TIMEOUT_DURATION_SECONDS = 60;
  const TEAM_KEYS = ['home', 'opp'];

  const DEFAULT_LABELS = {
    home: 'Home Team',
    opp: 'Opponent'
  };

  const scorekeeperState = {
    scores: {
      home: 0,
      opp: 0
    },
    labels: {
      home: DEFAULT_LABELS.home,
      opp: DEFAULT_LABELS.opp
    },
    timeouts: {
      home: Array(TIMEOUT_COUNT).fill(false),
      opp: Array(TIMEOUT_COUNT).fill(false)
    },
    activeTimeout: {
      home: null,
      opp: null
    },
    timeoutTimers: {
      home: null,
      opp: null
    },
    timeoutRemainingSeconds: {
      home: TIMEOUT_DURATION_SECONDS,
      opp: TIMEOUT_DURATION_SECONDS
    },
    display: {
      left: 'home',
      right: 'opp'
    }
  };

  const urlParams = new URLSearchParams(window.location.search);
  const matchIdParam = urlParams.get('matchId');
  const setParam = urlParams.get('set');
  const parsedMatchId = matchIdParam ? parseInt(matchIdParam, 10) : NaN;
  const matchId = Number.isInteger(parsedMatchId) ? parsedMatchId : null;
  const parsedSet = setParam ? parseInt(setParam, 10) : NaN;
  const DEFAULT_SET_NUMBER = 1;
  let activeSetNumber = Number.isInteger(parsedSet) && parsedSet >= 1 && parsedSet <= 5 ? parsedSet : DEFAULT_SET_NUMBER;

  let liveChannel = null;
  let liveMessageUnsubscribe = null;
  let liveStatusUnsubscribe = null;
  let liveClientId = null;
  let liveStatus = 'disconnected';
  let interactionLocked = matchId !== null;
  let manualFallback = matchId === null;
  let isApplyingRemoteUpdate = false;
  let statusElement = null;
  let lastBroadcastSnapshot = null;

  function getLiveChannel() {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.LiveScoreChannel || null;
  }

  function canApplyLocalMutation() {
    return manualFallback || !interactionLocked;
  }

  function setControlsEnabled(enabled) {
    const disable = !enabled;
    document.querySelectorAll('[data-role="score-zone"]').forEach((zone) => {
      zone.setAttribute('aria-disabled', disable ? 'true' : 'false');
      zone.tabIndex = disable ? -1 : 0;
      zone.classList.toggle('live-disabled', disable);
      zone.style.pointerEvents = disable ? 'none' : '';
    });
    document.querySelectorAll('.timeout-box').forEach((button) => {
      button.disabled = disable;
      button.classList.toggle('disabled', disable);
    });
    const swapButton = document.getElementById('scorekeeperSwapBtn');
    if (swapButton) {
      swapButton.disabled = disable;
      swapButton.classList.toggle('disabled', disable);
    }
    const resetScoresBtn = document.getElementById('scorekeeperResetScoresBtn');
    if (resetScoresBtn) {
      resetScoresBtn.disabled = disable;
    }
    const resetTimeoutsBtn = document.getElementById('scorekeeperResetTimeoutsBtn');
    if (resetTimeoutsBtn) {
      resetTimeoutsBtn.disabled = disable;
    }
    const homeInput = document.getElementById('scorekeeperHomeName');
    if (homeInput) {
      homeInput.disabled = disable;
    }
    const oppInput = document.getElementById('scorekeeperOppName');
    if (oppInput) {
      oppInput.disabled = disable;
    }
  }

  function updateLiveStatusIndicator(status, detail = {}) {
    if (!statusElement) {
      statusElement = document.getElementById('scorekeeperLiveStatus');
    }
    if (!statusElement) {
      return;
    }
    const classMap = {
      connecting: 'text-bg-warning',
      connected: 'text-bg-success',
      reconnecting: 'text-bg-warning',
      failed: 'text-bg-danger',
      disconnected: 'text-bg-secondary',
      manual: 'text-bg-secondary'
    };
    const textMap = {
      connecting: 'Connecting…',
      connected: 'Live',
      reconnecting: 'Reconnecting…',
      failed: 'Offline',
      disconnected: 'Offline',
      manual: 'Manual'
    };
    const targetClass = classMap[status] || 'text-bg-secondary';
    statusElement.className = `badge rounded-pill scorekeeper-live-indicator ${targetClass}`;
    statusElement.textContent = textMap[status] || 'Offline';
    if (status === 'reconnecting' && detail?.attempt) {
      statusElement.textContent = `${textMap[status]} (${detail.attempt})`;
    }
  }

  function getScorekeeperSnapshot() {
    return {
      scores: { ...scorekeeperState.scores },
      timeouts: {
        home: scorekeeperState.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
        opp: scorekeeperState.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
      },
      activeTimeout: {
        home: scorekeeperState.activeTimeout.home ?? null,
        opp: scorekeeperState.activeTimeout.opp ?? null
      },
      timeoutRemainingSeconds: {
        home: scorekeeperState.timeoutRemainingSeconds.home ?? TIMEOUT_DURATION_SECONDS,
        opp: scorekeeperState.timeoutRemainingSeconds.opp ?? TIMEOUT_DURATION_SECONDS
      },
      timeoutRunning: {
        home: Boolean(scorekeeperState.timeoutTimers.home),
        opp: Boolean(scorekeeperState.timeoutTimers.opp)
      },
      labels: { ...scorekeeperState.labels },
      swapped: scorekeeperState.display.left === 'opp',
      finalizedSets: {}
    };
  }

  function broadcastScorekeeperState(reason) {
    if (!liveChannel || matchId === null || isApplyingRemoteUpdate) {
      return;
    }
    const payload = {
      type: 'score:update',
      matchId,
      setNumber: activeSetNumber,
      reason,
      state: getScorekeeperSnapshot(),
      timestamp: Date.now()
    };
    lastBroadcastSnapshot = payload.state;
    liveChannel.send(payload);
  }

  function sendLiveJoin(reason) {
    if (!liveChannel || matchId === null) {
      return;
    }
    liveChannel.send({
      type: 'score:join',
      matchId,
      setNumber: activeSetNumber,
      reason,
      timestamp: Date.now()
    });
  }

  function sendLiveLeave() {
    if (!liveChannel || matchId === null) {
      return;
    }
    liveChannel.send({
      type: 'score:leave',
      matchId,
      setNumber: activeSetNumber,
      timestamp: Date.now()
    });
  }

  function applyRemoteSnapshot(message) {
    const { state = {} } = message;
    if (!state || typeof state !== 'object') {
      return;
    }
    isApplyingRemoteUpdate = true;
    try {
      if (message.setNumber !== undefined && message.setNumber !== null) {
        const numericSet = Number(message.setNumber);
        if (Number.isInteger(numericSet) && numericSet >= 1 && numericSet <= 5) {
          activeSetNumber = numericSet;
        }
      }
      if (state.labels && typeof state.labels === 'object') {
        if (typeof state.labels.home === 'string') {
          scorekeeperState.labels.home = state.labels.home;
        }
        if (typeof state.labels.opp === 'string') {
          scorekeeperState.labels.opp = state.labels.opp;
        }
        const homeInput = document.getElementById('scorekeeperHomeName');
        if (homeInput) {
          homeInput.value = scorekeeperState.labels.home;
        }
        const oppInput = document.getElementById('scorekeeperOppName');
        if (oppInput) {
          oppInput.value = scorekeeperState.labels.opp;
        }
        syncTeamLabelDisplays();
      }
      if (state.swapped !== undefined) {
        const shouldSwap = Boolean(state.swapped);
        const expectedLeft = shouldSwap ? 'opp' : 'home';
        const expectedRight = shouldSwap ? 'home' : 'opp';
        scorekeeperState.display.left = expectedLeft;
        scorekeeperState.display.right = expectedRight;
        updateDisplayAssignments();
      }
      if (state.scores && typeof state.scores === 'object') {
        if (state.scores.home !== undefined) {
          scorekeeperState.scores.home = clampScoreValue(state.scores.home);
        }
        if (state.scores.opp !== undefined) {
          scorekeeperState.scores.opp = clampScoreValue(state.scores.opp);
        }
        updateScoreDisplays();
      }
      if (state.timeouts && typeof state.timeouts === 'object') {
        ['home', 'opp'].forEach((team) => {
          const values = Array.isArray(state.timeouts[team]) ? state.timeouts[team] : [];
          scorekeeperState.timeouts[team] = values.slice(0, TIMEOUT_COUNT).map(Boolean);
        });
      }
      if (state.activeTimeout && typeof state.activeTimeout === 'object') {
        ['home', 'opp'].forEach((team) => {
          const index = Number(state.activeTimeout[team]);
          scorekeeperState.activeTimeout[team] = Number.isInteger(index) ? index : null;
        });
      } else {
        scorekeeperState.activeTimeout.home = null;
        scorekeeperState.activeTimeout.opp = null;
      }
      if (state.timeoutRemainingSeconds && typeof state.timeoutRemainingSeconds === 'object') {
        ['home', 'opp'].forEach((team) => {
          const value = Number(state.timeoutRemainingSeconds[team]);
          scorekeeperState.timeoutRemainingSeconds[team] = Number.isFinite(value)
            ? Math.max(0, Math.round(value))
            : TIMEOUT_DURATION_SECONDS;
        });
      }
      stopTimeoutTimer('home');
      stopTimeoutTimer('opp');
      if (state.timeoutRunning && typeof state.timeoutRunning === 'object') {
        ['home', 'opp'].forEach((team) => {
          if (state.timeoutRunning[team] && scorekeeperState.activeTimeout[team] !== null) {
            startTimeoutTimer(team, { broadcast: false });
          }
        });
      }
      refreshAllTimeoutDisplays();
      updateTimeoutTimerDisplay();
      lastBroadcastSnapshot = getScorekeeperSnapshot();
    } finally {
      isApplyingRemoteUpdate = false;
    }
  }

  function handleLiveMessage(message) {
    if (!liveChannel || !message || typeof message !== 'object') {
      return;
    }
    if (message.clientId && message.clientId === liveClientId) {
      return;
    }
    if (matchId !== null) {
      const incomingMatchId = Number(message.matchId);
      if (!Number.isNaN(incomingMatchId) && incomingMatchId !== matchId) {
        return;
      }
    }
    switch (message.type) {
      case 'score:update':
        applyRemoteSnapshot(message);
        break;
      case 'score:join':
        if (!interactionLocked && !manualFallback) {
          broadcastScorekeeperState('sync');
        }
        break;
      default:
        break;
    }
  }

  function handleLiveStatusChange(status, detail = {}) {
    liveStatus = status;
    if (status === 'connected') {
      updateLiveStatusIndicator('connected', detail);
      interactionLocked = false;
      if (manualFallback) {
        manualFallback = false;
      }
      setControlsEnabled(true);
      sendLiveJoin(detail?.isReconnect ? 'rejoined' : 'connected');
      broadcastScorekeeperState(detail?.isReconnect ? 'reconnect_sync' : 'sync');
    } else if (status === 'connecting' || status === 'reconnecting') {
      updateLiveStatusIndicator(status, detail);
      interactionLocked = true;
      setControlsEnabled(false);
    } else if (status === 'failed') {
      manualFallback = true;
      interactionLocked = false;
      setControlsEnabled(true);
      updateLiveStatusIndicator('manual');
    } else if (status === 'disconnected') {
      if (manualFallback) {
        updateLiveStatusIndicator('manual');
      } else {
        updateLiveStatusIndicator('disconnected', detail);
        interactionLocked = true;
        setControlsEnabled(false);
      }
    } else {
      updateLiveStatusIndicator(status, detail);
    }
  }

  function cleanupLiveChannel() {
    if (liveMessageUnsubscribe) {
      liveMessageUnsubscribe();
      liveMessageUnsubscribe = null;
    }
    if (liveStatusUnsubscribe) {
      liveStatusUnsubscribe();
      liveStatusUnsubscribe = null;
    }
    if (liveChannel) {
      liveChannel.disconnect();
    }
    liveChannel = null;
    liveClientId = null;
  }

  function initializeLiveChannel() {
    liveChannel = getLiveChannel();
    if (!liveChannel || matchId === null) {
      manualFallback = true;
      interactionLocked = false;
      setControlsEnabled(true);
      updateLiveStatusIndicator('manual');
      return;
    }
    liveClientId = liveChannel.getClientId();
    liveChannel.connect();
    liveMessageUnsubscribe = liveChannel.onMessage(handleLiveMessage);
    liveStatusUnsubscribe = liveChannel.onStatusChange(handleLiveStatusChange);
    updateLiveStatusIndicator('connecting');
    setControlsEnabled(false);
  }

  document.addEventListener('DOMContentLoaded', () => {
    attachEventListeners();
    updateDisplayAssignments();
    updateScoreDisplays();
    refreshAllTimeoutDisplays();
    loadInitialTeamNames();
    statusElement = document.getElementById('scorekeeperLiveStatus');
    setControlsEnabled(!interactionLocked || manualFallback);
    initializeLiveChannel();
  });

  window.addEventListener('beforeunload', () => {
    if (!manualFallback) {
      sendLiveLeave();
    }
    cleanupLiveChannel();
  });

  async function loadInitialTeamNames() {
    try {
      const response = await fetch('/api/config', { method: 'GET' });
      if (!response.ok) return;
      const data = await response.json();
      if (data && typeof data.homeTeam === 'string' && data.homeTeam.trim().length > 0) {
        scorekeeperState.labels.home = data.homeTeam.trim();
      }
    } catch (error) {
      console.warn('Unable to load configuration for scorekeeper.', error);
    } finally {
      const homeInput = document.getElementById('scorekeeperHomeName');
      if (homeInput) {
        homeInput.value = scorekeeperState.labels.home;
      }
      const oppInput = document.getElementById('scorekeeperOppName');
      if (oppInput) {
        oppInput.value = scorekeeperState.labels.opp;
      }
      syncTeamLabelDisplays();
      broadcastScorekeeperState('label_sync');
    }
  }

  function attachEventListeners() {
    const swapButton = document.getElementById('scorekeeperSwapBtn');
    if (swapButton) {
      swapButton.addEventListener('click', () => {
        swapDisplaySides();
      });
    }

    document.querySelectorAll('[data-role="score-zone"]').forEach((zone) => {
      zone.addEventListener('click', handleScoreZoneActivation);
      zone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleScoreZoneActivation(event);
        }
      });
    });

    document.querySelectorAll('.timeout-box').forEach((button) => {
      button.addEventListener('click', (event) => {
        const team = button.dataset.team;
        const index = parseInt(button.dataset.timeoutIndex || '', 10);
        if (!TEAM_KEYS.includes(team) || Number.isNaN(index)) {
          return;
        }
        handleTimeoutSelection(team, index, event);
      });
    });

    const resetScoresBtn = document.getElementById('scorekeeperResetScoresBtn');
    if (resetScoresBtn) {
      resetScoresBtn.addEventListener('click', resetScores);
    }

    const resetTimeoutsBtn = document.getElementById('scorekeeperResetTimeoutsBtn');
    if (resetTimeoutsBtn) {
      resetTimeoutsBtn.addEventListener('click', () => {
        if (!isApplyingRemoteUpdate && !canApplyLocalMutation()) {
          return;
        }
        TEAM_KEYS.forEach((team) => resetTeamTimeouts(team));
        refreshAllTimeoutDisplays();
        announceTimeoutStatus('All timeouts have been reset.');
        if (!isApplyingRemoteUpdate) {
          broadcastScorekeeperState('timeout_reset_all');
        }
      });
    }

    const homeInput = document.getElementById('scorekeeperHomeName');
    if (homeInput) {
      homeInput.addEventListener('input', () => {
        if (!isApplyingRemoteUpdate && !canApplyLocalMutation()) {
          return;
        }
        scorekeeperState.labels.home = normalizeTeamName(homeInput.value) || DEFAULT_LABELS.home;
        syncTeamLabelDisplays();
        if (!isApplyingRemoteUpdate) {
          broadcastScorekeeperState('label_change');
        }
      });
    }

    const oppInput = document.getElementById('scorekeeperOppName');
    if (oppInput) {
      oppInput.addEventListener('input', () => {
        if (!isApplyingRemoteUpdate && !canApplyLocalMutation()) {
          return;
        }
        scorekeeperState.labels.opp = normalizeTeamName(oppInput.value) || DEFAULT_LABELS.opp;
        syncTeamLabelDisplays();
        if (!isApplyingRemoteUpdate) {
          broadcastScorekeeperState('label_change');
        }
      });
    }
  }

  function normalizeTeamName(value) {
    return (value || '').toString().trim();
  }

  function updateDisplayAssignments() {
    const leftTeam = scorekeeperState.display.left;
    const rightTeam = scorekeeperState.display.right;

    const leftPanel = document.querySelector('.team-panel[data-position="left"]');
    const rightPanel = document.querySelector('.team-panel[data-position="right"]');

    if (leftPanel) {
      leftPanel.dataset.team = leftTeam;
      leftPanel.querySelectorAll('[data-role="score-zone"]').forEach((zone) => {
        zone.dataset.team = leftTeam;
      });
    }

    if (rightPanel) {
      rightPanel.dataset.team = rightTeam;
      rightPanel.querySelectorAll('[data-role="score-zone"]').forEach((zone) => {
        zone.dataset.team = rightTeam;
      });
    }

    document.querySelectorAll('.timeout-container').forEach((container) => {
      const position = container.dataset.position;
      if (position !== 'left' && position !== 'right') {
        return;
      }
      const team = scorekeeperState.display[position];
      container.dataset.team = team;
      container.querySelectorAll('.timeout-box').forEach((button) => {
        button.dataset.team = team;
      });
      container.setAttribute('aria-label', `${getTeamName(team)} timeouts`);
    });

    syncTeamLabelDisplays();
    refreshAllTimeoutDisplays();
    updateTimeoutTimerDisplay();
  }

  function syncTeamLabelDisplays() {
    const leftLabel = document.getElementById('scorekeeperLeftLabel');
    const rightLabel = document.getElementById('scorekeeperRightLabel');

    const leftTeam = scorekeeperState.display.left;
    const rightTeam = scorekeeperState.display.right;

    if (leftLabel) {
      leftLabel.textContent = getTeamName(leftTeam);
    }
    if (rightLabel) {
      rightLabel.textContent = getTeamName(rightTeam);
    }

    updateScoreZoneAriaLabels();
    updateTimeoutAriaLabels();
    updateTimeoutTimerDisplay();
  }

  function updateScoreZoneAriaLabels() {
    document.querySelectorAll('[data-role="score-zone"]').forEach((zone) => {
      const team = zone.dataset.team;
      if (!TEAM_KEYS.includes(team)) return;
      const action = zone.dataset.action === 'decrement' ? 'Decrease' : 'Increase';
      zone.setAttribute('aria-label', `${action} ${getTeamName(team)} score`);
    });
  }

  function updateTimeoutAriaLabels() {
    document.querySelectorAll('.timeout-container').forEach((container) => {
      const team = container.dataset.team;
      if (!TEAM_KEYS.includes(team)) return;
      container.setAttribute('aria-label', `${getTeamName(team)} timeouts`);
    });
  }

  function handleScoreZoneActivation(event) {
    const zone = event.currentTarget;
    const team = zone.dataset.team;
    if (!TEAM_KEYS.includes(team)) return;
    if (!isApplyingRemoteUpdate && !canApplyLocalMutation()) return;
    const action = zone.dataset.action;
    const delta = action === 'decrement' ? -1 : 1;
    adjustScore(team, delta);
  }

  function adjustScore(team, delta) {
    const current = scorekeeperState.scores[team] ?? 0;
    const next = clampScoreValue(current + delta);
    if (next === current) return;
    scorekeeperState.scores[team] = next;
    updateScoreDisplays();
    if (!isApplyingRemoteUpdate) {
      broadcastScorekeeperState('score_change');
    }
  }

  function clampScoreValue(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(99, Math.round(value)));
  }

  function formatScoreDisplay(value) {
    return clampScoreValue(value).toString().padStart(2, '0');
  }

  function updateScoreDisplays() {
    const leftTeam = scorekeeperState.display.left;
    const rightTeam = scorekeeperState.display.right;

    const leftScore = document.getElementById('scorekeeperLeftScore');
    const rightScore = document.getElementById('scorekeeperRightScore');

    if (leftScore) {
      leftScore.textContent = formatScoreDisplay(scorekeeperState.scores[leftTeam]);
    }
    if (rightScore) {
      rightScore.textContent = formatScoreDisplay(scorekeeperState.scores[rightTeam]);
    }
  }

  function swapDisplaySides() {
    if (!isApplyingRemoteUpdate && !canApplyLocalMutation()) {
      return;
    }
    const previousDisplay = { ...scorekeeperState.display };
    scorekeeperState.display.left = previousDisplay.right;
    scorekeeperState.display.right = previousDisplay.left;
    updateDisplayAssignments();
    announceTimeoutStatus('Team sides swapped.');
    updateScoreDisplays();
    if (!isApplyingRemoteUpdate) {
      broadcastScorekeeperState('swap');
    }
  }

  function getTeamName(team) {
    return scorekeeperState.labels[team] || DEFAULT_LABELS[team] || '';
  }

  function handleTimeoutSelection(team, index, event) {
    if (event) {
      event.stopPropagation();
    }
    if (!isApplyingRemoteUpdate && !canApplyLocalMutation()) {
      return;
    }
    if (!scorekeeperState.timeouts[team] || index < 0 || index >= TIMEOUT_COUNT) {
      return;
    }

    const used = scorekeeperState.timeouts[team][index];
    const isActive = scorekeeperState.activeTimeout[team] === index;

    if (used) {
      if (isActive) {
        stopTimeoutTimer(team);
        scorekeeperState.activeTimeout[team] = null;
        scorekeeperState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
      } else if (scorekeeperState.activeTimeout[team] === null) {
        scorekeeperState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
      }
      scorekeeperState.timeouts[team][index] = false;
      refreshTimeoutDisplayForTeam(team);
      announceTimeoutStatus(`${getTeamName(team)} timeout returned to available.`);
      if (!isApplyingRemoteUpdate) {
        broadcastScorekeeperState('timeout_toggle');
      }
      return;
    }

    stopTimeoutTimer(team);
    scorekeeperState.activeTimeout[team] = null;
    scorekeeperState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;

    scorekeeperState.timeouts[team][index] = true;
    scorekeeperState.activeTimeout[team] = index;
    startTimeoutTimer(team);
    refreshTimeoutDisplayForTeam(team);
    announceTimeoutStatus(`${getTeamName(team)} timeout started.`);
    if (!isApplyingRemoteUpdate) {
      broadcastScorekeeperState('timeout_toggle');
    }
  }

  function refreshAllTimeoutDisplays() {
    TEAM_KEYS.forEach((team) => refreshTimeoutDisplayForTeam(team));
    updateTimeoutTimerDisplay();
  }

  function refreshTimeoutDisplayForTeam(team) {
    const container = document.querySelector(`.timeout-container[data-team="${team}"]`);
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll('.timeout-box'));
    buttons.forEach((button, index) => {
      const used = Boolean(scorekeeperState.timeouts[team][index]);
      const isActive = scorekeeperState.activeTimeout[team] === index;
      button.classList.toggle('used', used);
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', used ? 'true' : 'false');
      let label = `${getTeamName(team)} ${ordinal(index + 1)} timeout ${used ? 'used' : 'available'}`;
      if (isActive && scorekeeperState.timeoutTimers[team]) {
        label += `. ${formatTimeoutDisplay(scorekeeperState.timeoutRemainingSeconds[team])} remaining`;
      }
      button.setAttribute('aria-label', label);
    });
    updateTimeoutTimerDisplay();
  }

  function resetScores() {
    if (!isApplyingRemoteUpdate && !canApplyLocalMutation()) {
      return;
    }
    scorekeeperState.scores.home = 0;
    scorekeeperState.scores.opp = 0;
    updateScoreDisplays();
    if (!isApplyingRemoteUpdate) {
      broadcastScorekeeperState('score_reset');
    }
  }

  function resetTeamTimeouts(team) {
    stopTimeoutTimer(team);
    scorekeeperState.timeouts[team] = Array(TIMEOUT_COUNT).fill(false);
    scorekeeperState.activeTimeout[team] = null;
    scorekeeperState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
    refreshTimeoutDisplayForTeam(team);
  }

  function startTimeoutTimer(team, { broadcast = true } = {}) {
    stopTimeoutTimer(team);
    scorekeeperState.timeoutTimers[team] = window.setInterval(() => {
      scorekeeperState.timeoutRemainingSeconds[team] = Math.max(
        0,
        scorekeeperState.timeoutRemainingSeconds[team] - 1
      );
      updateTimeoutTimerDisplay();
      if (broadcast && !isApplyingRemoteUpdate) {
        broadcastScorekeeperState('timeout_tick');
      }
      if (scorekeeperState.timeoutRemainingSeconds[team] <= 0) {
        stopTimeoutTimer(team);
        const activeIndex = scorekeeperState.activeTimeout[team];
        scorekeeperState.activeTimeout[team] = null;
        scorekeeperState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
        if (typeof activeIndex === 'number' && activeIndex >= 0) {
          refreshTimeoutDisplayForTeam(team);
        }
        updateTimeoutTimerDisplay();
        announceTimeoutStatus(`${getTeamName(team)} timeout complete.`);
        if (broadcast && !isApplyingRemoteUpdate) {
          broadcastScorekeeperState('timeout_complete');
        }
      }
    }, 1000);
    updateTimeoutTimerDisplay();
    if (broadcast && !isApplyingRemoteUpdate) {
      broadcastScorekeeperState('timeout_start');
    }
  }

  function stopTimeoutTimer(team) {
    const timerId = scorekeeperState.timeoutTimers[team];
    if (typeof timerId === 'number') {
      clearInterval(timerId);
    } else if (timerId && typeof timerId === 'object' && typeof timerId.refresh === 'function') {
      clearInterval(timerId);
    }
    scorekeeperState.timeoutTimers[team] = null;
    updateTimeoutTimerDisplay();
  }

  function getRunningTimeoutTeam() {
    for (const team of TEAM_KEYS) {
      if (scorekeeperState.timeoutTimers[team] && scorekeeperState.activeTimeout[team] !== null) {
        return team;
      }
    }
    return null;
  }

  function updateTimeoutTimerDisplay() {
    const display = document.getElementById('scorekeeperTimeoutDisplay');
    const srStatus = document.getElementById('scorekeeperTimeoutSrStatus');
    if (!display || !srStatus) return;

    const runningTeam = getRunningTimeoutTeam();
    if (!runningTeam) {
      display.classList.remove('show');
      display.removeAttribute('data-team');
      display.innerHTML = '';
      srStatus.textContent = 'No timeout running.';
      return;
    }

    const seconds = scorekeeperState.timeoutRemainingSeconds[runningTeam] ?? TIMEOUT_DURATION_SECONDS;
    display.classList.add('show');
    display.dataset.team = runningTeam;
    display.innerHTML = `
      <span class="timeout-timer-team">${getTeamName(runningTeam)}</span>
      <span class="timeout-timer-count">${formatTimeoutDisplay(seconds)}</span>
    `;
    srStatus.textContent = `${getTeamName(runningTeam)} timeout running. ${formatTimeoutDisplay(seconds)} remaining.`;
  }

  function formatTimeoutDisplay(seconds) {
    const safeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  function ordinal(value) {
    const remainder10 = value % 10;
    const remainder100 = value % 100;
    if (remainder10 === 1 && remainder100 !== 11) return `${value}st`;
    if (remainder10 === 2 && remainder100 !== 12) return `${value}nd`;
    if (remainder10 === 3 && remainder100 !== 13) return `${value}rd`;
    return `${value}th`;
  }

  function announceTimeoutStatus(message) {
    const srStatus = document.getElementById('scorekeeperTimeoutSrStatus');
    if (!srStatus) return;
    srStatus.textContent = message;
  }
})();
