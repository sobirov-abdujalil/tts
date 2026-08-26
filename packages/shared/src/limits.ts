/**
 * Shared generation limits and defaults.
 *
 * MAX_INPUT_CHARS is an interim M2 guardrail: the engine generates a single
 * chunk today (ROADMAP.md M2); sentence-aware chunking for long documents
 * lands in M3, at which point this limit is raised substantially.
 */

export const MAX_INPUT_CHARS = 2000;

export const DEFAULT_SPEED = 1;

export interface SpeedRange {
  min: number;
  max: number;
}

export const SPEED_RANGE: SpeedRange = { min: 0.5, max: 2 };
