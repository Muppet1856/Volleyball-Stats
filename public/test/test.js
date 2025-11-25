const restResultsBody = document.querySelector('#rest-results tbody');
const wsResultsBody = document.querySelector('#ws-results tbody');
const runRestButton = document.querySelector('#run-rest-tests');
const runWsButton = document.querySelector('#run-ws-tests');

function renderRow(targetBody, label, method, request, status, body) {
  const row = document.createElement('tr');
  const endpointCell = document.createElement('td');
  endpointCell.textContent = label;
  endpointCell.className = 'endpoint';

  const methodCell = document.createElement('td');
  methodCell.textContent = method;

  const requestCell = document.createElement('td');
  const requestDetails = document.createElement('details');
  const requestSummary = document.createElement('summary');
  const requestText =
    request === null || request === undefined || request === ''
      ? 'No payload'
      : request;
  requestSummary.textContent =
    typeof requestText === 'string' ? requestText.slice(0, 100) : 'View request';
  const requestPre = document.createElement('pre');
  requestPre.textContent =
    typeof requestText === 'string' ? requestText : JSON.stringify(requestText, null, 2);
  requestDetails.append(requestSummary, requestPre);
  requestCell.appendChild(requestDetails);

  const statusCell = document.createElement('td');
  statusCell.textContent = status;
  const isSuccess = typeof status === 'number' ? status < 300 : Boolean(status);
  statusCell.className = isSuccess ? 'status-success' : 'status-error';

  const responseCell = document.createElement('td');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = typeof body === 'string' ? body.slice(0, 100) || 'No content' : 'View body';
  const pre = document.createElement('pre');
  pre.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  details.append(summary, pre);
  responseCell.appendChild(details);

  row.append(endpointCell, methodCell, requestCell, statusCell, responseCell);
  targetBody.appendChild(row);
}

function addRestResult(endpoint, method, request, status, body) {
  renderRow(restResultsBody, endpoint, method, request, status, body);
}

function addWsResult(action, method, request, status, body) {
  renderRow(wsResultsBody, action, method, request, status, body);
}

async function callApi(endpoint, method = 'GET', body) {
  const options = { method, headers: {} };
  const serializedBody =
    body === null || body === undefined ? null : JSON.stringify(body);
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = serializedBody;
  }

  const response = await fetch(endpoint, options);
  const contentType = response.headers.get('Content-Type') || '';
  let parsedBody;

  if (contentType.includes('application/json')) {
    parsedBody = await response.json();
  } else {
    parsedBody = await response.text();
  }

  return { status: response.status, body: parsedBody, request: serializedBody };
}

