/**
 * __tests__/CreatorTipsDashboard.test.tsx
 * Tests for the CSV export button and timeout/offline/unmount behavior on the
 * creator tips dashboard (#612).
 */

import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import CreatorTipsDashboard from "../components/CreatorTipsDashboard";
import { exportTipsToCSV } from "@/utils/format";

jest.mock("@/utils/format", () => ({
  ...jest.requireActual("@/utils/format"),
  exportTipsToCSV: jest.fn(),
}));

const mockTips = [
  {
    id: 1,
    senderPublicKey: "GABC123SENDERPUBLICKEY",
    creatorPublicKey: "GXYZ789CREATORPUBLICKEY",
    amount: "5.0000000",
    asset: "XLM",
    memo: "Great content!",
    txHash: "abc123",
    timestamp: "2026-07-20T10:00:00Z",
  },
];

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

describe("CreatorTipsDashboard CSV export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it("exports the currently visible tips when the export button is clicked", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          tips: mockTips,
          stats: {
            totalTips: 1,
            totalByAsset: { XLM: { count: 1, amount: "5.0000000" } },
            averageTip: "5.0000000",
            largestTip: "5.0000000",
            smallestTip: "5.0000000",
          },
        },
      }),
    });

    render(<CreatorTipsDashboard publicKey="GXYZ789CREATORPUBLICKEY" username="alice" />);

    const exportButton = await screen.findByText("Export CSV");
    await waitFor(() => {
      expect(exportButton.closest("button")).not.toBeDisabled();
    });

    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(exportTipsToCSV).toHaveBeenCalledWith(mockTips);
    });
  });

  it("disables the export button when there are no tips", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { tips: [], stats: null } }),
    });

    render(<CreatorTipsDashboard publicKey="GXYZ789CREATORPUBLICKEY" username="alice" />);

    const exportButton = await screen.findByText("Export CSV");
    expect(exportButton.closest("button")).toBeDisabled();
  });
});

describe("CreatorTipsDashboard timeout + offline error handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it("shows a timeout message when the request overruns its budget", async () => {
    jest.useFakeTimers();
    (fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          const onAbort = () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
            (init.signal as AbortSignal).removeEventListener("abort", onAbort);
          };
          (init.signal as AbortSignal).addEventListener("abort", onAbort);
        })
    );

    render(<CreatorTipsDashboard publicKey="GXYZ789CREATORPUBLICKEY" username="alice" />);

    await jest.advanceTimersByTimeAsync(10_000 + 1);

    await waitFor(() => {
      expect(
        screen.getByText("Loading tips timed out. Please try again.")
      ).toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it("shows an offline message when the request fails with a TypeError", async () => {
    (fetch as jest.Mock).mockRejectedValue(new TypeError("Failed to fetch"));

    render(<CreatorTipsDashboard publicKey="GXYZ789CREATORPUBLICKEY" username="alice" />);

    await waitFor(() => {
      expect(
        screen.getByText("You appear to be offline. Check your connection and try again.")
      ).toBeInTheDocument();
    });
  });
});

describe("CreatorTipsDashboard unmount cancellation", () => {
  it("aborts the in-flight request when the component unmounts", async () => {
    const { promise, resolve } = deferred();
    const abortSpy = jest.fn();
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      signal.addEventListener("abort", abortSpy);
      return promise;
    }) as jest.Mock;

    const { unmount } = render(
      <CreatorTipsDashboard publicKey="GXYZ789CREATORPUBLICKEY" username="alice" />
    );

    expect(abortSpy).not.toHaveBeenCalled();
    unmount();

    // The component aborts its AbortController on unmount.
    expect(abortSpy).toHaveBeenCalled();

    resolve({ ok: true, json: async () => ({ success: true, data: { tips: [], stats: null } }) });
    cleanup();
  });
});
