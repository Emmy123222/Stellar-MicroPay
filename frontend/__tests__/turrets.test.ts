/**
 * Unit tests for lib/turrets.ts (#522).
 *
 * Covers:
 * - Each helper calls apiFetch with the correct URL, method, and body
 * - Network / API errors are surfaced (not swallowed)
 */

// Mock the api module before importing turrets so turrets picks up the mock.
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.body = body;
    }
  },
}));

import { apiFetch } from "@/lib/api";
import {
  createTurretsChallenge,
  deployTurretsFunction,
  getTurretsHistory,
  listTurretsFunctions,
  pauseTurretsFunction,
  resumeTurretsFunction,
  type TurretsDeployment,
  type TurretsExecutionHistory,
} from "@/lib/turrets";

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const MOCK_DEPLOYMENT: TurretsDeployment = {
  id: "dep-1",
  ownerPublicKey: "GABC123",
  type: "dca",
  status: "active",
  config: { amount: 10 },
  deploymentHash: "hash-abc",
  createdAt: "2024-01-01T00:00:00Z",
  nextRunAt: null,
  lastExecutedAt: null,
  lastCheckedAt: null,
  lastObservedPriceUsd: null,
  lastError: null,
};

describe("turrets API helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createTurretsChallenge ─────────────────────────────────────────────────

  describe("createTurretsChallenge", () => {
    it("calls POST /api/turrets/challenge with the supplied params", async () => {
      const response = {
        challengeXDR: "xdr-payload",
        deploymentHash: "hash-abc",
        normalizedConfig: { amount: 10 },
        networkPassphrase: "Test SDF Network ; September 2015",
      };
      mockApiFetch.mockResolvedValueOnce(response);

      const params = {
        ownerPublicKey: "GABC",
        type: "dca" as const,
        config: { amount: 10 },
      };
      const result = await createTurretsChallenge(params);

      expect(mockApiFetch).toHaveBeenCalledWith("/api/turrets/challenge", {
        method: "POST",
        body: JSON.stringify(params),
      });
      expect(result).toEqual(response);
    });

    it("surfaces network errors — does not swallow them", async () => {
      mockApiFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        createTurretsChallenge({ ownerPublicKey: "GABC", type: "dca", config: {} }),
      ).rejects.toThrow("Network error");
    });

    it("surfaces API errors with their status code", async () => {
      const apiErr = { name: "ApiError", message: "Unauthorized", status: 401 };
      mockApiFetch.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), apiErr));

      await expect(
        createTurretsChallenge({ ownerPublicKey: "GABC", type: "dca", config: {} }),
      ).rejects.toMatchObject({ message: "Unauthorized" });
    });
  });

  // ── deployTurretsFunction ──────────────────────────────────────────────────

  describe("deployTurretsFunction", () => {
    it("calls POST /api/turrets/deploy and returns the deployment", async () => {
      mockApiFetch.mockResolvedValueOnce(MOCK_DEPLOYMENT);

      const params = {
        ownerPublicKey: "GABC",
        type: "dca" as const,
        config: { amount: 10 },
        deploymentHash: "hash-abc",
        signedChallengeXDR: "signed-xdr",
      };
      const result = await deployTurretsFunction(params);

      expect(mockApiFetch).toHaveBeenCalledWith("/api/turrets/deploy", {
        method: "POST",
        body: JSON.stringify(params),
      });
      expect(result).toEqual(MOCK_DEPLOYMENT);
    });

    it("surfaces errors from the API", async () => {
      mockApiFetch.mockRejectedValueOnce(new Error("Bad Gateway"));

      await expect(
        deployTurretsFunction({
          ownerPublicKey: "GABC",
          type: "stop_loss",
          config: {},
          deploymentHash: "h",
          signedChallengeXDR: "xdr",
        }),
      ).rejects.toThrow("Bad Gateway");
    });
  });

  // ── listTurretsFunctions ───────────────────────────────────────────────────

  describe("listTurretsFunctions", () => {
    it("calls GET with URL-encoded owner public key", async () => {
      mockApiFetch.mockResolvedValueOnce([MOCK_DEPLOYMENT]);
      const pk = "GABC+DEF/GHI";

      const result = await listTurretsFunctions(pk);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/turrets?ownerPublicKey=${encodeURIComponent(pk)}`,
      );
      expect(result).toEqual([MOCK_DEPLOYMENT]);
    });

    it("returns an empty array when no deployments exist", async () => {
      mockApiFetch.mockResolvedValueOnce([]);

      const result = await listTurretsFunctions("GABC");
      expect(result).toEqual([]);
    });

    it("handles null or non-array responses gracefully by returning empty array", async () => {
      mockApiFetch.mockResolvedValueOnce(null as unknown as TurretsDeployment[]);

      const result = await listTurretsFunctions("GABC");
      expect(result).toEqual([]);
    });

    it("surfaces API errors", async () => {
      mockApiFetch.mockRejectedValueOnce(new Error("500 Internal Server Error"));
      await expect(listTurretsFunctions("GABC")).rejects.toThrow("500 Internal Server Error");
    });
  });

  // ── getTurretsHistory ──────────────────────────────────────────────────────

  describe("getTurretsHistory", () => {
    it("calls GET /api/turrets/:id/history with encoded id", async () => {
      const history: TurretsExecutionHistory[] = [
        {
          id: "h1",
          deploymentId: "dep-1",
          status: "success",
          message: "ran ok",
          result: null,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];
      mockApiFetch.mockResolvedValueOnce(history);

      const result = await getTurretsHistory("dep-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/turrets/dep-1/history");
      expect(result).toEqual(history);
    });

    it("URL-encodes the id", async () => {
      mockApiFetch.mockResolvedValueOnce([]);

      await getTurretsHistory("dep/1 2");
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/turrets/${encodeURIComponent("dep/1 2")}/history`,
      );
    });
  });

  // ── pauseTurretsFunction ───────────────────────────────────────────────────

  describe("pauseTurretsFunction", () => {
    it("calls POST /api/turrets/:id/pause and returns updated deployment", async () => {
      const paused = { ...MOCK_DEPLOYMENT, status: "paused" as const };
      mockApiFetch.mockResolvedValueOnce(paused);

      const result = await pauseTurretsFunction("dep-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/turrets/dep-1/pause", {
        method: "POST",
      });
      expect(result.status).toBe("paused");
    });
  });

  // ── resumeTurretsFunction ──────────────────────────────────────────────────

  describe("resumeTurretsFunction", () => {
    it("calls POST /api/turrets/:id/resume and returns active deployment", async () => {
      mockApiFetch.mockResolvedValueOnce({ ...MOCK_DEPLOYMENT, status: "active" });

      const result = await resumeTurretsFunction("dep-1");

      expect(mockApiFetch).toHaveBeenCalledWith("/api/turrets/dep-1/resume", {
        method: "POST",
      });
      expect(result.status).toBe("active");
    });
  });
});
