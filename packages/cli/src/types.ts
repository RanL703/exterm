export type RunState =
  | "idle"
  | "starting"
  | "training"
  | "paused"
  | "completed"
  | "stopped"
  | "failed";

export interface RunConfig {
  run_id?: string;
  env_id: string;
  algorithm: string;
  total_timesteps: number;
  seed?: number | null;
  hyperparameters?: Record<string, any>;
}

export interface TelemetryEvent {
  type: "telemetry";
  run_id?: string;
  timestamp: number;
  timesteps: number;
  total_timesteps: number;
  progress: number;
  episode_count: number;
  episode_reward?: number | null;
  episode_length?: number | null;
  mean_reward_100?: number | null;
  fps: number;
  metrics: Record<string, number>;
}

export interface StatusResponse {
  run_id?: string | null;
  state: RunState;
  current_run?: RunConfig | null;
  timesteps: number;
  total_timesteps: number;
  episodes: number;
  mean_reward_100?: number | null;
  fps: number;
  error?: string | null;
}

export interface StatusMessage extends StatusResponse {
  type: "status";
}

export interface LogMessage {
  type: "log";
  run_id?: string;
  level: string;
  message: string;
  timestamp: number;
}

export interface CommandMessage {
  action: "pause" | "resume" | "stop" | "steer";
  payload?: Record<string, any>;
}

export type ServerMessage = TelemetryEvent | StatusMessage | LogMessage;

export interface CheckpointInfo {
  checkpoint_id: string;
  run_id: string;
  timesteps: number;
  episode_count: number;
  mean_reward_100: number | null;
  created_at: number;
  reward_code: string;
  hyperparameters: Record<string, any>;
  algorithm: string;
  env_id: string;
}

export interface CheckpointListResponse {
  checkpoints: CheckpointInfo[];
}

export interface SteerRequest {
  instruction: string;
  checkpoint_id?: string;
}

export interface SteerResponse {
  diff: string;
  applied: boolean;
  requires_confirmation: boolean;
  checkpoint_id: string;
  message: string;
}

export interface RollbackRequest {
  checkpoint_id: string;
}

export interface RollbackResponse {
  success: boolean;
  message: string;
}
