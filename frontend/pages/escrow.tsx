/**
 * pages/escrow.tsx
 * Soroban time-locked escrow (issue #213).
 *
 * Create — sender locks XLM into the contract until release_ledger.
 * Claim  — recipient pulls the funds once release_ledger has elapsed.
 * Cancel — sender pulls the funds back, but only before release_ledger.
 */
import { useState, useEffect } from "react";
import WalletConnect from "@/components/WalletConnect";
import { useWallet } from "@/lib/useWallet";
import {
  buildCreateEscrowTransaction,
  buildClaimEscrowTransaction,
  buildCancelEscrowTransaction,
  getEscrow,
  getCurrentLedger,
  submitTransaction,
  isValidStellarAddress,
  getXLMBalance,
  CONTRACT_ID,
  EscrowRecord,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; escrow: EscrowRecord; currentLedger: number }
  | { kind: "missing" };

export default function EscrowPage() {
  const { publicKey } = useWallet();

  // Create-escrow form state.
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [releaseLedger, setReleaseLedger] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [xlmBalance, setXlmBalance] = useState("0");
  const [latestLedger, setLatestLedger] = useState<number | null>(null);

  // Manage-escrow (claim / cancel) state.
  const [lookupId, setLookupId] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<null | "claim" | "cancel">(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!publicKey) return;
      try {
        const [bal, ledger] = await Promise.all([
          getXLMBalance(publicKey),
          getCurrentLedger(),
        ]);
        if (cancelled) return;
        setXlmBalance(bal);
        setLatestLedger(ledger);
      } catch {
        // Non-fatal — the user can still type values manually.
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const isCreateDisabled = (() => {
    if (!publicKey) return true;
    if (!isValidStellarAddress(recipient)) return true;
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return true;
    const parsedLedger = parseInt(releaseLedger, 10);
    if (!Number.isFinite(parsedLedger)) return true;
    if (latestLedger !== null && parsedLedger <= latestLedger) return true;
    return creating;
  })();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) return;
    setCreating(true);
    setCreateError(null);
    setCreatedId(null);
    try {
      const tx = await buildCreateEscrowTransaction({
        fromPublicKey: publicKey,
        toPublicKey: recipient,
        amount,
        releaseLedger: parseInt(releaseLedger, 10),
      });
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) {
        throw new Error(signError || "Transaction signing was rejected.");
      }
      const result = await submitTransaction(signedXDR);
      // The contract returns the new escrow id as the call return value.
      // Horizon attaches it under result_meta_xdr; we surface it best-effort.
      const returned = (result as any)?.returnValue;
      const id = typeof returned === "number" ? returned : null;
      setCreatedId(id);
      setRecipient("");
      setAmount("");
      setReleaseLedger("");
    } catch (err: any) {
      setCreateError(err?.message ?? "Failed to create escrow.");
    } finally {
      setCreating(false);
    }
  }

  async function handleLookup() {
    if (!publicKey) return;
    const id = parseInt(lookupId, 10);
    if (!Number.isFinite(id) || id < 0) {
      setActionError("Enter a non-negative escrow id.");
      return;
    }
    setLookup({ kind: "loading" });
    setActionError(null);
    try {
      const [escrow, ledger] = await Promise.all([
        getEscrow(publicKey, id),
        getCurrentLedger(),
      ]);
      if (!escrow) {
        setLookup({ kind: "missing" });
        return;
      }
      setLookup({ kind: "found", escrow, currentLedger: ledger });
    } catch (err: any) {
      setActionError(err?.message ?? "Lookup failed.");
      setLookup({ kind: "idle" });
    }
  }

  async function handleAction(action: "claim" | "cancel") {
    if (!publicKey || lookup.kind !== "found") return;
    setActionPending(action);
    setActionError(null);
    try {
      const builder = action === "claim"
        ? buildClaimEscrowTransaction
        : buildCancelEscrowTransaction;
      const tx = await builder(publicKey, lookup.escrow.id);
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) {
        throw new Error(signError || "Transaction signing was rejected.");
      }
      await submitTransaction(signedXDR);
      // Refresh the cached escrow so the UI reflects the new status.
      await handleLookup();
    } catch (err: any) {
      setActionError(err?.message ?? `Failed to ${action} escrow.`);
    } finally {
      setActionPending(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-2xl font-semibold">Escrow payments</h1>
      <p className="mb-6 text-sm text-gray-600">
        Lock XLM until a future ledger. Recipient claims on or after the
        release ledger; sender can cancel any time before it.
      </p>

      {!CONTRACT_ID && (
        <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          <strong>NEXT_PUBLIC_CONTRACT_ID</strong> is not configured. Escrow
          calls will fail until a deployed contract id is wired in.
        </div>
      )}

      {!publicKey ? (
        <WalletConnect />
      ) : (
        <>
          <section className="mb-8 rounded-lg border border-gray-200 p-4">
            <h2 className="mb-3 text-lg font-medium">Create escrow</h2>
            <p className="mb-3 text-xs text-gray-500">
              Balance: {xlmBalance} XLM
              {latestLedger !== null && (
                <> · Current ledger: {latestLedger.toLocaleString()}</>
              )}
            </p>
            <form onSubmit={handleCreate} className="space-y-3">
              <label className="block text-sm">
                Recipient address
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="G..."
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs"
                />
              </label>
              <label className="block text-sm">
                Amount (XLM)
                <input
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Release ledger
                <input
                  type="number"
                  min="0"
                  value={releaseLedger}
                  onChange={(e) => setReleaseLedger(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                />
                <span className="mt-1 block text-xs text-gray-500">
                  Stellar ledgers close ~5s apart. For a ~1 hour lock,
                  add ~720 to the current ledger.
                </span>
              </label>
              {createError && (
                <p className="text-sm text-red-600">{createError}</p>
              )}
              {createdId !== null && (
                <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">
                  Escrow created. Note the id from the transaction return
                  value to claim or cancel later.
                </p>
              )}
              <button
                type="submit"
                disabled={isCreateDisabled}
                className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-300"
              >
                {creating ? "Locking funds…" : "Lock funds in escrow"}
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-gray-200 p-4">
            <h2 className="mb-3 text-lg font-medium">Claim or cancel</h2>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                placeholder="Escrow id"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                className="flex-1 rounded border border-gray-300 px-3 py-2"
              />
              <button
                type="button"
                onClick={handleLookup}
                disabled={lookup.kind === "loading"}
                className="rounded bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200 disabled:opacity-50"
              >
                Look up
              </button>
            </div>

            {lookup.kind === "missing" && (
              <p className="mt-3 text-sm text-gray-600">
                No escrow with that id, or the contract returned an error.
              </p>
            )}

            {lookup.kind === "found" && (
              <div className="mt-4 space-y-2 text-sm">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                  <dt className="text-gray-500">Status</dt>
                  <dd>{lookup.escrow.status}</dd>
                  <dt className="text-gray-500">From</dt>
                  <dd className="font-mono text-xs break-all">{lookup.escrow.from}</dd>
                  <dt className="text-gray-500">To</dt>
                  <dd className="font-mono text-xs break-all">{lookup.escrow.to}</dd>
                  <dt className="text-gray-500">Amount</dt>
                  <dd>{lookup.escrow.amount} stroops</dd>
                  <dt className="text-gray-500">Release ledger</dt>
                  <dd>{lookup.escrow.releaseLedger.toLocaleString()}</dd>
                  <dt className="text-gray-500">Current ledger</dt>
                  <dd>{lookup.currentLedger.toLocaleString()}</dd>
                </dl>

                {lookup.escrow.status === "Pending" && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleAction("claim")}
                      disabled={
                        actionPending !== null ||
                        lookup.currentLedger < lookup.escrow.releaseLedger ||
                        publicKey !== lookup.escrow.to
                      }
                      title={
                        publicKey !== lookup.escrow.to
                          ? "Only the recipient can claim"
                          : lookup.currentLedger < lookup.escrow.releaseLedger
                            ? "Release ledger not reached"
                            : ""
                      }
                      className="rounded bg-green-600 px-4 py-2 text-sm text-white disabled:bg-gray-300"
                    >
                      {actionPending === "claim" ? "Claiming…" : "Claim"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction("cancel")}
                      disabled={
                        actionPending !== null ||
                        lookup.currentLedger >= lookup.escrow.releaseLedger ||
                        publicKey !== lookup.escrow.from
                      }
                      title={
                        publicKey !== lookup.escrow.from
                          ? "Only the sender can cancel"
                          : lookup.currentLedger >= lookup.escrow.releaseLedger
                            ? "Release ledger already reached"
                            : ""
                      }
                      className="rounded bg-red-600 px-4 py-2 text-sm text-white disabled:bg-gray-300"
                    >
                      {actionPending === "cancel" ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {actionError && (
              <p className="mt-3 text-sm text-red-600">{actionError}</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
