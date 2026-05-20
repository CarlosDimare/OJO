import { Router } from "express";
import type { Request, Response } from "express";
import { db, coberturasTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/coberturas
router.get("/coberturas", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(coberturasTable)
      .orderBy(coberturasTable.createdAt);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/coberturas/:id
router.get("/coberturas/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const [row] = await db
      .select()
      .from(coberturasTable)
      .where(eq(coberturasTable.id, id))
      .limit(1);
    if (!row) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /api/coberturas
router.post("/coberturas", async (req: Request, res: Response) => {
  try {
    const { titulo, contenido, autor, tags } = req.body as {
      titulo?: string;
      contenido?: string;
      autor?: string;
      tags?: string[];
    };
    const [row] = await db
      .insert(coberturasTable)
      .values({
        titulo: titulo || "Sin título",
        contenido: contenido || "",
        autor: autor || null,
        tags: tags || [],
      })
      .returning();
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// PUT /api/coberturas/:id
router.put("/coberturas/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const allowed = ["titulo", "contenido", "autor", "tags"];
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        update[key] = req.body[key];
      }
    }
    const [row] = await db
      .update(coberturasTable)
      .set(update)
      .where(eq(coberturasTable.id, id))
      .returning();
    if (!row) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/coberturas/:id
router.delete("/coberturas/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const [row] = await db
      .delete(coberturasTable)
      .where(eq(coberturasTable.id, id))
      .returning();
    if (!row) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
