// public/js/api_client.js
const apiClientUtilities = (() => {
  if (typeof module !== 'undefined' && module.exports) {
    return require('./utils');
  }
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  return {};
})();

const normalizeRosterArrayFn = apiClientUtilities.normalizeRosterArray;
const normalizeStoredScoreValueFn = apiClientUtilities.normalizeStoredScoreValue;

if (typeof normalizeRosterArrayFn !== 'function' || typeof normalizeStoredScoreValueFn !== 'function') {
  throw new Error('Required utilities are not available for apiClient.');
}

const apiClient = (() => {
  const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

  function safeJsonParse(value, fallback) {
    if (typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function normalizePlayerRecord(row) {
    if (!row) return null;
    return {
      id: row.id,
      number: String(row.number ?? '').trim(),
      lastName: String(row.last_name ?? row.lastName ?? '').trim(),
      initial: String(row.initial ?? '').trim()
    };
  }

  function serializePlayerInitial(initial) {
    return String(initial ?? '');
  }

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const init = { method };
    const baseHeaders = body !== undefined ? JSON_HEADERS : { Accept: 'application/json' };
    init.headers = { ...baseHeaders, ...headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const response = await fetch(path, init);
    if (!response.ok) {
      let errorMessage = `${method} ${path} failed with status ${response.status}`;
      try {
        const errorText = await response.text();
        if (errorText) {
          errorMessage += `: ${errorText}`;
        }
      } catch (readError) {
        // Ignore read errors
      }
      throw new Error(errorMessage);
    }
    if (response.status === 204) {
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  }

  function normalizeMatchFlags(flags = {}) {
    const defaults = { tournament: false, league: false, postSeason: false, nonLeague: false };
    return Object.keys(defaults).reduce((acc, key) => {
      const value = flags[key];
      acc[key] = Boolean(value);
      return acc;
    }, {});
  }

  function normalizeFinalizedSets(data) {
    const normalized = {};
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([key, value]) => {
        const setNumber = Number(key);
        if (!Number.isNaN(setNumber)) {
          normalized[setNumber] = Boolean(value);
        }
      });
    }
    return normalized;
  }

  function normalizeMatchSets(sets) {
    const normalized = {};
    if (!sets) {
      return normalized;
    }

    const assignSet = (setNumber, data) => {
      if (!Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) return;
      const timeouts = data && typeof data === 'object' ? data.timeouts || {} : {};
      const homeTimeouts = Array.isArray(timeouts.home)
        ? timeouts.home.map(Boolean)
        : [Boolean(timeouts.home?.[0]), Boolean(timeouts.home?.[1])];
      const oppTimeouts = Array.isArray(timeouts.opp)
        ? timeouts.opp.map(Boolean)
        : [Boolean(timeouts.opp?.[0]), Boolean(timeouts.opp?.[1])];
      normalized[setNumber] = {
        home: normalizeStoredScoreValueFn(data?.home ?? null),
        opp: normalizeStoredScoreValueFn(data?.opp ?? null),
        timeouts: {
          home: [homeTimeouts[0] || false, homeTimeouts[1] || false],
          opp: [oppTimeouts[0] || false, oppTimeouts[1] || false]
        }
      };
    };

    if (Array.isArray(sets)) {
      sets.forEach((value) => {
        if (!value || typeof value !== 'object') return;
        const setNumber = Number(
          value.setNumber ?? value.set_number ?? value.number ?? value.id ?? value.match_set_id
        );
        if (!Number.isInteger(setNumber)) return;
        const homeScore = value.home ?? value.home_score ?? value.homeScore;
        const oppScore = value.opp ?? value.opp_score ?? value.oppScore;
        const homeTimeouts = {
          home: [value.home_timeout_1, value.home_timeout_2],
          opp: [value.opp_timeout_1, value.opp_timeout_2]
        };
        assignSet(setNumber, {
          home: homeScore,
          opp: oppScore,
          timeouts: {
            home: homeTimeouts.home.map((entry) => Boolean(Number(entry))),
            opp: homeTimeouts.opp.map((entry) => Boolean(Number(entry)))
          }
        });
      });
      return normalized;
    }

    if (typeof sets === 'object') {
      Object.entries(sets).forEach(([key, value]) => {
        const setNumber = Number(key);
        if (Number.isNaN(setNumber)) return;
        const timeouts = value && typeof value === 'object' ? value.timeouts || {} : {};
        assignSet(setNumber, {
          home: value?.home ?? null,
          opp: value?.opp ?? null,
          timeouts
        });
      });
    }

    return normalized;
  }

  function parseMatchPlayers(value) {
    const parsedValue = typeof value === 'string' ? safeJsonParse(value, null) : value;
    if (Array.isArray(parsedValue)) {
      return { roster: [], deleted: false, legacyRoster: parsedValue.slice() };
    }
    if (parsedValue && typeof parsedValue === 'object') {
      const roster = normalizeRosterArrayFn(parsedValue.roster);
      const legacyRoster = Array.isArray(parsedValue.legacyRoster)
        ? parsedValue.legacyRoster.slice()
        : null;
      return {
        roster,
        deleted: Boolean(parsedValue.deleted),
        legacyRoster
      };
    }
    return { roster: [], deleted: false };
  }

  function serializeMatchPlayers(match) {
    const roster = normalizeRosterArrayFn(match?.players);
    return { roster };
  }

  function parseMatchMetadata(typesValue, finalizedSetsValue) {
    let parsed = null;
    if (typeof typesValue === 'string') {
      parsed = safeJsonParse(typesValue, null);
    } else if (typesValue && typeof typesValue === 'object') {
      parsed = typesValue;
    }

    let flags = normalizeMatchFlags();
    let sets = {};
    let deleted = false;
    let deletedFlagPresent = false;

    if (parsed && typeof parsed === 'object') {
      const candidateFlags = parsed.flags && typeof parsed.flags === 'object' ? parsed.flags : parsed;
      flags = normalizeMatchFlags(candidateFlags);
      if (parsed.sets && typeof parsed.sets === 'object') {
        sets = parsed.sets;
      }
      if (Object.prototype.hasOwnProperty.call(parsed, 'deleted')) {
        deleted = Boolean(parsed.deleted);
        deletedFlagPresent = true;
      }
    } else if (parsed !== null) {
      flags = normalizeMatchFlags(parsed);
    }

    let finalizedSets = {};
    if (typeof finalizedSetsValue === 'string') {
      const parsedColumn = safeJsonParse(finalizedSetsValue, null);
      if (parsedColumn && typeof parsedColumn === 'object') {
        finalizedSets = parsedColumn;
      }
    } else if (finalizedSetsValue && typeof finalizedSetsValue === 'object') {
      finalizedSets = finalizedSetsValue;
    }

    if (Object.keys(finalizedSets).length === 0 && parsed && typeof parsed === 'object') {
      const legacyFinalized = parsed.finalizedSets;
      if (legacyFinalized && typeof legacyFinalized === 'object') {
        finalizedSets = legacyFinalized;
      }
    }

    return {
      flags,
      sets,
      finalizedSets: normalizeFinalizedSets(finalizedSets),
      deleted,
      deletedFlagPresent
    };
  }

  function serializeMatchMetadata(match) {
    const flags = normalizeMatchFlags(match?.types || {});
    return { ...flags };
  }

  function normalizeResultValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function prepareMatchForStorage(match) {
    const metadata = serializeMatchMetadata(match);
    const deleted = Boolean(match?.deleted);
    const playersPayload = serializeMatchPlayers(match);
    const finalizedSetsPayload = normalizeFinalizedSets(match?.finalizedSets);
    const body = {
      date: match?.date || null,
      location: match?.location || null,
      types: JSON.stringify(metadata),
      opponent: match?.opponent || null,
      jersey_color_home: match?.jerseyColorHome || null,
      jersey_color_opp: match?.jerseyColorOpp || null,
      result_home: normalizeResultValue(match?.resultHome),
      result_opp: normalizeResultValue(match?.resultOpp),
      first_server: match?.firstServer || null,
      players: JSON.stringify(playersPayload),
      finalized_sets: JSON.stringify(finalizedSetsPayload || {}),
      deleted
    };
    return { body, metadata, playersPayload };
  }

  function parseMatchRow(row) {
    const id = Number(row.id);
    const metadata = parseMatchMetadata(row.types, row.finalized_sets);
    const playersPayload = parseMatchPlayers(row.players);
    const hasMetadataDeleted = Boolean(metadata.deletedFlagPresent);
    const metadataDeleted = Boolean(metadata.deleted);
    const legacyDeleted = Boolean(playersPayload.deleted);
    const columnHasDeleted = Object.prototype.hasOwnProperty.call(row, 'deleted');
    let deleted = null;
    if (columnHasDeleted) {
      const value = row.deleted;
      if (typeof value === 'string') {
        deleted = value === '1' || value.toLowerCase() === 'true';
      } else if (typeof value === 'number') {
        deleted = value !== 0;
      } else if (typeof value === 'boolean') {
        deleted = value;
      } else if (value == null) {
        deleted = false;
      }
    }
    if (deleted === null) {
      deleted = hasMetadataDeleted ? metadataDeleted : legacyDeleted;
    }
    return {
      id: Number.isNaN(id) ? row.id : id,
      date: row.date ?? '',
      location: row.location ?? '',
      types: metadata.flags,
      opponent: row.opponent ?? '',
      jerseyColorHome: row.jersey_color_home ?? '',
      jerseyColorOpp: row.jersey_color_opp ?? '',
      resultHome: row.result_home != null ? Number(row.result_home) : null,
      resultOpp: row.result_opp != null ? Number(row.result_opp) : null,
      firstServer: row.first_server ?? '',
      players: playersPayload.roster,
      legacyPlayers: playersPayload.legacyRoster || null,
      sets: normalizeMatchSets(metadata.sets),
      finalizedSets: metadata.finalizedSets,
      _deleted: Boolean(deleted)
    };
  }

  function stripInternalMatch(match) {
    if (!match) return null;
    const { _deleted, ...rest } = match;
    return rest;
  }

  async function getRawMatch(id) {
    if (id === undefined || id === null) return null;
    return await request(`/api/match/get/${id}`);
  }

  async function getRawMatches() {
    const data = await request('/api/match');
    return Array.isArray(data) ? data : [];
  }

  async function getNormalizedMatches() {
    const rows = await getRawMatches();
    return rows.map(parseMatchRow);
  }

  async function updateMatchInternal(id, match) {
    const { body } = prepareMatchForStorage(match);
    await request('/api/match/set-date-time', { method: 'POST', body: { matchId: id, date: body.date } });
    await request('/api/match/set-location', { method: 'POST', body: { matchId: id, location: body.location } });
    await request('/api/match/set-type', { method: 'POST', body: { matchId: id, types: body.types } });
    await request('/api/match/set-opp-name', { method: 'POST', body: { matchId: id, opponent: body.opponent } });
    await request('/api/match/set-result', { method: 'POST', body: { matchId: id, resultHome: body.result_home, resultOpp: body.result_opp } });
    await request('/api/match/set-players', { method: 'POST', body: { matchId: id, players: body.players } });
    await request('/api/match/set-home-color', { method: 'POST', body: { matchId: id, jerseyColorHome: body.jersey_color_home } });
    await request('/api/match/set-opp-color', { method: 'POST', body: { matchId: id, jerseyColorOpp: body.jersey_color_opp } });
    await request('/api/match/set-first-server', { method: 'POST', body: { matchId: id, firstServer: body.first_server } });
    await request('/api/match/set-deleted', { method: 'POST', body: { matchId: id, deleted: body.deleted } });
    return { id };
  }

  function findMatchById(matches, id) {
    const numericId = Number(id);
    return matches.find(match => {
      const matchId = Number(match.id);
      if (!Number.isNaN(numericId) && !Number.isNaN(matchId)) {
        return matchId === numericId;
      }
      return match.id === id;
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      __test__: {
        parseMatchPlayers,
        serializeMatchPlayers,
        parseMatchMetadata,
        serializeMatchMetadata,
        parseMatchRow,
        prepareMatchForStorage
      }
    };
  }

  return {
    async getPlayers() {
      const rows = await request('/api/player');
      const normalized = Array.isArray(rows) ? rows.map(normalizePlayerRecord).filter(Boolean) : [];
      return normalized;
    },

    async createPlayer(player) {
      const payload = {
        number: String(player.number ?? '').trim(),
        last_name: String(player.lastName ?? '').trim(),
        initial: serializePlayerInitial(player.initial ?? '')
      };
      return await request('/api/player/create', { method: 'POST', body: payload });
    },

    async updatePlayer(id, player) {
      await request('/api/player/set-number', { method: 'POST', body: { playerId: id, number: String(player.number ?? '').trim() } });
      await request('/api/player/set-lname', { method: 'POST', body: { playerId: id, lastName: String(player.lastName ?? '').trim() } });
      await request('/api/player/set-fname', { method: 'POST', body: { playerId: id, initial: serializePlayerInitial(player.initial ?? '') } });
      return { id };
    },

    async deletePlayer(id) {
      await request(`/api/player/delete/${id}`, { method: 'DELETE' });
      return { id };
    },

    async listMatches() {
      const matches = await getNormalizedMatches();
      return matches.filter(match => !match._deleted).map(stripInternalMatch);
    },

    async getMatch(id, { includeDeleted = false } = {}) {
      const rawMatch = await getRawMatch(id);
      if (!rawMatch) return null;
      const match = parseMatchRow(rawMatch);
      if (match._deleted && !includeDeleted) return null;
      const stripped = stripInternalMatch(match) || {};
      const numericId = Number(match.id);
      if (!Number.isNaN(numericId)) {
        stripped.id = numericId;
        try {
          const setRows = await this.getMatchSets(numericId);
          const normalizedSets = normalizeMatchSets(setRows);
          if (Object.keys(normalizedSets).length > 0) {
            stripped.sets = normalizedSets;
          }
        } catch (error) {
          console.error(`Failed to load sets for match ${numericId}`, error);
        }
      }
      return stripped;
    },

    async createMatch(match) {
      const { body } = prepareMatchForStorage(match);
      return await request('/api/match/create', { method: 'POST', body });
    },

    async updateMatch(id, match) {
      return await updateMatchInternal(id, match);
    },

    prepareMatchPayload(match) {
      return prepareMatchForStorage(match);
    },

    async getMatchSets(matchId) {
      if (matchId === undefined || matchId === null) return [];
      const response = await request(`/api/set?matchId=${matchId}`);
      return Array.isArray(response) ? response : [];
    },

    async createSet(payload) {
      return await request('/api/set/create', { method: 'POST', body: payload });
    },

    async updateSetScore(setId, team, score) {
      if (team === 'home') {
        return await request('/api/set/set-home-score', { method: 'POST', body: { setId, homeScore: score } });
      }
      return await request('/api/set/set-opp-score', { method: 'POST', body: { setId, oppScore: score } });
    },

    async updateSetTimeout(setId, team, timeoutNumber, value) {
      const payload = { setId, timeoutNumber, value };
      if (team === 'home') {
        return await request('/api/set/set-home-timeout', { method: 'POST', body: payload });
      }
      return await request('/api/set/set-opp-timeout', { method: 'POST', body: payload });
    },

    async deleteSet(setId) {
      return await request(`/api/set/delete/${setId}`, { method: 'DELETE' });
    },

    async updateFinalizedSets(matchId, finalizedSets) {
      return await request('/api/set/set-is-final', { method: 'POST', body: { matchId, finalizedSets } });
    },

    async deleteMatch(id) {
      await request(`/api/match/delete/${id}`, { method: 'DELETE' });
      return { id };
    }
  };
})();
