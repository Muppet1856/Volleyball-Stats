// js/init/homeTeam.js
export async function initializeHomeTeam() {
  const HOME_TEAM_FALLBACK = 'Home Team';
  const pattern = /\{homeTeam\}/g;
  let homeName = HOME_TEAM_FALLBACK;

  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const data = await response.json();
      if (typeof data?.homeTeam === 'string' && data.homeTeam.trim()) {
        homeName = data.homeTeam.trim();
      }
    }
  } catch (_e) {
    // noop
  }

  updateState({ homeTeam: homeName });

  document.querySelectorAll('[data-home-team-template]').forEach(el => {
    const tmpl = el.getAttribute('data-home-team-template');
    if (tmpl) el.textContent = tmpl.replace(pattern, homeName);
  });

  // Trigger opponent update in case opponent field is pre-filled
  if (typeof window.updateOpponentName === 'function') {
    window.updateOpponentName();
  }
    
}
