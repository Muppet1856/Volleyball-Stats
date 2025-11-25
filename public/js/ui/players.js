import { state, setMatchPlayers, upsertMatchPlayer, removeMatchPlayer, setPlayers as setPlayersState } from '../state.js';
import { createJerseySvg } from '../init/jerseyColors.js';
import { fetchPlayers, createPlayer as createPlayerApi, updatePlayer as updatePlayerApi, deletePlayer as deletePlayerApi } from '../api/players.js';
const SORT_MODES = {
  NUMBER: 'number',
  NAME: 'name',
};

let roster = [];
let editId = null;
let mainSortMode = SORT_MODES.NUMBER;
let modalSortMode = SORT_MODES.NUMBER;
let hasRosterNumberConflict = false;
let hasWornJerseyConflict = false;

const DEFAULT_JERSEY_COLOR = '#0d6efd';
const ROSTER_JERSEY_SIZE = 47;

function getMatchPlayerEntry(playerId) {
  return state.matchPlayers.find((player) => player.playerId === playerId) ?? null;
}

function getMatchTempNumber(playerId) {
  const entry = getMatchPlayerEntry(playerId);
  return entry?.tempNumber ?? null;
}

function getMatchAppearance(playerId) {
  const entry = getMatchPlayerEntry(playerId);
  return entry?.appeared ?? false;
}

async function loadRoster() {
  try {
    const players = await fetchPlayers();
    const normalized = players.map(normalizePlayer).filter(Boolean);
    roster = normalized;
    setPlayersState(normalized);
    pruneMatchPlayers();
  } catch (error) {
    console.error('Failed to load roster from API:', error);
  }
}

function saveRoster() {
  // Roster is now sourced from the backend; keep state in sync locally.
  setPlayersState(roster);
}

function normalizePlayer(player) {
  if (!player || typeof player !== 'object') return null;
  const id = player.id ?? crypto.randomUUID?.() ?? `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const number = player.number !== undefined && player.number !== null ? Number(player.number) : null;
  if (Number.isNaN(number)) return null;
  const lastName = typeof player.lastName === 'string'
    ? player.lastName.trim()
    : typeof player.last_name === 'string'
      ? player.last_name.trim()
      : '';
  if (!lastName) return null;
  const initial = typeof player.initial === 'string' ? player.initial.trim() : '';
  return { id, number, lastName, initial };
}

function formatPlayerName(player) {
  const base = player.lastName;
  if (player.initial) {
    return `${base}, ${player.initial}.`;
  }
  return base;
}

function getEffectivePlayerNumber(player) {
  const temp = getMatchTempNumber(player.id);
  return temp ?? player.number;
}

function getSelectedHomeJerseyColor() {
  const select = document.getElementById('jerseyColorHome');
  const selectedColor = select?.selectedOptions?.[0]?.dataset.color?.trim();
  if (selectedColor) return selectedColor;

  const computedPrimary = getComputedStyle(document.documentElement)
    .getPropertyValue('--bs-primary')
    ?.trim();
  return computedPrimary || DEFAULT_JERSEY_COLOR;
}

function createJerseyBadge(number, title) {
  const badge = document.createElement('span');
  badge.className = 'player-jersey-icon';
  badge.innerHTML = createJerseySvg(getSelectedHomeJerseyColor(), number ?? '', ROSTER_JERSEY_SIZE);
  if (title) {
    badge.title = title;
  }
  return badge;
}

function sortMainPlayers(list, mode = mainSortMode) {
  const cloned = [...list];
  cloned.sort((a, b) => {
    const effectiveNumberA = Number(getEffectivePlayerNumber(a));
    const effectiveNumberB = Number(getEffectivePlayerNumber(b));

    if (mode === SORT_MODES.NAME) {
      const nameA = formatPlayerName(a).toLowerCase();
      const nameB = formatPlayerName(b).toLowerCase();
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return effectiveNumberA - effectiveNumberB;
    }

    const numDiff = effectiveNumberA - effectiveNumberB;
    if (numDiff !== 0) return numDiff;
    return formatPlayerName(a).toLowerCase().localeCompare(formatPlayerName(b).toLowerCase());
  });
  return cloned;
}

function sortModalPlayers(list, mode = modalSortMode) {
  const cloned = [...list];
  cloned.sort((a, b) => {
    if (mode === SORT_MODES.NAME) {
      const nameA = formatPlayerName(a).toLowerCase();
      const nameB = formatPlayerName(b).toLowerCase();
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return Number(a.number) - Number(b.number);
    }

    const numDiff = Number(a.number) - Number(b.number);
    if (numDiff !== 0) return numDiff;
    return formatPlayerName(a).toLowerCase().localeCompare(formatPlayerName(b).toLowerCase());
  });
  return cloned;
}

function renderRoster() {
  const mainSorted = sortMainPlayers(roster);
  const modalSorted = sortModalPlayers(roster);
  renderMainList(mainSorted);
  renderModalList(modalSorted);
  refreshWornJerseyConflicts();
}

function renderMainList(list) {
  const container = document.getElementById('playerList');
  if (!container) return;
  container.innerHTML = '';

  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'text-muted mb-0';
    empty.textContent = 'No players added yet.';
    container.appendChild(empty);
    return;
  }

  for (const player of list) {
    const item = document.createElement('div');
    item.className = 'player-item';

    const appeared = getMatchAppearance(player.id);
    const toggle = createAppearanceCheckbox(player.id, appeared, 'main-player');

    const tempNumber = getMatchTempNumber(player.id);

    const numberCircle = createJerseyBadge(
      tempNumber ?? player.number,
      tempNumber ? `Temporary number for #${player.number}` : `Jersey #${player.number}`,
    );

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = formatPlayerName(player);

    const label = document.createElement('label');
    label.className = 'mb-0 flex-grow-1 d-flex align-items-center gap-2';
    label.htmlFor = toggle.id;

    if (tempNumber !== null && tempNumber !== undefined) {
      const tempFlag = createTempJerseyFlag(tempNumber, player.number);
      label.append(numberCircle, tempFlag, name);
    } else {
      label.append(numberCircle, name);
    }

    item.append(toggle, label);
    container.appendChild(item);
  }
}

