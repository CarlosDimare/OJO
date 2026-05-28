import { Router } from "express";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  // from src/routes/ (source) — ../../ = api-server/
  resolve(__dir, "../../node_modules/.bin/opencode"),
  // from dist/ (built) — ../ = api-server/
  resolve(__dir, "../node_modules/.bin/opencode"),
  resolve(__dir, "../../../node_modules/.bin/opencode"),
  resolve(__dir, "../../../../node_modules/.bin/opencode"),
  "/usr/local/bin/opencode",
];
const OPENCODE = CANDIDATES.find(existsSync) || "opencode";

const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.post("/diag/opencode", async (_req, res) => {
  const result: Record<string, unknown> = {
    binary: OPENCODE,
    exists: existsSync(OPENCODE),
    candidates: CANDIDATES.map((c) => ({ path: c, exists: existsSync(c) })),
    env: {
      PATH: (process.env["PATH"] || "").split(":").filter(Boolean),
      NODE_ENV: process.env["NODE_ENV"] || "",
      OPENAI_API_KEY: process.env["OPENAI_API_KEY"] ? "SET" : "NOT SET",
      ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ? "SET" : "NOT SET",
    },
  };

  try {
    const proc = spawn(OPENCODE, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    const out = await new Promise<string>((resolve2, reject) => {
      let stdout = "";
      let stderr = "";
      proc.stdout!.on("data", (d: string) => { stdout += d; });
      proc.stderr!.on("data", (d: string) => { stderr += d; });
      proc.on("close", (code) => {
        if (code === 0) resolve2(stdout.trim());
        else reject(new Error(`exit ${code}: ${stderr.trim().slice(0, 200)}`));
      });
      proc.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 10_000);
    });
    result.opencode_version = out;
  } catch (err: unknown) {
    result.opencode_error = err instanceof Error ? err.message : String(err);
  }

  res.json(result);
});

export default router;
