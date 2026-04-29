/**
 * components/Navbar.tsx
 * Top navigation bar with wallet status indicator.
 */

import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { shortenAddress, getNetworkConfig, fetchNetworkFeeStats, type FeeLevel } from "@/lib/stellar";
import clsx from "clsx";
import { useTheme } from "@/pages/_app";

interface NavbarProps {
  publicKey: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trade", label: "Trade" },
  { href: "/transactions", label: "Transactions" },
  { href: "/network", label: "Network" },
  { href: "/settings", label: "Settings" },
];

export default function Navbar({
  publicKey,
  onConnect,
  onDisconnect,
}: NavbarProps) {
  const router = useRouter();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const config = getNetworkConfig();
  const isMainnet = config.network === "mainnet";
  const networkLabel = config.network === "custom" ? "Custom" : (isMainnet ? "Mainnet" : "Testnet");
  const networkBadgeClassName = config.network === "custom"
    ? "border-purple-400/35 bg-purple-400/10 text-purple-300"
    : (isMainnet
      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-300"
      : "border-amber-400/35 bg-amber-400/10 text-amber-300");

  // Issue #19 — Add dark/light mode toggle | Emmy123222/Stellar-MicroPay
  const { theme, toggleTheme } = useTheme();

  const [disconnectTimeout, setDisconnectTimeout] = useState<NodeJS.Timeout | null>(null);

  const handleDisconnectClick = () => {
    setShowDisconnectConfirm(true);
    const timeout = setTimeout(() => {
      setShowDisconnectConfirm(false);
    }, 5000);
    setDisconnectTimeout(timeout);
  };

  const handleConfirmDisconnect = () => {
    if (disconnectTimeout) clearTimeout(disconnectTimeout);
    setShowDisconnectConfirm(false);
    onDisconnect();
  };

  const handleCancelDisconnect = () => {
    if (disconnectTimeout) clearTimeout(disconnectTimeout);
    setShowDisconnectConfirm(false);
  };

  // Issue #168 — Network status indicator
  const [feeLevel, setFeeLevel] = useState<FeeLevel | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const stats = await fetchNetworkFeeStats();
        if (!cancelled) setFeeLevel(stats.feeLevel);
      } catch {
        // silently ignore — dot simply won't show on error
      }
    };
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!showDisconnectConfirm) return;

    const timeoutId = window.setTimeout(() => {
      setShowDisconnectConfirm(false);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [showDisconnectConfirm]);

  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(14,165,233,0.12)] bg-white/80 dark:bg-cosmos-900/80 backdrop-blur-xl transition-colors duration-300">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-stellar-500/20 border border-stellar-500/30 flex items-center justify-center group-hover:border-stellar-500/60 transition-colors">
              <StarIcon className="w-4 h-4 text-stellar-400" />
            </div>
            <span className="font-display font-semibold text-slate-900 dark:text-white tracking-tight">
              Stellar<span className="text-stellar-400">MicroPay</span>
            </span>
          </Link>

          <span
            className={clsx(
              "hidden md:inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
              networkBadgeClassName,
            )}
          >
            {networkLabel}
          </span>

          {/* Network fee status dot */}
          {feeLevel && (
            <span
              title={`Network: ${feeLevel.charAt(0).toUpperCase() + feeLevel.slice(1)}`}
              aria-label={`Network fee status: ${feeLevel}`}
              className={clsx(
                "hidden md:inline-block w-2.5 h-2.5 rounded-full border transition-colors",
                feeLevel === "normal"   && "bg-emerald-400 border-emerald-400/50",
                feeLevel === "elevated" && "bg-amber-400 border-amber-400/50",
                feeLevel === "high"     && "bg-red-400 border-red-400/50",
              )}
            />
          )}

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                  router.pathname === link.href
                    ? "bg-stellar-500/15 text-stellar-300"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5",
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right side: theme toggle + wallet */}
        <div className="flex items-center gap-3">
          {/* Issue #19 — Sun/moon icon toggle button */}
          <button
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300/30 bg-white/90 dark:border-slate-700/50 dark:bg-cosmos-800/80 text-slate-700 dark:text-slate-100 shadow-sm transition-all duration-200 hover:bg-slate-100 dark:hover:bg-cosmos-700/90"
          >
            {theme === "dark" ? (
              // Moon icon — current theme is dark
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"
                />
              </svg>
            ) : (
              // Sun icon — current theme is light
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.71.71M6.34 17.66l-.71.71m12.02 0-.71-.71M6.34 6.34l-.71-.71M12 7a5 5 0 100 10A5 5 0 0012 7z"
                />
              </svg>
            )}
          </button>

          {/* Wallet button */}
          {publicKey ? (
            <div className="flex items-center gap-2">
              {/* Issue #64 — ⌘K hint, shown only when wallet is connected */}
              <kbd
                title="Press Ctrl+K / Cmd+K to quick-send"
                className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stellar-500/20 bg-stellar-500/5 text-stellar-400 text-xs font-mono select-none"
              >
                ⌘K
              </kbd>

              <div className="flex items-center gap-2 address-pill">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{shortenAddress(publicKey)}</span>
              </div>
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                aria-label="Show disconnect confirmation"
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1"
              >
                Disconnect
              </button>
              {showDisconnectConfirm && (
                <div className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1">
                  <span className="text-[11px] text-amber-300">Disconnect wallet?</span>
                  <button
                    onClick={() => {
                      setShowDisconnectConfirm(false);
                      onDisconnect();
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] text-red-300 hover:bg-red-500/20"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowDisconnectConfirm(false)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={onConnect}
              className="btn-primary text-sm py-2 px-4"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L14.09 8.26L21 9L15.5 14.14L17.18 21L12 17.77L6.82 21L8.5 14.14L3 9L9.91 8.26L12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}
