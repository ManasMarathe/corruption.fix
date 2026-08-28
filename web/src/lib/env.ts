import { z } from "zod";

/**
 * Centralized, zod-validated environment loader.
 *
 * Import `env` anywhere server-side config is needed. Invalid or missing
 * required variables throw immediately at import time ("fail fast") instead
 * of surfacing as confusing runtime errors deep in request handling.
 *
 * A handful of secrets used only by not-yet-built features (the vault
 * encryption/HMAC keys, the job runner secret) are allowed to be omitted
 * outside production — a fixed, clearly-fake development default is used
 * instead, and a warning is logged so nobody mistakes it for a real secret.
 */

const hex64 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be a 64-character hex string (32 bytes)");

const rawEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  VAULT_ENCRYPTION_KEY: hex64.optional(),
  VAULT_HMAC_KEY: hex64.optional(),
  CHECKPOINT_SIGNING_KEY: hex64.optional(),
  // Public half of CHECKPOINT_SIGNING_KEY, safe to expose. Shown on
  // /transparency so anyone can independently verify checkpoint signatures
  // without trusting this server. Not derived automatically from the
  // signing key at boot (that key may live only in a secret store the app
  // process can read but shouldn't need Node crypto glue for at startup);
  // generate both together via scripts/generate-signing-key.mjs.
  CHECKPOINT_PUBLIC_KEY: hex64.optional(),
  JOB_SECRET: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
  // OTP email delivery. Genuinely optional in all environments: when unset
  // (or outside production) the console mailer transport is used instead of
  // Resend — see src/lib/mailer.ts.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  // Vercel AI Gateway key for the complaint chat assistant. Only needed for
  // local dev — on Vercel the gateway authenticates via OIDC automatically.
  // The AI SDK's gateway provider reads process.env.AI_GATEWAY_API_KEY
  // itself; this entry exists for validation/documentation.
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  // Place geocoding for the map's "where are you?" prompt. Neither is a
  // secret, and both have working defaults — the public Nominatim instance
  // is fine for development and low traffic. Point NOMINATIM_BASE_URL at a
  // self-hosted instance or a keyed provider before real production volume:
  // Nominatim's usage policy discourages autocomplete-rate querying, and it
  // blocks by IP, which serverless functions share.
  NOMINATIM_BASE_URL: z.string().url().optional(),
  // Nominatim's policy requires a descriptive User-Agent with a contact
  // route. Substitute the real production URL or a contact email.
  GEOCODER_USER_AGENT: z.string().min(1).optional(),
});

const DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_GEOCODER_USER_AGENT = "CorruptionFix/1.0 (+https://corruptionfix.org)";

// Fixed, obviously-fake fallbacks used only outside production. Never used
// as real secrets — production always requires the real value. Must be
// valid 64-char hex (unlike a "...dev"-suffixed placeholder) since these
// are actually fed to AES-256-GCM/HMAC-SHA256 via src/lib/crypto.ts, not
// just checked for presence.
const DEV_FALLBACK_VAULT_ENCRYPTION_KEY = "dead".repeat(16);
const DEV_FALLBACK_VAULT_HMAC_KEY = "beef".repeat(16);
const DEV_FALLBACK_JOB_SECRET = "dev-job-secret-do-not-use-in-production";

function loadEnv() {
  // The Vercel <-> Supabase integration injects the pooled connection
  // string as POSTGRES_URL rather than DATABASE_URL; accept it as a
  // fallback so the integration works without manual re-mapping. An
  // explicit DATABASE_URL always wins.
  const parsed = rawEnvSchema.safeParse({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const data = parsed.data;
  const isProduction = data.NODE_ENV === "production";

  const requireOrWarn = <T>(
    value: T | undefined,
    fallback: T,
    name: string
  ): T => {
    if (value !== undefined) return value;
    if (isProduction) {
      throw new Error(
        `Invalid environment configuration:\n  - ${name}: is required in production`
      );
    }
    console.warn(
      `[env] ${name} is not set — falling back to an insecure development default. ` +
        "Set this variable before deploying to production."
    );
    return fallback;
  };

  return {
    NODE_ENV: data.NODE_ENV,
    DATABASE_URL: data.DATABASE_URL,
    VAULT_ENCRYPTION_KEY: requireOrWarn(
      data.VAULT_ENCRYPTION_KEY,
      DEV_FALLBACK_VAULT_ENCRYPTION_KEY,
      "VAULT_ENCRYPTION_KEY"
    ),
    VAULT_HMAC_KEY: requireOrWarn(
      data.VAULT_HMAC_KEY,
      DEV_FALLBACK_VAULT_HMAC_KEY,
      "VAULT_HMAC_KEY"
    ),
    // Not required anywhere yet — the checkpoint-signing feature lands in a
    // later phase. Left undefined when unset rather than given a fallback.
    CHECKPOINT_SIGNING_KEY: data.CHECKPOINT_SIGNING_KEY,
    CHECKPOINT_PUBLIC_KEY: data.CHECKPOINT_PUBLIC_KEY,
    JOB_SECRET: requireOrWarn(
      data.JOB_SECRET,
      DEV_FALLBACK_JOB_SECRET,
      "JOB_SECRET"
    ),
    SESSION_SECRET: data.SESSION_SECRET,
    RESEND_API_KEY: data.RESEND_API_KEY,
    EMAIL_FROM: data.EMAIL_FROM,
    AI_GATEWAY_API_KEY: data.AI_GATEWAY_API_KEY,
    NOMINATIM_BASE_URL: data.NOMINATIM_BASE_URL ?? DEFAULT_NOMINATIM_BASE_URL,
    GEOCODER_USER_AGENT: data.GEOCODER_USER_AGENT ?? DEFAULT_GEOCODER_USER_AGENT,
  };
}

export const env = loadEnv();

export type Env = typeof env;
