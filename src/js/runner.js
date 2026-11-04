// runner.js — JavaScript aus einer Antwort sicher ausführen. Der Code läuft in einem abgeschotteten iframe
// (sandbox ohne Zugriff auf AI Core, ohne Speicher, ohne Netz) und meldet console.log und Fehler per postMessage zurück.
import { api } from './api.js';

const AsyncFn = '(Object.getPrototypeOf(async function(){}).constructor)';

export function buildRunnerHtml(code, id) {
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><body><script>
const ID=${json(id)};
const send=(type,text)=>parent.postMessage({aicoreRun:ID,type,text:String(text).slice(0,2000)},'*');
const fmt=(v)=>{if(typeof v==='string')return v;try{return v!==null&&typeof v==='object'?JSON.stringify(v,null,2):String(v)}catch(e){return String(v)}};
for(const k of ['log','info','warn','error','debug'])console[k]=(...a)=>send(k==='debug'?'log':k,a.map(fmt).join(' '));
addEventListener('error',e=>send('error',e.message));
addEventListener('unhandledrejection',e=>send('error',(e.reason&&e.reason.message)||e.reason));
(async()=>{try{await new ${AsyncFn}(${json(code)})()}catch(e){send('error',(e&&e.name?e.name+': ':'')+(e&&e.message||e))}send('done','')})();
<\/script></body>`;
}

/** @returns {Promise<{logs:{type:string,text:string}[], timedOut:boolean, ms:number}>} */
export async function runJs(code, { timeout = 8000 } = {}) {
  const id = Math.random().toString(36).slice(2);
  const started = Date.now();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
  const p = await api.preview('html', buildRunnerHtml(code, id));
  return new Promise((resolve) => {
    const logs = [];
    let finished = false;
    const finish = (timedOut) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); removeEventListener('message', onMsg); frame.remove();
      resolve({ logs, timedOut, ms: Date.now() - started });
    };
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow || e.data?.aicoreRun !== id) return;
      if (e.data.type === 'done') return finish(false);
      if (logs.length < 200) logs.push({ type: e.data.type, text: String(e.data.text) });
    };
    const timer = setTimeout(() => finish(true), timeout);
    addEventListener('message', onMsg);
    document.body.appendChild(frame);
    if (p.srcdoc) frame.srcdoc = p.srcdoc; else frame.src = p.url;
  });
}
