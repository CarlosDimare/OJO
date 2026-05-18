#!/usr/bin/env python3
"""
chatbot.py — Web chatbot powered by opencode
Run: python chatbot.py
"""

import json
import subprocess
import sys
import threading
from flask import Flask, Response, request, stream_with_context

app = Flask(__name__)

HTML = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OpenCode Chat</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #0d1117;
    --surface:   #161b22;
    --border:    #30363d;
    --text:      #e6edf3;
    --muted:     #8b949e;
    --accent:    #58a6ff;
    --user-bg:   #1f3a5f;
    --bot-bg:    #1c2128;
    --input-bg:  #21262d;
    --radius:    12px;
    --send:      #238636;
    --send-h:    #2ea043;
  }

  html, body { height: 100%; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.6; }

  /* ── Layout ── */
  .app { display: flex; flex-direction: column; height: 100vh; max-width: 860px;
    margin: 0 auto; padding: 0 12px; }

  header { padding: 18px 4px 14px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  header .logo { width: 32px; height: 32px; background: var(--accent);
    border-radius: 8px; display: grid; place-items: center; font-size: 18px; }
  header h1 { font-size: 17px; font-weight: 600; }
  header span { font-size: 12px; color: var(--muted); margin-left: 2px; }

  /* ── Messages ── */
  #messages { flex: 1; overflow-y: auto; padding: 20px 0; display: flex;
    flex-direction: column; gap: 16px; scroll-behavior: smooth; }

  .msg { display: flex; gap: 10px; align-items: flex-start; animation: fadein .18s ease; }
  @keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; } }

  .msg.user { flex-direction: row-reverse; }

  .avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center; font-size: 14px; font-weight: 700; }
  .msg.user .avatar  { background: #1f3a5f; color: var(--accent); }
  .msg.bot  .avatar  { background: #1c2128; border: 1px solid var(--border); color: var(--muted); }

  .bubble { max-width: min(72%, 640px); padding: 10px 14px; border-radius: var(--radius);
    word-break: break-word; white-space: pre-wrap; line-height: 1.65; }
  .msg.user .bubble { background: var(--user-bg); border-bottom-right-radius: 3px; }
  .msg.bot  .bubble { background: var(--bot-bg); border: 1px solid var(--border);
    border-bottom-left-radius: 3px; }

  /* Typing dots */
  .typing { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
  .typing span { width: 7px; height: 7px; background: var(--muted); border-radius: 50%;
    animation: blink 1.2s infinite; }
  .typing span:nth-child(2) { animation-delay: .2s; }
  .typing span:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }

  /* Code blocks inside bot messages */
  .bubble code { font-family: "Cascadia Code", "Fira Code", Menlo, monospace;
    font-size: 13px; background: rgba(255,255,255,.06); padding: 1px 5px;
    border-radius: 4px; }
  .bubble pre  { background: #0d1117; border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; overflow-x: auto; margin: 8px 0; }
  .bubble pre code { background: none; padding: 0; }

  /* ── Input ── */
  .input-row { padding: 14px 0 20px; display: flex; gap: 8px; flex-shrink: 0; }

  #input { flex: 1; background: var(--input-bg); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text); font-size: 15px;
    padding: 10px 14px; resize: none; height: 48px; max-height: 160px;
    font-family: inherit; line-height: 1.5; transition: border-color .2s;
    outline: none; overflow-y: auto; }
  #input:focus { border-color: var(--accent); }
  #input::placeholder { color: var(--muted); }

  #send { background: var(--send); color: #fff; border: none; border-radius: var(--radius);
    width: 48px; height: 48px; cursor: pointer; font-size: 18px; flex-shrink: 0;
    transition: background .15s; display: grid; place-items: center; }
  #send:hover:not(:disabled) { background: var(--send-h); }
  #send:disabled { opacity: .4; cursor: not-allowed; }

  /* ── Empty state ── */
  .empty { margin: auto; text-align: center; color: var(--muted); }
  .empty .icon { font-size: 48px; margin-bottom: 12px; }
  .empty p { font-size: 14px; }

  /* ── Scrollbar ── */
  #messages::-webkit-scrollbar { width: 6px; }
  #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  @media (max-width: 500px) {
    .bubble { max-width: 90%; }
    header h1 { font-size: 15px; }
  }
</style>
</head>
<body>
<div class="app">
  <header>
    <div class="logo">✦</div>
    <div>
      <h1>OpenCode Chat <span>beta</span></h1>
    </div>
  </header>

  <div id="messages">
    <div class="empty" id="empty">
      <div class="icon">✦</div>
      <p>Haz una pregunta para comenzar</p>
    </div>
  </div>

  <div class="input-row">
    <textarea id="input" placeholder="Escribe un mensaje... (Enter para enviar)" rows="1"></textarea>
    <button id="send" title="Enviar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</div>

