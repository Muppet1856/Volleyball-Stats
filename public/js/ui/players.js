import { state, setMatchPlayers, upsertMatchPlayer, removeMatchPlayer } from '../state.js';

const STORAGE_KEY = 'volleyballStats:roster';
const SORT_MODES = {
  NUMBER: 'number',
  NAME: 'name',
};

let roster = [];
let editId = null;
let currentSortMode = SORT_MODES.NUMBER;

function getMatchTempNumber(playerId) {
  const entry = state.matchPlayers.find((player) => player.playerId === playerId);
  return entry?.tempNumber ?? null;
}

function loadRoster() {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return [];
    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePlayer).filter(Boolean);
  } catch (error) {
    console.warn('Failed to load roster from storage:', error);
    return [];
  }
}

function saveRoster() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
}

function normalizePlayer(player) {
  if (!player || typeof player !== 'object') return null;
  const id = player.id ?? crypto.randomUUID?.() ?? `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const number = player.number !== undefined && player.number !== null ? Number(player.number) : null;
  if (Number.isNaN(number)) return null;
  const lastName = typeof player.lastName === 'string' ? player.lastName.trim() : '';
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

function sortPlayers(list, mode = currentSortMode) {
  const cloned = [...list];
  cloned.sort((a, b) => {
    if (mode === SORT_MODES.NAME) {
      const nameA = formatPlayerName(a).toLowerCase();
      const nameB = formatPlayerName(b).toLowerCase();
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return Number(a.number) - Number(b.number);
    }
    // Default to number sorting
    const numDiff = Number(a.number) - Number(b.number);
    if (numDiff !== 0) return numDiff;
    return formatPlayerName(a).toLowerCase().localeCompare(formatPlayerName(b).toLowerCase());
  });
  return cloned;
}

function renderRoster() {
  const sorted = sortPlayers(roster);
  renderMainList(sorted);
  renderModalList(sorted);
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

    const tempNumber = getMatchTempNumber(player.id);

    const numberCircle = document.createElement('span');
    numberCircle.className = 'player-number-circle';
    numberCircle.textContent = tempNumber ?? player.number;
    numberCircle.title = tempNumber ? `Temporary number for #${player.number}` : `Jersey #${player.number}`;

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = formatPlayerName(player);

    const tempBadge = document.createElement('span');
    tempBadge.className = 'badge text-bg-secondary ms-2';
    tempBadge.style.display = tempNumber ? '' : 'none';
    tempBadge.textContent = tempNumber ? `Temp: ${tempNumber}` : '';

    item.append(numberCircle, name, tempBadge);
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
    item.className = 'player-item justify-content-between gap-3';

    const label = document.createElement('label');
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

  const tempNumber = getMatchTempNumber(player.id);

  const numberCircle = document.createElement('span');
  numberCircle.className = 'player-number-circle';
  numberCircle.textContent = tempNumber ?? player.number;
  numberCircle.title = tempNumber ? `Temporary number for #${player.number}` : `Jersey #${player.number}`;

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = formatPlayerName(player);

  const tempBadge = document.createElement('span');
  tempBadge.className = 'badge text-bg-secondary';
  tempBadge.style.display = tempNumber ? '' : 'none';
  tempBadge.textContent = tempNumber ? `Temp: ${tempNumber}` : '';

  wrapper.append(numberCircle, name, tempBadge);
  return wrapper;
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

  numberInput.value = '';
  lastNameInput.value = '';
  initialInput.value = '';
  tempNumberInput.value = '';
  saveBtn.textContent = 'Add Player';
  cancelBtn.style.display = 'none';
  error.classList.add('d-none');
  error.textContent = '';
  editId = null;
}

function submitPlayer() {
  const numberInput = document.getElementById('number');
  const lastNameInput = document.getElementById('lastName');
  const initialInput = document.getElementById('initial');
  const tempNumberInput = document.getElementById('tempNumber');
  const error = document.getElementById('playerFormError');

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

  const existingIndex = roster.findIndex((p) => p.id === payload.id);
  if (existingIndex >= 0) {
    roster[existingIndex] = payload;
  } else {
    roster.push(payload);
  }

  if (tempNumber !== null) {
    upsertMatchPlayer(payload.id, tempNumber);
  } else {
    removeMatchPlayer(payload.id);
  }

  saveRoster();
  resetForm();
  renderRoster();
}

function deletePlayer(playerId) {
  const index = roster.findIndex((p) => p.id === playerId);
  if (index === -1) return;
  roster.splice(index, 1);
  if (editId === playerId) {
    resetForm();
  }
  removeMatchPlayer(playerId);
  saveRoster();
  renderRoster();
}

function toggleSortMode() {
  const nextMode = currentSortMode === SORT_MODES.NUMBER ? SORT_MODES.NAME : SORT_MODES.NUMBER;
  setSortMode(nextMode);
}

function setSortMode(mode) {
  currentSortMode = mode;
  const toggleBtn = document.getElementById('playerSortToggleBtn');
  const sortSelect = document.getElementById('modalPlayerSortSelect');

  if (toggleBtn) {
    const isNumberSort = mode === SORT_MODES.NUMBER;
    toggleBtn.textContent = isNumberSort ? 'Sort: Number' : 'Sort: Name';
    toggleBtn.setAttribute('aria-pressed', (!isNumberSort).toString());
    toggleBtn.title = isNumberSort ? 'Sorted numerically by jersey number.' : 'Sorted alphabetically by name.';
  }

  if (sortSelect && sortSelect.value !== mode) {
    sortSelect.value = mode;
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

function attachEvents() {
  const saveBtn = document.getElementById('savePlayerBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  const sortToggleBtn = document.getElementById('playerSortToggleBtn');
  const sortSelect = document.getElementById('modalPlayerSortSelect');

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
  if (sortSelect) {
    sortSelect.addEventListener('change', (event) => setSortMode(event.target.value));
  }
}

function initRosterModule() {
  roster = loadRoster();
  pruneMatchPlayers();
  attachEvents();
  setSortMode(currentSortMode);
}

document.addEventListener('DOMContentLoaded', initRosterModule);

// Expose handlers for inline attributes (fallback)
window.submitPlayer = submitPlayer;
window.cancelEdit = cancelEdit;
