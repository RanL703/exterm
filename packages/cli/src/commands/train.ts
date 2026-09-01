import pc from "picocolors";
import readline from "node:readline";
import { TrainerApiClient } from "../client/api.js";
import { ensureTrainerRunning } from "../client/spawner.js";
import { TrainerWebSocketClient } from "../client/ws.js";
import { RunConfig, StatusMessage, SteerResponse } from "../types.js";
import { TerminalRenderer } from "../ui/terminal.js";
import { resolveTrainerHost } from "../autodetect.js";
import { setLastHost, setLastToken } from "../config.js";

export interface TrainOptions {
  env?: string;
  algo?: string;
  steps?: string;
  host?: string;
  noSpawn?: boolean;
  seed?: string;
  token?: string;
  noInteractive?: boolean;
}

export async function trainCommand(options: TrainOptions): Promise<void> {
  const envId = options.env || "CartPole-v1";
  const algorithm = options.algo || "PPO";
  const timesteps = parseInt(options.steps || "50000", 10);
  const autoSpawn = !options.noSpawn;
  const seed = options.seed ? parseInt(options.seed, 10) : undefined;
  const interactive = !options.noInteractive;

  // Resolve host and token with auto-detection
  const { host: hostUrl, token } = await resolveTrainerHost(options.host, options.token);
  console.log(pc.dim(`  Resolved host: ${hostUrl}`));

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
  console.log(pc.dim(`  Connecting to trainer at ${hostUrl}`));

  let spawnerCleanup: (() => void) | null = null;

  try {
    const spawnRes = await ensureTrainerRunning(hostUrl, {
      autoSpawn,
      verbose: false,
    });
    spawnerCleanup = spawnRes.cleanup;

    // Save successful host/token for future use
    await setLastHost(hostUrl);
    if (token) await setLastToken(token);

    const apiClient = new TrainerApiClient(hostUrl, token);
    const wsClient = new TrainerWebSocketClient(hostUrl, token);

    try {
      await wsClient.connect();
    } catch (err: any) {
      if (err.message?.includes("403") || err.message?.includes("401") || err.message?.includes("Unauthorized") || err.message?.includes("Forbidden")) {
        console.error(pc.red(`\n  ? Authentication failed: The trainer at ${hostUrl} requires a bearer token.`));
        console.error(pc.dim(`  Run with: exterm train --token <your-token> --host ${hostUrl}`));
        console.error(pc.dim(`  Or set EXTERM_TOKEN environment variable.`));
        if (spawnerCleanup) spawnerCleanup();
        process.exit(1);
      }
      throw err;
    }

    const renderer = new TerminalRenderer(config, hostUrl);
    renderer.start();

    let isDone = false;
    let hasStarted = false;
    let finalStatus: StatusMessage | null = null;
    let trainingActive = false;

    wsClient.onTelemetry((event) => {
      if (event.run_id === runId) {
        hasStarted = true;
        trainingActive = true;
        renderer.onTelemetry(event);
      }
    });

    wsClient.onStatus((status) => {
      if (status.run_id === runId) {
        if (status.state === "training" || status.state === "starting") {
          hasStarted = true;
          trainingActive = true;
        } else if (hasStarted && (status.state === "completed" || status.state === "stopped")) {
          isDone = true;
          trainingActive = false;
          finalStatus = status;
        } else if (status.state === "failed") {
          isDone = true;
          trainingActive = false;
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

    // Set up interactive steering if enabled
    let rlInterface: readline.Interface | null = null;
    if (interactive) {
      rlInterface = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });

      // Show steering prompt after training starts
      const showSteerPrompt = () => {
        if (trainingActive && !isDone) {
          process.stdout.write("\x1b[?25h"); // Show cursor
          process.stdout.write(pc.cyan("\n  steer> "));
        }
      };

      // Handle user input for steering
      rlInterface.on("line", async (input) => {
        const instruction = input.trim();
        if (!instruction) {
          showSteerPrompt();
          return;
        }

        if (instruction === "exit" || instruction === "quit") {
          console.log(pc.yellow("  Exiting interactive mode. Training continues in background."));
          rlInterface?.close();
          rlInterface = null;
          return;
        }

        if (instruction === "pause") {
          try {
            await apiClient.pauseRun();
            console.log(pc.green("  Training paused"));
          } catch (e: any) {
            console.log(pc.red(`  Failed to pause: ${e.message}`));
          }
          showSteerPrompt();
          return;
        }

        if (instruction === "resume") {
          try {
            await apiClient.resumeRun();
            console.log(pc.green("  Training resumed"));
          } catch (e: any) {
            console.log(pc.red(`  Failed to resume: ${e.message}`));
          }
          showSteerPrompt();
          return;
        }

        if (instruction === "checkpoint") {
          try {
            const cp = await apiClient.createCheckpoint();
            console.log(pc.green(`  Checkpoint created: ${cp.checkpoint_id}`));
          } catch (e: any) {
            console.log(pc.red(`  Failed to create checkpoint: ${e.message}`));
          }
          showSteerPrompt();
          return;
        }

        if (instruction === "status") {
          try {
            const status = await apiClient.getStatus();
            console.log(pc.cyan(`  Status: ${status.state}, Timesteps: ${status.timesteps}/${status.total_timesteps}, Episodes: ${status.episodes}`));
          } catch (e: any) {
            console.log(pc.red(`  Failed to get status: ${e.message}`));
          }
          showSteerPrompt();
          return;
        }

        if (instruction === "help") {
          console.log(pc.dim("  Available commands:"));
          console.log(pc.dim("    <instruction>  - Steer with natural language (e.g. 'penalize jerky movements')"));
          console.log(pc.dim("    pause          - Pause training"));
          console.log(pc.dim("    resume         - Resume training"));
          console.log(pc.dim("    checkpoint     - Create a checkpoint"));
          console.log(pc.dim("    status         - Show current status"));
          console.log(pc.dim("    help           - Show this help"));
          console.log(pc.dim("    exit/quit      - Exit interactive mode (training continues)"));
          showSteerPrompt();
          return;
        }

        // Steer with natural language instruction
        console.log(pc.dim("  Applying steering..."));
        try {
          const response = await apiClient.queueSteer({
            instruction,
          });
          if (response.state === "rejected") throw new Error(response.message);
          console.log(pc.green(`\n  ? Steering queued: ${response.request_id}`));
          console.log(pc.dim(`  Position: ${response.queue_position ?? "ready"}`));
          console.log(pc.dim("  It will be proposed at the next safe trainer boundary.\n"));
        } catch (e: any) {
          console.log(pc.red(`\n  ? Steering failed: ${e.message}`));
        }

        showSteerPrompt();
      });

      // Show initial help and prompt after a short delay
      setTimeout(() => {
        if (trainingActive && !isDone) {
          console.log(pc.dim("\n  Type steering instructions (e.g. 'penalize jerky movements') or 'help' for commands."));
          console.log(pc.dim("  Type 'exit' to leave interactive mode (training continues)."));
          showSteerPrompt();
        }
      }, 2000);
    }

    // Wait until training finishes
    while (!isDone) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (rlInterface) {
      rlInterface.close();
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
