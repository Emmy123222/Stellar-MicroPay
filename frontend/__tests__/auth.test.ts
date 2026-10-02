/**
 * __tests__/auth.test.ts
 * Regression tests for the shared JWT token storage (issue #1002).
 *
 * pages/dashboard.tsx reads the token via `getJwtToken` from `@/lib/auth`,
 * while the wallet auth flow writes it through `@/lib/wallet`. Both must use
 * the same storage so the dashboard can authenticate API requests.
 */

import { getJwtToken, setJwtToken, clearJwtToken } from "@/lib/auth";
import { setJwtToken as setWalletJwtToken } from "@/lib/wallet";

const STORAGE_KEY = "micropay_auth_token";

describe("lib/auth JWT storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("persists and reads a token", () => {
    setJwtToken("token-123");

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("token-123");
    expect(getJwtToken()).toBe("token-123");
  });

  it("never writes the token to localStorage", () => {
    setJwtToken("token-123");

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clears the token when null is passed", () => {
    setJwtToken("token-123");
    setJwtToken(null);

    expect(getJwtToken()).toBeNull();
  });

  it("clears the token with clearJwtToken", () => {
    setJwtToken("token-123");
    clearJwtToken();

    expect(getJwtToken()).toBeNull();
  });
});

describe("wallet auth flow shares lib/auth storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stores the login token where the dashboard reads it", () => {
    setWalletJwtToken("wallet-token");

    expect(getJwtToken()).toBe("wallet-token");
  });

  it("clears the shared token on disconnect", () => {
    setWalletJwtToken("wallet-token");
    setWalletJwtToken(null);

    expect(getJwtToken()).toBeNull();
  });
});
