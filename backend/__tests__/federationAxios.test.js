/**
 * __tests__/federationAxios.test.js
 *
 * Focused regression tests for the axios upgrade (issue #808).
 *
 * The federation controller is the only place the backend talks to external
 * HTTP endpoints through axios. These tests re-verify the behaviors the
 * upgrade must preserve:
 *   - bounded request timeouts (proxy/redirect/network hang protection)
 *   - clean failure on timeout and cancellation (AbortController-style)
 *   - no partial response state is written on failure
 */

"use strict";

jest.mock("axios");

const axios = require("axios");
const {
  resolveFederation,
} = require("../src/controllers/federationController");

const EXTERNAL_TOML =
  'FEDERATION_SERVER="https://federation.example.com/federation"\n';

function mockResponse() {
  const res = {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      if (this.statusCode === null) {
        this.statusCode = 200;
      }
      this.body = payload;
      return this;
    },
  };
  return res;
}

function mockRequest(stellarAddress, type = "name") {
  return {
    query: { q: stellarAddress, type },
    get: jest.fn(() => undefined),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  axios.get = jest.fn();
});

describe("federation controller axios behavior (axios 1.20.0)", () => {
  it("forwards external lookups with a bounded 5s timeout", async () => {
    axios.get
      .mockResolvedValueOnce({ data: EXTERNAL_TOML })
      .mockResolvedValueOnce({
        data: {
          stellar_address: "alice*example.com",
          account_id: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
      });

    const req = mockRequest("alice*example.com");
    const res = mockResponse();
    const next = jest.fn();

    await resolveFederation(req, res, next);

    expect(axios.get).toHaveBeenNthCalledWith(
      1,
      "https://example.com/.well-known/stellar.toml",
      { timeout: 5000 },
    );
    expect(axios.get).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("federation.example.com/federation"),
      { timeout: 5000 },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.stellar_address).toBe("alice*example.com");
    expect(next).not.toHaveBeenCalled();
  });

  it("surfaces a request timeout as a clean error with no partial response", async () => {
    const timeoutError = new Error("timeout of 5000ms exceeded");
    timeoutError.code = "ECONNABORTED";
    axios.get.mockRejectedValueOnce(timeoutError);

    const req = mockRequest("alice*example.com");
    const res = mockResponse();
    const next = jest.fn();

    await resolveFederation(req, res, next);

    expect(next).toHaveBeenCalledWith(timeoutError);
    expect(res.body).toBeNull();
    expect(res.statusCode).toBeNull();
  });

  it("surfaces a cancelled (AbortController) request as a clean error with no partial response", async () => {
    const cancelError = new Error("canceled");
    cancelError.code = "ERR_CANCELED";
    axios.get.mockRejectedValueOnce(cancelError);

    const req = mockRequest("alice*example.com");
    const res = mockResponse();
    const next = jest.fn();

    await resolveFederation(req, res, next);

    expect(next).toHaveBeenCalledWith(cancelError);
    expect(res.body).toBeNull();
    expect(res.statusCode).toBeNull();
  });

  it("maps an upstream 404 to a 404 response without leaking internals", async () => {
    const notFoundError = new Error("Request failed with status code 404");
    notFoundError.response = { status: 404 };
    axios.get.mockRejectedValueOnce(notFoundError);

    const req = mockRequest("alice*example.com");
    const res = mockResponse();
    const next = jest.fn();

    await resolveFederation(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(next).not.toHaveBeenCalled();
  });
});
