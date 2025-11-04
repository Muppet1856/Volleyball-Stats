const DEFAULT_JERSEYS = { home: '', away: '' };
const DEFAULT_MATCH_SCORE = { home: 0, away: 0 };

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
    opponent: row.opponent ?? '',
    date: row.date ?? '',
    time: row.time ?? '',
    jerseys: {
      ...DEFAULT_JERSEYS,
      ...parseJson(row.jerseys, DEFAULT_JERSEYS)
    },
    whoServedFirst: row.who_served_first ?? '',
    playersAppeared: parseJson(row.players_appeared, []),
    location: row.location ?? '',
    type: row.type ?? '',
    matchScore: {
      ...DEFAULT_MATCH_SCORE,
      ...parseJson(row.match_score, DEFAULT_MATCH_SCORE)
    },
    createdAt: row.created_at ?? null
  };
}

const normalizeString = (value) => (value === null || value === undefined ? '' : String(value).trim());

const normalizeJerseys = (value) => {
  if (!value) {
    return { ...DEFAULT_JERSEYS };
  }
  if (typeof value === 'string') {
    const parsed = parseJson(value, DEFAULT_JERSEYS);
    return normalizeJerseys(parsed);
  }
  if (typeof value === 'object') {
    return {
      home: normalizeString(value.home ?? value.sc ?? value.homeTeam),
      away: normalizeString(value.away ?? value.opp ?? value.awayTeam)
    };
  }
  return { ...DEFAULT_JERSEYS };
};

const normalizePlayersAppeared = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set();
  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (normalized) {
      deduped.add(normalized);
    }
  }
  return Array.from(deduped);
};

const normalizeMatchType = (value) => normalizeString(value);

const normalizeMatchScore = (value) => {
  if (!value) {
    return { ...DEFAULT_MATCH_SCORE };
  }
  if (typeof value === 'string') {
    const parsed = parseJson(value, DEFAULT_MATCH_SCORE);
    return normalizeMatchScore(parsed);
  }
  const toNumber = (input) => {
    const parsed = Number.parseInt(input, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return {
    home: toNumber(value.home ?? value.sc ?? value.homeTeam),
    away: toNumber(value.away ?? value.opp ?? value.awayTeam)
  };
};

export function normalizeMatchPayload(input = {}) {
  return {
    opponent: normalizeString(input.opponent),
    date: normalizeString(input.date),
    time: normalizeString(input.time),
    jerseys: normalizeJerseys(input.jerseys),
    whoServedFirst: normalizeString(input.whoServedFirst ?? input.who_served_first),
    playersAppeared: normalizePlayersAppeared(input.playersAppeared ?? input.players_appeared),
    location: normalizeString(input.location),
    type: normalizeMatchType(input.type),
    matchScore: normalizeMatchScore(input.matchScore ?? input.match_score)
  };
}
