import { z } from "zod";

/**
 * Server-side environment schema.
 * SERPAPI_KEY is optional in Phase 1 (integration lands in Phase 2).
 * This module must ONLY be imported from server-side code
 * (Route Handlers, Server Components, server services).
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_BASE_URL: z.string().url().optional(),
  SERPAPI_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (!cached) {
    cached = serverEnvSchema.parse(process.env);
  }
  return cached;
}

/** True when a server-side SerpApi key is present. Never returns the key. */
export function isSerpApiConfigured(): boolean {
  return getServerEnv().SERPAPI_KEY !== undefined;
}
