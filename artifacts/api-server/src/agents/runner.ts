import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { db, accionesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { AgentConfig } from "./prompts";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOCAL_BIN = resolve(__dir, "../../node_modules/.bin/opencode");
const OPENCODE = existsSync(LOCAL_BIN) ? LOCAL_BIN : "opencode";

const now = new Date().toLocaleString("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "full",
  timeStyle: "short",
});

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
  const fullPrompt = `Fecha y hora actual: ${now}\n\n${agent.systemPrompt}\n\nBuscá acciones colectivas RECIENTES para esta sección: ${agent.label}`;
  const args = ["run", "--format", "json", fullPrompt];

  logger.info({ agent: agent.id }, "Agent starting");

  return new Promise((resolve) => {
    const proc = spawn(OPENCODE, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      logger.warn({ agent: agent.id }, "Agent timed out after 30s");
    }, 30_000);

    let botText = "";
    let stderrBuf = "";

    proc.stdout!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => {
      for (const raw of chunk.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const part = (event["part"] ?? {}) as Record<string, unknown>;
          if (event["type"] === "text" && part["type"] === "text" && part["text"]) {
            botText += part["text"] as string;
          }
        } catch {}
      }
    });

    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (d: string) => { stderrBuf += d; });

    proc.on("close", async (code) => {
      clearTimeout(killTimer);
      if (code !== 0 && stderrBuf.trim()) {
        logger.error({ agent: agent.id, stderr: stderrBuf.trim().slice(0, 300) }, "Agent error");
      }

      const raw = extractJSON(botText);
      if (raw.length === 0) {
        logger.warn({ agent: agent.id, text: botText.slice(0, 200) }, "Agent returned no parseable data");
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

        logger.info({ agent: agent.id, count: normalized.length }, "Agent completed");
        resolve({ ok: true, count: normalized.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ agent: agent.id, error: msg }, "Agent DB error");
        resolve({ ok: false, count: 0, error: msg });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      logger.error({ agent: agent.id, error: err.message }, "Agent spawn error");
      resolve({ ok: false, count: 0, error: err.message });
    });
  });
}
