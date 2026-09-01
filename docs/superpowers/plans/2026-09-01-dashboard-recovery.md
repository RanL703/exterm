# Dashboard Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `exterm dashboard` a reliable PRD-compliant monitoring client for live telemetry, replay videos, steering history, and run controls against local and remote trainers.

**Architecture:** Keep the trainer as the source of truth and introduce a small typed dashboard API layer for authenticated HTTP requests, WebSocket lifecycle, and normalized UI state. Build the four PRD panels from the existing trainer endpoints, adding only the missing transport behavior needed for video/auth and steering-log refresh. Preserve the current React/Vite/Recharts stack and fix the CLI launch path so runtime Vite configuration is initialized before any build or spawn operation.

**Tech Stack:** React 18, TypeScript, Vite, Recharts, browser WebSocket, FastAPI, Pydantic, Playwright, existing npm/uv workspace scripts.

**Spec:** `PRD.md` sections 5, 6.4, 6.6, 7, 8, and 9.

## Global Constraints

- The dashboard must provide four v1 panels: live reward/episode-length curves, episode replay/rendered rollout video, steering timeline, and run controls.
- The dashboard must work with a local or remote trainer; remote mode uses TLS plus a bearer token.
- Every steering action is versioned and the timeline shows the command, diff, checkpoint reference, and whether it was auto-applied or confirmed.
- Rollback must restore code and model weights as a pair through the trainer API.
- Experiment comparison, multi-user auth, distributed training, and MCP-addressable trainer behavior remain out of scope.
- Do not use fabricated chart points as production telemetry; empty and loading states must be explicit.
- Existing user modifications in the worktree are preserved; do not reset unrelated files.

## Evidence from the short feature test

- `npm run build` passes for both workspaces, so the issue is primarily runtime/integration behavior rather than TypeScript compilation.
- Authenticated Playwright smoke test against a real trainer reproduced a blank page immediately after the initial WebSocket `status` message and logged a Recharts error from `LineChart`.
- `packages/dashboard/src/App.tsx:344-355` renders a line with `yAxisId="right"` but declares no matching right `<YAxis>`; this is the direct render crash.
- `packages/dashboard/src/App.tsx:365-377` hardcodes “Video replay not yet implemented” even though `GET /api/v1/videos` and the streaming endpoint exist.
- `packages/dashboard/src/App.tsx:72` initializes `steeringHistory` once to an empty array and never reads `GET /api/v1/agent/log`, so the timeline cannot display actual steering actions.
- `trainer/exterm_trainer/server.py:497-537` sends initial status and live telemetry over WebSocket; `GET /api/v1/status` and `GET /api/v1/checkpoints` return successfully with the test bearer token.
- `packages/cli/src/commands/dashboard.ts:38` references `env` before its declaration at line 42 when a dashboard build is required; the existing `dist` directory masks this path during normal local testing.
- The trainer contract smoke test returned 200 for health, status, checkpoints, videos, and agent log, and received an initial WebSocket status message.

### Task 1: Make the dashboard mount and chart rendering deterministic

**Files:**
- Modify: `packages/dashboard/src/App.tsx`
- Modify: `packages/dashboard/src/index.css`
- Test: `packages/dashboard/tests/dashboard-render.spec.ts`

**Interfaces:**
- Consumes: `StatusResponse` and `TelemetryEvent` values from the trainer API/WS.
- Produces: A mounted dashboard with a valid dual-axis progress chart, explicit loading/empty/error states, and no synthetic telemetry.

- [ ] **Step 1: Write the failing Playwright test**

```ts
import { test, expect } from "@playwright/test";

test("renders the dashboard after receiving idle trainer status", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByText("Live Reward Curves")).toBeVisible();
  await expect(page.getByText("Episode Replay")).toBeVisible();
  await expect(page.getByText("Steering Timeline")).toBeVisible();
  await expect(page.getByText("Run Controls")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Video replay not yet implemented");
});
```

