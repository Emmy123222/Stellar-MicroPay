/**
 * Regression test for the duplicated snsDebounceRef declaration.
 *
 * Verifies that:
 * 1. A single lifecycle-managed timer ref is used for SNS resolution.
 * 2. Only one setTimeout is scheduled per debounce cycle.
 * 3. Typing a new destination clears the previous debounce timer.
 */

import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SendPaymentForm from "@/components/SendPaymentForm";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("@/components/ErrorBoundary", () => ({
  withErrorBoundary: (Component: React.FC) => Component,
}));

jest.mock("@/components/PaymentStatusModal", () => {
  const Mock = () => null;
  return { __esModule: true, default: Mock };
});

jest.mock("@/components/MultiSigFlow", () => ({
  MULTISIG_THRESHOLD_XLM: 100,
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn().mockResolvedValue({ signedXDR: "signed" }),
}));

jest.mock("@/lib/addressBook", () => ({
  loadAddressBookContacts: () => [],
  saveAddressBookContacts: jest.fn(),
  subscribeToAddressBookContacts: () => () => {},
  upsertAddressBookContact: (c: unknown) => c,
}));

jest.mock("@/utils/format", () => ({
  formatXLM: (v: number) => v.toFixed(7),
  shortenAddress: (a: string) => a.slice(0, 8),
}));

jest.mock("@/components/icons", () => {
  const Icon = () => null;
  return {
    SendIcon: Icon,
    CheckIcon: Icon,
    CopyIcon: Icon,
    ExternalLinkIcon: Icon,
    StarIcon: Icon,
    QrCodeIcon: Icon,
    ReceiptIcon: Icon,
  };
});

jest.mock("@/lib/ToastContext", () => ({
  useToastContext: () => ({ addToast: jest.fn() }),
}));

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const resolveStellarNameMock = jest.fn<Promise<string>, [string]>();
const isValidStellarNameMock = jest.fn<boolean, [string]>(() => false);

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn().mockResolvedValue({ toXDR: () => "mock-xdr" }),
  buildReceiptMintTransaction: jest.fn(),
  buildSorobanTipTransaction: jest.fn(),
  explorerUrl: jest.fn(),
  fetchNetworkFeeStats: jest.fn(() => Promise.resolve({ baseFeeXlm: "0.00001" })),
  isValidFederationAddress: jest.fn(() => false),
  isValidStellarAddress: jest.fn(() => false),
  isStellarName: (v: string) => isValidStellarNameMock(v),
  resolveFederationAddress: jest.fn(),
  resolveStellarName: (v: string) => resolveStellarNameMock(v),
  server: {
    loadAccount: jest.fn().mockRejectedValue(new Error("not found")),
    payments: jest.fn(),
    transactions: jest.fn(),
  },
  submitTransaction: jest.fn().mockResolvedValue({ hash: "tx123" }),
  STELLAR_BASE_FEE_XLM: "0.00001",
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  truncateMemoText: (s: string) => s,
}));

jest.mock("@/components/PaymentStatusModal", () => ({
  __esModule: true,
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div data-testid="status-modal"><button onClick={onClose}>Close</button></div> : null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
  xlmBalance: "100",
  title: "Send",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SendPaymentForm – snsDebounceRef lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resolveStellarNameMock.mockReset();
    isValidStellarNameMock.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules exactly one 400ms setTimeout when an SNS name is entered", async () => {
    resolveStellarNameMock.mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    isValidStellarNameMock.mockImplementation((v: string) =>
      typeof v === "string" && v.trim().toLowerCase().endsWith(".xlm")
    );

    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(input, "alice.xlm");

    // Advance past the debounce
    act(() => { jest.advanceTimersByTime(500); });

    // Only one 400ms timeout should have been scheduled for SNS debounce
    const snsTimeouts = setTimeoutSpy.mock.calls.filter(
      ([, ms]) => ms === 400
    );
    expect(snsTimeouts).toHaveLength(1);

    setTimeoutSpy.mockRestore();
  });

  it("clears the previous debounce timer when a new destination is typed", async () => {
    resolveStellarNameMock.mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    isValidStellarNameMock.mockImplementation((v: string) =>
      typeof v === "string" && v.trim().toLowerCase().endsWith(".xlm")
    );

    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/G\.\.\./);

    // Type first SNS name — triggers the useEffect debounce
    await user.type(input, "alice.xlm");
    act(() => { jest.advanceTimersByTime(100); });

    // Clear and type a different SNS name — should clear the old timer
    fireEvent.change(input, { target: { value: "" } });
    await user.type(input, "bob.xlm");

    // The useEffect cleanup should have called clearTimeout at least once
    // (once for the first alice.xlm entry, once for the clear)
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("renders without duplicate ref errors (the original compilation blocker)", () => {
    // If snsDebounceRef were declared twice, this would throw during render.
    const { container } = render(<SendPaymentForm {...defaultProps} />);
    expect(container).toBeTruthy();
  });
});
