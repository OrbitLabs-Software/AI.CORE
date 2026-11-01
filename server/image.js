// image.js — Bilder erzeugen über eine OpenAI-kompatible Schnittstelle (IMAGE_API_KEY gesetzt = an).
// Der Tiny hat keine Grafikkarte, deshalb läuft die Bilderzeugung bei einem Anbieter oder auf einem stärkeren Rechner.

export const imageEnabled = () => Boolean(process.env.IMAGE_API_KEY);

export async function generateImage(prompt, signal) {
  const base = (process.env.IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.IMAGE_API_KEY}` },
    body: JSON.stringify({ model: process.env.IMAGE_MODEL || 'gpt-image-1', prompt, n: 1, size: process.env.IMAGE_SIZE || '1024x1024' }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180000)].filter(Boolean)),
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.error?.message || ''; } catch { /* egal */ }
    throw new Error(msg ? `Bildanbieter: ${msg}`.slice(0, 200) : `Bildanbieter antwortet mit Fehler ${res.status}`);
  }
  const item = (await res.json())?.data?.[0];
  if (item?.b64_json) return { b64: item.b64_json, mime: 'image/png' };
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    if (!img.ok) throw new Error('Das Bild konnte nicht geladen werden');
    return { b64: Buffer.from(await img.arrayBuffer()).toString('base64'), mime: img.headers.get('content-type') || 'image/png' };
  }
  throw new Error('Der Bildanbieter hat kein Bild geliefert');
}
