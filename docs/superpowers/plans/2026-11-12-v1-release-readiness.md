# Exterm v1 Release Readiness Plan

> **For agentic workers:** Use the verification-before-completion skill throughout. Work task by task and keep the existing uncommitted changes intact.

**Goal:** Turn the implemented v1 CLI, trainer, dashboard, and MCP workflows into a coherent, verifiable release candidate.

**Architecture:** Keep the current CLI, FastAPI trainer, and React dashboard boundaries. First reconcile the written scope, then exercise the packaged CLI and its authenticated local/remote workflows, and finally complete a browser smoke pass and release checklist. Fix only defects demonstrated by these checks.

**Tech Stack:** Node.js 18+, TypeScript, npm workspaces, Python 3.10+, FastAPI, Gymnasium, Stable-Baselines3, Vite/React, pytest, Playwright.

**Spec:** `PRD.md`, with user-facing setup and safety instructions in `README.md`.

## Global Constraints

- Preserve the v1 cut line in `PRD.md`; do not add multi-user auth, experiment comparison, distributed training, or new environment families.
- Local trainer mode binds to `127.0.0.1`; remote use requires TLS and a bearer token as described in the PRD.
- Steering edits must keep diff visibility, checkpoints, safe-point application, confirmation for high-risk changes, and rollback.
- Keep the trainer-owned execution model and avoid adding dependencies for release checks when existing tools suffice.
- Preserve the current worktree, including uncommitted changes; do not reset, clean, or commit without a separate request.

---

## File Structure and Responsibilities

- `PRD.md`: authoritative v1 scope, architecture, and security contract. It currently says MCP is a v1 goal but also says MCP is considered for v2+.
- `README.md`: installation, quickstart, CLI/MCP configuration, safety model, troubleshooting, and verification commands.
- `packages/cli/package.json`, `packages/cli/bin/exterm.js`, and root npm workspace files: npm package contents and runnable entrypoint.
- `packages/cli/src/` and `packages/cli/tests/`: command behavior, MCP tool contracts, scaffolding, and CLI tests.
- `packages/dashboard/src/`: browser-facing telemetry, control, replay, and steering audit experience.
- `trainer/exterm_trainer/` and `trainer/tests/`: trainer API, run lifecycle, auth, steering, checkpointing, and artifacts.
- `docs/superpowers/plans/`: this release checklist and execution record.

## Skills and MCPs for Execution

- **Required: `verification-before-completion`** — establish evidence before each release-ready claim; run the full commands recorded below.
- **Required when a check fails: `systematic-debugging`** — reproduce and trace failures before making a fix.
- **Required for browser smoke coverage: `webapp-testing`** — exercise dashboard behavior with Playwright and inspect browser errors at desktop and mobile sizes.
- **Use only if visual changes become necessary: `frontend-design`** — preserve the existing visual direction while fixing user-visible dashboard defects.
- **Ponytail full is active for this session** — prefer the smallest release-blocking change and add a focused regression test for non-trivial fixes.
- **MCP tools:** use the connected Playwright MCP for browser checks if its local-browser controls are available; use filesystem MCP only if shell inspection is unavailable. No GitHub, LangSmith, or external service MCP is needed for this local release gate.

## Tasks

### Task 1: Make the v1 scope internally consistent

**Files:** `PRD.md`; verify references in `README.md`.

- [x] Decide the scope from the already-approved product state: bundled MCP is part of v1, as stated in the PRD goals and current README/CLI.
- [x] Update the architecture sentence that says MCP is considered for v2+ so it describes the bundled MCP server as a v1 client interface.
- [x] Search all scope statements for remaining MCP contradictions and check that README command/configuration examples agree.
- [x] Review the diff and run `git diff --check`.

**Deliverable:** one consistent statement of MCP scope; no behavior changes.

### Task 2: Reconcile and review the current worktree

**Files:** current changed files only; do not discard unrelated user work.

- [x] Record `git status --short`, `git diff --stat`, and `git diff --check` before review.
- [x] Review the CLI, trainer, dashboard, packaging, and test changes as separate groups; compare each change with the v1 requirements and existing callers.
- [x] Confirm every added behavior has a focused test, especially exact timestep completion, failed-run exit status, generated environment render mode, MCP required fields, and status timestep reporting.
- [x] Check the README’s install commands against actual npm scripts and Python package commands.
- [x] Keep only fixes required by a reproducible failure or a documented contract mismatch; do not reformat unrelated files.

**Deliverable:** an understood, internally consistent candidate diff with user changes preserved.

### Task 3: Verify package build and clean-install CLI path

**Files:** `package.json`, `package-lock.json`, `packages/cli/package.json`, `packages/cli/bin/exterm.js`, and CLI tests only if a failure requires a fix.

