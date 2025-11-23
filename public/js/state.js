// js/state.js
export let state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
  matchWins: { home: 0, opp: 0 },
  overallWinner: null,
  sets: {
    1: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    2: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    3: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    4: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
    5: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false, winner: null },
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