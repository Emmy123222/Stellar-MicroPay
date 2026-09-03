import { useMemo, useRef, useState } from "react";

import {
  buildPaymentTransaction,
  isValidStellarAddress,
  STELLAR_MEMO_TEXT_MAX_BYTES,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM,
  submitTransaction,
  truncateMemoText,
  MAX_BATCH_RECIPIENTS,
  MAX_BATCH_TOTAL_XLM,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLMPrecise, parseBatchRecipientsCSV } from "@/utils/format";

const MAX_RECIPIENTS = MAX_BATCH_RECIPIENTS;

type RecipientStatus = "idle" | "pending" | "success" | "failed";

type BatchRecipient = {
  id: string;
  address: string;
  amount: string;
  memo: string;
  status: RecipientStatus;
  error?: string;
  transactionHash?: string;
};

interface BatchPaymentFormProps {
  publicKey: string;
  xlmBalance: string;
  onBatchSuccess?: () => void;
}

function createRecipient(overrides: Partial<BatchRecipient> = {}): BatchRecipient {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    address: "",
    amount: "",
    memo: "",
    status: "idle",
    ...overrides,
  };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

export default function BatchPaymentForm({
  publicKey,
  xlmBalance,
  onBatchSuccess,
}: BatchPaymentFormProps) {
  const [recipients, setRecipients] = useState<BatchRecipient[]>([createRecipient()]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const xlmBalanceValue = parseFloat(xlmBalance || "0");
  const availableXLM = Math.max(0, xlmBalanceValue - STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM);

  const totalXLM = useMemo(
    () =>
      recipients.reduce((sum, recipient) => {
        const amount = parseFloat(recipient.amount);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0),
    [recipients]
  );

  const hasFailed = recipients.some((recipient) => recipient.status === "failed");
  const hasPending = recipients.some((recipient) => recipient.status === "pending");
  const hasSuccess = recipients.some((recipient) => recipient.status === "success");
  const canSubmit =
    !isProcessing &&
    !exceedsAggregateLimit &&
    !exceedsBalance &&
    recipients.some(
      (recipient) =>
        isValidStellarAddress(recipient.address) &&
        parseFloat(recipient.amount) > 0 &&
        recipient.address !== publicKey
    );

  const updateRecipient = (id: string, update: Partial<BatchRecipient>) => {
    setRecipients((current) =>
      current.map((recipient) => (recipient.id === id ? { ...recipient, ...update } : recipient))
    );
  };

  const handleAddRecipient = () => {
    if (recipients.length >= MAX_RECIPIENTS) return;
    const nextRowNumber = recipients.length + 1;
    setRecipients((current) => [...current, createRecipient()]);
    setRowAnnouncement(`Recipient row ${nextRowNumber} inserted.`);
    setBatchMessage(null);
  };

  const handleRemoveRecipient = (id: string) => {
    const rowIndex = recipients.findIndex((recipient) => recipient.id === id);
    const rowNumber = rowIndex + 1;
    setRecipients((current) => current.filter((recipient) => recipient.id !== id));
    if (rowIndex >= 0) {
      setRowAnnouncement(`Recipient row ${rowNumber} removed.`);
    }
    setBatchMessage(null);
  };

  const importRecipientsFromCSV = (csv: string) => {
    const rows = parseBatchRecipientsCSV(csv);

    if (rows.length === 0) {
      setImportMessage("No recipients found in that CSV file.");
      return;
    }

    const accepted = rows.slice(0, MAX_RECIPIENTS);
    const skipped = rows.length - accepted.length;

    const imported = accepted.map((row) => {
      // A row can be malformed (missing/invalid columns) or structurally fine
      // but still unusable — flag either way instead of dropping the row.
      const error =
        row.error ??
        (!isValidStellarAddress(row.address)
          ? "Invalid Stellar address."
          : row.address === publicKey
            ? "Recipient address cannot be the same as your wallet."
            : null);

      return createRecipient({
        address: row.address,
        amount: row.amount,
        memo: truncateMemoText(row.memo),
        status: error ? "failed" : "idle",
        error: error ?? undefined,
      });
    });

    setRecipients(imported);
    setBatchMessage(null);

    const invalidCount = imported.filter((recipient) => recipient.status === "failed").length;
    const validCount = imported.length - invalidCount;

    const parts = [`Imported ${validCount} recipient${validCount === 1 ? "" : "s"}.`];
    if (invalidCount > 0) {
      parts.push(
        `${invalidCount} row${invalidCount === 1 ? "" : "s"} need attention — see the errors below.`
      );
    }
    if (skipped > 0) {
      parts.push(
        `${skipped} extra row${skipped === 1 ? "" : "s"} skipped (max ${MAX_RECIPIENTS}).`
      );
    }
    setImportMessage(parts.join(" "));
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the input so re-picking the same file fires another change event.
    event.target.value = "";
    if (!file) return;
    try {
      importRecipientsFromCSV(await readFileAsText(file));
    } catch (err: unknown) {
      setImportMessage(err instanceof Error ? err.message : "Could not read the selected file.");
    }
  };

  const validateRecipient = (recipient: BatchRecipient) => {
    const amount = parseFloat(recipient.amount);
    if (!isValidStellarAddress(recipient.address)) {
      return "Invalid Stellar address.";
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return "Amount must be greater than 0.";
    }
    if (recipient.address === publicKey) {
      return "Recipient address cannot be the same as your wallet.";
    }
    return null;
  };

    setIsProcessing(true);
    setBatchMessage(null);

    let nextRecipients = recipients.map((recipient) => ({ ...recipient }));
    setRecipients(nextRecipients);

    for (const recipient of nextRecipients) {
      if (recipient.status === "success") {
        continue;
      }
      if (retryOnlyFailed && recipient.status !== "failed") {
        continue;
      }

      const validationError = validateRecipient(recipient);
      if (validationError) {
        recipient.status = "failed";
        recipient.error = validationError;
        setRecipients([...nextRecipients]);
        continue;
      }

      recipient.status = "pending";
      recipient.error = undefined;
      setRecipients([...nextRecipients]);

      try {
        const tx = await buildPaymentTransaction({
          fromPublicKey: publicKey,
          toPublicKey: recipient.address,
          amount: parseFloat(recipient.amount).toFixed(7),
          memo: recipient.memo.trim() || undefined,
        });

        const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());

        if (signError || !signedXDR) {
          recipient.status = "failed";
          recipient.error = signError || "Transaction signing was rejected.";
          setRecipients([...nextRecipients]);
          continue;
        }

        const result = await submitTransaction(signedXDR);

        recipient.status = "success";
        recipient.error = undefined;
        recipient.transactionHash = result.hash;
        setRecipients([...nextRecipients]);

        onBatchSuccess?.();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Batch payment failed.";
        recipient.status = "failed";
        recipient.error = message;
        setRecipients([...nextRecipients]);
      }

      const result = await submitTransaction(signedXDR);
      setBatchMessage(`Batch transaction submitted successfully! Hash: ${result.hash}`);
      if (onBatchSuccess) onBatchSuccess();
    } catch (err) {
      setBatchMessage(`Batch failed: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendBatch = async () => {
    await processRows(false);
  };

  const handleRetryFailed = async () => {
    if (!hasFailed) return;
    await processRows(true);
  };

  const recipientCount = recipients.length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white max-w-2xl mx-auto shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Batch Send</h2>
          <p className="text-sm text-slate-400">
            Send XLM to up to {MAX_RECIPIENTS} recipients sequentially.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded-lg transition"
          >
            Import CSV
          </button>
        </div>
      </div>

      <p className="-mt-4 mb-4 text-xs text-slate-500">
        CSV columns: address, amount, memo (header row optional).
      </p>

      {importMessage && (
        <div className="mb-4 p-3 bg-slate-800/80 border border-slate-700 text-xs rounded-lg text-slate-300">
          {importMessage}
        </div>
      )}

      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="batch-recipient-row-announcements"
      >
        {rowAnnouncement}
      </div>

      <div className="space-y-4">
        {recipients.map((recipient, index) => (
          <div key={recipient.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Recipient address</span>
                  <input
                    type="text"
                    value={recipient.address}
                    onChange={(event) =>
                      updateRecipient(recipient.id, {
                        address: event.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="input-field w-full"
                    placeholder="G..."
                  />
                </label>
                <label className="block">
                  <span className="label">Amount (XLM)</span>
                  <input
                    type="number"
                    step="0.0000001"
                    min="0"
                    value={recipient.amount}
                    onChange={(event) =>
                      updateRecipient(recipient.id, {
                        amount: event.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="input-field w-full"
                    placeholder="0.5"
                  />
                </label>
              </div>

              <label className="block">
                <span className="label">Memo (optional)</span>
                <input
                  type="text"
                  value={recipient.memo}
                  onChange={(event) =>
                    updateRecipient(recipient.id, {
                      memo: truncateMemoText(event.target.value),
                    })
                  }
                  disabled={isProcessing}
                  className="input-field w-full"
                  placeholder="Payment note"
                  maxLength={STELLAR_MEMO_TEXT_MAX_BYTES}
                />
              </label>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-300">
                  Status:
                  {recipient.status === "idle" && <span className="text-slate-400">Waiting</span>}
                  {recipient.status === "pending" && (
                    <span className="text-amber-300">Processing</span>
                  )}
                  {recipient.status === "success" && (
                    <span className="text-emerald-400">Sent ✓</span>
                  )}
                  {recipient.status === "failed" && <span className="text-rose-400">Failed</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRemoveRecipient(recipient.id)}
                    disabled={isProcessing || recipients.length <= 1}
                    className="text-xs text-slate-400 hover:text-white disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {recipient.error && (
                <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-100">
                  {recipient.error}
                </div>
              )}
            </div>
          </div>
        ))}

      <div className="flex justify-between items-center mb-6">
        <button
          type="button"
          onClick={handleAddRecipient}
          disabled={recipients.length >= MAX_RECIPIENTS}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold rounded-lg transition"
        >
          Add recipient ({recipients.length} / {MAX_RECIPIENTS})
        </button>
        <div className="text-right text-xs">
          <span className="text-slate-400">Total: </span>
          <span className={`font-bold ${exceedsAggregateLimit || exceedsBalance ? "text-red-400" : "text-white"}`}>
            {totalXLM.toFixed(7)} XLM
          </span>
        </div>
      </div>

      {exceedsAggregateLimit && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-xs text-red-400 rounded-lg">
          Aggregate payment amount exceeds the maximum limit of {MAX_BATCH_TOTAL_XLM} XLM.
        </div>
      )}

      {exceedsBalance && !exceedsAggregateLimit && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-xs text-red-400 rounded-lg">
          Total batch amount exceeds available XLM balance ({availableXLM.toFixed(7)} XLM).
        </div>
      )}

      {batchMessage && (
        <div className="mb-4 p-3 bg-slate-800 border border-slate-700 text-xs rounded-lg text-slate-200">
          {batchMessage}
        </div>
      )}

      <button
        type="button"
        onClick={handleProcessBatch}
        disabled={!canSubmit}
        className="w-full py-3 bg-stellar-600 hover:bg-stellar-500 disabled:opacity-50 text-white font-semibold rounded-xl transition"
      >
        {isProcessing ? "Processing Batch..." : "Send batch"}
      </button>
    </div>
  );
}
