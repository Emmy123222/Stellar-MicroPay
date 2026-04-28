/**
 * pages/settings.tsx
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
      </div>
    );
  }

  return (
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