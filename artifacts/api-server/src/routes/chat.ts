import { Router } from "express";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { Request, Response } from "express";
import { db, conversationsTable, messagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
- Para incluir imágenes: ![descripción](url-imagen) — incluir al menos UNA imagen relevante al tema usando formato markdown. La imagen debe estar en su propia línea.
- Para incluir videos: @[YouTube](url-del-video)
- Citar fuentes usando links markdown: [Nombre fuente](url)
- Si no tenés la URL exacta, citar así: [Nombre fuente — fecha]
- Ser consciente de la fecha y hora actual (se indica en cada mensaje).
- Sin frases de relleno, sin introducción, ir directo al análisis.`;

function sse(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function buildMessage(message: string, isNewSession: boolean): string {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "full",
    timeStyle: "short",
  });
  if (isNewSession) {
    return `[INSTRUCCIONES DEL SISTEMA]\n${SYSTEM_PROMPT}\n\nFecha y hora actual: ${now}\n\n[PREGUNTA DEL USUARIO]\n${message}`;
  }
  return `[Fecha y hora actual: ${now}]\n\n${message}`;
}

router.post("/chat", async (req: Request, res: Response) => {
  const { message, session_id, conversation_id } = req.body as {
    message?: string;
    session_id?: string;
    conversation_id?: number;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "empty message" });
    return;
  }

  const isNewSession = !session_id;
  const fullMessage = buildMessage(message.trim(), isNewSession);

  /* ── DB: save / resolve conversation ── */
  let convId = conversation_id ? Number(conversation_id) : null;
  try {
    if (!convId) {
      const [conv] = await db
        .insert(conversationsTable)
        .values({ title: message.trim().slice(0, 60), sessionId: session_id || null })
        .returning({ id: conversationsTable.id });
      convId = conv.id;
    } else {
      await db
        .update(conversationsTable)
        .set({ updatedAt: new Date() })
        .where(eq(conversationsTable.id, convId));
    }
    await db
      .insert(messagesTable)
      .values({ conversationId: convId, role: "user", content: message.trim() });
  } catch (err) {
    res.status(500).json({ error: "DB error: " + String(err) });
    return;
  }

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
        res.write(sse({ type: "session", session_id: event["sessionID"] }));
        sessionSent = true;
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
    // Save bot response to DB
    if (botContent.trim()) {
      try {
        await db
          .insert(messagesTable)
          .values({ conversationId: convId!, role: "bot", content: botContent.trim() });
      } catch {}
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
