/**
 * __tests__/events.test.js
 * Tests for the Soroban contract event stream (SSE).
 */

"use strict";

const { nativeToScVal, scValToNative } = require("@stellar/stellar-sdk");

const eventsRouter = require("../src/routes/events");
const eventStreamService = require("../src/services/eventStreamService");

const CONTRACT_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RECIPIENT = "GB62CUHQB72WRU3LZFL5BIXMQVQ22MJCDX4FZUBGBQH3PPPPS6INOCLV";

/** Grab the `/stream` handler out of the router without binding a socket. */
function getStreamHandler() {
  const layer = eventsRouter.stack.find(
    (entry) => entry.route && entry.route.path === "/stream"
  );
  return layer.route.stack[0].handle;
}

/** Minimal req/res doubles good enough for an SSE handler. */
function createSseHarness(query = {}) {
  const chunks = [];
  const reqListeners = {};
  const resListeners = {};

  const res = {
    headers: {},
    statusCode: null,
    headersFlushed: false,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(headers) {
      Object.assign(this.headers, headers);
      return this;
    },
    flushHeaders() {
      this.headersFlushed = true;
    },
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    },
    on(event, handler) {
      resListeners[event] = handler;
      return this;
    },
  };

  const req = {
    query,
    on(event, handler) {
      reqListeners[event] = handler;
      return this;
    },
  };

  return {
    req,
    res,
    chunks,
    reqListeners,
    resListeners,
    envelopes: () =>
      chunks
        .filter((chunk) => chunk.startsWith("data: "))
        .map((chunk) => JSON.parse(chunk.slice("data: ".length))),
    close() {
      reqListeners.close?.();
    },
  };
}

/** Build a raw RPC event shaped like `SorobanRpc.Api.EventResponse`. */
function makeRawEvent(overrides = {}) {
  return {
    id: "0000000042-0000000001",
    type: "contract",
    ledger: 42,
    ledgerClosedAt: "2026-09-24T10:35:22Z",
    contractId: CONTRACT_ID,
    pagingToken: "0000000042-0000000001",
    txHash: "abc123",
    inSuccessfulContractCall: true,
    topic: [
      nativeToScVal("tip", { type: "symbol" }),
      nativeToScVal(SENDER, { type: "address" }),
      nativeToScVal(RECIPIENT, { type: "address" }),
    ],
    value: nativeToScVal(15_000_000n, { type: "i128" }),
    ...overrides,
  };
}

