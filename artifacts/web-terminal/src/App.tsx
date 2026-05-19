import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const WS_URL = (() => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
})();

/* ── Full markdown renderer ─────────────────────────────────────── */
function md(raw: string): string {
  // 1. Protect fenced code blocks first
  const codeBlocks: string[] = [];
  let t = raw.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang: string, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre class="md-pre"><code class="md-code">${esc(code.trim())}</code></pre>`
    );
    return `\x00CODE${idx}\x00`;
  });

  // 2. Escape HTML in remaining text
  t = escLines(t);

  // 3. Inline code
  t = t.replace(/`([^`\n]+)`/g, `<code class="md-inline-code">$1</code>`);

  // 4. Bold / italic
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  t = t.replace(/\*\*([^*]+)\*\*/g,     "<strong>$1</strong>");
  t = t.replace(/\*([^*\n]+)\*/g,       "<em>$1</em>");
  t = t.replace(/_([^_\n]+)_/g,         "<em>$1</em>");

  // 5. Links — normal [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>`);

  // 6. <small>[text](url)</small> — citation style (already escaped, undo for link)
  t = t.replace(/&lt;small&gt;\[([^\]]+)\]\(([^)]+)\)&lt;\/small&gt;/g,
    `<a href="$2" target="_blank" rel="noopener" class="md-cite">$1</a>`);

  // 7. Headings (## heading)
  t = t.replace(/^### (.+)$/gm, `<p class="md-h3">$1</p>`);
  t = t.replace(/^## (.+)$/gm,  `<p class="md-h2">$1</p>`);
  t = t.replace(/^# (.+)$/gm,   `<p class="md-h1">$1</p>`);

  // 8. Blockquote
  t = t.replace(/^&gt; (.+)$/gm, `<blockquote class="md-blockquote">$1</blockquote>`);

  // 9. Horizontal rule
  t = t.replace(/^---+$/gm, `<hr class="md-hr">`);

  // 10. Lists — unordered (- or *)
  t = t.replace(/^[-*] (.+)$/gm, `<li class="md-li">$1</li>`);
  t = t.replace(/(<li class="md-li">[\s\S]*?<\/li>)(\n(?!<li))/g, "$1</ul>\n");
  t = t.replace(/(<li class="md-li">)/g, (m, _, offset, str) => {
    const before = str.slice(0, offset);
    const prevUl = before.lastIndexOf("<ul");
    const prevEnd = before.lastIndexOf("</ul>");
    return (prevEnd > prevUl || prevUl === -1) ? `<ul class="md-ul">` + m : m;
  });
  // close unclosed ul
  t = t.replace(/(<li class="md-li">(?:(?!<\/ul>)[\s\S])*?<\/li>)(?![\s\S]*<\/ul>)/,
    "$1</ul>");

  // 11. Ordered lists (1. 2. etc.)
  t = t.replace(/^\d+\. (.+)$/gm, `<li class="md-oli">$1</li>`);
  t = t.replace(/(<li class="md-oli">)/g, (m, _, offset, str) => {
    const before = str.slice(0, offset);
    const prevOl = before.lastIndexOf("<ol");
    const prevEnd = before.lastIndexOf("</ol>");
    return (prevEnd > prevOl || prevOl === -1) ? `<ol class="md-ol">` + m : m;
  });

  // 12. Paragraphs — double newline → paragraph break
  t = t.replace(/\n{2,}/g, `</p><p class="md-p">`);
  t = `<p class="md-p">${t}</p>`;

  // 13. Single newlines within paragraphs
  t = t.replace(/\n/g, "<br>");

  // 14. Restore code blocks
  t = t.replace(/\x00CODE(\d+)\x00/g, (_, i: string) => codeBlocks[parseInt(i)]);

  // 15. Clean up empty paragraphs
  t = t.replace(/<p class="md-p"><\/p>/g, "");
  t = t.replace(/<p class="md-p">(<(?:ul|ol|pre|blockquote|hr|p)\b)/g, "$1");
  t = t.replace(/(<\/(?:ul|ol|pre|blockquote)>)<\/p>/g, "$1");

  return t;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escLines(s: string): string {
  // escape HTML but preserve \n
  return s
    .split("\n")
    .map((line) => {
      // don't double-escape placeholders
      if (line.includes("\x00CODE")) return line;
      return esc(line);
    })
    .join("\n");
}

interface ChatMessage {
  role: "user" | "bot";
  text: string;
  html?: string;
}

type View = "terminal" | "chat";

const CHAT_CSS = `
  .md-p    { margin: 0 0 .6em; line-height: 1.75; }
  .md-p:last-child { margin-bottom: 0; }
  .md-h1   { font-size: 1.15em; font-weight: 700; color: #fff; margin: .8em 0 .4em; letter-spacing: .01em; }
  .md-h2   { font-size: 1.05em; font-weight: 700; color: #f0f0f0; margin: .7em 0 .35em; }
  .md-h3   { font-size: .97em;  font-weight: 700; color: #ddd; margin: .6em 0 .3em; }
  .md-ul, .md-ol { margin: .4em 0 .6em 1.4em; padding: 0; }
  .md-li, .md-oli { margin-bottom: .25em; line-height: 1.7; }
  .md-pre  { background: #0a0a0a; border-left: 3px solid #cc0000; padding: 12px 14px;
             margin: .7em 0; overflow-x: auto; border-radius: 2px; }
  .md-code { font-family: "Cascadia Code","Fira Code",Menlo,monospace; font-size: 12.5px;
             color: #e8e8e8; display: block; }
  .md-inline-code { font-family: "Cascadia Code","Fira Code",Menlo,monospace; font-size: 12px;
             background: #1c1c1c; border: 1px solid #2a2a2a; padding: 1px 5px; border-radius: 2px; color: #e0e0e0; }
  .md-link { color: #4a9eff; text-decoration: underline; text-underline-offset: 2px; }
  .md-link:hover { color: #79baff; }
  .md-cite { color: #888; font-size: .78em; text-decoration: underline;
             text-underline-offset: 2px; display: inline-block; margin-top: .15em; }
  .md-cite:hover { color: #aaa; }
  .md-blockquote { border-left: 3px solid #cc0000; margin: .5em 0; padding: .3em 0 .3em .8em;
                   color: #aaa; font-style: italic; }
  .md-hr { border: none; border-top: 1px solid #2a2a2a; margin: .8em 0; }
  strong { color: #fff; }
  em     { color: #ccc; }
`;

/* ══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [view, setView] = useState<View>("terminal");

  const terminalRef          = useRef<HTMLDivElement>(null);
  const termRef              = useRef<Terminal | null>(null);
  const fitAddonRef          = useRef<FitAddon | null>(null);
  const wsRef                = useRef<WebSocket | null>(null);
  const reconnectTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;

  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState("");
  const [busy, setBusy]           = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef            = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLTextAreaElement>(null);

  /* ── Terminal ───────────────────────────────────────────────────── */
  const connect = useCallback(() => {
    if (!termRef.current) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      termRef.current?.write("\r\n\x1b[32mConnected.\x1b[0m\r\n");
      fitAddonRef.current?.fit();
      const { cols, rows } = termRef.current!;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "output") termRef.current?.write(msg.data as string);
        else if (msg.type === "exit")
          termRef.current?.write(`\r\n\x1b[33mExited (${msg.exitCode}).\x1b[0m\r\n`);
      } catch {}
    };
    ws.onclose = () => {
      termRef.current?.write("\r\n\x1b[31mDisconnected.\x1b[0m\r\n");
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 15000);
        reconnectAttemptsRef.current += 1;
        termRef.current?.write(`\x1b[33mReconnecting in ${Math.round(delay / 1000)}s…\x1b[0m\r\n`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
    ws.onerror = () => termRef.current?.write("\r\n\x1b[31mWS error.\x1b[0m\r\n");
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code","Fira Code",Menlo,monospace',
      fontSize: 14, lineHeight: 1.25,
      theme: {
        background: "#0a0a0a", foreground: "#e8e8e8", cursor: "#cc0000",
        cursorAccent: "#0a0a0a", black: "#1a1a1a", red: "#cc0000",
        green: "#5a9a3a", yellow: "#c8a030", blue: "#4a7ab0",
        magenta: "#9a4a8a", cyan: "#3a8a9a", white: "#c8c8c8",
        brightBlack: "#444", brightRed: "#e83030", brightGreen: "#70ba50",
        brightYellow: "#e0c050", brightBlue: "#5a90c8", brightMagenta: "#ba5aba",
        brightCyan: "#50aaba", brightWhite: "#f0f0f0",
        selectionBackground: "#cc000040",
      },
      allowProposedApi: true, scrollback: 10000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    term.write("\x1b[90mConnecting…\x1b[0m\r\n");
    connect();

    term.onData((d) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "input", data: d }));
    });
    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const ro = new ResizeObserver(() => fitAddon.fit());
    if (terminalRef.current) ro.observe(terminalRef.current);
    window.addEventListener("resize", () => fitAddon.fit());

    return () => {
      ro.disconnect();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      term.dispose();
    };
  }, [connect]);

  useEffect(() => { setTimeout(() => fitAddonRef.current?.fit(), 50); }, [view]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  /* ── Send chat ──────────────────────────────────────────────────── */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");
    setMessages((p) => [...p, { role: "user", text }]);
    setMessages((p) => [...p, { role: "bot", text: "", html: "" }]);
    let full = "";
    let curSession = sessionId;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: curSession }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const ln of lines) {
          if (!ln.startsWith("data: ")) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(ln.slice(6)) as Record<string, unknown>; } catch { continue; }
          if (ev["type"] === "session") {
            curSession = ev["session_id"] as string;
            setSessionId(curSession);
          } else if (ev["type"] === "text") {
            full += ev["text"] as string;
            setMessages((p) => {
              const n = [...p];
              n[n.length - 1] = { role: "bot", text: full, html: md(full) };
              return n;
            });
          } else if (ev["type"] === "error") {
            const html = `<span style="color:#e83030">⚠ ${ev["message"] as string}</span>`;
            setMessages((p) => {
              const n = [...p];
              n[n.length - 1] = { role: "bot", text: "", html };
              return n;
            });
          }
        }
      }
      if (!full)
        setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "—", html: "—" }; return n; });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((p) => {
        const n = [...p];
        n[n.length - 1] = { role: "bot", text: "", html: `<span style="color:#e83030">⚠ ${msg}</span>` };
        return n;
      });
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, busy, sessionId]);

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#0a0a0a",
      display: "flex", flexDirection: "column", overflow: "hidden",
      fontFamily: "'Arial Black','Helvetica Neue',Arial,sans-serif",
    }}>

      {/* ════ NAV ════ */}
      <nav style={{
        flexShrink: 0, background: "#0a0a0a",
        borderBottom: "3px solid #cc0000",
        display: "flex", alignItems: "stretch",
        height: 52, position: "relative",
      }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: "#cc0000" }} />

        <div style={{ paddingLeft: 20, paddingRight: 24, display: "flex",
          alignItems: "center", gap: 10, borderRight: "2px solid #1a1a1a" }}>
          <div style={{ width: 22, height: 22, background: "#cc0000", transform: "rotate(45deg)", flexShrink: 0 }} />
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 900, letterSpacing: ".15em", textTransform: "uppercase" }}>
            SYSTEM
          </span>
        </div>

        {(["terminal", "chat"] as const).map((v) => {
          const active = view === v;
          const label  = v === "terminal" ? "▸ TERMINAL" : "◈ CHATBOT";
          return (
            <button key={v} data-testid={`button-nav-${v}`} onClick={() => setView(v)}
              style={{
                background: active ? "#cc0000" : "transparent",
                color: active ? "#fff" : "#666",
                border: "none", cursor: "pointer", padding: "0 28px", fontSize: 12,
                fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase",
                borderRight: "2px solid #1a1a1a", transition: "background .15s, color .15s",
                fontFamily: "inherit", position: "relative",
              }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#cc0000"; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#666"; }}
            >
              {label}
              {active && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "#fff" }} />}
            </button>
          );
        })}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingRight: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6,
            border: "1px solid #cc0000", padding: "3px 10px" }}>
            <div style={{ width: 6, height: 6, background: "#cc0000", borderRadius: "50%", animation: "pulse 1.8s infinite" }} />
            <span style={{ color: "#cc0000", fontSize: 10, fontWeight: 900, letterSpacing: ".15em", textTransform: "uppercase" }}>
              LIVE
            </span>
          </div>
        </div>
      </nav>

      {/* ════ TERMINAL ════ */}
      <div style={{ flex: view === "terminal" ? 1 : 0, display: view === "terminal" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={{ background: "#111", borderBottom: "1px solid #1a1a1a",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 5 }}>
            {["#cc0000", "#c8a030", "#5a9a3a"].map((c) => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
            ))}
          </div>
          <span style={{ color: "#444", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>
            bash — ~/workspace
          </span>
        </div>
        <div ref={terminalRef} data-testid="terminal-container"
          style={{ flex: 1, padding: "6px 4px", overflow: "hidden" }} />
      </div>

      {/* ════ CHAT ════ */}
      <div style={{ flex: view === "chat" ? 1 : 0, display: view === "chat" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden", background: "#0a0a0a", minHeight: 0 }}>

        {/* Sub-header */}
        <div style={{ background: "#111", borderBottom: "1px solid #1a1a1a",
          padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 14, height: 14, background: "#cc0000", flexShrink: 0 }} />
          <span style={{ color: "#999", fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>
            OpenCode — Periodismo de datos
          </span>
          {sessionId && (
            <span style={{ marginLeft: "auto", color: "#333", fontSize: 10, fontWeight: 700,
              letterSpacing: ".08em", textTransform: "uppercase", border: "1px solid #222", padding: "2px 8px" }}>
              sesión activa
            </span>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 0 12px",
          display: "flex", flexDirection: "column", gap: 0 }}>
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", userSelect: "none" }}>
              <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 16px" }}>
                <div style={{ position: "absolute", inset: 0, border: "3px solid #cc0000" }} />
                <div style={{ position: "absolute", top: 8, left: 8, right: 8, bottom: 8,
                  background: "#cc0000", display: "grid", placeItems: "center" }}>
                  <span style={{ color: "#fff", fontSize: 26, fontWeight: 900 }}>✦</span>
                </div>
              </div>
              <p style={{ color: "#333", fontSize: 11, fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase" }}>
                LISTO PARA ANALIZAR
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{
              display: "flex",
              flexDirection: m.role === "user" ? "row-reverse" : "row",
              alignItems: "flex-start", gap: 12, marginBottom: 20,
              padding: "0 20px",
              maxWidth: 860, width: "100%",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              boxSizing: "border-box",
            }}>
              {/* Avatar */}
              <div style={{
                width: 28, height: 28, flexShrink: 0,
                background: m.role === "user" ? "#cc0000" : "#1a1a1a",
                border: m.role === "bot" ? "2px solid #cc0000" : "none",
                display: "grid", placeItems: "center",
                fontWeight: 900, fontSize: 11,
                color: m.role === "user" ? "#fff" : "#cc0000",
                letterSpacing: ".05em",
                fontFamily: "'Arial Black',Arial,sans-serif",
              }}>
                {m.role === "user" ? "U" : "A"}
              </div>

              {/* Bubble */}
              <div style={{
                background: m.role === "user" ? "#cc0000" : "#111",
                border: m.role === "bot" ? "1px solid #1c1c1c" : "none",
                borderLeft: m.role === "bot" ? "3px solid #cc0000" : undefined,
                padding: "12px 16px",
                maxWidth: "calc(100% - 52px)",
                color: m.role === "user" ? "#fff" : "#d8d8d8",
                fontSize: 15,
                wordBreak: "break-word",
                // ChatGPT-style readable font for chat content
                fontFamily: m.role === "bot"
                  ? "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"
                  : "inherit",
                fontWeight: m.role === "bot" ? 400 : 700,
              }}>
                {m.role === "user" ? (
                  <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                ) : m.html ? (
                  <span dangerouslySetInnerHTML={{ __html: m.html }} />
                ) : (
                  <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                    {[0, 0.25, 0.5].map((d, j) => (
                      <span key={j} style={{
                        width: 5, height: 5, background: "#cc0000",
                        display: "inline-block", animation: `pulse 1.2s ${d}s infinite`,
                      }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ borderTop: "2px solid #cc0000", padding: "12px 20px 16px",
          background: "#0a0a0a", display: "flex", gap: 10, flexShrink: 0, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            data-testid="input-chat"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "42px";
              e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
            }}
            placeholder="ESCRIBE UN MENSAJE…"
            rows={1}
            disabled={busy}
            style={{
              flex: 1, background: "#111", border: "2px solid #222",
              color: "#e8e8e8", fontSize: 13, padding: "10px 14px",
              resize: "none", height: 42, maxHeight: 140,
              fontFamily: "'Arial Black',Arial,sans-serif", fontWeight: 700,
              letterSpacing: ".04em", lineHeight: 1.5, outline: "none",
              overflow: "auto", transition: "border-color .15s",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#cc0000")}
            onBlur={(e)  => (e.target.style.borderColor = "#222")}
          />
          <button
            data-testid="button-chat-send"
            onClick={() => void sendMessage()}
            disabled={busy || !input.trim()}
            style={{
              background: busy || !input.trim() ? "#1a1a1a" : "#cc0000",
              color: busy || !input.trim() ? "#333" : "#fff",
              border: "none", cursor: busy || !input.trim() ? "not-allowed" : "pointer",
              width: 42, height: 42, display: "grid", placeItems: "center",
              flexShrink: 0, transition: "background .15s, color .15s", fontFamily: "inherit",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Global + markdown styles */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:.2;transform:scale(1)} 50%{opacity:1;transform:scale(1.15)} }
        textarea::placeholder { color:#333; letter-spacing:.1em; }
        *::-webkit-scrollbar { width:4px; }
        *::-webkit-scrollbar-track { background:#0a0a0a; }
        *::-webkit-scrollbar-thumb { background:#cc0000; }
        ${CHAT_CSS}
      `}</style>
    </div>
  );
}