function renderModalList(list) {
  const container = document.getElementById('modalPlayerList');
  if (!container) return;
  container.innerHTML = '';

  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'text-muted mb-0';
    empty.textContent = 'No players in roster. Add a player to get started.';
    container.appendChild(empty);
    return;
  }

  for (const player of list) {
    const item = document.createElement('div');
    item.className = 'player-item justify-content-between gap-3 align-items-center flex-wrap';

    const label = document.createElement('div');
    label.className = 'player-name mb-0 flex-grow-1';
    label.appendChild(createPlayerSummary(player));

    const actions = document.createElement('div');
    actions.className = 'btn-group btn-group-sm flex-shrink-0';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-outline-primary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => startEdit(player.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-outline-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deletePlayer(player.id));

    actions.append(editBtn, deleteBtn);
    item.append(label, actions);
    container.appendChild(item);
  }
}

function createPlayerSummary(player) {
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex align-items-center gap-2 flex-wrap';
  wrapper.style.minWidth = '0';

  const numberCircle = createJerseyBadge(player.number, `Jersey #${player.number}`);

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = formatPlayerName(player);

  const tempNumber = getMatchTempNumber(player.id);
  const tempBadge = document.createElement('span');
  tempBadge.className = 'badge rounded-pill text-bg-secondary';
  tempBadge.style.display = tempNumber ? '' : 'none';
  tempBadge.textContent = tempNumber ? `Temp #${tempNumber}` : '';
  tempBadge.title = tempNumber ? `Temporary jersey assignment: ${tempNumber}` : '';

  wrapper.append(numberCircle, name, tempBadge);
  return wrapper;
}

