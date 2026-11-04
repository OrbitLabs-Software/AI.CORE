import test from 'node:test';
import assert from 'node:assert/strict';

const s = await import('../server/search.js');

test('Private und lokale Adressen werden erkannt', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.190', '172.16.0.5', '172.31.255.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd12::1', 'fe80::1', '::ffff:192.168.1.5', 'kaputt'])
    assert.equal(s.isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111'])
    assert.equal(s.isPrivateAddress(ip), false, ip);
});

test('assertPublicUrl blockt Heimnetz, Ports, Logins und fremde Protokolle', async () => {
  for (const u of ['http://192.168.1.190:3000/api', 'http://localhost/x', 'http://[::1]/', 'http://tiny.local/', 'file:///etc/passwd', 'ftp://example.com/', 'https://user:pw@example.com/', 'http://8.8.8.8:8080/', 'nicht-url'])
    await assert.rejects(s.assertPublicUrl(u), undefined, u);
  assert.equal((await s.assertPublicUrl('https://8.8.8.8/x')).hostname, '8.8.8.8');
});

test('htmlToText: nimmt den Hauptinhalt, entfernt Skripte und dekodiert Zeichen', () => {
  const html = `<html><head><title>x</title><style>p{}</style></head><body><nav>Menü Menü</nav><script>var a=1</script>
    <main><h1>Überschrift</h1><p>Erster Absatz &amp; mehr &uuml;ber Fl&#228;chen.</p><p>Zweiter&nbsp;Absatz</p>${'<p>Füllsatz eins.</p>'.repeat(30)}</main><footer>Impressum</footer></body></html>`;
  const t = s.htmlToText(html);
  assert.match(t, /Überschrift/); assert.match(t, /Erster Absatz & mehr über Flächen\./);
  assert.doesNotMatch(t, /Menü|var a|Impressum|<p>/);
});

test('DuckDuckGo-Seite wird gelesen, die Weiterleitung aufgelöst', () => {
  const html = `<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fde.wikipedia.org%2Fwiki%2FRied&amp;rut=abc">Ried im Innkreis &ndash; Wikipedia</a>
    <a class="result__snippet" href="x">Ried ist eine <b>Stadt</b> in Oberösterreich.</a></div>
    <div class="result"><a class="result__a" href="https://example.org/ried">Ried Tourismus</a><a class="result__snippet" href="y">Urlaub in Ried.</a></div>`;
  const r = s.parseDuckDuckGo(html);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { title: 'Ried im Innkreis – Wikipedia', url: 'https://de.wikipedia.org/wiki/Ried', snippet: 'Ried ist eine Stadt in Oberösterreich.' });
  assert.equal(r[1].url, 'https://example.org/ried');
});

test('webSearch: Brave zuerst, tiefe Suche liest Seiten, Fehler fallen auf den nächsten Anbieter zurück', async () => {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, opts) => {
    url = String(url); calls.push(url);
    if (url.includes('api.search.brave.com')) return Response.json({ web: { results: [{ title: 'Treffer <b>1</b>', url: 'https://8.8.8.8/seite', description: 'Beschreibung' }, { title: 'Treffer 2', url: 'http://192.168.1.1/intern', description: 'intern' }] } });
    if (url === 'https://8.8.8.8/seite') return new Response(`<main>${'<p>Inhalt der Seite.</p>'.repeat(40)}</main>`, { headers: { 'content-type': 'text/html' } });
    throw new Error('unerwartet ' + url);
  };
  try {
    process.env.BRAVE_API_KEY = 'k';
    const r = await s.webSearch('Wetter Ried', { deep: true });
    assert.equal(r.provider, 'Brave'); assert.equal(r.results[0].title, 'Treffer 1');
    assert.match(r.results[0].text, /Inhalt der Seite/);
    assert.equal(r.results[1].text, undefined);                              // Heimnetz-Adresse wurde nicht geladen
    assert.ok(!calls.some(u => u.includes('192.168.1.1')));
    delete process.env.BRAVE_API_KEY;
    globalThis.fetch = async (url) => {
      url = String(url);
      if (url.includes('duckduckgo')) return new Response('<html>gesperrt</html>');
      if (url.includes('wikipedia')) return Response.json({ query: { search: [{ title: 'Ried', pageid: 7, snippet: 'eine <span>Stadt</span>' }] } });
      throw new Error('x');
    };
    const w = await s.webSearch('Ried');
    assert.equal(w.provider, 'Wikipedia'); assert.equal(w.results[0].snippet, 'eine Stadt');
    await assert.rejects(s.webSearch(' '), /Suchbegriff/);
  } finally { globalThis.fetch = real; delete process.env.BRAVE_API_KEY; }
});

test('fetchPageText folgt Weiterleitungen nur auf öffentliche Adressen', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => String(url) === 'https://8.8.8.8/a'
    ? new Response(null, { status: 302, headers: { location: 'http://192.168.1.190:3000/api/memories' } })
    : new Response('geheim', { headers: { 'content-type': 'text/plain' } });
  try { await assert.rejects(s.fetchPageText('https://8.8.8.8/a'), /nicht erlaubt/); }
  finally { globalThis.fetch = real; }
});
