import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

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

export const redaccionAgentesTable = pgTable("redaccion_agentes", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  tareas: jsonb("tareas").notNull().$type<string[]>(),
  agenteId: text("agente_id"),
  activo: integer("activo").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const accionesTable = pgTable("acciones_colectivas", {
  id: serial("id").primaryKey(),
  seccion: text("seccion").notNull(),
  pais: text("pais").notNull(),
  bandera: text("bandera").notNull(),
  hora: text("hora").notNull(),
  fecha: text("fecha").notNull(),
  lugar: text("lugar").notNull(),
  tipoAccion: text("tipo_accion").notNull(),
  organizaciones: jsonb("organizaciones").notNull().$type<string[]>(),
  motivo: text("motivo").notNull(),
  status: text("status").notNull().default("programado"),
  fuentes: jsonb("fuentes").notNull().$type<{ nombre: string; url: string }[]>(),
  ultimasNoticias: jsonb("ultimas_noticias").$type<{ titular: string; url: string; fuente: string }[]>(),
  lat: text("lat"),
  lng: text("lng"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
