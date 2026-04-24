/**
 * pages/settings.tsx
 * Advanced settings for Stellar MicroPay, including account merge support.
 */

import { FormEvent, useState } from "react";
import WalletConnect from "@/components/WalletConnect";
import {
  buildAccountMergeTransaction,
  isValidStellarAddress,
  submitTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";

interface SettingsProps {
  publicKey: string | null;
  onConnect: (publicKey: string) => void;
}

export default function Settings({ publicKey, onConnect }: SettingsProps) {
  const [destination, setDestination] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destinationTrimmed = destination.trim();
  const canMerge =
    isValidStellarAddress(destinationTrimmed) && confirmText.trim() === "MERGE";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setTransactionHash(null);

    if (!publicKey) {
      setError("Connect your Freighter wallet before merging accounts.");
      return;
    }

    if (!isValidStellarAddress(destinationTrimmed)) {
      setError("Please enter a valid Stellar destination address.");
      return;
    }

    if (confirmText.trim() !== "MERGE") {
      setError("Type MERGE to confirm closing your account.");
      return;
    }

    setIsSubmitting(true);

    try {
      const transaction = await buildAccountMergeTransaction({
        fromPublicKey: publicKey,
        destinationPublicKey: destinationTrimmed,
      });

      const { signedXDR, error: signError } = await signTransactionWithWallet(
        transaction.toXDR()
      );

      if (signError || !signedXDR) {
        throw new Error(signError || "Unable to sign the merge transaction.");
      }

      const result = await submitTransaction(signedXDR);
      setTransactionHash(result.hash);
      setDestination("");
      setConfirmText("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1 className="font-display text-3xl font-semibold text-slate-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Manage your wallet, advanced network settings and account consolidation options.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <section className="card">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Advanced
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">
                  Account Merge
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Consolidate your Stellar account by transferring all native XLM and closing the source account.
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-6">
              <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">
                <p className="font-semibold text-red-200">Warning</p>
                <p className="mt-2 text-sm leading-6 text-red-100">
                  This will close your account and transfer all XLM to the destination address. Once completed, the source account can no longer be used.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="label" htmlFor="destination">
                    Destination address
                  </label>
                  <input
                    id="destination"
                    type="text"
                    className="input-field"
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    placeholder="G..."
                    aria-describedby="destination-help"
                    required
                  />
                  <p id="destination-help" className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    Enter the Stellar public key that will receive the remaining XLM.
                  </p>
                </div>

                <div>
                  <label className="label" htmlFor="confirm">
                    Confirm account closure
                  </label>
                  <input
                    id="confirm"
                    type="text"
                    className="input-field"
                    value={confirmText}
                    onChange={(event) => setConfirmText(event.target.value)}
                    placeholder="Type MERGE to confirm"
                    aria-describedby="confirm-help"
                    required
                  />
                  <p id="confirm-help" className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    You must type <span className="font-semibold">MERGE</span> to enable the merge transaction.
                  </p>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                    {error}
                  </div>
                )}

                {transactionHash ? (
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5 text-sm text-emerald-100">
                    <p className="font-semibold text-emerald-200">Merge successful</p>
                    <p className="mt-2">
                      Transaction hash: <span className="font-mono break-all text-emerald-100">{transactionHash}</span>
                    </p>
                    <p className="mt-2 text-slate-100">
                      Your source account has been closed. The destination account now owns the remaining XLM.
                    </p>
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={!canMerge || isSubmitting}
                  className="btn-primary w-full"
                >
                  {isSubmitting ? "Submitting merge..." : "Merge account"}
                </button>
              </form>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          {publicKey ? (
            <section className="card">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Connected wallet</h3>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 break-all">
                {publicKey}
              </p>
            </section>
          ) : (
            <WalletConnect onConnect={onConnect} />
          )}

          <section className="card">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Need help?</h3>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Account merge is irreversible. Make sure your destination address is correct and you understand that the source account will be permanently closed.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
