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
import "@/styles/globals.css";

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

  // Issue #64 — Quick-send modal state
  const [isQuickSendOpen, setIsQuickSendOpen] = useState(false);

  // Restore theme preference on load
  useEffect(() => {
    const saved = localStorage.getItem("stellar-micropay:theme") as "dark" | "light" | null;
    const preferred = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(preferred);
    document.documentElement.classList.toggle("dark", preferred === "dark");
  }, []);

  // Restore wallet connection on load
  useEffect(() => {
    getConnectedPublicKey().then((pk) => {
      if (pk) setPublicKey(pk);
    });
  }, []);

  // Issue #64 — Listen for Ctrl+K / Cmd+K globally to open quick-send modal.
  // Does NOT trigger when the user is typing inside an input, textarea, or
  // contentEditable element (acceptance criteria: "Does not trigger when
  // typing in an input field").
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const isShortcut = isMac ? e.metaKey && e.key === "k" : e.ctrlKey && e.key === "k";

      if (!isShortcut) return;

      const tag = (e.target as HTMLElement).tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement).isContentEditable;

      if (isEditable) return;

      // Only open if wallet is connected
      if (!publicKey) return;

      e.preventDefault();
      setIsQuickSendOpen((prev) => !prev);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [publicKey]);

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
          />
        </main>
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
