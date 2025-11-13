// public/js/volleyball_stats.js
var gk_isXlsx = false;
var gk_xlsxFileLookup = {};
var gk_fileData = {};

const HOME_TEAM_FALLBACK = 'Home Team';
const HOME_TEAM_TEMPLATE_PATTERN = /\{homeTeam\}/g;
let homeTeamName = HOME_TEAM_FALLBACK;

function getHomeTeamName() {
  return homeTeamName || HOME_TEAM_FALLBACK;
}

function applyHomeTeamTemplates(homeName) {
  document.querySelectorAll('[data-home-team-template]').forEach((element) => {
    const template = element.getAttribute('data-home-team-template');
    if (typeof template === 'string') {
      element.textContent = template.replace(HOME_TEAM_TEMPLATE_PATTERN, () => homeName);
    }
  });
}

async function initializeHomeTeam() {
  let configuredName = '';
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const data = await response.json();
      const candidate = typeof data?.homeTeam === 'string' ? data.homeTeam.trim() : '';
      if (candidate) {
        configuredName = candidate;
      }
    }
  } catch (error) {
    console.warn('Unable to load home team configuration', error);
  }
  homeTeamName = configuredName || HOME_TEAM_FALLBACK;
  updateHomeTeamUI();
}

function updateHomeTeamUI() {
  const homeName = getHomeTeamName();
  applyHomeTeamTemplates(homeName);
  if (typeof updateOpponentName === 'function') {
    updateOpponentName();
  }
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
        home: normalizeStoredScoreValue(data?.home ?? null),
        opp: normalizeStoredScoreValue(data?.opp ?? null),
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
      const roster = normalizeRosterArray(parsedValue.roster);
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
    const roster = normalizeRosterArray(match?.players);
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
      const matches = await getNormalizedMatches();
      const match = findMatchById(matches, id);
      if (!match) return null;
      if (match._deleted && !includeDeleted) return null;
      const stripped = stripInternalMatch(match) || {};
      const numericId = Number(match.id);
      if (!Number.isNaN(numericId)) {
        stripped.id = numericId;
        try {
          const setRows = await this.getMatchSets(numericId);
          const normalizedSets = normalizeMatchSets(setRows);
          if (normalizedSets && Object.keys(normalizedSets).length > 0) {
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
      const matches = await getNormalizedMatches();
      const match = findMatchById(matches, id);
      if (!match) return null;
      return await updateMatchInternal(match.id, { ...stripInternalMatch(match), deleted: true });
    }
  };
})();

let playerRecords = [];
let players = [];
let playerSortMode = 'number';
const temporaryPlayerNumbers = new Map();
let pendingTemporaryPlayer = null;

function normalizePlayerId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function normalizeRosterEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const playerId = normalizePlayerId(
    entry.playerId ?? entry.id ?? entry.player_id ?? entry.player ?? null
  );
  if (playerId === null) {
    return null;
  }
  const rawTemp = entry.tempNumber ?? entry.temp_number ?? entry.temp ?? null;
  const tempString = rawTemp === null || rawTemp === undefined ? '' : String(rawTemp).trim();
  const normalized = { playerId };
  if (tempString) {
    normalized.tempNumber = tempString;
  }
  return normalized;
}

