/**
 * __tests__/SendPaymentFormSNS.test.tsx
 *
 * Tests for Stellar Name Service integration in SendPaymentForm.
 *
 * Covers:
 *  - Typing a .xlm name shows inline spinner then resolved address
 *  - Typing a raw G... address skips SNS resolution entirely
 *  - Invalid / unresolvable name shows inline error and blocks submit
 *  - Submit uses the resolved address, not the typed name string
 */

import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockResolveStellarName = jest.fn();
const mockIsStellarName = jest.fn();

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn().mockResolvedValue({ toXDR: () => "mock-xdr" }),
  buildSorobanTipTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  CONTRACT_ID: null,
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr: string) => /^G[A-Z0-9]{55}$/.test(addr)),
  isValidFederationAddress: jest.fn((addr: string) => addr.includes("*") && addr.includes(".")),
  isStellarName: (...args: unknown[]) => mockIsStellarName(...args),
  resolveStellarName: (...args: unknown[]) => mockResolveStellarName(...args),
  resolveFederationAddress: jest.fn(),
  submitTransaction: jest.fn().mockResolvedValue({ hash: "abc123" }),
  fetchNetworkFeeStats: jest.fn().mockResolvedValue({ baseFeeXlm: 0.00001, feeLevel: "normal" }),
  truncateMemoText: jest.fn((t: string) => t),
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  server: {
    loadAccount: jest.fn().mockRejectedValue(new Error("not found")),
    payments: jest.fn(),
    transactions: jest.fn(),
  },
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn().mockResolvedValue({ signedXDR: "signed-xdr" }),
}));

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("@/lib/ToastContext", () => ({
  useToastContext: () => ({ addToast: jest.fn() }),
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

import SendPaymentForm from "../components/SendPaymentForm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN";
const RESOLVED_ADDRESS = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZZZ";

const defaultProps = {
  publicKey: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGXLQN8FMGEZEBQP3BHTPQP",
  xlmBalance: "100.0000000",
  usdcBalance: "0",
  onSuccess: jest.fn(),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SendPaymentForm — SNS integration", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    // Default: isStellarName is false for everything; tests override as needed
    mockIsStellarName.mockReturnValue(false);
    mockResolveStellarName.mockResolvedValue(RESOLVED_ADDRESS);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("typing a .xlm name", () => {
    beforeEach(() => {
      // Make isStellarName return true for .xlm inputs
      mockIsStellarName.mockImplementation((v: string) => v.trim().toLowerCase().endsWith(".xlm") || v.includes("*"));
    });

    it("shows a spinner while resolving the name", async () => {
      // Resolution doesn't settle immediately
      let resolvePromise!: (v: string) => void;
      mockResolveStellarName.mockReturnValue(
        new Promise<string>((res) => { resolvePromise = res; })
      );

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      await user.type(input, "alice.xlm");

      // Advance past the 400ms debounce
      act(() => { jest.advanceTimersByTime(500); });

      expect(await screen.findByLabelText("Resolving name")).toBeInTheDocument();

      // Settle the promise to avoid open handle warnings
      act(() => { resolvePromise(RESOLVED_ADDRESS); });
    });

    it("shows the resolved G... address below the field after successful resolution", async () => {
      mockResolveStellarName.mockResolvedValue(RESOLVED_ADDRESS);

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      await user.type(input, "alice.xlm");

      act(() => { jest.advanceTimersByTime(500); });

      await waitFor(() => {
        expect(screen.getByText(/Resolves to:/)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(RESOLVED_ADDRESS))).toBeInTheDocument();
      });
    });

    it("shows an inline error when the name cannot be resolved", async () => {
      mockResolveStellarName.mockRejectedValue(new Error('Could not resolve "bad.xlm" to a Stellar address'));

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      await user.type(input, "bad.xlm");

      act(() => { jest.advanceTimersByTime(500); });

      await waitFor(() => {
        expect(screen.getByText(/Could not resolve/i)).toBeInTheDocument();
      });
    });

    it("disables the submit button when the name is resolving", async () => {
      let resolvePromise!: (v: string) => void;
      mockResolveStellarName.mockReturnValue(
        new Promise<string>((res) => { resolvePromise = res; })
      );

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");
      await user.type(input, "alice.xlm");
      await user.type(amountInput, "5");

      act(() => { jest.advanceTimersByTime(500); });

      const sendButton = screen.getByRole("button", { name: /Send/i });
      expect(sendButton).toBeDisabled();

      // Settle promise
      act(() => { resolvePromise(RESOLVED_ADDRESS); });
    });

    it("disables the submit button when name resolution failed", async () => {
      mockResolveStellarName.mockRejectedValue(new Error("Could not resolve"));

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");
      await user.type(input, "bad.xlm");
      await user.type(amountInput, "5");

      act(() => { jest.advanceTimersByTime(500); });

      await waitFor(() => {
        expect(screen.getByText(/Could not resolve/i)).toBeInTheDocument();
      });

      const sendButton = screen.getByRole("button", { name: /Send/i });
      expect(sendButton).toBeDisabled();
    });
  });

  describe("typing a raw G... address", () => {
    it("does not call resolveStellarName for a raw public key", async () => {
      // isStellarName returns false for raw addresses
      mockIsStellarName.mockReturnValue(false);

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      await user.type(input, VALID_ADDRESS);

      act(() => { jest.advanceTimersByTime(500); });

      // resolveStellarName should never be called for a raw G address
      expect(mockResolveStellarName).not.toHaveBeenCalled();
      // No "Resolves to:" text should appear
      expect(screen.queryByText(/Resolves to:/)).not.toBeInTheDocument();
    });

    it("does not show a spinner for a raw public key", async () => {
      mockIsStellarName.mockReturnValue(false);

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      await user.type(input, VALID_ADDRESS);

      act(() => { jest.advanceTimersByTime(500); });

      expect(screen.queryByLabelText("Resolving name")).not.toBeInTheDocument();
    });
  });

  describe("out-of-order response protection", () => {
    beforeEach(() => {
      mockIsStellarName.mockImplementation((v: string) =>
        v.trim().toLowerCase().endsWith(".xlm") || v.includes("*")
      );
    });

    it("ignores a stale slow response when the input has already changed", async () => {
      // First call (alice.xlm) is slow; second call (bob.xlm) resolves first
      let resolveAlice!: (v: string) => void;
      const ALICE_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN";
      const BOB_ADDRESS   = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZZZ";

      mockResolveStellarName
        .mockImplementationOnce(() => new Promise<string>((res) => { resolveAlice = res; }))
        .mockResolvedValueOnce(BOB_ADDRESS);

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);

      // Type "alice.xlm" — debounce fires, slow request in-flight
      await user.type(input, "alice.xlm");
      act(() => { jest.advanceTimersByTime(500); });

      // Clear and type "bob.xlm" before alice resolves — debounce fires, fast request
      await user.clear(input);
      await user.type(input, "bob.xlm");
      act(() => { jest.advanceTimersByTime(500); });

      // bob.xlm resolves first
      await waitFor(() => {
        expect(screen.getByText(new RegExp(BOB_ADDRESS))).toBeInTheDocument();
      });

      // Now the stale alice response arrives — should be ignored
      act(() => { resolveAlice(ALICE_ADDRESS); });

      // Alice's address must NOT appear; bob's must remain
      await waitFor(() => {
        expect(screen.queryByText(new RegExp(ALICE_ADDRESS))).not.toBeInTheDocument();
        expect(screen.getByText(new RegExp(BOB_ADDRESS))).toBeInTheDocument();
      });
    });

    it("rapid valid→invalid→valid sequence shows final state correctly", async () => {
      const FINAL_ADDRESS = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZZZ";

      mockResolveStellarName
        .mockResolvedValueOnce("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN") // alice
        .mockRejectedValueOnce(new Error('Could not resolve "bad.xlm"'))                      // bad
        .mockResolvedValueOnce(FINAL_ADDRESS);                                                 // carol

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);

      await user.type(input, "alice.xlm");
      act(() => { jest.advanceTimersByTime(500); });

      await user.clear(input);
      await user.type(input, "bad.xlm");
      act(() => { jest.advanceTimersByTime(500); });

      await user.clear(input);
      await user.type(input, "carol.xlm");
      act(() => { jest.advanceTimersByTime(500); });

      await waitFor(() => {
        expect(screen.getByText(new RegExp(FINAL_ADDRESS))).toBeInTheDocument();
        expect(screen.queryByText(/Could not resolve/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("submission uses resolved address", () => {
    it("passes the resolved address (not the typed name) to buildPaymentTransaction", async () => {
      mockIsStellarName.mockImplementation((v: string) =>
        v.trim().toLowerCase().endsWith(".xlm") || v.includes("*")
      );
      mockResolveStellarName.mockResolvedValue(RESOLVED_ADDRESS);

      const { buildPaymentTransaction } = await import("@/lib/stellar");

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<SendPaymentForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");

      await user.type(input, "alice.xlm");
      act(() => { jest.advanceTimersByTime(500); });

      // Wait for resolution to complete and resolved address to appear
      await waitFor(() => {
        expect(screen.getByText(/Resolves to:/)).toBeInTheDocument();
      });

      await user.type(amountInput, "5");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Send/i })).toBeEnabled();
      });

      await user.click(screen.getByRole("button", { name: /Send/i }));

      const confirmButton = await screen.findByRole("button", { name: /confirm_sign|Confirm & Sign/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(buildPaymentTransaction).toHaveBeenCalledWith(
          expect.objectContaining({ toPublicKey: RESOLVED_ADDRESS })
        );
      });
    });
  });
});
