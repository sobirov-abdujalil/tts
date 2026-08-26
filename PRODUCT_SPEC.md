# PRODUCT_SPEC.md

## 1. Vision

A professional, general-purpose AI text-to-speech platform. The user enters text, picks a voice, and gets natural speech — instantly and privately when their device can handle it, with premium expressive generation available as a paid upgrade.

> **Positioning statement:** "Your text stays yours." When the device supports it, speech is generated on the user's own machine; the text never touches our servers.

The user never needs to know about ONNX, WebGPU, WASM, Kokoro, quantization, or inference providers. They see: enter text → pick voice → generate → listen → download.

## 2. Target Users & Jobs To Be Done

| Persona | Job |
| --- | --- |
| Content creator (YouTube/TikTok narration) | Turn scripts into natural voiceover quickly, cheaply, repeatedly |
| E-learning / course author | Produce long-form narration from lesson text; iterate often |
| Indie developer / tinkerer | Free high-quality TTS without uploading drafts anywhere |
| Business / agency | Commercial-use audio, consistent voices, higher limits, invoices |

## 3. Product Principles

1. **Local-first.** Local inference is a first-class product experience, not an afterthought or a demo mode. It must be genuinely useful on the free plan.
2. **Honest privacy.** We clearly label what runs locally vs. in the cloud. We never claim "private" for cloud generation and never collect local-mode text.
3. **Zero-friction free tier.** The free tier costs us almost nothing to serve (client-side compute) and must not be artificially crippled to force upgrades.
4. **Progressive disclosure.** Simple by default (text + voice + Generate). Advanced controls (speed, pauses, emotion) are available but never in the way.
5. **Server-authoritative billing.** Entitlements come from our database via signed webhooks from the payment provider — never from browser state.

## 4. Core User Flows

### 4.1 First visit
1. Landing page explains value proposition + local/privacy angle (no model download just for browsing).
2. User opens the workspace, enters text.
3. App checks device capability: "Analyzing your device…" → recommends Kokoro Local (or explains fallback).
4. On first Generate: model download (~86 MB q8) with progress UI, cached thereafter.

### 4.2 Generation (local)
Enter/adjust text → choose voice + speed → Generate → progress with cancel → inline player → download WAV.

### 4.3 Upgrade
User hits a paid-only feature (premium voice, emotion, batch, long history) → pricing page → checkout (provider-hosted) → entitlement active after webhook → feature unlocked without client-side trust.

## 5. Plans (structure; prices set separately)

Prices live ONLY in plan configuration (`packages/shared/src/plans`), never in business logic. Plan names below are structural placeholders.

| Capability | Free | Creator | Pro |
| --- | --- | --- | --- |
| Local generation (Kokoro) | ✅ unlimited* | ✅ | ✅ |
| Basic voices (subset) | ✅ | ✅ | ✅ |
| All voices incl. premium picks | ❌ | ✅ | ✅ |
| Speed control | ✅ basic range | ✅ full range | ✅ full range |
| WAV export | ✅ | ✅ | ✅ |
| MP3 export | ❌ | ✅ | ✅ |
| Pause insertion / advanced editor | ❌ | ✅ | ✅ |
| Emotion/expressive generation (cloud) | ❌ | limited credits | credits + priority |
| Cloud premium model fallback | ❌ | metered | metered |
| Batch generation | ❌ | small batches | large batches |
| Generation history/projects | session only | 30 days | 12 months + folders |
| Commercial use license | ❌ | ✅ | ✅ |
| API access | ❌ | waitlist | roadmap |

\* Subject to reasonable anti-abuse limits (documented in SECURITY.md), not artificial throttling of the core loop.

## 6. Feature Requirements

### 6.1 Editor & generation
- Long-text support: multi-paragraph documents, sentence-aware chunking with correct ordering.
- Controls: voice selection (grouped by language/accent), speed, pause insertion between paragraphs/sentences.
- Generation progress (model load %, per-chunk progress), cancellation, retry of failed chunks only.
- Audio preview player (seek, playback speed), file naming, WAV export; MP3 export where implemented.
- UI remains responsive during long generations (all heavy work off main thread).

### 6.2 Voice catalog
- Curated registry of Kokoro's pretrained voices (af_heart, af_bella, … bf_emma, bm_george, etc.) with human-readable names, language, accent, gender, preview sample.
- Registry is data-driven (`packages/shared`), shared by frontend, engine, and (later) cloud providers.
- Premium/emotional voices appear locked with clear upgrade affordance — no fake paywalling of basic quality.

### 6.3 Device recommendation (implemented M3)
- Capability check runs on workspace open (cheap, no model bytes): WebGPU adapter probe, CPU threads, memory hint, storage estimate — each labeled honestly as known / estimated / unknown; nothing fingerprinting-grade is read, and nothing leaves the device.
- Optional short benchmark generates one fixed sentence locally and reports a **measured** speed ("Measured on this device: 1.8× real time") plus an estimate derived from it ("Estimated time for 7 minutes of audio: ≈ 3m 53s"). Estimates are always labeled as estimates; without a measurement the card shows capability facts and offers to measure.
- The measurement runs once, quietly, right after a first successful generation (model already warm), or on demand via a button; it persists ~30 days per model+runtime+device and never re-runs while valid.
- Output in plain language: recommended model ("Kokoro — Local"), execution mode ("Using your GPU for local generation" / "Using CPU mode for local generation"), and "Generation happens on your device."
- Modular: recommendation engine consumes registered model descriptors + device profile + measurements + user intent (quality/speed/local/expressive), so future local models slot in without UI rewrites.

### 6.4 Emotion system (paid, M7)
- Users may write tags like `[curious] …`, `[laughing] …`.
- **Kokoro does not interpret arbitrary emotion tags.** For local generation the parser strips tags into plain text. Tags only take effect when routed to a provider that supports expressive control.
- Emotion layer is separate middleware between editor and router; new expressive models plug in later.

### 6.5 Accounts & projects (M5)
- Email/password auth, sessions, settings; project/generation metadata for paying users.
- Local-mode audio/text is NOT uploaded; only metadata (duration, voice, char count) is stored when the user opts into history.

## 7. Privacy Positioning (marketing-accurate)

| Mode | Where inference runs | What leaves the device | Label in UI |
| --- | --- | --- | --- |
| Local (default) | User's browser | Nothing about content (only anonymous usage events: success/failure, duration, performance tier) | 🔒 "Generated on your device" |
| Cloud/premium | Our servers + model vendor | Text submitted, generated audio | ☁️ "Processed securely in the cloud" |

Rules:
- Analytics payloads NEVER include user text or audio for any mode.
- Cloud mode copy explicitly states text is processed server-side.
- No dark patterns implying cloud features are private.

## 8. Non-Goals (for v1)

- Voice cloning (legal/licensing complexity; revisit post-v1 with explicit consent framework).
- Real-time streaming microphone/dubbing use cases.
- Native mobile/desktop apps (PWA-grade mobile web support is enough initially).
- Languages beyond what Kokoro voices ship (en focus at launch; structure allows more).
- Self-hosted enterprise deployment.

## 9. Success Metrics (v1)

- % of sessions using local generation successfully (target > 70% on desktop).
- Median first-generation latency (model load + generate) on mid-tier hardware.
- Free → paid conversion rate; D7 retention of generators.
- Support burden: failed-generation rate < 2% of attempts.
