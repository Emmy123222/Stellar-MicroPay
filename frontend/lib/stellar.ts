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
  get(target, prop, receiver) {
    if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
    const currentServer = getServer();
    const value = currentServer[prop as keyof Horizon.Server];
    return typeof value === "function" ? value.bind(currentServer) : value;
  },
});

/** One XLM is divided into 10,000,000 stroops, Stellar's smallest unit. */
export const STELLAR_STROOPS_PER_XLM = 10_000_000;

/** Stellar's protocol minimum operation fee is 100 stroops. */
export const STELLAR_BASE_FEE_STROOPS = 100;

/** Default network fee in XLM, derived from the base fee in stroops. */
export const STELLAR_BASE_FEE_XLM =
  STELLAR_BASE_FEE_STROOPS / STELLAR_STROOPS_PER_XLM;

/** Transactions built for wallet signing expire after 60 seconds. */
export const STELLAR_TRANSACTION_TIMEOUT_SECONDS = 60;

/** Stellar MEMO_TEXT values are capped at 28 UTF-8 bytes by the protocol. */
export const STELLAR_MEMO_TEXT_MAX_BYTES = 28;

/** A base Stellar account must keep two reserve units before subentries. */
export const STELLAR_BASE_ACCOUNT_RESERVE_COUNT = 2;

export function memoTextByteLength(memo: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(memo).length;
  return encodeURIComponent(memo).replace(/%[0-9A-F]{2}/gi, "x").length;
}

/**
 * Stellar base reserve in XLM.
 *
 * Each account holds (2 + subentry_count) base reserves of 0.5 XLM. Trustlines,
 * offers, signers, and data entries each count as one subentry.
 *
 * @see https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#base-reserves
 */
export const STELLAR_BASE_RESERVE_XLM = 0.5;

/** Minimum XLM balance for an account with no subentries. */
export const STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM =
  STELLAR_BASE_ACCOUNT_RESERVE_COUNT * STELLAR_BASE_RESERVE_XLM;

const STELLAR_BASE_FEE_STROOPS_STRING = String(STELLAR_BASE_FEE_STROOPS);
const ELEVATED_FEE_MAX_STROOPS = STELLAR_BASE_FEE_STROOPS * 10;

export function truncateMemoText(memo: string): string {
  if (memoTextByteLength(memo) <= STELLAR_MEMO_TEXT_MAX_BYTES) {
    return memo;
  }

  let truncated = "";
  for (const char of memo) {
    const next = truncated + char;
    if (memoTextByteLength(next) > STELLAR_MEMO_TEXT_MAX_BYTES) {
      break;
    }
    truncated = next;
  }

  return truncated;
}

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
  nextCursor?: string;
}

// DEX Types
export interface OrderbookEntry {
  price: string;
  amount: string;
}

export interface Orderbook {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
}


export interface NetworkStats {
  latestLedgerSequence: number;
  lastLedgerCloseTime: string;
  avgTransactionCount: number;
  currentBaseFee: number;
  p50Fee: number;
  p95Fee: number;
  p99Fee: number;
}

export interface FetchAllPaymentsProgress {
  fetchedRecords: number;
  fetchedPages: number;
  done: boolean;
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
 * Fetch all asset balances for a Stellar account.
 *
 * @param publicKey - The Stellar public key (G...) of the account to query.
 * @returns A promise resolving to an array of {@link WalletBalance} objects.
 * @throws {Error} With message `ACCOUNT_NOT_FOUND` if the account has never been funded.
 */
export async function getBalances(publicKey: string): Promise<WalletBalance[]> {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances.map((b) => {
      if (b.asset_type === "native") {
        return {
          asset: "native",
          balance: b.balance,
          assetCode: "XLM",
        };
      }
      const typed = b as Horizon.HorizonApi.BalanceLineAsset;
      return {
        asset: `${typed.asset_code}:${typed.asset_issuer}`,
        balance: typed.balance,
        assetCode: typed.asset_code,
      };
    });
  } catch (err: unknown) {
    const horizonErr = err as { response?: { status?: number } };
    if (horizonErr?.response?.status === 404) {
      throw new Error(ACCOUNT_NOT_FOUND_ERROR);
    }
    throw err;
  }
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
  const xlm = balances.find((b: WalletBalance) => b.assetCode === "XLM");
  return xlm ? xlm.balance : "0";
}

