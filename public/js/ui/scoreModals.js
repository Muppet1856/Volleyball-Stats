// Updated ui/scoreModals.js (full replacement with per-set persistence)
import { startTimeoutCountdown, resetTimeoutCountdown } from './timeOut.js';
import { state } from '../state.js'; // Add this import

// Function to pad scores to two digits
function padScore(score) {
  return String(score).padStart(2, '0');
}

// Handle modal show event to load scores from the calling set
const scoreGameModal = document.getElementById('scoreGameModal');
if (scoreGameModal) {
  scoreGameModal.addEventListener('show.bs.modal', (event) => {
    const button = event.relatedTarget; // The button that triggered the modal
    const setNumber = button.getAttribute('data-set');
    if (!setNumber) return;

    // Store the current set on the modal for later reference
    scoreGameModal.dataset.currentSet = setNumber;

    // Load scores from the table inputs
    const homeInput = document.getElementById(`set${setNumber}Home`);
    const oppInput = document.getElementById(`set${setNumber}Opp`);
    const homeDisplay = document.getElementById('scoreGameHomeDisplay');
    const oppDisplay = document.getElementById('scoreGameOppDisplay');

    if (homeInput && oppInput && homeDisplay && oppDisplay) {
      homeDisplay.textContent = padScore(homeInput.value || 0);
      oppDisplay.textContent = padScore(oppInput.value || 0);
    }

    loadTimeoutStates(setNumber);
  });

  scoreGameModal.addEventListener('hidden.bs.modal', () => {
    const setNumber = scoreGameModal.dataset.currentSet;
    if (setNumber) {
      const setState = state.setTimeoutStates[setNumber];
      const bar = document.getElementById('scoreGameTimeoutSrStatus');
      const currentRemaining = parseInt(bar?.getAttribute('aria-valuenow') || '0', 10);
      setState.remaining = currentRemaining;

      if (currentRemaining <= 0) {
        setState.activeTeam = null;
        setState.activeIndex = null;
      }

      saveTimeoutStates(setNumber); // Save used and active
    }

    // Clean up UI
    const boxes = document.querySelectorAll('.timeout-box');
    boxes.forEach(box => {
      box.setAttribute('aria-pressed', 'false');
      box.classList.remove('active');
    });

    const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');
    if (timeoutDisplay) timeoutDisplay.textContent = '';
    resetTimeoutCountdown();
  });
}

// Handle score changes via increment/decrement zones
function handleScoreChange(event) {
  const zone = event.currentTarget;
  const team = zone.dataset.team;
  const action = zone.dataset.action;
  const modal = document.getElementById('scoreGameModal');
  const setNumber = modal.dataset.currentSet;

  if (!setNumber) return;

  const displayId = (team === 'home') ? 'scoreGameHomeDisplay' : 'scoreGameOppDisplay';
  const inputId = (team === 'home') ? `set${setNumber}Home` : `set${setNumber}Opp`;
  const display = document.getElementById(displayId);
  const input = document.getElementById(inputId);

  if (!display || !input) return;

  let score = parseInt(display.textContent, 10) || 0;

  if (action === 'increment') {
    score += 1;
  } else if (action === 'decrement' && score > 0) {
    score -= 1;
  }

  display.textContent = padScore(score);
  input.value = score;

  // Optional: Trigger input event for any bound listeners (e.g., validation or auto-save)
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Attach event listeners to score zones
const scoreZones = document.querySelectorAll('.score-zone');
scoreZones.forEach((zone) => {
  zone.addEventListener('click', handleScoreChange);
  // Optional: Add keydown for accessibility (e.g., Enter/Space to trigger)
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleScoreChange(event);
    }
  });
});

// Function to load timeout states for a set
function loadTimeoutStates(setNumber) {
  const setState = state.setTimeoutStates[setNumber];
  const homeBoxes = document.querySelectorAll('.timeout-box[data-team="home"]');
  const oppBoxes = document.querySelectorAll('.timeout-box[data-team="opp"]');
  const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');

  homeBoxes.forEach((box, index) => {
    const isUsed = setState.used.home[index];
    box.classList.toggle('used', isUsed);
    box.setAttribute('aria-pressed', 'false');
    box.classList.remove('active');
    box.setAttribute('aria-label', `Home Team ${isUsed ? 'timeout used' : 'timeout available'}`);
  });

  oppBoxes.forEach((box, index) => {
    const isUsed = setState.used.opp[index];
    box.classList.toggle('used', isUsed);
    box.setAttribute('aria-pressed', 'false');
    box.classList.remove('active');
    box.setAttribute('aria-label', `Opponent ${isUsed ? 'timeout used' : 'timeout available'}`);
  });

  if (timeoutDisplay) timeoutDisplay.textContent = '';
  resetTimeoutCountdown();

  // Resume active timeout if applicable
  if (setState.activeTeam && setState.remaining > 0) {
    const teamBoxes = setState.activeTeam === 'home' ? homeBoxes : oppBoxes;
    const box = teamBoxes[setState.activeIndex];
    if (box) {
      box.setAttribute('aria-pressed', 'true');
      box.classList.add('active');
      const teamName = setState.activeTeam === 'home' ? 'Home Team' : 'Opponent';
      if (timeoutDisplay) timeoutDisplay.textContent = `Timeout: ${teamName}`;
      const isLeft = box.closest('.left-timeout') !== null;
      startTimeoutCountdown(isLeft, setState.remaining);
    }
  }
}

