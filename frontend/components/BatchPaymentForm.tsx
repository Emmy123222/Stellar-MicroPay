import { useMemo, useRef, useState } from "react";
import {
  buildPaymentTransaction,
  isValidStellarAddress,
  STELLAR_MEMO_TEXT_MAX_BYTES,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM,
  submitTransaction,
  truncateMemoText,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLMPrecise, parseBatchRecipientsCSV } from "@/utils/format";

const MAX_RECIPIENTS = 10;

export type RecipientStatus = "idle" | "pending" | "success" | "failed";
export type ColumnErrorKey = "address" | "amount" | "memo";

export type BatchRecipient = {
  id: string;
  address: string;
  amount: string;
  memo: string;
  status: RecipientStatus;
  error?: string;
  fieldErrors?: Partial<Record<ColumnErrorKey, string>>;
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
  const [recipients, setRecipients] = useState<BatchRecipient[]>([
    createRecipient(),
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [showInvalidOnly, setShowInvalidOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const xlmBalanceValue = parseFloat(xlmBalance || "0");
  const availableXLM = Math.max(
    0,
    xlmBalanceValue - STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM
  );

  const totalXLM = useMemo(
    () =>
      recipients.reduce((sum, recipient) => {
        const amount = parseFloat(recipient.amount);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0),
    [recipients]
  );

  const invalidRecipients = recipients.filter(
    (recipient) => recipient.status === "failed" || Boolean(recipient.error)
  );
  const hasFailed = invalidRecipients.length > 0;
  const hasPending = recipients.some((recipient) => recipient.status === "pending");
  const hasSuccess = recipients.some((recipient) => recipient.status === "success");

  const canSubmit =
    !isProcessing &&
    recipients.some(
      (recipient) =>
        isValidStellarAddress(recipient.address) &&
        parseFloat(recipient.amount) > 0 &&
        recipient.address !== publicKey
    );
  const exceedsBalance = totalXLM > availableXLM;

  const updateRecipient = (
    id: string,
    update: Partial<BatchRecipient>
  ) => {
    setRecipients((current) =>
      current.map((recipient) => {
        if (recipient.id !== id) return recipient;
        const updated = { ...recipient, ...update };

        // If user edited a field with errors, clear that field error to keep valid edits intact (#744)
        if (updated.fieldErrors) {
          const nextFieldErrors = { ...updated.fieldErrors };
          if ("address" in update) delete nextFieldErrors.address;
          if ("amount" in update) delete nextFieldErrors.amount;
          if ("memo" in update) delete nextFieldErrors.memo;

          const remainingKeys = Object.keys(nextFieldErrors) as ColumnErrorKey[];
          if (remainingKeys.length === 0) {
            updated.fieldErrors = undefined;
            updated.error = undefined;
            if (updated.status === "failed") updated.status = "idle";
          } else {
            updated.fieldErrors = nextFieldErrors;
            updated.error =
              nextFieldErrors.address ||
              nextFieldErrors.amount ||
              nextFieldErrors.memo;
          }
        } else if (updated.status === "failed") {
          updated.status = "idle";
          updated.error = undefined;
        }

        return updated;
      })
    );
  };

  const handleAddRecipient = () => {
    if (recipients.length >= MAX_RECIPIENTS) return;
    setRecipients((current) => [...current, createRecipient()]);
    setBatchMessage(null);
  };

  const handleRemoveRecipient = (id: string) => {
    setRecipients((current) => current.filter((recipient) => recipient.id !== id));
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
      const fieldErrors: Partial<Record<ColumnErrorKey, string>> = {};
      let error = row.error ?? null;

      if (!isValidStellarAddress(row.address)) {
        fieldErrors.address = "Invalid Stellar address.";
        if (!error) error = "Invalid Stellar address.";
      } else if (row.address === publicKey) {
        fieldErrors.address = "Recipient address cannot be the same as your wallet.";
        if (!error) error = "Recipient address cannot be the same as your wallet.";
      }

      const parsedAmount = parseFloat(row.amount);
      if (!row.amount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        fieldErrors.amount = row.error?.includes("Amount")
          ? row.error
          : "Amount must be a number greater than 0.";
        if (!error) error = fieldErrors.amount;
      }

      return createRecipient({
        address: row.address,
        amount: row.amount,
        memo: truncateMemoText(row.memo),
        status: error ? "failed" : "idle",
        error: error ?? undefined,
        fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
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
      parts.push(`${skipped} extra row${skipped === 1 ? "" : "s"} skipped (max ${MAX_RECIPIENTS}).`);
    }
    setImportMessage(parts.join(" "));
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImportMessage(null);

    try {
      importRecipientsFromCSV(await readFileAsText(file));
    } catch (err: unknown) {
      setImportMessage(
        err instanceof Error ? err.message : "Could not read the selected file."
      );
    }
  };

  const validateRecipient = (recipient: BatchRecipient) => {
    const fieldErrors: Partial<Record<ColumnErrorKey, string>> = {};
    const amount = parseFloat(recipient.amount);

    if (!recipient.address.trim()) {
      fieldErrors.address = "Recipient address is required.";
    } else if (!isValidStellarAddress(recipient.address)) {
      fieldErrors.address = "Invalid Stellar address.";
    } else if (recipient.address === publicKey) {
      fieldErrors.address = "Recipient address cannot be the same as your wallet.";
    }

    if (!recipient.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      fieldErrors.amount = "Amount must be greater than 0.";
    }

    if (recipient.memo) {
      const encoded = new TextEncoder().encode(recipient.memo);
      if (encoded.length > STELLAR_MEMO_TEXT_MAX_BYTES) {
        fieldErrors.memo = `Memo exceeds maximum ${STELLAR_MEMO_TEXT_MAX_BYTES} bytes.`;
      }
    }

    const primaryError =
      fieldErrors.address || fieldErrors.amount || fieldErrors.memo || null;

    return {
      isValid: !primaryError,
      error: primaryError,
      fieldErrors,
    };
  };

  const processRows = async (retryOnlyFailed = false) => {
    setBatchMessage(null);
    setIsProcessing(true);

    let nextRecipients = recipients.map((recipient) => ({ ...recipient }));
    setRecipients(nextRecipients);

    for (const recipient of nextRecipients) {
      if (recipient.status === "success") {
        continue;
      }
      if (retryOnlyFailed && recipient.status !== "failed" && !recipient.error) {
        continue;
      }

      const { isValid, error, fieldErrors } = validateRecipient(recipient);
      if (!isValid) {
        recipient.status = "failed";
        recipient.error = error || undefined;
        recipient.fieldErrors = fieldErrors;
        setRecipients([...nextRecipients]);
        continue;
      }

      recipient.status = "pending";
      recipient.error = undefined;
      recipient.fieldErrors = undefined;
      setRecipients([...nextRecipients]);

      try {
        const tx = await buildPaymentTransaction({
          fromPublicKey: publicKey,
          toPublicKey: recipient.address,
          amount: parseFloat(recipient.amount).toFixed(7),
          memo: recipient.memo.trim() || undefined,
        });

        const { signedXDR, error: signError } =
          await signTransactionWithWallet(tx.toXDR());

        if (signError || !signedXDR) {
          recipient.status = "failed";
          recipient.error = signError || "Transaction signing was rejected.";
          setRecipients([...nextRecipients]);
          continue;
        }

        const result = await submitTransaction(signedXDR);

        recipient.status = "success";
        recipient.error = undefined;
        recipient.fieldErrors = undefined;
        recipient.transactionHash = result.hash;
        setRecipients([...nextRecipients]);

        onBatchSuccess?.();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Batch payment failed.";
        recipient.status = "failed";
        recipient.error = message;
        setRecipients([...nextRecipients]);
      }
    }

    setIsProcessing(false);
    const failedRows = nextRecipients.some((recipient) => recipient.status === "failed");
    const successRows = nextRecipients.some((recipient) => recipient.status === "success");

    if (!failedRows) {
      setBatchMessage("Batch payment complete.");
    } else if (successRows) {
      setBatchMessage(
        "Batch completed with some failures. Retry individual failed payments below."
      );
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
  const displayedRecipients = showInvalidOnly ? invalidRecipients : recipients;

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Batch Send
          </h2>
          <p className="text-sm text-slate-400">
            Send XLM to up to {MAX_RECIPIENTS} recipients sequentially.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Import CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportFile}
            disabled={isProcessing}
            aria-label="Import recipients from CSV"
            className="hidden"
          />
          <div className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
            {recipientCount} / {MAX_RECIPIENTS}
          </div>
        </div>
      </div>

      <p className="-mt-4 mb-4 text-xs text-slate-500">
        CSV columns: address, amount, memo (header row optional).
      </p>

      {/* Row Filtering Controls (#744) */}
      {hasFailed && (
        <div className="mb-4 flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/10">
          <span className="text-xs text-slate-300 font-medium">
            Filter rows:
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowInvalidOnly(false)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition ${
                !showInvalidOnly
                  ? "bg-stellar-500 text-white"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
              aria-pressed={!showInvalidOnly}
            >
              All ({recipients.length})
            </button>
            <button
              type="button"
              onClick={() => setShowInvalidOnly(true)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition ${
                showInvalidOnly
                  ? "bg-rose-500 text-white"
                  : "bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20"
              }`}
              aria-pressed={showInvalidOnly}
              aria-label="Filter to invalid rows"
            >
              Invalid only ({invalidRecipients.length})
            </button>
          </div>
        </div>
      )}

      {importMessage && (
        <div className="mb-4 rounded-2xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-sm text-slate-200">
          {importMessage}
        </div>
      )}

      <div className="space-y-4">
        {showInvalidOnly && displayedRecipients.length === 0 ? (
          <div className="p-6 text-center rounded-3xl border border-white/10 bg-white/5 text-sm text-slate-300">
            All invalid rows have been resolved!
            <button
              type="button"
              onClick={() => setShowInvalidOnly(false)}
              className="ml-2 text-stellar-400 hover:underline font-medium"
            >
              Show all rows ({recipients.length})
            </button>
          </div>
        ) : (
          displayedRecipients.map((recipient) => {
            const rowIndex = recipients.findIndex((r) => r.id === recipient.id);
            const rowNumber = rowIndex + 1;

            return (
              <div
                key={recipient.id}
                data-testid={`recipient-row-${rowNumber}`}
                className={`rounded-3xl border p-4 transition ${
                  recipient.status === "failed" || recipient.error
                    ? "border-rose-500/30 bg-rose-500/5"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                    <span>Row #{rowNumber}</span>
                    {recipient.status === "failed" && (
                      <span className="text-rose-400">Needs attention</span>
                    )}
                  </div>

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
                        aria-invalid={Boolean(recipient.fieldErrors?.address)}
                        aria-label={`Row ${rowNumber} Recipient address`}
                        className={`input-field w-full ${
                          recipient.fieldErrors?.address ? "border-rose-500/50" : ""
                        }`}
                        placeholder="G..."
                      />
                      {recipient.fieldErrors?.address && (
                        <p
                          role="alert"
                          data-testid={`row-${rowNumber}-address-error`}
                          className="mt-1 text-xs text-rose-400"
                        >
                          Row {rowNumber} (Address): {recipient.fieldErrors.address}
                        </p>
                      )}
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
                        aria-invalid={Boolean(recipient.fieldErrors?.amount)}
                        aria-label={`Row ${rowNumber} Amount (XLM)`}
                        className={`input-field w-full ${
                          recipient.fieldErrors?.amount ? "border-rose-500/50" : ""
                        }`}
                        placeholder="0.5"
                      />
                      {recipient.fieldErrors?.amount && (
                        <p
                          role="alert"
                          data-testid={`row-${rowNumber}-amount-error`}
                          className="mt-1 text-xs text-rose-400"
                        >
                          Row {rowNumber} (Amount): {recipient.fieldErrors.amount}
                        </p>
                      )}
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
                      aria-invalid={Boolean(recipient.fieldErrors?.memo)}
                      aria-label={`Row ${rowNumber} Memo`}
                      className={`input-field w-full ${
                        recipient.fieldErrors?.memo ? "border-rose-500/50" : ""
                      }`}
                      placeholder="Payment note"
                      maxLength={STELLAR_MEMO_TEXT_MAX_BYTES}
                    />
                    {recipient.fieldErrors?.memo && (
                      <p
                        role="alert"
                        data-testid={`row-${rowNumber}-memo-error`}
                        className="mt-1 text-xs text-rose-400"
                      >
                        Row {rowNumber} (Memo): {recipient.fieldErrors.memo}
                      </p>
                    )}
                  </label>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-slate-300">
                      Status:{" "}
                      {recipient.status === "idle" && (
                        <span className="text-slate-400">Waiting</span>
                      )}
                      {recipient.status === "pending" && (
                        <span className="text-amber-300">Processing</span>
                      )}
                      {recipient.status === "success" && (
                        <span className="text-emerald-400">Sent ✓</span>
                      )}
                      {recipient.status === "failed" && (
                        <span className="text-rose-400">Failed</span>
                      )}
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
                    <div
                      role="alert"
                      className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-100"
                    >
                      {recipient.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-center">
          <button
            type="button"
            onClick={handleAddRecipient}
            disabled={isProcessing || recipients.length >= MAX_RECIPIENTS}
            className="btn-secondary w-full py-2.5"
          >
            Add recipient
          </button>
          <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            Total: <span className="font-semibold text-white">{formatXLMPrecise(totalXLM)}</span>
          </div>
        </div>

        {exceedsBalance ? (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-100">
            Total exceeds your available XLM balance after reserve.
          </div>
        ) : null}

        {batchMessage && (
          <div className="rounded-2xl bg-slate-800/70 border border-slate-700 px-4 py-3 text-sm text-slate-200">
            {batchMessage}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleSendBatch}
            disabled={!canSubmit || isProcessing || exceedsBalance}
            className="btn-primary w-full sm:w-auto py-2.5"
          >
            {isProcessing ? "Sending batch..." : "Send batch"}
          </button>
          <button
            type="button"
            onClick={handleRetryFailed}
            disabled={!hasFailed || isProcessing}
            className="btn-outline w-full sm:w-auto py-2.5"
          >
            Retry failed payments
          </button>
        </div>
      </div>
    </div>
  );
}
