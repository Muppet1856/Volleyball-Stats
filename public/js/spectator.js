const HOME_TEAM_FALLBACK = 'Home Team';
const POLL_INTERVAL_MS = 15000;

const dom = {
  viewerStatus: document.getElementById('viewerStatus'),
  shareLink: document.getElementById('shareLink'),
  homeTeamLabel: document.getElementById('homeTeamLabel'),
  awayTeamLabel: document.getElementById('awayTeamLabel'),
  homeScore: document.getElementById('homeTeamScore'),
  awayScore: document.getElementById('awayTeamScore'),
  homeTimeoutTrack: document.getElementById('homeTimeoutTrack'),
  awayTimeoutTrack: document.getElementById('awayTimeoutTrack'),
  currentSetLabel: document.getElementById('currentSetLabel'),
  homeSetCount: document.getElementById('homeSetCount'),
  awaySetCount: document.getElementById('awaySetCount'),
  setSummaryBody: document.getElementById('setSummaryBody'),
  homeSummaryHeader: document.getElementById('homeSummaryHeader'),
  awaySummaryHeader: document.getElementById('awaySummaryHeader')
};

const state = {
  matchId: null,
  homeTeamName: HOME_TEAM_FALLBACK,
  eventSource: null,
  pollTimer: null,
  lastRevision: null
};

function parseMatchId() {
  const params = new URLSearchParams(window.location.search);
  const candidates = ['matchId', 'match', 'id'];
  for (const key of candidates) {
    const raw = params.get(key);
    if (!raw) continue;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function updateViewerStatus(message, { tone = 'info' } = {}) {
  if (!dom.viewerStatus) return;
  dom.viewerStatus.textContent = message;
  dom.viewerStatus.dataset.tone = tone;
}

function formatScoreValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '00';
  }
  return Math.max(0, Math.min(99, Number(value))).toString().padStart(2, '0');
}

function parseScore(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : Math.max(0, Math.min(99, parsed));
}

function normalizeTimeoutArray(source) {
  const normalized = [false, false];
  if (!source) return normalized;
  if (Array.isArray(source)) {
    for (let i = 0; i < Math.min(source.length, normalized.length); i++) {
      normalized[i] = Boolean(source[i]);
    }
    return normalized;
  }
  if (typeof source === 'object') {
    for (let i = 0; i < normalized.length; i++) {
      if (source[i] !== undefined) {
        normalized[i] = Boolean(source[i]);
      }
    }
  }
  return normalized;
}

function renderTimeoutTrack(element, usedFlags) {
  if (!element) return;
  element.innerHTML = '';
  usedFlags.forEach((used, index) => {
    const indicator = document.createElement('span');
    indicator.className = `timeout-indicator${used ? ' used' : ''}`;
    indicator.textContent = 'TO';
    indicator.setAttribute('aria-label', used ? `Timeout ${index + 1} used` : `Timeout ${index + 1} available`);
    element.appendChild(indicator);
  });
}

function determineCurrentSet(match) {
  const sets = match?.sets || {};
  const finalized = match?.finalizedSets || {};
  for (let i = 1; i <= 5; i++) {
    if (!finalized[i]) {
      const entry = sets[i] || sets[String(i)];
      const scScore = parseScore(entry?.sc);
      const oppScore = parseScore(entry?.opp);
      if (scScore !== null || oppScore !== null) {
        return i;
      }
      if (i === 1) {
        return 1;
      }
    }
  }
  for (let i = 5; i >= 1; i--) {
    if (finalized[i]) {
      return i;
    }
  }
  return 1;
}

function getSetEntry(match, setNumber) {
  if (!match || !match.sets) return null;
  return match.sets[setNumber] || match.sets[String(setNumber)] || null;
}

