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

const EMPTY_TIMEOUTS = () => ({ home: [false, false], opp: [false, false] });

const createEmptySet = () => ({ home: '', opp: '', timeouts: EMPTY_TIMEOUTS() });

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

const toIntegerOrNull = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const toScoreString = (value) =>
  value === null || value === undefined || value === ''
    ? ''
    : String(value);

const toTimeoutBoolean = (value) => {
  if (value === 1 || value === true) {
    return true;
  }
  if (value === 0 || value === false) {
    return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
      return true;
    }
    if (
      normalized === '0' ||
      normalized === 'false' ||
      normalized === 'no' ||
      normalized === ''
    ) {
      return false;
    }
  }
  return Boolean(value);
};

const toTimeoutBit = (value) => (toTimeoutBoolean(value) ? 1 : 0);

export function mapMatchPayloadToRow(payload) {
  return {
    date: payload.date,
    location: payload.location,
    types: JSON.stringify(payload.types),
    opponent: payload.opponent,
    jersey_color_home: payload.jerseyColorHome,
    jersey_color_opp: payload.jerseyColorOpp,
    result_home: payload.resultHome,
    result_opp: payload.resultOpp,
    first_server: payload.firstServer,
    players: JSON.stringify(payload.players),
    finalized_sets: JSON.stringify(payload.finalizedSets),
    is_swapped: payload.isSwapped ? 1 : 0
  };
}

export function mapMatchSetsToRows(matchId, sets = {}) {
  const rows = [];
  for (let i = 1; i <= 5; i++) {
    const set = sets[i] ?? sets[String(i)] ?? createEmptySet();
    const timeouts = set.timeouts ?? {};
    const homeTimeouts = Array.isArray(timeouts.home)
      ? timeouts.home
      : EMPTY_TIMEOUTS().home;
    const oppTimeouts = Array.isArray(timeouts.opp)
      ? timeouts.opp
      : EMPTY_TIMEOUTS().opp;

    rows.push({
      matchId,
      setNumber: i,
      homeScore: toIntegerOrNull(set.home),
      oppScore: toIntegerOrNull(set.opp),
      homeTimeout1: toTimeoutBit(homeTimeouts[0]),
      homeTimeout2: toTimeoutBit(homeTimeouts[1]),
      oppTimeout1: toTimeoutBit(oppTimeouts[0]),
      oppTimeout2: toTimeoutBit(oppTimeouts[1])
    });
  }
  return rows;
}

export function hydrateMatchSets(setRows = []) {
  const hydrated = {};
  for (let i = 1; i <= 5; i++) {
    hydrated[i] = createEmptySet();
  }

  for (const row of setRows) {
    const setNumber = row.set_number ?? row.setNumber;
    if (!setNumber || setNumber < 1 || setNumber > 5) {
      continue;
    }
    hydrated[setNumber] = {
      home: toScoreString(row.home_score ?? row.homeScore ?? ''),
      opp: toScoreString(row.opp_score ?? row.oppScore ?? ''),
      timeouts: {
        home: [
          Boolean(toTimeoutBoolean(row.home_timeout_1 ?? row.homeTimeout1)),
          Boolean(toTimeoutBoolean(row.home_timeout_2 ?? row.homeTimeout2))
        ],
        opp: [
          Boolean(toTimeoutBoolean(row.opp_timeout_1 ?? row.oppTimeout1)),
          Boolean(toTimeoutBoolean(row.opp_timeout_2 ?? row.oppTimeout2))
        ]
      }
    };
  }

  return hydrated;
}

export function deserializeMatchRow(row, setRows = []) {
  return {
    id: row.id,
    date: row.date ?? '',
    location: row.location ?? '',
    types: {
      ...DEFAULT_TYPES,
      ...parseJson(row.types, DEFAULT_TYPES)
    },
    opponent: row.opponent ?? '',
    jerseyColorHome: row.jersey_color_home ?? '',
    jerseyColorOpp: row.jersey_color_opp ?? '',
    resultHome: row.result_home,
    resultOpp: row.result_opp,
    firstServer: row.first_server ?? '',
    players: parseJson(row.players, []),
    sets: hydrateMatchSets(setRows),
    finalizedSets: parseJson(row.finalized_sets, {}),
    isSwapped: Boolean(row.is_swapped)
  };
}
