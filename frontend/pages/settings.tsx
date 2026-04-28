/**
 * pages/settings.tsx
<<<<<<< HEAD
 * Settings page with Stellar Name Service registration and account preferences.
 */

import { useWallet } from "@/pages/_app";
import { shortenAddress } from "@/lib/stellar";
import { useState } from "react";
import clsx from "clsx";

// Icons (assuming these exist in the project)
const SettingsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ExternalLinkIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const UserIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const InfoIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export default function Settings() {
  const { publicKey, isConnected } = useWallet();
  const [activeTab, setActiveTab] = useState<"names" | "preferences">("names");

  if (!isConnected || !publicKey) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cosmos-900 via-cosmos-800 to-slate-900 p-4">
        <div className="max-w-2xl mx-auto pt-20">
          <div className="card text-center">
            <h1 className="font-display text-2xl font-bold text-white mb-4">Settings</h1>
            <p className="text-slate-400 mb-6">Connect your wallet to access settings</p>
          </div>
        </div>
=======
 * Configure and deploy Turrets txFunctions (DCA and stop-loss).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import WalletConnect from "@/components/WalletConnect";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/useToast";
import { signTransactionWithWallet } from "@/lib/wallet";
import {
  createTurretsChallenge,
  deployTurretsFunction,
  getTurretsHistory,
  listTurretsFunctions,
  pauseTurretsFunction,
  resumeTurretsFunction,
  TurretsDeployment,
  TurretsExecutionHistory,
} from "@/lib/turrets";

interface SettingsProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleString();
}

