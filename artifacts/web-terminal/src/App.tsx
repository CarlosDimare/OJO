import { useEffect, useRef, useCallback, useState } from "react";

const MONO = '"Cascadia Code","Fira Code",Menlo,Consolas,monospace';
const SANS = '-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif';
const SERIF = 'Georgia,"Times New Roman",serif';
const ACCENT = "#ce2b37";
const ACCENT_BLUE = "#0a5278";
const BG = "#fff";
const BG_CARD = "#f6f6f6";
const TEXT = "#1a1a1a";
const TEXT_MUTED = "#888";
const BORDER = "#e0e0e0";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineEscaped(t: string): string {
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, url) => `<span class="md-img-wrap"><img src="${url}" alt="${alt}" class="md-thumb" loading="lazy" onerror="this.style.display='none'" /></span>`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="#!" class="md-a md-link-modal" data-url="${'$2'}">${'$1'}</a>`);
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  t = t.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  t = t.replace(/`([^`\n]+)`/g, `<code class="md-ic">$1</code>`);
  t = t.replace(/(\d+(?:[.,]\d+)?\s*%)/g, '<span class="md-num">$1</span>');
  t = t.replace(/([$]\d+(?:[.,]\d+)?(?:\s*(?:millones|billones|mil|M|B))?)/g, '<span class="md-num">$1</span>');
  return t;
}

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

