// public/js/scoreboard.js
let finalizedSets = {};
let isSwapped = false;
let scoreGameModalInstance = null;

const SCORE_MODAL_FULLSCREEN_HEIGHT = 500;
const TIMEOUT_COUNT = 2;
const TIMEOUT_DURATION_SECONDS = 60;
const SET_NUMBERS = [1, 2, 3, 4, 5];
const matchSetRecords = new Map();
const scoreGameState = {
  setNumber: null,
  home: null,
  opp: null,
  timeouts: {
    home: Array(TIMEOUT_COUNT).fill(false),
    opp: Array(TIMEOUT_COUNT).fill(false)
  },
  activeTimeout: { home: null, opp: null },
  timeoutTimers: { home: null, opp: null },
  timeoutRemainingSeconds: {
    home: TIMEOUT_DURATION_SECONDS,
    opp: TIMEOUT_DURATION_SECONDS
  }
};
let matchTimeouts = createEmptyMatchTimeouts();
const finalizePopoverTimers = new WeakMap();
const finalizedStatePopoverTimers = new WeakMap();
const finalizedPopoverWrappers = new WeakMap();
const FINALIZE_TIE_POPOVER_TITLE = 'Scores tied';
const FINALIZE_TIE_POPOVER_MESSAGE = 'Set scores are tied. Adjust one team\'s score before marking the set final.';
const FINALIZE_MISSING_POPOVER_TITLE = 'Scores missing';
const FINALIZE_MISSING_POPOVER_MESSAGE = 'Enter both scores before finalizing the set.';
const FINALIZED_SET_POPOVER_TITLE = 'Score finalized';
const FINALIZED_SET_POPOVER_MESSAGE = 'This set\'s score is finalized. Toggle the final status to make changes.';
const FINALIZE_POPOVER_CONFIG = {
  tie: {
    title: FINALIZE_TIE_POPOVER_TITLE,
    content: FINALIZE_TIE_POPOVER_MESSAGE,
    customClass: 'finalize-error-popover'
  },
  missing: {
    title: FINALIZE_MISSING_POPOVER_TITLE,
    content: FINALIZE_MISSING_POPOVER_MESSAGE,
    customClass: 'finalize-error-popover'
  },
  finalized: {
    title: FINALIZED_SET_POPOVER_TITLE,
    content: FINALIZED_SET_POPOVER_MESSAGE,
    customClass: 'finalize-final-popover'
  }
};

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
function maybeRecalculateFinalResult(target) {
  if (!target || !target.id) return;
  const match = target.id.match(/^set(\d+)(Home|Opp)$/);
  if (!match) return;
  const setNumber = parseInt(match[1], 10);
  if (Number.isNaN(setNumber)) return;

  const editedKey = match[2] === 'Opp' ? 'opp' : 'home';
  const { homeInput, oppInput } = getSetScoreInputs(setNumber);
  if (!homeInput || !oppInput) {
    return;
  }
  const editedInput = editedKey === 'home' ? homeInput : oppInput;
  const isDirectInputEvent = editedInput === target;
  const editedScore = isDirectInputEvent ? parseScoreValue(editedInput.value) : null;
  let didAutoFill = false;
  let shouldUpdateScoreDisplay = false;
  const isScoreModalOpenForSet = scoreGameState.setNumber === setNumber;

  if (isScoreModalOpenForSet && isDirectInputEvent) {
    const currentValue = editedKey === 'home' ? scoreGameState.home : scoreGameState.opp;
    if (currentValue !== editedScore) {
      if (editedKey === 'home') {
        scoreGameState.home = editedScore;
      } else {
        scoreGameState.opp = editedScore;
      }
      shouldUpdateScoreDisplay = true;
    }
  }

  if (isDirectInputEvent && editedScore !== null) {
    const companionKey = editedKey === 'home' ? 'opp' : 'home';
    const companionInput = companionKey === 'home' ? homeInput : oppInput;
    if (companionInput && companionInput.value.trim() === '') {
      const zeroString = formatScoreInputValue(0);
      companionInput.value = zeroString;
      didAutoFill = true;
      if (isScoreModalOpenForSet) {
        const zeroScore = parseScoreValue(zeroString);
        const currentCompanion = companionKey === 'home' ? scoreGameState.home : scoreGameState.opp;
        if (currentCompanion !== zeroScore) {
          if (companionKey === 'home') {
            scoreGameState.home = zeroScore;
          } else {
            scoreGameState.opp = zeroScore;
          }
          shouldUpdateScoreDisplay = true;
        }
      }
    }
  }

  const { finalStateChanged } = updateFinalizeButtonState(setNumber);
  if (didAutoFill || finalizedSets[setNumber] || finalStateChanged) {
    calculateResult();
  }

  if (shouldUpdateScoreDisplay && isScoreModalOpenForSet) {
    updateScoreModalDisplay();
  }
}

