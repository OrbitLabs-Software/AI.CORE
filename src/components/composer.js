// composer.js — Eingabefeld. Während einer Antwort wird der Senden-Knopf zum Stopp-Knopf.

const SEND_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

export function initComposer({ textarea, sendBtn, form, onSubmit, onStop }) {
  let busy = false;

  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  function updateSendState() {
    sendBtn.disabled = busy ? false : textarea.value.trim().length === 0;
  }

  function setBusy(value) {
    busy = value;
    sendBtn.classList.toggle('stop', busy);
    sendBtn.innerHTML = busy ? STOP_ICON : SEND_ICON;
    sendBtn.setAttribute('aria-label', busy ? 'Antwort stoppen' : 'Senden');
    sendBtn.title = busy ? 'Antwort stoppen (Esc)' : 'Senden';
    updateSendState();
  }

  textarea.addEventListener('input', () => { autoResize(); updateSendState(); });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!busy) form.requestSubmit();
    }
  });

  sendBtn.addEventListener('click', (e) => {
    if (busy) { e.preventDefault(); onStop?.(); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const value = textarea.value.trim();
    if (!value) return;
    if (onSubmit(value) === false) return; // false = Text behalten (z. B. Datei lädt noch)
    textarea.value = '';
    autoResize();
    updateSendState();
  });

  return { autoResize, updateSendState, setBusy, setValue(v) { textarea.value = v; autoResize(); updateSendState(); textarea.focus(); } };
}
