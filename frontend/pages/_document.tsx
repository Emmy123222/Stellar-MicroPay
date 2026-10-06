/**
 * pages/_document.tsx
 * Custom document for adding manifest link and PWA meta tags
 *
 * SRI audit: no external <script> or <link rel="stylesheet"> tags are present.
 * All resources reference same-origin paths (/manifest.json, /icon-192.png),
 * which are served by this application and do not require Subresource Integrity
 * attributes. If a CDN-hosted font, stylesheet, or script is ever added here,
 * it must include integrity="sha256-..." and crossOrigin="anonymous".
 */

import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Theme color for browser UI */}
        <meta name="theme-color" content="#7B3FE4" />

        {/* Apple Touch Icon */}
        <link rel="apple-touch-icon" href="/icon-192.png" />

        {/* Apple mobile web app capable */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MicroPay" />

        {/* MS Tile Color */}
        <meta name="msapplication-TileColor" content="#7B3FE4" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
