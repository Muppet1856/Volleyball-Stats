// js/api/ws.js
// WebSocket client helpers that mirror the Durable Object API actions.
// Each function sends a WebSocket message shaped as { resource: { action: payload } }
// and resolves with the parsed response from the Worker.

const DEFAULT_WS_PATH = '/ws';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 300;
const RECONNECT_MAX_DELAY = 5000;

let socket = null;
let socketReadyPromise = null;
let socketReadyResolve = null;
let socketReadyReject = null;
const pendingRequests = new Set();
const updateListeners = new Set();
const deleteListeners = new Set();
const reconnectingListeners = new Set();
const reconnectedListeners = new Set();
const connectionStateListeners = new Set();
const activeSubscriptions = new Set();

let reconnectAttempts = 0;
let reconnecting = false;
let reconnectTimeout = null;
let lastUrl = null;
let connectionState = 'disconnected';

function createReadyPromise() {
  socketReadyPromise = new Promise((resolve, reject) => {
    socketReadyResolve = resolve;
    socketReadyReject = reject;
  });
  return socketReadyPromise;
}

function notify(listeners) {
  listeners.forEach((listener) => listener());
}

function setConnectionState(state) {
  if (connectionState === state) return;
  connectionState = state;
  connectionStateListeners.forEach((listener) => listener(state));
}

function getWsUrl() {
  if (typeof window === 'undefined') return DEFAULT_WS_PATH;
  const { host, hostname } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  const wsProtocol = isLocal ? 'ws:' : 'wss:';
  return `${wsProtocol}//${host}${DEFAULT_WS_PATH}`;
}

function resubscribeActive() {
  activeSubscriptions.forEach((matchId) => {
    sendRequest('match', 'subscribe', { matchId }).catch(() => {
      // Ignore failures; pending reconnection logic will retry if needed
    });
  });
}

function resetReconnectState() {
  reconnectAttempts = 0;
  reconnecting = false;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

function scheduleReconnect(url = lastUrl || getWsUrl()) {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (socketReadyReject) {
      socketReadyReject(new Error('Maximum reconnect attempts reached'));
    }
    reconnecting = false;
    setConnectionState('disconnected');
    return;
  }

  reconnecting = true;
  if (reconnectAttempts === 0) {
    notify(reconnectingListeners);
  }
  setConnectionState('reconnecting');

  reconnectAttempts += 1;
  const delay = Math.min(RECONNECT_BASE_DELAY * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_DELAY);
  createReadyPromise();
  reconnectTimeout = setTimeout(() => connectSocket(url), delay);
}

function connectSocket(url = getWsUrl()) {
  lastUrl = url;
  setConnectionState('reconnecting');
  socket = new WebSocket(url);

  if (!socketReadyPromise) {
    createReadyPromise();
  }

  socket.addEventListener('open', () => {
    const wasReconnecting = reconnecting;
    resetReconnectState();
    socketReadyResolve(socket);
    setConnectionState('connected');
    if (wasReconnecting) {
      notify(reconnectedListeners);
      resubscribeActive();
    }
  });

  socket.addEventListener('error', (event) => {
    if (socketReadyReject) {
      socketReadyReject(event);
    }
    scheduleReconnect(url);
  });

  socket.addEventListener('message', (event) => {
    handleIncoming(event.data);
  });

  socket.addEventListener('close', () => {
    pendingRequests.forEach(({ reject }) => reject(new Error('WebSocket closed')));
    pendingRequests.clear();
    if (socketReadyReject) {
      socketReadyReject(new Error('WebSocket closed'));
    }
    scheduleReconnect(url);
  });

  return socketReadyPromise;
}

function ensureSocket(url = getWsUrl()) {
  if (socket && socket.readyState <= 1) {
    return socketReadyPromise;
  }

  return connectSocket(url);
}

function handleIncoming(data) {
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    // Ignore non-JSON messages (e.g., debug strings)
    return;
  }

  if (parsed && parsed.type === 'update') {
    updateListeners.forEach((listener) => listener(parsed));
    return;
  }

  if (parsed && parsed.type === 'delete') {
    deleteListeners.forEach((listener) => listener(parsed));
    return;
  }

  // Match response to the first pending request waiting for this resource/action
  const match = Array.from(pendingRequests).find(({ resource, action }) => {
    return parsed.resource === resource && parsed.action === action && Object.prototype.hasOwnProperty.call(parsed, 'status');
  });

  if (match) {
    pendingRequests.delete(match);
    if (parsed.error) {
      match.reject(new Error(parsed.error.message || 'Unknown error'));
    } else {
      match.resolve(parsed);
    }
  }
}

async function sendRequest(resource, action, payload = {}) {
  await ensureSocket();

  return new Promise((resolve, reject) => {
    const message = JSON.stringify({ [resource]: { [action]: payload } });
    const request = { resource, action, resolve, reject };
    pendingRequests.add(request);
    socket.send(message);
  });
}