- [ ] **Step 2: Run it against the trainer and dashboard servers to verify the current render failure**

Run: `python3 .agents/skills/webapp-testing/scripts/with_server.py --server 'cd trainer && .venv/bin/python -m exterm_trainer --token test-token' --port 8765 --server 'VITE_TRAINER_TOKEN=test-token npm run dev --workspace=exterm-dashboard -- --host 0.0.0.0' --port 3000 -- npx playwright test packages/dashboard/tests/dashboard-render.spec.ts`

Expected: FAIL because the current Recharts tree throws before the dashboard remains mounted.

- [ ] **Step 3: Fix the smallest root cause and remove fake chart data**

Add `<YAxis yAxisId="right" ... />` to the progress chart before the FPS `<Line>`, keep the progress axis on `yAxisId="left"`, and render a text empty state until telemetry exists instead of the hardcoded points at `App.tsx:215-228`.

- [ ] **Step 4: Add stable panel sizing and accessible labels**

Give chart wrappers a non-zero responsive height at desktop and narrow widths, add `aria-label` values to control buttons, and ensure the grid collapses without clipping the replay and timeline panels.

- [ ] **Step 5: Run the focused render test**

Run: `npx playwright test packages/dashboard/tests/dashboard-render.spec.ts`

Expected: PASS with no page errors and all four panels visible.

### Task 2: Centralize authenticated trainer connectivity and telemetry state

**Files:**
- Create: `packages/dashboard/src/trainerClient.ts`
- Modify: `packages/dashboard/src/App.tsx`
- Modify: `packages/dashboard/src/vite-env.d.ts`
- Test: `packages/dashboard/tests/trainer-client.spec.ts`

**Interfaces:**
- Consumes: `VITE_TRAINER_HOST`, `VITE_TRAINER_TOKEN`, `/api/v1/status`, `/api/v1/checkpoints`, and `/ws`.
- Produces: `TrainerClient.getStatus()`, `TrainerClient.listCheckpoints()`, `TrainerClient.connect(onMessage)`, and `TrainerClient.sendCommand(action)` with normalized errors and cleanup.

- [ ] **Step 1: Write tests for URL normalization, bearer headers, and WebSocket token construction**

```ts
import { describe, expect, it } from "vitest";
import { buildWebSocketUrl, authHeaders } from "../src/trainerClient";

describe("trainer client transport", () => {
  it("normalizes an HTTP trainer URL to WS without duplicate slashes", () => {
    expect(buildWebSocketUrl("https://trainer.example/", "abc"))
      .toBe("wss://trainer.example/ws?token=abc");
  });

  it("adds bearer auth only when a token exists", () => {
    expect(authHeaders("abc")).toEqual({ "Content-Type": "application/json", Authorization: "Bearer abc" });
  });
});
```

- [ ] **Step 2: Run the tests to verify the client module is missing**

Run: `npm exec vitest run packages/dashboard/tests/trainer-client.spec.ts`

Expected: FAIL because the transport helpers do not yet exist.

- [ ] **Step 3: Implement the typed client and lifecycle guards**

Move HTTP and WebSocket code out of `App.tsx`; preserve the query-token WebSocket behavior required by FastAPI, reject non-2xx responses with endpoint/status detail, cancel reconnect timers on explicit disconnect, and expose connection/error state to the UI.

- [ ] **Step 4: Replace synthetic data and stale closures in `App.tsx`**

Use real telemetry only, reset histories when `run_id` changes, retain the last 1,000 events, and refresh status/checkpoints after control mutations. Show “connecting”, “trainer unavailable”, and “no telemetry yet” states distinctly.

- [ ] **Step 5: Run unit, build, and browser checks**

Run: `npm exec vitest run packages/dashboard/tests/trainer-client.spec.ts && npm run build && npx playwright test packages/dashboard/tests/dashboard-render.spec.ts`

Expected: PASS; the initial status message no longer crashes the page, and an idle trainer is represented as an idle dashboard rather than a fake curve.

### Task 3: Implement the episode replay panel using existing trainer video APIs

