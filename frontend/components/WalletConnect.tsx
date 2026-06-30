/**
 * components/WalletConnect.tsx
 * Wallet connection UI — shown when no wallet is connected.
 */

import { useState, useEffect } from "react";
import { withErrorBoundary } from "@/components/ErrorBoundary";
import { 
  connectWallet as requestWalletConnection,
  isFreighterInstalled, 
  detectBrowser, 
  EXTENSION_URLS, 
  performSEP0010Auth,
  getLedgerPublicKey,
  isLedgerSupported
} from "@/lib/wallet";
import { useWallet } from "@/lib/useWallet";
import { LedgerIcon, WalletIcon, PuzzleIcon, ExternalLinkIcon, Spinner } from "@/components/icons";

interface WalletConnectProps {
  onConnectSuccess?: (publicKey: string) => void;
}

type WalletType = "freighter" | "ledger";

function WalletConnect({ onConnectSuccess }: WalletConnectProps) {
  const { connectWallet } = useWallet();
  const [loading, setLoading] = useState(false);
  const [step, setStep]       = useState<"idle" | "connecting" | "authenticating">("idle");
  const [error, setError]     = useState<string | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [browser, setBrowser] = useState<"chrome" | "firefox" | "other">("other");
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null);
  const [ledgerSupported, setLedgerSupported] = useState(false);

  useEffect(() => {
    setBrowser(detectBrowser());
    // Check if Ledger is supported
    isLedgerSupported().then(setLedgerSupported);
  }, []);

  const handleFreighterConnect = async () => {
    setSelectedWallet("freighter");
    setLoading(true);
    setError(null);
    setStep("connecting");

    const installed = await isFreighterInstalled();
    if (!installed) {
      setShowInstallPrompt(true);
      setLoading(false);
      setStep("idle");
      return;
    }

    setShowInstallPrompt(false);
    const { publicKey, error: walletError } = await requestWalletConnection();

    if (walletError || !publicKey) {
      setError(walletError || "Could not retrieve public key.");
      setLoading(false);
      setStep("idle");
      return;
    }

    // SEP-0010: prove ownership of the connected wallet
    setStep("authenticating");
    const { error: authError } = await performSEP0010Auth(publicKey);
    setLoading(false);
    setStep("idle");

    if (authError) {
      setError(authError);
      return;
    }

    connectWallet(publicKey);
    onConnectSuccess?.(publicKey);
  };

  const handleLedgerConnect = async () => {
    setSelectedWallet("ledger");
    setLoading(true);
    setError(null);
    setStep("connecting");

    const { publicKey, error: ledgerError } = await getLedgerPublicKey();

    if (ledgerError || !publicKey) {
      setError(ledgerError || "Could not retrieve public key from Ledger device.");
      setLoading(false);
      setStep("idle");
      return;
    }

    // SEP-0010: prove ownership of the connected wallet
    setStep("authenticating");
    const { error: authError } = await performSEP0010Auth(publicKey);
    setLoading(false);
    setStep("idle");

    if (authError) {
      setError(authError);
      return;
    }

    connectWallet(publicKey);
    onConnectSuccess?.(publicKey);
  };

  const extensionUrl = EXTENSION_URLS[browser];
  const storeName =
    browser === "firefox" ? "Firefox Add-ons" :
    browser === "chrome"  ? "Chrome Web Store" :
    "freighter.app";

  if (showInstallPrompt) {
    return (
      <div className="card max-w-md mx-auto animate-slide-up">
        {/* Icon */}
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <PuzzleIcon className="w-7 h-7 text-amber-400" />
        </div>

        <h2 className="font-display text-xl font-semibold text-white mb-2 text-center">
          Freighter not detected
        </h2>
        <p className="text-slate-400 text-sm mb-5 leading-relaxed text-center">
          Freighter is a free browser extension that lets you sign Stellar transactions securely.
        </p>

        {/* Steps */}
        <ol className="space-y-3 mb-6 text-sm text-slate-300">
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-stellar-500/20 border border-stellar-500/30 text-stellar-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            <span>
              Install Freighter from the{" "}
              <a
                href={extensionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-stellar-400 hover:text-stellar-300 underline underline-offset-2 inline-flex items-center gap-1"
              >
                {storeName}
                <ExternalLinkIcon className="w-3 h-3" />
              </a>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-stellar-500/20 border border-stellar-500/30 text-stellar-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            <span>Create or import your Stellar wallet in the extension</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-stellar-500/20 border border-stellar-500/30 text-stellar-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <span>Come back here and click the button below</span>
          </li>
        </ol>

        <a
          href={extensionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary w-full flex items-center justify-center gap-2 mb-3"
        >
          <ExternalLinkIcon className="w-4 h-4" />
          Get Freighter for {storeName}
        </a>

        <button
          onClick={handleFreighterConnect}
          disabled={loading}
          className="btn-secondary w-full flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Spinner />
              Checking...
            </>
          ) : (
            "I've installed it — try again"
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="card max-w-md mx-auto text-center animate-slide-up">
      {/* Icon */}
      <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-stellar-500/10 border border-stellar-500/20 flex items-center justify-center">
        <WalletIcon className="w-8 h-8 text-stellar-400" />
      </div>

      <h2 className="font-display text-xl font-semibold text-white mb-2">
        Connect your wallet
      </h2>
      <p className="text-slate-400 text-sm mb-6 leading-relaxed">
        Choose your preferred wallet to connect to the Stellar network and start sending payments.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-left">
          {error}
        </div>
      )}

      {/* Wallet Options */}
      <div className="space-y-3 mb-6">
        {/* Freighter Option */}
        <button
          onClick={handleFreighterConnect}
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-3"
        >
          <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center">
            <WalletIcon className="w-3 h-3" />
          </div>
          {step === "connecting" && selectedWallet === "freighter" ? <><Spinner /> Connecting...</> :
           step === "authenticating" && selectedWallet === "freighter" ? <><Spinner /> Authenticating...</> :
           "Connect Freighter Wallet"}
        </button>

        {/* Ledger Option */}
        <button
          onClick={handleLedgerConnect}
          disabled={loading || !ledgerSupported}
          className="btn-secondary w-full flex items-center justify-center gap-3"
        >
          <div className="w-5 h-5 rounded bg-blue-500/20 flex items-center justify-center">
            <LedgerIcon className="w-3 h-3 text-blue-400" />
          </div>
          {step === "connecting" && selectedWallet === "ledger" ? <><Spinner /> Connecting...</> :
           step === "authenticating" && selectedWallet === "ledger" ? <><Spinner /> Authenticating...</> :
           "Connect Ledger Hardware Wallet"}
        </button>
      </div>

      {/* Help Text */}
      <div className="space-y-3 text-xs text-slate-400">
        <div>
          Don&apos;t have Freighter?{" "}
          <a
            href={extensionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-stellar-400 hover:underline"
          >
            Install the extension →
          </a>
        </div>
        
        {!ledgerSupported && (
          <div className="text-amber-400">
            Ledger requires Chrome, Edge, or another Chromium-based browser with WebHID support.
          </div>
        )}
        
        <div>
          Using Ledger? Make sure your device is connected, unlocked, and the Stellar app is open.
        </div>
      </div>

      {/* Network indicator */}
      <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-center gap-2 text-xs text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Connected to{" "}
        <span className="font-mono text-slate-400">
          {process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet"}
        </span>
      </div>
    </div>
  );
}

export default withErrorBoundary(WalletConnect, "WalletConnect");

// ─── Icons ────────────────────────────────────────────────────────────────────

