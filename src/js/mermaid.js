// mermaid.js — Diagramme (```mermaid) in der Vorschau zeichnen. Die Seite lädt die Bibliothek von jsDelivr und läuft
// wie jede Vorschau abgeschottet (sandbox, ohne Zugriff auf AI Core). Dafür braucht der Browser Internet.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mermaidPage(code) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#fff;color:#1f1e1d}.mermaid{display:flex;justify-content:center}#err{display:none;padding:12px 14px;border-radius:10px;background:#fdecea;color:#8a2a1f;font-size:14px}</style></head>
<body><pre class="mermaid">${esc(code)}</pre><div id="err"></div>
<script>function e(m){var d=document.getElementById('err');d.style.display='block';d.textContent=m}</script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js" onerror="e('Die Diagramm-Bibliothek konnte nicht geladen werden. Bist du online?')"></script>
<script>
addEventListener('load',function(){
  if(!window.mermaid){return e('Die Diagramm-Bibliothek konnte nicht geladen werden. Bist du online?')}
  mermaid.initialize({startOnLoad:false,theme:'neutral',securityLevel:'strict'});
  mermaid.run({querySelector:'.mermaid'}).catch(function(x){e('Das Diagramm hat einen Fehler: '+String(x&&x.message||x).slice(0,300))});
});
</script></body></html>`;
}
