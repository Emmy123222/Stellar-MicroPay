/**
 * __tests__/swagger-route-coverage.test.js
 *
 * Verifies that the OpenAPI spec served at /api/docs documents every route
 * registered by the federation, analytics, and turrets routers — with a
 * success response and the error responses the implementation can actually
 * return. The expected operations are derived from the Express routers
 * themselves (not from the docs), so a missing annotation fails the suite.
 */

"use strict";

const request = require("supertest");

const app = require("../src/server");
const swaggerSpec = require("../src/swagger");

// Mount points from src/server.js.
const ROUTERS = [
  { name: "federation", mount: "/federation", router: require("../src/routes/federation") },
  { name: "analytics", mount: "/api/analytics", router: require("../src/routes/analytics") },
  { name: "turrets", mount: "/api/turrets", router: require("../src/routes/turrets") },
];

// Error responses each operation can return, per the route middleware and
// controller/service implementation. 429 comes from the strict limiter
// (20/min on these route groups); 400 from sanitizePublicKey, body/config
// validation, or turretsService.validatePublicKey; 401 from an invalid deploy
// challenge signature; 404 from missing deployments or federation lookups.
const EXPECTED_ERRORS = {
  "GET /federation": ["400", "404", "429"],
  "GET /api/analytics/{publicKey}/summary": ["400", "429"],
  "GET /api/analytics/{publicKey}/top-recipients": ["400", "429"],
  "GET /api/analytics/{publicKey}/activity": ["400", "429"],
  "GET /api/turrets": ["400", "429"],
  "POST /api/turrets/challenge": ["400", "429"],
  "POST /api/turrets/deploy": ["400", "401", "429"],
  "GET /api/turrets/{id}": ["404", "429"],
  "GET /api/turrets/{id}/history": ["404", "429"],
  "POST /api/turrets/{id}/pause": ["404", "429"],
  "POST /api/turrets/{id}/resume": ["404", "429"],
};

/** Read the routes actually registered on an Express router. */
function routerOperations(router) {
  const operations = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).filter(
      (method) => layer.route.methods[method]
    );
    operations.push({ routePath: layer.route.path, methods });
  }
  return operations;
}

/** Convert an Express route path (`/:publicKey/summary`) to an OpenAPI path. */
function toSpecPath(mount, routePath) {
  const suffix =
    routePath === "/" ? "" : routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return suffix ? `${mount}${suffix}` : mount;
}

/** All `$ref` strings appearing anywhere in the spec. */
function collectRefs(node, refs = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectRefs(item, refs));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

describe("Swagger documentation for federation, analytics, and turrets", () => {
  describe("spec structure", () => {
    it("loads as an OpenAPI 3.0 document", () => {
      expect(swaggerSpec.openapi).toBe("3.0.0");
      expect(swaggerSpec.info.title).toBe("Stellar MicroPay API");
      expect(swaggerSpec.paths).toBeDefined();
      expect(swaggerSpec.components.schemas).toBeDefined();
    });

    it("resolves every $ref against the component schemas", () => {
      const refs = collectRefs(swaggerSpec);
      expect(refs.length).toBeGreaterThan(0);

      const broken = refs.filter((ref) => {
        if (!ref.startsWith("#/components/schemas/")) return true;
        const name = ref.replace("#/components/schemas/", "");
        return !swaggerSpec.components.schemas[name];
      });

      expect(broken).toEqual([]);
    });
  });

  describe.each(ROUTERS)("$name router coverage", ({ mount, router }) => {
    const operations = routerOperations(router);

    it("registers at least one route", () => {
      expect(operations.length).toBeGreaterThan(0);
    });

    it("documents every registered route with a success response", () => {
      const missing = [];

      for (const { routePath, methods } of operations) {
        for (const method of methods) {
          const specPath = toSpecPath(mount, routePath);
          const operation = (swaggerSpec.paths[specPath] || {})[method];

          if (!operation) {
            missing.push(`${method.toUpperCase()} ${specPath}`);
            continue;
          }

          const codes = Object.keys(operation.responses || {});
          const hasSuccess = codes.some((code) => /^2\d\d$/.test(code));
          if (!hasSuccess) {
            missing.push(`${method.toUpperCase()} ${specPath} (no 2xx response)`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it("documents no operations the router does not register", () => {
      const registered = new Set();
      for (const { routePath, methods } of operations) {
        for (const method of methods) {
          registered.add(`${method.toUpperCase()} ${toSpecPath(mount, routePath)}`);
        }
      }

      const documented = [];
      for (const [specPath, methods] of Object.entries(swaggerSpec.paths)) {
        if (!specPath.startsWith(mount)) continue;
        for (const method of Object.keys(methods)) {
          documented.push(`${method.toUpperCase()} ${specPath}`);
        }
      }

      const stale = documented.filter((operation) => !registered.has(operation));
      expect(stale).toEqual([]);
    });
  });

  describe("error responses", () => {
    it.each(Object.entries(EXPECTED_ERRORS))(
      "%s documents its error responses",
      (operation, expectedCodes) => {
        const [method, specPath] = operation.split(" ");
        const op = (swaggerSpec.paths[specPath] || {})[method.toLowerCase()];

        expect(op).toBeDefined();

        const documented = Object.keys(op.responses || {});
        const missing = expectedCodes.filter((code) => !documented.includes(code));

        expect(missing).toEqual([]);

        for (const code of expectedCodes) {
          expect(op.responses[code].description).toBeTruthy();
        }
      }
    );
  });

  describe("authentication", () => {
    it("declares no security requirement on these route groups", () => {
      // None of these routers use auth middleware (see routes/*.js); the
      // spec must not claim they are authenticated.
      for (const operation of Object.keys(EXPECTED_ERRORS)) {
        const [method, specPath] = operation.split(" ");
        const op = (swaggerSpec.paths[specPath] || {})[method.toLowerCase()];
        expect(op.security).toBeUndefined();
      }
    });
  });

  describe("GET /api/docs", () => {
    it("renders the Swagger UI", async () => {
      const response = await request(app).get("/api/docs").redirects(1);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.text).toContain('<div id="swagger-ui">');
      expect(response.text).toContain("swagger-ui-bundle.js");
      expect(response.text).toContain("swagger-ui-init.js");
    });

    it("serves a spec containing every documented target path", async () => {
      const response = await request(app).get("/api/docs.json");

      expect(response.status).toBe(200);
      expect(response.body.openapi).toBe("3.0.0");

      const missing = Object.keys(EXPECTED_ERRORS)
        .map((operation) => operation.split(" ")[1])
        .filter((specPath) => !response.body.paths[specPath]);

      expect([...new Set(missing)]).toEqual([]);
    });
  });
});
