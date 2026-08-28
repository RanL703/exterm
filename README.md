# exterm ?

A terminal-native CLI tool to scaffold, train, and steer reinforcement learning agents using natural language.

## Architecture

exterm is client-server from day one:
1. **exterm CLI** (`packages/cli`): Node/TypeScript control plane (`npm i -g exterm`).
2. **exterm trainer** (`trainer`): Python FastAPI + Stable-Baselines3 + Gymnasium execution engine with HTTP + WebSocket API.
3. **exterm dashboard** (`packages/dashboard`): On-demand web dashboard (upcoming).

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
# Using local CLI
npm run cli -- train --env CartPole-v1 --algo PPO --steps 50000

# Or using the built bin directly
node ./packages/cli/bin/exterm.js train
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
node ./packages/cli/bin/exterm.js train --host http://<trainer-ip>:8765
```
