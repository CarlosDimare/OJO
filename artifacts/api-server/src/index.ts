import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initServe, stopServe } from "./routes/chat";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

initServe().then(() => {
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
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
