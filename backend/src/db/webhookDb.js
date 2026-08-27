/**
 * src/db/webhookDb.js
 * Durable SQLite-backed storage for webhook registrations and monitor cursors.
 *
 * Replaces the old in-memory Map (webhookStore.js pre-#768), which lost all
 * registrations on restart and could not be shared across replicas. SQLite
 * gives us a single durable file with real uniqueness/index enforcement; for
 * multi-instance deployments, point WEBHOOK_DB_PATH at a shared/network volume
 * (or swap this module for a networked DB — the query surface below is the
 * seam to do that behind).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "..", "data", "webhooks.db");
const DB_PATH = process.env.WEBHOOK_DB_PATH || DEFAULT_DB_PATH;

if (DB_PATH !== ":memory:") {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key  TEXT NOT NULL,
    url         TEXT NOT NULL,
    secret      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (public_key, url)
  );

  CREATE INDEX IF NOT EXISTS idx_webhooks_public_key ON webhooks (public_key);

  CREATE TABLE IF NOT EXISTS monitor_cursors (
    public_key  TEXT PRIMARY KEY,
    cursor      TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

module.exports = { db, DB_PATH };
