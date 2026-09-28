/**
 * Test stellar.ts module can be imported in Node environment without crashing.
 * This verifies the fix for issue #1000 (SSR localStorage crash).
 */

describe("stellar.ts SSR compatibility", () => {
  it("should import without crashing in Node environment", () => {
    // Clear window to simulate server-side environment
    const originalWindow = global.window;
    delete (global as any).window;

    try {
      // This should not throw even though localStorage is undefined
      expect(() => {
        require("../lib/stellar");
      }).not.toThrow();
    } finally {
      // Restore window
      if (originalWindow) {
        (global as any).window = originalWindow;
      }
    }
  });

  it("should allow calling getNetworkConfig() in Node environment", () => {
    const originalWindow = global.window;
    delete (global as any).window;

    try {
      const { getNetworkConfig } = require("../lib/stellar");
      const config = getNetworkConfig();
      
      expect(config).toBeDefined();
      expect(config.network).toBe("testnet"); // Default when no env vars
      expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    } finally {
      if (originalWindow) {
        (global as any).window = originalWindow;
      }
    }
  });
});
