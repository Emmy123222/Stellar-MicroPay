import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import LiveEventsFeed, {
  buildEventsStreamUrl,
  mergeEvent,
} from "@/components/LiveEventsFeed";

const SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RECIPIENT = "GB62CUHQB72WRU3LZFL5BIXMQVQ22MJCDX4FZUBGBQH3PPPPS6INOCLV";

/** Minimal EventSource double that lets tests drive every callback. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];

  url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emitOpen() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  emitError(closed = false) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }

  static latest() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    type: "tip",
    participants: [SENDER, RECIPIENT],
    topics: ["tip"],
    amount: "1.5000000",
    asset: "XLM",
    ledger: 4844497,
    closedAt: new Date().toISOString(),
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    transactionHash: "abcdef1234567890",
    ...overrides,
  };
}

const originalEventSource = global.EventSource;

describe("LiveEventsFeed", () => {
  beforeEach(() => {
    FakeEventSource.reset();
    global.EventSource = FakeEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    global.EventSource = originalEventSource;
    jest.useRealTimers();
  });

  it("connects to the SSE endpoint and reports the live state", async () => {
    render(<LiveEventsFeed />);

    expect(screen.getByText("Connecting to the event stream…")).toBeInTheDocument();

    const source = FakeEventSource.latest();
    expect(source.url).toBe("/api/events/stream");

    act(() => source.emitOpen());

    expect(screen.getByRole("status")).toHaveTextContent("Live");
  });

  it("renders type, participants, amount and ledger for each event", async () => {
    render(<LiveEventsFeed />);
    const source = FakeEventSource.latest();

    act(() => {
      source.emitOpen();
      source.emitMessage({ kind: "event", event: makeEvent() });
    });

    expect(screen.getByText("Tip")).toBeInTheDocument();
    expect(
      screen.getByText("GAAAAA...AAAWHF → GB62CU...INOCLV")
    ).toBeInTheDocument();
    expect(screen.getByText("1.5 XLM")).toBeInTheDocument();
    expect(screen.getByText("Ledger #4,844,497")).toBeInTheDocument();
  });

  it("prepends new events so the newest is rendered first", async () => {
    render(<LiveEventsFeed />);
    const source = FakeEventSource.latest();

    act(() => {
      source.emitOpen();
      source.emitMessage({ kind: "event", event: makeEvent({ id: "evt-1" }) });
      source.emitMessage({
        kind: "event",
        event: makeEvent({ id: "evt-2", type: "claim" }),
      });
    });

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Claim");
    expect(rows[1]).toHaveTextContent("Tip");
  });

  it("ignores duplicate events", async () => {
    render(<LiveEventsFeed />);
    const source = FakeEventSource.latest();

    act(() => {
      source.emitOpen();
      source.emitMessage({ kind: "event", event: makeEvent({ id: "evt-1" }) });
      source.emitMessage({ kind: "event", event: makeEvent({ id: "evt-1" }) });
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("caps the list at the maxEvents prop", async () => {
    render(<LiveEventsFeed maxEvents={2} />);
    const source = FakeEventSource.latest();

    act(() => {
      source.emitOpen();
      for (let index = 1; index <= 4; index += 1) {
        source.emitMessage({
          kind: "event",
          event: makeEvent({ id: `evt-${index}` }),
        });
      }
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("surfaces backend status messages", async () => {
    render(<LiveEventsFeed />);
    const source = FakeEventSource.latest();

    act(() => {
      source.emitOpen();
      source.emitMessage({
        kind: "status",
        level: "error",
        message: "Event stream error: rpc unavailable",
      });
    });

    expect(screen.getByText(/rpc unavailable/)).toBeInTheDocument();
  });

  it("explains when the server has no contract configured", async () => {
    render(<LiveEventsFeed />);
    const source = FakeEventSource.latest();

    act(() => {
      source.emitMessage({
        kind: "ready",
        contractId: null,
        network: "testnet",
        configured: false,
        message: "CONTRACT_ID is not configured on the server, so no contract events can be streamed.",
      });
    });

    expect(screen.getByText(/CONTRACT_ID is not configured/)).toBeInTheDocument();
  });

  it("reconnects automatically with backoff when the connection drops", async () => {
    jest.useFakeTimers();
    render(<LiveEventsFeed />);

    const first = FakeEventSource.latest();
    act(() => first.emitOpen());
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => first.emitError(true));

    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");

    // First retry is scheduled 1s out.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest().url).toBe("/api/events/stream");
  });

  it("reconnects on demand from the Reconnect button", async () => {
    render(<LiveEventsFeed />);
    const source = FakeEventSource.latest();
    act(() => source.emitOpen());

    await userEvent.click(screen.getByRole("button", { name: /reconnect/i }));

    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(1);
    });
  });

  it("reports an unsupported browser when EventSource is unavailable", () => {
    // @ts-expect-error deliberately removing the global for this case
    delete global.EventSource;

    render(<LiveEventsFeed />);

    expect(
      screen.getByText(/does not support server-sent events/i)
    ).toBeInTheDocument();
  });
});

describe("LiveEventsFeed helpers", () => {
  it("builds the stream URL from an explicit base or the env var", () => {
    expect(buildEventsStreamUrl("https://api.example.com/")).toBe(
      "https://api.example.com/api/events/stream"
    );
  });

  it("keeps the newest events first and drops duplicates", () => {
    const first = makeEvent({ id: "a" }) as never;
    const second = makeEvent({ id: "b" }) as never;

    expect(mergeEvent([first], second, 5).map((e) => e.id)).toEqual(["b", "a"]);
    expect(mergeEvent([first], first, 5)).toEqual([first]);
  });
});
