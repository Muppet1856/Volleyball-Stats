// ui/renderScoringModal.js (updated to respect initial DOM if needed, but primarily use state)
import { state } from '../state.js';
import { getActiveTimeout, getRemaining } from './timeOut.js';

function padScore(score) {
  return String(score).padStart(2, '0');
}

export function renderModal() {
  if (!state.isModalOpen || !state.currentSet) return;

  const setData = state.sets[state.currentSet];
  const homeTeam = state.isDisplaySwapped ? state.opponent : state.homeTeam;
  const oppTeam = state.isDisplaySwapped ? state.homeTeam : state.opponent;

  // Update labels using state (which now has the fetched value)
  document.getElementById('scoreGameLeftLabel').textContent = homeTeam;
  document.getElementById('scoreGameRightLabel').textContent = oppTeam;

  // Update scores
  document.getElementById('scoreGameHomeDisplay').textContent = padScore(setData.scores.home);
  document.getElementById('scoreGameOppDisplay').textContent = padScore(setData.scores.opp);

  // Sync to table inputs
  const homeInput = document.getElementById(`set${state.currentSet}Home`);
  const oppInput = document.getElementById(`set${state.currentSet}Opp`);
  if (homeInput) homeInput.value = setData.scores.home;
  if (oppInput) oppInput.value = setData.scores.opp;

  // Update timeout boxes (from persistent state)
  const timeoutBoxes = document.querySelectorAll('.timeout-box');
  timeoutBoxes.forEach(box => {
    const team = box.dataset.team;
    const index = parseInt(box.dataset.timeoutIndex);
    const used = setData.timeouts[team][index];
    box.setAttribute('aria-pressed', used ? 'true' : 'false');
    box.classList.toggle('used', used);
    box.classList.toggle('available', !used);

    const active = getActiveTimeout();
    box.classList.toggle('active', active?.team === team && active?.index === index);

    const teamName = team === 'home' ? homeTeam : oppTeam;
    const ord = index + 1 === 1 ? 'first' : 'second';
    box.setAttribute('aria-label', `${teamName} ${ord} timeout ${used ? 'used' : 'available'}`);
  });

  // Update timeout display/timer (transient)
  const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
  const container = document.getElementById('timeoutContainer');
  const bar = document.getElementById('scoreGameTimeoutSrStatus');
  const label = document.getElementById('timeoutCenteredLabel');

  const active = getActiveTimeout();
  if (active) {
    const activeTeamName = active.team === 'home' ? homeTeam : oppTeam;
    timeoutDisplay.textContent = `Timeout: ${activeTeamName}`;
    container.style.display = 'block';

    bar.classList.remove('bg-primary', 'bg-danger');
    bar.classList.add(active.isBlue ? 'bg-primary' : 'bg-danger');

    const remainingVal = getRemaining();
    const duration = 60;
    const pct = (Math.max(remainingVal, 0) / duration) * 100;
    bar.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', remainingVal);
    const mm = Math.floor(remainingVal / 60);
    const ss = String(remainingVal % 60).padStart(2, '0');
    label.textContent = `${mm}:${ss}`;
  } else {
    timeoutDisplay.textContent = '';
    container.style.display = 'none';
    if (bar) bar.style.width = '0%';
    if (label) label.textContent = '';
  }
}