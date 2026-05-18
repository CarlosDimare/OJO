#!/usr/bin/env node
/**
 * chatbot.js — Web chatbot powered by opencode
 * Run:  node chatbot.js
 * Zero external dependencies — only Node.js built-ins.
 */

const http    = require("http");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 5000;

/* ═══════════════════════════ HTML/CSS/JS ═══════════════════════════ */
const HTML = /* html */`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OpenCode Chat</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--border:#30363d;
  --text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;
  --user-bg:#1f3a5f;--bot-bg:#1c2128;--input-bg:#21262d;
  --send:#238636;--send-h:#2ea043;--r:12px;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-size:15px;line-height:1.6}
.app{display:flex;flex-direction:column;height:100vh;max-width:860px;
  margin:0 auto;padding:0 12px}

header{padding:16px 4px 12px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:10px;flex-shrink:0}
.logo{width:32px;height:32px;background:var(--accent);border-radius:8px;
  display:grid;place-items:center;font-size:17px;color:#fff;font-weight:700}
header h1{font-size:16px;font-weight:600}
header small{color:var(--muted);font-size:11px;margin-left:5px;
  background:rgba(255,255,255,.07);padding:2px 7px;border-radius:20px}

#msgs{flex:1;overflow-y:auto;padding:20px 0;display:flex;
  flex-direction:column;gap:14px;scroll-behavior:smooth}
.msg{display:flex;gap:10px;align-items:flex-start;
  animation:fi .16s ease}
@keyframes fi{from{opacity:0;transform:translateY(5px)}to{opacity:1}}
.msg.user{flex-direction:row-reverse}
.av{width:32px;height:32px;border-radius:50%;flex-shrink:0;
  display:grid;place-items:center;font-size:13px;font-weight:700;user-select:none}
.msg.user .av{background:#1f3a5f;color:var(--accent)}
.msg.bot  .av{background:#1c2128;border:1px solid var(--border);color:var(--muted)}
.bbl{max-width:min(73%,640px);padding:10px 14px;border-radius:var(--r);
  word-break:break-word;line-height:1.65}
.msg.user .bbl{background:var(--user-bg);border-bottom-right-radius:3px;white-space:pre-wrap}
.msg.bot  .bbl{background:var(--bot-bg);border:1px solid var(--border);
  border-bottom-left-radius:3px}

.dots{display:flex;gap:4px;align-items:center;padding:3px 0}
.dots span{width:7px;height:7px;background:var(--muted);border-radius:50%;
  animation:bk 1.2s infinite}
.dots span:nth-child(2){animation-delay:.2s}
.dots span:nth-child(3){animation-delay:.4s}
@keyframes bk{0%,80%,100%{opacity:.2}40%{opacity:1}}

.bbl code{font-family:"Cascadia Code","Fira Code",Menlo,monospace;font-size:13px;
  background:rgba(255,255,255,.07);padding:1px 5px;border-radius:4px}
.bbl pre{background:#010409;border:1px solid var(--border);border-radius:8px;
  padding:12px;overflow-x:auto;margin:8px 0}
.bbl pre code{background:none;padding:0;font-size:13px}
.bbl strong{color:#fff}
.bbl em{color:#ccc}
.bbl a{color:var(--accent)}

.row{padding:12px 0 18px;display:flex;gap:8px;flex-shrink:0}
#inp{flex:1;background:var(--input-bg);border:1px solid var(--border);
  border-radius:var(--r);color:var(--text);font-size:15px;
  padding:10px 14px;resize:none;height:48px;max-height:160px;
  font-family:inherit;line-height:1.5;outline:none;overflow-y:auto;
  transition:border-color .2s}
#inp:focus{border-color:var(--accent)}
#inp::placeholder{color:var(--muted)}
#btn{background:var(--send);color:#fff;border:none;border-radius:var(--r);
  width:48px;height:48px;cursor:pointer;flex-shrink:0;
  display:grid;place-items:center;transition:background .15s}
#btn:hover:not(:disabled){background:var(--send-h)}
#btn:disabled{opacity:.35;cursor:not-allowed}

.empty{margin:auto;text-align:center;color:var(--muted)}
.empty .ic{font-size:42px;margin-bottom:10px}
.empty p{font-size:13px}

#msgs::-webkit-scrollbar{width:5px}
#msgs::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
@media(max-width:500px){.bbl{max-width:90%}}
</style>
</head>
<body>
<div class="app">
  <header>
    <div class="logo">✦</div>
    <div><h1>OpenCode Chat<small>beta</small></h1></div>
  </header>
  <div id="msgs">
    <div class="empty" id="empty">
      <div class="ic">✦</div>
      <p>Haz una pregunta para comenzar</p>
    </div>
  </div>
  <div class="row">
    <textarea id="inp" placeholder="Escribe un mensaje… (Enter para enviar)" rows="1"></textarea>
    <button id="btn" title="Enviar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</div>
<script>
const msgsEl = document.getElementById('msgs');
const inpEl  = document.getElementById('inp');
const btnEl  = document.getElementById('btn');
let   sessId = null;
let   busy   = false;

inpEl.addEventListener('input', () => {
  inpEl.style.height = '48px';
  inpEl.style.height = Math.min(inpEl.scrollHeight, 160) + 'px';
});
inpEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) go(); }
});
btnEl.addEventListener('click', () => { if (!busy) go(); });

function addMsg(role, text) {
  document.getElementById('empty')?.remove();
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = '<div class="av">' + (role === 'user' ? 'U' : '✦') + '</div><div class="bbl"></div>';
  msgsEl.appendChild(d);
  const b = d.querySelector('.bbl');
  if (text) b.textContent = text;
  scroll();
  return b;
}
function addTyping() {
  document.getElementById('empty')?.remove();
  const d = document.createElement('div');
  d.id = 'tdot'; d.className = 'msg bot';
  d.innerHTML = '<div class="av">✦</div><div class="bbl"><div class="dots"><span></span><span></span><span></span></div></div>';
  msgsEl.appendChild(d); scroll();
}
function rmTyping() { document.getElementById('tdot')?.remove(); }
function scroll()   { msgsEl.scrollTop = msgsEl.scrollHeight; }

function md(raw) {
  // escape HTML first
  let t = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // fenced code blocks
  t = t.replace(/\`\`\`[\\w]*\\n?([\\s\\S]*?)\`\`\`/g, (_, c) =>
    '<pre><code>' + c.trim() + '</code></pre>');
  // inline code
  t = t.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
  // bold / italic
  t = t.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  t = t.replace(/\\*([^*\\n]+)\\*/g,    '<em>$1</em>');
  // headings
  t = t.replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>');
  // newlines (outside pre blocks — rough but good enough)
  t = t.replace(/\\n/g, '<br>');
  return t;
}

async function go() {
  const txt = inpEl.value.trim();
  if (!txt) return;
  busy = true; btnEl.disabled = true;
  inpEl.value = ''; inpEl.style.height = '48px';
  addMsg('user', txt);
  addTyping();

  let bubble = null, full = '', first = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: txt, session_id: sessId }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\\n');
      buf = lines.pop();
      for (const ln of lines) {
        if (!ln.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(ln.slice(6)); } catch { continue; }
        if (ev.type === 'session') {
          sessId = ev.session_id;
        } else if (ev.type === 'text') {
          if (first) { rmTyping(); bubble = addMsg('bot', ''); first = false; }
          full += ev.text;
          bubble.innerHTML = md(full);
          scroll();
        } else if (ev.type === 'error') {
          rmTyping(); addMsg('bot', '⚠️ ' + ev.message);
          first = false;
        }
      }
    }
    if (first) { rmTyping(); addMsg('bot', '(Sin respuesta)'); }
  } catch (err) {
    rmTyping(); addMsg('bot', '⚠️ ' + err.message);
  } finally {
    busy = false; btnEl.disabled = false; inpEl.focus();
  }
}
</script>
</body>
</html>`;

