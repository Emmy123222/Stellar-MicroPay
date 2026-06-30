/**
 * __tests__/wallet.test.ts
 * Unit tests for wallet.ts with mocked @stellar/freighter-api
 */

// Mock @stellar/freighter-api before importing
jest.mock("@stellar/freighter-api");

// Mock the stellar library
jest.mock("@/lib/stellar", () => ({
  getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
}));

// Mock fetch
global.fetch = jest.fn();

import {
  isFreighterInstalled,
  connectWallet,
  signTransactionWithWallet,
  hasSiteAccess,
  getConnectedPublicKey,
  performSEP0010Auth,
  detectBrowser,
  disconnectWallet,
  setJwtToken,
  getJwtToken,
} from "@/lib/wallet";

import * as freighterApi from "@stellar/freighter-api";

const mockIsConnected = freighterApi.isConnected as jest.Mock;
const mockGetAddress = freighterApi.getAddress as jest.Mock;
const mockRequestAccess = freighterApi.requestAccess as jest.Mock;
const mockSignTransaction = freighterApi.signTransaction as jest.Mock;
const mockIsAllowed = freighterApi.isAllowed as jest.Mock;

describe("wallet.ts", () => {
  const mockPublicKey = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";
  const mockXDR = "AAAAAgAAAABZoZ5MvWi1I5BwUz8l0Tm9S7Fb9wKpAw6PxXFRp6Yy";
  const mockSignedXDR = "AAAAAgAAAABZoZ5MvWi1I5BwUz8l0Tm9S7Fb9wKpAw6PxXFRp6YyAAAABQAAAAAB";

  beforeEach(() => {
    jest.clearAllMocks();
    setJwtToken(null);
    (global.fetch as jest.Mock).mockClear();
  });

  describe("isFreighterInstalled", () => {
    it("returns true when Freighter is connected", async () => {
      mockIsConnected.mockResolvedValue({ isConnected: true });

      const result = await isFreighterInstalled();

      expect(result).toBe(true);
      expect(mockIsConnected).toHaveBeenCalled();
    });

    it("returns false when isConnected throws", async () => {
      mockIsConnected.mockRejectedValue(new Error("Extension not available"));

      const result = await isFreighterInstalled();

      expect(result).toBe(false);
      expect(mockIsConnected).toHaveBeenCalled();
    });

    it("returns false when isConnected returns false", async () => {
      mockIsConnected.mockResolvedValue({ isConnected: false });

      const result = await isFreighterInstalled();

      expect(result).toBe(false);
    });
  });

  describe("connectWallet", () => {
    it("returns error when Freighter is not installed", async () => {
      mockIsConnected.mockRejectedValue(new Error("Extension not found"));

      const result = await connectWallet();

      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Freighter wallet is not installed");
    });

    it("returns error when user declines connection", async () => {
      mockIsConnected.mockResolvedValue({ isConnected: true });
      mockRequestAccess.mockRejectedValue(new Error("User declined"));

      const result = await connectWallet();

      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Connection rejected");
    });

    it("returns public key on successful connection", async () => {
      mockIsConnected.mockResolvedValue({ isConnected: true });
      mockRequestAccess.mockResolvedValue({ address: mockPublicKey });

      const result = await connectWallet();

      expect(result.publicKey).toBe(mockPublicKey);
      expect(result.error).toBeNull();
    });

    it("falls back to getAddress when requestAccess doesn't return address", async () => {
      mockIsConnected.mockResolvedValue({ isConnected: true });
      mockRequestAccess.mockResolvedValue({}); // No address in response
      mockGetAddress.mockResolvedValue({ address: mockPublicKey });

      const result = await connectWallet();

      expect(result.publicKey).toBe(mockPublicKey);
      expect(result.error).toBeNull();
      expect(mockGetAddress).toHaveBeenCalled();
    });

    it("returns error when no public key is returned", async () => {
      mockIsConnected.mockResolvedValue({ isConnected: true });
      mockRequestAccess.mockResolvedValue({});
      mockGetAddress.mockResolvedValue({}); // No address

      const result = await connectWallet();

      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("No public key returned");
    });

    it("returns error with custom message on other failures", async () => {
      mockIsConnected.mockResolvedValue({ isConnected: true });
      mockRequestAccess.mockRejectedValue(new Error("Network error"));

      const result = await connectWallet();

      expect(result.publicKey).toBeNull();
      expect(result.error).toContain("Wallet connection failed");
    });
  });

  describe("signTransactionWithWallet", () => {
    it("returns signed XDR on success", async () => {
      mockSignTransaction.mockResolvedValue({
        signedTxXdr: mockSignedXDR,
      });

      const result = await signTransactionWithWallet(mockXDR);

      expect(result.signedXDR).toBe(mockSignedXDR);
      expect(result.error).toBeNull();
      expect(mockSignTransaction).toHaveBeenCalledWith(mockXDR, {
        networkPassphrase: "Test SDF Network ; September 2015",
      });
    });

    it("returns error when signing is rejected by user", async () => {
      mockSignTransaction.mockRejectedValue(new Error("User declined"));

      const result = await signTransactionWithWallet(mockXDR);

      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("Transaction signing was rejected");
    });

    it("returns error when Freighter returns an error", async () => {
      mockSignTransaction.mockResolvedValue({
        error: { message: "Invalid transaction" },
      });

      const result = await signTransactionWithWallet(mockXDR);

      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("Invalid transaction");
    });

    it("returns error with generic message on failure", async () => {
      mockSignTransaction.mockRejectedValue(new Error("Network timeout"));

      const result = await signTransactionWithWallet(mockXDR);

      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("Signing failed");
    });

    it("handles rejected rejection without Error instance", async () => {
      mockSignTransaction.mockRejectedValue("Unknown error");

      const result = await signTransactionWithWallet(mockXDR);

      expect(result.signedXDR).toBeNull();
      expect(result.error).toContain("Signing failed");
    });
  });

  describe("hasSiteAccess", () => {
    it("returns true when site has access", async () => {
      mockIsAllowed.mockResolvedValue({ isAllowed: true });

      const result = await hasSiteAccess();

      expect(result).toBe(true);
    });

    it("returns false when site does not have access", async () => {
      mockIsAllowed.mockResolvedValue({ isAllowed: false });

      const result = await hasSiteAccess();

      expect(result).toBe(false);
    });

    it("returns false when isAllowed throws", async () => {
      mockIsAllowed.mockRejectedValue(new Error("API error"));

      const result = await hasSiteAccess();

      expect(result).toBe(false);
    });
  });

  describe("getConnectedPublicKey", () => {
    it("returns public key when site has access", async () => {
      mockIsAllowed.mockResolvedValue({ isAllowed: true });
      mockGetAddress.mockResolvedValue({ address: mockPublicKey });

      const result = await getConnectedPublicKey();

      expect(result).toBe(mockPublicKey);
    });

    it("returns null when site does not have access", async () => {
      mockIsAllowed.mockResolvedValue({ isAllowed: false });

      const result = await getConnectedPublicKey();

      expect(result).toBeNull();
      expect(mockGetAddress).not.toHaveBeenCalled();
    });

    it("returns null when getAddress throws", async () => {
      mockIsAllowed.mockResolvedValue({ isAllowed: true });
      mockGetAddress.mockRejectedValue(new Error("Error getting address"));

      const result = await getConnectedPublicKey();

      expect(result).toBeNull();
    });
  });

  describe("detectBrowser", () => {
    const originalUserAgent = navigator.userAgent;

    it("detects Chrome browser", () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0",
        configurable: true,
      });

      const result = detectBrowser();
      expect(result).toBe("chrome");
    });

    it("detects Firefox browser", () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
        configurable: true,
      });

      const result = detectBrowser();
      expect(result).toBe("firefox");
    });

    it("returns other for unknown browser", () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "CustomBrowser/1.0",
        configurable: true,
      });

      const result = detectBrowser();
      expect(result).toBe("other");
    });
  });

  describe("JWT token management", () => {
    it("sets and gets JWT token", () => {
      const token = "test-jwt-token-123";
      setJwtToken(token);

      expect(getJwtToken()).toBe(token);
    });

    it("clears JWT token when set to null", () => {
      setJwtToken("test-token");
      setJwtToken(null);

      expect(getJwtToken()).toBeNull();
    });

    it("disconnectWallet clears JWT token", () => {
      setJwtToken("test-token");
      disconnectWallet();

      expect(getJwtToken()).toBeNull();
    });
  });

  describe("performSEP0010Auth", () => {
    it("returns token on successful authentication", async () => {
      const challengeXDR = "challenge-xdr-123";
      const jwtToken = "jwt-token-456";

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: challengeXDR }),
      });

      mockSignTransaction.mockResolvedValue({
        signedTxXdr: mockSignedXDR,
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: jwtToken }),
      });

      const result = await performSEP0010Auth(mockPublicKey);

      expect(result.token).toBe(jwtToken);
      expect(result.error).toBeNull();
      expect(getJwtToken()).toBe(jwtToken);
    });

    it("returns error when challenge fetch fails", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Challenge not available" }),
      });

      const result = await performSEP0010Auth(mockPublicKey);

      expect(result.token).toBeNull();
      expect(result.error).toContain("Authentication failed");
    });

    it("returns error when signing fails", async () => {
      const challengeXDR = "challenge-xdr-123";

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: challengeXDR }),
      });

      mockSignTransaction.mockRejectedValue(new Error("User declined signing"));

      const result = await performSEP0010Auth(mockPublicKey);

      expect(result.token).toBeNull();
      expect(result.error).toContain("signing was rejected");
    });
  });
});
