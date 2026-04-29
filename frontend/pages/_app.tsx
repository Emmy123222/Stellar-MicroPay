/**
 * pages/_app.tsx
 * Global app wrapper — manages wallet state and theme across all pages.
 */

import type { AppProps } from "next/app";
import { useState, useEffect, createContext, useContext } from "react";
import Head from "next/head";
import Navbar from "@/components/Navbar";
import QuickSendModal from "@/components/QuickSendModal";
import { getConnectedPublicKey } from "@/lib/wallet";
import { getStellarURIFromURL, registerProtocolHandler, URIParseResult } from "@/lib/sep0007";
import "@/styles/globals.css";

// PWA Install Banner Component
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('[PWA] User accepted the install prompt');
    }
    
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-50 animate-slide-up">
      <div className="bg-cosmos-800 border border-stellar-500/30 rounded-xl shadow-2xl p-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="font-display font-semibold text-white text-sm mb-1">
              Install MicroPay
            </h3>
            <p className="text-slate-400 text-xs">
              Add to your home screen for quick access and offline support
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer p-1"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleInstall}
            className="btn-primary text-xs px-4 py-2 flex-1"
          >
            Install App
          </button>
          <button
            onClick={handleDismiss}
            className="btn-secondary text-xs px-4 py-2 flex-1"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Theme Context ────────────────────────────────────────────────────────────
// Issue #19 — Add dark/light mode toggle | Emmy123222/Stellar-MicroPay
// Adds ThemeContext to manage dark/light mode state, persist theme
// preference in localStorage, and toggle the 'dark' class on <html>.
interface ThemeContextType {
  theme: "dark" | "light";
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [stellarURI, setStellarURI] = useState<URIParseResult | null>(null);

  // Issue #64 — Quick-send modal state
  const [isQuickSendOpen, setIsQuickSendOpen] = useState(false);

  // Restore theme preference on load
  useEffect(() => {
    const saved = localStorage.getItem("stellar-micropay:theme") as "dark" | "light" | null;
    const preferred = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(preferred);
    document.documentElement.classList.toggle("dark", preferred === "dark");
  }, []);

  // Parse Stellar URI on page load
  useEffect(() => {
    const uriResult = getStellarURIFromURL();
    if (uriResult) {
      setStellarURI(uriResult);
    }
  }, []);

  // Restore wallet connection on load
  useEffect(() => {
    getConnectedPublicKey().then((pk) => {
      if (pk) setPublicKey(pk);
    });
  }, []);

  // Register protocol handler
  useEffect(() => {
    registerProtocolHandler();
  }, []);

  // Issue #19 — toggleTheme: switches theme, updates <html> class and localStorage
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("stellar-micropay:theme", next);
  };

  const handleConnect = (pk: string) => setPublicKey(pk);
  const handleDisconnect = () => setPublicKey(null);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <Head>
        {/* Title and SEO */}
        <title>Stellar-MicroPay | Instant Micropayments</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Send instant, low-fee micropayments globally using the Stellar network. Secure, fast, and transparent." />
        
        {/* Canonical URL */}
        <link rel="canonical" href="https://stellar-micropay.vercel.app/" />

        {/* Favicon */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

        {/* Open Graph / Facebook / Discord */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://stellar-micropay.vercel.app/" />
        <meta property="og:title" content="Stellar-MicroPay | Instant Micropayments" />
        <meta property="og:description" content="Send instant, low-fee micropayments globally using the Stellar network. Secure, fast, and transparent." />
        <meta property="og:image" content="https://stellar-micropay.vercel.app/og-card.png" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Stellar-MicroPay | Instant Micropayments" />
        <meta name="twitter:description" content="Send instant, low-fee micropayments globally using the Stellar network. Secure, fast, and transparent." />
        <meta name="twitter:image" content="https://stellar-micropay.vercel.app/og-card.png" />
      </Head>

      <div className="min-h-screen bg-white dark:bg-cosmos-900 bg-grid transition-colors duration-300">
        <Navbar
          publicKey={publicKey}
          onConnect={() => {}}
          onDisconnect={handleDisconnect}
        />
        <main>
          <Component
            {...pageProps}
            publicKey={publicKey}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            stellarURI={stellarURI}
          />
        </main>
        <InstallBanner />
      </div>

      {/* Issue #64 — Quick-send modal, rendered at root so it overlays any page */}
      {publicKey && (
        <QuickSendModal
          isOpen={isQuickSendOpen}
          onClose={() => setIsQuickSendOpen(false)}
          publicKey={publicKey}
          xlmBalance="0"      // replace with real balance if available at app level
          usdcBalance={null}
        />
      )}
    </ThemeContext.Provider>
  );
}
