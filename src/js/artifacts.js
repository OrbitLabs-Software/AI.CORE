// artifacts.js — das Panel rechts: Vorschau (Sandbox) und Code zu einem Code-Block.

import { api } from './api.js';
import { showToast, highlight, isPreviewable } from './ui.js';

export function createArtifactPanel({ onToggle = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const panel = $('artifact-panel');
  const frame = $('artifact-frame');
  const codeEl = $('artifact-code');
  const empty = $('artifact-empty');
  const tabs = $('artifact-tabs');
  let state = null;     // { code, lang, file, url, previewCode (gebündelt aus mehreren Dateien) }
  let token = 0;        // verwirft veraltete Antworten beim schnellen Wechseln

  const isOpen = () => !panel.hidden;

  function setTab(next) {
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === next));
    const hasState = Boolean(state);
    frame.hidden = !(hasState && next === 'preview' && isPreviewable(state.lang));
    codeEl.hidden = !(hasState && next === 'code');
    empty.hidden = hasState && (next === 'code' || isPreviewable(state.lang));
  }

  async function loadPreview() {
    const mine = ++token;
    empty.hidden = true;
    try {
      const kind = state.lang === 'svg' ? 'svg' : 'html';
      const p = await api.preview(kind, state.previewCode ?? state.code);
      if (mine !== token) return;
      state.url = p.url || null;
      if (p.srcdoc) { frame.removeAttribute('src'); frame.srcdoc = p.srcdoc; } else { frame.removeAttribute('srcdoc'); frame.src = p.url; }
    } catch (e) {
      if (mine !== token) return;
      frame.hidden = true;
      empty.hidden = false;
      empty.textContent = `Vorschau nicht möglich: ${e.message}`;
    }
  }

  function open({ code, lang = '', file = '', mode, previewCode } = {}) {
    state = { code: String(code ?? ''), lang: String(lang).toLowerCase(), file, url: null, previewCode: previewCode ?? null };
    const lines = state.code.split('\n').length;
    $('artifact-name').textContent = file || (state.lang ? state.lang.toUpperCase() : 'Code');
    $('artifact-meta').textContent = `${lines} Zeilen`;
    codeEl.querySelector('code').innerHTML = highlight(state.code, state.lang);
    const canPreview = isPreviewable(state.lang);
    tabs.querySelector('[data-tab="preview"]').hidden = !canPreview;
    panel.hidden = false;
    setTab(canPreview && mode !== 'code' ? 'preview' : 'code');
    if (canPreview) loadPreview();
    onToggle(true);
  }

  function close() {
    token++;
    panel.hidden = true;
    frame.removeAttribute('src'); frame.removeAttribute('srcdoc');
    onToggle(false);
  }

  function showEmpty() {
    state = null;
    panel.hidden = false;
    $('artifact-name').textContent = 'Vorschau';
    $('artifact-meta').textContent = '';
    frame.removeAttribute('src'); frame.removeAttribute('srcdoc');
    empty.textContent = 'Klicke bei einem Code-Block auf „Vorschau“ oder „Öffnen“. Dann erscheint er hier.';
    setTab('code');
    frame.hidden = true; codeEl.hidden = true; empty.hidden = false;
    onToggle(true);
  }

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b && state) setTab(b.dataset.tab);
  });
  $('artifact-close').addEventListener('click', close);
  $('artifact-copy').addEventListener('click', () => {
    if (!state) return;
    navigator.clipboard?.writeText(state.code);
    showToast('Code kopiert');
  });
  $('artifact-download').addEventListener('click', async () => {
    if (!state) return;
    const { saveBlock } = await import('./formats.js');
    try { await saveBlock({ code: state.code, lang: state.lang, file: state.file }); } catch (e) { showToast(`Speichern nicht möglich: ${e.message}`); }
  });
  $('artifact-open').addEventListener('click', () => {
    if (state?.url) window.open(state.url, '_blank', 'noopener');
    else if (state) { $('artifact-download').click(); showToast('Als Datei gespeichert — öffne sie per Doppelklick'); } // nie auf dieser Seite ausführen
    else showToast('Für diesen Code gibt es keine Vorschau');
  });

  return { open, close, showEmpty, isOpen, get current() { return state; } };
}
