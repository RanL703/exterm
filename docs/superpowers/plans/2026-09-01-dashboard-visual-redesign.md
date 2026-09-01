# Dashboard Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard’s placeholder-heavy presentation with a refined, readable observability console while retaining the PRD’s four monitoring panels and existing trainer controls.

**Architecture:** Keep the current single-page React dashboard and trainer transport, but reorganize the shell into a header, metric strip, primary chart card, and three supporting cards. Centralize repeated visual primitives as local React components and use CSS variables, responsive grid rules, and inline SVG icons so the redesign adds no runtime dependency.

**Tech Stack:** React 18, TypeScript, Vite, Recharts, CSS.

**Spec:** `PRD.md` sections 6.6 and 7.

## Global Constraints

- Keep the four v1 panels: live curves, episode replay, steering timeline, and run controls.
- Preserve local/remote trainer host and bearer-token behavior.
- Never display fabricated telemetry as if it were real data.
- Keep the dashboard usable at desktop and mobile widths.
- Do not add a component framework or image dependency for this visual pass.

### Task 1: Redesign the application shell and panel hierarchy

**Files:** `packages/dashboard/src/App.tsx`, `packages/dashboard/src/index.css`

- [ ] Replace emoji headings and generic panels with a branded header, connection indicator, metric cards, clear section labels, and inline SVG icon components.
- [ ] Preserve current status/checkpoint/control handlers and add a matching right Y-axis for the FPS series so Recharts cannot crash.
- [ ] Replace fake fallback chart points with truthful loading/empty states.
- [ ] Keep the replay and timeline panels visibly intentional even before their data integrations are expanded.

### Task 2: Tune responsive behavior and interaction states

**Files:** `packages/dashboard/src/index.css`, `packages/dashboard/src/App.tsx`

- [ ] Add responsive breakpoints for the metric strip, chart split, and supporting-card grid.
- [ ] Add visible hover, focus, disabled, selected, and connection-error styles.
- [ ] Ensure controls remain keyboard accessible and have descriptive labels.

### Task 3: Verify the visual and runtime result

**Files:** `packages/dashboard/tests/dashboard-visual.spec.ts`

- [ ] Add a Playwright smoke test that waits for network idle, asserts all four panel labels, asserts no page errors, and captures a full-page screenshot at desktop and mobile widths.
- [ ] Run `npm run build`.
- [ ] Run the authenticated dashboard smoke test against local trainer and dashboard servers.

Plan complete and saved to `docs/superpowers/plans/2026-09-01-dashboard-visual-redesign.md`.
