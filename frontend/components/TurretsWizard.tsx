/**
 * components/TurretsWizard.tsx
 * Step-by-step Turrets DCA / Stop-Loss setup wizard (Closes #1148).
 *
 * Steps:
 *  1. Choose strategy (DCA or Stop-Loss)
 *  2. Configure parameters (interval, amount, price threshold)
 *  3. Fund the turret signer address
 *  4. Deploy and activate
 *
 * Also lists active automations with status + last execution time.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/useWallet";
import {
  createDcaAutomation,
  createStopLossAutomation,
  getTurretSignerAddress,
  listTurretsFunctions,
  type TurretsDeployment,
} from "@/lib/turrets";

type Strategy = "dca" | "stop_loss";

export default function TurretsWizard() {
  const { publicKey } = useWallet();
  const [step, setStep] = useState(1);
  const [strategy, setStrategy] = useState<Strategy>("dca");

  // DCA params
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [amountQuote, setAmountQuote] = useState("10");

  // Stop-loss params
  const [thresholdPrice, setThresholdPrice] = useState("0.10");
  const [amountSell, setAmountSell] = useState("100");

  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<TurretsDeployment | null>(null);
  const [automations, setAutomations] = useState<TurretsDeployment[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const refreshAutomations = useCallback(async () => {
    if (!publicKey) {
      setAutomations([]);
      return;
    }
    setListLoading(true);
    try {
      const list = await listTurretsFunctions(publicKey);
      setAutomations(list);
    } catch {
      // listing is best-effort; keep previous list
    } finally {
      setListLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void refreshAutomations();
  }, [refreshAutomations]);

  useEffect(() => {
    // Pre-fetch the turret signer address so step 3 can render instantly.
    getTurretSignerAddress()
      .then(setSignerAddress)
      .catch(() => setSignerAddress(null));
  }, []);

  const handleDeploy = async () => {
    if (!publicKey) {
      setError("Connect your wallet to deploy an automation.");
      return;
    }
    setDeploying(true);
    setError(null);
    try {
      const result =
        strategy === "dca"
          ? await createDcaAutomation({
              ownerPublicKey: publicKey,
              intervalMinutes: Number(intervalMinutes),
              amountQuote: Number(amountQuote),
            })
          : await createStopLossAutomation({
              ownerPublicKey: publicKey,
              thresholdPrice: Number(thresholdPrice),
              amountSell: Number(amountSell),
            });
      if (result.turretSignerAddress) setSignerAddress(result.turretSignerAddress);
      setDeployed(result);
      setStep(4);
      await refreshAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed.");
    } finally {
      setDeploying(false);
    }
  };

  if (!publicKey) {
    return (
      <p className="text-sm text-slate-400">
        Connect your wallet to configure automations.
      </p>
    );
  }

  return (
    <div>
      {/* Step indicator */}
      <ol className="flex items-center gap-2 text-xs text-slate-400 mb-4" aria-label="Setup progress">
        {[1, 2, 3, 4].map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-semibold ${
                step >= s ? "bg-stellar-500 text-white" : "bg-white/10 text-slate-400"
              }`}
            >
              {s}
            </span>
            {s < 4 && <span className="w-6 h-px bg-white/10" />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-200">Choose strategy</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStrategy("dca")}
              className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                strategy === "dca"
                  ? "border-stellar-500 bg-stellar-500/10 text-stellar-300"
                  : "border-slate-600 text-slate-300 hover:border-slate-500"
              }`}
            >
              DCA
              <span className="block text-xs font-normal text-slate-400 mt-1">
                Buy XLM on a schedule
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStrategy("stop_loss")}
              className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                strategy === "stop_loss"
                  ? "border-stellar-500 bg-stellar-500/10 text-stellar-300"
                  : "border-slate-600 text-slate-300 hover:border-slate-500"
              }`}
            >
              Stop-Loss
              <span className="block text-xs font-normal text-slate-400 mt-1">
                Sell if price drops
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="w-full px-4 py-2 bg-stellar-500 hover:bg-stellar-600 text-white font-medium rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-200">Configure parameters</p>
          {strategy === "dca" ? (
            <>
              <label className="block text-sm text-slate-300">
                Interval (minutes)
                <input
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-600 rounded-lg bg-cosmos-900 text-white"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Amount per run (USDC quote)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={amountQuote}
                  onChange={(e) => setAmountQuote(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-600 rounded-lg bg-cosmos-900 text-white"
                />
              </label>
            </>
          ) : (
            <>
              <label className="block text-sm text-slate-300">
                Price threshold (USD)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={thresholdPrice}
                  onChange={(e) => setThresholdPrice(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-600 rounded-lg bg-cosmos-900 text-white"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Amount to sell (XLM)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={amountSell}
                  onChange={(e) => setAmountSell(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-600 rounded-lg bg-cosmos-900 text-white"
                />
              </label>
            </>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="flex-1 px-4 py-2 bg-stellar-500 hover:bg-stellar-600 text-white font-medium rounded-lg transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-200">Fund the turret signer address</p>
          <p className="text-xs text-slate-400">
            The turret submits scheduled transactions from this signer. Fund it with at
            least 3 XLM so it can cover reserves and fees.
          </p>
          {signerAddress ? (
            <p className="font-mono text-xs text-slate-200 break-all bg-white/5 border border-white/10 rounded-lg px-3 py-2">
              {signerAddress}
            </p>
          ) : (
            <p className="text-xs text-slate-500">Loading signer address…</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleDeploy}
              disabled={deploying}
              className="flex-1 px-4 py-2 bg-stellar-500 hover:bg-stellar-600 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
            >
              {deploying ? "Deploying…" : "Deploy and activate"}
            </button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <p className="text-sm text-emerald-300 font-medium">Automation active</p>
            {deployed && (
              <p className="text-xs text-slate-400 mt-1 font-mono break-all">
                {deployed.id} · {deployed.type} · {deployed.status}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setStep(1);
              setDeployed(null);
            }}
            className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Create another
          </button>
        </div>
      )}

      {/* Active automations */}
      <div className="mt-6 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-200">Active automations</h3>
          <button
            type="button"
            onClick={refreshAutomations}
            className="text-xs text-stellar-400 hover:text-stellar-300"
          >
            {listLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {automations.length === 0 ? (
          <p className="text-xs text-slate-500">No automations yet.</p>
        ) : (
          <ul className="space-y-2">
            {automations.map((a) => (
              <li
                key={a.id}
                className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex flex-col gap-1"
              >
                <span className="font-medium text-slate-200">
                  {a.type === "dca" ? "DCA" : "Stop-Loss"} · {a.status}
                </span>
                <span className="text-slate-400">
                  Last execution:{" "}
                  {a.lastExecutedAt ? new Date(a.lastExecutedAt).toLocaleString() : "never"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
