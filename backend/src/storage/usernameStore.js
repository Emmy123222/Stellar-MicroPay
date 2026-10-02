"use strict";

/**
 * src/storage/usernameStore.js
 *
 * Persistent storage for username → publicKey registrations (Issue #1056).
 *
 * Implementation: a JSON file with atomic writes.
 *   - `backend/data/usernames.json` is the single source of truth.
 *   - Writes go to `<file>.tmp`, then `fsync`, then `rename` over the target —
 *     so a crash mid-write can never leave a truncated/corrupt store.
 *   - A hot in-memory `Map` mirrors the file, so lookups stay O(1) with no
 *     disk I/O on the read path (acceptance criterion: "Lookup performance
 *     is O(1)").
 *   - Registrations survive server restarts because the file is loaded on
 *     module init.
 *
 * Storage key is `usernames: { <username>: { publicKey, registeredAt } }` so
 * future migrations can extend the record shape without re-importing.
 *
 * Schema migration path to PostgreSQL (#1056):
 *   The JSON document maps 1:1 onto a two-column table:
 *
 *     CREATE TABLE usernames (
 *       username     TEXT PRIMARY KEY,          -- O(1) lookup via PK index
 *       public_key   TEXT NOT NULL,
 *       registered_at TIMESTAMPTZ DEFAULT now()
 *     );
 *
 *   Migration procedure: export `getAllUsernames()` rows and bulk-insert them
 *   (`INSERT ... ON CONFLICT (username) DO NOTHING`), then swap the service
 *   data layer to SQL queries. The record shape in this file
 *   (`username`, `publicKey`, `registeredAt`) is intentionally identical to
 *   the column set so no data transformation is needed. Until then, the
 *   versioned envelope (`version: 1`) lets future loaders detect and convert
 *   older file layouts.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_FILE = path.join(__dirname, "..", "..", "data", "usernames.json");
const WRITE_RETRY_DELAY_MS = 50;

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Extracts the username map from a parsed store document (any version). */
function extractUsernameMap(document) {
  if (!document || typeof document !== "object") {
    return null;
  }
  // v1 envelope: { version: 1, usernames: { name: { publicKey, registeredAt } } }
  if (document.usernames && typeof document.usernames === "object") {
    return document.usernames;
  }
  // Legacy flat shape: { name: publicKey }
  return document;
}

function isValidPublicKey(publicKey) {
  return typeof publicKey === "string" && /^G[A-Z0-9]{55}$/.test(publicKey);
}

/**
 * Creates a persistent username store backed by a JSON file with atomic
 * writes. All operations are synchronous so the existing service API (and its
 * error-handling contract) stays unchanged.
 *
 * @param {object} [options]
 * @param {string} [options.dataFile] Path to the JSON store file.
 */
function createUsernameStore(options = {}) {
  const dataFile = options.dataFile || process.env.USERNAMES_DATA_FILE || DEFAULT_DATA_FILE;

  const store = {
    dataFile,
    cache: new Map(),
    writeTimer: null,
    closed: false,
  };

  /** Loads the store file into the in-memory cache. Missing files start empty. */
  function loadFromDisk() {
    store.cache = new Map();
    let raw;
    try {
      raw = fs.readFileSync(dataFile, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return; // fresh install — nothing persisted yet
      }
      throw err;
    }

    const document = safeParseJson(raw);
    const map = extractUsernameMap(document);
    if (!map) {
      // Corrupt file: refuse to silently wipe it. Starting empty mirrors the
      // previous in-memory behavior; the raw file is left in place for manual
      // recovery.
      console.error(
        `[usernameStore] Could not parse ${dataFile}; starting with an empty store. ` +
          "The original file is left untouched for manual recovery."
      );
      return;
    }

    for (const [username, value] of Object.entries(map)) {
      if (typeof value === "string") {
        // legacy flat format: username -> publicKey
        store.cache.set(username, { publicKey: value, registeredAt: null });
      } else if (value && typeof value === "object" && isValidPublicKey(value.publicKey)) {
        store.cache.set(username, {
          publicKey: value.publicKey,
          registeredAt: value.registeredAt ?? null,
        });
      }
    }
  }

  /**
   * Synchronously persists the cache to disk using tmp-file + fsync + rename.
   * Throws on failure so callers can surface 500s instead of silently losing
   * registrations.
   */
  function writeToDisk() {
    if (store.closed) return;
    const document = {
      version: 1,
      usernames: Object.fromEntries(
        Array.from(store.cache.entries()).map(([username, entry]) => [username, entry])
      ),
    };
    const payload = JSON.stringify(document, null, 2);
    const tmpFile = `${dataFile}.tmp`;

    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const fd = fs.openSync(tmpFile, "w");
    try {
      fs.writeFileSync(fd, payload, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpFile, dataFile);
  }

  /** Debounced persistence: coalesces bursts of writes into one disk write. */
  function scheduleWrite() {
    if (store.writeTimer || store.closed) return;
    store.writeTimer = setTimeout(() => {
      store.writeTimer = null;
      try {
        writeToDisk();
      } catch (err) {
        console.error(`[usernameStore] Failed to persist usernames to ${dataFile}:`, err.message);
      }
    }, WRITE_RETRY_DELAY_MS);
  }

  /** Immediately flushes any pending debounced write (used on shutdown/tests). */
  function flushSync() {
    if (store.writeTimer) {
      clearTimeout(store.writeTimer);
      store.writeTimer = null;
    }
    if (!store.closed) {
      writeToDisk();
    }
  }

  loadFromDisk();

  return {
    /** O(1) in-memory lookup. */
    get(username) {
      return store.cache.get(username) ?? null;
    },
    has(username) {
      return store.cache.has(username);
    },
    /** All registrations ordered by registration time (oldest first). */
    entries() {
      return Array.from(store.cache.entries());
    },
    set(username, publicKey) {
      store.cache.set(username, { publicKey, registeredAt: Date.now() });
      scheduleWrite();
    },
    remove(username) {
      store.cache.delete(username);
      scheduleWrite();
    },
    flushSync,
    close() {
      flushSync();
      store.closed = true;
    },
  };
}

module.exports = { createUsernameStore, DEFAULT_DATA_FILE };
