/**
 * src/middleware/sseGuard.js
 * Resource guards for Server-Sent Events (SSE) streams.
 *
 * Issue #841 — enforces per-account and per-IP connection limits, applies
 * backpressure to slow consumers (so a stalled client cannot buffer unbounded
 * frames in memory), and cleans up unresponsive/stale connections.
 *
 * All limits are configurable via environment variables with sane defaults so
 * the behaviour is safe out of the box:
 *   - MAX_SSE_CONNECTIONS_PER_ACCOUNT (default 5)
 *   - MAX_SSE_CONNECTIONS_PER_IP       (default 20)
 *   - SSE_STALE_TIMEOUT_MS             (default 60_000) heartbeat/termination
 *   - SSE_HEARTBEAT_INTERVAL_MS        (default 25_000)
 */

"use strict";

const DEFAULT_MAX_PER_ACCOUNT = 5;
const DEFAULT_MAX_PER_IP = 20;
const DEFAULT_STALE_TIMEOUT_MS = 60_000;
const DEFAULT_HEARTBEAT_MS = 25_000;

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Tracks live SSE connections by account public key and by client IP.
 * Exports helper for acquiring/releasing a "slot" per connection.
 */
class SseConnectionRegistry {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxPerAccount]
   * @param {number} [opts.maxPerIp]
   */
  constructor({
    maxPerAccount = numberFromEnv("MAX_SSE_CONNECTIONS_PER_ACCOUNT", DEFAULT_MAX_PER_ACCOUNT),
    maxPerIp = numberFromEnv("MAX_SSE_CONNECTIONS_PER_IP", DEFAULT_MAX_PER_IP),
  } = {}) {
    this.maxPerAccount = maxPerAccount;
    this.maxPerIp = maxPerIp;
    /** @type {Map<string, Set<symbol>>} */
    this.accountConnections = new Map();
    /** @type {Map<string, Set<symbol>>} */
    this.ipConnections = new Map();
  }

  /**
   * Attempt to reserve connection slots for an account + IP.
   *
   * Returns `{ token }` on success (slots held) or `{ reason }` when a limit
   * would be exceeded (no slots held). Callers must pair a successful acquire
   * with a matching `release(token)` so the count stays accurate.
   *
   * @param {string} accountId  Stellar public key.
   * @param {string} ip         Client IP address.
   * @returns {{ token: symbol }|{ reason: string }}
   */
  acquire(accountId, ip) {
    this.trim(accountId, ip);

    const accountCount = this.accountConnections.get(accountId)?.size ?? 0;
    const ipCount = this.ipConnections.get(ip)?.size ?? 0;

    if (accountCount >= this.maxPerAccount) {
      return {
        reason: `Too many active SSE connections for this account (limit ${this.maxPerAccount})`,
      };
    }
    if (ipCount >= this.maxPerIp) {
      return {
        reason: `Too many active SSE connections from this IP (limit ${this.maxPerIp})`,
      };
    }

    const token = Symbol("sse-connection");
    if (!this.accountConnections.has(accountId)) {
      this.accountConnections.set(accountId, new Set());
    }
    if (!this.ipConnections.has(ip)) {
      this.ipConnections.set(ip, new Set());
    }
    this.accountConnections.get(accountId).add(token);
    this.ipConnections.get(ip).add(token);
    return { token };
  }

  /**
   * Release previously acquired slots. Safe to call multiple times.
   *
   * @param {string} accountId
   * @param {string} ip
   * @param {symbol} token
   */
  release(accountId, ip, token) {
    if (!token) return;
    this.accountConnections.get(accountId)?.delete(token);
    this.ipConnections.get(ip)?.delete(token);
    this.trim(accountId, ip);
  }

  /**
   * Drop empty buckets to avoid unbounded memory growth.
   *
   * @param {string} accountId
   * @param {string} ip
   */
  trim(accountId, ip) {
    const acct = this.accountConnections.get(accountId);
    if (acct && acct.size === 0) this.accountConnections.delete(accountId);
    const ipSet = this.ipConnections.get(ip);
    if (ipSet && ipSet.size === 0) this.ipConnections.delete(ip);
  }

  /**
   * Count of active connections for an account (test/introspection helper).
   * @param {string} accountId
   */
  accountCount(accountId) {
    return this.accountConnections.get(accountId)?.size ?? 0;
  }

  /**
   * Count of active connections for an IP (test/introspection helper).
   * @param {string} ip
   */
  ipCount(ip) {
    return this.ipConnections.get(ip)?.size ?? 0;
  }
}

const defaultRegistry = new SseConnectionRegistry();

/**
 * Express middleware enforcing per-account and per-IP SSE connection limits.
 *
 * A successful acquire sets `res.locals.sseToken` (for later release); a
 * failed acquire answers with 429 and does not call `next`.
 *
 * @param {SseConnectionRegistry} [registry]
 * @returns {import("express").RequestHandler}
 */
