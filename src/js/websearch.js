// websearch.js — Suchergebnisse für den Systemprompt aufbereiten (mit Platzbegrenzung) und Quellenliste bauen.

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function buildSearchContext(results, budgetChars, today = new Date()) {
  const list = (results || []).filter(r => /^https?:\/\//.test(r.url)).slice(0, 5);
  if (!list.length) return null;
  const per = Math.max(250, Math.floor((budgetChars - 300) / list.length));
  const items = list.map((r, i) => {
    const head = `[${i + 1}] ${r.title} (${host(r.url)})`;
    return `${head}\n${String(r.text || r.snippet || '').slice(0, Math.max(120, per - head.length))}`;
  });
  return {
    block: `Websuche (heute ist ${today.toLocaleDateString('de-AT')}). Nutze diese Quellen für aktuelle Fakten und nenne sie im Text als [1], [2]. Reichen sie nicht aus, sag das ehrlich.\n\n${items.join('\n\n')}`,
    sources: list.map((r, i) => ({ n: i + 1, title: String(r.title).slice(0, 120), url: r.url })),
  };
}

// ---------- Links in der Nachricht, Bibliothek, Zusammenführen ----------
const BINARY = /\.(png|jpe?g|gif|webp|svg|ico|mp4|mov|mp3|wav|zip|gz|tar|exe|dmg|pdf)(\?|#|$)/i;

/** Webadressen aus einer Nachricht (höchstens `max`, ohne doppelte, ohne Bilder und Dateien). */
export function extractUrls(text, max = 2) {
  const found = String(text || '').match(/https?:\/\/[^\s<>"'`)\]}]+/g) || [];
  const out = [];
  for (let u of found) {
    u = u.replace(/[.,;:!?]+$/, '');
    try { const url = new URL(u); if (!url.hostname.includes('.') || BINARY.test(url.pathname)) continue; u = url.href; } catch { continue; }
    if (!out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

export function buildLinkContext(pages, budgetChars) {
  const list = (pages || []).filter(p => p?.text);
  if (!list.length) return null;
  const per = Math.max(400, Math.floor((budgetChars - 200) / list.length));
  return {
    block: `Der Nutzer hat ${list.length > 1 ? 'Links' : 'einen Link'} geschickt. Das ist der gelesene Inhalt. Beziehe dich darauf und nenne die Quelle als [L1], [L2].\n\n${list.map((p, i) => `[L${i + 1}] ${p.title} (${host(p.url)})\n${p.text.slice(0, per)}`).join('\n\n')}`,
    sources: list.map((p, i) => ({ n: `L${i + 1}`, title: String(p.title).slice(0, 120), url: p.url })),
  };
}

export function buildLibraryContext(passages, budgetChars) {
  const list = (passages || []).filter(p => p?.text);
  if (!list.length) return null;
  const per = Math.max(300, Math.floor((budgetChars - 250) / list.length));
  return {
    block: `Aus der Bibliothek des Nutzers (passende Abschnitte). Antworte damit und nenne die Quelle als [B1], [B2]. Steht die Antwort nicht darin, sag das ehrlich.\n\n${list.map((p, i) => `[B${i + 1}] ${p.name}, Abschnitt ${p.part}\n${p.text.slice(0, per)}`).join('\n\n')}`,
    sources: list.map((p, i) => ({ n: `B${i + 1}`, title: `${p.name} · Abschnitt ${p.part}`, doc: true })),
  };
}

/** Mehrere Kontexte zu einem zusammenführen und auf `maxChars` begrenzen. */
export function combineContexts(parts, maxChars) {
  const ok = parts.filter(Boolean);
  if (!ok.length) return null;
  let block = ok.map(p => p.block).join('\n\n');
  if (block.length > maxChars) block = block.slice(0, maxChars - 20) + '\n[gekürzt]';
  return { block, sources: ok.flatMap(p => p.sources) };
}
