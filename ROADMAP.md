# ROADMAP.md

Milestones are strictly sequential. A milestone is **complete** only when its acceptance criteria pass, tests/lint/typecheck/build are green, docs are updated, and a git checkpoint (commit + tag) exists.

**Current status: M2 complete — local TTS MVP (tag `v0.2-local-tts`). Next: M3.**

---

## M0 — Foundation Docs ✅
Architecture proposal, product spec, risk register, decision log. No application code.

---

## M1 — Repo & Tooling Foundation ✅ → tag `v0.1-foundation`
Monorepo scaffolding and development infrastructure.

Scope:
- pnpm workspaces: `apps/web` (React+TS+Vite+Tailwind), `apps/api` (Fastify+TS skeleton with /health), `packages/{tts-engine,audio,shared}` stubs
- TypeScript strict config shared via workspace base; ESLint + Prettier; Vitest wired in every package; Playwright installed with one smoke test
- GitHub Actions CI: lint, typecheck, test, build
- docker-compose for Postgres + Redis (used from M5)
- `.env.example`, editorconfig, README quickstart

Acceptance criteria:
- [x] `pnpm install && pnpm dev` serves the app skeleton
- [x] CI runs all checks on PR and passes on main
- [x] Example unit test per package executes green
- [x] Playwright smoke test loads the page headlessly

## M2 — Local TTS MVP → tag `v0.2-local-tts`
A working browser-local TTS application (happy path).

Scope:
- `packages/tts-engine`: Kokoro provider wrapping kokoro-js (q8, WASM first), load with progress
- Dedicated Web Worker with message protocol (load/generate/cancel/result)
- `packages/audio`: WAV encoding of single-chunk output
- Minimal workspace UI: textarea, voice dropdown (from shared registry subset), Generate, progress bar, inline player, download WAV
- Model cached by Transformers.js Cache API (verify second-load offline behavior)

Acceptance criteria:
- [x] Desktop Chrome/Edge: enter text → hear speech without any request carrying the text (verified by `e2e/generate.local.spec.ts` network assertions; run with `E2E_LOCAL_MODEL=1 pnpm test:e2e`)
- [x] First generation downloads model with visible progress; second visit does not re-download (Cache API via transformers.js + kokoro voice cache; asserted in gated e2e)
- [x] Cancel during generation stops work promptly (worker termination, D-015; unit-tested; worker respawns on next use)
- [x] Main thread stays responsive during generation (all inference in a dedicated module Web Worker)
- [x] Unit tests: wav encoder, worker protocol, provider lifecycle/state machine, shared validation/registry; e2e: generate-and-download flow (WASM) behind `E2E_LOCAL_MODEL=1`

Known M2 limitations (carried into M3): single-chunk generation (2,000-char interim cap), speed control not yet in UI, no capability-detection card or speed estimates (estimates return null until the M3 micro-benchmark), WebGPU+q8 quality unvalidated per R2.

## M3 — Production Local Inference → tag `v0.3-browser-inference`
Robustness for real-world text and devices.

Scope:
- Capability detection module + optional micro-benchmark → performance tier
- WebGPU path behind runtime validation with automatic WASM fallback (resolve R2 empirically)
- Long-text pipeline: sentence chunking, ordered generation, pause insertion between paragraphs, chunk retry, concatenation (`packages/audio`)
- Memory management: session reuse, release-on-idle, transferables; repeated-generation soak test
- Error taxonomy: typed failures (download failed, OOM-ish, unsupported, cancelled) surfaced in UI copy
- COOP/COEP headers for cross-origin isolation where feasible; single-thread fallback verified

Acceptance criteria:
- [ ] 5,000-character document generates correctly ordered audio with paragraph pauses
- [ ] Failed chunk retries once then reports precise error without losing completed audio
- [ ] WebGPU device uses GPU path when beneficial; non-WebGPU devices fall back transparently
- [ ] 20 consecutive generations show stable memory (heap snapshot delta bounded)
- [ ] Recommendation card shows measured estimate ("≈X× real time")

## M4 — Production UX → tag `v0.4-production-ui`
The product looks and feels commercial.

Scope:
- Full voice catalog UI (grouped, searchable, previews), speed control, advanced settings drawer
- Polished audio player (seek, speed), file naming, WAV download; MP3 export if licensing resolved
- Device recommendation UX ("Analyzing your device…" → plain-language result)
- Marketing pages: landing (value prop, local/privacy explainer, demo samples, pricing, FAQ), SEO essentials (meta, sitemap.xml, robots.txt, JSON-LD), prerendered routes
- Responsive layout, keyboard accessibility, reduced-motion support, empty/loading/error states everywhere
- Privacy-conscious analytics events (no content fields) with CI guard

