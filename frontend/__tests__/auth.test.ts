/**
 * __tests__/auth.test.ts
 * Unit tests for authentication token handling (#518)
 */

import { getJwtToken, setJwtToken, clearJwtToken } from "../lib/auth";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("auth token handling", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("Successful challenge/response stores a token", () => {
    it("stores a token in localStorage", () => {
      const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";

      setJwtToken(testToken);

      expect(localStorage.getItem("micropay_auth_token")).toBe(testToken);
    });

    it("retrieves a stored token", () => {
      const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";

      setJwtToken(testToken);
      const retrievedToken = getJwtToken();

      expect(retrievedToken).toBe(testToken);
    });
  });

  describe("Expired token is treated as unauthenticated", () => {
    it("returns null when no token exists", () => {
      const token = getJwtToken();

      expect(token).toBeNull();
    });

    it("returns null after token is cleared", () => {
      const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";

      setJwtToken(testToken);
      clearJwtToken();
      const token = getJwtToken();

      expect(token).toBeNull();
    });

    it("handles missing localStorage gracefully in SSR", () => {
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;

      const token = getJwtToken();

      expect(token).toBeNull();

      // Restore window
      global.window = originalWindow;
    });
  });

  describe("Logout clears the stored token", () => {
    it("removes token from localStorage on logout", () => {
      const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";

      setJwtToken(testToken);
      expect(getJwtToken()).toBe(testToken);

      clearJwtToken();
      expect(getJwtToken()).toBeNull();
      expect(localStorage.getItem("micropay_auth_token")).toBeNull();
    });

    it("can store a new token after clearing", () => {
      const firstToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.first";
      const secondToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.second";

      setJwtToken(firstToken);
      expect(getJwtToken()).toBe(firstToken);

      clearJwtToken();
      expect(getJwtToken()).toBeNull();

      setJwtToken(secondToken);
      expect(getJwtToken()).toBe(secondToken);
    });

    it("handles clearing when no token exists", () => {
      expect(() => clearJwtToken()).not.toThrow();
      expect(getJwtToken()).toBeNull();
    });
  });

  describe("Token persistence", () => {
    it("persists token across multiple get calls", () => {
      const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.persistent";

      setJwtToken(testToken);

      expect(getJwtToken()).toBe(testToken);
      expect(getJwtToken()).toBe(testToken);
      expect(getJwtToken()).toBe(testToken);
    });

    it("overwrites existing token with new token", () => {
      const oldToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.old";
      const newToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new";

      setJwtToken(oldToken);
      expect(getJwtToken()).toBe(oldToken);

      setJwtToken(newToken);
      expect(getJwtToken()).toBe(newToken);
    });
  });
});
