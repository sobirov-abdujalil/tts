/**
 * Cross-workspace contracts consumed by apps/web, apps/api, and packages/*:
 *  - voice registry (data-driven catalog)
 *  - generation limits and text validation
 *  - plan configuration + zod API schemas arrive with M5/M6
 *
 * This module must never accumulate speculative or duplicated concepts.
 */

export * from "./limits.js";
export * from "./validation.js";
export * from "./voices.js";