function getSetScoreInputs(setNumber) {
  return {
    homeInput: document.getElementById(`set${setNumber}Home`),
    oppInput: document.getElementById(`set${setNumber}Opp`)
  };
}

function syncSetInputsToStoredScores(setNumber, record) {
  const { homeInput, oppInput } = getSetScoreInputs(setNumber);
  const homeValue = record ? record.homeScore : null;
  const oppValue = record ? record.oppScore : null;
  if (homeInput) {
    homeInput.value = formatScoreInputValue(homeValue);
  }
  if (oppInput) {
    oppInput.value = formatScoreInputValue(oppValue);
  }
  if (scoreGameState.setNumber === setNumber) {
    const normalizedHome = homeInput ? parseScoreValue(homeInput.value) : null;
    const normalizedOpp = oppInput ? parseScoreValue(oppInput.value) : null;
    scoreGameState.home = normalizedHome;
    scoreGameState.opp = normalizedOpp;
    updateScoreModalDisplay();
  }
  updateFinalizeButtonState(setNumber);
  calculateResult();
}

function clearFinalizePopoverTimer(element) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return;
  const timerId = finalizePopoverTimers.get(host);
  if (timerId) {
    clearTimeout(timerId);
    finalizePopoverTimers.delete(host);
  }
}

function clearFinalizedStatePopoverTimer(element) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return;
  const timerId = finalizedStatePopoverTimers.get(host);
  if (timerId) {
    clearTimeout(timerId);
    finalizedStatePopoverTimers.delete(host);
  }
}

function ensureFinalizePopover(element, type) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return null;
  const desiredType = type && FINALIZE_POPOVER_CONFIG[type] ? type : 'tie';
  const existingType = host.dataset.finalizePopoverType;
  let popover = bootstrap.Popover.getInstance(host);
  if (!popover || existingType !== desiredType) {
    if (popover) {
      popover.dispose();
    }
    const config = FINALIZE_POPOVER_CONFIG[desiredType];
    popover = new bootstrap.Popover(host, {
      container: 'body',
      trigger: 'manual focus hover',
      placement: 'top',
      title: config.title,
      content: config.content,
      customClass: config.customClass
    });
    host.dataset.finalizePopoverType = desiredType;
  } else {
    const config = FINALIZE_POPOVER_CONFIG[desiredType];
    if (typeof popover.setContent === 'function') {
      popover.setContent({
        '.popover-header': config.title,
        '.popover-body': config.content
      });
    } else {
      host.setAttribute('data-bs-original-title', config.title);
      host.setAttribute('data-bs-content', config.content);
    }
  }
  return popover;
}

function showFinalizedStatePopover(element, { focus = false } = {}) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return;
  clearFinalizePopoverTimer(host);
  const popover = ensureFinalizePopover(host, 'finalized');
  if (!popover) return;
  popover.show();
  if (focus) {
    try {
      host.focus({ preventScroll: true });
    } catch (error) {
      host.focus();
    }
  }
  clearFinalizedStatePopoverTimer(host);
  const timerId = setTimeout(() => {
    popover.hide();
    finalizedStatePopoverTimers.delete(host);
  }, 2600);
  finalizedStatePopoverTimers.set(host, timerId);
}

function destroyFinalizedStatePopover(element) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return;
  clearFinalizedStatePopoverTimer(host);
  if (host.dataset.finalizePopoverType === 'finalized') {
    const popover = bootstrap.Popover.getInstance(host);
    if (popover) {
      popover.hide();
      popover.dispose();
    }
    delete host.dataset.finalizePopoverType;
  }
}

