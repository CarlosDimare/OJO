import { Router } from "express";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { Request, Response } from "express";
import { store } from "../lib/store";

// Prefer the local node_modules binary so it works in production deployments too
const __dir = dirname(fileURLToPath(import.meta.url));
const LOCAL_BIN = resolve(__dir, "../../node_modules/.bin/opencode");
const OPENCODE = existsSync(LOCAL_BIN) ? LOCAL_BIN : "opencode";

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

  if (!message?.trim()) {
    res.status(400).json({ error: "empty message" });
    return;
  }

  const isNewSession = !session_id;
  const fullMessage = buildMessage(message.trim(), isNewSession, charla_mode === true);

  /* ── Save / resolve conversation ── */
  let convId = conversation_id ? Number(conversation_id) : null;
  if (!convId) {
    const conv = store.createConversation(message.trim().slice(0, 60), session_id || null);
    convId = conv.id;
  } else {
    store.updateConversation(convId, { updatedAt: new Date() });
  }
  store.createMessage(convId, "user", message.trim());

  const args = ["run", "--format", "json"];
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

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(OPENCODE, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err: unknown) {
    res.write(sse({ type: "error", message: "opencode not found: " + String(err) }));
    res.end();
    return;
  }

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
        // Persist the opencode session ID so loaded conversations resume with full context
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

      // Only emit text events — skip tool_use noise
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
    if (code !== 0 && stderrBuf.trim()) {
      res.write(sse({ type: "error", message: stderrBuf.trim().slice(0, 400) }));
    }
    // Save bot response
    if (botContent.trim()) {
      store.createMessage(convId!, "bot", botContent.trim());
    }
    res.write(sse({ type: "done" }));
    res.end();
  });

  proc.on("error", (err: Error) => {
    res.write(sse({ type: "error", message: err.message }));
    res.end();
  });

  res.on("close", () => { try { proc.kill(); } catch {} });
});

export default router;
