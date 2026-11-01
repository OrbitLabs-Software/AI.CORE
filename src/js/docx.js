// docx.js — Antwort (Markdown) als Word-Datei, ohne Bibliothek. Überschriften, Listen, Fett, Code und Tabellen als Text.
import { makeZip } from './zip.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MONO = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
const run = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;

function runs(text, base = '') {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map(t =>
    /^\*\*.+\*\*$/.test(t) ? run(t.slice(2, -2), base + '<w:b/>')
      : /^`.+`$/.test(t) ? run(t.slice(1, -1), base + MONO)
        : run(t, base)).join('');
}

export function markdownToDocx(markdown) {
  const body = [];
  let code = false;
  for (const line of String(markdown).split('\n')) {
    if (/^\s*```/.test(line)) { code = !code; continue; }
    if (code) { body.push(para(run(line, MONO + '<w:sz w:val="19"/>'), '<w:shd w:val="clear" w:color="auto" w:fill="F3F1EA"/><w:spacing w:after="0"/>')); continue; }
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) { body.push(para(runs(h[2], `<w:b/><w:sz w:val="${[0, 36, 30, 26][h[1].length]}"/>`), '<w:keepNext/><w:spacing w:before="240" w:after="80"/>')); continue; }
    const li = /^\s*(?:[-*]|\d+[.)])\s+(.*)/.exec(line);
    if (li) { body.push(para(runs(`${/^\s*\d/.test(line) ? line.trim().split(/\s/)[0] : '•'} ${li[1]}`), '<w:ind w:left="360" w:hanging="260"/><w:spacing w:after="40"/>')); continue; }
    if (/^\s*\|/.test(line)) {
      if (/^[\s|:-]+$/.test(line)) continue;
      body.push(para(runs(line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).join('   |   ')))); continue;
    }
    body.push(para(line.trim() ? runs(line) : ''));
  }
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