function hideFinalizePopover(element, type) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return;
  clearFinalizePopoverTimer(host);
  if (host.dataset.finalizePopoverType === type) {
    const popover = bootstrap.Popover.getInstance(host);
    if (popover) {
      popover.hide();
      popover.dispose();
    }
    delete host.dataset.finalizePopoverType;
  }
}

function hideFinalizeTiePopover(element) {
  hideFinalizePopover(element, 'tie');
}

function hideFinalizeMissingPopover(element) {
  hideFinalizePopover(element, 'missing');
}

function getFinalizePopoverTargets(setNumber) {
  const finalizeButton = resolveFinalizePopoverElement(document.getElementById(`finalizeButton${setNumber}`));
  const targets = finalizeButton ? [finalizeButton] : [];
  if (finalizedSets[setNumber]) {
    const { homeInput, oppInput } = getSetScoreInputs(setNumber);
    if (homeInput) {
      const homeTarget = resolveFinalizePopoverElement(homeInput);
      if (homeTarget) {
        targets.push(homeTarget);
      }
    }
    if (oppInput) {
      const oppTarget = resolveFinalizePopoverElement(oppInput);
      if (oppTarget) {
        targets.push(oppTarget);
      }
    }
    const scoreButton = document.querySelector(`.score-game-btn[data-set="${setNumber}"]`);
    if (scoreButton) {
      const scoreTarget = resolveFinalizePopoverElement(scoreButton);
      if (scoreTarget) {
        targets.push(scoreTarget);
      }
    }
  }
  return targets;
}

function showFinalizeTiePopover(element, { focus = false } = {}) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return;
  const popover = ensureFinalizePopover(host, 'tie');
  if (!popover) return;
  popover.show();
  if (focus) {
    try {
      host.focus({ preventScroll: true });
    } catch (error) {
      host.focus();
    }
  }
  clearFinalizePopoverTimer(host);
  const timerId = setTimeout(() => {
    popover.hide();
    finalizePopoverTimers.delete(host);
  }, 2400);
  finalizePopoverTimers.set(host, timerId);
}

function showFinalizeTiePopovers(setNumber) {
  const targets = getFinalizePopoverTargets(setNumber);
  targets.forEach((element, index) => {
    showFinalizeTiePopover(element, { focus: index === 0 });
  });
}

function showFinalizeMissingPopover(element, { focus = false } = {}) {
  const host = resolveFinalizePopoverElement(element);
  if (!host) return;
  const popover = ensureFinalizePopover(host, 'missing');
  if (!popover) return;
  popover.show();
  if (focus) {
    try {
      host.focus({ preventScroll: true });
    } catch (error) {
      host.focus();
    }
  }
  clearFinalizePopoverTimer(host);
  const timerId = setTimeout(() => {
    popover.hide();
    finalizePopoverTimers.delete(host);
  }, 2400);
  finalizePopoverTimers.set(host, timerId);
}

function showFinalizeMissingScorePopovers(setNumber) {
  const targets = getFinalizePopoverTargets(setNumber);
  targets.forEach((element, index) => {
    showFinalizeMissingPopover(element, { focus: index === 0 });
  });
}

function hideFinalizeErrorPopovers(element) {
  hideFinalizeTiePopover(element);
  hideFinalizeMissingPopover(element);
}

function ensureFinalizedPopoverTargets(setNumber) {
  getFinalizePopoverTargets(setNumber).forEach((element) => ensureFinalizePopover(element, 'finalized'));
}

function destroyFinalizedPopoverTargets(setNumber) {
  getFinalizePopoverTargets(setNumber).forEach((element) => destroyFinalizedStatePopover(element));
}

function resolveFinalizePopoverElement(element) {
  if (!element) return null;
  const wrapper = finalizedPopoverWrappers.get(element);
  if (wrapper && wrapper.isConnected && wrapper.contains(element)) {
    return wrapper;
  }
  if (wrapper && (!wrapper.isConnected || !wrapper.contains(element))) {
    finalizedPopoverWrappers.delete(element);
  }
  return element;
}

