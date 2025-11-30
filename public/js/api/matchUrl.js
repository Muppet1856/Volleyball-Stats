const MATCH_QUERY_KEYS = ['match', 'matchId', 'matchid'];

export function removeMatchParamsFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  let changed = false;
  MATCH_QUERY_KEYS.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) {
    const next = `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}`;
    window.history.replaceState({}, document.title, next);
  }
}

export function updateUrlWithMatchId(matchId) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const normalized = Number(matchId);
  if (!Number.isFinite(normalized) || normalized <= 0) return;
  const url = new URL(window.location.href);
  MATCH_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.set('match', normalized);
  const next = `${url.pathname}?${url.searchParams.toString()}`;
  window.history.replaceState({}, document.title, next);
}

export default {
  removeMatchParamsFromUrl,
  updateUrlWithMatchId,
};
