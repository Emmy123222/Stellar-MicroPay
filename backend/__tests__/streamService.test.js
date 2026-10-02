/**
 * __tests__/streamService.test.js
 * #1066 — streamService: Soroban contract reads, missing-stream 404s,
 * accrual math (paused ledgers + funded-window cap), and validation.
 * Uses the real stellar-sdk XDR round-trip (nativeToScVal → scValToNative);
 * only the RPC server boundary is mocked.
 */
"use strict";

jest.mock("../src/config/soroban", () => ({
  server: {
    getContractData: jest.fn(),
    getLatestLedger: jest.fn(),
  },
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  CONTRACT_ID: "CCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTID",
  getContractId: jest.fn(() => "CCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTID"),
}));

const { nativeToScVal } = require("@stellar/stellar-sdk");
const { server, getContractId } = require("../src/config/soroban");
const {
  getStreamStatus,
  parseStreamId,
  computeClaimableNow,
  streamKeyScVal,
  StreamNotFoundError,
  ContractNotConfiguredError,
} = require("../src/services/streamService");

const PAYER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const RECIPIENT = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

// A contract Stream struct as scValToNative would decode it.
function makeStream(overrides = {}) {
  return {
    payer: PAYER,
    recipients: [{ recipient: RECIPIENT, weight: 1, claimed: "0" }],
    rate_per_ledger: "10",
    deposited: "1000",
    start_ledger: 100,
    token: "CBELLMICROPAYTOKENBELLMICROPAYTOKENBELLMICROPAYTOK",
    paused: false,
    paused_at_ledger: 0,
    paused_ledgers: 0,
    closed: false,
    ...overrides,
  };
}

/** Wrap a native struct in a real ScVal so scValToNative decodes it back. */
function contractEntry(stream) {
  return { key: streamKeyScVal(1), val: nativeToScVal(stream), expirationLedgerSeq: 1000 };
}