function computeSetWins(match) {
  const finalized = match?.finalizedSets || {};
  let home = 0;
  let away = 0;
  for (let i = 1; i <= 5; i++) {
    if (!finalized[i]) continue;
    const entry = getSetEntry(match, i);
    if (!entry) continue;
    const scScore = parseScore(entry.sc);
    const oppScore = parseScore(entry.opp);
    if (scScore === null || oppScore === null || scScore === oppScore) {
      continue;
    }
    const swapped = Boolean(match?.isSwapped);
    if (swapped) {
      if (oppScore > scScore) home++;
      else if (scScore > oppScore) away++;
    } else {
      if (scScore > oppScore) home++;
      else away++;
    }
  }
  return { home, away };
}

function updateShareLink(matchId) {
  if (!dom.shareLink) return;
  if (!matchId) {
    dom.shareLink.textContent = 'Select a match to generate a link';
    dom.shareLink.href = '#';
    dom.shareLink.setAttribute('aria-disabled', 'true');
    return;
  }
  const targetUrl = new URL(window.location.href);
  targetUrl.pathname = '/live';
  targetUrl.search = `?matchId=${matchId}`;
  targetUrl.hash = '';
  dom.shareLink.textContent = targetUrl.toString();
  dom.shareLink.href = targetUrl.toString();
  dom.shareLink.removeAttribute('aria-disabled');
}

function describeSetStatus({ finalized, hasScores, setNumber, currentSet }) {
  if (finalized) {
    return { text: 'Final', className: 'status-pill final' };
  }
  if (setNumber === currentSet && hasScores) {
    return { text: 'In Progress', className: 'status-pill' };
  }
  if (hasScores) {
    return { text: 'Recorded', className: 'status-pill' };
  }
  return { text: 'Upcoming', className: 'status-pill upcoming' };
}

function renderSetSummary(match, names, currentSet) {
  if (!dom.setSummaryBody) return;
  const tbody = dom.setSummaryBody;
  tbody.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const entry = getSetEntry(match, i) || {};
    const scScore = parseScore(entry.sc);
    const oppScore = parseScore(entry.opp);
    const swapped = Boolean(match?.isSwapped);
    const homeScore = swapped ? oppScore : scScore;
    const awayScore = swapped ? scScore : oppScore;
    const hasScores = homeScore !== null || awayScore !== null;
    const finalized = Boolean(match?.finalizedSets?.[i]);
    const row = document.createElement('tr');
    if (i === currentSet) {
      row.classList.add('current-set');
    }
    if (finalized) {
      row.classList.add('finished-set');
    }
    const status = describeSetStatus({ finalized, hasScores, setNumber: i, currentSet });
    row.innerHTML = `
      <th scope="row">Set ${i}</th>
      <td>${homeScore === null ? '—' : homeScore}</td>
      <td>${awayScore === null ? '—' : awayScore}</td>
      <td><span class="${status.className}">${status.text}</span></td>
    `;
    tbody.appendChild(row);
  }
  if (dom.homeSummaryHeader) {
    dom.homeSummaryHeader.textContent = names.home;
  }
  if (dom.awaySummaryHeader) {
    dom.awaySummaryHeader.textContent = names.away;
  }
}

function resolveTeamNames(match) {
  const opponentName = match?.opponent?.trim() || 'Opponent';
  const swapped = Boolean(match?.isSwapped);
  return swapped
    ? { home: opponentName, away: state.homeTeamName }
    : { home: state.homeTeamName, away: opponentName };
}

function renderScoreboard(match) {
  const names = resolveTeamNames(match);
  if (dom.homeTeamLabel) dom.homeTeamLabel.textContent = names.home;
  if (dom.awayTeamLabel) dom.awayTeamLabel.textContent = names.away;

  const currentSet = determineCurrentSet(match);
  if (dom.currentSetLabel) {
    dom.currentSetLabel.textContent = `Set ${currentSet}`;
  }

  const entry = getSetEntry(match, currentSet) || {};
  const swapped = Boolean(match?.isSwapped);
  const homeScore = swapped ? parseScore(entry.opp) : parseScore(entry.sc);
  const awayScore = swapped ? parseScore(entry.sc) : parseScore(entry.opp);
  if (dom.homeScore) dom.homeScore.textContent = formatScoreValue(homeScore);
  if (dom.awayScore) dom.awayScore.textContent = formatScoreValue(awayScore);

  const wins = computeSetWins(match);
  if (dom.homeSetCount) dom.homeSetCount.textContent = wins.home;
  if (dom.awaySetCount) dom.awaySetCount.textContent = wins.away;

  const timeouts = entry?.timeouts || {};
  const homeTimeouts = swapped ? normalizeTimeoutArray(timeouts.opp) : normalizeTimeoutArray(timeouts.sc);
  const awayTimeouts = swapped ? normalizeTimeoutArray(timeouts.sc) : normalizeTimeoutArray(timeouts.opp);
  renderTimeoutTrack(dom.homeTimeoutTrack, homeTimeouts);
  renderTimeoutTrack(dom.awayTimeoutTrack, awayTimeouts);

  renderSetSummary(match, names, currentSet);
  updateDocumentTitle(names, match);
}

