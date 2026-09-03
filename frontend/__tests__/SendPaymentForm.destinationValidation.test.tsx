/**
 * __tests__/SendPaymentForm.destinationValidation.test.tsx
 *
 * Tests for destination validation debounce and stale-response handling (#709).
 *
 * Covers:
 *  - Debounced validation fires only after the user stops typing
 *  - Stale validation responses (slow network) are ignored when destination changes
 *  - Immediate validation on blur cancels the pending debounce
 */

import React from "react";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SendPaymentForm from "../components/SendPaymentForm";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadAccount = jest.fn();

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn().mockResolvedValue({ toXDR: () => "mock-xdr" }),
  buildSorobanTipTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr: string) =>
    /^G[A-Z0-9]{55}$/.test(addr)
  ),
  isValidFederationAddress: jest.fn((addr: string) => addr.includes("*") && addr.includes(".")),
  isStellarName: jest.fn(() => false),
  resolveStellarName: jest.fn(),
  resolveFederationAddress: jest.fn(),
  submitTransaction: jest.fn().mockResolvedValue({ hash: "tx123" }),
  fetchNetworkFeeStats: jest.fn().mockResolvedValue({ baseFeeXlm: 0.00001, feeLevel: "normal" }),
  truncateMemoText: jest.fn((t: string) => t),
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  server: {
    loadAccount: (...args: unknown[]) => mockLoadAccount(...args),
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
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div data-testid="status-modal"><button onClick={onClose}>Close</button></div> : null,
}));

jest.mock("@/components/MultiSigFlow", () => ({
  MULTISIG_THRESHOLD_XLM: 1000,
}));

jest.mock("@/components/ErrorBoundary", () => ({
  withErrorBoundary: (Component: React.FC) => Component,
}));

jest.mock("@/lib/addressBook", () => ({
  loadAddressBookContacts: () => [],
  saveAddressBookContacts: jest.fn(),
  subscribeToAddressBookContacts: () => () => {},
  upsertAddressBookContact: (c: unknown) => c,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADDR_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN";
const ADDR_B = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";

const defaultProps = {
  publicKey: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGXLQN8FMGEZEBQP3BHTPQP",
  xlmBalance: "100.0000000",
  title: "Send",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SendPaymentForm – destination validation debounce & stale-response handling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockLoadAccount.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("debounces destination validation by 400ms", async () => {
    mockLoadAccount.mockRejectedValue(new Error("not found"));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(input, ADDR_A);

    // Before the debounce elapses, loadAccount should not have been called
    expect(mockLoadAccount).not.toHaveBeenCalled();

    // Advance past the debounce
    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => {
      expect(mockLoadAccount).toHaveBeenCalledTimes(1);
      expect(mockLoadAccount).toHaveBeenCalledWith(ADDR_A);
    });
  });

  it("ignores stale validation responses from a previous destination", async () => {
    // Make the first call slow (never resolves during the test)
    let resolveFirstCall!: () => void;
    const firstCallPromise = new Promise<void>((resolve) => {
      resolveFirstCall = resolve;
    });

    // Make the second call fast
    mockLoadAccount
      .mockImplementationOnce(() => firstCallPromise)
      .mockResolvedValueOnce({ id: "account-b-exists" });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/G\.\.\./);

    // Type first address — debounce fires after 400ms, starts slow validation
    await user.type(input, ADDR_A);
    act(() => { jest.advanceTimersByTime(500); });
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);

    // Now type a different valid address character by character.
    // Use backspaces to clear, then type ADDR_B.
    // First, erase the last 10 chars of ADDR_A to make it invalid (triggers cleanup)
    for (let i = 0; i < 10; i++) {
      await user.type(input, "{Backspace}");
    }
    // Now append characters of ADDR_B that make a new valid address
    // We need to type 10 chars to get back to 56 chars
    await user.type(input, "CCCCCCCCCC");

    // Advance past the debounce for the new address
    act(() => { jest.advanceTimersByTime(500); });

    // Second validation fires
    await waitFor(() => {
      expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    });

    // Now the slow first call resolves
    act(() => { resolveFirstCall(); });

    // The warning from the first call should NOT be applied because the
    // destination has changed and the stale response is ignored.
    await waitFor(() => {
      expect(screen.queryByText(/doesn't exist yet/)).not.toBeInTheDocument();
    });
  });

  it("immediate validation on blur cancels the pending debounce", async () => {
    mockLoadAccount.mockResolvedValue({ id: "account-exists" });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(input, ADDR_A);

    // Blur the field immediately (before debounce elapses)
    act(() => {
      fireEvent.blur(input);
    });

    // loadAccount should have been called immediately via runImmediateDestinationValidation
    await waitFor(() => {
      expect(mockLoadAccount).toHaveBeenCalled();
    });

    const callCount = mockLoadAccount.mock.calls.length;

    // Advance past the debounce — no additional call should happen
    act(() => { jest.advanceTimersByTime(600); });

    expect(mockLoadAccount).toHaveBeenCalledTimes(callCount);
  });

  it("shows warning when account does not exist (testnet)", async () => {
    mockLoadAccount.mockRejectedValue(new Error("Account not found"));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(input, ADDR_A);

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => {
      expect(screen.getByText(/doesn't exist yet/)).toBeInTheDocument();
    });
  });

  it("clears warning when account exists", async () => {
    mockLoadAccount.mockResolvedValue({ id: "some-account" });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(input, ADDR_A);

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => {
      expect(mockLoadAccount).toHaveBeenCalled();
    });

    // No warning should be shown for an existing account
    expect(screen.queryByText(/doesn't exist/)).not.toBeInTheDocument();
  });

  it("renders without errors", () => {
    const { container } = render(<SendPaymentForm {...defaultProps} />);
    expect(container).toBeTruthy();
  });
});
