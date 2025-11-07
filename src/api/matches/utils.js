const TIMEOUT_COUNT = 2;
const MATCH_TYPE_MIN = 0;
const MATCH_TYPE_MAX = 4;

const parseMatchType = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return MATCH_TYPE_MIN;
  }
  if (parsed < MATCH_TYPE_MIN || parsed > MATCH_TYPE_MAX) {
    return MATCH_TYPE_MIN;
  }
  return parsed;
};

export function normalizeMatchPayload(input = {}) {
  const coercePlayers = (players) =>
    Array.isArray(players)
      ? players.map((player) => String(player ?? '').trim()).filter(Boolean)
      : [];

  const coerceTime = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  };

  const normalizeTimeoutArray = (value) => {
    const normalized = Array(TIMEOUT_COUNT).fill(false);
    const coerce = (raw) => {
      if (typeof raw === 'string') {
        const normalizedValue = raw.trim().toLowerCase();
        if (normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'yes') {
          return true;
        }
        if (
          normalizedValue === 'false' ||
          normalizedValue === '0' ||
          normalizedValue === 'no' ||
          normalizedValue === ''
        ) {
          return false;
        }
      }
      if (typeof raw === 'number') {
        return raw !== 0;
      }
      return Boolean(raw);
    };
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, TIMEOUT_COUNT); i++) {
        normalized[i] = coerce(value[i]);
      }
    } else if (value && typeof value === 'object') {
      for (let i = 0; i < TIMEOUT_COUNT; i++) {
        if (value[i] !== undefined) {
          normalized[i] = coerce(value[i]);
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
        home: normalizeScore(set.home),
        opp: normalizeScore(set.opp),
        timeouts: {
          home: normalizeTimeoutArray(timeoutSource.home),
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
    time: coerceTime(input.time),
    location: input.location ? String(input.location) : '',
    type: parseMatchType(input.type),
    opponent: input.opponent ? String(input.opponent) : '',
    jerseyColorHome: input.jerseyColorHome ? String(input.jerseyColorHome) : '',
    jerseyColorOpp: input.jerseyColorOpp ? String(input.jerseyColorOpp) : '',
    resultHome: toIntegerOrNull(input.resultHome),
    resultOpp: toIntegerOrNull(input.resultOpp),
    firstServer: input.firstServer ? String(input.firstServer) : '',
    players: coercePlayers(input.players),
    sets: coerceSets(input.sets),
    finalizedSets: coerceFinalized(input.finalizedSets),
    isSwapped: Boolean(input.isSwapped)
  };
}

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
    type: parseMatchType(row.type),
    opponent: row.opponent ?? '',
    jerseyColorHome: row.jersey_home ?? '',
    jerseyColorOpp: row.jersey_opp ?? '',
    resultHome: row.result_home,
    resultOpp: row.result_opp,
    firstServer: row.first_server ?? '',
    players: parseJson(row.players_appeared, []),
    sets: parseJson(row.sets, {}),
    finalizedSets: parseJson(row.finalized_sets, {}),
    isSwapped: Boolean(row.is_swapped)
  };
}
