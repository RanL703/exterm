import { strict as assert } from "node:assert";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { createMcpServer, runMcpStdio } from "../src/mcp/server.js";

test("MCP exposes trainer_status and does not expose shell", () => {
  const server = createMcpServer([{ name: "trainer_status", description: "status", execute: async () => ({ state: "idle" }) }], process.cwd());
  assert.ok(server.listTools().some((tool) => tool.name === "trainer_status"));
  assert.equal(server.listTools().some((tool) => tool.name === "shell"), false);
});

test("MCP stdio responds to initialize and tools/list", async () => {
  const server = createMcpServer([], process.cwd());
  const output: string[] = [];
  const writable = new Writable({ write(chunk, _encoding, callback) { output.push(chunk.toString()); callback(); } });
  await runMcpStdio(server, Readable.from([
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`,
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
  ]), writable);
  assert.equal(JSON.parse(output[0]).result.serverInfo.name, "exterm");
  assert.deepEqual(JSON.parse(output[1]).result.tools, []);
});
