/**
 * components/WalletConnect.tsx
 * Wallet connection UI — shown when no wallet is connected.
 */

import { useState, useEffect } from "react";
import { connectWallet, isFreighterInstalled, detectBrowser, EXTENSION_URLS, performSEP0010Auth } from "@/lib/wallet";

interface WalletConnectProps {
  onConnect: (publicKey: string) => void;
}

export default function WalletConnect({ onConnect }: WalletConnectProps) {
  const [loading, setLoading] = useState(false);
  const [step, setStep]       = useState<"idle" | "connecting" | "authenticating">("idle");
  const [error, setError]     = useState<string | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [browser, setBrowser] = useState<"chrome" | "firefox" | "other">("other");

  useEffect(() => {
    setBrowser(detectBrowser());
  }, []);

  const handleConnect = async () => {
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
    const { publicKey, error: walletError } = await connectWallet();

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

    onConnect(publicKey);
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
          onClick={handleConnect}
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
        Stellar MicroPay uses{" "}
        <a
          href="https://freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-stellar-400 hover:text-stellar-300 underline underline-offset-2"
        >
          Freighter
        </a>
        , a browser wallet for the Stellar network. Connect to start sending payments.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-left">
          {error}
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {step === "connecting"     ? <><Spinner /> Connecting...</> :
         step === "authenticating" ? <><Spinner /> Authenticating...</> :
         <><WalletIcon className="w-4 h-4" /> Connect Freighter Wallet</>}
      </button>

      <p className="mt-4 text-xs text-slate-500">
        Don&apos;t have Freighter?{" "}
        <a
          href={extensionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-stellar-400 hover:underline"
        >
          Install the extension →
        </a>
      </p>

      {/* Network indicator */}
      <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-center gap-2 text-xs text-slate-500">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Connected to{" "}
        <span className="font-mono text-slate-400">
          {process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet"}
        </span>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
    </svg>
  );
}

function PuzzleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
