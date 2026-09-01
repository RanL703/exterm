import { AgentTool } from "./tools.js";

export interface AgentTurnResult {
  message: string;
  tool?: string;
  result?: unknown;
}

export type AgentExecutor = (input: string, tools: AgentTool[]) => Promise<AgentTurnResult>;

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
