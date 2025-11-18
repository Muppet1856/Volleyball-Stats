// public/js/utils.js
(function (global) {
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

  const SCORE_FINALIZED_BACKGROUND_BLEND = 0.5;
  const SCORE_FINALIZED_TEXT_BLEND = 0.35;
  const SCORE_FINALIZED_GRAY_COLOR = { r: 173, g: 181, b: 189, a: 1 };

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
    if (!colorString || typeof document === 'undefined') return null;
    const temp = document.createElement('div');
    temp.style.color = colorString;
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);
    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/i);
    if (!match) return null;
    const [, r, g, b, a] = match;
    const blendRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : SCORE_FINALIZED_BACKGROUND_BLEND;
    const gray = SCORE_FINALIZED_GRAY_COLOR;
    return {
      r: Number(r) * (1 - blendRatio) + gray.r * blendRatio,
      g: Number(g) * (1 - blendRatio) + gray.g * blendRatio,
      b: Number(b) * (1 - blendRatio) + gray.b * blendRatio,
      a: a !== undefined ? Number(a) : 1
    };
  }

  const exported = {
    normalizePlayerId,
    normalizeRosterEntry,
    normalizeRosterArray,
    SCORE_FINALIZED_BACKGROUND_BLEND,
    SCORE_FINALIZED_TEXT_BLEND,
    SCORE_FINALIZED_GRAY_COLOR,
    clampScoreValue,
    parseScoreValue,
    formatScoreInputValue,
    formatScoreDisplay,
    normalizeScoreInputValue,
    normalizeStoredScoreValue,
    colorObjectToCss,
    mixColorWithGray
  };

  Object.assign(global, exported);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
