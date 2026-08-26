# tts — Local-First AI Text-to-Speech SaaS

A production SaaS platform for AI speech generation. Core differentiator: **on-device inference** — when the user's browser supports it, TTS (Kokoro-82M via ONNX Runtime Web / WebGPU + WASM) runs entirely client-side, so user text never reaches our servers. Premium expressive/cloud generation and billing layer on top.

> Status: **M1 — repo & tooling foundation complete** (see `ROADMAP.md`). Implementation proceeds milestone-by-milestone. Next up: M2, local TTS MVP.

## Documentation

| File | Read for |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Workflow rules for AI coding agents & developers (start here) |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | Vision, users, plans, features, privacy positioning |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, stack, module layout, risks |
| [ROADMAP.md](ROADMAP.md) | Milestones M0–M8, acceptance criteria, current status |
| [DECISIONS.md](DECISIONS.md) | Architectural decision records (the "why") |
| [SECURITY.md](SECURITY.md) | Threat model and required controls |
| [PAYMENTS.md](PAYMENTS.md) | Billing/webhook/entitlement architecture |

## Stack (planned)

- **Frontend:** React 18 + TypeScript + Vite + Tailwind
- **Local inference:** kokoro-js → Transformers.js v3 → ONNX Runtime Web (WebGPU → WASM fallback), dedicated Web Worker
- **Backend:** Node 22 + Fastify, PostgreSQL (Drizzle), Redis
- **Payments:** provider-agnostic adapter (Stripe / merchant-of-record TBD)
- **Tooling:** pnpm workspaces, Vitest, Playwright, GitHub Actions

## Development

Requires Node.js 22+ and pnpm 10 (activated automatically via the `packageManager` field / corepack).

```bash
pnpm install          # install all workspace deps
pnpm dev              # web (:5173) + api (:3001) in watch mode
pnpm build            # build all workspaces
pnpm test             # unit/integration tests (Vitest)
pnpm test:e2e         # build + Playwright headless browser tests
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit across workspaces
pnpm format           # Prettier write
```

PostgreSQL/Redis are not required until M5 (`docker compose up -d` then).

## License

TBD before public release (product code proprietary; model weights Apache-2.0).
