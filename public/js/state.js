// state.js
const TIMEOUT_COUNT = 2;
const TIMEOUT_DURATION_SECONDS = 60;
const SET_NUMBERS = [1, 2, 3, 4, 5];
const matchSetRecords = new Map();
export const state = {
  homeTeam: 'Home Team',
  opponent: 'Opponent',
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