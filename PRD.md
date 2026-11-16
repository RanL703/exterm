# exterm — Product Requirements Document

## 1. Summary

**exterm** is a terminal-native tool for hobbyists and prototypers to scaffold, train, and steer reinforcement learning agents using natural language — in the spirit of Claude Code / Codex, but for RL. It orchestrates existing, battle-tested RL libraries (Stable-Baselines3, etc.) rather than reimplementing algorithms, and pairs the CLI with an on-demand web dashboard for visual monitoring. Training can run locally on a laptop or be offloaded to a remote/on-prem host, with the CLI and dashboard acting as thin clients against a trainer server.

Distributed via npm: `npm i -g exterm`.

## 2. Problem

Getting a modern RL experiment running today requires: picking an environment, picking an algorithm suited to it, tuning hyperparameters, writing boilerplate training loops, and building your own visualization to understand what's happening. Each step has a steep on-ramp for someone who just wants to try an idea ("what if my agent got penalized for jerky movements?") without becoming an RL engineer first.

## 3. Target user

Hobbyists and prototypers exploring RL ideas casually — not production ML teams. They value speed-to-first-result and expressive, low-friction iteration over configurability or rigor. They're comfortable in a terminal (same audience as Claude Code / Codex users).

## 4. Goals / non-goals

**Goals (v1)**
- Scaffold an RL project from a natural-language description in under a minute
- Train with strong, sensible defaults with zero manual hyperparameter tuning required
- Steer a training run mid-flight using natural language, with full transparency and reversibility
- Visualize a training run (local or remote) via an on-demand web dashboard
- Support running training on the same machine or offloaded to a remote/on-prem host
- Expose trainer and project operations to external coding agents through the bundled MCP server

**Non-goals (v1 — explicitly roadmap)**
- Generating novel custom environments from scratch (v1 only selects/configures from existing registries)
- Multi-agent / PettingZoo support
- Real auth / multi-user / org accounts
- Experiment comparison or tracking suite (W&B-style)
- Distributed / multi-GPU training

## 5. Product architecture

exterm is client-server from day one, with three clients talking to one trainer:

- **exterm CLI** — the control plane. Conversational scaffolding, training commands, live NL steering, runs wherever the user types.
- **exterm trainer** — the actual training loop (env + algo), runs locally by default or on a remote/on-prem host via `--host`. Exposes an HTTP+WS API.
- **exterm dashboard** — web UI, attaches to a running trainer (local or remote) as another client of the same API.

**Protocol**: bespoke lightweight HTTP + WebSocket, JSON payloads. WS streams live telemetry (reward curves, episode events, steering log) and accepts commands (steer, pause, checkpoint, rollback). HTTP handles one-off calls (list checkpoints, fetch a replay). The bundled MCP server exposes trainer and project operations to external coding agents in v1.

**Security (v1)**: local mode binds to `127.0.0.1` and uses a bearer token generated at trainer start. Remote mode requires TLS (WSS/HTTPS) with a certificate trusted by clients, plus a per-session bearer token generated at trainer start — no accounts, no org/user system. This is "trusted network" security, sufficient for testing offload, not a production security model.

## 6. Core features

### 6.1 Conversational scaffolding (`exterm init`)
- User describes what they want in natural language (e.g. "an agent that learns to balance a cart and prefers smooth actions")
- exterm selects an environment from Gymnasium / PettingZoo-adjacent registries (classic control, Atari, MuJoCo) matching the description
- exterm selects an algorithm and hyperparameters via the defaults table (6.3)
- Produces a project directory with config, ready to train

### 6.2 Training (`exterm train`)
- Runs locally by default; `--host <address>` offloads to a remote trainer
- Uses SB3 (or equivalent) implementations under the hood — PPO, DQN, SAC, DDPG, TD3, A2C at minimum
- Default training budget capped so a first run finishes in minutes on a laptop CPU (e.g. 100k–250k timesteps depending on env), clearly surfaced and adjustable

