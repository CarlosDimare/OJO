import { Router } from "express";
import { spawn } from "child_process";
import type { Request, Response } from "express";

const router = Router();

function sse(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

router.post("/chat", (req: Request, res: Response) => {
  const { message, session_id } = req.body as {
    message?: string;
    session_id?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "empty message" });
    return;
  }

  const args = ["run", "--format", "json"];
  if (session_id) args.push("--session", session_id);
  args.push(message.trim());

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn("opencode", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err: unknown) {
    res.write(
      sse({
        type: "error",
        message: "opencode not found: " + String(err),
      }),
    );
    res.end();
    return;
  }

  let sessionSent = false;

  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (!sessionSent && event["sessionID"]) {
        res.write(sse({ type: "session", session_id: event["sessionID"] }));
        sessionSent = true;
      }

      const part = (event["part"] ?? {}) as Record<string, unknown>;

      if (
        event["type"] === "text" &&
        part["type"] === "text" &&
        part["text"]
      ) {
        res.write(sse({ type: "text", text: part["text"] }));
      } else if (event["type"] === "tool_use" && part["tool"]) {
        res.write(
          sse({ type: "text", text: `\n*[tool: ${part["tool"]}]*\n` }),
        );
      }
    }
  });

  let stderrBuf = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (d: string) => {
    stderrBuf += d;
  });

  proc.on("close", (code: number | null) => {
    if (code !== 0 && stderrBuf.trim()) {
      res.write(
        sse({ type: "error", message: stderrBuf.trim().slice(0, 400) }),
      );
    }
    res.write(sse({ type: "done" }));
    res.end();
  });

  proc.on("error", (err: Error) => {
    res.write(sse({ type: "error", message: err.message }));
    res.end();
  });

  res.on("close", () => {
    try {
      proc.kill();
    } catch {}
  });
});

export default router;
