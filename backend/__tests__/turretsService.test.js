/**
 * __tests__/turretsService.test.js
 * Unit tests for turretsService (issue #532).
 *
 * Covers job queueing (deployTxFunction produces the expected deployment
 * record) and signing delegation (a failed/forged signature is surfaced as
 * an error rather than silently dropped).
 *
 * server.loadAccount is mocked to reject so the service falls back to a
 * fresh Account(publicKey, "0") — no real Horizon network calls are made.
 * Keypair/Transaction/TransactionBuilder are used for real so the
 * challenge/sign/verify flow is exercised end-to-end.
 */

"use strict";

const { Keypair, Transaction, Networks } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  server: {
    loadAccount: jest.fn().mockRejectedValue(new Error("account not found")),
  },
}));

const turretsService = require("../src/services/turretsService");

const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Create a signing challenge and sign it with the given keypair, as a wallet would. */
async function buildSignedChallenge(ownerPublicKey, signerKeypair, type, config) {
  const challenge = await turretsService.createSigningChallenge({ ownerPublicKey, type, config });
  const tx = new Transaction(challenge.challengeXDR, NETWORK_PASSPHRASE);
  tx.sign(signerKeypair);
  return { ...challenge, signedChallengeXDR: tx.toXDR() };
}

describe("turretsService", () => {
  afterEach(() => {
    turretsService.stopRunner();
  });

  describe("createSigningChallenge", () => {
    it("throws for an invalid owner public key", async () => {
      await expect(
        turretsService.createSigningChallenge({ ownerPublicKey: "not-a-key", type: "dca", config: {} })
      ).rejects.toThrow("Invalid Stellar public key format");
    });

    it("normalizes dca config defaults and returns a signable challenge", async () => {
      const owner = Keypair.random();

      const result = await turretsService.createSigningChallenge({
        ownerPublicKey: owner.publicKey(),
        type: "dca",
        config: { amountQuote: 25 },
      });

      expect(typeof result.challengeXDR).toBe("string");
      expect(result.normalizedConfig).toMatchObject({
        intervalMinutes: 60,
        amountQuote: 25,
        quoteAssetCode: "USDC",
      });
      expect(result.networkPassphrase).toBe(NETWORK_PASSPHRASE);
    });

    it("rejects an invalid stop_loss config", async () => {
      const owner = Keypair.random();

      await expect(
        turretsService.createSigningChallenge({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
          config: { thresholdPrice: -1 },
        })
      ).rejects.toThrow("Stop-loss thresholdPrice must be greater than 0");
    });
  });

  describe("deployTxFunction — job queueing", () => {
    it("produces the expected job record for a validly signed deployment", async () => {
      const owner = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };
      const challenge = await buildSignedChallenge(owner.publicKey(), owner, "stop_loss", config);

      const deployment = turretsService.deployTxFunction({
        ownerPublicKey: owner.publicKey(),
        type: "stop_loss",
        config,
        deploymentHash: challenge.deploymentHash,
        signedChallengeXDR: challenge.signedChallengeXDR,
      });

      expect(deployment).toMatchObject({
        ownerPublicKey: owner.publicKey(),
        type: "stop_loss",
        status: "active",
        deploymentHash: challenge.deploymentHash,
        lastExecutedAt: null,
        lastError: null,
      });
      expect(deployment.id).toEqual(expect.any(String));
      expect(deployment.config).toMatchObject({
        thresholdPrice: 0.05,
        amountSell: 100,
        sellAssetCode: "XLM",
        cooldownMinutes: 30,
      });
      expect(new Date(deployment.nextRunAt).getTime()).toBeGreaterThan(Date.now());

      // The job record is queryable by id and by owner, as the runner expects.
      expect(turretsService.getDeployment(deployment.id)).toEqual(deployment);
      expect(turretsService.listDeployments(owner.publicKey())).toContainEqual(deployment);
    });

    it("throws a 404 for an unknown deployment id", () => {
      expect(() => turretsService.getDeployment("does-not-exist")).toThrow("txFunction not found");
    });
  });

  describe("deployTxFunction — signing delegation failures", () => {
    it("surfaces a signature mismatch as an error instead of silently dropping the job", async () => {
      const owner = Keypair.random();
      const impostor = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };

      // Challenge is built for `owner`, but signed by an unrelated keypair.
      const challenge = await buildSignedChallenge(owner.publicKey(), impostor, "stop_loss", config);

      expect(() =>
        turretsService.deployTxFunction({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
          config,
          deploymentHash: challenge.deploymentHash,
          signedChallengeXDR: challenge.signedChallengeXDR,
        })
      ).toThrow("Signed challenge was not signed by the owner account");

      // No job record should have been queued as a result of the failed delegation.
      expect(turretsService.listDeployments(owner.publicKey())).toHaveLength(0);
    });

    it("attaches a 401 status to the surfaced signing-delegation error", async () => {
      const owner = Keypair.random();
      const impostor = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };
      const challenge = await buildSignedChallenge(owner.publicKey(), impostor, "stop_loss", config);

      expect.assertions(1);
      try {
        turretsService.deployTxFunction({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
          config,
          deploymentHash: challenge.deploymentHash,
          signedChallengeXDR: challenge.signedChallengeXDR,
        });
      } catch (err) {
        expect(err.status).toBe(401);
      }
    });

    it("rejects a tampered config whose hash no longer matches the signed challenge", async () => {
      const owner = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };
      const challenge = await buildSignedChallenge(owner.publicKey(), owner, "stop_loss", config);

      expect(() =>
        turretsService.deployTxFunction({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
/**
 * __tests__/turretsService.test.js
 * Unit tests for turretsService (issue #532).
 *
 * Covers job queueing (deployTxFunction produces the expected deployment
 * record) and signing delegation (a failed/forged signature is surfaced as
 * an error rather than silently dropped).
 *
 * server.loadAccount is mocked to reject so the service falls back to a
 * fresh Account(publicKey, "0") — no real Horizon network calls are made.
 * Keypair/Transaction/TransactionBuilder are used for real so the
 * challenge/sign/verify flow is exercised end-to-end.
 */

"use strict";

const { Keypair, Transaction, Networks } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  server: {
    loadAccount: jest.fn().mockRejectedValue(new Error("account not found")),
  },
}));

const turretsService = require("../src/services/turretsService");

const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Create a signing challenge and sign it with the given keypair, as a wallet would. */
async function buildSignedChallenge(ownerPublicKey, signerKeypair, type, config) {
  const challenge = await turretsService.createSigningChallenge({ ownerPublicKey, type, config });
  const tx = new Transaction(challenge.challengeXDR, NETWORK_PASSPHRASE);
  tx.sign(signerKeypair);
  return { ...challenge, signedChallengeXDR: tx.toXDR() };
}

describe("turretsService", () => {
  afterEach(() => {
    turretsService.stopRunner();
  });

  describe("createSigningChallenge", () => {
    it("throws for an invalid owner public key", async () => {
      await expect(
        turretsService.createSigningChallenge({ ownerPublicKey: "not-a-key", type: "dca", config: {} })
      ).rejects.toThrow("Invalid Stellar public key format");
    });

    it("normalizes dca config defaults and returns a signable challenge", async () => {
      const owner = Keypair.random();

      const result = await turretsService.createSigningChallenge({
        ownerPublicKey: owner.publicKey(),
        type: "dca",
        config: { amountQuote: 25 },
      });

      expect(typeof result.challengeXDR).toBe("string");
      expect(result.normalizedConfig).toMatchObject({
        intervalMinutes: 60,
        amountQuote: 25,
        quoteAssetCode: "USDC",
      });
      expect(result.networkPassphrase).toBe(NETWORK_PASSPHRASE);
    });

    it("rejects an invalid stop_loss config", async () => {
      const owner = Keypair.random();

      await expect(
        turretsService.createSigningChallenge({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
          config: { thresholdPrice: -1 },
        })
      ).rejects.toThrow("Stop-loss thresholdPrice must be greater than 0");
    });
  });

  describe("deployTxFunction — job queueing", () => {
    it("produces the expected job record for a validly signed deployment", async () => {
      const owner = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };
      const challenge = await buildSignedChallenge(owner.publicKey(), owner, "stop_loss", config);

      const deployment = turretsService.deployTxFunction({
        ownerPublicKey: owner.publicKey(),
        type: "stop_loss",
        config,
        deploymentHash: challenge.deploymentHash,
        signedChallengeXDR: challenge.signedChallengeXDR,
      });

      expect(deployment).toMatchObject({
        ownerPublicKey: owner.publicKey(),
        type: "stop_loss",
        status: "active",
        deploymentHash: challenge.deploymentHash,
        lastExecutedAt: null,
        lastError: null,
      });
      expect(deployment.id).toEqual(expect.any(String));
      expect(deployment.config).toMatchObject({
        thresholdPrice: 0.05,
        amountSell: 100,
        sellAssetCode: "XLM",
        cooldownMinutes: 30,
      });
      expect(new Date(deployment.nextRunAt).getTime()).toBeGreaterThan(Date.now());

      // The job record is queryable by id and by owner, as the runner expects.
      expect(turretsService.getDeployment(deployment.id)).toEqual(deployment);
      expect(turretsService.listDeployments(owner.publicKey())).toContainEqual(deployment);
    });

    it("throws a 404 for an unknown deployment id", () => {
      expect(() => turretsService.getDeployment("does-not-exist")).toThrow("txFunction not found");
    });
  });

  describe("deployTxFunction — signing delegation failures", () => {
    it("surfaces a signature mismatch as an error instead of silently dropping the job", async () => {
      const owner = Keypair.random();
      const impostor = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };

      // Challenge is built for `owner`, but signed by an unrelated keypair.
      const challenge = await buildSignedChallenge(owner.publicKey(), impostor, "stop_loss", config);

      expect(() =>
        turretsService.deployTxFunction({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
          config,
          deploymentHash: challenge.deploymentHash,
          signedChallengeXDR: challenge.signedChallengeXDR,
        })
      ).toThrow("Signed challenge was not signed by the owner account");

      // No job record should have been queued as a result of the failed delegation.
      expect(turretsService.listDeployments(owner.publicKey())).toHaveLength(0);
    });

    it("attaches a 401 status to the surfaced signing-delegation error", async () => {
      const owner = Keypair.random();
      const impostor = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };
      const challenge = await buildSignedChallenge(owner.publicKey(), impostor, "stop_loss", config);

      expect.assertions(1);
      try {
        turretsService.deployTxFunction({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
          config,
          deploymentHash: challenge.deploymentHash,
          signedChallengeXDR: challenge.signedChallengeXDR,
        });
      } catch (err) {
        expect(err.status).toBe(401);
      }
    });

    it("rejects a tampered config whose hash no longer matches the signed challenge", async () => {
      const owner = Keypair.random();
      const config = { thresholdPrice: 0.05, amountSell: 100 };
      const challenge = await buildSignedChallenge(owner.publicKey(), owner, "stop_loss", config);

      expect(() =>
        turretsService.deployTxFunction({
          ownerPublicKey: owner.publicKey(),
          type: "stop_loss",
          config: { ...config, amountSell: 999 },
          deploymentHash: challenge.deploymentHash,
          signedChallengeXDR: challenge.signedChallengeXDR,
        })
      ).toThrow("Configuration hash mismatch");
    });
  });

  describe("getXlmUsdPrice", () => {
    let originalFetch;
    beforeEach(() => {
      originalFetch = global.fetch;
    });
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("uses CoinGecko successfully", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stellar: { usd: 0.15, last_updated_at: Date.now() / 1000 } })
      });
      const price = await turretsService._getXlmUsdPrice();
      expect(price).toBe(0.15);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("falls back to Binance if CoinGecko is stale", async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ stellar: { usd: 0.15, last_updated_at: (Date.now() / 1000) - 10000 } }) // Stale
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ lastPrice: "0.16", closeTime: Date.now() }) // Fresh
        });

      const price = await turretsService._getXlmUsdPrice();
      expect(price).toBe(0.16);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("throws if all sources fail or return invalid data", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}) // Missing data
      });

      await expect(turretsService._getXlmUsdPrice()).rejects.toThrow(/All price oracles failed/);
    });
  });
});
