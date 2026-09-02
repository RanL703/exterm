import { TrainerApiClient } from "./client/api.js";
import pc from "picocolors";
import type { RunState } from "./types.js";

export interface TrainerInstance {
  host: string;
  token?: string;
  status?: RunState;
  runId?: string;
}

const COMMON_PORTS = Array.from({ length: 100 }, (_, i) => 8765 + i);

export async function detectLocalTrainers(token?: string): Promise<TrainerInstance[]> {
  const instances: TrainerInstance[] = [];
  console.log(pc.dim("  Scanning ports 8765-8864 for trainers..."));
  
  for (const port of COMMON_PORTS) {
    const host = `http://127.0.0.1:${port}`;
    try {
      const client = new TrainerApiClient(host, token);
      const isHealthy = await client.checkHealth();
      if (isHealthy) {
        console.log(pc.green(`  Found healthy trainer at ${host}`));
        let status: TrainerInstance["status"] = "idle";
        let runId: string | undefined;
        try {
          const statusRes = await client.getStatus();
          status = statusRes.state;
          runId = statusRes.run_id || undefined;
        } catch {
          // Status requires auth, but trainer is alive
          status = "idle";
        }
        instances.push({
          host,
          status,
          runId,
          token: token,
        });
      }
    } catch {
      // Ignore - trainer not running on this port
    }
  }
  
  return instances;
}

export async function findBestTrainer(token?: string): Promise<TrainerInstance | null> {
  const instances = await detectLocalTrainers(token);
  console.log(pc.dim(`  Detected ${instances.length} trainer(s)`));
  
  // Prefer training > idle > others
  const training = instances.find(i => i.status === "training");
  if (training) {
    console.log(pc.green(`  Selected training trainer: ${training.host}`));
    return training;
  }
  
  const idle = instances.find(i => i.status === "idle");
  if (idle) {
    console.log(pc.green(`  Selected idle trainer: ${idle.host}`));
    return idle;
  }
  
  if (instances[0]) {
    console.log(pc.green(`  Selected first trainer: ${instances[0].host}`));
    return instances[0];
  }
  
  return null;
}

export async function resolveTrainerHost(
  explicitHost?: string,
  explicitToken?: string
): Promise<{ host: string; token?: string }> {
  console.log(pc.dim("  [resolveTrainerHost] Starting..."));
  
  // 1. Explicit CLI flag takes priority
  if (explicitHost) {
    console.log(pc.dim(`  [resolveTrainerHost] Using explicit host: ${explicitHost}`));
    return { host: explicitHost, token: explicitToken };
  }
  
  // 2. Check environment variables
  if (process.env.EXTERM_HOST) {
    console.log(pc.dim(`  [resolveTrainerHost] Using env var: ${process.env.EXTERM_HOST}`));
    return { host: process.env.EXTERM_HOST, token: process.env.EXTERM_TOKEN };
  }
  
  // 3. Check saved config - but verify it's still alive
  const { getLastHost, getLastToken } = await import("./config.js");
  const savedHost = await getLastHost();
  const savedToken = await getLastToken();
  console.log(pc.dim(`  [resolveTrainerHost] Saved host: ${savedHost}, token: ${savedToken ? 'present' : 'none'}`));
  if (savedHost) {
    console.log(pc.dim(`  [resolveTrainerHost] Checking saved config: ${savedHost}`));
    const client = new TrainerApiClient(savedHost, savedToken);
    const healthy = await client.checkHealth();
    console.log(pc.dim(`  [resolveTrainerHost] checkHealth result: ${healthy}`));
    if (healthy) {
      console.log(pc.green(`  [resolveTrainerHost] Saved trainer is alive: ${savedHost}`));
      return { host: savedHost, token: savedToken };
    } else {
      console.log(pc.yellow(`  [resolveTrainerHost] Saved trainer at ${savedHost} is not responding, auto-detecting...`));
    }
  }
  
  // 4. Auto-detect local trainer (try with saved token first if we have one)
  console.log(pc.dim("  [resolveTrainerHost] Auto-detecting local trainer..."));
  const detected = await findBestTrainer(savedToken);
  if (detected) {
    console.log(pc.green(`  [resolveTrainerHost] Found trainer at ${detected.host} (${detected.status})`));
    return { host: detected.host, token: detected.token };
  }
  
  // 5. Fallback to default
  console.log(pc.yellow("  [resolveTrainerHost] No trainer found, using default: http://127.0.0.1:8765"));
  return { host: "http://127.0.0.1:8765", token: undefined };
}
