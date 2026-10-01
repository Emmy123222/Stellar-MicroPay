/**
 * pages/scheduled-payments.tsx
 * UI for creating and managing recurring / scheduled payments via Turrets DCA.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/useWallet";
import WalletConnect from "@/components/WalletConnect";
import { isValidStellarAddress, USDC_ISSUER } from "@/lib/stellar";
import { shortenAddress } from "@/utils/format";
import {
  cancelTurretsFunction,
  createScheduledDcaPayment,
  listTurretsFunctions,
  pauseTurretsFunction,
  resumeTurretsFunction,
  type ScheduledFrequency,
  type TurretsDeployment,
} from "@/lib/turrets";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function isScheduledPayment(deployment: TurretsDeployment): boolean {
  return (
    deployment.type === "dca" &&
    (deployment.config?.paymentType === "scheduled_payment" ||
      typeof deployment.config?.recipient === "string")
  );
}

export default function ScheduledPaymentsPage() {
  const { publicKey } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"XLM" | "USDC">("XLM");
  const [frequency, setFrequency] = useState<ScheduledFrequency>("daily");
  const [payments, setPayments] = useState<TurretsDeployment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadPayments = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const deployments = await listTurretsFunctions(publicKey);
      setPayments(deployments.filter(isScheduledPayment));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scheduled payments");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;

    if (!isValidStellarAddress(recipient)) {
      setError("Enter a valid Stellar recipient address");
      return;
    }

    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount greater than zero");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await createScheduledDcaPayment({
        ownerPublicKey: publicKey,
        recipient,
        amount: amountNum,
        asset,
        assetIssuer: asset === "USDC" ? USDC_ISSUER : null,
        frequency,
      });
      setSuccess("Scheduled payment created");
      setRecipient("");
      setAmount("");
      await loadPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create scheduled payment");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async (id: string) => {
    setActionId(id);
    setError(null);
    try {
      await pauseTurretsFunction(id);
      await loadPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause payment");
    } finally {
      setActionId(null);
    }
  };

  const handleResume = async (id: string) => {
    setActionId(id);
    setError(null);
    try {
      await resumeTurretsFunction(id);
      await loadPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume payment");
    } finally {
      setActionId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionId(id);
    setError(null);
    try {
      await cancelTurretsFunction(id);
      await loadPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel payment");
    } finally {
      setActionId(null);
    }
  };

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h1 className="mb-3 font-display text-3xl font-bold text-white">Scheduled Payments</h1>
          <p className="text-slate-400">
            Connect your wallet to create and manage recurring payments.
          </p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <h1 className="mb-2 font-display text-3xl font-bold text-white">Scheduled Payments</h1>
        <p className="text-slate-400">
          Create recurring payments and manage active schedules (daily, weekly, or monthly).
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-display text-lg font-semibold text-white">Create recurring payment</h2>

          <div>
            <label className="label" htmlFor="recipient">
              Recipient
            </label>
            <input
              id="recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="G..."
              className="input-field font-mono text-sm"
            />
          </div>

          <div>
            <label className="label" htmlFor="amount">
              Amount
            </label>
            <div className="flex gap-2">
              <input
                id="amount"
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="input-field flex-1"
              />
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value as "XLM" | "USDC")}
                className="input-field w-28"
                aria-label="Asset"
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="frequency">
              Frequency
            </label>
            <select
              id="frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ScheduledFrequency)}
              className="input-field"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? "Creating…" : "Create scheduled payment"}
          </button>
        </form>

        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-white">Active schedules</h2>
            <button
              type="button"
              onClick={() => void loadPayments()}
              className="text-xs text-stellar-400 hover:text-stellar-300"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : payments.length === 0 ? (
            <p className="text-sm text-slate-500">No scheduled payments yet.</p>
          ) : (
            <div className="space-y-4">
              {payments.map((payment) => {
                const cfg = payment.config || {};
                const busy = actionId === payment.id;
                return (
                  <div
                    key={payment.id}
                    className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm text-white">
                          {shortenAddress(String(cfg.recipient || "—"), 8)}
                        </p>
                        <p className="text-sm text-slate-300">
                          {String(cfg.amountQuote ?? "—")} {String(cfg.quoteAssetCode ?? "")} ·{" "}
                          {String(cfg.frequency || "custom")}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          payment.status === "active"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {payment.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                      <div>
                        <p className="uppercase tracking-wide text-slate-500">Last execution</p>
                        <p className="text-slate-300">{formatTimestamp(payment.lastExecutedAt)}</p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide text-slate-500">Next run</p>
                        <p className="text-slate-300">{formatTimestamp(payment.nextRunAt)}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {payment.status === "active" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handlePause(payment.id)}
                          className="btn-secondary text-xs"
                        >
                          Pause
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleResume(payment.id)}
                          className="btn-secondary text-xs"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleCancel(payment.id)}
                        className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
