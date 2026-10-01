/**
 * utils/logger.ts
 * Minimal structured logger for client-side utilities.
 * Mirrors a pino-style call signature: logger.error(obj, message).
 */

type LogObject = Record<string, unknown>;

function emit(level: "debug" | "info" | "warn" | "error", obj?: LogObject, msg?: string) {
  const prefix = `[${level}]`;
  if (obj !== undefined && msg !== undefined) {
    console[level](prefix, msg, obj);
  } else if (obj !== undefined) {
    console[level](prefix, obj);
  } else if (msg !== undefined) {
    console[level](prefix, msg);
  }
}

export const logger = {
  debug: (obj?: LogObject, msg?: string) => emit("debug", obj, msg),
  info: (obj?: LogObject, msg?: string) => emit("info", obj, msg),
  warn: (obj?: LogObject, msg?: string) => emit("warn", obj, msg),
  error: (obj?: LogObject, msg?: string) => emit("error", obj, msg),
};