function createTempJerseyFlag(tempNumber, rosterNumber) {
  const flag = document.createElement('button');
  flag.type = 'button';
  flag.className = 'btn btn-link p-0 border-0 temp-jersey-flag text-warning';
  flag.setAttribute('aria-label', `Temporary jersey ${tempNumber} replaces roster number ${rosterNumber}`);
  flag.innerHTML = '<i class="bi bi-info-circle-fill" aria-hidden="true"></i>';
  flag.dataset.bsToggle = 'popover';
  flag.dataset.bsTrigger = 'focus hover';
  flag.dataset.bsPlacement = 'right';
  flag.dataset.bsCustomClass = 'temp-jersey-popover';
  flag.dataset.bsContent = `Temporary jersey #${tempNumber} is currently replacing roster #${rosterNumber}.`;

  if (typeof bootstrap !== 'undefined' && bootstrap?.Popover) {
    new bootstrap.Popover(flag);
  }

  return flag;
}

function startEdit(playerId) {
  const player = roster.find((p) => p.id === playerId);
  if (!player) return;
  const numberInput = document.getElementById('number');
  const lastNameInput = document.getElementById('lastName');
  const initialInput = document.getElementById('initial');
  const tempNumberInput = document.getElementById('tempNumber');
  const saveBtn = document.getElementById('savePlayerBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');

  numberInput.value = player.number;
  lastNameInput.value = player.lastName;
  initialInput.value = player.initial ?? '';
  tempNumberInput.value = getMatchTempNumber(player.id) ?? '';

  editId = player.id;
  saveBtn.textContent = 'Update Player';
  cancelBtn.style.display = 'inline-block';
  numberInput.focus();
}

function cancelEdit() {
  resetForm();
}

