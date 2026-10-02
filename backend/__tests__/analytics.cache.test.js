/**
 * __tests__/analytics.cache.test.js
 * Integration tests for the Redis-backed analytics cache (#1072).
 *
 * Verifies cache hit/miss behaviour through the full withCache → Redis
 * path and the in-memory fallback when Redis is unavailable.
 */

"use strict";

// Mock the `redis` package before any module that requires it is loaded.
// Jest hoists `jest.mock` calls above all imports/requires, so the factory
// is in place before cache.js runs its constructor.
// `redis` is an optional dependency, so it is not guaranteed to be installed
// in CI. Marking the mock virtual lets this suite exercise the cache without
// the real driver being present.
jest.mock(
  "redis",
  () => {
    const store = new Map();
    const mockClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(),
      get: jest.fn((key) => Promise.resolve(store.get(key) || null)),
      setEx: jest.fn((key, ttl, value) => {
        store.set(key, value);
        return Promise.resolve("OK");
      }),
      del: jest.fn((keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => store.delete(k));
        return Promise.resolve(arr.length);
      }),
      keys: jest.fn((pattern) => {
        const prefix = pattern.replace(/\*$/, "");
        const matches = [...store.keys()].filter((k) => k.startsWith(prefix));
        return Promise.resolve(matches);
      }),
    };

    return {
      createClient: jest.fn(() => mockClient),
      __mockClient: mockClient,
      __store: store,
    };
  },
  { virtual: true }
);

// Mock the Stellar service so analytics functions do not hit the network.
jest.mock("../src/services/stellarService");

// Ensure REDIS_URL is set so cache.js picks the Redis path at load time.
process.env.REDIS_URL = "redis://localhost:6379";
process.env.ANALYTICS_CACHE_TTL_MS = "300000";

const analyticsService = require("../src/services/analyticsService");
const stellarService = require("../src/services/stellarService");
const cache = require("../src/services/cache");
const redisModule = require("redis");

const testPublicKey = "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW";

const mockPayments = [
  {
    id: "1",
    type: "sent",
    amount: "100",
    asset: "XLM",
    from: testPublicKey,
    to: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYGJ2DN5ZKQYTROZXNUAAOXWS7",
    memo: "memo1",
    createdAt: "2024-01-01T12:00:00Z",
    transactionHash: "hash1",
    pagingToken: "token1",
  },
  {
    id: "2",
    type: "sent",
    amount: "50",
    asset: "XLM",
    from: testPublicKey,
    to: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYGJ2DN5ZKQYTROZXNUAAOXWS7",
    memo: "memo2",
    createdAt: "2024-01-02T12:00:00Z",
    transactionHash: "hash2",
    pagingToken: "token2",
  },
];

