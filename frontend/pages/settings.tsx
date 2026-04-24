/**
 * pages/settings.tsx
 * Settings page with network switcher for testnet/mainnet/custom Horizon URL.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Navbar from "@/components/Navbar";
import { getNetworkConfig, setNetworkConfig, NetworkConfig } from "@/lib/stellar";
import { disconnectWallet } from "@/lib/wallet";

interface SettingsPageProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
  onDisconnect: () => void;
}

export default function SettingsPage({
  publicKey,
  onConnect,
  onDisconnect,
}: SettingsPageProps) {
  const router = useRouter();
  const [config, setConfig] = useState<NetworkConfig>({
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  });
  const [customUrl, setCustomUrl] = useState("");
  const [showMainnetWarning, setShowMainnetWarning] = useState(false);
  const [pendingNetwork, setPendingNetwork] = useState<"testnet" | "mainnet" | "custom" | null>(null);

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
      onDisconnect();
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
        onDisconnect();
      }
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
        <Navbar
          publicKey={publicKey}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />

        <main className="max-w-2xl mx-auto px-4 py-8">
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