function disableFinalizedPointerEvents(element) {
  if (!element || element.dataset.finalizedPointerEventsValue) {
    element.style.pointerEvents = 'none';
    return;
  }
  const inlineValue = element.style.pointerEvents;
  element.dataset.finalizedPointerEventsValue = inlineValue ? inlineValue : '__unset__';
  element.style.pointerEvents = 'none';
}

function restoreFinalizedPointerEvents(element) {
  if (!element) return;
  const stored = element.dataset.finalizedPointerEventsValue;
  if (stored && stored !== '__unset__') {
    element.style.pointerEvents = stored;
  } else if (stored === '__unset__') {
    element.style.removeProperty('pointer-events');
  }
  delete element.dataset.finalizedPointerEventsValue;
}

function ensureFinalizedPopoverWrapper(element) {
  if (!element) return null;
  let wrapper = finalizedPopoverWrappers.get(element);
  if (wrapper && wrapper.isConnected && wrapper.contains(element)) {
    disableFinalizedPointerEvents(element);
    return wrapper;
  }
  const parent = element.parentElement;
  if (!parent) return null;
  wrapper = document.createElement('span');
  wrapper.classList.add('finalized-popover-wrapper');
  if (element.classList.contains('form-control')) {
    wrapper.classList.add('d-block', 'w-100');
  } else {
    wrapper.classList.add('d-inline-block');
  }
  wrapper.tabIndex = 0;
  parent.insertBefore(wrapper, element);
  wrapper.appendChild(element);
  finalizedPopoverWrappers.set(element, wrapper);
  disableFinalizedPointerEvents(element);
  return wrapper;
}

function removeFinalizedPopoverWrapper(element) {
  if (!element) return;
  const wrapper = finalizedPopoverWrappers.get(element);
  if (wrapper) {
    destroyFinalizedStatePopover(wrapper);
    if (wrapper.parentElement) {
      wrapper.parentElement.insertBefore(element, wrapper);
    }
    wrapper.remove();
    finalizedPopoverWrappers.delete(element);
  }
  restoreFinalizedPointerEvents(element);
}

function setSetScoreEditingDisabled(setNumber, disabled) {
  const { homeInput, oppInput } = getSetScoreInputs(setNumber);
  const scoreInputs = [homeInput, oppInput];
  scoreInputs.forEach((input) => {
    if (!input) return;
    if (disabled) {
      const computed = window.getComputedStyle(input);
      const originalBackground = computed.backgroundColor;
      const originalColor = computed.color;
      if (originalBackground) {
        input.dataset.scoreOriginalBackground = originalBackground;
      } else {
        delete input.dataset.scoreOriginalBackground;
      }
      if (originalColor) {
        input.dataset.scoreOriginalColor = originalColor;
      } else {
        delete input.dataset.scoreOriginalColor;
      }
      const mutedBackground = mixColorWithGray(originalBackground, SCORE_FINALIZED_BACKGROUND_BLEND);
      const mutedText = mixColorWithGray(originalColor, SCORE_FINALIZED_TEXT_BLEND);
      if (mutedBackground) {
        input.style.backgroundColor = colorObjectToCss(mutedBackground);
      }
      if (mutedText) {
        input.style.color = colorObjectToCss(mutedText);
      }
      input.setAttribute('disabled', 'disabled');
      input.disabled = true;
      input.classList.add('set-score-finalized');
      ensureFinalizedPopoverWrapper(input);
    } else {
      input.removeAttribute('disabled');
      input.disabled = false;
      input.classList.remove('set-score-finalized');
      if (input.dataset.scoreOriginalBackground) {
        input.style.backgroundColor = input.dataset.scoreOriginalBackground;
      } else {
        input.style.removeProperty('background-color');
      }
      if (input.dataset.scoreOriginalColor) {
        input.style.color = input.dataset.scoreOriginalColor;
      } else {
        input.style.removeProperty('color');
      }
      delete input.dataset.scoreOriginalBackground;
      delete input.dataset.scoreOriginalColor;
      removeFinalizedPopoverWrapper(input);
    }
  });
  const scoreButton = document.querySelector(`.score-game-btn[data-set="${setNumber}"]`);
  if (scoreButton) {
    if (disabled) {
      scoreButton.classList.add('disabled');
      scoreButton.setAttribute('aria-disabled', 'true');
      scoreButton.disabled = true;
      scoreButton.setAttribute('disabled', 'disabled');
      ensureFinalizedPopoverWrapper(scoreButton);
    } else {
      scoreButton.classList.remove('disabled');
      scoreButton.removeAttribute('aria-disabled');
      scoreButton.disabled = false;
      scoreButton.removeAttribute('disabled');
      removeFinalizedPopoverWrapper(scoreButton);
    }
  }
}

