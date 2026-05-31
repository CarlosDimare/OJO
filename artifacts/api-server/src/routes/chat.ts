import { Router } from "express";
import { spawn, type ChildProcess } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { Request, Response } from "express";
import { store } from "../lib/store";
import { logger } from "../lib/logger";

// Resolve opencode binary
const __dir = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  resolve(__dir, "../../node_modules/.bin/opencode"),
  resolve(__dir, "../node_modules/.bin/opencode"),
  resolve(__dir, "../../../node_modules/.bin/opencode"),
  resolve(__dir, "../../../../node_modules/.bin/opencode"),
  "/usr/local/bin/opencode",
];
const OPENCODE = CANDIDATES.find(existsSync) || "opencode";
logger.info({ opencode: OPENCODE }, "chat route initialized");

const OPENCODE_TIMEOUT_MS = 120_000;
const SERVE_PORT = 4200;
const SERVE_PASSWORD = "ojo-serve-local";

/* ── opencode serve lifecycle ── */

let serveProc: ChildProcess | null = null;
let serveUrl: string | null = null;
let serveReadyPromise: Promise<void> | null = null;
let serveStarting = false;

export async function initServe(): Promise<void> {
  if (serveUrl) return;
  if (serveReadyPromise) return serveReadyPromise;

  serveStarting = true;
  serveReadyPromise = new Promise<void>((resolve, reject) => {
    logger.info({ port: SERVE_PORT }, "starting opencode serve");
    try {
      const proc = spawn(OPENCODE, ["serve", "--port", String(SERVE_PORT), "--print-logs"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: SERVE_PASSWORD },
      });
      serveProc = proc;

      let stderrBuf = "";
      proc.stderr!.setEncoding("utf8");
      proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

      proc.stdout!.setEncoding("utf8");
      proc.stdout!.on("data", (d: string) => {
        if (!serveUrl && d.includes("listening on")) {
          serveUrl = `http://127.0.0.1:${SERVE_PORT}`;
          logger.info({ serveUrl }, "opencode serve ready");
          resolve();
        }
      });

      proc.on("error", (err) => {
        logger.error({ err }, "opencode serve process error");
        serveProc = null; serveStarting = false;
        reject(err);
      });

      proc.on("exit", (code) => {
        const wasReady = !!serveUrl;
        logger.warn({ code, stderr: stderrBuf.slice(0, 300) }, "opencode serve exited");
        serveProc = null; serveUrl = null; serveReadyPromise = null; serveStarting = false;
        if (!wasReady) reject(new Error(`serve exited (${code}): ${stderrBuf.slice(0, 200)}`));
        // Auto-restart after a short delay
        else setTimeout(() => { void initServe(); }, 1500);
      });

      setTimeout(() => {
        if (!serveUrl) { serveStarting = false; reject(new Error("serve startup timeout")); }
      }, 20_000);
    } catch (err) {
      serveStarting = false;
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
    serveProc = null; serveUrl = null; serveReadyPromise = null; serveStarting = false;
  }
}

// Start serve in background at import time; first request will await it if needed
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

function buildMessage(message: string, isNewSession: boolean, charlaMode: boolean): string {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "full",
    timeStyle: "short",
  });
  const prompt = charlaMode ? SYSTEM_PROMPT_CHARLA : SYSTEM_PROMPT;
  if (isNewSession) {
    return `[INSTRUCCIONES DEL SISTEMA]\n${prompt}\n\nFecha y hora actual: ${now}\n\n[PREGUNTA DEL USUARIO]\n${message}`;
  }
  return `[Fecha y hora actual: ${now}]\n\n${message}`;
}

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
  let attachUrl: string;
  try {
    await initServe();
    attachUrl = serveUrl!;
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

  const args = ["run", "--attach", attachUrl, "--password", SERVE_PASSWORD, "--format", "json"];
  if (session_id) args.push("--session", session_id);
  args.push(fullMessage);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send conversation_id so frontend can track it
  res.write(sse({ type: "conversation", conversation_id: convId }));

  /* ── Spawn opencode ── */
  let proc: ReturnType<typeof spawn>;
  const startTime = Date.now();
  log.info({ opencode: OPENCODE, args }, "spawning opencode");

  try {
    proc = spawn(OPENCODE, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  } catch (err: unknown) {
    log.error({ err }, "failed to spawn opencode");
    res.write(sse({ type: "error", message: "opencode not found: " + String(err) }));
    res.end();
    return;
  }

  /* ── Process timeout ── */
  const killTimer = setTimeout(() => {
    log.warn("opencode process timed out, killing");
    try { proc.kill(9); } catch {}
  }, OPENCODE_TIMEOUT_MS);

  let sessionSent = false;
  let botContent = "";

  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; }
      catch { continue; }

      const evType = event["type"] as string;

      if (!sessionSent && event["sessionID"]) {
        const sid = event["sessionID"] as string;
        res.write(sse({ type: "session", session_id: sid }));
        sessionSent = true;
        if (convId) {
          store.updateConversation(convId, { sessionId: sid });
        }
      }

      if (evType === "step_start") {
        res.write(sse({ type: "status", status: "..." }));
        continue;
      }

      if (evType === "tool_use") {
        const part = (event["part"] ?? {}) as Record<string, unknown>;
        const tool = (part["tool"] as string) || "";
        const label: Record<string, string> = {
          websearch: "Investigando...",
          webfetch: "Analizando fuentes...",
          read: "Leyendo documentos...",
          read_file: "Leyendo documentos...",
          write_file: "Redactando...",
          edit: "Redactando...",
          bash: "Ejecutando...",
        };
        res.write(sse({ type: "status", status: label[tool] || "Procesando..." }));
        continue;
      }

      const part = (event["part"] ?? {}) as Record<string, unknown>;

      if (evType === "text" && part["type"] === "text" && part["text"]) {
        const text = part["text"] as string;
        botContent += text;
        res.write(sse({ type: "text", text }));
      }
    }
  });

  let stderrBuf = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

  proc.on("close", async (code: number | null) => {
    clearTimeout(killTimer);
    const elapsed = Date.now() - startTime;
    log.info({ code, elapsed, botLen: botContent.length, stderr: stderrBuf.slice(0, 200) }, "opencode closed");
    if (code !== 0 && stderrBuf.trim()) {
      res.write(sse({ type: "error", message: stderrBuf.trim().slice(0, 400) }));
    }
    if (botContent.trim()) {
      store.createMessage(convId!, "bot", botContent.trim());
    }
    res.write(sse({ type: "done" }));
    res.end();
  });

  proc.on("error", (err: Error) => {
    clearTimeout(killTimer);
    log.error({ err }, "opencode process error");
    res.write(sse({ type: "error", message: err.message }));
    res.end();
  });

  res.on("close", () => {
    clearTimeout(killTimer);
    try { proc.kill(); } catch {}
  });
});

export default router;