### 6.3 Strong defaults
Simple decision table, not per-run tuning:

| Env characteristic | Default algo | Notes |
|---|---|---|
| Discrete action space | PPO | Preferred over DQN for stability as a default |
| Continuous action space | SAC | PPO offered for simpler continuous tasks |
| Sparse reward / hard exploration | PPO + higher entropy bonus | User is flagged that env is "hard mode" |

Hyperparameters use known-good SB3 defaults per algorithm rather than custom-tuned values — differentiation is in UX/steering, not hyperparameter research.

### 6.4 Natural-language runtime steering
The core differentiator. While training is live, the user can type steering instructions (e.g. "make it more cautious," "penalize jerky movement more"), and exterm:
1. Translates the instruction into a concrete code change (reward function, wrapper, or hyperparameter) — full code-editing approach, not just a constrained whitelist
2. Generates a diff of the proposed change
3. Auto-checkpoints the current model state
4. **Auto-applies** small/scoped edits (single reward term, isolated function change)
5. **Requires confirmation** for higher-risk edits: changes to observation/action space shape, changes touching the core training loop, or anything the LLM itself flags as uncertain
6. Logs the action (diff + code version + checkpoint reference) to the steering timeline, visible in both CLI and dashboard

Every steering action is versioned. `exterm rollback` (or a dashboard control) reverts both the code (reward/env) and the model weights to any prior point together — code and weights are rolled back as a pair, never independently.

### 6.5 Scaffold-time vs runtime interaction
Two distinct conversational surfaces:
- **Scaffold-time** (`exterm init`): one-shot conversational setup, produces project structure
- **Runtime** (during `exterm train`): ongoing NL steering against a live run, per 6.4

### 6.6 Dashboard (`exterm dashboard`)
Launched on demand, points at a local or remote trainer. Four panels for v1:
- Live reward / episode-length curves
- Episode replay / rendered rollout video
- Steering timeline (every NL command, resulting diff, auto-applied vs confirmed)
- Run controls: pause, resume, rollback to checkpoint, kill

No multi-run comparison or experiment tracking in v1.

## 7. User flows

**Flow A — local prototyping**
1. `npm i -g exterm`
2. `exterm init` → describe the agent in NL → project scaffolded
3. `exterm train` → training starts locally with defaults
4. User types steering instructions in the CLI as training runs
5. `exterm dashboard` → opens local dashboard to watch curves/replays

**Flow B — remote/on-prem offload**
1. `exterm serve` started on remote/on-prem host → prints connection address + bearer token
2. `exterm train --host <address>` from local machine, training runs remotely
3. `exterm dashboard --host <address>` (or same command auto-detects) attaches to the remote trainer
4. Steering commands sent from local CLI apply to the remote run identically to local mode

## 8. Risks

- **Code-editing steering is the highest-risk feature.** LLM-authored reward/wrapper edits could silently degrade training if buggy. Mitigated by mandatory diff+checkpoint+rollback and confirmation gating on high-risk edit classes (5.4) — this is a required architectural component, not optional polish.
- **"Almost every basic RL model"** is bounded in v1 to what SB3 (or equivalent) supports well; broader algorithm coverage is a scope risk if not held to this line.
- **No accounts or organization-level access controls** means offload is only safe on trusted networks for v1 — this must be communicated clearly in docs/CLI output, not just assumed understood.

## 9. v1 cut line

**In scope**: `exterm init`, `exterm train` (local + `--host`), NL runtime steering with diff/checkpoint/rollback, `exterm dashboard` (4 panels, local + remote), PPO/DQN/SAC/DDPG/TD3/A2C via SB3, Gymnasium classic control + Atari + MuJoCo, TLS + bearer token for remote mode.

**Out of scope (roadmap)**: novel custom environment generation, multi-agent/PettingZoo, real auth/multi-user, experiment comparison/tracking, distributed/multi-GPU training.
