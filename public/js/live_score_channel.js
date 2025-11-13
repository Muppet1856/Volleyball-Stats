(() => {
  const globalScope = typeof window !== 'undefined' ? window : globalThis;
  if (!globalScope) {
    return;
  }
  const existing = globalScope.LiveScoreChannel;
  if (existing && typeof existing === 'object') {
    return;
  }

  const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY_MS = 500;
  const MAX_RECONNECT_DELAY_MS = 8000;

  const messageHandlers = new Set();
  const statusHandlers = new Set();

  let socket = null;
  let pendingMessages = [];
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let manualClose = false;
  let maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS;
  let currentStatus = 'disconnected';
  let lastStatusDetail = null;
  let connectionMatchId = null;
  let connectionSetNumber = null;

  const clientId = generateClientId();

  function generateClientId() {
    try {
      if (globalScope.crypto && typeof globalScope.crypto.randomUUID === 'function') {
        return globalScope.crypto.randomUUID();
      }
    } catch (error) {
      // Ignore and fall back
    }
    const now = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `${now}-${random}`;
  }

  function getWebSocketUrl() {
    if (typeof globalScope.location === 'undefined') {
      return 'ws://localhost/api/live/score';
    }
    const { protocol, host } = globalScope.location;
    const scheme = protocol === 'https:' ? 'wss' : 'ws';
    let url = `${scheme}://${host}/api/live/score`;
    const params = new URLSearchParams();
    if (connectionMatchId !== null) {
      params.set('matchId', String(connectionMatchId));
    }
    if (connectionSetNumber !== null) {
      params.set('setNumber', String(connectionSetNumber));
    }
    const query = params.toString();
    if (query) {
      url += `?${query}`;
    }
    return url;
  }

  function sanitizePositiveInteger(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const integer = Math.floor(parsed);
    if (integer <= 0) {
      return null;
    }
    return integer;
  }

  function notifyStatus(status, detail = null) {
    currentStatus = status;
    lastStatusDetail = detail;
    statusHandlers.forEach((handler) => {
      try {
        handler(status, detail);
      } catch (error) {
        console.error('LiveScoreChannel status handler error', error);
      }
    });
  }

  function flushPendingMessages() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const queued = pendingMessages.slice();
    pendingMessages = [];
    queued.forEach((payload) => {
      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        console.error('LiveScoreChannel failed to send queued message', error);
      }
    });
  }

  function scheduleReconnect() {
    if (manualClose) {
      return;
    }
    if (reconnectAttempts >= maxReconnectAttempts) {
      notifyStatus('failed', { attempts: reconnectAttempts, willRetry: false });
      return;
    }
    const attempt = reconnectAttempts + 1;
    reconnectAttempts = attempt;
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1)
    );
    notifyStatus('reconnecting', { attempt, delay, willRetry: true });
    clearTimeout(reconnectTimer);
    reconnectTimer = globalScope.setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function handleOpen() {
    const isReconnect = reconnectAttempts > 0;
    reconnectAttempts = 0;
    notifyStatus('connected', { isReconnect });
    flushPendingMessages();
  }

  function handleMessage(event) {
    let data = null;
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.warn('LiveScoreChannel received invalid JSON message', error);
      return;
    }
    if (!data || typeof data !== 'object') {
      return;
    }
    messageHandlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error('LiveScoreChannel message handler error', error);
      }
    });
  }

  function cleanupSocket() {
    if (!socket) return;
    try {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
    } catch (error) {
      // Ignore cleanup errors
    }
    socket = null;
  }

  function handleClose(event) {
    cleanupSocket();
    if (manualClose) {
      notifyStatus('disconnected', { manual: true, code: event?.code });
      return;
    }
    notifyStatus('disconnected', { manual: false, code: event?.code });
    scheduleReconnect();
  }

  function handleError(event) {
    console.warn('LiveScoreChannel socket error', event);
    const detail = {
      type: event?.type || 'error',
      message: event?.message || null
    };
    notifyStatus('error', detail);
    if (manualClose) {
      return;
    }
    if (!socket) {
      scheduleReconnect();
      return;
    }
    const { readyState } = socket;
    if (readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED) {
      scheduleReconnect();
      return;
    }
    try {
      socket.close();
    } catch (error) {
      console.warn('LiveScoreChannel failed to close socket after error', error);
      cleanupSocket();
      scheduleReconnect();
    }
  }

  function openSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    manualClose = false;
    try {
      socket = new WebSocket(getWebSocketUrl());
    } catch (error) {
      console.error('LiveScoreChannel failed to create WebSocket', error);
      scheduleReconnect();
      return;
    }
    notifyStatus('connecting');
    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', handleClose);
    socket.addEventListener('error', handleError);
  }

  function ensureConnection() {
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      openSocket();
    }
  }

  function send(message) {
    if (!message || typeof message !== 'object') {
      return false;
    }
    const payload = { ...message, clientId };
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(payload));
        return true;
      } catch (error) {
        console.error('LiveScoreChannel failed to send message', error);
        pendingMessages.push(payload);
        ensureConnection();
        return false;
      }
    }
    pendingMessages.push(payload);
    ensureConnection();
    return false;
  }

  function connect(options = {}) {
    if (typeof options.maxReconnectAttempts === 'number') {
      maxReconnectAttempts = Math.max(1, Math.floor(options.maxReconnectAttempts));
    }
    if (Object.prototype.hasOwnProperty.call(options, 'matchId')) {
      connectionMatchId = sanitizePositiveInteger(options.matchId);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'setNumber')) {
      connectionSetNumber = sanitizePositiveInteger(options.setNumber);
    }
    ensureConnection();
  }

  function disconnect() {
    manualClose = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    pendingMessages = [];
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try {
        socket.close();
      } catch (error) {
        console.warn('LiveScoreChannel failed to close socket cleanly', error);
      }
    }
    cleanupSocket();
    notifyStatus('disconnected', { manual: true, willRetry: false });
  }

  function onMessage(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    messageHandlers.add(handler);
    return () => {
      messageHandlers.delete(handler);
    };
  }

  function onStatusChange(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    statusHandlers.add(handler);
    if (currentStatus !== 'disconnected' || lastStatusDetail) {
      try {
        handler(currentStatus, lastStatusDetail);
      } catch (error) {
        console.error('LiveScoreChannel status handler error', error);
      }
    }
    return () => {
      statusHandlers.delete(handler);
    };
  }

  function isConnected() {
    return Boolean(socket && socket.readyState === WebSocket.OPEN);
  }

  globalScope.LiveScoreChannel = {
    connect,
    disconnect,
    send,
    onMessage,
    onStatusChange,
    isConnected,
    getClientId() {
      return clientId;
    }
  };
})();
