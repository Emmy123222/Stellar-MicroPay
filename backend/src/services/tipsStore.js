/**
 * src/services/tipsStore.js
 * Durable, indexed storage engine for tip records.
 *
 * Persists the full record set to a single JSON file using atomic
 * (write-to-temp + rename) writes, so a crash mid-write can never leave a
 * corrupt, partially-written store on disk — a mutation either lands on disk
 * in full or the previous file is left untouched. In-memory mutations are
 * rolled back if the persist step fails, so memory and disk never diverge
 * (see `insert`).
 *
 * In-memory indexes (by id, by creator, by sender) are rebuilt from the file
 * at load time and kept in sync on every write, so `getTipsReceived` /
 * `getTipsSent` never need to scan every record to find one creator's or
 * sender's tips.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

const SCHEMA_VERSION = 1;
const DEFAULT_STORE_PATH = path.join(__dirname, "..", "..", "data", "tips.json");

let storePath = process.env.TIPS_STORE_PATH || DEFAULT_STORE_PATH;

/** @type {Map<number, object>} id -> TipRecord */
let tipsById = new Map();
/** @type {Map<string, number[]>} creatorPublicKey -> id[] (newest first) */
let idsByCreator = new Map();
/** @type {Map<string, number[]>} senderPublicKey -> id[] (newest first) */
let idsBySender = new Map();
/** @type {Array<{raw: unknown, reason: string, quarantinedAt: string}>} */
let quarantine = [];
let nextId = 1;

function dataDir() {
  return path.dirname(storePath);
}

/**
 * Minimal structural check for a tip record read back from disk.
 * Anything failing this is quarantined instead of loaded, so one malformed
 * entry can't take down the whole store.
 */
function isValidTipShape(raw) {
  return Boolean(
    raw &&
      typeof raw === "object" &&
      Number.isInteger(raw.id) &&
      raw.id > 0 &&
      typeof raw.senderPublicKey === "string" &&
      raw.senderPublicKey &&
      typeof raw.creatorPublicKey === "string" &&
      raw.creatorPublicKey &&
      (typeof raw.amount === "string" || typeof raw.amount === "number") &&
      typeof raw.timestamp === "string" &&
      raw.timestamp
  );
}

/** Fill in defaults for optional fields so every stored record has a uniform shape. */
function normalizeTip(raw) {
  return {
    id: raw.id,
    senderPublicKey: raw.senderPublicKey,
    creatorPublicKey: raw.creatorPublicKey,
    amount: String(raw.amount),
    asset: raw.asset || "XLM",
    memo: raw.memo || "",
    txHash: raw.txHash || "",
    timestamp: raw.timestamp,
  };
}

function indexInsert(map, key, id) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).unshift(id); // newest first, matches the historical unshift() ordering
}

function indexRemoveMostRecent(map, key) {
  const arr = map.get(key);
  if (!arr) return;
  arr.shift();
  if (arr.length === 0) map.delete(key);
}

function rebuildIndexes(tips) {
  tipsById = new Map();
  idsByCreator = new Map();
  idsBySender = new Map();
  nextId = 1;

  // Insert oldest → newest so each per-key id list ends up newest-first.
  for (const tip of tips) {
    tipsById.set(tip.id, tip);
    indexInsert(idsByCreator, tip.creatorPublicKey, tip.id);
    indexInsert(idsBySender, tip.senderPublicKey, tip.id);
    if (tip.id >= nextId) nextId = tip.id + 1;
  }
}

/**
 * Atomically write the full envelope to disk: write to a temp file in the
 * same directory, then rename over the target path. Rename is atomic on
 * POSIX filesystems, so readers only ever see the old file or the fully
 * written new one — never a partial write.
 */
