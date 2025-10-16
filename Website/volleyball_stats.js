var gk_isXlsx = false;
var gk_xlsxFileLookup = {};
var gk_fileData = {};

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

let db;
    const request = indexedDB.open("VolleyballDB", 2);

    request.onupgradeneeded = function(event) {
      db = event.target.result;
      if (!db.objectStoreNames.contains("players")) {
        db.createObjectStore("players", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("matches")) {
        db.createObjectStore("matches", { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = function(event) {
      db = event.target.result;
      seedDemoPlayersIfEmpty()
        .catch(error => {
          console.error('Failed to seed demo players', error);
        })
        .finally(() => {
          loadPlayers();
          loadMatchFromUrl();
        });
    };

    let players = [];
    let finalizedSets = {};
    let isSwapped = false;
    let editingPlayerId = null;
    let loadedMatchPlayers = [];
    let autoSaveTimeout = null;
    let autoSaveStatusTimeout = null;
    let suppressAutoSave = true;
    let currentMatchId = null;
    let scoreGameModalInstance = null;
    const SCORE_MODAL_FULLSCREEN_HEIGHT = 500;
    const scoreGameState = {
      setNumber: null,
      sc: null,
      opp: null
    };
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
    function formatPlayerRecord(player) {
      const number = String(player.number ?? '').trim();
      const lastName = String(player.lastName ?? '').trim();
      const initial = String(player.initial ?? '').trim();
      return [number, lastName, initial].filter(Boolean).join(' ');
    }

    function loadPlayers() {
      const transaction = db.transaction(["players"], "readonly");
      const store = transaction.objectStore("players");
      const request = store.getAll();
      request.onsuccess = function(event) {
        const records = event.target.result.slice();
        records.sort((a, b) => {
          const numberA = parseInt(a.number, 10);
          const numberB = parseInt(b.number, 10);
          if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) {
            return numberA - numberB;
          }
          return formatPlayerRecord(a).localeCompare(formatPlayerRecord(b));
        });
        players = records.map(formatPlayerRecord);
        updatePlayerList();
        updateModalPlayerList();
      };
    }

    function seedDemoPlayersIfEmpty() {
      return new Promise((resolve, reject) => {
        if (!db) {
          resolve(false);
          return;
        }
        const countTransaction = db.transaction(["players"], "readonly");
        const countStore = countTransaction.objectStore("players");
        const countRequest = countStore.count();
        countRequest.onsuccess = function() {
          if (countRequest.result > 0) {
            resolve(false);
            return;
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
          const seedTransaction = db.transaction(["players"], "readwrite");
          const seedStore = seedTransaction.objectStore("players");
          demoPlayers.forEach(player => seedStore.add(player));
          seedTransaction.oncomplete = () => resolve(true);
          seedTransaction.onerror = event => reject(event.target.error);
        };
        countRequest.onerror = event => reject(event.target.error);
      });
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
      if (!db || suppressAutoSave) return;
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      setAutoSaveStatus('Saving…', 'text-warning', null);
      autoSaveTimeout = setTimeout(() => {
        autoSaveTimeout = null;
        saveMatch({ showAlert: false });
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

    function updateScoreModalLabels() {
      const leftLabel = document.getElementById('scoreGameLeftLabel');
      const rightLabel = document.getElementById('scoreGameRightLabel');
      const leftName = getTeamHeaderName('scHeader', 'Stoney Creek');
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
      scoreGameState.setNumber = setNumber;
      scoreGameState.sc = parseScoreValue(scInput.value);
      scoreGameState.opp = parseScoreValue(oppInput.value);
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

    function savePlayer(number, lastName, initial, id = null) {
      const transaction = db.transaction(["players"], "readwrite");
      const store = transaction.objectStore("players");
      const player = { number: number, lastName: lastName, initial: initial || '' };
      if (id !== null) {
        player.id = id;
      }
      const request = (id !== null) ? store.put(player) : store.add(player);
      request.onsuccess = function(event) {
        loadPlayers();
      };
    }

    function deletePlayer(id) {
      const transaction = db.transaction(["players"], "readwrite");
      const store = transaction.objectStore("players");
      store.delete(id).onsuccess = function() {
        if (editingPlayerId === id) {
          resetPlayerForm();
        }
        loadPlayers();
      };
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

    function updateOpponentName() {
      const opponentInput = document.getElementById('opponent').value.trim();
      const opponentName = opponentInput || 'Opponent';
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
      select.innerHTML = '';
      const stoneyCreekOption = document.createElement('option');
      stoneyCreekOption.value = 'Stoney Creek';
      stoneyCreekOption.textContent = 'Stoney Creek';
      select.appendChild(stoneyCreekOption);
      const opponentOption = document.createElement('option');
      opponentOption.value = opponentName;
      opponentOption.textContent = opponentName;
      select.appendChild(opponentOption);
    }

    function updateSetHeaders(opponentName, swapped) {
      const homeName = swapped ? opponentName : 'Stoney Creek';
      const awayName = swapped ? 'Stoney Creek' : opponentName;
      setTeamHeaderName('scHeader', homeName, { roleDescription: 'Home team' });
      setTeamHeaderName('oppHeader', awayName, { roleDescription: 'Opponent team' });
      updateScoreModalLabels();
    }

    function swapScores() {
      isSwapped = !isSwapped;
      const opponentInput = document.getElementById('opponent').value.trim();
      const opponentName = opponentInput || 'Opponent';
      for (let i = 1; i <= 5; i++) {
        const scScore = document.getElementById(`set${i}SC`).value;
        const oppScore = document.getElementById(`set${i}Opp`).value;
        document.getElementById(`set${i}SC`).value = oppScore;
        document.getElementById(`set${i}Opp`).value = scScore;
      }
      updateAllFinalizeButtonStates();
      const scHeader = document.getElementById('scHeader');
      const oppHeader = document.getElementById('oppHeader');
      const scClass = scHeader.classList.contains('left-score') ? 'left-score' : 'right-score';
      const oppClass = oppHeader.classList.contains('right-score') ? 'right-score' : 'left-score';
      scHeader.classList.remove('left-score', 'right-score');
      oppHeader.classList.remove('left-score', 'right-score');
      scHeader.classList.add(oppClass);
      oppHeader.classList.add(scClass);
      updateSetHeaders(opponentName, isSwapped); // Update headers after swap
      refreshAllTeamHeaderButtons();
      if (Object.keys(finalizedSets).length > 0) {
        calculateResult();
      }
      scheduleAutoSave();
    }

    function submitPlayer() {
      const number = document.getElementById('number').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const initial = document.getElementById('initial').value.trim() || '';
      if (number && lastName) {
        const idToSave = editingPlayerId !== null ? editingPlayerId : null;
        savePlayer(number, lastName, initial, idToSave);
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

    function getJerseyColorStyles(color) {
      const contrastMap = {
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
      return {
        backgroundColor: color,
        textColor: contrastMap[color] || '#ffffff'
      };
    }

    function applyJerseyColorToNumbers() {
      const jerseySelect = document.getElementById('jerseyColorSC');
      if (!jerseySelect) return;
      const { backgroundColor, textColor } = getJerseyColorStyles(jerseySelect.value);
      const borderColor = jerseySelect.value === 'white' ? '#000000' : 'transparent';
      document.querySelectorAll('.player-number-circle').forEach(circle => {
        circle.style.backgroundColor = backgroundColor;
        circle.style.color = textColor;
        circle.style.borderColor = borderColor;
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
        numberCircle.style.borderColor = jerseyColor === 'white' ? '#000000' : 'transparent';
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
      const transaction = db.transaction(["players"], "readonly");
      const store = transaction.objectStore("players");
      const request = store.openCursor();
      request.onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          const playerData = { ...cursor.value };
          const div = document.createElement('div');
          div.className = 'd-flex justify-content-between align-items-center mb-2';

          const displayContainer = document.createElement('div');
          displayContainer.className = 'd-flex align-items-center';
          const playerDisplay = createPlayerDisplay(
            `${playerData.number} ${playerData.lastName} ${playerData.initial || ''}`
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
          deleteBtn.onclick = () => deletePlayer(playerData.id);

          buttonGroup.appendChild(editBtn);
          buttonGroup.appendChild(deleteBtn);

          div.appendChild(displayContainer);
          div.appendChild(buttonGroup);
          list.appendChild(div);
          cursor.continue();
        } else {
          applyJerseyColorToNumbers();
        }
      };
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

    function saveMatch({ showAlert = false } = {}) {
      if (!db) return;
      const form = document.getElementById('matchForm');
      if (form && !form.checkValidity()) {
        form.classList.add('was-validated');
        setAutoSaveStatus('Unable to save due to validation errors.', 'text-danger', 4000);
        return;
      }
      const transaction = db.transaction(["matches"], "readwrite");
      const store = transaction.objectStore("matches");
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
        resultSC: document.getElementById('resultSC').value,
        resultOpp: document.getElementById('resultOpp').value,
        firstServer: document.getElementById('firstServer').value,
        players: Array.from(document.querySelectorAll('#playerList input[type="checkbox"]:checked')).map(cb => cb.value),
        sets: {
          1: { sc: normalizeScoreInputValue(document.getElementById('set1SC').value), opp: normalizeScoreInputValue(document.getElementById('set1Opp').value) },
          2: { sc: normalizeScoreInputValue(document.getElementById('set2SC').value), opp: normalizeScoreInputValue(document.getElementById('set2Opp').value) },
          3: { sc: normalizeScoreInputValue(document.getElementById('set3SC').value), opp: normalizeScoreInputValue(document.getElementById('set3Opp').value) },
          4: { sc: normalizeScoreInputValue(document.getElementById('set4SC').value), opp: normalizeScoreInputValue(document.getElementById('set4Opp').value) },
          5: { sc: normalizeScoreInputValue(document.getElementById('set5SC').value), opp: normalizeScoreInputValue(document.getElementById('set5Opp').value) }
        },
        finalizedSets: { ...finalizedSets },
        isSwapped: isSwapped
      };
      const matchId = currentMatchId;
      if (matchId !== null) {
        match.id = matchId;
      }
      loadedMatchPlayers = [...match.players];
      const request = matchId !== null ? store.put(match) : store.add(match);
      request.onsuccess = function(event) {
        const savedId = matchId !== null ? matchId : event.target.result;
        if (currentMatchId !== savedId) {
          currentMatchId = savedId;
          const newUrl = `${window.location.pathname}?matchId=${savedId}`;
          window.history.replaceState(null, '', newUrl);
        }
        if (showAlert) {
          const url = `${window.location.href.split('?')[0]}${savedId ? `?matchId=${savedId}` : ''}`;
          alert(`Match ${matchId !== null ? 'updated' : 'saved'}! View it at: ${url}`);
        } else {
          setAutoSaveStatus('All changes saved.', 'text-success');
        }
        populateMatchIndexModal();
      };
      request.onerror = function() {
        if (!showAlert) {
          setAutoSaveStatus('Error saving changes.', 'text-danger', 4000);
        }
      };
    }

    function deleteMatch(matchId) {
      if (!confirm('Delete this match?')) return;
      const transaction = db.transaction(["matches"], "readwrite");
      const store = transaction.objectStore("matches");
      const request = store.delete(matchId);
      request.onsuccess = function() {
        const urlParams = new URLSearchParams(window.location.search);
        const currentMatchId = urlParams.get('matchId');
        if (currentMatchId && parseInt(currentMatchId) === matchId) {
          window.location.href = window.location.href.split('?')[0];
        } else {
          populateMatchIndexModal();
        }
      };
    }

    function loadMatchFromUrl() {
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
      if (matchId && db) {
        const transaction = db.transaction(["matches"], "readonly");
        const store = transaction.objectStore("matches");
        const request = store.get(parseInt(matchId));
        request.onsuccess = function(event) {
          const match = event.target.result;
          if (match) {
            currentMatchId = match.id;
            loadedMatchPlayers = match.players || [];
            document.getElementById('date').value = match.date;
            document.getElementById('location').value = match.location;
            document.getElementById('tournament').checked = match.types.tournament;
            document.getElementById('league').checked = match.types.league;
            document.getElementById('postSeason').checked = match.types.postSeason;
            document.getElementById('nonLeague').checked = match.types.nonLeague;
            document.getElementById('opponent').value = match.opponent;
            document.getElementById('jerseyColorSC').value = match.jerseyColorSC;
            document.getElementById('jerseyColorOpp').value = match.jerseyColorOpp;
            applyJerseyColorToNumbers();
            document.getElementById('resultSC').value = match.resultSC;
            document.getElementById('resultOpp').value = match.resultOpp;
            document.getElementById('firstServer').value = match.firstServer;
            updateOpponentName();
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
            finalizedSets = { ...match.finalizedSets };
            isSwapped = match.isSwapped;
            for (let i = 1; i <= 5; i++) {
              if (finalizedSets[i]) {
                document.getElementById(`finalizeButton${i}`).classList.add('finalized-btn');
              }
            }
            updateAllFinalizeButtonStates();
            if (isSwapped) swapScores();
            calculateResult();
          } else {
            loadedMatchPlayers = [];
          }
          suppressAutoSave = false;
        };
        request.onerror = function() {
          suppressAutoSave = false;
        };
      } else {
        currentMatchId = matchId ? parseInt(matchId) : null;
        loadedMatchPlayers = [];
        suppressAutoSave = false;
      }
    }

    function populateMatchIndexModal() {
      const modal = document.getElementById('matchIndexModal');
      const matchList = document.getElementById('matchList');
      matchList.innerHTML = '';
      const transaction = db.transaction(["matches"], "readonly");
      const store = transaction.objectStore("matches");
      const request = store.openCursor();
      const matches = [];
      request.onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          matches.push(cursor.value);
          cursor.continue();
        } else {
          matches.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
            return a.opponent.localeCompare(b.opponent);
          });
          if (matches.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.className = 'list-group-item text-center text-muted';
            emptyItem.textContent = 'No matches saved yet.';
            matchList.appendChild(emptyItem);
          } else {
            matches.forEach(match => {
              const li = document.createElement('li');
              li.className = 'list-group-item d-flex justify-content-between align-items-center';
              li.style.cursor = 'pointer';
              const date = match.date ? new Date(match.date).toLocaleString() : 'Unknown date';
              const matchInfo = document.createElement('span');
              matchInfo.className = 'flex-grow-1 me-3';
              matchInfo.textContent = `${date} - ${match.opponent}`;
              li.appendChild(matchInfo);

              li.onclick = () => {
                window.location.href = `${window.location.href.split('?')[0]}?matchId=${match.id}`;
                closeMatchIndexModal();
              };

              const deleteBtn = document.createElement('button');
              deleteBtn.type = 'button';
              deleteBtn.className = 'btn btn-danger btn-sm';
              deleteBtn.textContent = 'Delete';
              deleteBtn.onclick = (event) => {
                event.stopPropagation();
                deleteMatch(match.id);
              };
              li.appendChild(deleteBtn);

              matchList.appendChild(li);
            });
          }
          const modalInstance = bootstrap.Modal.getInstance(modal);
          if (modalInstance) {
            modalInstance.handleUpdate();
          }
        }
      };
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
      if (!confirm('Start a new match? Unsaved changes will be lost.')) return;
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
      applyJerseyColorToNumbers();
      setAutoSaveStatus('Ready for a new match.', 'text-info', 3000);

      suppressAutoSave = false;
    }

    document.addEventListener('DOMContentLoaded', function() {
      updateOpponentName();
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
      const jerseySelect = document.getElementById('jerseyColorSC');
      if (jerseySelect) {
        jerseySelect.addEventListener('change', () => {
          applyJerseyColorToNumbers();
          scheduleAutoSave();
        });
        applyJerseyColorToNumbers();
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
        scoreGameModalElement.addEventListener('show.bs.modal', updateScoreGameModalLayout);
        scoreGameModalElement.addEventListener('shown.bs.modal', updateScoreGameModalLayout);
        scoreGameModalElement.addEventListener('hidden.bs.modal', () => {
          scoreGameState.setNumber = null;
          scoreGameState.sc = null;
          scoreGameState.opp = null;
          updateScoreModalDisplay();
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
    });