function updateFinalizeButtonState(setNumber) {
  const button = document.getElementById(`finalizeButton${setNumber}`);
  const homeInput = document.getElementById(`set${setNumber}Home`);
  const oppInput = document.getElementById(`set${setNumber}Opp`);
  if (!button || !homeInput || !oppInput) {
    return { isTie: false, finalStateChanged: false, isFinal: false };
  }
  const popoverTargets = getFinalizePopoverTargets(setNumber);
  hideFinalizeErrorPopovers(button);
  const homeRaw = homeInput.value.trim();
  const oppRaw = oppInput.value.trim();
  const homeScore = parseScoreValue(homeRaw);
  const oppScore = parseScoreValue(oppRaw);
  const isMissing = homeScore === null || oppScore === null;
  const isTie = !isMissing && homeScore === oppScore;
  const hasError = isTie || isMissing;
  button.classList.toggle('finalize-btn-error', hasError);
  if (hasError) {
    button.setAttribute('aria-disabled', 'true');
  } else {
    button.removeAttribute('aria-disabled');
    popoverTargets.forEach((element) => hideFinalizeErrorPopovers(element));
  }
  let finalStateChanged = false;
  if (hasError && finalizedSets[setNumber]) {
    delete finalizedSets[setNumber];
    button.classList.remove('finalized-btn');
    finalStateChanged = true;
  }
  const previousFinal = button.dataset.finalized === 'true';
  const isFinal = Boolean(finalizedSets[setNumber]);
  if (previousFinal !== isFinal) {
    finalStateChanged = true;
  }
  button.classList.toggle('finalized-btn', isFinal);
  setSetScoreEditingDisabled(setNumber, isFinal);
  if (isFinal) {
    ensureFinalizedPopoverTargets(setNumber);
  } else {
    destroyFinalizedPopoverTargets(setNumber);
  }
  destroyFinalizedStatePopover(button);
  button.dataset.finalized = isFinal ? 'true' : 'false';
  if (button.dataset.finalizeInitialized !== 'true') {
    button.dataset.finalizeInitialized = 'true';
  }
  return { isTie, isMissing, finalStateChanged, isFinal };
}

function updateAllFinalizeButtonStates() {
  for (let i = 1; i <= 5; i++) {
    updateFinalizeButtonState(i);
  }
}

function updateScoreModalDisplay() {
  const homeDisplay = document.getElementById('scoreGameHomeDisplay');
  const oppDisplay = document.getElementById('scoreGameOppDisplay');
  if (homeDisplay) homeDisplay.textContent = formatScoreDisplay(scoreGameState.home);
  if (oppDisplay) oppDisplay.textContent = formatScoreDisplay(scoreGameState.opp);
}

