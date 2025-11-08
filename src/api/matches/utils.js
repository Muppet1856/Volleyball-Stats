const SET_COUNT = 5;
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
    for (let i = 1; i <= SET_COUNT; i++) {
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
        const index = Number(key);
        if (Number.isInteger(index) && index >= 1 && index <= SET_COUNT) {
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

const createEmptyTimeoutArray = () => Array(TIMEOUT_COUNT).fill(false);

const createEmptySet = () => ({
  sc: '',
  opp: '',
  timeouts: {
    sc: createEmptyTimeoutArray(),
    opp: createEmptyTimeoutArray()
  }
});

export function serializeMatchSets(sets = {}, finalizedSets = {}) {
  const rows = [];
  for (let i = 1; i <= SET_COUNT; i++) {
    const set = sets[i] ?? sets[String(i)] ?? {};
    const timeouts = set.timeouts ?? {};
    const scTimeouts = Array.isArray(timeouts.sc) ? timeouts.sc : [];
    const oppTimeouts = Array.isArray(timeouts.opp) ? timeouts.opp : [];
    const finalizedValue = finalizedSets[i] ?? finalizedSets[String(i)];
    rows.push({
      setNumber: i,
      scScore: set.sc ?? '',
      oppScore: set.opp ?? '',
      scTimeout1: scTimeouts[0] ? 1 : 0,
      scTimeout2: scTimeouts[1] ? 1 : 0,
      oppTimeout1: oppTimeouts[0] ? 1 : 0,
      oppTimeout2: oppTimeouts[1] ? 1 : 0,
      finalized:
        finalizedValue === undefined || finalizedValue === null
          ? null
          : finalizedValue
          ? 1
          : 0
    });
  }
  return rows;
}

export function deserializeMatchSets(rows = []) {
  const sets = {};
  for (let i = 1; i <= SET_COUNT; i++) {
    sets[i] = createEmptySet();
  }

  const finalizedSets = {};

  for (const row of rows) {
    const index = Number(row.set_number ?? row.setNumber);
    if (!Number.isInteger(index) || index < 1 || index > SET_COUNT) {
      continue;
    }
    const target = sets[index];
    target.sc = row.sc_score ?? row.scScore ?? '';
    target.opp = row.opp_score ?? row.oppScore ?? '';
    target.timeouts = {
      sc: [Boolean(row.sc_timeout_1 ?? row.scTimeout1), Boolean(row.sc_timeout_2 ?? row.scTimeout2)],
      opp: [Boolean(row.opp_timeout_1 ?? row.oppTimeout1), Boolean(row.opp_timeout_2 ?? row.oppTimeout2)]
    };

    const finalized = row.finalized ?? null;
    if (finalized !== null && finalized !== undefined) {
      finalizedSets[index] = Boolean(finalized);
    }
  }

  return { sets, finalizedSets };
}

export function deserializeMatchRow(row, setRows = []) {
  const { sets, finalizedSets } = deserializeMatchSets(setRows);
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
    sets,
    finalizedSets,
    isSwapped: Boolean(row.is_swapped)
  };
}
