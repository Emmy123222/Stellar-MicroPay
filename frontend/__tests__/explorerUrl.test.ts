/**
 * @jest-environment node
 */
import { explorerUrl } from "@/lib/stellar";

const VALID = "a".repeat(64);

describe("explorerUrl (#274)", () => {
  it("returns a stellar.expert URL for a valid 64-char hex hash", () => {
    const url = explorerUrl(VALID);
    expect(url).not.toBeNull();
    expect(url).toContain(`/tx/${VALID}`);
    expect(url).toMatch(/^https:\/\/stellar\.expert\/explorer\/(testnet|public)\/tx\//);
  });

  it("accepts mixed-case hex", () => {
    expect(explorerUrl("A1b2C3d4".repeat(8))).not.toBeNull();
  });

  it("returns null for an empty hash", () => {
    expect(explorerUrl("")).toBeNull();
  });

  it("returns null for a too-short hash", () => {
    expect(explorerUrl("abc123")).toBeNull();
  });

  it("returns null for a non-hex string of the right length", () => {
    expect(explorerUrl("z".repeat(64))).toBeNull();
  });
});
