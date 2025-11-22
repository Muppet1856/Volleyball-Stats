// state.js (add finalized and match wins)
export const state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
  isDisplaySwapped: false,
  currentSet: null,
  sets: {
    1: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    2: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    3: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    4: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false },
    5: { scores: { home: 0, opp: 0 }, timeouts: { home: [false, false], opp: [false, false] }, finalized: false }
  },
  matchWins: { home: 0, opp: 0 },  // Track set wins
  overallWinner: null,  // 'home', 'opp', or null
  isModalOpen: false
};

export function updateState(newState, callback) {
  Object.assign(state, newState);
  if (callback) callback();
}