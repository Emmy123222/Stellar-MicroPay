/**
 * pages/_app.tsx
 * Global app wrapper for theme, wallet, navigation, and shared overlays.
 */

import type { AppProps } from "next/app";
import { useState, useEffect, createContext, useContext } from "react";
import Head from "next/head";
import Navbar from "@/components/Navbar";
import QuickSendModal from "@/components/QuickSendModal";
import { WalletProvider, useWallet } from "@/lib/useWallet";
import {
  getStellarURIFromURL,
  registerProtocolHandler,
  type URIParseResult,
} from "@/lib/sep0007";
import "@/styles/globals.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-slide-up sm:left-auto sm:right-4 sm:w-96">
      <div className="rounded-xl border border-stellar-500/30 bg-cosmos-800 p-4 shadow-2xl backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="mb-1 text-sm font-display font-semibold text-white">
              Install MicroPay
            </h3>
            <p className="text-xs text-slate-400">
              Add to your home screen for quick access and offline support
            </p>
          </div>
          <button
            onClick={() => setShowBanner(false)}
            className="cursor-pointer p-1 text-slate-500 transition-colors hover:text-slate-300"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={handleInstall} className="btn-primary flex-1 px-4 py-2 text-xs">
            Install App
          </button>
          <button
            onClick={() => setShowBanner(false)}
            className="btn-secondary flex-1 px-4 py-2 text-xs"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}

interface ThemeContextType {
  theme: "dark" | "light";
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function AppShell({
  Component,
  pageProps,
  stellarURI,
  isQuickSendOpen,
  setIsQuickSendOpen,
}: {
  Component: AppProps["Component"];
  pageProps: AppProps["pageProps"];
  stellarURI: URIParseResult | null;
  isQuickSendOpen: boolean;
  setIsQuickSendOpen: (isOpen: boolean) => void;
}) {
  const { publicKey } = useWallet();

  return (
    <>
      <div className="min-h-screen bg-white bg-grid transition-colors duration-300 dark:bg-cosmos-900">
        <Navbar />
        <main>
          <Component {...pageProps} stellarURI={stellarURI} />
        </main>
        <InstallBanner />
      </div>

      {publicKey && (
        <QuickSendModal
          isOpen={isQuickSendOpen}
          onClose={() => setIsQuickSendOpen(false)}
          publicKey={publicKey}
          xlmBalance="0"
          usdcBalance={null}
        />
      )}
    </>
  );
}

export default function App({ Component, pageProps }: AppProps) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [stellarURI, setStellarURI] = useState<URIParseResult | null>(null);
  const [isQuickSendOpen, setIsQuickSendOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("stellar-micropay:theme") as
      | "dark"
      | "light"
      | null;
    const preferred =
      saved ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    setTheme(preferred);
    document.documentElement.classList.toggle("dark", preferred === "dark");
  }, []);

  useEffect(() => {
    const uriResult = getStellarURIFromURL();
    if (uriResult) {
      setStellarURI(uriResult);
    }
  }, []);

  useEffect(() => {
    registerProtocolHandler();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const registerWorker = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("[PWA] Service worker registration failed:", error);
      });
    };

    if (document.readyState === "complete") {
      registerWorker();
      return;
    }

    window.addEventListener("load", registerWorker, { once: true });
    return () => window.removeEventListener("load", registerWorker);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    localStorage.setItem("stellar-micropay:theme", nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <WalletProvider>
        <Head>
          <title>Stellar-MicroPay | Instant Micropayments</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta
            name="description"
            content="Send instant, low-fee micropayments globally using the Stellar network. Secure, fast, and transparent."
          />
          <link rel="canonical" href="https://stellar-micropay.vercel.app/" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="https://stellar-micropay.vercel.app/" />
          <meta
            property="og:title"
            content="Stellar-MicroPay | Instant Micropayments"
          />
          <meta
            property="og:description"
            content="Send instant, low-fee micropayments globally using the Stellar network. Secure, fast, and transparent."
          />
          <meta
            property="og:image"
            content="https://stellar-micropay.vercel.app/og-card.png"
          />
          <meta name="twitter:card" content="summary_large_image" />
          <meta
            name="twitter:title"
            content="Stellar-MicroPay | Instant Micropayments"
          />
          <meta
            name="twitter:description"
            content="Send instant, low-fee micropayments globally using the Stellar network. Secure, fast, and transparent."
          />
          <meta
            name="twitter:image"
            content="https://stellar-micropay.vercel.app/og-card.png"
          />
        </Head>

        <AppShell
          Component={Component}
          pageProps={pageProps}
          stellarURI={stellarURI}
          isQuickSendOpen={isQuickSendOpen}
          setIsQuickSendOpen={setIsQuickSendOpen}
        />
      </WalletProvider>
    </ThemeContext.Provider>
  );
}
