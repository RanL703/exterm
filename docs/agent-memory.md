# Exterm implementation memory

Updated: 2026-09-02

## Product

Exterm is a local-first RL training platform: a TypeScript CLI, Python FastAPI/Stable-Baselines3 trainer, and dashboard. The CLI should feel like a coding agent while remaining focused on training, safe-point steering, checkpoints, telemetry, and reproducible testing.

## Architecture

- CLI: `packages/cli`; TypeScript, Node 18, Commander, `readline`, `ws`, `picocolors`.
- Trainer: `trainer/exterm_trainer`; `TrainerApiClient` and `TrainerWebSocketClient` are the transport seams.
- Trainer runner owns model, environment, checkpoints, videos, and safe-point queue state.
- Dashboard consumes trainer HTTP/WebSocket state; do not create a second training state machine.
- Existing Ollama agent graph is in `trainer/exterm_trainer/agent/graph.py`.
- The interactive natural-language session router is `trainer/exterm_trainer/agent/session.py`. It is a LangGraph state graph with deterministic steering/scaffolding classification and a bounded LangChain tool loop for trainer questions/control.
- The CLI sends free-form turns to `POST /api/v1/agent/session`; session history is held by the trainer process for the lifetime of the CLI session ID.

## Completed CLI work

- Persistent interactive session with slash commands and natural-language Ollama turns.
- Serialized readline command handling so rapid commands do not race.
- Safe-point steering queue with `/steer` and `/approve`.
- Bounded project/trainer agent tools; no generic shell tool.
- Bundled `exterm mcp` newline-delimited JSON-RPC server exposing the domain tools.
- Ollama `/model` support, committed as `1ae23c4`: `/model` lists `$OLLAMA_BASE_URL/api/tags`; `/model 1` or `/model <name>` selects the model for later agent turns.
- `/edit <request>` routes to the bounded Ollama project tools, applies unified patches under the project root, and prints each applied patch in the interactive CLI.
- Interactive CLI telemetry is intentionally quiet; the dashboard owns live charts while the CLI reports steering lifecycle events, diffs, and terminal run transitions.
- Local artifacts `.agents/`, `.claude/`, `trainer/checkpoints/`, and `trainer/videos/` are ignored.

## Steering implementation

- `trainer/exterm_trainer/agent/validation.py` parses generated reward source, rejects structural edits and undefined names, then executes the reward wrapper in an isolated subprocess against cached CartPole/LunarLander-shaped samples.
- `TrainingRunner` loads the project `reward.py` when starting a run, hot-swaps the reward wrapper only at a queue safe point, and writes reward source through a temporary file before replacement.
- Checkpoints contain model weights and reward source. Rollback restores source first, loads the model into a temporary object, then publishes it and hot-reloads the wrapper.
- Queue events expose `rationale`, `risk_level`, `checkpoint_id`, `applied`, and `rolled_back` fields. Invalid edits emit `validation_failed` and never reach the live runner.
- Safe standard constructors (`dict`, `list`, `set`, and `tuple`) are allowed by the validator; filesystem/network/process calls remain blocked.
- `tests/test_steering_process.py` starts a real trainer subprocess and uses only a fake Ollama HTTP server; it covers hard-landing, inverse-speed, and confirm-required instructions. Socket creation is denied in the managed sandbox, so these tests are skipped here and run in normal CI/dev environments.

## Useful verification

```bash
npm run build
rm -rf packages/cli/.tmp-test
npx tsc --module NodeNext --moduleResolution NodeNext --target ES2022 --outDir packages/cli/.tmp-test packages/cli/src/session/events.ts packages/cli/src/session/commands.ts packages/cli/src/session/session.ts packages/cli/src/agent/ollama.ts packages/cli/tests/session-events.test.ts packages/cli/tests/session-commands.test.ts packages/cli/tests/ollama-models.test.ts
node --test packages/cli/.tmp-test/tests/*.test.js
rm -rf packages/cli/.tmp-test
```

The server tests use the installed async ASGI transport; the full trainer suite completes successfully in the current environment.

## Working rules

- Preserve unrelated dirty worktree changes: `package-lock.json`, `package.json`, dashboard command, trainer dependency/reward files, `trainer/tests/test_server.py`, `trainer/uv.lock`, dashboard Vite types, and `skills-lock.json` were already dirty.
- Commit every meaningful change with a focused message.
- Use `apply_patch` for edits. Keep implementation minimal and reuse existing clients/services.
- Before claiming completion, run the build and focused tests and report any failures.

## Current verification

```bash
npm run build
npm run typecheck --workspace=exterm
npm test --workspace=exterm
cd trainer && ./.venv/bin/python -m pytest tests/test_agent_session.py tests/test_steering_validation.py tests/test_steering_agent.py tests/test_checkpoint_rollback.py tests/test_steering_process.py -q
```

Expected result: CLI tests pass, TypeScript builds/typechecks, and the trainer suite reports `16 passed, 3 skipped` in the restricted workspace. The three skips are the socket-based real-process tests when the OS denies local binds.
