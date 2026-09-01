import readline from "node:readline";
import pc from "picocolors";
import { TrainerApiClient } from "../client/api.js";
import { TrainerWebSocketClient } from "../client/ws.js";
import { AgentRuntime, OllamaAgentExecutor } from "../agent/runtime.js";
import { createAgentTools } from "../agent/tools.js";
import { listOllamaModels } from "../agent/ollama.js";
import { RunConfig, StatusMessage, TelemetryEvent } from "../types.js";
import { CommandRegistry } from "./commands.js";
import { parseSlashCommand } from "./events.js";

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
  private commandQueue: Promise<void> = Promise.resolve();
  private readonly agent: AgentRuntime;
  private readonly ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  private agentModel = process.env.OLLAMA_MODEL || "qwen3.5:9b";

  constructor(private readonly options: InteractiveSessionOptions) {
    this.api = new TrainerApiClient(options.host, options.token);
    this.ws = new TrainerWebSocketClient(options.host, options.token);
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.agent = new AgentRuntime(createAgentTools(process.cwd(), this.api), (input, tools) => new OllamaAgentExecutor(this.ollamaBaseUrl, this.agentModel).execute(input, tools));
    this.commands = new CommandRegistry({
      help: async () => this.help(),
      train: async (args) => this.train(args),
      status: async () => this.status(),
      pause: async () => this.control("pause"),
      resume: async () => this.control("resume"),
      stop: async () => this.control("stop"),
      checkpoint: async () => this.checkpoint(),
      steer: async (args) => this.steer(args.join(" ")),
      approve: async (args) => this.approve(args[0]),
      model: async (args) => this.model(args),
      dashboard: async () => this.write(`  dashboard  ${this.options.host.replace(/^http/i, "http").replace(/:8765$/, ":3000")}`),
      clear: async () => this.write("\x1b[2J\x1b[H"),
      exit: async () => this.close(),
      quit: async () => this.close(),
    });
  }

  async run(): Promise<void> {
    await this.ws.connect();
    this.ws.onStatus((status) => this.onStatus(status));
    this.ws.onTelemetry((event) => this.onTelemetry(event));
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
      else {
        this.write(pc.dim(`  agent  ${input}`));
        const result = await this.agent.run(input);
        this.write(result.message);
      }
    } catch (error) {
      this.write(pc.red(`  error  ${error instanceof Error ? error.message : String(error)}`));
    }
    if (!this.closed) this.rl?.prompt();
  }

  private async status(): Promise<void> {
    const status = await this.api.getStatus();
    this.write(`  ${status.state} · ${status.timesteps.toLocaleString()}/${status.total_timesteps.toLocaleString()} steps · ${status.episodes.toLocaleString()} episodes · ${status.fps} fps`);
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

  private async help(): Promise<void> {
    this.write(pc.dim("  /train [--env CartPole-v1 --algo PPO --steps 50000] /model [name|number] /status /pause /resume /stop /checkpoint /steer /approve /dashboard /clear /exit"));
  }

  private onStatus(status: StatusMessage): void {
    if (status.state === "failed") this.write(pc.red(`  trainer failed  ${status.error || "unknown error"}`));
    if (["completed", "stopped"].includes(status.state)) this.write(pc.green(`  run ${status.state}`));
  }

  private onTelemetry(event: TelemetryEvent): void {
    const progress = (event.progress * 100).toFixed(1);
    this.write(pc.dim(`  telemetry  ${progress}% · ${event.episode_count} episodes · ${event.fps} fps${event.episode_reward == null ? "" : ` · reward ${event.episode_reward.toFixed(1)}`}`));
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
