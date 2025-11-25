// js/api/matches.js
// Fetches matches over WebSocket and wires the "Saved Matches" modal list.
import { deleteMatch, getMatches, onUpdate, onDelete } from './ws.js';

const MATCH_LIST_ID = 'matchList';
const MODAL_ID = 'matchIndexModal';
const CONFIRM_MODAL_ID = 'confirmDeleteModal';
const CONFIRM_MESSAGE_ID = 'confirmDeleteModalMessage';
const CONFIRM_BUTTON_ID = 'confirmDeleteModalConfirmBtn';

let isLoading = false;
let modalIsOpen = false;
let refreshTimer = null;

function getMatchId(match) {
  if (!match) return undefined;
  return match.id ?? match.match_id ?? match.matchId;
}

function getMatchListBody() {
  const table = document.getElementById(MATCH_LIST_ID);
  return table ? table.querySelector('tbody') : null;
}

function setListMessage(text, className = 'text-muted') {
  const body = getMatchListBody();
  if (!body) return;
  body.innerHTML = '';
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 3;
  cell.className = className;
  cell.textContent = text;
  row.appendChild(cell);
  body.appendChild(row);
}

function formatDate(value) {
  if (!value) return 'No date set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateShort(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function buildDeleteMessage(matchId, match) {
  const opponent = match?.opponent || 'opponent';
  const location = match?.location;
  const date = match?.date ? formatDateShort(match.date) : null;
  const parts = [`vs ${opponent}`];
  if (location) parts.push(`@ ${location}`);
  if (date) parts.push(`on ${date}`);
  const summary = parts.filter(Boolean).join(' ');
  const suffix = summary ? ` ${summary}` : '';
  return `Are you sure you want to delete this match${suffix}?`;
}

function confirmDelete(message) {
  const modalEl = document.getElementById(CONFIRM_MODAL_ID);
  const messageEl = document.getElementById(CONFIRM_MESSAGE_ID);
  const confirmBtn = document.getElementById(CONFIRM_BUTTON_ID);
  const bootstrapModal = window.bootstrap?.Modal;

  if (!modalEl || !messageEl || !confirmBtn || !bootstrapModal) {
    return Promise.resolve(window.confirm(message || 'Are you sure you want to delete this match? This is permanent and cannot be restored.'));
  }

  messageEl.textContent = message || 'Are you sure you want to delete this match? This is permanent and cannot be restored.';
  const modal = bootstrapModal.getOrCreateInstance(modalEl);

  return new Promise((resolve) => {
    let resolved = false;

    const handleHidden = () => {
      modalEl.removeEventListener('hidden.bs.modal', handleHidden);
      confirmBtn.removeEventListener('click', handleConfirm);
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    };

    const handleConfirm = () => {
      if (resolved) return;
      resolved = true;
      modal.hide();
      resolve(true);
    };

    modalEl.addEventListener('hidden.bs.modal', handleHidden, { once: true });
    confirmBtn.addEventListener('click', handleConfirm, { once: true });
    modal.show();
  });
}

function buildActions(match) {
  const matchId = getMatchId(match);
  const actions = document.createElement('div');
  actions.className = 'btn-group btn-group-sm flex-wrap';

  const loadLink = document.createElement('a');
  loadLink.className = 'btn btn-primary';
  loadLink.role = 'button';
  loadLink.textContent = 'Load';
  if (matchId) {
    loadLink.href = `?match=${encodeURIComponent(matchId)}`;
  } else {
    loadLink.classList.add('disabled');
    loadLink.setAttribute('aria-disabled', 'true');
    loadLink.tabIndex = -1;
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-outline-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.disabled = !matchId;
  deleteBtn.addEventListener('click', async () => {
    if (!matchId) return;
    const confirmMessage = buildDeleteMessage(matchId, match);
    const confirmed = await confirmDelete(confirmMessage);
    if (!confirmed) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    try {
      await deleteMatch(matchId);
      await refreshMatches();
    } catch (error) {
      console.error('Failed to delete match:', error);
      setListMessage('Could not delete match. Please try again.', 'text-danger');
    } finally {
      deleteBtn.textContent = 'Delete';
      deleteBtn.disabled = false;
    }
  });

  actions.append(loadLink, deleteBtn);
  return actions;
}

function renderMatches(matches) {
  const body = getMatchListBody();
  if (!body) return;
  body.innerHTML = '';

  if (!matches.length) {
    setListMessage('No saved matches yet.');
    return;
  }

  matches.forEach((match) => {
    const id = getMatchId(match);
    const opponent = match.opponent || 'Unknown opponent';
    const location = match.location || 'No location';
    const date = formatDate(match.date);

    const row = document.createElement('tr');

    const matchCell = document.createElement('td');
    matchCell.className = 'fw-semibold text-nowrap';
    matchCell.textContent = location ? `${opponent} @ ${location}` : opponent;

    const dateCell = document.createElement('td');
    dateCell.className = 'text-muted small text-nowrap';
    dateCell.textContent = date;

    const actionsCell = document.createElement('td');
    actionsCell.className = 'text-end';
    const actions = buildActions(match);
    actionsCell.appendChild(actions);

    row.append(matchCell, dateCell, actionsCell);
    body.appendChild(row);
  });
}

export async function refreshMatches() {
  if (isLoading) return;
  const body = getMatchListBody();
  if (!body) return;

  isLoading = true;
  setListMessage('Loading matches...');

  try {
    const response = await getMatches();
    const matches = Array.isArray(response?.body) ? response.body : [];
    renderMatches(matches);
  } catch (error) {
    console.error('Failed to load matches:', error);
    setListMessage('Could not load matches. Please try again.', 'text-danger');
  } finally {
    isLoading = false;
  }
}

function scheduleRefresh() {
  if (!modalIsOpen) return;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(refreshMatches, 200);
}

export function initSavedMatchesModal() {
  const modal = document.getElementById(MODAL_ID);
  const body = getMatchListBody();
  if (!modal || !body) return;

  modal.addEventListener('show.bs.modal', () => {
    modalIsOpen = true;
    refreshMatches();
  });

  modal.addEventListener('hidden.bs.modal', () => {
    modalIsOpen = false;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  });

  onUpdate((message) => {
    if (message.resource === 'match') {
      scheduleRefresh();
    }
  });

  onDelete((message) => {
    if (message.resource === 'match') {
      scheduleRefresh();
    }
  });
}
