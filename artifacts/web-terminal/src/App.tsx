import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const WS_URL = (() => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
})();

/* ── Markdown renderer (no deps) ─────────────────────────────────── */
function md(raw: string): string {
  let t = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  t = t.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c: string) =>
    `<pre style="background:#010409;border:1px solid #30363d;border-radius:7px;padding:10px;overflow-x:auto;margin:6px 0;font-size:12px">`
    + `<code style="font-family:'Cascadia Code','Fira Code',Menlo,monospace">${c.trim()}</code></pre>`,
  );
  t = t.replace(/`([^`\n]+)`/g, `<code style="background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;font-size:12px">$1</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*\n]+)\*/g, "<em style='color:#ccc'>$1</em>");
  t = t.replace(/^#{1,3} (.+)$/gm, "<strong style='color:#fff'>$1</strong>");
  t = t.replace(/\n/g, "<br>");
  return t;
}

/* ── Chat types ──────────────────────────────────────────────────── */
interface ChatMessage {
  role: "user" | "bot";
  text: string;
  html?: string;
}

/* ══════════════════════════════════════════════════════════════════ */
export default function App() {
  /* terminal refs */
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;

  /* chat state */
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ── Terminal connect ─────────────────────────────────────────── */
  const connect = useCallback(() => {
    if (!termRef.current) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      termRef.current?.write("\r\n\x1b[32mConnected to terminal.\x1b[0m\r\n");
      fitAddonRef.current?.fit();
      const { cols, rows } = termRef.current!;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "output") termRef.current?.write(msg.data as string);
        else if (msg.type === "exit")
          termRef.current?.write(
            `\r\n\x1b[33mProcess exited with code ${msg.exitCode}.\x1b[0m\r\n`,
          );
      } catch {}
    };

    ws.onclose = () => {
      termRef.current?.write("\r\n\x1b[31mDisconnected.\x1b[0m\r\n");
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 15000);
        reconnectAttemptsRef.current += 1;
        termRef.current?.write(
          `\x1b[33mReconnecting in ${Math.round(delay / 1000)}s...\x1b[0m\r\n`,
        );
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        termRef.current?.write(
          "\x1b[31mMax reconnect attempts reached. Refresh to try again.\x1b[0m\r\n",
        );
      }
    };

    ws.onerror = () => {
      termRef.current?.write("\r\n\x1b[31mWebSocket error.\x1b[0m\r\n");
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: "#0d1117", foreground: "#e6edf3", cursor: "#58a6ff",
        cursorAccent: "#0d1117", black: "#484f58", red: "#ff7b72",
        green: "#3fb950", yellow: "#d29922", blue: "#58a6ff",
        magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
        brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364",
        brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd", brightWhite: "#f0f6fc", selectionBackground: "#264f78",
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
    term.write("\x1b[90mConnecting to terminal server...\x1b[0m\r\n");
    connect();

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "input", data }));
    });
    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const ro = new ResizeObserver(() => fitAddon.fit());
    if (terminalRef.current) ro.observe(terminalRef.current);
    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      term.dispose();
    };
  }, [connect]);

  /* re-fit terminal when chat panel opens/closes */
  useEffect(() => {
    setTimeout(() => fitAddonRef.current?.fit(), 300);
  }, [chatOpen]);

  /* scroll chat to bottom */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── Send chat message ────────────────────────────────────────── */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");

    const userMsg: ChatMessage = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);

    // placeholder bot message
    const botIdx = (prev: ChatMessage[]) => prev.length;
    setMessages((prev) => [...prev, { role: "bot", text: "", html: "" }]);

    let full = "";
    let currentSessionId = sessionId;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: currentSessionId }),
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
            currentSessionId = ev["session_id"] as string;
            setSessionId(currentSessionId);
          } else if (ev["type"] === "text") {
            full += ev["text"] as string;
            const html = md(full);
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "bot", text: full, html };
              return next;
            });
          } else if (ev["type"] === "error") {
            const html = `<span style="color:#ff7b72">⚠️ ${ev["message"] as string}</span>`;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "bot", text: "", html };
              return next;
            });
          }
        }
      }

      if (!full) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "bot", text: "(no response)", html: "(no response)" };
          return next;
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "bot",
          text: "",
          html: `<span style="color:#ff7b72">⚠️ ${msg}</span>`,
        };
        return next;
      });
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, busy, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0d1117",
      display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ height: 36, background: "#161b22",
        borderBottom: "1px solid #30363d", display: "flex",
        alignItems: "center", padding: "0 16px", gap: 8,
        flexShrink: 0, userSelect: "none", justifyContent: "space-between" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, marginRight: 4 }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
            ))}
          </div>
          <span style={{ color: "#8b949e", fontSize: 13,
            fontFamily: '"Cascadia Code","Fira Code",Menlo,monospace' }}>
            bash
          </span>
        </div>

        {/* Chatbot toggle button */}
        <button
          data-testid="button-chatbot-toggle"
          onClick={() => setChatOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: chatOpen ? "#58a6ff" : "rgba(88,166,255,.12)",
            color: chatOpen ? "#0d1117" : "#58a6ff",
            border: "1px solid " + (chatOpen ? "#58a6ff" : "rgba(88,166,255,.35)"),
            borderRadius: 6, padding: "3px 10px", fontSize: 12,
            fontWeight: 600, cursor: "pointer", transition: "all .15s",
            letterSpacing: ".01em",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Chatbot
        </button>
      </div>

      {/* ── Body: terminal + optional chat panel ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Terminal */}
        <div
          ref={terminalRef}
          data-testid="terminal-container"
          style={{ flex: 1, padding: 8, overflow: "hidden", minWidth: 0 }}
        />

        {/* Chat panel */}
        {chatOpen && (
          <div style={{
            width: 360, flexShrink: 0, background: "#0d1117",
            borderLeft: "1px solid #30363d", display: "flex",
            flexDirection: "column", overflow: "hidden",
          }}>

            {/* Panel header */}
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #30363d",
              display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <div style={{ width: 24, height: 24, background: "#58a6ff",
                borderRadius: 6, display: "grid", placeItems: "center",
                fontSize: 13, color: "#0d1117", fontWeight: 700 }}>✦</div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>
                OpenCode Chat
              </span>
              {sessionId && (
                <span style={{ fontSize: 10, color: "#8b949e", marginLeft: "auto",
                  background: "rgba(255,255,255,.05)", padding: "2px 6px", borderRadius: 10 }}>
                  sesión activa
                </span>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 0",
              display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.length === 0 && (
                <div style={{ margin: "auto", textAlign: "center", color: "#8b949e" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✦</div>
                  <div style={{ fontSize: 12 }}>Haz una pregunta</div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 7, flexDirection: m.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                    background: m.role === "user" ? "#1f3a5f" : "#1c2128",
                    color: m.role === "user" ? "#58a6ff" : "#8b949e",
                    border: m.role === "bot" ? "1px solid #30363d" : "none",
                  }}>
                    {m.role === "user" ? "U" : "✦"}
                  </div>
                  <div style={{
                    maxWidth: "82%", padding: "8px 11px", borderRadius: 10, lineHeight: 1.55,
                    fontSize: 13, wordBreak: "break-word",
                    background: m.role === "user" ? "#1f3a5f" : "#161b22",
                    border: m.role === "bot" ? "1px solid #30363d" : "none",
                    borderBottomRightRadius: m.role === "user" ? 3 : 10,
                    borderBottomLeftRadius:  m.role === "bot"  ? 3 : 10,
                    color: "#e6edf3",
                  }}>
                    {m.role === "user" ? (
                      <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                    ) : m.html ? (
                      <span dangerouslySetInnerHTML={{ __html: m.html }} />
                    ) : (
                      /* typing indicator */
                      <span style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
                        {[0, 0.2, 0.4].map((d, j) => (
                          <span key={j} style={{
                            width: 6, height: 6, background: "#8b949e", borderRadius: "50%",
                            display: "inline-block",
                            animation: "blink 1.2s infinite",
                            animationDelay: `${d}s`,
                          }} />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input row */}
            <div style={{ padding: "10px 12px 12px", borderTop: "1px solid #30363d",
              display: "flex", gap: 7, flexShrink: 0 }}>
              <textarea
                ref={inputRef}
                data-testid="input-chat"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "38px";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un mensaje…"
                rows={1}
                disabled={busy}
                style={{
                  flex: 1, background: "#21262d", border: "1px solid #30363d",
                  borderRadius: 8, color: "#e6edf3", fontSize: 13, padding: "8px 11px",
                  resize: "none", height: 38, maxHeight: 120, fontFamily: "inherit",
                  lineHeight: 1.5, outline: "none", overflow: "auto",
                  transition: "border-color .2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#58a6ff")}
                onBlur={(e)  => (e.target.style.borderColor = "#30363d")}
              />
              <button
                data-testid="button-chat-send"
                onClick={() => void sendMessage()}
                disabled={busy || !input.trim()}
                style={{
                  background: "#238636", color: "#fff", border: "none",
                  borderRadius: 8, width: 38, height: 38, cursor: "pointer",
                  display: "grid", placeItems: "center", flexShrink: 0,
                  transition: "background .15s", opacity: busy || !input.trim() ? 0.4 : 1,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* keyframe for typing dots */}
      <style>{`@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>
    </div>
  );
}
