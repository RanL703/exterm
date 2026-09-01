# exterm Agentic CLI — Product Requirements Document

**Status:** Proposed v1.0

**Product:** exterm, a terminal-native coding agent for reinforcement-learning experiments.

**Audience:** Hobbyists and prototypers who want to describe an RL idea, let an agent create or modify the experiment, run training, and steer it without leaving the terminal.

## 1. Product intent

exterm should feel like a modern coding agent: one persistent terminal session, a compact slash-command surface, readable live logs, an input prompt that remains available while work runs, and an agent that can inspect and edit the project with transparent diffs.

The domain-specific difference is the work unit. The agent operates on an RL project, trainer, run state, reward/environment code, checkpoints, telemetry, and replay artifacts. The existing web dashboard remains the visual monitoring surface; the CLI is the control plane and conversational workspace.

## 2. Problem

The current CLI exposes useful isolated commands, but not a coherent session. `train` owns a blocking loop, steering edits can be requested while the trainer is in an unsafe part of the loop, natural-language edits are limited to the reward wrapper, and there is no general project-aware agent that can inspect files, write custom training code, validate it, and start a run.

Users need to be able to:

1. Start exterm once and keep working while training runs.
2. Type `/train`, `/status`, `/pause`, `/checkpoint`, or `/steer ...` while logs stream.
3. Enter a natural-language directive at any time and have it queued rather than lost or applied mid-step.
4. See what the agent is about to change, what it changed, which checkpoint protects it, and whether it was applied automatically or needs confirmation.
5. Ask the agent to create or modify an RL project, run validation, and launch training using the same tools.

## 3. Goals

- Provide one persistent interactive CLI session for project work and live training.
- Make slash commands predictable and scriptable while keeping natural language available.
- Queue runtime directives and apply them at a documented trainer safe point.
- Preserve code + model rollback as an atomic user-visible operation.
- Give the agent bounded coding tools: inspect files, edit files, run validation, control training, and inspect artifacts.
- Bundle a small exterm-specific MCP server with the CLI so external coding agents can use the same trainer capabilities.
- Keep the dashboard as a client of the same HTTP/WebSocket API, not a second source of truth.
- Maintain local-first operation and support remote trainers with bearer tokens/TLS.

## 4. Non-goals for v1

- Rebuilding Claude Code, Codex, or a general-purpose IDE.
- Autonomous long-horizon experimentation without user-visible checkpoints and approvals.
- Arbitrary shell execution by the model.
- Direct model-weight editing outside trainer-owned checkpoint APIs.
- Multi-user collaboration, organization accounts, or distributed training.
- Bundling a full GitHub integration by default. GitHub access is an optional adapter after the local workflow is stable.
- Replacing the existing dashboard.

## 5. Core experience

### 5.1 Session startup

`exterm` with no subcommand opens an interactive session in the current project. It discovers `exterm.yaml` (or the existing project configuration), resolves the trainer, and prints a compact welcome block:

```text
exterm 0.2.0 · RL coding agent
project  ./cartpole-smooth
trainer  local · connected

Type /help for commands. Describe a change in plain language.
exterm>
```

`exterm train` remains supported as a direct non-session command for scripts and compatibility. It uses the same session/runtime modules underneath.

### 5.2 Slash commands

The v1 command set is intentionally small:

| Command | Behavior |
|---|---|
| `/train [options]` | Validate project/config and start a run. |
| `/status` | Show current run state, progress, reward, FPS, and queued work. |
| `/pause` | Request pause at the next trainer callback boundary. |
| `/resume` | Resume a paused run. |
| `/stop` | Stop after the current safe callback boundary. |
| `/checkpoint [label]` | Save a named or generated checkpoint. |
| `/steer <instruction>` | Queue a natural-language runtime change. |
| `/approve <id>` | Apply a pending high-risk change. |
| `/rollback <id>` | Restore code and weights together. |
| `/dashboard` | Launch or print the dashboard URL. |
| `/logs [n]` | Show recent run and agent events. |
| `/clear` | Clear the visible terminal transcript only. |
| `/help` | Show commands and examples. |
| `/exit` | Close the CLI session; explicitly choose whether training continues. |

Unknown slash commands return a suggestion instead of being sent to the LLM as ordinary prose.

### 5.3 Natural-language agent mode

Input that does not begin with `/` is an agent request. Examples:

- “Create a CartPole project that rewards surviving longer but penalizes abrupt action changes.”
- “The mean reward has plateaued; inspect the latest telemetry and suggest one low-risk change.”
- “Add a custom observation feature, validate it, and show me the diff before starting training.”

The agent may use only the built-in project/trainer tools. Every file mutation is shown as a diff. The agent must run the relevant validation command before starting or resuming training after a code change.

### 5.4 Live output and input

Training renders a stable live block with run ID, environment, algorithm, progress, speed, ETA, episodes, reward range, and current state. Log events appear below it. The input line remains available while telemetry arrives.