function updateDocumentTitle(names, match) {
  const opponent = names.away;
  const titleParts = [`Live: ${names.home} vs ${opponent}`];
  if (match?.location) {
    titleParts.push(`@ ${match.location}`);
  }
  document.title = titleParts.join(' • ');
}

function applySnapshot(payload) {
  const match = payload?.state || payload?.match || payload;
  if (!match) return;
  state.lastRevision = payload?.revision ?? match.revision ?? null;
  renderScoreboard(match);
  updateViewerStatus(`Connected • Revision ${state.lastRevision ?? '—'}`);
}

function handleSnapshotEvent(event) {
  try {
    const data = JSON.parse(event.data);
    applySnapshot(data.payload || data);
  } catch (error) {
    console.error('Failed to parse snapshot event', error);
  }
}

async function fetchHomeTeamName() {
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    const candidate = typeof data?.homeTeam === 'string' ? data.homeTeam.trim() : '';
    if (candidate) {
      state.homeTeamName = candidate;
    }
  } catch (error) {
    console.warn('Unable to load home team configuration', error);
  }
}

async function loadInitialMatch(matchId) {
  try {
    const response = await fetch(`/api/matches/${matchId}`, {
      headers: { Accept: 'application/json' }
    });
    if (response.status === 404) {
      updateViewerStatus('Match not found. Double-check the link.', { tone: 'danger' });
      return 'notfound';
    }
    if (!response.ok) {
      updateViewerStatus('Unable to load match data.', { tone: 'danger' });
      return 'error';
    }
    const data = await response.json();
    applySnapshot({ state: data, revision: data?.revision });
    return 'ok';
  } catch (error) {
    console.error('Failed to load match', error);
    updateViewerStatus('Network error while loading match.', { tone: 'danger' });
    return 'error';
  }
}

function startPolling(matchId) {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  state.pollTimer = setInterval(async () => {
    try {
      const response = await fetch(`/api/matches/${matchId}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.revision !== state.lastRevision) {
        applySnapshot({ state: data, revision: data?.revision });
      }
    } catch (error) {
      console.warn('Polling failed', error);
    }
  }, POLL_INTERVAL_MS);
}

function startEventStream(matchId) {
  if (!('EventSource' in window)) {
    startPolling(matchId);
    return;
  }
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  const source = new EventSource(`/api/matches/${matchId}/stream`);
  source.addEventListener('open', () => {
    updateViewerStatus('Connected to live updates');
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  });
  source.addEventListener('snapshot', handleSnapshotEvent);
  source.addEventListener('error', () => {
    updateViewerStatus('Connection lost. Attempting to reconnect…', { tone: 'warning' });
    if (!state.pollTimer) {
      startPolling(matchId);
    }
  });
  state.eventSource = source;
}

async function initialize() {
  state.matchId = parseMatchId();
  updateShareLink(state.matchId);
  if (!state.matchId) {
    updateViewerStatus('Add ?matchId=### to the URL to watch a match.', { tone: 'warning' });
    return;
  }
  await fetchHomeTeamName();
  const loadResult = await loadInitialMatch(state.matchId);
  if (loadResult === 'ok') {
    startEventStream(state.matchId);
  } else if (loadResult === 'error') {
    startPolling(state.matchId);
  }
}

window.addEventListener('DOMContentLoaded', initialize);
