// state.js
export let state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
<<<<<<< Updated upstream
  isDisplaySwapped: false,
  isTimeoutColorSwapped: false,
  currentSet: 1,
  scores: [0, 0],
  timeouts: {
    home: Array(TIMEOUT_COUNT).fill(false),
    opp: Array(TIMEOUT_COUNT).fill(false)
  },
  activeTimeout: { home: null, opp: null },
  timeoutTimers: { home: null, opp: null },
  timeoutRemainingSeconds: {
    home: TIMEOUT_DURATION_SECONDS,
    opp: TIMEOUT_DURATION_SECONDS
  }// ... everything else in one place
};

state.setTimeoutStates = {};
SET_NUMBERS.forEach(set => {
  state.setTimeoutStates[set] = {
    used: {
      home: Array(TIMEOUT_COUNT).fill(false),
      opp: Array(TIMEOUT_COUNT).fill(false)
    },
    activeTeam: null,
    activeIndex: null,
    remaining: TIMEOUT_DURATION_SECONDS
  };
});

export function updateAllDisplays() {
  const home = state.isDisplaySwapped ? state.opponent : state.homeTeam;
  const opp  = state.isDisplaySwapped ? state.homeTeam : state.opponent;

  document.querySelectorAll('[data-home-team-template]').forEach(el => {
    el.textContent = el.dataset.homeTeamTemplate.replace('{homeTeam}', home);
  });

  document.querySelectorAll('[data-opponent]').forEach(el => {
    el.textContent = opp;
  });

  // Update score headers if you have #homeHeader and #oppHeader
  const homeHeader = document.getElementById('homeHeader');
  const oppHeader  = document.getElementById('oppHeader');
  if (homeHeader) homeHeader.textContent = home;
  if (oppHeader)  oppHeader.textContent = opp;
}
=======
  matchWins: { home: 0, opp: 0 },
  sets: {
    1: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    2: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    3: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    4: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    5: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
  },
};

// Mutate target in-place with source values (deep merge)
function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) return target;

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (typeof source[key] === 'object' && source[key] !== null) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = Array.isArray(source[key]) ? [] : {};
        }
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  return target;
}

export function updateState(partialState) {
  deepMerge(state, partialState);
  // Optional: console.log('Updated state:', state) for debugging
}

// Expose for console debugging (keep this)
window.state = state;
window.updateState = updateState;
>>>>>>> Stashed changes
