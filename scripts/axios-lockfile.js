/**
 * scripts/axios-lockfile.js
 * Shared helpers for verifying patched Axios versions in package-lock files (#809).
 */

"use strict";

const MIN_PATCHED_AXIOS = [1, 16, 0];

/**
 * @param {string} version
 * @returns {boolean}
 */
function isPatchedAxiosVersion(version) {
  const parts = String(version).split(".").map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  for (let index = 0; index < MIN_PATCHED_AXIOS.length; index += 1) {
    const expected = MIN_PATCHED_AXIOS[index];
    const actual = parts[index] ?? 0;
    if (actual > expected) return true;
    if (actual < expected) return false;
  }

  return true;
}

/**
 * @param {string} lockfilePath
 * @returns {string[]}
 */
function collectAxiosVersionsFromLockfile(lockfilePath) {
  const lock = require(lockfilePath);
  const versions = new Set();

  for (const [path, entry] of Object.entries(lock.packages || {})) {
    if (path === "node_modules/axios" || path.endsWith("/node_modules/axios")) {
      if (entry?.version) {
        versions.add(entry.version);
      }
    }
  }

  return [...versions].sort();
}

/**
 * Resolve the axios version that a package loads at runtime.
 * @param {string} packageName
 * @returns {string}
 */
function resolveAxiosVersionForPackage(packageName) {
  const path = require("path");
  const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
  const axiosEntry = require.resolve("axios/package.json", { paths: [packageRoot] });
  return require(axiosEntry).version;
}

module.exports = {
  MIN_PATCHED_AXIOS,
  isPatchedAxiosVersion,
  collectAxiosVersionsFromLockfile,
  resolveAxiosVersionForPackage,
};
