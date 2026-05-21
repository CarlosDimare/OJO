import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { db, redaccionAgentesTable, coberturasTable } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOCAL_BIN = resolve(__dir, "../../node_modules/.bin/opencode");
const OPENCODE = existsSync(LOCAL_BIN) ? LOCAL_BIN : "opencode";

const SYSTEM_PROMPT = `Sos un periodista de investigacion del medio "CD" (Corresponsal Digital).

Instrucciones:
1. Busca informacion actualizada en la web sobre el tema indicado.
2. Redacta una nota periodistica completa con: titulo, contexto, datos chequeados, fuentes citadas con [texto](url).
3. Inclui fechas, lugares, protagonistas y cifras verificables.
4. Si encontras informacion relevante, usa el formato ::: cifra para destacar numeros importantes.
5. NO incluyas tu opinion personal ni editorialices.
6. Responde UNICA Y EXCLUSIVAMENTE con el contenido de la nota. Sin explicaciones, sin "Claro", sin presentacion.
7. La nota debe estar en espanol.`;

let intervalId: ReturnType<typeof setInterval> | null = null;
let running = false;

export function isRedaccionSchedulerRunning(): boolean {
  return intervalId !== null;
}

export function startRedaccionScheduler(): void {
  if (intervalId) return;
  logger.info("Redaccion agent scheduler started");
  intervalId = setInterval(() => {
    void checkAndRunAgents();
  }, 60_000);
  setImmediate(() => { void checkAndRunAgents(); });
}

export function stopRedaccionScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  logger.info("Redaccion agent scheduler stopped");
}

async function checkAndRunAgents(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const agents = await db
      .select()
      .from(redaccionAgentesTable)
      .where(
        sql`${redaccionAgentesTable.periodo} > 0 AND ${redaccionAgentesTable.activo} = 1`,
      );
    const now = new Date();
    for (const agent of agents) {
      const lastRun = agent.ultimaEjecucion ? new Date(agent.ultimaEjecucion) : null;
      const periodMs = agent.periodo * 60 * 1000;
      if (lastRun && (now.getTime() - lastRun.getTime()) < periodMs) continue;
      const topics = (agent.topics || []).filter(Boolean);
      const tasks = (agent.tareas || []).filter(Boolean);
      const allTopics = [...topics, ...tasks].filter(Boolean);
      if (allTopics.length === 0) continue;
      const topic = allTopics[Math.floor(Math.random() * allTopics.length)];
      logger.info({ agent: agent.nombre, topic }, "Auto-executing redaccion agent");
      await executeAgent(agent, topic);
    }
  } catch (err: any) {
    logger.error({ error: err?.message }, "Redaccion scheduler check failed");
  } finally {
    running = false;
  }
}

async function executeAgent(agent: any, topic: string): Promise<void> {
  const fullPrompt = `${SYSTEM_PROMPT}\n\nTu tarea especifica es: ${topic}`;
  const args = ["run", "--format", "json", fullPrompt];
  return new Promise((resolvePromise) => {
    const proc = spawn(OPENCODE, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 90_000,
    });
    let botText = "";
    let stderrBuf = "";
    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolvePromise();
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
            botText += part["text"] as string;
          }
        } catch {}
      }
    });
    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (d: string) => { stderrBuf += d; });
    proc.on("close", async () => {
      clearTimeout(killTimer);
      if (botText.trim()) {
        try {
          await db.insert(coberturasTable).values({
            titulo: topic.slice(0, 120) || "Nota automatica",
            contenido: botText.trim(),
            autor: agent.nombre,
            tags: [],
            seccion: agent.agenteId || agent.nombre,
          });
          await db.update(redaccionAgentesTable)
            .set({ ultimaEjecucion: new Date() })
            .where(eq(redaccionAgentesTable.id, agent.id));
        } catch {}
      }
      resolvePromise();
    });
    proc.on("error", () => { clearTimeout(killTimer); resolvePromise(); });
  });
}