describe("streamService (#1066)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getContractId.mockReturnValue("CCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTID");
  });

  describe("parseStreamId", () => {
    it.each(["0", "1", "42", "4294967295", 7])("accepts valid u32 %p", (input) => {
      expect(parseStreamId(input)).toBe(Number(input));
    });

    it.each(["-1", "abc", "4294967296", "1.5", "", " 7", "007xyz", null, undefined])(
      "rejects invalid stream id %p with 400",
      (input) => {
        expect(() => parseStreamId(input)).toThrow(
          expect.objectContaining({ status: 400 })
        );
      }
    );
  });

  describe("computeClaimableNow", () => {
    it("computes rate × elapsed minus claimed across recipients", () => {
      const stream = makeStream({
        start_ledger: 100,
        recipients: [
          { recipient: PAYER, weight: 1, claimed: "30" },
          { recipient: RECIPIENT, weight: 1, claimed: "0" },
        ],
      });
      // 10 ledgers elapsed → 100 streamed − 30 claimed
      expect(computeClaimableNow(stream, 110)).toBe(70n);
    });

    it("caps accrual at the funded window (deposited / rate)", () => {
      const stream = makeStream({ start_ledger: 0, rate_per_ledger: "10", deposited: "100" });
      expect(computeClaimableNow(stream, 9999)).toBe(100n);
    });

    it("excludes paused ledgers (historical + in-progress pause)", () => {
      const stream = makeStream({
        start_ledger: 0,
        rate_per_ledger: "10",
        deposited: "1000000",
        paused: true,
        paused_at_ledger: 50,
        paused_ledgers: 20,
      });
      // elapsed = 100 − (20 + 50) = 30 → 300 streamed
      expect(computeClaimableNow(stream, 100)).toBe(300n);
    });

    it("returns 0n for a closed stream and for a zero rate", () => {
      expect(computeClaimableNow(makeStream({ closed: true }), 1000)).toBe(0n);
      expect(computeClaimableNow(makeStream({ rate_per_ledger: "0" }), 1000)).toBe(0n);
    });

    it("never returns a negative claimable amount", () => {
      const stream = makeStream({
        start_ledger: 0,
        rate_per_ledger: "10",
        deposited: "1000000",
        recipients: [{ recipient: PAYER, weight: 1, claimed: "999999" }],
      });
      expect(computeClaimableNow(stream, 50)).toBe(0n);
    });
  });

  describe("getStreamStatus", () => {
    it("throws ContractNotConfiguredError (503) when CONTRACT_ID is unset", async () => {
      getContractId.mockReturnValue("");

      await expect(getStreamStatus("1")).rejects.toBeInstanceOf(ContractNotConfiguredError);
      await expect(getStreamStatus("1")).rejects.toMatchObject({ status: 503 });
      expect(server.getContractData).not.toHaveBeenCalled();
    });

    it("reads contract data with a u32 Stream key and returns the mapped state", async () => {
      server.getContractData.mockResolvedValue(contractEntry(makeStream({ start_ledger: 100 })));
      server.getLatestLedger.mockResolvedValue({ sequence: 150 });

      const status = await getStreamStatus("1");

      const [calledContractId, calledKey, calledDurability] = server.getContractData.mock.calls[0];
      expect(calledContractId).toBe("CCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTIDCONTRACTID");
      expect(calledDurability).toBe("persistent");
      // DataKey::Stream(1) — key must round-trip to the exact same XDR
      expect(calledKey.toXDR("base64")).toBe(streamKeyScVal(1).toXDR("base64"));

      expect(status).toEqual({
        payer: PAYER,
        recipient: RECIPIENT,
        ratePerLedger: "10",
        deposited: "1000",
        claimed: "0",
        startLedger: 100,
        claimableNow: "500", // (150 − 100) × 10
      });
    });

    it("aggregates claimed across multiple weighted recipients", async () => {
      server.getContractData.mockResolvedValue(
        contractEntry(
          makeStream({
            recipients: [
              { recipient: PAYER, weight: 3, claimed: "40" },
              { recipient: RECIPIENT, weight: 1, claimed: "20" },
            ],
          })
        )
      );
      server.getLatestLedger.mockResolvedValue({ sequence: 110 });

      const status = await getStreamStatus("3");
      expect(status.claimed).toBe("60");
      expect(status.claimableNow).toBe("40"); // 100 streamed − 60 claimed
    });

    it("uses start_ledger for claimableNow when getLatestLedger fails", async () => {
      server.getContractData.mockResolvedValue(contractEntry(makeStream({ start_ledger: 100 })));
      server.getLatestLedger.mockRejectedValue(new Error("RPC down"));

      const status = await getStreamStatus("1");
      expect(status.claimableNow).toBe("0"); // 0 ledgers elapsed at start_ledger
    });

    it("returns recipient: null for a stream with no recipients", async () => {
      server.getContractData.mockResolvedValue(contractEntry(makeStream({ recipients: [] })));
      server.getLatestLedger.mockResolvedValue({ sequence: 100 });

      const status = await getStreamStatus("1");
      expect(status.recipient).toBeNull();
      expect(status.claimed).toBe("0");
    });

    it("throws StreamNotFoundError (404) when the contract entry is missing", async () => {
      server.getContractData.mockRejectedValue(new Error("Data for contract is missing"));

      await expect(getStreamStatus("999")).rejects.toBeInstanceOf(StreamNotFoundError);
      await expect(getStreamStatus("999")).rejects.toMatchObject({ status: 404 });
    });

    it("treats a void ScVal entry as not found (404)", async () => {
      server.getContractData.mockResolvedValue({
        key: streamKeyScVal(9),
        val: nativeToScVal(null),
        expirationLedgerSeq: 1000,
      });

      await expect(getStreamStatus("9")).rejects.toMatchObject({ status: 404 });
    });

    it("throws 400 for a malformed stream id before touching RPC", async () => {
      await expect(getStreamStatus("not-a-number")).rejects.toMatchObject({ status: 400 });
      expect(server.getContractData).not.toHaveBeenCalled();
    });

    it("propagates unexpected RPC transport errors", async () => {
      server.getContractData.mockRejectedValue(new Error("ECONNRESET"));

      await expect(getStreamStatus("1")).rejects.toThrow("ECONNRESET");
    });
  });
});