- [x] Run `npm ci` only if the existing install is stale or inconsistent with the lockfile; otherwise use the installed dependencies.
- [x] Run `npm run build`.
- [x] Run `npm test --workspace=exterm` and `npm run typecheck --workspace=exterm`.
- [x] Run `npm pack --dry-run --json --workspace=exterm` and verify the published file list contains the executable and required `dist` output.
- [x] In a temporary directory, install the packed tarball and execute `exterm --help`; also run one scaffold smoke flow if its dependencies are available.
- [x] Confirm failed training exits non-zero and a run reaching its requested budget exits successfully using existing focused tests or a local smoke run.

**Deliverable:** an installable npm artifact whose entrypoint and core CLI paths work outside the repository.

### Task 4: Verify trainer safety and API behavior

**Files:** `trainer/exterm_trainer/`, `trainer/tests/`, and README safety/security statements if the evidence shows a mismatch.

- [x] Run the full trainer suite with `cd trainer && ./.venv/bin/python -m pytest tests -q`.
- [x] Confirm the real-process steering checks run rather than skip in a normal local environment.
- [x] Verify authenticated status/control access, invalid-token rejection, safe-point steering, checkpoint-before-edit behavior, approval gating, rollback pairing of code and weights, and exact timestep stopping through existing tests or minimal focused regressions.
- [x] Review local bind defaults and remote TLS/token setup against the PRD and README. Do not claim remote security properties that the exercised server configuration does not provide.
- [x] For any failure, use systematic debugging, fix the shared root cause, add a narrow regression test, then rerun the affected test and full trainer suite.

**Deliverable:** trainer/API safety contract supported by passing automated tests and accurate docs.

### Task 5: Verify dashboard workflows in a browser

**Files:** `packages/dashboard/src/`, `packages/dashboard/package.json`, and dashboard tests or smoke harness only if needed.

- [x] Start the trainer and dashboard using a test token and a disposable run/artifact directory.
- [x] At desktop and mobile viewport sizes, verify initial/offline state, connected status and telemetry, pause/resume/stop controls, checkpoint creation/restore, replay selection/playback, and steering audit/diff rendering.
- [x] Inspect browser console and failed network requests; confirm token-authenticated API and video requests work.
- [x] Verify no horizontal overflow at mobile width and controls have accessible names and disabled states.
- [x] Run `npm run build`; note the known dashboard bundle-size warning and decide whether it is acceptable for this release. Do not split chunks without a demonstrated user impact.
- [x] Fix only reproducible issues; add regression coverage for behavior beyond a visual-only adjustment.

**Deliverable:** verified dashboard workflows at desktop and mobile sizes with no unexplained browser errors.

### Task 6: Final release gate and handoff

**Files:** `README.md`, `PRD.md`, and the candidate diff.

- [x] Run final `git diff --check`, `npm run build`, `npm test --workspace=exterm`, `npm run typecheck --workspace=exterm`, and the full trainer suite after all fixes.
- [x] Re-run the npm pack dry-run and installed-binary smoke if package files changed after Task 3.
- [x] Confirm quickstart, remote token/TLS caveat, MCP launch configuration, dashboard options, and verification commands match actual behavior.
- [x] Summarize passed commands, skips, warnings, changed files, and remaining limitations; keep release publication and Git commit as separate explicitly requested actions.

**Deliverable:** a reviewable release candidate and an evidence-based handoff; no publication or commit.

## Review Notes

- The current branch has a set of uncommitted changes spanning the PRD, README, npm configuration, CLI, dashboard, trainer, and tests. Execution must treat them as existing user work.
- The PRD’s MCP statements conflict: v1 Goals include MCP while Product architecture still says MCP is considered for v2+. Task 1 resolves this based on the accepted v1 implementation and documentation.
- The last recorded verification passed npm build, CLI tests/typecheck, and 20 trainer tests. The dashboard build reported a 539 kB minified chunk warning; trainer tests reported video-overwrite and PPO GPU warnings. These are known warnings to re-evaluate, not automatic release blockers.
- No plan requirement calls for a new dependency, a new service, GitHub changes, or release publication.
- Execution found and fixed three release issues: the `serve` CLI did not expose trainer TLS settings; the dashboard advertised training before model initialization and allowed an invalid early checkpoint; and stop/restart could overlap trainer workers. Checkpoint restore now also supports a run without project reward code.
- Final evidence: `npm run build`; CLI tests (8 passed); CLI typecheck; trainer tests (24 passed); packed npm install and `exterm --help`/`serve --help`; init scaffold smoke; and local Playwright checks for authenticated controls, pause/checkpoint/resume/stop, restore, replay playback, steering diff rendering, and mobile overflow.
- The remote TLS options and documentation were verified, but a remote TLS handshake using a client-trusted certificate was not exercised. Do not publish until that deployment path is checked in the intended hosting environment.
