/**
 * __tests__/request-timeout.test.ts
 * Coverage for AbortController timeout + error classification used by the
 * frontend API and Horizon request layers.
 */

import {
  createTimeoutController,
  classifyFetchError,
  RequestTimeoutError,
  RequestAbortedError,
  OfflineError,
} from "@/lib/request";
import { apiFetch, API_TIMEOUT_MS } from "@/lib/api";

describe("createTimeoutController", () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("aborts and reports a timeout after the budget elapses", () => {
    const { controller, cleanup, wasTimeout } = createTimeoutController(100);
    expect(controller.signal.aborted).toBe(false);

    jest.advanceTimersByTime(101);
    expect(controller.signal.aborted).toBe(true);
    expect(wasTimeout()).toBe(true);

    cleanup();
  });

  it("aborts immediately when the external signal is already aborted (not a timeout)", () => {
    const external = new AbortController();
    external.abort();
    const { controller, cleanup, wasTimeout } = createTimeoutController(100, external.signal);
    expect(controller.signal.aborted).toBe(true);
    expect(wasTimeout()).toBe(false);
    cleanup();
  });

  it("aborts when a not-yet-aborted external signal fires (not a timeout)", () => {
    const external = new AbortController();
    const { controller, cleanup, wasTimeout } = createTimeoutController(100, external.signal);
    external.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(wasTimeout()).toBe(false);
    cleanup();
  });
});

describe("classifyFetchError", () => {
  it("maps an abort to a timeout when the budget fired", () => {
    const err = classifyFetchError(new DOMException("aborted", "AbortError"), true, true);
    expect(err).toBeInstanceOf(RequestTimeoutError);
  });

  it("maps an abort to a cancelled request when a signal fired", () => {
    const err = classifyFetchError(new DOMException("aborted", "AbortError"), true, false);
    expect(err).toBeInstanceOf(RequestAbortedError);
  });

  it("maps a network TypeError to an offline error", () => {
    const err = classifyFetchError(new TypeError("Failed to fetch"), false, false);
    expect(err).toBeInstanceOf(OfflineError);
  });

  it("leaves unrelated errors untouched", () => {
    const original = new Error("boom");
    expect(classifyFetchError(original, false, false)).toBe(original);
  });
});

describe("apiFetch timeout + error classification", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("rejects with RequestTimeoutError when the request overruns its budget", async () => {
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

    const promise = apiFetch("/slow").catch((e) => e);
    jest.advanceTimersByTime(API_TIMEOUT_MS + 1);

    const err = await promise;
    expect(err).toBeInstanceOf(RequestTimeoutError);
  });

  it("rejects with OfflineError when fetch rejects with a TypeError", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiFetch("/offline")).rejects.toBeInstanceOf(OfflineError);
  });

  it("aborts when an external signal is passed and fired", async () => {
    const external = new AbortController();
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

    const promise = apiFetch("/cancelled", { signal: external.signal }).catch((e) => e);
    external.abort();
    const err = await promise;
    expect(err).toBeInstanceOf(RequestAbortedError);
  });

  it("still returns parsed data on success", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { hello: "world" } }),
    });

    const data = await apiFetch<{ hello: string }>("/ok");
    expect(data).toEqual({ hello: "world" });
  });
});