describe("Analytics Cache - Redis Integration (#1072)", () => {
  /**
   * Allow the async Redis `connect()` promise inside cache.js to settle
   * before assertions run.
   */
  beforeAll(async () => {
    const deadline = Date.now() + 500;
    while (!cache.isUsingRedis() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  beforeEach(() => {
    redisModule.__store.clear();
    redisModule.__mockClient.get.mockClear();
    redisModule.__mockClient.setEx.mockClear();
    redisModule.__mockClient.del.mockClear();
    redisModule.__mockClient.keys.mockClear();
    stellarService.getPayments.mockReset();
    stellarService.getPayments.mockResolvedValue(mockPayments);

    // Clear cache for the test public key.
    return analyticsService.clearCache(testPublicKey);
  });

  afterAll(() => {
    delete process.env.REDIS_URL;
    delete process.env.ANALYTICS_CACHE_TTL_MS;
  });

  it("should use Redis when REDIS_URL is configured", async () => {
    expect(cache.isUsingRedis()).toBe(true);
    expect(redisModule.createClient).toHaveBeenCalledWith({
      url: "redis://localhost:6379",
    });
  });

  it("cache miss on first call fetches from stellarService and stores in Redis", async () => {
    const result = await analyticsService.getSummary(testPublicKey);

    // stellarService.getPayments called exactly once (cache miss)
    expect(stellarService.getPayments).toHaveBeenCalledTimes(1);

    // Redis GET was attempted for the cache key
    expect(redisModule.__mockClient.get).toHaveBeenCalledWith(
      `summary:${testPublicKey}`
    );

    // Redis SETEX was called to store the result
    expect(redisModule.__mockClient.setEx).toHaveBeenCalledTimes(1);
    const [key, ttlSeconds] = redisModule.__mockClient.setEx.mock.calls[0];
    expect(key).toBe(`summary:${testPublicKey}`);
    // TTL should be 300 seconds (5 minutes)
    expect(ttlSeconds).toBe(300);

    // Result has expected shape
    expect(result.publicKey).toBe(testPublicKey);
    expect(result.totalSentXLM).toBe("150.0000000");
  });

  it("cache hit on second call returns cached data without hitting stellarService", async () => {
    // First call — cache miss
    const result1 = await analyticsService.getSummary(testPublicKey);
    expect(stellarService.getPayments).toHaveBeenCalledTimes(1);

    // Second call — cache hit
    const result2 = await analyticsService.getSummary(testPublicKey);
    expect(stellarService.getPayments).toHaveBeenCalledTimes(1); // still 1, not 2
    expect(redisModule.__mockClient.get).toHaveBeenCalledTimes(2);
    expect(redisModule.__mockClient.setEx).toHaveBeenCalledTimes(1); // not called again
    expect(result1).toEqual(result2);
  });

  it("clearCache removes entries from Redis", async () => {
    await analyticsService.getSummary(testPublicKey);
    expect(stellarService.getPayments).toHaveBeenCalledTimes(1);

    // Clear the cache
    await analyticsService.clearCache(testPublicKey);

    // Verify Redis DEL was called for the prefix
    expect(redisModule.__mockClient.del).toHaveBeenCalled();
    // del() is called with the key array as a single argument, so flatten
    // twice to surface the individual key strings.
    const delArgs = redisModule.__mockClient.del.mock.calls.flat(2);
    expect(delArgs).toContain(`summary:${testPublicKey}`);

    // Next call should be a cache miss (fetches again)
    await analyticsService.getSummary(testPublicKey);
    expect(stellarService.getPayments).toHaveBeenCalledTimes(2);
  });

  it("different keys do not collide in Redis", async () => {
    const otherKey = "GOTHERKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678";

    await analyticsService.getSummary(testPublicKey);
    await analyticsService.getTopRecipients(otherKey);

    // Both functions fetched data independently
    expect(stellarService.getPayments).toHaveBeenCalledTimes(2);

    // Redis stored two distinct keys
    const setExKeys = redisModule.__mockClient.setEx.mock.calls.map(
      (call) => call[0]
    );
    expect(setExKeys).toContain(`summary:${testPublicKey}`);
    expect(setExKeys).toContain(`top-recipients:${otherKey}`);
  });
});

describe("Analytics Cache - In-Memory Fallback (#1072)", () => {
  it("should fall back to in-memory when REDIS_URL is not set", async () => {
    delete process.env.REDIS_URL;
    delete process.env.ANALYTICS_CACHE_TTL_MS;

    let isolatedService;
    let isolatedStellar;
    let isolatedCache;

    jest.isolateModules(() => {
      isolatedStellar = require("../src/services/stellarService");
      isolatedStellar.getPayments = jest
        .fn()
        .mockResolvedValue(mockPayments);
      isolatedService = require("../src/services/analyticsService");
      isolatedCache = require("../src/services/cache");
    });

    // Redis was never initialised
    expect(isolatedCache.isUsingRedis()).toBe(false);

    // First call — in-memory cache miss, fetches from service
    const result1 = await isolatedService.getSummary(testPublicKey);
    expect(isolatedStellar.getPayments).toHaveBeenCalledTimes(1);
    expect(result1.publicKey).toBe(testPublicKey);

    // Second call — in-memory cache hit
    const result2 = await isolatedService.getSummary(testPublicKey);
    expect(isolatedStellar.getPayments).toHaveBeenCalledTimes(1); // still 1
    expect(result2).toEqual(result1);
  });
});
