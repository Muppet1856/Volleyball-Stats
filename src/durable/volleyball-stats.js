const INTERNAL_ERROR = 'Internal error';

function createInitialState() {
  return {
    matches: [],
    players: [],
    nextMatchId: 1,
    nextPlayerId: 1
  };
}

function cloneMatch(match) {
  if (match === undefined || match === null) {
    return {};
  }
  return JSON.parse(JSON.stringify(match));
}

function clonePlayer(player) {
  if (player === undefined || player === null) {
    return {};
  }
  return JSON.parse(JSON.stringify(player));
}

function compareMatches(a, b) {
  const dateA = a.date ?? '';
  const dateB = b.date ?? '';
  if (dateA !== dateB) {
    return dateA.localeCompare(dateB);
  }

  const opponentA = a.opponent ?? '';
  const opponentB = b.opponent ?? '';
  if (opponentA !== opponentB) {
    return opponentA.localeCompare(opponentB);
  }

  return a.id - b.id;
}

function comparePlayers(a, b) {
  const numberValue = (value) => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const numberA = numberValue(a.number);
  const numberB = numberValue(b.number);

  if (numberA !== numberB) {
    return numberA - numberB;
  }

  const lastNameA = a.lastName ?? '';
  const lastNameB = b.lastName ?? '';

  const lastNameComparison = lastNameA.localeCompare(lastNameB);
  if (lastNameComparison !== 0) {
    return lastNameComparison;
  }

  return a.id - b.id;
}

export class VolleyballStatsDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
    this.ready = state.blockConcurrencyWhile(async () => {
      this.data = await this.storage.get('state');
      if (!this.data) {
        this.data = createInitialState();
        await this.storage.put('state', this.data);
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const method = request.method.toUpperCase();

    try {
      await this.ready;

      if (segments.length === 0) {
        return Response.json({ error: 'Not Found' }, { status: 404 });
      }

      const [resource, idSegment] = segments;

      if (resource === 'matches') {
        return this.#handleMatches(method, idSegment, request);
      }

      if (resource === 'players') {
        return this.#handlePlayers(method, idSegment, request);
      }

      return Response.json({ error: 'Not Found' }, { status: 404 });
    } catch (error) {
      console.error('Durable Object error', error);
      return Response.json({ error: INTERNAL_ERROR }, { status: 500 });
    }
  }

  async #handleMatches(method, idSegment, request) {
    switch (method) {
      case 'GET':
        if (!idSegment) {
          return this.#listMatches();
        }
        return this.#getMatch(idSegment);
      case 'POST':
        if (idSegment) {
          return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
        }
        return this.#createMatch(request);
      case 'PUT':
        if (!idSegment) {
          return Response.json({ error: 'Match not found' }, { status: 404 });
        }
        return this.#updateMatch(idSegment, request);
      case 'DELETE':
        if (!idSegment) {
          return Response.json({ error: 'Match not found' }, { status: 404 });
        }
        return this.#deleteMatch(idSegment);
      default:
        return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }
  }

  async #handlePlayers(method, idSegment, request) {
    switch (method) {
      case 'GET':
        if (!idSegment) {
          return this.#listPlayers();
        }
        return Response.json({ error: 'Not Found' }, { status: 404 });
      case 'POST':
        if (idSegment) {
          return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
        }
        return this.#createPlayer(request);
      case 'PUT':
        if (!idSegment) {
          return Response.json({ error: 'Player not found' }, { status: 404 });
        }
        return this.#updatePlayer(idSegment, request);
      case 'DELETE':
        if (!idSegment) {
          return Response.json({ error: 'Player not found' }, { status: 404 });
        }
        return this.#deletePlayer(idSegment);
      default:
        return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }
  }

  async #listMatches() {
    const matches = [...this.data.matches]
      .map((match) => ({
        id: match.id,
        date: match.date ?? '',
        opponent: match.opponent ?? ''
      }))
      .sort(compareMatches);

    return Response.json(matches);
  }

  async #getMatch(idSegment) {
    const id = Number.parseInt(idSegment, 10);
    if (Number.isNaN(id)) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const match = this.data.matches.find((item) => item.id === id);
    if (!match) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    return Response.json(cloneMatch(match));
  }

  async #createMatch(request) {
    const payload = await request.json();
    const id = this.data.nextMatchId++;
    const stored = { id, ...cloneMatch(payload) };
    stored.id = id;

    this.data.matches.push(stored);
    await this.#saveState();

    return Response.json({ id }, { status: 201 });
  }

  async #updateMatch(idSegment, request) {
    const id = Number.parseInt(idSegment, 10);
    if (Number.isNaN(id)) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const index = this.data.matches.findIndex((item) => item.id === id);
    if (index === -1) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const payload = await request.json();
    const updated = { id, ...cloneMatch(payload) };
    updated.id = id;
    this.data.matches[index] = updated;
    await this.#saveState();

    return Response.json({ id });
  }

  async #deleteMatch(idSegment) {
    const id = Number.parseInt(idSegment, 10);
    if (Number.isNaN(id)) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const initialLength = this.data.matches.length;
    this.data.matches = this.data.matches.filter((item) => item.id !== id);

    if (this.data.matches.length === initialLength) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    await this.#saveState();
    return new Response(null, { status: 204 });
  }

  async #listPlayers() {
    const players = [...this.data.players]
      .map((player) => clonePlayer(player))
      .sort(comparePlayers)
      .map((player) => ({
        id: player.id,
        number: player.number ?? '',
        lastName: player.lastName ?? '',
        initial: player.initial ?? ''
      }));

    return Response.json(players);
  }

  async #createPlayer(request) {
    const payload = await request.json();
    const id = this.data.nextPlayerId++;
    const stored = {
      id,
      number: String(payload.number ?? ''),
      lastName: String(payload.lastName ?? ''),
      initial: String(payload.initial ?? '')
    };

    this.data.players.push(stored);
    await this.#saveState();

    return Response.json(clonePlayer(stored), { status: 201 });
  }

  async #updatePlayer(idSegment, request) {
    const id = Number.parseInt(idSegment, 10);
    if (Number.isNaN(id)) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    const index = this.data.players.findIndex((item) => item.id === id);
    if (index === -1) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    const payload = await request.json();
    const updated = {
      id,
      number: String(payload.number ?? ''),
      lastName: String(payload.lastName ?? ''),
      initial: String(payload.initial ?? '')
    };

    this.data.players[index] = updated;
    await this.#saveState();

    return Response.json(clonePlayer(updated));
  }

  async #deletePlayer(idSegment) {
    const id = Number.parseInt(idSegment, 10);
    if (Number.isNaN(id)) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    const initialLength = this.data.players.length;
    this.data.players = this.data.players.filter((item) => item.id !== id);

    if (this.data.players.length === initialLength) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    await this.#saveState();
    return new Response(null, { status: 204 });
  }

  async #saveState() {
    await this.storage.put('state', this.data);
  }
}
