const request = require("supertest");
const app = require("../src/server");

describe("Security: JSON Body Limits", () => {
  it("should reject JSON payloads larger than 10kb", async () => {
    // Generate a string larger than 10kb
    const largePayload = {
      data: "a".repeat(50 * 1024)
    };

    const res = await request(app)
      .post("/api/v1/accounts/create") // Any POST route that parses body
      .send(largePayload)
      .set("Content-Type", "application/json");

    expect(res.statusCode).toBe(413); // Payload Too Large
  });

  it("should accept JSON payloads smaller than 10kb", async () => {
    const smallPayload = {
      data: "a".repeat(1024)
    };

    const res = await request(app)
      .post("/api/v1/accounts/create") // Doesn't matter if it fails logic, as long as it isn't 413
      .send(smallPayload)
      .set("Content-Type", "application/json");

    expect(res.statusCode).not.toBe(413);
  });
});
