import { Router } from "express";
import { store } from "../lib/store";

const router = Router();

router.get("/conversations", (_req, res) => {
  res.json(store.listConversations());
});

router.get("/conversations/:id", (req, res) => {
  const conv = store.getConversation(Number(req.params.id));
  if (!conv) { res.status(404).json({ error: "not found" }); return; }
  const msgs = store.getMessages(conv.id);
  res.json({ ...conv, messages: msgs });
});

router.delete("/conversations/:id", (req, res) => {
  store.deleteConversation(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
