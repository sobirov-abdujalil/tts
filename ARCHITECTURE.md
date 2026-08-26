# ARCHITECTURE.md

Proposed production architecture. This is the technical blueprint; decisions and their rationale live in `DECISIONS.md`.

## 1. System Overview

```
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                  │
│  apps/web (React SPA + prerendered marketing pages)              │
│    ├── UI: editor, voice picker, player, pricing, auth           │
│    ├── Capability detection + benchmark → recommendation         │
│    └── Model Router (packages/tts-engine)                        │
│          ├── KokoroProvider  → dedicated Web Worker              │
│          │      kokoro-js / Transformers.js v3                │
│          │      ONNX Runtime Web: webgpu → wasm fallback       │
│          │      model cached in browser Cache API              │
│          └── CloudProvider (M7, entitlement-gated)               │
│                 HTTPS streaming to apps/api                      │
│  packages/audio: chunking, pauses, WAV encode/concat (worker-    │
│  compatible, no DOM dependencies)                                │
└──────────────────────────────────────────────────────────────────┘
                     │ only metadata/auth/billing/cloud-gen traffic
┌─────────────────────▼────────────────────────────────────────────┐
│  apps/api — Fastify (Node 22, TypeScript)                         │
│   auth · sessions · entitlements · usage metering · cloud TTS     │
│   payment webhooks (signature verify → idempotency → tx)          │
│   rate limiting (Redis) · structured logs · health checks         │
├──────────────────────────────────────────────────────────────────┤
│  PostgreSQL (Drizzle ORM + migrations)   Redis (sessions/ratelimit/queues)
│  Object storage (cloud-gen audio TTL; user assets if opted in)    │
│  Payment provider (adapter behind BillingProvider port)           │
└──────────────────────────────────────────────────────────────────┘
```

**Privacy invariant enforced by design:** the local path (UI ↔ Worker ↔ ORT) has no network code path for text/audio. The worker bundle contains no fetch-to-API calls with content; lint rules + review checklist enforce this.

## 2. Monorepo Layout

pnpm workspaces (+ Turborepo task graph when needed).

```
apps/
  web/        React 18 + TypeScript + Vite + Tailwind CSS
  api/        Fastify + TypeScript
packages/
  tts-engine/ Framework-agnostic inference core (no React imports)
  audio/      WAV encode/decode, chunker, pause insertion, concatenation
  shared/     Types, zod schemas, voice registry, plan config, constants
```

Dependency direction (enforced by review, later by eslint boundaries): `web` → `tts-engine`, `audio`, `shared`; `api` → `shared`; `tts-engine`/`audio` → `shared` only.

## 3. Frontend (`apps/web`)

- **Stack:** React 18, TypeScript strict, Vite, Tailwind CSS, TanStack Query for server state, Zustand (or context) for local UI state.
- **Pages:** marketing landing/pricing/docs (prerendered/static), workspace app shell, auth screens, account/billing screens.
- **SEO:** semantic HTML, per-route meta tags, canonical URLs, `sitemap.xml`, `robots.txt`, JSON-LD (Product/FAQ). Marketing pages are prerendered at build time so crawlers see full content without executing the app.
- **State:** server state (entitlements, projects) always fetched from API; local-only state (editor text, settings) stays in the client and is never sent to the backend in local mode.
- **Accessibility:** keyboard-navigable controls, focus management during generation progress, `prefers-reduced-motion`, WCAG AA contrast.

### Key UI modules
- `WorkspacePage`: editor + controls + player; orchestrates generation via engine façade.
- `CapabilityCard`: runs capability detection/benchmark on demand ("Analyzing your device…"), renders recommendation in plain language.
- `VoicePicker`: data-driven from shared voice registry.
- `AudioPlayer` + `DownloadMenu`: WAV now, MP3 later.

## 4. Inference Core (`packages/tts-engine`)

Framework-agnostic TypeScript library. No React. Usable from a worker or tests (Node).

