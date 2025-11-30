const STATUS_ELEMENT_ID = 'autoSaveStatus';

function getStatusElement() {
  return document.getElementById(STATUS_ELEMENT_ID);
}

export function setAutoSaveStatus(message, tone = 'muted') {
  const el = getStatusElement();
  if (!el) return;
  el.textContent = message;
  el.classList.remove('d-none', 'text-muted', 'text-success', 'text-danger');
  const toneClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-muted';
  el.classList.add(toneClass);
}

export function clearAutoSaveStatus() {
  const el = getStatusElement();
  if (!el) return;
  el.textContent = '';
  el.classList.add('d-none');
}

export default {
  setAutoSaveStatus,
  clearAutoSaveStatus,
};
