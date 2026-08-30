import {
  STELLAR_BASE_FEE_STROOPS as legacyBaseFee,
  TransactionCategory as LegacyTransactionCategory,
  USDC as legacyUsdc,
  calculateMinimumBalance as legacyMinimumBalance,
  truncateMemoText as legacyTruncateMemoText,
  type PaymentHistoryResponse as LegacyPaymentHistoryResponse,
} from "@/lib/stellar";
import {
  STELLAR_BASE_FEE_STROOPS,
  calculateMinimumBalance,
  truncateMemoText,
} from "@/lib/stellar/protocol";
import { USDC } from "@/lib/stellar/assets";
import {
  TransactionCategory,
  type PaymentHistoryResponse,
} from "@/lib/stellar/types";

describe("Stellar domain module compatibility", () => {
  it("keeps legacy runtime exports bound to the extracted modules", () => {
    expect(legacyBaseFee).toBe(STELLAR_BASE_FEE_STROOPS);
    expect(legacyMinimumBalance).toBe(calculateMinimumBalance);
    expect(legacyTruncateMemoText).toBe(truncateMemoText);
    expect(LegacyTransactionCategory).toBe(TransactionCategory);
    expect(legacyUsdc).toBe(USDC);
  });

  it("keeps extracted pure helpers behaviorally compatible", () => {
    expect(calculateMinimumBalance(3)).toBe(2.5);
    expect(truncateMemoText("😀".repeat(8))).toBe("😀".repeat(7));
  });

  it("keeps shared payment contracts assignable through either entry point", () => {
    const response: PaymentHistoryResponse = { records: [], hasMore: false };
    const legacyResponse: LegacyPaymentHistoryResponse = response;

    expect(legacyResponse).toEqual(response);
  });
});