function normalizeRosterArray(roster) {
  if (!Array.isArray(roster)) {
    return [];
  }
  const seen = new Set();
  const normalizedRoster = [];
  roster.forEach(entry => {
    const normalized = normalizeRosterEntry(entry);
    if (!normalized) {
      return;
    }
    if (seen.has(normalized.playerId)) {
      const existingIndex = normalizedRoster.findIndex(
        candidate => candidate.playerId === normalized.playerId
      );
      if (existingIndex !== -1 && normalized.tempNumber) {
        normalizedRoster[existingIndex] = normalized;
      }
      return;
    }
    seen.add(normalized.playerId);
    normalizedRoster.push(normalized);
  });
  return normalizedRoster;
}
    let finalizedSets = {};
    let isSwapped = false;
    let editingPlayerId = null;
    let loadedMatchPlayers = [];
    let autoSaveTimeout = null;
    let autoSaveStatusTimeout = null;
    let suppressAutoSave = true;
    let currentMatchId = null;
    let hasPendingChanges = false;
    let openJerseySelectInstance = null;
    let scoreGameModalInstance = null;
    let jerseyConflictModalInstance = null;
    let jerseyConflictModalMessageElement = null;
    let jerseyThemeObserver = null;
    let isResolvingJerseyColorConflict = false;
    const SCORE_MODAL_FULLSCREEN_HEIGHT = 500;
    const TIMEOUT_COUNT = 2;
    const TIMEOUT_DURATION_SECONDS = 60;
    const SET_NUMBERS = [1, 2, 3, 4, 5];
    const matchSetRecords = new Map();
    const scoreGameState = {
      setNumber: null,
      home: null,
      opp: null,
      timeouts: {
        home: Array(TIMEOUT_COUNT).fill(false),
        opp: Array(TIMEOUT_COUNT).fill(false)
      },
      activeTimeout: { home: null, opp: null },
      timeoutTimers: { home: null, opp: null },
      timeoutRemainingSeconds: {
        home: TIMEOUT_DURATION_SECONDS,
        opp: TIMEOUT_DURATION_SECONDS
      }
    };
    let matchTimeouts = createEmptyMatchTimeouts();
    const finalizePopoverTimers = new WeakMap();
    const finalizedStatePopoverTimers = new WeakMap();
    const finalizedPopoverWrappers = new WeakMap();
    const FINALIZE_TIE_POPOVER_TITLE = 'Scores tied';
    const FINALIZE_TIE_POPOVER_MESSAGE = 'Set scores are tied. Adjust one team\'s score before marking the set final.';
    const FINALIZE_MISSING_POPOVER_TITLE = 'Scores missing';
    const FINALIZE_MISSING_POPOVER_MESSAGE = 'Enter both scores before finalizing the set.';
    const FINALIZED_SET_POPOVER_TITLE = 'Score finalized';
    const FINALIZED_SET_POPOVER_MESSAGE = 'This set\'s score is finalized. Toggle the final status to make changes.';
    const FINALIZE_POPOVER_CONFIG = {
      tie: {
        title: FINALIZE_TIE_POPOVER_TITLE,
        content: FINALIZE_TIE_POPOVER_MESSAGE,
        customClass: 'finalize-error-popover'
      },
      missing: {
        title: FINALIZE_MISSING_POPOVER_TITLE,
        content: FINALIZE_MISSING_POPOVER_MESSAGE,
        customClass: 'finalize-error-popover'
      },
      finalized: {
        title: FINALIZED_SET_POPOVER_TITLE,
        content: FINALIZED_SET_POPOVER_MESSAGE,
        customClass: 'finalize-final-popover'
      }
    };
    const SCORE_FINALIZED_BACKGROUND_BLEND = 0.5;
    const SCORE_FINALIZED_TEXT_BLEND = 0.35;
    const SCORE_FINALIZED_GRAY_COLOR = { r: 173, g: 181, b: 189, a: 1 };

    function getScoreGameModalDialog() {
      const modalElement = document.getElementById('scoreGameModal');
      if (!modalElement) return null;
      return modalElement.querySelector('.modal-dialog');
    }

    function updateScoreGameModalLayout() {
      const dialog = getScoreGameModalDialog();
      if (!dialog) return;
      const shouldFullscreen = window.innerHeight < SCORE_MODAL_FULLSCREEN_HEIGHT;
      if (shouldFullscreen) {
        dialog.classList.add('modal-fullscreen', 'modal-dialog-scrollable');
        dialog.classList.remove('modal-lg', 'modal-dialog-centered');
      } else {
        dialog.classList.add('modal-lg', 'modal-dialog-centered');
        dialog.classList.remove('modal-fullscreen', 'modal-dialog-scrollable');
      }
    }

    function setScoreModalBackgroundLock(isLocked) {
      const className = 'score-modal-open';
      [document.body, document.documentElement].forEach(element => {
        if (!element) return;
        if (isLocked) {
          element.classList.add(className);
        } else {
          element.classList.remove(className);
        }
      });
    }
    function formatLegacyPlayerRecord(player) {
      const number = String(player.number ?? '').trim();
      const lastName = String(player.lastName ?? '').trim();
      const initial = String(player.initial ?? '').trim();
      return [number, lastName, initial].filter(Boolean).join(' ');
    }

    function getPlayerDisplayData(player) {
      if (!player) {
        return { id: null, number: '', tempNumber: '', lastName: '', initial: '' };
      }
      const id = normalizePlayerId(player.id);
      const number = String(player.number ?? '').trim();
      const lastName = String(player.lastName ?? '').trim();
      const initial = String(player.initial ?? '').trim();
      let tempNumber = '';
      if (id !== null && temporaryPlayerNumbers.has(id)) {
        const rawTemp = temporaryPlayerNumbers.get(id);
        if (rawTemp !== null && rawTemp !== undefined) {
          tempNumber = String(rawTemp).trim();
        }
      }
      return { id, number, tempNumber, lastName, initial };
    }

    function formatPlayerRecord(player) {
      const { number, tempNumber, lastName, initial } = getPlayerDisplayData(player);
      const displayNumber = tempNumber || number;
      const nameText = [lastName, initial].filter(Boolean).join(' ');
      return [displayNumber, nameText].filter(Boolean).join(' ');
    }


    function getSortablePlayerNumber(player) {
      const { number, tempNumber } = getPlayerDisplayData(player);
      const rawValue = (tempNumber || number || '').trim();
      const numericValue = parseInt(rawValue, 10);
      return {
        rawValue,
        numericValue,
        hasNumericValue: !Number.isNaN(numericValue)
      };
    }

    function comparePlayersByNumber(a, b) {
      const numberA = getSortablePlayerNumber(a);
      const numberB = getSortablePlayerNumber(b);
      if (numberA.hasNumericValue && numberB.hasNumericValue && numberA.numericValue !== numberB.numericValue) {
        return numberA.numericValue - numberB.numericValue;
      }
      if (numberA.hasNumericValue && !numberB.hasNumericValue) {
        return -1;
      }
      if (!numberA.hasNumericValue && numberB.hasNumericValue) {
        return 1;
      }
      const nameA = formatPlayerRecord(a);
      const nameB = formatPlayerRecord(b);
      if (numberA.rawValue && numberB.rawValue && numberA.rawValue !== numberB.rawValue) {
        return numberA.rawValue.localeCompare(numberB.rawValue, undefined, { sensitivity: 'base' });
      }
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    }

    function comparePlayersByName(a, b) {
      const lastA = String(a.lastName ?? '').trim().toLocaleLowerCase();
      const lastB = String(b.lastName ?? '').trim().toLocaleLowerCase();
      if (lastA !== lastB) {
        return lastA.localeCompare(lastB, undefined, { sensitivity: 'base' });
      }
      const firstA = String(a.initial ?? '').trim().toLocaleLowerCase();
      const firstB = String(b.initial ?? '').trim().toLocaleLowerCase();
      if (firstA !== firstB) {
        return firstA.localeCompare(firstB, undefined, { sensitivity: 'base' });
      }
      return comparePlayersByNumber(a, b);
    }

    function sortPlayerRecords(records) {
      const comparer = playerSortMode === 'name' ? comparePlayersByName : comparePlayersByNumber;
      return records.slice().sort(comparer);
    }

    function updatePlayerSortToggle() {
      const button = document.getElementById('playerSortToggleBtn');
      if (!button) return;
      const isNameSort = playerSortMode === 'name';
      button.textContent = `Sort: ${isNameSort ? 'Name' : 'Number'}`;
      button.setAttribute('aria-pressed', String(isNameSort));
      const description = isNameSort
        ? 'Sorted alphabetically by last name, then first initial and number.'
        : 'Sorted numerically by jersey number.';
      button.setAttribute('title', description);
    }

    function updateModalPlayerSortSelect() {
      const select = document.getElementById('modalPlayerSortSelect');
      if (!select) return;
      if (select.value !== playerSortMode) {
        select.value = playerSortMode;
      }
    }

    function setPlayerSortMode(mode) {
      const normalized = mode === 'name' ? 'name' : 'number';
      if (playerSortMode === normalized) {
        updatePlayerSortToggle();
        updateModalPlayerSortSelect();
        return;
      }
      playerSortMode = normalized;
      setPlayerRecords(playerRecords);
    }

    function setPlayerRecords(records) {
      const safeRecords = Array.isArray(records) ? records : [];
      const sortedRecords = sortPlayerRecords(safeRecords);
      playerRecords = sortedRecords;
      players = sortedRecords.map(getPlayerDisplayData);
      const validIds = new Set(sortedRecords.map(record => normalizePlayerId(record.id)).filter(id => id !== null));
      Array.from(temporaryPlayerNumbers.keys()).forEach(playerId => {
        if (!validIds.has(playerId)) {
          temporaryPlayerNumbers.delete(playerId);
        }
      });
      if (pendingTemporaryPlayer) {
        const {
          number: pendingNumber,
          lastName: pendingLastName,
          initial: pendingInitial,
          value: pendingValue
        } = pendingTemporaryPlayer;
        const normalizedNumber = String(pendingNumber ?? '').trim();
        const normalizedLast = String(pendingLastName ?? '').trim().toLocaleLowerCase();
        const normalizedInitial = String(pendingInitial ?? '').trim().toLocaleLowerCase();
        const match = sortedRecords.find(record => {
          const recordId = normalizePlayerId(record.id);
          if (recordId === null) {
            return false;
          }
          const recordNumber = String(record.number ?? '').trim();
          const recordLast = String(record.lastName ?? '').trim().toLocaleLowerCase();
          const recordInitial = String(record.initial ?? '').trim().toLocaleLowerCase();
          return (
            recordNumber === normalizedNumber &&
            recordLast === normalizedLast &&
            recordInitial === normalizedInitial &&
            !temporaryPlayerNumbers.has(recordId)
          );
        });
        if (match) {
          const matchId = normalizePlayerId(match.id);
          if (matchId !== null) {
            if (pendingValue) {
              temporaryPlayerNumbers.set(matchId, pendingValue);
            } else {
              temporaryPlayerNumbers.delete(matchId);
            }
          }
        }
        pendingTemporaryPlayer = null;
      }
      updatePlayerList();
      updateModalPlayerList();
      updatePlayerSortToggle();
      updateModalPlayerSortSelect();
    }

    function togglePlayerSortMode() {
      setPlayerSortMode(playerSortMode === 'number' ? 'name' : 'number');
    }


    async function loadPlayers() {
      try {
        const records = await apiClient.getPlayers();
        setPlayerRecords(Array.isArray(records) ? records.slice() : []);
      } catch (error) {
        console.error('Failed to load players', error);
      }
    }


    
    async function seedDemoPlayersIfEmpty() {
      try {
        const existing = await apiClient.getPlayers();
        if (Array.isArray(existing) && existing.length > 0) {
          return false;
        }
        const demoPlayers = [
          { number: 2, lastName: 'Anderson', initial: 'L' },
          { number: 4, lastName: 'Bennett', initial: 'K' },
          { number: 6, lastName: 'Chen', initial: 'M' },
          { number: 7, lastName: 'Diaz', initial: 'R' },
          { number: 9, lastName: 'Ellis', initial: 'S' },
          { number: 10, lastName: 'Foster', initial: 'J' },
          { number: 12, lastName: 'Garcia', initial: 'T' }
        ];
        for (const player of demoPlayers) {
          await apiClient.createPlayer(player);
        }
        return true;
      } catch (error) {
        console.error('Failed to seed demo players', error);
        throw error;
      }
    }


    function setAutoSaveStatus(message, className = 'text-muted', timeout = 2000) {
      const statusElement = document.getElementById('autoSaveStatus');
      if (!statusElement) return;
      statusElement.textContent = message;
      statusElement.className = message ? className : 'text-muted';
      statusElement.classList.toggle('d-none', !message);
      if (autoSaveStatusTimeout) clearTimeout(autoSaveStatusTimeout);
      if (timeout) {
        autoSaveStatusTimeout = setTimeout(() => {
          statusElement.textContent = '';
          statusElement.className = 'text-muted';
          statusElement.classList.add('d-none');
          autoSaveStatusTimeout = null;
        }, timeout);
      } else {
        autoSaveStatusTimeout = null;
      }
    }

    function scheduleAutoSave() {
      if (suppressAutoSave) return;
      hasPendingChanges = true;
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      setAutoSaveStatus('Saving…', 'text-warning', null);
      autoSaveTimeout = setTimeout(async () => {
        autoSaveTimeout = null;
        try {
          await saveMatch({ showAlert: false });
        } catch (error) {
          // Errors handled within saveMatch
        }
      }, 500);
    }

    function maybeRecalculateFinalResult(target) {
      if (!target || !target.id) return;
      const match = target.id.match(/^set(\d+)(Home|Opp)$/);
      if (!match) return;
      const setNumber = parseInt(match[1], 10);
      if (Number.isNaN(setNumber)) return;

      const editedKey = match[2] === 'Opp' ? 'opp' : 'home';
      const { homeInput, oppInput } = getSetScoreInputs(setNumber);
      if (!homeInput || !oppInput) {
        return;
      }
      const editedInput = editedKey === 'home' ? homeInput : oppInput;
      const isDirectInputEvent = editedInput === target;
      const editedScore = isDirectInputEvent ? parseScoreValue(editedInput.value) : null;
      let didAutoFill = false;
      let shouldUpdateScoreDisplay = false;
      const isScoreModalOpenForSet = scoreGameState.setNumber === setNumber;

      if (isScoreModalOpenForSet && isDirectInputEvent) {
        const currentValue = editedKey === 'home' ? scoreGameState.home : scoreGameState.opp;
        if (currentValue !== editedScore) {
          if (editedKey === 'home') {
            scoreGameState.home = editedScore;
          } else {
            scoreGameState.opp = editedScore;
          }
          shouldUpdateScoreDisplay = true;
        }
      }

      if (isDirectInputEvent && editedScore !== null) {
        const companionKey = editedKey === 'home' ? 'opp' : 'home';
        const companionInput = companionKey === 'home' ? homeInput : oppInput;
        if (companionInput && companionInput.value.trim() === '') {
          const zeroString = formatScoreInputValue(0);
          companionInput.value = zeroString;
          didAutoFill = true;
          if (isScoreModalOpenForSet) {
            const zeroScore = parseScoreValue(zeroString);
            const currentCompanion = companionKey === 'home' ? scoreGameState.home : scoreGameState.opp;
            if (currentCompanion !== zeroScore) {
              if (companionKey === 'home') {
                scoreGameState.home = zeroScore;
              } else {
                scoreGameState.opp = zeroScore;
              }
              shouldUpdateScoreDisplay = true;
            }
          }
        }
      }

      const { finalStateChanged } = updateFinalizeButtonState(setNumber);
      if (didAutoFill || finalizedSets[setNumber] || finalStateChanged) {
        calculateResult();
      }

      if (shouldUpdateScoreDisplay && isScoreModalOpenForSet) {
        updateScoreModalDisplay();
      }
    }

    function clampScoreValue(value) {
      const number = typeof value === 'number' ? value : parseInt(value, 10);
      if (Number.isNaN(number)) return 0;
      return Math.min(99, Math.max(0, number));
    }

    function parseScoreValue(rawValue) {
      if (rawValue === '' || rawValue === null || rawValue === undefined) {
        return null;
      }
      const trimmed = String(rawValue).trim();
      if (!trimmed) return null;
      const parsed = parseInt(trimmed, 10);
      if (Number.isNaN(parsed)) return null;
      return clampScoreValue(parsed);
    }

    function formatScoreInputValue(value) {
      if (value === null || value === undefined || Number.isNaN(value)) {
        return '';
      }
      return clampScoreValue(value).toString();
    }

    function formatScoreDisplay(value) {
      if (value === null || value === undefined || Number.isNaN(value)) {
        return '00';
      }
      return clampScoreValue(value).toString().padStart(2, '0');
    }

    function getSetScoreInputs(setNumber) {
      return {
        homeInput: document.getElementById(`set${setNumber}Home`),
        oppInput: document.getElementById(`set${setNumber}Opp`)
      };
    }

    function syncSetInputsToStoredScores(setNumber, record) {
      const { homeInput, oppInput } = getSetScoreInputs(setNumber);
      const homeValue = record ? record.homeScore : null;
      const oppValue = record ? record.oppScore : null;
      if (homeInput) {
        homeInput.value = formatScoreInputValue(homeValue);
      }
      if (oppInput) {
        oppInput.value = formatScoreInputValue(oppValue);
      }
      if (scoreGameState.setNumber === setNumber) {
        const normalizedHome = homeInput ? parseScoreValue(homeInput.value) : null;
        const normalizedOpp = oppInput ? parseScoreValue(oppInput.value) : null;
        scoreGameState.home = normalizedHome;
        scoreGameState.opp = normalizedOpp;
        updateScoreModalDisplay();
      }
      updateFinalizeButtonState(setNumber);
      calculateResult();
    }

    function normalizeScoreInputValue(rawValue) {
      const parsed = parseScoreValue(rawValue);
      return parsed === null ? '' : clampScoreValue(parsed).toString();
    }

    function normalizeStoredScoreValue(value) {
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'number') {
        return clampScoreValue(value).toString();
      }
      return normalizeScoreInputValue(String(value));
    }

    function clearFinalizePopoverTimer(element) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return;
      const timerId = finalizePopoverTimers.get(host);
      if (timerId) {
        clearTimeout(timerId);
        finalizePopoverTimers.delete(host);
      }
    }

    function clearFinalizedStatePopoverTimer(element) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return;
      const timerId = finalizedStatePopoverTimers.get(host);
      if (timerId) {
        clearTimeout(timerId);
        finalizedStatePopoverTimers.delete(host);
      }
    }

    function ensureFinalizePopover(element, type) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return null;
      const desiredType = type && FINALIZE_POPOVER_CONFIG[type] ? type : 'tie';
      const existingType = host.dataset.finalizePopoverType;
      let popover = bootstrap.Popover.getInstance(host);
      if (!popover || existingType !== desiredType) {
        if (popover) {
          popover.dispose();
        }
        const config = FINALIZE_POPOVER_CONFIG[desiredType];
        popover = new bootstrap.Popover(host, {
          container: 'body',
          trigger: 'manual focus hover',
          placement: 'top',
          title: config.title,
          content: config.content,
          customClass: config.customClass
        });
        host.dataset.finalizePopoverType = desiredType;
      } else {
        const config = FINALIZE_POPOVER_CONFIG[desiredType];
        if (typeof popover.setContent === 'function') {
          popover.setContent({
            '.popover-header': config.title,
            '.popover-body': config.content
          });
        } else {
          host.setAttribute('data-bs-original-title', config.title);
          host.setAttribute('data-bs-content', config.content);
        }
      }
      return popover;
    }

    function showFinalizedStatePopover(element, { focus = false } = {}) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return;
      clearFinalizePopoverTimer(host);
      const popover = ensureFinalizePopover(host, 'finalized');
      if (!popover) return;
      popover.show();
      if (focus) {
        try {
          host.focus({ preventScroll: true });
        } catch (error) {
          host.focus();
        }
      }
      clearFinalizedStatePopoverTimer(host);
      const timerId = setTimeout(() => {
        popover.hide();
        finalizedStatePopoverTimers.delete(host);
      }, 2600);
      finalizedStatePopoverTimers.set(host, timerId);
    }

    function destroyFinalizedStatePopover(element) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return;
      clearFinalizedStatePopoverTimer(host);
      if (host.dataset.finalizePopoverType === 'finalized') {
        const popover = bootstrap.Popover.getInstance(host);
        if (popover) {
          popover.hide();
          popover.dispose();
        }
        delete host.dataset.finalizePopoverType;
      }
    }

    function hideFinalizePopover(element, type) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return;
      clearFinalizePopoverTimer(host);
      if (host.dataset.finalizePopoverType === type) {
        const popover = bootstrap.Popover.getInstance(host);
        if (popover) {
          popover.hide();
          popover.dispose();
        }
        delete host.dataset.finalizePopoverType;
      }
    }

    function hideFinalizeTiePopover(element) {
      hideFinalizePopover(element, 'tie');
    }

    function hideFinalizeMissingPopover(element) {
      hideFinalizePopover(element, 'missing');
    }

    function getFinalizePopoverTargets(setNumber) {
      const finalizeButton = resolveFinalizePopoverElement(document.getElementById(`finalizeButton${setNumber}`));
      const targets = finalizeButton ? [finalizeButton] : [];
      if (finalizedSets[setNumber]) {
        const { homeInput, oppInput } = getSetScoreInputs(setNumber);
        if (homeInput) {
          const homeTarget = resolveFinalizePopoverElement(homeInput);
          if (homeTarget) {
            targets.push(homeTarget);
          }
        }
        if (oppInput) {
          const oppTarget = resolveFinalizePopoverElement(oppInput);
          if (oppTarget) {
            targets.push(oppTarget);
          }
        }
        const scoreButton = document.querySelector(`.score-game-btn[data-set="${setNumber}"]`);
        if (scoreButton) {
          const scoreTarget = resolveFinalizePopoverElement(scoreButton);
          if (scoreTarget) {
            targets.push(scoreTarget);
          }
        }
      }
      return targets;
    }

    function showFinalizeTiePopover(element, { focus = false } = {}) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return;
      const popover = ensureFinalizePopover(host, 'tie');
      if (!popover) return;
      popover.show();
      if (focus) {
        try {
          host.focus({ preventScroll: true });
        } catch (error) {
          host.focus();
        }
      }
      clearFinalizePopoverTimer(host);
      const timerId = setTimeout(() => {
        popover.hide();
        finalizePopoverTimers.delete(host);
      }, 2400);
      finalizePopoverTimers.set(host, timerId);
    }

    function showFinalizeTiePopovers(setNumber) {
      const targets = getFinalizePopoverTargets(setNumber);
      targets.forEach((element, index) => {
        showFinalizeTiePopover(element, { focus: index === 0 });
      });
    }

    function showFinalizeMissingPopover(element, { focus = false } = {}) {
      const host = resolveFinalizePopoverElement(element);
      if (!host) return;
      const popover = ensureFinalizePopover(host, 'missing');
      if (!popover) return;
      popover.show();
      if (focus) {
        try {
          host.focus({ preventScroll: true });
        } catch (error) {
          host.focus();
        }
      }
      clearFinalizePopoverTimer(host);
      const timerId = setTimeout(() => {
        popover.hide();
        finalizePopoverTimers.delete(host);
      }, 2400);
      finalizePopoverTimers.set(host, timerId);
    }

    function showFinalizeMissingScorePopovers(setNumber) {
      const targets = getFinalizePopoverTargets(setNumber);
      targets.forEach((element, index) => {
        showFinalizeMissingPopover(element, { focus: index === 0 });
      });
    }

    function hideFinalizeErrorPopovers(element) {
      hideFinalizeTiePopover(element);
      hideFinalizeMissingPopover(element);
    }

    function ensureFinalizedPopoverTargets(setNumber) {
      getFinalizePopoverTargets(setNumber).forEach((element) => ensureFinalizePopover(element, 'finalized'));
    }

    function destroyFinalizedPopoverTargets(setNumber) {
      getFinalizePopoverTargets(setNumber).forEach((element) => destroyFinalizedStatePopover(element));
    }

    function colorObjectToCss(color) {
      if (!color) return '';
      const r = Math.round(Math.max(0, Math.min(255, color.r ?? 0)));
      const g = Math.round(Math.max(0, Math.min(255, color.g ?? 0)));
      const b = Math.round(Math.max(0, Math.min(255, color.b ?? 0)));
      const alpha = color.a === undefined ? 1 : Math.max(0, Math.min(1, color.a));
      if (alpha >= 1) {
        return `rgb(${r}, ${g}, ${b})`;
      }
      return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
    }

    function mixColorWithGray(colorString, ratio = SCORE_FINALIZED_BACKGROUND_BLEND) {
      if (!colorString) return null;
      const base = parseCssColor(colorString);
      if (!base) return null;
      const blendRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : SCORE_FINALIZED_BACKGROUND_BLEND;
      const gray = SCORE_FINALIZED_GRAY_COLOR;
      return {
        r: base.r * (1 - blendRatio) + gray.r * blendRatio,
        g: base.g * (1 - blendRatio) + gray.g * blendRatio,
        b: base.b * (1 - blendRatio) + gray.b * blendRatio,
        a: base.a
      };
    }

    function resolveFinalizePopoverElement(element) {
      if (!element) return null;
      const wrapper = finalizedPopoverWrappers.get(element);
      if (wrapper && wrapper.isConnected && wrapper.contains(element)) {
        return wrapper;
      }
      if (wrapper && (!wrapper.isConnected || !wrapper.contains(element))) {
        finalizedPopoverWrappers.delete(element);
      }
      return element;
    }

    function disableFinalizedPointerEvents(element) {
      if (!element || element.dataset.finalizedPointerEventsValue) {
        element.style.pointerEvents = 'none';
        return;
      }
      const inlineValue = element.style.pointerEvents;
      element.dataset.finalizedPointerEventsValue = inlineValue ? inlineValue : '__unset__';
      element.style.pointerEvents = 'none';
    }

    function restoreFinalizedPointerEvents(element) {
      if (!element) return;
      const stored = element.dataset.finalizedPointerEventsValue;
      if (stored && stored !== '__unset__') {
        element.style.pointerEvents = stored;
      } else if (stored === '__unset__') {
        element.style.removeProperty('pointer-events');
      }
      delete element.dataset.finalizedPointerEventsValue;
    }

    function ensureFinalizedPopoverWrapper(element) {
      if (!element) return null;
      let wrapper = finalizedPopoverWrappers.get(element);
      if (wrapper && wrapper.isConnected && wrapper.contains(element)) {
        disableFinalizedPointerEvents(element);
        return wrapper;
      }
      const parent = element.parentElement;
      if (!parent) return null;
      wrapper = document.createElement('span');
      wrapper.classList.add('finalized-popover-wrapper');
      if (element.classList.contains('form-control')) {
        wrapper.classList.add('d-block', 'w-100');
      } else {
        wrapper.classList.add('d-inline-block');
      }
      wrapper.tabIndex = 0;
      parent.insertBefore(wrapper, element);
      wrapper.appendChild(element);
      finalizedPopoverWrappers.set(element, wrapper);
      disableFinalizedPointerEvents(element);
      return wrapper;
    }

    function removeFinalizedPopoverWrapper(element) {
      if (!element) return;
      const wrapper = finalizedPopoverWrappers.get(element);
      if (wrapper) {
        destroyFinalizedStatePopover(wrapper);
        if (wrapper.parentElement) {
          wrapper.parentElement.insertBefore(element, wrapper);
        }
        wrapper.remove();
        finalizedPopoverWrappers.delete(element);
      }
      restoreFinalizedPointerEvents(element);
    }

    function setSetScoreEditingDisabled(setNumber, disabled) {
      const { homeInput, oppInput } = getSetScoreInputs(setNumber);
      const scoreInputs = [homeInput, oppInput];
      scoreInputs.forEach((input) => {
        if (!input) return;
        if (disabled) {
          const computed = window.getComputedStyle(input);
          const originalBackground = computed.backgroundColor;
          const originalColor = computed.color;
          if (originalBackground) {
            input.dataset.scoreOriginalBackground = originalBackground;
          } else {
            delete input.dataset.scoreOriginalBackground;
          }
          if (originalColor) {
            input.dataset.scoreOriginalColor = originalColor;
          } else {
            delete input.dataset.scoreOriginalColor;
          }
          const mutedBackground = mixColorWithGray(originalBackground, SCORE_FINALIZED_BACKGROUND_BLEND);
          const mutedText = mixColorWithGray(originalColor, SCORE_FINALIZED_TEXT_BLEND);
          if (mutedBackground) {
            input.style.backgroundColor = colorObjectToCss(mutedBackground);
          }
          if (mutedText) {
            input.style.color = colorObjectToCss(mutedText);
          }
          input.setAttribute('disabled', 'disabled');
          input.disabled = true;
          input.classList.add('set-score-finalized');
          ensureFinalizedPopoverWrapper(input);
        } else {
          input.removeAttribute('disabled');
          input.disabled = false;
          input.classList.remove('set-score-finalized');
          if (input.dataset.scoreOriginalBackground) {
            input.style.backgroundColor = input.dataset.scoreOriginalBackground;
          } else {
            input.style.removeProperty('background-color');
          }
          if (input.dataset.scoreOriginalColor) {
            input.style.color = input.dataset.scoreOriginalColor;
          } else {
            input.style.removeProperty('color');
          }
          delete input.dataset.scoreOriginalBackground;
          delete input.dataset.scoreOriginalColor;
          removeFinalizedPopoverWrapper(input);
        }
      });
      const scoreButton = document.querySelector(`.score-game-btn[data-set="${setNumber}"]`);
      if (scoreButton) {
        if (disabled) {
          scoreButton.classList.add('disabled');
          scoreButton.setAttribute('aria-disabled', 'true');
          scoreButton.disabled = true;
          scoreButton.setAttribute('disabled', 'disabled');
          ensureFinalizedPopoverWrapper(scoreButton);
        } else {
          scoreButton.classList.remove('disabled');
          scoreButton.removeAttribute('aria-disabled');
          scoreButton.disabled = false;
          scoreButton.removeAttribute('disabled');
          removeFinalizedPopoverWrapper(scoreButton);
        }
      }
    }

    function updateFinalizeButtonState(setNumber) {
      const button = document.getElementById(`finalizeButton${setNumber}`);
      const homeInput = document.getElementById(`set${setNumber}Home`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (!button || !homeInput || !oppInput) {
        return { isTie: false, finalStateChanged: false, isFinal: false };
      }
      const popoverTargets = getFinalizePopoverTargets(setNumber);
      hideFinalizeErrorPopovers(button);
      const homeRaw = homeInput.value.trim();
      const oppRaw = oppInput.value.trim();
      const homeScore = parseScoreValue(homeRaw);
      const oppScore = parseScoreValue(oppRaw);
      const isMissing = homeScore === null || oppScore === null;
      const isTie = !isMissing && homeScore === oppScore;
      const hasError = isTie || isMissing;
      button.classList.toggle('finalize-btn-error', hasError);
      if (hasError) {
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.removeAttribute('aria-disabled');
        popoverTargets.forEach((element) => hideFinalizeErrorPopovers(element));
      }
      let finalStateChanged = false;
      if (hasError && finalizedSets[setNumber]) {
        delete finalizedSets[setNumber];
        button.classList.remove('finalized-btn');
        finalStateChanged = true;
      }
      const previousFinal = button.dataset.finalized === 'true';
      const isFinal = Boolean(finalizedSets[setNumber]);
      if (previousFinal !== isFinal) {
        finalStateChanged = true;
      }
      button.classList.toggle('finalized-btn', isFinal);
      setSetScoreEditingDisabled(setNumber, isFinal);
      if (isFinal) {
        ensureFinalizedPopoverTargets(setNumber);
      } else {
        destroyFinalizedPopoverTargets(setNumber);
      }
      destroyFinalizedStatePopover(button);
      button.dataset.finalized = isFinal ? 'true' : 'false';
      if (button.dataset.finalizeInitialized !== 'true') {
        button.dataset.finalizeInitialized = 'true';
      }
      return { isTie, isMissing, finalStateChanged, isFinal };
    }

    function updateAllFinalizeButtonStates() {
      for (let i = 1; i <= 5; i++) {
        updateFinalizeButtonState(i);
      }
    }

    function updateScoreModalDisplay() {
      const homeDisplay = document.getElementById('scoreGameHomeDisplay');
      const oppDisplay = document.getElementById('scoreGameOppDisplay');
      if (homeDisplay) homeDisplay.textContent = formatScoreDisplay(scoreGameState.home);
      if (oppDisplay) oppDisplay.textContent = formatScoreDisplay(scoreGameState.opp);
    }

    function formatTimeoutDisplay(seconds) {
      const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
      const minutes = Math.floor(safeSeconds / 60);
      const remainingSeconds = safeSeconds % 60;
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    function getTimeoutTeamName(team) {
      const homeTeamHeaderId = isSwapped ? 'oppHeader' : 'homeHeader';
      const opponentHeaderId = isSwapped ? 'homeHeader' : 'oppHeader';
      if (team === 'opp') {
        return getTeamHeaderName(opponentHeaderId, 'Opponent');
      }
      return getTeamHeaderName(homeTeamHeaderId, getHomeTeamName());
    }

    function getTimeoutOrdinalLabel(index) {
      return index === 0 ? 'first' : 'second';
    }

    function createEmptySetTimeouts() {
      return {
        home: Array(TIMEOUT_COUNT).fill(false),
        opp: Array(TIMEOUT_COUNT).fill(false)
      };
    }

    function createEmptyMatchTimeouts() {
      const state = {};
      SET_NUMBERS.forEach((setNumber) => {
        state[setNumber] = createEmptySetTimeouts();
      });
      return state;
    }

    function resetMatchSetRecords() {
      matchSetRecords.clear();
    }

    function normalizeSetRowForState(row) {
      if (!row || typeof row !== 'object') return null;
      const setNumber = Number(row.set_number ?? row.setNumber ?? row.number ?? row.id);
      if (!Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) return null;
      const parseScore = (value) => {
        if (value === null || value === undefined || value === '') {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const parseTimeout = (value) => Boolean(Number(value));
      return {
        id: row.id,
        setNumber,
        homeScore: parseScore(row.home_score ?? row.homeScore ?? row.home),
        oppScore: parseScore(row.opp_score ?? row.oppScore ?? row.opp),
        timeouts: {
          home: [parseTimeout(row.home_timeout_1), parseTimeout(row.home_timeout_2)],
          opp: [parseTimeout(row.opp_timeout_1), parseTimeout(row.opp_timeout_2)]
        }
      };
    }

    function primeMatchSetRecords(rows) {
      resetMatchSetRecords();
      const normalized = {};
      if (!Array.isArray(rows)) {
        return normalized;
      }
      const sortedRows = rows.slice().sort((a, b) => {
        const aNumber = Number(a.set_number ?? a.setNumber ?? a.number ?? a.id ?? 0);
        const bNumber = Number(b.set_number ?? b.setNumber ?? b.number ?? b.id ?? 0);
        return aNumber - bNumber;
      });
      sortedRows.forEach((row) => {
        const record = normalizeSetRowForState(row);
        if (!record) return;
        matchSetRecords.set(record.setNumber, {
          id: record.id,
          setNumber: record.setNumber,
          homeScore: record.homeScore,
          oppScore: record.oppScore,
          timeouts: {
            home: record.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
            opp: record.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
          }
        });
        normalized[record.setNumber] = {
          home: normalizeStoredScoreValue(record.homeScore),
          opp: normalizeStoredScoreValue(record.oppScore),
          timeouts: {
            home: record.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
            opp: record.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
          }
        };
      });
      return normalized;
    }

    function getMatchSetRecord(setNumber) {
      return matchSetRecords.get(setNumber) || null;
    }

    function setMatchSetRecord(setNumber, record) {
      matchSetRecords.set(setNumber, {
        id: record.id,
        setNumber,
        homeScore: record.homeScore,
        oppScore: record.oppScore,
        timeouts: {
          home: record.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
          opp: record.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
        }
      });
    }

    function deleteMatchSetRecord(setNumber) {
      matchSetRecords.delete(setNumber);
    }

    function cloneTimeoutArray(values) {
      const normalized = Array(TIMEOUT_COUNT).fill(false);
      if (Array.isArray(values)) {
        for (let i = 0; i < Math.min(values.length, TIMEOUT_COUNT); i++) {
          normalized[i] = Boolean(values[i]);
        }
      }
      return normalized;
    }

    function getMatchTimeoutState(setNumber) {
      if (!matchTimeouts[setNumber]) {
        matchTimeouts[setNumber] = createEmptySetTimeouts();
      }
      return matchTimeouts[setNumber];
    }

    function setMatchTimeoutState(setNumber, timeouts) {
      matchTimeouts[setNumber] = {
        home: cloneTimeoutArray(timeouts?.home),
        opp: cloneTimeoutArray(timeouts?.opp)
      };
    }

    function swapSetTimeoutState(state) {
      return {
        home: cloneTimeoutArray(state?.opp),
        opp: cloneTimeoutArray(state?.home)
      };
    }

    function swapAllStoredTimeouts() {
      SET_NUMBERS.forEach((setNumber) => {
        const current = getMatchTimeoutState(setNumber);
        matchTimeouts[setNumber] = swapSetTimeoutState(current);
      });
    }

    function persistCurrentSetTimeouts() {
      const { setNumber } = scoreGameState;
      if (!setNumber) return;
      const stored = getMatchTimeoutState(setNumber);
      stored.home = scoreGameState.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean);
      stored.opp = scoreGameState.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean);
    }

    function loadSetTimeoutsIntoScoreState(setNumber) {
      const stored = getMatchTimeoutState(setNumber);
      ['home', 'opp'].forEach(team => {
        stopTimeoutTimer(team);
        scoreGameState.timeouts[team] = stored[team].slice();
        scoreGameState.activeTimeout[team] = null;
        scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
      });
      refreshAllTimeoutDisplays();
    }

    function stopTimeoutTimer(team) {
      const timerId = scoreGameState.timeoutTimers[team];
      if (timerId) {
        clearInterval(timerId);
        scoreGameState.timeoutTimers[team] = null;
      }
    }

    function startTimeoutTimer(team) {
      stopTimeoutTimer(team);
      scoreGameState.timeoutTimers[team] = window.setInterval(() => {
        scoreGameState.timeoutRemainingSeconds[team] = Math.max(0, scoreGameState.timeoutRemainingSeconds[team] - 1);
        updateTimeoutUI(team);
        if (scoreGameState.timeoutRemainingSeconds[team] <= 0) {
          stopTimeoutTimer(team);
          scoreGameState.activeTimeout[team] = null;
          updateTimeoutUI(team);
        }
      }, 1000);
    }

    function getRunningTimeoutTeam() {
      return ['home', 'opp'].find(team => Boolean(scoreGameState.timeoutTimers[team])) || null;
    }

    function cancelActiveTimeoutTimer() {
      const runningTeam = getRunningTimeoutTeam();
      if (!runningTeam) {
        return false;
      }
      stopTimeoutTimer(runningTeam);
      scoreGameState.activeTimeout[runningTeam] = null;
      scoreGameState.timeoutRemainingSeconds[runningTeam] = TIMEOUT_DURATION_SECONDS;
      updateTimeoutUI(runningTeam);
      return true;
    }

    function updateTimeoutTimerDisplay() {
      const displayElement = document.getElementById('scoreGameTimeoutDisplay');
      const statusElement = document.getElementById('scoreGameTimeoutSrStatus');
      const runningTeam = getRunningTimeoutTeam();

      if (!displayElement) {
        if (statusElement) {
          statusElement.textContent = runningTeam
            ? `${getTimeoutTeamName(runningTeam)} timeout running. ${formatTimeoutDisplay(scoreGameState.timeoutRemainingSeconds[runningTeam])} remaining.`
            : '';
        }
        return;
      }

      if (!runningTeam) {
        displayElement.classList.remove('show');
        displayElement.removeAttribute('data-team');
        displayElement.innerHTML = '';
        if (statusElement) {
          statusElement.textContent = '';
        }
        return;
      }

      const seconds = scoreGameState.timeoutRemainingSeconds[runningTeam];
      const formatted = formatTimeoutDisplay(seconds);
      const teamName = getTimeoutTeamName(runningTeam);

      displayElement.classList.add('show');
      displayElement.setAttribute('data-team', runningTeam);
      displayElement.innerHTML = `
        <span class="timeout-timer-team">${teamName} timeout</span>
        <span class="timeout-timer-count">${formatted}</span>
      `.trim();

      if (statusElement) {
        statusElement.textContent = `${teamName} timeout running. ${formatted} remaining.`;
      }
    }

    function updateTimeoutUI(team) {
      const container = document.querySelector(`#scoreGameModal .timeout-container[data-team="${team}"]`);
      if (container) {
        const buttons = container.querySelectorAll('.timeout-box');
        const teamName = getTimeoutTeamName(team);
        container.setAttribute('aria-label', `${teamName} timeouts`);
        const isRunning = Boolean(scoreGameState.timeoutTimers[team]);
        const activeIndex = scoreGameState.activeTimeout[team];
        buttons.forEach(button => {
          const index = parseInt(button.getAttribute('data-timeout-index'), 10);
          if (Number.isNaN(index)) return;
          const used = Boolean(scoreGameState.timeouts[team][index]);
          const isActive = activeIndex === index;
          const textSpan = button.querySelector('.timeout-box-text');
          if (textSpan) {
            textSpan.textContent = 'TO';
          }
          button.classList.toggle('used', used);
          button.classList.toggle('active', isActive && isRunning);
          button.setAttribute('aria-pressed', used ? 'true' : 'false');
          let label = `${teamName} ${getTimeoutOrdinalLabel(index)} timeout ${used ? 'used' : 'available'}`;
          if (isActive && isRunning) {
            label += `. ${formatTimeoutDisplay(scoreGameState.timeoutRemainingSeconds[team])} remaining`;
          }
          button.setAttribute('aria-label', label);
        });
      }
      updateTimeoutTimerDisplay();
    }

    function refreshAllTimeoutDisplays() {
      updateTimeoutUI('home');
      updateTimeoutUI('opp');
    }

    function swapScoreGameTimeoutState() {
      const wasRunning = {
        home: Boolean(scoreGameState.timeoutTimers.home),
        opp: Boolean(scoreGameState.timeoutTimers.opp)
      };
      const previousActive = {
        home: scoreGameState.activeTimeout.home,
        opp: scoreGameState.activeTimeout.opp
      };
      const previousRemaining = {
        home: scoreGameState.timeoutRemainingSeconds.home ?? TIMEOUT_DURATION_SECONDS,
        opp: scoreGameState.timeoutRemainingSeconds.opp ?? TIMEOUT_DURATION_SECONDS
      };

      stopTimeoutTimer('home');
      stopTimeoutTimer('opp');

      const swappedTimeouts = swapSetTimeoutState(scoreGameState.timeouts);
      scoreGameState.timeouts.home = swappedTimeouts.home;
      scoreGameState.timeouts.opp = swappedTimeouts.opp;

      scoreGameState.activeTimeout.home = previousActive.opp ?? null;
      scoreGameState.activeTimeout.opp = previousActive.home ?? null;

      scoreGameState.timeoutRemainingSeconds.home = previousRemaining.opp;
      scoreGameState.timeoutRemainingSeconds.opp = previousRemaining.home;

      if (wasRunning.opp && scoreGameState.activeTimeout.home !== null) {
        startTimeoutTimer('home');
      }

      if (wasRunning.home && scoreGameState.activeTimeout.opp !== null) {
        startTimeoutTimer('opp');
      }

      updateTimeoutUI('home');
      updateTimeoutUI('opp');
    }

    function updateTimeoutLayoutForSwap() {
      const timeoutBar = document.querySelector('#scoreGameModal .timeout-bar');
      if (timeoutBar) {
        // Keep the timeout bar layout consistent regardless of swap state so the
        // team colors always remain aligned with their buttons.
        timeoutBar.classList.remove('timeout-bar-swapped');
      }
    }

    function handleTimeoutSelection(team, index, event) {
      if (event) {
        event.stopPropagation();
      }
      if (!scoreGameState.timeouts[team] || index < 0 || index >= scoreGameState.timeouts[team].length) {
        return;
      }
      const used = scoreGameState.timeouts[team][index];
      const isActive = scoreGameState.activeTimeout[team] === index;

      if (used) {
        if (isActive) {
          stopTimeoutTimer(team);
          scoreGameState.activeTimeout[team] = null;
          scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
        } else if (scoreGameState.activeTimeout[team] === null) {
          scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
        }
        scoreGameState.timeouts[team][index] = false;
        updateTimeoutUI(team);
        persistCurrentSetTimeouts();
        scheduleAutoSave();
        return;
      }

      stopTimeoutTimer(team);
      scoreGameState.activeTimeout[team] = null;
      scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;

      scoreGameState.timeouts[team][index] = true;
      scoreGameState.activeTimeout[team] = index;
      startTimeoutTimer(team);
      updateTimeoutUI(team);
      persistCurrentSetTimeouts();
      scheduleAutoSave();
    }

    function resetTeamTimeouts(team, { skipPersist = false } = {}) {
      stopTimeoutTimer(team);
      scoreGameState.timeouts[team] = Array(TIMEOUT_COUNT).fill(false);
      scoreGameState.activeTimeout[team] = null;
      scoreGameState.timeoutRemainingSeconds[team] = TIMEOUT_DURATION_SECONDS;
      updateTimeoutUI(team);
      if (!skipPersist) {
        persistCurrentSetTimeouts();
      }
    }

    function resetAllTimeouts({ resetStored = false } = {}) {
      if (resetStored) {
        matchTimeouts = createEmptyMatchTimeouts();
      }
      resetTeamTimeouts('home', { skipPersist: true });
      resetTeamTimeouts('opp', { skipPersist: true });
      persistCurrentSetTimeouts();
    }

    function updateScoreColorClasses() {
      const homeHeader = document.getElementById('homeHeader');
      const oppHeader = document.getElementById('oppHeader');
      if (homeHeader) {
        homeHeader.classList.add('left-score');
        homeHeader.classList.remove('right-score');
      }
      if (oppHeader) {
        oppHeader.classList.add('right-score');
        oppHeader.classList.remove('left-score');
      }

      for (let i = 1; i <= 5; i++) {
        const homeInput = document.getElementById(`set${i}Home`);
        const oppInput = document.getElementById(`set${i}Opp`);
        if (homeInput) {
          homeInput.classList.add('left-score');
          homeInput.classList.remove('right-score');
        }
        if (oppInput) {
          oppInput.classList.add('right-score');
          oppInput.classList.remove('left-score');
        }
      }

      const teamPanels = document.querySelectorAll('#scoreGameModal .team-panel');
      if (teamPanels.length >= 2) {
        const [leftPanel, rightPanel] = teamPanels;
        leftPanel.classList.add('team-blue');
        leftPanel.classList.remove('team-red');
        rightPanel.classList.add('team-red');
        rightPanel.classList.remove('team-blue');
      }
    }

    function updateScoreModalLabels() {
      const leftLabel = document.getElementById('scoreGameLeftLabel');
      const rightLabel = document.getElementById('scoreGameRightLabel');
      const leftName = getTeamHeaderName('homeHeader', getHomeTeamName());
      const rightName = getTeamHeaderName('oppHeader', 'Opponent');
      if (leftLabel) leftLabel.textContent = leftName;
      if (rightLabel) rightLabel.textContent = rightName;
      const homeIncrementZone = document.querySelector('#scoreGameModal .score-zone.increment[data-team="home"]');
      const homeDecrementZone = document.querySelector('#scoreGameModal .score-zone.decrement[data-team="home"]');
      const oppIncrementZone = document.querySelector('#scoreGameModal .score-zone.increment[data-team="opp"]');
      const oppDecrementZone = document.querySelector('#scoreGameModal .score-zone.decrement[data-team="opp"]');
      if (homeIncrementZone) homeIncrementZone.setAttribute('aria-label', `Increase ${leftName} score`);
      if (homeDecrementZone) homeDecrementZone.setAttribute('aria-label', `Decrease ${leftName} score`);
      if (oppIncrementZone) oppIncrementZone.setAttribute('aria-label', `Increase ${rightName} score`);
      if (oppDecrementZone) oppDecrementZone.setAttribute('aria-label', `Decrease ${rightName} score`);
      refreshAllTimeoutDisplays();
      updateTimeoutLayoutForSwap();
      updateScoreColorClasses();
    }

    function applyScoreModalToInputs({ triggerSave = true } = {}) {
      const { setNumber } = scoreGameState;
      if (!setNumber) return;
      const homeInput = document.getElementById(`set${setNumber}Home`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (homeInput) homeInput.value = formatScoreInputValue(scoreGameState.home);
      if (oppInput) oppInput.value = formatScoreInputValue(scoreGameState.opp);
      const { finalStateChanged } = updateFinalizeButtonState(setNumber);
      if (triggerSave) {
        calculateResult();
        scheduleAutoSave();
      } else if (finalStateChanged) {
        calculateResult();
      }
    }

    function adjustScoreModal(team, delta) {
      const { setNumber } = scoreGameState;
      if (!setNumber) return;
      const key = team === 'opp' ? 'opp' : 'home';
      const currentValue = scoreGameState[key];
      const baseValue = currentValue === null || currentValue === undefined ? 0 : currentValue;
      const newValue = clampScoreValue(baseValue + delta);
      if (newValue === scoreGameState[key]) return;
      scoreGameState[key] = newValue;
      updateScoreModalDisplay();
      applyScoreModalToInputs();
    }

    function openScoreGameModal(setNumber) {
      const homeInput = document.getElementById(`set${setNumber}Home`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (!homeInput || !oppInput) return false;
      if (scoreGameState.setNumber !== null) {
        persistCurrentSetTimeouts();
        if (scoreGameState.setNumber !== setNumber) {
          cancelActiveTimeoutTimer();
        }
      }
      scoreGameState.setNumber = setNumber;
      scoreGameState.home = parseScoreValue(homeInput.value);
      scoreGameState.opp = parseScoreValue(oppInput.value);
      loadSetTimeoutsIntoScoreState(setNumber);
      updateScoreModalLabels();
      updateScoreModalDisplay();
      applyScoreModalToInputs({ triggerSave: false });
      const modalTitle = document.getElementById('scoreGameModalLabel');
      if (modalTitle) modalTitle.textContent = `Score Game – Set ${setNumber}`;
      if (!scoreGameModalInstance) {
        const modalElement = document.getElementById('scoreGameModal');
        if (modalElement) {
          scoreGameModalInstance = new bootstrap.Modal(modalElement);
        }
      }
      if (scoreGameModalInstance) {
        updateScoreGameModalLayout();
        scoreGameModalInstance.show();
        return true;
      }
      return false;
    }

    
    async function savePlayer(number, lastName, initial, id = null) {
      const payload = {
        number: number,
        lastName: lastName,
        initial: initial || ''
      };
      try {
        if (id !== null) {
          await apiClient.updatePlayer(id, payload);
        } else {
          await apiClient.createPlayer(payload);
        }
        await loadPlayers();
      } catch (error) {
        console.error('Failed to save player', error);
        alert('Unable to save player. Please try again.');
      }
    }


    
    async function deletePlayer(id) {
      try {
        await apiClient.deletePlayer(id);
        if (editingPlayerId === id) {
          resetPlayerForm();
        }
        await loadPlayers();
      } catch (error) {
        console.error('Failed to delete player', error);
        alert('Unable to delete player. Please try again.');
      }
    }


    function getTeamHeaderButton(headerId) {
      const header = document.getElementById(headerId);
      return header ? header.querySelector('.team-name-button') : null;
    }

    function getTeamAbbreviation(name = '') {
      const trimmed = name.trim();
      if (!trimmed) return '';
      const parts = trimmed
        .replace(/[^A-Za-z0-9\s-]+/g, ' ')
        .split(/[-\s]+/)
        .filter(Boolean);
      if (!parts.length) return trimmed.toUpperCase();
      return parts.map(part => part[0].toUpperCase()).join('');
    }

    function updateTeamHeaderButtonDisplay(button) {
      if (!button) return;
      const fullName = button.dataset.fullName || button.textContent.trim();
      const abbreviation = button.dataset.abbr || getTeamAbbreviation(fullName);
      button.textContent = fullName;
      button.dataset.displayMode = 'full';
      if (fullName && abbreviation && button.scrollWidth > button.clientWidth + 1) {
        button.textContent = abbreviation;
        button.dataset.displayMode = 'abbr';
      }
    }

    function scheduleTeamHeaderButtonDisplayUpdate(button) {
      if (!button) return;
      requestAnimationFrame(() => updateTeamHeaderButtonDisplay(button));
    }

    function refreshAllTeamHeaderButtons() {
      document.querySelectorAll('.team-name-button').forEach(updateTeamHeaderButtonDisplay);
    }

    function getTeamHeaderName(headerId, fallback) {
      const button = getTeamHeaderButton(headerId);
      if (button) {
        const fullName = button.dataset.fullName || button.textContent.trim();
        if (fullName) return fullName;
      }
      const header = document.getElementById(headerId);
      if (header && header.textContent.trim()) {
        return header.textContent.trim();
      }
      return fallback;
    }

    function setTeamHeaderName(headerId, name, { roleDescription } = {}) {
      const safeName = name || '';
      const button = getTeamHeaderButton(headerId);
      if (button) {
        const abbreviation = getTeamAbbreviation(safeName);
        button.dataset.fullName = safeName;
        button.dataset.abbr = abbreviation;
        button.textContent = safeName;
        button.setAttribute('data-bs-content', safeName);
        button.setAttribute('title', safeName);
        if (roleDescription) {
          button.setAttribute('aria-label', `${roleDescription}: ${safeName}. Press or tap to view full name.`);
        } else {
          button.setAttribute('aria-label', `${safeName}. Press or tap to view full name.`);
        }
        const instance = window.bootstrap ? window.bootstrap.Popover.getInstance(button) : null;
        if (instance && typeof instance.setContent === 'function') {
          instance.setContent({ '.popover-body': safeName });
        }
        scheduleTeamHeaderButtonDisplayUpdate(button);
      } else {
        const header = document.getElementById(headerId);
        if (header) {
          header.textContent = safeName;
        }
      }
    }

    function initializeTeamHeaderPopovers() {
      if (!window.bootstrap || !window.bootstrap.Popover) return;
      document.querySelectorAll('.team-name-button[data-bs-toggle="popover"]').forEach(button => {
        const existing = window.bootstrap.Popover.getInstance(button);
        if (existing) {
          existing.dispose();
        }
        const content = button.dataset.fullName || button.getAttribute('data-bs-content') || button.textContent.trim();
        new window.bootstrap.Popover(button, {
          trigger: 'focus',
          placement: button.getAttribute('data-bs-placement') || 'bottom',
          content
        });
        scheduleTeamHeaderButtonDisplayUpdate(button);
      });
    }

    function getOpponentTeamName() {
      const opponentInput = document.getElementById('opponent');
      if (!opponentInput) return 'Opponent';
      const trimmed = opponentInput.value.trim();
      return trimmed || 'Opponent';
    }

    function updateOpponentName() {
      const opponentName = getOpponentTeamName();
      const jerseyColorOppLabel = document.getElementById('jerseyColorOppLabel');
      const resultOppLabel = document.getElementById('resultOppLabel');
      if (jerseyColorOppLabel) jerseyColorOppLabel.textContent = `Jersey Color (${opponentName})`;
      if (resultOppLabel) resultOppLabel.textContent = opponentName;
      updateFirstServeOptions();
      updateSetHeaders(opponentName, isSwapped);
    }

    function updateFirstServeOptions() {
      const opponentInput = document.getElementById('opponent').value.trim();
      const opponentName = opponentInput || 'Opponent';
      const select = document.getElementById('firstServer');
      if (!select) return;

      const previousValue = select.value;

      select.innerHTML = '';
      const homeName = getHomeTeamName();
      const homeOption = document.createElement('option');
      homeOption.value = homeName;
      homeOption.textContent = homeName;
      select.appendChild(homeOption);
      const opponentOption = document.createElement('option');
      opponentOption.value = opponentName;
      opponentOption.textContent = opponentName;
      select.appendChild(opponentOption);

      const normalizedPrevious = (previousValue || '').trim();
      const normalizedLower = normalizedPrevious.toLocaleLowerCase();
      const homeLower = homeName.toLocaleLowerCase();
      const fallbackLower = HOME_TEAM_FALLBACK.toLocaleLowerCase();
      if (normalizedLower === homeLower || normalizedLower === fallbackLower) {
        select.value = homeName;
      } else if (normalizedPrevious) {
        select.value = opponentName;
      }
    }

    function setFirstServerSelection(value) {
      const select = document.getElementById('firstServer');
      if (!select) return;

      const normalized = (value ?? '').trim();
      if (!normalized) {
        select.value = '';
        return;
      }

      const optionsArray = Array.from(select.options);
      const normalizedLower = normalized.toLocaleLowerCase();
      const homeLower = getHomeTeamName().toLocaleLowerCase();
      const fallbackLower = HOME_TEAM_FALLBACK.toLocaleLowerCase();

      if (normalizedLower === homeLower || normalizedLower === fallbackLower) {
        const homeOption = optionsArray.find(option => option.value.toLocaleLowerCase() === homeLower);
        if (homeOption) {
          select.value = homeOption.value;
          return;
        }
      }

      const exactMatch = optionsArray.find(option => option.value === normalized);
      if (exactMatch) {
        select.value = normalized;
        return;
      }

      const caseInsensitiveMatch = optionsArray.find(
        option => option.value.toLocaleLowerCase() === normalizedLower
      );
      if (caseInsensitiveMatch) {
        select.value = caseInsensitiveMatch.value;
        return;
      }

      select.value = '';
    }

    function updateSetHeaders(opponentName, swapped) {
      const baseHomeName = getHomeTeamName();
      const homeName = swapped ? opponentName : baseHomeName;
      const awayName = swapped ? baseHomeName : opponentName;
      setTeamHeaderName('homeHeader', homeName, { roleDescription: 'Home team' });
      setTeamHeaderName('oppHeader', awayName, { roleDescription: 'Opponent team' });
      updateScoreModalLabels();
    }

    function syncScoreGameModalAfterSwap() {
      const modalElement = document.getElementById('scoreGameModal');
      if (!modalElement || !modalElement.classList.contains('show')) return;
      updateScoreModalLabels();
      const { setNumber } = scoreGameState;
      if (!setNumber) return;
      const homeInput = document.getElementById(`set${setNumber}Home`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      if (!homeInput || !oppInput) return;
      scoreGameState.home = parseScoreValue(homeInput.value);
      scoreGameState.opp = parseScoreValue(oppInput.value);
      updateScoreModalDisplay();
    }

    function swapScores() {
      persistCurrentSetTimeouts();
      isSwapped = !isSwapped;
      swapAllStoredTimeouts();
      swapScoreGameTimeoutState();
      const opponentInput = document.getElementById('opponent').value.trim();
      const opponentName = opponentInput || 'Opponent';
      for (let i = 1; i <= 5; i++) {
        const homeScore = document.getElementById(`set${i}Home`).value;
        const oppScore = document.getElementById(`set${i}Opp`).value;
        document.getElementById(`set${i}Home`).value = oppScore;
        document.getElementById(`set${i}Opp`).value = homeScore;
      }
      updateAllFinalizeButtonStates();
      updateSetHeaders(opponentName, isSwapped); // Update headers after swap
      refreshAllTeamHeaderButtons();
      if (Object.keys(finalizedSets).length > 0) {
        calculateResult();
      }
      scheduleAutoSave();
      syncScoreGameModalAfterSwap();
    }

    
    async function submitPlayer() {
      const number = document.getElementById('number').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const initial = document.getElementById('initial').value.trim() || '';
      const tempNumberElement = document.getElementById('tempNumber');
      const tempNumber = tempNumberElement ? tempNumberElement.value.trim() : '';
      if (number && lastName) {
        const idToSave = editingPlayerId !== null ? editingPlayerId : null;
        if (idToSave !== null) {
          const normalizedId = normalizePlayerId(idToSave);
          if (normalizedId !== null) {
            if (tempNumber) {
              temporaryPlayerNumbers.set(normalizedId, tempNumber);
            } else {
              temporaryPlayerNumbers.delete(normalizedId);
            }
          }
          pendingTemporaryPlayer = null;
          updateModalPlayerList();
        } else if (tempNumber) {
          pendingTemporaryPlayer = {
            number,
            lastName,
            initial,
            value: tempNumber
          };
        } else {
          pendingTemporaryPlayer = null;
        }
        await savePlayer(number, lastName, initial, idToSave);
      }
      resetPlayerForm();
    }


    function updatePlayerList() {
      const list = document.getElementById('playerList');
      list.innerHTML = '';
      const rosterSelection = Array.isArray(loadedMatchPlayers) ? loadedMatchPlayers : [];
      players.forEach((player, index) => {
        const div = document.createElement('div');
        div.className = 'player-item form-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'form-check-input';
        const checkboxId = `player-select-${index}`;
        checkbox.id = checkboxId;
        const normalizedId = player.id;
        if (normalizedId !== null) {
          checkbox.value = normalizedId;
          checkbox.dataset.playerId = normalizedId;
          if (
            rosterSelection.some(entry => normalizePlayerId(entry?.playerId) === normalizedId)
          ) {
            checkbox.checked = true;
          }
        } else {
          checkbox.value = '';
          checkbox.disabled = true;
        }
        div.appendChild(checkbox);
        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.setAttribute('for', checkboxId);
        label.appendChild(createPlayerDisplay(player));
        div.appendChild(label);
        list.appendChild(div);
      });
      applyJerseyColorToNumbers();
    }

    const JERSEY_SWATCH_SVG_PATH = 'M15 10l9-6h16l9 6 5 14-11 5v21H21V29l-11-5z';

    const jerseyColorValues = {
      white: '#ffffff',
      grey: '#808080',
      black: '#000000',
      yellow: '#ffd700',
      orange: '#ff8c00',
      red: '#dc3545',
      green: '#198754',
      blue: '#0d6efd',
      purple: '#6f42c1',
      pink: '#d63384'
    };

    const jerseyColorContrast = {
      white: '#000000',
      yellow: '#000000',
      orange: '#000000',
      pink: '#000000',
      grey: '#ffffff',
      black: '#ffffff',
      red: '#ffffff',
      green: '#ffffff',
      blue: '#ffffff',
      purple: '#ffffff'
    };

    const JERSEY_CONFLICT_NOTE = 'If both teams have the same color, choose the libero color.';

    const JERSEY_CONTRAST_RATIO_THRESHOLD = 3;

    function parseCssColor(value) {
      if (!value) return null;
      const color = value.trim().toLowerCase();
      if (!color) return null;
      if (color === 'transparent') {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
          hex = hex.split('').map(char => char + char).join('');
        }
        const intVal = parseInt(hex, 16);
        return {
          r: (intVal >> 16) & 255,
          g: (intVal >> 8) & 255,
          b: intVal & 255,
          a: 1
        };
      }
      const rgbMatch = color.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
      if (rgbMatch) {
        const [, r, g, b, a] = rgbMatch;
        return {
          r: Math.max(0, Math.min(255, parseFloat(r))),
          g: Math.max(0, Math.min(255, parseFloat(g))),
          b: Math.max(0, Math.min(255, parseFloat(b))),
          a: a !== undefined ? Math.max(0, Math.min(1, parseFloat(a))) : 1
        };
      }
      return null;
    }

    function relativeLuminance({ r, g, b }) {
      const convertChannel = (channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      const rL = convertChannel(r);
      const gL = convertChannel(g);
      const bL = convertChannel(b);
      return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
    }

    function getContrastRatio(colorA, colorB) {
      if (!colorA || !colorB) return Number.POSITIVE_INFINITY;
      const lumA = relativeLuminance(colorA);
      const lumB = relativeLuminance(colorB);
      const lighter = Math.max(lumA, lumB);
      const darker = Math.min(lumA, lumB);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function getContrastingOutlineColor(color) {
      if (!color) return '#000000';
      const black = { r: 0, g: 0, b: 0 };
      const white = { r: 255, g: 255, b: 255 };
      const contrastWithBlack = getContrastRatio(color, black);
      const contrastWithWhite = getContrastRatio(color, white);
      return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
    }

    function getEffectiveBackgroundColor(element) {
      let current = element ? element.parentElement : null;
      while (current) {
        const style = window.getComputedStyle(current);
        const parsed = parseCssColor(style.backgroundColor);
        if (parsed && parsed.a > 0) {
          return parsed;
        }
        current = current.parentElement;
      }
      const bodyColor = parseCssColor(window.getComputedStyle(document.body).backgroundColor);
      if (bodyColor && bodyColor.a > 0) return bodyColor;
      const rootColor = parseCssColor(window.getComputedStyle(document.documentElement).backgroundColor);
      if (rootColor && rootColor.a > 0) return rootColor;
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function computeContrastOutlineColor(element, fillColor, fallbackColor) {
      const parsedFill = parseCssColor(fillColor);
      if (!element || !parsedFill) return fallbackColor;
      const backgroundColor = getEffectiveBackgroundColor(element);
      const contrast = getContrastRatio(parsedFill, backgroundColor);
      if (!Number.isFinite(contrast) || contrast < JERSEY_CONTRAST_RATIO_THRESHOLD) {
        return getContrastingOutlineColor(parsedFill);
      }
      return fallbackColor;
    }

    function ensureJerseySwatchGraphic(swatchElement) {
      if (!swatchElement) return null;

      let svg = swatchElement._jerseySvg;
      let path = swatchElement._jerseyPath;

      if (!svg || !path || path.ownerSVGElement !== svg) {
        svg = swatchElement.querySelector('svg[data-jersey-swatch]');
        path = svg ? svg.querySelector('path') : null;
      }

      if (!svg || !path) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.dataset.jerseySwatch = 'true';

        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', JERSEY_SWATCH_SVG_PATH);
        svg.appendChild(path);

        swatchElement.textContent = '';
        swatchElement.appendChild(svg);
      }

      swatchElement._jerseySvg = svg;
      swatchElement._jerseyPath = path;
      return { svg, path };
    }

    function getSwatchDefaultBorder(element) {
      if (!element) return 'rgba(0, 0, 0, 0.175)';
      if (!element.dataset.jerseyDefaultBorder) {
        const computed = window.getComputedStyle(element).getPropertyValue('--jersey-swatch-border');
        element.dataset.jerseyDefaultBorder = computed && computed.trim()
          ? computed.trim()
          : 'rgba(0, 0, 0, 0.175)';
      }
      return element.dataset.jerseyDefaultBorder;
    }

    function applySwatchStyles(swatchElement, color) {
      if (!swatchElement) return;
      const graphic = ensureJerseySwatchGraphic(swatchElement);
      const fallbackBorder = getSwatchDefaultBorder(swatchElement);
      swatchElement.style.setProperty('--jersey-swatch-color', color);
      const borderColor = computeContrastOutlineColor(swatchElement, color, fallbackBorder);
      swatchElement.style.setProperty('--jersey-swatch-border', borderColor);
      swatchElement.style.color = borderColor;
      swatchElement.dataset.jerseySwatchColor = color;
      if (graphic && graphic.path) {
        graphic.path.setAttribute('fill', color);
        graphic.path.setAttribute('stroke', borderColor);
      }
    }

    function getJerseyColorStyles(color) {
      const backgroundColor = jerseyColorValues[color] || color;
      const textColor = jerseyColorContrast[color] || '#ffffff';
      return { backgroundColor, textColor };
    }

    function updateJerseySelectDisplay(selectElement) {
      if (!selectElement || !selectElement._jerseyUI) return;
      const { triggerLabel, triggerSwatch, optionButtons } = selectElement._jerseyUI;
      const selectedOption = selectElement.options[selectElement.selectedIndex];
      if (!selectedOption) return;
      const swatchColor = selectedOption.dataset.color || jerseyColorValues[selectedOption.value] || '#ffffff';
      if (triggerLabel) {
        triggerLabel.textContent = selectedOption.textContent;
      }
      if (triggerSwatch) {
        applySwatchStyles(triggerSwatch, swatchColor);
      }
      if (Array.isArray(optionButtons)) {
        optionButtons.forEach((button) => {
          const isSelected = button.dataset.value === selectElement.value;
          button.classList.toggle('is-active', isSelected);
          button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
          button.setAttribute('tabindex', isSelected ? '0' : '-1');
          const swatch = button._jerseySwatch || button.querySelector('.jersey-select-option-swatch');
          if (swatch) {
            const color = swatch.dataset.jerseySwatchColor || swatch.style.getPropertyValue('--jersey-swatch-color') || '#ffffff';
            applySwatchStyles(swatch, color);
            button._jerseySwatch = swatch;
          }
        });
      }
    }

    function refreshJerseySelectDisplays() {
      updateJerseySelectDisplay(document.getElementById('jerseyColorHome'));
      updateJerseySelectDisplay(document.getElementById('jerseyColorOpp'));
    }

    function resetJerseySwatchDefaultBorders() {
      document.querySelectorAll('.jersey-select-swatch, .jersey-select-option-swatch').forEach((swatch) => {
        if (!swatch) return;
        if (swatch.dataset && swatch.dataset.jerseyDefaultBorder) {
          delete swatch.dataset.jerseyDefaultBorder;
        }
        if (swatch.style) {
          swatch.style.removeProperty('--jersey-swatch-border');
          swatch.style.removeProperty('color');
        }
      });
    }

    function handleJerseyThemeChange() {
      resetJerseySwatchDefaultBorders();
      refreshJerseySelectDisplays();
    }

    function setupJerseyThemeObserver() {
      if (jerseyThemeObserver || typeof MutationObserver !== 'function') return;
      const rootElement = document.documentElement;
      if (!rootElement) return;
      jerseyThemeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-bs-theme') {
            handleJerseyThemeChange();
            break;
          }
        }
      });
      jerseyThemeObserver.observe(rootElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
    }

    function getJerseyColorLabel(selectElement, value) {
      if (!selectElement) return value;
      const option = Array.from(selectElement.options || []).find(opt => opt.value === value);
      return option ? option.textContent.trim() : value;
    }

    function findAlternativeJerseyColor(selectElement, forbiddenValue) {
      if (!selectElement) return null;
      const options = Array.from(selectElement.options || []);
      if (options.length === 0) return null;
      const startIndex = Math.max(0, options.findIndex(option => option.value === forbiddenValue));
      for (let offset = 1; offset <= options.length; offset++) {
        const option = options[(startIndex + offset) % options.length];
        if (!option || option.disabled || option.value === forbiddenValue) continue;
        return option.value;
      }
      return null;
    }

    function setJerseyConflictMessage({ conflictColorLabel, changedTeamName, adjustedTeamName, replacementColorLabel }) {
      if (!jerseyConflictModalMessageElement) return;
      let message = `Jersey colors must be different. ${JERSEY_CONFLICT_NOTE}`;
      if (changedTeamName && adjustedTeamName && conflictColorLabel) {
        if (replacementColorLabel) {
          message = `${changedTeamName} and ${adjustedTeamName} cannot both have ${conflictColorLabel} jerseys. ${adjustedTeamName}'s jersey color has been changed to ${replacementColorLabel}. ${JERSEY_CONFLICT_NOTE}`;
        } else {
          message = `${changedTeamName} and ${adjustedTeamName} cannot both have ${conflictColorLabel} jerseys. Please choose another color for ${adjustedTeamName}. ${JERSEY_CONFLICT_NOTE}`;
        }
      }
      jerseyConflictModalMessageElement.textContent = message;
    }

    function ensureDistinctJerseyColors(changedSelect, { showModal = true } = {}) {
      if (isResolvingJerseyColorConflict) return;
      const homeSelect = document.getElementById('jerseyColorHome');
      const opponentSelect = document.getElementById('jerseyColorOpp');
      if (!homeSelect || !opponentSelect) return;

      const homeValue = homeSelect.value;
      const opponentValue = opponentSelect.value;
      if (!homeValue || !opponentValue || homeValue !== opponentValue) return;

      const isOpponentChanged = changedSelect === opponentSelect;
      const activeSelect = changedSelect && (changedSelect === homeSelect || changedSelect === opponentSelect)
        ? changedSelect
        : homeSelect;
      const otherSelect = isOpponentChanged ? homeSelect : opponentSelect;
      const changedTeamName = activeSelect === opponentSelect ? getOpponentTeamName() : getHomeTeamName();
      const adjustedTeamName = otherSelect === opponentSelect ? getOpponentTeamName() : getHomeTeamName();
      const conflictColorLabel = getJerseyColorLabel(activeSelect, activeSelect.value);

      const replacementValue = findAlternativeJerseyColor(otherSelect, activeSelect.value);
      let replacementLabel = '';
      if (replacementValue) {
        isResolvingJerseyColorConflict = true;
        try {
          otherSelect.value = replacementValue;
          otherSelect.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
          isResolvingJerseyColorConflict = false;
        }
        replacementLabel = getJerseyColorLabel(otherSelect, replacementValue);
      }

      if (showModal && jerseyConflictModalInstance) {
        setJerseyConflictMessage({
          conflictColorLabel,
          changedTeamName,
          adjustedTeamName,
          replacementColorLabel: replacementLabel
        });
        jerseyConflictModalInstance.show();
      }
    }

    function closeOpenJerseySelect(options) {
      if (!openJerseySelectInstance || typeof openJerseySelectInstance.close !== 'function') return;
      openJerseySelectInstance.close(options);
    }

    function focusJerseyOption(optionButtons, index) {
      if (!Array.isArray(optionButtons) || optionButtons.length === 0) return;
      const boundedIndex = Math.max(0, Math.min(optionButtons.length - 1, index));
      const button = optionButtons[boundedIndex];
      if (button) {
        button.focus();
      }
    }

    function initializeJerseySelect(selectElement, { applyToNumbers = false } = {}) {
      if (!selectElement || selectElement.dataset.jerseyInitialized === 'true') return;

      selectElement.dataset.jerseyInitialized = 'true';

      let container = selectElement.closest('.jersey-select-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'jersey-select-container';
        const parent = selectElement.parentNode;
        if (parent) {
          parent.insertBefore(container, selectElement);
        }
        container.appendChild(selectElement);
      } else {
        container.classList.add('jersey-select-container');
      }

      selectElement.classList.add('jersey-select');
      selectElement.setAttribute('aria-hidden', 'true');
      selectElement.setAttribute('tabindex', '-1');

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'form-select jersey-select-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      const triggerMain = document.createElement('span');
      triggerMain.className = 'jersey-select-main';

      const triggerSwatch = document.createElement('span');
      triggerSwatch.className = 'jersey-select-swatch';
      triggerMain.appendChild(triggerSwatch);

      const triggerLabel = document.createElement('span');
      triggerLabel.className = 'jersey-select-label';
      triggerMain.appendChild(triggerLabel);

      trigger.appendChild(triggerMain);
      container.appendChild(trigger);
      getSwatchDefaultBorder(triggerSwatch);

      const triggerIdBase = selectElement.id || `jerseySelect${Date.now()}`;
      const triggerId = `${triggerIdBase}Trigger`;
      trigger.id = triggerId;

      const menu = document.createElement('ul');
      const menuId = `${triggerId}-menu`;
      menu.className = 'jersey-select-menu';
      menu.id = menuId;
      menu.hidden = true;
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('tabindex', '-1');
      container.appendChild(menu);
      trigger.setAttribute('aria-controls', menuId);
      menu.setAttribute('aria-labelledby', triggerId);

      const labelElement = document.querySelector(`label[for="${selectElement.id}"]`);
      if (labelElement) {
        labelElement.setAttribute('for', triggerId);
        const labelReference = [labelElement.id, triggerId].filter(Boolean).join(' ');
        if (labelReference) {
          trigger.setAttribute('aria-labelledby', labelReference);
        }
      }

      const optionButtons = Array.from(selectElement.options).map((option, index) => {
        const listItem = document.createElement('li');
        listItem.role = 'presentation';

        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'jersey-select-option';
        optionButton.setAttribute('role', 'option');
        optionButton.dataset.value = option.value;
        optionButton.dataset.index = String(index);
        optionButton.setAttribute('tabindex', '-1');

        const swatch = document.createElement('span');
        swatch.className = 'jersey-select-option-swatch';
        const swatchColor = option.dataset.color || jerseyColorValues[option.value] || '#ffffff';
        optionButton.appendChild(swatch);

        const optionLabel = document.createElement('span');
        optionLabel.className = 'jersey-select-option-label';
        optionLabel.textContent = option.textContent;
        optionButton.appendChild(optionLabel);

        optionButton.addEventListener('click', () => {
          const newValue = option.value;
          const hasChanged = selectElement.value !== newValue;
          selectElement.value = newValue;
          if (hasChanged) {
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            updateJerseySelectDisplay(selectElement);
            if (applyToNumbers) {
              applyJerseyColorToNumbers();
            }
          }
          closeMenu({ focusTrigger: true });
        });

        listItem.appendChild(optionButton);
        menu.appendChild(listItem);
        applySwatchStyles(swatch, swatchColor);
        optionButton._jerseySwatch = swatch;
        return optionButton;
      });

      function closeMenu({ focusTrigger = false } = {}) {
        if (!container.classList.contains('is-open')) return;
        container.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        menu.hidden = true;
        if (openJerseySelectInstance && openJerseySelectInstance.close === closeMenu) {
          openJerseySelectInstance = null;
        }
        if (focusTrigger) {
          trigger.focus();
        }
      }

      function openMenu({ focusOption = true } = {}) {
        if (container.classList.contains('is-open')) return;
        closeOpenJerseySelect();
        container.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        openJerseySelectInstance = {
          close: closeMenu,
          container,
          trigger
        };
        const selectedIndex = selectElement.selectedIndex >= 0 ? selectElement.selectedIndex : 0;
        const target = optionButtons[selectedIndex] || optionButtons[0];
        if (target) {
          requestAnimationFrame(() => {
            target.scrollIntoView({ block: 'nearest' });
            if (focusOption) {
              target.focus();
            }
          });
        }
      }

      function focusRelative(delta) {
        if (!Array.isArray(optionButtons) || optionButtons.length === 0) return;
        const activeIndex = optionButtons.indexOf(document.activeElement);
        if (activeIndex === -1) {
          const baseIndex = selectElement.selectedIndex >= 0 ? selectElement.selectedIndex : (delta > 0 ? -1 : optionButtons.length);
          focusJerseyOption(optionButtons, baseIndex + delta);
          return;
        }
        focusJerseyOption(optionButtons, activeIndex + delta);
      }

      trigger.addEventListener('click', () => {
        if (container.classList.contains('is-open')) {
          closeMenu();
        } else {
          openMenu();
        }
      });

      trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          openMenu({ focusOption: false });
          if (event.key === 'ArrowDown') {
            focusRelative(1);
          } else {
            focusRelative(-1);
          }
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (container.classList.contains('is-open')) {
            closeMenu();
          } else {
            openMenu();
          }
        }
      });

      menu.addEventListener('keydown', (event) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            focusRelative(1);
            break;
          case 'ArrowUp':
            event.preventDefault();
            focusRelative(-1);
            break;
          case 'Home':
            event.preventDefault();
            focusJerseyOption(optionButtons, 0);
            break;
          case 'End':
            event.preventDefault();
            focusJerseyOption(optionButtons, optionButtons.length - 1);
            break;
          case 'Enter':
          case ' ': {
            event.preventDefault();
            const activeButton = document.activeElement;
            if (optionButtons.includes(activeButton)) {
              activeButton.click();
            }
            break;
          }
          case 'Escape':
            event.preventDefault();
            closeMenu({ focusTrigger: true });
            break;
          case 'Tab':
            closeMenu();
            break;
          default:
            break;
        }
      });

      selectElement.addEventListener('change', () => {
        updateJerseySelectDisplay(selectElement);
        if (applyToNumbers) {
          applyJerseyColorToNumbers();
        }
        if (!isResolvingJerseyColorConflict) {
          ensureDistinctJerseyColors(selectElement);
        }
      });

      selectElement._jerseyUI = {
        container,
        trigger,
        triggerLabel,
        triggerSwatch,
        menu,
        optionButtons,
        closeMenu,
        openMenu
      };

      container.classList.add('is-ready');
      updateJerseySelectDisplay(selectElement);
      if (applyToNumbers) {
        applyJerseyColorToNumbers();
      }
    }

    document.addEventListener('pointerdown', (event) => {
      if (!openJerseySelectInstance || !openJerseySelectInstance.container) return;
      if (!openJerseySelectInstance.container.contains(event.target)) {
        openJerseySelectInstance.close({ focusTrigger: false });
      }
    });

    document.addEventListener('focusin', (event) => {
      if (!openJerseySelectInstance || !openJerseySelectInstance.container) return;
      if (!openJerseySelectInstance.container.contains(event.target)) {
        openJerseySelectInstance.close({ focusTrigger: false });
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!openJerseySelectInstance) return;
      event.preventDefault();
      openJerseySelectInstance.close({ focusTrigger: true });
    });

    function applyJerseyColorToNumbers() {
      const jerseySelect = document.getElementById('jerseyColorHome');
      if (!jerseySelect) return;
      updateJerseySelectDisplay(jerseySelect);
      const { backgroundColor, textColor } = getJerseyColorStyles(jerseySelect.value);
      document.querySelectorAll('.player-number-circle').forEach(circle => {
        circle.style.backgroundColor = backgroundColor;
        circle.style.color = textColor;
        const computedBorder = computeContrastOutlineColor(circle, backgroundColor, 'transparent');
        circle.style.borderColor = computedBorder;
      });
    }

    function createPlayerDisplay(player) {
      const fragment = document.createDocumentFragment();
      if (!player || typeof player !== 'object') {
        const fallback = document.createElement('span');
        fallback.className = 'player-name';
        fallback.textContent = typeof player === 'string' ? player : '';
        fragment.appendChild(fallback);
        return fragment;
      }

      const displayNumber = String(player.tempNumber || player.number || '').trim();
      const lastName = String(player.lastName || '').trim();
      const initial = String(player.initial || '').trim();
      const nameText = [lastName, initial].filter(Boolean).join(' ');

      if (displayNumber) {
        const numberCircle = document.createElement('span');
        numberCircle.className = 'player-number-circle';
        numberCircle.textContent = displayNumber;
        const jerseyColor = document.getElementById('jerseyColorHome').value;
        const { backgroundColor, textColor } = getJerseyColorStyles(jerseyColor);
        numberCircle.style.backgroundColor = backgroundColor;
        numberCircle.style.color = textColor;
        numberCircle.style.borderColor = 'transparent';
        fragment.appendChild(numberCircle);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = nameText;
      if (nameText) {
        nameSpan.title = nameText;
      }
      fragment.appendChild(nameSpan);

      return fragment;
    }

    
    function updateModalPlayerList() {
      const list = document.getElementById('modalPlayerList');
      list.innerHTML = '';
      playerRecords.forEach(playerData => {
        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center mb-2';

        const displayContainer = document.createElement('div');
        displayContainer.className = 'd-flex align-items-center';
        const displayData = getPlayerDisplayData(playerData);
        const playerDisplay = createPlayerDisplay(displayData);
        displayContainer.appendChild(playerDisplay);
        const recordId = normalizePlayerId(playerData.id);
        if (recordId !== null && temporaryPlayerNumbers.has(recordId)) {
          const tempBadge = document.createElement('span');
          const tempValue = temporaryPlayerNumbers.get(recordId);
          tempBadge.className = 'badge text-bg-secondary ms-2';
          tempBadge.textContent = `Temp #${tempValue}`;
          tempBadge.setAttribute('aria-label', `Temporary number ${tempValue}`);
          displayContainer.appendChild(tempBadge);
        }

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'btn-group btn-group-sm';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-outline-primary';
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => startEditPlayer(playerData);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = async () => deletePlayer(playerData.id);

        buttonGroup.appendChild(editBtn);
        buttonGroup.appendChild(deleteBtn);

        div.appendChild(displayContainer);
        div.appendChild(buttonGroup);
        list.appendChild(div);
      });
      applyJerseyColorToNumbers();
    }


    function startEditPlayer(player) {
      editingPlayerId = player.id;
      document.getElementById('number').value = player.number;
      document.getElementById('lastName').value = player.lastName;
      document.getElementById('initial').value = player.initial || '';
      const tempInput = document.getElementById('tempNumber');
      if (tempInput) {
        const tempValue = temporaryPlayerNumbers.get(normalizePlayerId(player.id));
        tempInput.value = tempValue !== undefined ? tempValue : '';
      }
      document.getElementById('savePlayerBtn').textContent = 'Update Player';
      document.getElementById('cancelEditBtn').style.display = 'inline-block';
    }

    function cancelEdit() {
      resetPlayerForm();
    }

    function resetPlayerForm() {
      editingPlayerId = null;
      document.getElementById('number').value = '';
      document.getElementById('lastName').value = '';
      document.getElementById('initial').value = '';
      const tempInput = document.getElementById('tempNumber');
      if (tempInput) {
        tempInput.value = '';
      }
      document.getElementById('savePlayerBtn').textContent = 'Add Player';
      document.getElementById('cancelEditBtn').style.display = 'none';
    }

    function finalizeSet(setNumber) {
      const button = document.getElementById(`finalizeButton${setNumber}`);
      if (!button) return;
      const homeInput = document.getElementById(`set${setNumber}Home`);
      const oppInput = document.getElementById(`set${setNumber}Opp`);
      const homeRaw = homeInput ? homeInput.value.trim() : '';
      const oppRaw = oppInput ? oppInput.value.trim() : '';
      const homeScore = parseScoreValue(homeRaw);
      const oppScore = parseScoreValue(oppRaw);
      const scoresMissing = homeScore === null || oppScore === null;
      if (scoresMissing) {
        updateFinalizeButtonState(setNumber);
        showFinalizeMissingScorePopovers(setNumber);
        return;
      }
      if (homeScore === oppScore) {
        updateFinalizeButtonState(setNumber);
        showFinalizeTiePopovers(setNumber);
        return;
      }
      if (finalizedSets[setNumber]) {
        delete finalizedSets[setNumber];
      } else {
        finalizedSets[setNumber] = true;
      }
      updateFinalizeButtonState(setNumber);
      calculateResult();
      scheduleAutoSave();
    }

    function calculateResult() {
      let homeWins = 0;
      let oppWins = 0;
      for (let i = 1; i <= 5; i++) {
        if (finalizedSets[i]) {
          const homeScore = parseScoreValue(document.getElementById(`set${i}Home`).value);
          const oppScore = parseScoreValue(document.getElementById(`set${i}Opp`).value);
          if (homeScore === null || oppScore === null) {
            continue;
          }
          if (isSwapped) {
            if (oppScore > homeScore) homeWins++;
            else if (homeScore > oppScore) oppWins++;
          } else {
            if (homeScore > oppScore) homeWins++;
            else if (oppScore > homeScore) oppWins++;
          }
        }
      }
      document.getElementById('resultHome').value = Math.min(homeWins, 3);
      document.getElementById('resultOpp').value = Math.min(oppWins, 3);
    }


    function getSerializedSetTimeouts(setNumber) {
      const stored = getMatchTimeoutState(setNumber);
      return {
        home: stored.home.slice(0, TIMEOUT_COUNT).map(Boolean),
        opp: stored.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
      };
    }

    function collectSetFormState() {
      const states = {};
      SET_NUMBERS.forEach((setNumber) => {
        const homeInput = document.getElementById(`set${setNumber}Home`);
        const oppInput = document.getElementById(`set${setNumber}Opp`);
        const homeValue = homeInput ? homeInput.value : '';
        const oppValue = oppInput ? oppInput.value : '';
        states[setNumber] = {
          homeScore: parseScoreValue(homeValue),
          oppScore: parseScoreValue(oppValue),
          timeouts: getSerializedSetTimeouts(setNumber)
        };
      });
      return states;
    }

    function hasSetStateData(state) {
      if (!state) return false;
      const hasScores = state.homeScore !== null || state.oppScore !== null;
      const timeoutValues = [...(state.timeouts?.home || []), ...(state.timeouts?.opp || [])];
      const hasTimeouts = timeoutValues.some(Boolean);
      return hasScores || hasTimeouts;
    }

    function scoresEqual(a, b) {
      const normalize = (value) => {
        if (value === null || value === undefined || value === '') {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const left = normalize(a);
      const right = normalize(b);
      if (left === null && right === null) return true;
      return left === right;
    }

    async function applySetEdits(matchId, desiredStates) {
      if (!matchId || !desiredStates) return;
      for (const setNumber of SET_NUMBERS) {
        const desired = desiredStates[setNumber];
        const existing = getMatchSetRecord(setNumber);
        const hasData = hasSetStateData(desired);
        if (!hasData) {
          if (existing) {
            try {
              await apiClient.deleteSet(existing.id);
            } catch (error) {
              console.error(`Failed to delete set ${setNumber}`, error);
              throw error;
            }
            deleteMatchSetRecord(setNumber);
          }
          continue;
        }

        if (!existing) {
          try {
            const response = await apiClient.createSet({
              match_id: matchId,
              set_number: setNumber,
              home_score: desired.homeScore,
              opp_score: desired.oppScore,
              home_timeout_1: desired.timeouts.home[0] ? 1 : 0,
              home_timeout_2: desired.timeouts.home[1] ? 1 : 0,
              opp_timeout_1: desired.timeouts.opp[0] ? 1 : 0,
              opp_timeout_2: desired.timeouts.opp[1] ? 1 : 0
            });
            const newId = response?.id;
            if (newId !== undefined && newId !== null) {
              setMatchSetRecord(setNumber, {
                id: newId,
                homeScore: desired.homeScore,
                oppScore: desired.oppScore,
                timeouts: {
                  home: desired.timeouts.home.slice(0, TIMEOUT_COUNT).map(Boolean),
                  opp: desired.timeouts.opp.slice(0, TIMEOUT_COUNT).map(Boolean)
                }
              });
            }
          } catch (error) {
            console.error(`Failed to create set ${setNumber}`, error);
            throw error;
          }
          continue;
        }

        try {
          const setIsFinalized = Boolean(finalizedSets[setNumber]);
          const homeScoreChanged = !scoresEqual(existing.homeScore, desired.homeScore);
          const oppScoreChanged = !scoresEqual(existing.oppScore, desired.oppScore);

          if (homeScoreChanged) {
            if (!setIsFinalized) {
              await apiClient.updateSetScore(existing.id, 'home', desired.homeScore);
            } else {
              try {
                await apiClient.updateSetScore(existing.id, 'home', desired.homeScore);
              } catch (scoreError) {
                console.warn(`Unable to update finalized set ${setNumber} home score`, scoreError);
              }
            }
            existing.homeScore = desired.homeScore;
          }

          if (oppScoreChanged) {
            if (!setIsFinalized) {
              await apiClient.updateSetScore(existing.id, 'opp', desired.oppScore);
            } else {
              try {
                await apiClient.updateSetScore(existing.id, 'opp', desired.oppScore);
              } catch (scoreError) {
                console.warn(`Unable to update finalized set ${setNumber} opp score`, scoreError);
              }
            }
            existing.oppScore = desired.oppScore;
          }
          for (let index = 0; index < desired.timeouts.home.length; index += 1) {
            const value = desired.timeouts.home[index];
            const desiredBool = Boolean(value);
            if (Boolean(existing.timeouts.home[index]) !== desiredBool) {
              await apiClient.updateSetTimeout(existing.id, 'home', index + 1, desiredBool ? 1 : 0);
              existing.timeouts.home[index] = desiredBool;
            }
          }
          for (let index = 0; index < desired.timeouts.opp.length; index += 1) {
            const value = desired.timeouts.opp[index];
            const desiredBool = Boolean(value);
            if (Boolean(existing.timeouts.opp[index]) !== desiredBool) {
              await apiClient.updateSetTimeout(existing.id, 'opp', index + 1, desiredBool ? 1 : 0);
              existing.timeouts.opp[index] = desiredBool;
            }
          }
          setMatchSetRecord(setNumber, existing);
        } catch (error) {
          console.error(`Failed to update set ${setNumber}`, error);
          throw error;
        }
      }
    }


    async function saveMatch({ showAlert = false } = {}) {
      if (suppressAutoSave) return null;
      persistCurrentSetTimeouts();
      const form = document.getElementById('matchForm');
      if (form && !form.checkValidity()) {
        form.classList.add('was-validated');
        setAutoSaveStatus('Unable to save due to validation errors.', 'text-danger', 4000);
        return null;
      }
      const parseResultValue = (elementId) => {
        const element = document.getElementById(elementId);
        if (!element) return null;
        const value = parseInt(element.value, 10);
        return Number.isNaN(value) ? null : value;
      };
      const rosterSelections = [];
      const seenRosterIds = new Set();
      document.querySelectorAll('#playerList input[type="checkbox"]').forEach(cb => {
        if (!cb.checked) return;
        const playerId = normalizePlayerId(cb.dataset.playerId ?? cb.value);
        if (playerId === null || seenRosterIds.has(playerId)) {
          return;
        }
        seenRosterIds.add(playerId);
        const rosterEntry = { playerId };
        const tempValue = temporaryPlayerNumbers.get(playerId);
        if (tempValue !== null && tempValue !== undefined) {
          const tempString = String(tempValue).trim();
          if (tempString) {
            rosterEntry.tempNumber = tempString;
          }
        }
        rosterSelections.push(rosterEntry);
      });
      const normalizedRosterSelections = normalizeRosterArray(rosterSelections);

      const match = {
        date: document.getElementById('date').value,
        location: document.getElementById('location').value,
        types: {
          tournament: document.getElementById('tournament').checked,
          league: document.getElementById('league').checked,
          postSeason: document.getElementById('postSeason').checked,
          nonLeague: document.getElementById('nonLeague').checked
        },
        opponent: document.getElementById('opponent').value.trim() || 'Opponent',
        jerseyColorHome: document.getElementById('jerseyColorHome').value,
        jerseyColorOpp: document.getElementById('jerseyColorOpp').value,
        resultHome: parseResultValue('resultHome'),
        resultOpp: parseResultValue('resultOpp'),
        firstServer: document.getElementById('firstServer').value,
        players: normalizedRosterSelections,
        sets: {
          1: {
            home: normalizeScoreInputValue(document.getElementById('set1Home').value),
            opp: normalizeScoreInputValue(document.getElementById('set1Opp').value),
            timeouts: getSerializedSetTimeouts(1)
          },
          2: {
            home: normalizeScoreInputValue(document.getElementById('set2Home').value),
            opp: normalizeScoreInputValue(document.getElementById('set2Opp').value),
            timeouts: getSerializedSetTimeouts(2)
          },
          3: {
            home: normalizeScoreInputValue(document.getElementById('set3Home').value),
            opp: normalizeScoreInputValue(document.getElementById('set3Opp').value),
            timeouts: getSerializedSetTimeouts(3)
          },
          4: {
            home: normalizeScoreInputValue(document.getElementById('set4Home').value),
            opp: normalizeScoreInputValue(document.getElementById('set4Opp').value),
            timeouts: getSerializedSetTimeouts(4)
          },
          5: {
            home: normalizeScoreInputValue(document.getElementById('set5Home').value),
            opp: normalizeScoreInputValue(document.getElementById('set5Opp').value),
            timeouts: getSerializedSetTimeouts(5)
          }
        },
        finalizedSets: { ...finalizedSets },
        deleted: false
      };
      const { body } = apiClient.prepareMatchPayload(match);
      const setStates = collectSetFormState();
      const matchId = currentMatchId;
      loadedMatchPlayers = normalizedRosterSelections.map(entry => ({ ...entry }));
      try {
        const response = matchId !== null
          ? await apiClient.updateMatch(matchId, match)
          : await apiClient.createMatch(match);
        const savedId = response?.id ?? matchId ?? null;
        if (savedId !== null) {
          if (currentMatchId !== savedId) {
            currentMatchId = savedId;
            const newUrl = `${window.location.pathname}?matchId=${savedId}`;
            window.history.replaceState(null, '', newUrl);
          }
          await applySetEdits(savedId, setStates);
          await apiClient.updateFinalizedSets(savedId, body.finalized_sets);
        }
        hasPendingChanges = false;
        if (showAlert) {
          const url = `${window.location.href.split('?')[0]}${savedId ? `?matchId=${savedId}` : ''}`;
          alert(`Match ${matchId !== null ? 'updated' : 'saved'}! View it at: ${url}`);
        } else {
          setAutoSaveStatus('All changes saved.', 'text-success');
        }
        populateMatchIndexModal();
        return savedId;
      } catch (error) {
        console.error('Failed to save match', error);
        if (showAlert) {
          alert('Unable to save match. Please try again.');
        } else {
          setAutoSaveStatus('Error saving changes.', 'text-danger', 4000);
        }
        throw error;
      }
    }
    
    async function deleteMatch(matchId) {
      if (!confirm('Delete this match?')) return;
      try {
        await apiClient.deleteMatch(matchId);
        const urlParams = new URLSearchParams(window.location.search);
        const currentMatchIdParam = urlParams.get('matchId');
        if (currentMatchIdParam && parseInt(currentMatchIdParam, 10) === matchId) {
          window.location.href = window.location.href.split('?')[0];
        } else {
          await populateMatchIndexModal();
        }
      } catch (error) {
        console.error('Failed to delete match', error);
        alert('Unable to delete match. Please try again.');
      }
    }


    function applyTemporaryNumbersFromRoster(roster) {
      if (!Array.isArray(roster)) {
        return;
      }
      roster.forEach(entry => {
        const normalized = normalizeRosterEntry(entry);
        if (!normalized) {
          return;
        }
        const { playerId, tempNumber } = normalized;
        if (tempNumber) {
          temporaryPlayerNumbers.set(playerId, tempNumber);
        } else {
          temporaryPlayerNumbers.delete(playerId);
        }
      });
    }

    function convertLegacyRosterEntries(legacyRoster) {
      if (!Array.isArray(legacyRoster) || legacyRoster.length === 0) {
        return [];
      }
      const lookup = new Map();
      playerRecords.forEach(record => {
        const recordId = normalizePlayerId(record.id);
        if (recordId === null) {
          return;
        }
        const key = formatLegacyPlayerRecord(record).toLocaleLowerCase();
        if (!key || lookup.has(key)) {
          return;
        }
        lookup.set(key, recordId);
      });
      const converted = [];
      const seen = new Set();
      legacyRoster.forEach(entry => {
        if (typeof entry !== 'string') {
          return;
        }
        const normalizedKey = entry.trim().toLocaleLowerCase();
        if (!normalizedKey) {
          return;
        }
        const playerId = lookup.get(normalizedKey);
        if (!playerId || seen.has(playerId)) {
          return;
        }
        seen.add(playerId);
        converted.push({ playerId });
      });
      return converted;
    }

    function extractRosterFromMatch(match) {
      if (!match) {
        return [];
      }
      const structuredRoster = normalizeRosterArray(match.players);
      if (structuredRoster.length > 0) {
        return structuredRoster;
      }
      if (Array.isArray(match.legacyPlayers) && match.legacyPlayers.length > 0) {
        return normalizeRosterArray(convertLegacyRosterEntries(match.legacyPlayers));
      }
      return [];
    }



    async function loadMatchFromUrl() {
      const urlParams = new URLSearchParams(window.location.search);
      const matchId = urlParams.get('matchId');
      suppressAutoSave = true;
      isSwapped = false;
      const existingOpponentInput = document.getElementById('opponent');
      if (existingOpponentInput) {
        const currentOpponent = existingOpponentInput.value.trim() || 'Opponent';
        updateSetHeaders(currentOpponent, isSwapped);
      }
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }
      if (autoSaveStatusTimeout) {
        clearTimeout(autoSaveStatusTimeout);
        autoSaveStatusTimeout = null;
      }
      const form = document.getElementById('matchForm');
      if (form) {
        form.classList.remove('was-validated');
      }
      const resetFinalizeButtons = () => {
        for (let i = 1; i <= 5; i++) {
          const button = document.getElementById(`finalizeButton${i}`);
          if (button) {
            button.classList.remove('finalized-btn');
          }
        }
      };
      resetAllTimeouts({ resetStored: true });
      resetMatchSetRecords();
      if (matchId) {
        try {
          const match = await apiClient.getMatch(matchId);
          if (match) {
            currentMatchId = match.id;
            const roster = extractRosterFromMatch(match);
            loadedMatchPlayers = roster.map(entry => ({ ...entry }));
            match.players = loadedMatchPlayers.map(entry => ({ ...entry }));
            applyTemporaryNumbersFromRoster(loadedMatchPlayers);
            document.getElementById('date').value = match.date || '';
            document.getElementById('location').value = match.location || '';
            document.getElementById('tournament').checked = Boolean(match.types?.tournament);
            document.getElementById('league').checked = Boolean(match.types?.league);
            document.getElementById('postSeason').checked = Boolean(match.types?.postSeason);
            document.getElementById('nonLeague').checked = Boolean(match.types?.nonLeague);
            document.getElementById('opponent').value = match.opponent || '';
            document.getElementById('jerseyColorHome').value = match.jerseyColorHome || 'white';
            document.getElementById('jerseyColorOpp').value = match.jerseyColorOpp || 'white';
            refreshJerseySelectDisplays();
            ensureDistinctJerseyColors(document.getElementById('jerseyColorHome'), { showModal: false });
            applyJerseyColorToNumbers();
            document.getElementById('resultHome').value = match.resultHome ?? 0;
            document.getElementById('resultOpp').value = match.resultOpp ?? 0;
            const storedFirstServer = match.firstServer || '';
            updateOpponentName();
            setFirstServerSelection(storedFirstServer);
            const setRows = match.id ? await apiClient.getMatchSets(match.id) : [];
            const setsFromRows = primeMatchSetRecords(setRows);
            const combinedSets = Object.keys(setsFromRows).length > 0 ? setsFromRows : match.sets;
            for (let i = 1; i <= 5; i++) {
              const homeInput = document.getElementById(`set${i}Home`);
              const oppInput = document.getElementById(`set${i}Opp`);
              if (homeInput) {
                homeInput.value = normalizeStoredScoreValue(combinedSets?.[i]?.home);
              }
              if (oppInput) {
                oppInput.value = normalizeStoredScoreValue(combinedSets?.[i]?.opp);
              }
            }
            SET_NUMBERS.forEach((setNumber) => {
              const setData = combinedSets?.[setNumber] ?? combinedSets?.[String(setNumber)];
              setMatchTimeoutState(setNumber, setData?.timeouts);
            });
            finalizedSets = { ...(match.finalizedSets || {}) };
            resetFinalizeButtons();
            for (let i = 1; i <= 5; i++) {
              if (finalizedSets[i]) {
                const button = document.getElementById(`finalizeButton${i}`);
                if (button) {
                  button.classList.add('finalized-btn');
                }
              }
            }
            updateAllFinalizeButtonStates();
            calculateResult();
          } else {
            currentMatchId = null;
            loadedMatchPlayers = [];
            finalizedSets = {};
            resetFinalizeButtons();
          }
        } catch (error) {
          console.error('Failed to load match', error);
          setAutoSaveStatus('Unable to load match data.', 'text-danger', 4000);
          currentMatchId = null;
          loadedMatchPlayers = [];
          finalizedSets = {};
          resetFinalizeButtons();
        }
      } else {
        currentMatchId = matchId ? parseInt(matchId, 10) : null;
        loadedMatchPlayers = [];
        finalizedSets = {};
        resetFinalizeButtons();
      }
      setPlayerRecords(playerRecords);
      hasPendingChanges = false;
      suppressAutoSave = false;
    }


    
    async function populateMatchIndexModal() {
      const modal = document.getElementById('matchIndexModal');
      const matchList = document.getElementById('matchList');
      matchList.innerHTML = '';
      try {
        const matches = await apiClient.listMatches();
        const sortedMatches = Array.isArray(matches)
          ? matches.slice().sort((a, b) => {
              const dateA = a.date ? new Date(a.date) : new Date(0);
              const dateB = b.date ? new Date(b.date) : new Date(0);
              if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
              return (a.opponent || '').localeCompare(b.opponent || '');
            })
          : [];
        if (sortedMatches.length === 0) {
          const emptyItem = document.createElement('li');
          emptyItem.className = 'list-group-item text-center text-muted';
          emptyItem.textContent = 'No matches saved yet.';
          matchList.appendChild(emptyItem);
        } else {
          sortedMatches.forEach(match => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.style.cursor = 'pointer';
            const date = match.date ? new Date(match.date).toLocaleString() : 'Unknown date';
            const opponentName = match.opponent || 'Opponent';
            const matchInfo = document.createElement('span');
            matchInfo.className = 'flex-grow-1 me-3';
            matchInfo.textContent = `${date} - ${opponentName}`;
            li.appendChild(matchInfo);

            li.onclick = () => {
              window.location.href = `${window.location.href.split('?')[0]}?matchId=${match.id}`;
              closeMatchIndexModal();
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-danger btn-sm';
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = async (event) => {
              event.stopPropagation();
              await deleteMatch(match.id);
            };
            li.appendChild(deleteBtn);

            matchList.appendChild(li);
          });
        }
        const modalInstance = modal ? bootstrap.Modal.getInstance(modal) : null;
        if (modalInstance) {
          modalInstance.handleUpdate();
        }
      } catch (error) {
        console.error('Failed to load matches', error);
        const errorItem = document.createElement('li');
        errorItem.className = 'list-group-item text-center text-danger';
        errorItem.textContent = 'Unable to load matches. Please try again later.';
        matchList.appendChild(errorItem);
      }
    }


    function closeMatchIndexModal() {
      const modalElement = document.getElementById('matchIndexModal');
      if (!modalElement) return;
      const modalInstance = bootstrap.Modal.getInstance(modalElement);
      if (modalInstance) {
        modalInstance.hide();
      }
    }

    function startNewMatch() {
      if (hasPendingChanges && !confirm('Start a new match? Unsaved changes will be lost.')) return;
      suppressAutoSave = true;
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }
      if (autoSaveStatusTimeout) {
        clearTimeout(autoSaveStatusTimeout);
        autoSaveStatusTimeout = null;
      }
      currentMatchId = null;
      loadedMatchPlayers = [];
      finalizedSets = {};
      isSwapped = false;

      const form = document.getElementById('matchForm');
      if (form) {
        form.reset();
        form.classList.remove('was-validated');
      }

      for (let i = 1; i <= 5; i++) {
        const homeInput = document.getElementById(`set${i}Home`);
        const oppInput = document.getElementById(`set${i}Opp`);
        const finalizeButton = document.getElementById(`finalizeButton${i}`);
        if (homeInput) homeInput.value = '';
        if (oppInput) oppInput.value = '';
        if (finalizeButton) finalizeButton.classList.remove('finalized-btn');
      }
      updateAllFinalizeButtonStates();

      document.querySelectorAll('#playerList input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });

      resetAllTimeouts({ resetStored: true });
      resetMatchSetRecords();
      scoreGameState.home = null;
      scoreGameState.opp = null;
      updateScoreModalDisplay();

      const baseUrl = window.location.href.split('?')[0];
      window.history.replaceState(null, '', baseUrl);

      const dateInput = document.getElementById('date');
      if (dateInput && !dateInput.value) {
        const now = new Date();
        const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        dateInput.value = offsetDate.toISOString().slice(0, 16);
      }

      updateOpponentName();
      updateFirstServeOptions();
      refreshJerseySelectDisplays();
      ensureDistinctJerseyColors(document.getElementById('jerseyColorHome'), { showModal: false });
      applyJerseyColorToNumbers();
      setAutoSaveStatus('Ready for a new match.', 'text-info', 3000);

      hasPendingChanges = false;
      suppressAutoSave = false;
    }

    document.addEventListener('DOMContentLoaded', async function() {
      await initializeHomeTeam();
      initializeTeamHeaderPopovers();
      refreshAllTeamHeaderButtons();
      window.addEventListener('resize', refreshAllTeamHeaderButtons);
      const dateInput = document.getElementById('date');
      if (dateInput && !dateInput.value) {
        const now = new Date();
        const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        dateInput.value = offsetDate.toISOString().slice(0, 16);
      }
      const opponentInput = document.getElementById('opponent');
      opponentInput.addEventListener('input', () => {
        updateOpponentName();
        scheduleAutoSave();
      });
      jerseyConflictModalMessageElement = document.getElementById('jerseyConflictModalMessage');
      const jerseyConflictModalElement = document.getElementById('jerseyConflictModal');
      if (jerseyConflictModalElement) {
        jerseyConflictModalInstance = new bootstrap.Modal(jerseyConflictModalElement);
      }
      initializeJerseySelect(document.getElementById('jerseyColorHome'), { applyToNumbers: true });
      initializeJerseySelect(document.getElementById('jerseyColorOpp'));
      setupJerseyThemeObserver();
      handleJerseyThemeChange();
      ensureDistinctJerseyColors(document.getElementById('jerseyColorHome'), { showModal: false });
      const sortToggleBtn = document.getElementById('playerSortToggleBtn');
      if (sortToggleBtn) {
        sortToggleBtn.addEventListener('click', () => {
          togglePlayerSortMode();
        });
        updatePlayerSortToggle();
      }
      const modalSortSelect = document.getElementById('modalPlayerSortSelect');
      if (modalSortSelect) {
        modalSortSelect.addEventListener('change', (event) => {
          setPlayerSortMode(event.target.value);
        });
        modalSortSelect.value = playerSortMode;
      }
      const autoSaveTargets = document.querySelector('.container');
      if (autoSaveTargets) {
        autoSaveTargets.addEventListener('input', (event) => {
          if (event.target.closest('#playerModal')) return;
          maybeRecalculateFinalResult(event.target);
          scheduleAutoSave();
        });
        autoSaveTargets.addEventListener('change', (event) => {
          if (event.target.closest('#playerModal')) return;
          maybeRecalculateFinalResult(event.target);
          scheduleAutoSave();
        });
      }
      const matchIndexModal = document.getElementById('matchIndexModal');
      if (matchIndexModal) {
        matchIndexModal.addEventListener('show.bs.modal', populateMatchIndexModal);
      }
      const scoreGameModalElement = document.getElementById('scoreGameModal');
      if (scoreGameModalElement) {
        scoreGameModalInstance = new bootstrap.Modal(scoreGameModalElement);
        const handleScoreModalResize = () => {
          if (scoreGameModalElement.classList.contains('show')) {
            updateScoreGameModalLayout();
          }
        };
        scoreGameModalElement.addEventListener('show.bs.modal', () => {
          setScoreModalBackgroundLock(true);
          updateScoreGameModalLayout();
          updateTimeoutTimerDisplay();
        });
        scoreGameModalElement.addEventListener('shown.bs.modal', () => {
          updateScoreGameModalLayout();
          updateTimeoutTimerDisplay();
          updateTimeoutLayoutForSwap();
        });
        scoreGameModalElement.addEventListener('hidden.bs.modal', () => {
          setScoreModalBackgroundLock(false);
          persistCurrentSetTimeouts();
          cancelActiveTimeoutTimer();
          scoreGameState.setNumber = null;
          scoreGameState.home = null;
          scoreGameState.opp = null;
          updateScoreModalDisplay();
          refreshAllTimeoutDisplays();
        });
        window.addEventListener('resize', handleScoreModalResize);
        const scoreZones = scoreGameModalElement.querySelectorAll('.score-zone');
        scoreZones.forEach(zone => {
          const team = zone.getAttribute('data-team');
          const action = zone.getAttribute('data-action');
          const delta = action === 'increment' ? 1 : -1;
          zone.addEventListener('click', () => adjustScoreModal(team, delta));
          zone.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              adjustScoreModal(team, delta);
            } else if (event.key === 'ArrowUp' && action === 'increment') {
              event.preventDefault();
              adjustScoreModal(team, 1);
            } else if (event.key === 'ArrowDown' && action === 'decrement') {
              event.preventDefault();
              adjustScoreModal(team, -1);
            }
          });
        });
        const timeoutButtons = scoreGameModalElement.querySelectorAll('.timeout-box');
        timeoutButtons.forEach(button => {
          const team = button.getAttribute('data-team');
          const index = parseInt(button.getAttribute('data-timeout-index'), 10);
          if (!team || Number.isNaN(index)) return;
          button.addEventListener('click', (event) => handleTimeoutSelection(team, index, event));
        });
        scoreGameModalElement.addEventListener('click', (event) => {
          if (!getRunningTimeoutTeam()) {
            return;
          }
          if (event.target.closest('.timeout-box') || event.target.closest('.timeout-timer-display')) {
            return;
          }
          cancelActiveTimeoutTimer();
        });
        const modalSwapButton = document.getElementById('scoreModalSwapBtn');
        if (modalSwapButton) {
          modalSwapButton.addEventListener('click', swapScores);
        }
        resetAllTimeouts({ resetStored: true });
      }
      document.querySelectorAll('.score-game-btn').forEach(button => {
        button.addEventListener('click', (event) => {
          const setNumber = parseInt(button.getAttribute('data-set'), 10);
          if (Number.isNaN(setNumber)) {
            return;
          }
          if (button.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          const didOpen = openScoreGameModal(setNumber);
          if (!didOpen) {
            event.preventDefault();
            event.stopPropagation();
          }
        });
      });
      for (let i = 1; i <= 5; i++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `finalizeButton${i}`;
        button.className = 'btn btn-primary finalize-button';
        button.innerHTML = `
          <span class="finalize-button-label">Final</span>
          <span class="finalize-button-hazard">
            <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
            <span class="visually-hidden">Set score is tied. Adjust before finalizing.</span>
          </span>
        `;
        button.onclick = () => finalizeSet(i);
        const oppCell = document.getElementById(`set${i}Opp`);
        if (!oppCell) continue;
        const actionCell = oppCell.parentElement ? oppCell.parentElement.nextElementSibling : null;
        if (!actionCell) continue;
        const stack = actionCell.querySelector('.set-actions-stack') || actionCell;
        stack.appendChild(button);
      }
      updateAllFinalizeButtonStates();

      (async () => {
        try {
          await seedDemoPlayersIfEmpty();
        } catch (error) {
          console.error('Failed during initial player seeding', error);
        }
        await loadPlayers();
        await loadMatchFromUrl();
      })();
    });
