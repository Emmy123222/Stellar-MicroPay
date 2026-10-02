/**
 * __tests__/sanitization.test.js
 * Unit tests for the parameter sanitization and validation middleware.
 */

"use strict";

const request = require("supertest");
const app = require("../src/server");
const { validatePublicKey, sanitizeRequest } = require("../src/middleware/sanitization");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const VALID_PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("validatePublicKey middleware", () => {
  const VALID_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

  it("calls next() for a valid public key", () => {
    const req = { params: { publicKey: VALID_KEY } };
    const res = mockRes();
    const next = jest.fn();

    validatePublicKey()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 for a key with the wrong prefix", () => {
    const req = { params: { publicKey: `A${VALID_KEY.slice(1)}` } };
    const res = mockRes();
    const next = jest.fn();

    validatePublicKey()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid Stellar public key" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a key with the wrong length", () => {
    const req = { params: { publicKey: VALID_KEY.slice(0, -1) } };
    const res = mockRes();
    const next = jest.fn();

    validatePublicKey()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid Stellar public key" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a key with invalid characters", () => {
    const req = { params: { publicKey: `${VALID_KEY.slice(0, -1)}!` } };
    const res = mockRes();
    const next = jest.fn();

    validatePublicKey()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid Stellar public key" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing key", () => {
    const req = { params: {} };
    const res = mockRes();
    const next = jest.fn();

    validatePublicKey()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("validates against a custom param name", () => {
    const req = { params: { creatorPublicKey: VALID_KEY } };
    const res = mockRes();
    const next = jest.fn();

    validatePublicKey("creatorPublicKey")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid value under a custom param name", () => {
    const req = { params: { senderPublicKey: "not-a-valid-key" } };
    const res = mockRes();
    const next = jest.fn();

    validatePublicKey("senderPublicKey")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid Stellar public key" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("sanitizeRequest middleware", () => {
  it("trims string values in the body, including nested objects and arrays", () => {
    const req = {
      body: {
        username: "  alice  ",
        nested: { memo: "  hi  " },
        tags: [" one ", "two "],
        amount: 5,
      },
      query: {},
    };
    const res = createRes();
    const next = jest.fn();

    sanitizeRequest(req, res, next);

    expect(req.body).toEqual({
      username: "alice",
      nested: { memo: "hi" },
      tags: ["one", "two"],
      amount: 5,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("trims string values in the query string", () => {
    const req = { body: {}, query: { search: "  stellar  " } };
    const res = createRes();
    const next = jest.fn();

    sanitizeRequest(req, res, next);

    expect(req.query.search).toBe("stellar");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when a null byte is present in a body string field", () => {
    const req = { body: { username: "alice\u0000" }, query: {} };
    const res = createRes();
    const next = jest.fn();

    sanitizeRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Request contains null bytes" });
    expect(next).not.toHaveBeenCalled();
  });

  it("detects null bytes nested inside body values", () => {
    const req = { body: { profile: { displayName: "bob\u0000" } }, query: {} };
    const res = createRes();
    const next = jest.fn();

    sanitizeRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("leaves non-string values untouched", () => {
    const req = { body: { amount: 12.5, verified: true, meta: null }, query: {} };
    const res = createRes();
    const next = jest.fn();

    sanitizeRequest(req, res, next);

    expect(req.body).toEqual({ amount: 12.5, verified: true, meta: null });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("global sanitization on POST routes", () => {
  it("rejects a POST body containing a null byte with 400", async () => {
    const res = await request(app)
      .post("/api/accounts/register")
      .send({ username: "alice", publicKey: `${VALID_PUBLIC_KEY}\u0000` });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Request contains null bytes" });
  });

  it("rejects payloads larger than 10 KB", async () => {
    const res = await request(app)
      .post("/api/accounts/register")
      .send({ username: "alice", publicKey: "a".repeat(11 * 1024) });

    expect(res.status).toBe(413);
  });
});
