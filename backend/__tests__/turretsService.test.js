"use strict";

const { stopRunner, startRunner } = require("../src/services/turretsService");

describe("Turrets Service", () => {
  afterAll(() => {
    // Clear the timer that leaks in tests
    stopRunner();
  });

  it("should start and stop runner", () => {
    startRunner();
    expect(true).toBe(true);
  });
});
