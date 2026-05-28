import { useEffect, useRef, useCallback, useState } from "react";

const MONO = '"Cascadia Code","Fira Code",Menlo,Consolas,monospace';
const SANS = '-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif';
const ACCENT = "#ff7700";

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
  *::-webkit-scrollbar { width: 4px; }
  *::-webkit-scrollbar-track { background: #0a0a0a; }
  *::-webkit-scrollbar-thumb { background: ${ACCENT}; }
  textarea::placeholder { color: #555; }

  .md-p   { margin: 0 0 .65em; line-height: 1.8; }
  .md-p:last-child { margin-bottom: 0; }
  .md-h1, .md-h2, .md-h3 { text-transform: uppercase; background: #fff; color: #cc0000; padding: 6px 10px; margin: .8em 0 .5em; letter-spacing: .04em; font-family: ${SANS}; }
  .md-h1 { font-size: 1.3em; font-weight: 800; }
  .md-h2 { font-size: 1.1em; font-weight: 700; }
  .md-h3 { font-size: .96em; font-weight: 700; }
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
  .md-cite  { color: #666; font-size: .76em; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .md-cite:hover { color: #999; }
  .md-cite-text { color: #555; font-size: .76em; }
  .md-data-box { background: #0d0d0d; border: 2px solid #cc0000; padding: 14px 16px; margin: .6em 0; }
  .md-data-box strong { color: #fff; }
  .md-data-box br + strong { display: inline-block; margin-top: .3em; }
  .md-num { color: #cc0000; font-weight: 700; }
  .md-media { margin: .6em 0; }
  .md-thumb { max-width: 280px; max-height: 180px; height: auto; border: 2px solid #cc0000; display: block; margin: .4em 0; border-radius: 4px; }
  .md-img-wrap { display: block; margin: .4em 0; }
  .md-video { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; }
  .md-video iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 1px solid #1a1a1a; }
  .md-link-modal { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .md-link-modal:hover { opacity: .8; }
  strong { color: #fff; font-weight: 700; }
  em     { color: #bbb; }
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
    <div style={{ width: "100vw", height: "100dvh", background: "#0a0a0a",
      display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: MONO }}>

      <nav style={{ flexShrink: 0, background: "#0a0a0a", borderBottom: "3px solid " + ACCENT,
        display: "flex", alignItems: "stretch", height: 48, position: "relative" }}>

        <div style={{ width: 6, background: ACCENT, flexShrink: 0 }} />

        <div style={{ paddingLeft: 14, paddingRight: 18, display: "flex",
          alignItems: "center", borderRight: "2px solid #1a1a1a", cursor: "pointer",
          position: "relative" }}
          onClick={() => setMenuOpen((p) => !p)}
          onMouseLeave={() => setMenuOpen(false)}>
          <div style={{ width: 24, height: 24, background: ACCENT,
            display: "grid", placeItems: "center", transform: "rotate(45deg)", flexShrink: 0 }}>
            <img src="/ESTRELLA.svg" alt="✦"
              style={{ width: 16, height: 16, transform: "rotate(-45deg)", display: "block" }} />
          </div>

          {menuOpen && (
            <div style={{
              position: "absolute", top: 44, left: 0, zIndex: 999,
              background: "#111", border: "2px solid " + ACCENT,
              minWidth: 180, fontFamily: MONO,
            }}>
              {[
                { id: "new" as any, label: "◈ NUEVA CONVERSACIÓN" },
                { id: null, label: "─" },
                { id: "history" as any, label: "☰ HISTORIAL" },
              ].map((item: any, idx) => {
                if (item.label === "─") {
                  return <div key={idx} style={{ height: 1, background: "#222", margin: "4px 0" }} />;
                }
                return (
                  <button key={item.id} onClick={() => {
                    setMenuOpen(false);
                    if (item.id === "new") { newConversation(); }
                    else if (item.id === "history") { setHistoryOpen(true); fetchConversations(); }
                  }}
                    style={{
                      display: "block", width: "100%", border: "none",
                      background: "transparent",
                      color: "#555",
                      cursor: "pointer", padding: "10px 18px", fontSize: 11,
                      fontWeight: 700, letterSpacing: ".12em",
                      textTransform: "uppercase", textAlign: "left",
                      fontFamily: MONO, transition: "all .1s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1a"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", paddingLeft: 16 }}>
          <span style={{ color: charlaMode ? "#ff7700" : "#888", fontSize: 11, fontWeight: 700,
            letterSpacing: ".12em", textTransform: "uppercase", fontFamily: MONO }}>
            ◈ {charlaMode ? "CHARLA" : "PERIODISTA"}
          </span>
        </div>

        <button
          onClick={() => {
            setCharlaMode((m) => !m);
            setSessionId(null);
            setConversationId(null);
          }}
          title={charlaMode ? "Activar modo periodista" : "Volver a modo charla"}
          style={{
            marginLeft: 16,
            background: charlaMode ? "transparent" : "#ff7700",
            color: charlaMode ? "#555" : "#000",
            border: "1px solid " + (charlaMode ? "#333" : "#ff7700"),
            padding: "3px 10px",
            fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", cursor: "pointer",
            fontFamily: MONO, transition: "all .15s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ff7700"; e.currentTarget.style.color = charlaMode ? "#ff7700" : "#000"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = charlaMode ? "#333" : "#ff7700"; e.currentTarget.style.color = charlaMode ? "#555" : "#000"; }}
        >
          {charlaMode ? "○ PERIODISTA" : "✦ PERIODISTA"}
        </button>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingRight: 16 }}>
          <span style={{ color: ACCENT, fontSize: 11, fontWeight: 700,
            letterSpacing: ".06em", fontFamily: MONO }}>
            {clock}
          </span>
        </div>
      </nav>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

        <div ref={chatMsgsRef} style={{ flex: 1, overflowY: "auto", padding: "20px 0 8px",
          display: "flex", flexDirection: "column", fontFamily: SANS }}>
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center" }}>
              <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 14px" }}>
                <div style={{ position: "absolute", inset: 0, border: "3px solid " + ACCENT }} />
                <div style={{ position: "absolute", top: 7, left: 7, right: 7, bottom: 7,
                  background: ACCENT, display: "grid", placeItems: "center" }}>
                  <span style={{ color: "#fff", fontSize: 22, fontWeight: 900 }}>✦</span>
                </div>
              </div>
              <p style={{ color: "#553300", fontSize: 10, fontWeight: 700,
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
              <div style={{
                width: 26, height: 26, flexShrink: 0,
                background: m.role === "user" ? ACCENT : "#111",
                border: m.role === "bot" ? "2px solid " + ACCENT : "none",
                display: "grid", placeItems: "center",
                color: m.role === "user" ? "#000" : ACCENT,
                fontWeight: 700, fontSize: 10, letterSpacing: ".05em", fontFamily: MONO,
              }}>
                {m.role === "user" ? "U" : "A"}
              </div>

              <div style={{
                background: m.role === "user" ? ACCENT : "#111",
                borderLeft: m.role === "bot" ? "3px solid " + ACCENT : undefined,
                border: m.role === "bot" ? "1px solid #1a1a1a" : "none",
                padding: "10px 14px",
                maxWidth: "calc(100% - 48px)",
                color: m.role === "user" ? "#000" : "#d0d0d0",
                fontSize: 13.5, lineHeight: 1.75,
                wordBreak: "break-word", fontFamily: SANS,
              }}>
                {m.role === "user" ? (
                  <span style={{ whiteSpace: "pre-wrap", fontFamily: MONO }}>{m.text}</span>
                ) : m.html ? (
                  <span dangerouslySetInnerHTML={{ __html: m.html }} />
                ) : thinkingStatus ? (
                  <span style={{ color: "#666", fontSize: 11, fontWeight: 700,
                    letterSpacing: ".08em", fontFamily: MONO }}>
                    {thinkingStatus}
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                    {[0, .25, .5].map((d, j) => (
                      <span key={j} style={{ width: 5, height: 5, background: ACCENT,
                        display: "inline-block", animation: `pulse 1.2s ${d}s infinite` }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={msgsEndRef} />
        </div>

        <div style={{ borderTop: "2px solid " + ACCENT, padding: "10px 16px 14px",
          background: "#0a0a0a", display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
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
            onFocus={(e) => (e.target.style.borderColor = ACCENT)}
            onBlur={(e)  => (e.target.style.borderColor = "#1e1e1e")}
          />
          <button onClick={() => void sendMessage()}
            disabled={busy || !input.trim()}
            style={{
              background: busy || !input.trim() ? "#111" : ACCENT,
              color: busy || !input.trim() ? "#333" : "#000",
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

      {historyOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: "rgba(0,0,0,.85)", display: "flex",
          flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: 20, fontFamily: MONO,
        }} onClick={() => setHistoryOpen(false)}>
          <div style={{
            background: "#111", border: "2px solid " + ACCENT,
            maxWidth: 600, width: "100%", maxHeight: "80vh",
            display: "flex", flexDirection: "column",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "12px 16px",
              borderBottom: "1px solid #1a1a1a", flexShrink: 0,
            }}>
              <span style={{ color: ACCENT, fontWeight: 700, fontSize: 11,
                letterSpacing: ".12em", textTransform: "uppercase" }}>
                ☰ HISTORIAL
              </span>
              <button onClick={() => setHistoryOpen(false)}
                style={{ background: "none", border: "none", color: "#555",
                  cursor: "pointer", fontSize: 18 }}>
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {historyLoading && (
                <div style={{ textAlign: "center", color: "#555", padding: 20, fontSize: 11,
                  letterSpacing: ".1em", textTransform: "uppercase" }}>
                  Cargando...
                </div>
              )}
              {!historyLoading && conversations.length === 0 && (
                <div style={{ textAlign: "center", color: "#333", padding: 20, fontSize: 11,
                  letterSpacing: ".1em", textTransform: "uppercase" }}>
                  Sin conversaciones guardadas
                </div>
              )}
              {!historyLoading && conversations.map((c: any) => (
                <div key={c.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px", borderBottom: "1px solid #1a1a1a",
                }}>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ color: "#d0d0d0", fontSize: 12, fontWeight: 700,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.title}
                    </div>
                    <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>
                      {new Date(c.createdAt).toLocaleString("es-AR", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <button onClick={() => loadConversation(c.id)}
                    style={{
                      background: ACCENT, color: "#000", border: "none",
                      padding: "5px 10px", cursor: "pointer", fontSize: 9,
                      fontWeight: 700, letterSpacing: ".1em",
                      textTransform: "uppercase", flexShrink: 0,
                    }}>
                    CARGAR
                  </button>
                  <button onClick={() => deleteConversation(c.id)}
                    style={{
                      background: "transparent", color: "#555", border: "1px solid #333",
                      padding: "5px 10px", cursor: "pointer", fontSize: 9,
                      fontWeight: 700, letterSpacing: ".1em",
                      textTransform: "uppercase", flexShrink: 0,
                    }}>
                    BORRAR
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
