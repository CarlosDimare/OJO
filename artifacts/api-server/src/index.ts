import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initServe, stopServe } from "./routes/chat";
import { readFileSync, readdirSync, readlinkSync } from "fs";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// Kill any stale process that might be holding the port (survives Replit Run restarts)
function freePort(targetPort: number): void {
  try {
    const myPid = process.pid;
    const hex = targetPort.toString(16).toUpperCase().padStart(4, "0");
    for (const line of readFileSync("/proc/net/tcp", "utf8").split("\n")) {
      const m = line.match(/^\s*\d+:\s+[0-9A-F]+:([0-9A-F]+)\s/);
      if (m && m[1] === hex) {
        const inode = line.trim().split(/\s+/)[9];
        if (!inode || inode === "0") break;
        for (const p of readdirSync("/proc")) {
          if (!/^\d+$/.test(p)) continue;
          if (Number(p) === myPid) continue;
          try {
            for (const fd of readdirSync(`/proc/${p}/fd`)) {
              if (readlinkSync(`/proc/${p}/fd/${fd}`) === `socket:[${inode}]`) {
                process.kill(Number(p), "SIGKILL");
                logger.warn({ pid: p, port: targetPort }, "killed stale process on port");
                return;
              }
            }
          } catch { /* permission denied, skip */ }
        }
        break;
      }
    }
  } catch { /* /proc/net/tcp unavailable */ }
}

freePort(port);
setTimeout(() => {
  const server = http.createServer(app);
  initServe().then(() => {
    server.listen(port, () => {
      logger.info({ port }, "Server listening");
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      logger.error({ err }, "server error");
      process.exit(1);
    });
  }).catch((err) => {
    logger.error({ err }, "failed to start opencode serve, exiting");
    process.exit(1);
  });

  function shutdown() {
    logger.info("shutting down");
    stopServe();
    server.close(() => process.exit(0));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}, 500);
