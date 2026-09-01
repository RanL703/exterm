import { strict as assert } from "node:assert";
import test from "node:test";
import { parseSlashCommand } from "../src/session/events.js";

test("parses a slash command without touching natural-language input", () => {
  assert.deepEqual(parseSlashCommand("/steer penalize jerky actions"), {
    name: "steer",
    args: ["penalize", "jerky", "actions"],
  });
  assert.equal(parseSlashCommand("reward smoother actions"), null);
});

test("normalizes command names and treats an empty slash as help", () => {
  assert.deepEqual(parseSlashCommand(" /STATUS "), { name: "status", args: [] });
  assert.deepEqual(parseSlashCommand("/"), { name: "help", args: [] });
});