function formatTimeoutDisplay(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getTimeoutTeamName(team) {
  const homeTeamHeaderId = isSwapped ? 'oppHeader' : 'homeHeader';
  const opponentHeaderId = isSwapped ? 'homeHeader' : 'oppHeader';
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
    home: Array(TIMEOUT_COUNT).fill(false),
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

function resetMatchSetRecords() {
  matchSetRecords.clear();
}

function normalizeSetRowForState(row) {
  if (!row || typeof row !== 'object') return null;
  const setNumber = Number(row.set_number ?? row.setNumber ?? row.number ?? row.id);
  if (!Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) return null;
  const parseScore = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const parseTimeout = (value) => Boolean(Number(value));
  return {
    id: row.id,
    setNumber,
    homeScore: parseScore(row.home_score ?? row.homeScore ?? row.home),
    oppScore: parseScore(row.opp_score ?? row.oppScore ?? row.opp),
    timeouts: {
      home: [parseTimeout(row.home_timeout_1), parseTimeout(row.home_timeout_2)],
      opp: [parseTimeout(row.opp_timeout_1), parseTimeout(row.opp_timeout_2)]
    }
  };
}

function primeMatchSetRecords(rows) {
  resetMatchSetRecords();
  const normalized = {};
  if (!Array.isArray(rows)) {
    return normalized;
  }
  const sortedRows = rows.slice().sort((a, b) => {
    const aNumber = Number(a.set_number ?? a.setNumber ?? a.number ?? a.id ?? 0);
    const bNumber = Number(b.set_number ?? b.setNumber ?? b.number ?? b.id ?? 0);
    return aNumber - bNumber;
  });
  sortedRows.forEach((row) => {
    const record = normalizeSetRowForState(row);
    if (!record) return;
    matchSetRecords.set(record.setNumber, {
      id: record.id,
      setNumber: record.setNumber,
      homeScore: record.homeScore,
      oppScore: record.oppScore,
      timeouts: {
        home: record.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
        opp: record.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
      }
    });
    normalized[record.setNumber] = {
      home: normalizeStoredScoreValue(record.homeScore),
      opp: normalizeStoredScoreValue(record.oppScore),
      timeouts: {
        home: record.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
        opp: record.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
      }
    };
  });
  return normalized;
}

function getMatchSetRecord(setNumber) {
  return matchSetRecords.get(setNumber) || null;
}

function setMatchSetRecord(setNumber, record) {
  matchSetRecords.set(setNumber, {
    id: record.id,
    setNumber,
    homeScore: record.homeScore,
    oppScore: record.oppScore,
    timeouts: {
      home: record.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
      opp: record.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
    }
  });
}

function deleteMatchSetRecord(setNumber) {
  matchSetRecords.delete(setNumber);
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
    home: cloneTimeoutArray(timeouts?.home),
    opp: cloneTimeoutArray(timeouts?.opp)
  };
}

function swapSetTimeoutState(state) {
  return {
    home: cloneTimeoutArray(state?.opp),
    opp: cloneTimeoutArray(state?.home)
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
  stored.home = scoreGameState.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean);
  stored.opp = scoreGameState.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean);
}