// Function to save timeout states for a set
function saveTimeoutStates(setNumber) {
  const setState = state.setTimeoutStates[setNumber];
  const homeBoxes = document.querySelectorAll('.timeout-box[data-team="home"]');
  const oppBoxes = document.querySelectorAll('.timeout-box[data-team="opp"]');

  homeBoxes.forEach((box, index) => {
    setState.used.home[index] = box.classList.contains('used');
  });

  oppBoxes.forEach((box, index) => {
    setState.used.opp[index] = box.classList.contains('used');
  });

  const activeBox = document.querySelector('.timeout-box.active');
  if (activeBox) {
    setState.activeTeam = activeBox.dataset.team;
    const teamBoxes = document.querySelectorAll(`.timeout-box[data-team="${setState.activeTeam}"]`);
    setState.activeIndex = Array.from(teamBoxes).indexOf(activeBox);
  } else {
    setState.activeTeam = null;
    setState.activeIndex = null;
  }

  // TODO: Trigger auto-save to Cloudflare DO if needed (e.g., debounce and PATCH to Worker endpoint for atomic update)
}

// Optional: Basic timeout handling (toggle pressed state)
const timeoutBoxes = document.querySelectorAll('.timeout-box');
timeoutBoxes.forEach((box) => {
  box.addEventListener('click', () => {
    const isPressed = box.getAttribute('aria-pressed') === 'true';
    const team = box.dataset.team;
    const teamName = team === 'home' ? 'Home Team' : 'Opponent';
    const timeoutDisplay = document.getElementById('scoreGameTimeoutDisplay');

    // Ensure only one timeout active: unpress others
    const otherBoxes = document.querySelectorAll('.timeout-box[aria-pressed="true"]');
    otherBoxes.forEach(otherBox => {
      if (otherBox !== box) {
        otherBox.setAttribute('aria-pressed', 'false');
        otherBox.classList.remove('active');
      }
    });

    if (isPressed) {
      // Stop timeout
      box.setAttribute('aria-pressed', 'false');
      box.classList.remove('active');
      box.classList.remove('used');
      if (timeoutDisplay) timeoutDisplay.textContent = '';
      resetTimeoutCountdown();
      box.setAttribute('aria-label', `${teamName} timeout available`);
    } else {
      // Check if available (not all used)
      const teamBoxes = document.querySelectorAll(`.timeout-box[data-team="${team}"]`);
      const availableIndex = Array.from(teamBoxes).findIndex(b => !b.classList.contains('used'));
      if (availableIndex === -1) return; // No available timeouts

      // Start timeout on this box (but since boxes are identical, could use availableIndex, but since clicked specific, check if this box is not used
      if (box.classList.contains('used')) return; // Can't start on used box

      if (timeoutDisplay) timeoutDisplay.textContent = `Timeout: ${teamName}`;
      box.setAttribute('aria-pressed', 'true');
      box.classList.add('active');
      box.classList.add('used');
      const isLeft = box.closest('.left-timeout') !== null;
      startTimeoutCountdown(isLeft);
      box.setAttribute('aria-label', `${teamName} timeout used`);
    }

    // Save after change
    const setNumber = scoreGameModal.dataset.currentSet;
    if (setNumber) saveTimeoutStates(setNumber);
  });
});

// Note: With this setup, timeout states (used, active, remaining) are persisted per set in client-side state.js.
// For server persistence, add logic to serialize state.setTimeoutStates to your Cloudflare Worker/DO on save events,
// using transactions in D1 SQLite for atomic updates (e.g., UPDATE match SET timeout_data = json WHERE id = ?).
// Example: On modal hidden or score change, debounce and send PATCH with set-specific data to avoid clobbering.