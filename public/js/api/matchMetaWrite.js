// js/api/matchMetaWrite.js
// Debounced writes for match metadata fields.
import { debounce } from '../utils/debounce.js';
import {
  setMatchDateTime,
  setMatchFirstServer,
  setMatchHomeColor,
  setMatchLocation,
  setMatchOppName,
  setMatchOppColor,
  setMatchType,
} from './ws.js';

const SAVE_DELAY_MS = 800;

function normalizeMatchId(matchId) {
  const parsed = Number(matchId);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeSelectValue(value) {
  const normalized = normalizeText(value);
  return normalized === null ? null : normalized;
}

function serializeTypeSelection(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '{}';
  try {
    return JSON.stringify({ [normalized]: true });
  } catch (error) {
    return '{}';
  }
}

function logMissingMatchId(field) {
  console.warn(`Cannot save ${field} without a valid matchId.`);
}

const debouncedLocationWrite = debounce((matchId, value) => {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) {
    logMissingMatchId('location');
    return;
  }
  const location = normalizeText(value);
  setMatchLocation(normalizedId, location).catch((error) => {
    console.error('Failed to save location:', error);
  });
}, SAVE_DELAY_MS);

const debouncedOpponentWrite = debounce((matchId, value) => {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) {
    logMissingMatchId('opponent');
    return;
  }
  const opponent = normalizeText(value);
  setMatchOppName(normalizedId, opponent).catch((error) => {
    console.error('Failed to save opponent:', error);
  });
}, SAVE_DELAY_MS);

const debouncedDateWrite = debounce((matchId, value) => {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) {
    logMissingMatchId('date');
    return;
  }
  const date = normalizeText(value);
  setMatchDateTime(normalizedId, date).catch((error) => {
    console.error('Failed to save date:', error);
  });
}, SAVE_DELAY_MS);

const debouncedTypeWrite = debounce((matchId, value) => {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) {
    logMissingMatchId('type');
    return;
  }
  const serialized = serializeTypeSelection(value);
  setMatchType(normalizedId, serialized).catch((error) => {
    console.error('Failed to save type:', error);
  });
}, SAVE_DELAY_MS);

const debouncedFirstServerWrite = debounce((matchId, value) => {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) {
    logMissingMatchId('firstServer');
    return;
  }
  const firstServer = normalizeSelectValue(value);
  setMatchFirstServer(normalizedId, firstServer).catch((error) => {
    console.error('Failed to save first server:', error);
  });
}, SAVE_DELAY_MS);

const debouncedHomeJerseyWrite = debounce((matchId, value) => {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) {
    logMissingMatchId('home jersey color');
    return;
  }
  const jerseyColorHome = normalizeSelectValue(value);
  setMatchHomeColor(normalizedId, jerseyColorHome).catch((error) => {
    console.error('Failed to save home jersey color:', error);
  });
}, SAVE_DELAY_MS);

const debouncedOppJerseyWrite = debounce((matchId, value) => {
  const normalizedId = normalizeMatchId(matchId);
  if (!normalizedId) {
    logMissingMatchId('opponent jersey color');
    return;
  }
  const jerseyColorOpp = normalizeSelectValue(value);
  setMatchOppColor(normalizedId, jerseyColorOpp).catch((error) => {
    console.error('Failed to save opponent jersey color:', error);
  });
}, SAVE_DELAY_MS);

export function writeLocation(matchId, location) {
  debouncedLocationWrite(matchId, location);
}

export function writeOpponent(matchId, opponent) {
  debouncedOpponentWrite(matchId, opponent);
}

export function writeDate(matchId, date) {
  debouncedDateWrite(matchId, date);
}

export function writeType(matchId, value) {
  debouncedTypeWrite(matchId, value);
}

export function writeFirstServer(matchId, value) {
  debouncedFirstServerWrite(matchId, value);
}

export function writeHomeJerseyColor(matchId, value) {
  debouncedHomeJerseyWrite(matchId, value);
}

export function writeOppJerseyColor(matchId, value) {
  debouncedOppJerseyWrite(matchId, value);
}

export default {
  writeLocation,
  writeOpponent,
  writeDate,
  writeType,
  writeFirstServer,
  writeHomeJerseyColor,
  writeOppJerseyColor,
};