function resetForm() {
  const numberInput = document.getElementById('number');
  const lastNameInput = document.getElementById('lastName');
  const initialInput = document.getElementById('initial');
  const tempNumberInput = document.getElementById('tempNumber');
  const saveBtn = document.getElementById('savePlayerBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  const error = document.getElementById('playerFormError');
  const warning = document.getElementById('playerFormWarning');

  numberInput.value = '';
  lastNameInput.value = '';
  initialInput.value = '';
  tempNumberInput.value = '';
  saveBtn.textContent = 'Add Player';
  cancelBtn.style.display = 'none';
  error.classList.add('d-none');
  error.textContent = '';
  warning?.classList.add('d-none');
  if (warning) {
    warning.textContent = '';
  }
  editId = null;
  setRosterConflictState(false);
  refreshWornJerseyConflicts();
}

function setRosterConflictState(active) {
  hasRosterNumberConflict = active;
  syncModalConflictState();
}

function setWornJerseyConflictState(active) {
  hasWornJerseyConflict = active;
  syncModalConflictState();
}

function syncModalConflictState() {
  const modal = document.getElementById('playerModal');
  const modalConflictActive = hasRosterNumberConflict || hasWornJerseyConflict;
  updateModalDismissControls(modalConflictActive, hasWornJerseyConflict);
  updateConflictCloseButtonLabel(modalConflictActive);
  if (modal) {
    modal.dataset.rosterNumberConflict = hasRosterNumberConflict ? 'true' : 'false';
    modal.dataset.wornJerseyConflict = hasWornJerseyConflict ? 'true' : 'false';
    modal.dataset.modalConflict = modalConflictActive ? 'true' : 'false';
  }
}

function updateModalDismissControls(disabled, lockAll = false) {
  const modal = document.getElementById('playerModal');
  if (!modal) return;
  const dismissButtons = modal.querySelectorAll('[data-bs-dismiss="modal"]');
  dismissButtons.forEach((button) => {
    if (!lockAll && button.dataset.allowRosterConflict === 'true') {
      button.disabled = false;
      button.setAttribute('aria-disabled', 'false');
      button.classList.remove('disabled');
      return;
    }
    button.disabled = disabled;
    button.setAttribute('aria-disabled', disabled.toString());
    button.classList.toggle('disabled', disabled);
  });
}

function updateConflictCloseButtonLabel(conflictActive) {
  const closeBtn = document.getElementById('playerModalCloseBtn');
  if (!closeBtn) return;
  closeBtn.textContent = conflictActive ? 'Cancel' : 'Close';
  closeBtn.setAttribute('aria-label', conflictActive ? 'Cancel adding player' : 'Close');
}

function handlePlayerModalHide(event) {
  const modal = event.target;
  if (
    modal?.dataset.modalConflict === 'true' ||
    modal?.dataset.rosterNumberConflict === 'true' ||
    modal?.dataset.wornJerseyConflict === 'true' ||
    hasRosterNumberConflict ||
    hasWornJerseyConflict
  ) {
    event.preventDefault();
  }
}

function getWornJerseyAssignments() {
  return roster
    .map((player) => {
      const tempNumber = getMatchTempNumber(player.id);
      const wornNumber = tempNumber ?? player.number;
      const numericWorn = wornNumber === null ? null : Number(wornNumber);
      if (numericWorn === null || Number.isNaN(numericWorn)) return null;
      return { player, wornNumber: numericWorn };
    })
    .filter(Boolean);
}

function findPreferredWornConflict(assignments, preferredPlayerId, preferredWornNumber) {
  const conflictsByNumber = new Map();
  assignments.forEach((entry) => {
    const list = conflictsByNumber.get(entry.wornNumber) ?? [];
    list.push(entry.player);
    conflictsByNumber.set(entry.wornNumber, list);
  });

  if (preferredPlayerId) {
    const preferredEntry = assignments.find((entry) => entry.player.id === preferredPlayerId);
    if (preferredEntry) {
      const preferredPlayers = conflictsByNumber.get(preferredEntry.wornNumber);
      if (preferredPlayers?.length > 1) {
        return { wornNumber: preferredEntry.wornNumber, players: preferredPlayers };
      }
    }
  }

  if (preferredWornNumber !== null && preferredWornNumber !== undefined) {
    const preferredList = conflictsByNumber.get(Number(preferredWornNumber));
    if (preferredList?.length > 1) {
      return { wornNumber: Number(preferredWornNumber), players: preferredList };
    }
  }

  for (const [wornNumber, players] of conflictsByNumber.entries()) {
    if (players.length > 1) {
      return { wornNumber, players };
    }
  }

  return null;
}

function refreshWornJerseyConflicts(preferredPlayerId = null, preferredWornNumber = null) {
  const warning = document.getElementById('playerFormWarning');
  if (!warning) return false;

  const assignments = getWornJerseyAssignments();
  const preferredNumber = preferredWornNumber === null ? null : Number(preferredWornNumber);
  const conflict = findPreferredWornConflict(assignments, preferredPlayerId, preferredNumber);

  if (conflict) {
    const names = conflict.players.map((player) => formatPlayerName(player)).join(', ');
    warning.textContent = `Worn jersey #${conflict.wornNumber} is assigned to ${names}. Update a roster or temporary number to resolve the conflict.`;
    warning.classList.remove('d-none');
    setWornJerseyConflictState(true);
    return true;
  }

  warning.classList.add('d-none');
  warning.textContent = '';
  setWornJerseyConflictState(false);
  return false;
}

async function submitPlayer() {
  const numberInput = document.getElementById('number');
  const lastNameInput = document.getElementById('lastName');
  const initialInput = document.getElementById('initial');
  const tempNumberInput = document.getElementById('tempNumber');
  const error = document.getElementById('playerFormError');
  const warning = document.getElementById('playerFormWarning');

  error.classList.add('d-none');
  error.textContent = '';
  setRosterConflictState(false);
  setWornJerseyConflictState(false);
  if (warning) {
    warning.classList.add('d-none');
    warning.textContent = '';
  }

  const numberValue = Number(numberInput.value);
  const lastNameValue = lastNameInput.value.trim();
  const initialValue = initialInput.value.trim();
  const tempNumberValue = tempNumberInput.value.trim();
  const tempNumber = tempNumberValue === '' ? null : Number(tempNumberValue);

  if (!lastNameValue || Number.isNaN(numberValue)) {
    error.textContent = 'Player number and last name are required.';
    error.classList.remove('d-none');
    return;
  }

  if (tempNumberValue !== '' && Number.isNaN(tempNumber)) {
    error.textContent = 'Temporary jersey numbers must be numeric.';
    error.classList.remove('d-none');
    return;
  }

  const payload = normalizePlayer({
    id: editId ?? crypto.randomUUID?.() ?? `player-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    number: numberValue,
    lastName: lastNameValue,
    initial: initialValue,
  });

  if (!payload) {
    error.textContent = 'Please provide valid player details.';
    error.classList.remove('d-none');
    return;
  }

  const conflictingPlayer = roster.find((player) => player.id !== payload.id && Number(player.number) === payload.number);

  const existingIndex = roster.findIndex((p) => p.id === payload.id);
  if (conflictingPlayer) {
    error.textContent = `Jersey number ${payload.number} is already assigned to ${formatPlayerName(conflictingPlayer)}.`;
    error.classList.remove('d-none');
    const revertValue = existingIndex >= 0 ? roster[existingIndex].number : '';
    numberInput.value = revertValue;
    numberInput.focus();
    numberInput.select?.();
    setRosterConflictState(true);
    return;
  }

  const existingMatchEntry = getMatchPlayerEntry(payload.id);
  const saveBtn = document.getElementById('savePlayerBtn');
  const originalText = saveBtn?.textContent;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = editId ? 'Updating...' : 'Saving...';
  }

  try {
    let savedPlayer = payload;
    if (existingIndex >= 0) {
      const previous = roster[existingIndex];
      savedPlayer = await updatePlayerApi(payload.id, payload, previous);
      roster[existingIndex] = savedPlayer;
    } else {
      savedPlayer = await createPlayerApi(payload);
      roster.push(savedPlayer);
    }

    const nextTemp = tempNumber !== null ? tempNumber : null;
    const appeared = existingMatchEntry?.appeared ?? (tempNumber !== null);
    const nextWornNumber = nextTemp !== null ? nextTemp : savedPlayer.number;

    if (existingMatchEntry || appeared || nextTemp !== null) {
      upsertMatchPlayer(savedPlayer.id, nextTemp, appeared);
    } else {
      removeMatchPlayer(savedPlayer.id);
    }

    saveRoster();
    renderRoster();

    const wornConflictActive = refreshWornJerseyConflicts(savedPlayer.id, nextWornNumber);
    if (!wornConflictActive) {
      resetForm();
    }
  } catch (apiError) {
    console.error('Failed to save player:', apiError);
    error.textContent = 'Could not save player. Please try again.';
    error.classList.remove('d-none');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText ?? 'Add Player';
    }
  }
}

async function deletePlayer(playerId) {
  const index = roster.findIndex((p) => p.id === playerId);
  if (index === -1) return;

  const deleteBtn = document.activeElement;
  const originalText = deleteBtn?.textContent;
  if (deleteBtn && deleteBtn.tagName === 'BUTTON') {
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
  }

  try {
    await deletePlayerApi(playerId);
    roster.splice(index, 1);
    if (editId === playerId) {
      resetForm();
    }
    removeMatchPlayer(playerId);
    saveRoster();
    renderRoster();
  } catch (apiError) {
    console.error('Failed to delete player:', apiError);
  } finally {
    if (deleteBtn && deleteBtn.tagName === 'BUTTON') {
      deleteBtn.disabled = false;
      deleteBtn.textContent = originalText ?? 'Delete';
    }
  }
}

function toggleSortMode() {
  const nextMode = mainSortMode === SORT_MODES.NUMBER ? SORT_MODES.NAME : SORT_MODES.NUMBER;
  setMainSortMode(nextMode);
}

function toggleModalSortMode() {
  const nextMode = modalSortMode === SORT_MODES.NUMBER ? SORT_MODES.NAME : SORT_MODES.NUMBER;
  setModalSortMode(nextMode);
}

function setMainSortMode(mode) {
  mainSortMode = mode;
  const toggleBtn = document.getElementById('playerSortToggleBtn');

  if (toggleBtn) {
    const isNumberSort = mode === SORT_MODES.NUMBER;
    toggleBtn.textContent = isNumberSort ? 'Sort: Number' : 'Sort: Name';
    toggleBtn.setAttribute('aria-pressed', (!isNumberSort).toString());
    toggleBtn.title = isNumberSort ? 'Sorted numerically by jersey number.' : 'Sorted alphabetically by name.';
  }

  renderRoster();
}

function setModalSortMode(mode) {
  modalSortMode = mode;
  const sortToggleBtn = document.getElementById('modalPlayerSortToggleBtn');

  if (sortToggleBtn) {
    const isNumberSort = mode === SORT_MODES.NUMBER;
    sortToggleBtn.textContent = isNumberSort ? 'Sort: Number' : 'Sort: Name';
    sortToggleBtn.setAttribute('aria-pressed', (!isNumberSort).toString());
    sortToggleBtn.title = isNumberSort ? 'Sorted numerically by jersey number.' : 'Sorted alphabetically by name.';
  }

  renderRoster();
}

function pruneMatchPlayers() {
  const validIds = new Set(roster.map((player) => player.id));
  const filtered = state.matchPlayers.filter((entry) => validIds.has(entry.playerId));
  if (filtered.length !== state.matchPlayers.length) {
    setMatchPlayers(filtered);
  }
}

function createAppearanceCheckbox(playerId, appeared, prefix) {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'form-check-input';
  checkbox.id = `${prefix}-${playerId}`;
  checkbox.checked = appeared;
  checkbox.setAttribute('aria-label', 'Appeared in match');
  checkbox.addEventListener('change', (event) => {
    handleAppearanceToggle(playerId, event.target.checked);
  });
  return checkbox;
}

function handleAppearanceToggle(playerId, appeared) {
  const currentEntry = getMatchPlayerEntry(playerId);
  const tempNumber = currentEntry?.tempNumber ?? null;
  upsertMatchPlayer(playerId, tempNumber, appeared);
  renderRoster();
}

function attachEvents() {
  const saveBtn = document.getElementById('savePlayerBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  const sortToggleBtn = document.getElementById('playerSortToggleBtn');
  const modalSortToggleBtn = document.getElementById('modalPlayerSortToggleBtn');
  const playerModal = document.getElementById('playerModal');
  const dismissButtons = playerModal?.querySelectorAll('[data-bs-dismiss="modal"]');

  if (saveBtn) {
    saveBtn.removeAttribute('onclick');
    saveBtn.addEventListener('click', submitPlayer);
  }
  if (cancelBtn) {
    cancelBtn.removeAttribute('onclick');
    cancelBtn.addEventListener('click', cancelEdit);
  }
  if (sortToggleBtn) {
    sortToggleBtn.addEventListener('click', toggleSortMode);
  }
  if (modalSortToggleBtn) {
    modalSortToggleBtn.addEventListener('click', toggleModalSortMode);
  }

  const homeJerseySelect = document.getElementById('jerseyColorHome');
  if (homeJerseySelect) {
    homeJerseySelect.addEventListener('change', renderRoster);
  }

  if (playerModal) {
    playerModal.dataset.rosterNumberConflict = 'false';
    playerModal.dataset.wornJerseyConflict = 'false';
    playerModal.dataset.modalConflict = 'false';
    updateModalDismissControls(false);
    playerModal.addEventListener('hide.bs.modal', handlePlayerModalHide);
  }
  if (dismissButtons?.length) {
    dismissButtons.forEach((button) => {
      button.addEventListener('click', resetForm);
    });
  }
}

async function initRosterModule() {
  attachEvents();
  setMainSortMode(mainSortMode);
  setModalSortMode(modalSortMode);
  await loadRoster();
  renderRoster();
}

document.addEventListener('DOMContentLoaded', initRosterModule);
document.addEventListener('volleyball:new-match-reset', renderRoster);

// Expose handlers for inline attributes (fallback)
window.submitPlayer = submitPlayer;
window.cancelEdit = cancelEdit;
