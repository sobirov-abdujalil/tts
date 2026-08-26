# AGENTS.md — Working Rules for AI Coding Agents

This document governs how any AI coding agent (or human developer) works in this repository. Read it before every task. It is the entry point; the other docs in the root contain the details.

## Project Summary

A production SaaS web application for AI text-to-speech. Core differentiator: **local-first inference** — when the user's device supports it, TTS runs entirely in the user's browser (Kokoro-82M via ONNX Runtime Web), so user text never reaches our servers for local generation. Premium expressive/cloud generation and billing are layered on top of that foundation.

**This is a commercial product, not a demo.**

## Documentation Map

Read these before working on anything:

| File | Contents |
| --- | --- |
| `AGENTS.md` | This file — workflow rules |
| `PRODUCT_SPEC.md` | What we are building: vision, plans, features, privacy positioning |
| `ARCHITECTURE.md` | How it is built: stack, module layout, inference design, risks |
| `ROADMAP.md` | Milestones M1–M8 with acceptance criteria; current status |
| `DECISIONS.md` | Architectural Decision Records — why things are the way they are |
| `SECURITY.md` | Threat model and required security controls |
| `PAYMENTS.md` | Billing architecture: webhooks, idempotency, entitlements |

If you change architecture or behavior in a way these documents describe incorrectly, update the documents in the same change.

## Hard Rules

1. **Work milestone-by-milestone.** Never start work on a later milestone while an earlier one is incomplete. Check `ROADMAP.md` for current status.
2. **Plan before code.** For any non-trivial task: read relevant docs → inspect existing code → state an implementation plan → then implement.
3. **Minimal changes.** Do not refactor, reformat, or "improve" code outside the scope of your task.
4. **No duplicate implementations.** Before adding a utility/feature, search the repo for an existing one. One source of truth per concept (plan config, voice registry, audio encoding, etc.).
5. **Never silently change an architectural decision.** If a decision in `DECISIONS.md` looks wrong, document the problem and stop for review before changing course.
6. **No secrets in code.** No API keys, tokens, or credentials in frontend bundles, test fixtures that run in CI, or git history. Server secrets come from environment variables only.
7. **The server is authoritative.** Never implement authorization, plan status, usage limits, or pricing based on client-side state (`localStorage`, React state). Client state is UI convenience only.
8. **Privacy invariant.** Local-mode TTS text and audio must never be transmitted to the backend, logged server-side, or included in analytics payloads. If your change could route user text to the network, stop and justify it explicitly.
9. **Schema changes only via migrations.** Never hand-edit a production database schema. Every schema change gets a migration file committed with the code that needs it.
10. **Tests are part of the feature.** A feature without tests is not done. See Testing section below.

## Repository Layout

```
apps/
  web/        # React + TypeScript + Vite frontend (SPA + prerendered marketing pages)
  api/        # Node.js + Fastify backend (auth, billing, cloud generation)
packages/
  tts-engine/ # Browser inference core: provider abstraction, capability detection,
              #   benchmarking, Kokoro provider (framework-agnostic, no React)
  audio/      # Audio pipeline: WAV encode/decode, chunking, pause insertion,
              #   concatenation (usable from worker and main thread)
  shared/     # Shared types, zod schemas, plan configuration (single source of truth)
docs/         # (optional) longer-form design docs; root files stay canonical
```

Do not create parallel structures (`src/lib/...` at repo root, second `utils` package, etc.). This structure exists since M1.

## Commands

Canonical since Milestone 1. Update this section if tooling changes.

```bash
pnpm install                 # install all workspace deps
pnpm dev                     # run apps/web (+ apps/api where relevant) in dev
pnpm build                   # build all workspaces
pnpm test                    # unit + integration tests (Vitest)
pnpm test:e2e                # Playwright browser tests
pnpm lint                    # ESLint
pnpm typecheck               # tsc --noEmit across workspaces
```

Package manager: **pnpm** (workspaces). Node.js LTS (22+).

## Definition of Done (per milestone / per PR)

- Requested functionality works as specified.
- Tests written and passing (`pnpm test`, plus e2e where applicable).
- `pnpm lint` and `pnpm typecheck` clean.
- `pnpm build` succeeds.
- No unrelated functionality broken.
- Security implications reviewed against `SECURITY.md`.
- Documentation updated if architecture/behavior changed.
- Git commit made with a meaningful message.
- Known limitations recorded (in the milestone's acceptance criteria notes or an issue).

## Git Conventions

- Commit after every stable checkpoint. Message style: imperative summary line, e.g. `feat(engine): kokoro worker with cancellation support`.
- Milestone completion is tagged per `ROADMAP.md`: `v0.1-foundation`, `v0.2-local-tts`, `v0.3-browser-inference`, etc.
- Never force-push shared branches; never rewrite history that others may depend on.

## Verification Checklist for Browser-Inference Work

When touching `packages/tts-engine` or anything running in a Worker:

- Main thread stays responsive during model load and generation (no synchronous heavy work off-worker).
- Cancellation actually stops inference promptly (worker terminated or session interrupted), not just ignores results.
- Model download progress is reported and models are cached (verify second-load does not re-download).
- Fallback path works when WebGPU is unavailable (WASM) and when WASM threads are unavailable (single-threaded).
- Memory is released after generation (buffers dereferenced; no unbounded accumulation over repeated generations).
- Errors surface as typed, user-understandable failures — not silent hangs or console-only errors.
