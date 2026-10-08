/**
 * src/swagger.js
 * OpenAPI 3.0 specification for Stellar MicroPay backend API.
 */

"use strict";

const path = require("path");

const swaggerJsdoc = require("swagger-jsdoc");

// Route files scanned for JSDoc `@swagger` annotations. Federation, analytics,
// and turrets operations are documented in their route files; the remaining
// operations are defined statically in `definition.paths` below.
const routesGlob = `${path.join(__dirname, "routes").split(path.sep).join("/")}/*.js`;

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Stellar MicroPay API",
      version: "1.0.0",
      description:
        "Backend API for Stellar MicroPay — instant micropayments on the Stellar network.",
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
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "SEP-0010 JWT obtained from POST /api/auth",
        },
      },
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
            uniqueCounterparties: { type: "integer" },
            averageTransactionSize: { type: "string" },
            totalTransactions: { type: "integer" },
          },
        },
        TopRecipient: {
          type: "object",
          properties: {
            address: { type: "string" },
            totalXLMSent: { type: "string" },
          },
        },
        ActivityDay: {
          type: "object",
          properties: {
            day: { type: "string", example: "Monday" },
            dayIndex: { type: "integer", minimum: 0, maximum: 6 },
            transactionCount: { type: "integer" },
          },
        },
        TurretsChallenge: {
          type: "object",
          properties: {
            challengeXDR: {
              type: "string",
              description: "ManageData challenge transaction to sign and deploy.",
            },
            deploymentHash: { type: "string" },
            normalizedConfig: {
              type: "object",
              description: "Configuration after validation and normalization.",
            },
            networkPassphrase: { type: "string" },
          },
        },
        TxFunctionDeployment: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            ownerPublicKey: { type: "string" },
            type: { type: "string", enum: ["dca", "stop_loss"] },
            status: { type: "string", enum: ["active", "paused"] },
            config: { type: "object" },
            deploymentHash: { type: "string" },
            signedChallengeXDR: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            nextRunAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            lastExecutedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            lastCheckedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            lastObservedPriceUsd: {
              type: "number",
              nullable: true,
            },
            lastError: {
              type: "string",
              nullable: true,
            },
          },
        },
        ExecutionLogEntry: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            deploymentId: { type: "string", format: "uuid" },
            status: { type: "string", example: "executed" },
            message: { type: "string" },
            result: { type: "object", nullable: true },
            createdAt: { type: "string", format: "date-time" },
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
        AssetTrustline: {
          type: "object",
          properties: {
            assetCode: { type: "string", description: "Asset code (e.g. USDC)" },
            assetIssuer: { type: "string", description: "Issuing account public key" },
            balance: { type: "string", description: "Held balance" },
            limit: { type: "string", description: "Trustline limit" },
          },
        },
        StreamStatus: {
          type: "object",
          properties: {
            payer: { type: "string", description: "Payer Stellar address (contract Address)" },
            recipient: {
              type: "string",
              nullable: true,
              description: "First recipient address, or null when the stream has none",
            },
            ratePerLedger: { type: "string", description: "Tokens accrued per ledger (i128 as string)" },
            deposited: { type: "string", description: "Total deposited into the stream (i128 as string)" },
            claimed: { type: "string", description: "Total claimed by all recipients so far (i128 as string)" },
            startLedger: { type: "integer", description: "Ledger the stream started at" },
            claimableNow: { type: "string", description: "Derived unclaimed amount as of the latest ledger (i128 as string)" },
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
        Webhook: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            url: { type: "string", format: "uri" },
            publicKey: { type: "string" },
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
      "/api/accounts/{publicKey}/assets": {
        get: {
          tags: ["Accounts"],
          summary: "List non-native asset trustlines",
          description:
            "Returns every non-native balance the account holds a trustline for. " +
            "Native XLM is excluded — use `/api/accounts/{publicKey}` for full balances. " +
            "Requires a SEP-0010 JWT.",
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
              description: "Non-native asset trustlines",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/AssetTrustline" },
                      },
                    },
                  },
                },
              },
            },
            401: { description: "Missing, invalid, or expired JWT" },
            404: { description: "Account not found" },
            429: { description: "Rate limit exceeded" },
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
          },
        },
      },
      "/api/payments/stream-status/{streamId}": {
        get: {
          tags: ["Payments"],
          summary: "Get streaming payment channel state from the Soroban contract",
          description:
            "Reads the `Stream` entry from the deployed MicroPay contract's persistent storage " +
            "via Soroban RPC `getContractData` and returns its current state. The contract ID is " +
            "configured with the `CONTRACT_ID` environment variable. `claimableNow` mirrors the " +
            "contract's accrual logic (paused ledgers excluded, capped at the funded window).",
          parameters: [
            {
              name: "streamId",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 0, maximum: 4294967295 },
              description: "u32 stream id stored in the contract",
            },
          ],
          responses: {
            200: {
              description: "Current stream state",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: { $ref: "#/components/schemas/StreamStatus" },
                    },
                  },
                },
              },
            },
            400: { description: "streamId is not an unsigned 32-bit integer" },
            404: { description: "Stream not found in contract storage" },
            503: { description: "CONTRACT_ID not configured or Soroban RPC unavailable" },
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
      "/api/tips/leaderboard": {
        get: {
          tags: ["Tips"],
          summary: "Get the top XLM tip senders and recipients",
          responses: { 200: { description: "Community tip leaderboard" } },
        },
      },
      "/api/webhooks/register": {
        post: {
          tags: ["Webhooks"],
          summary: "Register a payment-event webhook",
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              type: "object",
              required: ["url", "publicKey", "secret"],
              properties: { url: { type: "string", format: "uri" }, publicKey: { type: "string" }, secret: { type: "string", format: "password" } },
            } } },
          },
          responses: { 201: { description: "Webhook registered", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } } }, 400: { description: "Invalid registration payload" } },
        },
      },
      "/api/webhooks/{id}": {
        delete: {
          tags: ["Webhooks"],
          summary: "Deregister a webhook",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { 204: { description: "Webhook removed" }, 404: { description: "Webhook not found" } },
        },
      },
      "/api/events/stream": {
        get: {
          tags: ["Events"],
          summary: "Stream Soroban contract events (Server-Sent Events)",
          description:
            "Opens a `text/event-stream` connection. Each message is a JSON envelope with a `kind` of `ready`, `event` or `status`.",
          parameters: [
            {
              name: "cursor",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Resume from a paging cursor returned by Soroban RPC",
            },
          ],
          responses: {
            200: {
              description: "Event stream",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
          },
        },
      },
    },
  },
  apis: [routesGlob],
};

module.exports = swaggerJsdoc(options);

