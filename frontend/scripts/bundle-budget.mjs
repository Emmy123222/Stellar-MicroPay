import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ROUTE_BUDGETS = {
  "/dashboard": { label: "Dashboard", initial: 450, hydration: 250 },
  "/pay": { label: "Pay", initial: 350, hydration: 180 },
  "/trade": { label: "Trade", initial: 450, hydration: 250 },
  "/settings": { label: "Settings", initial: 450, hydration: 250 },
};

const DEFAULT_BUILD_DIR = ".next";
const REPORT_DIR = "bundle-reports";

function bytesForFiles(files, sizes) {
  return [...new Set(files)].reduce((total, file) => {
    const size = sizes.get(file);
    if (size === undefined) {
      throw new Error(`Build manifest references missing file: ${file}`);
    }
    return total + size;
  }, 0);
}

export function createRouteReport(manifest, sizes, routeBudgets = ROUTE_BUDGETS) {
  const sharedFiles = manifest.pages?.["/_app"] ?? [];

  return Object.entries(routeBudgets).map(([route, budget]) => {
    const routeFiles = manifest.pages?.[route];
    if (!routeFiles) {
      throw new Error(`Build manifest is missing required route: ${route}`);
    }

    const initialFiles = [...new Set([...sharedFiles, ...routeFiles])];
    const sharedBytes = bytesForFiles(sharedFiles, sizes);
    const initialBytes = bytesForFiles(initialFiles, sizes);
    const hydrationFiles = routeFiles.filter((file) => !sharedFiles.includes(file));
    const hydrationBytes = bytesForFiles(hydrationFiles, sizes);

    return {
      route,
      label: budget.label,
      sharedBytes,
      initialBytes,
      hydrationBytes,
      initialBudgetBytes: budget.initial * 1024,
      hydrationBudgetBytes: budget.hydration * 1024,
      initialPass: initialBytes <= budget.initial * 1024,
      hydrationPass: hydrationBytes <= budget.hydration * 1024,
      files: initialFiles,
      hydrationFiles,
    };
  });
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function renderMarkdown(report) {
  const lines = [
    "# Frontend Bundle Report",
    "",
    `Network: \`${report.network}\``,
    `Generated: \`${report.generatedAt}\``,
    "",
    "| Route | Initial JS | Initial budget | Hydration JS | Hydration budget | Status |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const route of report.routes) {
    const status = route.initialPass && route.hydrationPass ? "PASS" : "FAIL";
    lines.push(
      `| ${route.label} (${route.route}) | ${formatKb(route.initialBytes)} | ${formatKb(route.initialBudgetBytes)} | ${formatKb(route.hydrationBytes)} | ${formatKb(route.hydrationBudgetBytes)} | ${status} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function collectSizes(buildDir, files) {
  const sizes = new Map();
  await Promise.all(
    [...new Set(files)].map(async (file) => {
      const stats = await fs.stat(path.join(buildDir, file));
      sizes.set(file, stats.size);
    }),
  );
  return sizes;
}

async function main() {
  const buildDir = process.env.NEXT_BUILD_DIR || DEFAULT_BUILD_DIR;
  const manifestPath = path.join(buildDir, "build-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const routeFiles = Object.values(ROUTE_BUDGETS).flatMap((_, index) => {
    const route = Object.keys(ROUTE_BUDGETS)[index];
    return [...(manifest.pages?.["/_app"] ?? []), ...(manifest.pages?.[route] ?? [])];
  });
  const sizes = await collectSizes(buildDir, routeFiles);
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
  if (!["testnet", "mainnet"].includes(network)) {
    throw new Error(`Unsupported Stellar network for bundle report: ${network}`);
  }

  const report = {
    network,
    generatedAt: new Date().toISOString(),
    routes: createRouteReport(manifest, sizes),
  };
  const outputDir = path.join(process.cwd(), REPORT_DIR);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "routes.json"), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, "routes.md"), renderMarkdown(report));

  console.log(renderMarkdown(report));
  if (report.routes.some((route) => !route.initialPass || !route.hydrationPass)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}