Acceptance criteria:
- [ ] Lighthouse ≥ 90 performance/a11y/SEO on landing (mid-tier laptop profile)
- [ ] Workspace usable end-to-end on mobile Safari/Chrome at usable speeds or clearly recommends cloud/desktop
- [ ] All marketing pages fully crawlable prerendered HTML
- [ ] Analytics contains zero user-content fields (enforced by test)

## M5 — Accounts & Backend → tag `v0.5-auth`
Production authentication and persistence.

Scope:
- Fastify API hardening: validation schemas, rate limiting (Redis), CORS policy, body caps
- Auth: register/login/logout, argon2id hashes, DB-backed sessions (httpOnly Secure cookies), email verification + password reset flows (dev inbox), session expiry/revocation, CSRF protections
- Postgres migrations for users/sessions/plans/projects/generation_records (+ tables list in ARCHITECTURE.md §6)
- Projects/history for logged-in users (local-mode metadata only, opt-in); account settings
- `/me` endpoint returning server-authoritative plan + entitlements; frontend consumes it

Acceptance criteria:
- [ ] Full auth lifecycle tested (unit + integration incl. token expiry/reuse)
- [ ] Rate limits block brute force in automated test
- [ ] No session fixation; cookies flagged correctly (verified in e2e)
- [ ] Local-mode text still never leaves browser after auth integration (network assertions in e2e)

## M6 — Payments & Entitlements → tag `v0.6-billing`
Real billing, provider-agnostic.

Scope:
- Plan configuration source of truth in `packages/shared`; prices injected via env/config
- BillingProvider port + chosen adapter (Stripe vs Paddle/Polar — decide before starting, see DECISIONS open question)
- Hosted checkout, customer portal, webhook receiver: raw-body signature verification → payment_events idempotency ledger → transactional subscription/credit updates
- Entitlements service (server-side feature gating consumed by API routes); usage metering for metered features
- Edge cases implemented + tested: duplicate webhook, out-of-order events, renewal, failed renewal (dunning state), cancel-at-period-end, refund, dispute flag, plan change/proration

Acceptance criteria:
- [ ] Provider sandbox end-to-end: checkout → webhook → entitlement live, replayed webhook is a no-op
- [ ] Refund/cancellation revoke entitlements within defined SLA
- [ ] Client cannot unlock paid features by tampering (evidence: API denies without valid entitlement regardless of client state)
- [ ] All money flows integer minor units; ledger rows immutable

## M7 — Premium Emotion TTS → tag `v0.7-expressive`
Paid expressive layer + cloud routing.

Scope:
- Emotion tag parser (strip for local; structured spans for expressive providers)
- CloudProvider implementation behind entitlement + credits; vendor selected per ARCHITECTURE.md open question
- Server-side credit reservation/decrement; usage events; balance UI
- Explicit local-vs-cloud labeling in UI; consent when switching to cloud mode
- Graceful degradation: cloud outage falls back to suggestion, never silently uploads text

Acceptance criteria:
- [ ] `[emotion]` tags produce expressive output only on capable providers; local output has tags stripped
- [ ] Credits decrement exactly once per successful generation (idempotent under retry)
- [ ] Free users cannot reach premium endpoints (403 with upgrade path)
- [ ] Load test shows cost-guard alerts fire on anomalous spend

## M8 — Production Hardening → tag `v1.0`
Ship it.

Scope:
- Security review against SECURITY.md checklist; pen-test pass on auth/billing/webhooks
- Performance review (bundle sizes, model caching hit rate, TTFB), monitoring/alerting/dashboards, uptime checks
- Browser compatibility matrix executed (Chrome/Edge/Firefox/Safari desktop + mobile)
- Legal pages: ToS, Privacy Policy, cookie/analytics notice, commercial-use terms; DPA groundwork if needed
- Abuse prevention final pass; backup/restore drill for DB; incident runbook
- Final regression suite + release deployment

Acceptance criteria:
- [ ] SECURITY.md controls all checked off with evidence links
- [ ] Real payment tested in provider sandbox AND a live small transaction refunded cleanly
- [ ] Compatibility matrix documented with known-issue list
- [ ] Backups verified by restore test; monitoring catches an induced failure
