const pino = require('pino');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * src/utils/logger.js
 *
 * Shared pino logger plus the AsyncLocalStorage store that carries the current
 * request's correlation ID across asynchronous boundaries (issue #837).
 *
 * Every log line emitted while a correlation ID is active is tagged with that
 * ID, so a single end-to-end request can be traced across the HTTP handler,
 * async jobs and outbound third-party calls.
 */

// Header we accept from / attach to requests and propagate to outbound calls.
const CORRELATION_HEADER = 'x-request-id';

// Store holds the correlation ID for the current async execution context.
const correlationStore = new AsyncLocalStorage();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // When a correlation ID is present in the current async context, merge it
  // into every structured log so downstream log aggregation (Datadog,
  // CloudWatch) can group a request's logs together.
  mixin() {
    const id = correlationStore.getStore();
    return id ? { correlationId: id } : {};
  },
});

/**
 * Run `fn` with `id` set as the active correlation ID. The ID is visible to
 * `logger.*` calls and to `getCorrelationId()` anywhere underneath `fn`,
 * including in child promises / async jobs spawned within it.
 *
 * @param {string|null|undefined} id
 * @param {() => any} fn
 * @returns {any}
 */
function runWithCorrelationId(id, fn) {
  return correlationStore.run(id || null, fn);
}

/**
 * Return the correlation ID active in the current async context, or null when
 * there is none (e.g. in a detached background job that was not spawned under
 * an incoming request).
 *
 * @returns {string|null}
 */
function getCorrelationId() {
  return correlationStore.getStore() ?? null;
}

/**
 * Build the outbound header object carrying the active correlation ID, so a
 * third-party / Horizon request made *during* an incoming request can forward
 * the trace to downstream services.
 *
 * @returns {{ [k: string]: string } | {}}
 */
function correlationHeaders() {
  const id = correlationStore.getStore();
  return id ? { [CORRELATION_HEADER]: id } : {};
}

module.exports = logger;
module.exports.runWithCorrelationId = runWithCorrelationId;
module.exports.getCorrelationId = getCorrelationId;
module.exports.correlationHeaders = correlationHeaders;
module.exports.CORRELATION_HEADER = CORRELATION_HEADER;