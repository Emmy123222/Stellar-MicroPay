/**
 * __tests__/usernameService.test.js
 * Unit tests for usernameService (issue #533).
 *
 * Tests username registration, uniqueness, and resolution to Stellar address.
 */

"use strict";

const usernameService = require("../src/services/usernameService");

const KEY_A = "G" + "A".repeat(55); // 56 chars
const KEY_B = "G" + "B".repeat(55); // 56 chars
const KEY_C = "G" + "C".repeat(55); // 56 chars

describe("usernameService", () => {
  beforeEach(() => {
    // Clear in-memory storage before each test
    usernameService.usernameMap?.clear?.();
  });

  describe("registerUsername", () => {
    it("registering a new username succeeds", () => {
      const result = usernameService.registerUsername("alice123", KEY_A);

      expect(result.username).toBe("alice123");
      expect(result.publicKey).toBe(KEY_A);
    });

    it("registering a taken username is rejected", () => {
      usernameService.registerUsername("alice123", KEY_A);

      expect(() => {
        usernameService.registerUsername("alice123", KEY_B);
      }).toThrow("Username already registered");
    });

    it("registering with an already registered public key is rejected", () => {
      usernameService.registerUsername("alice123", KEY_A);

      expect(() => {
        usernameService.registerUsername("bob456", KEY_A);
      }).toThrow("Public key already registered to another username");
    });

    it("rejects invalid username format", () => {
      expect(() => usernameService.registerUsername("a", KEY_A)).toThrow();
      expect(() => usernameService.registerUsername("user with spaces", KEY_A)).toThrow();
    });

    it("rejects invalid public key format", () => {
      expect(() => usernameService.registerUsername("alice123", "invalid_key")).toThrow();
    });

    it("canonicalizes username casing to lowercase on registration", () => {
      const result = usernameService.registerUsername("AliceXYZ", KEY_A);

      expect(result.username).toBe("alicexyz");
    });

    it("rejects a case-variant of an already registered username", () => {
      usernameService.registerUsername("alice123", KEY_A);

      expect(() => {
        usernameService.registerUsername("Alice123", KEY_B);
      }).toThrow("Username already registered");

      expect(() => {
        usernameService.registerUsername("ALICE123", KEY_B);
      }).toThrow("Username already registered");
    });
  });

  describe("resolveUsername", () => {
    beforeEach(() => {
      usernameService.registerUsername("alice123", KEY_A);
    });

    it("resolves a registered username", () => {
      const result = usernameService.resolveUsername("alice123");

      expect(result.username).toBe("alice123");
      expect(result.publicKey).toBe(KEY_A);
    });

    it("throws error for non-existent username", () => {
      expect(() => usernameService.resolveUsername("nonexistent")).toThrow("Username not found");
    });

    it("throws error with 404 status for unregistered username", () => {
      try {
        usernameService.resolveUsername("unknownuser");
        fail("Should have thrown error");
      } catch (error) {
        expect(error.status).toBe(404);
        expect(error.message).toBe("Username not found");
      }
    });

    it("throws error for invalid username format", () => {
      expect(() => usernameService.resolveUsername("ab")).toThrow();
    });

    it("throws error for missing username", () => {
      expect(() => usernameService.resolveUsername(null)).toThrow("Username is required");
    });

    it("resolves a username regardless of the casing used to register it", () => {
      const result = usernameService.resolveUsername("ALICE123");

      expect(result.username).toBe("alice123");
      expect(result.publicKey).toBe(KEY_A);
    });

    it("resolves case-variants of the same username to an identical canonical result", () => {
      const lower = usernameService.resolveUsername("alice123");
      const mixed = usernameService.resolveUsername("AlIcE123");

      expect(lower).toEqual(mixed);
    });
  });

  describe("getAllUsernames", () => {
    it("returns all registered usernames", () => {
      usernameService.registerUsername("alice123", KEY_A);
      usernameService.registerUsername("bob456", KEY_B);

      const result = usernameService.getAllUsernames();

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { username: "alice123", publicKey: KEY_A },
        { username: "bob456", publicKey: KEY_B },
      ]);
    });

    it("returns empty array when no usernames are registered", () => {
      const result = usernameService.getAllUsernames();

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it("stores usernames in their canonical (lowercase) form", () => {
      usernameService.registerUsername("AliceXYZ", KEY_A);

      const result = usernameService.getAllUsernames();

      expect(result).toEqual([{ username: "alicexyz", publicKey: KEY_A }]);
    });
  });

  describe("canonicalizeUsername", () => {
    it("lowercases a username", () => {
      expect(usernameService.canonicalizeUsername("AliceXYZ")).toBe("alicexyz");
      expect(usernameService.canonicalizeUsername("BOB456")).toBe("bob456");
      expect(usernameService.canonicalizeUsername("already_lower")).toBe("already_lower");
    });
  });

  describe("removeUsername", () => {
    beforeEach(() => {
      usernameService.registerUsername("alice123", KEY_A);
    });

    it("removes an existing username", () => {
      const result = usernameService.removeUsername("alice123");

      expect(result.username).toBe("alice123");
      expect(() => usernameService.resolveUsername("alice123")).toThrow("Username not found");
    });

    it("throws error when removing non-existent username", () => {
      expect(() => usernameService.removeUsername("nonexistent")).toThrow("Username not found");
    });

    it("throws error with 404 status for non-existent username", () => {
      try {
        usernameService.removeUsername("unknownuser");
        fail("Should have thrown error");
      } catch (error) {
        expect(error.status).toBe(404);
        expect(error.message).toBe("Username not found");
      }
    });

    it("throws error for invalid username format", () => {
      expect(() => usernameService.removeUsername("ab")).toThrow();
    });

    it("throws error for missing username", () => {
      expect(() => usernameService.removeUsername(null)).toThrow("Username is required");
    });

    it("removes a registered username using a different casing", () => {
      const result = usernameService.removeUsername("ALICE123");

      expect(result.username).toBe("alice123");
      expect(() => usernameService.resolveUsername("alice123")).toThrow("Username not found");
    });

    it("frees the username for re-registration with different casing after removal", () => {
      usernameService.removeUsername("Alice123");

      const result = usernameService.registerUsername("aliceNew", KEY_B);
      expect(result.username).toBe("alicenew");

      // The old canonical name is gone and can be re-registered by anyone.
      const reRegistered = usernameService.registerUsername("Alice123", KEY_C);
      expect(reRegistered.username).toBe("alice123");
      expect(reRegistered.publicKey).toBe(KEY_C);
    });
  });

  describe("validateUsername", () => {
    it("accepts valid usernames", () => {
      expect(() => usernameService.validateUsername("alice")).not.toThrow();
      expect(() => usernameService.validateUsername("bob123")).not.toThrow();
      expect(() => usernameService.validateUsername("user123456789012345")).not.toThrow();
    });

    it("rejects usernames that are too short", () => {
      expect(() => usernameService.validateUsername("ab")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
    });

    it("rejects usernames that are too long", () => {
      expect(() => usernameService.validateUsername("user12345678901234567")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
    });

    it("rejects usernames with special characters", () => {
      expect(() => usernameService.validateUsername("user_name")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
      expect(() => usernameService.validateUsername("user@name")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
    });

    it("rejects usernames with spaces", () => {
      expect(() => usernameService.validateUsername("user name")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
    });

    it("rejects null/undefined username", () => {
      expect(() => usernameService.validateUsername(null)).toThrow("Username is required");
      expect(() => usernameService.validateUsername(undefined)).toThrow("Username is required");
    });
  });

  describe("validatePublicKey", () => {
    it("accepts valid Stellar public keys", () => {
      expect(() => usernameService.validatePublicKey(KEY_A)).not.toThrow();
      expect(() => usernameService.validatePublicKey(KEY_B)).not.toThrow();
    });

    it("rejects public keys with wrong prefix", () => {
      expect(() =>
        usernameService.validatePublicKey("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
      ).toThrow("Invalid Stellar public key format");
      expect(() =>
        usernameService.validatePublicKey("MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
      ).toThrow("Invalid Stellar public key format");
    });

    it("rejects public keys with incorrect length", () => {
      expect(() =>
        usernameService.validatePublicKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH")
      ).toThrow("Invalid Stellar public key format");
      expect(() =>
        usernameService.validatePublicKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHFA")
      ).toThrow("Invalid Stellar public key format");
    });

    it("rejects public keys with invalid characters", () => {
      expect(() =>
        usernameService.validatePublicKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH!")
      ).toThrow("Invalid Stellar public key format");
    });

    it("rejects null/undefined public key", () => {
      expect(() => usernameService.validatePublicKey(null)).toThrow("Public key is required");
      expect(() => usernameService.validatePublicKey(undefined)).toThrow("Public key is required");
    });
  });
});
