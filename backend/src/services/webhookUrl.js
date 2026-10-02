"use strict";

const net = require("net");

/**
 * Hostnames that always resolve to infrastructure a webhook must never reach.
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);

/**
 * IPv4 CIDR ranges that are not publicly routable (private, loopback,
 * link-local, shared, documentation, benchmarking, multicast and reserved).
 */
const PRIVATE_IPV4_RANGES = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16 (includes cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0000200, 24], // 192.0.2.0/24
  [0xc0586300, 24], // 192.88.99.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xc6336400, 24], // 198.51.100.0/24
  [0xcb007100, 24], // 203.0.113.0/24
  [0xe0000000, 4], // 224.0.0.0/4 (multicast)
  [0xf0000000, 4], // 240.0.0.0/4 (reserved)
];

function ipv4ToInt(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isPrivateIpv4(hostname) {
  const value = ipv4ToInt(hostname);
  if (value === null) return false;

  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

function isPrivateIpv6(hostname) {
  const host = hostname.toLowerCase();
  if (host === "::" || host === "::1") return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // unique-local fc00::/7
  if (/^ff[0-9a-f]{2}:/.test(host)) return true; // multicast ff00::/8

  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isPrivateIpv6(host);
  return false;
}

/**
 * Validates a webhook target URL and returns its normalized form.
 *
 * Only publicly reachable HTTP(S) URLs are allowed: the scheme must be
 * http/https and the host must not point at loopback, private, link-local,
 * multicast or other reserved addresses. This blocks server-side request
 * forgery (SSRF) attempts against internal services and cloud metadata.
 */
function sanitizeWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const error = new Error("url must be a valid HTTP(S) URL");
    error.status = 400;
    throw error;
  }

  if (!["http:", "https:"].includes(parsed.protocol) || isBlockedHostname(parsed.hostname)) {
    const error = new Error("url must be a publicly reachable HTTP(S) URL");
    error.status = 400;
    throw error;
  }

  return parsed.toString();
}

module.exports = { sanitizeWebhookUrl, isBlockedHostname, isPrivateIpv4 };
