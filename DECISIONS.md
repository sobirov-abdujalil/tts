# DECISIONS.md — Architectural Decision Records

Append-only log. Each decision: context → decision → consequences. Changing a decision requires a new entry that supersedes the old one, plus updates to affected docs.

---

## D-001 — Local-first inference as the core architecture
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** Cloud TTS APIs create per-character cost, latency, and privacy concerns; browser inference is now viable for small models.
**Decision:** Default generation path is on-device (Kokoro-82M via ONNX Runtime Web). Cloud generation is a paid, explicitly-labeled addition.
**Consequences:** Near-zero marginal server cost for free usage; strong privacy story; extra complexity in capability detection/fallbacks (risks R1–R6).

## D-002 — kokoro-js + Transformers.js v3 / ONNX Runtime Web as the local runtime
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** Evaluated raw ONNX Runtime Web integration vs kokoro-js. kokoro-js provides model loading, G2P/phonemization, voice registry, and streaming, maintained by HF (Xenova), backed by Transformers.js v3 with WebGPU + WASM backends.
**Decision:** Use `kokoro-js` inside our own provider abstraction (`packages/tts-engine`); do not fork unless blocked.
**Consequences:** Faster M2; dependency on upstream for G2P fixes; provider abstraction keeps replacement possible.

## D-003 — Dedicated Web Worker for all inference (not Service Worker)
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** ORT backend loading uses dynamic `import()`, which is restricted in Service Workers (onnxruntime#20876). Main-thread inference would freeze UI.
**Decision:** All model load/inference runs in a dedicated Worker behind a typed message protocol; cancellation is cooperative abort + worker termination fallback.
**Consequences:** Responsive UI; slightly more complex state sync; worker restart strategy needed after suspension/OOM.

## D-004 — q8 quantized model as default; fp32/fp16 opt-in
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** Variants: fp32 ≈ 326 MB, fp16 ≈ 163 MB, q8f16 ≈ 86 MB, uint8f16 ≈ 114 MB. q8 quality is near-lossless per community listening tests; fp32 is impractical for most devices.
**Decision:** Ship q8 (~86 MB) as default download. WebGPU dtype policy (kokoro-js suggests fp32 on GPU) resolved empirically in M3 via runtime benchmark; never block generation on WebGPU availability.
**Consequences:** Reasonable mobile footprint; slight quality ceiling vs fp32 acceptable for product positioning; advanced settings may expose precision choice.

## D-005 — Monorepo with pnpm workspaces; strict package boundaries
**Date:** 2026-08-26 · **Status:** Accepted
**Decision:** Layout per AGENTS.md (`apps/web`, `apps/api`, `packages/{tts-engine,audio,shared}`). `tts-engine` and `audio` are framework-agnostic (no React/DOM-only APIs where avoidable) so they run in workers and Node tests.
**Consequences:** Single versioning story; enforced dependency direction prevents UI logic leaking into engine/audio.

## D-006 — Fastify + TypeScript for API; PostgreSQL + Drizzle ORM; Redis for sessions/rate limiting
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** Need production-grade relational data (billing integrity), migrations, and fast session/ratelimit primitives. Alternatives considered: NestJS (heavier), Prisma (fine but Drizzle gives lighter SQL control + edge-friendly), MongoDB (unsuitable for transactional billing).
**Decision:** Fastify routes validated by zod schemas shared from `packages/shared`; Drizzle + drizzle-kit migrations; Redis-backed sessions/rate limits from M5.
**Consequences:** Explicit SQL control for payment transactions; two datastores to operate (acceptable; both managed offerings exist).

## D-007 — Server-authoritative entitlements; opaque cookie sessions
**Date:** 2026-08-26 · **Status:** Accepted
**Decision:** Plan status/credits live only in DB. Client fetches `/me` for display. Sessions are opaque random tokens (hashed at rest) in httpOnly Secure SameSite cookies. No JWTs for browser sessions initially (revocation simplicity).
**Consequences:** Simple revocation/logout-everywhere; an extra `/me` roundtrip (cached briefly client-side).

## D-008 — Payment provider abstraction; provider TBD by jurisdiction
**Date:** 2026-08-26 · **Status:** Accepted (provider selection open)
**Context:** Stripe availability depends on business country/entity; merchant-of-record platforms (Paddle, Polar, Lemon Squeezy) handle global sales tax.
**Decision:** Code against a `BillingProvider` port. Choose adapter before M6 based on business entity location; no provider-specific types outside the adapter module.
**Consequences:** Slight indirection cost now; avoids rewrite risk later. See PAYMENTS.md.

## D-009 — Emotion layer separate from TTS engine
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** Kokoro does not interpret arbitrary `[emotion]` tags; passing them through degrades local output.
**Decision:** Parser converts tags to structured style spans; local providers receive cleaned text only; expressive cloud providers consume spans. Router gates expressive routing behind entitlements.
**Consequences:** Clean upgrade path; local UX never shows broken tags.

## D-010 — Cross-origin isolation enabled in production (COOP/COEP)
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** Multithreaded WASM (major WASM speed factor, R1/R4) requires SharedArrayBuffer → cross-origin isolated context. Third-party scripts must send CORP-compatible resources or be dropped.
**Decision:** Serve COOP `same-origin` + COEP `require-corp` on app origins; audit/replace third-party scripts; analytics chosen accordingly; single-threaded fallback retained for non-isolated contexts.
**Consequences:** Up to multi-x WASM speedup; constraint on embeddable third parties documented here.

## D-011 — Analytics without content, ever
**Date:** 2026-08-26 · **Status:** Accepted
**Decision:** Event schema whitelist (mode, provider id, perf tier, durations, error codes, counts). No text/audio fields by design; CI test asserts payload schema. Cookieless page analytics.
**Consequences:** Slightly less insight into user content behavior; privacy invariant holds structurally rather than by discipline alone.

## D-012 — Marketing pages prerendered; workspace is SPA
**Date:** 2026-08-26 · **Status:** Accepted
**Decision:** Landing/pricing/legal/docs pages are prerendered static HTML at build time (crawlable, fast); the workspace app shell hydrates client-side. No SSR runtime server initially.
**Consequences:** Good SEO without running Node rendering infra; revisit if dynamic SEO content is ever needed.

## D-013 — Concrete toolchain versions for the foundation (M1)
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** M1 required pinning exact tooling. Notable: TypeScript 7.0.2 (native rewrite) is now stable on npm, but `typescript-eslint@8` declares peer support `<6.1.0` and fails with TS 7; Vite 8 and Tailwind v4 (CSS-first Vite plugin) are stable.
**Decision:** TypeScript ^5.9 until typescript-eslint ships TS 7 support (revisit then); Vite 8 + `@tailwindcss/vite`; ESLint 9 flat config (+ react-hooks plugin for web), Prettier; Vitest as a single root runner covering all workspaces (per-package Vitest configs deferred until a package needs a custom environment, e.g. jsdom in M4); Playwright at repo root with a Chromium smoke project; Node `engines >=22`, CI runs Node 24. Markdown docs are excluded from Prettier to avoid reformat churn in canonical documents.
**Consequences:** Mature, mutually compatible versions now; TS 7 upgrade is a tracked follow-up, not silent drift.

## D-014 — Internal packages consumed as TypeScript source
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** Workspace packages (`shared`, `tts-engine`, `audio`) are private and consumed only by our own TS-aware tooling (Vite bundler, tsx, Vitest).
**Decision:** Package `exports` point directly at `src/index.ts`; no per-package build step or generated `.d.ts`. Only `apps/web` produces a build artifact today; API deployment packaging is decided at M8/deploy time.
**Consequences:** Zero build orchestration between packages; consumers must remain TS-aware (true for all current tooling). Revisit if an external consumer or non-TS pipeline ever needs these packages.

## D-015 — M2 execution choices: worker-termination cancellation, WebGPU-first attempt policy, registry subset
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** M2 ships single-chunk local generation. kokoro-js exposes no per-chunk abort hook for one-shot `generate()`, and the WebGPU dtype question (R2) is not yet benchmarked.
**Decision:** (1) Cancellation is enforced by terminating the inference worker immediately; the next operation transparently respawns it and reloads from cache (cooperative chunk-level abort arrives with M3 long-text pipeline). (2) Device order is WebGPU→WASM with q8 for both; if the GPU path fails at load time the provider falls back automatically — WebGPU is an optimization, never a requirement; per-device dtype selection waits for the M3 benchmark (D-004). (3) The curated free-tier voice catalog lives in `packages/shared` as data; voice ids are validated against it before dispatch. (4) Input is capped at 2,000 chars until chunking lands (M3 raises this).
**Consequences:** Cancel is prompt and simple but reloads weights from cache (~seconds); acceptable while generation is a single chunk. A failed WebGPU load doubles nothing (fallback happens inside one load request). Voice metadata has exactly one source of truth.

## D-016 — Device capability honesty levels: known / estimated / unknown
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** M3 device detection must inform recommendations without overclaiming. `navigator.hardwareConcurrency` is a definitive report; `navigator.deviceMemory` is a coarse capped approximation; exact GPU model names are only exposed when the adapter offers them; many signals (storage quota precision, browser identity without UA parsing) are simply not reliably available.
**Decision:** Every detected signal carries an explicit confidence: `known` (standard API reports it), `estimated` (browser-provided approximation), or `unknown` (not exposed — never guessed). The profile reads only non-fingerprinting signals (adapter probe + vendor/architecture hints, thread count, memory bucket, isolation flags, storage estimate, coarse browser family) and stays on-device. A stable device signature (threads/memory/isolation/browser/SAB) gates benchmark comparability.
**Consequences:** UI copy can be precise about what the app does and doesn't know; privacy surface stays minimal; future signals slot into the same three-level contract.

## D-017 — Runtime selection policy and local-only benchmark cache
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** WebGPU presence ≠ usable/faster; WASM speed varies widely (R1/R2). Users need honest expectations, and re-benchmarking on every visit would waste time and bytes.
**Decision:** (1) Selection order is WebGPU (only after a real adapter probe passes) → WASM → unavailable; a WebGPU load failure recorded in-session drops GPU from candidates until reload. Selection decides what to *try*; the measured RTF decides what to *keep* — WebGPU is never assumed faster. (2) The benchmark generates one fixed sentence through the real provider, measures init/generation/audio-duration, and derives `rtf = generation_time / audio_duration`, `speedMultiplier = audio/generation`, `estimated_time = target_audio_duration × rtf`. All user-facing numbers are labeled "Measured on this device" / estimates. (3) Results persist in localStorage per `modelId|dtype|runtime` + benchmark version + device signature with a **30-day TTL**; any mismatch invalidates silently. (4) Benchmark/device data never leaves the browser — no backend endpoint receives it.
**Consequences:** Honest per-device expectations at near-zero steady-state cost; risk of stale measurements bounded by TTL + signature checks; runtime comparison (benchmarking both WebGPU and WASM) remains available via per-runtime cache entries but is not auto-run (doubles first-run cost).

## D-018 — Model descriptors as data; registry-based recommendation
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** The recommendation system must outlive Kokoro: future local models (Piper, smaller/quantized variants) need to appear without rewriting UI or router logic, and specs must never be invented.
**Decision:** Models are data-only `ModelDescriptor`s (provider id, runtimes, minimum requirements, quality tier, emotion/cloning support flags, documented download size or null, voices) registered in one engine registry. `recommendModels(deviceProfile, benchmarks, userRequirements)` filters by eligibility, picks the runtime from the selection plan, attaches measured RTF only from matching cached benchmarks (`confidence: "measured" | "unknown"`), and ranks per user intent (`quality | speed | privacy-local | expressive`). The React card is one consumer of the result list.
**Consequences:** Adding a local model = register descriptor + implement provider; unsupported claims are structurally impossible (fields must be documented or null); expressive intent already routes correctly (Kokoro reports no emotion support) ahead of M7.

## D-019 — Idle release of the loaded session; tab-wide provider singleton
**Date:** 2026-08-26 · **Status:** Accepted
**Context:** ~86 MB weights + ORT worker should not stay resident forever, but tearing down on React unmounts (StrictMode double-mounts!) would thrash the session and slow every generation.
**Decision:** The web app holds ONE provider instance per tab (survives remounts) and releases the loaded session (graceful in-worker dispose, then worker termination) after **15 minutes** without any operation. Finished audio object URLs survive the release; the next generate reloads transparently from cache.
**Consequences:** Bounded memory for idle tabs; slightly slower first generate after long idles (cache-warm load); cancellation semantics unchanged.

## Superseded / Rejected
(none yet)
