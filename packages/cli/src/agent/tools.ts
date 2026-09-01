import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { TrainerApiClient } from "../client/api.js";

const execFileAsync = promisify(execFile);

export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  execute(input: I): Promise<O>;
}

function safePath(projectRoot: string, relativePath: string): string {
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error("path is outside project root");
  return candidate;
}

function validatePatch(patch: string): void {
  for (const line of patch.split("\n")) {
    const match = line.match(/^(?:---|\+\+\+)\s+[ab\\/]*(.+?)(?:\t.*)?$/);
    if (!match) continue;
    const file = match[1];
    if (file.startsWith("/") || file.split(/[\\/]/).includes("..")) throw new Error("patch contains a path outside project root");
  }
}

async function applyPatch(projectRoot: string, patch: string): Promise<{ ok: boolean; output: string }> {
  validatePatch(patch);
  return new Promise((resolve) => {
    const child = spawn("git", ["apply", "--whitespace=nowarn", "-"], { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ ok: false, output: error.message }));
    child.on("close", (code) => resolve(code === 0 ? { ok: true, output: stdout || "patch applied" } : { ok: false, output: stderr || "patch rejected" }));
    child.stdin.end(patch);
  });
}

export function createAgentTools(projectRoot: string, api: TrainerApiClient): AgentTool[] {
  return [
    { name: "project_list_files", description: "List project files excluding build and environment directories.", execute: async () => { const entries = await fs.readdir(projectRoot, { recursive: true }); return entries.filter((entry) => !/(^|[\\/])(node_modules|\.venv|dist|build|__pycache__|\.git)([\\/]|$)/.test(entry)).slice(0, 500); } },
    { name: "project_read_file", description: "Read one bounded text file inside the project root.", execute: async ({ path: relativePath }: { path: string }) => { const file = safePath(projectRoot, relativePath); const content = await fs.readFile(file, "utf8"); if (Buffer.byteLength(content) > 100 * 1024) throw new Error("file exceeds 100 KiB agent read limit"); return content; } },
    { name: "project_apply_patch", description: "Apply a unified patch inside the project root.", execute: async ({ patch }: { patch: string }) => applyPatch(projectRoot, patch) },
    { name: "project_validate", description: "Run the project validation command without a shell.", execute: async ({ command, args = [] }: { command: string; args?: string[] }) => { const allowed = new Set(["npm", "node", "python", "pytest", "uv"]); if (!allowed.has(command)) throw new Error(`validation command not allowed: ${command}`); try { const result = await execFileAsync(command, args, { cwd: projectRoot, timeout: 120_000, maxBuffer: 1024 * 1024 }); return { ok: true, output: `${result.stdout}${result.stderr}` }; } catch (error: any) { return { ok: false, output: `${error.stdout || ""}${error.stderr || error.message || ""}` }; } } },
    { name: "trainer_status", description: "Read the current RL trainer state.", execute: async () => api.getStatus() },
    { name: "trainer_start", description: "Start a validated RL training run.", execute: async (config: Parameters<TrainerApiClient["startRun"]>[0]) => api.startRun(config) },
    { name: "trainer_control", description: "Pause, resume, stop, checkpoint, or restore a run.", execute: async ({ action, checkpointId }: { action: "pause" | "resume" | "stop" | "checkpoint" | "restore"; checkpointId?: string }) => { if (action === "pause") return api.pauseRun(); if (action === "resume") return api.resumeRun(); if (action === "stop") return api.stopRun(); if (action === "checkpoint") return api.createCheckpoint(); if (!checkpointId) throw new Error("checkpointId is required for restore"); return api.restoreCheckpoint(checkpointId); } },
    { name: "trainer_queue_steer", description: "Queue a natural-language steering request for a trainer safe point.", execute: async ({ instruction }: { instruction: string }) => api.queueSteer({ instruction }) },
    { name: "trainer_artifacts", description: "List checkpoints, replay videos, and steering audit records.", execute: async () => { const [checkpoints, videos, log] = await Promise.all([api.listCheckpoints(), api.listVideos(), api.getAgentLog()]); return { checkpoints, videos, log }; } },
  ];
}
