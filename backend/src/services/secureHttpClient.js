"use strict";

const dns = require("node:dns");
const https = require("node:https");
const net = require("node:net");

const axios = require("axios");

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class UnsafeNetworkTargetError extends Error {
  constructor(message = "External federation target is not allowed") {
    super(message);
    this.name = "UnsafeNetworkTargetError";
    this.status = 400;
  }
}

function ipv4ToNumber(address) {
  return address
    .split(".")
    .reduce((value, octet) => (value << 8n) | BigInt(Number(octet)), 0n);
}

function isInIpv4Cidr(address, base, prefix) {
  const bits = 32n;
  const shift = bits - BigInt(prefix);
  return (ipv4ToNumber(address) >> shift) === (ipv4ToNumber(base) >> shift);
}

function expandIpv6(address) {
  let value = address.toLowerCase();
  const ipv4Match = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const ipv4 = ipv4ToNumber(ipv4Match[1]);
    value = `${value.slice(0, ipv4Match.index)}${(ipv4 >> 16n).toString(16)}:${(
      ipv4 & 0xffffn
    ).toString(16)}`;
  }

  const sides = value.split("::");
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(Math.max(0, missing)).fill("0"), ...right].map(part =>
    Number.parseInt(part || "0", 16)
  );
}

function ipv6ToBigInt(address) {
  return expandIpv6(address).reduce((value, part) => (value << 16n) | BigInt(part), 0n);
}

function isPublicIpv4(address) {
  const blockedCidrs = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return !blockedCidrs.some(([base, prefix]) => isInIpv4Cidr(address, base, prefix));
}

function isPublicIpv6(address) {
  const value = ipv6ToBigInt(address);
  const globalUnicastPrefix = value >> 125n;

  // Only globally routable 2000::/3 addresses are valid federation targets.
  if (globalUnicastPrefix !== 1n) return false;

  // Documentation addresses must never become federation destinations.
  const documentationBase = ipv6ToBigInt("2001:db8::");
  return value >> 96n !== documentationBase >> 96n;
}

function isPublicAddress(address) {
  const normalized = String(address).replace(/^\[|\]$/g, "").split("%")[0];
  const family = net.isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

function parseSecureUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeNetworkTargetError("External federation target is invalid");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new UnsafeNetworkTargetError("External federation targets must use HTTPS");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new UnsafeNetworkTargetError();
  }

  // WHATWG URL parsing canonicalizes decimal, octal, hexadecimal and percent-
  // encoded IP hosts, so alternate spellings cannot bypass this check.
  if (net.isIP(hostname) && !isPublicAddress(hostname)) {
    throw new UnsafeNetworkTargetError();
  }

  return url;
}

function buildDiscoveryUrl(domain) {
  const rawDomain = String(domain).trim();
  const origin = parseSecureUrl(`https://${rawDomain}/`);
  if (origin.port || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new UnsafeNetworkTargetError("Federation address domain is invalid");
  }

  return new URL("/.well-known/stellar.toml", origin);
}

async function resolvePublicAddresses(hostname) {
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeNetworkTargetError("External federation target could not be resolved");
  }

  if (!addresses.length || addresses.some(result => !isPublicAddress(result.address))) {
    throw new UnsafeNetworkTargetError();
  }

  return addresses;
}

async function requestOnce(url, options) {
  // Resolve immediately before this hop and pin the socket lookup to the vetted
  // address. This removes the validation/connect race used by DNS rebinding.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolvePublicAddresses(hostname);
  const selected = addresses[0];
  const agent = new https.Agent({
    lookup: (_hostname, _options, callback) => {
      callback(null, selected.address, selected.family);
    },
  });

  try {
    return await axios.get(url.toString(), {
      ...options,
      httpAgent: undefined,
      httpsAgent: agent,
      maxRedirects: 0,
      proxy: false,
      validateStatus: status =>
        (status >= 200 && status < 300) || REDIRECT_STATUSES.has(status),
    });
  } finally {
    agent.destroy();
  }
}

async function secureGet(input, options = {}) {
  let url = parseSecureUrl(input);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestOnce(url, options);
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    if (redirectCount === MAX_REDIRECTS || !response.headers.location) {
      throw new UnsafeNetworkTargetError("External federation redirect was invalid");
    }

    url = parseSecureUrl(new URL(response.headers.location, url).toString());
  }

  throw new UnsafeNetworkTargetError("Too many external federation redirects");
}

module.exports = {
  MAX_REDIRECTS,
  UnsafeNetworkTargetError,
  buildDiscoveryUrl,
  isPublicAddress,
  parseSecureUrl,
  resolvePublicAddresses,
  secureGet,
};
