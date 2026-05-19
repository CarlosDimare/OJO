import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const WS_URL = (() => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
})();

const MONO = '"Cascadia Code","Fira Code",Menlo,Consolas,monospace';

/* ── Escape HTML special chars ─────────────────────────────────── */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Inline markdown (runs on already-escaped text EXCEPT for protected HTML) */
function inlineEscaped(t: string): string {
  // links: [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" target="_blank" rel="noopener" class="md-a">$1</a>`);
  // bold+italic ***
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  // bold **
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic *
  t = t.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  // italic _
  t = t.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  // inline code `
  t = t.replace(/`([^`\n]+)`/g, `<code class="md-ic">$1</code>`);
  return t;
}

/* ── Table parser ──────────────────────────────────────────────── */
function parseTableRow(row: string): string[] {
  return row.split("|").map((c) => c.trim()).filter((_, i, a) => !(i === 0 && a[0] === "") && !(i === a.length - 1 && a[a.length - 1] === ""));
}

function renderTable(lines: string[]): string {
  const headers = parseTableRow(lines[0]);
  const rows = lines.slice(2).map(parseTableRow);
  const ths = headers.map((h) => `<th class="md-th">${inlineEscaped(esc(h))}</th>`).join("");
  const trs = rows.map((r) =>
    `<tr>${r.map((c) => `<td class="md-td">${inlineEscaped(esc(c))}</td>`).join("")}</tr>`
  ).join("");
  return `<table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ── Block markdown parser ─────────────────────────────────────── */
function md(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      out.push(`<pre class="md-pre"><code class="md-code">${esc(codeLines.join("\n"))}</code></pre>`);
      i++;
      continue;
    }

    // ── Table (line with | and next line is separator ---|--)
    if (line.includes("|") && i + 1 < lines.length && /^[\s|:\-]+$/.test(lines[i + 1])) {
      const tableLines = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(renderTable(tableLines));
      continue;
    }

    // ── Heading
    const hm = line.match(/^(#{1,3}) (.+)$/);
    if (hm) {
      const lvl = hm[1].length;
      out.push(`<p class="md-h${lvl}">${inlineEscaped(esc(hm[2]))}</p>`);
      i++;
      continue;
    }

    // ── HR
    if (/^---+$/.test(line.trim())) {
      out.push(`<hr class="md-hr">`);
      i++;
      continue;
    }

    // ── Blockquote
    if (line.startsWith("> ")) {
      out.push(`<blockquote class="md-bq">${inlineEscaped(esc(line.slice(2)))}</blockquote>`);
      i++;
      continue;
    }

    // ── Unordered list
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(`<li class="md-li">${inlineEscaped(esc(lines[i].replace(/^[-*] /, "")))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join("")}</ul>`);
      continue;
    }

    // ── Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li class="md-li">${inlineEscaped(esc(lines[i].replace(/^\d+\. /, "")))}</li>`);
        i++;
      }
      out.push(`<ol class="md-ol">${items.join("")}</ol>`);
      continue;
    }

    // ── <small> citation lines (model emits these as bare text)
    //    Handles: <small>[text](url)</small>  or  <small>text</small>
    if (/^<small>/.test(line.trim())) {
      // Collect consecutive citation lines
      const citeItems: string[] = [];
      while (i < lines.length && /^<small>/.test(lines[i].trim())) {
        const raw2 = lines[i].trim();
        // <small>[text](url)</small>
        const linkMatch = raw2.match(/^<small>\[([^\]]+)\]\(([^)]+)\)<\/small>$/);
        if (linkMatch) {
          citeItems.push(`<a href="${linkMatch[2]}" target="_blank" rel="noopener" class="md-cite">${esc(linkMatch[1])}</a>`);
        } else {
          // <small>plain text</small>
          const textMatch = raw2.match(/^<small>(.*?)<\/small>$/s);
          const inner = textMatch ? textMatch[1] : raw2;
          citeItems.push(`<span class="md-cite-text">${esc(inner)}</span>`);
        }
        i++;
      }
      out.push(`<div class="md-cites">${citeItems.join(" · ")}</div>`);
      continue;
    }

    // ── Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph: collect until a block boundary
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !/^#{1,3} /.test(lines[i]) &&
      !/^[-*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !lines[i].startsWith("> ") &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^<small>/.test(lines[i].trim()) &&
      !(lines[i].includes("|") && i + 1 < lines.length && /^[\s|:\-]+$/.test(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const html = paraLines.map((l) => inlineEscaped(esc(l))).join("<br>");
      out.push(`<p class="md-p">${html}</p>`);
    }
  }

  return out.join("");
}

/* ── Clock hook ─────────────────────────────────────────────────── */
function useClock(): string {
  const [time, setTime] = useState(() =>
    new Date().toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    })
  );
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

