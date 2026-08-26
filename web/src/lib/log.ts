import pino from "pino";
import { env } from "./env";

const isProduction = env.NODE_ENV === "production";

/**
 * Shared application logger.
 *
 * Uses pino's pretty-printer outside production for readable local/dev
 * output; in production it logs structured JSON with no transport overhead.
 * The `pino-pretty` transport is only ever requested when not in
 * production, so nothing depends on it being present in a production
 * environment.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});
