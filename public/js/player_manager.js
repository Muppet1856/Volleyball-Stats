// public/js/player_manager.js
let playerRecords = [];
let players = [];
let playerSortMode = 'number';
const temporaryPlayerNumbers = new Map();
let pendingTemporaryPlayer = null;
let playerFormErrorElement = null;
let editingPlayerId = null;
let loadedMatchPlayers = [];
let openJerseySelectInstance = null;
let jerseyConflictModalInstance = null;
let jerseyConflictModalMessageElement = null;
let jerseyThemeObserver = null;
let isResolvingJerseyColorConflict = false;
function formatLegacyPlayerRecord(player) {
  const number = String(player.number ?? '').trim();
  const lastName = String(player.lastName ?? '').trim();
  const initial = String(player.initial ?? '').trim();
  return [number, lastName, initial].filter(Boolean).join(' ');
}

function getPlayerDisplayData(player) {
  if (!player) {
    return { id: null, number: '', tempNumber: '', lastName: '', initial: '' };
  }
  const id = normalizePlayerId(player.id);
  const number = String(player.number ?? '').trim();
  const lastName = String(player.lastName ?? '').trim();
  const initial = String(player.initial ?? '').trim();
  let tempNumber = '';
  if (id !== null && temporaryPlayerNumbers.has(id)) {
    const rawTemp = temporaryPlayerNumbers.get(id);
    if (rawTemp !== null && rawTemp !== undefined) {
      tempNumber = String(rawTemp).trim();
    }
  }
  return { id, number, tempNumber, lastName, initial };
}

function formatPlayerRecord(player) {
  const { number, tempNumber, lastName, initial } = getPlayerDisplayData(player);
  const displayNumber = tempNumber || number;
  const nameText = [lastName, initial].filter(Boolean).join(' ');
  return [displayNumber, nameText].filter(Boolean).join(' ');
}

function getSortablePlayerNumber(player) {
  const { number, tempNumber } = getPlayerDisplayData(player);
  const rawValue = (tempNumber || number || '').trim();
  const numericValue = parseInt(rawValue, 10);
  return {
    rawValue,
    numericValue,
    hasNumericValue: !Number.isNaN(numericValue)
  };
}

function comparePlayersByNumber(a, b) {
  const numberA = getSortablePlayerNumber(a);
  const numberB = getSortablePlayerNumber(b);
  if (numberA.hasNumericValue && numberB.hasNumericValue && numberA.numericValue !== numberB.numericValue) {
    return numberA.numericValue - numberB.numericValue;
  }
  if (numberA.hasNumericValue && !numberB.hasNumericValue) {
    return -1;
  }
  if (!numberA.hasNumericValue && numberB.hasNumericValue) {
    return 1;
  }
  const nameA = formatPlayerRecord(a);
  const nameB = formatPlayerRecord(b);
  if (numberA.rawValue && numberB.rawValue && numberA.rawValue !== numberB.rawValue) {
    return numberA.rawValue.localeCompare(numberB.rawValue, undefined, { sensitivity: 'base' });
  }
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

function updateModalPlayerSortSelect() {
  const select = document.getElementById('modalPlayerSortSelect');
  if (!select) return;
  if (select.value !== playerSortMode) {
    select.value = playerSortMode;
  }
}

function setPlayerSortMode(mode) {
  const normalized = mode === 'name' ? 'name' : 'number';
  if (playerSortMode === normalized) {
    updatePlayerSortToggle();
    updateModalPlayerSortSelect();
    return;
  }
  playerSortMode = normalized;
  setPlayerRecords(playerRecords);
}

function setPlayerRecords(records) {
  const safeRecords = Array.isArray(records) ? records : [];
  const sortedRecords = sortPlayerRecords(safeRecords);
  playerRecords = sortedRecords;
  players = sortedRecords.map(getPlayerDisplayData);
  const validIds = new Set(sortedRecords.map(record => normalizePlayerId(record.id)).filter(id => id !== null));
  Array.from(temporaryPlayerNumbers.keys()).forEach(playerId => {
    if (!validIds.has(playerId)) {
      temporaryPlayerNumbers.delete(playerId);
    }
  });
  if (pendingTemporaryPlayer) {
    const {
      number: pendingNumber,
      lastName: pendingLastName,
      initial: pendingInitial,
      value: pendingValue
    } = pendingTemporaryPlayer;
    const normalizedNumber = String(pendingNumber ?? '').trim();
    const normalizedLast = String(pendingLastName ?? '').trim().toLocaleLowerCase();
    const normalizedInitial = String(pendingInitial ?? '').trim().toLocaleLowerCase();
    const match = sortedRecords.find(record => {
      const recordId = normalizePlayerId(record.id);
      if (recordId === null) {
        return false;
      }
      const recordNumber = String(record.number ?? '').trim();
      const recordLast = String(record.lastName ?? '').trim().toLocaleLowerCase();
      const recordInitial = String(record.initial ?? '').trim().toLocaleLowerCase();
      return (
        recordNumber === normalizedNumber &&
        recordLast === normalizedLast &&
        recordInitial === normalizedInitial &&
        !temporaryPlayerNumbers.has(recordId)
      );
    });
    if (match) {
      const matchId = normalizePlayerId(match.id);
      if (matchId !== null) {
        if (pendingValue) {
          temporaryPlayerNumbers.set(matchId, pendingValue);
        } else {
          temporaryPlayerNumbers.delete(matchId);
        }
      }
    }
    pendingTemporaryPlayer = null;
  }
  updatePlayerList();
  updateModalPlayerList();
  updatePlayerSortToggle();
  updateModalPlayerSortSelect();
}

function togglePlayerSortMode() {
  setPlayerSortMode(playerSortMode === 'number' ? 'name' : 'number');
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
    return true;
  } catch (error) {
    console.error('Failed to save player', error);
    alert('Unable to save player. Please try again.');
    return false;
  }
  return true;
}

