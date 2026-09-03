import {
  classifyDestination,
  resolveDestination,
  isValidStellarAddress,
  isStellarName,
} from "/lib/stellar";

// A valid 56-char Stellar public key for testing (G + 55 alphanumeric chars)
const VALID_ADDRESS = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".repeat(2).slice(0, 55);

// ─── classifyDestination ────────────────────────────────────────────────────

describe("classifyDestination", () => {
  describe("address detection", () => {
    it("classifies a valid G... public key as address", () => {
      const result = classifyDestination(VALID_ADDRESS);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("address");
      expect(result.normalized).toBe(VALID_ADDRESS);
    });

    it("trims whitespace from addresses", () => {
      const result = classifyDestination(`  ${VALID_ADDRESS}  `);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("address");
      expect(result.normalized).toBe(VALID_ADDRESS);
    });
  });

  describe("federation detection", () => {
    it("classifies user*domain.com as federation", () => {
      const result = classifyDestination("alice*stellar.org");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("federation");
    });

    it("classifies user*domain.io as federation", () => {
      const result = classifyDestination("bob*xlm.money");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("federation");
    });
  });

  describe("SNS detection", () => {
    it("classifies .xlm names as sns", () => {
      const result = classifyDestination("alice.xlm");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("sns");
    });

    it("trims .xlm names", () => {
      const result = classifyDestination("  alice.xlm  ");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("sns");
      expect(result.normalized).toBe("alice.xlm");
    });
  });

  describe("username detection", () => {
    it("classifies bare usernames (3-20 chars) as username", () => {
      const result = classifyDestination("alice");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("username");
    });

    it("strips leading @ from usernames", () => {
      const result = classifyDestination("@alice");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("username");
      expect(result.normalized).toBe("alice");
    });

    it("rejects usernames shorter than 3 chars", () => {
      const result = classifyDestination("ab");
      expect(result.valid).toBe(false);
      expect(result.kind).toBe("unknown");
    });

    it("rejects usernames longer than 20 chars", () => {
      const result = classifyDestination("a".repeat(21));
      expect(result.valid).toBe(false);
      expect(result.kind).toBe("unknown");
    });
  });

  describe("empty / unknown input", () => {
    it("returns invalid for empty string", () => {
      const result = classifyDestination("");
      expect(result.valid).toBe(false);
      expect(result.kind).toBe("unknown");
      expect(result.error).toBeDefined();
    });

    it("returns invalid for random text", () => {
      const result = classifyDestination("hello world!");
      expect(result.valid).toBe(false);
      expect(result.kind).toBe("unknown");
    });

    it("returns invalid for a URL", () => {
      const result = classifyDestination("https://stellar.org");
      expect(result.valid).toBe(false);
      expect(result.kind).toBe("unknown");
    });
  });
});

// ─── resolveDestination ─────────────────────────────────────────────────────

describe("resolveDestination", () => {
  it("returns the address directly for valid G... keys", async () => {
    const result = await resolveDestination(VALID_ADDRESS);
    expect(result.publicKey).toBe(VALID_ADDRESS);
    expect(result.kind).toBe("address");
    expect(result.raw).toBe(VALID_ADDRESS);
  });

  it("throws for invalid input", async () => {
    await expect(resolveDestination("")).rejects.toThrow(
      "Destination is required"
    );
  });

  it("throws for random text", async () => {
    await expect(resolveDestination("hello world")).rejects.toThrow(
      "Enter a valid Stellar public key"
    );
  });

  it("resolves usernames via the injected resolver", async () => {
    const mockResolver = jest.fn().mockResolvedValue(VALID_ADDRESS);
    const result = await resolveDestination("alice", mockResolver);
    expect(result.publicKey).toBe(VALID_ADDRESS);
    expect(result.kind).toBe("username");
    expect(result.raw).toBe("alice");
    expect(mockResolver).toHaveBeenCalledWith("alice");
  });

  it("resolves @-prefixed usernames via the injected resolver", async () => {
    const mockResolver = jest.fn().mockResolvedValue(VALID_ADDRESS);
    const result = await resolveDestination("@alice", mockResolver);
    expect(result.publicKey).toBe(VALID_ADDRESS);
    expect(result.kind).toBe("username");
    expect(mockResolver).toHaveBeenCalledWith("alice");
  });

  it("throws when username resolver is not provided", async () => {
    await expect(resolveDestination("alice")).rejects.toThrow(
      "Username resolver is not available"
    );
  });

  it("throws when resolver returns an invalid public key", async () => {
    const mockResolver = jest.fn().mockResolvedValue("not-a-valid-key");
    await expect(
      resolveDestination("alice", mockResolver)
    ).rejects.toThrow("did not return a valid public key");
  });

  it("throws when resolver rejects", async () => {
    const mockResolver = jest.fn().mockRejectedValue(new Error("Network error"));
    await expect(
      resolveDestination("alice", mockResolver)
    ).rejects.toThrow("Network error");
  });
});

// ─── Consistency: classifyDestination + resolveDestination agree ─────────────

describe("pipeline consistency", () => {
  it("classifyDestination and resolveDestination agree on kind", async () => {
    const inputs = [
      { raw: VALID_ADDRESS, kind: "address" as const },
      { raw: "alice", kind: "username" as const },
      { raw: "@bob", kind: "username" as const },
    ];

    const mockResolver = jest.fn().mockResolvedValue(VALID_ADDRESS);

    for (const { raw, kind } of inputs) {
      const classification = classifyDestination(raw);
      expect(classification.valid).toBe(true);
      expect(classification.kind).toBe(kind);

      const resolved = await resolveDestination(raw, mockResolver);
      expect(resolved.kind).toBe(classification.kind);
      expect(resolved.raw).toBe(raw);
    }
  });

  it("rejects the same inputs in both classify and resolve", async () => {
    const invalidInputs = ["", "hello world", "https://example.com"];

    for (const input of invalidInputs) {
      const classification = classifyDestination(input);
      expect(classification.valid).toBe(false);

      await expect(resolveDestination(input)).rejects.toThrow();
    }
  });
});