**Files:**
- Modify: `packages/dashboard/src/trainerClient.ts`
- Modify: `packages/dashboard/src/App.tsx`
- Modify: `trainer/exterm_trainer/server.py`
- Test: `packages/dashboard/tests/replay.spec.ts`
- Test: `trainer/tests/test_server.py`

**Interfaces:**
- Consumes: `GET /api/v1/videos?run_id=<id>` and `GET /api/v1/videos/{run_id}/{filename}`.
- Produces: A replay selector/list, authenticated video playback, loading/error/empty states, and safe filename handling.

- [ ] **Step 1: Add a backend test for authenticated video access**

```python
def test_video_endpoint_accepts_authenticated_request(client, monkeypatch, tmp_path):
    video = tmp_path / "episode-0.mp4"
    video.write_bytes(b"video")
    monkeypatch.setattr(server.runner, "get_video_path", lambda run_id, filename: video)
    response = client.get("/api/v1/videos/run-1/episode-0.mp4", headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("video/mp4")
```

- [ ] **Step 2: Decide and test browser authentication for the media request**

Use an authenticated `fetch` to retrieve the selected MP4 as a Blob and assign `URL.createObjectURL(blob)` to the `<video>` element, revoking the previous object URL on selection/unmount. This avoids relying on browsers sending custom Authorization headers for a plain media `src`.

- [ ] **Step 3: Implement video list state and selection**

Fetch videos after a connected status identifies a run, filter by the active `run_id`, sort newest first using `created_at`, and render the newest playable video by default. Display filename, episode/run metadata, and a clear empty state when no recordings exist.

- [ ] **Step 4: Add the Playwright replay test**

```ts
test("shows a playable replay when the trainer exposes a video", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.locator("video")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /episode/i })).toBeVisible();
});
```

- [ ] **Step 5: Run replay and backend tests**

Run: `pytest trainer/tests/test_server.py -q && npx playwright test packages/dashboard/tests/replay.spec.ts`

Expected: PASS with a real file-backed video and no unauthenticated media request.

### Task 4: Connect the steering timeline to the audit log

**Files:**
- Modify: `packages/dashboard/src/trainerClient.ts`
- Modify: `packages/dashboard/src/App.tsx`
- Modify: `trainer/exterm_trainer/server.py`
- Modify: `trainer/exterm_trainer/engine/runner.py`
- Test: `packages/dashboard/tests/steering-timeline.spec.ts`
- Test: `trainer/tests/test_server.py`

**Interfaces:**
- Consumes: `GET /api/v1/agent/log?limit=100` and `SteerResponse` data.
- Produces: Timeline entries showing instruction, timestamp, diff, applied/pending state, and checkpoint ID; refreshes after steering/confirmation.

- [ ] **Step 1: Write the failing UI test against a seeded agent log**

```ts
test("renders steering audit entries", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByText('"penalize jerky movements"')).toBeVisible();
  await expect(page.getByText(/Pending Confirmation|Applied|Confirmed/)).toBeVisible();
  await expect(page.getByText(/checkpoint/i)).toBeVisible();
});
```

- [ ] **Step 2: Add a refreshable client method and normalize `AgentActionLog`**

Map `instruction: null`, `diff: null`, and optional checkpoint IDs without crashing the renderer; sort entries newest first and preserve server order for equal timestamps.

- [ ] **Step 3: Implement refresh behavior**

Fetch the log after connection and after every dashboard-issued steer/confirm action. Until the dashboard has its own steering input, keep the timeline read-only but display the CLI-originated history; do not fabricate entries locally.

- [ ] **Step 4: Verify with trainer and browser tests**

Run: `pytest trainer/tests/test_server.py -q && npx playwright test packages/dashboard/tests/steering-timeline.spec.ts`

Expected: PASS with applied and pending entries rendered from the backend audit log.

### Task 5: Make run controls safe, observable, and PRD-complete

