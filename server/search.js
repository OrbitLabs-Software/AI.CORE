// search.js — Websuche mit Quellen, optional "tief" (die ersten Seiten werden gelesen).
// Anbieter in dieser Reihenfolge: BRAVE_API_KEY, SEARXNG_URL, sonst DuckDuckGo-Seite und Wikipedia (ohne Konto).
// Seiten werden nur von öffentlichen Adressen geladen, nie aus dem Heimnetz (Schutz vor Zugriffen auf eigene Geräte).

import dns from 'dns/promises';
import net from 'net';

export const searchEnabled = () => process.env.WEB_SEARCH !== 'false';
const UA = 'Mozilla/5.0 (compatible; AI-Core/3.4; +https://github.com)';
const lang = () => (process.env.WEB_SEARCH_LANG || 'de').slice(0, 5);

// ---------- Adress-Schutz ----------
export function isPrivateAddress(ip) {
  let a = String(ip).toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (net.isIPv4(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 || p >= 224 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19));
  }
  if (net.isIPv6(a)) return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff');
  return true;   // keine gültige Adresse: lieber nicht
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Ungültige Adresse'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Nur http und https');
  if (u.username || u.password) throw new Error('Adresse nicht erlaubt');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Port nicht erlaubt');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.lan|.*\.internal)$/i.test(host)) throw new Error('Adresse nicht erlaubt');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some(x => isPrivateAddress(x.address))) throw new Error('Adresse nicht erlaubt');
  return u;
}

// ---------- Text aus HTML ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—', hellip: '…', euro: '€' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ''; }
  return ENT[e] ?? m;
});

export function htmlToText(html, max = 4000) {
  let h = String(html).replace(/<!--[\s\S]*?-->/g, '');
  h = h.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const main = /<(main|article)[\s>][\s\S]*?<\/\1>/i.exec(h);
  if (main && main[0].length > 400) h = main[0];
  h = h.replace(/<\/(p|div|li|h[1-6]|tr|br|section)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(h).replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
const strip = (s) => decode(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

async function fetchPage(url) {
  let current = await assertPublicUrl(url);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9' }, signal: AbortSignal.timeout(8000) });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Weiterleitung ohne Ziel');
      current = await assertPublicUrl(new URL(loc, current).href);
      continue;
    }
    if (!res.ok) throw new Error(`Fehler ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/text\/(html|plain)|application\/xhtml/i.test(type)) throw new Error('Kein Text');
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    while (size < 1_500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
    reader.cancel().catch(() => {});
    return { url: current.href ?? String(current), html: /html/i.test(type), raw: new TextDecoder().decode(Buffer.concat(chunks)) };
  }
  throw new Error('Zu viele Weiterleitungen');
}

export async function fetchPageText(url, max = 3500) {
  const p = await fetchPage(url);
  return p.html ? htmlToText(p.raw, max) : p.raw.replace(/\s+/g, ' ').slice(0, max);
}

/** Eine Seite lesen: Adresse, Titel und Text (für „Link in der Nachricht lesen“). */
export async function readPage(url, max = 6000) {
  const p = await fetchPage(url);
  const title = p.html ? strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(p.raw) || [])[1] || '') : '';
  const text = p.html ? htmlToText(p.raw, max) : p.raw.replace(/\s+/g, ' ').slice(0, max);
  if (text.length < 40) throw new Error('Auf der Seite wurde kaum Text gefunden');
  return { url: p.url, title: title.slice(0, 160) || new URL(p.url).hostname, text };
}

// ---------- Anbieter ----------
const get = async (url, headers = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Suchanbieter: Fehler ${res.status}`);
  return res;
};

async function brave(q, n) {
  const res = await get(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: n, search_lang: lang() })}`, { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' });
  return ((await res.json()).web?.results || []).map(r => ({ title: strip(r.title), url: r.url, snippet: strip(r.description) }));
}

async function searxng(q, n) {
  const base = process.env.SEARXNG_URL.replace(/\/+$/, '');
  const res = await get(`${base}/search?${new URLSearchParams({ q, format: 'json', language: lang() })}`);
  return ((await res.json()).results || []).slice(0, n).map(r => ({ title: strip(r.title), url: r.url, snippet: strip(r.content) }));
}

export function parseDuckDuckGo(html, n = 6) {
  const links = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map(m => strip(m[1]));
  const out = [];
  links.forEach((m, i) => {
    let url = decode(m[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    try { const u = new URL(url); if (u.hostname.endsWith('duckduckgo.com') && u.searchParams.get('uddg')) url = u.searchParams.get('uddg'); } catch { return; }
    if (/^https?:\/\//.test(url) && !/duckduckgo\.com\/y\.js/.test(url)) out.push({ title: strip(m[2]), url, snippet: snippets[i] || '' });
  });
  return out.slice(0, n);
}
async function duckduckgo(q, n) {
  const res = await get(`https://html.duckduckgo.com/html/?${new URLSearchParams({ q, kl: lang() === 'de' ? 'de-de' : 'wt-wt' })}`);
  const found = parseDuckDuckGo(await res.text(), n);
  if (!found.length) throw new Error('DuckDuckGo hat nichts geliefert');
  return found;
}

async function wikipedia(q, n) {
  const res = await get(`https://${lang().slice(0, 2)}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: n, format: 'json', utf8: '1' })}`);
  return ((await res.json()).query?.search || []).map(r => ({ title: r.title, url: `https://${lang().slice(0, 2)}.wikipedia.org/?curid=${r.pageid}`, snippet: strip(r.snippet) }));
}

export async function webSearch(query, { deep = false } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (q.length < 2) throw new Error('Suchbegriff fehlt');
  const chain = [];
  if (process.env.BRAVE_API_KEY) chain.push(['Brave', brave]);
  if (process.env.SEARXNG_URL) chain.push(['SearXNG', searxng]);
  if (!chain.length) chain.push(['DuckDuckGo', duckduckgo], ['Wikipedia', wikipedia]);
  let last = null;
  for (const [provider, fn] of chain) {
    try {
      let results = (await fn(q, 6)).filter(r => r.url && r.title).slice(0, 5);
      if (!results.length) throw new Error('keine Treffer');
      if (deep) {
        await Promise.all(results.slice(0, 3).map(async (r) => { try { r.text = await fetchPageText(r.url); } catch { /* Seite nicht lesbar: Auszug bleibt */ } }));
      }
      return { provider, results };
    } catch (e) { last = e; console.warn(`[search] ${provider}: ${e.message}`); }
  }
  throw new Error(`Die Websuche hat nicht geklappt (${last?.message || 'kein Anbieter'}).`);
}
