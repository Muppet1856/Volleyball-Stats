// volleyball_stats.js — the only file loaded in <script type="module">
import './state.js';
import { initializeHomeTeam } from './init/homeTeam.js';
import { setDefaultDate } from './init/date.js';
import { enhanceJerseySelectsCustom } from './init/jerseyColors.js';
import { swapConfig , mainSwap } from './ui/swap.js';
import { debouncedOpponentUpdate , updateOpponentName} from './ui/opponentName.js';
import './ui/scoreModals.js';
import './ui/finalizeButtons.js';

//import { loadPlayers, seedDemoPlayersIfEmpty } from './players/loader.js';
//import { loadMatchFromUrl } from './match/loader.js';  // new file

document.addEventListener('DOMContentLoaded', async () => {
  await initializeHomeTeam();
  await setDefaultDate();
  await enhanceJerseySelectsCustom();
  const opponentInput = document.getElementById('opponent');
  if (opponentInput) {
    opponentInput.addEventListener('input', debouncedOpponentUpdate);
  }
  const swapButton = document.getElementById('swapTeamsBtn');
  if (swapButton) {
    swapButton.addEventListener('click', () => {
      mainSwap(swapConfig);
    });
  } else {
    console.warn('Swap button not found.');
  }
  const modalSwapButton = document.getElementById('scoreModalSwapBtn');
  if (modalSwapButton) {
    modalSwapButton.addEventListener('click', () => {
      mainSwap(swapConfig);
      // Optional: Toggle button text or state if you want to indicate swap/revert
      // e.g., swapButton.textContent = swapButton.textContent === 'Swap Teams' ? 'Revert Swap' : 'Swap Teams';
    });
  } else {
    console.warn('Modal swap button not found.');
  }
  
  //await updateOpponentName();  // Add here for initial fallback render post-DOM
  document.getElementById('loader').style.display = 'none';
  document.getElementById('main-content').style.visibility = 'visible';
});
