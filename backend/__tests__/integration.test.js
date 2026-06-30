const request = require("supertest");
const nock = require("nock");

// Mock auth middleware before requiring app
jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (req, res, next) => {
    req.user = { publicKey: req.params.publicKey };
    next();
  },
}));

const app = require("../src/server");

describe("API Integration Tests", () => {
  afterAll(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe("GET /health", () => {
    it("should return 200 OK", async () => {
      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "ok");
    });
  });

  describe("GET /api/accounts/:key", () => {
    it("should return 200 for a valid public key", async () => {
      const publicKey = "GAO6LBHHRHUW6XBLUPLWZHWVISNL6XF6MY722G37WS2JMHVVIEEFN4DR";
      
      // Mock Horizon server call
      nock("https://horizon-testnet.stellar.org")
        .get(`/accounts/${publicKey}`)
        .reply(200, {
          id: publicKey,
          account_id: publicKey,
          sequence: "123",
          subentry_count: 0,
          balances: [{ balance: "100.0000000", asset_type: "native" }],
          thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
          flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
          signers: [{ weight: 1, key: publicKey, type: "ed25519_public_key" }],
          data: {},
          _links: {
            self: { href: `https://horizon-testnet.stellar.org/accounts/${publicKey}` }
          }
        });

      const response = await request(app).get(`/api/accounts/${publicKey}`);
      if (response.status !== 200) {
        console.error("DEBUG:", response.body);
      }
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.publicKey).toBe(publicKey);
    });

    it("should return 400 for an invalid public key", async () => {
      const invalidKey = "invalid_key";
      const response = await request(app).get(`/api/accounts/${invalidKey}`);
      // Usually either 400 from validation
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("GET /api/accounts/resolve/alice", () => {
    it("should return 501 Not Implemented", async () => {
      const response = await request(app).get("/api/accounts/resolve/alice");
      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Not Implemented");
    });
  });

  describe("GET /api/payments/:key", () => {
    it("should return an array of payments", async () => {
      const publicKey = "GAO6LBHHRHUW6XBLUPLWZHWVISNL6XF6MY722G37WS2JMHVVIEEFN4DR";
      const txHash = "hash123";

      // Mock Horizon server call for payments
      nock("https://horizon-testnet.stellar.org")
        .get(`/accounts/${publicKey}/payments`)
        .query(() => true)
        .reply(200, {
          _embedded: {
            records: [
              {
                id: "123",
                type_i: 1,
                type: "payment",
                asset_type: "native",
                amount: "10.0000000",
                from: "GAY...",
                to: publicKey,
                _links: {
                  transaction: {
                    href: `https://horizon-testnet.stellar.org/transactions/${txHash}`
                  }
                }
              }
            ]
          }
        });

      // Mock Horizon server call for the transaction (to fetch memo)
      nock("https://horizon-testnet.stellar.org")
        .get(`/transactions/${txHash}`)
        .reply(200, {
          id: txHash,
          memo_type: "text",
          memo: "test memo",
          created_at: "2023-01-01T00:00:00Z"
        });

      const response = await request(app).get(`/api/payments/${publicKey}`);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].id).toBe("123");
    });
  });
});
