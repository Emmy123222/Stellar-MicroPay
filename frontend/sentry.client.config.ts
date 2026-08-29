/**
 * sentry.client.config.ts
 * Sentry browser-side initialisation — resolves #293.
 * Loaded automatically by @sentry/nextjs before the app boots.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE || process.env.GITHUB_SHA || "dev",
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  integrations: [Sentry.browserTracingIntegration()],
});