### 4.1 Provider abstraction

```ts
interface TTSModelProvider {
  id: string;                       // "kokoro-local", "kokoro-cloud-expressive", ...
  kind: 'local' | 'cloud';
  capabilities: ProviderCapabilities; // voices, speedRange, emotionSupport, maxCharsPerReq…
  requirements?: DeviceRequirements;
  estimate(ctx: EstimateContext): SpeedEstimate | null; // e.g. "1.8x realtime"
  load(opts: LoadOptions & { onProgress }): Promise<LoadedModel>;
}
```

The router selects a provider from a registry given: requested features (voice, emotion), device capability report, user entitlements, and availability. No provider names hard-coded outside the registry.

### 4.2 Kokoro provider (local)

- Runtime: `kokoro-js` (Transformers.js v3 → ONNX Runtime Web).
- Model: `onnx-community/Kokoro-82M-v1.0-ONNX`. Default dtype **q8 (~86 MB)**; fp32/fp16 variants available behind advanced settings where memory allows. Sample rate 24 kHz mono.
- Execution preference order:
  1. **WebGPU** (`device: 'webgpu'`) — validated per-device at runtime; note kokoro-js guidance currently recommends fp32 weights with WebGPU, so we benchmark q8-vs-fp32-on-GPU during M3 and pick per measured RTF.
  2. **WASM** (SIMD; multithreaded when `SharedArrayBuffer` available via cross-origin isolation, else single-threaded).
  3. Optional cloud fallback (only for entitled users, explicit UI consent, M7).
