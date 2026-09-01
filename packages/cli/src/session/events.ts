export type SlashCommand = {
  name: string;
  args: string[];
};

export type SessionEvent =
  | { type: "log"; message: string; level?: "info" | "success" | "warning" | "error" }
  | { type: "status"; state: string; runId?: string; timesteps?: number; totalTimesteps?: number }
  | { type: "telemetry"; runId?: string; timesteps: number; totalTimesteps: number; progress: number; episodeCount: number; reward?: number | null; meanReward?: number | null; fps: number }
  | { type: "steering_queued"; requestId: string; instruction: string; requestedAtTimestep: number }
  | { type: "steering_window_open"; requestId: string; safePointTimestep: number }
  | { type: "steering_proposed"; requestId: string; checkpointId: string; diff: string; requiresConfirmation: boolean }
  | { type: "steering_applied"; requestId: string; checkpointId: string; safePointTimestep: number }
  | { type: "steering_pending"; requestId: string; checkpointId: string; safePointTimestep: number }
  | { type: "validation_failed"; requestId?: string; message: string }
  | { type: "error"; message: string };

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const tokens = trimmed.slice(1).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { name: "help", args: [] };

  return { name: tokens[0].toLowerCase(), args: tokens.slice(1) };
}
