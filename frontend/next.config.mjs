/** @type {import('next').NextConfig} */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Strict Content-Security-Policy for the Next.js frontend.
 * - script-src is 'self' only (no 'unsafe-inline')
 * - connect-src allows Horizon + backend API origins
 *
 * Note: with `output: "export"`, Next.js does not emit these headers at
 * runtime for static files. Production nginx (nginx/nginx.conf) mirrors
 * this policy so browsers still receive the CSP.
 */
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  [
    "connect-src 'self'",
    API_URL,
    "https://horizon.stellar.org",
    "https://horizon-testnet.stellar.org",
    "https://friendbot.stellar.org",
    "https://soroban.stellar.org",
    "https://soroban-testnet.stellar.org",
    "https://api.coingecko.com",
  ].join(" "),
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: ContentSecurityPolicy,
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Required for the production Docker image (copies only what's needed)
  output: "export",
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
