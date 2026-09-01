import { CheckpointInfo, CheckpointListResponse, RollbackRequest, RollbackResponse, RunConfig, StatusResponse, SteerRequest, SteerResponse } from "../types.js";

export class TrainerApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl: string, token?: string) {
    // Strip trailing slash if present
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(), ...options.headers },
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Request failed: ${res.status} ${res.statusText} - ${errorText}`);
    }
    return (await res.json()) as T;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/api/v1/status");
  }

  async startRun(config: RunConfig): Promise<StatusResponse> {
    return this.request<StatusResponse>("/api/v1/run", {
      method: "POST",
      body: JSON.stringify(config),
    });
  }

  async pauseRun(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/api/v1/run/pause", { method: "POST" });
  }

  async resumeRun(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/api/v1/run/resume", { method: "POST" });
  }

  async stopRun(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/api/v1/run/stop", { method: "POST" });
  }

  async listCheckpoints(): Promise<CheckpointListResponse> {
    return this.request<CheckpointListResponse>("/api/v1/checkpoints");
  }

  async createCheckpoint(): Promise<CheckpointInfo> {
    return this.request<CheckpointInfo>("/api/v1/checkpoints", { method: "POST" });
  }

  async restoreCheckpoint(checkpointId: string): Promise<StatusResponse> {
    return this.request<StatusResponse>(`/api/v1/checkpoints/${checkpointId}/restore`, { method: "POST" });
  }

  async steer(request: SteerRequest): Promise<SteerResponse> {
    return this.request<SteerResponse>("/api/v1/steer", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async queueSteer(request: SteerRequest): Promise<import("../types.js").QueueSteerResponse> {
    return this.request<import("../types.js").QueueSteerResponse>("/api/v1/steer/queue", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async approveQueuedSteer(requestId: string): Promise<SteerResponse> {
    return this.request<SteerResponse>(`/api/v1/steer/queue/${requestId}/approve`, { method: "POST" });
  }

  async listVideos(): Promise<{ videos: Array<Record<string, unknown>> }> {
    return this.request<{ videos: Array<Record<string, unknown>> }>("/api/v1/videos");
  }

  async getAgentLog(): Promise<{ logs: Array<Record<string, unknown>>; total: number }> {
    return this.request<{ logs: Array<Record<string, unknown>>; total: number }>("/api/v1/agent/log");
  }

  async confirmSteer(request: SteerRequest): Promise<SteerResponse> {
    return this.request<SteerResponse>("/api/v1/steer/confirm", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async rollback(request: RollbackRequest): Promise<RollbackResponse> {
    return this.request<RollbackResponse>("/api/v1/rollback", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
}
