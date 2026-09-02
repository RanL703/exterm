# exterm

A terminal-native CLI for scaffolding, training, evaluating, and steering reinforcement learning agents.

## v1

v1 combines three pieces:

- `exterm`: a TypeScript terminal CLI with direct commands and a persistent coding-agent session.
- `exterm-trainer`: a Python FastAPI service running Gymnasium and Stable-Baselines3 jobs.
- Dashboard: a Vite/React observability console backed by the trainer’s HTTP and WebSocket APIs.

The CLI is local-first. Training remains owned by the trainer, code changes are bounded to the project, and queued steering is applied only after a completed training callback safe point.

## Architecture

exterm is client-server from day one:
1. **exterm CLI** (`packages/cli`): Node/TypeScript control plane (`npm i -g exterm`).
2. **exterm trainer** (`trainer`): Python FastAPI + Stable-Baselines3 + Gymnasium execution engine with HTTP + WebSocket API.
3. **exterm dashboard** (`packages/dashboard`): On-demand web dashboard for live training telemetry and artifacts.

## Quickstart

### Prerequisites
- Node.js >= 18
- Python >= 3.10 and [`uv`](https://docs.astral.sh/uv/)

### Installation & Setup

1. Clone repository and install dependencies:
```bash
npm install
npm run build
```

2. Setup Python trainer environment:
```bash
cd trainer
uv venv --python 3.12
uv pip install -e ".[dev]"
cd ..
```

### Running Training

Start training CartPole with PPO:
```bash
# Using the built CLI
node ./packages/cli/bin/exterm.js train

# With explicit run settings
node ./packages/cli/bin/exterm.js train --env CartPole-v1 --algo PPO --steps 50000
```

### Standalone Trainer Server

Run the trainer server explicitly on any machine:
```bash
npm run dev:trainer
# or
cd trainer && uv run python -m exterm_trainer --host 0.0.0.0 --port 8765
```

Connect your CLI to a remote/standalone trainer:
```bash
EXTERM_TOKEN=<trainer-token> node ./packages/cli/bin/exterm.js train --host http://<trainer-ip>:8765
```

The trainer prints a bearer token at startup. Set `EXTERM_TOKEN` for authenticated CLI and dashboard requests. For a fixed local token, pass `--token <token>` to the trainer command.

### Dashboard

Launch the production dashboard from the CLI after the trainer is available:

```bash
EXTERM_TOKEN=<trainer-token> node ./packages/cli/bin/exterm.js dashboard
```

Useful options:

```text
--host <url>       trainer URL (defaults to local autodetection)
--port <port>      dashboard port (default: 3000)
--no-open          keep the browser closed
--token <token>    trainer bearer token
```

The dashboard reads the same trainer status, telemetry, checkpoints, replay videos, steering queue, and audit events as the CLI. If port `3000` is occupied, choose another port with `--port 3001`.

### Interactive agent session

Run `exterm` with a TTY to open the persistent session. It streams trainer telemetry while accepting slash commands and natural-language requests through Ollama:

```bash
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=qwen3.5:9b
EXTERM_HOST=http://127.0.0.1:8765 \
EXTERM_TOKEN=<trainer-token> \
node ./packages/cli/bin/exterm.js
```

Useful commands:

```text
/model                 # list models available in Ollama
/model 2               # select a listed model
/train --steps 10000   # start a run
/steer favor stable    # queue a directive at the next safe point
/logs                  # show agent actions
/rollback              # list checkpoints
/rollback <checkpoint> # restore code and weights
/help
/exit
```

Natural-language input is handled by the selected Ollama model. `/model` reads `OLLAMA_BASE_URL/api/tags`; use `/model <number>` or `/model <name>` to change the model for later agent turns. Project edits are bounded to the current project, validated before training, and runtime steering is applied only at trainer safe points.

Direct command equivalents are available without an interactive session:

```text
exterm init                         scaffold a project
exterm train [options]              start a training run
exterm steer [instruction]          steer a running run
exterm rollback [options]           list or restore checkpoints
exterm dashboard [options]          launch the dashboard
exterm serve [options]              run the trainer
exterm mcp                          start the bundled MCP server
```

Use `node ./packages/cli/bin/exterm.js <command> --help` for command-specific options.

### Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXTERM_HOST` | `http://127.0.0.1:8765` | Trainer URL used by the interactive CLI and MCP server. |
| `EXTERM_TOKEN` | unset | Bearer token for authenticated trainer requests. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama URL used by the agent and `/model`. |
| `OLLAMA_MODEL` | `qwen3.5:9b` | Initial agent model; `/model` can change it for the session. |
| `VITE_TRAINER_HOST` | set by dashboard command | Trainer URL embedded into the dashboard build. |
| `VITE_TRAINER_TOKEN` | set by dashboard command | Trainer token embedded into the dashboard build. |

For remote trainers, use an HTTPS/WSS URL and supply the token explicitly. Do not commit tokens to shell scripts, project files, or MCP configuration checked into source control.

### Safety model

Exterm keeps training mutations behind the trainer service:

1. `/steer` queues a directive instead of editing during an optimizer or environment callback.
2. The trainer finishes the current callback and records a safe-point timestep.
3. A checkpoint is created before any code change.
4. Low-risk supported reward changes may apply automatically; high-risk changes remain pending until `/approve <request-id>`.
5. Validation failure leaves the previous code and model active.

The built-in agent can inspect project files, apply unified patches, validate the project, control runs, queue steering, and inspect artifacts. It has no generic shell tool. Local checkpoints and replay videos are runtime data and are ignored by Git.

### Bundled MCP server

Expose the same exterm-specific tools to another MCP-compatible coding agent over stdio:

```bash
EXTERM_HOST=http://127.0.0.1:8765 node ./packages/cli/bin/exterm.js mcp
```

The server exposes trainer status/control, safe-point steering, project file inspection and patching, validation, and artifact resources. It intentionally does not expose a generic shell tool. Configure the MCP client to launch the command with the same `EXTERM_HOST`, `EXTERM_TOKEN`, and working directory as the project being edited.

Example MCP process configuration:

```json
{
  "mcpServers": {
    "exterm": {
      "command": "node",
      "args": ["/absolute/path/to/exterm/packages/cli/bin/exterm.js", "mcp"],
      "env": {
        "EXTERM_HOST": "http://127.0.0.1:8765",
        "EXTERM_TOKEN": "<trainer-token>"
      }
    }
  }
}
```

The MCP transport is stdio; protocol messages are written to stdout, so keep human-readable logging on the client side.

## Troubleshooting

### CLI cannot connect

Confirm the trainer is listening and use the token printed at startup:

```bash
curl http://127.0.0.1:8765/health
EXTERM_HOST=http://127.0.0.1:8765 EXTERM_TOKEN=<trainer-token> node ./packages/cli/bin/exterm.js
```

### `/model` cannot reach Ollama

Check Ollama and its tags endpoint:

```bash
curl "$OLLAMA_BASE_URL/api/tags"
```

The selected model must support the Ollama chat/tool-calling flow for natural-language project edits. Slash commands such as `/status` and `/train` do not require Ollama.

### Steering is still queued

That is expected until the trainer reaches a completed callback safe point. Check `/status` and the dashboard event timeline. High-risk proposals additionally require `/approve <request-id>`.

### Dashboard is blank or points at the wrong trainer

Restart it with explicit values so the Vite build receives the correct endpoint:

```bash
EXTERM_HOST=http://127.0.0.1:8765 \
EXTERM_TOKEN=<trainer-token> \
node ./packages/cli/bin/exterm.js dashboard --no-open
```

## v1 verification

```bash
npm install
npm run build
cd trainer && uv pip install -e ".[dev]" && pytest -q
```

The trainer’s legacy `tests/test_server.py` health test currently hangs under the installed TestClient stack; investigate that harness issue separately if the full trainer suite does not return. The CLI build and focused session/model tests can be run with the Node test runner after compiling the test files to a temporary directory.
