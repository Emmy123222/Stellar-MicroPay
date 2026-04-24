/**
 * pages/settings.tsx
 * Settings page with trustline management.
 */

import { useState, useEffect, useCallback } from "react";
import WalletConnect from "@/components/WalletConnect";
import Toast from "@/components/Toast";
import {
  getTrustlines,
  buildChangeTrustTransaction,
  submitTransaction,
  getKnownAssets,
  Trustline,
  ACCOUNT_NOT_FOUND_ERROR,
  NETWORK_PASSPHRASE,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { useToast } from "@/lib/useToast";

interface SettingsProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function Settings({ publicKey, onConnect }: SettingsProps) {
  const [trustlines, setTrustlines] = useState<Trustline[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountNotFound, setAccountNotFound] = useState(false);
  const { visible: toastVisible, message: toastMessage, showToast } = useToast();
  const knownAssets = getKnownAssets();

  const fetchTrustlines = useCallback(async () => {
    if (!publicKey) return;

    setLoading(true);
    setAccountNotFound(false);

    try {
      const tls = await getTrustlines(publicKey);
      setTrustlines(tls);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === ACCOUNT_NOT_FOUND_ERROR) {
        setAccountNotFound(true);
      } else {
        showToast(`Failed to load trustlines: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [publicKey, showToast]);

  useEffect(() => {
    fetchTrustlines();
  }, [fetchTrustlines]);

  const handleAddTrustline = async (assetCode: string, issuer: string) => {
    if (!publicKey) return;

    try {
      const tx = await buildChangeTrustTransaction({
        fromPublicKey: publicKey,
        assetCode,
        issuer,
      });

      const { signedXDR, error } = await signTransactionWithWallet(tx.toXDR());
      if (error) {
        showToast(`Signing failed: ${error}`);
        return;
      }

      await submitTransaction(signedXDR!);
      showToast(`Trustline for ${assetCode} added successfully!`);
      fetchTrustlines(); // Refresh
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Failed to add trustline: ${msg}`);
    }
  };

  const handleRemoveTrustline = async (assetCode: string, issuer: string, balance: string) => {
    if (!publicKey) return;

    if (parseFloat(balance) > 0) {
      const confirm = window.confirm(
        `Warning: You have ${balance} ${assetCode} in your account. Removing the trustline will make these assets inaccessible. Are you sure?`
      );
      if (!confirm) return;
    }

    try {
      const tx = await buildChangeTrustTransaction({
        fromPublicKey: publicKey,
        assetCode,
        issuer,
        limit: "0",
      });

      const { signedXDR, error } = await signTransactionWithWallet(tx.toXDR());
      if (error) {
        showToast(`Signing failed: ${error}`);
        return;
      }

      await submitTransaction(signedXDR!);
      showToast(`Trustline for ${assetCode} removed successfully!`);
      fetchTrustlines(); // Refresh
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Failed to remove trustline: ${msg}`);
    }
  };

  if (!publicKey) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-cosmos-950">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
            Settings
          </h1>
          <WalletConnect onConnect={onConnect} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-cosmos-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
          Settings
        </h1>

        <div className="bg-white dark:bg-cosmos-900 rounded-xl shadow-sm border border-slate-200 dark:border-cosmos-800 p-6 mb-8">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
            Trustlines
          </h2>

          {accountNotFound ? (
            <p className="text-slate-500 dark:text-slate-400">
              Account not found. Please fund your account first.
            </p>
          ) : loading ? (
            <p className="text-slate-500 dark:text-slate-400">Loading trustlines...</p>
          ) : (
            <>
              <div className="mb-6">
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                  Existing Trustlines
                </h3>
                {trustlines.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">
                    No trustlines found.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {trustlines.map((tl) => (
                      <li
                        key={`${tl.assetCode}:${tl.issuer}`}
                        className="flex items-center justify-between p-3 bg-slate-50 dark:bg-cosmos-800 rounded-lg"
                      >
                        <div>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {tl.assetCode}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 ml-2">
                            Balance: {tl.balance}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveTrustline(tl.assetCode, tl.issuer, tl.balance)}
                          className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                  Known Assets
                </h3>
                <ul className="space-y-2">
                  {knownAssets.map((asset) => {
                    const hasTrustline = trustlines.some(
                      (tl) => tl.assetCode === asset.code && tl.issuer === asset.issuer
                    );
                    return (
                      <li
                        key={`${asset.code}:${asset.issuer}`}
                        className="flex items-center justify-between p-3 bg-slate-50 dark:bg-cosmos-800 rounded-lg"
                      >
                        <span className="font-medium text-slate-900 dark:text-white">
                          {asset.code}
                        </span>
                        {hasTrustline ? (
                          <span className="text-green-600 dark:text-green-400">
                            Trusted
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAddTrustline(asset.code, asset.issuer)}
                            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                          >
                            Add Trustline
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </div>

        <Toast visible={toastVisible} message={toastMessage} />
      </div>
    </div>
  );
}