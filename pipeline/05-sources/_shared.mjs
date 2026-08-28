// Shared helpers for the pipeline/05-sources/* modules: on-disk caching
// under pipeline/data/raw/ (resumable fetches) and a couple of small
// utilities. No source-specific logic lives here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PIPELINE_DIR = dirname(__dirname);
export const DATA_DIR = join(PIPELINE_DIR, "data");
export const RAW_DIR = join(DATA_DIR, "raw");

// Identifies us honestly to upstream services, with a contact so an
// operator can reach out if we're being a bad citizen.
export const USER_AGENT =
  "CorruptionFixPipeline/1.0 (+https://github.com/corruptionfix/corruptionfix; contact: kevin.dedhia.gupshup@gmail.com)";

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** @returns {any|null} */
export function readJsonCache(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeJsonCache(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data), "utf8");
}

export function cachePathFor(source) {
  return join(RAW_DIR, `${source}.json`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read process.env.DATA_GOV_IN_API_KEY. Callers must treat a missing key as
 * a clean, non-fatal "this data source is not configured" — never crash the
 * pipeline over it.
 */
export function dataGovInApiKey() {
  return process.env.DATA_GOV_IN_API_KEY || null;
}
