import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface TelemetryEvent { type: "telemetry"; run_id?: string; timestamp: number; timesteps: number; total_timesteps: number; progress: number; episode_count: number; episode_reward?: number | null; episode_length?: number | null; mean_reward_100?: number | null; fps: number; metrics: Record<string, number>; }
interface StatusResponse { run_id?: string | null; state: string; current_run?: RunConfig | null; timesteps: number; total_timesteps: number; episodes: number; mean_reward_100?: number | null; fps: number; error?: string | null; }
interface RunConfig { run_id?: string; env_id: string; algorithm: string; total_timesteps: number; seed?: number | null; hyperparameters?: Record<string, unknown>; }
interface CheckpointInfo { checkpoint_id: string; run_id: string; timesteps: number; episode_count: number; mean_reward_100: number | null; created_at: number; reward_code: string; hyperparameters: Record<string, unknown>; algorithm: string; env_id: string; }

type IconName = "activity" | "play" | "pause" | "stop" | "save" | "rotate" | "wifi" | "terminal";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    activity: <><path d="M3 12h3l2-7 4 14 2-7h7" /><path d="M3 19h18" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    pause: <><path d="M8 5v14M16 5v14" /></>, stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    save: <><path d="M5 4h12l2 2v14H5V4Z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
    rotate: <><path d="M20 11a8 8 0 0 0-14-4L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14 4l3-3" /><path d="M21 19v-5h-5" /></>,
    wifi: <><path d="M2 8.5a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0M12 19h.01" /></>,
    terminal: <><path d="m4 5 6 6-6 6M12 17h8" /></>,
  };
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function App() {
  const defaultHost = import.meta.env.VITE_TRAINER_HOST || "http://127.0.0.1:8765";
  const token = import.meta.env.VITE_TRAINER_TOKEN;
  const [host] = useState(defaultHost);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryEvent[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
    return fetch(url, { ...options, headers });
  }, [token]);
  const fetchStatus = useCallback(async () => { const response = await fetchWithAuth(`${host}/api/v1/status`); if (response.ok) setStatus(await response.json()); }, [fetchWithAuth, host]);
  const fetchCheckpoints = useCallback(async () => { const response = await fetchWithAuth(`${host}/api/v1/checkpoints`); if (response.ok) setCheckpoints((await response.json()).checkpoints || []); }, [fetchWithAuth, host]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const wsUrl = host.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://").replace(/\/+$/, "") + "/ws" + (token ? `?token=${encodeURIComponent(token)}` : "");
    const ws = new WebSocket(wsUrl); wsRef.current = ws;
    ws.onopen = () => { setConnected(true); void fetchStatus(); void fetchCheckpoints(); };
    ws.onmessage = (event) => { try { const message = JSON.parse(event.data); if (message.type === "telemetry") setTelemetryHistory((previous) => [...previous.slice(-999), message]); if (message.type === "status") setStatus(message); } catch { /* Ignore malformed trainer messages. */ } };
    ws.onclose = () => { setConnected(false); reconnectTimeoutRef.current = setTimeout(connect, 3000); };
  }, [fetchCheckpoints, fetchStatus, host, token]);
  const disconnect = useCallback(() => { if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current); wsRef.current?.close(); wsRef.current = null; setConnected(false); }, []);
  useEffect(() => { connect(); return disconnect; }, [connect, disconnect]);

  const sendCommand = (action: "pause" | "resume" | "stop") => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ action })); };
  const createCheckpoint = async () => { const response = await fetchWithAuth(`${host}/api/v1/checkpoints`, { method: "POST" }); if (response.ok) void fetchCheckpoints(); };
  const restoreCheckpoint = async (id: string) => { if (!window.confirm(`Restore checkpoint ${id}? This changes model weights and reward code.`)) return; const response = await fetchWithAuth(`${host}/api/v1/checkpoints/${id}/restore`, { method: "POST" }); if (response.ok) { void fetchStatus(); void fetchCheckpoints(); } };
  const rewardData = useMemo(() => telemetryHistory.filter((event) => event.episode_reward != null).map((event, index) => ({ episode: index + 1, reward: event.episode_reward, meanReward: event.mean_reward_100 })), [telemetryHistory]);
  const progressData = useMemo(() => telemetryHistory.map((event) => ({ timesteps: event.timesteps, progress: event.progress * 100, fps: event.fps })), [telemetryHistory]);
  const state = status?.state || "offline"; const run = status?.current_run; const canControl = Boolean(status && ["training", "paused", "starting"].includes(status.state)); const progress = status && status.total_timesteps ? Math.min(100, (status.timesteps / status.total_timesteps) * 100) : 0;

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Icon name="terminal" size={19} /></span><span>exterm</span><span className="brand-slash">/</span><span className="brand-context">RUN CONSOLE</span></div><div className="topbar-actions"><span className={`connection-pill ${connected ? "is-live" : ""}`}><span className="pulse-dot" />{connected ? "Connected" : "Disconnected"}</span><button className="icon-button" onClick={connected ? disconnect : connect} aria-label={connected ? "Disconnect from trainer" : "Connect to trainer"}><Icon name="wifi" /></button></div></header>
    <section className="hero-row"><div><p className="eyebrow"><Icon name="activity" size={14} /> TRAINING OBSERVABILITY</p><h1>{run?.env_id || "No active experiment"}</h1><p className="hero-subtitle">{run ? `${run.algorithm} policy · run ${run.run_id || "local"}` : "Connect to a trainer to start watching your agent learn."}</p></div><div className="hero-actions"><span className={`state-chip state-${state}`}>{state}</span>{!connected && <button className="button button-primary" onClick={connect}>Connect trainer</button>}</div></section>
    <section className="metric-grid" aria-label="Run summary"><Metric label="Progress" value={`${progress.toFixed(1)}%`} detail={`${(status?.timesteps || 0).toLocaleString()} / ${(status?.total_timesteps || 0).toLocaleString()} steps`} accent="lime" /><Metric label="Mean reward" value={status?.mean_reward_100 != null ? status.mean_reward_100.toFixed(1) : "—"} detail="rolling 100 episodes" accent="amber" /><Metric label="Episodes" value={(status?.episodes || 0).toLocaleString()} detail="completed rollouts" accent="violet" /><Metric label="Throughput" value={`${status?.fps || 0}`} detail="frames per second" accent="blue" /></section>
    <section className="panel chart-panel"><PanelHeader icon="activity" title="Reward dynamics" kicker="LIVE TELEMETRY"><span className="live-label"><span className="pulse-dot" /> {telemetryHistory.length ? "streaming" : "awaiting data"}</span></PanelHeader><div className="chart-meta"><div><strong>Agent performance</strong><span>Episode reward and rolling mean over time</span></div><div className="chart-legend"><span><i className="legend-swatch swatch-lime" />Reward</span><span><i className="legend-swatch swatch-amber" />Mean 100</span></div></div>{rewardData.length === 0 ? <EmptyState icon="activity" title={connected ? "Waiting for the first episode" : "Telemetry is offline"} detail={connected ? "The chart will populate as the trainer emits episode events." : "Connect to a running trainer to see live performance."} /> : <div className="chart-grid"><Chart data={rewardData} kind="reward" /><Chart data={progressData} kind="progress" /></div>}</section>
    <section className="lower-grid"><section className="panel replay-panel"><PanelHeader icon="play" title="Episode replay" kicker="LATEST ROLLOUT" /><EmptyState icon="play" title="Replay queue is ready" detail="Rendered episodes will appear here when the trainer records a rollout." action="Browse recordings" /></section><section className="panel timeline-panel"><PanelHeader icon="rotate" title="Steering timeline" kicker="AUDIT TRAIL" /><EmptyState icon="terminal" title="No steering actions yet" detail="Commands from the CLI will appear here with their diff and checkpoint." action="Open steering guide" /></section><section className="panel controls-panel"><PanelHeader icon="save" title="Run controls" kicker="COMMAND CENTER" /><div className="control-status"><span className={`state-dot state-dot-${state}`} /><div><strong>{state === "offline" ? "Trainer unavailable" : `Run is ${state}`}</strong><span>{status?.error || "Changes are applied to the connected trainer."}</span></div></div><div className="control-buttons"><button className="button button-soft" onClick={() => sendCommand("pause")} disabled={!canControl || state !== "training"}><Icon name="pause" size={15} />Pause</button><button className="button button-soft" onClick={() => sendCommand("resume")} disabled={!canControl || state !== "paused"}><Icon name="play" size={15} />Resume</button><button className="button button-danger" onClick={() => sendCommand("stop")} disabled={!canControl}><Icon name="stop" size={15} />Stop</button><button className="button button-outline" onClick={createCheckpoint} disabled={!canControl}><Icon name="save" size={15} />Checkpoint</button></div><div className="checkpoint-heading"><span>CHECKPOINTS</span><span>{checkpoints.length} saved</span></div>{checkpoints.length === 0 ? <p className="muted-copy">Checkpoints created during training will be listed here.</p> : <div className="checkpoint-list">{checkpoints.map((checkpoint) => <div className="checkpoint-row" key={checkpoint.checkpoint_id}><div><strong>{checkpoint.checkpoint_id}</strong><span>{checkpoint.timesteps.toLocaleString()} steps · {checkpoint.episode_count} episodes</span></div><button className="text-button" onClick={() => restoreCheckpoint(checkpoint.checkpoint_id)}><Icon name="rotate" size={14} />Restore</button></div>)}</div>}</section></section>
    <footer className="footer"><span>EXTERM CONTROL PLANE</span><span className="footer-host"><span className="pulse-dot" />{host.replace(/^https?:\/\//, "")}</span></footer>
  </main>;
}

function Chart({ data, kind }: { data: Array<Record<string, number | null | undefined>>; kind: "reward" | "progress" }) { return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 18, left: -20, bottom: 0 }}><CartesianGrid stroke="#27313b" strokeDasharray="3 5" vertical={false} /><XAxis dataKey={kind === "reward" ? "episode" : "timesteps"} tick={{ fill: "#6f7d8a", fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis yAxisId="left" domain={kind === "progress" ? [0, 100] : undefined} tick={{ fill: "#6f7d8a", fontSize: 11 }} axisLine={false} tickLine={false} />{kind === "progress" && <YAxis yAxisId="right" orientation="right" tick={{ fill: "#6f7d8a", fontSize: 11 }} axisLine={false} tickLine={false} />}<Tooltip contentStyle={{ background: "#111820", border: "1px solid #34414d", borderRadius: 8, color: "#e7edf2" }} /><Line yAxisId="left" type="monotone" dataKey={kind === "reward" ? "reward" : "progress"} stroke="#91d65b" strokeWidth={2.5} dot={false} />{kind === "reward" && <Line yAxisId="left" type="monotone" dataKey="meanReward" stroke="#e9aa52" strokeWidth={2} dot={false} />}{kind === "progress" && <Line yAxisId="right" type="monotone" dataKey="fps" stroke="#6fb7e8" strokeWidth={2} dot={false} strokeDasharray="5 5" />}</LineChart></ResponsiveContainer></div>; }
function Metric({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) { return <div className={`metric-card metric-${accent}`}><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-detail">{detail}</span></div>; }
function PanelHeader({ icon, title, kicker, children }: { icon: "activity" | "play" | "save" | "rotate"; title: string; kicker: string; children?: React.ReactNode }) { return <div className="panel-header"><div className="panel-title-group"><span className="panel-icon"><Icon name={icon} size={16} /></span><div><span className="panel-kicker">{kicker}</span><h2>{title}</h2></div></div>{children}</div>; }
function EmptyState({ icon, title, detail, action }: { icon: "activity" | "play" | "terminal"; title: string; detail: string; action?: string }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={22} /></span><strong>{title}</strong><span>{detail}</span>{action && <button className="text-button" type="button">{action} <span>↗</span></button>}</div>; }
export default App;
