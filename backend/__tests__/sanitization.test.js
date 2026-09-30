/**
 * __tests__/sanitization.test.js
 * Unit tests for the validatePublicKey middleware.
 */

"use strict";

const { validatePublicKey } = require("../src/middleware/sanitization");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

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
