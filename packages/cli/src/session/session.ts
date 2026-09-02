import readline from "node:readline";
import pc from "picocolors";
import { TrainerApiClient } from "../client/api.js";
import { TrainerWebSocketClient } from "../client/ws.js";
import { listOllamaModels } from "../agent/ollama.js";
import { AgentRuntime, OllamaAgentExecutor } from "../agent/runtime.js";
import { createAgentTools } from "../agent/tools.js";
import { RunConfig, StatusMessage } from "../types.js";
import { CommandRegistry } from "./commands.js";
import { parseSlashCommand } from "./events.js";
import { applySkill, loadSkills } from "./skills.js";
import { launchDashboard } from "./dashboard.js";

export interface InteractiveSessionOptions {
  host: string;
  token?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class InteractiveSession {
  private readonly api: TrainerApiClient;
  private readonly ws: TrainerWebSocketClient;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly commands: CommandRegistry;
  private rl: readline.Interface | null = null;
  private closed = false;
  private lastTerminalRunState = "";
  private commandQueue: Promise<void> = Promise.resolve();
  private readonly ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  private agentModel = process.env.OLLAMA_MODEL || "qwen3.5:9b";
  private readonly sessionId = Math.random().toString(36).slice(2, 10);

  constructor(private readonly options: InteractiveSessionOptions) {
    this.api = new TrainerApiClient(options.host, options.token);
    this.ws = new TrainerWebSocketClient(options.host, options.token);
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.commands = new CommandRegistry({
      help: async () => this.help(),
      train: async (args) => this.train(args),
      status: async () => this.status(),
      pause: async () => this.control("pause"),
      resume: async () => this.control("resume"),
      stop: async () => this.control("stop"),
      checkpoint: async () => this.checkpoint(),
      logs: async () => this.logs(),
      rollback: async (args) => this.rollback(args[0]),
      steer: async (args) => this.steer(args.join(" ")),
      approve: async (args) => this.approve(args[0]),
      model: async (args) => this.model(args),
      skills: async (args) => this.skills(args),
      mcp: async () => this.write(pc.yellow("  MCP is not available as an interactive session tool yet; use `exterm mcp` for the bundled stdio server.")),
      dashboard: async (args) => this.dashboard(args),
      edit: async (args) => this.edit(args.join(" ")),
      clear: async () => this.write("\x1b[2J\x1b[H"),
      exit: async () => this.close(),
      quit: async () => this.close(),
    });
  }

  async run(): Promise<void> {
    await this.ws.connect();
    this.ws.onStatus((status) => this.onStatus(status));
    this.ws.onMessage((message) => this.onTrainerMessage(message as { type: string; request_id?: string; message?: string; checkpoint_id?: string; diff?: string }));
    this.write(pc.bold(pc.cyan("\n  exterm")) + pc.dim(" · RL coding agent"));
    this.write(pc.dim(`  trainer  ${this.options.host}`));
    this.write(pc.dim("  Type /help for commands. Describe a change in plain language."));

    this.rl = readline.createInterface({ input: this.input, output: this.output, terminal: true, prompt: pc.cyan("exterm> ") });
    this.rl.on("line", (line) => {
      this.commandQueue = this.commandQueue.then(() => this.handleLine(line));
    });
    this.rl.on("close", () => this.close());
    this.rl.prompt();
  }

  private async handleLine(line: string): Promise<void> {
    const input = line.trim();
    if (!input || this.closed) { this.rl?.prompt(); return; }
    const command = parseSlashCommand(input);
    try {
      if (command) await this.commands.execute(command.name, command.args);
      else if (looksLikeProjectEdit(input)) {
        await this.edit(input);
      } else {
        this.write(pc.dim(`  agent  ${input}`));
        const result = await this.api.agentSession(this.sessionId, input, this.agentModel);
        this.write(pc.dim(`  ${result.route}`));
        this.write(result.message);
      }
    } catch (error) {
      this.write(pc.red(`  error  ${error instanceof Error ? error.message : String(error)}`));
    }
    if (!this.closed) this.rl?.prompt();
  }

  private async status(): Promise<void> {
    const status = await this.api.getStatus();
    this.write(pc.dim(`  trainer  ${this.options.host}`));
    this.write(`  ${status.state} · ${status.timesteps.toLocaleString()}/${status.total_timesteps.toLocaleString()} steps · ${status.episodes.toLocaleString()} episodes · ${status.fps} fps`);
    const queue = await this.api.listSteeringQueue();
    for (const event of queue.items.slice(-3)) {
      this.write(pc.dim(`  steering  ${String(event.request_id)} · ${String(event.state)}${event.safe_point_timestep == null ? "" : ` · safe point ${event.safe_point_timestep}`}`));
    }
  }

  private async train(args: string[]): Promise<void> {
    const config = runConfigFromArgs(args);
    const status = await this.api.startRun(config);
    this.write(pc.green(`  run ${config.run_id} started · ${config.env_id} · ${config.algorithm} · ${config.total_timesteps.toLocaleString()} steps`));
    this.write(pc.dim(`  trainer is ${status.state}; telemetry will stream below`));
  }

  private async control(action: "pause" | "resume" | "stop"): Promise<void> {
    const status = action === "pause" ? await this.api.pauseRun() : action === "resume" ? await this.api.resumeRun() : await this.api.stopRun();
    this.write(pc.green(`  ${action} requested · trainer is ${status.state}`));
  }

  private async checkpoint(): Promise<void> {
    const checkpoint = await this.api.createCheckpoint();
    this.write(pc.green(`  checkpoint ${checkpoint.checkpoint_id} saved at ${checkpoint.timesteps.toLocaleString()} steps`));
  }

  private async logs(): Promise<void> {
    const response = await this.api.getAgentLog();
    if (response.logs.length === 0) { this.write(pc.dim("  no agent actions recorded")); return; }
    for (const entry of response.logs) {
      const timestamp = typeof entry.timestamp === "number" ? new Date(entry.timestamp * 1000).toISOString() : "unknown time";
      const action = typeof entry.action_type === "string" ? entry.action_type : "action";
      const instruction = typeof entry.instruction === "string" ? entry.instruction : "";
      this.write(`  ${pc.dim(timestamp)}  ${action}  ${instruction}`);
    }
    this.write(pc.dim(`  ${response.total} total agent actions`));
  }

  private async rollback(checkpointId?: string): Promise<void> {
    if (!checkpointId) {
      const response = await this.api.listCheckpoints();
      if (response.checkpoints.length === 0) { this.write(pc.yellow("  no checkpoints found")); return; }
      for (const [index, checkpoint] of response.checkpoints.entries()) this.write(`  ${index + 1}. ${checkpoint.checkpoint_id} · ${checkpoint.timesteps.toLocaleString()} steps · ${checkpoint.env_id}`);
      this.write(pc.dim("  usage  /rollback <checkpoint-id|steering-event-id>"));
      return;
    }
    const queue = await this.api.listSteeringQueue();
    const isEvent = queue.items.some((event) => event.request_id === checkpointId);
    const response = await this.api.rollback(isEvent ? { event_id: checkpointId } : { checkpoint_id: checkpointId });
    this.write(response.success ? pc.green(`  rollback complete · ${response.message}`) : pc.red(`  rollback failed · ${response.message}`));
  }

  private async steer(instruction: string): Promise<void> {
    if (!instruction) { this.write(pc.yellow("  usage  /steer <instruction>")); return; }
    this.write(pc.dim(`  steering  ${instruction}`));
    const response = await this.api.queueSteer({ instruction });
    if (response.state === "rejected") throw new Error(response.message);
    this.write(pc.green(`  steering queued · request ${response.request_id} · position ${response.queue_position ?? "ready"}`));
  }

  private async approve(requestId?: string): Promise<void> {
    if (!requestId) { this.write(pc.yellow("  usage  /approve <request-id>")); return; }
    const response = await this.api.approveQueuedSteer(requestId);
    this.write(pc.green(`  steering approved · checkpoint ${response.checkpoint_id}`));
  }

  private async model(args: string[]): Promise<void> {
    const models = await listOllamaModels(this.ollamaBaseUrl);
    if (args.length === 0) {
      this.write(`  ollama  ${this.ollamaBaseUrl}`);
      if (models.length === 0) { this.write(pc.yellow("  no models found")); return; }
      for (const [index, model] of models.entries()) this.write(`  ${index + 1}. ${model.name}${model.name === this.agentModel ? pc.green("  (selected)") : ""}`);
      return;
    }

    const requested = args.join(" ");
    const index = /^\d+$/.test(requested) ? Number(requested) - 1 : -1;
    const selected = index >= 0 ? models[index]?.name : requested;
    if (!selected || !models.some((candidate) => candidate.name === selected)) throw new Error(`model not found: ${requested}`);
    this.agentModel = selected;
    this.write(pc.green(`  model selected  ${selected}`));
  }

  private async skills(args: string[]): Promise<void> {
    const skills = await loadSkills();
    if (args[0] !== "apply") {
      this.write("  skills");
      for (const skill of skills) this.write(`  ${skill.name} · ${skill.description}`);
      this.write(pc.dim("  usage  /skills apply <name>"));
      return;
    }
    const skill = skills.find((candidate) => candidate.name === args[1]);
    if (!skill) throw new Error(`skill not found: ${args[1] || ""}`);
    this.write(pc.green(`  ${await applySkill(skill, this.api)}`));
  }

  private async dashboard(args: string[]): Promise<void> {
    const portFlag = args.indexOf("--port");
    const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 4173;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("dashboard port must be between 1 and 65535");
    this.write(pc.dim(`  dashboard  starting on port ${port}`));
    this.write(pc.green(`  dashboard  ${await launchDashboard(this.options.host, this.options.token, port)}`));
  }

  private async edit(request: string): Promise<void> {
    if (!request) { this.write(pc.yellow("  usage  /edit <file change request>")); return; }
    this.write(pc.dim(`  agent  editing project files`));
    const executor = new OllamaAgentExecutor(this.ollamaBaseUrl, this.agentModel);
    const runtime = new AgentRuntime(createAgentTools(process.cwd(), this.api), (input, tools) => executor.execute(input, tools));
    const result = await runtime.run(request);
    for (const diff of result.diffs || []) this.showDiff(diff);
    this.write(result.message);
  }

  private async help(): Promise<void> {
    this.write(pc.dim("  /train [--env CartPole-v1 --algo PPO --steps 50000] /model [name|number] /edit <request> /skills [apply name] /mcp /status /pause /resume /stop /checkpoint /logs /rollback [id] /steer /approve /dashboard [--port 4173] /clear /exit"));
  }

  private onStatus(status: StatusMessage): void {
    if (status.state === "failed") this.write(pc.red(`  trainer failed  ${status.error || "unknown error"}`));
    const terminalKey = `${status.run_id || "local"}:${status.state}`;
    if (["completed", "stopped"].includes(status.state) && terminalKey !== this.lastTerminalRunState) {
      this.lastTerminalRunState = terminalKey;
      this.write(pc.green(`  run ${status.state}`));
    }
  }

  private onTrainerMessage(message: { type: string; request_id?: string; message?: string; checkpoint_id?: string; diff?: string }): void {
    if (message.type === "steering_window_open") this.write(pc.yellow(`  steering window open · request ${message.request_id}`));
    if (message.type === "steering_pending") {
      this.write(pc.yellow(`  steering pending approval · request ${message.request_id}`));
      this.showDiff(message.diff);
    }
    if (message.type === "steering_applied") {
      this.write(pc.green(`  steering applied · request ${message.request_id} · checkpoint ${message.checkpoint_id}`));
      this.showDiff(message.diff);
    }
    if (message.type === "steering_failed") this.write(pc.red(`  steering failed · ${message.message || "validation failed"}`));
  }

  private showDiff(diff?: string): void {
    if (diff) this.write(`\n${diff}\n`);
  }

  private write(message: string): void { this.output.write(`${message}\n`); }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rl?.close(); this.rl = null; this.ws.close();
    this.write(pc.dim("  session closed"));
  }
}

export function runConfigFromArgs(args: string[]): RunConfig {
  const value = (flag: string, fallback: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] || fallback : fallback; };
  return { run_id: Math.random().toString(36).slice(2, 10), env_id: value("--env", "CartPole-v1"), algorithm: value("--algo", "PPO"), total_timesteps: Number(value("--steps", "50000")), hyperparameters: {} };
}

function looksLikeProjectEdit(input: string): boolean {
  return /\b(edit|modify|patch|refactor)\b/i.test(input) && /(?:[\w/-]+\.(?:py|ts|tsx|js|json|md)|\bfile\b)/i.test(input);
}
