import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import TransactionList from "@/components/TransactionList";
import type { PaymentRecord } from "@/lib/stellar";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {} }),
}));

jest.mock("@/lib/stellar", () => ({
  ...jest.requireActual("@/lib/stellar"),
  getPaymentHistory: jest.fn(),
}));

import { getPaymentHistory } from "@/lib/stellar";

const PUBLIC_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "1",
    type: "received",
    amount: "10.0000000",
    asset: "XLM",
    from: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYGJ2DN5ZKQYTROZXNUAAOXWS7",
    to: PUBLIC_KEY,
    createdAt: new Date().toISOString(),
    transactionHash: "hash1",
    pagingToken: "token1",
    ...overrides,
  };
}

describe("TransactionList memo rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a memo containing markup as escaped text, not HTML", async () => {
    const maliciousMemo = "<script>alert(1)</script>";
    (getPaymentHistory as jest.Mock).mockResolvedValue({
      records: [makePayment({ memo: maliciousMemo })],
      hasMore: false,
    });

    const { container } = render(<TransactionList publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.queryByText(/Coffee|script/i)).toBeTruthy();
    });

    // The literal text is present in the rendered output...
    expect(container.textContent).toContain(maliciousMemo);

    // ...but no <script> element was ever created in the DOM, and the
    // serialized HTML shows it escaped rather than parsed as markup.
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("<script>alert(1)</script>");
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });
});
