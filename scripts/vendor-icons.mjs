// Kopiert Font Awesome Free aus node_modules nach public/vendor/fa (läuft offline, auch in der App).
// Einmal ausführen:  npm install --save-dev @fortawesome/fontawesome-free && npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(repo, 'node_modules', '@fortawesome', 'fontawesome-free');
const to = path.join(repo, 'public', 'vendor', 'fa');
if (!fs.existsSync(from)) { console.error('Erst installieren: npm install --save-dev @fortawesome/fontawesome-free'); process.exit(1); }
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(path.join(to, 'css'), { recursive: true });
fs.copyFileSync(path.join(from, 'css', 'all.min.css'), path.join(to, 'css', 'all.min.css'));
fs.cpSync(path.join(from, 'webfonts'), path.join(to, 'webfonts'), { recursive: true });
console.log('Font Awesome kopiert nach', to);
