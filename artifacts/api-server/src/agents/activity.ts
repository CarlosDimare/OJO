export interface ActivityEntry {
  agentId: string;
  agentLabel: string;
  time: string;
  msg: string;
  type: "step" | "tool" | "done" | "error";
}

const MAX = 100;
const log: ActivityEntry[] = [];

export function pushActivity(entry: ActivityEntry): void {
  log.unshift(entry);
  if (log.length > MAX) log.length = MAX;
}

export function getActivity(limit = 20): ActivityEntry[] {
  return log.slice(0, limit);
}

export function clearActivity(agentId?: string): void {
  if (agentId) {
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].agentId === agentId) log.splice(i, 1);
    }
  } else {
    log.length = 0;
  }
}