<script>
const messagesEl = document.getElementById('messages');
const inputEl    = document.getElementById('input');
const sendBtn    = document.getElementById('send');
const emptyEl    = document.getElementById('empty');

let sessionId = null;
let busy      = false;

// Auto-grow textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = '48px';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!busy) sendMessage();
  }
});
sendBtn.addEventListener('click', () => { if (!busy) sendMessage(); });

function appendMsg(role, text) {
  if (emptyEl) emptyEl.remove();
  const msg = document.createElement('div');
  msg.className = 'msg ' + role;
  msg.innerHTML = `
    <div class="avatar">${role === 'user' ? 'U' : '✦'}</div>
    <div class="bubble"></div>`;
  messagesEl.appendChild(msg);
  const bubble = msg.querySelector('.bubble');
  if (text) bubble.textContent = text;
  scrollBottom();
  return bubble;
}

function appendTyping() {
  if (emptyEl) emptyEl.remove();
  const msg = document.createElement('div');
  msg.className = 'msg bot';
  msg.id = 'typing-msg';
  msg.innerHTML = `
    <div class="avatar">✦</div>
    <div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  messagesEl.appendChild(msg);
  scrollBottom();
}

function removeTyping() {
  const el = document.getElementById('typing-msg');
  if (el) el.remove();
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Minimal markdown: bold, inline code, code blocks, line breaks
function renderMarkdown(text) {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return escaped
    // fenced code blocks
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`)
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // line breaks
    .replace(/\n/g, '<br>');
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  busy = true;
  sendBtn.disabled = true;
  inputEl.value = '';
  inputEl.style.height = '48px';

  appendMsg('user', text);
  appendTyping();

  let botBubble = null;
  let fullText  = '';
  let firstChunk = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, session_id: sessionId }),
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        if (evt.type === 'session') {
          sessionId = evt.session_id;
        } else if (evt.type === 'text') {
          if (firstChunk) {
            removeTyping();
            botBubble = appendMsg('bot', '');
            firstChunk = false;
          }
          fullText += evt.text;
          botBubble.innerHTML = renderMarkdown(fullText);
          scrollBottom();
        } else if (evt.type === 'error') {
          removeTyping();
          appendMsg('bot', '⚠️ Error: ' + evt.message);
        }
      }
    }

    if (firstChunk) {
      // nothing streamed
      removeTyping();
      appendMsg('bot', '(Sin respuesta)');
    }

  } catch (err) {
    removeTyping();
    appendMsg('bot', '⚠️ Error de conexión: ' + err.message);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}
</script>
</body>
</html>
"""


def stream_opencode(message: str, session_id: str | None):
    """
    Calls `opencode run --format json [message]`, optionally continuing
    a previous session, and yields SSE lines.
    """
    cmd = ["opencode", "run", "--format", "json"]
    if session_id:
        cmd += ["--session", session_id]
    cmd.append(message)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        yield _sse({"type": "error", "message": "opencode not found. Install it with: npm install -g opencode"})
        return

    session_sent = False

    for raw_line in proc.stdout:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError:
            continue

        # Send session ID to client on first event
        if not session_sent and event.get("sessionID"):
            yield _sse({"type": "session", "session_id": event["sessionID"]})
            session_sent = True

        event_type = event.get("type", "")
        part = event.get("part", {})

        if event_type == "text" and part.get("type") == "text":
            text = part.get("text", "")
            if text:
                yield _sse({"type": "text", "text": text})

        elif event_type == "tool_use":
            tool = part.get("tool", "")
            if tool:
                yield _sse({"type": "text", "text": f"\n*[usando herramienta: {tool}]*\n"})

    proc.wait()

    if proc.returncode not in (0, None):
        stderr_out = proc.stderr.read().strip()
        if stderr_out:
            yield _sse({"type": "error", "message": stderr_out[:400]})

    yield _sse({"type": "done"})


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.route("/")
def index():
    return HTML, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/api/chat", methods=["POST"])
def chat():
    body       = request.get_json(silent=True) or {}
    message    = (body.get("message") or "").strip()
    session_id = body.get("session_id") or None

    if not message:
        return {"error": "empty message"}, 400

    return Response(
        stream_with_context(stream_opencode(message, session_id)),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = 5000
    print(f"✦ OpenCode Chat corriendo en http://localhost:{port}")
    print("  Presiona Ctrl+C para detener.\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
