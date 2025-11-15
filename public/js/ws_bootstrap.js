// public/js/ws_bootstrap.js
(() => {
  const DEFAULT_RETRY_DELAY = 1500;
  const MAX_RETRY_DELAY = 10000;
  const REQUEST_TIMEOUT_MS = 15000;

  const sendQueue = [];
  const pendingOrder = [];
  const pendingMap = new Map();

  let socket = null;
  let connectionPromise = null;
  let reconnectTimer = null;
  let retryDelay = DEFAULT_RETRY_DELAY;
  let messageCounter = 0;

  function isBrowser() {
    return typeof window !== 'undefined';
  }

  function getWebSocketUrl() {
    if (!isBrowser() || !window.location) {
      return 'ws://localhost/ws';
    }
    const { protocol, host } = window.location;
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${host}/ws`;
  }

  function getNextMessageId() {
    messageCounter = (messageCounter + 1) % Number.MAX_SAFE_INTEGER;
    const now = Date.now();
    return `msg-${now}-${messageCounter}`;
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (!isBrowser()) {
      return;
    }
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureConnection().catch((error) => {
        console.warn('WebSocket reconnect attempt failed', error);
        scheduleReconnect();
      });
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
  }

  function resetRetryDelay() {
    retryDelay = DEFAULT_RETRY_DELAY;
  }

  function removeFromPendingOrder(entry) {
    const index = pendingOrder.indexOf(entry);
    if (index >= 0) {
      pendingOrder.splice(index, 1);
    }
  }

  function finalizePending(entry, result, isError) {
    if (!entry) {
      return;
    }
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
      entry.timeoutId = null;
    }
    pendingMap.delete(entry.id);
    removeFromPendingOrder(entry);
    if (isError) {
      entry.reject(result);
    } else {
      entry.resolve(result);
    }
  }

  function handleTimeout(entry) {
    if (!entry) return;
    entry.timeoutId = null;
    pendingMap.delete(entry.id);
    removeFromPendingOrder(entry);
    entry.reject(new Error(entry.meta && entry.meta.timeoutMessage
      ? entry.meta.timeoutMessage
      : 'Request timed out waiting for a server response'));
  }

  function parseMessage(event) {
    const raw = typeof event.data === 'string' ? event.data : '';
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.debug('Ignoring non-JSON WebSocket message', raw);
      return null;
    }
  }

  function resolvePendingFromMessage(message) {
    if (!message) return null;
    if (typeof message.id === 'string' && pendingMap.has(message.id)) {
      return pendingMap.get(message.id) || null;
    }
    return pendingOrder.length > 0 ? pendingOrder[0] : null;
  }

  function handleAck(message) {
    const entry = resolvePendingFromMessage(message);
    if (!entry) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'success')) {
      if (message.success) {
        finalizePending(entry, message, false);
        return;
      }
      const failureReason = message.message
        || message.error
        || (entry.meta && entry.meta.errorMessage)
        || 'Server rejected update';
      finalizePending(entry, new Error(failureReason), true);
      return;
    }
    const status = message.status || message.result || 'ok';
    if (status === 'ok' || status === 'success' || status === 200) {
      finalizePending(entry, message, false);
      return;
    }
    const errorMessage = message.message
      || message.error
      || (entry.meta && entry.meta.errorMessage)
      || 'Server rejected update';
    finalizePending(entry, new Error(errorMessage), true);
  }

  function handleResponse(message) {
    const entry = resolvePendingFromMessage(message);
    if (!entry) {
      return;
    }
    const status = typeof message.status === 'number' ? message.status : 200;
    if (status >= 400) {
      const errorPayload = typeof message.body === 'string'
        ? message.body
        : JSON.stringify(message.body || {});
      const error = new Error(`${entry.meta?.resource || 'request'}.${entry.meta?.action || 'execute'} failed with status ${status}${errorPayload ? `: ${errorPayload}` : ''}`);
      finalizePending(entry, error, true);
      return;
    }
    const body = message.body !== undefined ? message.body : message;
    finalizePending(entry, body, false);
  }

  function handleGenericError(message) {
    const entry = resolvePendingFromMessage(message);
    if (!entry) {
      return;
    }
    const errorMessage = message?.error?.message
      || message?.error
      || entry.meta?.errorMessage
      || 'WebSocket request failed';
    finalizePending(entry, new Error(errorMessage), true);
  }

  function handleMessage(event) {
    const message = parseMessage(event);
    if (!message) {
      return;
    }
    if (message.type === 'ack') {
      handleAck(message);
      return;
    }
    if (message.type === 'response') {
      handleResponse(message);
      return;
    }
    if (message.error) {
      handleGenericError(message);
      return;
    }
    if (typeof message.status === 'number' || Object.prototype.hasOwnProperty.call(message, 'body')) {
      handleResponse(message);
    }
  }

  function reschedulePendingOnClose() {
    const retryable = [];
    pendingOrder.splice(0, pendingOrder.length).forEach((entry) => {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
        entry.timeoutId = null;
      }
      if (entry.meta && entry.meta.retryOnReconnect) {
        entry.sent = false;
        retryable.push(entry);
      } else {
        pendingMap.delete(entry.id);
        entry.reject(new Error('WebSocket connection closed before completion'));
      }
    });
    retryable.forEach((entry) => {
      if (!pendingMap.has(entry.id)) {
        pendingMap.set(entry.id, entry);
      }
      sendQueue.push(entry);
    });
  }

  function handleSocketClose() {
    if (socket) {
      socket.removeEventListener('message', handleMessage);
    }
    socket = null;
    connectionPromise = null;
    reschedulePendingOnClose();
    scheduleReconnect();
  }

  function handleSocketError() {
    if (socket) {
      try {
        socket.close();
      } catch (closeError) {
        console.warn('Error closing WebSocket after failure', closeError);
      }
    }
  }

  function flushSendQueue() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    while (sendQueue.length > 0) {
      const entry = sendQueue.shift();
      try {
        socket.send(entry.serialized);
        entry.sent = true;
        pendingOrder.push(entry);
        entry.timeoutId = setTimeout(() => handleTimeout(entry), REQUEST_TIMEOUT_MS);
      } catch (error) {
        console.warn('Failed to send WebSocket message, will retry', error);
        entry.sent = false;
        sendQueue.unshift(entry);
        handleSocketError();
        break;
      }
    }
  }

  function ensureConnection() {
    if (!isBrowser()) {
      return Promise.reject(new Error('WebSocket transport requires a browser environment'));
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(socket);
    }
    if (connectionPromise) {
      return connectionPromise;
    }

    connectionPromise = new Promise((resolve, reject) => {
      if (typeof WebSocket === 'undefined') {
        connectionPromise = null;
        reject(new Error('WebSocket API is not available in this environment'));
        return;
      }
      try {
        const ws = new WebSocket(getWebSocketUrl());
        socket = ws;
        ws.addEventListener('message', handleMessage);
        ws.addEventListener('open', () => {
          resetRetryDelay();
          flushSendQueue();
          resolve(ws);
        }, { once: true });
        ws.addEventListener('close', () => {
          if (connectionPromise) {
            reject(new Error('WebSocket connection closed during handshake'));
          }
          handleSocketClose();
        }, { once: true });
        ws.addEventListener('error', (event) => {
          console.warn('WebSocket connection error', event);
          if (connectionPromise) {
            reject(new Error('Failed to establish WebSocket connection'));
          }
          handleSocketError();
        }, { once: true });
      } catch (error) {
        connectionPromise = null;
        reject(error);
        scheduleReconnect();
      }
    });

    return connectionPromise.finally(() => {
      connectionPromise = null;
    });
  }

  function enqueueMessage(envelope, meta) {
    if (!isBrowser()) {
      return Promise.reject(new Error('WebSocket transport requires a browser environment'));
    }
    const id = getNextMessageId();
    const payload = { ...envelope, id };
    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const entry = {
        id,
        payload,
        serialized,
        resolve,
        reject,
        meta: meta || {},
        sent: false,
        timeoutId: null
      };
      pendingMap.set(id, entry);
      sendQueue.push(entry);
      ensureConnection()
        .then(() => {
          flushSendQueue();
        })
        .catch((error) => {
          if (!entry.sent) {
            pendingMap.delete(id);
            const queueIndex = sendQueue.indexOf(entry);
            if (queueIndex >= 0) {
              sendQueue.splice(queueIndex, 1);
            }
            reject(error);
          }
        });
    });
  }

  function buildResourceEnvelope(resource, action, data) {
    const envelope = {};
    envelope[resource] = {};
    envelope[resource][action] = data || {};
    return envelope;
  }

  function sendAtomicUpdate(resource, action, data) {
    if (!resource || !action) {
      return Promise.reject(new Error('Resource and action are required for atomic updates'));
    }
    return enqueueMessage(
      buildResourceEnvelope(resource, action, data),
      {
        resource,
        action,
        retryOnReconnect: true,
        errorMessage: 'Live update failed',
        timeoutMessage: 'Timed out waiting for server acknowledgement'
      }
    );
  }

  function request(resource, action, data) {
    if (!resource || !action) {
      return Promise.reject(new Error('Resource and action are required for WebSocket requests'));
    }
    return enqueueMessage(
      buildResourceEnvelope(resource, action, data),
      {
        resource,
        action,
        retryOnReconnect: false,
        errorMessage: `${resource}.${action} failed`
      }
    );
  }

  const transport = {
    ensureConnection,
    sendAtomicUpdate,
    request
  };

  if (isBrowser()) {
    window.wsTransport = transport;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = transport;
  }
})();
