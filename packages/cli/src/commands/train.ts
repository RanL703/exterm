import pc from "picocolors";
import { TrainerApiClient } from "../client/api.js";
import { ensureTrainerRunning } from "../client/spawner.js";
import { TrainerWebSocketClient } from "../client/ws.js";
import { RunConfig, StatusMessage } from "../types.js";
import { TerminalRenderer } from "../ui/terminal.js";

export interface TrainOptions {
  env?: string;
  algo?: string;
  steps?: string;
  host?: string;
  noSpawn?: boolean;
  seed?: string;
  token?: string;
}

export async function trainCommand(options: TrainOptions): Promise<void> {
  const envId = options.env || "CartPole-v1";
  const algorithm = options.algo || "PPO";
  const timesteps = parseInt(options.steps || "50000", 10);
  const hostUrl = options.host || "http://127.0.0.1:8765";
  const autoSpawn = !options.noSpawn;
  const seed = options.seed ? parseInt(options.seed, 10) : undefined;
  const token = options.token;
  const runId = Math.random().toString(36).substring(2, 10);

  const config: RunConfig = {
    run_id: runId,
    env_id: envId,
    algorithm: algorithm,
    total_timesteps: timesteps,
    seed: seed,
    hyperparameters: {},
  };

  console.log(pc.bold(pc.cyan("\n  exterm")) + pc.dim(" - Starting RL Training Session..."));

  let spawnerCleanup: (() => void) | null = null;

  try {
    const spawnRes = await ensureTrainerRunning(hostUrl, {
      autoSpawn,
      verbose: false,
    });
    spawnerCleanup = spawnRes.cleanup;

    const apiClient = new TrainerApiClient(hostUrl, token);
    const wsClient = new TrainerWebSocketClient(hostUrl, token);

    await wsClient.connect();

    const renderer = new TerminalRenderer(config, hostUrl);
    renderer.start();

    let isDone = false;
    let hasStarted = false;
    let finalStatus: StatusMessage | null = null;

    wsClient.onTelemetry((event) => {
      if (event.run_id === runId) {
        hasStarted = true;
        renderer.onTelemetry(event);
      }
    });

    wsClient.onStatus((status) => {
      if (status.run_id === runId) {
        if (status.state === "training" || status.state === "starting") {
          hasStarted = true;
        } else if (hasStarted && (status.state === "completed" || status.state === "stopped")) {
          isDone = true;
          finalStatus = status;
        } else if (status.state === "failed") {
          isDone = true;
          renderer.fail(status.error || "Unknown trainer failure");
        }
      }
    });

    // Handle Ctrl+C gracefully
    const sigintHandler = async () => {
      process.stdout.write("\x1b[?25h");
      console.log(pc.yellow("\n\n  Training interrupted by user. Stopping run..."));
      try {
        await apiClient.stopRun();
      } catch {
        // Ignore stop errors on exit
      }
      wsClient.close();
      if (spawnerCleanup) spawnerCleanup();
      process.exit(0);
    };

    process.on("SIGINT", sigintHandler);

    // Start training run
    await apiClient.startRun(config);

    // Wait until training finishes
    while (!isDone) {
      await new Promise((r) => setTimeout(r, 100));
    }

    renderer.finish(finalStatus);
    wsClient.close();
    process.removeListener("SIGINT", sigintHandler);
    process.exit(0);
  } catch (err: any) {
    process.stdout.write("\x1b[?25h");
    console.error(pc.red(`\n  ? Error: ${err.message || err}\n`));
    if (spawnerCleanup) spawnerCleanup();
    process.exit(1);
  }
}
