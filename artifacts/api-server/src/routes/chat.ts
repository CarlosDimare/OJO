import { Router } from "express";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { Request, Response } from "express";
import { store } from "../lib/store";
import { logger } from "../lib/logger";

// Resolve opencode binary (only needed to start serve)
const __dir = dirname(fileURLToPath(import.meta.url));
const BIN = process.platform === "win32" ? "opencode.CMD" : "opencode";
const CANDIDATES = [
  resolve(__dir, `../../node_modules/.bin/${BIN}`),
  resolve(__dir, `../node_modules/.bin/${BIN}`),
  resolve(__dir, `../../../node_modules/.bin/${BIN}`),
  resolve(__dir, `../../../../node_modules/.bin/${BIN}`),
  "/usr/local/bin/opencode",
];
const OPENCODE = CANDIDATES.find(existsSync) || "opencode";
logger.info({ opencode: OPENCODE }, "chat route initialized");

const OPENCODE_TIMEOUT_MS = 300_000;
const SERVE_PASSWORD = "ojo-serve-local";

/* ── opencode serve lifecycle ── */

// Strip opencode session env vars so the child serve doesn't get confused
function stripOpenCodeEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (key === "OPENCODE" || (key.startsWith("OPENCODE_") && key !== "OPENCODE_SERVER_PASSWORD")) delete out[key];
  }
  return out;
}

let serveProc: any = null;
let serveReady = false;
let serveUrl = "";
let serveReadyPromise: Promise<void> | null = null;

export async function initServe(): Promise<void> {
  if (serveReady) return;
  if (serveReadyPromise) return serveReadyPromise;

  serveReadyPromise = new Promise<void>((resolve, reject) => {
    logger.info("starting opencode serve (random port)");
    try {
      const isWin = process.platform === "win32";
      const spawnArgs = isWin ? { cmd: "cmd.exe", args: ["/c", OPENCODE, "serve", "--port", "0", "--print-logs"] } : { cmd: OPENCODE, args: ["serve", "--port", "0", "--print-logs"] };
      const proc = spawn(spawnArgs.cmd, spawnArgs.args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...stripOpenCodeEnv(process.env), OPENCODE_SERVER_PASSWORD: SERVE_PASSWORD },
      });
      serveProc = proc;

      let stderrBuf = "";
      proc.stderr!.setEncoding("utf8");
      proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

      proc.stdout!.setEncoding("utf8");
      proc.stdout!.on("data", (d: string) => {
        if (!serveReady && d.includes("listening on")) {
          const match = d.match(/https?:\/\/[^\s]+/);
          if (match) serveUrl = match[0];
          else serveUrl = `http://127.0.0.1:4200`;
          serveReady = true;
          logger.info({ serveUrl }, "opencode serve ready");
          resolve();
        }
      });

      proc.on("error", (err: Error) => {
        logger.error({ err }, "opencode serve process error");
        serveProc = null; serveReady = false;
        reject(err);
      });

      proc.on("exit", (code: number | null) => {
        const wasReady = serveReady;
        logger.warn({ code, stderr: stderrBuf.slice(0, 300) }, "opencode serve exited");
        serveProc = null; serveReady = false; serveReadyPromise = null; serveUrl = "";
        if (!wasReady) reject(new Error(`serve exited (${code}): ${stderrBuf.slice(0, 200)}`));
        else setTimeout(() => { void initServe(); }, 1500);
      });

      setTimeout(() => {
        if (!serveReady) { reject(new Error("serve startup timeout")); }
      }, 20_000);
    } catch (err) {
      logger.error({ err }, "failed to spawn opencode serve");
      reject(err);
    }
  });

  return serveReadyPromise;
}

export function stopServe(): void {
  if (serveProc) {
    logger.info("stopping opencode serve");
    serveProc.kill();
    serveProc = null; serveReady = false; serveReadyPromise = null; serveUrl = "";
  }
}

// Start serve in background at import time
void initServe();

const router = Router();