async function runRestTests() {
  restResultsBody.innerHTML = '';
  runRestButton.disabled = true;
  const state = { matchId: null, setId: null, starterId: null, benchId: null };
  const uniqueSuffix = Date.now().toString();

  const starterEntry = () =>
    state.starterId ? { player_id: state.starterId, temp_number: 11 } : null;
  const benchEntry = (tempNumber = 22) =>
    state.benchId ? { player_id: state.benchId, temp_number: tempNumber } : null;

  const steps = [
    async () => {
      const res = await callApi('/api/config');
      addRestResult('/api/config', 'GET', res.request, res.status, res.body);
    },
    async () => {
      const res = await callApi('/api/player/create', 'POST', { number: `9${uniqueSuffix}`, last_name: 'Starter', initial: 'S' });
      state.starterId = res.body?.id ?? null;
      addRestResult('/api/player/create (starter)', 'POST', res.request, res.status, res.body);
    },
    async () => {
      const res = await callApi('/api/player/create', 'POST', { number: `8${uniqueSuffix}`, last_name: 'Bench', initial: 'B' });
      state.benchId = res.body?.id ?? null;
      addRestResult('/api/player/create (bench)', 'POST', res.request, res.status, res.body);
    },
    async () => {
      const payload = {
        date: new Date().toISOString(),
        location: 'Test Arena',
        types: JSON.stringify({ friendly: true }),
        opponent: 'Visitors',
        jersey_color_home: 'blue',
        jersey_color_opp: 'red',
        result_home: 0,
        result_opp: 0,
        first_server: 'home',
        players: JSON.stringify([]),
        finalized_sets: JSON.stringify({}),
        deleted: 0,
      };
      const res = await callApi('/api/match/create', 'POST', payload);
      state.matchId = res.body?.id ?? null;
      addRestResult('/api/match/create', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-location', 'POST', { matchId: state.matchId, location: 'Test Arena Updated' });
      addRestResult('/api/match/set-location', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-date-time', 'POST', { matchId: state.matchId, date: new Date().toISOString() });
      addRestResult('/api/match/set-date-time', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-opp-name', 'POST', { matchId: state.matchId, opponent: 'Updated Visitors' });
      addRestResult('/api/match/set-opp-name', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-type', 'POST', { matchId: state.matchId, types: JSON.stringify({ scrimmage: true }) });
      addRestResult('/api/match/set-type', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-result', 'POST', { matchId: state.matchId, resultHome: 3, resultOpp: 1 });
      addRestResult('/api/match/set-result', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const roster = starterEntry();
      if (!roster) return addRestResult('player missing', 'POST', null, 0, 'Cannot set players without a starter');
      const res = await callApi('/api/match/set-players', 'POST', { matchId: state.matchId, players: JSON.stringify([roster]) });
      addRestResult('/api/match/set-players', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-home-color', 'POST', { matchId: state.matchId, jerseyColorHome: 'gold' });
      addRestResult('/api/match/set-home-color', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-opp-color', 'POST', { matchId: state.matchId, jerseyColorOpp: 'black' });
      addRestResult('/api/match/set-opp-color', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-first-server', 'POST', { matchId: state.matchId, firstServer: 'opp' });
      addRestResult('/api/match/set-first-server', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const bench = benchEntry();
      if (!bench) return addRestResult('player missing', 'POST', null, 0, 'Cannot add player without bench player');
      const res = await callApi('/api/match/add-player', 'POST', { matchId: state.matchId, player: JSON.stringify(bench) });
      addRestResult('/api/match/add-player', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const updatedBench = benchEntry(33);
      if (!updatedBench) return addRestResult('player missing', 'POST', null, 0, 'Cannot update player without bench player');
      const res = await callApi('/api/match/update-player', 'POST', { matchId: state.matchId, player: JSON.stringify(updatedBench) });
      addRestResult('/api/match/update-player', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      if (!state.benchId)
        return addRestResult('playerId missing', 'POST', null, 0, 'Cannot add temp number without bench player');
      const tempPayload = { player_id: state.benchId, temp_number: 44 };
      const res = await callApi('/api/match/add-temp-number', 'POST', { matchId: state.matchId, tempNumber: tempPayload });
      addRestResult('/api/match/add-temp-number', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      if (!state.benchId)
        return addRestResult('playerId missing', 'POST', null, 0, 'Cannot update temp number without bench player');
      const tempPayload = { player_id: state.benchId, temp_number: 55 };
      const res = await callApi('/api/match/update-temp-number', 'POST', { matchId: state.matchId, tempNumber: tempPayload });
      addRestResult('/api/match/update-temp-number', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      if (!state.benchId)
        return addRestResult('playerId missing', 'POST', null, 0, 'Cannot remove temp number without bench player');
      const tempPayload = { player_id: state.benchId };
      const res = await callApi('/api/match/remove-temp-number', 'POST', { matchId: state.matchId, tempNumber: tempPayload });
      addRestResult('/api/match/remove-temp-number', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const roster = starterEntry();
      if (!roster) return addRestResult('player missing', 'POST', null, 0, 'Cannot remove player without a starter');
      const res = await callApi('/api/match/remove-player', 'POST', { matchId: state.matchId, player: JSON.stringify(roster) });
      addRestResult('/api/match/remove-player', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-deleted', 'POST', { matchId: state.matchId, deleted: 0 });
      addRestResult('/api/match/set-deleted', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'GET', null, 0, 'Cannot continue tests without matchId');
      const res = await callApi(`/api/match/get/${state.matchId}`);
      addRestResult(`/api/match/get/${state.matchId}`, 'GET', res.request, res.status, res.body);
    },
    async () => {
      const res = await callApi('/api/match');
      addRestResult('/api/match', 'GET', res.request, res.status, res.body);
    },
    async () => {
      if (!state.benchId)
        return addRestResult('playerId missing', 'POST', null, 0, 'Cannot continue player tests without playerId');
      const res = await callApi('/api/player/set-lname', 'POST', { playerId: state.benchId, lastName: 'McTest' });
      addRestResult('/api/player/set-lname', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.benchId)
        return addRestResult('playerId missing', 'POST', null, 0, 'Cannot continue player tests without playerId');
      const res = await callApi('/api/player/set-fname', 'POST', { playerId: state.benchId, initial: 'TM' });
      addRestResult('/api/player/set-fname', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.benchId)
        return addRestResult('playerId missing', 'POST', null, 0, 'Cannot continue player tests without playerId');
      const res = await callApi('/api/player/set-number', 'POST', { playerId: state.benchId, number: `99${uniqueSuffix}` });
      addRestResult('/api/player/set-number', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.benchId)
        return addRestResult('playerId missing', 'GET', null, 0, 'Cannot continue player tests without playerId');
      const res = await callApi(`/api/player/get/${state.benchId}`);
      addRestResult(`/api/player/get/${state.benchId}`, 'GET', res.request, res.status, res.body);
    },
    async () => {
      const res = await callApi('/api/player');
      addRestResult('/api/player', 'GET', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue set tests without matchId');
      const res = await callApi('/api/set/create', 'POST', { match_id: state.matchId, set_number: 1, home_score: 0, opp_score: 0, home_timeout_1: 0, home_timeout_2: 0, opp_timeout_1: 0, opp_timeout_2: 0 });
      state.setId = res.body?.id ?? null;
      addRestResult('/api/set/create', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.setId)
        return addRestResult('setId missing', 'POST', null, 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-home-score', 'POST', { setId: state.setId, homeScore: 25 });
      addRestResult('/api/set/set-home-score', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.setId)
        return addRestResult('setId missing', 'POST', null, 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-opp-score', 'POST', { setId: state.setId, oppScore: 20 });
      addRestResult('/api/set/set-opp-score', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.setId)
        return addRestResult('setId missing', 'POST', null, 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-home-timeout', 'POST', { setId: state.setId, timeoutNumber: 1, value: 1 });
      addRestResult('/api/set/set-home-timeout', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.setId)
        return addRestResult('setId missing', 'POST', null, 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-opp-timeout', 'POST', { setId: state.setId, timeoutNumber: 2, value: 1 });
      addRestResult('/api/set/set-opp-timeout', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'POST', null, 0, 'Cannot continue set tests without matchId');
      const res = await callApi('/api/set/set-is-final', 'POST', { matchId: state.matchId, finalizedSets: JSON.stringify({ 1: true }) });
      addRestResult('/api/set/set-is-final', 'POST', res.request, res.status, res.body);
    },
    async () => {
      if (!state.setId)
        return addRestResult('setId missing', 'GET', null, 0, 'Cannot continue set tests without setId');
      const res = await callApi(`/api/set/get/${state.setId}`);
      addRestResult(`/api/set/get/${state.setId}`, 'GET', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'GET', null, 0, 'Cannot continue set tests without matchId');
      const res = await callApi(`/api/set?matchId=${state.matchId}`);
      addRestResult(`/api/set?matchId=${state.matchId}`, 'GET', res.request, res.status, res.body);
    },
    async () => {
      if (!state.setId)
        return addRestResult('setId missing', 'DELETE', null, 0, 'Cannot delete set without setId');
      const res = await callApi(`/api/set/delete/${state.setId}`, 'DELETE');
      addRestResult(`/api/set/delete/${state.setId}`, 'DELETE', res.request, res.status, res.body);
    },
    async () => {
      if (!state.benchId)
        return addRestResult('playerId missing', 'DELETE', null, 0, 'Cannot delete player without playerId');
      const res = await callApi(`/api/player/delete/${state.benchId}`, 'DELETE');
      addRestResult(`/api/player/delete/${state.benchId}`, 'DELETE', res.request, res.status, res.body);
    },
    async () => {
      if (!state.starterId)
        return addRestResult('playerId missing', 'DELETE', null, 0, 'Cannot delete player without playerId');
      const res = await callApi(`/api/player/delete/${state.starterId}`, 'DELETE');
      addRestResult(`/api/player/delete/${state.starterId}`, 'DELETE', res.request, res.status, res.body);
    },
    async () => {
      if (!state.matchId)
        return addRestResult('matchId missing', 'DELETE', null, 0, 'Cannot delete match without matchId');
      const res = await callApi(`/api/match/delete/${state.matchId}`, 'DELETE');
      addRestResult(`/api/match/delete/${state.matchId}`, 'DELETE', res.request, res.status, res.body);
    },
  ];

  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      addRestResult('Error running step', 'N/A', null, 0, (error && error.message) || String(error));
    }
  }

  runRestButton.disabled = false;
}

function deriveWsUrl() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWsClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(deriveWsUrl());
    const queue = [];
    const waiters = [];

    const handleMessage = (event) => {
      const text = event.data?.toString ? event.data.toString() : String(event.data);
      if (text.startsWith('Debug:')) return;
      try {
        const parsed = JSON.parse(text);
        const waiter = waiters.shift();
        if (waiter) {
          waiter(parsed);
        } else {
          queue.push(parsed);
        }
      } catch (error) {
      }
    };

    const handleOpen = () => {
      ws.removeEventListener('error', handleError);
      resolve({
        ws,
        send(resource, action, payload, serializedPayload) {
          const message = serializedPayload ?? JSON.stringify({ [resource]: { [action]: payload } });
          ws.send(message);
          return message;
        },
        async nextResponse(timeoutMs = 5000) {
          if (queue.length > 0) {
            return queue.shift();
          }
          return new Promise((resolveResponse, rejectResponse) => {
            const timer = setTimeout(() => {
              cleanup();
              rejectResponse(new Error(`Timed out waiting for ${name} response`));
            }, timeoutMs);

            const onClose = () => {
              cleanup();
              rejectResponse(new Error(`${name} WebSocket closed`));
            };
            const onError = () => {
              cleanup();
              rejectResponse(new Error(`${name} WebSocket error`));
            };
            const cleanup = () => {
              clearTimeout(timer);
              ws.removeEventListener('close', onClose);
              ws.removeEventListener('error', onError);
            };

            waiters.push((value) => {
              cleanup();
              resolveResponse(value);
            });
            ws.addEventListener('close', onClose);
            ws.addEventListener('error', onError);
          });
        },
        close() {
          ws.close();
        },
      });
    };

    const handleError = (event) => reject(new Error(event?.message || 'WebSocket connection failed'));

    ws.addEventListener('message', handleMessage);
    ws.addEventListener('open', handleOpen, { once: true });
    ws.addEventListener('error', handleError, { once: true });
  });
}

async function sendAndTrack(client, label, resource, action, payload) {
  const serializedPayload = JSON.stringify({ [resource]: { [action]: payload } });
  try {
    client.send(resource, action, payload, serializedPayload);
    const response = await client.nextResponse();
    addWsResult(label, 'WS', serializedPayload, response.status, response.body);
    if (response.status >= 300) {
      throw new Error(`${label} failed with status ${response.status}`);
    }
    return response;
  } catch (error) {
    addWsResult(label, 'WS', serializedPayload, 0, error.message || String(error));
    throw error;
  }
}

async function runWebSocketTests() {
  wsResultsBody.innerHTML = '';
  runWsButton.disabled = true;
  let listener;
  let actor;

  try {
    addWsResult('Connect listener', 'CONNECT', null, '…', 'Opening listener socket');
    listener = await createWsClient('listener');
    addWsResult('Connect listener', 'CONNECT', null, 101, 'Listener connected');
    listener.ws.addEventListener('message', (event) => {
      const text = event.data?.toString ? event.data.toString() : String(event.data);
      if (!text.startsWith('Debug:')) {
        addWsResult('Broadcast', 'EVENT', null, 'info', text);
      }
    });

    addWsResult('Connect actor', 'CONNECT', null, '…', 'Opening actor socket');
    actor = await createWsClient('actor');
    addWsResult('Connect actor', 'CONNECT', null, 101, 'Actor connected');

    const uniqueSuffix = Date.now().toString();

    const starterCreate = await sendAndTrack(actor, 'player:create starter', 'player', 'create', {
      number: `9${uniqueSuffix}`,
      last_name: 'WsStarter',
      initial: 'S',
    });
    const starterId = starterCreate.body.id;
    await sleep(150);

    const benchCreate = await sendAndTrack(actor, 'player:create bench', 'player', 'create', {
      number: `8${uniqueSuffix}`,
      last_name: 'WsBench',
      initial: 'B',
    });
    const benchId = benchCreate.body.id;
    await sleep(150);

    const matchCreate = await sendAndTrack(actor, 'match:create', 'match', 'create', {
      date: new Date().toISOString(),
      opponent: `WS Opponent ${uniqueSuffix}`,
    });
    const matchId = matchCreate.body.id;
    await sleep(200);

    await sendAndTrack(actor, 'match:set-location', 'match', 'set-location', { matchId, location: 'WS Location' });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-date-time', 'match', 'set-date-time', { matchId, date: new Date().toISOString() });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-opp-name', 'match', 'set-opp-name', { matchId, opponent: 'WS Opponent Updated' });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-type', 'match', 'set-type', { matchId, types: JSON.stringify({ tournament: true }) });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-result', 'match', 'set-result', { matchId, resultHome: 3, resultOpp: 2 });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-players', 'match', 'set-players', { matchId, players: JSON.stringify([{ player_id: starterId, temp_number: 11 }]) });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-home-color', 'match', 'set-home-color', { matchId, jerseyColorHome: 'blue' });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-opp-color', 'match', 'set-opp-color', { matchId, jerseyColorOpp: 'black' });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-first-server', 'match', 'set-first-server', { matchId, firstServer: 'home' });
    await sleep(100);
    await sendAndTrack(actor, 'match:add-player', 'match', 'add-player', { matchId, player: JSON.stringify({ player_id: benchId, temp_number: 22 }) });
    await sleep(100);
    await sendAndTrack(actor, 'match:update-player', 'match', 'update-player', { matchId, player: JSON.stringify({ player_id: benchId, temp_number: 33 }) });
    await sleep(100);
    await sendAndTrack(actor, 'match:remove-player', 'match', 'remove-player', { matchId, player: JSON.stringify({ player_id: starterId, temp_number: 11 }) });
    await sleep(100);
    await sendAndTrack(actor, 'match:set-deleted', 'match', 'set-deleted', { matchId, deleted: true });
    await sleep(100);
    await sendAndTrack(actor, 'match:get one', 'match', 'get', { matchId });
    await sendAndTrack(actor, 'match:get all', 'match', 'get', {});
    await sendAndTrack(actor, 'match:delete', 'match', 'delete', { id: matchId });
    await sleep(200);

    await sendAndTrack(actor, 'player:set-lname', 'player', 'set-lname', { playerId: benchId, lastName: 'WsUpdated' });
    await sleep(100);
    await sendAndTrack(actor, 'player:set-fname', 'player', 'set-fname', { playerId: benchId, initial: 'Q' });
    await sleep(100);
    await sendAndTrack(actor, 'player:set-number', 'player', 'set-number', { playerId: benchId, number: `21${uniqueSuffix}` });
    await sleep(100);
    await sendAndTrack(actor, 'player:get one', 'player', 'get', { id: benchId });
    await sendAndTrack(actor, 'player:get all', 'player', 'get', {});
    await sendAndTrack(actor, 'player:delete bench', 'player', 'delete', { id: benchId });
    await sleep(100);
    await sendAndTrack(actor, 'player:delete starter', 'player', 'delete', { id: starterId });
    await sleep(200);

    const setMatchCreate = await sendAndTrack(actor, 'set:match create', 'match', 'create', {
      date: new Date().toISOString(),
      opponent: `WS Set Opponent ${uniqueSuffix}`,
    });
    const setMatchId = setMatchCreate.body.id;
    await sleep(200);

    const setCreate = await sendAndTrack(actor, 'set:create (no preexisting sets)', 'set', 'create', {
      matchId: setMatchId,
      setNumber: 1,
      homeScore: 0,
      oppScore: 0,
      homeTimeout1: 0,
      homeTimeout2: 0,
      oppTimeout1: 0,
      oppTimeout2: 0,
    });
    const setId = setCreate.body.id;
    await sleep(200);

    await sendAndTrack(actor, 'set:get list', 'set', 'get', { matchId: setMatchId });

    await sendAndTrack(actor, 'set:set-home-score', 'set', 'set-home-score', { setId, homeScore: 25, matchId: setMatchId });
    await sleep(100);
    await sendAndTrack(actor, 'set:set-opp-score', 'set', 'set-opp-score', { setId, oppScore: 20, matchId: setMatchId });
    await sleep(100);
    await sendAndTrack(actor, 'set:set-home-timeout', 'set', 'set-home-timeout', { setId, timeoutNumber: 1, value: true, matchId: setMatchId });
    await sleep(100);
    await sendAndTrack(actor, 'set:set-opp-timeout', 'set', 'set-opp-timeout', { setId, timeoutNumber: 2, value: true, matchId: setMatchId });
    await sleep(100);
    await sendAndTrack(actor, 'set:set-is-final', 'set', 'set-is-final', { matchId: setMatchId, finalizedSets: JSON.stringify({ 1: true }) });
    await sleep(100);
    await sendAndTrack(actor, 'set:get one', 'set', 'get', { id: setId });
    await sendAndTrack(actor, 'set:get all', 'set', 'get', { matchId: setMatchId });
    await sendAndTrack(actor, 'set:delete', 'set', 'delete', { id: setId, matchId: setMatchId });
    await sleep(200);
    await sendAndTrack(actor, 'set:match delete', 'match', 'delete', { id: setMatchId });
  } catch (error) {
    addWsResult('Error running WebSocket flow', 'N/A', null, 0, error.message || String(error));
  } finally {
    actor?.close();
    listener?.close();
    runWsButton.disabled = false;
  }
}

runRestButton.addEventListener('click', runRestTests);
runWsButton.addEventListener('click', runWebSocketTests);
