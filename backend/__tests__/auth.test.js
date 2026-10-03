"use strict";

const request = require("supertest");
const app = require("../src/server");

describe("SEP-0010 auth rate limiting", () => {
  it("blocks the sixth verification request from the same IP within a minute", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post("/api/auth").send({}).expect(400);
    }

    const response = await request(app).post("/api/auth").send({}).expect(429);

    expect(response.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("allows ten challenge requests and blocks the eleventh from the same IP", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app).get("/api/auth").expect(400);
    }

    const response = await request(app).get("/api/auth").expect(429);

    expect(response.headers["retry-after"]).toMatch(/^\d+$/);
  });
});