/**
 * src/swagger.js
 * OpenAPI 3.0 specification for Stellar MicroPay backend API.
 */

"use strict";

const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Stellar MicroPay API",
      version: "1.0.0",
      description:
        "Backend API for Stellar MicroPay — instant micropayments on the Stellar network.\n\n" +
        "## Rate Limiting\n\n" +
        "All endpoints are rate-limited. Two limiters apply:\n\n" +
        "| Limiter | Window | Limit | Routes |\n" +
        "|---------|--------|-------|--------|\n" +
        "| Global | 15 minutes | 100 req/IP | All routes |\n" +
        "| Strict | 1 minute | 20 req/IP | `/api/turrets/*` |\n\n" +
        "Every response includes the following headers so clients can implement back-off:\n\n" +
        "| Header | Description |\n" +
        "|--------|-------------|\n" +
        "| `RateLimit-Limit` | Maximum requests allowed in the current window |\n" +
        "| `RateLimit-Remaining` | Requests remaining before the limit is reached |\n" +
        "| `RateLimit-Reset` | Seconds until the window resets |\n\n" +
        "When the limit is exceeded the server returns **HTTP 429** with `{ \"error\": \"Too many requests, please try again later.\" }`. " +
        "Clients should read `RateLimit-Remaining` on each response and add exponential back-off when the value approaches 0.",
      contact: {
        name: "Stellar MicroPay",
        url: "https://github.com/Emmy123222/Stellar-MicroPay",
      },
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Local development server",
      },
    ],
    components: {
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string", description: "Error message" },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: { type: "object" },
          },
        },
        PaymentRecord: {
          type: "object",
          properties: {
            id: { type: "string", description: "Horizon operation ID" },
            type: {
              type: "string",
              enum: ["sent", "received"],
              description: "Direction relative to the queried account",
            },
            amount: { type: "string", description: "Amount sent/received" },
            asset: { type: "string", description: "Asset code (e.g. XLM)" },
            from: { type: "string", description: "Sender public key" },
            to: { type: "string", description: "Recipient public key" },
            memo: { type: "string", description: "Optional memo text" },
            createdAt: { type: "string", format: "date-time" },
            transactionHash: { type: "string" },
            pagingToken: { type: "string" },
          },
        },
        PaymentStats: {
          type: "object",
          properties: {
            publicKey: { type: "string" },
            totalSentXLM: { type: "string" },
            totalReceivedXLM: { type: "string" },
            sentCount: { type: "integer" },
            receivedCount: { type: "integer" },
            totalTransactions: { type: "integer" },
          },
        },
        AnalyticsSummary: {
          type: "object",
          properties: {
            publicKey: { type: "string" },
            totalSentXLM: { type: "string" },
            totalReceivedXLM: { type: "string" },
            sentCount: { type: "integer" },
            receivedCount: { type: "integer" },
            totalTransactions: { type: "integer" },
          },
        },
        TopRecipient: {
          type: "object",
          properties: {
            publicKey: { type: "string" },
            totalXLM: { type: "string" },
            count: { type: "integer" },
          },
        },
        ActivityDay: {
          type: "object",
          properties: {
            date: { type: "string", format: "date" },
            totalXLM: { type: "string" },
            count: { type: "integer" },
          },
        },
        AccountBalance: {
          type: "object",
          properties: {
            assetCode: { type: "string" },
            balance: { type: "string" },
            asset_type: { type: "string" },
          },
        },
        AccountInfo: {
          type: "object",
          properties: {
            publicKey: { type: "string" },
            sequence: { type: "string" },
            balances: {
              type: "array",
              items: { $ref: "#/components/schemas/AccountBalance" },
            },
            subentryCount: { type: "integer" },
          },
        },
        Tip: {
          type: "object",
          properties: {
            id: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            amount: { type: "string" },
            memo: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            transactionHash: { type: "string" },
          },
        },
        TipStats: {
          type: "object",
          properties: {
            totalReceived: { type: "string" },
            totalCount: { type: "integer" },
            averageAmount: { type: "string" },
          },
        },
        TxFunctionChallengeRequest: {
          type: "object",
          required: ["ownerPublicKey", "type", "config"],
          properties: {
            ownerPublicKey: {
              type: "string",
              pattern: "^G[A-Z0-9]{55}$",
              description: "Stellar public key of the txFunction owner",
            },
            type: {
              type: "string",
              enum: ["dca", "stop_loss", "escrow_release"],
              description: "Type of automated txFunction",
            },
            config: {
              type: "object",
              description: "Type-specific configuration — see DcaConfig, StopLossConfig, or EscrowReleaseConfig",
            },
          },
        },
        TxFunctionChallengeResponse: {
          type: "object",
          properties: {
            challengeXDR: {
              type: "string",
              description: "Base64-encoded ManageData transaction XDR the owner must sign",
            },
            deploymentHash: {
              type: "string",
              description: "SHA-256 hash of the normalised config, included in the challenge",
            },
            normalizedConfig: { type: "object" },
            networkPassphrase: { type: "string" },
          },
        },
        TxFunctionDeployRequest: {
          type: "object",
          required: ["ownerPublicKey", "type", "config", "deploymentHash", "signedChallengeXDR"],
          properties: {
            ownerPublicKey: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            type: { type: "string", enum: ["dca", "stop_loss", "escrow_release"] },
            config: { type: "object" },
            deploymentHash: { type: "string" },
            signedChallengeXDR: {
              type: "string",
              description: "The challenge XDR signed by the owner's Freighter (or Ledger) wallet",
            },
          },
        },
        TxFunctionDeployment: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            ownerPublicKey: { type: "string" },
            type: { type: "string", enum: ["dca", "stop_loss", "escrow_release"] },
            status: { type: "string", enum: ["active", "paused", "completed"] },
            config: { type: "object" },
            deploymentHash: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            nextRunAt: { type: "string", format: "date-time", nullable: true },
            lastExecutedAt: { type: "string", format: "date-time", nullable: true },
            lastCheckedAt: { type: "string", format: "date-time", nullable: true },
            lastObservedPriceUsd: { type: "number", nullable: true },
            lastError: { type: "string", nullable: true },
          },
        },
        ExecutionLogEntry: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            deploymentId: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: ["created", "executed", "error", "status"],
              description: "Execution event type",
            },
            message: { type: "string" },
            result: {
              type: "object",
              nullable: true,
              description: "Operation intent generated by the txFunction evaluator",
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          responses: {
            200: {
              description: "Server is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      timestamp: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/auth": {
        get: {
          tags: ["Authentication"],
          summary: "Get SEP-0010 challenge transaction",
          parameters: [
            {
              name: "account",
              in: "query",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
              description: "Stellar public key",
            },
          ],
          responses: {
            200: {
              description: "Challenge transaction XDR",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      transaction: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing or invalid account parameter" },
          },
        },
        post: {
          tags: ["Authentication"],
          summary: "Verify signed challenge and get JWT",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    transaction: {
                      type: "string",
                      description: "Signed challenge XDR",
                    },
                  },
                  required: ["transaction"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "JWT token",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      token: { type: "string" },
                    },
                  },
                },
              },
            },
            401: { description: "Invalid signature" },
          },
        },
      },
      "/api/accounts/{publicKey}": {
        get: {
          tags: ["Accounts"],
          summary: "Get account details and balances",
          parameters: [
            {
              name: "publicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Account info",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 100 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: { $ref: "#/components/schemas/AccountInfo" },
                    },
                  },
                },
              },
            },
            404: { description: "Account not found" },
            429: { description: "Rate limit exceeded — back off and retry after RateLimit-Reset seconds" },
          },
        },
      },
      "/api/accounts/{publicKey}/balance": {
        get: {
          tags: ["Accounts"],
          summary: "Get native XLM balance",
          parameters: [
            {
              name: "publicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "XLM balance",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "object",
                        properties: {
                          balance: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/accounts/resolve/{username}": {
        get: {
          tags: ["Accounts"],
          summary: "Resolve a username to a Stellar public key",
          parameters: [
            {
              name: "username",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Resolved public key",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "object",
                        properties: {
                          publicKey: { type: "string" },
                          username: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            404: { description: "Username not found" },
          },
        },
      },
      "/api/accounts/register": {
        post: {
          tags: ["Accounts"],
          summary: "Register a username for an account",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    publicKey: {
                      type: "string",
                      pattern: "^G[A-Z0-9]{55}$",
                    },
                    username: { type: "string" },
                  },
                  required: ["publicKey", "username"],
                },
              },
            },
          },
          responses: {
            200: { description: "Username registered" },
            409: { description: "Username already taken" },
          },
        },
      },
      "/api/payments/{publicKey}": {
        get: {
          tags: ["Payments"],
          summary: "Fetch payment history for an account",
          parameters: [
            {
              name: "publicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20, maximum: 100 },
              description: "Number of results per page",
            },
            {
              name: "cursor",
              in: "query",
              schema: { type: "string" },
              description: "Pagination cursor",
            },
          ],
          responses: {
            200: {
              description: "Payment history",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 100 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/PaymentRecord" },
                      },
                    },
                  },
                },
              },
            },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/api/payments/{publicKey}/stats": {
        get: {
          tags: ["Payments"],
          summary: "Get aggregate payment statistics",
          parameters: [
            {
              name: "publicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Payment stats",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: { $ref: "#/components/schemas/PaymentStats" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/analytics/{publicKey}/summary": {
        get: {
          tags: ["Analytics"],
          summary: "Get payment summary for an account",
          parameters: [
            {
              name: "publicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Analytics summary",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: { $ref: "#/components/schemas/AnalyticsSummary" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/analytics/{publicKey}/top-recipients": {
        get: {
          tags: ["Analytics"],
          summary: "Get top payment recipients",
          parameters: [
            {
              name: "publicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Top recipients",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/TopRecipient",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/analytics/{publicKey}/activity": {
        get: {
          tags: ["Analytics"],
          summary: "Get payment activity by day",
          parameters: [
            {
              name: "publicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Activity data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ActivityDay" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/tips/received/{creatorPublicKey}": {
        get: {
          tags: ["Tips"],
          summary: "Get tips received by a creator",
          parameters: [
            {
              name: "creatorPublicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Received tips",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Tip" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/tips/sent/{senderPublicKey}": {
        get: {
          tags: ["Tips"],
          summary: "Get tips sent by an account",
          parameters: [
            {
              name: "senderPublicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Sent tips",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Tip" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/tips/stats/{creatorPublicKey}": {
        get: {
          tags: ["Tips"],
          summary: "Get tip statistics for a creator",
          parameters: [
            {
              name: "creatorPublicKey",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
            },
          ],
          responses: {
            200: {
              description: "Tip stats",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: { $ref: "#/components/schemas/TipStats" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/tips": {
        post: {
          tags: ["Tips"],
          summary: "Record a new tip",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                    amount: { type: "string" },
                    memo: { type: "string" },
                    transactionHash: { type: "string" },
                  },
                  required: ["from", "to", "amount"],
                },
              },
            },
          },
          responses: {
            200: { description: "Tip recorded" },
            400: { description: "Invalid tip data" },
          },
        },
      },
      "/api/turrets": {
        get: {
          tags: ["Turrets"],
          summary: "List txFunction deployments",
          description: "Returns all deployments. Filter by owner using `ownerPublicKey` query parameter.",
          parameters: [
            {
              name: "ownerPublicKey",
              in: "query",
              required: false,
              schema: { type: "string", pattern: "^G[A-Z0-9]{55}$" },
              description: "Filter deployments by owner Stellar public key",
            },
          ],
          responses: {
            200: {
              description: "Array of deployments",
              headers: {
                "RateLimit-Limit": {
                  description: "Maximum requests allowed in the current window (20 per minute)",
                  schema: { type: "integer", example: 20 },
                },
                "RateLimit-Remaining": {
                  description: "Requests remaining in the current window",
                  schema: { type: "integer", example: 19 },
                },
                "RateLimit-Reset": {
                  description: "Seconds until the rate-limit window resets",
                  schema: { type: "integer", example: 45 },
                },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/TxFunctionDeployment" },
                      },
                    },
                  },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer" } },
                "RateLimit-Remaining": { schema: { type: "integer", example: 0 } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
            },
          },
        },
      },
      "/api/turrets/challenge": {
        post: {
          tags: ["Turrets"],
          summary: "Create a txFunction signing challenge",
          description: "Returns a ManageData transaction XDR that the user must sign with their Stellar keypair to prove ownership. The signed XDR is then passed to `POST /api/turrets/deploy`.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TxFunctionChallengeRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Challenge XDR and deployment hash",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 20 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      data: { $ref: "#/components/schemas/TxFunctionChallengeResponse" },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid request body (bad public key, unknown type, invalid config)" },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/api/turrets/deploy": {
        post: {
          tags: ["Turrets"],
          summary: "Deploy a signed txFunction",
          description: "Verifies the signed challenge and registers the txFunction. The runner begins evaluating the deployment immediately.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TxFunctionDeployRequest" },
              },
            },
          },
          responses: {
            201: {
              description: "Deployment created",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 20 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      data: { $ref: "#/components/schemas/TxFunctionDeployment" },
                    },
                  },
                },
              },
            },
            400: { description: "Config hash mismatch or invalid asset" },
            401: { description: "Signed challenge was not signed by the owner" },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/api/turrets/{id}": {
        get: {
          tags: ["Turrets"],
          summary: "Get a single txFunction deployment",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Deployment details",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 20 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      data: { $ref: "#/components/schemas/TxFunctionDeployment" },
                    },
                  },
                },
              },
            },
            404: { description: "Deployment not found" },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/api/turrets/{id}/history": {
        get: {
          tags: ["Turrets"],
          summary: "Get execution history for a deployment",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Execution log entries (most recent first)",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 20 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ExecutionLogEntry" },
                      },
                    },
                  },
                },
              },
            },
            404: { description: "Deployment not found" },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/api/turrets/{id}/pause": {
        post: {
          tags: ["Turrets"],
          summary: "Pause a txFunction deployment",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Updated deployment with status 'paused'",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 20 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
            },
            404: { description: "Deployment not found" },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/api/turrets/{id}/resume": {
        post: {
          tags: ["Turrets"],
          summary: "Resume a paused txFunction deployment",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Updated deployment with status 'active'",
              headers: {
                "RateLimit-Limit": { schema: { type: "integer", example: 20 } },
                "RateLimit-Remaining": { schema: { type: "integer" } },
                "RateLimit-Reset": { schema: { type: "integer" } },
              },
            },
            404: { description: "Deployment not found" },
            429: { description: "Rate limit exceeded" },
          },
        },
      },
      "/.well-known/stellar.toml": {
        get: {
          tags: ["Federation"],
          summary: "SEP-0001 Stellar TOML discovery document",
          responses: {
            200: {
              description: "TOML document containing the federation server URL",
              content: {
                "application/toml": {
                  schema: {
                    type: "string",
                    example: 'FEDERATION_SERVER="https://stellarmicropay.io/federation"',
                  },
                },
              },
            },
          },
        },
      },
      "/federation": {
        get: {
          tags: ["Federation"],
          summary: "SEP-0002 federation endpoint",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Federation query. Use user*domain for type=name or a public key for type=id.",
            },
            {
              name: "type",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["name", "id"] },
              description: "Query type",
            },
          ],
          responses: {
            200: {
              description: "Federation record",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      stellar_address: { type: "string", example: "alice*stellarmicropay.io" },
                      account_id: { type: "string", example: "GABC...XYZ" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing or invalid federation query" },
            404: { description: "Federation record not found" },
          },
        },
      },
    },
  },
  apis: [],
};

module.exports = swaggerJsdoc(options);
