/**
 * __tests__/sanitizeLogToken.test.js (#811)
 */

"use strict";

const {
  sanitizeLogToken,
  sanitizeLogHeaders,
  sanitizeReqLogRecord,
  sanitizeAccessLogLine,
} = require("../src/utils/sanitizeLogToken");

describe("sanitizeLogToken (#811)", () => {
  it("neutralizes CRLF log-forging attempts", () => {
    const forged = "attacker\r\n127.0.0.1 - admin [01/Jan/2026:00:00:00 +0000] \"GET /secrets HTTP/1.1\" 200";
    const sanitized = sanitizeLogToken(forged);

    expect(sanitized).not.toMatch(/[\r\n]/);
    expect(sanitized).toContain("attacker");
    expect(sanitized).toContain("127.0.0.1 - admin");
  });

  it("neutralizes terminal control characters", () => {
    const payload = "user\x1b[31mred\x07bell";
    const sanitized = sanitizeLogToken(payload);

    expect(sanitized).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(sanitized).toContain("user");
    expect(sanitized).toContain("red");
    expect(sanitized).toContain("bell");
  });

  it("sanitizes Basic auth usernames in header maps", () => {
    const authorization = `Basic ${Buffer.from("evil\r\nadmin").toString("base64")}`;
    const headers = sanitizeLogHeaders({
      authorization,
      "user-agent": "scanner\r\nFORGED",
    });

    expect(headers.authorization).not.toMatch(/[\r\n]/);
    expect(headers["user-agent"]).not.toMatch(/[\r\n]/);
  });

  it("sanitizes structured request log records", () => {
    const record = sanitizeReqLogRecord({
      id: 1,
      method: "GET",
      url: "/health\r\nINJECTED",
      remoteAddress: "10.0.0.1\r\n",
      headers: {
        authorization: "Basic forged\r\nuser",
      },
    });

    expect(record.url).toBe("/health INJECTED");
    expect(record.remoteAddress).toBe("10.0.0.1  ");
    expect(record.headers.authorization).toBe("Basic forged user");
  });

  it("sanitizes full access-log lines", () => {
    const line = '127.0.0.1 - evil\r\nadmin [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 0\n';
    const sanitized = sanitizeAccessLogLine(line);

    expect(sanitized).not.toMatch(/[\r\n]/);
  });

  it("passes through nullish and numeric values unchanged", () => {
    expect(sanitizeLogToken(null)).toBeNull();
    expect(sanitizeLogToken(undefined)).toBeUndefined();
    expect(sanitizeLogToken(404)).toBe(404);
  });
});
