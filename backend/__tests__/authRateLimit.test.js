"use strict";

const request = require("supertest");
const app = require("../src/server");

describe("Authentication rate limits", () => {
  it("limits challenge requests to five per minute", async () => {
    const responses = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await request(app).get("/api/auth/challenge"));
    }

    expect(responses.slice(0, 5).every((response) => response.status !== 429)).toBe(true);
    expect(responses[5].status).toBe(429);
  });

  it("limits verification requests to five per minute", async () => {
    const responses = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await request(app).post("/api/auth/verify").send({}));
    }

    expect(responses.slice(0, 5).every((response) => response.status !== 429)).toBe(true);
    expect(responses[5].status).toBe(429);
  });
});