interface ChatMessage { role: "user" | "bot"; text: string; html?: string; }
type View = "terminal" | "chat";

/* ── CSS injected once ──────────────────────────────────────────── */
const STYLES = `
  @keyframes pulse { 0%,100%{opacity:.2} 50%{opacity:1} }
  *::-webkit-scrollbar { width: 4px; }
  *::-webkit-scrollbar-track { background: #0a0a0a; }
  *::-webkit-scrollbar-thumb { background: #cc0000; }
  textarea::placeholder { color: #333; }

  /* ── Markdown ── */
  .md-p   { margin: 0 0 .65em; line-height: 1.8; }
  .md-p:last-child { margin-bottom: 0; }
  .md-h1  { font-size: 1.1em; font-weight: 700; color: #fff; margin: .9em 0 .4em; text-transform: uppercase; letter-spacing: .04em; }
  .md-h2  { font-size: 1.02em; font-weight: 700; color: #eee; margin: .75em 0 .35em; }
  .md-h3  { font-size: .96em; font-weight: 700; color: #ddd; margin: .6em 0 .3em; }
  .md-ul, .md-ol { margin: .3em 0 .65em 1.5em; padding: 0; }
  .md-li  { margin-bottom: .3em; line-height: 1.75; }
  .md-pre { background: #0a0a0a; border-left: 3px solid #cc0000; padding: 11px 14px; margin: .6em 0; overflow-x: auto; }
  .md-code{ display: block; color: #e8e8e8; font-size: 12.5px; line-height: 1.6; white-space: pre; }
  .md-ic  { background: #1c1c1c; border: 1px solid #2a2a2a; padding: 1px 5px; font-size: 12px; color: #e0e0e0; }
  .md-a   { color: #4a9eff; text-decoration: underline; text-underline-offset: 2px; }
  .md-a:hover { color: #79baff; }
  .md-bq  { border-left: 3px solid #cc0000; margin: .45em 0; padding: .25em 0 .25em .8em; color: #999; font-style: italic; }
  .md-hr  { border: none; border-top: 1px solid #222; margin: .75em 0; }
  .md-table { border-collapse: collapse; width: 100%; margin: .6em 0; font-size: 13px; }
  .md-th  { background: #cc0000; color: #fff; font-weight: 700; padding: 6px 10px; text-align: left; border: 1px solid #222; }
  .md-td  { padding: 5px 10px; border: 1px solid #1e1e1e; color: #d0d0d0; }
  .md-table tr:nth-child(even) td { background: #111; }
  .md-cites { margin-top: .5em; padding-top: .4em; border-top: 1px solid #1e1e1e; display: flex; flex-wrap: wrap; gap: .3em .6em; }
  .md-cite  { color: #666; font-size: .76em; text-decoration: underline; text-underline-offset: 2px; }
  .md-cite:hover { color: #999; }
  .md-cite-text { color: #555; font-size: .76em; }
  strong { color: #fff; font-weight: 700; }
  em     { color: #bbb; }
`;

