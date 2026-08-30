/**
 * __tests__/stellarSdkDependencies.test.js (#809)
 */

"use strict";

const path = require("path");

const {
  collectAxiosVersionsFromLockfile,
  isPatchedAxiosVersion,
  resolveAxiosVersionForPackage,
} = require("../../scripts/axios-lockfile");

const pkg = require("../package.json");
const lockPath = path.join(__dirname, "..", "package-lock.json");

describe("stellar SDK dependency security (#809)", () => {
  it("pins a patched direct axios release", () => {
    expect(pkg.dependencies.axios).toMatch(/^[\^~]?1\.(1[6-9]|[2-9]\d)/);
    expect(isPatchedAxiosVersion(pkg.dependencies.axios.replace(/^[^\d]*/, ""))).toBe(true);
  });

  it("keeps @stellar/stellar-sdk on the Node 20-compatible 15.x line", () => {
    expect(pkg.dependencies["@stellar/stellar-sdk"]).toMatch(/^[\^~]?15\./);
  });

  it("resolves only patched axios versions in the lockfile", () => {
    const axiosVersions = collectAxiosVersionsFromLockfile(lockPath);
    expect(axiosVersions.length).toBeGreaterThan(0);
    expect(axiosVersions.every(isPatchedAxiosVersion)).toBe(true);
    expect(axiosVersions).not.toContain("1.15.0");
  });

  it("loads patched axios for @stellar/stellar-sdk at runtime", () => {
    expect(isPatchedAxiosVersion(resolveAxiosVersionForPackage("@stellar/stellar-sdk"))).toBe(
      true
    );
  });

  it("documents explicit testnet defaults for Horizon-backed services", () => {
    const { HORIZON_URL } = require("../src/config/stellar");
    expect(HORIZON_URL).toContain("testnet");
  });
});

describe("stellar-sdk Horizon, federation, and Soroban regression (#809)", () => {
  const { Horizon, Federation, rpc, Networks } = require("@stellar/stellar-sdk");

  it("constructs a Horizon server for testnet", () => {
    const server = new Horizon.Server("https://horizon-testnet.stellar.org");
    expect(server.serverURL.toString()).toContain("horizon-testnet.stellar.org");
  });

  it("constructs a Soroban RPC server for testnet", () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    expect(server.serverURL.toString()).toContain("soroban-testnet.stellar.org");
  });

  it("exposes federation and network passphrases explicitly", () => {
    expect(Networks.TESTNET).toContain("Test");
    expect(new Federation.Server("https://example.com/federation")).toBeDefined();
  });
});
