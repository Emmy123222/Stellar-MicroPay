/**
 * __tests__/healthHorizonBreaker.test.js (#840)
 */

"use strict";

const request = require("supertest");

jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (req, res, next) => next(),
}));

const app = require("../src/server");
const { getBreaker, resetAllBreakers } = require("../src/services/horizonCircuitBreaker");

describe("GET /health horizon circuit visibility (#840)", () => {
  beforeEach(() => {
    resetAllBreakers();
  });

  afterAll(() => {
    resetAllBreakers();
  });

  it("returns ok with closed circuit by default", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.horizon.network).toBe("testnet");
    expect(res.body.horizon.openOrigins).toEqual([]);
    expect(res.body.horizon.halfOpenOrigins).toEqual([]);
  });

  it("reports degraded status and open origins when the breaker is open", async () => {
    const breaker = getBreaker("https://horizon-testnet.stellar.org", { failureThreshold: 1 });
    breaker.recordFailure();

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.horizon.openOrigins).toContain("https://horizon-testnet.stellar.org");
    expect(res.body.horizon.circuits[0]).toMatchObject({
      state: "open",
      network: "testnet",
    });
  });
});
