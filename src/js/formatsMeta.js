// formatsMeta.js — welche Code-Blöcke und Antworten sich in Dateien verwandeln lassen (klein, ohne Abhängigkeiten).
import { blocks } from './mdblocks.js';

/** Sprache im Code-Block → Zielformate. Das erste Format ist das „eigene“ Format des Blocks. */
const BY_LANG = {
  xlsx: ['xlsx'], excel: ['xlsx'], tabelle: ['xlsx'], xls: ['xlsx'], csv: ['xlsx'], tsv: ['xlsx'],
  pptx: ['pptx'], powerpoint: ['pptx'], folien: ['pptx'], praesentation: ['pptx'], präsentation: ['pptx'], ppt: ['pptx'],
  pdf: ['pdf'],
  docx: ['docx'], word: ['docx'], doc: ['docx'],
  zip: ['zip'],
  md: ['docx', 'pdf'], markdown: ['docx', 'pdf'],
  svg: ['png', 'jpg'],
};

/** Formate, bei denen der Block selbst nur eine Beschreibung ist und „Laden“ die fertige Datei liefert. */
const NATIVE = new Set(['xlsx', 'excel', 'tabelle', 'xls', 'pptx', 'powerpoint', 'folien', 'praesentation', 'präsentation', 'ppt', 'pdf', 'docx', 'word', 'doc', 'zip']);

export const FORMAT_LABEL = { xlsx: 'Excel', pptx: 'PowerPoint', pdf: 'PDF', docx: 'Word', zip: 'ZIP', png: 'PNG', jpg: 'JPG', md: 'Markdown', txt: 'Text' };
export const FORMAT_EXT = { xlsx: 'xlsx', pptx: 'pptx', pdf: 'pdf', docx: 'docx', zip: 'zip', png: 'png', jpg: 'jpg', md: 'md', txt: 'txt' };

export const formatsFor = (lang) => BY_LANG[String(lang || '').toLowerCase()] || [];
export const isNativeLang = (lang) => NATIVE.has(String(lang || '').toLowerCase());

/** Welche Dateiformate bietet eine ganze Antwort an? (Menü „Datei“ unter der Antwort) */
export function messageExports(content) {
  const text = String(content ?? '');
  const out = [{ fmt: 'docx' }, { fmt: 'pdf' }, { fmt: 'md' }, { fmt: 'txt' }];
  const bl = blocks(text.replace(/^\s*<think>[\s\S]*?(?:<\/think>|$)/, ''));
  if (bl.some(b => b.type === 'table')) out.splice(2, 0, { fmt: 'xlsx' });
  if (bl.filter(b => b.type === 'h').length >= 2) out.splice(2, 0, { fmt: 'pptx' });
  return out.map(o => ({ ...o, label: FORMAT_LABEL[o.fmt] }));
}
