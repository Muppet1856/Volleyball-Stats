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

  document.addEventListener('DOMContentLoaded', () => {
    attachEventListeners();
    updateDisplayAssignments();
    updateScoreDisplays();
    refreshAllTimeoutDisplays();
    loadInitialTeamNames();
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
        TEAM_KEYS.forEach((team) => resetTeamTimeouts(team));
        refreshAllTimeoutDisplays();
        announceTimeoutStatus('All timeouts have been reset.');
      });
    }

    const homeInput = document.getElementById('scorekeeperHomeName');
    if (homeInput) {
      homeInput.addEventListener('input', () => {
        scorekeeperState.labels.home = normalizeTeamName(homeInput.value) || DEFAULT_LABELS.home;
        syncTeamLabelDisplays();
      });
    }

    const oppInput = document.getElementById('scorekeeperOppName');
    if (oppInput) {
      oppInput.addEventListener('input', () => {
        scorekeeperState.labels.opp = normalizeTeamName(oppInput.value) || DEFAULT_LABELS.opp;
        syncTeamLabelDisplays();
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
    const previousDisplay = { ...scorekeeperState.display };
    scorekeeperState.display.left = previousDisplay.right;
    scorekeeperState.display.right = previousDisplay.left;
    updateDisplayAssignments();
    announceTimeoutStatus('Team sides swapped.');
    updateScoreDisplays();
  }

  function getTeamName(team) {
    return scorekeeperState.labels[team] || DEFAULT_LABELS[team] || '';
  }

  function handleTimeoutSelection(team, index, event) {
    if (event) {
      event.stopPropagation();
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
    scorekeeperState.scores.home = 0;
    scorekeeperState.scores.opp = 0;
    updateScoreDisplays();
  }

  function resetTeamTimeouts(team) {
    stopTimeoutTimer(team);
    scorekeeperState.timeouts[team] = Array(TIMEOUT_COUNT).fill(false);
    scorekeeperState.activeTimeout[team] = null;
    scorekeeperState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
    refreshTimeoutDisplayForTeam(team);
  }

  function startTimeoutTimer(team) {
    stopTimeoutTimer(team);
    scorekeeperState.timeoutTimers[team] = window.setInterval(() => {
      scorekeeperState.timeoutRemainingSeconds[team] = Math.max(0, scorekeeperState.timeoutRemainingSeconds[team] - 1);
      updateTimeoutTimerDisplay();
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
      }
    }, 1000);
    updateTimeoutTimerDisplay();
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
