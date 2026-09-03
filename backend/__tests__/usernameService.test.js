/**
 * __tests__/usernameService.test.js
 * Unit tests for usernameService (issue #533).
 *
 * Tests username registration, uniqueness, and resolution to Stellar address.
 */

"use strict";

const usernameService = require("../src/services/usernameService");

describe("usernameService", () => {
  beforeEach(() => {
    // Clear in-memory storage before each test
    usernameService.clear();
  });

  describe("registerUsername", () => {
    it("registering a new username succeeds", () => {
      const result = usernameService.registerUsername(
        "alice123",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      );

      expect(result.username).toBe("alice123");
      expect(result.publicKey).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    });

    it("registering a taken username is rejected", () => {
      usernameService.registerUsername(
        "alice123",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      );

      expect(() => {
        usernameService.registerUsername(
          "alice123",
          "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        );
      }).toThrow("Username already registered");
    });

    it("registering with an already registered public key is rejected", () => {
      usernameService.registerUsername(
        "alice123",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      );

      expect(() => {
        usernameService.registerUsername(
          "bob456",
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
      }).toThrow("Public key already registered to another username");
    });

    it("throws error for invalid username format", () => {
      expect(() => {
        usernameService.registerUsername(
          "ab", // too short
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
      }).toThrow("Username must be 3-20 characters long and contain only letters and numbers");

      expect(() => {
        usernameService.registerUsername(
          "abc def", // contains space
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
      }).toThrow("Username must be 3-20 characters long and contain only letters and numbers");

      expect(() => {
        usernameService.registerUsername(
          "a".repeat(21), // too long
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
      }).toThrow("Username must be 3-20 characters long and contain only letters and numbers");
    });

    it("throws error for invalid public key format", () => {
      expect(() => {
        usernameService.registerUsername(
          "alice123",
          "invalid_key"
        );
      }).toThrow("Invalid Stellar public key format");

      expect(() => {
        usernameService.registerUsername(
          "alice123",
          "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" // wrong prefix
        );
      }).toThrow("Invalid Stellar public key format");
    });

    it("throws error for missing username", () => {
      expect(() => {
        usernameService.registerUsername(
          "",
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
      }).toThrow("Username is required");
    });

    it("throws error for missing public key", () => {
      expect(() => {
        usernameService.registerUsername("alice123", "");
      }).toThrow("Public key is required");
    });
  });

  describe("resolveUsername", () => {
    beforeEach(() => {
      usernameService.registerUsername(
        "alice123",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      );
    });

    it("resolving a registered username returns the correct address", () => {
      const result = usernameService.resolveUsername("alice123");

      expect(result.username).toBe("alice123");
      expect(result.publicKey).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    });

    it("resolving an unregistered username returns a clear not-found result", () => {
      expect(() => {
        usernameService.resolveUsername("nonexistent");
      }).toThrow("Username not found");
    });

    it("throws error with 404 status for unregistered username", () => {
      try {
        usernameService.resolveUsername("nonexistent");
        fail("Should have thrown error");
      } catch (err) {
        expect(err.status).toBe(404);
        expect(err.message).toBe("Username not found");
      }
    });

    it("throws error for invalid username format", () => {
      expect(() => {
        usernameService.resolveUsername("ab");
      }).toThrow("Username must be 3-20 characters long and contain only letters and numbers");
    });

    it("throws error for missing username", () => {
      expect(() => {
        usernameService.resolveUsername("");
      }).toThrow("Username is required");
    });
  });

  describe("getAllUsernames", () => {
    beforeEach(() => {
      usernameService.registerUsername(
        "alice123",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      );
      usernameService.registerUsername(
        "bob456",
        "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
      );
    });

    it("returns all registered usernames", () => {
      const result = usernameService.getAllUsernames();

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("username");
      expect(result[0]).toHaveProperty("publicKey");
      expect(result[1]).toHaveProperty("username");
      expect(result[1]).toHaveProperty("publicKey");
    });

    it("returns empty array when no usernames are registered", () => {
      usernameService.clear();
      const result = usernameService.getAllUsernames();

      expect(result).toHaveLength(0);
    });
  });

  describe("removeUsername", () => {
    beforeEach(() => {
      usernameService.registerUsername(
        "alice123",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      );
    });

    it("removes an existing username", () => {
      const result = usernameService.removeUsername("alice123");

      expect(result.username).toBe("alice123");
      expect(() => usernameService.resolveUsername("alice123")).toThrow("Username not found");
    });

    it("throws error when removing non-existent username", () => {
      expect(() => {
        usernameService.removeUsername("nonexistent");
      }).toThrow("Username not found");
    });

    it("throws error with 404 status for non-existent username", () => {
      try {
        usernameService.removeUsername("nonexistent");
        fail("Should have thrown error");
      } catch (err) {
        expect(err.status).toBe(404);
        expect(err.message).toBe("Username not found");
      }
    });

    it("throws error for invalid username format", () => {
      expect(() => {
        usernameService.removeUsername("ab");
      }).toThrow("Username must be 3-20 characters long and contain only letters and numbers");
    });

    it("throws error for missing username", () => {
      expect(() => {
        usernameService.removeUsername("");
      }).toThrow("Username is required");
    });
  });

  describe("validateUsername", () => {
    it("accepts valid usernames", () => {
      expect(() => usernameService.validateUsername("alice123")).not.toThrow();
      expect(() => usernameService.validateUsername("Bob456")).not.toThrow();
      expect(() => usernameService.validateUsername("ABC123")).not.toThrow();
      expect(() => usernameService.validateUsername("a".repeat(20))).not.toThrow();
    });

    it("rejects usernames that are too short", () => {
      expect(() => usernameService.validateUsername("ab")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
      expect(() => usernameService.validateUsername("a")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
    });

    it("rejects usernames that are too long", () => {
      expect(() => usernameService.validateUsername("a".repeat(21))).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
    });

    it("rejects usernames with special characters", () => {
      expect(() => usernameService.validateUsername("alice_123")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
      expect(() => usernameService.validateUsername("alice-123")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
      expect(() => usernameService.validateUsername("alice.123")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
      expect(() => usernameService.validateUsername("alice 123")).toThrow(
        "Username must be 3-20 characters long and contain only letters and numbers"
      );
    });

    it("rejects empty username", () => {
      expect(() => usernameService.validateUsername("")).toThrow("Username is required");
    });

    it("rejects null/undefined username", () => {
      expect(() => usernameService.validateUsername(null)).toThrow("Username is required");
      expect(() => usernameService.validateUsername(undefined)).toThrow("Username is required");
    });
  });

  describe("validatePublicKey", () => {
    it("accepts valid Stellar public keys", () => {
      expect(() =>
        usernameService.validatePublicKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
      ).not.toThrow();
      expect(() =>
        usernameService.validatePublicKey("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")
      ).not.toThrow();
    });

    it("rejects public keys with wrong prefix", () => {
      expect(() =>
        usernameService.validatePublicKey("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
      ).toThrow("Invalid Stellar public key format");
      expect(() =>
        usernameService.validatePublicKey("MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
      ).toThrow("Invalid Stellar public key format");
    });

    it("rejects public keys with incorrect length", () => {
      expect(() =>
        usernameService.validatePublicKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
      ).toThrow("Invalid Stellar public key format");
      // 57 chars (too long) — valid prefix but wrong length
      expect(() =>
        usernameService.validatePublicKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
      ).toThrow("Invalid Stellar public key format");
    });

    it("rejects public keys with invalid characters", () => {
      expect(() =>
        usernameService.validatePublicKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH!")
      ).toThrow("Invalid Stellar public key format");
      expect(() =>
        usernameService.validatePublicKey("Gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      ).toThrow("Invalid Stellar public key format");
    });

    it("rejects empty public key", () => {
      expect(() => usernameService.validatePublicKey("")).toThrow("Public key is required");
    });

    it("rejects null/undefined public key", () => {
      expect(() => usernameService.validatePublicKey(null)).toThrow("Public key is required");
      expect(() => usernameService.validatePublicKey(undefined)).toThrow("Public key is required");
    });
  });
});
