// catalog.js — Modellkatalog: welche Modelle es gibt, unter welchem Namen und für wen (gratis oder Pro).
// Nutzer sehen nur den Anzeigenamen („AI Core Lite“) und eine neutrale Kennung („core/ai-core-lite“), nie den Namen des
// Basismodells. Der Server übersetzt die Kennung erst beim Aufruf zurück. Die Namen im Katalog zeigen auf Modelle, die du mit
// deploy/models/create-models.sh unter eigenem Namen angelegt hast (Persönlichkeit und Einstellungen sind darin festgelegt).
//
// MODEL_CATALOG=aicore-lite|AI Core Lite|free|schnell|Kostenlos,aicore-coder|AI Core Coder|pro|Code|Programmieren,cloud/deepseek-flash|AI Core Ultra|pro|am stärksten|Denken
//   Eintrag = ollama-name ODER quelle/name | Anzeigename | free oder pro | kurzer Hinweis | Gruppe (optional) | schnell (optional)
//   „schnell“ als 6. Angabe schaltet das Nachdenken des Modells ab (nur für Modelle mit Denkmodus, zum Beispiel Qwen 3.5).

const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f<>"]/g, '').trim();
export const slugify = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'modell';

export function parseCatalog(text = process.env.MODEL_CATALOG) {
  const out = [], seen = new Set();
  for (const part of String(text || '').split(',')) {
    const [raw, name, tier, note, category, speed] = part.split('|').map(clean);
    if (!raw || !name) continue;
    let slug = slugify(name), n = 2;
    while (seen.has(slug)) slug = `${slugify(name)}-${n++}`;
    seen.add(slug);
    const id = /^(ollama|cloud|anthropic)\//.test(raw) ? raw : `ollama/${raw}`;
    const fast = speed === 'schnell' && id.startsWith('ollama/');
    out.push({ slug, publicId: `core/${slug}`, baseId: id, rawId: fast ? `${id}+nothink` : id, name, tier: tier === 'pro' ? 'pro' : 'free', note: note || '', category: category || '' });
  }
  return out;
}

export const catalogOn = (c = parseCatalog()) => c.length > 0;

/** Kennung aus dem Browser → echtes Modell und Stufe. Unbekannte Kennungen: null. */
export function unalias(id, c = parseCatalog()) {
  const e = c.find(m => m.publicId === String(id || ''));
  return e ? { id: e.rawId, tier: e.tier, name: e.name } : null;
}

/**
 * Liste für den Browser. installed = echte Modell-IDs, die der Server gerade anbietet (listAllModels).
 * Modelle, die nicht installiert sind, erscheinen nicht.
 */
export function publicModels(installed, { pro = false } = {}, c = parseCatalog()) {
  const have = new Map(installed.map(m => [m.id, m]));
  return c.filter(e => have.has(e.baseId)).map(e => ({
    id: e.publicId, label: e.name, group: e.category || (e.tier === 'pro' ? 'Pro' : 'Kostenlos'), provider: 'core',
    tier: e.tier, hint: e.note, cloud: e.baseId.startsWith('cloud/'), locked: e.tier === 'pro' && !pro, loaded: Boolean(have.get(e.baseId)?.loaded),
  }));
}

/** Standardmodell: das erste kostenlose, sonst das erste. */
export const defaultPublic = (models) => (models.find(m => m.tier === 'free') || models[0])?.id;

/** Darf dieses Konto das Modell nutzen? */
export const allowed = (entry, { pro }) => !entry || entry.tier !== 'pro' || pro;

// Persönlichkeit: gilt für alle Modelle. Sie sagt nichts Falsches, nennt aber keine Technik dahinter.
export const IDENTITY_RULE = 'Du bist AI Core, ein Assistent von OrbitLabs. Wenn dich jemand fragt, welches Sprachmodell oder welche Technik hinter dir steckt, sag freundlich, dass du AI Core bist und dazu keine Angaben machst. Behaupte nie etwas Falsches über dich.';
export const withIdentity = (system) => (String(system || '').includes('Du bist AI Core') && String(system).includes('keine Angaben') ? system : `${system || ''}\n\n${IDENTITY_RULE}`.trim());
