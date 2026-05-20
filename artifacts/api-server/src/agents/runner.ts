import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { db, accionesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { pushActivity } from "./activity";
import type { AgentConfig } from "./prompts";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOCAL_BIN = resolve(__dir, "../../node_modules/.bin/opencode");
const OPENCODE = existsSync(LOCAL_BIN) ? LOCAL_BIN : "opencode";

interface AccionRaw {
  pais?: string;
  bandera?: string;
  hora?: string;
  fecha?: string;
  lugar?: string;
  tipo_accion?: string;
  organizaciones?: string[];
  motivo?: string;
  status?: string;
  lat?: number | null;
  lng?: number | null;
  fuentes?: { nombre?: string; url?: string }[];
}

function extractJSON(text: string): AccionRaw[] {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as AccionRaw[];
    return [];
  } catch {}

  // Try extracting from markdown code blocks
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed as AccionRaw[];
    } catch {}
  }

  // Try finding an array pattern [...]
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed as AccionRaw[];
    } catch {}
  }

  return [];
}

function normalize(accion: AccionRaw): AccionRaw {
  return {
    pais: accion.pais || "Desconocido",
    bandera: accion.bandera || "🏳",
    hora: accion.hora || "—",
    fecha: accion.fecha || new Date().toISOString().slice(0, 10),
    lugar: accion.lugar || "—",
    tipo_accion: accion.tipo_accion || "otra",
    organizaciones: accion.organizaciones?.filter(Boolean) || [],
    motivo: accion.motivo || "—",
    status: (accion.status === "programado" || accion.status === "en_curso" || accion.status === "finalizado")
      ? accion.status : "programado",
    lat: accion.lat ?? null,
    lng: accion.lng ?? null,
    fuentes: accion.fuentes?.filter(f => f?.nombre || f?.url) || [],
  };
}

export async function runAgent(agent: AgentConfig): Promise<{ ok: boolean; count: number; error?: string }> {
  const now = new Date();
  const today = now.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const todayISO = now.toISOString().slice(0, 10);
  const hora = now.toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit", minute: "2-digit",
  });
  const fullPrompt = `HOY es ${today} (${todayISO}). ${hora} hs Argentina.\n\nBuscá SOLO acciones colectivas que estén ocurriendo HOY ${todayISO}.\n\n${agent.systemPrompt}\n\nBuscá acciones colectivas RECIENTES para esta sección: ${agent.label}`;
  const args = ["run", "--format", "json", fullPrompt];

  logger.info({ agent: agent.id }, "Agent starting");
  pushActivity({ agentId: agent.id, agentLabel: agent.label, time: new Date().toLocaleTimeString("es-AR"), msg: "Iniciando búsqueda...", type: "step" });

  return new Promise((resolve) => {
    const proc = spawn(OPENCODE, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      pushActivity({ agentId: agent.id, agentLabel: agent.label, time: new Date().toLocaleTimeString("es-AR"), msg: "TimeOut — no respondió en 90s", type: "error" });
      logger.warn({ agent: agent.id }, "Agent timed out after 90s");
    }, 90_000);

    let botText = "";
    let stderrBuf = "";

    proc.stdout!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => {
      for (const raw of chunk.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const evType = event["type"] as string;
          const part = (event["part"] ?? {}) as Record<string, unknown>;

          if (evType === "step_start") {
            pushActivity({ agentId: agent.id, agentLabel: agent.label, time: new Date().toLocaleTimeString("es-AR"), msg: "Pensando...", type: "step" });
            continue;
          }

          if (evType === "tool_use") {
            const tool = (part["tool"] as string) || "";
            const label: Record<string, string> = {
              websearch: "Buscando en la web...",
              webfetch: "Analizando fuente...",
              read: "Leyendo documento...",
              read_file: "Leyendo documento...",
            };
            pushActivity({ agentId: agent.id, agentLabel: agent.label, time: new Date().toLocaleTimeString("es-AR"), msg: label[tool] || `Ejecutando: ${tool}...`, type: "tool" });
            continue;
          }

          if (evType === "text" && part["type"] === "text" && part["text"]) {
            botText += part["text"] as string;
          }
        } catch {}
      }
    });

    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

    proc.on("close", async (code) => {
      clearTimeout(killTimer);

      const t = new Date().toLocaleTimeString("es-AR");

      if (code !== 0 && stderrBuf.trim()) {
        pushActivity({ agentId: agent.id, agentLabel: agent.label, time: t, msg: "Error en ejecución", type: "error" });
        logger.error({ agent: agent.id, stderr: stderrBuf.trim().slice(0, 300) }, "Agent error");
      }

      const raw = extractJSON(botText);
      if (raw.length === 0) {
        console.error("=== RAW BOT TEXT ===", botText.slice(0, 2000));
        console.error("=== STDERR ===", stderrBuf.trim().slice(0, 1000));
        pushActivity({ agentId: agent.id, agentLabel: agent.label, time: t, msg: "No se encontraron acciones", type: "done" });
        logger.warn({ agent: agent.id, text: botText.slice(0, 200), stderr: stderrBuf.trim().slice(0, 300) }, "Agent returned no parseable data");
        resolve({ ok: false, count: 0, error: "No se pudo extraer JSON de la respuesta" });
        return;
      }

      const normalized = raw.map(normalize);

      try {
        // Replace old data for this section
        await db.delete(accionesTable).where(eq(accionesTable.seccion, agent.id));

        for (const a of normalized) {
          const values: typeof accionesTable.$inferInsert = {
            seccion: agent.id,
            pais: a.pais || "",
            bandera: a.bandera || "",
            hora: a.hora || "",
            fecha: a.fecha || "",
            lugar: a.lugar || "",
            tipoAccion: a.tipo_accion || "",
            organizaciones: a.organizaciones || [],
            motivo: a.motivo || "",
            status: a.status || "programado",
            lat: a.lat != null ? String(a.lat) : null,
            lng: a.lng != null ? String(a.lng) : null,
            fuentes: (a.fuentes || []).map((f) => ({ nombre: f.nombre || "", url: f.url || "" })),
          };
          await db.insert(accionesTable).values(values);
        }

        pushActivity({ agentId: agent.id, agentLabel: agent.label, time: t, msg: `${normalized.length} acciones publicadas`, type: "done" });
        logger.info({ agent: agent.id, count: normalized.length }, "Agent completed");
        resolve({ ok: true, count: normalized.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushActivity({ agentId: agent.id, agentLabel: agent.label, time: t, msg: `Error DB: ${msg.slice(0, 60)}`, type: "error" });
        logger.error({ agent: agent.id, error: msg }, "Agent DB error");
        resolve({ ok: false, count: 0, error: msg });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      pushActivity({ agentId: agent.id, agentLabel: agent.label, time: new Date().toLocaleTimeString("es-AR"), msg: `Error: ${err.message.slice(0, 60)}`, type: "error" });
      logger.error({ agent: agent.id, error: err.message }, "Agent spawn error");
      resolve({ ok: false, count: 0, error: err.message });
    });
  });
}
