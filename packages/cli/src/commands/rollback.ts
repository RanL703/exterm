import pc from "picocolors";
import { TrainerApiClient } from "../client/api.js";

export interface RollbackOptions {
  host?: string;
  checkpoint?: string;
  list?: boolean;
  token?: string;
}

export async function rollbackCommand(options: RollbackOptions): Promise<void> {
  const hostUrl = options.host || "http://127.0.0.1:8765";
  const checkpointId = options.checkpoint;
  const listOnly = options.list || false;
  const token = options.token;

  const apiClient = new TrainerApiClient(hostUrl, token);

  try {
    if (listOnly || !checkpointId) {
      console.log(pc.bold(pc.cyan("\n  exterm")) + pc.dim(" - Available checkpoints:\n"));

      const response = await apiClient.listCheckpoints();

      if (response.checkpoints.length === 0) {
        console.log(pc.dim("  No checkpoints found."));
        console.log();
        return;
      }

      response.checkpoints.forEach((cp, i) => {
        const timeStr = new Date(cp.created_at * 1000).toLocaleString();
        console.log(`  ${pc.cyan(String(i + 1))}. ${pc.bold(cp.checkpoint_id)}  ${pc.dim(`(${timeStr})`)}`);
        console.log(`      ${pc.dim("Timesteps:")} ${cp.timesteps.toLocaleString()}  ${pc.dim("Episodes:")} ${cp.episode_count}  ${pc.dim("Mean reward:")} ${cp.mean_reward_100?.toFixed(2) ?? "N/A"}`);
        console.log(`      ${pc.dim("Algorithm:")} ${cp.algorithm}  ${pc.dim("Env:")} ${cp.env_id}`);
        console.log();
      });

      if (!listOnly) {
        console.log(pc.bold("  To rollback:"));
        console.log(pc.cyan("  exterm rollback --checkpoint <checkpoint_id>"));
        console.log();
      }
      return;
    }

    console.log(pc.bold(pc.cyan("\n  exterm")) + pc.dim(" - Rolling back to checkpoint..."));
    console.log(pc.dim(`  Checkpoint: ${checkpointId}`));

    const response = await apiClient.rollback({ checkpoint_id: checkpointId });

    if (response.success) {
      console.log(pc.green("\n  ? Rollback successful!"));
      console.log(pc.dim(`  ${response.message}\n`));
    } else {
      console.log(pc.red("\n  ? Rollback failed!"));
      console.log(pc.dim(`  ${response.message}\n`));
      process.exit(1);
    }
  } catch (err: any) {
    console.error(pc.red(`\n  ? Error: ${err.message || err}\n`));
    process.exit(1);
  }
}