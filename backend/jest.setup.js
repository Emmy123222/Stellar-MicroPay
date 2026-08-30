/**
 * jest.setup.js
 * Runs once per test file, before it loads.
 *
 * Points TIPS_STORE_PATH at a fresh temp file so any test that touches
 * tipsService/tipsStore (directly, or indirectly through e.g. analyticsService)
 * never reads or writes the real backend/data/tips.json used by `npm run dev`
 * / production — durable, file-backed storage means tests that didn't
 * explicitly isolate themselves would otherwise leak state onto disk across
 * runs.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

if (!process.env.TIPS_STORE_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tips-store-jest-"));
  process.env.TIPS_STORE_PATH = path.join(dir, "tips.json");
}
