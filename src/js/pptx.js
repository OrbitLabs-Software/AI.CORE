// pptx.js — Präsentationen als PowerPoint-Datei (.pptx), ohne Bibliothek.
// Eingabe: Markdown („# Titel“ = Titelfolie, „## Folientitel“ = Folie, „- Punkt“) oder JSON { title, slides:[{title, bullets}] }.
// Zu lange Folien werden automatisch aufgeteilt, die Schriftgröße passt sich dem Inhalt an.
import { makeZip } from './zip.js';
import { plainInline, spans } from './mdblocks.js';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const IN = 914400; // EMU pro Zoll
const emu = (inch) => Math.round(inch * IN);

const COLOR = { ink: '2B2926', paper: 'FAF9F5', accent: 'C15F3C', muted: '6B665E', dark: '2B2926', light: 'F4F1EA' };

// ---------- Eingabe lesen ----------
const BULLET = /^(\s*)([-*•–]|\d+[.)])\s+(.*)$/;

function itemFromLine(line) {
  const raw = line.replace(/\t/g, '  ');
  if (/^\s*\|/.test(raw)) {
    if (/^[\s|:-]+$/.test(raw)) return null;
    return { text: raw.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).join('  ·  '), level: 0, bullet: true };
  }
  const m = BULLET.exec(raw);
  if (m) return { text: m[3].trim(), level: Math.min(2, Math.floor(m[1].length / 2)), bullet: true, num: /\d/.test(m[2]) };
  const t = raw.trim();
  return t ? { text: t, level: 0, bullet: false } : null;
}

