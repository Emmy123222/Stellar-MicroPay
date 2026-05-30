/**
 * sentry.client.config.ts
 * Sentry browser-side initialisation — resolves #293.
 * Loaded automatically by @sentry/nextjs before the app boots.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Only enable when a DSN is provided
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  // Capture unhandled promise rejections and React error boundaries
  integrations: [Sentry.browserTracingIntegration()],
});
