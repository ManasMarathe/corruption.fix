import pino from "pino";
import pretty from "pino-pretty";
import { env } from "./env";

const isProduction = env.NODE_ENV === "production";

/**
 * Shared application logger.
 *
 * Uses pino's pretty-printer outside production for readable local/dev
 * output; in production it logs structured JSON with no transport overhead.
 *
 * Built via pino-pretty's synchronous stream API (`pretty(options)` passed
 * as pino's second argument) rather than pino's `transport: { target:
 * "pino-pretty" }` option. That option spawns pino-pretty in a separate
 * worker thread, resolved by absolute file path at runtime — under Next.js
 * dev's per-route module tracing (especially inside a git worktree, where
 * the traced path can point at a copy that was never written into
 * `.next/server/`) that resolution reliably fails ("Cannot find module
 * .../vendor-chunks/lib/worker.js" / "the worker has exited"), which
 * silently swallows every log call, including the OTP-code log line
 * dev/test tooling depends on being able to grep. The synchronous stream
 * form produces identical output with no worker thread involved.
 */
export const log = pino(
  { level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug") },
  isProduction
    ? undefined
    : pretty({
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      })
);
