// ui.js — Hilfen für die Oberfläche: Markdown mit Code-Hervorhebung, Datum, Download, Hinweise.

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Code-Hervorhebung (klein, ohne Bibliothek; gibt immer sicher escaptes HTML zurück) ----------
const KEYWORDS = {
  js: 'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false yield static get set delete void super',
  py: 'def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda None True False yield global nonlocal async await self',
  sh: 'if then else elif fi for while do done case esac function in echo cd ls sudo export return exit set unset local',
};
const KW = Object.fromEntries(Object.entries(KEYWORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

const LANG_ALIAS = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js',
  py: 'py', python: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  json: 'json', jsonc: 'json',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css',
};
export const normLang = (lang) => LANG_ALIAS[String(lang || '').toLowerCase()] || '';

const span = (cls, text) => `<span class="tok-${cls}">${escapeHtml(text)}</span>`;

function tokenize(code, re, classify) {
  let out = '';
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(code))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out += escapeHtml(code.slice(last, m.index));
    out += classify(m);
    last = m.index + m[0].length;
  }
  return out + escapeHtml(code.slice(last));
}

export function highlight(code, lang) {
  const l = normLang(lang);
  if (!l || code.length > 60000) return escapeHtml(code);

  if (l === 'js') {
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
    return tokenize(code, re, (m) => m[1] ? span('c', m[0]) : m[2] ? span('s', m[0]) : m[3] ? span('n', m[0])
      : m[4] ? (KW.js.has(m[0]) ? span('k', m[0]) : span('f', m[0])) : KW.js.has(m[0]) ? span('k', m[0]) : escapeHtml(m[0]));
  }
  if (l === 'py') {
    const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)(?=\s*\()|([A-Za-z_][\w]*)/g;
    return tokenize(code, re, (m) => m[1] ? span('c', m[0]) : m[2] ? span('s', m[0]) : m[3] ? span('n', m[0])
      : m[4] ? (KW.py.has(m[0]) ? span('k', m[0]) : span('f', m[0])) : KW.py.has(m[0]) ? span('k', m[0]) : escapeHtml(m[0]));
  }
  if (l === 'sh') {
    const re = /((?:^|\s)#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|(\$\{[^}]*\}|\$\w+)|(\b[A-Za-z_][\w-]*\b)/g;
    return tokenize(code, re, (m) => m[1] ? span('c', m[0]) : m[2] ? span('s', m[0]) : m[3] ? span('a', m[0])
      : KW.sh.has(m[0]) ? span('k', m[0]) : escapeHtml(m[0]));
  }
  if (l === 'json') {
    const re = /("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g;
    return tokenize(code, re, (m) => m[1] ? (m[2] ? span('f', m[1]) + escapeHtml(m[2]) : span('s', m[1])) : m[3] ? span('n', m[0]) : span('k', m[0]));
  }
  if (l === 'css') {
    const re = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b)|([a-z-]+)(?=\s*:)/g;
    return tokenize(code, re, (m) => m[1] ? span('c', m[0]) : m[2] ? span('s', m[0]) : m[3] ? span('k', m[0]) : m[4] ? span('n', m[0]) : span('f', m[0]));
  }
  if (l === 'html') {
    const re = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?>)/g;
    return tokenize(code, re, (m) => {
      if (m[1]) return span('c', m[1]);
      const attrs = m[4].replace(/(\s+)([^\s=>/]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g,
        (_, ws, name, eq, val) => `${ws}${span('a', name)}${eq ? escapeHtml(eq) + span('s', val) : ''}`);
      // attrs enthält bereits fertiges HTML aus span() und escapeHtml(); der Rest wurde oben escaped
      return `${escapeHtml(m[2])}${span('t', m[3])}${attrs}${escapeHtml(m[5])}`;
    });
  }
  return escapeHtml(code);
}

// ---------- Code-Blöcke ----------
export const EXT = { js: 'js', javascript: 'js', jsx: 'jsx', ts: 'ts', typescript: 'ts', tsx: 'tsx', py: 'py', python: 'py', html: 'html', css: 'css', json: 'json', sh: 'sh', bash: 'sh', shell: 'sh', svg: 'svg', md: 'md', markdown: 'md', java: 'java', c: 'c', cpp: 'cpp', cs: 'cs', go: 'go', rs: 'rs', rust: 'rs', php: 'php', sql: 'sql', yaml: 'yml', yml: 'yml', xml: 'xml', vue: 'vue', txt: 'txt' };
export const isPreviewable = (lang) => ['html', 'svg'].includes(String(lang || '').toLowerCase());

/** "js:app.js", "html index.html", `js title="app.js"` → { lang, file } */
export function parseFenceInfo(info) {
  const t = String(info || '').trim();
  const m = /^([A-Za-z][\w+#.-]*)?(?:[:\s]+(?:title=|file=|filename=)?["']?([^\s"']+\.[A-Za-z0-9]+)["']?)?/.exec(t) || [];
  return { lang: (m[1] || '').toLowerCase(), file: m[2] || '' };
}

function blockHtml(info, code, open) {
  const { lang, file } = parseFenceInfo(info);
  const label = lang || 'text';
  const lines = code.split('\n').length;
  const actions = open ? '' : `
        <div class="code-actions">
          ${isPreviewable(lang) ? '<button type="button" class="primary" data-code-preview title="Vorschau rechts anzeigen">▶ Vorschau</button>' : (lines >= 12 ? '<button type="button" data-code-open title="Rechts im Panel öffnen">Öffnen</button>' : '')}
          <button type="button" data-code-download title="Als Datei speichern">Laden</button>
          <button type="button" data-code-copy>Kopieren</button>
        </div>`;
  return `<div class="code-block" data-lang="${escapeHtml(lang)}" data-file="${escapeHtml(file)}">
      <div class="code-block-header"><span class="code-lang">${escapeHtml(label)}</span>${file ? `<span class="code-file">${escapeHtml(file)}</span>` : ''}${actions}</div>
      <pre><code>${highlight(code.replace(/\n$/, ''), lang)}</code></pre>
    </div>`;
}

const FENCE = /(^|\n)```([^\n`]*)\n([\s\S]*?)(?:\n```[ \t]*(?=\n|$)|$)/g;

/** Alle abgeschlossenen Code-Blöcke einer Nachricht. */
export function extractCodeBlocks(markdown) {
  const out = [];
  const re = /(^|\n)```([^\n`]*)\n([\s\S]*?)\n```[ \t]*(?=\n|$)/g;
  let m;
  while ((m = re.exec(String(markdown ?? '')))) {
    const { lang, file } = parseFenceInfo(m[2]);
    out.push({ lang, file, code: m[3] });
  }
  return out;
}

// ---------- Markdown ----------
function renderLists(text) {
  return text.replace(/^(?: *(?:[-*] |\d+[.)] ).*(?:\n|$))+/gm, (block) => {
    const lines = block.replace(/\n$/, '').split('\n');
    let html = '';
    const stack = [];
    for (const line of lines) {
      const m = /^( *)([-*]|\d+[.)]) (.*)$/.exec(line);
      const indent = m[1].length;
      const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      while (stack.length && indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
      if (stack.length && indent === stack[stack.length - 1].indent) html += '</li>';
      else { stack.push({ indent, tag }); html += `<${tag}>`; }
      html += `<li>${m[3]}`;
    }
    while (stack.length) html += `</li></${stack.pop().tag}>`;
    return `${html}\n`;
  });
}

function renderBody(src) {
  const stash = [];
  const hold = (kind, html) => { stash.push(html); return `@@${kind}${stash.length - 1}@@`; };
  let text = String(src ?? '');

  // 1. Code-Blöcke (auch noch offene beim Streamen)
  text = text.replace(FENCE, (m, pre, info, code) => pre + hold('B', blockHtml(info, code, !/\n```[ \t]*$/.test(m))));
  text = text.replace(/(^|\n)```([^\n`]*)$/, (m, pre, info) => pre + hold('B', blockHtml(info, '', true)));
  // 2. Inline-Code
  text = text.replace(/`([^`\n]+)`/g, (m, c) => hold('I', `<code>${escapeHtml(c)}</code>`));
  // 3. Rest escapen
  text = escapeHtml(text);

  text = text.replace(/^(#{1,4}) (.*)$/gm, (m, h, t) => `<h${h.length}>${t}</h${h.length}>`);
  text = text.replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '<hr>');
  text = text.replace(/^(?:&gt; ?.*(?:\n|$))+/gm, (block) =>
    `<blockquote>${block.trim().split('\n').map(l => l.replace(/^&gt; ?/, '')).join('<br>')}</blockquote>\n`);
  text = text.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.*\|(?:\n|$))*)/gm, (_, head, _sep, body) => {
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const th = cells(head).map(c => `<th>${c}</th>`).join('');
    const rows = body.trim() ? body.trim().split('\n').map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : '';
    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
  });
  text = renderLists(text);

  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  // Code-Blöcke immer als eigener Absatz
  text = text.replace(/@@B(\d+)@@/g, '\n\n@@B$1@@\n\n');
  text = text.split(/\n{2,}/).map(chunk => {
    const t = chunk.trim();
    if (!t) return '';
    if (/^<(h[1-4]|ul|ol|hr|blockquote|div class="table-wrap")/.test(t) || /^@@B\d+@@$/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return text.replace(/@@[BI](\d+)@@/g, (_, i) => stash[Number(i)]);
}

export function renderMarkdown(src) {
  // DeepSeek-R1 / V4: <think>…</think> als einklappbaren Denkprozess darstellen.
  const m = /^\s*<think>([\s\S]*?)(<\/think>|$)/.exec(src || '');
  if (m) {
    const closed = Boolean(m[2]);
    const answer = src.slice(m[0].length);
    const label = closed ? 'Denkprozess anzeigen' : 'Denkt nach …';
    return `<details class="think-block"${closed ? '' : ' open'}><summary>${label}</summary><div class="think-body">${renderBody(m[1].trim() || '…')}</div></details>` +
      (answer.trim() ? renderBody(answer) : '');
  }
  return renderBody(src);
}

/** Reiner Text für Vorlesen und Suche (ohne Denkblock, Code und Formatierung). */
export function plainText(md) {
  return String(md ?? '')
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/```[\s\S]*?(```|$)/g, ' (Code-Block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*\d.)\s]+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/\n{2,}/g, '. ')
    .trim();
}

// ---------- Kleinkram ----------
let toastTimer = null;
export function showToast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export const formatTime = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Gruppe für die Seitenleiste: Heute, Gestern, Letzte 7 Tage, Letzte 30 Tage, Älter. */
export function dateGroup(ts, now = new Date()) {
  const day = (d) => new Date(d).setHours(0, 0, 0, 0);
  const diff = Math.round((day(now) - day(ts)) / 86400000);
  if (diff <= 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff < 7) return 'Letzte 7 Tage';
  if (diff < 30) return 'Letzte 30 Tage';
  return 'Älter';
}
export const relativeDay = dateGroup;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const estimateTokens = (s) => Math.ceil(String(s ?? '').length / 3.2);

export function formatBytes(n) {
  if (!n) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function downloadFile(name, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
