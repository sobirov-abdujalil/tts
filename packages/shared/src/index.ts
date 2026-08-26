/**
 * Cross-workspace contracts consumed by apps/web, apps/api, and packages/*:
 *  - voice registry (data-driven catalog) — lands with M2
 *  - plan configuration (prices live ONLY here once billing exists, M6)
 *  - zod schemas for API payloads — lands with M5
 *
 * Deliberately empty in M1: nothing cross-workspace is needed yet, and this
 * module must never accumulate speculative or duplicated concepts.
 */
export {};