export default function Settings({ publicKey, onConnect }: SettingsProps) {
  const [deployments, setDeployments] = useState<TurretsDeployment[]>([]);
  const [loadingDeployments, setLoadingDeployments] = useState(false);
  const [historyById, setHistoryById] = useState<Record<string, TurretsExecutionHistory[]>>({});
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);

  const [dcaAmountQuote, setDcaAmountQuote] = useState("10");
  const [dcaIntervalMinutes, setDcaIntervalMinutes] = useState("60");
  const [dcaQuoteAssetCode, setDcaQuoteAssetCode] = useState("USDC");
  const [dcaQuoteAssetIssuer, setDcaQuoteAssetIssuer] = useState("");
  const [dcaSubmitting, setDcaSubmitting] = useState(false);

  const [stopLossThreshold, setStopLossThreshold] = useState("0.09");
  const [stopLossAmountSell, setStopLossAmountSell] = useState("25");
  const [stopLossAssetCode, setStopLossAssetCode] = useState("USDC");
  const [stopLossAssetIssuer, setStopLossAssetIssuer] = useState("");
  const [stopLossCooldownMinutes, setStopLossCooldownMinutes] = useState("30");
  const [stopLossSubmitting, setStopLossSubmitting] = useState(false);

  const { visible: toastVisible, message: toastMessage, showToast } = useToast();

  const isConnected = Boolean(publicKey);

  const refreshDeployments = useCallback(async () => {
    if (!publicKey) return;
    setLoadingDeployments(true);
    try {
      const data = await listTurretsFunctions(publicKey);
      setDeployments(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load txFunctions";
      showToast(message);
    } finally {
      setLoadingDeployments(false);
    }
  }, [publicKey, showToast]);

  useEffect(() => {
    refreshDeployments();
  }, [refreshDeployments]);

  useEffect(() => {
    if (!publicKey) return;
    const id = setInterval(() => {
      refreshDeployments();
    }, 20_000);

    return () => clearInterval(id);
  }, [publicKey, refreshDeployments]);

  const deploymentCountLabel = useMemo(() => {
    if (loadingDeployments) return "Loading txFunctions...";
    return `${deployments.length} deployed txFunction${deployments.length === 1 ? "" : "s"}`;
  }, [deployments.length, loadingDeployments]);

  const deployDca = async () => {
    if (!publicKey) return;
    setDcaSubmitting(true);
    try {
      const config = {
        amountQuote: Number(dcaAmountQuote),
        intervalMinutes: Number(dcaIntervalMinutes),
        quoteAssetCode: dcaQuoteAssetCode.toUpperCase(),
        quoteAssetIssuer: dcaQuoteAssetIssuer || null,
      };

      const challenge = await createTurretsChallenge({
        ownerPublicKey: publicKey,
        type: "dca",
        config,
      });

      const { signedXDR, error } = await signTransactionWithWallet(challenge.challengeXDR);
      if (error || !signedXDR) {
        throw new Error(error || "Freighter could not sign the DCA challenge");
      }

      await deployTurretsFunction({
        ownerPublicKey: publicKey,
        type: "dca",
        config,
        deploymentHash: challenge.deploymentHash,
        signedChallengeXDR: signedXDR,
      });

      showToast("DCA txFunction deployed");
      refreshDeployments();
    } catch (err) {
      const message = err instanceof Error ? err.message : "DCA deployment failed";
      showToast(message);
    } finally {
      setDcaSubmitting(false);
    }
  };

  const deployStopLoss = async () => {
    if (!publicKey) return;
    setStopLossSubmitting(true);
    try {
      const config = {
        thresholdPrice: Number(stopLossThreshold),
        amountSell: Number(stopLossAmountSell),
        sellAssetCode: stopLossAssetCode.toUpperCase(),
        sellAssetIssuer: stopLossAssetIssuer || null,
        cooldownMinutes: Number(stopLossCooldownMinutes),
      };

      const challenge = await createTurretsChallenge({
        ownerPublicKey: publicKey,
        type: "stop_loss",
        config,
      });

      const { signedXDR, error } = await signTransactionWithWallet(challenge.challengeXDR);
      if (error || !signedXDR) {
        throw new Error(error || "Freighter could not sign the stop-loss challenge");
      }

      await deployTurretsFunction({
        ownerPublicKey: publicKey,
        type: "stop_loss",
        config,
        deploymentHash: challenge.deploymentHash,
        signedChallengeXDR: signedXDR,
      });

      showToast("Stop-loss txFunction deployed");
      refreshDeployments();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stop-loss deployment failed";
      showToast(message);
    } finally {
      setStopLossSubmitting(false);
    }
  };

  const toggleStatus = async (deployment: TurretsDeployment) => {
    try {
      if (deployment.status === "active") {
        await pauseTurretsFunction(deployment.id);
        showToast("txFunction paused");
      } else {
        await resumeTurretsFunction(deployment.id);
        showToast("txFunction resumed");
      }
      refreshDeployments();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not change txFunction status";
      showToast(message);
    }
  };

  const loadHistory = async (deploymentId: string) => {
    setLoadingHistoryId(deploymentId);
    try {
      const history = await getTurretsHistory(deploymentId);
      setHistoryById((prev) => ({ ...prev, [deploymentId]: history }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load execution history";
      showToast(message);
    } finally {
      setLoadingHistoryId(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 cursor-default select-none">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">Settings</h1>
          <p className="text-slate-400">Connect your wallet to configure Turrets txFunctions</p>
        </div>
        <WalletConnect onConnect={onConnect} />
>>>>>>> ccd17266252c90fdc295d5a1537f1aacaae16dd4
      </div>
    );
  }

  return (
<<<<<<< HEAD
    <div className="min-h-screen bg-gradient-to-br from-cosmos-900 via-cosmos-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto pt-20">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <SettingsIcon className="w-8 h-8 text-stellar-400" />
            Settings
          </h1>
          <p className="text-slate-400">
            Manage your Stellar Name Service registration and account preferences
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-8 p-1 bg-slate-900/50 rounded-xl border border-white/10">
          <button
            onClick={() => setActiveTab("names")}
            className={clsx(
              "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === "names"
                ? "bg-stellar-500/20 text-stellar-300 border border-stellar-500/30"
                : "text-slate-400 hover:text-slate-300 hover:bg-white/5"
            )}
          >
            Stellar Names
          </button>
          <button
            onClick={() => setActiveTab("preferences")}
            className={clsx(
              "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === "preferences"
                ? "bg-stellar-500/20 text-stellar-300 border border-stellar-500/30"
                : "text-slate-400 hover:text-slate-300 hover:bg-white/5"
            )}
          >
            Preferences
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "names" && <StellarNamesTab publicKey={publicKey} />}
        {activeTab === "preferences" && <PreferencesTab publicKey={publicKey} />}
      </div>
    </div>
  );
}

function StellarNamesTab({ publicKey }: { publicKey: string }) {
  return (
    <div className="space-y-6">
      {/* Current Account */}
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <UserIcon className="w-5 h-5 text-stellar-400" />
          Your Account
        </h2>
        <div className="p-4 rounded-xl bg-slate-900/50 border border-white/10">
          <p className="text-sm text-slate-400 mb-1">Stellar Address</p>
          <p className="font-mono text-sm text-slate-200">{publicKey}</p>
          <p className="text-xs text-slate-500 mt-1">
            Short: {shortenAddress(publicKey)}
          </p>
        </div>
      </div>

      {/* Stellar Name Service Registration */}
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-white mb-4">
          Register Your Stellar Name
        </h2>
        
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-stellar-500/10 border border-stellar-500/20">
            <div className="flex items-start gap-3">
              <InfoIcon className="w-5 h-5 text-stellar-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-stellar-300 mb-1">
                  What is Stellar Name Service?
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Stellar Name Service allows you to register human-readable names (like alice.xlm) 
                  that resolve to your Stellar address. This makes it easier for people to send you 
                  payments without needing to remember your long G... address.
                </p>
              </div>
            </div>
          </div>

          {/* Registration Options */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Stellar Name Service (.xlm) */}
            <div className="p-4 rounded-xl border border-white/10 bg-slate-900/30 hover:bg-slate-900/50 transition-colors">
              <h3 className="font-medium text-white mb-2">Stellar Name Service</h3>
              <p className="text-sm text-slate-400 mb-3">
                Register a .xlm name that resolves to your address
              </p>
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  Easy to remember (alice.xlm)
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  Works across all Stellar apps
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  Decentralized and secure
                </div>
              </div>
              <a
                href="https://stellar.id"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stellar-500/20 text-stellar-300 text-sm font-medium hover:bg-stellar-500/30 transition-colors"
              >
                Register on Stellar.ID
                <ExternalLinkIcon className="w-4 h-4" />
              </a>
            </div>

            {/* Federation Protocol */}
            <div className="p-4 rounded-xl border border-white/10 bg-slate-900/30 hover:bg-slate-900/50 transition-colors">
              <h3 className="font-medium text-white mb-2">Federation Protocol</h3>
              <p className="text-sm text-slate-400 mb-3">
                Set up federation on your own domain
              </p>
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  Use your own domain
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  Full control over names
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckIcon className="w-3 h-3 text-emerald-400" />
                  Standard Stellar protocol
                </div>
              </div>
              <a
                href="https://developers.stellar.org/docs/encyclopedia/federation"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 text-sm font-medium hover:bg-slate-700/70 transition-colors"
              >
                Learn More
                <ExternalLinkIcon className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* How it works */}
          <div className="p-4 rounded-xl bg-slate-900/50 border border-white/10">
            <h3 className="font-medium text-white mb-3">How it works</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-stellar-500/20 text-stellar-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <p className="text-sm text-slate-300 font-medium">Register your name</p>
                  <p className="text-xs text-slate-500">
                    Choose a service and register your preferred name
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-stellar-500/20 text-stellar-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <p className="text-sm text-slate-300 font-medium">Link to your address</p>
                  <p className="text-xs text-slate-500">
                    Associate your name with your Stellar public key
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-stellar-500/20 text-stellar-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <p className="text-sm text-slate-300 font-medium">Start receiving payments</p>
                  <p className="text-xs text-slate-500">
                    Share your name instead of your long address
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreferencesTab({ publicKey }: { publicKey: string }) {
  const [notifications, setNotifications] = useState(true);
  const [autoConnect, setAutoConnect] = useState(false);
  const [theme, setTheme] = useState<"dark" | "auto">("dark");

  return (
    <div className="space-y-6">
      {/* General Preferences */}
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-white mb-4">
          General Preferences
        </h2>
        
        <div className="space-y-4">
          {/* Theme */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-200">Theme</p>
              <p className="text-xs text-slate-500">Choose your preferred theme</p>
            </div>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "dark" | "auto")}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-stellar-400/50"
            >
              <option value="dark">Dark</option>
              <option value="auto">Auto</option>
            </select>
          </div>

          {/* Auto Connect */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-200">Auto-connect wallet</p>
              <p className="text-xs text-slate-500">Automatically connect when you visit the app</p>
            </div>
            <button
              onClick={() => setAutoConnect(!autoConnect)}
              className={clsx(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                autoConnect ? "bg-stellar-500" : "bg-slate-700"
              )}
            >
              <span
                className={clsx(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  autoConnect ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {/* Notifications */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-200">Payment notifications</p>
              <p className="text-xs text-slate-500">Get notified when you receive payments</p>
            </div>
            <button
              onClick={() => setNotifications(!notifications)}
              className={clsx(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                notifications ? "bg-stellar-500" : "bg-slate-700"
              )}
            >
              <span
                className={clsx(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  notifications ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Privacy & Security */}
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-white mb-4">
          Privacy & Security
        </h2>
        
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900/50 border border-white/10">
            <p className="text-sm text-slate-300 mb-2">Your data stays private</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Stellar MicroPay is a client-side application. Your private keys never leave your 
              wallet, and we don't store any personal information on our servers. All transactions 
              are processed directly on the Stellar network.
            </p>
          </div>
          
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-sm text-amber-300 mb-2">Keep your wallet secure</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              Always verify transaction details before signing. Never share your secret key or 
              recovery phrase with anyone. Use hardware wallets for large amounts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
=======
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 cursor-default select-none">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-1">Settings</h1>
        <p className="text-slate-400 text-sm">Deploy and monitor Stellar Turrets txFunctions</p>
      </div>

      <div className="card mb-6">
        <p className="label mb-1">Connected Wallet</p>
        <p className="font-mono text-sm text-slate-300 break-all">{publicKey}</p>
        <p className="text-xs text-slate-400 mt-2">{deploymentCountLabel}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card">
          <h2 className="font-display text-xl text-white mb-4">DCA into XLM</h2>

          <label className="label">Quote Amount</label>
          <input
            className="input-field mb-4"
            value={dcaAmountQuote}
            onChange={(e) => setDcaAmountQuote(e.target.value)}
            placeholder="10"
          />

          <label className="label">Interval (minutes)</label>
          <input
            className="input-field mb-4"
            value={dcaIntervalMinutes}
            onChange={(e) => setDcaIntervalMinutes(e.target.value)}
            placeholder="60"
          />

          <label className="label">Quote Asset Code</label>
          <input
            className="input-field mb-4"
            value={dcaQuoteAssetCode}
            onChange={(e) => setDcaQuoteAssetCode(e.target.value)}
            placeholder="USDC"
          />

          <label className="label">Quote Asset Issuer (required for non-XLM)</label>
          <input
            className="input-field mb-4"
            value={dcaQuoteAssetIssuer}
            onChange={(e) => setDcaQuoteAssetIssuer(e.target.value)}
            placeholder="G..."
          />

          <button className="btn-primary w-full" onClick={deployDca} disabled={dcaSubmitting}>
            {dcaSubmitting ? "Deploying..." : "Deploy DCA txFunction"}
          </button>
        </div>

        <div className="card">
          <h2 className="font-display text-xl text-white mb-4">Stop-loss</h2>

          <label className="label">Threshold Price (USD)</label>
          <input
            className="input-field mb-4"
            value={stopLossThreshold}
            onChange={(e) => setStopLossThreshold(e.target.value)}
            placeholder="0.09"
          />

          <label className="label">Amount to Sell</label>
          <input
            className="input-field mb-4"
            value={stopLossAmountSell}
            onChange={(e) => setStopLossAmountSell(e.target.value)}
            placeholder="25"
          />

          <label className="label">Sell Asset Code</label>
          <input
            className="input-field mb-4"
            value={stopLossAssetCode}
            onChange={(e) => setStopLossAssetCode(e.target.value)}
            placeholder="USDC"
          />

          <label className="label">Sell Asset Issuer (required for non-XLM)</label>
          <input
            className="input-field mb-4"
            value={stopLossAssetIssuer}
            onChange={(e) => setStopLossAssetIssuer(e.target.value)}
            placeholder="G..."
          />

          <label className="label">Cooldown (minutes)</label>
          <input
            className="input-field mb-4"
            value={stopLossCooldownMinutes}
            onChange={(e) => setStopLossCooldownMinutes(e.target.value)}
            placeholder="30"
          />

          <button
            className="btn-primary w-full"
            onClick={deployStopLoss}
            disabled={stopLossSubmitting}
          >
            {stopLossSubmitting ? "Deploying..." : "Deploy Stop-loss txFunction"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-white">Function Status & History</h2>
          <button className="btn-secondary py-2 px-4" onClick={refreshDeployments}>
            Refresh
          </button>
        </div>

        {deployments.length === 0 ? (
          <p className="text-slate-400 text-sm">No txFunctions deployed yet.</p>
        ) : (
          <div className="space-y-4">
            {deployments.map((deployment) => {
              const history = historyById[deployment.id] || [];

              return (
                <div key={deployment.id} className="border border-white/10 rounded-xl p-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-white font-medium">
                        {deployment.type === "dca" ? "DCA" : "Stop-loss"} · {deployment.status}
                      </p>
                      <p className="text-xs text-slate-400 break-all">ID: {deployment.id}</p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        className="btn-secondary py-2 px-3 text-sm"
                        onClick={() => toggleStatus(deployment)}
                      >
                        {deployment.status === "active" ? "Pause" : "Resume"}
                      </button>
                      <button
                        className="btn-secondary py-2 px-3 text-sm"
                        onClick={() => loadHistory(deployment.id)}
                        disabled={loadingHistoryId === deployment.id}
                      >
                        {loadingHistoryId === deployment.id ? "Loading..." : "Load History"}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs text-slate-400">
                    <p>Created: {formatDate(deployment.createdAt)}</p>
                    <p>Next Run: {formatDate(deployment.nextRunAt)}</p>
                    <p>Last Checked: {formatDate(deployment.lastCheckedAt)}</p>
                    <p>Last Executed: {formatDate(deployment.lastExecutedAt)}</p>
                    <p>Last Observed Price: {deployment.lastObservedPriceUsd ?? "—"}</p>
                    <p>Last Error: {deployment.lastError || "None"}</p>
                  </div>

                  <div className="mt-4">
                    {history.length === 0 ? (
                      <p className="text-xs text-slate-500">No history loaded yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-auto pr-1">
                        {history.map((entry) => (
                          <div key={entry.id} className="text-xs border border-white/5 rounded-lg p-2">
                            <p className="text-slate-200">
                              {entry.status} · {entry.message}
                            </p>
                            <p className="text-slate-500">{formatDate(entry.createdAt)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}
>>>>>>> ccd17266252c90fdc295d5a1537f1aacaae16dd4
