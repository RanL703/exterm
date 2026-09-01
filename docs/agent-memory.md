# Exterm implementation memory

Updated: 2026-09-01

## Product

Exterm is a local-first RL training platform: a TypeScript CLI, Python FastAPI/Stable-Baselines3 trainer, and dashboard. The CLI should feel like a coding agent while remaining focused on training, safe-point steering, checkpoints, telemetry, and reproducible testing.

## Architecture

- CLI: `packages/cli`; TypeScript, Node 18, Commander, `readline`, `ws`, `picocolors`.
- Trainer: `trainer/exterm_trainer`; `TrainerApiClient` and `TrainerWebSocketClient` are the transport seams.
- Trainer runner owns model, environment, checkpoints, videos, and safe-point queue state.
- Dashboard consumes trainer HTTP/WebSocket state; do not create a second training state machine.
- Existing Ollama agent graph is in `trainer/exterm_trainer/agent/graph.py`.

## Completed CLI work

- Persistent interactive session with slash commands and natural-language Ollama turns.
- Serialized readline command handling so rapid commands do not race.
- Safe-point steering queue with `/steer` and `/approve`.
- Bounded project/trainer agent tools; no generic shell tool.
- Bundled `exterm mcp` newline-delimited JSON-RPC server exposing the domain tools.
- Ollama `/model` support, committed as `1ae23c4`: `/model` lists `$OLLAMA_BASE_URL/api/tags`; `/model 1` or `/model <name>` selects the model for later agent turns.
- Local artifacts `.agents/`, `.claude/`, `trainer/checkpoints/`, and `trainer/videos/` are ignored.

## Useful verification

```bash
npm run build
rm -rf packages/cli/.tmp-test
npx tsc --module NodeNext --moduleResolution NodeNext --target ES2022 --outDir packages/cli/.tmp-test packages/cli/src/session/events.ts packages/cli/src/session/commands.ts packages/cli/src/session/session.ts packages/cli/src/agent/ollama.ts packages/cli/tests/session-events.test.ts packages/cli/tests/session-commands.test.ts packages/cli/tests/ollama-models.test.ts
node --test packages/cli/.tmp-test/tests/*.test.js
rm -rf packages/cli/.tmp-test
```

The existing `trainer/tests/test_server.py` `TestClient` health test currently hangs, even with a managed lifespan; do not claim the full trainer suite passes until that separate harness issue is diagnosed.

## Working rules

- Preserve unrelated dirty worktree changes: `package-lock.json`, `package.json`, dashboard command, trainer dependency/reward files, `trainer/tests/test_server.py`, `trainer/uv.lock`, dashboard Vite types, and `skills-lock.json` were already dirty.
- Commit every meaningful change with a focused message.
- Use `apply_patch` for edits. Keep implementation minimal and reuse existing clients/services.
- Before claiming completion, run the build and focused tests and report any failures.

## Next CLI targets

1. Finish session parity with existing direct commands: `/logs`, `/rollback`, and useful checkpoint output.
2. Add concise README/CLI help for interactive mode, model selection, MCP, and steering.
3. Verify a real local trainer smoke path, then only add missing behavior exposed by that test.
