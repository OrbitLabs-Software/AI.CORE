// icons.js — Symbole aus Font Awesome (Free) statt Emojis. Die Schrift wird zuerst aus public/vendor/fa geladen
// (offline, auch in der App) und, falls dort nichts liegt, von cdnjs.
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';

/** <i>-Symbol als HTML. style: solid | regular | brands */
export const ico = (name, { style = 'solid', spin = false, cls = '' } = {}) =>
  `<i class="fa-${style} fa-${name}${spin ? ' fa-spin' : ''}${cls ? ` ${cls}` : ''}" aria-hidden="true"></i>`;
export const icoBrand = (name) => ico(name, { style: 'brands' });

let loaded = false;
export function loadIcons() {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  const link = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); return l; };
  const local = link(new URL('../../public/vendor/fa/css/all.min.css', import.meta.url).href);
  local.addEventListener('error', () => { local.remove(); link(CDN); });
}
loadIcons();