The terminal session must not lose typed input when a telemetry redraw occurs. Commands are serialized through one session event loop; a second command can be accepted while the first agent action is pending, but trainer mutations execute in order.

## 6. Safe-point steering protocol

### 6.1 User-visible semantics

When a user submits `/steer penalize jerky movements` during training:

1. The CLI immediately prints `queued` with the current progress and a request ID.
2. The trainer finishes the current environment/model callback invocation.
3. The trainer pauses at a safe boundary and emits `steering_window_open` with the last completed timestep.
4. The agent reads the project, current telemetry, and active run configuration.
5. The agent creates a checkpoint before editing.
6. The agent proposes a diff and risk level.
7. Low-risk scoped edits are applied at the safe point; high-risk edits wait for `/approve <id>`.
8. The trainer reloads the affected reward/wrapper configuration only at the boundary, emits `steering_applied` or `steering_pending`, and resumes if appropriate.
9. The timeline records request ID, directive, diff, checkpoint ID, safe-point timestep, actor, status, and error if any.

“After 66%” therefore means the first safe callback boundary at or after the request, not an unsafe interruption in the middle of an optimizer/environment operation.

### 6.2 Safety rules

- Never write project code from the callback thread.
- Never mutate model weights independently from a checkpoint record.
- Never apply a code edit without a pre-edit checkpoint.
- The default auto-apply scope is one known reward function body or one explicitly supported config field.
- Observation/action shape changes, training-loop changes, dependency changes, arbitrary file creation, and uncertain parses require approval.
- Validation failure leaves the prior code and model active and records the failed proposal.
- Queue capacity is bounded to 20 requests; duplicate pending directives are coalesced only when their normalized text matches exactly.

## 7. Agent tools

The initial tool set is deliberately narrow:

1. `project_list_files` — list files below the project root, excluding virtualenv/build/cache directories.
2. `project_read_file` — read a bounded text file inside the project root.
3. `project_apply_patch` — apply a unified patch after showing it to the user.
4. `project_validate` — run the project’s configured validation command with a timeout and captured output.
5. `trainer_status` — read current state and telemetry.
6. `trainer_start` — start a run from validated config.
7. `trainer_control` — pause, resume, stop, checkpoint, restore, or rollback.
8. `trainer_queue_steer` — enqueue a safe-point steering request.
9. `trainer_artifacts` — list checkpoints, videos, and audit events.

The agent cannot call a generic shell tool. A future explicit `/shell` feature would require a separate threat model and approval design.

## 8. Bundled MCP surface

The CLI ships an stdio MCP server invoked by `exterm mcp`. It exposes the same nine domain operations as MCP tools with JSON schemas and no duplicated trainer logic. MCP calls use the configured trainer host/token and project root.

Required resources/prompts are minimal:

- Resource `exterm://run/current` — current run status.
- Resource `exterm://project/config` — sanitized project configuration.
- Prompt `exterm_steer` — safe-point steering request template.

The MCP server is for external agents calling exterm; it is not a second trainer API. GitHub integration is an optional future package/adapter and is not installed or enabled by default.

## 9. Configuration and compatibility

- Existing `exterm train`, `exterm steer`, `exterm rollback`, `exterm dashboard`, and `exterm serve` continue to work.
- New project metadata lives in `exterm.yaml`; existing scaffold output must be migrated or read compatibly.
- `EXTERM_HOST`, `EXTERM_TOKEN`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL` remain supported.
- Local default remains `127.0.0.1`; remote mode requires explicit host and token, with TLS validation left to the configured URL/client.
- The agent provider is initially the existing Ollama/LangGraph path. Provider abstraction is a small interface, not a provider marketplace.

## 10. Success criteria

- A user can launch one CLI session, start a 10,000-step CartPole run, observe streaming telemetry, and issue `/pause`, `/checkpoint`, `/resume`, and `/stop` without losing input.
- A steering request submitted during a run is applied only at a recorded safe point and never mutates code from the training callback thread.
- A high-risk proposal is visible with a diff and cannot apply without `/approve`.
- Rollback restores both reward code and model weights and returns the run to a known state.
- A natural-language request can inspect and modify a project, pass validation, and start training with all mutations visible.
- `exterm mcp` can be connected by an external MCP client and perform read-only status/artifact operations plus explicitly requested mutations.
- Existing CLI/trainer/dashboard builds and smoke tests remain green.

## 11. Acceptance test

From a fresh CartPole project:

```text
exterm
/train --steps 10000
/status
/checkpoint baseline
/steer penalize jerky movements
/status
/approve <proposal-id>       # only if risk requires it
/pause
/resume
/rollback <baseline-id>
/dashboard
/stop
/exit
```

The transcript must show ordered events, safe-point timing, diffs, checkpoint IDs, final state, and no lost commands. A parallel MCP client must be able to read the same status and audit log.
