import readline from "node:readline";
import { AgentTool } from "../agent/tools.js";

export interface McpToolDefinition { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; additionalProperties?: boolean }; }

export function createMcpServer(tools: AgentTool[], projectRoot: string) {
  const definitions: McpToolDefinition[] = tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: { type: "object", properties: {}, additionalProperties: true } }));
  return {
    listTools: () => definitions,
    async callTool(name: string, input: unknown) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`unknown tool: ${name}`);
      return tool.execute(input);
    },
    listResources: () => [
      { uri: "exterm://run/current", name: "Current RL run", mimeType: "application/json" },
      { uri: "exterm://project/config", name: "Project configuration", mimeType: "text/plain" },
    ],
    async readResource(uri: string) {
      if (uri === "exterm://run/current") return tools.find((tool) => tool.name === "trainer_status")!.execute({});
      if (uri === "exterm://project/config") return tools.find((tool) => tool.name === "project_read_file")!.execute({ path: "exterm.yaml" });
      throw new Error(`unknown resource: ${uri}`);
    },
    projectRoot,
  };
}

export async function runMcpStdio(server: ReturnType<typeof createMcpServer>, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let request: any;
    try { request = JSON.parse(line); } catch { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`); continue; }
    try {
      const result = request.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "exterm", version: "0.2.0" } }
        : request.method === "notifications/initialized" ? null
        : request.method === "tools/list" ? { tools: server.listTools() }
        : request.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify(await server.callTool(request.params.name, request.params.arguments || {})) }] }
        : request.method === "resources/list" ? { resources: server.listResources() }
        : request.method === "resources/read" ? { contents: [{ uri: request.params.uri, mimeType: "application/json", text: JSON.stringify(await server.readResource(request.params.uri)) }] }
        : request.method === "prompts/list" ? { prompts: [{ name: "exterm_steer", description: "Queue an RL steering request at a safe trainer point." }] }
        : request.method === "ping" ? {}
        : (() => { throw new Error(`method not found: ${request.method}`); })();
      if (request.id !== undefined) output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    } catch (error) {
      if (request.id !== undefined) output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }
}