const SYSTEM_PROMPT = `Sos un asistente periodista con perspectiva de clase. Reglas estrictas:
- Siempre lo más breve posible. Sin rodeos.
- No declarar: analizar y comunicar.
- Datos chequeados. Énfasis en cifras, números, nombres propios, fechas, porcentajes.
- Usar markdown: negrita para datos clave, listas para enumerar, encabezados solo si son necesarios.
- Para datos clave (cifras, indicadores) usar este bloque:
  ::: cifra
  **Indicador**: valor
  :::
- Separar secciones con ---
- Para incluir imágenes: ![descripción](url-imagen) — solo si tenés la URL exacta y real. La imagen debe estar en su propia línea.
- Para incluir videos: @[YouTube](url-del-video) — solo si tenés la URL exacta y real.
- Citar fuentes usando links markdown: [Nombre fuente](url)
- Si no tenés la URL exacta, citar así: [Nombre fuente — fecha]
- Ser consciente de la fecha y hora actual (se indica en cada mensaje).
- Sin frases de relleno, sin introducción, ir directo al análisis.`;

const SYSTEM_PROMPT_CHARLA = `Sos un interlocutor con perspectiva de clase. Modo conversación informal. Reglas:
- Extremadamente breve. Máximo 3 oraciones por respuesta salvo que sea imprescindible más.
- Nada de introducciones, aclaraciones, ni frases de cortesía.
- Perspectiva de clase siempre presente pero sin sermón. Se nota en el enfoque, no en el discurso.
- Humor sutil, inteligente, estilo Les Luthiers: el remate aparece donde menos se lo espera, nunca forzado, nunca explicado.
- Si algo es obvio, no lo digas. Si algo es absurdo, señalalo con una sola palabra o una coma.
- Podés usar markdown mínimo: **negrita** para énfasis, nada más.
- No uses listas, no uses títulos, no uses citas formales.
- Hablá como alguien que sabe mucho y tiene poco tiempo.`;

function sse(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function buildMessage(message: string, _isNewSession: boolean, charlaMode: boolean): string {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "full",
    timeStyle: "short",
  });
  const prompt = charlaMode ? SYSTEM_PROMPT_CHARLA : SYSTEM_PROMPT;
  return `[INSTRUCCIONES DEL SISTEMA]\n${prompt}\n\nFecha y hora actual: ${now}\n\n[PREGUNTA DEL USUARIO]\n${message}`;
}

const AUTH_BASIC = Buffer.from(`opencode:${SERVE_PASSWORD}`).toString("base64");
const AUTH_HEADER = { Authorization: `Basic ${AUTH_BASIC}` };

const TOOL_LABELS: Record<string, string> = {
  websearch: "🔍 Investigando...",
  webfetch: "🌐 Analizando fuentes...",
  read: "📄 Leyendo documentos...",
  read_file: "📄 Leyendo documentos...",
  write_file: "✍️ Redactando...",
  edit: "✍️ Redactando...",
  bash: "⚙️ Ejecutando...",
  glob: "🔎 Buscando archivos...",
  grep: "🔎 Buscando en código...",
};

