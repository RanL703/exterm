import pc from "picocolors";
import { TrainerApiClient } from "../client/api.js";

export interface SteerOptions {
  host?: string;
  instruction?: string;
  confirm?: boolean;
  checkpoint?: string;
  token?: string;
}

export async function steerCommand(options: SteerOptions): Promise<void> {
  const hostUrl = options.host || "http://127.0.0.1:8765";
  const instruction = options.instruction;
  const confirm = options.confirm || false;
  const checkpointId = options.checkpoint;
  const token = options.token;

  const apiClient = new TrainerApiClient(hostUrl, token);

  try {
    if (confirm && checkpointId) {
      console.log(pc.bold(pc.cyan("\n  exterm")) + pc.dim(" - Confirming steering change..."));

      const response = await apiClient.confirmSteer({
        instruction: instruction || "",
        checkpoint_id: checkpointId,
      });

      console.log(pc.green("\n  ? Steering confirmed and applied!"));
      console.log(pc.dim(`  Checkpoint: ${response.checkpoint_id}`));
      console.log(pc.dim(`  Message: ${response.message}\n`));
      if (response.diff) {
        console.log(pc.bold("  Diff:"));
        console.log(response.diff);
      }
      return;
    }

    if (!instruction) {
      console.log(pc.yellow("  Please provide a steering instruction."));
      console.log(pc.dim("  Example: exterm steer \"penalize jerky movements\""));
      process.exit(1);
    }

    console.log(pc.bold(pc.cyan("\n  exterm")) + pc.dim(" - Applying steering instruction..."));
    console.log(pc.dim(`  Instruction: "${instruction}"`));

    const response = await apiClient.steer({
      instruction,
      checkpoint_id: checkpointId,
    });

    if (response.requires_confirmation) {
      console.log(pc.yellow("\n  ? This change requires confirmation due to risk level."));
      console.log(pc.dim(`  Checkpoint created: ${response.checkpoint_id}`));
      console.log(pc.bold("\n  Proposed diff:"));
      console.log(response.diff);
      console.log();
      console.log(pc.bold("  To confirm and apply:"));
      console.log(pc.cyan(`  exterm steer --confirm --checkpoint ${response.checkpoint_id} "${instruction}"`));
      console.log();
      return;
    }

    console.log(pc.green("\n  ? Steering applied successfully!"));
    console.log(pc.dim(`  Checkpoint: ${response.checkpoint_id}`));
    console.log(pc.dim(`  Message: ${response.message}`));
    if (response.diff) {
      console.log(pc.bold("\n  Applied diff:"));
      console.log(response.diff);
    }
    console.log();
  } catch (err: any) {
    console.error(pc.red(`\n  ? Error: ${err.message || err}\n`));
    process.exit(1);
  }
}