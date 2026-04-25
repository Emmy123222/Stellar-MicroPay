/**
* @file lib/stellar.ts
* @description Core Stellar blockchain interaction helpers for Stellar MicroPay.
* Uses the Horizon REST API — no private keys ever touch this module.
*
* @see {@link https://developers.stellar.org/docs/data/horizon | Stellar Horizon Docs}
* @see {@link https://stellar.github.io/js-stellar-sdk/ | stellar-sdk Reference}
*/

import {
  Horizon,
  Account,
  Transaction,
  Networks,
  Asset,
  Operation,
  TransactionBuilder,
  Memo,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  SorobanRpc,
  Federation,
} from "@stellar/stellar-sdk";

// ─── Config ────────────────────────────────────────────────────────────────

export interface NetworkConfig {
  network: "testnet" | "mainnet" | "custom";
  horizonUrl: string;
}

const DEFAULT_CONFIGS: Record<"testnet" | "mainnet", NetworkConfig> = {
  testnet: {
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  },
  mainnet: {
    network: "mainnet",
    horizonUrl: "https://horizon.stellar.org",
  },
};

export function getNetworkConfig(): NetworkConfig {
  if (typeof window === "undefined") {
    // Server-side: use env vars as fallback
    const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
    return DEFAULT_CONFIGS[network];
  }

  const stored = localStorage.getItem("stellar-micropay:network");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Invalid stored config, fall back to default
    }
  }

  // Default to testnet
  return DEFAULT_CONFIGS.testnet;
}

export function setNetworkConfig(config: NetworkConfig): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("stellar-micropay:network", JSON.stringify(config));
  }
}

// Get current network config
const config = getNetworkConfig();

// For backwards compatibility, keep these as computed values
export const NETWORK = config.network === "custom" ? "testnet" : config.network; // Default to testnet for custom
export const HORIZON_URL = config.horizonUrl;

