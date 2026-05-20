import { AGENTS } from "./prompts";
import { runAgent } from "./runner";
import { logger } from "../lib/logger";

const running = new Set<string>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let enabled = true;

export function getStatus() {
  return {
    enabled,
    running: Array.from(running),
    scheduled: intervalId !== null,
  };
}

export async function runAllAgents(): Promise<void> {
  for (const agent of AGENTS) {
    if (running.has(agent.id)) {
      logger.warn({ agent: agent.id }, "Agent already running, skipping");
      continue;
    }
    running.add(agent.id);
    try {
      await runAgent(agent);
    } catch (err: any) {
      logger.error({ agent: agent.id, error: err?.message }, "Agent crashed");
    } finally {
      running.delete(agent.id);
    }
  }
}

export async function runAgentById(id: string): Promise<{ ok: boolean; count: number; error?: string } | null> {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) return null;
  if (running.has(id)) {
    return { ok: false, count: 0, error: "Agent already running" };
  }
  running.add(id);
  try {
    return await runAgent(agent);
  } finally {
    running.delete(id);
  }
}

export function startScheduler(): void {
  if (intervalId) return;
  intervalId = setInterval(() => {
    if (!enabled) return;
    runAllAgents().catch((err) => logger.error({ error: err.message }, "Scheduled agent run failed"));
  }, 60 * 60 * 1000);
  logger.info("Agent scheduler started — runs every 60 minutes");
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  logger.info("Agent scheduler stopped");
}

export function setSchedulerEnabled(on: boolean): boolean {
  enabled = on;
  if (on) {
    if (!intervalId) startScheduler();
  } else {
    stopScheduler();
  }
  return on;
}
