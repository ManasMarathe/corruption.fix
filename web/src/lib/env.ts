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
});

// Fixed, obviously-fake fallbacks used only outside production. Never used
// as real secrets — production always requires the real value. Must be
// valid 64-char hex (unlike a "...dev"-suffixed placeholder) since these
// are actually fed to AES-256-GCM/HMAC-SHA256 via src/lib/crypto.ts, not
// just checked for presence.
const DEV_FALLBACK_VAULT_ENCRYPTION_KEY = "dead".repeat(16);
const DEV_FALLBACK_VAULT_HMAC_KEY = "beef".repeat(16);
const DEV_FALLBACK_JOB_SECRET = "dev-job-secret-do-not-use-in-production";

function loadEnv() {
  const parsed = rawEnvSchema.safeParse(process.env);

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
  };
}

export const env = loadEnv();

export type Env = typeof env;
