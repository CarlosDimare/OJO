import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .references(() => conversationsTable.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
