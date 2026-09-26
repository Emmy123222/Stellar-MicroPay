/**
 * components/AnchorRamp.tsx
 * SEP-0006 fiat on/off-ramp section for Settings (Closes #1142).
 */

import { useState } from "react";
import { useWallet } from "@/lib/useWallet";
import { getJwtToken } from "@/lib/auth";
import {
  DEFAULT_ANCHOR_URL,
  buildDepositUrl,
  fetchAnchorInfo,
  getAnchorUrl,
  setAnchorUrl,
  submitWithdrawRequest,
  type AnchorInfo,
} from "@/lib/anchor";

export default function AnchorRamp() {
  const { publicKey } = useWallet();
  const [anchorUrl, setAnchorUrlState] = useState(getAnchorUrl);
  const [asset, setAsset] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [info, setInfo] = useState<AnchorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saveUrl = (url: string) => {
    setAnchorUrlState(url);
    setAnchorUrl(url);
  };

  const handleFetchInfo = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fetchAnchorInfo(anchorUrl || DEFAULT_ANCHOR_URL);
      setInfo(result);
      setNotice("Anchor info loaded. Choose deposit or withdraw below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the anchor server.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = () => {
    if (!publicKey) {
      setError("Connect your wallet first.");
      return;
    }
    const url = buildDepositUrl({
      anchorUrl: anchorUrl || DEFAULT_ANCHOR_URL,
      assetCode: asset,
      account: publicKey,
    });
    window.open(url, "_blank", "noopener,noreferrer");
    setNotice("Anchor deposit flow opened in a new tab. Complete KYC/payment there.");
  };

  const handleWithdraw = async () => {
    setError(null);
    setNotice(null);
    if (!publicKey) {
      setError("Connect your wallet first.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount to withdraw.");
      return;
    }
    const token = getJwtToken();
    if (!token) {
      setError("Sign in (SEP-0010) to get a JWT before withdrawing.");
      return;
    }
    setLoading(true);
    try {
      await submitWithdrawRequest({
        anchorUrl: anchorUrl || DEFAULT_ANCHOR_URL,
        assetCode: asset,
        amount,
        account: publicKey,
        jwt: token,
      });
      setNotice(
        "Withdraw submitted. Await the Stellar payment from the anchor, then check your balance."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Anchor server URL
        </label>
        <input
          type="url"
          value={anchorUrl}
          onChange={(e) => saveUrl(e.target.value)}
          placeholder={DEFAULT_ANCHOR_URL}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white placeholder-slate-500 focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
        />
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Default: {DEFAULT_ANCHOR_URL} (public testnet anchor). Stored locally.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-slate-700 dark:text-slate-300">
          Asset
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
          >
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </label>
        <label className="block text-sm text-slate-700 dark:text-slate-300">
          Amount (withdraw)
          <input
            type="number"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10.00"
            className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-cosmos-900 text-slate-900 dark:text-white"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleFetchInfo}
          disabled={loading}
          className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
        >
          {loading ? "Loading…" : "Fetch anchor info"}
        </button>
        <button
          type="button"
          onClick={handleDeposit}
          className="px-4 py-2 bg-stellar-500 hover:bg-stellar-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Deposit →
        </button>
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={loading}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
        >
          Withdraw
        </button>
      </div>

      {info && (
        <details className="text-xs text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer text-stellar-400">Anchor info (SEP-0006)</summary>
          <pre className="mt-2 p-3 rounded-lg bg-black/30 overflow-auto max-h-48">
            {JSON.stringify(info, null, 2)}
          </pre>
        </details>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      {notice && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <p className="text-sm text-emerald-400">{notice}</p>
        </div>
      )}
    </div>
  );
}
