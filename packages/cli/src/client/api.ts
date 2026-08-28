import { RunConfig, StatusResponse } from "../types.js";

export class TrainerApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash if present
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/status`);
    if (!res.ok) {
      throw new Error(`Failed to fetch status: ${res.statusText}`);
    }
    return (await res.json()) as StatusResponse;
  }

  async startRun(config: RunConfig): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to start run: ${errorText}`);
    }
    return (await res.json()) as StatusResponse;
  }

  async pauseRun(): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/run/pause`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`Failed to pause run: ${res.statusText}`);
    }
    return (await res.json()) as StatusResponse;
  }

  async resumeRun(): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/run/resume`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`Failed to resume run: ${res.statusText}`);
    }
    return (await res.json()) as StatusResponse;
  }

  async stopRun(): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/run/stop`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`Failed to stop run: ${res.statusText}`);
    }
    return (await res.json()) as StatusResponse;
  }
}
