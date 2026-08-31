import { withSentryConfig } from "@sentry/nextjs";
import { validateEnv } from "./scripts/validateEnv.mjs";

if (process.env.npm_lifecycle_event !== "lint") {
  validateEnv();
}

const isProduction = process.env.NODE_ENV === "production";

function buildContentSecurityPolicy() {
  const scriptSrc = ["'self'"];
  if (!isProduction) {
    // Next.js dev tooling relies on eval-based sourcemaps/HMR.
    scriptSrc.push("'unsafe-eval'");
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' http: https: ws: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ];

  return directives.join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the production Docker image (copies only what's needed)
  output: "export",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy(),
          },
        ],
      },
    ];
  },
  // Allow Stellar SDK in browser
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: process.env.SENTRY_RELEASE || process.env.GITHUB_SHA || "dev",
  silent: true,
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
