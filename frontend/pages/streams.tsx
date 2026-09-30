/**
 * pages/streams.tsx
 * Soroban streaming payment contract UI.
 * Allows users to open, view, claim, and close streaming payments.
 */

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/lib/useWallet";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLM } from "@/utils/format";
import { buildPaymentTransaction, submitTransaction, getXLMBalance, STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM } from "@/lib/stellar";

const STROOPS_PER_XLM = 10_000_000;

interface Stream {
  streamId: string;
  payer: string;
  recipient: string;
  ratePerHour: string; // XLM per hour
  deposit: string; // Total XLM deposited
  claimable: string; // XLM available to claim
  startTime: string;
  isActive: boolean;
}

interface NewStreamForm {
  recipient: string;
  ratePerHour: string; // XLM per hour
  deposit: string; // Total XLM to deposit
}

export default function StreamsPage() {
  const { publicKey } = useWallet();
  const [xlmBalance, setXlmBalance] = useState("0");
  const [activeTab, setActiveTab] = useState<"open" | "my-streams" | "received">("open");
  const [myStreams, setMyStreams] = useState<Stream[]>([]);
  const [receivedStreams, setReceivedStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // New stream form
  const [newStream, setNewStream] = useState<NewStreamForm>({
    recipient: "",
    ratePerHour: "",
    deposit: "",
  });

  // Load streams and wallet balance on mount
  const loadStreams = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      // In production, this would fetch from the backend
      // For now, using mock data
      setMyStreams([]);
      setReceivedStreams([]);
    } catch (err: any) {
      setError(err.message || "Failed to load streams");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    loadStreams();
    if (publicKey) {
      getXLMBalance(publicKey)
        .then(setXlmBalance)
        .catch(() => setXlmBalance("0"));
    }
  }, [publicKey, loadStreams]);

  const handleOpenStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;

    const ratePerHourNum = parseFloat(newStream.ratePerHour);
    const depositNum = parseFloat(newStream.deposit);

    if (!newStream.recipient || !ratePerHourNum || !depositNum) {
      setError("Please fill in all fields");
      return;
    }

    if (depositNum < ratePerHourNum) {
      setError("Deposit must be at least the hourly rate");
      return;
    }

    const availableBalance = parseFloat(xlmBalance) - STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM;
    if (depositNum > availableBalance) {
      setError("Insufficient balance");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // In production, this would build a Soroban transaction to create the stream
      // For now, we'll simulate with a regular payment
      const tx = await buildPaymentTransaction({
        fromPublicKey: publicKey,
        toPublicKey: newStream.recipient,
        amount: newStream.deposit,
        memo: `Stream: ${ratePerHourNum} XLM/hour`,
      });

      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) throw new Error(signError || "Signing failed");

      await submitTransaction(signedXDR);

      // Reset form
      setNewStream({ recipient: "", ratePerHour: "", deposit: "" });
      alert("Stream opened successfully!");
      loadStreams();
    } catch (err: any) {
      setError(err.message || "Failed to open stream");
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (streamId: string) => {
    if (!publicKey) return;

    setLoading(true);
    setError(null);

    try {
      // In production, this would call claim_stream on the Soroban contract
      alert(`Claimed stream ${streamId}`);
      loadStreams();
    } catch (err: any) {
      setError(err.message || "Failed to claim stream");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async (streamId: string) => {
    if (!publicKey) return;

    if (!confirm("Are you sure you want to close this stream? Any remaining funds will be refunded.")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // In production, this would call close_stream on the Soroban contract
      alert(`Closed stream ${streamId}`);
      loadStreams();
    } catch (err: any) {
      setError(err.message || "Failed to close stream");
    } finally {
      setLoading(false);
    }
  };

  const convertStroopsToXLM = (stroops: number): string => {
    return (stroops / STROOPS_PER_XLM).toFixed(7);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl font-bold text-white mb-2">Streaming Payments</h1>
      <p className="text-slate-400 mb-8">Open, view, claim, and close Soroban streaming payment contracts.</p>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-white/10 pb-4">
        <button
          onClick={() => setActiveTab("open")}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === "open"
              ? "bg-stellar-500/20 text-stellar-300"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          Open Stream
        </button>
        <button
          onClick={() => setActiveTab("my-streams")}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === "my-streams"
              ? "bg-stellar-500/20 text-stellar-300"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          My Streams
        </button>
        <button
          onClick={() => setActiveTab("received")}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === "received"
              ? "bg-stellar-500/20 text-stellar-300"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          Received Streams
        </button>
      </div>

      {/* Open Stream Tab */}
      {activeTab === "open" && (
        <div className="card max-w-2xl">
          <h2 className="font-display text-xl font-semibold text-white mb-6">Open New Stream</h2>
          <form onSubmit={handleOpenStream} className="space-y-5">
            <div>
              <label className="label">Recipient Address</label>
              <input
                type="text"
                value={newStream.recipient}
                onChange={(e) => setNewStream({ ...newStream, recipient: e.target.value })}
                placeholder="G..."
                className="input-field font-mono"
                disabled={loading}
              />
            </div>

            <div>
              <label className="label">Rate (XLM/hour)</label>
              <input
                type="number"
                step="0.0000001"
                min="0"
                value={newStream.ratePerHour}
                onChange={(e) => setNewStream({ ...newStream, ratePerHour: e.target.value })}
                placeholder="10.0"
                className="input-field"
                disabled={loading}
              />
              <p className="mt-2 text-xs text-slate-500">
                The recipient can claim this amount every hour.
              </p>
            </div>

            <div>
              <label className="label">Deposit Amount (XLM)</label>
              <input
                type="number"
                step="0.0000001"
                min="0"
                value={newStream.deposit}
                onChange={(e) => setNewStream({ ...newStream, deposit: e.target.value })}
                placeholder="100.0"
                className="input-field"
                disabled={loading}
              />
              <p className="mt-2 text-xs text-slate-500">
                Total XLM to deposit into the stream contract.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !publicKey}
              className="btn-primary w-full"
            >
              {loading ? "Opening Stream..." : "Open Stream"}
            </button>
          </form>
        </div>
      )}

      {/* My Streams Tab */}
      {activeTab === "my-streams" && (
        <div className="card">
          <h2 className="font-display text-xl font-semibold text-white mb-6">My Streams (Payer)</h2>
          {loading ? (
            <div className="text-center text-slate-400 py-8">Loading...</div>
          ) : myStreams.length === 0 ? (
            <div className="text-center text-slate-400 py-8">No active streams</div>
          ) : (
            <div className="space-y-4">
              {myStreams.map((stream) => (
                <div
                  key={stream.streamId}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="text-sm text-slate-400">Recipient</p>
                      <p className="font-mono text-sm text-white">{stream.recipient}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      stream.isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"
                    }`}>
                      {stream.isActive ? "Active" : "Closed"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-500">Rate</p>
                      <p className="text-sm font-medium text-white">{formatXLM(stream.ratePerHour)}/hr</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Deposit</p>
                      <p className="text-sm font-medium text-white">{formatXLM(stream.deposit)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Claimable</p>
                      <p className="text-sm font-medium text-stellar-300">{formatXLM(stream.claimable)}</p>
                    </div>
                  </div>
                  {stream.isActive && (
                    <button
                      onClick={() => handleClose(stream.streamId)}
                      disabled={loading}
                      className="btn-secondary w-full text-sm"
                    >
                      Close Stream
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Received Streams Tab */}
      {activeTab === "received" && (
        <div className="card">
          <h2 className="font-display text-xl font-semibold text-white mb-6">Received Streams</h2>
          {loading ? (
            <div className="text-center text-slate-400 py-8">Loading...</div>
          ) : receivedStreams.length === 0 ? (
            <div className="text-center text-slate-400 py-8">No received streams</div>
          ) : (
            <div className="space-y-4">
              {receivedStreams.map((stream) => (
                <div
                  key={stream.streamId}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="text-sm text-slate-400">Payer</p>
                      <p className="font-mono text-sm text-white">{stream.payer}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      stream.isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"
                    }`}>
                      {stream.isActive ? "Active" : "Closed"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-500">Rate</p>
                      <p className="text-sm font-medium text-white">{formatXLM(stream.ratePerHour)}/hr</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Total Deposit</p>
                      <p className="text-sm font-medium text-white">{formatXLM(stream.deposit)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Claimable</p>
                      <p className="text-sm font-medium text-stellar-300">{formatXLM(stream.claimable)}</p>
                    </div>
                  </div>
                  {stream.isActive && (
                    <button
                      onClick={() => handleClaim(stream.streamId)}
                      disabled={loading}
                      className="btn-primary w-full text-sm"
                    >
                      Claim {formatXLM(stream.claimable)}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
