// appearance.js — Darstellung: Design (hell/dunkel/System), Textgröße, Dichte, Breite. Wirkt über Attribute am <html>.
const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
export const resolveTheme = (theme) => (theme === 'system' ? (mq?.matches ? 'dark' : 'light') : theme === 'dark' ? 'dark' : 'light');

export function applyAppearance(s) {
  const r = document.documentElement;
  r.setAttribute('data-theme', resolveTheme(s.theme));
  r.dataset.fs = s.fontSize || 'm';
  r.dataset.density = s.density || 'normal';
  r.dataset.width = s.width || 'normal';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolveTheme(s.theme) === 'dark' ? '#262624' : '#faf9f5');
}
/** Bei „System“ dem Wechsel des Geräts folgen. */
export function watchSystemTheme(getSettings) {
  mq?.addEventListener?.('change', () => { const s = getSettings(); if (s.theme === 'system') applyAppearance(s); });
}
