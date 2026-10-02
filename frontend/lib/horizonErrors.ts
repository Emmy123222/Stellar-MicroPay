/**
 * lib/horizonErrors.ts
 * Maps Horizon's structured transaction-submission error codes
 * (err.response.data.extras.result_codes) to human-readable messages, so a
 * rejected transaction surfaces something actionable instead of a generic
 * "Transaction failed".
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/result-codes/transactions | Horizon transaction result codes}
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/result-codes/operations | Horizon operation result codes}
 */

export interface HorizonResultCodes {
  transaction?: string;
  operations?: string[];
}

export interface HorizonSubmissionError {
  message: string;
  codes: HorizonResultCodes | null;
}

const TRANSACTION_CODE_MESSAGES: Record<string, string> = {
  tx_bad_seq: "This transaction used an out-of-date sequence number. Please try again.",
  tx_insufficient_balance: "Your account does not have enough XLM to cover this payment and its fee.",
  tx_insufficient_fee: "The network fee offered was too low. Please try again.",
  tx_bad_auth: "The transaction signature is invalid or missing a required signer.",
  tx_no_source_account: "The sending account could not be found on the network.",
  tx_too_late: "This transaction expired before it reached the network. Please try again.",
  tx_too_early: "This transaction was submitted before it becomes valid.",
  tx_failed: "One of the transaction's operations failed.",
};

const OPERATION_CODE_MESSAGES: Record<string, string> = {
  op_underfunded: "Insufficient balance to complete this payment.",
  op_no_destination: "The destination account does not exist on the network.",
  op_no_trust: "The destination account has not established a trustline for this asset.",
  op_line_full: "The destination account's trustline is full and cannot receive this amount.",
  op_no_issuer: "The asset's issuer account could not be found.",
  op_not_authorized: "The destination account is not authorized to hold this asset.",
  op_src_no_trust: "Your account does not have a trustline for this asset.",
  op_malformed: "The payment operation was malformed.",
  op_low_reserve: "This payment would leave the sending account below its minimum balance reserve.",
};

/**
 * Extracts `result_codes` from a Horizon error, if present. Returns null for
 * any other shape of error (network failure, client-side validation, etc.),
 * so callers can tell "Horizon rejected this" apart from every other failure
 * mode without inspecting the raw error shape themselves.
 */
export function extractHorizonResultCodes(err: unknown): HorizonResultCodes | null {
  if (!err || typeof err !== "object") return null;
  const response = (err as { response?: unknown }).response;
  if (!response || typeof response !== "object") return null;
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const extras = (data as { extras?: unknown }).extras;
  if (!extras || typeof extras !== "object") return null;
  const resultCodes = (extras as { result_codes?: unknown }).result_codes;
  if (!resultCodes || typeof resultCodes !== "object") return null;

  const { transaction, operations } = resultCodes as {
    transaction?: unknown;
    operations?: unknown;
  };

  return {
    transaction: typeof transaction === "string" ? transaction : undefined,
    operations: Array.isArray(operations)
      ? operations.filter((code): code is string => typeof code === "string")
      : undefined,
  };
}

/**
 * Builds a human-readable message from a set of Horizon result codes,
 * preferring the most specific operation-level code (since that is almost
 * always the actionable one — e.g. a `tx_failed` transaction code paired
 * with an `op_underfunded` operation code should say "insufficient balance",
 * not the generic "one of the operations failed").
 */
export function formatHorizonResultCodes(codes: HorizonResultCodes): string {
  const operationCode = codes.operations?.find((code) => code !== "op_success");
  if (operationCode) {
    return OPERATION_CODE_MESSAGES[operationCode] ?? `Transaction failed: ${operationCode}`;
  }
  if (codes.transaction) {
    return TRANSACTION_CODE_MESSAGES[codes.transaction] ?? `Transaction failed: ${codes.transaction}`;
  }
  return "Transaction failed for an unknown reason.";
}

/**
 * Parses a Horizon submission error into a human-readable message plus the
 * raw codes (for callers that want to branch on the specific code, not just
 * display the message). Falls back to the error's own message, or a generic
 * fallback, when the error does not carry Horizon result codes at all.
 */
export function parseHorizonSubmissionError(err: unknown): HorizonSubmissionError {
  const codes = extractHorizonResultCodes(err);
  if (codes) {
    return { message: formatHorizonResultCodes(codes), codes };
  }

  const message =
    err instanceof Error && err.message ? err.message : "An unexpected error occurred";
  return { message, codes: null };
}