function md(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

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

    const hm = line.match(/^(#{1,3}) (.+)$/);
    if (hm) {
      const lvl = hm[1].length;
      out.push(`<p class="md-h${lvl}">${inlineEscaped(esc(hm[2]))}</p>`);
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      out.push(`<hr class="md-hr">`);
      i++;
      continue;
    }

    if (/^:::\s*cifra/i.test(line.trim())) {
      const boxLines: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) {
        boxLines.push(lines[i]);
        i++;
      }
      i++;
      const inner = boxLines.map((l) => inlineEscaped(esc(l))).join("<br>");
      out.push(`<div class="md-data-box">${inner}</div>`);
      continue;
    }

    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      out.push(`<span class="md-img-wrap"><img src="${esc(imgMatch[2])}" alt="${esc(imgMatch[1])}" class="md-thumb" loading="lazy" onerror="this.style.display='none'" /></span>`);
      i++;
      continue;
    }

    const vidMatch = line.match(/^@\[(YouTube|Vimeo)\]\(([^)]+)\)$/);
    if (vidMatch) {
      let url = vidMatch[2];
      if (vidMatch[1] === "YouTube") {
        url = url.replace(/watch\?v=/, "embed/").replace(/youtu\.be\//, "youtube.com/embed/");
      }
      if (/^https:\/\//.test(url)) {
        out.push(`<div class="md-media md-video"><iframe src="${esc(url)}" frameborder="0" allowfullscreen loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe></div>`);
      }
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      out.push(`<blockquote class="md-bq">${inlineEscaped(esc(line.slice(2)))}</blockquote>`);
      i++;
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(`<li class="md-li">${inlineEscaped(esc(lines[i].replace(/^[-*] /, "")))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li class="md-li">${inlineEscaped(esc(lines[i].replace(/^\d+\. /, "")))}</li>`);
        i++;
      }
      out.push(`<ol class="md-ol">${items.join("")}</ol>`);
      continue;
    }

    if (/^<small>/.test(line.trim())) {
      const citeItems: string[] = [];
      while (i < lines.length && /^<small>/.test(lines[i].trim())) {
        const raw2 = lines[i].trim();
        const linkMatch = raw2.match(/^<small>\[([^\]]+)\]\(([^)]+)\)<\/small>$/);
        if (linkMatch) {
          citeItems.push(`<a href="#!" class="md-cite md-link-modal" data-url="${esc(linkMatch[2])}">${esc(linkMatch[1])}</a>`);
        } else {
          const textMatch = raw2.match(/^<small>(.*?)<\/small>$/s);
          const inner = textMatch ? textMatch[1] : raw2;
          citeItems.push(`<span class="md-cite-text">${esc(inner)}</span>`);
        }
        i++;
      }
      out.push(`<div class="md-cites">${citeItems.join(" · ")}</div>`);
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

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
      !/^:::\s*cifra/i.test(lines[i].trim()) &&
      !/^:::\s*$/.test(lines[i].trim()) &&
      !/^!\[/.test(lines[i]) &&
      !/^@\[/.test(lines[i]) &&
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

const STYLES = `
  @keyframes pulse { 0%,100%{opacity:.2} 50%{opacity:1} }
  *::-webkit-scrollbar { width: 6px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
  *::-webkit-scrollbar-thumb:hover { background: #aaa; }
  textarea::placeholder { color: #bbb; font-family: ${SERIF}; font-style: italic; }

  .md-p   { margin: 0 0 .7em; line-height: 1.8; color: #333; font-family: ${SERIF}; font-size: 14px; }
  .md-p:last-child { margin-bottom: 0; }
  .md-h1, .md-h2, .md-h3 { font-family: ${SERIF}; color: ${ACCENT}; font-weight: 700; margin: 1em 0 .4em; line-height: 1.3; }
  .md-h1 { font-size: 1.4em; border-bottom: 2px solid ${ACCENT}; padding-bottom: 4px; }
  .md-h2 { font-size: 1.2em; }
  .md-h3 { font-size: 1.05em; }
  .md-ul, .md-ol { margin: .3em 0 .65em 1.5em; padding: 0; }
  .md-li  { margin-bottom: .3em; line-height: 1.75; color: #444; font-family: ${SERIF}; }
  .md-pre { background: #fafafa; border: 1px solid ${BORDER}; border-left: 3px solid ${ACCENT}; padding: 12px 16px; margin: .6em 0; overflow-x: auto; }
  .md-code{ display: block; color: #333; font-size: 13px; line-height: 1.5; white-space: pre; font-family: ${MONO}; }
  .md-ic  { background: #f0f0f0; border: 1px solid ${BORDER}; padding: 1px 5px; font-size: 12.5px; color: #333; font-family: ${MONO}; }
  .md-a   { color: ${ACCENT_BLUE}; text-decoration: underline; text-underline-offset: 2px; }
  .md-a:hover { color: #083d5e; }
  .md-bq  { border-left: 3px solid ${ACCENT}; margin: .45em 0; padding: .25em 0 .25em 1em; color: #666; font-style: italic; font-family: ${SERIF}; }
  .md-hr  { border: none; border-top: 1px solid ${BORDER}; margin: .75em 0; }
  .md-table { border-collapse: collapse; width: 100%; margin: .6em 0; font-size: 13px; }
  .md-th  { background: ${ACCENT}; color: #fff; font-weight: 700; padding: 6px 10px; text-align: left; border: 1px solid ${ACCENT}; }
  .md-td  { padding: 5px 10px; border: 1px solid ${BORDER}; color: #444; }
  .md-table tr:nth-child(even) td { background: ${BG_CARD}; }
  .md-cites { margin-top: .5em; padding-top: .4em; border-top: 1px solid ${BORDER}; display: flex; flex-wrap: wrap; gap: .3em .6em; }
  .md-cite  { color: ${TEXT_MUTED}; font-size: .76em; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .md-cite:hover { color: #555; }
  .md-cite-text { color: #aaa; font-size: .76em; }
  .md-data-box { background: ${BG_CARD}; border-left: 4px solid ${ACCENT}; padding: 14px 16px; margin: .6em 0; font-family: ${SERIF}; }
  .md-data-box strong { color: ${ACCENT}; }
  .md-data-box br + strong { display: inline-block; margin-top: .3em; }
  .md-num { color: ${ACCENT}; font-weight: 700; font-family: ${SERIF}; }
  .md-media { margin: .6em 0; }
  .md-thumb { max-width: 280px; max-height: 180px; height: auto; border: 1px solid ${BORDER}; display: block; margin: .4em 0; }
  .md-img-wrap { display: block; margin: .4em 0; }
  .md-video { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; }
  .md-video iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
  .md-link-modal { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .md-link-modal:hover { opacity: .8; }
  strong { color: ${ACCENT}; font-weight: 700; }
  em     { color: #555; font-style: italic; }
`;

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const clock = useClock();

  /* chat */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [charlaMode, setCharlaMode] = useState(true);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatMsgsRef = useRef<HTMLDivElement>(null);

  /* history */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true); setInput(""); setThinkingStatus("...");
    setMessages((p) => [...p, { role: "user", text }, { role: "bot", text: "", html: "" }]);
    let full = ""; let cur = sessionId; let cid = conversationId;
    const ac = new AbortController();
    const overallTimer = setTimeout(() => ac.abort(), 180_000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: cur, conversation_id: cid, charla_mode: charlaMode }),
        signal: ac.signal,
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
          else if (ev["type"] === "conversation") { cid = ev["conversation_id"] as number; setConversationId(cid); }
          else if (ev["type"] === "status") { setThinkingStatus(ev["status"] as string); }
          else if (ev["type"] === "text") {
            setThinkingStatus(null);
            full += ev["text"] as string;
            setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: full, html: md(full) }; return n; });
          } else if (ev["type"] === "error") {
            setThinkingStatus(null);
            setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "", html: `<span style="color:#ff4400">⚠ ${esc(ev["message"] as string)}</span>` }; return n; });
          }
        }
      }
      if (!full) setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "—", html: "—" }; return n; });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setThinkingStatus(null);
      setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "", html: `<span style="color:#e83030">⚠ ${esc(msg)}</span>` }; return n; });
    } finally { clearTimeout(overallTimer); setBusy(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [input, busy, sessionId, conversationId, charlaMode]);

  const fetchConversations = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/conversations");
      if (r.ok) setConversations(await r.json());
    } catch {} finally { setHistoryLoading(false); }
  }, []);

  const loadConversation = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/conversations/${id}`);
      if (!r.ok) return;
      const data = await r.json();
      setMessages(data.messages.map((m: any) => ({
        role: m.role as "user" | "bot",
        text: m.content,
        html: m.role === "bot" ? md(m.content) : undefined,
      })));
      setConversationId(id);
      setSessionId(data.sessionId);
      setHistoryOpen(false);
    } catch {}
  }, []);

  const deleteConversation = useCallback(async (id: number) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((p) => p.filter((c: any) => c.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
        setSessionId(null);
      }
    } catch {}
  }, [conversationId]);

  const newConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setSessionId(null);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100dvh", background: BG,
      display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Header ── */}
      <nav style={{
        flexShrink: 0, background: BG,
        borderBottom: "1px solid " + BORDER,
        display: "flex", alignItems: "center", height: 52, padding: "0 16px",
        gap: 12,
      }}>
        {/* Brand */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: ACCENT,
          letterSpacing: "-.02em", userSelect: "none",
        }}
          onClick={() => setMenuOpen((p) => !p)}
          onMouseLeave={() => setMenuOpen(false)}>
          <span style={{
            background: ACCENT, color: "#fff", padding: "2px 6px",
            fontSize: 14, letterSpacing: ".05em",
          }}>CD</span>

          {menuOpen && (
            <div style={{
              position: "absolute", top: 48, left: 16, zIndex: 999,
              background: BG, border: "1px solid " + BORDER,
              boxShadow: "0 4px 12px rgba(0,0,0,.08)",
              minWidth: 180, fontFamily: SERIF,
            }}>
              {[
                { id: "new" as any, label: "Nuova conversazione" },
                { id: null, label: "─" },
                { id: "history" as any, label: "☰ Cronologia" },
              ].map((item: any, idx) => {
                if (item.label === "─") {
                  return <div key={idx} style={{ height: 1, background: BORDER, margin: "4px 0" }} />;
                }
                return (
                  <button key={item.id} onClick={() => {
                    setMenuOpen(false);
                    if (item.id === "new") { newConversation(); }
                    else if (item.id === "history") { setHistoryOpen(true); fetchConversations(); }
                  }}
                    style={{
                      display: "block", width: "100%", border: "none",
                      background: "transparent", color: TEXT,
                      cursor: "pointer", padding: "10px 18px", fontSize: 13,
                      textAlign: "left", fontFamily: SERIF, transition: "all .1s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = BG_CARD; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 24, background: BORDER }} />

        {/* Mode label */}
        <span style={{
          color: TEXT_MUTED, fontSize: 12, fontFamily: SERIF, fontStyle: "italic",
        }}>
          {charlaMode ? "chat" : "inchiesta"}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {/* Charla button */}
          <button onClick={() => { if (!charlaMode) { setCharlaMode(true); setSessionId(null); setConversationId(null); } }}
            style={{
              padding: "5px 14px", fontSize: 11, fontWeight: 700,
              letterSpacing: ".06em", textTransform: "uppercase",
              fontFamily: SERIF, cursor: "pointer", whiteSpace: "nowrap",
              background: charlaMode ? ACCENT : "transparent",
              color: charlaMode ? "#fff" : TEXT_MUTED,
              border: "1px solid " + (charlaMode ? ACCENT : BORDER),
              transition: "all .15s",
            }}
            onMouseEnter={(e) => { if (!charlaMode) { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; } }}
            onMouseLeave={(e) => { if (!charlaMode) { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TEXT_MUTED; } }}>
            CHARLA
          </button>
          {/* Periodista button */}
          <button onClick={() => { if (charlaMode) { setCharlaMode(false); setSessionId(null); setConversationId(null); } }}
            style={{
              padding: "5px 14px", fontSize: 11, fontWeight: 700,
              letterSpacing: ".06em", textTransform: "uppercase",
              fontFamily: SERIF, cursor: "pointer", whiteSpace: "nowrap",
              background: charlaMode ? "transparent" : ACCENT,
              color: charlaMode ? TEXT_MUTED : "#fff",
              border: "1px solid " + (charlaMode ? BORDER : ACCENT),
              transition: "all .15s",
            }}
            onMouseEnter={(e) => { if (charlaMode) { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; } }}
            onMouseLeave={(e) => { if (charlaMode) { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TEXT_MUTED; } }}>
            PERIODISTA
          </button>
        </div>

        {/* Clock */}
        <span style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: MONO, marginLeft: 8 }}>
          {clock}
        </span>
      </nav>

      {/* ── Main content ── */}
      {charlaMode ? (
        /* ── CHARLA MODE: normal chat ── */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div ref={chatMsgsRef} style={{
            flex: 1, overflowY: "auto", padding: "20px 0 8px",
            display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            {messages.length === 0 && (
              <div style={{ margin: "auto", textAlign: "center", padding: "0 20px" }}>
                <p style={{ color: TEXT_MUTED, fontSize: 24, fontWeight: 400,
                  fontFamily: SERIF, margin: 0, lineHeight: 1.4 }}>
                  <span style={{ fontStyle: "italic" }}>¿De qué<br />hablamos?</span>
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{
                display: "flex",
                flexDirection: "column",
                gap: 4, marginBottom: 14,
                padding: "0 16px",
                maxWidth: 700, width: "100%", boxSizing: "border-box",
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: ".08em", color: TEXT_MUTED, fontFamily: SERIF,
                  textAlign: m.role === "user" ? "right" : "left",
                }}>
                  {m.role === "user" ? "Tu" : "CD"}
                </div>
                <div style={{
                  background: m.role === "user" ? BG_CARD : BG,
                  border: "1px solid " + BORDER,
                  borderLeft: m.role === "bot" ? "3px solid " + ACCENT : "none",
                  padding: "12px 16px",
                  fontSize: 14, lineHeight: 1.75,
                  color: TEXT,
                  fontFamily: SERIF,
                  wordBreak: "break-word",
                }}>
                  {m.role === "user" ? (
                    <span style={{ fontFamily: MONO, fontSize: 13, color: TEXT }}>{m.text}</span>
                  ) : m.html ? (
                    <span dangerouslySetInnerHTML={{ __html: m.html }} />
                  ) : thinkingStatus ? (
                    <span style={{ color: TEXT_MUTED, fontSize: 12, fontStyle: "italic", fontFamily: SERIF }}>
                      {thinkingStatus}
                    </span>
                  ) : (
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      {[0, .25, .5].map((d, j) => (
                        <span key={j} style={{ width: 4, height: 4, background: ACCENT, borderRadius: "50%",
                          display: "inline-block", animation: `pulse 1.2s ${d}s infinite` }} />
                      ))}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={msgsEndRef} />
          </div>

          <div style={{
            borderTop: "1px solid " + BORDER, padding: "12px 16px 16px",
            background: BG, display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "40px";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
              placeholder="Scrivi qualcosa… (Invio per inviare)"
              rows={1} disabled={busy}
              style={{
                flex: 1, background: BG_CARD, border: "1px solid " + BORDER,
                color: TEXT, fontSize: 14, padding: "10px 14px",
                resize: "none", height: 40, maxHeight: 120,
                fontFamily: SERIF, lineHeight: 1.5, outline: "none", overflow: "auto",
                transition: "border-color .15s",
              }}
              onFocus={(e) => (e.target.style.borderColor = ACCENT)}
              onBlur={(e) => (e.target.style.borderColor = BORDER)}
            />
            <button onClick={() => void sendMessage()}
              disabled={busy || !input.trim()}
              style={{
                background: busy || !input.trim() ? BG_CARD : ACCENT,
                color: busy || !input.trim() ? TEXT_MUTED : "#fff",
                border: "none", cursor: busy || !input.trim() ? "not-allowed" : "pointer",
                width: 40, height: 40, display: "grid", placeItems: "center",
                flexShrink: 0, transition: "background .15s", fontSize: 16,
              }}
            >
              ›
            </button>
          </div>
        </div>
      ) : (
        /* ── PERIODISTA MODE: centered input ── */
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
        }}>
          {messages.length === 0 ? (
            /* Centered prompt */
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: "0 20px",
            }}>
              <p style={{
                fontFamily: SERIF, fontSize: 28, color: TEXT,
                margin: "0 0 24px", textAlign: "center", lineHeight: 1.3, fontWeight: 400,
                letterSpacing: "-.01em",
              }}>
                <span style={{ fontStyle: "italic" }}>¿Qué tema<br />investigo?</span>
              </p>
              <div style={{
                display: "flex", gap: 8, width: "100%", maxWidth: 520,
              }}>
                <input
                  ref={inputRef as any}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void sendMessage(); } }}
                  placeholder="escribe el tema a investigar…"
                  disabled={busy}
                  style={{
                    flex: 1, background: BG_CARD, border: "1px solid " + BORDER,
                    color: TEXT, fontSize: 15, padding: "12px 16px",
                    outline: "none", fontFamily: SERIF,
                    transition: "border-color .15s",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = ACCENT)}
                  onBlur={(e) => (e.target.style.borderColor = BORDER)}
                />
                <button onClick={() => void sendMessage()}
                  disabled={busy || !input.trim()}
                  style={{
                    background: busy || !input.trim() ? BG_CARD : ACCENT,
                    color: busy || !input.trim() ? TEXT_MUTED : "#fff",
                    border: "none", cursor: busy || !input.trim() ? "not-allowed" : "pointer",
                    width: 46, height: 46, display: "grid", placeItems: "center",
                    flexShrink: 0, fontSize: 20, fontWeight: 700,
                    fontFamily: SERIF, transition: "background .15s",
                  }}
                >
                  →
                </button>
              </div>
            </div>
          ) : (
            /* Conversation view (same as charla) */
            <>
              <div ref={chatMsgsRef} style={{
                flex: 1, overflowY: "auto", padding: "20px 0 8px",
                display: "flex", flexDirection: "column", alignItems: "center",
              }}>
                {messages.map((m, i) => (
                  <div key={i} style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4, marginBottom: 14,
                    padding: "0 16px",
                    maxWidth: 700, width: "100%", boxSizing: "border-box",
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                      letterSpacing: ".08em", color: TEXT_MUTED, fontFamily: SERIF,
                      textAlign: m.role === "user" ? "right" : "left",
                    }}>
                      {m.role === "user" ? "Tu" : "CD"}
                    </div>
                    <div style={{
                      background: m.role === "user" ? BG_CARD : BG,
                      border: "1px solid " + BORDER,
                      borderLeft: m.role === "bot" ? "3px solid " + ACCENT : "none",
                      padding: "12px 16px",
                      fontSize: 14, lineHeight: 1.75,
                      color: TEXT,
                      fontFamily: SERIF,
                      wordBreak: "break-word",
                    }}>
                      {m.role === "user" ? (
                        <span style={{ fontFamily: MONO, fontSize: 13, color: TEXT }}>{m.text}</span>
                      ) : m.html ? (
                        <span dangerouslySetInnerHTML={{ __html: m.html }} />
                      ) : thinkingStatus ? (
                        <span style={{ color: TEXT_MUTED, fontSize: 12, fontStyle: "italic", fontFamily: SERIF }}>
                          {thinkingStatus}
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          {[0, .25, .5].map((d, j) => (
                            <span key={j} style={{ width: 4, height: 4, background: ACCENT, borderRadius: "50%",
                              display: "inline-block", animation: `pulse 1.2s ${d}s infinite` }} />
                          ))}
                        </span>
                      )}
                    </div>
                    {m.role === "bot" && m.text && !thinkingStatus && (
                      <button onClick={() => navigator.clipboard.writeText(m.text)}
                        title="Copiar respuesta"
                        style={{
                          alignSelf: "flex-start", marginTop: 4, marginLeft: 2,
                          background: "none", border: "none", color: TEXT_MUTED,
                          cursor: "pointer", fontSize: 10, fontFamily: SERIF,
                          padding: "2px 6px", transition: "color .15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = ACCENT; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = TEXT_MUTED; }}>
                        📋 copiar
                      </button>
                    )}
                  </div>
                ))}
                <div ref={msgsEndRef} />
              </div>

              <div style={{
                borderTop: "1px solid " + BORDER, padding: "12px 16px 16px",
                background: BG, display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end",
              }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void sendMessage(); } }}
                  placeholder="Seguí preguntando…"
                  disabled={busy}
                  style={{
                    flex: 1, background: BG_CARD, border: "1px solid " + BORDER,
                    color: TEXT, fontSize: 14, padding: "10px 14px",
                    outline: "none", fontFamily: SERIF, height: 40,
                    transition: "border-color .15s",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = ACCENT)}
                  onBlur={(e) => (e.target.style.borderColor = BORDER)}
                />
                <button onClick={() => void sendMessage()}
                  disabled={busy || !input.trim()}
                  style={{
                    background: busy || !input.trim() ? BG_CARD : ACCENT,
                    color: busy || !input.trim() ? TEXT_MUTED : "#fff",
                    border: "none", cursor: busy || !input.trim() ? "not-allowed" : "pointer",
                    width: 40, height: 40, display: "grid", placeItems: "center",
                    flexShrink: 0, fontSize: 16, fontWeight: 700,
                    fontFamily: SERIF, transition: "background .15s",
                  }}
                >
                  →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── History Modal ── */}
      {historyOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: "rgba(0,0,0,.4)", display: "flex",
          flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: 20, fontFamily: SERIF,
        }} onClick={() => setHistoryOpen(false)}>
          <div style={{
            background: BG, border: "1px solid " + BORDER,
            boxShadow: "0 8px 30px rgba(0,0,0,.1)",
            maxWidth: 520, width: "100%", maxHeight: "80vh",
            display: "flex", flexDirection: "column",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "14px 18px",
              borderBottom: "1px solid " + BORDER, flexShrink: 0,
            }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: TEXT, fontFamily: SERIF }}>
                Cronologia
              </span>
              <button onClick={() => setHistoryOpen(false)}
                style={{ background: "none", border: "none", color: TEXT_MUTED,
                  cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {historyLoading && (
                <div style={{ textAlign: "center", color: TEXT_MUTED, padding: 24, fontSize: 13, fontFamily: SERIF, fontStyle: "italic" }}>
                  caricamento…
                </div>
              )}
              {!historyLoading && conversations.length === 0 && (
                <div style={{ textAlign: "center", color: TEXT_MUTED, padding: 24, fontSize: 13, fontFamily: SERIF }}>
                  Nessuna conversazione
                </div>
              )}
              {!historyLoading && conversations.map((c: any) => (
                <div key={c.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 18px", borderBottom: "1px solid " + BORDER,
                }}>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: 13, color: TEXT,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      fontFamily: SERIF,
                    }}>
                      {c.title}
                    </div>
                    <div style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 2, fontFamily: SERIF }}>
                      {new Date(c.createdAt).toLocaleString("es-AR", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <button onClick={() => loadConversation(c.id)}
                    style={{
                      background: ACCENT, color: "#fff", border: "none",
                      padding: "5px 10px", cursor: "pointer", fontSize: 11,
                      fontWeight: 600, fontFamily: SERIF, flexShrink: 0,
                    }}>
                    Carica
                  </button>
                  <button onClick={() => deleteConversation(c.id)}
                    style={{
                      background: "transparent", color: TEXT_MUTED, border: "1px solid " + BORDER,
                      padding: "5px 10px", cursor: "pointer", fontSize: 11,
                      fontFamily: SERIF, flexShrink: 0,
                    }}>
                    Elimina
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{STYLES}</style>
    </div>
  );
}
