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
import { copyToClipboard } from "@/utils/format";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trade", label: "Trade" },
  { href: "/transactions", label: "Transactions" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/network", label: "Network" },
  { href: "/settings", label: "Settings" },
];

export interface NavbarProps {
  /** Opens the global AI payment assistant (also reachable via Cmd/Ctrl+K). */
  onOpenAssistant?: () => void;
}

export default function Navbar({ onOpenAssistant }: NavbarProps) {
  const router = useRouter();
  const { publicKey, connectWallet, disconnectWallet } = useWallet();
  const { theme, toggleTheme } = useTheme();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feeLevel, setFeeLevel] = useState<FeeLevel | null>(null);

  const handleCopyAddress = async () => {
    if (!publicKey) return;
    const ok = await copyToClipboard(publicKey);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
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
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="group flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stellar-500/30 bg-stellar-500/20 transition-colors group-hover:border-stellar-500/60">
              <StarIcon className="h-4 w-4 text-stellar-400" />
            </div>
            <span className="truncate font-display font-semibold tracking-tight text-slate-900 dark:text-white">
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

        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
          {onOpenAssistant && (
            <button
              onClick={onOpenAssistant}
              title="Open AI payment assistant (Cmd+K / Ctrl+K)"
              aria-label="Open AI payment assistant. Keyboard shortcut: Command K on Mac, Control K on Windows and Linux."
              className="hidden h-9 items-center gap-1.5 rounded-lg border border-stellar-500/20 bg-stellar-500/5 px-3 text-xs font-medium text-stellar-400 transition-colors hover:bg-stellar-500/10 sm:inline-flex"
            >
              <SparkleIcon className="h-3.5 w-3.5" />
              Ask AI
              <kbd className="ml-1 hidden select-none rounded border border-stellar-500/20 bg-stellar-500/10 px-1 py-0.5 font-mono text-[10px] md:inline">
                &#8984;K
              </kbd>
            </button>
          )}

          <button
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300/30 bg-white/90 text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-100 dark:border-slate-700/50 dark:bg-cosmos-800/80 dark:text-slate-100 dark:hover:bg-cosmos-700/90"
          >
            {theme === "dark" ? <MoonIcon /> : <SunIcon />}
          </button>

          {publicKey ? (
            <div className="flex min-w-0 items-center gap-2">
              <kbd
                title="Press Ctrl+K / Cmd+K to quick-send"
                className="hidden select-none items-center gap-1 rounded-md border border-stellar-500/20 bg-stellar-500/5 px-2 py-1 font-mono text-xs text-stellar-400 md:inline-flex"
              >
                Ctrl+K
              </kbd>

              <div className="address-pill relative flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span>{shortenAddress(publicKey)}</span>
                <button
                  onClick={handleCopyAddress}
                  aria-label="Copy wallet address"
                  title="Copy wallet address"
                  className="flex items-center justify-center p-0.5 text-slate-400 hover:text-white transition-colors cursor-pointer rounded"
                >
                  {copied ? (
                    <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <ClipboardIcon className="h-3.5 w-3.5" />
                  )}
                </button>
                {copied && (
                  <span
                    className="absolute -bottom-8 left-1/2 -translate-x-1/2 rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-400/20 shadow-md animate-fade-in z-50 whitespace-nowrap"
                    role="status"
                  >
                    Copied!
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                aria-label="Show disconnect confirmation"
                className="shrink-0 px-2 py-1 text-xs text-slate-500 transition-colors hover:text-slate-300"
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

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2L14.09 8.26L21 9L15.5 14.14L17.18 21L12 17.77L6.82 21L8.5 14.14L3 9L9.91 8.26L12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className || "h-3.5 w-3.5"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
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
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
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
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className || "h-3.5 w-3.5"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M8 5a2 2 0 002 2h4a2 2 0 002-2M8 5a2 2 0 012-2h4a2 2 0 012 2"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className || "h-3.5 w-3.5"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
