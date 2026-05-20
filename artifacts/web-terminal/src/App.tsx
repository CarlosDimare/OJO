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
const SANS = '-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif';

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
  // images: ![alt](url) → thumbnail
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, url) => `<span class="md-img-wrap"><img src="${url}" alt="${alt}" class="md-thumb" loading="lazy" onerror="this.style.display='none'" /></span>`);
  // links: [text](url) → modal
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="#!" class="md-a md-link-modal" data-url="${'$2'}">${'$1'}</a>`);
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
  // highlight percentages
  t = t.replace(/(\d+(?:[.,]\d+)?\s*%)/g, '<span class="md-num">$1</span>');
  // highlight currency & large figures
  t = t.replace(/([$]\d+(?:[.,]\d+)?(?:\s*(?:millones|billones|mil|M|B))?)/g, '<span class="md-num">$1</span>');
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

    // ── Data box ::: cifra
    if (/^:::\s*cifra/i.test(line.trim())) {
      const boxLines: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) {
        boxLines.push(lines[i]);
        i++;
      }
      i++; // skip :::
      const inner = boxLines.map((l) => inlineEscaped(esc(l))).join("<br>");
      out.push(`<div class="md-data-box">${inner}</div>`);
      continue;
    }

    // ── Image block
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      out.push(`<span class="md-img-wrap"><img src="${esc(imgMatch[2])}" alt="${esc(imgMatch[1])}" class="md-thumb" loading="lazy" onerror="this.style.display='none'" /></span>`);
      i++;
      continue;
    }

    // ── Video block (YouTube, Vimeo)
    const vidMatch = line.match(/^@\[(YouTube|Vimeo)\]\(([^)]+)\)$/);
    if (vidMatch) {
      let url = vidMatch[2];
      if (vidMatch[1] === "YouTube") {
        url = url.replace(/watch\?v=/, "embed/").replace(/youtu\.be\//, "youtube.com/embed/");
      }
      // Only render if URL looks valid (starts with https://)
      if (/^https:\/\//.test(url)) {
        out.push(`<div class="md-media md-video"><iframe src="${esc(url)}" frameborder="0" allowfullscreen loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe></div>`);
      }
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
          citeItems.push(`<a href="#!" class="md-cite md-link-modal" data-url="${esc(linkMatch[2])}">${esc(linkMatch[1])}</a>`);
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
interface VoiceMessage { role: "user" | "bot"; text: string; }
type View = "terminal" | "chat" | "voz" | "portal" | "redaccion";

interface ActivityEntry {
  agentId: string;
  agentLabel: string;
  time: string;
  msg: string;
  type: "step" | "tool" | "done" | "error";
}

interface Accion {
  id: number;
  seccion: string;
  pais: string;
  bandera: string;
  hora: string;
  fecha: string;
  lugar: string;
  tipoAccion: string;
  organizaciones: string[];
  motivo: string;
  status: string;
  lat: string | null;
  lng: string | null;
  fuentes: { nombre: string; url: string }[];
  ultimasNoticias: { titular: string; url: string; fuente: string }[] | null;
  createdAt: string;
  updatedAt: string;
}

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
  /* ── Data box ── */
  .md-data-box { background: #0d0d0d; border: 2px solid #cc0000; padding: 14px 16px; margin: .6em 0; }
  .md-data-box strong { color: #fff; }
  .md-data-box br + strong { display: inline-block; margin-top: .3em; }
  /* ── Number highlight ── */
  .md-num { color: #cc0000; font-weight: 700; }
  /* ── Media ── */
  .md-media { margin: .6em 0; }
  .md-thumb { max-width: 280px; max-height: 180px; height: auto; border: 2px solid #cc0000; display: block; margin: .4em 0; border-radius: 4px; }
  .md-img-wrap { display: block; margin: .4em 0; }
  .md-img-broken { display: inline-block; color: #555; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; font-family: monospace; border: 1px dashed #333; padding: 8px 14px; }
  .md-media img { max-width: 100%; height: auto; border: 1px solid #1a1a1a; display: block; }
  .md-video { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; }
  .md-video iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 1px solid #1a1a1a; }
  /* ── Modal link ── */
  .md-link-modal { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .md-link-modal:hover { opacity: .8; }
  strong { color: #fff; font-weight: 700; }
  em     { color: #bbb; }
`;

