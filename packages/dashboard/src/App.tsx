import React, { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface TelemetryEvent {
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

interface StatusResponse {
  run_id?: string | null;
  state: string;
  current_run?: RunConfig | null;
  timesteps: number;
  total_timesteps: number;
  episodes: number;
  mean_reward_100?: number | null;
  fps: number;
  error?: string | null;
}

interface RunConfig {
  run_id?: string;
  env_id: string;
  algorithm: string;
  total_timesteps: number;
  seed?: number | null;
  hyperparameters?: Record<string, any>;
}

interface CheckpointInfo {
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

interface SteeringEntry {
  instruction: string;
  timestamp: number;
  diff: string;
  applied: boolean;
  requires_confirmation: boolean;
  checkpoint_id: string;
  message: string;
}

function App() {
  const [host, setHost] = useState("http://127.0.0.1:8765");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryEvent[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [steeringHistory] = useState<SteeringEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = host.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://") + "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Fetch initial data
      fetchStatus();
      fetchCheckpoints();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "telemetry") {
          setTelemetryHistory((prev) => [...prev.slice(-1000), msg]);
        } else if (msg.type === "status") {
          setStatus(msg);
        }
      } catch (e) {
        console.error("Failed to parse WS message:", e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => connect(), 3000);
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
    };
  }, [host]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${host}/api/v1/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.error("Failed to fetch status:", e);
    }
  };

  const fetchCheckpoints = async () => {
    try {
      const res = await fetch(`${host}/api/v1/checkpoints`);
      if (res.ok) {
        const data = await res.json();
        setCheckpoints(data.checkpoints || []);
      }
    } catch (e) {
      console.error("Failed to fetch checkpoints:", e);
    }
  };

  const sendCommand = async (action: string, payload?: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action, payload }));
    }
  };

  const handlePause = () => sendCommand("pause");
  const handleResume = () => sendCommand("resume");
  const handleStop = () => sendCommand("stop");

  const handleRestoreCheckpoint = async (checkpointId: string) => {
    try {
      const res = await fetch(`${host}/api/v1/checkpoints/${checkpointId}/restore`, { method: "POST" });
      if (res.ok) {
        await fetchStatus();
        await fetchCheckpoints();
      }
    } catch (e) {
      console.error("Failed to restore checkpoint:", e);
    }
  };

  const handleCreateCheckpoint = async () => {
    try {
      const res = await fetch(`${host}/api/v1/checkpoints`, { method: "POST" });
      if (res.ok) {
        await fetchCheckpoints();
      }
    } catch (e) {
      console.error("Failed to create checkpoint:", e);
    }
  };

  // Prepare chart data
  const rewardData = telemetryHistory
    .filter((t) => t.episode_reward !== null && t.episode_reward !== undefined)
    .map((t, i) => ({
      episode: i + 1,
      reward: t.episode_reward!,
      timesteps: t.timesteps,
    }));

  const meanRewardData = telemetryHistory
    .filter((t) => t.mean_reward_100 !== null && t.mean_reward_100 !== undefined)
    .map((t) => ({
      timesteps: t.timesteps,
      meanReward: t.mean_reward_100!,
    }));

  const progressData = telemetryHistory.map((t) => ({
    timesteps: t.timesteps,
    progress: t.progress * 100,
    fps: t.fps,
  }));

  const canControl = status && (status.state === "training" || status.state === "paused" || status.state === "starting");

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  if (!connected && !host) {
    return <ConnectScreen onConnect={(h) => setHost(h)} />;
  }

  return (
    <div className="dashboard">
      {/* Panel 1: Live Reward Curves */}
      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panel-header">
          <span className="panel-title">? Live Reward Curves</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className={`status-badge status-${status?.state || "idle"}`}>
              {status?.state || "idle"}
            </span>
            {!connected && (
              <button className="btn btn-secondary" onClick={connect} style={{ padding: "6px 12px", fontSize: "12px" }}>
                Connect
              </button>
            )}
            {connected && (
              <button className="btn btn-secondary" onClick={disconnect} style={{ padding: "6px 12px", fontSize: "12px" }}>
                Disconnect
              </button>
            )}
          </div>
        </div>
        <div className="panel-content">
          {!connected ? (
            <ConnectScreen onConnect={(h) => setHost(h)} />
          ) : !status ? (
            <div className="empty-state">Connecting to trainer...</div>
          ) : (
            <>
              <div className="run-info">
                <div className="info-item">
                  <span className="info-label">Run ID</span>
                  <span className="info-value">{status.run_id || "N/A"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Environment</span>
                  <span className="info-value">{status.current_run?.env_id || "N/A"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Algorithm</span>
                  <span className="info-value">{status.current_run?.algorithm || "N/A"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Timesteps</span>
                  <span className="info-value">{status.timesteps.toLocaleString()} / {status.total_timesteps.toLocaleString()}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Episodes</span>
                  <span className="info-value">{status.episodes.toLocaleString()}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">100-Ep Mean Reward</span>
                  <span className="info-value">{status.mean_reward_100?.toFixed(2) ?? "N/A"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">FPS</span>
                  <span className="info-value">{status.fps}</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div style={{ height: "300px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rewardData.length > 0 ? rewardData : [{ episode: 0, reward: 0 }]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                      <XAxis dataKey="episode" tick={{ fill: "#8b949e", fontSize: 11 }} stroke="#30363d" />
                      <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} stroke="#30363d" />
                      <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", color: "#e6edf3" }} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="reward"
                        stroke="#58a6ff"
                        strokeWidth={2}
                        dot={false}
                        name="Episode Reward"
                      />
                      {meanRewardData.length > 0 && (
                        <Line
                          type="monotone"
                          dataKey="meanReward"
                          stroke="#d29922"
                          strokeWidth={2}
                          dot={false}
                          name="Mean (100 ep)"
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ height: "300px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={progressData.length > 0 ? progressData : [{ timesteps: 0, progress: 0, fps: 0 }]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                      <XAxis dataKey="timesteps" tick={{ fill: "#8b949e", fontSize: 11 }} stroke="#30363d" />
                      <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} stroke="#30363d" domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", color: "#e6edf3" }} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="progress"
                        stroke="#a371f7"
                        strokeWidth={2}
                        dot={false}
                        name="Progress %"
                        yAxisId="left"
                      />
                      <Line
                        type="monotone"
                        dataKey="fps"
                        stroke="#3fb950"
                        strokeWidth={1.5}
                        dot={false}
                        name="FPS"
                        yAxisId="right"
                        strokeDasharray="5 5"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Panel 2: Episode Replay / Video */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">? Episode Replay</span>
        </div>
        <div className="panel-content">
          <div className="empty-state" style={{ height: "300px" }}>
            <div style={{ fontSize: "48px" }}>??</div>
            <div>Video replay not yet implemented</div>
            <div style={{ fontSize: "12px", marginTop: "8px" }}>
              Requires rendering environment episodes to video
            </div>
          </div>
        </div>
      </div>

      {/* Panel 3: Steering Timeline */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">?? Steering Timeline</span>
        </div>
        <div className="panel-content scrollable">
          {steeringHistory.length === 0 ? (
            <div className="empty-state" style={{ height: "200px" }}>
              <div>No steering commands yet</div>
              <div style={{ fontSize: "12px" }}>Use <code>exterm steer "instruction"</code> to steer</div>
            </div>
          ) : (
            <div className="steering-timeline">
              {steeringHistory.slice().reverse().map((entry, idx) => (
                <div key={idx} className="steering-entry">
                  <div className="steering-header">
                    <span className="steering-instruction">"{entry.instruction}"</span>
                    <span className="steering-time">
                      {new Date(entry.timestamp * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className={`steering-status steering-${entry.applied ? "applied" : entry.requires_confirmation ? "pending" : "confirmed"}`}>
                    {entry.requires_confirmation ? "? Pending Confirmation" : entry.applied ? "? Applied" : "? Confirmed"}
                  </span>
                  {entry.diff && (
                    <div className="steering-diff" style={{ marginTop: "8px" }}>
                      {entry.diff.split("\n").map((line, i) => (
                        <div key={i} className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-remove" : ""}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panel 4: Run Controls */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">? Run Controls</span>
        </div>
        <div className="panel-content">
          <div className="btn-group" style={{ marginBottom: "24px" }}>
            <button
              className="btn btn-secondary"
              onClick={handlePause}
              disabled={!canControl || status?.state !== "training"}
            >
              ? Pause
            </button>
            <button
              className="btn btn-primary"
              onClick={handleResume}
              disabled={!canControl || status?.state !== "paused"}
            >
              ? Resume
            </button>
            <button
              className="btn btn-danger"
              onClick={handleStop}
              disabled={!canControl}
            >
              ? Stop
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleCreateCheckpoint}
              disabled={!canControl}
            >
              ? Checkpoint
            </button>
          </div>

          <div style={{ borderTop: "1px solid #30363d", paddingTop: "16px" }}>
            <h4 style={{ fontSize: "13px", color: "#8b949e", marginBottom: "12px", textTransform: "uppercase" }}>
              Checkpoints
            </h4>
            {checkpoints.length === 0 ? (
              <div className="empty-state" style={{ height: "100px", padding: "8px" }}>
                No checkpoints yet
              </div>
            ) : (
              <div className="checkpoint-list">
                {checkpoints.map((cp) => (
                  <div key={cp.checkpoint_id} className="checkpoint-item">
                    <div className="checkpoint-info">
                      <span className="checkpoint-id">{cp.checkpoint_id}</span>
                      <span className="checkpoint-meta">
                        {new Date(cp.created_at * 1000).toLocaleString()} ?
                        {cp.timesteps.toLocaleString()} steps ?
                        {cp.episode_count} ep ?
                        mean: {cp.mean_reward_100?.toFixed(1) ?? "N/A"}
                      </span>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleRestoreCheckpoint(cp.checkpoint_id)}
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectScreen({ onConnect }: { onConnect: (host: string) => void }) {
  const [host, setHost] = useState("http://127.0.0.1:8765");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${host}/health`);
      if (res.ok) {
        onConnect(host);
      } else {
        setError("Failed to connect to trainer");
      }
    } catch (e) {
      setError("Connection failed - is the trainer running?");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="connect-form">
      <h2 style={{ color: "#f0f6fc", marginBottom: "8px" }}>exterm Dashboard</h2>
      <p style={{ color: "#8b949e", fontSize: "14px" }}>Enter trainer URL to connect</p>
      {error && <div style={{ color: "#da3633", fontSize: "13px" }}>{error}</div>}
      <input
        type="text"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        placeholder="http://127.0.0.1:8765"
        autoFocus
      />
      <button type="submit" className="btn btn-primary">Connect</button>
    </form>
  );
}

export default App;