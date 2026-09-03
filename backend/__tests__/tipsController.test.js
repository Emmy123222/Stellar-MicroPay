/**
 * __tests__/tipsController.test.js
 * Unit tests for tipsController.js (#528)
 */

const tipsController = require("../src/controllers/tipsController");
const tipsService = require("../src/services/tipsService");

// Mock the tipsService
jest.mock("../src/services/tipsService");

describe("tipsController", () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      body: {},
      params: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe("Create tip validates required fields", () => {
    it("validates required fields before recording tip", async () => {
      req.body = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
        amount: "10.5",
        asset: "XLM",
        memo: "Great work!",
        txHash: "abc123hash",
      };

      const mockTip = {
        id: 1,
        ...req.body,
        timestamp: new Date().toISOString(),
      };

      tipsService.validateTipInput.mockImplementation(() => {});
      tipsService.recordTip.mockReturnValue(mockTip);

      await tipsController.recordTip(req, res, next);

      expect(tipsService.validateTipInput).toHaveBeenCalledWith({
        senderPublicKey: req.body.senderPublicKey,
        creatorPublicKey: req.body.creatorPublicKey,
        amount: req.body.amount,
      });

      expect(tipsService.recordTip).toHaveBeenCalledWith({
        senderPublicKey: req.body.senderPublicKey,
        creatorPublicKey: req.body.creatorPublicKey,
        amount: req.body.amount,
        asset: "XLM",
        memo: "Great work!",
        txHash: "abc123hash",
        operationIndex: 0,
      });

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockTip,
        message: "Tip recorded successfully",
      });
    });

    it("handles validation errors", async () => {
      req.body = {
        senderPublicKey: "INVALID",
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
        amount: "10.5",
      };

      const validationError = new Error("Invalid sender public key");
      tipsService.validateTipInput.mockImplementation(() => {
        throw validationError;
      });

      await tipsController.recordTip(req, res, next);

      expect(next).toHaveBeenCalledWith(validationError);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("uses default values for optional fields", async () => {
      req.body = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
        amount: "5.0",
      };

      tipsService.validateTipInput.mockImplementation(() => {});
      tipsService.recordTip.mockReturnValue({ id: 1 });

      await tipsController.recordTip(req, res, next);

      expect(tipsService.recordTip).toHaveBeenCalledWith({
        senderPublicKey: req.body.senderPublicKey,
        creatorPublicKey: req.body.creatorPublicKey,
        amount: req.body.amount,
        asset: "XLM",
        memo: "",
        txHash: "",
        operationIndex: 0,
      });
    });

    it("rejects tip with missing required fields", async () => {
      req.body = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
        // Missing creatorPublicKey and amount
      };

      const validationError = new Error("Missing required fields");
      tipsService.validateTipInput.mockImplementation(() => {
        throw validationError;
      });

      await tipsController.recordTip(req, res, next);

      expect(next).toHaveBeenCalledWith(validationError);
    });
  });

  describe("Idempotent tip recording", () => {
    it("returns 200 with the existing record when tipsService reports a duplicate", async () => {
      req.body = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
        amount: "10.5",
        txHash: "abc123hash",
        operationIndex: 0,
      };

      const existingTip = {
        id: 1,
        senderPublicKey: req.body.senderPublicKey,
        creatorPublicKey: req.body.creatorPublicKey,
        amount: req.body.amount,
        txHash: req.body.txHash,
        operationIndex: 0,
        isDuplicate: true,
        timestamp: new Date().toISOString(),
      };

      tipsService.validateTipInput.mockImplementation(() => {});
      tipsService.recordTip.mockReturnValue(existingTip);

      await tipsController.recordTip(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: existingTip,
        message: "Tip already recorded",
      });
    });

    it("passes operationIndex through to tipsService.recordTip", async () => {
      req.body = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
        amount: "10.5",
        txHash: "abc123hash",
        operationIndex: 2,
      };

      tipsService.validateTipInput.mockImplementation(() => {});
      tipsService.recordTip.mockReturnValue({ id: 1, isDuplicate: false });

      await tipsController.recordTip(req, res, next);

      expect(tipsService.recordTip).toHaveBeenCalledWith(
        expect.objectContaining({ operationIndex: 2 })
      );
    });

    it("defaults operationIndex to 0 when omitted", async () => {
      req.body = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
        amount: "10.5",
        txHash: "abc123hash",
      };

      tipsService.validateTipInput.mockImplementation(() => {});
      tipsService.recordTip.mockReturnValue({ id: 1, isDuplicate: false });

      await tipsController.recordTip(req, res, next);

      expect(tipsService.recordTip).toHaveBeenCalledWith(
        expect.objectContaining({ operationIndex: 0 })
      );
    });
  });

  describe("List received/sent tips supports pagination params", () => {
    it("gets received tips with pagination", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };
      req.query = {
        limit: "10",
        offset: "20",
      };

      const mockResult = {
        tips: [
          { id: 1, amount: "5.0", asset: "XLM" },
          { id: 2, amount: "10.0", asset: "XLM" },
        ],
        total: 50,
        limit: 10,
        offset: 20,
      };

      const mockStats = {
        totalTips: 50,
        totalByAsset: { XLM: { count: 50, amount: "250.0" } },
      };

      tipsService.getTipsReceived.mockReturnValue(mockResult);
      tipsService.getTipsStats.mockReturnValue(mockStats);

      await tipsController.getTipsReceived(req, res, next);

      expect(tipsService.getTipsReceived).toHaveBeenCalledWith(
        req.params.creatorPublicKey,
        { limit: 10, offset: 20, cursor: undefined }
      );

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          ...mockResult,
          stats: mockStats,
        },
      });
    });

    it("gets sent tips with pagination", async () => {
      req.params = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
      };
      req.query = {
        limit: "15",
        offset: "5",
      };

      const mockResult = {
        tips: [{ id: 1, amount: "3.0", asset: "XLM" }],
        total: 20,
        limit: 15,
        offset: 5,
      };

      tipsService.getTipsSent.mockReturnValue(mockResult);

      await tipsController.getTipsSent(req, res, next);

      expect(tipsService.getTipsSent).toHaveBeenCalledWith(
        req.params.senderPublicKey,
        { limit: 15, offset: 5, cursor: undefined }
      );

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it("handles pagination with undefined limit/offset", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };
      req.query = {};

      tipsService.getTipsReceived.mockReturnValue({ tips: [], total: 0 });
      tipsService.getTipsStats.mockReturnValue({});

      await tipsController.getTipsReceived(req, res, next);

      expect(tipsService.getTipsReceived).toHaveBeenCalledWith(
        req.params.creatorPublicKey,
        { limit: undefined, offset: undefined, cursor: undefined }
      );
    });

    it("passes pagination params to service", async () => {
      req.params = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
      };
      req.query = {
        limit: "25",
        offset: "50",
      };

      tipsService.getTipsSent.mockReturnValue({ tips: [], total: 0 });

      await tipsController.getTipsSent(req, res, next);

      expect(tipsService.getTipsSent).toHaveBeenCalledWith(
        req.params.senderPublicKey,
        { limit: 25, offset: 50, cursor: undefined }
      );
    });

    it("passes a cursor query param through to tipsService.getTipsReceived", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };
      req.query = { cursor: "eyJpZCI6NX0" };

      tipsService.getTipsReceived.mockReturnValue({ tips: [], total: 0, nextCursor: null });
      tipsService.getTipsStats.mockReturnValue({});

      await tipsController.getTipsReceived(req, res, next);

      expect(tipsService.getTipsReceived).toHaveBeenCalledWith(
        req.params.creatorPublicKey,
        { limit: undefined, offset: undefined, cursor: "eyJpZCI6NX0" }
      );
    });

    it("passes a cursor query param through to tipsService.getTipsSent", async () => {
      req.params = {
        senderPublicKey: "GABC123456789012345678901234567890123456789012345678",
      };
      req.query = { cursor: "eyJpZCI6NX0" };

      tipsService.getTipsSent.mockReturnValue({ tips: [], total: 0, nextCursor: null });

      await tipsController.getTipsSent(req, res, next);

      expect(tipsService.getTipsSent).toHaveBeenCalledWith(
        req.params.senderPublicKey,
        { limit: undefined, offset: undefined, cursor: "eyJpZCI6NX0" }
      );
    });

    it("handles errors in getTipsReceived", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };

      const error = new Error("Database error");
      tipsService.getTipsReceived.mockImplementation(() => {
        throw error;
      });

      await tipsController.getTipsReceived(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("Stats endpoint returns correct aggregate shape", () => {
    it("returns stats for a creator", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };

      const mockStats = {
        totalTips: 100,
        totalByAsset: {
          XLM: { count: 80, amount: "400.0" },
          USDC: { count: 20, amount: "200.0" },
        },
        averageTip: "6.0",
        largestTip: "50.0",
        smallestTip: "1.0",
      };

      tipsService.getTipsStats.mockReturnValue(mockStats);

      await tipsController.getTipsStats(req, res, next);

      expect(tipsService.getTipsStats).toHaveBeenCalledWith(
        req.params.creatorPublicKey
      );

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockStats,
      });
    });

    it("returns correct shape with multiple assets", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };

      const mockStats = {
        totalTips: 50,
        totalByAsset: {
          XLM: { count: 30, amount: "150.0" },
          USDC: { count: 15, amount: "75.0" },
          BTC: { count: 5, amount: "0.5" },
        },
        averageTip: "4.5",
        largestTip: "25.0",
        smallestTip: "0.5",
      };

      tipsService.getTipsStats.mockReturnValue(mockStats);

      await tipsController.getTipsStats(req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.data).toHaveProperty("totalTips");
      expect(response.data).toHaveProperty("totalByAsset");
      expect(response.data).toHaveProperty("averageTip");
      expect(response.data.totalByAsset).toHaveProperty("XLM");
      expect(response.data.totalByAsset).toHaveProperty("USDC");
      expect(response.data.totalByAsset).toHaveProperty("BTC");
    });

    it("handles stats for creator with no tips", async () => {
      req.params = {
        creatorPublicKey: "GHIJ789012345678901234567890123456789012345678901234",
      };

      const mockStats = {
        totalTips: 0,
        totalByAsset: {},
        averageTip: "0",
        largestTip: "0",
        smallestTip: "0",
      };

      tipsService.getTipsStats.mockReturnValue(mockStats);

      await tipsController.getTipsStats(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockStats,
      });
    });

    it("handles errors in getTipsStats", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };

      const error = new Error("Stats calculation failed");
      tipsService.getTipsStats.mockImplementation(() => {
        throw error;
      });

      await tipsController.getTipsStats(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("Additional endpoints", () => {
    it("gets top tippers with limit", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };
      req.query = {
        limit: "10",
      };

      const mockResult = [
        { senderPublicKey: "GABC...", totalAmount: "100.0", tipCount: 5 },
        { senderPublicKey: "GDEF...", totalAmount: "75.0", tipCount: 3 },
      ];

      tipsService.getTopTippers.mockReturnValue(mockResult);

      await tipsController.getTopTippers(req, res, next);

      expect(tipsService.getTopTippers).toHaveBeenCalledWith(
        req.params.creatorPublicKey,
        "10"
      );

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it("uses default limit for top tippers when not provided", async () => {
      req.params = {
        creatorPublicKey: "GDEF456789012345678901234567890123456789012345678901",
      };
      req.query = {};

      tipsService.getTopTippers.mockReturnValue([]);

      await tipsController.getTopTippers(req, res, next);

      expect(tipsService.getTopTippers).toHaveBeenCalledWith(
        req.params.creatorPublicKey,
        undefined
      );
    });
  });
});
