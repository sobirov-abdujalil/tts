import Fastify, { type FastifyInstance } from "fastify";

/**
 * Builds the configured API instance (no network binding), so tests can use
 * fastify.inject and deployment code owns the listen call.
 *
 * M1 scope: health probe only. Auth, entitlements, billing, and cloud
 * generation arrive in later milestones — do not add routes speculatively.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
