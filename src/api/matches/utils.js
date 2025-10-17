const TIMEOUT_COUNT = 2;

export function normalizeMatchPayload(input = {}) {
  const coerceTypes = (types = {}) => ({
    tournament: Boolean(types.tournament),
    league: Boolean(types.league),
    postSeason: Boolean(types.postSeason),
    nonLeague: Boolean(types.nonLeague)
  });

  const coercePlayers = (players) =>
    Array.isArray(players)
      ? players.map((player) => String(player ?? '').trim()).filter(Boolean)
      : [];

  const normalizeTimeoutArray = (value) => {
    const normalized = Array(TIMEOUT_COUNT).fill(false);
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, TIMEOUT_COUNT); i++) {
        normalized[i] = Boolean(value[i]);
      }
    } else if (value && typeof value === 'object') {
      for (let i = 0; i < TIMEOUT_COUNT; i++) {
        if (value[i] !== undefined) {
          normalized[i] = Boolean(value[i]);
        }
      }
    }
    return normalized;
  };

  const coerceSets = (sets = {}) => {
    const normalized = {};
    for (let i = 1; i <= 5; i++) {
      const set = sets[i] ?? sets[String(i)] ?? {};
      const normalizeScore = (value) => {
        if (value === null || value === undefined) return '';
        return String(value).trim();
      };
      const timeoutSource = set.timeouts ?? {};
      normalized[i] = {
        sc: normalizeScore(set.sc),
        opp: normalizeScore(set.opp),
        timeouts: {
          sc: normalizeTimeoutArray(timeoutSource.sc),
          opp: normalizeTimeoutArray(timeoutSource.opp)
        }
      };
    }
    return normalized;
  };

  const coerceFinalized = (finalized = {}) => {
    const normalized = {};
    if (finalized && typeof finalized === 'object') {
      for (const key of Object.keys(finalized)) {
        if ([1, 2, 3, 4, 5].includes(Number(key))) {
          normalized[key] = Boolean(finalized[key]);
        }
      }
    }
    return normalized;
  };

  const toIntegerOrNull = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return {
    date: input.date ? String(input.date) : '',
    location: input.location ? String(input.location) : '',
    types: coerceTypes(input.types),
    opponent: input.opponent ? String(input.opponent) : '',
    jerseyColorSC: input.jerseyColorSC ? String(input.jerseyColorSC) : '',
    jerseyColorOpp: input.jerseyColorOpp ? String(input.jerseyColorOpp) : '',
    resultSC: toIntegerOrNull(input.resultSC),
    resultOpp: toIntegerOrNull(input.resultOpp),
    firstServer: input.firstServer ? String(input.firstServer) : '',
    players: coercePlayers(input.players),
    sets: coerceSets(input.sets),
    finalizedSets: coerceFinalized(input.finalizedSets),
    isSwapped: Boolean(input.isSwapped)
  };
}

const DEFAULT_TYPES = {
  tournament: false,
  league: false,
  postSeason: false,
  nonLeague: false
};

const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

export function deserializeMatchRow(row) {
  return {
    id: row.id,
    date: row.date ?? '',
    location: row.location ?? '',
    types: {
      ...DEFAULT_TYPES,
      ...parseJson(row.types, DEFAULT_TYPES)
    },
    opponent: row.opponent ?? '',
    jerseyColorSC: row.jersey_color_sc ?? '',
    jerseyColorOpp: row.jersey_color_opp ?? '',
    resultSC: row.result_sc,
    resultOpp: row.result_opp,
    firstServer: row.first_server ?? '',
    players: parseJson(row.players, []),
    sets: parseJson(row.sets, {}),
    finalizedSets: parseJson(row.finalized_sets, {}),
    isSwapped: Boolean(row.is_swapped)
  };
}
