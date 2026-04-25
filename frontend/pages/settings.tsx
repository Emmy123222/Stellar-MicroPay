/**
 * pages/settings.tsx
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
      </div>
    );
  }

  return (
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