function getPlayerFormErrorElement() {
  if (!playerFormErrorElement) {
    playerFormErrorElement = document.getElementById('playerFormError');
  }
  return playerFormErrorElement;
}

function showPlayerFormError(message) {
  const element = getPlayerFormErrorElement();
  if (!element) return;
  element.textContent = message;
  element.classList.remove('d-none');
}

function clearPlayerFormError() {
  const element = getPlayerFormErrorElement();
  if (!element) return;
  element.textContent = '';
  element.classList.add('d-none');
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


async function submitPlayer() {
  const numberInput = document.getElementById('number');
  const lastNameInput = document.getElementById('lastName');
  const initialInput = document.getElementById('initial');
  const tempNumberElement = document.getElementById('tempNumber');

  const number = numberInput ? numberInput.value.trim() : '';
  const lastName = lastNameInput ? lastNameInput.value.trim() : '';
  const initial = initialInput ? initialInput.value.trim() : '';
  const tempNumber = tempNumberElement ? tempNumberElement.value.trim() : '';

  if (numberInput) {
    numberInput.value = number;
  }
  if (lastNameInput) {
    lastNameInput.value = lastName;
  }
  if (initialInput) {
    initialInput.value = initial;
  }
  if (tempNumberElement) {
    tempNumberElement.value = tempNumber;
  }

  clearPlayerFormError();

  if (!number) {
    showPlayerFormError('Player number is required.');
    if (numberInput) {
      numberInput.focus();
      if (typeof numberInput.select === 'function') {
        numberInput.select();
      }
    }
    return;
  }

  if (!lastName) {
    showPlayerFormError('Player last name is required.');
    if (lastNameInput) {
      lastNameInput.focus();
      if (typeof lastNameInput.select === 'function') {
        lastNameInput.select();
      }
    }
    return;
  }

  const idToSave = editingPlayerId !== null ? editingPlayerId : null;
  const previousPending = pendingTemporaryPlayer;
  let normalizedId = null;
  let hadPreviousTempEntry = false;
  let previousTempValue = '';

  if (idToSave !== null) {
    normalizedId = normalizePlayerId(idToSave);
    if (normalizedId !== null && temporaryPlayerNumbers.has(normalizedId)) {
      hadPreviousTempEntry = true;
      previousTempValue = temporaryPlayerNumbers.get(normalizedId);
    }
  }

  if (idToSave !== null) {
    if (normalizedId !== null) {
      if (tempNumber) {
        temporaryPlayerNumbers.set(normalizedId, tempNumber);
      } else {
        temporaryPlayerNumbers.delete(normalizedId);
      }
    }
    pendingTemporaryPlayer = null;
    updateModalPlayerList();
  } else if (tempNumber) {
    pendingTemporaryPlayer = {
      number,
      lastName,
      initial,
      value: tempNumber
    };
  } else {
    pendingTemporaryPlayer = null;
  }

  const saveSucceeded = await savePlayer(number, lastName, initial, idToSave);

  if (!saveSucceeded) {
    pendingTemporaryPlayer = previousPending;
    if (normalizedId !== null) {
      if (hadPreviousTempEntry) {
        temporaryPlayerNumbers.set(normalizedId, previousTempValue);
      } else {
        temporaryPlayerNumbers.delete(normalizedId);
      }
    }
    if (idToSave !== null) {
      updateModalPlayerList();
    }
    return;
  }

  resetPlayerForm();
}

function updatePlayerList() {
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  const rosterSelection = Array.isArray(loadedMatchPlayers) ? loadedMatchPlayers : [];
  players.forEach((player, index) => {
    const div = document.createElement('div');
    div.className = 'player-item form-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input';
    const checkboxId = `player-select-${index}`;
    checkbox.id = checkboxId;
    const normalizedId = player.id;
    if (normalizedId !== null) {
      checkbox.value = normalizedId;
      checkbox.dataset.playerId = normalizedId;
      if (
        rosterSelection.some(entry => normalizePlayerId(entry?.playerId) === normalizedId)
      ) {
        checkbox.checked = true;
      }
    } else {
      checkbox.value = '';
      checkbox.disabled = true;
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
  updateJerseySelectDisplay(document.getElementById('jerseyColorHome'));
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
  const homeSelect = document.getElementById('jerseyColorHome');
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
  const jerseySelect = document.getElementById('jerseyColorHome');
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
  if (!player || typeof player !== 'object') {
    const fallback = document.createElement('span');
    fallback.className = 'player-name';
    fallback.textContent = typeof player === 'string' ? player : '';
    fragment.appendChild(fallback);
    return fragment;
  }

  const displayNumber = String(player.tempNumber || player.number || '').trim();
  const lastName = String(player.lastName || '').trim();
  const initial = String(player.initial || '').trim();
  const nameText = [lastName, initial].filter(Boolean).join(' ');

  if (displayNumber) {
    const numberCircle = document.createElement('span');
    numberCircle.className = 'player-number-circle';
    numberCircle.textContent = displayNumber;
    const jerseyColor = document.getElementById('jerseyColorHome').value;
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
    const displayData = getPlayerDisplayData(playerData);
    const playerDisplay = createPlayerDisplay(displayData);
    displayContainer.appendChild(playerDisplay);
    const recordId = normalizePlayerId(playerData.id);
    if (recordId !== null && temporaryPlayerNumbers.has(recordId)) {
      const tempBadge = document.createElement('span');
      const tempValue = temporaryPlayerNumbers.get(recordId);
      tempBadge.className = 'badge text-bg-secondary ms-2';
      tempBadge.textContent = `Temp #${tempValue}`;
      tempBadge.setAttribute('aria-label', `Temporary number ${tempValue}`);
      displayContainer.appendChild(tempBadge);
    }

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
  const tempInput = document.getElementById('tempNumber');
  if (tempInput) {
    const tempValue = temporaryPlayerNumbers.get(normalizePlayerId(player.id));
    tempInput.value = tempValue !== undefined ? tempValue : '';
  }
  document.getElementById('savePlayerBtn').textContent = 'Update Player';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  clearPlayerFormError();
}

function cancelEdit() {
  resetPlayerForm();
}

function resetPlayerForm() {
function applyTemporaryNumbersFromRoster(roster) {
  if (!Array.isArray(roster)) {
    return;
  }
  roster.forEach(entry => {
    const normalized = normalizeRosterEntry(entry);
    if (!normalized) {
      return;
    }
    const { playerId, tempNumber } = normalized;
    if (tempNumber) {
      temporaryPlayerNumbers.set(playerId, tempNumber);
    } else {
      temporaryPlayerNumbers.delete(playerId);
    }
  });
}

function convertLegacyRosterEntries(legacyRoster) {
  if (!Array.isArray(legacyRoster) || legacyRoster.length === 0) {
    return [];
  }
  const lookup = new Map();
  playerRecords.forEach(record => {
    const recordId = normalizePlayerId(record.id);
    if (recordId === null) {
      return;
    }
    const key = formatLegacyPlayerRecord(record).toLocaleLowerCase();
    if (!key || lookup.has(key)) {
      return;
    }
    lookup.set(key, recordId);
  });
  const converted = [];
  const seen = new Set();
  legacyRoster.forEach(entry => {
    if (typeof entry !== 'string') {
      return;
    }
    const normalizedKey = entry.trim().toLocaleLowerCase();
    if (!normalizedKey) {
      return;
    }
    const playerId = lookup.get(normalizedKey);
    if (!playerId || seen.has(playerId)) {
      return;
    }
    seen.add(playerId);
    converted.push({ playerId });
  });
  return converted;
}

function extractRosterFromMatch(match) {
  if (!match) {
    return [];
  }
  const structuredRoster = normalizeRosterArray(match.players);
  if (structuredRoster.length > 0) {
    return structuredRoster;
  }
  if (Array.isArray(match.legacyPlayers) && match.legacyPlayers.length > 0) {
    return normalizeRosterArray(convertLegacyRosterEntries(match.legacyPlayers));
  }
  return [];
}