/* ═══════════════════════════ SSE helper ════════════════════════════ */
function sse(obj) {
  return "data: " + JSON.stringify(obj) + "\n\n";
}

/* ═══════════════════════════ opencode stream ═══════════════════════ */
function streamOpencode(res, message, sessionId) {
  const args = ["run", "--format", "json"];
  if (sessionId) args.push("--session", sessionId);
  args.push(message);

  let proc;
  try {
    proc = spawn("opencode", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    res.write(sse({ type: "error", message: "opencode no encontrado: " + err.message }));
    res.end();
    return;
  }

  let sessionSent = false;

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }

      // capture session ID on first event
      if (!sessionSent && event.sessionID) {
        res.write(sse({ type: "session", session_id: event.sessionID }));
        sessionSent = true;
      }

      const part = event.part || {};

      if (event.type === "text" && part.type === "text" && part.text) {
        res.write(sse({ type: "text", text: part.text }));
      } else if (event.type === "tool_use" && part.tool) {
        res.write(sse({ type: "text", text: "\n*[herramienta: " + part.tool + "]*\n" }));
      }
    }
  });

  let stderrBuf = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (d) => { stderrBuf += d; });

  proc.on("close", (code) => {
    if (code !== 0 && stderrBuf.trim()) {
      res.write(sse({ type: "error", message: stderrBuf.trim().slice(0, 400) }));
    }
    res.write(sse({ type: "done" }));
    res.end();
  });

  proc.on("error", (err) => {
    res.write(sse({ type: "error", message: err.message }));
    res.end();
  });

  // kill child if client disconnects
  res.on("close", () => { try { proc.kill(); } catch {} });
}

/* ═══════════════════════════ HTTP server ═══════════════════════════ */
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  if (req.method === "GET" && url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const message   = (parsed.message   || "").trim();
      const sessionId = parsed.session_id || null;

      if (!message) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "empty message" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache",
        "Connection":        "keep-alive",
        "X-Accel-Buffering": "no",
      });

      streamOpencode(res, message, sessionId);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n✦ OpenCode Chat corriendo en http://localhost:" + PORT);
  console.log("  Presiona Ctrl+C para detener.\n");
});