/** The network passphrase is used to sign and verify transactions. */
export function getNetworkPassphrase(): string {
  const config = getNetworkConfig();
  return config.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

// For backwards compatibility
export const NETWORK_PASSPHRASE = getNetworkPassphrase();

/** Pre-configured Horizon server instance for the active network. */
let _server: Horizon.Server | null = null;
export function getServer(): Horizon.Server {
  const currentConfig = getNetworkConfig();
  if (!_server || _server.serverURL.toString() !== currentConfig.horizonUrl) {
    _server = new Horizon.Server(currentConfig.horizonUrl);
  }
  return _server;
}

// For backwards compatibility, export server as getter
export const server = new Proxy({} as Horizon.Server, {
  get(target, prop) {
    return getServer()[prop as keyof Horizon.Server];
  },
});

/**
 * USDC issuer (Circle) for the active network.
 *
 * If you intend to use USDC features on testnet, set `NEXT_PUBLIC_USDC_ISSUER`.
 */
export const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  // Default to mainnet Circle issuer. (App can still run without USDC usage.)
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

/** USDC asset helper. */
export const USDC = new Asset("USDC", USDC_ISSUER);

/** Known assets for trustline management. */
export const KNOWN_ASSETS = {
  testnet: [
    { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
    { code: "AQUA", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7" }, // Example issuer
    { code: "yXLM", issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55" }, // Example issuer
  ],
  mainnet: [
    { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
    { code: "AQUA", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7" }, // Example issuer
    { code: "yXLM", issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55" }, // Example issuer
  ],
};

/** Get known assets for the current network. */
export function getKnownAssets() {
  return KNOWN_ASSETS[NETWORK];
}

/** Soroban RPC server URL. Defaults to testnet. */
export function getSorobanRpcUrl(): string {
  const config = getNetworkConfig();
  if (config.network === "mainnet") {
    return "https://soroban.stellar.org";
  } else if (config.network === "testnet") {
    return "https://soroban-testnet.stellar.org";
  } else {
    // For custom networks, try to infer from Horizon URL
    const url = new URL(config.horizonUrl);
    return `https://soroban.${url.hostname}`;
  }
}

// For backwards compatibility
export const SOROBAN_RPC_URL = getSorobanRpcUrl();

/** Pre-configured Soroban RPC server instance. */
let _sorobanServer: SorobanRpc.Server | null = null;
export function getSorobanServer(): SorobanRpc.Server {
  const currentUrl = getSorobanRpcUrl();
  if (!_sorobanServer || _sorobanServer.serverURL.toString() !== currentUrl) {
    _sorobanServer = new SorobanRpc.Server(currentUrl);
  }
  return _sorobanServer;
}

// For backwards compatibility
export const sorobanServer = new Proxy({} as SorobanRpc.Server, {
  get(target, prop) {
    return getSorobanServer()[prop as keyof SorobanRpc.Server];
  },
});

/** The deployed Soroban contract ID for recording tips. */
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Enum for transaction categories.
 */
export enum TransactionCategory {
  Payment = "Payment",
  Transfer = "Transfer",
  Merge = "Merge",
  // Add more as needed
}

/**
 * Represents a single asset balance on a Stellar account.
*/
export interface WalletBalance {
  /** Full asset identifier, e.g. `"native"` or `"USDC:GA5ZSEJY..."` */
  asset: string;
  /** Human-readable balance string, e.g. `"100.0000000"` */
  balance: string;
  /** Short asset code shown in the UI, e.g. `"XLM"` or `"USDC"` */
  assetCode: string;
}

/**
 * Represents a trustline for a non-native asset.
 */
export interface Trustline {
  /** Asset code, e.g. "USDC" */
  assetCode: string;
  /** Asset issuer public key */
  issuer: string;
  /** Current balance */
  balance: string;
  /** Trust limit */
  limit: string;
}
/**
 * Represents a single transaction operation in a user's transaction history.
*/
export interface PaymentRecord {
  /** Unique operation ID assigned by Horizon. */
  id: string;
  /** Whether this payment was sent or received by the queried account. */
  type: "sent" | "received" | "merge";
  /** Whether this payment was sent or received by the queried account. */
  amount: string;
  /** Asset code, e.g. `"XLM"` */
  asset: string;
  /** Sender's Stellar public key. */
  from: string;
  /** Recipient's Stellar public key. */
  to: string;
  /** Optional memo text attached to the transaction. */
  memo?: string;
  /** ISO 8601 timestamp of when the operation was created. */
  createdAt: string;
  /** Hash of the parent transaction. */
  transactionHash: string;
  /** Horizon paging token used for cursor-based pagination. */
  pagingToken?: string;
  /** Category of the transaction. */
  category?: TransactionCategory;
}

/**
 * Response shape returned by {@link getPaymentHistory}.
*/
export interface PaymentHistoryResponse {
  /** Array of payment records for the requested page. */
  records: PaymentRecord[];
  /** Whether more records are available on the next page. */
  hasMore: boolean;
  /** Cursor string to pass into the next {@link getPaymentHistory} call. */
  nextCursor?: string | (() => any);
}

/**
 * Handle function invoked for each streamed payment operation.
 */
export type PaymentStreamHandler = (payment: PaymentRecord) => void;

/**
 * Function returned by {@link streamPayments} to stop the underlying EventSource.
 */
export type PaymentStreamUnsubscribe = () => void;

// ─── Account helpers ────────────────────────────────────────────────────────

/** Sentinel error message used to detect unfunded accounts in the UI. */
export const ACCOUNT_NOT_FOUND_ERROR = "ACCOUNT_NOT_FOUND";

/** Friendbot endpoint for Stellar testnet funding. */
export const FRIENDBOT_URL =
  process.env.NEXT_PUBLIC_FRIENDBOT_URL || "https://friendbot.stellar.org";

/** Polling options for waiting until an account exists on Horizon. */
export interface FundingPollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Fetch all trustlines (non-native asset balances) for a Stellar account.
 *
 * @param publicKey - The Stellar public key (G...) of the account to query.
 * @returns A promise resolving to an array of {@link Trustline} objects.
 * @throws {Error} With message `ACCOUNT_NOT_FOUND` if the account has never been funded.
 */
export async function getTrustlines(publicKey: string): Promise<Trustline[]> {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances
      .filter((b): b is Horizon.HorizonApi.BalanceLineAsset => b.asset_type !== "native")
      .map((b) => {
        const typed = b as Horizon.HorizonApi.BalanceLineAsset;
        return {
          assetCode: typed.asset_code,
          issuer: typed.asset_issuer,
          balance: typed.balance,
          limit: typed.limit,
        };
      });
  } catch (err: unknown) {
    // Horizon returns 404 for unfunded accounts — surface a sentinel so the
    // UI can offer the Friendbot funding button instead of a generic error.
    const horizonErr = err as { response?: { status?: number } };
    if (horizonErr?.response?.status === 404) {
      throw new Error(ACCOUNT_NOT_FOUND_ERROR);
    }
    console.error("Failed to load account trustlines:", err);
    throw new Error("Could not fetch account trustlines. Is this address funded?");
  }
}

/**
 * Fund an unfunded testnet account via Stellar Friendbot.
 * Only call this on testnet — Friendbot does not exist on mainnet.
 *
 * @param publicKey - The Stellar public key (G...) to fund.
 * @returns A promise that resolves when funding succeeds.
 * @throws {Error} If the Friendbot request fails.
 *
 * @see {@link https://developers.stellar.org/docs/learn/networks | Stellar Networks}
 */
export async function fundWithFriendbot(publicKey: string): Promise<void> {
  await getFriendBotFunding(publicKey);
}

/**
 * Fund an unfunded account through Stellar Friendbot.
 *
 * Guarded to testnet only.
 */
export async function getFriendBotFunding(publicKey: string): Promise<void> {
  if (NETWORK !== "testnet") {
    throw new Error("Friendbot is only available on Stellar testnet.");
  }

  const res = await fetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`
  );

  if (!res.ok) {
    throw new Error(`Friendbot failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Wait until Horizon can load an account after funding.
 *
 * Returns true once the account is visible on Horizon, false on timeout.
 */
export async function waitForAccountFunding(
  publicKey: string,
  options: FundingPollOptions = {}
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 20000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await getXLMBalance(publicKey);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      const isUnfundedError =
        msg === ACCOUNT_NOT_FOUND_ERROR ||
        msg.includes("404") ||
        msg.toLowerCase().includes("not found");

      if (!isUnfundedError) {
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Fetch only the native XLM balance for an account.
 *
 * @param publicKey - The Stellar public key (G...) of the account to query.
 * @returns A promise resolving to the XLM balance string, e.g. `"100.0000000"`.
 *          Returns `"0"` if no native balance entry is found.
 * @throws {Error} If the underlying {@link getBalances} call fails.
*/

export async function getXLMBalance(publicKey: string): Promise<string> {
  const balances = await getBalances(publicKey);
  const xlm = balances.find((b) => b.assetCode === "XLM");
  return xlm ? xlm.balance : "0";
}

/**
 * Fetch the USDC (Circle) balance for a Stellar account.
 * Returns null if the account has no USDC trustline.
 */
export async function getUSDCBalance(publicKey: string): Promise<string | null> {
  try {
    const balances = await getBalances(publicKey);
    const usdc = balances.find(
      (b) => b.asset === `USDC:${USDC_ISSUER}`
    );
    return usdc ? usdc.balance : null;
  } catch {
    return null;
  }
}

/**
 * Build an unsigned changeTrust transaction to add or remove a trustline.
 *
 * @param params - Trustline parameters.
 * @param params.fromPublicKey - The account adding/removing the trustline.
 * @param params.assetCode - Asset code, e.g. "USDC".
 * @param params.issuer - Asset issuer public key.
 * @param params.limit - Trust limit. Use "0" to remove the trustline.
 * @returns A promise resolving to an unsigned {@link Transaction} object.
 * @throws {Error} If the source account cannot be loaded from Horizon.
 */
export async function buildChangeTrustTransaction({
  fromPublicKey,
  assetCode,
  issuer,
  limit = "922337203685.4775807", // Max limit for adding
}: {
  fromPublicKey: string;
  assetCode: string;
  issuer: string;
  limit?: string;
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);

  const asset = new Asset(assetCode, issuer);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: asset,
        limit: limit,
      })
    )
    .setTimeout(60);

  return builder.build();
}

/**
 * Build an unsigned XLM payment transaction ready for Freighter to sign.
  fromPublicKey,
  toPublicKey,
  amount,
  memo,
  asset = "XLM",
}: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
  asset?: "XLM" | "USDC";
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);

  // For USDC, verify the recipient has a trustline before building the tx
  if (asset === "USDC") {
    const recipient = await server.loadAccount(toPublicKey).catch(() => null);
    if (!recipient) {
      throw new Error("Recipient account not found on the Stellar network.");
    }
    const hasTrustline = recipient.balances.some(
      (b): b is Horizon.HorizonApi.BalanceLineAsset =>
        b.asset_type !== "native" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === "USDC" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === USDC_ISSUER
    );
    if (!hasTrustline) {
      throw new Error(
        "Recipient has no USDC trustline. They must add USDC to their Stellar wallet first."
      );
    }
  }

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "100", // 100 stroops = 0.00001 XLM
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: toPublicKey,
        asset: asset === "USDC" ? USDC : Asset.native(),
        amount: amount,
      })
    )
    .setTimeout(60); // 60 second validity window

  if (memo) {
    builder.addMemo(Memo.text(memo.slice(0, 28))); // Stellar memo max 28 bytes
  }

  return builder.build();
}

/**
 * Build an unsigned Stellar account merge transaction ready for Freighter to sign.
 *
 * @param params - Merge parameters.
 * @param params.fromPublicKey - Source account public key (will be closed).
 * @param params.destinationPublicKey - Destination account public key.
 * @returns A promise resolving to an unsigned {@link Transaction} object.
 */
export async function buildAccountMergeTransaction({
  fromPublicKey,
  destinationPublicKey,
}: {
  fromPublicKey: string;
  destinationPublicKey: string;
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.accountMerge({
        destination: destinationPublicKey,
      })
    )
    .setTimeout(60);

  return builder.build();
}

/**
 * Submit a signed transaction XDR string to the Stellar network.
 *
 * Deserializes the XDR envelope, submits it to Horizon, and returns the
 * full submission result. On failure, extracts Horizon result codes and
 * throws a descriptive error.
 *
 * @param signedXDR - The base64-encoded signed transaction XDR string,
 *                    typically produced by Freighter's `signTransaction`.
 * @returns A promise resolving to the Horizon transaction submission result.
 * @throws {Error} With Horizon result codes if the transaction is rejected.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/transactions/submit | Horizon Submit Transaction}
 *
 * @example
 * ```ts
 * const signedXDR = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
 * const result = await submitTransaction(signedXDR);
 * console.log("Transaction hash:", result.hash);
 * ```
*/
export async function submitTransaction(signedXDR: string) {
  const transaction = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  try {
    const result = await server.submitTransaction(transaction);
    return result;
  } catch (err: unknown) {
    const horizonErr = err as { response?: { data?: { extras?: { result_codes?: unknown } } } };
    if (horizonErr?.response?.data?.extras?.result_codes) {
      const codes = horizonErr.response.data.extras.result_codes;
      throw new Error(`Transaction failed: ${JSON.stringify(codes)}`);
    }
    throw err;
  }
}

// ─── Payment history ─────────────────────────────────────────────────────────

/**
 * Fetch recent payment operations for a Stellar account with cursor-based pagination.
 *
 * Queries Horizon for `payment` type operations, enriches each record with
 * the transaction memo, and returns a structured response including a cursor
 * for fetching the next page.
 *
 * @param publicKey - The Stellar public key (G...) of the account to query.
 * @param limit - Maximum number of records to return per page. Defaults to `20`.
 * @param cursor - Paging token from a previous response's `nextCursor` field.
 *                 Omit to start from the most recent payment.
 * @returns A promise resolving to a {@link PaymentHistoryResponse}.
 * @throws {Error} If the Horizon payments request fails.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/operations/payments | Horizon Payments API}
 *
 * @example
 * ```ts
 * // First page
 * const page1 = await getPaymentHistory("GABC...XYZ");
 * console.log(page1.records);
 *
 * // Next page using cursor
 * if (page1.hasMore) {
 *   const page2 = await getPaymentHistory("GABC...XYZ", 20, page1.nextCursor as string);
 * }
 * ```
 */
export async function getPaymentHistory(
  publicKey: string,
  limit = 20,
  cursor?: string
): Promise<PaymentHistoryResponse> {
  let operationsBuilder = server
    .operations()
    .forAccount(publicKey)
    .limit(limit)
    .order("desc");

  if (cursor) {
    operationsBuilder = operationsBuilder.cursor(cursor);
  }

  const operations = await operationsBuilder.call();

  const records: PaymentRecord[] = [];

  for (const op of operations.records) {
    let record: PaymentRecord | null = null;

    if (op.type === "payment") {
      const payment = op as Horizon.HorizonApi.PaymentOperationResponse;

      // Fetch transaction for memo
      let memo: string | undefined;
      try {
        const tx = await server.transactions().transaction(payment.transaction_hash).call();
        if (tx.memo && tx.memo_type === "text") {
          memo = tx.memo;
        }
      } catch {
        // memo is optional, don't fail
      }

      const assetCode =
        payment.asset_type === "native" ? "XLM" : payment.asset_code || "???";

      record = {
        id: payment.id,
        type: payment.from === publicKey ? "sent" : "received",
        amount: payment.amount,
        asset: assetCode,
        from: payment.from,
        to: payment.to,
        memo,
        createdAt: payment.created_at,
        transactionHash: payment.transaction_hash,
        pagingToken: payment.paging_token,
        category: TransactionCategory.Payment,
      };
    } else if (op.type === "account_merge") {
      const merge = op as Horizon.HorizonApi.AccountMergeOperationResponse;

      record = {
        id: merge.id,
        type: "merge",
        amount: "0", // Account merge doesn't have an amount
        asset: "XLM",
        from: merge.account, // The account being merged
        to: merge.into, // The destination account
        createdAt: merge.created_at,
        transactionHash: merge.transaction_hash,
        pagingToken: merge.paging_token,
        category: TransactionCategory.Merge,
      };
    }

    if (record) {
      records.push(record);
    }
  }

  return {
    records,
    hasMore: operations.records.length === limit && !!operations.next,
    nextCursor: operations.next ? operations.next.toString() : undefined,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Shorten a Stellar public key for display purposes.
 *
 * @param address - Full Stellar public key string (G...).
 * @param chars - Number of characters to keep at each end. Defaults to `6`.
 * @returns Shortened string in the format `GABC...XYZ`.
 *          Returns the original string unchanged if it is too short to shorten.
 *
 * @example
 * ```ts
 * shortenAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
 * // → "GAAZI4...CCWN"
 * ```
*/
export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Validate whether a string is a well-formed Stellar public key.
 *
 * Checks for the `G` prefix followed by exactly 55 uppercase alphanumeric
 * characters (base32 alphabet), for a total length of 56 characters.
 *
 * @param address - The string to validate.
 * @returns `true` if the address matches the Stellar public key format, `false` otherwise.
 *
 * @example
 * ```ts
 * isValidStellarAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"); // true
 * isValidStellarAddress("not-a-key"); // false
 * ```
*/
export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

/**
 * Generate a Stellar Expert explorer URL for a given transaction hash.
 *
 * @param hash - The transaction hash to link to.
 * @returns Full URL string pointing to the transaction on Stellar Expert.
 *
 * @see {@link https://stellar.expert | Stellar Expert Explorer}
 *
 * @example
 * ```ts
 * explorerUrl("abc123...");
 * // → "https://stellar.expert/explorer/testnet/tx/abc123..."
 * ```
*/
export function explorerUrl(hash: string): string {
  const net = NETWORK === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/tx/${hash}`;
}

/**
 * Build a Soroban contract invocation transaction to call `send_tip()`.
 *
 * This function calls the deployed smart contract to record a tip.
 * It handles simulation (preflight) to automatically set the correct
 * footprint and resource fees.
 *
 * @param params - Tip parameters.
 * @param params.fromPublicKey - Sender's public key (G...).
 * @param params.toPublicKey - Recipient's public key (G...).
 * @param params.amount - XLM amount as a string (e.g. "0.5").
 * @returns A promise resolving to a built and preflighted {@link Transaction}.
 */
export async function buildSorobanTipTransaction({
  fromPublicKey,
  toPublicKey,
  amount,
}: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
}): Promise<Transaction> {
  if (!CONTRACT_ID) {
    throw new Error("Contract ID is not configured.");
  }

  const sourceAccount = await server.loadAccount(fromPublicKey);
  const contract = new Contract(CONTRACT_ID);

  // Derive the XLM Asset Contract ID
  const xlmContractId = Asset.native().contractId(NETWORK_PASSPHRASE);

  // Convert XLM amount to stroops (1 XLM = 10,000,000 stroops)
  const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));

  // Prepare the `send_tip` invocation
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "send_tip",
        nativeToScVal(xlmContractId, { type: "address" }),
        nativeToScVal(fromPublicKey, { type: "address" }),
        nativeToScVal(toPublicKey, { type: "address" }),
        nativeToScVal(stroops, { type: "i128" })
      )
    )
    .setTimeout(60)
    .build();

  // Preflight: Simulate the transaction to get resources and fees
  const simulated = await sorobanServer.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  // Assemble the transaction with simulation results
  return sorobanServer.prepareTransaction(tx);
}

/**
 * Query the total tips recorded on-chain for a specific recipient.
 *
 * @param recipient - The Stellar public key of the recipient.
 * @returns A promise resolving to the total tips in stroops as a string.
 */
export async function getContractTipTotal(recipient: string): Promise<string> {
  if (!CONTRACT_ID) return "0";

  try {
    const contract = new Contract(CONTRACT_ID);

    // Create a dummy transaction to simulate the getter call
    // Alternatively, we could use getLedgerEntries if we knew the storage key format,
    // but simulation is more robust for contract getters.
    const tx = new TransactionBuilder(
      new Account(recipient, "0"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
    )
      .addOperation(
        contract.call("get_tip_total", nativeToScVal(recipient, { type: "address" }))
      )
      .setTimeout(30)
      .build();

    const sim = await sorobanServer.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result) {
      const value = scValToNative(sim.result.retval);
      return value.toString();
    }

    return "0";
  } catch (err) {
    console.error("Failed to query tip total:", err);
    return "0";
  }
}

/**
 * Fetch the last N payment transactions for sparkline chart rendering.
 * Returns records in chronological order (oldest first) so the chart
 * reads left-to-right over time.
 *
 * @param publicKey - Stellar public key (G...) of the account.
 * @param limit - Number of recent payments to fetch. Defaults to `10`.
 * @returns Array of {@link PaymentRecord} sorted oldest → newest.
 */
export async function getRecentPaymentsForSparkline(
  publicKey: string,
  limit = 10
): Promise<PaymentRecord[]> {
  const { records } = await getPaymentHistory(publicKey, limit);
  // getPaymentHistory returns newest-first; reverse for chronological order
  return records.slice().reverse();
}

/**
 * Start a server-sent events (SSE) stream of payment operations for an account.
 *
 * Uses Horizon's streaming support under the hood via the JS SDK. New payment
 * operations are normalized into {@link PaymentRecord} objects and passed to
 * the provided {@link PaymentStreamHandler}.
 *
 * The stream starts from `cursor("now")` so only *new* payments are delivered,
 * and it is ordered ascending for consistent event ordering.
 *
 * @param publicKey - Stellar public key (G...) to stream payments for.
 * @param onPayment - Callback fired for each normalized payment record.
 * @param onError - Optional error handler for stream errors.
 * @returns Function to close the underlying EventSource and stop streaming.
 */
export function streamPayments(
  publicKey: string,
  onPayment: PaymentStreamHandler,
  onError?: (error: unknown) => void
): PaymentStreamUnsubscribe {
  const paymentsBuilder = server
    .payments()
    .forAccount(publicKey)
    .order("asc")
    .cursor("now");

  const close = paymentsBuilder.stream({
    onmessage: async (op: any) => {
      if (op.type !== "payment") return;

      const payment = op as Horizon.HorizonApi.PaymentOperationResponse;

      // Best-effort fetch of the parent transaction memo
      let memo: string | undefined;
      try {
        const tx = await server
          .transactions()
          .transaction(payment.transaction_hash)
          .call();
        if (tx.memo && tx.memo_type === "text") {
          memo = tx.memo;
        }
      } catch {
        // memo is optional; ignore failures
      }

      const assetCode =
        payment.asset_type === "native" ? "XLM" : payment.asset_code || "???";

      const record: PaymentRecord = {
        id: payment.id,
        type: payment.from === publicKey ? "sent" : "received",
        amount: payment.amount,
        asset: assetCode,
        from: payment.from,
        to: payment.to,
        memo,
        createdAt: payment.created_at,
        transactionHash: payment.transaction_hash,
        pagingToken: payment.paging_token,
        category: TransactionCategory.Payment,
      };

      onPayment(record);
    },
    onerror: (error: unknown) => {
      console.error("Payment stream error:", error);
      onError?.(error);
    },
  });

  return () => {
    try {
      close?.();
    } catch {
      // swallow errors on close
    }
  };
}

/**
 * Resolve a Stellar Federation address (user*domain.com) to a Stellar public key.
 *
 * Uses the Stellar Federation protocol to perform lookups using the federation
 * server specified in the domain's stellar.toml file.
 *
 * @param federationAddress - The federation address to resolve (e.g., "alice*stellar.org")
 * @returns A promise resolving to the Stellar public key (G...).
 * @throws Error if the federation address is invalid or resolution fails.
 *
 * @example
 * ```ts
 * const publicKey = await resolveFederationAddress("alice*stellar.org");
 * // → "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ"
 * ```
 */
export async function resolveFederationAddress(
  federationAddress: string
): Promise<string> {
  // Basic validation: federation addresses should contain exactly one @
  if (!federationAddress.includes("*")) {
    throw new Error(
      'Invalid federation address format. Expected "user*domain.com"'
    );
  }

  try {
    const record = await Federation.Server.resolve(federationAddress);
    return record.account_id;
  } catch (error) {
    throw new Error(
      `Federation lookup failed for "${federationAddress}": ${error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
