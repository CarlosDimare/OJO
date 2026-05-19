import { Router } from "express";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { Request, Response } from "express";

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
- Citar fuentes al final usando este formato exacto: <small>[Nombre fuente](url)</small>
- Si no tenés la URL exacta, citar así: <small>Nombre fuente — fecha</small>
- Ser consciente de la fecha y hora actual (se indica en cada mensaje).
- Perspectiva de clase: jerarquizar quién gana y quién pierde en cada hecho.
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

router.post("/chat", (req: Request, res: Response) => {
  const { message, session_id } = req.body as {
    message?: string;
    session_id?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "empty message" });
    return;
  }

  const isNewSession = !session_id;
  const fullMessage = buildMessage(message.trim(), isNewSession);

  const args = ["run", "--format", "json"];
  if (session_id) args.push("--session", session_id);
  args.push(fullMessage);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(OPENCODE, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err: unknown) {
    res.write(sse({ type: "error", message: "opencode not found: " + String(err) }));
    res.end();
    return;
  }

  let sessionSent = false;

  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; }
      catch { continue; }

      if (!sessionSent && event["sessionID"]) {
        res.write(sse({ type: "session", session_id: event["sessionID"] }));
        sessionSent = true;
      }

      const part = (event["part"] ?? {}) as Record<string, unknown>;

      // Only emit text events — skip tool_use noise
      if (event["type"] === "text" && part["type"] === "text" && part["text"]) {
        res.write(sse({ type: "text", text: part["text"] }));
      }
    }
  });

  let stderrBuf = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

  proc.on("close", (code: number | null) => {
    if (code !== 0 && stderrBuf.trim()) {
      res.write(sse({ type: "error", message: stderrBuf.trim().slice(0, 400) }));
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
