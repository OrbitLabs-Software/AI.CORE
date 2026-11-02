// docx.js — Antwort (Markdown) als Word-Datei, ohne Bibliothek.
// Überschriften, Absätze, Listen, Fett/Kursiv/Code, echte Tabellen, Zitate, Code-Blöcke, Trennlinien.
import { makeZip } from './zip.js';
import { blocks, spans, answerOnly } from './mdblocks.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MONO = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
const run = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;

/** Zeilentext → Läufe (fett, kursiv, Code). */
function runs(text, base = '') {
  return spans(text).map(s => run(s.t, base + (s.b ? '<w:b/>' : '') + (s.i ? '<w:i/>' : '') + (s.c ? `${MONO}<w:sz w:val="20"/>` : ''))).join('');
}
/** Mehrere Zeilen mit Zeilenumbruch dazwischen. */
const lines = (arr, base = '') => arr.map(l => runs(l, base)).join('<w:r><w:br/></w:r>');

const TEXT_W = 9298; // A4 minus Ränder, in Twips
const BORDER = (c = 'C9C4B8') => ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="${c}"/>`).join('');

function table(b) {
  const cols = Math.max(...b.rows.map(r => r.length));
  const w = Math.floor(TEXT_W / cols);
  const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join('');
  const rows = b.rows.map((r, ri) => {
    const head = b.header && ri === 0;
    const cells = Array.from({ length: cols }, (_, c) => {
      const shd = head ? '<w:shd w:val="clear" w:color="auto" w:fill="EDE6DC"/>' : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shd}</w:tcPr>${para(runs(r[c] ?? '', head ? '<w:b/>' : ''), '<w:spacing w:before="40" w:after="40"/>')}</w:tc>`;
    }).join('');
    return `<w:tr>${head ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:tblBorders>${BORDER()}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>${para('', '<w:spacing w:after="60"/>')}`;
}

export function markdownToDocx(markdown) {
  const body = [];
  const list = blocks(answerOnly(markdown));
  list.forEach((b, i) => {
    if (b.type === 'h') {
      body.push(para(runs(b.text, `<w:b/><w:sz w:val="${[0, 36, 30, 26, 24][b.level]}"/>`), `<w:keepNext/><w:spacing w:before="${b.level === 1 ? 320 : 240}" w:after="100"/>`));
    } else if (b.type === 'p') {
      body.push(para(lines(b.lines), '<w:spacing w:after="140"/>'));
    } else if (b.type === 'li') {
      const left = 360 + b.level * 360;
      const marker = b.ordered ? b.marker : (b.level ? '–' : '•');
      body.push(para(`${run(`${marker}\t`)}${runs(b.text)}`, `<w:tabs><w:tab w:val="left" w:pos="${left}"/></w:tabs><w:ind w:left="${left}" w:hanging="320"/><w:spacing w:after="40"/>`));
      if (list[i + 1]?.type !== 'li') body.push(para('', '<w:spacing w:after="60"/>'));
    } else if (b.type === 'code') {
      b.lines.forEach((l, k) => body.push(para(run(l || ' ', `${MONO}<w:sz w:val="19"/>`),
        `<w:shd w:val="clear" w:color="auto" w:fill="F3F1EA"/><w:spacing w:before="${k === 0 ? 60 : 0}" w:after="${k === b.lines.length - 1 ? 140 : 0}" w:line="240" w:lineRule="auto"/>`)));
    } else if (b.type === 'table') {
      if (b.rows.length) body.push(table(b));
    } else if (b.type === 'quote') {
      body.push(para(lines(b.lines, '<w:i/><w:color w:val="5A564E"/>'), '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C15F3C"/></w:pBdr><w:ind w:left="300"/><w:spacing w:after="140"/>'));
    } else if (b.type === 'hr') {
      body.push(para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9C4B8"/></w:pBdr><w:spacing w:after="140"/>'));
    }
  });
  if (!body.length) body.push(para(''));
  if (/<\/w:tbl>$/.test(body[body.length - 1])) body.push(para(''));

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    { name: '[Content_Types].xml', content: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', content: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', content: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/styles.xml', content: `${X}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="de-AT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>` },
    { name: 'word/document.xml', content: `${X}<w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ];
  return new Blob([makeZip(files)], { type: DOCX_MIME });
}
