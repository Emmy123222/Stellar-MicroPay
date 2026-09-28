"use strict";

const fs = require("fs");
const path = require("path");

describe("Route mount configuration", () => {
  it("should not have duplicate route mounts in server.js", () => {
    const serverPath = path.join(__dirname, "..", "src", "server.js");
    const serverContent = fs.readFileSync(serverPath, "utf-8");

    // Extract all app.use() calls with route paths
    const routeMountPattern = /app\.use\(["']([^"']+)["']\s*,\s*(\w+)\)/g;
    const routeMounts = [];
    let match;

    while ((match = routeMountPattern.exec(serverContent)) !== null) {
      const [, routePath, routeHandler] = match;
      routeMounts.push({ path: routePath, handler: routeHandler, fullMatch: match[0] });
    }

    // Check for duplicate path + handler combinations
    const duplicates = [];
    const seen = new Map();

    for (const mount of routeMounts) {
      const key = `${mount.path}::${mount.handler}`;
      if (seen.has(key)) {
        duplicates.push({
          path: mount.path,
          handler: mount.handler,
          firstOccurrence: seen.get(key),
          duplicate: mount.fullMatch,
        });
      } else {
        seen.set(key, mount.fullMatch);
      }
    }

    // Assert no duplicates exist
    if (duplicates.length > 0) {
      const errorMessage = duplicates
        .map(
          (dup) =>
            `Duplicate route mount detected:\n` +
            `  Path: ${dup.path}\n` +
            `  Handler: ${dup.handler}\n` +
            `  First: ${dup.firstOccurrence}\n` +
            `  Duplicate: ${dup.duplicate}`
        )
        .join("\n\n");
      
      fail(errorMessage);
    }

    expect(duplicates.length).toBe(0);
  });

  it("should mount accountRoutes and paymentRoutes exactly once", () => {
    const serverPath = path.join(__dirname, "..", "src", "server.js");
    const serverContent = fs.readFileSync(serverPath, "utf-8");

    // Count occurrences of accountRoutes mounting
    const accountMounts = (serverContent.match(/app\.use\([^)]*accountRoutes\)/g) || []).length;
    expect(accountMounts).toBe(1);

    // Count occurrences of paymentRoutes mounting
    const paymentMounts = (serverContent.match(/app\.use\([^)]*paymentRoutes\)/g) || []).length;
    expect(paymentMounts).toBe(1);
  });

  it("should mount all routes after rate limiter middleware", () => {
    const serverPath = path.join(__dirname, "..", "src", "server.js");
    const serverContent = fs.readFileSync(serverPath, "utf-8");

    // Find the position of rate limiter application
    const rateLimiterMatch = serverContent.match(/app\.use\(limiter\)/);
    expect(rateLimiterMatch).toBeTruthy();
    
    const rateLimiterPosition = rateLimiterMatch.index;

    // Find positions of critical route mounts
    const accountRoutesMatch = serverContent.match(/app\.use\(["']\/api\/accounts["']\s*,\s*accountRoutes\)/);
    const paymentRoutesMatch = serverContent.match(/app\.use\(["']\/api\/payments["']\s*,\s*paymentRoutes\)/);

    expect(accountRoutesMatch).toBeTruthy();
    expect(paymentRoutesMatch).toBeTruthy();

    // Verify routes are mounted after the rate limiter
    expect(accountRoutesMatch.index).toBeGreaterThan(rateLimiterPosition);
    expect(paymentRoutesMatch.index).toBeGreaterThan(rateLimiterPosition);
  });
});
