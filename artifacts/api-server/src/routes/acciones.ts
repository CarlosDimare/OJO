import { Router } from "express";
import type { Request, Response } from "express";
import { db, accionesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runAllAgents, runAgentById, getStatus, setSchedulerEnabled } from "../agents/scheduler";
import { getActivity } from "../agents/activity";

const router = Router();

// GET /api/acciones?seccion=internacionales
router.get("/acciones", async (_req: Request, res: Response) => {
  try {
    const { seccion } = _req.query as { seccion?: string };
    const filter = seccion ? eq(accionesTable.seccion, seccion) : undefined;
    const rows = await db
      .select()
      .from(accionesTable)
      .where(filter)
      .orderBy(accionesTable.hora);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/acciones/:id
router.get("/acciones/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const [row] = await db
      .select()
      .from(accionesTable)
      .where(eq(accionesTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/agentes/disparar
router.post("/agentes/disparar", async (_req: Request, res: Response) => {
  const { seccion } = _req.body as { seccion?: string };
  try {
    if (seccion) {
      const result = await runAgentById(seccion);
      if (!result) {
        res.status(404).json({ error: `agent '${seccion}' not found` });
        return;
      }
      res.json(result);
    } else {
      await runAllAgents();
      res.json({ ok: true });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/agentes/status
router.get("/agentes/status", (_req: Request, res: Response) => {
  res.json(getStatus());
});

// POST /api/agentes/toggle
router.post("/agentes/toggle", (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (enabled !== undefined) {
    setSchedulerEnabled(enabled);
  }
  res.json(getStatus());
});

// GET /api/agentes/actividad
router.get("/agentes/actividad", (_req: Request, res: Response) => {
  res.json(getActivity(30));
});

export default router;
