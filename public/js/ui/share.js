import { state, subscribe } from '../state.js';

const summaryButton = document.getElementById('shareSummaryButton');
const summaryStatus = document.getElementById('shareSummaryStatus');
const statusClasses = ['text-muted', 'text-success', 'text-danger', 'text-warning'];

function setSummaryStatus(message = '', tone = 'muted') {
  if (!summaryStatus) return;
  summaryStatus.textContent = message;
  statusClasses.forEach((cls) => summaryStatus.classList.remove(cls));
  summaryStatus.classList.add(`text-${tone}`);
}

function isMobileShareCapable() {
  const userAgent = navigator.userAgent || '';
  const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
  return isMobile && typeof navigator.share === 'function';
}

function formatMatchHeading() {
  const home = state.homeTeam?.trim() || 'Home Team';
  const opp = state.opponent?.trim() || 'Opponent';
  const homeWins = Number.isFinite(state.matchWins?.home) ? state.matchWins.home : 0;
  const oppWins = Number.isFinite(state.matchWins?.opp) ? state.matchWins.opp : 0;
  return `${home} vs ${opp} – Sets: ${homeWins}-${oppWins}`;
}

function formatSetDetails() {
  if (!state.sets) return '';

  const finalizedSets = [];
  for (let setNumber = 1; setNumber <= 5; setNumber++) {
    const setState = state.sets[setNumber];
    if (!setState?.finalized) continue;
    const homeScore = Number.isFinite(setState.scores?.home) ? setState.scores.home : 0;
    const oppScore = Number.isFinite(setState.scores?.opp) ? setState.scores.opp : 0;
    finalizedSets.push(`Set ${setNumber}: ${homeScore}-${oppScore}`);
  }

  return finalizedSets.join(', ');
}

function buildShareSummary() {
  const heading = formatMatchHeading();
  const setSummary = formatSetDetails();
  return setSummary ? `${heading} | ${setSummary}` : heading;
}

async function copySummary(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const success = document.execCommand('copy');
      if (success) {
        resolve();
      } else {
        reject(new Error('Copy command was unsuccessful'));
      }
    } catch (error) {
      reject(error);
    } finally {
      textarea.remove();
    }
  });
}

async function shareSummary() {
  const summary = buildShareSummary();

  if (isMobileShareCapable()) {
    try {
      await navigator.share({
        title: `${state.homeTeam} vs ${state.opponent}`.trim(),
        text: summary,
      });
      setSummaryStatus('Shared via your device options.', 'success');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') {
        setSummaryStatus('Share cancelled.', 'muted');
        return;
      }
      setSummaryStatus('Sharing unavailable. Copying the summary instead.', 'warning');
    }
  }

  try {
    await copySummary(summary);
    setSummaryStatus('Summary copied to clipboard.', 'success');
  } catch (_error) {
    setSummaryStatus('Unable to copy automatically. Please copy the summary manually.', 'danger');
  }
}

function toggleSummaryVisibility() {
  if (!summaryButton) return;

  const hasMatchId = Boolean(state.matchId);
  summaryButton.closest('#shareControls')?.classList.toggle('d-none', !hasMatchId);
}

if (summaryButton) {
  summaryButton.addEventListener('click', shareSummary);
}

toggleSummaryVisibility();
subscribe(toggleSummaryVisibility);