router.post("/chat", async (req: Request, res: Response) => {
  const { message, session_id, conversation_id, charla_mode } = req.body as {
    message?: string;
    session_id?: string;
    conversation_id?: number;
    charla_mode?: boolean;
  };

  const log = logger.child({ session_id, conversation_id, charla_mode });
  log.info({ msgLen: message?.length }, "POST /chat received");

  if (!message?.trim()) {
    res.status(400).json({ error: "empty message" });
    return;
  }

  const isNewSession = !session_id;
  const fullMessage = buildMessage(message.trim(), isNewSession, charla_mode === true);

  /* ── Save / resolve conversation ── */
  let convId = conversation_id ? Number(conversation_id) : null;
  if (!convId) {
    const conv = store.createConversation(message.trim().slice(0, 60), session_id || null, charla_mode === true);
    convId = conv.id;
  } else {
    store.updateConversation(convId, { updatedAt: new Date() });
  }
  store.createMessage(convId, "user", message.trim());

  /* ── Ensure opencode serve is ready ── */
  try {
    await initServe();
  } catch (err) {
    log.error({ err }, "opencode serve unavailable");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(sse({ type: "error", message: "opencode serve unavailable: " + String(err) }));
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(sse({ type: "conversation", conversation_id: convId }));

  /* ── Call opencode serve REST API with real-time SSE streaming ── */
  let currentSid = session_id || "";
  const startTime = Date.now();
  let botContent = "";

  try {
    // Create session if new
    if (!currentSid) {
      const createRes = await fetch(`${serveUrl}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADER },
        body: "{}",
      });
      if (!createRes.ok) {
        throw new Error(`session create failed: ${createRes.status}`);
      }
      const sessionData = await createRes.json() as Record<string, unknown>;
      currentSid = sessionData.id as string;
      res.write(sse({ type: "session", session_id: currentSid }));
      if (convId) {
        store.updateConversation(convId, { sessionId: currentSid });
      }
    }

    // Connect to opencode event stream (SSE)
    const ac = new AbortController();
    const eventResp = await fetch(`${serveUrl}/event`, {
      headers: AUTH_HEADER,
      signal: ac.signal,
    });
    if (!eventResp.ok || !eventResp.body) {
      throw new Error(`event stream connect failed: ${eventResp.status}`);
    }

    // Send async message (non-blocking, returns 204 immediately)
    const promptResp = await fetch(`${serveUrl}/session/${currentSid}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADER },
      body: JSON.stringify({
        parts: [{ type: "text", text: fullMessage }],
      }),
    });
    if (!promptResp.ok) {
      ac.abort();
      throw new Error(`prompt_async failed: ${promptResp.status}`);
    }

    // Read events from SSE stream, forwarding to frontend in real-time
    const reader = eventResp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let assistantMsgIds = new Set<string>();
    let partTextIds = new Set<string>();
    let partTextLen = new Map<string, number>();
    let sessionDone = false;
    const timeoutId = setTimeout(() => ac.abort(), OPENCODE_TIMEOUT_MS);

    try {
      while (!sessionDone) {
        const { value, done } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          const props = evt.properties as Record<string, unknown> | undefined;
          if (!props || props.sessionID !== currentSid) continue;

          switch (evt.type) {
            case "message.updated": {
              const info = props.info as Record<string, unknown> | undefined;
              if (info && (info.role as string) === "assistant") {
                assistantMsgIds.add(info.id as string);
              }
              break;
            }
            case "message.part.updated": {
              const part = props.part as Record<string, unknown>;
              const msgId = part.messageID as string;
              if (!assistantMsgIds.has(msgId)) break;

              const pId = part.id as string;
              const pType = part.type as string;

              if (pType === "reasoning") {
                res.write(sse({ type: "status", status: "🧠 Razonando..." }));
              } else if (pType === "tool" || pType === "tool-call") {
                const tool = part.tool as string;
                const label = TOOL_LABELS[tool] || "🔄 Procesando...";
                res.write(sse({ type: "status", status: label }));
              } else if (pType === "text") {
                partTextIds.add(pId);
                const text = (part.text as string) || "";
                if (text) {
                  const prevLen = partTextLen.get(pId) || 0;
                  if (text.length > prevLen) {
                    const newText = text.slice(prevLen);
                    botContent += newText;
                    res.write(sse({ type: "text", text: newText }));
                    partTextLen.set(pId, text.length);
                  }
                }
              }
              break;
            }
            case "message.part.delta": {
              const msgId = props.messageID as string;
              if (!assistantMsgIds.has(msgId)) break;

              const pId = props.partID as string;
              if (partTextIds.has(pId) && props.field === "text") {
                const delta = props.delta as string;
                if (delta) {
                  botContent += delta;
                  res.write(sse({ type: "text", text: delta }));
                  const prevLen = partTextLen.get(pId) || 0;
                  partTextLen.set(pId, prevLen + delta.length);
                }
              }
              break;
            }
            case "session.status": {
              const status = props.status as Record<string, string>;
              if (status.type === "idle") {
                sessionDone = true;
              }
              break;
            }
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      ac.abort();
    }

    const elapsed = Date.now() - startTime;
    log.info({ elapsed, botLen: botContent.length }, "opencode serve response received");

    if (botContent.trim()) {
      store.createMessage(convId!, "bot", botContent.trim());
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "AbortError") {
      log.warn({ err }, "opencode serve request timed out");
    } else {
      log.error({ err }, "opencode serve request failed");
    }
    if (botContent.trim()) {
      store.createMessage(convId!, "bot", botContent.trim());
    }
    res.write(sse({ type: "error", message: msg }));
  }

  res.write(sse({ type: "done" }));
  res.end();
});

export default router;
