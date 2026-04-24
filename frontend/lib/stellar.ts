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
} from "@stellar/stellar-sdk";

// ─── Config ────────────────────────────────────────────────────────────────

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as
  | "testnet"
  | "mainnet";

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";

/** The network passphrase is used to sign and verify transactions. */
export const NETWORK_PASSPHRASE =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

/** Pre-configured Horizon server instance for the active network. */
export const server = new Horizon.Server(HORIZON_URL);

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

/** Soroban RPC server URL. Defaults to testnet. */
export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  "https://soroban-testnet.stellar.org";

/** Pre-configured Soroban RPC server instance. */
export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

/** The deployed Soroban contract ID for recording tips. */
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "";

// ─── Types ─────────────────────────────────────────────────────────────────

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
 * Represents a single payment operation in a user's transaction history.
*/
export interface PaymentRecord {
  /** Unique operation ID assigned by Horizon. */
  id: string;
  /** Whether this payment was sent or received by the queried account. */
  type: "sent" | "received";
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

/**
 * Fetch all asset balances for a Stellar account.
 *
 * @param publicKey - The Stellar public key (G...) of the account to query.
 * @returns A promise resolving to an array of {@link WalletBalance} objects.
 * @throws {Error} With message `ACCOUNT_NOT_FOUND` if the account has never been funded.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/accounts | Horizon Accounts API}
*/
export async function getBalances(publicKey: string): Promise<WalletBalance[]> {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances.map((b: Horizon.HorizonApi.BalanceLine) => {
      if (b.asset_type === "native") {
        return { asset: "native", balance: b.balance, assetCode: "XLM" };
      }
      const typed = b as Horizon.HorizonApi.BalanceLineAsset;
      return {
        asset: `${typed.asset_code}:${typed.asset_issuer}`,
        balance: typed.balance,
        assetCode: typed.asset_code,
      };
    });
  } catch (err: unknown) {
    // Horizon returns 404 for unfunded accounts — surface a sentinel so the
    // UI can offer the Friendbot funding button instead of a generic error.
    const horizonErr = err as { response?: { status?: number } };
    if (horizonErr?.response?.status === 404) {
      throw new Error(ACCOUNT_NOT_FOUND_ERROR);
    }
    console.error("Failed to load account balances:", err);
    throw new Error("Could not fetch account. Is this address funded?");
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
  const res = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
  );
  if (!res.ok) {
    throw new Error(`Friendbot failed: ${res.status} ${res.statusText}`);
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
 * Build an unsigned XLM payment transaction ready for Freighter to sign.
 *
 * This function loads the source account sequence number from Horizon,
 * constructs a `TransactionBuilder`, adds a payment operation, and
 * optionally attaches a text memo (truncated to 28 bytes per Stellar spec).
 *
 * @param params - Payment parameters.
 * @param params.fromPublicKey - Sender's Stellar public key (G...).
 * @param params.toPublicKey - Recipient's Stellar public key (G...).
 * @param params.amount - XLM amount to send as a string, e.g. `"0.5"`.
 * @param params.memo - Optional text memo (max 28 bytes; longer strings are truncated).
 * @returns A promise resolving to an unsigned {@link Transaction} object.
 * @throws {Error} If the source account cannot be loaded from Horizon.
 *
 * @see {@link https://developers.stellar.org/docs/learn/fundamentals/transactions | Stellar Transactions}
 *
 * @example
 * ```ts
 * const tx = await buildPaymentTransaction({
 *   fromPublicKey: "GABC...sender",
 *   toPublicKey:   "GXYZ...recipient",
 *   amount:        "0.5",
 *   memo:          "coffee ☕",
 * });
 * // Pass `tx` to Freighter for signing:
 * const signedXDR = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
 * ```
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
  let paymentsBuilder = server
    .payments()
    .forAccount(publicKey)
    .limit(limit)
    .order("desc");

  if (cursor) {
    paymentsBuilder = paymentsBuilder.cursor(cursor);
  }

  const payments = await paymentsBuilder.call();

  const records: PaymentRecord[] = [];

  for (const op of payments.records) {
    // Only process payment operations
    if (op.type !== "payment") continue;

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

    records.push({
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
    });
  }

  return {
    records,
    hasMore: payments.records.length === limit && !!payments.next,
    nextCursor: payments.next ? payments.next.toString() : undefined,
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