/* ══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [view, setView]       = useState<View>("chat");
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [charlaMode, setCharlaMode] = useState(false);
  const msgsEndRef               = useRef<HTMLDivElement>(null);
  const inputRef                 = useRef<HTMLTextAreaElement>(null);
  const chatMsgsRef              = useRef<HTMLDivElement>(null);

  /* history */
  const [historyOpen, setHistoryOpen]     = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* modal */
  const [modalOpen, setModalOpen]       = useState(false);
  const [modalUrl, setModalUrl]         = useState("");
  const [modalTitle, setModalTitle]     = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError]     = useState("");
  const [modalHtml, setModalHtml]       = useState("");

  /* portal */
  const [portalTab, setPortalTab]           = useState<"internacionales" | "protestas_ar">("internacionales");
  const [acciones, setAcciones]             = useState<Accion[]>([]);
  const [portalLoading, setPortalLoading]   = useState(false);
  const [selectedAccion, setSelectedAccion] = useState<Accion | null>(null);
  const [portalDetailOpen, setPortalDetailOpen] = useState(false);
  const [portalNoticias, setPortalNoticias] = useState<{ titular: string; url: string; fuente: string }[]>([]);
  const [portalNoticiasLoading, setPortalNoticiasLoading] = useState(false);
  const [portalRefreshLoading, setPortalRefreshLoading] = useState(false);

  /* agent status */
  const [agentStatus, setAgentStatus] = useState<{ enabled: boolean; running: string[]; scheduled: boolean } | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);

  /* redaccion */
  const [redaccionAgentes, setRedaccionAgentes] = useState<any[]>([]);
  const [editingName, setEditingName] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [editTaskValue, setEditTaskValue] = useState("");

  /* jefe editor */
  interface JefeMsg { role: "user" | "assistant"; text: string; }
  const [jefeMessages, setJefeMessages] = useState<JefeMsg[]>([]);
  const [jefeInput, setJefeInput] = useState("");
  const [jefeBusy, setJefeBusy] = useState(false);
  const jefeMsgsRef = useRef<HTMLDivElement>(null);
  const jefeEndRef = useRef<HTMLDivElement>(null);

  /* voz */
  const voiceStoppedRef          = useRef(false);
  const voiceBusyRef             = useRef(false);
  const recogRef                 = useRef<any>(null);
  const voiceSessionRef          = useRef<string | null>(null);
  const [voiceActive, setVoiceActive]     = useState(false);
  const [voiceStatus, setVoiceStatus]     = useState("");
  const [voiceMessages, setVoiceMessages] = useState<VoiceMessage[]>([]);
  const voiceMessagesEndRef               = useRef<HTMLDivElement>(null);

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

  /* ── Modal link delegation ────────────────────────────────────────── */
  useEffect(() => {
    const el = chatMsgsRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest(".md-link-modal") as HTMLElement | null;
      if (!t) return;
      e.preventDefault();
      const url = t.getAttribute("data-url") || "";
      if (!url) return;
      setModalUrl(url);
      setModalTitle(t.textContent || "");
      setModalOpen(true);
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, []);

  /* ── Fetch modal content ───────────────────────────────────────────── */
  useEffect(() => {
    if (!modalOpen || !modalUrl) return;
    setModalLoading(true); setModalError(""); setModalHtml("");
    fetch(`/api/fetch-proxy?url=${encodeURIComponent(modalUrl)}`)
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok) {
          const body = ct.includes("json") ? (await r.json()).error : `HTTP ${r.status}`;
          throw new Error(body);
        }
        return r.text();
      })
      .then((html) => { setModalHtml(html); setModalLoading(false); })
      .catch((err) => { setModalError(err.message); setModalLoading(false); });
  }, [modalOpen, modalUrl]);

  /* ── Send chat ──────────────────────────────────────────────────── */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true); setInput(""); setThinkingStatus("...");
    setMessages((p) => [...p, { role: "user", text }, { role: "bot", text: "", html: "" }]);
    let full = ""; let cur = sessionId; let cid = conversationId;
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: cur, conversation_id: cid, charla_mode: charlaMode }),
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
            setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "", html: `<span style="color:#e83030">⚠ ${esc(ev["message"] as string)}</span>` }; return n; });
          }
        }
      }
      if (!full) setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "—", html: "—" }; return n; });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setThinkingStatus(null);
      setMessages((p) => { const n = [...p]; n[n.length - 1] = { role: "bot", text: "", html: `<span style="color:#e83030">⚠ ${esc(msg)}</span>` }; return n; });
    } finally { setBusy(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [input, busy, sessionId, conversationId]);

  /* ── Voice chat ──────────────────────────────────────────────────── */
  useEffect(() => { voiceMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [voiceMessages]);
  useEffect(() => {
    if (view !== "voz") {
      voiceStoppedRef.current = true; voiceBusyRef.current = false;
      try { recogRef.current?.stop(); } catch {}
      recogRef.current = null; window.speechSynthesis?.cancel();
      setVoiceActive(false);
    }
  }, [view]);

  const startVoice = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVoiceStatus("Reconocimiento de voz no soportado"); return; }
    if (!("speechSynthesis" in window)) { setVoiceStatus("Síntesis de voz no soportada"); return; }

    setVoiceActive(true); setVoiceMessages([]);
    voiceSessionRef.current = null; voiceBusyRef.current = false; voiceStoppedRef.current = false;
    setVoiceStatus("Iniciando...");

    const recognition = new SR();
    recognition.lang = "es-ES"; recognition.continuous = false;
    recognition.interimResults = false; recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      if (!text.trim() || voiceStoppedRef.current) return;
      setVoiceMessages((p) => [...p, { role: "user", text: text.trim() }]);
      setVoiceStatus("Procesando..."); voiceBusyRef.current = true;

      (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text.trim(), session_id: voiceSessionRef.current }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
          let full = "";
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n"); buf = lines.pop()!;
            for (const ln of lines) {
              if (!ln.startsWith("data: ")) continue;
              let ev: any; try { ev = JSON.parse(ln.slice(6)); } catch { continue; }
              if (ev.type === "session") voiceSessionRef.current = ev.session_id;
              else if (ev.type === "text") full += ev.text;
            }
          }
          if (full && !voiceStoppedRef.current) {
            setVoiceMessages((p) => [...p, { role: "bot", text: full }]);
            setVoiceStatus("Hablando...");
            const u = new SpeechSynthesisUtterance(full);
            u.lang = "es-ES"; u.rate = 1.1;
            u.onend = () => {
              voiceBusyRef.current = false;
              if (!voiceStoppedRef.current) { setVoiceStatus("Escuchando..."); try { recognition.start(); } catch {} }
            };
            window.speechSynthesis.speak(u);
          } else {
            voiceBusyRef.current = false;
            if (!voiceStoppedRef.current) { setVoiceStatus("Escuchando..."); try { recognition.start(); } catch {} }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setVoiceMessages((p) => [...p, { role: "bot", text: "Error: " + msg }]);
          voiceBusyRef.current = false;
          if (!voiceStoppedRef.current) { setVoiceStatus("Escuchando..."); try { recognition.start(); } catch {} }
        }
      })();
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        if (!voiceStoppedRef.current && !voiceBusyRef.current) { try { recognition.start(); } catch {} }
        return;
      }
      if (!voiceStoppedRef.current) { setVoiceStatus("Error: " + event.error); voiceStoppedRef.current = true; }
    };

    recognition.onend = () => {
      if (!voiceStoppedRef.current && !voiceBusyRef.current) { try { recognition.start(); } catch {} }
    };

    recogRef.current = recognition;
    setVoiceStatus("Escuchando...");
    try { recognition.start(); } catch { setVoiceStatus("Error al iniciar micrófono"); }
  }, []);

  const stopVoice = useCallback(() => {
    voiceStoppedRef.current = true; voiceBusyRef.current = false;
    try { recogRef.current?.stop(); } catch {}
    recogRef.current = null; window.speechSynthesis?.cancel();
    setVoiceActive(false); setVoiceStatus("Conversación detenida");
  }, []);

  /* ── History ──────────────────────────────────────────────────────── */
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
      if (view !== "chat") setView("chat");
    } catch {}
  }, [view]);

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

  /* ── Portal ──────────────────────────────────────────────────────── */
  const fetchAcciones = useCallback(async (seccion: string) => {
    setPortalLoading(true);
    try {
      const r = await fetch(`/api/acciones?seccion=${seccion}`);
      if (r.ok) setAcciones(await r.json());
    } catch {} finally { setPortalLoading(false); }
  }, []);

  const openPortalDetail = useCallback(async (a: Accion) => {
    setSelectedAccion(a);
    setPortalDetailOpen(true);
    setPortalNoticiasLoading(true);
    setPortalNoticias([]);
    try {
      const r = await fetch(`/api/acciones/${a.id}`);
      if (r.ok) {
        const data = await r.json();
        setPortalNoticias(data.ultimasNoticias || []);
      }
    } catch {} finally { setPortalNoticiasLoading(false); }
  }, []);

  // Auto-refresh portal every 60s when portal view is active
  useEffect(() => {
    if (view !== "portal") return;
    fetchAcciones(portalTab);
    const id = setInterval(() => fetchAcciones(portalTab), 60_000);
    return () => clearInterval(id);
  }, [view, portalTab, fetchAcciones]);

  const triggerAgent = useCallback(async () => {
    setPortalRefreshLoading(true);
    try {
      await fetch("/api/agentes/disparar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setTimeout(() => fetchAcciones(portalTab), 5000);
    } catch {} finally { setPortalRefreshLoading(false); }
  }, [portalTab, fetchAcciones]);

  /* ── Agent status polling ── */
  const fetchAgentStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/agentes/status");
      if (r.ok) setAgentStatus(await r.json());
    } catch {}
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const r = await fetch("/api/agentes/actividad");
      if (r.ok) setActivityLog(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (view !== "chat") return;
    fetchAgentStatus();
    const id = setInterval(fetchAgentStatus, 10_000);
    return () => clearInterval(id);
  }, [view, fetchAgentStatus]);

  useEffect(() => {
    if (view !== "chat") return;
    fetchActivity();
    const id = setInterval(fetchActivity, 4_000);
    return () => clearInterval(id);
  }, [view, fetchActivity]);

  const toggleAgents = useCallback(async () => {
    const next = !agentStatus?.enabled;
    try {
      const r = await fetch("/api/agentes/toggle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (r.ok) setAgentStatus(await r.json());
    } catch {}
  }, [agentStatus]);

  /* ── Redacción handlers ─────────────────────────────────────────── */
  const fetchRedaccion = useCallback(async () => {
    try {
      const r = await fetch("/api/redaccion");
      if (r.ok) setRedaccionAgentes(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (view !== "redaccion") return;
    fetchRedaccion();
    const id = setInterval(fetchRedaccion, 8000);
    // Auto-seed if empty
    fetch("/api/redaccion").then(async (r) => {
      if (r.ok) {
        const rows = await r.json();
        if (rows.length === 0) {
          await fetch("/api/redaccion/sembrar", { method: "POST" });
          fetchRedaccion();
        }
      }
    });
    return () => clearInterval(id);
  }, [view, fetchRedaccion]);

  const seedRedaccion = useCallback(async () => {
    await fetch("/api/redaccion/sembrar", { method: "POST" });
    fetchRedaccion();
  }, [fetchRedaccion]);

  const saveAgentName = useCallback(async (id: number) => {
    if (editNameValue.trim()) {
      await fetch(`/api/redaccion/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: editNameValue.trim() }),
      });
      fetchRedaccion();
    }
    setEditingName(null);
  }, [editNameValue, fetchRedaccion]);

  const deleteAgente = useCallback(async (id: number) => {
    await fetch(`/api/redaccion/${id}`, { method: "DELETE" });
    fetchRedaccion();
  }, [fetchRedaccion]);

  const addTask = useCallback(async (id: number) => {
    const ag = redaccionAgentes.find((a) => a.id === id);
    if (!ag) return;
    const tareas = [...ag.tareas, "nueva tarea"];
    await fetch(`/api/redaccion/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tareas }),
    });
    fetchRedaccion();
  }, [redaccionAgentes, fetchRedaccion]);

  const deleteTask = useCallback(async (id: number, idx: number) => {
    const ag = redaccionAgentes.find((a) => a.id === id);
    if (!ag) return;
    const tareas = ag.tareas.filter((_: string, i: number) => i !== idx);
    await fetch(`/api/redaccion/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tareas }),
    });
    fetchRedaccion();
  }, [redaccionAgentes, fetchRedaccion]);

  const saveTask = useCallback(async (id: number, idx: number) => {
    setEditingTask(null);
    if (!editTaskValue.trim()) return;
    const ag = redaccionAgentes.find((a) => a.id === id);
    if (!ag) return;
    const tareas = [...ag.tareas];
    tareas[idx] = editTaskValue.trim();
    await fetch(`/api/redaccion/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tareas }),
    });
    fetchRedaccion();
  }, [editTaskValue, redaccionAgentes, fetchRedaccion]);

  /* Actividad por agente */
  const [actividadPorAgente, setActividadPorAgente] = useState<Record<string, string>>({});
  const [actividad, setActividad] = useState<Record<string, ActivityEntry[]>>({});

  const fetchActividad = useCallback(async () => {
    try {
      const r = await fetch("/api/redaccion/actividad");
      if (!r.ok) return;
      const data = await r.json() as { actividad: ActivityEntry[]; agentes: any[] };
      const grouped: Record<string, ActivityEntry[]> = {};
      for (const act of data.actividad) {
        if (!grouped[act.agentId]) grouped[act.agentId] = [];
        grouped[act.agentId].push(act);
      }
      setActividad(grouped);
      const latest: Record<string, string> = {};
      for (const ag of data.agentes) {
        if (ag.agenteId && grouped[ag.agenteId]?.[0]) {
          latest[ag.agenteId] = grouped[ag.agenteId][0].msg;
        }
      }
      setActividadPorAgente(latest);
    } catch {}
  }, []);

  useEffect(() => {
    if (view !== "redaccion") return;
    fetchActividad();
    const id = setInterval(fetchActividad, 4000);
    return () => clearInterval(id);
  }, [view, fetchActividad]);

  /* ── Jefe Editor ── */
  useEffect(() => {
    jefeEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [jefeMessages]);

  const jefeSend = useCallback(async () => {
    const msg = jefeInput.trim();
    if (!msg || jefeBusy) return;
    setJefeInput("");
    setJefeMessages((prev) => [...prev, { role: "user", text: msg }]);
    setJefeBusy(true);
    try {
      const r = await fetch("/api/redaccion/jefe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const reader = r.body?.getReader();
      if (!reader) return;
      let partial = "";
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as { type: string; text?: string; error?: string };
            if (ev.type === "text" && ev.text) {
              partial += ev.text;
              setJefeMessages((prev) => {
                const next = [...prev];
                if (next.length > 0 && next[next.length - 1].role === "assistant") {
                  next[next.length - 1] = { role: "assistant", text: partial };
                } else {
                  next.push({ role: "assistant", text: partial });
                }
                return next;
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      setJefeMessages((prev) => [...prev, { role: "assistant", text: `Error: ${(e as Error).message}` }]);
    } finally {
      setJefeBusy(false);
    }
  }, [jefeInput, jefeBusy]);

  const resetJefe = useCallback(async () => {
    await fetch("/api/redaccion/jefe/reset", { method: "POST" });
    setJefeMessages([]);
  }, []);

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div style={{ width: "100vw", height: "100dvh", background: "#0a0a0a",
      display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: MONO }}>

      {/* ════ NAV BAR ════ */}
      <nav style={{ flexShrink: 0, background: "#0a0a0a", borderBottom: "3px solid #cc0000",
        display: "flex", alignItems: "stretch", height: 48, position: "relative" }}>

        {/* Red stripe */}
        <div style={{ width: 6, background: "#cc0000", flexShrink: 0 }} />

        {/* Star — toggle menu */}
        <div style={{ paddingLeft: 14, paddingRight: 18, display: "flex",
          alignItems: "center", borderRight: "2px solid #1a1a1a", cursor: "pointer",
          position: "relative" }}
          onClick={() => setMenuOpen((p) => !p)}
          onMouseLeave={() => setMenuOpen(false)}>
          <div style={{ width: 24, height: 24, background: "#cc0000",
            display: "grid", placeItems: "center", transform: "rotate(45deg)", flexShrink: 0 }}>
            <img src="/ESTRELLA.svg" alt="✦"
              style={{ width: 16, height: 16, transform: "rotate(-45deg)", display: "block" }} />
          </div>

          {/* Dropdown menu */}
          {menuOpen && (
            <div style={{
              position: "absolute", top: 44, left: 0, zIndex: 999,
              background: "#111", border: "2px solid #cc0000",
              minWidth: 180, fontFamily: MONO,
            }}>
              {[
                { id: "chat" as const, label: "◈ PERIODISTA" },
                { id: "voz" as const,  label: "♪ VOZ" },
                { id: "terminal" as const, label: "▸ TERMINAL" },
                { id: "portal" as const, label: "◉ PORTAL" },
                { id: "redaccion" as const, label: "◼ REDACCIÓN" },
                { id: null, label: "─" },
                { id: "new" as any, label: "◈ NUEVA CONVERSACIÓN" },
                { id: "history" as any, label: "☰ HISTORIAL" },
              ].map((item: any, idx) => {
                if (item.label === "─") {
                  return <div key={idx} style={{ height: 1, background: "#222", margin: "4px 0" }} />;
                }
                const isView = item.id === "chat" || item.id === "voz" || item.id === "terminal" || item.id === "portal" || item.id === "redaccion";
                const active = isView && view === item.id;
                return (
                  <button key={item.id} onClick={() => {
                    setMenuOpen(false);
                    if (item.id === "new") { newConversation(); setView("chat"); }
                    else if (item.id === "history") { setHistoryOpen(true); fetchConversations(); }
                    else { setView(item.id); }
                  }}
                    style={{
                      display: "block", width: "100%", border: "none",
                      background: active ? "#cc0000" : "transparent",
                      color: active ? "#fff" : "#555",
                      cursor: "pointer", padding: "10px 18px", fontSize: 11,
                      fontWeight: 700, letterSpacing: ".12em",
                      textTransform: "uppercase", textAlign: "left",
                      fontFamily: MONO, transition: "all .1s",
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#1a1a1a"; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Active view label */}
        <div style={{ display: "flex", alignItems: "center", paddingLeft: 16 }}>
          <span style={{ color: "#cc0000", fontSize: 11, fontWeight: 700,
            letterSpacing: ".12em", textTransform: "uppercase", fontFamily: MONO }}>
            {view === "chat" ? "◈ PERIODISTA" : view === "voz" ? "♪ VOZ" : view === "portal" ? "◉ PORTAL" : view === "redaccion" ? "◼ REDACCIÓN" : "▸ TERMINAL"}
          </span>
        </div>

        {/* Modo charla toggle — solo visible en chat */}
        {view === "chat" && (
          <button
            onClick={() => {
              setCharlaMode((m) => !m);
              // Nueva sesión para que el system prompt nuevo tome efecto
              setSessionId(null);
              setConversationId(null);
            }}
            title={charlaMode ? "Cambiar a modo periodista" : "Cambiar a modo charla"}
            style={{
              marginLeft: 16,
              background: charlaMode ? "#fff" : "transparent",
              color: charlaMode ? "#cc0000" : "#444",
              border: charlaMode ? "none" : "1px solid #333",
              padding: "3px 10px",
              fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", cursor: "pointer",
              fontFamily: MONO, transition: "all .15s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { if (!charlaMode) e.currentTarget.style.borderColor = "#cc0000"; e.currentTarget.style.color = charlaMode ? "#cc0000" : "#cc0000"; }}
            onMouseLeave={(e) => { if (!charlaMode) e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = charlaMode ? "#cc0000" : "#444"; }}
          >
            {charlaMode ? "✦ CHARLA" : "○ CHARLA"}
          </button>
        )}

        {/* Redacción button */}
        <button onClick={() => setView("redaccion")}
          style={{
            marginLeft: view === "chat" ? 16 : "auto",
            background: view === "redaccion" ? "#cc0000" : "transparent",
            color: view === "redaccion" ? "#fff" : "#444",
            border: view === "redaccion" ? "none" : "1px solid #333",
            padding: "3px 10px", fontSize: 10, fontWeight: 700,
            letterSpacing: ".1em", textTransform: "uppercase", cursor: "pointer",
            fontFamily: MONO, whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { if (view !== "redaccion") { e.currentTarget.style.borderColor = "#cc0000"; e.currentTarget.style.color = "#cc0000"; } }}
          onMouseLeave={(e) => { if (view !== "redaccion") { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#444"; } }}>
          ◼ REDACCIÓN
        </button>

        {/* Agent indicator */}
        {view === "chat" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 16 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0,
              background: agentStatus?.enabled ? "#3a9a3a" : "#555",
              transition: "background .3s",
            }} />
            <span style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
              textTransform: "uppercase", fontFamily: MONO }}>
              agentes {agentStatus?.enabled ? "activos" : "detenidos"}
            </span>
            {agentStatus && agentStatus.running.length > 0 && (
              <span style={{ color: "#e8c030", fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
                fontFamily: MONO }}>
                ({agentStatus.running.length} trabajando)
              </span>
            )}
            <button onClick={toggleAgents}
              style={{
                background: "transparent", color: agentStatus?.enabled ? "#e83030" : "#3a9a3a",
                border: `1px solid ${agentStatus?.enabled ? "#e83030" : "#3a9a3a"}`,
                padding: "2px 8px", fontSize: 8, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", cursor: "pointer", fontFamily: MONO,
              }}>
              {agentStatus?.enabled ? "DETENER" : "ACTIVAR"}
            </button>
          </div>
        )}

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
        <div ref={terminalRef} data-testid="terminal-container"
          style={{ flex: 1, padding: "6px 4px", overflow: "hidden" }} />
      </div>

      {/* ════ PORTAL ════ */}
      <div style={{ flex: view === "portal" ? 1 : 0,
        display: view === "portal" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden", minHeight: 0, fontFamily: MONO }}>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "2px solid #1a1a1a", flexShrink: 0 }}>
          {[
            { id: "internacionales" as const, label: "🌍 INTERNACIONALES" },
            { id: "protestas_ar" as const, label: "🇦🇷 PROTESTAS AR" },
          ].map((tab) => (
            <button key={tab.id} onClick={() => setPortalTab(tab.id)}
              style={{
                flex: 1, padding: "10px 0", border: "none", cursor: "pointer",
                background: portalTab === tab.id ? "#cc0000" : "transparent",
                color: portalTab === tab.id ? "#fff" : "#555",
                fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
                textTransform: "uppercase", fontFamily: MONO,
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 14, padding: "6px 12px", borderBottom: "1px solid #1a1a1a",
          flexShrink: 0, fontSize: 9, color: "#555", letterSpacing: ".08em", textTransform: "uppercase" }}>
          <span>🟢 programado</span>
          <span>🟡 en curso</span>
          <span>🔴 finalizado</span>
        </div>

        {/* Table header */}
        <div style={{ display: "flex", padding: "6px 12px", borderBottom: "2px solid #cc0000",
          flexShrink: 0, fontSize: 9, fontWeight: 700, color: "#cc0000",
          letterSpacing: ".1em", textTransform: "uppercase" }}>
          <span style={{ width: 50 }}>HORA</span>
          <span style={{ width: 120 }}>LUGAR</span>
          <span style={{ width: 100 }}>TIPO</span>
          <span style={{ flex: 1 }}>ORGANIZACIONES</span>
          <span style={{ flex: 1 }}>MOTIVO</span>
        </div>

        {/* Table rows */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {portalLoading && <div style={{ textAlign: "center", padding: 20, color: "#555", fontSize: 10 }}>CARGANDO...</div>}
          {!portalLoading && acciones.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#333", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>
              Sin acciones registradas
            </div>
          )}
          {!portalLoading && acciones
            .filter((a) => a.seccion === portalTab)
            .map((a) => {
              const statusColor = a.status === "en_curso" ? "#e8c030" : a.status === "finalizado" ? "#cc0000" : "#3a9a3a";
              return (
                <div key={a.id} onClick={() => openPortalDetail(a)}
                  style={{
                    display: "flex", padding: "8px 12px", borderBottom: "1px solid #141414",
                    cursor: "pointer", fontSize: 11, color: "#ccc", alignItems: "center",
                    transition: "background .1s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#111"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <span style={{ width: 50, color: statusColor, fontWeight: 700 }}>{a.hora}</span>
                  <span style={{ width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#999" }}>
                    {a.bandera} {a.lugar}
                  </span>
                  <span style={{ width: 100, textTransform: "uppercase", fontSize: 9, letterSpacing: ".08em" }}>
                    {a.tipoAccion}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.organizaciones.join(", ")}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#888" }}>
                    {a.motivo}
                  </span>
                </div>
              );
            })}
    </div>
  </div>

  {/* ════ REDACCIÓN ════ */}
  <div style={{ flex: view === "redaccion" ? 1 : 0,
    display: view === "redaccion" ? "flex" : "none",
    flexDirection: "column", overflow: "hidden", minHeight: 0, fontFamily: MONO }}>

    {/* Agent grid */}
    <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
      {redaccionAgentes.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 11 }}>
          Sin agentes. Creá uno o activá los existentes.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {redaccionAgentes.map((ag) => (
          <div key={ag.id} style={{
            background: "#0d0d0d", border: "1px solid #1a1a1a",
            borderLeft: "3px solid #cc0000", padding: 10,
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {/* Name row */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {editingName === ag.id ? (
                <input autoFocus
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  onBlur={() => saveAgentName(ag.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveAgentName(ag.id); }}
                  style={{ flex: 1, background: "#111", border: "1px solid #cc0000", color: "#eee",
                    fontSize: 12, fontWeight: 700, padding: "4px 6px", fontFamily: MONO, outline: "none" }} />
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#eee",
                    letterSpacing: ".04em" }}>{ag.nombre}</span>
                  <button onClick={() => { setEditingName(ag.id); setEditNameValue(ag.nombre); }}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 10 }}>✎</button>
                </>
              )}
            </div>

            {/* Linked agent badge */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {ag.agenteId && (
                <span style={{ fontSize: 8, color: "#666", letterSpacing: ".08em", textTransform: "uppercase",
                  background: "#111", padding: "2px 5px" }}>
                  ⟳ {ag.agenteId}
                </span>
              )}
              {actividadPorAgente[ag.agenteId || ""] && (
                <span style={{ fontSize: 8, color: "#e8c030", letterSpacing: ".04em" }}>
                  {actividadPorAgente[ag.agenteId || ""]}
                </span>
              )}
              <button onClick={() => deleteAgente(ag.id)}
                style={{ marginLeft: "auto", background: "none", border: "none", color: "#e83030", cursor: "pointer", fontSize: 9 }}>
                ×
              </button>
            </div>

            {/* Tasks */}
            <div style={{ fontSize: 10, color: "#888", lineHeight: 1.7 }}>
              {ag.tareas.map((t, ti) => (
                <div key={ti} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ color: "#cc0000" }}>▸</span>
                  {editingTask === `${ag.id}-${ti}` ? (
                    <input autoFocus
                      value={editTaskValue}
                      onChange={(e) => setEditTaskValue(e.target.value)}
                      onBlur={() => saveTask(ag.id, ti)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTask(ag.id, ti); }}
                      style={{ flex: 1, background: "#111", border: "1px solid #444", color: "#ccc",
                        fontSize: 10, padding: "2px 4px", fontFamily: MONO, outline: "none" }} />
                  ) : (
                    <>
                      <span style={{ flex: 1 }}>{t}</span>
                      <button onClick={() => { setEditingTask(`${ag.id}-${ti}`); setEditTaskValue(t); }}
                        style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 8 }}>✎</button>
                      <button onClick={() => deleteTask(ag.id, ti)}
                        style={{ background: "none", border: "none", color: "#e83030", cursor: "pointer", fontSize: 8 }}>×</button>
                    </>
                  )}
                </div>
              ))}
              <button onClick={() => addTask(ag.id)}
                style={{ background: "none", border: "1px dashed #333", color: "#555", cursor: "pointer",
                  fontSize: 9, padding: "2px 8px", marginTop: 4, width: "100%" }}>
                + tarea
              </button>
            </div>

            {/* Activity log for this agent */}
            {ag.agenteId && (
              <div style={{ fontSize: 8, color: "#444", maxHeight: 40, overflowY: "auto",
                borderTop: "1px solid #141414", paddingTop: 4, marginTop: "auto" }}>
                {actividad[ag.agenteId]?.slice(0, 3).map((act, ai) => (
                  <div key={ai} style={{ color: act.type === "error" ? "#e83030" : act.type === "done" ? "#3a9a3a" : "#666" }}>
                    {act.time} {act.msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>

    {/* Jefe Editor chat */}
    <div style={{ borderTop: "2px solid #cc0000", display: "flex", flexDirection: "column",
      maxHeight: 300, minHeight: 200, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 12px",
        background: "#0a0a0a", borderBottom: "1px solid #1a1a1a", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#cc0000", letterSpacing: ".1em",
          textTransform: "uppercase" }}>JEFE EDITOR</span>
        <span style={{ fontSize: 8, color: "#555" }}>consultá sobre cobertura y estrategia</span>
        <button onClick={() => resetJefe()}
          style={{ marginLeft: "auto", background: "none", border: "1px solid #333", color: "#555",
            cursor: "pointer", fontSize: 8, padding: "2px 6px" }}>
          LIMPIAR
        </button>
      </div>
      <div ref={jefeMsgsRef} style={{ flex: 1, overflowY: "auto", padding: 8, fontSize: 11, lineHeight: 1.6 }}>
        {jefeMessages.length === 0 && (
          <div style={{ textAlign: "center", color: "#444", padding: 20, fontSize: 10 }}>
            Consultá al jefe editor sobre la redacción
          </div>
        )}
        {jefeMessages.map((m, i) => (
          <div key={i} style={{
            display: "flex", gap: 6, marginBottom: 8,
            flexDirection: m.role === "user" ? "row-reverse" : "row",
          }}>
            <div style={{
              background: m.role === "user" ? "#cc0000" : "#111",
              border: m.role === "user" ? "none" : "1px solid #222",
              padding: "6px 10px", borderRadius: 4,
              maxWidth: "80%", wordBreak: "break-word",
              color: m.role === "user" ? "#fff" : "#ccc",
              fontFamily: m.role === "user" ? MONO : SANS,
              fontSize: m.role === "user" ? 11 : 12,
            }}>{m.text}</div>
          </div>
        ))}
        {jefeBusy && (
          <div style={{ color: "#666", fontSize: 10, padding: "4px 0" }}>
            <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
              {[0, .25, .5].map((d, j) => (
                <span key={j} style={{ width: 4, height: 4, background: "#cc0000",
                  display: "inline-block", animation: `pulse 1.2s ${d}s infinite` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={jefeEndRef} />
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #1a1a1a", padding: "6px 8px", gap: 6, background: "#0a0a0a" }}>
        <textarea
          value={jefeInput}
          onChange={(e) => setJefeInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void jefeSend(); } }}
          placeholder="consultar al editor..."
          rows={1} disabled={jefeBusy}
          style={{ flex: 1, background: "#0d0d0d", border: "1px solid #1e1e1e",
            color: "#e8e8e8", fontSize: 11, padding: "6px 8px", resize: "none",
            fontFamily: MONO, lineHeight: 1.4, outline: "none", height: 30 }} />
        <button onClick={() => void jefeSend()} disabled={jefeBusy || !jefeInput.trim()}
          style={{
            background: jefeBusy || !jefeInput.trim() ? "#111" : "#cc0000",
            color: jefeBusy || !jefeInput.trim() ? "#333" : "#fff",
            border: "none", cursor: jefeBusy || !jefeInput.trim() ? "not-allowed" : "pointer",
            padding: "0 12px", fontSize: 10, fontWeight: 700, fontFamily: MONO,
          }}>→</button>
      </div>
    </div>
  </div>

  {/* ════ CHAT ════ */}
      <div style={{ flex: view === "chat" ? 1 : 0,
        display: view === "chat" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

        {/* Messages */}
        <div ref={chatMsgsRef} style={{ flex: 1, overflowY: "auto", padding: "20px 0 8px",
          display: "flex", flexDirection: "column", fontFamily: SANS }}>
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

        {/* Activity feed */}
        {activityLog.length > 0 && (
          <div style={{ borderTop: "1px solid #1a1a1a", flexShrink: 0 }}>
            <button onClick={() => setActivityOpen(!activityOpen)}
              style={{
                width: "100%", background: "#0a0a0a", border: "none", cursor: "pointer",
                padding: "6px 16px", display: "flex", alignItems: "center", gap: 8,
                color: "#555", fontFamily: MONO, fontSize: 9, fontWeight: 700,
                letterSpacing: ".1em", textTransform: "uppercase",
              }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%",
                background: activityLog.some(a => a.type === "tool") ? "#e8c030" : "#555" }} />
              actividad — {activityLog.filter(a => a.type === "tool" || a.type === "step").length} eventos
              <span style={{ marginLeft: "auto" }}>{activityOpen ? "▾" : "▸"}</span>
            </button>
            {activityOpen && (
              <div style={{ maxHeight: 140, overflowY: "auto", background: "#080808",
                padding: "4px 0", fontFamily: MONO, fontSize: 10, lineHeight: 1.6 }}>
                {activityLog.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 8, padding: "2px 16px",
                    color: a.type === "error" ? "#e83030" : a.type === "done" ? "#3a9a3a" : "#888",
                  }}>
                    <span style={{ color: "#444", width: 50, flexShrink: 0 }}>{a.time}</span>
                    <span style={{ color: "#666", width: 80, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.agentLabel}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

      {/* ════ VOZ ════ */}
      <div style={{ flex: view === "voz" ? 1 : 0,
        display: view === "voz" ? "flex" : "none",
        flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: voiceMessages.length === 0 ? "center" : undefined,
          overflow: "hidden", padding: "20px 16px" }}>

          {voiceMessages.length > 0 && (
            <div style={{ flex: 1, overflowY: "auto", width: "100%", maxWidth: 700 }}>
              {voiceMessages.map((m, i) => (
                <div key={i} style={{
                  display: "flex", gap: 8, marginBottom: 12,
                  flexDirection: m.role === "user" ? "row-reverse" : "row",
                }}>
                  <div style={{ color: m.role === "user" ? "#cc0000" : "#666",
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                    minWidth: 20, textAlign: "center" }}>
                    {m.role === "user" ? "U" : "A"}
                  </div>
                  <div style={{
                    background: m.role === "user" ? "#1a0000" : "#111",
                    border: m.role === "bot" ? "1px solid #1a1a1a" : "none",
                    borderLeft: m.role === "bot" ? "3px solid #cc0000" : undefined,
                    padding: "8px 12px", borderRadius: 4,
                    color: m.role === "user" ? "#cc0000" : "#d0d0d0",
                    fontSize: 13, lineHeight: 1.6, fontFamily: MONO,
                    maxWidth: "80%", wordBreak: "break-word",
                  }}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={voiceMessagesEndRef} />
            </div>
          )}

          {voiceMessages.length === 0 && !voiceActive && (
            <div style={{ textAlign: "center" }}>
              <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 16px" }}>
                <div style={{ position: "absolute", inset: 0, border: "3px solid #cc0000" }} />
                <div style={{ position: "absolute", top: 8, left: 8, right: 8, bottom: 8,
                  background: "#cc0000", display: "grid", placeItems: "center" }}>
                  <span style={{ color: "#fff", fontSize: 26, fontWeight: 900 }}>♪</span>
                </div>
              </div>
              <p style={{ color: "#2a2a2a", fontSize: 10, fontWeight: 700,
                letterSpacing: ".18em", textTransform: "uppercase", fontFamily: MONO }}>
                Presiona INICIAR para conversar por voz
              </p>
            </div>
          )}

          {voiceMessages.length === 0 && voiceActive && (
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "#555", fontSize: 11, fontWeight: 700,
                letterSpacing: ".12em", textTransform: "uppercase", fontFamily: MONO }}>
                {voiceStatus}
              </p>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div style={{ borderTop: "2px solid #cc0000", padding: "16px",
          background: "#0a0a0a", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 10, flexShrink: 0 }}>
          {voiceActive && (
            <span style={{ color: "#555", fontSize: 10, fontWeight: 700,
              letterSpacing: ".12em", fontFamily: MONO }}>
              {voiceStatus}
            </span>
          )}
          <button onClick={voiceActive ? stopVoice : startVoice}
            style={{
              background: voiceActive ? "transparent" : "#cc0000",
              color: voiceActive ? "#cc0000" : "#fff",
              border: voiceActive ? "2px solid #cc0000" : "none",
              cursor: "pointer", padding: "12px 40px",
              fontSize: 13, fontWeight: 700, letterSpacing: ".15em",
              fontFamily: MONO, textTransform: "uppercase",
              transition: "all .15s",
            }}>
            {voiceActive ? "■ DETENER" : "● INICIAR"}
          </button>
        </div>
      </div>

      {/* ════ MODAL ════ */}
      {modalOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,.85)", display: "flex",
          flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: 20, fontFamily: MONO,
        }} onClick={() => setModalOpen(false)}>
          <div style={{
            background: "#111", border: "2px solid #cc0000",
            maxWidth: 900, width: "100%", maxHeight: "90vh",
            display: "flex", flexDirection: "column",
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "12px 16px",
              borderBottom: "1px solid #1a1a1a", flexShrink: 0,
            }}>
              <span style={{ color: "#cc0000", fontWeight: 700, fontSize: 11,
                letterSpacing: ".12em", textTransform: "uppercase" }}>
                {modalTitle || "FUENTE"}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a href={modalUrl} target="_blank" rel="noopener"
                  style={{
                    background: "#cc0000", color: "#fff", border: "none",
                    padding: "6px 12px", cursor: "pointer", fontSize: 10,
                    fontWeight: 700, letterSpacing: ".1em",
                    textTransform: "uppercase", textDecoration: "none",
                  }}>
                  ABRIR ORIGINAL
                </a>
                <button onClick={() => setModalOpen(false)}
                  style={{ background: "none", border: "none", color: "#555",
                    cursor: "pointer", fontSize: 18 }}>
                  ✕
                </button>
              </div>
            </div>
            {/* Content */}
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              {modalLoading && (
                <div style={{ display: "grid", placeItems: "center",
                  height: 300, color: "#666", fontSize: 12,
                  letterSpacing: ".1em", textTransform: "uppercase" }}>
                  Cargando contenido...
                </div>
              )}
              {!modalLoading && modalError && (
                <div style={{ padding: 32, textAlign: "center" }}>
                  <p style={{ color: "#e83030", fontSize: 12, marginBottom: 12 }}>
                    {modalError}
                  </p>
                  <a href={modalUrl} target="_blank" rel="noopener"
                    style={{ color: "#4a9eff", fontSize: 11, textDecoration: "underline" }}>
                    Abrir directamente en nueva pestaña →
                  </a>
                </div>
              )}
              {!modalLoading && !modalError && modalHtml && (
                <div style={{ background: "#fff", color: "#111",
                  fontSize: 14, lineHeight: 1.7 }}
                  dangerouslySetInnerHTML={{ __html: modalHtml }} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════ HISTORY MODAL ════ */}
      {historyOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: "rgba(0,0,0,.85)", display: "flex",
          flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: 20, fontFamily: MONO,
        }} onClick={() => setHistoryOpen(false)}>
          <div style={{
            background: "#111", border: "2px solid #cc0000",
            maxWidth: 600, width: "100%", maxHeight: "80vh",
            display: "flex", flexDirection: "column",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "12px 16px",
              borderBottom: "1px solid #1a1a1a", flexShrink: 0,
            }}>
              <span style={{ color: "#cc0000", fontWeight: 700, fontSize: 11,
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
                      background: "#cc0000", color: "#fff", border: "none",
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

      {/* ════ PORTAL DETAIL MODAL ════ */}
      {portalDetailOpen && selectedAccion && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,.85)", display: "flex",
          flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: 20, fontFamily: MONO,
        }} onClick={() => setPortalDetailOpen(false)}>
          <div style={{
            background: "#111", border: "2px solid #cc0000",
            maxWidth: 700, width: "100%", maxHeight: "90vh",
            display: "flex", flexDirection: "column",
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "12px 16px",
              borderBottom: "1px solid #1a1a1a", flexShrink: 0,
            }}>
              <span style={{ color: "#cc0000", fontWeight: 700, fontSize: 11,
                letterSpacing: ".12em", textTransform: "uppercase" }}>
                {selectedAccion.bandera} {selectedAccion.lugar}
              </span>
              <button onClick={() => setPortalDetailOpen(false)}
                style={{ background: "none", border: "none", color: "#555",
                  cursor: "pointer", fontSize: 18 }}>
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {/* Detail grid */}
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 12px", fontSize: 12 }}>
                <span style={{ color: "#555", textTransform: "uppercase", letterSpacing: ".08em" }}>Hora</span>
                <span style={{ color: "#d0d0d0" }}>{selectedAccion.hora} hs</span>
                <span style={{ color: "#555", textTransform: "uppercase", letterSpacing: ".08em" }}>Fecha</span>
                <span style={{ color: "#d0d0d0" }}>{selectedAccion.fecha}</span>
                <span style={{ color: "#555", textTransform: "uppercase", letterSpacing: ".08em" }}>Lugar</span>
                <span style={{ color: "#d0d0d0" }}>{selectedAccion.pais} — {selectedAccion.lugar}</span>
                <span style={{ color: "#555", textTransform: "uppercase", letterSpacing: ".08em" }}>Tipo</span>
                <span style={{ color: "#d0d0d0", textTransform: "uppercase", fontSize: 10 }}>{selectedAccion.tipoAccion}</span>
                <span style={{ color: "#555", textTransform: "uppercase", letterSpacing: ".08em" }}>Status</span>
                <span style={{
                  color: selectedAccion.status === "en_curso" ? "#e8c030" : selectedAccion.status === "finalizado" ? "#cc0000" : "#3a9a3a",
                  textTransform: "uppercase", fontSize: 10, fontWeight: 700,
                }}>
                  {selectedAccion.status === "en_curso" ? "🟡 EN CURSO" : selectedAccion.status === "finalizado" ? "🔴 FINALIZADO" : "🟢 PROGRAMADO"}
                </span>
                <span style={{ color: "#555", textTransform: "uppercase", letterSpacing: ".08em" }}>Organizaciones</span>
                <span style={{ color: "#d0d0d0" }}>{selectedAccion.organizaciones.join(", ") || "—"}</span>
                <span style={{ color: "#555", textTransform: "uppercase", letterSpacing: ".08em" }}>Motivo</span>
                <span style={{ color: "#d0d0d0" }}>{selectedAccion.motivo}</span>
              </div>

              {/* Fuentes */}
              {selectedAccion.fuentes.length > 0 && (
                <div style={{ marginTop: 16, borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
                  <div style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: ".12em",
                    textTransform: "uppercase", marginBottom: 8 }}>Fuentes</div>
                  {selectedAccion.fuentes.map((f, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <a href="#!" onClick={(e) => { e.preventDefault(); setModalUrl(f.url); setModalTitle(f.nombre); setModalOpen(true); }}
                        style={{ color: "#4a9eff", fontSize: 11, textDecoration: "underline", cursor: "pointer" }}>
                        {f.nombre || f.url}
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {/* Map */}
              {selectedAccion.lat && selectedAccion.lng && (
                <div style={{ marginTop: 16, borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
                  <div style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: ".12em",
                    textTransform: "uppercase", marginBottom: 8 }}>Mapa</div>
                  <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden" }}>
                    <iframe
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(selectedAccion.lng) - 0.1},${Number(selectedAccion.lat) - 0.1},${Number(selectedAccion.lng) + 0.1},${Number(selectedAccion.lat) + 0.1}&layer=mapnik&marker=${selectedAccion.lat},${selectedAccion.lng}`}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "1px solid #1a1a1a" }}
                      loading="lazy" />
                  </div>
                </div>
              )}

              {/* Related news */}
              <div style={{ marginTop: 16, borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
                <div style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: ".12em",
                  textTransform: "uppercase", marginBottom: 8 }}>
                  Últimas noticias
                </div>
                {portalNoticiasLoading && (
                  <div style={{ color: "#555", fontSize: 10, textTransform: "uppercase" }}>Cargando...</div>
                )}
                {!portalNoticiasLoading && portalNoticias.length === 0 && (
                  <div style={{ color: "#333", fontSize: 10, textTransform: "uppercase" }}>Sin noticias relacionadas</div>
                )}
                {!portalNoticiasLoading && portalNoticias.map((n, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <a href="#!" onClick={(e) => { e.preventDefault(); setModalUrl(n.url); setModalTitle(n.fuente); setModalOpen(true); }}
                      style={{ color: "#4a9eff", fontSize: 11, textDecoration: "underline", cursor: "pointer", display: "block" }}>
                      {n.titular}
                    </a>
                    <span style={{ color: "#555", fontSize: 9, letterSpacing: ".08em" }}>{n.fuente}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{STYLES}</style>
    </div>
  );
}
