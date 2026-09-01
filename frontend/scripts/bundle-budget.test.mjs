import test from "node:test";
import assert from "node:assert/strict";
import { createRouteReport, renderMarkdown } from "./bundle-budget.mjs";

const manifest = {
  pages: {
    "/_app": ["static/app.js", "static/shared.js"],
    "/dashboard": ["static/shared.js", "static/dashboard.js"],
    "/pay": ["static/shared.js", "static/pay.js"],
    "/trade": ["static/shared.js", "static/trade.js"],
    "/settings": ["static/shared.js", "static/settings.js"],
  },
};

const sizes = new Map([
  ["static/app.js", 10 * 1024],
  ["static/shared.js", 20 * 1024],
  ["static/dashboard.js", 30 * 1024],
  ["static/pay.js", 15 * 1024],
  ["static/trade.js", 40 * 1024],
  ["static/settings.js", 25 * 1024],
]);

test("reports each required route and deduplicates shared chunks", () => {
  const routes = createRouteReport(manifest, sizes, {
    "/dashboard": { label: "Dashboard", initial: 100, hydration: 100 },
    "/pay": { label: "Pay", initial: 100, hydration: 100 },
    "/trade": { label: "Trade", initial: 100, hydration: 100 },
    "/settings": { label: "Settings", initial: 100, hydration: 100 },
  });

  assert.deepEqual(routes.map(({ route }) => route), ["/dashboard", "/pay", "/trade", "/settings"]);
  assert.equal(routes[0].initialBytes, 60 * 1024);
  assert.equal(routes[0].hydrationBytes, 30 * 1024);
  assert.deepEqual(routes[0].hydrationFiles, ["static/dashboard.js"]);
});

test("marks a route as failed when either budget is exceeded", () => {
  const [route] = createRouteReport(manifest, sizes, {
    "/dashboard": { label: "Dashboard", initial: 50, hydration: 20 },
  });

  assert.equal(route.initialPass, false);
  assert.equal(route.hydrationPass, false);
  assert.match(renderMarkdown({ network: "testnet", generatedAt: "now", routes: [route] }), /FAIL/);
});