describe("eventStreamService", () => {
  const originalContractId = process.env.CONTRACT_ID;

  afterEach(() => {
    if (originalContractId === undefined) {
      delete process.env.CONTRACT_ID;
    } else {
      process.env.CONTRACT_ID = originalContractId;
    }
  });

  describe("getEventStreamConfig", () => {
    it("is unconfigured when no contract ID is set", () => {
      delete process.env.CONTRACT_ID;
      delete process.env.SOROBAN_CONTRACT_ID;
      delete process.env.NEXT_PUBLIC_CONTRACT_ID;

      const config = eventStreamService.getEventStreamConfig();

      expect(config.configured).toBe(false);
      expect(config.contractId).toBe("");
      expect(config.rpcUrl).toMatch(/^https:\/\//);
    });

    it("reports the contract from CONTRACT_ID when set", () => {
      process.env.CONTRACT_ID = CONTRACT_ID;

      const config = eventStreamService.getEventStreamConfig();

      expect(config.configured).toBe(true);
      expect(config.contractId).toBe(CONTRACT_ID);
    });
  });

  describe("mapEventType", () => {
    it("maps known contract symbols onto canonical types", () => {
      expect(eventStreamService.mapEventType("tip")).toBe("tip");
      expect(eventStreamService.mapEventType("receipt")).toBe("receipt");
      expect(eventStreamService.mapEventType("open")).toBe("open");
      expect(eventStreamService.mapEventType("claim")).toBe("claim");
      expect(eventStreamService.mapEventType("close")).toBe("close");
    });

    it("normalises aliases and separators", () => {
      expect(eventStreamService.mapEventType("TOPUP")).toBe("top_up");
      expect(eventStreamService.mapEventType("top-up")).toBe("top_up");
      expect(eventStreamService.mapEventType("send_tip")).toBe("tip");
    });

    it("falls back to the raw symbol for unknown events", () => {
      expect(eventStreamService.mapEventType("SomethingWeird")).toBe(
        "somethingweird"
      );
      expect(eventStreamService.mapEventType(undefined)).toBe("unknown");
    });
  });

  describe("normalizeContractEvent", () => {
    it("flattens type, participants, amount and ledger", () => {
      const event = eventStreamService.normalizeContractEvent(makeRawEvent());

      expect(event).toMatchObject({
        id: "0000000042-0000000001",
        type: "tip",
        participants: [SENDER, RECIPIENT],
        amount: "1.5000000",
        asset: "XLM",
        ledger: 42,
        closedAt: "2026-09-24T10:35:22Z",
        contractId: CONTRACT_ID,
        transactionHash: "abc123",
      });
      expect(event.rawValue).toBe("15000000");
    });

    it("keeps non-address topics as labels instead of participants", () => {
      const event = eventStreamService.normalizeContractEvent(
        makeRawEvent({
          topic: [
            nativeToScVal("open", { type: "symbol" }),
            nativeToScVal("promo", { type: "symbol" }),
            nativeToScVal(RECIPIENT, { type: "address" }),
          ],
        })
      );

      expect(event.type).toBe("open");
      expect(event.participants).toEqual([RECIPIENT]);
      expect(event.topicLabels).toEqual(["promo"]);
    });

    it("leaves amount null when the value is not a number", () => {
      const event = eventStreamService.normalizeContractEvent(
        makeRawEvent({ value: nativeToScVal("not-a-number", { type: "symbol" }) })
      );

      expect(event.amount).toBeNull();
      expect(event.asset).toBeNull();
    });

    it("tolerates malformed events without throwing", () => {
      const event = eventStreamService.normalizeContractEvent({});

      expect(event.type).toBe("unknown");
      expect(event.participants).toEqual([]);
      expect(event.ledger).toBe(0);
      expect(event.amount).toBeNull();
    });
  });

  describe("fetchContractEvents", () => {
    it("filters by contract and forwards the cursor", async () => {
      const getEvents = jest.fn().mockResolvedValue({
        events: [makeRawEvent()],
        latestLedger: 100,
        cursor: "cursor-1",
      });

      const page = await eventStreamService.fetchContractEvents({
        contractId: CONTRACT_ID,
        cursor: "previous",
        server: { getEvents },
      });

      expect(getEvents).toHaveBeenCalledWith({
        filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
        limit: 100,
        cursor: "previous",
      });
      expect(page.cursor).toBe("cursor-1");
      expect(page.events).toHaveLength(1);
    });

    it("uses startLedger on the first poll", async () => {
      const getEvents = jest.fn().mockResolvedValue({
        events: [],
        latestLedger: 100,
        cursor: null,
      });

      await eventStreamService.fetchContractEvents({
        contractId: CONTRACT_ID,
        startLedger: 90,
        server: { getEvents },
      });

      expect(getEvents).toHaveBeenCalledWith({
        filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
        limit: 100,
        startLedger: 90,
      });
    });

    it("does not call RPC when no contract is configured", async () => {
      const getEvents = jest.fn();

      const page = await eventStreamService.fetchContractEvents({
        contractId: "",
        server: { getEvents },
      });

      expect(getEvents).not.toHaveBeenCalled();
      expect(page.events).toEqual([]);
    });
  });
});

describe("GET /api/events/stream", () => {
  const handler = getStreamHandler();
  const originalContractId = process.env.CONTRACT_ID;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.CONTRACT_ID = CONTRACT_ID;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalContractId === undefined) {
      delete process.env.CONTRACT_ID;
    } else {
      process.env.CONTRACT_ID = originalContractId;
    }
  });

  it("opens an event-stream with SSE headers and a ready envelope", async () => {
    jest.spyOn(eventStreamService, "fetchLatestLedger").mockResolvedValue(1000);
    jest.spyOn(eventStreamService, "fetchContractEvents").mockResolvedValue({
      events: [],
      latestLedger: 1000,
      cursor: "cursor-1",
    });

    const harness = createSseHarness();
    handler(harness.req, harness.res);
    await jest.advanceTimersByTimeAsync(0);

    expect(harness.res.statusCode).toBe(200);
    expect(harness.res.headers["Content-Type"]).toMatch(/text\/event-stream/);
    expect(harness.res.headers["Cache-Control"]).toMatch(/no-cache/);
    expect(harness.res.headersFlushed).toBe(true);
    expect(harness.chunks[0]).toBe("retry: 3000\n\n");

    const ready = harness.envelopes()[0];
    expect(ready.kind).toBe("ready");
    expect(ready.contractId).toBe(CONTRACT_ID);
    expect(ready.configured).toBe(true);

    harness.close();
  });

  it("pushes a normalised envelope per contract event", async () => {
    jest.spyOn(eventStreamService, "fetchLatestLedger").mockResolvedValue(1000);
    jest
      .spyOn(eventStreamService, "fetchContractEvents")
      .mockResolvedValue({
        events: [makeRawEvent(), makeRawEvent({ id: "evt-2", ledger: 43 })],
        latestLedger: 1000,
        cursor: "cursor-2",
      });

    const harness = createSseHarness();
    handler(harness.req, harness.res);
    await jest.advanceTimersByTimeAsync(0);

    const events = harness.envelopes().filter((item) => item.kind === "event");
    expect(events).toHaveLength(2);
    expect(events[0].event.type).toBe("tip");
    expect(events[0].event.amount).toBe("1.5000000");
    expect(events[1].event.id).toBe("evt-2");
    expect(events[1].event.ledger).toBe(43);

    harness.close();
  });

  it("starts the first poll from the recent ledger window", async () => {
    jest.spyOn(eventStreamService, "fetchLatestLedger").mockResolvedValue(1000);
    const fetchSpy = jest
      .spyOn(eventStreamService, "fetchContractEvents")
      .mockResolvedValue({ events: [], latestLedger: 1000, cursor: "c" });

    const harness = createSseHarness();
    handler(harness.req, harness.res);
    await jest.advanceTimersByTimeAsync(0);

    const config = eventStreamService.getEventStreamConfig();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 1000 - config.ledgerLookback })
    );

    harness.close();
  });

  it("reports RPC failures as a status envelope without closing the stream", async () => {
    jest.spyOn(eventStreamService, "fetchLatestLedger").mockResolvedValue(1000);
    jest
      .spyOn(eventStreamService, "fetchContractEvents")
      .mockRejectedValue(new Error("rpc unavailable"));

    const harness = createSseHarness();
    handler(harness.req, harness.res);
    await jest.advanceTimersByTimeAsync(0);

    const status = harness.envelopes().find((item) => item.kind === "status");
    expect(status.level).toBe("error");
    expect(status.message).toMatch(/rpc unavailable/);
    expect(harness.res.ended).toBe(false);

    harness.close();
  });

  it("sends heartbeats while idle", async () => {
    jest.spyOn(eventStreamService, "fetchLatestLedger").mockResolvedValue(1000);
    jest
      .spyOn(eventStreamService, "fetchContractEvents")
      .mockResolvedValue({ events: [], latestLedger: 1000, cursor: "c" });

    const harness = createSseHarness();
    handler(harness.req, harness.res);
    await jest.advanceTimersByTimeAsync(0);

    await jest.advanceTimersByTimeAsync(15000);

    expect(harness.chunks.some((chunk) => chunk.includes(": heartbeat"))).toBe(
      true
    );

    harness.close();
  });

  it("stops polling and ends the response when the client disconnects", async () => {
    jest.spyOn(eventStreamService, "fetchLatestLedger").mockResolvedValue(1000);
    const fetchSpy = jest
      .spyOn(eventStreamService, "fetchContractEvents")
      .mockResolvedValue({ events: [], latestLedger: 1000, cursor: "c" });

    const harness = createSseHarness();
    handler(harness.req, harness.res);
    await jest.advanceTimersByTimeAsync(0);

    const callsBeforeClose = fetchSpy.mock.calls.length;

    harness.close();
    await jest.advanceTimersByTimeAsync(30000);

    expect(fetchSpy.mock.calls.length).toBe(callsBeforeClose);
    expect(harness.res.ended).toBe(true);
  });

  it("explains on the stream when no contract ID is configured", async () => {
    delete process.env.CONTRACT_ID;
    delete process.env.SOROBAN_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_CONTRACT_ID;

    const fetchSpy = jest.spyOn(eventStreamService, "fetchContractEvents");

    const harness = createSseHarness();
    handler(harness.req, harness.res);
    await jest.advanceTimersByTimeAsync(0);

    const ready = harness.envelopes()[0];
    expect(ready.kind).toBe("ready");
    expect(ready.configured).toBe(false);
    expect(ready.message).toMatch(/CONTRACT_ID is not configured/);
    expect(fetchSpy).not.toHaveBeenCalled();

    harness.close();
  });
});
