/**
 * components/Navbar.tsx
 * Top navigation bar with theme toggle, network status, and wallet controls.
 */

import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  shortenAddress,
  getNetworkConfig,
  fetchNetworkFeeStats,
  type FeeLevel,
} from "@/lib/stellar";
import {
  connectWallet as requestWalletConnection,
  performSEP0010Auth,
} from "@/lib/wallet";
import { useWallet } from "@/lib/useWallet";
import { useTheme } from "@/pages/_app";
import { NavStarIcon, MoonIcon, SunIcon } from "@/components/icons";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trade", label: "Trade" },
  { href: "/transactions", label: "Transactions" },
  { href: "/network", label: "Network" },
  { href: "/settings", label: "Settings" },
];

export default function Navbar() {
  const router = useRouter();
  const { publicKey, connectWallet, disconnectWallet } = useWallet();
  const { theme, toggleTheme } = useTheme();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [feeLevel, setFeeLevel] = useState<FeeLevel | null>(null);
  const config = getNetworkConfig();
  const isMainnet = config.network === "mainnet";
  const networkLabel =
    config.network === "custom" ? "Custom" : isMainnet ? "Mainnet" : "Testnet";
  const networkBadgeClassName =
    config.network === "custom"
      ? "border-purple-400/35 bg-purple-400/10 text-purple-300"
      : isMainnet
        ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-300"
        : "border-amber-400/35 bg-amber-400/10 text-amber-300";

  useEffect(() => {
    let cancelled = false;

    const loadFeeLevel = async () => {
      try {
        const stats = await fetchNetworkFeeStats();
        if (!cancelled) {
          setFeeLevel(stats.feeLevel);
        }
      } catch {
        // If fee stats fail, the status dot simply stays hidden.
      }
    };

    void loadFeeLevel();
    const intervalId = window.setInterval(() => void loadFeeLevel(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!showDisconnectConfirm) return;

    const timeoutId = window.setTimeout(() => {
      setShowDisconnectConfirm(false);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [showDisconnectConfirm]);

  const handleConnectClick = async () => {
    const { publicKey: nextPublicKey, error: walletError } =
      await requestWalletConnection();

    if (!nextPublicKey) {
      if (walletError) {
        console.error(walletError);
      }
      return;
    }

    const { error: authError } = await performSEP0010Auth(nextPublicKey);
    if (authError) {
      console.error(authError);
      return;
    }

    connectWallet(nextPublicKey);
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(14,165,233,0.12)] bg-white/80 backdrop-blur-xl transition-colors duration-300 dark:bg-cosmos-900/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="group flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-stellar-500/30 bg-stellar-500/20 transition-colors group-hover:border-stellar-500/60">
              <NavStarIcon className="h-4 w-4 text-stellar-400" />
            </div>
            <span className="font-display font-semibold tracking-tight text-slate-900 dark:text-white">
              Stellar<span className="text-stellar-400">MicroPay</span>
            </span>
          </Link>

          <span
            className={clsx(
              "hidden items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide md:inline-flex",
              networkBadgeClassName
            )}
          >
            {networkLabel}
          </span>

          {feeLevel && (
            <span
              title={`Network: ${feeLevel.charAt(0).toUpperCase()}${feeLevel.slice(1)}`}
              aria-label={`Network fee status: ${feeLevel}`}
              className={clsx(
                "hidden h-2.5 w-2.5 rounded-full border transition-colors md:inline-block",
                feeLevel === "normal" && "border-emerald-400/50 bg-emerald-400",
                feeLevel === "elevated" && "border-amber-400/50 bg-amber-400",
                feeLevel === "high" && "border-red-400/50 bg-red-400"
              )}
            />
          )}

          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150",
                  router.pathname === link.href
                    ? "bg-stellar-500/15 text-stellar-300"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300/30 bg-white/90 text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-100 dark:border-slate-700/50 dark:bg-cosmos-800/80 dark:text-slate-100 dark:hover:bg-cosmos-700/90"
          >
            {theme === "dark" ? <MoonIcon /> : <SunIcon />}
          </button>

          {publicKey ? (
            <div className="flex items-center gap-2">
              <kbd
                title="Press Ctrl+K / Cmd+K to quick-send"
                className="hidden select-none items-center gap-1 rounded-md border border-stellar-500/20 bg-stellar-500/5 px-2 py-1 font-mono text-xs text-stellar-400 md:inline-flex"
              >
                Ctrl+K
              </kbd>

              <div className="address-pill flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span>{shortenAddress(publicKey)}</span>
              </div>
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                aria-label="Show disconnect confirmation"
                className="px-2 py-1 text-xs text-slate-500 transition-colors hover:text-slate-300"
              >
                Disconnect
              </button>
              {showDisconnectConfirm && (
                <div className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1">
                  <span className="text-[11px] text-amber-300">Disconnect wallet?</span>
                  <button
                    onClick={() => {
                      setShowDisconnectConfirm(false);
                      disconnectWallet();
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
            <button onClick={handleConnectClick} className="btn-primary px-4 py-2 text-sm">
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

