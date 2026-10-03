"use strict";

const { SorobanRpc } = require("@stellar/stellar-sdk");

const rpc = new SorobanRpc.Server(
  process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org"
);
const pollMs = Number(process.env.EVENT_POLL_INTERVAL_MS || 5000);

async function stream(req, res) {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  let closed = false;
  let nextLedger = Number(req.query.startLedger || 0) || undefined;
  const contractId = process.env.CONTRACT_ID || process.env.NEXT_PUBLIC_CONTRACT_ID;
  const send = (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  send("ready", { contractId: contractId || null });

  const poll = async () => {
    if (closed || !contractId) return;
    try {
      const latest = await rpc.getLatestLedger();
      const startLedger = nextLedger || Math.max(1, latest.sequence - 1);
      const result = await rpc.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
        limit: 100,
      });
      for (const event of result.events || []) send("contract-event", event);
      nextLedger = (result.latestLedger || latest.sequence) + 1;
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : "Event poll failed" });
    }
  };

  const timer = setInterval(() => void poll(), pollMs);
  void poll();
  req.on("close", () => {
    closed = true;
    clearInterval(timer);
  });
}

module.exports = { stream };
