#!/usr/bin/env node
/**
 * check-json-duplicate-keys.mjs
 *
 * Parses one or more JSON files and exits non-zero if any duplicate keys are
 * found at any nesting level.  Duplicate keys are silently dropped by most
 * JSON parsers, so a typo like two "overrides" blocks in package.json can go
 * unnoticed.  This script catches that before it reaches CI.
 *
 * Usage:
 *   node scripts/check-json-duplicate-keys.mjs [file…]
 *
 * If no files are given it defaults to checking package.json in the current
 * working directory.
 *
 * Exit codes:
 *   0 – no duplicate keys found
 *   1 – at least one duplicate key was found (details printed to stderr)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Collect every key path that appears more than once in a raw JSON string. */
function findDuplicateKeys(jsonText) {
  const duplicates = [];

  /**
   * Recursively walk the JSON value produced by a custom reviver so we have
   * access to the raw text for each object.  We use a two-pass approach:
   * 1. Walk the text with a custom replacer that intercepts every object
   *    before key deduplication happens (JSON.parse dedupes silently).
   * 2. We do this by re-parsing each raw object literal we find in the text.
   */

  // We track duplicate keys by using a custom parser that counts keys per
  // object.  Because JSON.parse deduplicates keys we cannot use it directly;
  // instead we walk the raw string with a simple state machine.
  scanObject(jsonText.trim(), '$', duplicates);

  return duplicates;
}

/**
 * Walk a raw JSON string starting at `text` (which must begin with '{' or
 * '[') and record any duplicate keys found in any object at any depth.
 *
 * @param {string} text  - The full JSON source string.
 * @param {string} path  - JSONPath prefix for error messages.
 * @param {Array}  found - Accumulator for { path, key } duplicates.
 */
function scanObject(text, path, found) {
  let i = 0;

  function skipWhitespace() {
    while (i < text.length && /\s/.test(text[i])) i++;
  }

  function readString() {
    // i must point at opening '"'
    let result = '';
    i++; // skip opening "
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        i += 2; // skip escape sequence (good enough for key matching)
        result += '?'; // placeholder; we only care about duplicate detection
        continue;
      }
      if (ch === '"') { i++; break; }
      result += ch;
      i++;
    }
    return result;
  }

  function skipValue() {
    skipWhitespace();
    const ch = text[i];
    if (ch === '"') { readString(); return; }
    if (ch === '{') { walkObject(path); return; }
    if (ch === '[') { walkArray(path); return; }
    // number, true, false, null — scan until delimiter
    while (i < text.length && !/[,}\]]/.test(text[i])) i++;
  }

  function walkArray(arrPath) {
    i++; // skip '['
    let idx = 0;
    while (i < text.length) {
      skipWhitespace();
      if (text[i] === ']') { i++; return; }
      if (text[i] === ',') { i++; idx++; continue; }
      // recurse into nested structures
      const elPath = `${arrPath}[${idx}]`;
      if (text[i] === '{') walkObject(elPath);
      else if (text[i] === '[') walkArray(elPath);
      else skipValue();
    }
  }

  function walkObject(objPath) {
    i++; // skip '{'
    const seen = new Map(); // key → first occurrence index
    while (i < text.length) {
      skipWhitespace();
      if (text[i] === '}') { i++; return; }
      if (text[i] === ',') { i++; continue; }
      if (text[i] !== '"') { i++; continue; } // malformed – skip

      const keyStart = i;
      const key = readString();
      const keyPath = `${objPath}.${key}`;

      if (seen.has(key)) {
        found.push({ path: keyPath, key });
      } else {
        seen.set(key, keyStart);
      }

      skipWhitespace();
      if (text[i] === ':') i++; // skip ':'

      skipWhitespace();
      if (text[i] === '{') walkObject(keyPath);
      else if (text[i] === '[') walkArray(keyPath);
      else skipValue();
    }
  }

  skipWhitespace();
  if (text[i] === '{') walkObject(path);
  else if (text[i] === '[') walkArray(path);
}

// ── Main ────────────────────────────────────────────────────────────────────

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => resolve(f))
  : [resolve('package.json')];

let anyError = false;

for (const filePath of targets) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    process.stderr.write(`ERROR: Cannot read ${filePath}: ${err.message}\n`);
    anyError = true;
    continue;
  }

  const duplicates = findDuplicateKeys(text);
  if (duplicates.length > 0) {
    anyError = true;
    process.stderr.write(`DUPLICATE KEYS in ${filePath}:\n`);
    for (const { path, key } of duplicates) {
      process.stderr.write(`  "${key}" at ${path}\n`);
    }
  } else {
    process.stdout.write(`OK: no duplicate keys in ${filePath}\n`);
  }
}

process.exit(anyError ? 1 : 0);
