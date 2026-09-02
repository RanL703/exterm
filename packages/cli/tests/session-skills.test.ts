import { strict as assert } from "node:assert";
import test from "node:test";
import { applySkill, loadSkills } from "../src/session/skills.js";

test("loads built-in skills without a project file", async () => {
  const skills = await loadSkills("/tmp/exterm-no-such-project");
  assert.deepEqual(skills.map((skill) => skill.name), ["cartpole-ppo", "smooth-landings"]);
});

test("applies a steering skill through the trainer client", async () => {
  const calls: unknown[] = [];
  const api = { queueSteer: async (request: unknown) => { calls.push(request); return { state: "queued", request_id: "r1" }; } };
  const message = await applySkill({ name: "smooth-landings", description: "", steering: "penalize hard landings more" }, api as never);
  assert.equal(message, "steering queued · request r1");
  assert.deepEqual(calls, [{ instruction: "penalize hard landings more" }]);
});
