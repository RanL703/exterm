import { readFile } from "node:fs/promises";
import path from "node:path";
import { TrainerApiClient } from "../client/api.js";

export interface ExtermSkill {
  name: string;
  description: string;
  env?: string;
  algo?: string;
  steps?: number;
  steering?: string;
}

const defaults: ExtermSkill[] = [
  { name: "cartpole-ppo", description: "Small PPO baseline for CartPole.", env: "CartPole-v1", algo: "PPO", steps: 50000 },
  { name: "smooth-landings", description: "Penalize hard landings at the next safe point.", steering: "penalize hard landings more" },
];

export async function loadSkills(projectRoot = process.cwd()): Promise<ExtermSkill[]> {
  try {
    const content = await readFile(path.join(projectRoot, "exterm.skills.json"), "utf8");
    const custom = JSON.parse(content) as ExtermSkill[];
    return [...defaults, ...custom.filter((skill) => skill.name && !defaults.some((item) => item.name === skill.name))];
  } catch {
    return defaults;
  }
}

export async function applySkill(skill: ExtermSkill, api: TrainerApiClient): Promise<string> {
  if (skill.steering) {
    const response = await api.queueSteer({ instruction: skill.steering });
    if (response.state === "rejected") throw new Error(response.message);
    return `steering queued · request ${response.request_id}`;
  }
  if (!skill.env || !skill.algo || !skill.steps) throw new Error(`skill ${skill.name} has no runnable action`);
  const response = await api.startRun({ run_id: Math.random().toString(36).slice(2, 10), env_id: skill.env, algorithm: skill.algo, total_timesteps: skill.steps, hyperparameters: {} });
  return `run started · ${skill.env} · ${skill.algo} · ${response.state}`;
}
