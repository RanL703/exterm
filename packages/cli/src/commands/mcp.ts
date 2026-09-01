import { createAgentTools } from "../agent/tools.js";
import { TrainerApiClient } from "../client/api.js";
import { createMcpServer, runMcpStdio } from "../mcp/server.js";

export async function mcpCommand(): Promise<void> {
  const host = process.env.EXTERM_HOST || "http://127.0.0.1:8765";
  const api = new TrainerApiClient(host, process.env.EXTERM_TOKEN);
  await runMcpStdio(createMcpServer(createAgentTools(process.cwd(), api), process.cwd()));
}