**Files:**
- Modify: `packages/dashboard/src/App.tsx`
- Modify: `packages/dashboard/src/trainerClient.ts`
- Modify: `packages/dashboard/src/index.css`
- Test: `packages/dashboard/tests/run-controls.spec.ts`

**Interfaces:**
- Consumes: WS `pause`, `resume`, `stop`; HTTP checkpoint create/restore; current `StatusResponse`.
- Produces: Controls that reflect server state, show request failures, prevent duplicate actions, and make rollback/restore explicit.

- [ ] **Step 1: Write control tests for state transitions and disabled actions**

```ts
test("enables only the valid actions for a training run", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Resume" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
});
```

- [ ] **Step 2: Add command acknowledgements and error feedback**

Track the last requested action, disable only the relevant button while it is in flight, and render an inline error when WS is closed or an HTTP call returns non-2xx. Do not silently ignore failed checkpoint creation or restore.

- [ ] **Step 3: Add checkpoint restore confirmation**

Before restore, show the checkpoint ID and timestep metadata in a confirmation dialog; after success, refresh status, checkpoints, videos, and steering log because rollback changes the active run view.

- [ ] **Step 4: Verify control behavior**

Run: `npx playwright test packages/dashboard/tests/run-controls.spec.ts`

Expected: PASS for training → paused → training and training → stopped, with failed requests visible to the user.

### Task 6: Fix CLI dashboard launch configuration and add a full smoke gate

**Files:**
- Modify: `packages/cli/src/commands/dashboard.ts`
- Create: `packages/dashboard/tests/dashboard-e2e.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `dashboardCommand({ host, port, open, token })`.
- Produces: A dashboard process that builds with the resolved host/token and then serves the same configuration it was built with.

- [ ] **Step 1: Write a regression test for the no-`dist` path**

Run the command in a temporary copied dashboard directory with its `dist` removed and assert the build child receives an environment object containing `VITE_TRAINER_HOST` and `VITE_TRAINER_TOKEN`; the current source fails because `env` is referenced before declaration.

- [ ] **Step 2: Move `env` initialization before the conditional build**

Construct the environment immediately after resolving `host` and `token`, pass it to `runCommand`, and pass the same object to `vite preview`. Preserve the current CLI behavior for `--no-open`.

- [ ] **Step 3: Add the end-to-end PRD smoke test**

Exercise: connect to authenticated trainer, display idle status, receive a live status/telemetry event, display a replay, display a seeded steering entry, create/list/restore a checkpoint using a test fixture, and verify pause/resume/stop requests. Keep the test data isolated under a temporary trainer working directory.

- [ ] **Step 4: Document supported dashboard startup modes**

Update `README.md` with local and remote examples, explicit token configuration, the `--no-open` option for headless environments, and the trusted-network limitation from PRD section 8.

- [ ] **Step 5: Run the complete verification suite**

Run: `npm run build && pytest trainer/tests -q && npx playwright test packages/dashboard/tests`

Expected: PASS with no browser console errors, all four PRD panels populated or showing truthful empty states, and no regressions in the existing trainer tests.

## Self-review against the PRD

- Live reward and episode-length visualization: Tasks 1 and 2 add real telemetry rendering; Task 6 covers the live smoke path.
- Episode replay/rendered rollout video: Task 3 uses the trainer’s existing list and stream APIs and solves browser bearer authentication.
- Steering timeline with diff/checkpoint/status: Task 4 reads the existing audit log and refreshes after actions.
- Pause/resume/rollback/kill controls: Task 5 covers pause, resume, stop, checkpoint, and restore confirmation.
- Local/remote and bearer-token behavior: Tasks 2, 3, and 6 cover HTTP, WS, and media transport paths.
- Reversibility and code/weight rollback pairing remain trainer-owned; the dashboard only invokes the existing restore endpoint and refreshes all dependent views.
- No comparison suite, multi-user auth, distributed training, or MCP wrapper is added.

Plan complete and saved to `docs/superpowers/plans/2026-09-01-dashboard-recovery.md`.
