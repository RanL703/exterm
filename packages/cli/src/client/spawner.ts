import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TrainerApiClient } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SpawnResult {
  child: ChildProcess | null;
  cleanup: () => void;
}

export async function ensureTrainerRunning(
  hostUrl: string,
  options: { autoSpawn?: boolean; verbose?: boolean } = {}
): Promise<SpawnResult> {
  const { autoSpawn = true, verbose = false } = options;
  const client = new TrainerApiClient(hostUrl);

  const isAlive = await client.checkHealth();
  if (isAlive) {
    return {
      child: null,
      cleanup: () => {},
    };
  }

  const isLocalhost =
    hostUrl.includes("localhost") ||
    hostUrl.includes("127.0.0.1") ||
    hostUrl.includes("0.0.0.0");

  if (!autoSpawn || !isLocalhost) {
    throw new Error(
      `Trainer is not reachable at ${hostUrl}. Please start the trainer first or check connection.`
    );
  }

  const possiblePaths = [
    path.resolve(process.cwd(), "trainer"),
    path.resolve(__dirname, "../../../trainer"),
    path.resolve(__dirname, "../../trainer"),
  ];

  let trainerDir = "";
  for (const p of possiblePaths) {
    trainerDir = p;
    break;
  }

  if (verbose) {
    console.log(`[exterm] Auto-spawning local trainer from ${trainerDir}...`);
  }

  const urlObj = new URL(hostUrl);
  const port = urlObj.port || "8765";

  // Use unref and detached so local trainer runs as a daemon
  const child = spawn(
    "uv",
    ["run", "--directory", trainerDir, "python", "-m", "exterm_trainer", "--port", port],
    {
      stdio: verbose ? "inherit" : "ignore",
      detached: true,
    }
  );
  child.unref();

  const cleanup = () => {
    if (child && !child.killed && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Ignore kill errors
      }
    }
  };

  // Poll /health until server is ready
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const alive = await client.checkHealth();
    if (alive) {
      return { child, cleanup };
    }
  }

  cleanup();
  throw new Error(`Timed out waiting for local trainer to start at ${hostUrl}`);
}
