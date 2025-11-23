const resultsBody = document.querySelector('#results tbody');
const runButton = document.querySelector('#run-tests');

function addResult(endpoint, method, status, body) {
  const row = document.createElement('tr');
  const endpointCell = document.createElement('td');
  endpointCell.textContent = endpoint;
  endpointCell.className = 'endpoint';

  const methodCell = document.createElement('td');
  methodCell.textContent = method;

  const statusCell = document.createElement('td');
  statusCell.textContent = status;
  statusCell.className = status && status < 300 ? 'status-success' : 'status-error';

  const responseCell = document.createElement('td');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = typeof body === 'string' ? body.slice(0, 100) || 'No content' : 'View body';
  const pre = document.createElement('pre');
  pre.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  details.append(summary, pre);
  responseCell.appendChild(details);

  row.append(endpointCell, methodCell, statusCell, responseCell);
  resultsBody.appendChild(row);
}

async function callApi(endpoint, method = 'GET', body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(endpoint, options);
  const contentType = response.headers.get('Content-Type') || '';
  let parsedBody;

  if (contentType.includes('application/json')) {
    parsedBody = await response.json();
  } else {
    parsedBody = await response.text();
  }

  return { status: response.status, body: parsedBody };
}

async function runTests() {
  resultsBody.innerHTML = '';
  runButton.disabled = true;
  const state = { matchId: null, playerId: null, setId: null };

  const steps = [
    async () => {
      const res = await callApi('/api/config');
      addResult('/api/config', 'GET', res.status, res.body);
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
        players: JSON.stringify([1, 2, 3, 4, 5, 6]),
        finalized_sets: JSON.stringify({}),
        deleted: 0,
      };
      const res = await callApi('/api/match/create', 'POST', payload);
      state.matchId = res.body?.id ?? null;
      addResult('/api/match/create', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-location', 'POST', { matchId: state.matchId, location: 'Test Arena Updated' });
      addResult('/api/match/set-location', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-date-time', 'POST', { matchId: state.matchId, date: new Date().toISOString() });
      addResult('/api/match/set-date-time', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-opp-name', 'POST', { matchId: state.matchId, opponent: 'Updated Visitors' });
      addResult('/api/match/set-opp-name', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-type', 'POST', { matchId: state.matchId, types: JSON.stringify({ scrimmage: true }) });
      addResult('/api/match/set-type', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-result', 'POST', { matchId: state.matchId, resultHome: 3, resultOpp: 1 });
      addResult('/api/match/set-result', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-players', 'POST', { matchId: state.matchId, players: JSON.stringify([7, 8, 9, 10, 11, 12]) });
      addResult('/api/match/set-players', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-home-color', 'POST', { matchId: state.matchId, jerseyColorHome: 'gold' });
      addResult('/api/match/set-home-color', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-opp-color', 'POST', { matchId: state.matchId, jerseyColorOpp: 'black' });
      addResult('/api/match/set-opp-color', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-first-server', 'POST', { matchId: state.matchId, firstServer: 'opp' });
      addResult('/api/match/set-first-server', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue tests without matchId');
      const res = await callApi('/api/match/set-deleted', 'POST', { matchId: state.matchId, deleted: 0 });
      addResult('/api/match/set-deleted', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'GET', 0, 'Cannot continue tests without matchId');
      const res = await callApi(`/api/match/get/${state.matchId}`);
      addResult(`/api/match/get/${state.matchId}`, 'GET', res.status, res.body);
    },
    async () => {
      const res = await callApi('/api/match');
      addResult('/api/match', 'GET', res.status, res.body);
    },
    async () => {
      const res = await callApi('/api/player/create', 'POST', { number: '00', last_name: 'Tester', initial: 'T' });
      state.playerId = res.body?.id ?? null;
      addResult('/api/player/create', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.playerId) return addResult('playerId missing', 'POST', 0, 'Cannot continue player tests without playerId');
      const res = await callApi('/api/player/set-lname', 'POST', { playerId: state.playerId, lastName: 'McTest' });
      addResult('/api/player/set-lname', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.playerId) return addResult('playerId missing', 'POST', 0, 'Cannot continue player tests without playerId');
      const res = await callApi('/api/player/set-fname', 'POST', { playerId: state.playerId, initial: 'TM' });
      addResult('/api/player/set-fname', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.playerId) return addResult('playerId missing', 'POST', 0, 'Cannot continue player tests without playerId');
      const res = await callApi('/api/player/set-number', 'POST', { playerId: state.playerId, number: '99' });
      addResult('/api/player/set-number', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.playerId) return addResult('playerId missing', 'GET', 0, 'Cannot continue player tests without playerId');
      const res = await callApi(`/api/player/get/${state.playerId}`);
      addResult(`/api/player/get/${state.playerId}`, 'GET', res.status, res.body);
    },
    async () => {
      const res = await callApi('/api/player');
      addResult('/api/player', 'GET', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue set tests without matchId');
      const res = await callApi('/api/set/create', 'POST', { match_id: state.matchId, set_number: 1, home_score: 0, opp_score: 0, home_timeout_1: 0, home_timeout_2: 0, opp_timeout_1: 0, opp_timeout_2: 0 });
      state.setId = res.body?.id ?? null;
      addResult('/api/set/create', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.setId) return addResult('setId missing', 'POST', 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-home-score', 'POST', { setId: state.setId, homeScore: 25 });
      addResult('/api/set/set-home-score', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.setId) return addResult('setId missing', 'POST', 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-opp-score', 'POST', { setId: state.setId, oppScore: 20 });
      addResult('/api/set/set-opp-score', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.setId) return addResult('setId missing', 'POST', 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-home-timeout', 'POST', { setId: state.setId, timeoutNumber: 1, value: 1 });
      addResult('/api/set/set-home-timeout', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.setId) return addResult('setId missing', 'POST', 0, 'Cannot continue set tests without setId');
      const res = await callApi('/api/set/set-opp-timeout', 'POST', { setId: state.setId, timeoutNumber: 2, value: 1 });
      addResult('/api/set/set-opp-timeout', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'POST', 0, 'Cannot continue set tests without matchId');
      const res = await callApi('/api/set/set-is-final', 'POST', { matchId: state.matchId, finalizedSets: JSON.stringify({ 1: true }) });
      addResult('/api/set/set-is-final', 'POST', res.status, res.body);
    },
    async () => {
      if (!state.setId) return addResult('setId missing', 'GET', 0, 'Cannot continue set tests without setId');
      const res = await callApi(`/api/set/get/${state.setId}`);
      addResult(`/api/set/get/${state.setId}`, 'GET', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'GET', 0, 'Cannot continue set tests without matchId');
      const res = await callApi(`/api/set?matchId=${state.matchId}`);
      addResult(`/api/set?matchId=${state.matchId}`, 'GET', res.status, res.body);
    },
    async () => {
      if (!state.setId) return addResult('setId missing', 'DELETE', 0, 'Cannot delete set without setId');
      const res = await callApi(`/api/set/delete/${state.setId}`, 'DELETE');
      addResult(`/api/set/delete/${state.setId}`, 'DELETE', res.status, res.body);
    },
    async () => {
      if (!state.playerId) return addResult('playerId missing', 'DELETE', 0, 'Cannot delete player without playerId');
      const res = await callApi(`/api/player/delete/${state.playerId}`, 'DELETE');
      addResult(`/api/player/delete/${state.playerId}`, 'DELETE', res.status, res.body);
    },
    async () => {
      if (!state.matchId) return addResult('matchId missing', 'DELETE', 0, 'Cannot delete match without matchId');
      const res = await callApi(`/api/match/delete/${state.matchId}`, 'DELETE');
      addResult(`/api/match/delete/${state.matchId}`, 'DELETE', res.status, res.body);
    },
  ];

  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      addResult('Error running step', 'N/A', 0, (error && error.message) || String(error));
    }
  }

  runButton.disabled = false;
}

runButton.addEventListener('click', runTests);