function loadSetTimeoutsIntoScoreState(setNumber) {
  const stored = getMatchTimeoutState(setNumber);
  ['home', 'opp'].forEach(team => {
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
  return ['home', 'opp'].find(team => Boolean(scoreGameState.timeoutTimers[team])) || null;
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
  updateTimeoutUI('home');
  updateTimeoutUI('opp');
}

function swapScoreGameTimeoutState() {
  const wasRunning = {
    home: Boolean(scoreGameState.timeoutTimers.home),
    opp: Boolean(scoreGameState.timeoutTimers.opp)
  };
  const previousActive = {
    home: scoreGameState.activeTimeout.home,
    opp: scoreGameState.activeTimeout.opp
  };
  const previousRemaining = {
    home: scoreGameState.timeoutRemainingSeconds.home ?? TIMEOUT_DURATION_SECONDS,
    opp: scoreGameState.timeoutRemainingSeconds.opp ?? TIMEOUT_DURATION_SECONDS
  };

  stopTimeoutTimer('home');
  stopTimeoutTimer('opp');

  const swappedTimeouts = swapSetTimeoutState(scoreGameState.timeouts);
  scoreGameState.timeouts.home = swappedTimeouts.home;
  scoreGameState.timeouts.opp = swappedTimeouts.opp;

  scoreGameState.activeTimeout.home = previousActive.opp ?? null;
  scoreGameState.activeTimeout.opp = previousActive.home ?? null;

  scoreGameState.timeoutRemainingSeconds.home = previousRemaining.opp;
  scoreGameState.timeoutRemainingSeconds.opp = previousRemaining.home;

  if (wasRunning.opp && scoreGameState.activeTimeout.home !== null) {
    startTimeoutTimer('home');
  }

  if (wasRunning.home && scoreGameState.activeTimeout.opp !== null) {
    startTimeoutTimer('opp');
  }

  updateTimeoutUI('home');
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
  resetTeamTimeouts('home', { skipPersist: true });
  resetTeamTimeouts('opp', { skipPersist: true });
  persistCurrentSetTimeouts();
}

function updateScoreColorClasses() {
  const homeHeader = document.getElementById('homeHeader');
  const oppHeader = document.getElementById('oppHeader');
  if (homeHeader) {
    homeHeader.classList.add('left-score');
    homeHeader.classList.remove('right-score');
  }
  if (oppHeader) {
    oppHeader.classList.add('right-score');
    oppHeader.classList.remove('left-score');
  }

  for (let i = 1; i <= 5; i++) {
    const homeInput = document.getElementById(`set${i}Home`);
    const oppInput = document.getElementById(`set${i}Opp`);
    if (homeInput) {
      homeInput.classList.add('left-score');
      homeInput.classList.remove('right-score');
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
  const leftName = getTeamHeaderName('homeHeader', getHomeTeamName());
  const rightName = getTeamHeaderName('oppHeader', 'Opponent');
  if (leftLabel) leftLabel.textContent = leftName;
  if (rightLabel) rightLabel.textContent = rightName;
  const homeIncrementZone = document.querySelector('#scoreGameModal .score-zone.increment[data-team="home"]');
  const homeDecrementZone = document.querySelector('#scoreGameModal .score-zone.decrement[data-team="home"]');
  const oppIncrementZone = document.querySelector('#scoreGameModal .score-zone.increment[data-team="opp"]');
  const oppDecrementZone = document.querySelector('#scoreGameModal .score-zone.decrement[data-team="opp"]');
  if (homeIncrementZone) homeIncrementZone.setAttribute('aria-label', `Increase ${leftName} score`);
  if (homeDecrementZone) homeDecrementZone.setAttribute('aria-label', `Decrease ${leftName} score`);
  if (oppIncrementZone) oppIncrementZone.setAttribute('aria-label', `Increase ${rightName} score`);
  if (oppDecrementZone) oppDecrementZone.setAttribute('aria-label', `Decrease ${rightName} score`);
  refreshAllTimeoutDisplays();
  updateTimeoutLayoutForSwap();
  updateScoreColorClasses();
}

function applyScoreModalToInputs({ triggerSave = true } = {}) {
  const { setNumber } = scoreGameState;
  if (!setNumber) return;
  const homeScore = scoreGameState.home;
  const oppScore = scoreGameState.opp;
  const homeMissing = homeScore === null && oppScore !== null;
  const oppMissing = oppScore === null && homeScore !== null;
  if (homeMissing) {
    scoreGameState.home = 0;
  } else if (oppMissing) {
    scoreGameState.opp = 0;
  }
  const homeInput = document.getElementById(`set${setNumber}Home`);
  const oppInput = document.getElementById(`set${setNumber}Opp`);
  if (homeInput) homeInput.value = formatScoreInputValue(scoreGameState.home);
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
  const { setNumber } = scoreGameState;
  if (!setNumber) return;
  const key = team === 'opp' ? 'opp' : 'home';
  const currentValue = scoreGameState[key];
  const baseValue = currentValue === null || currentValue === undefined ? 0 : currentValue;
  const newValue = clampScoreValue(baseValue + delta);
  if (newValue === scoreGameState[key]) return;
  scoreGameState[key] = newValue;
  updateScoreModalDisplay();
  applyScoreModalToInputs();
}

function openScoreGameModal(setNumber) {
  const homeInput = document.getElementById(`set${setNumber}Home`);
  const oppInput = document.getElementById(`set${setNumber}Opp`);
  if (!homeInput || !oppInput) return false;
  if (scoreGameState.setNumber !== null) {
    persistCurrentSetTimeouts();
    if (scoreGameState.setNumber !== setNumber) {
      cancelActiveTimeoutTimer();
    }
  }
  scoreGameState.setNumber = setNumber;
  scoreGameState.home = parseScoreValue(homeInput.value);
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
    return true;
  }
  return false;
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
  setTeamHeaderName('homeHeader', homeName, { roleDescription: 'Home team' });
  setTeamHeaderName('oppHeader', awayName, { roleDescription: 'Opponent team' });
  updateScoreModalLabels();
}

function syncScoreGameModalAfterSwap() {
  const modalElement = document.getElementById('scoreGameModal');
  if (!modalElement || !modalElement.classList.contains('show')) return;
  updateScoreModalLabels();
  const { setNumber } = scoreGameState;
  if (!setNumber) return;
  const homeInput = document.getElementById(`set${setNumber}Home`);
  const oppInput = document.getElementById(`set${setNumber}Opp`);
  if (!homeInput || !oppInput) return;
  scoreGameState.home = parseScoreValue(homeInput.value);
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
    const homeScore = document.getElementById(`set${i}Home`).value;
    const oppScore = document.getElementById(`set${i}Opp`).value;
    document.getElementById(`set${i}Home`).value = oppScore;
    document.getElementById(`set${i}Opp`).value = homeScore;
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

function finalizeSet(setNumber) {
  const button = document.getElementById(`finalizeButton${setNumber}`);
  if (!button) return;
  const homeInput = document.getElementById(`set${setNumber}Home`);
  const oppInput = document.getElementById(`set${setNumber}Opp`);
  const homeRaw = homeInput ? homeInput.value.trim() : '';
  const oppRaw = oppInput ? oppInput.value.trim() : '';
  const homeScore = parseScoreValue(homeRaw);
  const oppScore = parseScoreValue(oppRaw);
  const scoresMissing = homeScore === null || oppScore === null;
  if (scoresMissing) {
    updateFinalizeButtonState(setNumber);
    showFinalizeMissingScorePopovers(setNumber);
    return;
  }
  if (homeScore === oppScore) {
    updateFinalizeButtonState(setNumber);
    showFinalizeTiePopovers(setNumber);
    return;
  }
  if (finalizedSets[setNumber]) {
    delete finalizedSets[setNumber];
  } else {
    finalizedSets[setNumber] = true;
  }
  updateFinalizeButtonState(setNumber);
  calculateResult();
  scheduleAutoSave();
}

function calculateResult() {
  let homeWins = 0;
  let oppWins = 0;
  for (let i = 1; i <= 5; i++) {
    if (finalizedSets[i]) {
      const homeScore = parseScoreValue(document.getElementById(`set${i}Home`).value);
      const oppScore = parseScoreValue(document.getElementById(`set${i}Opp`).value);
      if (homeScore === null || oppScore === null) {
        continue;
      }
      if (isSwapped) {
        if (oppScore > homeScore) homeWins++;
        else if (homeScore > oppScore) oppWins++;
      } else {
        if (homeScore > oppScore) homeWins++;
        else if (oppScore > homeScore) oppWins++;
      }
    }
  }
  document.getElementById('resultHome').value = Math.min(homeWins, 3);
  document.getElementById('resultOpp').value = Math.min(oppWins, 3);
}

function getSerializedSetTimeouts(setNumber) {
  const stored = getMatchTimeoutState(setNumber);
  return {
    home: stored.home.slice(0, TIMEOUT_COUNT).map(Boolean),
    opp: stored.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
  };
}

function collectSetFormState() {
  const states = {};
  SET_NUMBERS.forEach((setNumber) => {
    const homeInput = document.getElementById(`set${setNumber}Home`);
    const oppInput = document.getElementById(`set${setNumber}Opp`);
    const homeValue = homeInput ? homeInput.value : '';
    const oppValue = oppInput ? oppInput.value : '';
    states[setNumber] = {
      homeScore: parseScoreValue(homeValue),
      oppScore: parseScoreValue(oppValue),
      timeouts: getSerializedSetTimeouts(setNumber)
    };
  });
  return states;
}

function hasSetStateData(state) {
  if (!state) return false;
  const hasScores = state.homeScore !== null || state.oppScore !== null;
  const timeoutValues = [...(state.timeouts?.home || []), ...(state.timeouts?.opp || [])];
  const hasTimeouts = timeoutValues.some(Boolean);
  return hasScores || hasTimeouts;
}

function scoresEqual(a, b) {
  const normalize = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const left = normalize(a);
  const right = normalize(b);
  if (left === null && right === null) return true;
  return left === right;
}