function persist() {
  fs.mkdirSync(dataDir(), { recursive: true });

  const envelope = {
    version: SCHEMA_VERSION,
    tips: Array.from(tipsById.values()).sort((a, b) => a.id - b.id),
    quarantine,
  };

  const tmpPath = path.join(dataDir(), `.tips.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), "utf8");
  fs.renameSync(tmpPath, storePath);
}

/**
 * Load the store from disk into memory, migrating legacy shapes:
 *  - a bare array of tip-like objects (e.g. a hand-written dev fixture) is
 *    treated as unversioned data and wrapped into the current envelope
 *  - entries that don't look like a tip record are quarantined instead of
 *    dropped silently, so they can be inspected via getQuarantinedTips()
 * The migrated result is immediately re-persisted in the current envelope
 * shape so subsequent loads skip the migration step.
 */
function load() {
  quarantine = [];

  if (!fs.existsSync(storePath)) {
    rebuildIndexes([]);
    return;
  }

  let raw;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch (err) {
    logger.error({ err, path: storePath }, "tipsStore: failed to read store file, starting empty");
    rebuildIndexes([]);
    return;
  }

  let parsed;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch (err) {
    logger.error({ err, path: storePath }, "tipsStore: store file is not valid JSON, starting empty");
    rebuildIndexes([]);
    return;
  }

  const isVersionedEnvelope = Boolean(parsed) && !Array.isArray(parsed) && parsed.version === SCHEMA_VERSION;
  const rawTips = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tips) ? parsed.tips : [];

  const validTips = [];
  for (const candidate of rawTips) {
    if (isValidTipShape(candidate)) {
      validTips.push(normalizeTip(candidate));
    } else {
      quarantine.push({
        raw: candidate,
        reason: "malformed tip record",
        quarantinedAt: new Date().toISOString(),
      });
    }
  }

  validTips.sort((a, b) => a.id - b.id);
  rebuildIndexes(validTips);

  if (!isVersionedEnvelope || quarantine.length > 0) {
    logger.info(
      { path: storePath, migrated: validTips.length, quarantined: quarantine.length },
      "tipsStore: migrated store to current schema version"
    );
    persist();
  }
}

/** Allocate the next monotonically increasing tip id. */
function nextTipId() {
  return nextId++;
}

/**
 * Insert a new tip transactionally: the in-memory indexes and the on-disk
 * envelope are updated together. If the disk write fails, the in-memory
 * mutation is rolled back so memory and disk never disagree about what was
 * recorded.
 * @param {object} tip - A fully-formed tip record (must include `id`).
 * @returns {object} The inserted tip.
 */
function insert(tip) {
  tipsById.set(tip.id, tip);
  indexInsert(idsByCreator, tip.creatorPublicKey, tip.id);
  indexInsert(idsBySender, tip.senderPublicKey, tip.id);

  try {
    persist();
  } catch (err) {
    tipsById.delete(tip.id);
    indexRemoveMostRecent(idsByCreator, tip.creatorPublicKey);
    indexRemoveMostRecent(idsBySender, tip.senderPublicKey);
    logger.error({ err, path: storePath }, "tipsStore: failed to persist tip, rolled back");
    throw err;
  }

  return tip;
}

function getById(id) {
  return tipsById.get(id);
}

function getAllByCreator(creatorPublicKey) {
  return (idsByCreator.get(creatorPublicKey) || []).map((id) => tipsById.get(id));
}

function getAllBySender(senderPublicKey) {
  return (idsBySender.get(senderPublicKey) || []).map((id) => tipsById.get(id));
}

/** Opaque cursor: base64url-encoded JSON pointer at the last id seen. */
function encodeCursor(id) {
  return Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const { id } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(id)) throw new Error("cursor does not encode an id");
    return id;
  } catch {
    const error = new Error("Invalid pagination cursor");
    error.status = 400;
    throw error;
  }
}

/**
 * Binary search for the first index in a descending-sorted id array whose
 * value is strictly less than `cursorId` — i.e. the first entry "after" the
 * cursor. O(log n) instead of scanning from the start.
 */
function findFirstIndexBelow(sortedDescIds, cursorId) {
  let lo = 0;
  let hi = sortedDescIds.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedDescIds[mid] < cursorId) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * Page through a per-key id index, supporting either offset pagination
 * (legacy, still the default) or cursor pagination. When a cursor is given
 * it wins over offset.
 * @param {Map<string, number[]>} indexMap
 * @param {string} key
 * @param {{limit?: number, offset?: number, cursor?: string}} options
 * @returns {{tips: object[], total: number, nextCursor: string|null}}
 */
function listByIndex(indexMap, key, { limit = 50, offset = 0, cursor } = {}) {
  const ids = indexMap.get(key) || [];
  const total = ids.length;

  const startIndex = cursor ? findFirstIndexBelow(ids, decodeCursor(cursor)) : offset;
  const pageIds = ids.slice(startIndex, startIndex + limit);

  // The cursor for the next page points at the last id shown on *this*
  // page; the next call resumes strictly after it (see findFirstIndexBelow).
  const lastShownIndex = startIndex + pageIds.length - 1;
  const hasMore = lastShownIndex + 1 < total;
  const nextCursor = hasMore ? encodeCursor(ids[lastShownIndex]) : null;

  return {
    tips: pageIds.map((id) => tipsById.get(id)),
    total,
    nextCursor,
  };
}

function listByCreator(creatorPublicKey, options) {
  return listByIndex(idsByCreator, creatorPublicKey, options);
}

function listBySender(senderPublicKey, options) {
  return listByIndex(idsBySender, senderPublicKey, options);
}

function getQuarantinedTips() {
  return quarantine.slice();
}

/**
 * Test-only helper: point the store at a different file and reload it.
 * Lets tests use an isolated temp file instead of the real data directory.
 */
function setStorePathForTests(newPath) {
  storePath = newPath;
  load();
}

/**
 * Test-only helper: wipe all records and re-persist an empty store at the
 * currently configured path.
 */
function resetStore() {
  rebuildIndexes([]);
  quarantine = [];
  persist();
}

function getStorePath() {
  return storePath;
}

load();

module.exports = {
  nextTipId,
  insert,
  getById,
  getAllByCreator,
  getAllBySender,
  listByCreator,
  listBySender,
  getQuarantinedTips,
  setStorePathForTests,
  resetStore,
  getStorePath,
};
