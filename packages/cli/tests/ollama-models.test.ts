import { strict as assert } from "node:assert";
import test from "node:test";
import { listOllamaModels } from "../src/agent/ollama.js";

test("lists model names from Ollama tags", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: "qwen3.5:9b" }, { name: "llama3.2:3b" }] }) }) as Response;
  try {
    assert.deepEqual(await listOllamaModels("http://ollama.test/"), [{ name: "qwen3.5:9b" }, { name: "llama3.2:3b" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