/** Text → { title, subtitle, slides:[{ kind:'title'|'section'|'content', title, subtitle?, items[] }] } */
export function parseSlides(input) {
  const text = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  if (/^\{/.test(text)) {
    try {
      const j = JSON.parse(text);
      const slides = (Array.isArray(j.slides) ? j.slides : []).map((s, i) => {
        const raw = s.bullets || s.points || s.items || (s.text ? String(s.text).split('\n') : []);
        const items = raw.map(b => typeof b === 'string' ? { text: b.replace(/^[-*•]\s*/, ''), level: 0, bullet: true } : { text: String(b.text ?? ''), level: Math.min(2, Number(b.level) || 0), bullet: true });
        return { kind: 'content', title: String(s.title || `Folie ${i + 1}`), items: items.filter(x => x.text) };
      });
      const out = { title: String(j.title || ''), subtitle: String(j.subtitle || ''), slides: [] };
      if (out.title) out.slides.push({ kind: 'title', title: out.title, subtitle: out.subtitle, items: [] });
      out.slides.push(...slides);
      return out;
    } catch { /* kein JSON */ }
  }

  const lines = text.split('\n');
  const hasHeadings = lines.some(l => /^#{1,3}\s+\S/.test(l));
  const slides = [];
  let cur = null;
  const start = (kind, title) => { cur = { kind, title: plainInline(title).trim(), subtitle: '', items: [] }; slides.push(cur); };

  if (!hasHeadings) {
    // Folien durch „---“ getrennt; erste Zeile jeder Folie ist der Titel
    const parts = text.split(/\n\s*-{3,}\s*\n/).map(p => p.trim()).filter(Boolean);
    parts.forEach((p, i) => {
      const ls = p.split('\n');
      start(i === 0 && parts.length > 1 && ls.length <= 3 ? 'title' : 'content', ls[0].replace(/^#+\s*/, ''));
      for (const l of ls.slice(1)) { const it = itemFromLine(l); if (it) cur.items.push(it); }
    });
  } else {
    for (const line of lines) {
      const h = /^(#{1,3})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { start(h[1].length === 1 ? (slides.length === 0 ? 'title' : 'section') : 'content', h[2]); continue; }
      if (/^\s*-{3,}\s*$/.test(line)) continue;
      const it = itemFromLine(line);
      if (!it) continue;
      if (!cur) start('title', '');
      cur.items.push(it);
    }
  }
  // Titel- und Zwischenfolien: Text darunter ist Untertitel
  for (const s of slides) {
    if (s.kind !== 'content') { s.subtitle = s.items.slice(0, 3).map(i => plainInline(i.text)).join('\n'); s.items = []; }
  }
  const t = slides.find(s => s.kind === 'title');
  return { title: t?.title || '', subtitle: t?.subtitle || '', slides: slides.filter(s => s.title || s.items.length || s.subtitle) };
}

// ---------- Aufteilen und Schriftgröße ----------
const BODY_W_IN = 11.9;
const BODY_H_IN = 4.75;
const SIZES = [28, 26, 24, 22, 20, 18, 16, 14];
const linesFor = (text, size, level) => Math.max(1, Math.ceil(plainInline(text).length / ((BODY_W_IN - 0.6 * level) * 72 / (size * 0.5))));
const heightOf = (items, size) => items.reduce((h, it) => h + linesFor(it.text, size - it.level * 2, it.level) * size * 1.2 + 9, 0);
const fits = (items, size) => heightOf(items, size) <= BODY_H_IN * 72;

export function layoutSlides(deck) {
  const out = [];
  for (const s of deck.slides) {
    if (s.kind !== 'content') { out.push(s); continue; }
    let rest = s.items.slice();
    let part = 0;
    do {
      const chunk = [];
      while (rest.length && (chunk.length === 0 || fits([...chunk, rest[0]], 18))) chunk.push(rest.shift());
      const size = SIZES.find(z => fits(chunk, z)) || 14;
      out.push({ ...s, title: part ? `${s.title} (Forts.)` : s.title, items: chunk, size });
      part++;
    } while (rest.length);
  }
  return out;
}

// ---------- XML ----------
const rpr = (size, color, extra = '') => `<a:rPr lang="de-DE" sz="${Math.round(size * 100)}"${extra} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr>`;
function runs(text, size, color, bold = false) {
  return spans(text).map(s => `<a:r>${rpr(size, color, s.b || bold ? ' b="1"' : s.i ? ' i="1"' : '')}<a:t>${esc(s.t)}</a:t></a:r>`).join('');
}
const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
const rect = (id, name, x, y, w, h, color) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
const bg = (color) => `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;

const titleSp = (id, text, x, y, w, h, size, color, anchor = 'b') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Titel"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}</p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l"/>${runs(text || ' ', size, color, true)}</a:p></p:txBody></p:sp>`;

function bodyParas(items, size) {
  return items.map((it, idx) => {
    const sz = size - it.level * 2;
    const mar = [342900, 685800, 1028700][it.level];
    const ind = it.bullet ? (it.num ? `marL="${mar + 114300}" indent="-457200"` : `marL="${mar}" indent="-285750"`) : 'marL="0" indent="0"';
    const bullet = it.bullet
      ? (it.num ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : `<a:buFont typeface="Arial"/><a:buChar char="${it.level === 0 ? '•' : '–'}"/>`)
      : '<a:buNone/>';
    return `<a:p><a:pPr ${ind} lvl="${it.level}"><a:spcBef><a:spcPts val="${idx ? 700 : 0}"/></a:spcBef>${bullet}</a:pPr>${runs(it.text, sz, it.level ? COLOR.muted : COLOR.ink)}</a:p>`;
  }).join('');
}

function slideXml(s, n, total) {
  const num = `<p:sp><p:nvSpPr><p:cNvPr id="9" name="Nummer"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(11.6, 6.95, 1.1, 0.35)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="r"/><a:r>${rpr(11, s.kind === 'content' ? COLOR.muted : 'B8B2A7')}<a:t>${n} / ${total}</a:t></a:r></a:p></p:txBody></p:sp>`;
  let shapes;
  let background;
  if (s.kind === 'title' || s.kind === 'section') {
    const big = s.kind === 'title';
    background = bg(COLOR.dark);
    shapes = rect(2, 'Akzent', 0.9, big ? 3.55 : 3.3, 1.6, 0.07, COLOR.accent)
      + titleSp(3, s.title, 0.9, 1.3, 11.5, 2.1, big ? 44 : 38, 'FFFFFF')
      + (s.subtitle ? `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Untertitel"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0.9, 3.85, 11.5, 2)}</p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>${s.subtitle.split('\n').map(l => `<a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>${runs(l, 22, COLOR.light)}</a:p>`).join('')}</p:txBody></p:sp>` : '')
      + num;
  } else {
    background = bg(COLOR.paper);
    shapes = rect(2, 'Akzent', 0, 0, 0.25, 7.5, COLOR.accent)
      + titleSp(3, s.title, 0.7, 0.4, 11.9, 1.15, 32, COLOR.ink)
      + `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Inhalt"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0.7, 1.75, BODY_W_IN, BODY_H_IN)}</p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>${bodyParas(s.items, s.size || 20) || '<a:p><a:endParaRPr lang="de-DE"/></a:p>'}</p:txBody></p:sp>`
      + num;
  }
  return `${X}<p:sld ${A} ${R} ${P}><p:cSld>${background}<p:spTree>${grp}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${X}<a:theme ${A} name="AI Core"><a:themeElements><a:clrScheme name="AI Core"><a:dk1><a:srgbClr val="2B2926"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3D3A35"/></a:dk2><a:lt2><a:srgbClr val="FAF9F5"/></a:lt2><a:accent1><a:srgbClr val="C15F3C"/></a:accent1><a:accent2><a:srgbClr val="4F7CAC"/></a:accent2><a:accent3><a:srgbClr val="6B8F71"/></a:accent3><a:accent4><a:srgbClr val="D4A24C"/></a:accent4><a:accent5><a:srgbClr val="8E6BAE"/></a:accent5><a:accent6><a:srgbClr val="5B8A8A"/></a:accent6><a:hlink><a:srgbClr val="4F7CAC"/></a:hlink><a:folHlink><a:srgbClr val="8E6BAE"/></a:folHlink></a:clrScheme><a:fontScheme name="AI Core"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="AI Core"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const phTitle = (withXfrm) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Titel"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${withXfrm ? xfrm(0.7, 0.4, 11.9, 1.15) : ''}</p:spPr><p:txBody><a:bodyPr anchor="b"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>Titel bearbeiten</a:t></a:r></a:p></p:txBody></p:sp>`;
const phBody = (withXfrm) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Inhalt"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${withXfrm ? xfrm(0.7, 1.75, BODY_W_IN, BODY_H_IN) : ''}</p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="de-DE"/><a:t>Text bearbeiten</a:t></a:r></a:p></p:txBody></p:sp>`;

const MASTER = `${X}<p:sldMaster ${A} ${R} ${P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${grp}${phTitle(true)}${phBody(true)}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900" algn="l"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="de-DE"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${X}<p:sldLayout ${A} ${R} ${P} type="obj" preserve="1"><p:cSld name="Titel und Inhalt"><p:spTree>${grp}${phTitle(false)}${phBody(false)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** deck: Text oder { slides } → Uint8Array (.pptx) */
export function pptxBytes(input) {
  const deck = typeof input === 'string' ? parseSlides(input) : input;
  let slides = layoutSlides(deck);
  if (!slides.length) slides = [{ kind: 'title', title: 'Präsentation', subtitle: '', items: [] }];
  const total = slides.length;
  const rels = (items) => `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const title = esc(deck.title || slides[0].title || 'Präsentation');
  const files = [
    { name: '[Content_Types].xml', content: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', content: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', content: `${X}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>AI Core</dc:creator></cp:coreProperties>` },
    { name: 'ppt/presentation.xml', content: `${X}<p:presentation ${A} ${R} ${P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', content: rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', content: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', content: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', content: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', content: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/theme/theme1.xml', content: THEME },
    ...slides.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, content: slideXml(s, i + 1, total) },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, content: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]) },
    ]),
  ];
  return makeZip(files);
}

export const buildPptx = (input) => new Blob([pptxBytes(input)], { type: PPTX_MIME });
