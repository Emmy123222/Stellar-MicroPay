"use strict";

const jwt = require("jsonwebtoken");
const {
  verifyJWT,
  JWT_SECRET,
  MAX_FAILED_ATTEMPTS,
  resetFailedAttempts,
} = require("../src/middleware/auth");

function mockReq(token, ip = "203.0.113.7") {
  return { ip, headers: { authorization: `Bearer ${token}` } };
}

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
}

describe("JWT verification lockout", () => {
  beforeEach(() => resetFailedAttempts());

  it("locks out an IP after 5 failed verifications", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      const res = mockRes();
      verifyJWT(mockReq("bad-token"), res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    }

    const validToken = jwt.sign({ publicKey: "GTEST" }, JWT_SECRET);
    const res = mockRes();
    const next = jest.fn();
    verifyJWT(mockReq(validToken), res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
    expect(next).not.toHaveBeenCalled();
  });

  it("does not lock out other IPs", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      verifyJWT(mockReq("bad-token"), mockRes(), jest.fn());
    }

    const validToken = jwt.sign({ publicKey: "GTEST" }, JWT_SECRET);
    const next = jest.fn();
    verifyJWT(mockReq(validToken, "198.51.100.1"), mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it("resets the failure count after a successful verification", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      verifyJWT(mockReq("bad-token"), mockRes(), jest.fn());
    }

    const validToken = jwt.sign({ publicKey: "GTEST" }, JWT_SECRET);
    verifyJWT(mockReq(validToken), mockRes(), jest.fn());

    const res = mockRes();
    verifyJWT(mockReq("bad-token"), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
