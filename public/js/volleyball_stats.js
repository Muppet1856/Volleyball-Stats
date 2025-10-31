var gk_isXlsx = false;
var gk_xlsxFileLookup = {};
var gk_fileData = {};

const HOME_TEAM_FALLBACK = 'Home Team';
const HOME_TEAM_TEMPLATE_PATTERN = /\{homeTeam\}/g;
let homeTeamName = HOME_TEAM_FALLBACK;

function getHomeTeamName() {
  return homeTeamName || HOME_TEAM_FALLBACK;
}

function applyHomeTeamTemplates(homeName) {
  document.querySelectorAll('[data-home-team-template]').forEach((element) => {
    const template = element.getAttribute('data-home-team-template');
    if (typeof template === 'string') {
      element.textContent = template.replace(HOME_TEAM_TEMPLATE_PATTERN, () => homeName);
    }
  });
}

async function initializeHomeTeam() {
  let configuredName = '';
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const data = await response.json();
      const candidate = typeof data?.homeTeam === 'string' ? data.homeTeam.trim() : '';
      if (candidate) {
        configuredName = candidate;
      }
    }
  } catch (error) {
    console.warn('Unable to load home team configuration', error);
  }
  homeTeamName = configuredName || HOME_TEAM_FALLBACK;
  updateHomeTeamUI();
}

function updateHomeTeamUI() {
  const homeName = getHomeTeamName();
  applyHomeTeamTemplates(homeName);
  if (typeof updateOpponentName === 'function') {
    updateOpponentName();
  }
}

function filledCell(cell) {
  return cell !== '' && cell != null;
}

function loadFileData(filename) {
  if (gk_isXlsx && gk_xlsxFileLookup[filename]) {
    try {
      var workbook = XLSX.read(gk_fileData[filename], { type: 'base64' });
      var firstSheetName = workbook.SheetNames[0];
      var worksheet = workbook.Sheets[firstSheetName];

      // Convert sheet to JSON to filter blank rows
      var jsonData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        blankrows: false,
        defval: ''
      });
      // Filter out blank rows (rows where all cells are empty, null, or undefined)
      var filteredData = jsonData.filter(row => row.some(filledCell));

      // Heuristic to find the header row by ignoring rows with fewer filled cells than the next row
      var headerRowIndex = filteredData.findIndex((row, index) =>
        row.filter(filledCell).length >= filteredData[index + 1]?.filter(filledCell).length
      );
      // Fallback
      if (headerRowIndex === -1 || headerRowIndex > 25) {
        headerRowIndex = 0;
      }

      // Convert filtered JSON back to CSV
      var csv = XLSX.utils.aoa_to_sheet(filteredData.slice(headerRowIndex));
      csv = XLSX.utils.sheet_to_csv(csv, { header: 1 });
      return csv;
    } catch (e) {
      console.error(e);
      return "";
    }
  }
  return gk_fileData[filename] || "";
}

const apiClient = (() => {
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const init = { method, headers: body !== undefined ? { ...JSON_HEADERS, ...headers } : headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      if (!init.headers['Content-Type']) {
        init.headers['Content-Type'] = 'application/json';
      }
    }
    const response = await fetch(path, init);
    if (!response.ok) {
      let errorMessage = `${method} ${path} failed with status ${response.status}`;
      try {
        const errorText = await response.text();
        if (errorText) {
          errorMessage += `: ${errorText}`;
        }
      } catch (readError) {
        // Ignore read errors when constructing the message
      }
      throw new Error(errorMessage);
    }
    if (response.status === 204) {
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  }

  return {
    getPlayers: () => request('/api/players'),
    createPlayer: (player) => request('/api/players', { method: 'POST', body: player }),
    updatePlayer: (id, player) => request(`/api/players/${id}`, { method: 'PUT', body: player }),
    deletePlayer: (id) => request(`/api/players/${id}`, { method: 'DELETE' }),
    listMatches: () => request('/api/matches'),
    getMatch: (id) => request(`/api/matches/${id}`),
    createMatch: (match) => request('/api/matches', { method: 'POST', body: match }),
    updateMatch: (id, match) => request(`/api/matches/${id}`, { method: 'PUT', body: match }),
    deleteMatch: (id) => request(`/api/matches/${id}`, { method: 'DELETE' })
  };
})();

