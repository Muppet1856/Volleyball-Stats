// public/js/volleyball_stats.js
let autoSaveTimeout = null;
let autoSaveStatusTimeout = null;
let suppressAutoSave = true;
let currentMatchId = null;
let hasPendingChanges = false;
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

async function applySetEdits(matchId, desiredStates) {
  if (!matchId || !desiredStates) return;
  for (const setNumber of SET_NUMBERS) {
    const desired = desiredStates[setNumber];
    const existing = getMatchSetRecord(setNumber);
    const hasData = hasSetStateData(desired);
    if (!hasData) {
      if (existing) {
        try {
          await apiClient.deleteSet(existing.id);
        } catch (error) {
          console.error(`Failed to delete set ${setNumber}`, error);
          throw error;
        }
        deleteMatchSetRecord(setNumber);
      }
      continue;
    }

    if (!existing) {
      try {
        const response = await apiClient.createSet({
          match_id: matchId,
          set_number: setNumber,
          home_score: desired.homeScore,
          opp_score: desired.oppScore,
          home_timeout_1: desired.timeouts.home[0] ? 1 : 0,
          home_timeout_2: desired.timeouts.home[1] ? 1 : 0,
          opp_timeout_1: desired.timeouts.opp[0] ? 1 : 0,
          opp_timeout_2: desired.timeouts.opp[1] ? 1 : 0
        });
        const newId = response?.id;
        if (newId !== undefined && newId !== null) {
          setMatchSetRecord(setNumber, {
            id: newId,
            homeScore: desired.homeScore,
            oppScore: desired.oppScore,
            timeouts: {
              home: desired.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
              opp: desired.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
            }
          });
        }
      } catch (error) {
        console.error(`Failed to create set ${setNumber}`, error);
        throw error;
      }
      continue;
    }

    try {
      const setIsFinalized = Boolean(finalizedSets[setNumber]);
      const homeScoreChanged = !scoresEqual(existing.homeScore, desired.homeScore);
      const oppScoreChanged = !scoresEqual(existing.oppScore, desired.oppScore);

      if (homeScoreChanged) {
        if (!setIsFinalized) {
          await apiClient.updateSetScore(existing.id, 'home', desired.homeScore);
        } else {
          try {
            await apiClient.updateSetScore(existing.id, 'home', desired.homeScore);
          } catch (scoreError) {
            console.warn(`Unable to update finalized set ${setNumber} home score`, scoreError);
          }
        }
        existing.homeScore = desired.homeScore;
      }

      if (oppScoreChanged) {
        if (!setIsFinalized) {
          await apiClient.updateSetScore(existing.id, 'opp', desired.oppScore);
        } else {
          try {
            await apiClient.updateSetScore(existing.id, 'opp', desired.oppScore);
          } catch (scoreError) {
            console.warn(`Unable to update finalized set ${setNumber} opp score`, scoreError);
          }
        }
        existing.oppScore = desired.oppScore;
      }
      for (let index = 0; index < desired.timeouts.home.length; index += 1) {
        const value = desired.timeouts.home[index];
        const desiredBool = Boolean(value);
        if (Boolean(existing.timeouts.home[index]) !== desiredBool) {
          await apiClient.updateSetTimeout(existing.id, 'home', index + 1, desiredBool ? 1 : 0);
          existing.timeouts.home[index] = desiredBool;
        }
      }
      for (let index = 0; index < desired.timeouts.opp.length; index += 1) {
        const value = desired.timeouts.opp[index];
        const desiredBool = Boolean(value);
        if (Boolean(existing.timeouts.opp[index]) !== desiredBool) {
          await apiClient.updateSetTimeout(existing.id, 'opp', index + 1, desiredBool ? 1 : 0);
          existing.timeouts.opp[index] = desiredBool;
        }
      }
      setMatchSetRecord(setNumber, existing);
    } catch (error) {
      console.error(`Failed to update set ${setNumber}`, error);
      throw error;
    }
  }
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
  const rosterSelections = [];
  const seenRosterIds = new Set();
  document.querySelectorAll('#playerList input[type="checkbox"]').forEach(cb => {
    if (!cb.checked) return;
    const playerId = normalizePlayerId(cb.dataset.playerId ?? cb.value);
    if (playerId === null || seenRosterIds.has(playerId)) {
      return;
    }
    seenRosterIds.add(playerId);
    const rosterEntry = { playerId };
    const tempValue = temporaryPlayerNumbers.get(playerId);
    if (tempValue !== null && tempValue !== undefined) {
      const tempString = String(tempValue).trim();
      if (tempString) {
        rosterEntry.tempNumber = tempString;
      }
    }
    rosterSelections.push(rosterEntry);
  });
  const normalizedRosterSelections = normalizeRosterArray(rosterSelections);

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
    jerseyColorHome: document.getElementById('jerseyColorHome').value,
    jerseyColorOpp: document.getElementById('jerseyColorOpp').value,
    resultHome: parseResultValue('resultHome'),
    resultOpp: parseResultValue('resultOpp'),
    firstServer: document.getElementById('firstServer').value,
    players: normalizedRosterSelections,
    sets: {
      1: {
        home: normalizeScoreInputValue(document.getElementById('set1Home').value),
        opp: normalizeScoreInputValue(document.getElementById('set1Opp').value),
        timeouts: getSerializedSetTimeouts(1)
      },
      2: {
        home: normalizeScoreInputValue(document.getElementById('set2Home').value),
        opp: normalizeScoreInputValue(document.getElementById('set2Opp').value),
        timeouts: getSerializedSetTimeouts(2)
      },
      3: {
        home: normalizeScoreInputValue(document.getElementById('set3Home').value),
        opp: normalizeScoreInputValue(document.getElementById('set3Opp').value),
        timeouts: getSerializedSetTimeouts(3)
      },
      4: {
        home: normalizeScoreInputValue(document.getElementById('set4Home').value),
        opp: normalizeScoreInputValue(document.getElementById('set4Opp').value),
        timeouts: getSerializedSetTimeouts(4)
      },
      5: {
        home: normalizeScoreInputValue(document.getElementById('set5Home').value),
        opp: normalizeScoreInputValue(document.getElementById('set5Opp').value),
        timeouts: getSerializedSetTimeouts(5)
      }
    },
    finalizedSets: { ...finalizedSets },
    deleted: false
  };
  const { body } = apiClient.prepareMatchPayload(match);
  const setStates = collectSetFormState();
  const matchId = currentMatchId;
  loadedMatchPlayers = normalizedRosterSelections.map(entry => ({ ...entry }));
  try {
    const response = matchId !== null
      ? await apiClient.updateMatch(matchId, match)
      : await apiClient.createMatch(match);
    const savedId = response?.id ?? matchId ?? null;
    if (savedId !== null) {
      if (currentMatchId !== savedId) {
        currentMatchId = savedId;
        const newUrl = `${window.location.pathname}?matchId=${savedId}`;
        window.history.replaceState(null, '', newUrl);
      }
      await applySetEdits(savedId, setStates);
      await apiClient.updateFinalizedSets(savedId, body.finalized_sets);
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
  isSwapped = false;
  const existingOpponentInput = document.getElementById('opponent');
  if (existingOpponentInput) {
    const currentOpponent = existingOpponentInput.value.trim() || 'Opponent';
    updateSetHeaders(currentOpponent, isSwapped);
  }
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
  resetMatchSetRecords();
  if (matchId) {
    try {
      const match = await apiClient.getMatch(matchId);
      if (match) {
        currentMatchId = match.id;
        const roster = extractRosterFromMatch(match);
        loadedMatchPlayers = roster.map(entry => ({ ...entry }));
        match.players = loadedMatchPlayers.map(entry => ({ ...entry }));
        applyTemporaryNumbersFromRoster(loadedMatchPlayers);
        document.getElementById('date').value = match.date || '';
        document.getElementById('location').value = match.location || '';
        document.getElementById('tournament').checked = Boolean(match.types?.tournament);
        document.getElementById('league').checked = Boolean(match.types?.league);
        document.getElementById('postSeason').checked = Boolean(match.types?.postSeason);
        document.getElementById('nonLeague').checked = Boolean(match.types?.nonLeague);
        document.getElementById('opponent').value = match.opponent || '';
        document.getElementById('jerseyColorHome').value = match.jerseyColorHome || 'white';
        document.getElementById('jerseyColorOpp').value = match.jerseyColorOpp || 'white';
        refreshJerseySelectDisplays();
        ensureDistinctJerseyColors(document.getElementById('jerseyColorHome'), { showModal: false });
        applyJerseyColorToNumbers();
        document.getElementById('resultHome').value = match.resultHome ?? 0;
        document.getElementById('resultOpp').value = match.resultOpp ?? 0;
        const storedFirstServer = match.firstServer || '';
        updateOpponentName();
        setFirstServerSelection(storedFirstServer);
        const setRows = match.id ? await apiClient.getMatchSets(match.id) : [];
        const setsFromRows = primeMatchSetRecords(setRows);
        const combinedSets = Object.keys(setsFromRows).length > 0 ? setsFromRows : match.sets;
        for (let i = 1; i <= 5; i++) {
          const homeInput = document.getElementById(`set${i}Home`);
          const oppInput = document.getElementById(`set${i}Opp`);
          if (homeInput) {
            homeInput.value = normalizeStoredScoreValue(combinedSets?.[i]?.home);
          }
          if (oppInput) {
            oppInput.value = normalizeStoredScoreValue(combinedSets?.[i]?.opp);
          }
        }
        SET_NUMBERS.forEach((setNumber) => {
          const setData = combinedSets?.[setNumber] ?? combinedSets?.[String(setNumber)];
          setMatchTimeoutState(setNumber, setData?.timeouts);
        });
        finalizedSets = { ...(match.finalizedSets || {}) };
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
        calculateResult();
      } else {
        currentMatchId = null;
        loadedMatchPlayers = [];
        finalizedSets = {};
        resetFinalizeButtons();
      }
    } catch (error) {
      console.error('Failed to load match', error);
      setAutoSaveStatus('Unable to load match data.', 'text-danger', 4000);
      currentMatchId = null;
      loadedMatchPlayers = [];
      finalizedSets = {};
      resetFinalizeButtons();
    }
  } else {
    currentMatchId = matchId ? parseInt(matchId, 10) : null;
    loadedMatchPlayers = [];
    finalizedSets = {};
    resetFinalizeButtons();
  }
  setPlayerRecords(playerRecords);
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
  loadedMatchPlayers = [];
  finalizedSets = {};
  isSwapped = false;

  const form = document.getElementById('matchForm');
  if (form) {
    form.reset();
    form.classList.remove('was-validated');
  }

  for (let i = 1; i <= 5; i++) {
    const homeInput = document.getElementById(`set${i}Home`);
    const oppInput = document.getElementById(`set${i}Opp`);
    const finalizeButton = document.getElementById(`finalizeButton${i}`);
    if (homeInput) homeInput.value = '';
    if (oppInput) oppInput.value = '';
    if (finalizeButton) finalizeButton.classList.remove('finalized-btn');
  }
  updateAllFinalizeButtonStates();

  document.querySelectorAll('#playerList input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
  });

  resetAllTimeouts({ resetStored: true });
  resetMatchSetRecords();
  scoreGameState.home = null;
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
  ensureDistinctJerseyColors(document.getElementById('jerseyColorHome'), { showModal: false });
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
  playerFormErrorElement = document.getElementById('playerFormError');
  const playerModalElement = document.getElementById('playerModal');
  const playerModalInputs = ['number', 'lastName', 'initial', 'tempNumber']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const handlePlayerModalEnterKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPlayer();
    }
  };
  playerModalInputs.forEach(input => {
    input.addEventListener('keydown', handlePlayerModalEnterKey);
  });
  ['number', 'lastName'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', () => {
        clearPlayerFormError();
      });
    }
  });
  if (playerModalElement) {
    playerModalElement.addEventListener('hidden.bs.modal', () => {
      clearPlayerFormError();
    });
  }
  jerseyConflictModalMessageElement = document.getElementById('jerseyConflictModalMessage');
  const jerseyConflictModalElement = document.getElementById('jerseyConflictModal');
  if (jerseyConflictModalElement) {
    jerseyConflictModalInstance = new bootstrap.Modal(jerseyConflictModalElement);
  }
  initializeJerseySelect(document.getElementById('jerseyColorHome'), { applyToNumbers: true });
  initializeJerseySelect(document.getElementById('jerseyColorOpp'));
  setupJerseyThemeObserver();
  handleJerseyThemeChange();
  ensureDistinctJerseyColors(document.getElementById('jerseyColorHome'), { showModal: false });
  const sortToggleBtn = document.getElementById('playerSortToggleBtn');
  if (sortToggleBtn) {
    sortToggleBtn.addEventListener('click', () => {
      togglePlayerSortMode();
    });
    updatePlayerSortToggle();
  }
  const modalSortSelect = document.getElementById('modalPlayerSortSelect');
  if (modalSortSelect) {
    modalSortSelect.addEventListener('change', (event) => {
      setPlayerSortMode(event.target.value);
    });
    modalSortSelect.value = playerSortMode;
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
      scoreGameState.home = null;
      scoreGameState.opp = null;
      updateScoreModalDisplay();
      refreshAllTimeoutDisplays();
    });
    window.addEventListener('resize', handleScoreModalResize);
    const scoreZones = scoreGameModalElement.querySelectorAll('.score-zone');
    scoreZones.forEach(zone => {
      const team = zone.getAttribute('data-team');