/* ══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [view, setView]       = useState<View>("terminal");
  const clock                 = useClock();

  /* terminal */
  const terminalRef          = useRef<HTMLDivElement>(null);
  const termRef              = useRef<Terminal | null>(null);
  const fitAddonRef          = useRef<FitAddon | null>(null);
  const wsRef                = useRef<WebSocket | null>(null);
  const reconnTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnAttempts       = useRef(0);

  /* chat */
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState("");
  const [busy, setBusy]           = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const msgsEndRef               = useRef<HTMLDivElement>(null);
  const inputRef                 = useRef<HTMLTextAreaElement>(null);

  /* ── Terminal setup ─────────────────────────────────────────────── */
  const connect = useCallback(() => {
    if (!termRef.current) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      reconnAttempts.current = 0;
      termRef.current?.write("\r\n\x1b[32mConnected.\x1b[0m\r\n");
      fitAddonRef.current?.fit();
      const { cols, rows } = termRef.current!;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data as string);
        if (m.type === "output") termRef.current?.write(m.data as string);
        else if (m.type === "exit") termRef.current?.write(`\r\n\x1b[33mExited (${m.exitCode}).\x1b[0m\r\n`);
      } catch {}
    };
    ws.onclose = () => {
      termRef.current?.write("\r\n\x1b[31mDisconnected.\x1b[0m\r\n");
      if (reconnAttempts.current < 10) {
        const d = Math.min(1000 * 2 ** reconnAttempts.current, 15000);
        reconnAttempts.current++;
        termRef.current?.write(`\x1b[33mReconnecting in ${Math.round(d / 1000)}s…\x1b[0m\r\n`);
        reconnTimerRef.current = setTimeout(connect, d);
      }
    };
    ws.onerror = () => termRef.current?.write("\r\n\x1b[31mWS error.\x1b[0m\r\n");
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    const term = new Terminal({
      cursorBlink: true, fontFamily: MONO, fontSize: 14, lineHeight: 1.25,
      theme: {
        background: "#0a0a0a", foreground: "#e8e8e8", cursor: "#cc0000",
        cursorAccent: "#0a0a0a", black: "#1a1a1a", red: "#cc0000", green: "#5a9a3a",
        yellow: "#c8a030", blue: "#4a7ab0", magenta: "#9a4a8a", cyan: "#3a8a9a",
        white: "#c8c8c8", brightBlack: "#444", brightRed: "#e83030", brightGreen: "#70ba50",
        brightYellow: "#e0c050", brightBlue: "#5a90c8", brightMagenta: "#ba5aba",
        brightCyan: "#50aaba", brightWhite: "#f0f0f0", selectionBackground: "#cc000040",
      },
      allowProposedApi: true, scrollback: 10000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current); fit.fit();
    termRef.current = term; fitAddonRef.current = fit;
    term.write("\x1b[90mConnecting…\x1b[0m\r\n");
    connect();
    term.onData((d) => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "input", data: d })); });
    term.onResize(({ cols, rows }) => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "resize", cols, rows })); });
    const ro = new ResizeObserver(() => fit.fit());
    if (terminalRef.current) ro.observe(terminalRef.current);
    window.addEventListener("resize", () => fit.fit());
    return () => { ro.disconnect(); if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current); wsRef.current?.close(); term.dispose(); };
  }, [connect]);

  useEffect(() => { setTimeout(() => fitAddonRef.current?.fit(), 50); }, [view]);
  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  /* ── Send chat ──────────────────────────────────────────────────── */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true); setInput("");
    setMessages((p) => [...p, { role: "user", text }, { role: "bot", text: "", html: "" }]);
    let full = ""; let cur = sessionId;
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: cur }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop()!;
        for (const ln of lines) {
          if (!ln.startsWith("data: ")) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(ln.slice(6)) as Record<string, unknown>; } catch { continue; }
          if (ev["type"] === "session") { cur = ev["session_id"] as string; setSessionId(cur); }
          else if (ev["type"] === "text") {
            full += ev["text"] as string;
            setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: full, html: md(full) }; return n; });
          } else if (ev["type"] === "error") {
            setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "", html: `<span style="color:#e83030">⚠ ${esc(ev["message"] as string)}</span>` }; return n; });
          }
        }
      }
      if (!full) setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "—", html: "—" }; return n; });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "", html: `<span style="color:#e83030">⚠ ${esc(msg)}</span>` }; return n; });
    } finally { setBusy(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [input, busy, sessionId]);

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0a0a0a",
      display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: MONO }}>

      {/* ════ NAV BAR ════ */}
      <nav style={{ flexShrink: 0, background: "#0a0a0a", borderBottom: "3px solid #cc0000",
        display: "flex", alignItems: "stretch", height: 48 }}>

        {/* Red stripe + star */}
        <div style={{ width: 6, background: "#cc0000", flexShrink: 0 }} />
        <div style={{ paddingLeft: 14, paddingRight: 18, display: "flex",
          alignItems: "center", borderRight: "2px solid #1a1a1a" }}>
          <div style={{ width: 20, height: 20, background: "#cc0000",
            display: "grid", placeItems: "center", transform: "rotate(45deg)", flexShrink: 0 }}>
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 900,
              transform: "rotate(-45deg)", display: "block" }}>✦</span>
          </div>
        </div>

        {/* Tab buttons */}
        {(["terminal", "chat"] as const).map((v) => {
          const active = view === v;
          const label  = v === "terminal" ? "▸ TERMINAL" : "◈ CHATBOT";
          return (
            <button key={v} data-testid={`button-nav-${v}`} onClick={() => setView(v)}
              style={{
                background: active ? "#cc0000" : "transparent",
                color: active ? "#fff" : "#555",
                border: "none", cursor: "pointer", padding: "0 24px", fontSize: 11,
                fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase",
                borderRight: "2px solid #1a1a1a", fontFamily: MONO,
                position: "relative", transition: "all .15s",
              }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#cc0000"; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#555"; }}
            >
              {label}
              {active && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "#fff" }} />}
            </button>
          );
        })}

        {/* Clock */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingRight: 16 }}>
          <span style={{ color: "#cc0000", fontSize: 11, fontWeight: 700,
            letterSpacing: ".06em", fontFamily: MONO }}>
            {clock}
          </span>
        </div>
      </nav>

      {/* ════ TERMINAL ════ */}
      <div style={{ flex: view === "terminal" ? 1 : 0,
        display: view === "terminal" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a",
          padding: "5px 14px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {["#cc0000", "#c8a030", "#5a9a3a"].map((c) => (
            <div key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />
          ))}
          <span style={{ color: "#333", fontSize: 11, fontWeight: 700,
            letterSpacing: ".1em", textTransform: "uppercase", fontFamily: MONO }}>
            bash — ~/workspace
          </span>
        </div>
        <div ref={terminalRef} data-testid="terminal-container"
          style={{ flex: 1, padding: "6px 4px", overflow: "hidden" }} />
      </div>

      {/* ════ CHAT ════ */}
      <div style={{ flex: view === "chat" ? 1 : 0,
        display: view === "chat" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

        <div style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a",
          padding: "5px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, background: "#cc0000", flexShrink: 0 }} />
          <span style={{ color: "#333", fontSize: 11, fontWeight: 700,
            letterSpacing: ".12em", textTransform: "uppercase", fontFamily: MONO }}>
            opencode — periodismo de datos
          </span>
          {sessionId && (
            <span style={{ marginLeft: "auto", color: "#333", fontSize: 10,
              fontWeight: 700, letterSpacing: ".08em", fontFamily: MONO }}>
              [sesión activa]
            </span>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 0 8px",
          display: "flex", flexDirection: "column" }}>
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center" }}>
              <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 14px" }}>
                <div style={{ position: "absolute", inset: 0, border: "3px solid #cc0000" }} />
                <div style={{ position: "absolute", top: 7, left: 7, right: 7, bottom: 7,
                  background: "#cc0000", display: "grid", placeItems: "center" }}>
                  <span style={{ color: "#fff", fontSize: 22, fontWeight: 900 }}>✦</span>
                </div>
              </div>
              <p style={{ color: "#2a2a2a", fontSize: 10, fontWeight: 700,
                letterSpacing: ".18em", textTransform: "uppercase", fontFamily: MONO }}>
                LISTO PARA ANALIZAR
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{
              display: "flex",
              flexDirection: m.role === "user" ? "row-reverse" : "row",
              alignItems: "flex-start", gap: 10, marginBottom: 16,
              padding: "0 16px",
              maxWidth: 900, width: "100%", boxSizing: "border-box",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            }}>
              {/* Avatar */}
              <div style={{
                width: 26, height: 26, flexShrink: 0,
                background: m.role === "user" ? "#cc0000" : "#111",
                border: m.role === "bot" ? "2px solid #cc0000" : "none",
                display: "grid", placeItems: "center",
                color: m.role === "user" ? "#fff" : "#cc0000",
                fontWeight: 700, fontSize: 10, letterSpacing: ".05em", fontFamily: MONO,
              }}>
                {m.role === "user" ? "U" : "A"}
              </div>

              {/* Bubble */}
              <div style={{
                background: m.role === "user" ? "#cc0000" : "#111",
                borderLeft: m.role === "bot" ? "3px solid #cc0000" : undefined,
                border: m.role === "bot" ? "1px solid #1a1a1a" : "none",
                padding: "10px 14px",
                maxWidth: "calc(100% - 48px)",
                color: m.role === "user" ? "#fff" : "#d0d0d0",
                fontSize: 13.5, lineHeight: 1.75,
                wordBreak: "break-word", fontFamily: MONO,
              }}>
                {m.role === "user" ? (
                  <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                ) : m.html ? (
                  <span dangerouslySetInnerHTML={{ __html: m.html }} />
                ) : (
                  <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                    {[0, .25, .5].map((d, j) => (
                      <span key={j} style={{ width: 5, height: 5, background: "#cc0000",
                        display: "inline-block", animation: `pulse 1.2s ${d}s infinite` }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={msgsEndRef} />
        </div>

        {/* Input */}
        <div style={{ borderTop: "2px solid #cc0000", padding: "10px 16px 14px",
          background: "#0a0a0a", display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef} data-testid="input-chat"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "40px";
              e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
            placeholder="escribe un mensaje... (enter para enviar)"
            rows={1} disabled={busy}
            style={{
              flex: 1, background: "#0d0d0d", border: "1px solid #1e1e1e",
              color: "#e8e8e8", fontSize: 13, padding: "9px 12px",
              resize: "none", height: 40, maxHeight: 140, fontFamily: MONO,
              lineHeight: 1.5, outline: "none", overflow: "auto",
              transition: "border-color .15s",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#cc0000")}
            onBlur={(e)  => (e.target.style.borderColor = "#1e1e1e")}
          />
          <button data-testid="button-chat-send" onClick={() => void sendMessage()}
            disabled={busy || !input.trim()}
            style={{
              background: busy || !input.trim() ? "#111" : "#cc0000",
              color: busy || !input.trim() ? "#333" : "#fff",
              border: "none", cursor: busy || !input.trim() ? "not-allowed" : "pointer",
              width: 40, height: 40, display: "grid", placeItems: "center",
              flexShrink: 0, transition: "background .15s",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      <style>{STYLES}</style>
    </div>
  );
}
