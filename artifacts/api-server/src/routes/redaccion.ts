import { Router } from "express";
import type { Request, Response } from "express";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { db, redaccionAgentesTable, coberturasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getActivity, clearActivity } from "../agents/activity";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOCAL_BIN = resolve(__dir, "../../node_modules/.bin/opencode");
const OPENCODE = existsSync(LOCAL_BIN) ? LOCAL_BIN : "opencode";

const router = Router();

// GET /api/redaccion
router.get("/redaccion", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(redaccionAgentesTable)
      .orderBy(redaccionAgentesTable.id);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /api/redaccion
router.post("/redaccion", async (req: Request, res: Response) => {
  try {
    const { nombre, tareas, agenteId } = req.body as {
      nombre?: string;
      tareas?: string[];
      agenteId?: string | null;
    };
    const [row] = await db
      .insert(redaccionAgentesTable)
      .values({
        nombre: nombre || "Nuevo agente",
        tareas: tareas || [],
        agenteId: agenteId || null,
        activo: 1,
      })
      .returning();
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// PUT /api/redaccion/:id
router.put("/redaccion/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const { nombre, tareas, agenteId, activo } = req.body as {
      nombre?: string;
      tareas?: string[];
      agenteId?: string | null;
      activo?: number;
    };
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (nombre !== undefined) update.nombre = nombre;
    if (tareas !== undefined) update.tareas = tareas;
    if (agenteId !== undefined) update.agenteId = agenteId;
    if (activo !== undefined) update.activo = activo;

    const [row] = await db
      .update(redaccionAgentesTable)
      .set(update)
      .where(eq(redaccionAgentesTable.id, id))
      .returning();
    if (!row) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/redaccion/:id
router.delete("/redaccion/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const [row] = await db
      .delete(redaccionAgentesTable)
      .where(eq(redaccionAgentesTable.id, id))
      .returning();
    if (!row) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /api/redaccion/sembrar — seed default agents
router.post("/redaccion/sembrar", async (_req: Request, res: Response) => {
  try {
    const existing = await db.select().from(redaccionAgentesTable).limit(1);
    if (existing.length > 0) {
      return res.json({ ok: true, message: "already seeded" });
    }
    const defaults = [
      {
        nombre: "Corresponsal Internacional",
        tareas: ["Seguir conflictos activos", "Reportar cumbres diplomáticas", "Analizar geopolítica"],
        agenteId: "internacionales",
        activo: 1,
      },
      {
        nombre: "Cronista Argentina",
        tareas: ["Cubrir protestas sociales", "Investigar medidas de gobierno", "Documentar movimientos sindicales"],
        agenteId: "protestas_ar",
        activo: 1,
      },
      {
        nombre: "Editor de Datos",
        tareas: ["Verificar cifras", "Cruzar fuentes estadísticas", "Preparar infografías"],
        agenteId: null,
        activo: 1,
      },
      {
        nombre: "Reportero de Campo",
        tareas: ["Entrevistas en terreno", "Cobertura de eventos", "Material audiovisual"],
        agenteId: null,
        activo: 1,
      },
    ];
    for (const a of defaults) {
      await db.insert(redaccionAgentesTable).values(a);
    }
    return res.json({ ok: true, count: defaults.length });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/redaccion/actividad — current agent activity + linked redaccion agents
router.get("/redaccion/actividad", async (_req: Request, res: Response) => {
  try {
    const raw = getActivity(50);
    const agentes = await db
      .select()
      .from(redaccionAgentesTable)
      .where(eq(redaccionAgentesTable.activo, 1))
      .orderBy(redaccionAgentesTable.id);
    return res.json({ actividad: raw, agentes });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

/* ── Ejecutar agente (investigar y publicar en coberturas) ────── */

// POST /api/redaccion/ejecutar/:id
router.post("/redaccion/ejecutar/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "invalid id" });
    }

    const [agent] = await db
      .select()
      .from(redaccionAgentesTable)
      .where(eq(redaccionAgentesTable.id, id))
      .limit(1);

    if (!agent) {
      return res.status(404).json({ error: "agent not found" });
    }

    const { tareaIndice } = req.body as { tareaIndice?: number };
    const tasks = tareaIndice !== undefined && agent.tareas[tareaIndice]
      ? [agent.tareas[tareaIndice]]
      : agent.tareas;

    const promptText = tasks.join(". ");

    const fullPrompt = `Sos un periodista de investigación del medio "CD" (Corresponsal Digital). Tu tarea específica es: ${promptText}

Instrucciones:
1. Buscá información actualizada en la web sobre este tema.
2. Redactá una nota periodística completa con: título, contexto, datos chequeados, fuentes citadas con [texto](url).
3. Incluí fechas, lugares, protagonistas y cifras verificables.
4. Si encontrás información relevante, usá el formato ::: cifra para destacar números importantes.
5. NO incluyas tuopinión personal ni editorialices.
6. Respondé ÚNICA Y EXCLUSIVAMENTE con el contenido de la nota. Sin explicaciones, sin "Claro", sin presentación.
7. La nota debe estar en español.`;

    const args = ["run", "--format", "json", fullPrompt];

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const sendEvent = (type: string, data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    sendEvent("session", { session_id: `ejecutar-${id}` });

    const proc = spawn(OPENCODE, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let botText = "";
    let stderrBuf = "";

    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      sendEvent("error", { message: "El agente no respondió a tiempo (90s)" });
      sendEvent("done", {});
      res.end();
    }, 90_000);

    proc.stdout!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => {
      for (const raw of chunk.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const evType = event["type"] as string;
          const part = (event["part"] ?? {}) as Record<string, unknown>;
          if (evType === "text" && part["type"] === "text" && part["text"]) {
            const text = part["text"] as string;
            botText += text;
            sendEvent("text", { text });
          }
        } catch {}
      }
    });

    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

    proc.on("close", async (code) => {
      clearTimeout(killTimer);

      if (code !== 0 && stderrBuf.trim()) {
        console.error("Ejecutar agente stderr:", stderrBuf.trim().slice(0, 200));
      }

      if (botText.trim()) {
        try {
          const titulo = tasks[0].slice(0, 120) || "Nota del agente";
          const [row] = await db
            .insert(coberturasTable)
            .values({
              titulo,
              contenido: botText.trim(),
              autor: agent.nombre,
              tags: [],
            })
            .returning();
          sendEvent("cobertura", { id: row.id, titulo: row.titulo });
          sendEvent("text", { text: `\n\n---\n✅ Nota publicada en Coberturas: "${titulo}"` });
        } catch (err) {
          sendEvent("error", { message: "Error al guardar la cobertura" });
        }
      } else {
        sendEvent("error", { message: "El agente no produjo contenido" });
      }
      sendEvent("done", {});
      res.end();
    });

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      sendEvent("error", { message: err.message });
      sendEvent("done", {});
      res.end();
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

/* ── Jefe Editor chat ─────────────────────────────────────────── */

const JEFE_SYSTEM = `Eres el Jefe Editor de la redacción de "CD" (Corresponsal Digital), un medio independiente con base en Buenos Aires, Argentina.

Tu rol: Coordinás un equipo de reporteros que cubren protestas, conflictos y acciones colectivas en Argentina y el mundo. Asignás tareas, revisás cobertura, definís ángulos editoriales y resolvés dudas del equipo.

Contexto actual:
- Fecha: la que se indica abajo.
- La redacción opera en Argentina (huso horario -03:00).
- Tu equipo incluye corresponsales en terreno y agentes automatizados de monitoreo.
- Las fuentes deben ser chequeadas y verificables.
- El tono es serio, directo, sin adjetivos innecesarios. Priorizamos datos sobre opinión.

Respondé con claridad y firmeza, como un jefe de redacción experimentado. Usá el mismo formato que el asistente principal (::: cifra, [fuentes](url), etc.) cuando incluyas datos concretos.`;

const JEFE_EDITOR_NOTE = `\n\nIMPORTANTE: Hoy sos Jefe Editor. Respondé como tal. Si te consultan sobre cobertura, definí prioridades. Si te piden revisar una nota, señalá problemas de enfoque o fuentes. Si preguntan por la línea editorial, defendela con argumentos. No te salgas del personaje.`;

let jefeHistory: { role: "user" | "assistant"; content: string }[] = [];

function jefeSystemMsg(): { role: "system"; content: string } {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "full",
    timeStyle: "short",
  });
  return { role: "system", content: `${JEFE_SYSTEM}\n\nMomento actual: ${now}\nUbicación: Redacción CD, Buenos Aires, Argentina${JEFE_EDITOR_NOTE}` };
}

// POST /api/redaccion/jefe
router.post("/redaccion/jefe", (req: Request, res: Response) => {
  const { message } = req.body as { message?: string };
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const sendEvent = (type: string, data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  sendEvent("session", { session_id: "jefe-editor" });

  jefeHistory.push({ role: "user", content: message });
  if (jefeHistory.length > 20) {
    jefeHistory = jefeHistory.slice(-20);
  }

  const msgHistory = jefeHistory.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages = [jefeSystemMsg(), ...msgHistory];
  const prompt = JSON.stringify(messages);

  const args = ["run", "--format", "json", prompt];
  const proc = spawn(OPENCODE, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let botText = "";
  let stderrBuf = "";

  const killTimer = setTimeout(() => {
    proc.kill("SIGKILL");
    sendEvent("error", { message: "El editor no respondió a tiempo (30s)" });
    sendEvent("done", {});
    res.end();
  }, 30_000);

  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const evType = event["type"] as string;
        const part = (event["part"] ?? {}) as Record<string, unknown>;
        if (evType === "text" && part["type"] === "text" && part["text"]) {
          const text = part["text"] as string;
          botText += text;
          sendEvent("text", { text });
        }
      } catch {}
    }
  });

  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

  proc.on("close", (code) => {
    clearTimeout(killTimer);
    if (code !== 0 && stderrBuf.trim()) {
      console.error("Jefe editor stderr:", stderrBuf.trim().slice(0, 200));
    }
    if (botText.trim()) {
      jefeHistory.push({ role: "assistant", content: botText });
    }
    sendEvent("done", {});
    res.end();
  });

  proc.on("error", (err) => {
    clearTimeout(killTimer);
    sendEvent("error", { message: err.message });
    sendEvent("done", {});
    res.end();
  });
});

// POST /api/redaccion/jefe/reset — clear jefe conversation
router.post("/redaccion/jefe/reset", (_req: Request, res: Response) => {
  jefeHistory = [];
  return res.json({ ok: true });
});

export default router;