export function onUpdate(listener) {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

export function onDelete(listener) {
  deleteListeners.add(listener);
  return () => deleteListeners.delete(listener);
}

// Match endpoints
export const createMatch = (data) => sendRequest('match', 'create', data);
export const setMatchLocation = (matchId, location) => sendRequest('match', 'set-location', { matchId, location });
export const setMatchDateTime = (matchId, date) => sendRequest('match', 'set-date-time', { matchId, date });
export const setMatchOppName = (matchId, opponent) => sendRequest('match', 'set-opp-name', { matchId, opponent });
export const setMatchType = (matchId, types) => sendRequest('match', 'set-type', { matchId, types });
export const setMatchResult = (matchId, resultHome, resultOpp) =>
  sendRequest('match', 'set-result', { matchId, resultHome, resultOpp });
export const setMatchPlayers = (matchId, players) => sendRequest('match', 'set-players', { matchId, players });
export const addMatchPlayer = (matchId, player) => sendRequest('match', 'add-player', { matchId, player });
export const removeMatchPlayer = (matchId, player) => sendRequest('match', 'remove-player', { matchId, player });
export const addMatchTempNumber = (matchId, tempNumber) =>
  sendRequest('match', 'add-temp-number', { matchId, tempNumber });
export const updateMatchTempNumber = (matchId, tempNumber) =>
  sendRequest('match', 'update-temp-number', { matchId, tempNumber });
export const removeMatchTempNumber = (matchId, tempNumber) =>
  sendRequest('match', 'remove-temp-number', { matchId, tempNumber });
export const setMatchHomeColor = (matchId, jerseyColorHome) =>
  sendRequest('match', 'set-home-color', { matchId, jerseyColorHome });
export const setMatchOppColor = (matchId, jerseyColorOpp) =>
  sendRequest('match', 'set-opp-color', { matchId, jerseyColorOpp });
export const setMatchFirstServer = (matchId, firstServer) =>
  sendRequest('match', 'set-first-server', { matchId, firstServer });
export const setMatchDeleted = (matchId, deleted) => sendRequest('match', 'set-deleted', { matchId, deleted });
export const subscribeToMatch = (matchId) => {
  activeSubscriptions.add(matchId);
  return sendRequest('match', 'subscribe', { matchId }).catch((err) => {
    activeSubscriptions.delete(matchId);
    throw err;
  });
};
export const unsubscribeFromMatch = (matchId) => {
  activeSubscriptions.delete(matchId);
  return sendRequest('match', 'unsubscribe', { matchId });
};
export const getMatch = (matchId) => sendRequest('match', 'get', { matchId });
export const getMatches = () => sendRequest('match', 'get', {});
export const deleteMatch = (id) => sendRequest('match', 'delete', { id });

// Player endpoints
export const createPlayer = (data) => sendRequest('player', 'create', data);
export const setPlayerLastName = (playerId, lastName) => sendRequest('player', 'set-lname', { playerId, lastName });
export const setPlayerFirstName = (playerId, initial) => sendRequest('player', 'set-fname', { playerId, initial });
export const setPlayerNumber = (playerId, number) => sendRequest('player', 'set-number', { playerId, number });
export const getPlayer = (id) => sendRequest('player', 'get', { id });
export const getPlayers = () => sendRequest('player', 'get', {});
export const deletePlayer = (id) => sendRequest('player', 'delete', { id });

// Set endpoints
export const createSet = (data) => sendRequest('set', 'create', data);
export const setHomeScore = (setId, homeScore, matchId) =>
  sendRequest('set', 'set-home-score', { setId, homeScore, matchId });
export const setOppScore = (setId, oppScore, matchId) =>
  sendRequest('set', 'set-opp-score', { setId, oppScore, matchId });
export const setHomeTimeout = (setId, timeoutNumber, value, matchId, timeoutStartedAt) =>
  sendRequest('set', 'set-home-timeout', { setId, timeoutNumber, value, matchId, timeoutStartedAt });
export const setOppTimeout = (setId, timeoutNumber, value, matchId, timeoutStartedAt) =>
  sendRequest('set', 'set-opp-timeout', { setId, timeoutNumber, value, matchId, timeoutStartedAt });
export const setIsFinal = (matchId, finalizedSets) =>
  sendRequest('set', 'set-is-final', { matchId, finalizedSets });
export const getSet = (id) => sendRequest('set', 'get', { id });
export const getSets = (matchId) => (matchId ? sendRequest('set', 'get', { matchId }) : sendRequest('set', 'get', {}));
export const deleteSet = (id, matchId) => sendRequest('set', 'delete', { id, matchId });

export function connect(url) {
  return ensureSocket(url);
}

export function onReconnecting(listener) {
  reconnectingListeners.add(listener);
  return () => reconnectingListeners.delete(listener);
}

export function onReconnected(listener) {
  reconnectedListeners.add(listener);
  return () => reconnectedListeners.delete(listener);
}

export function onConnectionStateChange(listener) {
  connectionStateListeners.add(listener);
  return () => connectionStateListeners.delete(listener);
}

export function getConnectionState() {
  return connectionState;
}

export function restartConnection(url = lastUrl || getWsUrl()) {
  resetReconnectState();
  scheduleReconnect(url);
}

export default {
  connect,
  onUpdate,
  onDelete,
  onReconnecting,
  onReconnected,
  onConnectionStateChange,
  getConnectionState,
  restartConnection,
  // Matches
  createMatch,
  setMatchLocation,
  setMatchDateTime,
  setMatchOppName,
  setMatchType,
  setMatchResult,
  setMatchPlayers,
  addMatchPlayer,
  removeMatchPlayer,
  addMatchTempNumber,
  updateMatchTempNumber,
  removeMatchTempNumber,
  setMatchHomeColor,
  setMatchOppColor,
  setMatchFirstServer,
  setMatchDeleted,
  subscribeToMatch,
  unsubscribeFromMatch,
  getMatch,
  getMatches,
  deleteMatch,
  // Players
  createPlayer,
  setPlayerLastName,
  setPlayerFirstName,
  setPlayerNumber,
  getPlayer,
  getPlayers,
  deletePlayer,
  // Sets
  createSet,
  setHomeScore,
  setOppScore,
  setHomeTimeout,
  setOppTimeout,
  setIsFinal,
  getSet,
  getSets,
  deleteSet,
};
