/**
 * src/services/cache.js
 * Redis-backed caching layer for analytics with in-memory fallback.
 *
 * When `REDIS_URL` is set the cache stores entries in Redis so that data
 * survives restarts and is shared across multiple backend instances.  If
 * Redis is unavailable (connection refused, missing env var, etc.) the cache
 * transparently falls back to an in-process `Map` so the service keeps working
 * — just without cross-instance sharing.
 *
 * TTL is controlled by `ANALYTICS_CACHE_TTL_MS` (default 5 minutes).
 */

"use strict";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_MS = parseInt(
  process.env.ANALYTICS_CACHE_TTL_MS || String(DEFAULT_CACHE_TTL_MS),
  10
);
const REDIS_URL = process.env.REDIS_URL || null;

class AnalyticsCache {
  constructor() {
    /** @type {Map<string, { data: *, timestamp: number }>} */
    this.memoryCache = new Map();
    /** @type {import("redis").RedisClientType | null} */
    this.redisClient = null;
    this.usingRedis = false;

    this._initRedis();
  }

  /**
   * Attempt to create and connect a Redis client.
   * Silently falls back to in-memory when Redis is unavailable so the
   * service degrades gracefully rather than crashing on startup.
   */
  _initRedis() {
    if (!REDIS_URL) {
      return;
    }

    try {
      const { createClient } = require("redis");
      this.redisClient = createClient({ url: REDIS_URL });

      this.redisClient.on("error", (err) => {
        console.error(
          "[analytics-cache] Redis error — falling back to memory cache:",
          err.message
        );
        this.usingRedis = false;
      });

      this.redisClient
        .connect()
        .then(() => {
          this.usingRedis = true;
          console.info("[analytics-cache] Connected to Redis at", REDIS_URL);
        })
        .catch((err) => {
          console.error(
            "[analytics-cache] Redis connection failed — falling back to memory cache:",
            err.message
          );
          this.usingRedis = false;
        });
    } catch (err) {
      console.error(
        "[analytics-cache] Failed to initialise Redis — falling back to memory cache:",
        err.message
      );
      this.usingRedis = false;
    }
  }

  /**
   * Retrieve a value from the cache.
   * @param {string} key
   * @returns {Promise<*>} The cached value or `null` if not found / expired.
   */
  async get(key) {
    if (this.usingRedis && this.redisClient) {
      try {
        const raw = await this.redisClient.get(key);
        if (raw !== null) {
          return JSON.parse(raw);
        }
        return null;
      } catch (err) {
        console.error(
          "[analytics-cache] Redis GET failed — falling back to memory:",
          err.message
        );
        this.usingRedis = false;
        return this._getMemory(key);
      }
    }

    return this._getMemory(key);
  }

  /**
   * Retrieve from the in-memory fallback, honouring TTL.
   * @param {string} key
   * @returns {*|null}
   */
  _getMemory(key) {
    const entry = this.memoryCache.get(key);

    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return entry.data;
    }

    // Expired or absent — remove if present and return null.
    if (entry) {
      this.memoryCache.delete(key);
    }
    return null;
  }

  /**
   * Store a value in the cache with the configured TTL.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    if (this.usingRedis && this.redisClient) {
      try {
        const ttlSeconds = Math.max(1, Math.floor(CACHE_TTL_MS / 1000));
        await this.redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
        return;
      } catch (err) {
        console.error(
          "[analytics-cache] Redis SET failed — falling back to memory:",
          err.message
        );
        this.usingRedis = false;
      }
    }

    this.memoryCache.set(key, { data: value, timestamp: Date.now() });
  }

  /**
   * Delete a single key from the cache.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async del(key) {
    if (this.usingRedis && this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch {
        // Ignore Redis errors during deletion; memory is best-effort too.
      }
    }
    this.memoryCache.delete(key);
  }

  /**
   * Delete every key that starts with `prefix`.
   * @param {string} prefix
   * @returns {Promise<void>}
   */
  async clearByPrefix(prefix) {
    if (this.usingRedis && this.redisClient) {
      try {
        const keys = await this.redisClient.keys(`${prefix}*`);
        if (keys.length > 0) {
          await this.redisClient.del(keys);
        }
      } catch {
        // Fall through to memory cleanup.
      }
    }

    for (const key of [...this.memoryCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Synchronous read that checks memory only (used internally and in tests
   * that do not have Redis configured).
   * @param {string} key
   * @returns {*|null}
   */
  getSync(key) {
    return this._getMemory(key);
  }

  /**
   * Synchronous write to memory only.
   * @param {string} key
   * @param {*} value
   */
  setSync(key, value) {
    this.memoryCache.set(key, { data: value, timestamp: Date.now() });
  }

  /**
   * Whether the Redis backend is currently active.
   * @returns {boolean}
   */
  isUsingRedis() {
    return this.usingRedis;
  }
}

module.exports = new AnalyticsCache();
