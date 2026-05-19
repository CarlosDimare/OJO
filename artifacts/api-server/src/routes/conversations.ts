import { Router } from "express";
import { db, conversationsTable, messagesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/conversations", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: conversationsTable.id,
        title: conversationsTable.title,
        createdAt: conversationsTable.createdAt,
        updatedAt: conversationsTable.updatedAt,
        preview: sql<string>`coalesce(
          (select content from messages where conversation_id = conversations.id order by id desc limit 1),
          ''
        )`,
      })
      .from(conversationsTable)
      .orderBy(desc(conversationsTable.updatedAt))
      .limit(50);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const conv = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, Number(req.params.id)))
      .then((r) => r[0]);
    if (!conv) { res.status(404).json({ error: "not found" }); return; }
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(messagesTable.id);
    res.json({ ...conv, messages: msgs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/conversations/:id", async (req, res) => {
  try {
    await db
      .delete(conversationsTable)
      .where(eq(conversationsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
