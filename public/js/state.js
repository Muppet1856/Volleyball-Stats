// state.js
const TIMEOUT_COUNT = 2;
const TIMEOUT_DURATION_SECONDS = 60;
const SET_NUMBERS = [1, 2, 3, 4, 5];
const matchSetRecords = new Map();
export const state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
  isDisplaySwapped: false,
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