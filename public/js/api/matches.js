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
  return document.getElementById(MATCH_LIST_ID);
}

function setListMessage(text, className = 'text-muted') {
  const body = getMatchListBody();
  if (!body) return;
  body.innerHTML = '';
  const message = document.createElement('div');
  message.className = `match-list-message ${className}`;
  message.textContent = text;
  body.appendChild(message);
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

function formatModalDate(value) {
  if (!value) return 'No date set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function normalizeDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
}

function compareMatches(a, b) {
  const aDate = normalizeDateValue(a?.date);
  const bDate = normalizeDateValue(b?.date);
  if (aDate !== bDate) {
    if (aDate === null) return 1;
    if (bDate === null) return -1;
    return aDate - bDate;
  }

  const opponentA = (a?.opponent || '').toLowerCase();
  const opponentB = (b?.opponent || '').toLowerCase();
  if (opponentA !== opponentB) return opponentA.localeCompare(opponentB);

  const locationA = (a?.location || '').toLowerCase();
  const locationB = (b?.location || '').toLowerCase();
  return locationA.localeCompare(locationB);
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

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-outline-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.disabled = !matchId;
  deleteBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!matchId) return;
    const confirmMessage = buildDeleteMessage(matchId, match);
    const confirmed = await confirmDelete(confirmMessage);
    if (!confirmed) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    try {
      await deleteMatch(matchId);
      await refreshMatches();
    } catch (_error) {
      setListMessage('Could not delete match. Please try again.', 'text-danger');
    } finally {
      deleteBtn.textContent = 'Delete';
      deleteBtn.disabled = false;
    }
  });

  actions.append(deleteBtn);
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
    const location = match.location;
    const date = formatModalDate(match.date);

    const item = document.createElement('div');
    const canLoad = Boolean(id);
    item.className = 'match-list-item';
    if (canLoad) {
      item.classList.add('match-list-link');
      item.tabIndex = 0;
      const navigateToMatch = () => {
        window.location.href = `?match=${encodeURIComponent(id)}`;
      };
      item.addEventListener('click', navigateToMatch);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigateToMatch();
        }
      });
    }

    const content = document.createElement('div');
    content.className = 'match-list-content text-truncate';

    const title = document.createElement('div');
    title.className = 'match-list-title text-truncate';
    const locationSuffix = location ? ` @ ${location}` : '';
    title.textContent = `${date} \u2013 ${opponent}${locationSuffix}`;
    content.append(title);

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'match-list-actions';
    const actions = buildActions(match);
    actionsWrapper.appendChild(actions);

    item.append(content, actionsWrapper);
    body.appendChild(item);
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
    const matches = Array.isArray(response?.body) ? response.body.slice().sort(compareMatches) : [];
    renderMatches(matches);
  } catch (_error) {
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
