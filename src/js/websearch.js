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
