import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import app from "./app";
import { logger } from "./lib/logger";

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

const wss = new WebSocketServer({ server, path: "/api/ws" });

wss.on("connection", (ws: WebSocket) => {
  logger.info("Terminal WebSocket connection opened");

  const shell = process.env["SHELL"] || "/bin/bash";

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.env["HOME"] || "/",
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    logger.info({ exitCode }, "PTY process exited");
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode }));
      ws.close();
    }
  });

  ws.on("message", (message: Buffer) => {
    try {
      const msg = JSON.parse(message.toString());
      if (msg.type === "input") {
        ptyProcess.write(msg.data);
      } else if (msg.type === "resize") {
        ptyProcess.resize(msg.cols, msg.rows);
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    logger.info("Terminal WebSocket connection closed");
    try {
      ptyProcess.kill();
    } catch {
      // already dead
    }
  });

  ws.on("error", (err) => {
    logger.error({ err }, "WebSocket error");
    try {
      ptyProcess.kill();
    } catch {
      // already dead
    }
  });
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
