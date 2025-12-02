// js/volleyball_stats.js
import { state } from './state.js';
import { initializeHomeTeam } from './init/homeTeam.js';
import { setDefaultDate } from './init/date.js';
import { enhanceJerseySelectsCustom } from './init/jerseyColors.js';
import { swapConfig , mainSwap } from './ui/swap.js';
import { initSavedMatchesModal } from './api/matches.js';
import { initMatchCreate } from './api/matchCreate.js';
import { initMatchMetaAutosave, loadMatchFromUrl } from './api/matchMetaAutosave.js';
import { initMatchLiveSync } from './api/matchLiveSync.js';
import { hydrateScores } from './api/scoring.js';
import './ui/scoreModals.js';
import './ui/finalizeButtons.js';
import './ui/resultSummary.js';  // New import to load the result summary logic
import './ui/players.js';
import './ui/shareControls.js';

document.addEventListener('DOMContentLoaded', async () => {
  await initializeHomeTeam();
  await setDefaultDate();
  await enhanceJerseySelectsCustom();
  const swapButton = document.getElementById('swapTeamsBtn');
  if (swapButton) {
    swapButton.addEventListener('click', () => {
      mainSwap(swapConfig);
      // Optional: Toggle button text or state if you want to indicate swap/revert
      // e.g., swapButton.textContent = swapButton.textContent === 'Swap Teams' ? 'Revert Swap' : 'Swap Teams';
    });
  }
  const modalSwapButton = document.getElementById('scoreModalSwapBtn');
  if (modalSwapButton) {
    modalSwapButton.addEventListener('click', () => {
      mainSwap(swapConfig);
      // Optional: Toggle button text or state if you want to indicate swap/revert
      // e.g., swapButton.textContent = swapButton.textContent === 'Swap Teams' ? 'Revert Swap' : 'Swap Teams';
    });
  }
  
  //await updateOpponentName();  // Add here for initial fallback render post-DOM
  initMatchMetaAutosave();
  await loadMatchFromUrl();
  await hydrateScores();
  initMatchLiveSync();
  initSavedMatchesModal();
  initMatchCreate();
  document.getElementById('loader').style.display = 'none';
  document.getElementById('main-content').style.visibility = 'visible';
});
