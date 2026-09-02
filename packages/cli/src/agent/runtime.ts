import { AgentTool } from "./tools.js";

export interface AgentTurnResult {
  message: string;
  tool?: string;
  result?: unknown;
  diffs?: string[];
}

export type AgentExecutor = (input: string, tools: AgentTool[]) => Promise<AgentTurnResult>;

export class OllamaAgentExecutor {
  constructor(private readonly baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434", private readonly model = process.env.OLLAMA_MODEL || "qwen3.5:9b") {}

  async execute(input: string, tools: AgentTool[]): Promise<AgentTurnResult> {
    const diffs: string[] = [];
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: "You are exterm, an RL coding agent. Inspect project files before editing. Explain planned mutations, use project_apply_patch for changes, validate code before training, and use trainer_queue_steer for runtime directives. Never invent telemetry or claim a mutation succeeded unless the tool returned success. Do not request shell access." },
      { role: "user", content: input },
    ];
    const definitions = tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: { type: "object", additionalProperties: true } } }));

    for (let turn = 0; turn < 8; turn += 1) {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, stream: false, messages, tools: definitions }) });
      if (!response.ok) throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
      const payload = await response.json() as { message?: { role?: string; content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> } };
      const message = payload.message;
      if (!message) throw new Error("Ollama returned no message");
      messages.push(message as Record<string, unknown>);
      if (!message.tool_calls?.length) return { message: message.content || "Agent completed without a text response.", diffs };

      for (const call of message.tool_calls) {
        const tool = tools.find((candidate) => candidate.name === call.function.name);
        if (!tool) throw new Error(`agent requested unknown tool: ${call.function.name}`);
        const argumentsValue = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments;
        let result: unknown;
        try { result = await tool.execute(argumentsValue); } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
        if (tool.name === "project_apply_patch" && (result as { ok?: boolean }).ok && typeof argumentsValue === "object" && argumentsValue && "patch" in argumentsValue && typeof argumentsValue.patch === "string") diffs.push(argumentsValue.patch);
        messages.push({ role: "tool", content: JSON.stringify(result) });
      }
    }
    throw new Error("agent exceeded the 8-turn tool limit");
  }
}

export class AgentRuntime {
  constructor(private readonly tools: AgentTool[], private readonly executor?: AgentExecutor) {}

  async run(input: string): Promise<AgentTurnResult> {
    if (!this.executor) return { message: "Agent provider is not configured. Use a slash command or configure an Ollama agent provider." };
    return this.executor(input, this.tools);
  }

  getTool(name: string): AgentTool {
    const tool = this.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`unknown agent tool: ${name}`);
    return tool;
  }
}
