/**
 * pages/settings.tsx
 * Settings page with network switcher for testnet/mainnet/custom Horizon URL.
 */

import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { getNetworkConfig, setNetworkConfig, NetworkConfig } from "@/lib/stellar";
import { disconnectWallet, signTransactionWithWallet } from "@/lib/wallet";
import {
  createTurretsChallenge,
  deployTurretsFunction,
  listTurretsFunctions,
  pauseTurretsFunction,
  resumeTurretsFunction,
  TurretsDeployment,
} from "@/lib/turrets";
import { shortenAddress } from "@/lib/stellar";
import { useWallet } from "@/lib/useWallet";

interface SettingsPageProps {
  publicKey: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function SettingsPage({
  publicKey,
  onConnect,
  onDisconnect,
}: SettingsPageProps) {
  const [config, setConfig] = useState<NetworkConfig>({
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  });
  const [customUrl, setCustomUrl] = useState("");
  const [showMainnetWarning, setShowMainnetWarning] = useState(false);
  const [pendingNetwork, setPendingNetwork] = useState<"testnet" | "mainnet" | "custom" | null>(null);

  const [deployments, setDeployments] = useState<TurretsDeployment[]>([]);
  const [turretsLoading, setTurretsLoading] = useState(false);
  const [turretsError, setTurretsError] = useState<string | null>(null);
  const [turretsSuccess, setTurretsSuccess] = useState<string | null>(null);

  const [dcaForm, setDcaForm] = useState({
    amountQuote: "10",
    intervalMinutes: "60",
    quoteAssetCode: "USDC",
    quoteAssetIssuer: "",
  });

  const [stopLossForm, setStopLossForm] = useState({
    thresholdPrice: "0.10",
    amountSell: "10",
    sellAssetCode: "USDC",
    sellAssetIssuer: "",
    cooldownMinutes: "30",
  });

  // Username registration state
  const [username, setUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);
  const [registeredUsername, setRegisteredUsername] = useState<string | null>(null);

  // Fetch current username on mount
  useEffect(() => {
    const fetchUsername = async () => {
      if (!publicKey) return;
      
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      try {
        const response = await fetch(
          `${apiBase}/api/accounts/resolve/${encodeURIComponent(publicKey)}`
        );
        if (response.ok) {
          const payload = await response.json();
          if (payload?.success && payload?.data?.username) {
            setRegisteredUsername(payload.data.username);
          }
        }
      } catch (err) {
        console.error("Error fetching username:", err);
      }
    };
    
    fetchUsername();
  }, [publicKey]);

  useEffect(() => {
    const loadTurretsDeployments = async () => {
      if (!publicKey) {
        setDeployments([]);
        return;
      }

      setTurretsLoading(true);
      setTurretsError(null);

      try {
        const data = await listTurretsFunctions(publicKey);
        setDeployments(data);
      } catch (err) {
        setTurretsError(err instanceof Error ? err.message : "Failed to load Turrets deployments");
      } finally {
        setTurretsLoading(false);
      }
    };

    loadTurretsDeployments();
  }, [publicKey]);

  useEffect(() => {
    const currentConfig = getNetworkConfig();
    setConfig(currentConfig);
    if (currentConfig.network === "custom") {
      setCustomUrl(currentConfig.horizonUrl);
    }
  }, []);

  const handleNetworkChange = (network: "testnet" | "mainnet" | "custom") => {
    if (network === "mainnet" && config.network !== "mainnet") {
      setPendingNetwork(network);
      setShowMainnetWarning(true);
      return;
    }

    applyNetworkChange(network);
  };

  const refreshTurretsDeployments = async () => {
    if (!publicKey) return;
    setTurretsLoading(true);
    setTurretsError(null);

    try {
      const data = await listTurretsFunctions(publicKey);
      setDeployments(data);
    } catch (err) {
      setTurretsError(err instanceof Error ? err.message : "Failed to refresh Turrets deployments");
    } finally {
      setTurretsLoading(false);
    }
  };

  const handleTurretsAction = async (type: "dca" | "stop_loss") => {
    if (!publicKey) {
      setTurretsError("Connect your wallet before deploying a Turrets function.");
      return;
    }

    setTurretsLoading(true);
    setTurretsError(null);
    setTurretsSuccess(null);

    try {
      const config =
        type === "dca"
          ? {
              amountQuote: Number(dcaForm.amountQuote),
              intervalMinutes: Number(dcaForm.intervalMinutes),
              quoteAssetCode: dcaForm.quoteAssetCode.trim().toUpperCase(),
              quoteAssetIssuer: dcaForm.quoteAssetIssuer.trim(),
            }
          : {
              thresholdPrice: Number(stopLossForm.thresholdPrice),
              amountSell: Number(stopLossForm.amountSell),
              sellAssetCode: stopLossForm.sellAssetCode.trim().toUpperCase(),
              sellAssetIssuer: stopLossForm.sellAssetIssuer.trim(),
              cooldownMinutes: Number(stopLossForm.cooldownMinutes),
            };

      const { challengeXDR, deploymentHash } = await createTurretsChallenge({
        ownerPublicKey: publicKey,
        type,
        config,
      });

      const { signedXDR, error } = await signTransactionWithWallet(challengeXDR);
      if (error || !signedXDR) {
        throw new Error(error || "Failed to sign Turrets challenge");
      }

      const deployment = await deployTurretsFunction({
        ownerPublicKey: publicKey,
        type,
        config,
        deploymentHash,
        signedChallengeXDR: signedXDR,
      });

      setTurretsSuccess(
        `Turrets ${type === "dca" ? "DCA" : "stop-loss"} function deployed successfully.`
      );
      setDeployments((prev) => [deployment, ...prev]);
    } catch (err) {
      setTurretsError(err instanceof Error ? err.message : "Failed to deploy Turrets function");
    } finally {
      setTurretsLoading(false);
    }
  };

  const handleToggleDeployment = async (deployment: TurretsDeployment) => {
    if (!publicKey) {
      setTurretsError("Connect your wallet to manage Turrets deployments.");
      return;
    }

    setTurretsLoading(true);
    setTurretsError(null);

    try {
      const updated =
        deployment.status === "active"
          ? await pauseTurretsFunction(deployment.id)
          : await resumeTurretsFunction(deployment.id);
      setDeployments((prev) => prev.map((item) => (item.id === deployment.id ? updated : item)));
    } catch (err) {
      setTurretsError(err instanceof Error ? err.message : "Failed to update deployment status");
    } finally {
      setTurretsLoading(false);
    }
  };

  const applyNetworkChange = (network: "testnet" | "mainnet" | "custom") => {
    let horizonUrl: string;
    if (network === "testnet") {
      horizonUrl = "https://horizon-testnet.stellar.org";
    } else if (network === "mainnet") {
      horizonUrl = "https://horizon.stellar.org";
    } else {
      horizonUrl = customUrl.trim();
      if (!horizonUrl) return; // Don't allow empty custom URL
    }

    const newConfig: NetworkConfig = { network, horizonUrl };
    setNetworkConfig(newConfig);
    setConfig(newConfig);

    // Disconnect wallet to force reconnect on new network
    if (publicKey) {
      disconnectWallet();
      disconnectCurrentWallet();
    }

    setShowMainnetWarning(false);
    setPendingNetwork(null);
  };

  const handleCustomUrlChange = (url: string) => {
    setCustomUrl(url);
    if (config.network === "custom") {
      const newConfig: NetworkConfig = { network: "custom", horizonUrl: url };
      setNetworkConfig(newConfig);
      setConfig(newConfig);

      // Disconnect wallet on URL change
      if (publicKey) {
        disconnectWallet();
        disconnectCurrentWallet();
      }
    }
  };

  // Username registration handler
  const handleRegisterUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !publicKey) {
      setUsernameError("Username and wallet connection required");
      return;
    }

    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9]{3,20}$/;
    if (!usernameRegex.test(username.trim())) {
      setUsernameError("Username must be 3-20 characters, alphanumeric only");
      return;
    }

    setUsernameLoading(true);
    setUsernameError(null);
    setUsernameSuccess(null);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      const response = await fetch(`${apiBase}/api/accounts/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          publicKey,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to register username");
      }

      setRegisteredUsername(username.trim().toLowerCase());
      setUsernameSuccess(`Username @${username.trim()} registered successfully!`);
      setUsername("");
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : "Failed to register username");
    } finally {
      setUsernameLoading(false);
    }
  };

  const confirmMainnetSwitch = () => {
    if (pendingNetwork) {
      applyNetworkChange(pendingNetwork);
    }
  };

  return (
    <>
      <Head>
        <title>Settings - Stellar MicroPay</title>
      </Head>
      <div className="min-h-screen bg-white dark:bg-cosmos-900">
        <main className="mx-auto max-w-2xl px-4 py-8">
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white mb-2">
                Settings
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                Configure your Stellar network preferences
              </p>
            </div>

            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                Network Configuration
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Select Network
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleNetworkChange("testnet")}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                        config.network === "testnet"
                          ? "border-stellar-500 bg-stellar-500/10 text-stellar-400"
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                      }`}
                    >
                      Testnet
                    </button>
                    <button
                      onClick={() => handleNetworkChange("mainnet")}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                        config.network === "mainnet"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                      }`}
                    >
                      Mainnet
                    </button>
                    <button
                      onClick={() => handleNetworkChange("custom")}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                        config.network === "custom"
                          ? "border-purple-500 bg-purple-500/10 text-purple-400"
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                {config.network === "custom" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Custom Horizon URL
                    </label>
                    <input
                      type="url"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      onBlur={() => handleCustomUrlChange(customUrl)}
                      placeholder="https://horizon.example.com"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Enter a custom Horizon server URL. Changes take effect immediately.
                    </p>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-600 dark:text-slate-400">Current:</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {config.horizonUrl}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Turrets / Server-side Signing
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Deploy programmatic txFunctions with Freighter-signed authorization and server-side evaluation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refreshTurretsDeployments}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                >
                  Refresh
                </button>
              </div>

              {(turretsError || turretsSuccess) && (
                <div className="space-y-2 mb-4">
                  {turretsError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">
                      {turretsError}
                    </div>
                  )}
                  {turretsSuccess && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
                      {turretsSuccess}
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">DCA into XLM</p>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Quote Amount (USD)</label>
                    <input
                      type="number"
                      value={dcaForm.amountQuote}
                      onChange={(e) => setDcaForm((prev) => ({ ...prev, amountQuote: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Interval (minutes)</label>
                    <input
                      type="number"
                      value={dcaForm.intervalMinutes}
                      onChange={(e) => setDcaForm((prev) => ({ ...prev, intervalMinutes: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Quote Asset Code</label>
                    <input
                      type="text"
                      value={dcaForm.quoteAssetCode}
                      onChange={(e) => setDcaForm((prev) => ({ ...prev, quoteAssetCode: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Quote Asset Issuer</label>
                    <input
                      type="text"
                      value={dcaForm.quoteAssetIssuer}
                      onChange={(e) => setDcaForm((prev) => ({ ...prev, quoteAssetIssuer: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      disabled={turretsLoading}
                      onClick={() => handleTurretsAction("dca")}
                      className="w-full mt-4 px-4 py-2 rounded-lg bg-stellar-500 text-white font-medium hover:bg-stellar-600 disabled:opacity-60"
                    >
                      Deploy DCA Function
                    </button>
                  </div>

                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">Stop-loss Monitor</p>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Threshold Price (USD)</label>
                    <input
                      type="number"
                      value={stopLossForm.thresholdPrice}
                      onChange={(e) => setStopLossForm((prev) => ({ ...prev, thresholdPrice: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Amount to Sell</label>
                    <input
                      type="number"
                      value={stopLossForm.amountSell}
                      onChange={(e) => setStopLossForm((prev) => ({ ...prev, amountSell: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Sell Asset Code</label>
                    <input
                      type="text"
                      value={stopLossForm.sellAssetCode}
                      onChange={(e) => setStopLossForm((prev) => ({ ...prev, sellAssetCode: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Sell Asset Issuer</label>
                    <input
                      type="text"
                      value={stopLossForm.sellAssetIssuer}
                      onChange={(e) => setStopLossForm((prev) => ({ ...prev, sellAssetIssuer: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Cooldown (minutes)</label>
                    <input
                      type="number"
                      value={stopLossForm.cooldownMinutes}
                      onChange={(e) => setStopLossForm((prev) => ({ ...prev, cooldownMinutes: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      disabled={turretsLoading}
                      onClick={() => handleTurretsAction("stop_loss")}
                      className="w-full mt-4 px-4 py-2 rounded-lg bg-stellar-500 text-white font-medium hover:bg-stellar-600 disabled:opacity-60"
                    >
                      Deploy Stop-loss Function
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">Deployments</p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{deployments.length} active</span>
                    </div>
                    {turretsLoading ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">Loading deployments...</p>
                    ) : deployments.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No Turrets functions deployed yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {deployments.map((deployment) => (
                          <div key={deployment.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-cosmos-900">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{deployment.type === "dca" ? "DCA" : "Stop-loss"}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{deployment.id}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleToggleDeployment(deployment)}
                                className="text-xs px-2 py-1 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                              >
                                {deployment.status === "active" ? "Pause" : "Resume"}
                              </button>
                            </div>
                            <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <div>Next run: {deployment.nextRunAt || "n/a"}</div>
                              <div>Last checked: {deployment.lastCheckedAt || "n/a"}</div>
                              <div>Last executed: {deployment.lastExecutedAt || "n/a"}</div>
                              {deployment.lastError && <div className="text-rose-400">Error: {deployment.lastError}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Username Registration Section */}
            {publicKey ? (
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-stellar-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Creator Username
                </h2>

                {registeredUsername ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                      <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <div>
                        <p className="text-emerald-400 font-medium">@{registeredUsername}</p>
                        <p className="text-xs text-slate-400">Your tip page: {typeof window !== "undefined" ? window.location.origin : ""}/tip/{registeredUsername}</p>
                      </div>
                    </div>
                    <Link
                      href={`/tip/${registeredUsername}`}
                      className="inline-flex items-center gap-2 text-sm text-stellar-400 hover:text-stellar-300"
                    >
                      View your tip page →
                    </Link>
                  </div>
                ) : (
                  <form onSubmit={handleRegisterUsername} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Register a username
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">@</span>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="yourname"
                            className="w-full pl-7 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                            disabled={usernameLoading}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={usernameLoading || !username.trim()}
                          className="px-4 py-2 bg-stellar-500 hover:bg-stellar-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                        >
                          {usernameLoading ? "Registering..." : "Register"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        3-20 characters, letters and numbers only
                      </p>
                    </div>

                    {usernameError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <p className="text-sm text-red-400">{usernameError}</p>
                      </div>
                    )}

                    {usernameSuccess && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                        <p className="text-sm text-emerald-400">{usernameSuccess}</p>
                      </div>
                    )}
                  </form>
                )}

                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-600 dark:text-slate-400">Linked wallet:</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {shortenAddress(publicKey)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="text-center py-4">
                  <svg className="w-12 h-12 mx-auto text-slate-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <p className="text-slate-600 dark:text-slate-400">
                    Connect your wallet to register a username
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Mainnet Warning Modal */}
      {showMainnetWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-cosmos-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Switch to Mainnet?
              </h3>
            </div>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              Mainnet uses real XLM and real funds. Make sure you understand the risks and have backed up your keys. This action will disconnect your wallet.
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmMainnetSwitch}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Switch to Mainnet
              </button>
              <button
                onClick={() => {
                  setShowMainnetWarning(false);
                  setPendingNetwork(null);
                }}
                className="flex-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