/**
 * Returns the minimum XLM balance required for an account with the given
 * subentry count.
 */
export function calculateMinimumBalance(subentryCount: number): number {
  const safeSubentryCount = Number.isFinite(subentryCount) && subentryCount >= 0
    ? subentryCount
    : 0;
  return (
    STELLAR_BASE_ACCOUNT_RESERVE_COUNT + safeSubentryCount
  ) * STELLAR_BASE_RESERVE_XLM;
}

export interface AccountReserveInfo {
  /** Total XLM held by the account (native balance). */
  xlmBalance: number;
  /** Number of subentries on the account (trustlines + offers + signers + data). */
  subentryCount: number;
  /** Minimum balance the account must keep to remain submittable. */
  minimumBalance: number;
  /** XLM available to spend without breaching the reserve. */
  spendableBalance: number;
}

/**
 * Loads native balance + subentry count and derives the reserve numbers in a
 * single Horizon call. Returns `null` when the account is unfunded so callers
 * can show the Friendbot path instead of a generic error.
 */
export async function getAccountReserveInfo(
  publicKey: string
): Promise<AccountReserveInfo | null> {
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find((b) => b.asset_type === "native");
    const xlmBalance = native ? Number(native.balance) : 0;
    const subentryCount = account.subentry_count ?? 0;
    const minimumBalance = calculateMinimumBalance(subentryCount);

    return {
      xlmBalance,
      subentryCount,
      minimumBalance,
      spendableBalance: Math.max(0, xlmBalance - minimumBalance),
    };
  } catch (err: unknown) {
    const horizonErr = err as { response?: { status?: number } };
    if (horizonErr?.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Fetch the USDC (Circle) balance for a Stellar account.
 * Returns null if the account has no USDC trustline.
 */
export async function getUSDCBalance(publicKey: string): Promise<string | null> {
  try {
    const balances = await getBalances(publicKey);
    const usdc = balances.find(
      (b: WalletBalance) => b.asset === `USDC:${USDC_ISSUER}`
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
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: asset,
        limit: limit,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS);

  return builder.build();
}

/**
 * Build an unsigned XLM payment transaction ready for Freighter to sign.
 */
export async function buildPaymentTransaction({
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
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: toPublicKey,
        asset: asset === "USDC" ? USDC : Asset.native(),
        amount: amount,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS);

  if (memo) {
    builder.addMemo(Memo.text(truncateMemoText(memo)));
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
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.accountMerge({
        destination: destinationPublicKey,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS);

  return builder.build();
}

// ── Custom asset issuance (#1147) ─────────────────────────────────────────

/** Shortest allowed custom asset code. */
export const ASSET_CODE_MIN_LENGTH = 1;

/** Longest asset code the Stellar protocol accepts. */
export const ASSET_CODE_MAX_LENGTH = 12;

/** Codes the protocol reserves, e.g. the native asset. */
export const RESERVED_ASSET_CODES = ["XLM"];

/**
 * Validate a custom asset code.
 *
 * Stellar asset codes are 1–12 characters of uppercase `A–Z` and `0–9`. Spaces,
 * lowercase letters and symbols are rejected, and `XLM` is reserved for the
 * native asset.
 *
 * @param code - The candidate asset code.
 * @returns `null` when the code is valid, otherwise a human-readable reason.
 */
export function validateAssetCode(code: string): string | null {
  if (!code) return "Enter an asset code.";

  if (code.length < ASSET_CODE_MIN_LENGTH || code.length > ASSET_CODE_MAX_LENGTH) {
    return `Asset code must be between ${ASSET_CODE_MIN_LENGTH} and ${ASSET_CODE_MAX_LENGTH} characters.`;
  }

  if (/\s/.test(code)) return "Asset code cannot contain spaces.";

  if (!/^[A-Z0-9]+$/.test(code)) {
    return "Asset code must use uppercase letters and numbers only.";
  }

  if (RESERVED_ASSET_CODES.includes(code)) {
    return `${code} is reserved for the native Stellar asset.`;
  }

  return null;
}

/**
 * Validate a home domain (the domain publishing a SEP-0001 `stellar.toml`).
 *
 * @returns `null` when valid or empty (the field is optional).
 */
export function validateHomeDomain(domain: string): string | null {
  if (!domain.trim()) return null;

  const hostname = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostname)) {
    return "Enter a valid domain, e.g. example.com";
  }

  return null;
}

/**
 * Build an unsigned payment of a custom asset from the issuer to a
 * distributor — the "issue" half of asset issuance.
 *
 * The distributor must already hold a trustline for the asset, otherwise
 * Stellar rejects the payment.
 *
 * @throws {Error} If the asset code is invalid or the issuer account cannot be loaded.
 */
export async function buildAssetIssueTransaction({
  issuerPublicKey,
  distributorPublicKey,
  assetCode,
  amount,
}: {
  issuerPublicKey: string;
  distributorPublicKey: string;
  assetCode: string;
  amount: string;
}): Promise<Transaction> {
  const codeError = validateAssetCode(assetCode);
  if (codeError) throw new Error(codeError);

  const sourceAccount = await server.loadAccount(issuerPublicKey);

  return new TransactionBuilder(sourceAccount, {
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: distributorPublicKey,
        asset: new Asset(assetCode, issuerPublicKey),
        amount,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
    .build();
}

/**
 * Build an unsigned `setOptions` transaction that sets an account's home domain.
 *
 * The domain must serve a `stellar.toml` under `/.well-known/` for wallets and
 * explorers to discover the issuer's asset metadata (SEP-0001).
 */
export async function buildHomeDomainTransaction({
  publicKey,
  homeDomain,
}: {
  publicKey: string;
  homeDomain: string;
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(publicKey);

  return new TransactionBuilder(sourceAccount, {
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.setOptions({ homeDomain }))
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
    .build();
}

/** Stellar Expert URL for an issued asset, e.g. `.../asset/COOL-GABC...`. */
export function assetExplorerUrl(assetCode: string, issuer: string): string {
  const net = NETWORK === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/asset/${assetCode}-${issuer}`;
}

/** SEP-0001 `stellar.toml` location for a home domain. */
export function stellarTomlUrl(homeDomain: string): string {
  const hostname = homeDomain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  return `https://${hostname}/.well-known/stellar.toml`;
}

/**
 * Render the `stellar.toml` an issuer should publish for a custom asset.
 *
 * Returning it as a string lets the wizard offer a preview, a copy button and a
 * download without the user hand-writing TOML.
 */
export function buildStellarToml({
  homeDomain,
  assetCode,
  issuerPublicKey,
  network,
}: {
  homeDomain: string;
  assetCode: string;
  issuerPublicKey: string;
  network?: "testnet" | "mainnet";
}): string {
  const activeNetwork = network ?? NETWORK;
  const accounts = [issuerPublicKey];

  if (activeNetwork === "mainnet") {
    accounts.push("GCO2IP3MCPLXT4GMQ5H7UQRCLHH3QDEM7SY6DNNJDAW6DGRITQKHXVV");
  }

  const domain =
    homeDomain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "") ||
    "yourdomain.com";

  return [
    "# Stellar MicroPay — generated asset metadata (SEP-0001)",
    `VERSION = "1.0.0"`,
    `NETWORK_PASSPHRASE = "${
      activeNetwork === "mainnet" ? Networks.PUBLIC : Networks.TESTNET
    }"`,
    "",
    "[[CURRENCIES]]",
    `code = "${assetCode}"`,
    `issuer = "${issuerPublicKey}"`,
    "is_asset_anchored = false",
    `desc = "${assetCode} issued via Stellar MicroPay"`,
    "",
    "# Liquidity/explorer accounts that must be trusted for mainnet listings.",
    "ACCOUNTS = [",
    ...accounts.map((account) => `  "${account}",`),
    "]",
    "",
    `# Publish this file at: ${stellarTomlUrl(domain)}`,
    "",
  ].join("\n");
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
  const transaction = TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE) as Transaction;
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

/**
 * Collect signatures from multiple co-signers and combine them into a single signed XDR.
 *
 * @param unsignedXDR - The unsigned transaction XDR string.
 * @param signedXDRs - Array of signed XDR strings from co-signers.
 * @returns A promise resolving to the combined signed XDR string.
 * @throws {Error} If the unsigned XDR is invalid or signature collection fails.
 *
 * @example
 * ```ts
 * const combinedXDR = await collectSignatures(unsignedXDR, [signedXDR1, signedXDR2]);
 * const result = await submitTransaction(combinedXDR);
 * ```
 */
export async function collectSignatures(unsignedXDR: string, signedXDRs: string[]): Promise<string> {
  try {
    // Parse the unsigned transaction
    const transaction = new Transaction(unsignedXDR, NETWORK_PASSPHRASE);

    // Collect signatures from each signed XDR
    for (const signedXDR of signedXDRs) {
      const signedTx = new Transaction(signedXDR, NETWORK_PASSPHRASE);
      // Add each signature from the signed transaction
      for (const sig of signedTx.signatures) {
        // Check if signature already exists to avoid duplicates
        const exists = transaction.signatures.some(existing =>
          existing.hint().equals(sig.hint()) &&
          existing.signature().equals(sig.signature())
        );
        if (!exists) {
          transaction.signatures.push(sig);
        }
      }
    }

    return transaction.toXDR();
  } catch (err: unknown) {
    console.error("Failed to collect signatures:", err);
    throw new Error("Invalid transaction XDR or signature collection failed.");
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
      const merge = op as any; // Cast to any to access Horizon properties that might be missing in type definitions

      record = {
        id: merge.id,
        type: "merge",
        amount: "0", // Account merge doesn't have an amount
        asset: "XLM",
        from: merge.account || merge.source_account, // Handle potential variations in property names
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

/**
 * Fetches full payment history by following Horizon paging cursors until exhausted.
 * Use this for exports that must include complete account history.
 */
export async function fetchAllPayments(
  publicKey: string,
  options: {
    pageSize?: number;
    maxPages?: number;
    onProgress?: (progress: FetchAllPaymentsProgress) => void;
  } = {}
): Promise<PaymentRecord[]> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 200, 200));
  const maxPages = Math.max(1, options.maxPages ?? 1000);

  let cursor: string | undefined;
  let pageCount = 0;
  const allRecords: PaymentRecord[] = [];

  while (pageCount < maxPages) {
    let operationsBuilder = server
      .operations()
      .forAccount(publicKey)
      .limit(pageSize)
      .order("desc");

    if (cursor) {
      operationsBuilder = operationsBuilder.cursor(cursor);
    }

    const operations = await operationsBuilder.call();
    pageCount += 1;

    let pageRecordsCount = 0;
    for (const op of operations.records) {
      if (op.type !== "payment") continue;

      const payment = op as Horizon.HorizonApi.PaymentOperationResponse;
      const assetCode =
        payment.asset_type === "native" ? "XLM" : payment.asset_code || "???";

      allRecords.push({
        id: payment.id,
        type: payment.from === publicKey ? "sent" : "received",
        amount: payment.amount,
        asset: assetCode,
        from: payment.from,
        to: payment.to,
        createdAt: payment.created_at,
        transactionHash: payment.transaction_hash,
        pagingToken: payment.paging_token,
        category: TransactionCategory.Payment,
      });
      pageRecordsCount += 1;
    }

    const lastRecord = operations.records[operations.records.length - 1];
    if (!lastRecord || !("paging_token" in lastRecord)) {
      options.onProgress?.({
        fetchedRecords: allRecords.length,
        fetchedPages: pageCount,
        done: true,
      });
      break;
    }

    cursor = String(lastRecord.paging_token);
    const reachedEnd = operations.records.length < pageSize || pageRecordsCount === 0;

    options.onProgress?.({
      fetchedRecords: allRecords.length,
      fetchedPages: pageCount,
      done: reachedEnd || pageCount >= maxPages,
    });

    if (reachedEnd) break;
  }

  return allRecords;
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

  const stroops = BigInt(Math.round(parseFloat(amount) * STELLAR_STROOPS_PER_XLM));

  // Prepare the `send_tip` invocation
  const tx = new TransactionBuilder(sourceAccount, {
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
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
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
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
      { fee: STELLAR_BASE_FEE_STROOPS_STRING, networkPassphrase: NETWORK_PASSPHRASE }
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

// ─── NFT Receipts ───────────────────────────────────────────────────────────

/**
 * Build a Soroban contract invocation to mint a payment receipt (NFT).
 * Simulates/preflights the transaction so it's ready for signing.
 */
export async function buildReceiptMintTransaction({
  fromPublicKey,
  toPublicKey,
  amount,
  memo,
}: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
}): Promise<Transaction> {
  if (!CONTRACT_ID) {
    throw new Error("Contract ID is not configured.");
  }

  const sourceAccount = await server.loadAccount(fromPublicKey);
  const contract = new Contract(CONTRACT_ID);

  const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
  const memoStr = (memo ?? "").slice(0, 28);
  const memoScVal = nativeToScVal(memoStr, { type: "symbol" });

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "mint_receipt",
        nativeToScVal(fromPublicKey, { type: "address" }),
        nativeToScVal(toPublicKey, { type: "address" }),
        nativeToScVal(stroops, { type: "i128" }),
        memoScVal
      )
    )
    .setTimeout(60)
    .build();

  const simulated = await sorobanServer.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Receipt simulation failed: ${simulated.error}`);
  }

  return sorobanServer.prepareTransaction(tx);
}

/**
 * Get the number of receipt NFTs minted for a payer.
 */
export async function getReceiptCount(payer: string): Promise<number> {
  if (!CONTRACT_ID) return 0;
  try {
    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(
      new Account(payer, "0"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
    )
      .addOperation(
        contract.call("get_receipt_count", nativeToScVal(payer, { type: "address" }))
      )
      .setTimeout(30)
      .build();

    const sim = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result) {
      const value = scValToNative(sim.result.retval);
      return Number(value);
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function getRecentPaymentsForSparkline(
  publicKey: string,
  limit = 10
): Promise<PaymentRecord[]> {
  const { records } = await getPaymentHistory(publicKey, limit);
  // getPaymentHistory returns newest-first; reverse for chronological order
  return records.slice().reverse();
}


/**
 * Wrapper for fetching recent payments specifically for analytics/stats.
 */
export async function getRecentPaymentsForStats(
  publicKey: string,
  limit = 100
): Promise<PaymentRecord[]> {
  const { records } = await getPaymentHistory(publicKey, limit);
  return records;
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

// ── Network fee status (#168) ──────────────────────────────────────────────

export type FeeLevel = "normal" | "elevated" | "high";

export interface NetworkFeeStats {
  feeLevel: FeeLevel;
  /** Most-recent base fee in XLM (e.g. 0.00001) */
  baseFeeXlm: number;
}

/**
 * Fetches the current network fee statistics from Horizon and classifies
 * the fee level for the network status indicator.
 *
 * Thresholds (mode base fee in stroops):
 *   normal   — < 100 stroops (< 0.00001 XLM)
 *   elevated — 100–1000 stroops
 *   high     — > 1000 stroops
 */
export async function fetchNetworkFeeStats(): Promise<NetworkFeeStats> {
  const config = getNetworkConfig();
  const url = `${config.horizonUrl}/fee_stats`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Horizon fee_stats returned ${res.status}`);
  }

  const data = await res.json() as {
    fee_charged: { mode: string };
  };

  const modeStroops = parseInt(
    data.fee_charged?.mode ?? STELLAR_BASE_FEE_STROOPS_STRING,
    10
  );
  const baseFeeXlm = modeStroops / STELLAR_STROOPS_PER_XLM;

  return { feeLevel: feeLevelFromStroops(modeStroops), baseFeeXlm };
}

// ── Horizon root / network health (#1144) ──────────────────────────────────

/**
 * Horizon's root endpoint (`GET /`) response, trimmed to the fields this app
 * reads. The endpoint is the canonical source for the network's current ledger
 * and the Horizon/core versions serving it.
 *
 * @see {@link https://developers.stellar.org/docs/data/apis/horizon/api-reference/get-root | Horizon get root}
 */
export interface HorizonRootResponse {
  horizon_version: string;
  core_version: string;
  ingest_latest_ledger: number;
  history_latest_ledger: number;
  history_latest_ledger_closed_at: string;
  core_latest_ledger: number;
  network_passphrase: string;
  current_protocol_version: number;
  core_supported_protocol_version: number;
}

/**
 * Network health metrics rendered by the network status page.
 *
 * A `null` value means the metric could not be derived from Horizon on this
 * refresh — the UI shows "Unavailable" rather than a misleading zero.
 */
export interface NetworkMetrics {
  /** Sequence of the newest ledger Horizon has ingested. */
  latestLedgerSequence: number;
  /** ISO-8601 close time of the newest ledger. */
  lastLedgerCloseTime: string;
  /** Seconds between the newest ledger close time and this measurement. */
  ledgerCloseLagSeconds: number;
  /** Protocol minimum fee in XLM (Horizon `last_ledger_base_fee`). */
  baseFeeXlm: number;
  /** Median fee actually charged by recent transactions, in XLM. */
  recommendedFeeXlm: number;
  /** 95th percentile fee charged, in XLM. */
  feeP95Xlm: number;
  /** 99th percentile fee charged, in XLM. */
  feeP99Xlm: number;
  /** Fee level classification for the network status indicator. */
  feeLevel: FeeLevel;
  /** Distinct accounts seen in the newest ledger's operations. */
  activeAccounts: number | null;
  /** Ledger the {@link NetworkMetrics.activeAccounts} sample came from. */
  activeAccountsLedger: number;
  /** Successful operations per second across the sampled ledger window. */
  operationsPerSecond: number | null;
  /** Number of ledgers averaged for {@link NetworkMetrics.operationsPerSecond}. */
  sampledLedgerCount: number;
  /** Client-measured round-trip time of the Horizon root request, in ms. */
  horizonLatencyMs: number;
  /** Client-measured round-trip time of the fee-stats request, in ms. */
  feeStatsLatencyMs: number;
  /** Stellar protocol version reported by Horizon. */
  protocolVersion: number | null;
  /** Horizon build serving the active network. */
  horizonVersion: string | null;
  /** Stellar Core build behind Horizon. */
  coreVersion: string | null;
  /** Network passphrase, e.g. `Test SDF Network ; September 2015`. */
  networkPassphrase: string | null;
}

/** How many recent ledgers are averaged for the operations/second metric. */
export const NETWORK_SAMPLE_LEDGER_COUNT = 10;

/** Cap for the operations page used to count active accounts. */
export const NETWORK_OPERATIONS_PAGE_LIMIT = 200;

function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function stroopsToXlm(stroops: string | number | undefined, fallback = 0): number {
  const parsed = typeof stroops === "number" ? stroops : parseInt(stroops ?? "", 10);
  return Number.isFinite(parsed) ? parsed / STELLAR_STROOPS_PER_XLM : fallback;
}

/**
 * Fetch Horizon's root (`GET /`) endpoint.
 *
 * `stellar-sdk`'s JS `Horizon.Server` has no `fetchRoot()` helper (that method
 * only exists in the Go/Java SDKs), so this hits the same endpoint directly and
 * returns the typed payload the status page needs.
 *
 * @throws {Error} If Horizon responds with a non-2xx status.
 */
export async function fetchHorizonRoot(): Promise<HorizonRootResponse> {
  const { horizonUrl } = getNetworkConfig();
  const res = await fetch(`${horizonUrl.replace(/\/$/, "")}/`);

  if (!res.ok) {
    throw new Error(`Horizon root endpoint returned ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as HorizonRootResponse;
}

/**
 * Count the distinct accounts referenced by the operations of a single ledger.
 *
 * Horizon has no account-count metric, so "active accounts" is defined here as
 * the accounts that participated in the newest ledger. Returns `null` when the
 * operations page cannot be read, so the UI can say "Unavailable".
 */
export async function countActiveAccountsInLedger(
  ledgerSequence: number
): Promise<number | null> {
  try {
    const operations = await getServer()
      .operations()
      .forLedger(ledgerSequence)
      .limit(NETWORK_OPERATIONS_PAGE_LIMIT)
      .call();

    const accounts = new Set<string>();

    for (const op of operations.records) {
      const candidate = op as {
        source_account?: string;
        from?: string;
        to?: string;
        into?: string;
        destination?: string;
      };

      for (const address of [
        candidate.source_account,
        candidate.from,
        candidate.to,
        candidate.into,
        candidate.destination,
      ]) {
        if (address) accounts.add(address);
      }
    }

    return accounts.size;
  } catch (err) {
    console.error("Failed to count active accounts:", err);
    return null;
  }
}

/**
 * Collect every network health metric the status page renders.
 *
 * Sources:
 *   - Horizon root (`/`) — ledger sequence, close time, protocol/versions.
 *   - Horizon `/fee_stats` — base, recommended, p95 and p99 fees.
 *   - Horizon `/ledgers` — operations-per-second over a recent window.
 *   - Horizon `/ledgers/{seq}/operations` — active accounts.
 *
 * Latencies are measured client-side around each request.
 */
export async function fetchNetworkMetrics(): Promise<NetworkMetrics> {
  const horizon = getServer();

  const rootStartedAt = nowMs();
  const root = await fetchHorizonRoot();
  const horizonLatencyMs = nowMs() - rootStartedAt;

  const feeStartedAt = nowMs();
  const feeStats = await horizon.feeStats();
  const feeStatsLatencyMs = nowMs() - feeStartedAt;

  const ledgers = await horizon
    .ledgers()
    .order("desc")
    .limit(NETWORK_SAMPLE_LEDGER_COUNT)
    .call();

  const records = ledgers.records;
  if (records.length === 0) {
    throw new Error("Horizon returned no ledgers for the requested window.");
  }

  const newestLedger = records[0];
  const oldestLedger = records[records.length - 1];

  const totalOperations = records.reduce(
    (sum, ledger) => sum + (ledger.operation_count ?? 0),
    0
  );
  const windowSeconds =
    (Date.parse(newestLedger.closed_at) - Date.parse(oldestLedger.closed_at)) / 1000;
  const operationsPerSecond =
    windowSeconds > 0
      ? Math.round((totalOperations / windowSeconds) * 100) / 100
      : null;

  const activeAccounts = await countActiveAccountsInLedger(newestLedger.sequence);

  const modeStroops = parseInt(
    feeStats.fee_charged?.mode ?? STELLAR_BASE_FEE_STROOPS_STRING,
    10
  );
  const lastLedgerCloseMs = Date.parse(root.history_latest_ledger_closed_at);

  return {
    latestLedgerSequence: root.history_latest_ledger,
    lastLedgerCloseTime: root.history_latest_ledger_closed_at,
    ledgerCloseLagSeconds: Number.isFinite(lastLedgerCloseMs)
      ? Math.max(0, Math.round((Date.now() - lastLedgerCloseMs) / 1000))
      : 0,
    baseFeeXlm: stroopsToXlm(feeStats.last_ledger_base_fee, STELLAR_BASE_FEE_XLM),
    recommendedFeeXlm: stroopsToXlm(feeStats.fee_charged?.p50),
    feeP95Xlm: stroopsToXlm(feeStats.fee_charged?.p95),
    feeP99Xlm: stroopsToXlm(feeStats.fee_charged?.p99),
    feeLevel: feeLevelFromStroops(modeStroops),
    activeAccounts,
    activeAccountsLedger: newestLedger.sequence,
    operationsPerSecond,
    sampledLedgerCount: records.length,
    horizonLatencyMs,
    feeStatsLatencyMs,
    protocolVersion: root.current_protocol_version ?? null,
    horizonVersion: root.horizon_version ?? null,
    coreVersion: root.core_version ?? null,
    networkPassphrase: root.network_passphrase ?? null,
  };
}

/** Classify a fee (in stroops) using the same thresholds as the navbar indicator. */
export function feeLevelFromStroops(modeStroops: number): FeeLevel {
  if (modeStroops < STELLAR_BASE_FEE_STROOPS) return "normal";
  if (modeStroops <= ELEVATED_FEE_MAX_STROOPS) return "elevated";
  return "high";
}

// ── DEX Trading Helpers ───────────────────────────────────────────────────

/**
 * Represents the orderbook for an asset pair.
 */
export interface Orderbook {
  bids: Array<{ price: string; amount: string }>;
  asks: Array<{ price: string; amount: string }>;
  base: Asset;
  counter: Asset;
}

/**
 * Represents a single trade aggregation (OHLC) point.
 */
export interface TradeAggregation {
  timestamp: number;
  trade_count: number;
  base_volume: string;
  counter_volume: string;
  avg: string;
  high: string;
  low: string;
  open: string;
  close: string;
  price: string; // Map to close for display
}

/**
 * Represents an open offer on the DEX.
 */
export interface OpenOffer {
  id: string;
  seller: string;
  selling: Asset;
  buying: Asset;
  amount: string;
  price: string;
}

/**
 * Fetch the current orderbook for an asset pair.
 */
export async function fetchOrderbook(
  selling: Asset,
  buying: Asset,
  limit = 20
): Promise<Orderbook> {
  const result = await server.orderbook(selling, buying).limit(limit).call();
  return {
    bids: result.bids.map((b) => ({ price: b.price, amount: b.amount })),
    asks: result.asks.map((a) => ({ price: a.price, amount: a.amount })),
    base: selling,
    counter: buying,
  };
}

/**
 * Fetch trade aggregations for charting.
 */
export async function fetchTradeAggregations(
  base: Asset,
  counter: Asset,
  resolution: "1hour" | "1day" | "1week",
  startTime: Date,
  endTime: Date,
  limit = 100
): Promise<TradeAggregation[]> {
  const resMap: Record<string, number> = {
    "1hour": 3600000,
    "1day": 86400000,
    "1week": 604800000,
  };

  const records = await server
    .tradeAggregation(base, counter, startTime.getTime(), endTime.getTime(), resMap[resolution], 0)
    .limit(limit)
    .order("desc")
    .call();

  return records.records.map((r: any) => ({
    timestamp: parseInt(r.timestamp),
    trade_count: r.trade_count,
    base_volume: r.base_volume,
    counter_volume: r.counter_volume,
    avg: r.avg,
    high: r.high,
    low: r.low,
    open: r.open,
    close: r.close,
    price: r.close,
  }));
}

/**
 * Fetch all open offers for a given account.
 */
export async function fetchOpenOffers(publicKey: string): Promise<OpenOffer[]> {
  const result = await server.offers().forAccount(publicKey).call();
  return result.records.map((r: any) => ({
    id: r.id,
    seller: r.seller,
    selling: r.selling,
    buying: r.buying,
    amount: r.amount,
    price: r.price,
  }));
}

/**
 * Build a transaction to cancel an existing DEX offer.
 */
export async function buildCancelOfferTransaction({
  fromPublicKey,
  offerId,
  selling,
  buying,
}: {
  fromPublicKey: string;
  offerId: string;
  selling: Asset;
  buying: Asset;
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);
  return new TransactionBuilder(sourceAccount, {
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.manageSellOffer({
        selling,
        buying,
        amount: "0",
        price: "1",
        offerId: offerId,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
    .build();
}

/**
 * Build a transaction to create a sell offer on the DEX.
 */
export async function buildSellOfferTransaction({
  fromPublicKey,
  selling,
  buying,
  amount,
  price,
}: {
  fromPublicKey: string;
  selling: Asset;
  buying: Asset;
  amount: string;
  price: string;
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);
  return new TransactionBuilder(sourceAccount, {
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.manageSellOffer({
        selling,
        buying,
        amount,
        price,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
    .build();
}

/**
 * Build a transaction to create a buy offer on the DEX.
 */
export async function buildBuyOfferTransaction({
  fromPublicKey,
  selling,
  buying,
  amount,
  price,
}: {
  fromPublicKey: string;
  selling: Asset;
  buying: Asset;
  amount: string;
  price: string;
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);
  return new TransactionBuilder(sourceAccount, {
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.manageBuyOffer({
        selling,
        buying,
        buyAmount: amount,
        price,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
    .build();
}

/**
 * Build a transaction for a path payment.
 */
export async function buildPathPaymentTransaction({
  fromPublicKey,
  toPublicKey,
  sendAsset,
  sendMax,
  destAsset,
  destAmount,
  path,
}: {
  fromPublicKey: string;
  toPublicKey: string;
  sendAsset: Asset;
  sendMax: string;
  destAsset: Asset;
  destAmount: string;
  path: Asset[];
}): Promise<Transaction> {
  const sourceAccount = await server.loadAccount(fromPublicKey);
  return new TransactionBuilder(sourceAccount, {
    fee: STELLAR_BASE_FEE_STROOPS_STRING,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset,
        sendMax,
        destination: toPublicKey,
        destAsset,
        destAmount,
        path,
      })
    )
    .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
    .build();
}


/**
 * Fetches general network statistics from Horizon.
 */
export async function fetchNetworkStats(): Promise<NetworkStats> {
  const server = getServer();
  const ledgers = await server.ledgers().order("desc").limit(10).call();
  const latestLedger = ledgers.records[0];
  const feeStats = await server.feeStats();

  const totalTransactions = ledgers.records.reduce((acc, l) => acc + l.successful_transaction_count, 0);
  const avgTransactionCount = Math.round(totalTransactions / ledgers.records.length);

  return {
    latestLedgerSequence: latestLedger.sequence,
    lastLedgerCloseTime: latestLedger.closed_at,
    avgTransactionCount,
    currentBaseFee: parseInt(feeStats.fee_charged.min),
    p50Fee: parseInt(feeStats.fee_charged.p50),
    p95Fee: parseInt(feeStats.fee_charged.p95),
    p99Fee: parseInt(feeStats.fee_charged.p99),
  };
}
