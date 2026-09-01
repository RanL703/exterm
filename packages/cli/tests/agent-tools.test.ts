import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TrainerApiClient } from "../src/client/api.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { createAgentTools } from "../src/agent/tools.js";

test("project_read_file rejects paths outside the project root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "exterm-agent-"));
  await writeFile(path.join(root, "README.md"), "hello");
  const read = createAgentTools(root, new TrainerApiClient("http://127.0.0.1:8765")).find((tool) => tool.name === "project_read_file");
  await assert.rejects(() => read!.execute({ path: "../secret.txt" }), /outside project root/);
});

test("agent runtime exposes named tools and is explicit when no provider is configured", async () => {
  const tools = createAgentTools(process.cwd(), new TrainerApiClient("http://127.0.0.1:8765"));
  const runtime = new AgentRuntime(tools);
  assert.equal(runtime.getTool("trainer_status").name, "trainer_status");
  assert.match((await runtime.run("inspect this run")).message, /provider is not configured/);
});