function sseConnectionLimiter({ registry = defaultRegistry } = {}) {
  return function sseConnectionLimiterMiddleware(req, res, next) {
    const { publicKey } = req.params;
    if (!publicKey) {
      return next();
    }

    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const result = registry.acquire(publicKey, ip);

    if (result.reason) {
      res.status(429).json({ error: result.reason });
      return;
    }

    res.locals.sseRegistry = registry;
    res.locals.sseAccountId = publicKey;
    res.locals.sseIp = ip;
    res.locals.sseToken = result.token;
    return next();
  };
}

/**
 * Release a connection previously acquired by {@link sseConnectionLimiter}.
 * Safe no-op when the limiter never ran.
 *
 * @param {object} res
 */
function releaseConnection(res) {
  const { sseRegistry, sseAccountId, sseIp, sseToken } = res.locals || {};
  if (sseRegistry && sseToken) {
    sseRegistry.release(sseAccountId, sseIp, sseToken);
    res.locals.sseToken = null;
  }
}

/**
 * Backpressure-aware SSE writer.
 *
 * Wrapping `res` keeps a `paused` flag that reflects whether the underlying
 * socket is full (`res.write` returning `false`). While paused, frames are
 * buffered in a small in-memory queue instead of being pushed to a slow
 * consumer, and flushing resumes on the stream's `"drain"` event.
 *
 * The buffer is deliberately bounded (`maxBuffer`); if a slow consumer lets
 * the buffer overflow (i.e. it is too slow to ever catch up) the queue is
 * discarded and the connection terminated — this prevents unbounded memory
 * growth from a dead/stalled client.
 *
 * @param {import("express").Response} res
 * @param {object} [opts]
 * @param {number}  [opts.maxBuffer]  Max queued frames before termination.
 * @returns {{
 *   write: (chunk: string) => boolean,
 *   end: () => void,
 *   paused: () => boolean,
 * }}
 */
function createSseWriter(res, { maxBuffer = 64 } = {}) {
  let paused = false;
  let ended = false;
  const queue = [];

  res.on("drain", () => {
    paused = false;
    while (queue.length > 0) {
      if (paused || ended) break;
      const chunk = queue.shift();
      if (!res.write(chunk)) {
        paused = true;
        break;
      }
    }
  });

  res.on("close", () => {
    ended = true;
    queue.length = 0;
  });

  function write(chunk) {
    if (ended) return false;

    if (paused) {
      if (queue.length >= maxBuffer) {
        // Slow consumer can never catch up — drop the queue and signal end.
        queue.length = 0;
        res.destroy();
        return false;
      }
      queue.push(chunk);
      return true;
    }

    const ok = res.write(chunk);
    if (!ok) {
      paused = true;
    }
    return ok;
  }

  return {
    write,
    end: () => {
      if (ended) return;
      ended = true;
      if (!res.writableEnded) res.end();
    },
    paused: () => paused,
  };
}

/**
 * Keep-alive heartbeat + stale-connection termination.
 *
 * Starts a heartbeat interval that writes a `: heartbeat` comment. If the
 * write surfaces backpressure that the client never recovers from, or the
 * connection has had no writable progress, the socket is destroyed.
 *
 * Returns a stop function that clears the interval.
 *
 * @param {import("express").Response} res
 * @param {ReturnType<typeof createSseWriter>} writer
 * @param {object} [opts]
 * @param {number} [opts.heartbeatMs]
 * @param {number} [opts.staleTimeoutMs]
 * @returns {() => void}
 */
function heartbeatPing(
  res,
  writer,
  {
    heartbeatMs = numberFromEnv("SSE_HEARTBEAT_INTERVAL_MS", DEFAULT_HEARTBEAT_MS),
    staleTimeoutMs = numberFromEnv("SSE_STALE_TIMEOUT_MS", DEFAULT_STALE_TIMEOUT_MS),
  } = {}
) {
  // Tracks the last time the socket could accept data (was not paused).
  let lastDrainAt = Date.now();
  res.on("drain", () => {
    lastDrainAt = Date.now();
  });

  const interval = setInterval(() => {
    // If the consumer is still backpressured this may push into the queue;
    // guard against it being permanently stalled.
    writer.write(": heartbeat\n\n");

    if (Date.now() - lastDrainAt > staleTimeoutMs) {
      res.destroy();
    }
  }, heartbeatMs);

  interval.unref?.();

  return () => clearInterval(interval);
}

module.exports = {
  SseConnectionRegistry,
  sseConnectionLimiter,
  releaseConnection,
  createSseWriter,
  heartbeatPing,
  _defaults: {
    DEFAULT_MAX_PER_ACCOUNT,
    DEFAULT_MAX_PER_IP,
    DEFAULT_STALE_TIMEOUT_MS,
    DEFAULT_HEARTBEAT_MS,
  },
};
