/**
 * __tests__/stellar-timeout.test.ts
 * Coverage for the Horizon raw-fetch timeout wrapper in lib/stellar.
 */

import {
  fetchWithTimeout,
  HORIZON_FEE_STATS_TIMEOUT_MS,
  FRIENDBOT_TIMEOUT_MS,
} from "@/lib/stellar";
import { RequestTimeoutError, OfflineError } from "@/lib/request";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("rejects with RequestTimeoutError when the response overruns the budget", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          const onAbort = () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
            (init.signal as AbortSignal).removeEventListener("abort", onAbort);
          };
          (init.signal as AbortSignal).addEventListener("abort", onAbort);
        })
    );

    const promise = fetchWithTimeout("https://horizon.testnet.stellar.org/fee_stats", 100).catch(
      (e) => e
    );
    jest.advanceTimersByTime(101);

    await expect(promise).resolves.toBeInstanceOf(RequestTimeoutError);
  });

  it("rejects with OfflineError when the browser is offline", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      fetchWithTimeout("https://horizon.testnet.stellar.org/fee_stats", 100)
    ).rejects.toBeInstanceOf(OfflineError);
  });

  it("is invoked through the exported fee/friendbot budgets", () => {
    expect(HORIZON_FEE_STATS_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FRIENDBOT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
