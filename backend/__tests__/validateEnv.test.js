/**
 * __tests__/validateEnv.test.js
 * Unit tests for src/validateEnv.js
 */

"use strict";

const { validateEnv, REQUIRED_VARS } = require("../src/validateEnv");

describe("validateEnv", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("exports all three required var names", () => {
    expect(REQUIRED_VARS).toEqual(
      expect.arrayContaining(["JWT_SECRET", "STELLAR_NETWORK", "HORIZON_URL"])
    );
    expect(REQUIRED_VARS).toHaveLength(3);
  });

  it("returns empty array when all required vars are present", () => {
    const env = {
      JWT_SECRET: "supersecret",
      STELLAR_NETWORK: "testnet",
      HORIZON_URL: "https://horizon-testnet.stellar.org",
    };

    const missing = validateEnv(env, { exitOnFailure: false });

    expect(missing).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("returns missing var names when vars are absent", () => {
    const env = {
      STELLAR_NETWORK: "testnet",
      // JWT_SECRET and HORIZON_URL intentionally omitted
    };

    const missing = validateEnv(env, { exitOnFailure: false });

    expect(missing).toEqual(expect.arrayContaining(["JWT_SECRET", "HORIZON_URL"]));
    expect(missing).toHaveLength(2);
  });

  it("reports all missing vars in a single error message", () => {
    const env = {}; // all three missing

    validateEnv(env, { exitOnFailure: false });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const errorMsg = consoleErrorSpy.mock.calls[0][0];
    expect(errorMsg).toMatch(/Missing required environment variables/);
    expect(errorMsg).toMatch(/JWT_SECRET/);
    expect(errorMsg).toMatch(/STELLAR_NETWORK/);
    expect(errorMsg).toMatch(/HORIZON_URL/);
  });

  it("error message matches expected format when two vars are missing", () => {
    const env = { STELLAR_NETWORK: "testnet" };

    validateEnv(env, { exitOnFailure: false });

    const errorMsg = consoleErrorSpy.mock.calls[0][0];
    expect(errorMsg).toContain("Missing required environment variables: JWT_SECRET, HORIZON_URL");
  });

  it("calls process.exit(1) when exitOnFailure is true and vars are missing", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    const env = { STELLAR_NETWORK: "testnet" };

    validateEnv(env, { exitOnFailure: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("does not call process.exit when all vars are present", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    const env = {
      JWT_SECRET: "s3cr3t",
      STELLAR_NETWORK: "mainnet",
      HORIZON_URL: "https://horizon.stellar.org",
    };

    validateEnv(env, { exitOnFailure: true });

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("treats empty string values as missing", () => {
    const env = {
      JWT_SECRET: "",
      STELLAR_NETWORK: "testnet",
      HORIZON_URL: "https://horizon-testnet.stellar.org",
    };

    const missing = validateEnv(env, { exitOnFailure: false });

    expect(missing).toContain("JWT_SECRET");
  });
});
