// lab.js — Linux-Testlabor (Coder Ultimate): eine Konsole, in der Programme in einem abgeschotteten Linux-Container laufen.
// Gehört zu AI Core Pro. Der Server führt nichts selbst aus; Docker kapselt jeden Lauf (kein Netz, Zeit- und Speichergrenze).
import { api } from './api.js';
import { openModal } from '../components/modal.js';
import { showToast, escapeHtml, isLinuxRunnable } from './ui.js';
import { ico } from './icons.js';

// Sprache → Dateiname und Befehl im Container
const RUN = {
  python: ['main.py', 'python3 main.py'], py: ['main.py', 'python3 main.py'],
  javascript: ['main.js', 'node main.js'], js: ['main.js', 'node main.js'], node: ['main.js', 'node main.js'],
  bash: ['main.sh', 'bash main.sh'], sh: ['main.sh', 'bash main.sh'], shell: ['main.sh', 'bash main.sh'],
  c: ['main.c', 'gcc main.c -o main && ./main'], cpp: ['main.cpp', 'g++ -std=c++17 main.cpp -o main && ./main'], 'c++': ['main.cpp', 'g++ -std=c++17 main.cpp -o main && ./main'],
  go: ['main.go', 'go run main.go'], ruby: ['main.rb', 'ruby main.rb'], rb: ['main.rb', 'ruby main.rb'], php: ['main.php', 'php main.php'],
  java: ['Main.java', 'javac Main.java && java Main'],
};
export const planFor = (lang) => RUN[String(lang || '').toLowerCase()] || null;

let term = null;   // { print(text, cls), run(command, files) } solange das Fenster offen ist

