/**
 * components/WalletHealthPanel.tsx
 * Wallet health check panel showing reserves, trustlines, signers, and home domain.
 *
 * Issue #1192 - feat: add a 'Wallet health check' tool showing reserves, trustlines, and signers
 * Emmy123222/Stellar-MicroPay
 */

import { useState, useEffect, useCallback } from "react";
import { server } from "@/lib/stellar";

interface WalletHealthData {
  totalBalance: number;
  spendableBalance: number;
  baseReserve: number;
  subentryCount: number;
  trustlines: TrustlineInfo[];
  signers: SignerInfo[];
  homeDomain: string | null;
  isHealthy: boolean;
  warnings: string[];
}

interface TrustlineInfo {
  assetCode: string;
  assetIssuer: string;
  balance: string;
  reserveCost: number;
}

interface SignerInfo {
  key: string;
  weight: number;
  type: string;
}

interface WalletHealthPanelProps {
  publicKey: string;
}

const BASE_RESERVE = 0.5; // XLM per reserve unit
const BASE_ACCOUNT_RESERVE = 1; // base account = 2 subentries worth (min balance = 1 XLM)

const TOOLTIP_DESCRIPTIONS: Record<string, string> = {
  totalBalance: "The total XLM balance in your account, including all locked reserves.",
  spendableBalance:
    "The amount you can actually send. Stellar requires a minimum reserve of 0.5 XLM per subentry (trustlines, signers, offers, etc.) plus a 1 XLM base reserve.",
  trustlines:
    "Trustlines allow your account to hold non-XLM assets. Each trustline costs 0.5 XLM as a reserve that cannot be spent.",
  signers:
    "Additional signers that can authorize transactions on your account. Used for multi-signature security. Each non-master signer costs 0.5 XLM reserve.",
  homeDomain:
    "A domain set on your account that links it to a SEP-0001 stellar.toml file. Used by wallets and exchanges to verify your identity.",
};