- **Execution environment: dedicated Web Worker** (not a Service Worker — ORT's dynamic-import backend loading is restricted in SWs). Protocol: `{type:'load'|'generate'|'cancel'|'release', id, payload}` with streamed progress/chunk messages. Cancellation = cooperative abort flag checked between chunks + worker termination as last resort.
- **Caching:** Transformers.js caches model files in the browser Cache API. We additionally: request `navigator.storage.persist()`, verify cache hits (no re-download on second visit), and handle corrupted cache by versioned cache-busting re-download.
- **Memory:** one session at a time; explicit release after idle timeout; chunk buffers transferred to main thread via transferable ArrayBuffers then dereferenced.

### 4.3 Capability detection & benchmark

Signals: `navigator.gpu.requestAdapter()` (+ adapter info), `hardwareConcurrency`, `deviceMemory` (Chromium), `navigator.storage.estimate()`, cross-origin isolation status, UA-based browser tiering. Then an optional ~2–4 s micro-benchmark: generate a fixed short sentence with the recommended dtype/device, measure RTF, classify into performance tiers (e.g. slow/ok/fast). Result cached in `localStorage` with a TTL and invalidated on device/browser change. Output feeds both the recommendation card and telemetry (tier label only — never text).

## 5. Audio Pipeline (`packages/audio`)

Pure functions, no DOM, usable in worker and Node tests:

1. **TextSegmenter** — paragraph/sentence splitting with max-token budget per chunk (model-friendly lengths); keeps original indices.
2. **PauseInserter** — silence segments (configurable ms) between paragraphs/sentences.
3. **Generator loop** — ordered chunk generation, per-chunk failure isolation + retry, cancellation-aware.
4. **Concatenator** — single sample-rate (24 kHz) float32 timeline assembly; optional peak normalization.
5. **WavEncoder** — PCM16 WAV export; MP3 encoder added later (client-side for free-tier parity of paid feature? MP3 is a paid export — implement server-side or licensed lib at M4+).

Chunk ordering uses monotonic sequence numbers end-to-end (worker → pipeline → UI) to make retries safe.

## 6. Backend (`apps/api`)

- **Framework:** Fastify (schema-validated routes via zod schemas shared with frontend through `packages/shared`).
- **Auth:** email+password (argon2id), server-side sessions (opaque token in httpOnly, Secure, SameSite=Lax cookie; session row + Redis for fast lookup), email verification + password reset tokens (hashed, single-use, expiring), login/register/reset rate limits per IP+email, generic error messages.
- **CSRF:** SameSite cookies + Origin/Referer validation + double-submit token for state-changing routes.
- **Authorization:** every route derives entitlements server-side from DB (`users → subscriptions → entitlements`). `/me` endpoint returns plan + remaining credits; the client renders from it but never decides with it.
- **Usage accounting:** cloud generations metered server-side at request time (atomic decrement/reservation pattern), usage rows immutable; local usage NOT required for cost but anonymous aggregate events allowed (see Analytics).
- **Cloud generation (M7):** POST /generate/premium → validate entitlement + credits → call model vendor SDK server-side → store audio briefly in object storage with signed TTL URL → record usage. Streaming response preferred once validated.
- **Rate limiting:** Redis-backed (per-IP global, per-user for expensive endpoints), request body size caps.
- **Observability:** pino structured logs, request IDs, Sentry (server + browser), health/readiness endpoints, uptime monitoring.

### Database (PostgreSQL; Drizzle ORM + drizzle-kit migrations)

Tables (minimum):

```
users(id, email UNIQUE, password_hash, email_verified_at, created_at, …)
email_tokens(id, user_id, kind[verify|reset], token_hash, expires_at, used_at)
sessions(id, user_id, token_hash, ip, ua, expires_at, revoked_at)
plans(code PK, name, prices JSONB, entitlements JSONB, stripe/paddle ids)
subscriptions(id, user_id, plan_code, status, provider, provider_subscription_id,
              current_period_start/end, cancel_at_period_end, canceled_at)
payments(id, user_id, provider, provider_payment_id UNIQUE, amount, currency,
         status, created_at)
payment_events(id, provider, event_id UNIQUE, type, payload JSONB, processed_at,
               status)                       -- webhook idempotency ledger
usage_events(id, user_id, kind[cloud_chars|credits|export…], amount, ref_id,
             created_at)                     -- append-only
credit_balances(user_id PK, balance, updated_at)
projects(id, user_id, name, created_at, updated_at)
generation_records(id, user_id NULL, project_id NULL, mode[local|cloud],
                   voice_id, chars, duration_ms, status, created_at)
```

Rules: migrations only (`drizzle-kit generate/migrate`), no manual prod schema edits; all money amounts integer minor units; timestamps UTC.

## 7. Payments (summary — details in PAYMENTS.md)

- `BillingProvider` port interface (create checkout, verify webhook signature, map event types, create customer portal session). Adapters: Stripe, Paddle/Polar (merchant-of-record). Provider choice depends on business jurisdiction; adapter keeps it swappable.
- Flow: hosted checkout → provider → signed webhook → raw-body signature verify → `payment_events` idempotency insert → DB transaction (subscription/credits) → entitlement effective. Client polls `/me`; never trusts redirect alone.
- All edge cases handled explicitly: duplicate delivery, out-of-order events, renewal, failed renewal, cancellation, refund, dispute, proration/plan change.

## 8. Analytics

- Privacy-friendly provider (self-hostable Umami/Plausible class, or PostHog EU) with cookieless page analytics.
- Custom events: generation_attempted/succeeded/failed {mode, provider_id, perf_tier, duration_ms_bucket, error_code}, model_downloaded {bytes}, paywall_shown, checkout_started, subscription_activated.
- Hard rule (lint/review): event payloads must not contain text content or audio. CI grep guard for known fields.

## 9. Deployment & Environments

| Env | Frontend | API | DB |
| --- | --- | --- | --- |
| dev | Vite dev server + local API | localhost | docker-compose Postgres+Redis |
| staging | preview deploy | staging API | managed Postgres (branch DB) |
| prod | static hosting + CDN (Cloudflare Pages/Vercel) | container host (Fly.io/Railway/ECS) | managed Postgres (Neon/RDS) + Redis |

- **Cross-origin isolation:** production serves COOP/COEP headers (`same-origin` / `require-corp`) to enable multithreaded WASM. Third-party scripts must be audited for CORP compatibility; any that break isolation load conditionally or get replaced. This is a deliberate trade-off documented in DECISIONS.md.
- Model files served from CDN (or Hugging Face) with long-lived cache headers; pinned versions.
- Secrets: server env vars only; frontend receives zero secret material. `.env.example` committed, real env files ignored.

## 10. Testing Strategy

| Layer | Tooling |
| --- | --- |
| Unit (engine, audio, shared, api services) | Vitest |
| Integration (API + Postgres via testcontainers/docker) | Vitest |
| Contract (payment webhook fixtures, provider adapters) | Vitest |
| E2E browser (workspace flow, WASM smoke test, cancellation, download) | Playwright (Chromium; WebGPU smoke behind flag where supported) |
| Load/abuse basics (rate limits, oversized payloads) | scripted k6/autocannon (lightweight) |

CI (GitHub Actions): install → lint → typecheck → unit/integration → build → e2e (on PRs touching apps/web or packages/*).

## 11. Technical Risks & Mitigations (verified Aug 2026)

| # | Risk | Evidence | Mitigation |
| --- | --- | --- | --- |
| R1 | **WASM inference speed varies widely** (reports range ≈0.35×–2×+ real-time depending on CPU/threads) | community benchmarks; kokoro-js issues | mandatory micro-benchmark + honest speed estimates; set expectations in UI; cloud fallback upsell path |
| R2 | **WebGPU + Kokoro quality/perf coupling**: kokoro-js recommends fp32 with WebGPU (heavy); q8-on-GPU needs validation | kokoro-js README guidance | runtime A/B benchmark per device; fall back to WASM-q8 when GPU path underperforms; treat WebGPU as optimization, never requirement |
| R3 | **~86 MB model download UX** (mobile data, iOS storage eviction) | model sizes table (fp32 326 MB unusable mobile) | lazy download only on first Generate; persistent storage request; progress UI; resume/re-download handling; show size before download |
| R4 | **Multithreaded WASM requires cross-origin isolation** (COOP/COEP), which can break third-party embeds/scripts | SharedArrayBuffer requirements | serve COOP/COEP; audit third-party scripts; graceful single-thread fallback |
| R5 | **ORT limitations inside Service Workers** (dynamic import restrictions) | onnxruntime#20876 | dedicated Web Worker instead of Service Worker for inference |
| R6 | **Browser fragmentation**: WebGPU absent/disabled (Firefox flag history, Safari timing), older devices, tab suspension killing workers | caniuse ~70%+ and climbing | capability detection + WASM fallback + auto-restart on suspension; clear unsupported-browser messaging |
| R7 | **Phonemization/G2P edge cases** (numbers, acronyms, names, non-English input) | Kokoro G2P pipeline (misaki/espeak lineage) | text normalization layer with user pronunciation hints (later); chunk-level failure isolation |
| R8 | **Payment provider availability depends on business country/entity**; Stripe not universally available | business constraint | BillingProvider abstraction; merchant-of-record options (Paddle/Polar) evaluated before M6; no provider assumptions in code |
| R9 | **Licensing/compliance**: Kokoro weights Apache-2.0 (commercial OK); voice IP considerations; commercial-use terms must match plans | hexgrad/Kokoro license | legal review of ToS before launch; no cloning; document voice provenance; commercial-use gated to paid plans |
| R10 | **Abuse of cloud generation** (cost attacks) | billing risk | server-side credit reservation, rate limits, anomaly alerts, spend caps |

## 12. Open Questions (tracked; do not block early milestones)

1. Final payment provider (pending business jurisdiction decision) — before M6.
2. Exact plan pricing — business decision, config-only.
3. WebGPU dtype policy finalization (R2) — resolved empirically during M3.
4. Brand name/domain — before public deployment (affects SEO/canonical setup).
5. Cloud expressive model vendor selection — before M7 (candidates evaluated on quality, latency, licensing, price).