let playerRecords = [];
let players = [];
let playerSortMode = 'number';
    let finalizedSets = {};
    let isSwapped = false;
    let editingPlayerId = null;
    let loadedMatchPlayers = [];
    let autoSaveTimeout = null;
    let autoSaveStatusTimeout = null;
    let suppressAutoSave = true;
    let currentMatchId = null;
    let currentMatchRevision = 0;
    let hasPendingChanges = false;
    let openJerseySelectInstance = null;
    let scoreGameModalInstance = null;
    let jerseyConflictModalInstance = null;
    let jerseyConflictModalMessageElement = null;
    let jerseyThemeObserver = null;
    let isResolvingJerseyColorConflict = false;
    const SCORE_MODAL_FULLSCREEN_HEIGHT = 500;
    const TIMEOUT_COUNT = 2;
    const TIMEOUT_DURATION_SECONDS = 60;
    const SET_NUMBERS = [1, 2, 3, 4, 5];
    const scoreGameState = {
      setNumber: null,
      sc: null,
      opp: null,
      timeouts: {
        sc: Array(TIMEOUT_COUNT).fill(false),
        opp: Array(TIMEOUT_COUNT).fill(false)
      },
      activeTimeout: { sc: null, opp: null },
      timeoutTimers: { sc: null, opp: null },
      timeoutRemainingSeconds: {
        sc: TIMEOUT_DURATION_SECONDS,
        opp: TIMEOUT_DURATION_SECONDS
      }
    };
    let matchTimeouts = createEmptyMatchTimeouts();
    const finalizeButtonPopoverTimers = new WeakMap();
    const FINALIZE_TIE_POPOVER_TITLE = 'Scores tied';
    const FINALIZE_TIE_POPOVER_MESSAGE = 'Set scores are tied. Adjust one team\'s score before marking the set final.';

    function getScoreGameModalDialog() {
      const modalElement = document.getElementById('scoreGameModal');
      if (!modalElement) return null;
      return modalElement.querySelector('.modal-dialog');
    }

    function updateScoreGameModalLayout() {
      const dialog = getScoreGameModalDialog();
      if (!dialog) return;
      const shouldFullscreen = window.innerHeight < SCORE_MODAL_FULLSCREEN_HEIGHT;
      if (shouldFullscreen) {
        dialog.classList.add('modal-fullscreen', 'modal-dialog-scrollable');
        dialog.classList.remove('modal-lg', 'modal-dialog-centered');
      } else {
        dialog.classList.add('modal-lg', 'modal-dialog-centered');
        dialog.classList.remove('modal-fullscreen', 'modal-dialog-scrollable');
      }
    }

    function setScoreModalBackgroundLock(isLocked) {
      const className = 'score-modal-open';
      [document.body, document.documentElement].forEach(element => {
        if (!element) return;
        if (isLocked) {
          element.classList.add(className);
        } else {
          element.classList.remove(className);
        }
      });
    }
    function formatPlayerRecord(player) {
      const number = String(player.number ?? '').trim();
      const lastName = String(player.lastName ?? '').trim();
      const initial = String(player.initial ?? '').trim();
      return [number, lastName, initial].filter(Boolean).join(' ');
    }


    function comparePlayersByNumber(a, b) {
      const numberA = parseInt(a.number, 10);
      const numberB = parseInt(b.number, 10);
      if (!Number.isNaN(numberA) && !Number.isNaN(numberB) && numberA !== numberB) {
        return numberA - numberB;
      }
      if (!Number.isNaN(numberA) && Number.isNaN(numberB)) {
        return -1;
      }
      if (Number.isNaN(numberA) && !Number.isNaN(numberB)) {
        return 1;
      }
      const nameA = formatPlayerRecord(a);
      const nameB = formatPlayerRecord(b);
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    }

    function comparePlayersByName(a, b) {
      const lastA = String(a.lastName ?? '').trim().toLocaleLowerCase();
      const lastB = String(b.lastName ?? '').trim().toLocaleLowerCase();
      if (lastA !== lastB) {
        return lastA.localeCompare(lastB, undefined, { sensitivity: 'base' });
      }
      const firstA = String(a.initial ?? '').trim().toLocaleLowerCase();
      const firstB = String(b.initial ?? '').trim().toLocaleLowerCase();
      if (firstA !== firstB) {
        return firstA.localeCompare(firstB, undefined, { sensitivity: 'base' });
      }
      return comparePlayersByNumber(a, b);
    }

    function sortPlayerRecords(records) {
      const comparer = playerSortMode === 'name' ? comparePlayersByName : comparePlayersByNumber;
      return records.slice().sort(comparer);
    }

    function updatePlayerSortToggle() {
      const button = document.getElementById('playerSortToggleBtn');
      if (!button) return;
      const isNameSort = playerSortMode === 'name';
      button.textContent = `Sort: ${isNameSort ? 'Name' : 'Number'}`;
      button.setAttribute('aria-pressed', String(isNameSort));
      const description = isNameSort
        ? 'Sorted alphabetically by last name, then first initial and number.'
        : 'Sorted numerically by jersey number.';
      button.setAttribute('title', description);
    }

    function setPlayerRecords(records) {
      const safeRecords = Array.isArray(records) ? records : [];
      const sortedRecords = sortPlayerRecords(safeRecords);
      playerRecords = sortedRecords;
      players = sortedRecords.map(formatPlayerRecord);
      updatePlayerList();
      updateModalPlayerList();
      updatePlayerSortToggle();
    }

    function togglePlayerSortMode() {
      playerSortMode = playerSortMode === 'number' ? 'name' : 'number';
      setPlayerRecords(playerRecords);
    }


    async function loadPlayers() {
      try {
        const records = await apiClient.getPlayers();
        setPlayerRecords(Array.isArray(records) ? records.slice() : []);
      } catch (error) {
        console.error('Failed to load players', error);
      }
    }


    
    async function seedDemoPlayersIfEmpty() {
      try {
        const existing = await apiClient.getPlayers();
        if (Array.isArray(existing) && existing.length > 0) {
          return false;
        }
        const demoPlayers = [
          { number: 2, lastName: 'Anderson', initial: 'L' },
          { number: 4, lastName: 'Bennett', initial: 'K' },
          { number: 6, lastName: 'Chen', initial: 'M' },
          { number: 7, lastName: 'Diaz', initial: 'R' },
          { number: 9, lastName: 'Ellis', initial: 'S' },
          { number: 10, lastName: 'Foster', initial: 'J' },
          { number: 12, lastName: 'Garcia', initial: 'T' }
        ];
        for (const player of demoPlayers) {
          await apiClient.createPlayer(player);
        }
        return true;
      } catch (error) {
        console.error('Failed to seed demo players', error);
        throw error;
      }
    }


    function setAutoSaveStatus(message, className = 'text-muted', timeout = 2000) {
      const statusElement = document.getElementById('autoSaveStatus');
      if (!statusElement) return;
      statusElement.textContent = message;
      statusElement.className = message ? className : 'text-muted';
      statusElement.classList.toggle('d-none', !message);
      if (autoSaveStatusTimeout) clearTimeout(autoSaveStatusTimeout);
      if (timeout) {
        autoSaveStatusTimeout = setTimeout(() => {
          statusElement.textContent = '';
          statusElement.className = 'text-muted';
          statusElement.classList.add('d-none');
          autoSaveStatusTimeout = null;
        }, timeout);
      } else {
        autoSaveStatusTimeout = null;
      }
    }

    function scheduleAutoSave() {
      if (suppressAutoSave) return;
      hasPendingChanges = true;
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      setAutoSaveStatus('Saving…', 'text-warning', null);
      autoSaveTimeout = setTimeout(async () => {
        autoSaveTimeout = null;
        try {
          await saveMatch({ showAlert: false });
        } catch (error) {
          // Errors handled within saveMatch
        }
      }, 500);
    }

    function maybeRecalculateFinalResult(target) {
      if (!target || !target.id) return;
      const match = target.id.match(/^set(\d+)(SC|Opp)$/);
      if (!match) return;
      const setNumber = parseInt(match[1], 10);
      if (Number.isNaN(setNumber)) return;
      const { finalStateChanged } = updateFinalizeButtonState(setNumber);
      if (finalizedSets[setNumber] || finalStateChanged) {
        calculateResult();
      }
    }

    function clampScoreValue(value) {
      const number = typeof value === 'number' ? value : parseInt(value, 10);
      if (Number.isNaN(number)) return 0;
      return Math.min(99, Math.max(0, number));
    }

    function parseScoreValue(rawValue) {
      if (rawValue === '' || rawValue === null || rawValue === undefined) {
        return null;
      }
      const trimmed = String(rawValue).trim();
      if (!trimmed) return null;
      const parsed = parseInt(trimmed, 10);
      if (Number.isNaN(parsed)) return null;
      return clampScoreValue(parsed);
    }

    function formatScoreInputValue(value) {
      if (value === null || value === undefined || Number.isNaN(value)) {
        return '';
      }
      return clampScoreValue(value).toString();
    }

    function formatScoreDisplay(value) {
      if (value === null || value === undefined || Number.isNaN(value)) {
        return '00';
      }
      return clampScoreValue(value).toString().padStart(2, '0');
    }

    function normalizeScoreInputValue(rawValue) {
      const parsed = parseScoreValue(rawValue);
      return parsed === null ? '' : clampScoreValue(parsed).toString();
    }

    function normalizeStoredScoreValue(value) {
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'number') {
        return clampScoreValue(value).toString();
      }
      return normalizeScoreInputValue(String(value));
    }

    function clearFinalizePopoverTimer(button) {
      const timerId = finalizeButtonPopoverTimers.get(button);
      if (timerId) {
        clearTimeout(timerId);
        finalizeButtonPopoverTimers.delete(button);
      }
    }

    function showFinalizeTiePopover(button) {
      if (!button) return;
      let popover = bootstrap.Popover.getInstance(button);
      if (!popover) {
        popover = new bootstrap.Popover(button, {
          container: 'body',
          trigger: 'manual',
          placement: 'top',
          title: FINALIZE_TIE_POPOVER_TITLE,
          content: FINALIZE_TIE_POPOVER_MESSAGE,
          customClass: 'finalize-error-popover'
        });
      } else if (typeof popover.setContent === 'function') {
        popover.setContent({
          '.popover-header': FINALIZE_TIE_POPOVER_TITLE,
          '.popover-body': FINALIZE_TIE_POPOVER_MESSAGE
        });
      } else {
        button.setAttribute('data-bs-original-title', FINALIZE_TIE_POPOVER_TITLE);
        button.setAttribute('data-bs-content', FINALIZE_TIE_POPOVER_MESSAGE);
      }
      popover.show();
      try {
        button.focus({ preventScroll: true });
      } catch (error) {
        button.focus();
      }
      clearFinalizePopoverTimer(button);
      const timerId = setTimeout(() => {
        popover.hide();
        finalizeButtonPopoverTimers.delete(button);
      }, 2400);
      finalizeButtonPopoverTimers.set(button, timerId);
    }

    function updateFinalizeButtonState(setNumber) {
      const button = document.getElementById(`finalizeButton${setNumber}`);
      const scInput = document.getElementById(`set${setNumber}SC`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (!button || !scInput || !oppInput) {
        return { isTie: false, finalStateChanged: false };
      }
      const scRaw = scInput.value.trim();
      const oppRaw = oppInput.value.trim();
      const bothScoresEntered = scRaw !== '' && oppRaw !== '';
      const scScore = parseScoreValue(scRaw);
      const oppScore = parseScoreValue(oppRaw);
      const isTie = bothScoresEntered && scScore === oppScore;
      button.classList.toggle('finalize-btn-error', isTie);
      if (isTie) {
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.removeAttribute('aria-disabled');
      }
      if (!isTie) {
        const popover = bootstrap.Popover.getInstance(button);
        if (popover) {
          popover.hide();
        }
        clearFinalizePopoverTimer(button);
      }
      let finalStateChanged = false;
      if (isTie && finalizedSets[setNumber]) {
        delete finalizedSets[setNumber];
        button.classList.remove('finalized-btn');
        finalStateChanged = true;
      }
      return { isTie, finalStateChanged };
    }

    function updateAllFinalizeButtonStates() {
      for (let i = 1; i <= 5; i++) {
        updateFinalizeButtonState(i);
      }
    }

    function updateScoreModalDisplay() {
      const scDisplay = document.getElementById('scoreGameScDisplay');
      const oppDisplay = document.getElementById('scoreGameOppDisplay');
      if (scDisplay) scDisplay.textContent = formatScoreDisplay(scoreGameState.sc);
      if (oppDisplay) oppDisplay.textContent = formatScoreDisplay(scoreGameState.opp);
    }

    function formatTimeoutDisplay(seconds) {
      const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
      const minutes = Math.floor(safeSeconds / 60);
      const remainingSeconds = safeSeconds % 60;
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    function getTimeoutTeamName(team) {
      const homeTeamHeaderId = isSwapped ? 'oppHeader' : 'scHeader';
      const opponentHeaderId = isSwapped ? 'scHeader' : 'oppHeader';
      if (team === 'opp') {
        return getTeamHeaderName(opponentHeaderId, 'Opponent');
      }
      return getTeamHeaderName(homeTeamHeaderId, getHomeTeamName());
    }

    function getTimeoutOrdinalLabel(index) {
      return index === 0 ? 'first' : 'second';
    }

    function createEmptySetTimeouts() {
      return {
        sc: Array(TIMEOUT_COUNT).fill(false),
        opp: Array(TIMEOUT_COUNT).fill(false)
      };
    }

    function createEmptyMatchTimeouts() {
      const state = {};
      SET_NUMBERS.forEach((setNumber) => {
        state[setNumber] = createEmptySetTimeouts();
      });
      return state;
    }

    function cloneTimeoutArray(values) {
      const normalized = Array(TIMEOUT_COUNT).fill(false);
      if (Array.isArray(values)) {
        for (let i = 0; i < Math.min(values.length, TIMEOUT_COUNT); i++) {
          normalized[i] = Boolean(values[i]);
        }
      }
      return normalized;
    }

    function getMatchTimeoutState(setNumber) {
      if (!matchTimeouts[setNumber]) {
        matchTimeouts[setNumber] = createEmptySetTimeouts();
      }
      return matchTimeouts[setNumber];
    }

    function setMatchTimeoutState(setNumber, timeouts) {
      matchTimeouts[setNumber] = {
        sc: cloneTimeoutArray(timeouts?.sc),
        opp: cloneTimeoutArray(timeouts?.opp)
      };
    }

    function swapSetTimeoutState(state) {
      return {
        sc: cloneTimeoutArray(state?.opp),
        opp: cloneTimeoutArray(state?.sc)
      };
    }

    function swapAllStoredTimeouts() {
      SET_NUMBERS.forEach((setNumber) => {
        const current = getMatchTimeoutState(setNumber);
        matchTimeouts[setNumber] = swapSetTimeoutState(current);
      });
    }

    function persistCurrentSetTimeouts() {
      const { setNumber } = scoreGameState;
      if (!setNumber) return;
      const stored = getMatchTimeoutState(setNumber);
      stored.sc = scoreGameState.timeouts.sc.slice(0, TIMEOUT_COUNT).map(Boolean);
      stored.opp = scoreGameState.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean);
    }

    function loadSetTimeoutsIntoScoreState(setNumber) {
      const stored = getMatchTimeoutState(setNumber);
      ['sc', 'opp'].forEach(team => {
        stopTimeoutTimer(team);
        scoreGameState.timeouts[team] = stored[team].slice();
        scoreGameState.activeTimeout[team] = null;
        scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
      });
      refreshAllTimeoutDisplays();
    }

    function stopTimeoutTimer(team) {
      const timerId = scoreGameState.timeoutTimers[team];
      if (timerId) {
        clearInterval(timerId);
        scoreGameState.timeoutTimers[team] = null;
      }
    }

    function startTimeoutTimer(team) {
      stopTimeoutTimer(team);
      scoreGameState.timeoutTimers[team] = window.setInterval(() => {
        scoreGameState.timeoutRemainingSeconds[team] = Math.max(0, scoreGameState.timeoutRemainingSeconds[team] - 1);
        updateTimeoutUI(team);
        if (scoreGameState.timeoutRemainingSeconds[team] <= 0) {
          stopTimeoutTimer(team);
          scoreGameState.activeTimeout[team] = null;
          updateTimeoutUI(team);
        }
      }, 1000);
    }

    function getRunningTimeoutTeam() {
      return ['sc', 'opp'].find(team => Boolean(scoreGameState.timeoutTimers[team])) || null;
    }

    function cancelActiveTimeoutTimer() {
      const runningTeam = getRunningTimeoutTeam();
      if (!runningTeam) {
        return false;
      }
      stopTimeoutTimer(runningTeam);
      scoreGameState.activeTimeout[runningTeam] = null;
      scoreGameState.timeoutRemainingSeconds[runningTeam] = TIMEOUT_DURATION_SECONDS;
      updateTimeoutUI(runningTeam);
      return true;
    }

    function updateTimeoutTimerDisplay() {
      const displayElement = document.getElementById('scoreGameTimeoutDisplay');
      const statusElement = document.getElementById('scoreGameTimeoutSrStatus');
      const runningTeam = getRunningTimeoutTeam();

      if (!displayElement) {
        if (statusElement) {
          statusElement.textContent = runningTeam
            ? `${getTimeoutTeamName(runningTeam)} timeout running. ${formatTimeoutDisplay(scoreGameState.timeoutRemainingSeconds[runningTeam])} remaining.`
            : '';
        }
        return;
      }

      if (!runningTeam) {
        displayElement.classList.remove('show');
        displayElement.removeAttribute('data-team');
        displayElement.innerHTML = '';
        if (statusElement) {
          statusElement.textContent = '';
        }
        return;
      }

      const seconds = scoreGameState.timeoutRemainingSeconds[runningTeam];
      const formatted = formatTimeoutDisplay(seconds);
      const teamName = getTimeoutTeamName(runningTeam);

      displayElement.classList.add('show');
      displayElement.setAttribute('data-team', runningTeam);
      displayElement.innerHTML = `
        <span class="timeout-timer-team">${teamName} timeout</span>
        <span class="timeout-timer-count">${formatted}</span>
      `.trim();

      if (statusElement) {
        statusElement.textContent = `${teamName} timeout running. ${formatted} remaining.`;
      }
    }

    function updateTimeoutUI(team) {
      const container = document.querySelector(`#scoreGameModal .timeout-container[data-team="${team}"]`);
      if (container) {
        const buttons = container.querySelectorAll('.timeout-box');
        const teamName = getTimeoutTeamName(team);
        container.setAttribute('aria-label', `${teamName} timeouts`);
        const isRunning = Boolean(scoreGameState.timeoutTimers[team]);
        const activeIndex = scoreGameState.activeTimeout[team];
        buttons.forEach(button => {
          const index = parseInt(button.getAttribute('data-timeout-index'), 10);
          if (Number.isNaN(index)) return;
          const used = Boolean(scoreGameState.timeouts[team][index]);
          const isActive = activeIndex === index;
          const textSpan = button.querySelector('.timeout-box-text');
          if (textSpan) {
            textSpan.textContent = 'TO';
          }
          button.classList.toggle('used', used);
          button.classList.toggle('active', isActive && isRunning);
          button.setAttribute('aria-pressed', used ? 'true' : 'false');
          let label = `${teamName} ${getTimeoutOrdinalLabel(index)} timeout ${used ? 'used' : 'available'}`;
          if (isActive && isRunning) {
            label += `. ${formatTimeoutDisplay(scoreGameState.timeoutRemainingSeconds[team])} remaining`;
          }
          button.setAttribute('aria-label', label);
        });
      }
      updateTimeoutTimerDisplay();
    }

    function refreshAllTimeoutDisplays() {
      updateTimeoutUI('sc');
      updateTimeoutUI('opp');
    }

    function swapScoreGameTimeoutState() {
      const wasRunning = {
        sc: Boolean(scoreGameState.timeoutTimers.sc),
        opp: Boolean(scoreGameState.timeoutTimers.opp)
      };
      const previousActive = {
        sc: scoreGameState.activeTimeout.sc,
        opp: scoreGameState.activeTimeout.opp
      };
      const previousRemaining = {
        sc: scoreGameState.timeoutRemainingSeconds.sc ?? TIMEOUT_DURATION_SECONDS,
        opp: scoreGameState.timeoutRemainingSeconds.opp ?? TIMEOUT_DURATION_SECONDS
      };

      stopTimeoutTimer('sc');
      stopTimeoutTimer('opp');

      const swappedTimeouts = swapSetTimeoutState(scoreGameState.timeouts);
      scoreGameState.timeouts.sc = swappedTimeouts.sc;
      scoreGameState.timeouts.opp = swappedTimeouts.opp;

      scoreGameState.activeTimeout.sc = previousActive.opp ?? null;
      scoreGameState.activeTimeout.opp = previousActive.sc ?? null;

      scoreGameState.timeoutRemainingSeconds.sc = previousRemaining.opp;
      scoreGameState.timeoutRemainingSeconds.opp = previousRemaining.sc;

      if (wasRunning.opp && scoreGameState.activeTimeout.sc !== null) {
        startTimeoutTimer('sc');
      }

      if (wasRunning.sc && scoreGameState.activeTimeout.opp !== null) {
        startTimeoutTimer('opp');
      }

      updateTimeoutUI('sc');
      updateTimeoutUI('opp');
    }

    function updateTimeoutLayoutForSwap() {
      const timeoutBar = document.querySelector('#scoreGameModal .timeout-bar');
      if (timeoutBar) {
        // Keep the timeout bar layout consistent regardless of swap state so the
        // team colors always remain aligned with their buttons.
        timeoutBar.classList.remove('timeout-bar-swapped');
      }
    }

    function handleTimeoutSelection(team, index, event) {
      if (event) {
        event.stopPropagation();
      }
      if (!scoreGameState.timeouts[team] || index < 0 || index >= scoreGameState.timeouts[team].length) {
        return;
      }
      const used = scoreGameState.timeouts[team][index];
      const isActive = scoreGameState.activeTimeout[team] === index;

      if (used) {
        if (isActive) {
          stopTimeoutTimer(team);
          scoreGameState.activeTimeout[team] = null;
          scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
        } else if (scoreGameState.activeTimeout[team] === null) {
          scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
        }
        scoreGameState.timeouts[team][index] = false;
        updateTimeoutUI(team);
        persistCurrentSetTimeouts();
        scheduleAutoSave();
        return;
      }

      stopTimeoutTimer(team);
      scoreGameState.activeTimeout[team] = null;
      scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;

      scoreGameState.timeouts[team][index] = true;
      scoreGameState.activeTimeout[team] = index;
      startTimeoutTimer(team);
      updateTimeoutUI(team);
      persistCurrentSetTimeouts();
      scheduleAutoSave();
    }

    function resetTeamTimeouts(team, { skipPersist = false } = {}) {
      stopTimeoutTimer(team);
      scoreGameState.timeouts[team] = Array(TIMEOUT_COUNT).fill(false);
      scoreGameState.activeTimeout[team] = null;
      scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
      updateTimeoutUI(team);
      if (!skipPersist) {
        persistCurrentSetTimeouts();
      }
    }

    function resetAllTimeouts({ resetStored = false } = {}) {
      if (resetStored) {
        matchTimeouts = createEmptyMatchTimeouts();
      }
      resetTeamTimeouts('sc', { skipPersist: true });
      resetTeamTimeouts('opp', { skipPersist: true });
      persistCurrentSetTimeouts();
    }

    function updateScoreColorClasses() {
      const scHeader = document.getElementById('scHeader');
      const oppHeader = document.getElementById('oppHeader');
      if (scHeader) {
        scHeader.classList.add('left-score');
        scHeader.classList.remove('right-score');
      }
      if (oppHeader) {
        oppHeader.classList.add('right-score');
        oppHeader.classList.remove('left-score');
      }

      for (let i = 1; i <= 5; i++) {
        const scInput = document.getElementById(`set${i}SC`);
        const oppInput = document.getElementById(`set${i}Opp`);
        if (scInput) {
          scInput.classList.add('left-score');
          scInput.classList.remove('right-score');
        }
        if (oppInput) {
          oppInput.classList.add('right-score');
          oppInput.classList.remove('left-score');
        }
      }

      const teamPanels = document.querySelectorAll('#scoreGameModal .team-panel');
      if (teamPanels.length >= 2) {
        const [leftPanel, rightPanel] = teamPanels;
        leftPanel.classList.add('team-blue');
        leftPanel.classList.remove('team-red');
        rightPanel.classList.add('team-red');
        rightPanel.classList.remove('team-blue');
      }
    }

    function updateScoreModalLabels() {
      const leftLabel = document.getElementById('scoreGameLeftLabel');
      const rightLabel = document.getElementById('scoreGameRightLabel');
      const leftName = getTeamHeaderName('scHeader', getHomeTeamName());
      const rightName = getTeamHeaderName('oppHeader', 'Opponent');
      if (leftLabel) leftLabel.textContent = leftName;
      if (rightLabel) rightLabel.textContent = rightName;
      const scIncrementZone = document.querySelector('#scoreGameModal .score-zone.increment[data-team="sc"]');
      const scDecrementZone = document.querySelector('#scoreGameModal .score-zone.decrement[data-team="sc"]');
      const oppIncrementZone = document.querySelector('#scoreGameModal .score-zone.increment[data-team="opp"]');
      const oppDecrementZone = document.querySelector('#scoreGameModal .score-zone.decrement[data-team="opp"]');
      if (scIncrementZone) scIncrementZone.setAttribute('aria-label', `Increase ${leftName} score`);
      if (scDecrementZone) scDecrementZone.setAttribute('aria-label', `Decrease ${leftName} score`);
      if (oppIncrementZone) oppIncrementZone.setAttribute('aria-label', `Increase ${rightName} score`);
      if (oppDecrementZone) oppDecrementZone.setAttribute('aria-label', `Decrease ${rightName} score`);
      refreshAllTimeoutDisplays();
      updateTimeoutLayoutForSwap();
      updateScoreColorClasses();
    }

    function applyScoreModalToInputs({ triggerSave = true } = {}) {
      const { setNumber } = scoreGameState;
      if (!setNumber) return;
      const scInput = document.getElementById(`set${setNumber}SC`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (scInput) scInput.value = formatScoreInputValue(scoreGameState.sc);
      if (oppInput) oppInput.value = formatScoreInputValue(scoreGameState.opp);
      const { finalStateChanged } = updateFinalizeButtonState(setNumber);
      if (triggerSave) {
        calculateResult();
        scheduleAutoSave();
      } else if (finalStateChanged) {
        calculateResult();
      }
    }

    function adjustScoreModal(team, delta) {
      const key = team === 'opp' ? 'opp' : 'sc';
      const currentValue = scoreGameState[key];
      const baseValue = currentValue === null || currentValue === undefined ? 0 : currentValue;
      const newValue = clampScoreValue(baseValue + delta);
      if (newValue === scoreGameState[key]) return;
      scoreGameState[key] = newValue;
      updateScoreModalDisplay();
      applyScoreModalToInputs();
    }

    function openScoreGameModal(setNumber) {
      const scInput = document.getElementById(`set${setNumber}SC`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (!scInput || !oppInput) return;
      if (scoreGameState.setNumber !== null) {
        persistCurrentSetTimeouts();
        if (scoreGameState.setNumber !== setNumber) {
          cancelActiveTimeoutTimer();
        }
      }
      scoreGameState.setNumber = setNumber;
      scoreGameState.sc = parseScoreValue(scInput.value);
      scoreGameState.opp = parseScoreValue(oppInput.value);
      loadSetTimeoutsIntoScoreState(setNumber);
      updateScoreModalLabels();
      updateScoreModalDisplay();
      applyScoreModalToInputs({ triggerSave: false });
      const modalTitle = document.getElementById('scoreGameModalLabel');
      if (modalTitle) modalTitle.textContent = `Score Game – Set ${setNumber}`;
      if (!scoreGameModalInstance) {
        const modalElement = document.getElementById('scoreGameModal');
        if (modalElement) {
          scoreGameModalInstance = new bootstrap.Modal(modalElement);
        }
      }
      if (scoreGameModalInstance) {
        updateScoreGameModalLayout();
        scoreGameModalInstance.show();
      }
    }

    
    async function savePlayer(number, lastName, initial, id = null) {
      const payload = {
        number: number,
        lastName: lastName,
        initial: initial || ''
      };
      try {
        if (id !== null) {
          await apiClient.updatePlayer(id, payload);
        } else {
          await apiClient.createPlayer(payload);
        }
        await loadPlayers();
      } catch (error) {
        console.error('Failed to save player', error);
        alert('Unable to save player. Please try again.');
      }
    }


    
    async function deletePlayer(id) {
      try {
        await apiClient.deletePlayer(id);
        if (editingPlayerId === id) {
          resetPlayerForm();
        }
        await loadPlayers();
      } catch (error) {
        console.error('Failed to delete player', error);
        alert('Unable to delete player. Please try again.');
      }
    }


    function getTeamHeaderButton(headerId) {
      const header = document.getElementById(headerId);
      return header ? header.querySelector('.team-name-button') : null;
    }

    function getTeamAbbreviation(name = '') {
      const trimmed = name.trim();
      if (!trimmed) return '';
      const parts = trimmed
        .replace(/[^A-Za-z0-9\s-]+/g, ' ')
        .split(/[-\s]+/)
        .filter(Boolean);
      if (!parts.length) return trimmed.toUpperCase();
      return parts.map(part => part[0].toUpperCase()).join('');
    }

    function updateTeamHeaderButtonDisplay(button) {
      if (!button) return;
      const fullName = button.dataset.fullName || button.textContent.trim();
      const abbreviation = button.dataset.abbr || getTeamAbbreviation(fullName);
      button.textContent = fullName;
      button.dataset.displayMode = 'full';
      if (fullName && abbreviation && button.scrollWidth > button.clientWidth + 1) {
        button.textContent = abbreviation;
        button.dataset.displayMode = 'abbr';
      }
    }

    function scheduleTeamHeaderButtonDisplayUpdate(button) {
      if (!button) return;
      requestAnimationFrame(() => updateTeamHeaderButtonDisplay(button));
    }

    function refreshAllTeamHeaderButtons() {
      document.querySelectorAll('.team-name-button').forEach(updateTeamHeaderButtonDisplay);
    }

    function getTeamHeaderName(headerId, fallback) {
      const button = getTeamHeaderButton(headerId);
      if (button) {
        const fullName = button.dataset.fullName || button.textContent.trim();
        if (fullName) return fullName;
      }
      const header = document.getElementById(headerId);
      if (header && header.textContent.trim()) {
        return header.textContent.trim();
      }
      return fallback;
    }

    function setTeamHeaderName(headerId, name, { roleDescription } = {}) {
      const safeName = name || '';
      const button = getTeamHeaderButton(headerId);
      if (button) {
        const abbreviation = getTeamAbbreviation(safeName);
        button.dataset.fullName = safeName;
        button.dataset.abbr = abbreviation;
        button.textContent = safeName;
        button.setAttribute('data-bs-content', safeName);
        button.setAttribute('title', safeName);
        if (roleDescription) {
          button.setAttribute('aria-label', `${roleDescription}: ${safeName}. Press or tap to view full name.`);
        } else {
          button.setAttribute('aria-label', `${safeName}. Press or tap to view full name.`);
        }
        const instance = window.bootstrap ? window.bootstrap.Popover.getInstance(button) : null;
        if (instance && typeof instance.setContent === 'function') {
          instance.setContent({ '.popover-body': safeName });
        }
        scheduleTeamHeaderButtonDisplayUpdate(button);
      } else {
        const header = document.getElementById(headerId);
        if (header) {
          header.textContent = safeName;
        }
      }
    }

    function initializeTeamHeaderPopovers() {
      if (!window.bootstrap || !window.bootstrap.Popover) return;
      document.querySelectorAll('.team-name-button[data-bs-toggle="popover"]').forEach(button => {
        const existing = window.bootstrap.Popover.getInstance(button);
        if (existing) {
          existing.dispose();
        }
        const content = button.dataset.fullName || button.getAttribute('data-bs-content') || button.textContent.trim();
        new window.bootstrap.Popover(button, {
          trigger: 'focus',
          placement: button.getAttribute('data-bs-placement') || 'bottom',
          content
        });
        scheduleTeamHeaderButtonDisplayUpdate(button);
      });
    }

    function getOpponentTeamName() {
      const opponentInput = document.getElementById('opponent');
      if (!opponentInput) return 'Opponent';
      const trimmed = opponentInput.value.trim();
      return trimmed || 'Opponent';
    }

    function updateOpponentName() {
      const opponentName = getOpponentTeamName();
      const jerseyColorOppLabel = document.getElementById('jerseyColorOppLabel');
      const resultOppLabel = document.getElementById('resultOppLabel');
      if (jerseyColorOppLabel) jerseyColorOppLabel.textContent = `Jersey Color (${opponentName})`;
      if (resultOppLabel) resultOppLabel.textContent = opponentName;
      updateFirstServeOptions();
      updateSetHeaders(opponentName, isSwapped);
    }

    function updateFirstServeOptions() {
      const opponentInput = document.getElementById('opponent').value.trim();
      const opponentName = opponentInput || 'Opponent';
      const select = document.getElementById('firstServer');
      if (!select) return;

      const previousValue = select.value;

      select.innerHTML = '';
      const homeName = getHomeTeamName();
      const homeOption = document.createElement('option');
      homeOption.value = homeName;
      homeOption.textContent = homeName;
      select.appendChild(homeOption);
      const opponentOption = document.createElement('option');
      opponentOption.value = opponentName;
      opponentOption.textContent = opponentName;
      select.appendChild(opponentOption);

      const normalizedPrevious = (previousValue || '').trim();
      const normalizedLower = normalizedPrevious.toLocaleLowerCase();
      const homeLower = homeName.toLocaleLowerCase();
      const fallbackLower = HOME_TEAM_FALLBACK.toLocaleLowerCase();
      if (normalizedLower === homeLower || normalizedLower === fallbackLower) {
        select.value = homeName;
      } else if (normalizedPrevious) {
        select.value = opponentName;
      }
    }

    function setFirstServerSelection(value) {
      const select = document.getElementById('firstServer');
      if (!select) return;

      const normalized = (value ?? '').trim();
      if (!normalized) {
        select.value = '';
        return;
      }

      const optionsArray = Array.from(select.options);
      const normalizedLower = normalized.toLocaleLowerCase();
      const homeLower = getHomeTeamName().toLocaleLowerCase();
      const fallbackLower = HOME_TEAM_FALLBACK.toLocaleLowerCase();

      if (normalizedLower === homeLower || normalizedLower === fallbackLower) {
        const homeOption = optionsArray.find(option => option.value.toLocaleLowerCase() === homeLower);
        if (homeOption) {
          select.value = homeOption.value;
          return;
        }
      }

      const exactMatch = optionsArray.find(option => option.value === normalized);
      if (exactMatch) {
        select.value = normalized;
        return;
      }

      const caseInsensitiveMatch = optionsArray.find(
        option => option.value.toLocaleLowerCase() === normalizedLower
      );
      if (caseInsensitiveMatch) {
        select.value = caseInsensitiveMatch.value;
        return;
      }

      select.value = '';
    }

    function updateSetHeaders(opponentName, swapped) {
      const baseHomeName = getHomeTeamName();
      const homeName = swapped ? opponentName : baseHomeName;
      const awayName = swapped ? baseHomeName : opponentName;
      setTeamHeaderName('scHeader', homeName, { roleDescription: 'Home team' });
      setTeamHeaderName('oppHeader', awayName, { roleDescription: 'Opponent team' });
      updateScoreModalLabels();
    }

    function syncScoreGameModalAfterSwap() {
      const modalElement = document.getElementById('scoreGameModal');
      if (!modalElement || !modalElement.classList.contains('show')) return;
      updateScoreModalLabels();
      const { setNumber } = scoreGameState;
      if (!setNumber) return;
      const scInput = document.getElementById(`set${setNumber}SC`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (!scInput || !oppInput) return;
      scoreGameState.sc = parseScoreValue(scInput.value);
      scoreGameState.opp = parseScoreValue(oppInput.value);
      updateScoreModalDisplay();
    }

    function swapScores() {
      persistCurrentSetTimeouts();
      isSwapped = !isSwapped;
      swapAllStoredTimeouts();
      swapScoreGameTimeoutState();
      const opponentInput = document.getElementById('opponent').value.trim();
      const opponentName = opponentInput || 'Opponent';
      for (let i = 1; i <= 5; i++) {
        const scScore = document.getElementById(`set${i}SC`).value;
        const oppScore = document.getElementById(`set${i}Opp`).value;
        document.getElementById(`set${i}SC`).value = oppScore;
        document.getElementById(`set${i}Opp`).value = scScore;
      }
      updateAllFinalizeButtonStates();
      updateSetHeaders(opponentName, isSwapped); // Update headers after swap
      refreshAllTeamHeaderButtons();
      if (Object.keys(finalizedSets).length > 0) {
        calculateResult();
      }
      scheduleAutoSave();
      syncScoreGameModalAfterSwap();
    }

    
    async function submitPlayer() {
      const number = document.getElementById('number').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const initial = document.getElementById('initial').value.trim() || '';
      if (number && lastName) {
        const idToSave = editingPlayerId !== null ? editingPlayerId : null;
        await savePlayer(number, lastName, initial, idToSave);
      }
      resetPlayerForm();
    }


    function updatePlayerList() {
      const list = document.getElementById('playerList');
      list.innerHTML = '';
      players.forEach((player, index) => {
        const div = document.createElement('div');
        div.className = 'player-item form-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = player;
        checkbox.className = 'form-check-input';
        const checkboxId = `player-select-${index}`;
        checkbox.id = checkboxId;
        if (loadedMatchPlayers.includes(player)) {
          checkbox.checked = true;
        }
        div.appendChild(checkbox);
        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.setAttribute('for', checkboxId);
        label.appendChild(createPlayerDisplay(player));
        div.appendChild(label);
        list.appendChild(div);
      });
      applyJerseyColorToNumbers();
    }

    const JERSEY_SWATCH_SVG_PATH = 'M15 10l9-6h16l9 6 5 14-11 5v21H21V29l-11-5z';

    const jerseyColorValues = {
      white: '#ffffff',
      grey: '#808080',
      black: '#000000',
      yellow: '#ffd700',
      orange: '#ff8c00',
      red: '#dc3545',
      green: '#198754',
      blue: '#0d6efd',
      purple: '#6f42c1',
      pink: '#d63384'
    };

    const jerseyColorContrast = {
      white: '#000000',
      yellow: '#000000',
      orange: '#000000',
      pink: '#000000',
      grey: '#ffffff',
      black: '#ffffff',
      red: '#ffffff',
      green: '#ffffff',
      blue: '#ffffff',
      purple: '#ffffff'
    };

    const JERSEY_CONFLICT_NOTE = 'If both teams have the same color, choose the libero color.';

    const JERSEY_CONTRAST_RATIO_THRESHOLD = 3;

    function parseCssColor(value) {
      if (!value) return null;
      const color = value.trim().toLowerCase();
      if (!color) return null;
      if (color === 'transparent') {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
          hex = hex.split('').map(char => char + char).join('');
        }
        const intVal = parseInt(hex, 16);
        return {
          r: (intVal >> 16) & 255,
          g: (intVal >> 8) & 255,
          b: intVal & 255,
          a: 1
        };
      }
      const rgbMatch = color.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
      if (rgbMatch) {
        const [, r, g, b, a] = rgbMatch;
        return {
          r: Math.max(0, Math.min(255, parseFloat(r))),
          g: Math.max(0, Math.min(255, parseFloat(g))),
          b: Math.max(0, Math.min(255, parseFloat(b))),
          a: a !== undefined ? Math.max(0, Math.min(1, parseFloat(a))) : 1
        };
      }
      return null;
    }

    function relativeLuminance({ r, g, b }) {
      const convertChannel = (channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      const rL = convertChannel(r);
      const gL = convertChannel(g);
      const bL = convertChannel(b);
      return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
    }

    function getContrastRatio(colorA, colorB) {
      if (!colorA || !colorB) return Number.POSITIVE_INFINITY;
      const lumA = relativeLuminance(colorA);
      const lumB = relativeLuminance(colorB);
      const lighter = Math.max(lumA, lumB);
      const darker = Math.min(lumA, lumB);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function getContrastingOutlineColor(color) {
      if (!color) return '#000000';
      const black = { r: 0, g: 0, b: 0 };
      const white = { r: 255, g: 255, b: 255 };
      const contrastWithBlack = getContrastRatio(color, black);
      const contrastWithWhite = getContrastRatio(color, white);
      return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
    }

    function getEffectiveBackgroundColor(element) {
      let current = element ? element.parentElement : null;
      while (current) {
        const style = window.getComputedStyle(current);
        const parsed = parseCssColor(style.backgroundColor);
        if (parsed && parsed.a > 0) {
          return parsed;
        }
        current = current.parentElement;
      }
      const bodyColor = parseCssColor(window.getComputedStyle(document.body).backgroundColor);
      if (bodyColor && bodyColor.a > 0) return bodyColor;
      const rootColor = parseCssColor(window.getComputedStyle(document.documentElement).backgroundColor);
      if (rootColor && rootColor.a > 0) return rootColor;
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function computeContrastOutlineColor(element, fillColor, fallbackColor) {
      const parsedFill = parseCssColor(fillColor);
      if (!element || !parsedFill) return fallbackColor;
      const backgroundColor = getEffectiveBackgroundColor(element);
      const contrast = getContrastRatio(parsedFill, backgroundColor);
      if (!Number.isFinite(contrast) || contrast < JERSEY_CONTRAST_RATIO_THRESHOLD) {
        return getContrastingOutlineColor(parsedFill);
      }
      return fallbackColor;
    }

    function ensureJerseySwatchGraphic(swatchElement) {
      if (!swatchElement) return null;

      let svg = swatchElement._jerseySvg;
      let path = swatchElement._jerseyPath;

      if (!svg || !path || path.ownerSVGElement !== svg) {
        svg = swatchElement.querySelector('svg[data-jersey-swatch]');
        path = svg ? svg.querySelector('path') : null;
      }

      if (!svg || !path) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.dataset.jerseySwatch = 'true';

        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', JERSEY_SWATCH_SVG_PATH);
        svg.appendChild(path);

        swatchElement.textContent = '';
        swatchElement.appendChild(svg);
      }

      swatchElement._jerseySvg = svg;
      swatchElement._jerseyPath = path;
      return { svg, path };
    }

    function getSwatchDefaultBorder(element) {
      if (!element) return 'rgba(0, 0, 0, 0.175)';
      if (!element.dataset.jerseyDefaultBorder) {
        const computed = window.getComputedStyle(element).getPropertyValue('--jersey-swatch-border');
        element.dataset.jerseyDefaultBorder = computed && computed.trim()
          ? computed.trim()
          : 'rgba(0, 0, 0, 0.175)';
      }
      return element.dataset.jerseyDefaultBorder;
    }

    function applySwatchStyles(swatchElement, color) {
      if (!swatchElement) return;
      const graphic = ensureJerseySwatchGraphic(swatchElement);
      const fallbackBorder = getSwatchDefaultBorder(swatchElement);
      swatchElement.style.setProperty('--jersey-swatch-color', color);
      const borderColor = computeContrastOutlineColor(swatchElement, color, fallbackBorder);
      swatchElement.style.setProperty('--jersey-swatch-border', borderColor);
      swatchElement.style.color = borderColor;
      swatchElement.dataset.jerseySwatchColor = color;
      if (graphic && graphic.path) {
        graphic.path.setAttribute('fill', color);
        graphic.path.setAttribute('stroke', borderColor);
      }
    }

    function getJerseyColorStyles(color) {
      const backgroundColor = jerseyColorValues[color] || color;
      const textColor = jerseyColorContrast[color] || '#ffffff';
      return { backgroundColor, textColor };
    }

    function updateJerseySelectDisplay(selectElement) {
      if (!selectElement || !selectElement._jerseyUI) return;
      const { triggerLabel, triggerSwatch, optionButtons } = selectElement._jerseyUI;
      const selectedOption = selectElement.options[selectElement.selectedIndex];
      if (!selectedOption) return;
      const swatchColor = selectedOption.dataset.color || jerseyColorValues[selectedOption.value] || '#ffffff';
      if (triggerLabel) {
        triggerLabel.textContent = selectedOption.textContent;
      }
      if (triggerSwatch) {
        applySwatchStyles(triggerSwatch, swatchColor);
      }
      if (Array.isArray(optionButtons)) {
        optionButtons.forEach((button) => {
          const isSelected = button.dataset.value === selectElement.value;
          button.classList.toggle('is-active', isSelected);
          button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
          button.setAttribute('tabindex', isSelected ? '0' : '-1');
          const swatch = button._jerseySwatch || button.querySelector('.jersey-select-option-swatch');
          if (swatch) {
            const color = swatch.dataset.jerseySwatchColor || swatch.style.getPropertyValue('--jersey-swatch-color') || '#ffffff';
            applySwatchStyles(swatch, color);
            button._jerseySwatch = swatch;
          }
        });
      }
    }

    function refreshJerseySelectDisplays() {
      updateJerseySelectDisplay(document.getElementById('jerseyColorSC'));
      updateJerseySelectDisplay(document.getElementById('jerseyColorOpp'));
    }

    function resetJerseySwatchDefaultBorders() {
      document.querySelectorAll('.jersey-select-swatch, .jersey-select-option-swatch').forEach((swatch) => {
        if (!swatch) return;
        if (swatch.dataset && swatch.dataset.jerseyDefaultBorder) {
          delete swatch.dataset.jerseyDefaultBorder;
        }
        if (swatch.style) {
          swatch.style.removeProperty('--jersey-swatch-border');
          swatch.style.removeProperty('color');
        }
      });
    }

    function handleJerseyThemeChange() {
      resetJerseySwatchDefaultBorders();
      refreshJerseySelectDisplays();
    }

    function setupJerseyThemeObserver() {
      if (jerseyThemeObserver || typeof MutationObserver !== 'function') return;
      const rootElement = document.documentElement;
      if (!rootElement) return;
      jerseyThemeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-bs-theme') {
            handleJerseyThemeChange();
            break;
          }
        }
      });
      jerseyThemeObserver.observe(rootElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
    }

    function getJerseyColorLabel(selectElement, value) {
      if (!selectElement) return value;
      const option = Array.from(selectElement.options || []).find(opt => opt.value === value);
      return option ? option.textContent.trim() : value;
    }

    function findAlternativeJerseyColor(selectElement, forbiddenValue) {
      if (!selectElement) return null;
      const options = Array.from(selectElement.options || []);
      if (options.length === 0) return null;
      const startIndex = Math.max(0, options.findIndex(option => option.value === forbiddenValue));
      for (let offset = 1; offset <= options.length; offset++) {
        const option = options[(startIndex + offset) % options.length];
        if (!option || option.disabled || option.value === forbiddenValue) continue;
        return option.value;
      }
      return null;
    }

    function setJerseyConflictMessage({ conflictColorLabel, changedTeamName, adjustedTeamName, replacementColorLabel }) {
      if (!jerseyConflictModalMessageElement) return;
      let message = `Jersey colors must be different. ${JERSEY_CONFLICT_NOTE}`;
      if (changedTeamName && adjustedTeamName && conflictColorLabel) {
        if (replacementColorLabel) {
          message = `${changedTeamName} and ${adjustedTeamName} cannot both have ${conflictColorLabel} jerseys. ${adjustedTeamName}'s jersey color has been changed to ${replacementColorLabel}. ${JERSEY_CONFLICT_NOTE}`;
        } else {
          message = `${changedTeamName} and ${adjustedTeamName} cannot both have ${conflictColorLabel} jerseys. Please choose another color for ${adjustedTeamName}. ${JERSEY_CONFLICT_NOTE}`;
        }
      }
      jerseyConflictModalMessageElement.textContent = message;
    }

    function ensureDistinctJerseyColors(changedSelect, { showModal = true } = {}) {
      if (isResolvingJerseyColorConflict) return;
      const homeSelect = document.getElementById('jerseyColorSC');
      const opponentSelect = document.getElementById('jerseyColorOpp');
      if (!homeSelect || !opponentSelect) return;

      const homeValue = homeSelect.value;
      const opponentValue = opponentSelect.value;
      if (!homeValue || !opponentValue || homeValue !== opponentValue) return;

      const isOpponentChanged = changedSelect === opponentSelect;
      const activeSelect = changedSelect && (changedSelect === homeSelect || changedSelect === opponentSelect)
        ? changedSelect
        : homeSelect;
      const otherSelect = isOpponentChanged ? homeSelect : opponentSelect;
      const changedTeamName = activeSelect === opponentSelect ? getOpponentTeamName() : getHomeTeamName();
      const adjustedTeamName = otherSelect === opponentSelect ? getOpponentTeamName() : getHomeTeamName();
      const conflictColorLabel = getJerseyColorLabel(activeSelect, activeSelect.value);

      const replacementValue = findAlternativeJerseyColor(otherSelect, activeSelect.value);
      let replacementLabel = '';
      if (replacementValue) {
        isResolvingJerseyColorConflict = true;
        try {
          otherSelect.value = replacementValue;
          otherSelect.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
          isResolvingJerseyColorConflict = false;
        }
        replacementLabel = getJerseyColorLabel(otherSelect, replacementValue);
      }

      if (showModal && jerseyConflictModalInstance) {
        setJerseyConflictMessage({
          conflictColorLabel,
          changedTeamName,
          adjustedTeamName,
          replacementColorLabel: replacementLabel
        });
        jerseyConflictModalInstance.show();
      }
    }

    function closeOpenJerseySelect(options) {
      if (!openJerseySelectInstance || typeof openJerseySelectInstance.close !== 'function') return;
      openJerseySelectInstance.close(options);
    }

    function focusJerseyOption(optionButtons, index) {
      if (!Array.isArray(optionButtons) || optionButtons.length === 0) return;
      const boundedIndex = Math.max(0, Math.min(optionButtons.length - 1, index));
      const button = optionButtons[boundedIndex];
      if (button) {
        button.focus();
      }
    }

    function initializeJerseySelect(selectElement, { applyToNumbers = false } = {}) {
      if (!selectElement || selectElement.dataset.jerseyInitialized === 'true') return;

      selectElement.dataset.jerseyInitialized = 'true';

      let container = selectElement.closest('.jersey-select-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'jersey-select-container';
        const parent = selectElement.parentNode;
        if (parent) {
          parent.insertBefore(container, selectElement);
        }
        container.appendChild(selectElement);
      } else {
        container.classList.add('jersey-select-container');
      }

      selectElement.classList.add('jersey-select');
      selectElement.setAttribute('aria-hidden', 'true');
      selectElement.setAttribute('tabindex', '-1');

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'form-select jersey-select-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      const triggerMain = document.createElement('span');
      triggerMain.className = 'jersey-select-main';

      const triggerSwatch = document.createElement('span');
      triggerSwatch.className = 'jersey-select-swatch';
      triggerMain.appendChild(triggerSwatch);

      const triggerLabel = document.createElement('span');
      triggerLabel.className = 'jersey-select-label';
      triggerMain.appendChild(triggerLabel);

      trigger.appendChild(triggerMain);
      container.appendChild(trigger);
      getSwatchDefaultBorder(triggerSwatch);

      const triggerIdBase = selectElement.id || `jerseySelect${Date.now()}`;
      const triggerId = `${triggerIdBase}Trigger`;
      trigger.id = triggerId;

      const menu = document.createElement('ul');
      const menuId = `${triggerId}-menu`;
      menu.className = 'jersey-select-menu';
      menu.id = menuId;
      menu.hidden = true;
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('tabindex', '-1');
      container.appendChild(menu);
      trigger.setAttribute('aria-controls', menuId);
      menu.setAttribute('aria-labelledby', triggerId);

      const labelElement = document.querySelector(`label[for="${selectElement.id}"]`);
      if (labelElement) {
        labelElement.setAttribute('for', triggerId);
        const labelReference = [labelElement.id, triggerId].filter(Boolean).join(' ');
        if (labelReference) {
          trigger.setAttribute('aria-labelledby', labelReference);
        }
      }

      const optionButtons = Array.from(selectElement.options).map((option, index) => {
        const listItem = document.createElement('li');
        listItem.role = 'presentation';

        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'jersey-select-option';
        optionButton.setAttribute('role', 'option');
        optionButton.dataset.value = option.value;
        optionButton.dataset.index = String(index);
        optionButton.setAttribute('tabindex', '-1');

        const swatch = document.createElement('span');
        swatch.className = 'jersey-select-option-swatch';
        const swatchColor = option.dataset.color || jerseyColorValues[option.value] || '#ffffff';
        optionButton.appendChild(swatch);

        const optionLabel = document.createElement('span');
        optionLabel.className = 'jersey-select-option-label';
        optionLabel.textContent = option.textContent;
        optionButton.appendChild(optionLabel);

        optionButton.addEventListener('click', () => {
          const newValue = option.value;
          const hasChanged = selectElement.value !== newValue;
          selectElement.value = newValue;
          if (hasChanged) {
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            updateJerseySelectDisplay(selectElement);
            if (applyToNumbers) {
              applyJerseyColorToNumbers();
            }
          }
          closeMenu({ focusTrigger: true });
        });

        listItem.appendChild(optionButton);
        menu.appendChild(listItem);
        applySwatchStyles(swatch, swatchColor);
        optionButton._jerseySwatch = swatch;
        return optionButton;
      });

      function closeMenu({ focusTrigger = false } = {}) {
        if (!container.classList.contains('is-open')) return;
        container.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        menu.hidden = true;
        if (openJerseySelectInstance && openJerseySelectInstance.close === closeMenu) {
          openJerseySelectInstance = null;
        }
        if (focusTrigger) {
          trigger.focus();
        }
      }

      function openMenu({ focusOption = true } = {}) {
        if (container.classList.contains('is-open')) return;
        closeOpenJerseySelect();
        container.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        openJerseySelectInstance = {
          close: closeMenu,
          container,
          trigger
        };
        const selectedIndex = selectElement.selectedIndex >= 0 ? selectElement.selectedIndex : 0;
        const target = optionButtons[selectedIndex] || optionButtons[0];
        if (target) {
          requestAnimationFrame(() => {
            target.scrollIntoView({ block: 'nearest' });
            if (focusOption) {
              target.focus();
            }
          });
        }
      }

      function focusRelative(delta) {
        if (!Array.isArray(optionButtons) || optionButtons.length === 0) return;
        const activeIndex = optionButtons.indexOf(document.activeElement);
        if (activeIndex === -1) {
          const baseIndex = selectElement.selectedIndex >= 0 ? selectElement.selectedIndex : (delta > 0 ? -1 : optionButtons.length);
          focusJerseyOption(optionButtons, baseIndex + delta);
          return;
        }
        focusJerseyOption(optionButtons, activeIndex + delta);
      }

      trigger.addEventListener('click', () => {
        if (container.classList.contains('is-open')) {
          closeMenu();
        } else {
          openMenu();
        }
      });

      trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          openMenu({ focusOption: false });
          if (event.key === 'ArrowDown') {
            focusRelative(1);
          } else {
            focusRelative(-1);
          }
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (container.classList.contains('is-open')) {
            closeMenu();
          } else {
            openMenu();
          }
        }
      });

      menu.addEventListener('keydown', (event) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            focusRelative(1);
            break;
          case 'ArrowUp':
            event.preventDefault();
            focusRelative(-1);
            break;
          case 'Home':
            event.preventDefault();
            focusJerseyOption(optionButtons, 0);
            break;
          case 'End':
            event.preventDefault();
            focusJerseyOption(optionButtons, optionButtons.length - 1);
            break;
          case 'Enter':
          case ' ': {
            event.preventDefault();
            const activeButton = document.activeElement;
            if (optionButtons.includes(activeButton)) {
              activeButton.click();
            }
            break;
          }
          case 'Escape':
            event.preventDefault();
            closeMenu({ focusTrigger: true });
            break;
          case 'Tab':
            closeMenu();
            break;
          default:
            break;
        }
      });

      selectElement.addEventListener('change', () => {
        updateJerseySelectDisplay(selectElement);
        if (applyToNumbers) {
          applyJerseyColorToNumbers();
        }
        if (!isResolvingJerseyColorConflict) {
          ensureDistinctJerseyColors(selectElement);
        }
      });

      selectElement._jerseyUI = {
        container,
        trigger,
        triggerLabel,
        triggerSwatch,
        menu,
        optionButtons,
        closeMenu,
        openMenu
      };

      container.classList.add('is-ready');
      updateJerseySelectDisplay(selectElement);
      if (applyToNumbers) {
        applyJerseyColorToNumbers();
      }
    }

    document.addEventListener('pointerdown', (event) => {
      if (!openJerseySelectInstance || !openJerseySelectInstance.container) return;
      if (!openJerseySelectInstance.container.contains(event.target)) {
        openJerseySelectInstance.close({ focusTrigger: false });
      }
    });

    document.addEventListener('focusin', (event) => {
      if (!openJerseySelectInstance || !openJerseySelectInstance.container) return;
      if (!openJerseySelectInstance.container.contains(event.target)) {
        openJerseySelectInstance.close({ focusTrigger: false });
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!openJerseySelectInstance) return;
      event.preventDefault();
      openJerseySelectInstance.close({ focusTrigger: true });
    });

    function applyJerseyColorToNumbers() {
      const jerseySelect = document.getElementById('jerseyColorSC');
      if (!jerseySelect) return;
      updateJerseySelectDisplay(jerseySelect);
      const { backgroundColor, textColor } = getJerseyColorStyles(jerseySelect.value);
      document.querySelectorAll('.player-number-circle').forEach(circle => {
        circle.style.backgroundColor = backgroundColor;
        circle.style.color = textColor;
        const computedBorder = computeContrastOutlineColor(circle, backgroundColor, 'transparent');
        circle.style.borderColor = computedBorder;
      });
    }

    function createPlayerDisplay(player) {
      const fragment = document.createDocumentFragment();
      const playerParts = player.trim().split(/\s+/);
      const numberPart = playerParts.shift() || '';
      const nameText = playerParts.join(' ').trim();

      if (numberPart) {
        const numberCircle = document.createElement('span');
        numberCircle.className = 'player-number-circle';
        numberCircle.textContent = numberPart;
        const jerseyColor = document.getElementById('jerseyColorSC').value;
        const { backgroundColor, textColor } = getJerseyColorStyles(jerseyColor);
        numberCircle.style.backgroundColor = backgroundColor;
        numberCircle.style.color = textColor;
        numberCircle.style.borderColor = 'transparent';
        fragment.appendChild(numberCircle);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = nameText;
      if (nameText) {
        nameSpan.title = nameText;
      }
      fragment.appendChild(nameSpan);

      return fragment;
    }

    
    function updateModalPlayerList() {
      const list = document.getElementById('modalPlayerList');
      list.innerHTML = '';
      playerRecords.forEach(playerData => {
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center mb-2';

        const displayContainer = document.createElement('div');
        displayContainer.className = 'd-flex align-items-center';
        const playerDisplay = createPlayerDisplay(
          formatPlayerRecord(playerData)
        );
        displayContainer.appendChild(playerDisplay);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'btn-group btn-group-sm';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-outline-primary';
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => startEditPlayer(playerData);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = async () => deletePlayer(playerData.id);

        buttonGroup.appendChild(editBtn);
        buttonGroup.appendChild(deleteBtn);

        div.appendChild(displayContainer);
        div.appendChild(buttonGroup);
        list.appendChild(div);
      });
      applyJerseyColorToNumbers();
    }


    function startEditPlayer(player) {
      editingPlayerId = player.id;
      document.getElementById('number').value = player.number;
      document.getElementById('lastName').value = player.lastName;
      document.getElementById('initial').value = player.initial || '';
      document.getElementById('savePlayerBtn').textContent = 'Update Player';
      document.getElementById('cancelEditBtn').style.display = 'inline-block';
    }

    function cancelEdit() {
      resetPlayerForm();
    }

    function resetPlayerForm() {
      editingPlayerId = null;
      document.getElementById('number').value = '';
      document.getElementById('lastName').value = '';
      document.getElementById('initial').value = '';
      document.getElementById('savePlayerBtn').textContent = 'Add Player';
      document.getElementById('cancelEditBtn').style.display = 'none';
    }

    function finalizeSet(setNumber) {
      const button = document.getElementById(`finalizeButton${setNumber}`);
      if (!button) return;
      const scInput = document.getElementById(`set${setNumber}SC`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      const scRaw = scInput ? scInput.value.trim() : '';
      const oppRaw = oppInput ? oppInput.value.trim() : '';
      const bothScoresEntered = scRaw !== '' && oppRaw !== '';
      const scScore = parseScoreValue(scRaw);
      const oppScore = parseScoreValue(oppRaw);
      if (bothScoresEntered && scScore === oppScore) {
        updateFinalizeButtonState(setNumber);
        showFinalizeTiePopover(button);
        return;
      }
      if (finalizedSets[setNumber]) {
        delete finalizedSets[setNumber];
        button.classList.remove('finalized-btn');
      } else {
        finalizedSets[setNumber] = true;
        button.classList.add('finalized-btn');
      }
      updateFinalizeButtonState(setNumber);
      calculateResult();
      scheduleAutoSave();
    }

    function calculateResult() {
      let scWins = 0;
      let oppWins = 0;
      for (let i = 1; i <= 5; i++) {
        if (finalizedSets[i]) {
          const scScore = parseScoreValue(document.getElementById(`set${i}SC`).value);
          const oppScore = parseScoreValue(document.getElementById(`set${i}Opp`).value);
          if (scScore === null || oppScore === null) {
            continue;
          }
          if (isSwapped) {
            if (oppScore > scScore) scWins++;
            else if (scScore > oppScore) oppWins++;
          } else {
            if (scScore > oppScore) scWins++;
            else if (oppScore > scScore) oppWins++;
          }
        }
      }
      document.getElementById('resultSC').value = Math.min(scWins, 3);
      document.getElementById('resultOpp').value = Math.min(oppWins, 3);
    }


    function getSerializedSetTimeouts(setNumber) {
      const stored = getMatchTimeoutState(setNumber);
      return {
        sc: stored.sc.slice(0, TIMEOUT_COUNT).map(Boolean),
        opp: stored.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
      };
    }


    async function saveMatch({ showAlert = false } = {}) {
      if (suppressAutoSave) return null;
      persistCurrentSetTimeouts();
      const form = document.getElementById('matchForm');
      if (form && !form.checkValidity()) {
        form.classList.add('was-validated');
        setAutoSaveStatus('Unable to save due to validation errors.', 'text-danger', 4000);
        return null;
      }
      const parseResultValue = (elementId) => {
        const element = document.getElementById(elementId);
        if (!element) return null;
        const value = parseInt(element.value, 10);
        return Number.isNaN(value) ? null : value;
      };
      const match = {
        date: document.getElementById('date').value,
        location: document.getElementById('location').value,
        types: {
          tournament: document.getElementById('tournament').checked,
          league: document.getElementById('league').checked,
          postSeason: document.getElementById('postSeason').checked,
          nonLeague: document.getElementById('nonLeague').checked
        },
        opponent: document.getElementById('opponent').value.trim() || 'Opponent',
        jerseyColorSC: document.getElementById('jerseyColorSC').value,
        jerseyColorOpp: document.getElementById('jerseyColorOpp').value,
        resultSC: parseResultValue('resultSC'),
        resultOpp: parseResultValue('resultOpp'),
        firstServer: document.getElementById('firstServer').value,
        players: Array.from(document.querySelectorAll('#playerList input[type="checkbox"]:checked')).map(cb => cb.value),
        sets: {
          1: {
            sc: normalizeScoreInputValue(document.getElementById('set1SC').value),
            opp: normalizeScoreInputValue(document.getElementById('set1Opp').value),
            timeouts: getSerializedSetTimeouts(1)
          },
          2: {
            sc: normalizeScoreInputValue(document.getElementById('set2SC').value),
            opp: normalizeScoreInputValue(document.getElementById('set2Opp').value),
            timeouts: getSerializedSetTimeouts(2)
          },
          3: {
            sc: normalizeScoreInputValue(document.getElementById('set3SC').value),
            opp: normalizeScoreInputValue(document.getElementById('set3Opp').value),
            timeouts: getSerializedSetTimeouts(3)
          },
          4: {
            sc: normalizeScoreInputValue(document.getElementById('set4SC').value),
            opp: normalizeScoreInputValue(document.getElementById('set4Opp').value),
            timeouts: getSerializedSetTimeouts(4)
          },
          5: {
            sc: normalizeScoreInputValue(document.getElementById('set5SC').value),
            opp: normalizeScoreInputValue(document.getElementById('set5Opp').value),
            timeouts: getSerializedSetTimeouts(5)
          }
        },
        finalizedSets: { ...finalizedSets },
        isSwapped: isSwapped
      };
      match.revision = currentMatchRevision;
      const matchId = currentMatchId;
      loadedMatchPlayers = [...match.players];
      try {
        const response = matchId !== null
          ? await apiClient.updateMatch(matchId, match)
          : await apiClient.createMatch(match);
        const savedId = response?.id ?? matchId ?? null;
        if (typeof response?.revision === 'number') {
          currentMatchRevision = response.revision;
        }
        if (savedId !== null && currentMatchId !== savedId) {
          currentMatchId = savedId;
          const newUrl = `${window.location.pathname}?matchId=${savedId}`;
          window.history.replaceState(null, '', newUrl);
        }
        hasPendingChanges = false;
        if (showAlert) {
          const url = `${window.location.href.split('?')[0]}${savedId ? `?matchId=${savedId}` : ''}`;
          alert(`Match ${matchId !== null ? 'updated' : 'saved'}! View it at: ${url}`);
        } else {
          setAutoSaveStatus('All changes saved.', 'text-success');
        }
        populateMatchIndexModal();
        return savedId;
      } catch (error) {
        console.error('Failed to save match', error);
        if (showAlert) {
          alert('Unable to save match. Please try again.');
        } else {
          setAutoSaveStatus('Error saving changes.', 'text-danger', 4000);
        }
        throw error;
      }
    }
    
    async function deleteMatch(matchId) {
      if (!confirm('Delete this match?')) return;
      try {
        await apiClient.deleteMatch(matchId);
        const urlParams = new URLSearchParams(window.location.search);
        const currentMatchIdParam = urlParams.get('matchId');
        if (currentMatchIdParam && parseInt(currentMatchIdParam, 10) === matchId) {
          window.location.href = window.location.href.split('?')[0];
        } else {
          await populateMatchIndexModal();
        }
      } catch (error) {
        console.error('Failed to delete match', error);
        alert('Unable to delete match. Please try again.');
      }
    }


    
    async function loadMatchFromUrl() {
      const urlParams = new URLSearchParams(window.location.search);
      const matchId = urlParams.get('matchId');
      suppressAutoSave = true;
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }
      if (autoSaveStatusTimeout) {
        clearTimeout(autoSaveStatusTimeout);
        autoSaveStatusTimeout = null;
      }
      const form = document.getElementById('matchForm');
      if (form) {
        form.classList.remove('was-validated');
      }
      const resetFinalizeButtons = () => {
        for (let i = 1; i <= 5; i++) {
          const button = document.getElementById(`finalizeButton${i}`);
          if (button) {
            button.classList.remove('finalized-btn');
          }
        }
      };
      resetAllTimeouts({ resetStored: true });
      if (matchId) {
        try {
          const match = await apiClient.getMatch(matchId);
          if (match) {
            currentMatchId = match.id;
            currentMatchRevision = typeof match.revision === 'number' ? match.revision : 0;
            loadedMatchPlayers = Array.isArray(match.players) ? match.players : [];
            document.getElementById('date').value = match.date || '';
            document.getElementById('location').value = match.location || '';
            document.getElementById('tournament').checked = Boolean(match.types?.tournament);
            document.getElementById('league').checked = Boolean(match.types?.league);
            document.getElementById('postSeason').checked = Boolean(match.types?.postSeason);
            document.getElementById('nonLeague').checked = Boolean(match.types?.nonLeague);
            document.getElementById('opponent').value = match.opponent || '';
            document.getElementById('jerseyColorSC').value = match.jerseyColorSC || 'white';
            document.getElementById('jerseyColorOpp').value = match.jerseyColorOpp || 'white';
            refreshJerseySelectDisplays();
            ensureDistinctJerseyColors(document.getElementById('jerseyColorSC'), { showModal: false });
            applyJerseyColorToNumbers();
            document.getElementById('resultSC').value = match.resultSC ?? 0;
            document.getElementById('resultOpp').value = match.resultOpp ?? 0;
            const storedFirstServer = match.firstServer || '';
            updateOpponentName();
            setFirstServerSelection(storedFirstServer);
            updatePlayerList();
            for (let i = 1; i <= 5; i++) {
              const scInput = document.getElementById(`set${i}SC`);
              const oppInput = document.getElementById(`set${i}Opp`);
              if (scInput) {
                scInput.value = normalizeStoredScoreValue(match.sets?.[i]?.sc);
              }
              if (oppInput) {
                oppInput.value = normalizeStoredScoreValue(match.sets?.[i]?.opp);
              }
            }
            SET_NUMBERS.forEach((setNumber) => {
              const setData = match.sets?.[setNumber] ?? match.sets?.[String(setNumber)];
              setMatchTimeoutState(setNumber, setData?.timeouts);
            });
            finalizedSets = { ...(match.finalizedSets || {}) };
            isSwapped = Boolean(match.isSwapped);
            resetFinalizeButtons();
            for (let i = 1; i <= 5; i++) {
              if (finalizedSets[i]) {
                const button = document.getElementById(`finalizeButton${i}`);
                if (button) {
                  button.classList.add('finalized-btn');
                }
              }
            }
            updateAllFinalizeButtonStates();
            if (isSwapped) swapScores();
            calculateResult();
          } else {
            currentMatchId = null;
            currentMatchRevision = 0;
            loadedMatchPlayers = [];
            finalizedSets = {};
            resetFinalizeButtons();
            updatePlayerList();
          }
        } catch (error) {
          console.error('Failed to load match', error);
          setAutoSaveStatus('Unable to load match data.', 'text-danger', 4000);
          currentMatchId = null;
          currentMatchRevision = 0;
          loadedMatchPlayers = [];
          finalizedSets = {};
          resetFinalizeButtons();
          updatePlayerList();
        }
      } else {
        currentMatchId = matchId ? parseInt(matchId, 10) : null;
        currentMatchRevision = 0;
        loadedMatchPlayers = [];
        finalizedSets = {};
        resetFinalizeButtons();
        updatePlayerList();
      }
      hasPendingChanges = false;
      suppressAutoSave = false;
    }


    
    async function populateMatchIndexModal() {
      const modal = document.getElementById('matchIndexModal');
      const matchList = document.getElementById('matchList');
      matchList.innerHTML = '';
      try {
        const matches = await apiClient.listMatches();
        const sortedMatches = Array.isArray(matches)
          ? matches.slice().sort((a, b) => {
              const dateA = a.date ? new Date(a.date) : new Date(0);
              const dateB = b.date ? new Date(b.date) : new Date(0);
              if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
              return (a.opponent || '').localeCompare(b.opponent || '');
            })
          : [];
        if (sortedMatches.length === 0) {
          const emptyItem = document.createElement('li');
          emptyItem.className = 'list-group-item text-center text-muted';
          emptyItem.textContent = 'No matches saved yet.';
          matchList.appendChild(emptyItem);
        } else {
          sortedMatches.forEach(match => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.style.cursor = 'pointer';
            const date = match.date ? new Date(match.date).toLocaleString() : 'Unknown date';
            const opponentName = match.opponent || 'Opponent';
            const matchInfo = document.createElement('span');
            matchInfo.className = 'flex-grow-1 me-3';
            matchInfo.textContent = `${date} - ${opponentName}`;
            li.appendChild(matchInfo);

            li.onclick = () => {
              window.location.href = `${window.location.href.split('?')[0]}?matchId=${match.id}`;
              closeMatchIndexModal();
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-danger btn-sm';
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = async (event) => {
              event.stopPropagation();
              await deleteMatch(match.id);
            };
            li.appendChild(deleteBtn);

            matchList.appendChild(li);
          });
        }
        const modalInstance = modal ? bootstrap.Modal.getInstance(modal) : null;
        if (modalInstance) {
          modalInstance.handleUpdate();
        }
      } catch (error) {
        console.error('Failed to load matches', error);
        const errorItem = document.createElement('li');
        errorItem.className = 'list-group-item text-center text-danger';
        errorItem.textContent = 'Unable to load matches. Please try again later.';
        matchList.appendChild(errorItem);
      }
    }


    function closeMatchIndexModal() {
      const modalElement = document.getElementById('matchIndexModal');
      if (!modalElement) return;
      const modalInstance = bootstrap.Modal.getInstance(modalElement);
      if (modalInstance) {
        modalInstance.hide();
      }
    }

    function startNewMatch() {
      if (hasPendingChanges && !confirm('Start a new match? Unsaved changes will be lost.')) return;
      suppressAutoSave = true;
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }
      if (autoSaveStatusTimeout) {
        clearTimeout(autoSaveStatusTimeout);
        autoSaveStatusTimeout = null;
      }
      currentMatchId = null;
      currentMatchRevision = 0;
      loadedMatchPlayers = [];
      finalizedSets = {};
      isSwapped = false;

      const form = document.getElementById('matchForm');
      if (form) {
        form.reset();
        form.classList.remove('was-validated');
      }

      for (let i = 1; i <= 5; i++) {
        const scInput = document.getElementById(`set${i}SC`);
        const oppInput = document.getElementById(`set${i}Opp`);
        const finalizeButton = document.getElementById(`finalizeButton${i}`);
        if (scInput) scInput.value = '';
        if (oppInput) oppInput.value = '';
        if (finalizeButton) finalizeButton.classList.remove('finalized-btn');
      }
      updateAllFinalizeButtonStates();

      document.querySelectorAll('#playerList input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });

      resetAllTimeouts({ resetStored: true });
      scoreGameState.sc = null;
      scoreGameState.opp = null;
      updateScoreModalDisplay();

      const baseUrl = window.location.href.split('?')[0];
      window.history.replaceState(null, '', baseUrl);

      const dateInput = document.getElementById('date');
      if (dateInput && !dateInput.value) {
        const now = new Date();
        const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        dateInput.value = offsetDate.toISOString().slice(0, 16);
      }

      updateOpponentName();
      updateFirstServeOptions();
      refreshJerseySelectDisplays();
      ensureDistinctJerseyColors(document.getElementById('jerseyColorSC'), { showModal: false });
      applyJerseyColorToNumbers();
      setAutoSaveStatus('Ready for a new match.', 'text-info', 3000);

      hasPendingChanges = false;
      suppressAutoSave = false;
    }

    document.addEventListener('DOMContentLoaded', async function() {
      await initializeHomeTeam();
      initializeTeamHeaderPopovers();
      refreshAllTeamHeaderButtons();
      window.addEventListener('resize', refreshAllTeamHeaderButtons);
      const dateInput = document.getElementById('date');
      if (dateInput && !dateInput.value) {
        const now = new Date();
        const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        dateInput.value = offsetDate.toISOString().slice(0, 16);
      }
      const opponentInput = document.getElementById('opponent');
      opponentInput.addEventListener('input', () => {
        updateOpponentName();
        scheduleAutoSave();
      });
      jerseyConflictModalMessageElement = document.getElementById('jerseyConflictModalMessage');
      const jerseyConflictModalElement = document.getElementById('jerseyConflictModal');
      if (jerseyConflictModalElement) {
        jerseyConflictModalInstance = new bootstrap.Modal(jerseyConflictModalElement);
      }
      initializeJerseySelect(document.getElementById('jerseyColorSC'), { applyToNumbers: true });
      initializeJerseySelect(document.getElementById('jerseyColorOpp'));
      setupJerseyThemeObserver();
      handleJerseyThemeChange();
      ensureDistinctJerseyColors(document.getElementById('jerseyColorSC'), { showModal: false });
      const sortToggleBtn = document.getElementById('playerSortToggleBtn');
      if (sortToggleBtn) {
        sortToggleBtn.addEventListener('click', () => {
          togglePlayerSortMode();
        });
        updatePlayerSortToggle();
      }
      const autoSaveTargets = document.querySelector('.container');
      if (autoSaveTargets) {
        autoSaveTargets.addEventListener('input', (event) => {
          if (event.target.closest('#playerModal')) return;
          maybeRecalculateFinalResult(event.target);
          scheduleAutoSave();
        });
        autoSaveTargets.addEventListener('change', (event) => {
          if (event.target.closest('#playerModal')) return;
          maybeRecalculateFinalResult(event.target);
          scheduleAutoSave();
        });
      }
      const matchIndexModal = document.getElementById('matchIndexModal');
      if (matchIndexModal) {
        matchIndexModal.addEventListener('show.bs.modal', populateMatchIndexModal);
      }
      const scoreGameModalElement = document.getElementById('scoreGameModal');
      if (scoreGameModalElement) {
        scoreGameModalInstance = new bootstrap.Modal(scoreGameModalElement);
        const handleScoreModalResize = () => {
          if (scoreGameModalElement.classList.contains('show')) {
            updateScoreGameModalLayout();
          }
        };
        scoreGameModalElement.addEventListener('show.bs.modal', () => {
          setScoreModalBackgroundLock(true);
          updateScoreGameModalLayout();
          updateTimeoutTimerDisplay();
        });
        scoreGameModalElement.addEventListener('shown.bs.modal', () => {
          updateScoreGameModalLayout();
          updateTimeoutTimerDisplay();
          updateTimeoutLayoutForSwap();
        });
        scoreGameModalElement.addEventListener('hidden.bs.modal', () => {
          setScoreModalBackgroundLock(false);
          persistCurrentSetTimeouts();
          cancelActiveTimeoutTimer();
          scoreGameState.setNumber = null;
          scoreGameState.sc = null;
          scoreGameState.opp = null;
          updateScoreModalDisplay();
          refreshAllTimeoutDisplays();
        });
        window.addEventListener('resize', handleScoreModalResize);
        const scoreZones = scoreGameModalElement.querySelectorAll('.score-zone');
        scoreZones.forEach(zone => {
          const team = zone.getAttribute('data-team');
          const action = zone.getAttribute('data-action');
          const delta = action === 'increment' ? 1 : -1;
          zone.addEventListener('click', () => adjustScoreModal(team, delta));
          zone.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              adjustScoreModal(team, delta);
            } else if (event.key === 'ArrowUp' && action === 'increment') {
              event.preventDefault();
              adjustScoreModal(team, 1);
            } else if (event.key === 'ArrowDown' && action === 'decrement') {
              event.preventDefault();
              adjustScoreModal(team, -1);
            }
          });
        });
        const timeoutButtons = scoreGameModalElement.querySelectorAll('.timeout-box');
        timeoutButtons.forEach(button => {
          const team = button.getAttribute('data-team');
          const index = parseInt(button.getAttribute('data-timeout-index'), 10);
          if (!team || Number.isNaN(index)) return;
          button.addEventListener('click', (event) => handleTimeoutSelection(team, index, event));
        });
        scoreGameModalElement.addEventListener('click', (event) => {
          if (!getRunningTimeoutTeam()) {
            return;
          }
          if (event.target.closest('.timeout-box') || event.target.closest('.timeout-timer-display')) {
            return;
          }
          cancelActiveTimeoutTimer();
        });
        const modalSwapButton = document.getElementById('scoreModalSwapBtn');
        if (modalSwapButton) {
          modalSwapButton.addEventListener('click', swapScores);
        }
        resetAllTimeouts({ resetStored: true });
      }
      document.querySelectorAll('.score-game-btn').forEach(button => {
        button.addEventListener('click', () => {
          const setNumber = parseInt(button.getAttribute('data-set'), 10);
          if (!Number.isNaN(setNumber)) {
            openScoreGameModal(setNumber);
          }
        });
      });
      for (let i = 1; i <= 5; i++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `finalizeButton${i}`;
        button.className = 'btn btn-primary finalize-button';
        button.innerHTML = `
          <span class="finalize-button-label">Final</span>
          <span class="finalize-button-hazard">
            <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
            <span class="visually-hidden">Set score is tied. Adjust before finalizing.</span>
          </span>
        `;
        button.onclick = () => finalizeSet(i);
        const oppCell = document.getElementById(`set${i}Opp`);
        if (!oppCell) continue;
        const actionCell = oppCell.parentElement ? oppCell.parentElement.nextElementSibling : null;
        if (!actionCell) continue;
        const stack = actionCell.querySelector('.set-actions-stack') || actionCell;
        stack.appendChild(button);
      }
      updateAllFinalizeButtonStates();

      (async () => {
        try {
          await seedDemoPlayersIfEmpty();
        } catch (error) {
          console.error('Failed during initial player seeding', error);
        }
        await loadPlayers();
        await loadMatchFromUrl();
      })();
    });
