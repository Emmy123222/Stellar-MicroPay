import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import Network from "@/pages/network";

const mockFetchNetworkMetrics = jest.fn();

jest.mock("@/lib/stellar", () => ({
  fetchNetworkMetrics: (...args: unknown[]) => mockFetchNetworkMetrics(...args),
}));

function makeMetrics(overrides: Record<string, unknown> = {}) {
  return {
    latestLedgerSequence: 4844497,
    lastLedgerCloseTime: "2026-09-24T10:35:22Z",
    ledgerCloseLagSeconds: 4,
    baseFeeXlm: 0.00001,
    recommendedFeeXlm: 0.0007403,
    feeP95Xlm: 0.0071246,
    feeP99Xlm: 0.4988467,
    feeLevel: "elevated",
    activeAccounts: 42,
    activeAccountsLedger: 4844497,
    operationsPerSecond: 12.5,
    sampledLedgerCount: 10,
    horizonLatencyMs: 187,
    feeStatsLatencyMs: 92,
    protocolVersion: 28,
    horizonVersion: "28.0.1-a70eb47",
    coreVersion: "stellar-core 29.0.0",
    networkPassphrase: "Test SDF Network ; September 2015",
    ...overrides,
  };
}

describe("Network status page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchNetworkMetrics.mockResolvedValue(makeMetrics());
  });

  it("shows a Connecting… skeleton on first load", () => {
    mockFetchNetworkMetrics.mockReturnValue(new Promise(() => {}));

    render(<Network />);

    const skeleton = screen.getByRole("status");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("renders every metric in a table with labelled units", async () => {
    render(<Network />);

    expect(await screen.findByRole("table")).toBeInTheDocument();

    // Ledger sequence appears in the ticker and in the metrics table.
    expect((await screen.findAllByText("#4,844,497")).length).toBeGreaterThan(0);

    // Units are rendered as their own labelled cells.
    expect(screen.getByText("sequence number")).toBeInTheDocument();
    expect(screen.getAllByText("XLM").length).toBe(4);
    expect(screen.getByText("accounts")).toBeInTheDocument();
    expect(screen.getByText("ops/s")).toBeInTheDocument();
    expect(screen.getAllByText("milliseconds")).toHaveLength(2);
    expect(screen.getByText("2026-09-24 10:35:22 UTC")).toBeInTheDocument();
  });

  it("labels the row/column header structure for assistive technology", async () => {
    render(<Network />);

    await screen.findByRole("table");

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Metric", "Value", "Unit"]);

    // Each metric name is a row header, so screen readers can pair it with its value.
    expect(
      screen.getByRole("rowheader", { name: /Latest ledger/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("rowheader", { name: /Active accounts/i })
    ).toBeInTheDocument();
  });

  it("refreshes automatically every 10 seconds", async () => {
    const setIntervalSpy = jest.spyOn(window, "setInterval");

    render(<Network />);
    await screen.findByRole("table");

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    setIntervalSpy.mockRestore();
  });

  it("renders Unavailable for metrics Horizon could not supply", async () => {
    mockFetchNetworkMetrics.mockResolvedValue(
      makeMetrics({ activeAccounts: null, operationsPerSecond: null })
    );

    render(<Network />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  });

  it("shows an error state with a working retry when the first load fails", async () => {
    mockFetchNetworkMetrics.mockRejectedValueOnce(new Error("Horizon is down"));
    mockFetchNetworkMetrics.mockResolvedValueOnce(makeMetrics());

    render(<Network />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Horizon is down");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });
  });

  it("keeps the last good snapshot visible when a background refresh fails", async () => {
    const setIntervalSpy = jest.spyOn(window, "setInterval");

    mockFetchNetworkMetrics.mockResolvedValueOnce(makeMetrics());
    mockFetchNetworkMetrics.mockRejectedValueOnce(new Error("socket closed"));

    render(<Network />);
    await screen.findByRole("table");

    const refresh = setIntervalSpy.mock.calls[0][0] as () => Promise<void>;

    await act(async () => {
      await refresh();
    });

    // The stale snapshot stays on screen and the failure is surfaced inline.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText(/#4,844,497/).length).toBeGreaterThan(0);
    expect(screen.getByText(/refresh failed/i)).toBeInTheDocument();

    setIntervalSpy.mockRestore();
  });
});
