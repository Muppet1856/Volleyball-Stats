// ui/renderHelpers.js (new: shared render logic)
import { state } from '../state.js';

// Apply disables based on first un-finalized set
export function applyDisableLogic() {
  const setNumbers = Object.keys(state.sets).map(Number).sort((a, b) => a - b);
  let firstUnfinalized = null;
  for (const num of setNumbers) {
    if (!state.sets[num].finalized) {
      firstUnfinalized = num;
      break;
    }
  }

  setNumbers.forEach(num => {
    const isDisabled = firstUnfinalized !== null && num > firstUnfinalized;
    // Disable table inputs
    const homeInput = document.getElementById(`set${num}Home`);
    const oppInput = document.getElementById(`set${num}Opp`);
    if (homeInput) homeInput.disabled = isDisabled || state.sets[num].finalized; // Also disable if finalized
    if (oppInput) oppInput.disabled = isDisabled || state.sets[num].finalized;

    // Disable modal open buttons
    const modalBtn = document.querySelector(`[data-bs-toggle="modal"][data-set="${num}"]`);
    if (modalBtn) modalBtn.disabled = isDisabled;

    // Optional: Disable finalize btn if prior sets unfinalized
    const finalizeBtn = document.querySelector(`.finalize-btn[data-set="${num}"]`);
    if (finalizeBtn) finalizeBtn.disabled = num > (firstUnfinalized || 0);
  });
}

// Render match results (assume <div id="matchResults"></div> in HTML)
export function renderMatchResults() {
  const resultsDiv = document.getElementById('matchResults');
  if (!resultsDiv) return;

  const homeWins = state.matchWins.home;
  const oppWins = state.matchWins.opp;
  const winnerText = state.overallWinner 
    ? `${state[state.overallWinner + 'Team']} wins the match ${homeWins}-${oppWins}!` 
    : `Current match score: ${state.homeTeam} ${homeWins} - ${oppWins} ${state.opponent}`;

  resultsDiv.innerHTML = `
    <h4>${winnerText}</h4>
    ${state.overallWinner ? '<p>Match complete!</p>' : '<p>Ongoing match.</p>'}
  `;
}