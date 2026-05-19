import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const WS_URL = (() => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
})();

/* ── Markdown (no deps) ─────────────────────────────────────────── */
function md(raw: string): string {
  let t = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  t = t.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c: string) =>
    `<pre style="background:#0a0a0a;border-left:3px solid #cc0000;padding:10px 12px;margin:8px 0;overflow-x:auto;font-size:12px">`
    + `<code style="font-family:'Cascadia Code','Fira Code',Menlo,monospace;color:#e8e8e8">${c.trim()}</code></pre>`,
  );
  t = t.replace(/`([^`\n]+)`/g,
    `<code style="background:#1a1a1a;border:1px solid #333;padding:1px 5px;font-size:12px;font-family:monospace">$1</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  t = t.replace(/^#{1,3} (.+)$/gm, "<strong style='color:#fff;text-transform:uppercase;letter-spacing:.05em'>$1</strong>");
  t = t.replace(/\n/g, "<br>");
  return t;
}

interface ChatMessage {
  role: "user" | "bot";
  text: string;
  html?: string;
}

type View = "terminal" | "chat";

/* ══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [view, setView] = useState<View>("terminal");

  /* ── Terminal refs ──────────────────────────────────────────────── */
  const terminalRef        = useRef<HTMLDivElement>(null);
  const termRef            = useRef<Terminal | null>(null);
  const fitAddonRef        = useRef<FitAddon | null>(null);
  const wsRef              = useRef<WebSocket | null>(null);
  const reconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;

  /* ── Chat state ─────────────────────────────────────────────────── */
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState("");
  const [busy, setBusy]           = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef            = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLTextAreaElement>(null);

  /* ── Terminal connect ───────────────────────────────────────────── */
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
      fontSize: 14,
      lineHeight: 1.25,
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
      allowProposedApi: true,
      scrollback: 10000,
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

  useEffect(() => {
    setTimeout(() => fitAddonRef.current?.fit(), 50);
  }, [view]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
          try { ev = JSON.parse(ln.slice(6)) as Record<string, unknown>; }
          catch { continue; }
          if (ev["type"] === "session") {
            curSession = ev["session_id"] as string;
            setSessionId(curSession);
          } else if (ev["type"] === "text") {
            full += ev["text"] as string;
            const html = md(full);
            setMessages((p) => {
              const n = [...p];
              n[n.length - 1] = { role: "bot", text: full, html };
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
        setMessages((p) => {
          const n = [...p];
          n[n.length - 1] = { role: "bot", text: "—", html: "—" };
          return n;
        });
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

      {/* ════ CONSTRUCTIVIST NAV BAR ════ */}
      <nav style={{
        flexShrink: 0, background: "#0a0a0a",
        borderBottom: "3px solid #cc0000",
        display: "flex", alignItems: "stretch",
        height: 52, position: "relative", overflow: "hidden",
      }}>
        {/* Red diagonal accent */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: 6, background: "#cc0000",
        }} />

        {/* Title block */}
        <div style={{
          paddingLeft: 20, paddingRight: 24, display: "flex",
          alignItems: "center", gap: 10, borderRight: "2px solid #222",
        }}>
          <div style={{
            width: 22, height: 22, background: "#cc0000",
            transform: "rotate(45deg)", flexShrink: 0,
          }} />
          <span style={{
            color: "#fff", fontSize: 13, fontWeight: 900,
            letterSpacing: ".15em", textTransform: "uppercase",
          }}>
            SYSTEM
          </span>
        </div>

        {/* Nav tabs */}
        {(["terminal", "chat"] as const).map((v) => {
          const active = view === v;
          const label = v === "terminal" ? "▸ TERMINAL" : "◈ CHATBOT";
          return (
            <button
              key={v}
              data-testid={`button-nav-${v}`}
              onClick={() => setView(v)}
              style={{
                background: active ? "#cc0000" : "transparent",
                color: active ? "#fff" : "#666",
                border: "none", cursor: "pointer",
                padding: "0 28px", fontSize: 12,
                fontWeight: 900, letterSpacing: ".12em",
                textTransform: "uppercase",
                borderRight: "2px solid #1a1a1a",
                transition: "background .15s, color .15s",
                fontFamily: "inherit",
                position: "relative",
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.color = "#cc0000";
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.color = "#666";
              }}
            >
              {label}
              {active && (
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  height: 3, background: "#fff",
                }} />
              )}
            </button>
          );
        })}

        {/* Status pill */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingRight: 20 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            border: "1px solid #cc0000", padding: "3px 10px",
          }}>
            <div style={{ width: 6, height: 6, background: "#cc0000",
              borderRadius: "50%", animation: "pulse 1.8s infinite" }} />
            <span style={{ color: "#cc0000", fontSize: 10, fontWeight: 900,
              letterSpacing: ".15em", textTransform: "uppercase" }}>
              LIVE
            </span>
          </div>
        </div>
      </nav>

      {/* ════ TERMINAL VIEW ════ */}
      <div style={{
        flex: view === "terminal" ? 1 : 0,
        display: view === "terminal" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden",
        minHeight: 0,
      }}>
        {/* Terminal sub-header */}
        <div style={{
          background: "#111", borderBottom: "1px solid #1a1a1a",
          padding: "6px 16px", display: "flex", alignItems: "center",
          gap: 10, flexShrink: 0,
        }}>
          <div style={{ display: "flex", gap: 5 }}>
            {["#cc0000", "#c8a030", "#5a9a3a"].map((c) => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
            ))}
          </div>
          <span style={{ color: "#444", fontSize: 11, fontWeight: 700,
            letterSpacing: ".1em", textTransform: "uppercase" }}>
            bash — ~/workspace
          </span>
        </div>
        <div
          ref={terminalRef}
          data-testid="terminal-container"
          style={{ flex: 1, padding: "6px 4px", overflow: "hidden" }}
        />
      </div>

      {/* ════ CHAT VIEW ════ */}
      <div style={{
        flex: view === "chat" ? 1 : 0,
        display: view === "chat" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden",
        background: "#0a0a0a", minHeight: 0,
      }}>
        {/* Chat sub-header */}
        <div style={{
          background: "#111", borderBottom: "1px solid #1a1a1a",
          padding: "8px 20px", display: "flex", alignItems: "center",
          gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: 14, height: 14, background: "#cc0000", flexShrink: 0,
          }} />
          <span style={{ color: "#999", fontSize: 11, fontWeight: 700,
            letterSpacing: ".12em", textTransform: "uppercase" }}>
            OpenCode — Conversación
          </span>
          {sessionId && (
            <span style={{
              marginLeft: "auto", color: "#333", fontSize: 10,
              fontWeight: 700, letterSpacing: ".08em",
              textTransform: "uppercase", border: "1px solid #222",
              padding: "2px 8px",
            }}>
              sesión activa
            </span>
          )}
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "24px 20px 12px",
          display: "flex", flexDirection: "column", gap: 0,
        }}>
          {messages.length === 0 && (
            <div style={{
              margin: "auto", textAlign: "center", userSelect: "none",
            }}>
              {/* Constructivist graphic */}
              <div style={{ position: "relative", width: 80, height: 80, margin: "0 auto 20px" }}>
                <div style={{ position: "absolute", inset: 0, border: "3px solid #cc0000" }} />
                <div style={{
                  position: "absolute", top: 8, left: 8, right: 8, bottom: 8,
                  background: "#cc0000", display: "grid", placeItems: "center",
                }}>
                  <span style={{ color: "#fff", fontSize: 28, fontWeight: 900 }}>✦</span>
                </div>
              </div>
              <p style={{ color: "#333", fontSize: 11, fontWeight: 700,
                letterSpacing: ".18em", textTransform: "uppercase" }}>
                LISTO PARA OPERAR
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{
              display: "flex",
              flexDirection: m.role === "user" ? "row-reverse" : "row",
              alignItems: "flex-start", gap: 12,
              marginBottom: 16,
              maxWidth: 820, width: "100%",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
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
              }}>
                {m.role === "user" ? "U" : "A"}
              </div>

              {/* Bubble */}
              <div style={{
                background: m.role === "user" ? "#cc0000" : "#111",
                border: m.role === "bot" ? "1px solid #1a1a1a" : "none",
                borderLeft: m.role === "bot" ? "3px solid #cc0000" : undefined,
                padding: "10px 14px",
                maxWidth: "calc(100% - 52px)",
                color: m.role === "user" ? "#fff" : "#d8d8d8",
                fontSize: 14, lineHeight: 1.65,
                wordBreak: "break-word",
              }}>
                {m.role === "user" ? (
                  <span style={{ whiteSpace: "pre-wrap", fontFamily: "Arial,sans-serif" }}>{m.text}</span>
                ) : m.html ? (
                  <span dangerouslySetInnerHTML={{ __html: m.html }} />
                ) : (
                  /* typing indicator */
                  <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                    {[0, 0.25, 0.5].map((d, j) => (
                      <span key={j} style={{
                        width: 5, height: 5, background: "#cc0000",
                        display: "inline-block",
                        animation: `pulse 1.2s ${d}s infinite`,
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
        <div style={{
          borderTop: "2px solid #cc0000", padding: "12px 20px 16px",
          background: "#0a0a0a", display: "flex", gap: 10, flexShrink: 0,
          alignItems: "flex-end",
        }}>
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="ESCRIBE UN MENSAJE…"
            rows={1}
            disabled={busy}
            style={{
              flex: 1, background: "#111", border: "2px solid #222",
              color: "#e8e8e8", fontSize: 13, padding: "10px 14px",
              resize: "none", height: 42, maxHeight: 140,
              fontFamily: "inherit", fontWeight: 700, letterSpacing: ".04em",
              lineHeight: 1.5, outline: "none", overflow: "auto",
              transition: "border-color .15s",
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
              flexShrink: 0, transition: "background .15s, color .15s",
              fontFamily: "inherit",
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

      {/* Global keyframes */}
      <style>{`
        @keyframes pulse {
          0%,100% { opacity: .2; transform: scale(1); }
          50%      { opacity: 1;  transform: scale(1.15); }
        }
        textarea::placeholder { color: #333; letter-spacing: .1em; }
        *::-webkit-scrollbar { width: 4px; }
        *::-webkit-scrollbar-track { background: #0a0a0a; }
        *::-webkit-scrollbar-thumb { background: #cc0000; }
      `}</style>
    </div>
  );
}
