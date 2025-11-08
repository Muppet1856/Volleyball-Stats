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

  const toTimeoutBoolean = (raw) => {
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === '') {
        return false;
      }
    }
    if (typeof raw === 'number') {
      return raw !== 0;
    }
    return Boolean(raw);
  };

  const normalizeTimeoutArray = (value) => {
    const normalized = Array(TIMEOUT_COUNT).fill(false);
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, TIMEOUT_COUNT); i++) {
        normalized[i] = toTimeoutBoolean(value[i]);
      }
    } else if (value && typeof value === 'object') {
      for (let i = 0; i < TIMEOUT_COUNT; i++) {
        if (value[i] !== undefined) {
          normalized[i] = toTimeoutBoolean(value[i]);
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
    location: input.location ? String(input.location) : '',
    types: coerceTypes(input.types),
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

const DEFAULT_TYPES = {
  tournament: false,
  league: false,
  postSeason: false,
  nonLeague: false
};

const createEmptySet = () => ({
  home: '',
  opp: '',
  timeouts: {
    home: [false, false],
    opp: [false, false]
  }
});

const ensureBooleanArray = (value = [], length = 2) => {
  const normalized = Array(length).fill(false);
  for (let i = 0; i < length; i++) {
    normalized[i] = Boolean(value[i]);
  }
  return normalized;
};

export function deserializeMatchRow(record = {}) {
  const normalized = normalizeMatchPayload(record);

  const sets = {};
  for (let i = 1; i <= 5; i++) {
    const source = normalized.sets?.[i] ?? createEmptySet();
    sets[i] = {
      home: source.home ?? '',
      opp: source.opp ?? '',
      timeouts: {
        home: ensureBooleanArray(source.timeouts?.home),
        opp: ensureBooleanArray(source.timeouts?.opp)
      }
    };
  }

  return {
    id: record.id,
    date: normalized.date ?? '',
    location: normalized.location ?? '',
    types: {
      ...DEFAULT_TYPES,
      ...(normalized.types ?? {})
    },
    opponent: normalized.opponent ?? '',
    jerseyColorHome: normalized.jerseyColorHome ?? '',
    jerseyColorOpp: normalized.jerseyColorOpp ?? '',
    resultHome: normalized.resultHome ?? null,
    resultOpp: normalized.resultOpp ?? null,
    firstServer: normalized.firstServer ?? '',
    players: Array.isArray(normalized.players)
      ? [...normalized.players]
      : [],
    sets,
    finalizedSets:
      normalized.finalizedSets && typeof normalized.finalizedSets === 'object'
        ? { ...normalized.finalizedSets }
        : {},
    isSwapped: Boolean(normalized.isSwapped)
  };
}
