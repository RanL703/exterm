import { strict as assert } from "node:assert";
import test from "node:test";
import { CommandRegistry } from "../src/session/commands.js";
import { runConfigFromArgs } from "../src/session/session.js";

test("unknown slash commands return help instead of reaching the model", async () => {
  const seen: string[] = [];
  const registry = new CommandRegistry({ help: async () => { seen.push("help"); } });
  await registry.execute("wat", []);
  assert.deepEqual(seen, ["help"]);
});

test("session train arguments become a normal run config", () => {
  const config = runConfigFromArgs(["--env", "Acrobot-v1", "--algo", "DQN", "--steps", "1200"]);
  assert.match(config.run_id || "", /^[a-z0-9]{8}$/);
  assert.equal(config.env_id, "Acrobot-v1");
  assert.equal(config.algorithm, "DQN");
  assert.equal(config.total_timesteps, 1200);
  assert.deepEqual(config.hyperparameters, {});
});
