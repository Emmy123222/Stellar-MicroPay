import { TransactionCategory, resolveEscrowStatus } from "/lib/stellar";

describe("Stellar helper", () => {
  it("categories", () => {
    expect(TransactionCategory.Payment).toBe("Payment");
    expect(TransactionCategory.Merge).toBe("Merge");
  });

  it.each([
    [0, "pending"],
    [1, "claimable"],
    [2, "claimed"],
    [3, "cancelled"],
  ])("maps %i to %s", (status, expected) => {
    expect(resolveEscrowStatus({ status })).toBe(expected);
  });
});
