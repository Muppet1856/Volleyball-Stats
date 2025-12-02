import { state, subscribe } from '../state.js';
import { getActiveMatchId } from '../api/matchMetaAutosave.js';

const shareSection = document.getElementById('shareControls');
const shareStatus = document.getElementById('shareStatusMessage');
const linkElements = {
  scorekeeper: document.getElementById('scorekeeperLink'),
  follower: document.getElementById('followerLink'),
};

const statusClasses = ['text-muted', 'text-success', 'text-danger', 'text-warning'];
let cachedUrls = { scorekeeper: '', follower: '' };
let lastMatchId = null;

function setStatus(message = '', tone = 'muted') {
  if (!shareStatus) return;
  shareStatus.textContent = message;
  statusClasses.forEach((cls) => shareStatus.classList.remove(cls));
  shareStatus.classList.add(`text-${tone}`);
}

function copyToClipboard(text) {
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

function getMatchUrls(matchId) {
  const origin = window.location.origin;
  return {
    scorekeeper: `${origin}/scorekeeper/?match=${matchId}`,
    follower: `${origin}/follower/?match=${matchId}`,
  };
}

function getCurrentMatchId() {
  return getActiveMatchId() ?? state.matchId;
}

function syncShareControls() {
  if (!shareSection) return;

  const matchId = getCurrentMatchId();
  if (!matchId) {
    shareSection.classList.add('d-none');
    setStatus('');
    cachedUrls = { scorekeeper: '', follower: '' };
    lastMatchId = null;
    return;
  }

  if (matchId === lastMatchId) return;
  lastMatchId = matchId;

  cachedUrls = getMatchUrls(matchId);
  shareSection.classList.remove('d-none');

  Object.entries(linkElements).forEach(([key, element]) => {
    const nextUrl = cachedUrls[key];
    if (element && nextUrl) {
      element.href = nextUrl;
      element.textContent = nextUrl;
    }
  });

  setStatus('');
}

async function shareLink(linkType, action) {
  const url = cachedUrls[linkType];
  if (!url) {
    setStatus('Match link not ready yet.', 'warning');
    return;
  }

  const textByType = {
    scorekeeper: 'Control and score this match.',
    follower: 'Follow this match live.',
  };

  if (action === 'share' && navigator.share) {
    try {
      await navigator.share({
        title: 'Volleyball match',
        text: textByType[linkType] ?? 'Volleyball match link',
        url,
      });
      setStatus('Shared via your device options.', 'success');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') {
        setStatus('Share cancelled.', 'muted');
        return;
      }
      // Fallback to copy if sharing fails.
      setStatus('Sharing unavailable. Copying the link instead.', 'warning');
    }
  }

  try {
    await copyToClipboard(url);
    setStatus('Link copied to clipboard.', 'success');
  } catch (_error) {
    setStatus('Unable to copy automatically. Please copy the link manually.', 'danger');
  }
}

function wireShareButtons() {
  if (!shareSection) return;
  shareSection.querySelectorAll('.share-control-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      const { linkType, action } = event.currentTarget.dataset;
      shareLink(linkType, action);
    });
  });
}

wireShareButtons();
syncShareControls();
subscribe(syncShareControls);
