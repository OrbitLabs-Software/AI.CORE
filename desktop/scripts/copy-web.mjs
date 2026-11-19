// Kopiert die Weboberfläche (index.html, src, public, pwa) in desktop/web, damit sie ins Programm gepackt wird.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const out = path.resolve(here, '..', 'web');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(repo, 'index.html'), path.join(out, 'index.html'));
for (const dir of ['src', 'public']) fs.cpSync(path.join(repo, dir), path.join(out, dir), { recursive: true });
fs.cpSync(path.join(repo, 'pwa'), out, { recursive: true });                       // Symbole, Manifest und sw.js liegen oben im Web-Ordner
// Symbole (Font Awesome) offline mitgeben, falls installiert
const fa = path.resolve(here, '..', 'node_modules', '@fortawesome', 'fontawesome-free');
const faOut = path.join(out, 'public', 'vendor', 'fa');
if (fs.existsSync(fa)) {
  fs.mkdirSync(path.join(faOut, 'css'), { recursive: true });
  fs.copyFileSync(path.join(fa, 'css', 'all.min.css'), path.join(faOut, 'css', 'all.min.css'));
  fs.cpSync(path.join(fa, 'webfonts'), path.join(faOut, 'webfonts'), { recursive: true });
}
fs.mkdirSync(path.resolve(here, '..', 'build'), { recursive: true });
fs.copyFileSync(path.join(repo, 'pwa', 'icon-512.png'), path.resolve(here, '..', 'build', 'icon.png'));
console.log('Weboberfläche kopiert nach', out);
