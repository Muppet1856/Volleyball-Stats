// js/api/matches.js
// Fetches matches over WebSocket and wires the “Saved Matches” modal list.
import { getMatches, onUpdate, onDelete } from './ws.js';

const MATCH_LIST_ID = 'matchList';
const MODAL_ID = 'matchIndexModal';

let isLoading = false;
let modalIsOpen = false;
let refreshTimer = null;

function getMatchListElement() {
  return document.getElementById(MATCH_LIST_ID);
}

function setListMessage(text, className = 'text-muted') {
  const list = getMatchListElement();
  if (!list) return;
  list.innerHTML = '';
  const li = document.createElement('li');
  li.className = `list-group-item ${className}`;
  li.textContent = text;
  list.appendChild(li);
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

function renderMatches(matches) {
  const list = getMatchListElement();
  if (!list) return;
  list.innerHTML = '';

  if (!matches.length) {
    setListMessage('No saved matches yet.');
    return;
  }

  matches.forEach((match) => {
    const id = match.id ?? match.match_id;
    const opponent = match.opponent || 'Unknown opponent';
    const location = match.location || 'No location';
    const date = formatDate(match.date);

    const item = document.createElement('li');
    item.className = 'list-group-item';

    const title = document.createElement('div');
    title.className = 'fw-semibold';
    title.textContent = `${opponent} (${location})`;

    const meta = document.createElement('div');
    meta.className = 'text-muted small';
    meta.textContent = `Match #${id ?? '—'} • ${date}`;

    item.append(title, meta);
    list.appendChild(item);
  });
}

export async function refreshMatches() {
  if (isLoading) return;
  const list = getMatchListElement();
  if (!list) return;

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
  const list = getMatchListElement();
  if (!modal || !list) return;

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
