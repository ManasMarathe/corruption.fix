#!/usr/bin/env node
// `npm run sources` — runs fetchRaw() + normalize() for every source module
// in this directory and writes each one's canonical rows to
// pipeline/data/raw/<source>.canonical.json for 06-merge.mjs to pick up.
//
// Configured sources fetch for real (indiapost, subject to the pincode-list
// caveat in indiapost.mjs); unconfigured ones (uidai, parivahan, ecourts)
// log why they're skipped and produce zero rows — see each module's header
// comment.
import * as indiapost from "./indiapost.mjs";
import * as uidai from "./uidai.mjs";
import * as parivahan from "./parivahan.mjs";
import * as ecourts from "./ecourts.mjs";
import { RAW_DIR, ensureDir, writeJsonCache } from "./_shared.mjs";
import { join } from "node:path";

const MODULES = [indiapost, uidai, parivahan, ecourts];

async function main() {
  ensureDir(RAW_DIR);
  const limit = process.argv.includes("--smoke-test") ? 3 : undefined;

  for (const mod of MODULES) {
    console.log(`\n=== ${mod.source} ===`);
    const raw = await mod.fetchRaw(limit ? { limit } : {});
    const canonical = mod.normalize(raw);
    console.log(`[${mod.source}] ${raw.length} raw rows -> ${canonical.length} canonical offices`);
    writeJsonCache(join(RAW_DIR, `${mod.source}.canonical.json`), canonical);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
