// public/js/home_team.js
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