export default function WalletHealthPanel({ publicKey }: WalletHealthPanelProps) {
  const [healthData, setHealthData] = useState<WalletHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const loadHealthData = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const account = await server.loadAccount(publicKey);

      const xlmBalance = account.balances.find((b: any) => b.asset_type === "native");
      const totalBalance = xlmBalance ? parseFloat(xlmBalance.balance) : 0;

      // Trustlines (non-native balances)
      const trustlines: TrustlineInfo[] = account.balances
        .filter((b: any) => b.asset_type !== "native")
        .map((b: any) => ({
          assetCode: b.asset_code || "UNKNOWN",
          assetIssuer: b.asset_issuer || "",
          balance: b.balance || "0",
          reserveCost: BASE_RESERVE,
        }));

      // Signers (excluding the master key)
      const signers: SignerInfo[] = account.signers.map((s: any) => ({
        key: s.key,
        weight: s.weight,
        type: s.type,
      }));

      // Subentry reserve calculation:
      // base account = 1 XLM min balance (2 base reserves)
      // each subentry (trustline, data entry, offer, signer) = 0.5 XLM
      const subentryCount = account.subentry_count || 0;
      const totalReserve = BASE_ACCOUNT_RESERVE + subentryCount * BASE_RESERVE;
      const spendableBalance = Math.max(0, totalBalance - totalReserve);

      const homeDomain = account.home_domain || null;

      // Health checks & warnings
      const warnings: string[] = [];

      if (spendableBalance < 1) {
        warnings.push("Low spendable balance — your account is close to the minimum reserve.");
      }
      if (trustlines.length > 10) {
        warnings.push(
          `High number of trustlines (${trustlines.length}) — each locks 0.5 XLM in reserve.`
        );
      }
      if (signers.length > 5) {
        warnings.push(
          `High number of signers (${signers.length}) — review if all are still needed.`
        );
      }
      const masterSigner = signers.find((s) => s.key === publicKey);
      if (masterSigner && masterSigner.weight === 0) {
        warnings.push(
          "Master key weight is 0 — your account may require all signers for transactions."
        );
      }

      setHealthData({
        totalBalance,
        spendableBalance,
        baseReserve: totalReserve,
        subentryCount,
        trustlines,
        signers,
        homeDomain,
        isHealthy: warnings.length === 0,
        warnings,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to load wallet health data.");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    loadHealthData();
  }, [loadHealthData]);

  const toggleTooltip = (key: string) => {
    setActiveTooltip((prev) => (prev === key ? null : key));
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-cosmos-700 animate-pulse" />
          <div className="h-5 w-36 rounded bg-slate-200 dark:bg-cosmos-700 animate-pulse" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-cosmos-700">
              <div className="h-4 w-32 rounded bg-slate-200 dark:bg-cosmos-600 animate-pulse" />
              <div className="h-4 w-20 rounded bg-slate-200 dark:bg-cosmos-600 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-2">
          <HeartIcon className="w-5 h-5 text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Wallet Health</h2>
        </div>
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
          <p className="text-sm text-red-400">{error}</p>
        </div>
        <button
          onClick={loadHealthData}
          className="mt-3 text-sm text-stellar-400 hover:text-stellar-300 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!healthData) return null;

  return (
    <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <HeartIcon className="w-5 h-5 text-stellar-400" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Wallet Health</h2>
        </div>
        <div
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full ${
            healthData.isHealthy
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${healthData.isHealthy ? "bg-emerald-400" : "bg-amber-400"}`}
          />
          {healthData.isHealthy ? "Your account is healthy" : `${healthData.warnings.length} warning${healthData.warnings.length > 1 ? "s" : ""}`}
        </div>
      </div>

      {/* Warning banners */}
      {healthData.warnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {healthData.warnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg"
            >
              <WarningIcon className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-300">{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Health rows */}
      <div className="space-y-2">
        {/* Total Balance */}
        <HealthRow
          label="Total Balance"
          value={`${healthData.totalBalance.toFixed(7)} XLM`}
          tooltipKey="totalBalance"
          activeTooltip={activeTooltip}
          onToggleTooltip={toggleTooltip}
        />

        {/* Spendable Balance */}
        <HealthRow
          label="Spendable Balance"
          value={`${healthData.spendableBalance.toFixed(7)} XLM`}
          subValue={`${healthData.baseReserve.toFixed(1)} XLM locked in reserves`}
          tooltipKey="spendableBalance"
          activeTooltip={activeTooltip}
          onToggleTooltip={toggleTooltip}
          highlight={healthData.spendableBalance < 1 ? "warning" : "success"}
        />

        {/* Trustlines */}
        <HealthRow
          label="Trustlines"
          value={`${healthData.trustlines.length} trustline${healthData.trustlines.length !== 1 ? "s" : ""}`}
          subValue={
            healthData.trustlines.length > 0
              ? `${(healthData.trustlines.length * BASE_RESERVE).toFixed(1)} XLM reserved`
              : "No extra reserves"
          }
          tooltipKey="trustlines"
          activeTooltip={activeTooltip}
          onToggleTooltip={toggleTooltip}
        />

        {/* Trustline details */}
        {healthData.trustlines.length > 0 && (
          <div className="ml-4 space-y-1">
            {healthData.trustlines.map((tl) => (
              <div
                key={`${tl.assetCode}-${tl.assetIssuer}`}
                className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-cosmos-700/50 text-xs"
              >
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {tl.assetCode}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{tl.balance}</span>
                  <span className="text-amber-400">-{tl.reserveCost} XLM reserve</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Signers */}
        <HealthRow
          label="Multi-sig Signers"
          value={`${healthData.signers.length} signer${healthData.signers.length !== 1 ? "s" : ""}`}
          tooltipKey="signers"
          activeTooltip={activeTooltip}
          onToggleTooltip={toggleTooltip}
        />

        {/* Signer details */}
        {healthData.signers.length > 0 && (
          <div className="ml-4 space-y-1">
            {healthData.signers.map((signer) => (
              <div
                key={signer.key}
                className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-cosmos-700/50 text-xs"
              >
                <span className="font-mono text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                  {signer.key === publicKey ? (
                    <span className="text-stellar-400">Master key (this wallet)</span>
                  ) : (
                    `${signer.key.slice(0, 8)}…${signer.key.slice(-6)}`
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Weight: {signer.weight}</span>
                  <span className="text-slate-600 capitalize">{signer.type}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Home Domain */}
        <HealthRow
          label="Home Domain"
          value={healthData.homeDomain || "Not set"}
          tooltipKey="homeDomain"
          activeTooltip={activeTooltip}
          onToggleTooltip={toggleTooltip}
          highlight={healthData.homeDomain ? "success" : "neutral"}
        />
      </div>

      <button
        onClick={loadHealthData}
        className="mt-4 text-xs text-slate-400 dark:text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1"
      >
        <RefreshIcon className="w-3.5 h-3.5" />
        Refresh
      </button>
    </div>
  );
}

// ─── HealthRow Component ─────────────────────────────────────────────────────

interface HealthRowProps {
  label: string;
  value: string;
  subValue?: string;
  tooltipKey: string;
  activeTooltip: string | null;
  onToggleTooltip: (key: string) => void;
  highlight?: "success" | "warning" | "neutral";
}

function HealthRow({
  label,
  value,
  subValue,
  tooltipKey,
  activeTooltip,
  onToggleTooltip,
  highlight,
}: HealthRowProps) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-cosmos-700/50 hover:bg-slate-100 dark:hover:bg-cosmos-700 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
          <button
            type="button"
            onClick={() => onToggleTooltip(tooltipKey)}
            className="text-slate-400 hover:text-stellar-400 transition-colors"
            aria-label={`Info about ${label}`}
          >
            <InfoIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="text-right">
          <span
            className={`text-sm font-medium ${
              highlight === "success"
                ? "text-emerald-400"
                : highlight === "warning"
                ? "text-amber-400"
                : "text-slate-900 dark:text-white"
            }`}
          >
            {value}
          </span>
          {subValue && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subValue}</p>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {activeTooltip === tooltipKey && (
        <div className="absolute left-0 right-0 z-10 mt-1 p-3 bg-slate-900 border border-white/10 rounded-lg shadow-xl text-xs text-slate-300 leading-relaxed">
          {TOOLTIP_DESCRIPTIONS[tooltipKey]}
        </div>
      )}
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
      />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
      />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
      />
    </svg>
  );
}