export function openLab({ command, files } = {}) {
  if (term) { if (command) term.run(command, files); return; }
  const history = []; let hi = 0;
  const render = () => {
    const wrap = document.createElement('div');
    wrap.className = 'lab';
    wrap.innerHTML = `
      <div class="lab-status" id="lab-status">Verbinde …</div>
      <pre class="lab-out" id="lab-out" tabindex="0"></pre>
      <form class="lab-in" id="lab-form"><span>$</span><input id="lab-cmd" autocomplete="off" spellcheck="false" placeholder="z. B. python3 main.py oder ls -la"><button class="btn primary" type="submit" id="lab-go"><b>Ausführen</b></button></form>
      <div class="lab-tools"><button class="btn" id="lab-shot" type="button" title="Startet den Befehl auf einem virtuellen Bildschirm und nimmt nach 3 Sekunden ein Bild auf">Bild aufnehmen</button><button class="btn" id="lab-files" type="button">Dateien</button><button class="btn" id="lab-reset" type="button">Leeren</button><small>Ubuntu · kein Netz · 30 s Zeitlimit · deine Dateien liegen unter /work</small></div>`;
    const out = wrap.querySelector('#lab-out'), input = wrap.querySelector('#lab-cmd'), status = wrap.querySelector('#lab-status'), go = wrap.querySelector('#lab-go');
    const print = (text, cls = '') => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; out.appendChild(s); out.scrollTop = out.scrollHeight; };
    let busy = false;
    const run = async (command, files) => {
      if (busy) return;
      busy = true; go.disabled = true; print(`$ ${command}\n`, 'lab-cmd');
      try {
        const r = await api.coderRun(command, files);
        if (r.output) print(r.output.endsWith('\n') ? r.output : `${r.output}\n`);
        print(r.timedOut ? `Zeitlimit erreicht (Exit ${r.exitCode})\n` : r.exitCode === 0 ? `Fertig in ${(r.ms / 1000).toFixed(1)} s\n` : `Fehler, Exit ${r.exitCode}\n`, r.exitCode === 0 ? 'lab-ok' : 'lab-err');
      } catch (e) { print(`${e.message}\n`, 'lab-err'); }
      busy = false; go.disabled = false; input.focus();
    };
    term = { print, run };
    wrap.querySelector('#lab-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const c = input.value.trim(); if (!c) return;
      history.push(c); hi = history.length; input.value = ''; run(c);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && history.length) { hi = Math.max(0, hi - 1); input.value = history[hi]; e.preventDefault(); }
      if (e.key === 'ArrowDown' && history.length) { hi = Math.min(history.length, hi + 1); input.value = history[hi] || ''; e.preventDefault(); }
    });
    wrap.querySelector('#lab-shot').addEventListener('click', async () => {
      const c = input.value.trim() || history.at(-1);
      if (!c) return print('Gib oben ein Programm ein (zum Beispiel python3 app.py) und klicke dann auf „Bild aufnehmen“.\n', 'lab-dim');
      if (busy) return;
      busy = true; go.disabled = true; print(`$ ${c}   (Bild nach 3 s)\n`, 'lab-cmd');
      try {
        const r = await api.coderShot(c);
        if (r.output) print(r.output.endsWith('\n') ? r.output : `${r.output}\n`);
        if (r.image) { const img = document.createElement('img'); img.src = r.image; img.alt = 'Bildschirm des Programms'; img.className = 'lab-shot'; out.appendChild(img); out.appendChild(document.createTextNode('\n')); out.scrollTop = out.scrollHeight; }
        else print(`${r.note || 'Kein Bild.'}\n`, 'lab-err');
      } catch (e) { print(`${e.message}\n`, 'lab-err'); }
      busy = false; go.disabled = false;
    });
    wrap.querySelector('#lab-files').addEventListener('click', async () => {
      try { const f = await api.coderFiles(); print(f.length ? `${f.map(x => `${x.path}  (${x.size} B)`).join('\n')}\n` : '(Arbeitsordner ist leer)\n', 'lab-dim'); } catch (e) { print(`${e.message}\n`, 'lab-err'); }
    });
    wrap.querySelector('#lab-reset').addEventListener('click', async () => {
      if (!confirm('Alle Dateien im Testlabor löschen?')) return;
      try { await api.coderReset(); out.textContent = ''; print('Arbeitsordner geleert.\n', 'lab-dim'); } catch (e) { print(`${e.message}\n`, 'lab-err'); }
    });
    api.coderStatus().then((s) => {
      status.className = `lab-status ${s.pro && s.available ? 'ok' : 'warn'}`;
      status.innerHTML = !s.pro ? 'Coder Ultimate gehört zu <b>AI Core Pro</b> (Einstellungen → Pro).' : s.available ? `${ico('linux', { style: 'brands' })} Linux-Testlabor bereit` : escapeHtml(s.reason || 'Nicht verfügbar');
      if (s.pro && s.available) { print('Linux-Testlabor bereit. Befehle laufen in einem abgeschotteten Ubuntu-Container.\n', 'lab-dim'); }
    }).catch((e) => { status.className = 'lab-status warn'; status.textContent = e.message || 'Server nicht erreichbar'; });
    if (command) setTimeout(() => run(command, files), 250);
    setTimeout(() => input.focus(), 50);
    return wrap;
  };
  openModal({ title: 'Linux-Testlabor', tabs: { terminal: { label: 'Terminal', render } }, initialTab: 'terminal', onClose: () => { term = null; } });
}

/** Ein Codeblock aus dem Chat im Testlabor ausführen. */
export function runSnippet({ code, lang, file }) {
  const plan = planFor(lang);
  if (!plan || !isLinuxRunnable(lang)) return showToast('Diese Sprache läuft im Testlabor nicht.');
  const name = file && /^[\w./-]+$/.test(file) && !file.includes('..') ? file : plan[0];
  const cmd = name === plan[0] ? plan[1] : plan[1].split(plan[0]).join(name);
  const body = lang && /^(bash|sh|shell)$/i.test(lang) && !code.startsWith('#!') ? code : code;
  openLab({ command: cmd, files: [{ path: name, content: body }] });
}
