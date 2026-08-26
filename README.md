# tts — Local-First AI Text-to-Speech SaaS

A production SaaS platform for AI speech generation. Core differentiator: **on-device inference** — when the user's browser supports it, TTS (Kokoro-82M via ONNX Runtime Web / WebGPU + WASM) runs entirely client-side, so user text never reaches our servers. Premium expressive/cloud generation and billing layer on top.

> Status: **M0 — architecture & documentation phase** (see `ROADMAP.md`). Implementation proceeds milestone-by-milestone.

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

Scaffolding lands in M1; commands will be documented in `AGENTS.md` at that point.

## License

TBD before public release (product code proprietary; model weights Apache-2.0).
