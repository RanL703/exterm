import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { selectAlgoDefaults } from "../src/init/algoDefaults.js";
import { ENV_REGISTRY } from "../src/init/envMatcher.js";
import { scaffoldProject } from "../src/init/scaffolder.js";

test("generated reward environments accept the trainer's render mode", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "exterm-scaffold-"));
  try {
    const env = ENV_REGISTRY.find((item) => item.id === "CartPole-v1")!;
    await scaffoldProject(dir, { projectName: "cartpole", description: "balance a pole", env, algo: selectAlgoDefaults(env), totalTimesteps: 1000 });
    const reward = await readFile(path.join(dir, "reward.py"), "utf8");
    assert.match(reward, /def make_env\(env_id: str = "CartPole-v1", render_mode: str \| None = None\):/);
    assert.match(reward, /gym\.make\(env_id, render_mode=render_mode\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
