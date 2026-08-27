/**
 * __tests__/SendPaymentFormA11y.test.tsx
 *
 * Accessibility regression tests (#822).
 *
 * Verifies that:
 *  - every form control has a stable HTML id
 *  - validation errors are associated with their inputs via aria-describedby
 *  - aria-invalid toggles correctly based on error presence
 *  - a failed submission moves focus to the first invalid field
 *  - keyboard interaction exposes the form controls
 *  - the form renders without automated axe violations
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn().mockResolvedValue({ toXDR: () => "mock-xdr" }),
  buildSorobanTipTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  CONTRACT_ID: null,
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr: string) => addr.startsWith("G") && addr.length === 56),
  isValidFederationAddress: jest.fn((addr: string) => addr.includes("*")),
  isStellarName: jest.fn(() => false),
  resolveStellarName: jest.fn(() => Promise.reject(new Error("not a name"))),
  resolveFederationAddress: jest.fn(),
  submitTransaction: jest.fn().mockResolvedValue({ hash: "txhash" }),
  fetchNetworkFeeStats: jest.fn().mockResolvedValue({ baseFeeXlm: 0.00001, feeLevel: "normal" }),
  truncateMemoText: jest.fn((text: string) => text),
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  server: {
    loadAccount: jest.fn(() => Promise.reject(new Error("not found"))),
    payments: jest.fn(),
    transactions: jest.fn(),
  },
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn().mockResolvedValue({ signedXDR: "signed-xdr" }),
}));

jest.mock("@/utils/format", () => ({
  formatXLM: jest.fn((n: number) => `${n} XLM`),
  shortenAddress: jest.fn((a: string) => a?.slice(0, 8) + "..."),
}));

jest.mock("@/components/PaymentStatusModal", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/MultiSigFlow", () => ({
  MULTISIG_THRESHOLD_XLM: 1000,
}));

import SendPaymentForm from "../components/SendPaymentForm";

const defaultProps = {
  publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ4",
  xlmBalance: "100.0000000",
  usdcBalance: "50.0000000",
  onSuccess: jest.fn(),
};

const validDestination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("SendPaymentForm — accessibility (#822)", () => {
  it("gives every form control a stable HTML id", () => {
    render(<SendPaymentForm {...defaultProps} />);

    expect(screen.getByLabelText("Destination")).toHaveAttribute("id", "send-payment-destination");
    expect(screen.getByPlaceholderText("0.0000000")).toHaveAttribute("id", "send-payment-amount");
    expect(
      screen.getByPlaceholderText("Enter memo (optional)")
    ).toHaveAttribute("id", "send-payment-memo");
  });

  it("does not mark a valid amount/memo as invalid", () => {
    const { container } = render(<SendPaymentForm {...defaultProps} />);
    const amountInput = screen.getByPlaceholderText("0.0000000");
    const memoInput = screen.getByPlaceholderText("Enter memo (optional)");

    expect(amountInput).toHaveAttribute("aria-invalid", "false");
    expect(memoInput).toHaveAttribute("aria-invalid", "false");
    expect(container.querySelector("#send-payment-amount-error")).not.toBeInTheDocument();
    expect(container.querySelector("#send-payment-memo-error")).not.toBeInTheDocument();
  });

  it("associates an over-balance amount error with the amount field via aria-describedby and aria-invalid", async () => {
    const user = userEvent.setup();
    render(<SendPaymentForm {...defaultProps} xlmBalance="10.0000000" />);

    await user.type(screen.getByLabelText("Destination"), validDestination);
    // 9.5 > max sendable (10 - 1 reserve = 9), so amount is invalid.
    await user.type(screen.getByPlaceholderText("0.0000000"), "9.5");

    const amountInput = screen.getByPlaceholderText("0.0000000");
    expect(amountInput).toHaveAttribute("aria-invalid", "true");
    expect(amountInput).toHaveAttribute("aria-describedby", "send-payment-amount-error");
    expect(screen.getByText(/Amount must be at least/i)).toBeInTheDocument();
  });

  it("associates an over-long memo error with the memo field via aria-describedby and aria-invalid", async () => {
    const user = userEvent.setup();
    render(<SendPaymentForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText("Enter memo (optional)"), "x".repeat(29));

    const memoInput = screen.getByPlaceholderText("Enter memo (optional)");
    expect(memoInput).toHaveAttribute("aria-invalid", "true");
    expect(memoInput).toHaveAttribute("aria-describedby", "send-payment-memo-error");
    expect(screen.getByText(/Memo is limited to 28 bytes/i)).toBeInTheDocument();
  });

  it("moves focus to the destination field when submitting with an invalid destination", async () => {
    const user = userEvent.setup();
    render(<SendPaymentForm {...defaultProps} />);

    await user.type(screen.getByLabelText("Destination"), "not-a-valid-address");
    await user.type(screen.getByPlaceholderText("0.0000000"), "5");

    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(screen.getByLabelText("Destination")).toHaveFocus();
    expect(screen.getByLabelText("Destination")).toHaveAttribute("aria-invalid", "true");
  });

  it("moves focus to the amount field when it is the first invalid field", async () => {
    const user = userEvent.setup();
    render(<SendPaymentForm {...defaultProps} xlmBalance="10.0000000" />);

    await user.type(screen.getByLabelText("Destination"), validDestination);
    await user.type(screen.getByPlaceholderText("0.0000000"), "9.5");

    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(screen.getByPlaceholderText("0.0000000")).toHaveFocus();
  });

  it("exposes all form inputs in the tab order (keyboard interaction)", async () => {
    const user = userEvent.setup();
    render(<SendPaymentForm {...defaultProps} />);

    // There are focusable toolbar buttons (asset picker, contacts, etc.) ahead
    // of the inputs; walk forward with Tab until each input is reached.
    const targetOrder = [
      screen.getByLabelText("Destination"),
      screen.getByPlaceholderText("0.0000000"),
      screen.getByPlaceholderText("Enter memo (optional)"),
    ];

    for (const target of targetOrder) {
      let guard = 0;
      do {
        await user.tab();
        guard += 1;
      } while (document.activeElement !== target && guard < 12);
      expect(target).toHaveFocus();
    }
  });

  it("renders without axe accessibility violations on a pristine form", async () => {
    const { container } = render(<SendPaymentForm {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("renders without axe accessibility violations on a form with validation errors", async () => {
    const user = userEvent.setup();
    const { container } = render(<SendPaymentForm {...defaultProps} xlmBalance="10.0000000" />);

    await user.type(screen.getByLabelText("Destination"), validDestination);
    await user.type(screen.getByPlaceholderText("0.0000000"), "9.5");
    await user.type(screen.getByPlaceholderText("Enter memo (optional)"), "x".repeat(29));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});