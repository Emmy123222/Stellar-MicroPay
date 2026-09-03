import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Define mocks before importing the component
jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        memo_optional: "Memo (optional)",
        send_button: `Send ${opts?.amount || ""} ${opts?.asset || ""}`,
        processing: "Processing...",
        confirm_title: "Confirm Payment",
        confirm_sign: "Confirm & Sign",
        cancel: "Cancel",
        destination: "Destination",
        amount: "Amount",
        to: "To",
        estimated_fee: "Estimated Fee",
        memo: "Memo",
        send_another: "Send Another",
        success_title: "Payment Sent!",
        success_message: "Your payment has been processed successfully.",
        transaction_hash: "Transaction Hash",
        view_explorer: "View on Explorer",
        mint_receipt: "Mint NFT Receipt",
        minting_receipt: "Minting Receipt...",
        mint_success: "Receipt minted successfully!",
        max: `Max ${opts?.amount || ""}`,
        amount_placeholder: "0.0000000",
        contacts: "Contacts",
        close: "Close",
        checking_account: "Checking account...",
        scan_qr: "Scan QR Code",
        save_contact: "Save Contact",
        remove_contact: "Remove Contact",
        high_value_warning: "Consider using Multi-Signature for high-value payments.",
        memo_limit: "Memo exceeds 28 bytes",
      };
      return map[key] ?? (opts ? `${key}:${JSON.stringify(opts)}` : key);
    },
  }),
}));

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn(),
  buildSorobanTipTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  CONTRACT_ID: null,
  explorerUrl: jest.fn((hash) => `https://testnet.expert.stellar.org/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr) => addr.startsWith("G") && addr.length === 56),
  isValidFederationAddress: jest.fn((addr) => addr.includes("*")),
  isStellarName: jest.fn((name: string) => name.endsWith(".xlm") || name.includes("*")),
  resolveStellarName: jest.fn(() => Promise.resolve("GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZZZ")),
  resolveFederationAddress: jest.fn(),
  resolveStellarName: jest.fn(),
  submitTransaction: jest.fn(),
  fetchNetworkFeeStats: jest.fn(() => Promise.resolve({ baseFeeXlm: 0.00001, feeLevel: "normal" })),
  truncateMemoText: jest.fn((text: string) => text),
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  server: {
    loadAccount: jest.fn(() => Promise.reject(new Error("Account not found"))),
    payments: jest.fn(),
    transactions: jest.fn(),
  },
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/utils/format", () => ({
  formatXLM: jest.fn((amount) => `${parseFloat(amount).toFixed(7)} XLM`),
  shortenAddress: jest.fn((addr, len) => addr?.slice(0, len) + "..."),
}));

jest.mock("@/components/PaymentStatusModal", () => ({
  __esModule: true,
  default: ({ isOpen, error, txHash, onClose }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="payment-status-modal">
        {error && <div data-testid="error-message">{error}</div>}
        {txHash && <div data-testid="tx-hash">{txHash}</div>}
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
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
  withErrorBoundary: (Comp: React.ComponentType) => Comp,
}));

// Now import the component and get mock references
import SendPaymentForm from "../components/SendPaymentForm";
import * as stellarModule from "@/lib/stellar";
import * as walletModule from "@/lib/wallet";
import { TEST_PUBLIC_KEY_A, TEST_PUBLIC_KEY_B } from "./fixtures/stellar";

const mockBuildPaymentTransaction = stellarModule.buildPaymentTransaction as jest.Mock;
const mockIsValidStellarAddress = stellarModule.isValidStellarAddress as jest.Mock;
const mockSubmitTransaction = stellarModule.submitTransaction as jest.Mock;
const mockFetchNetworkFeeStats = stellarModule.fetchNetworkFeeStats as jest.Mock;
const mockSignTransactionWithWallet = walletModule.signTransactionWithWallet as jest.Mock;

describe("SendPaymentForm", () => {
  const defaultProps = {
    publicKey: TEST_PUBLIC_KEY_A,
    xlmBalance: "100.0000000",
    usdcBalance: "50.0000000",
    onSuccess: jest.fn(),
  };

  const validDestination = TEST_PUBLIC_KEY_B;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to return expected values
    mockFetchNetworkFeeStats.mockResolvedValue({ baseFeeXlm: 0.00001, feeLevel: "normal" });
    mockIsValidStellarAddress.mockImplementation(
      (addr) => addr.startsWith("G") && addr.length === 56
    );
    mockBuildPaymentTransaction.mockResolvedValue({ toXDR: () => "mock-xdr" });
    mockSubmitTransaction.mockResolvedValue({ hash: "tx123456" });
    mockSignTransactionWithWallet.mockResolvedValue({ signedXDR: "mock-signed-xdr" });
  });

  it("renders the form with memo field and send button", () => {
    render(<SendPaymentForm {...defaultProps} />);

    expect(screen.getByText("memo_optional")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send_button/i })).toBeInTheDocument();
  });

  describe("Submit button disabled state", () => {
    it("disables submit button when destination is empty", () => {
      render(<SendPaymentForm {...defaultProps} />);

      const sendButton = screen.getByRole("button", { name: /send_button/i });
      expect(sendButton).toBeDisabled();
    });

    it("enables submit button when destination and amount are valid", async () => {
      mockIsValidStellarAddress.mockReturnValue(true);
      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      await waitFor(() => {
        const sendButton = screen.getByRole("button", { name: /send_button/i });
        expect(sendButton).toBeEnabled();
      });
    });

    it("disables submit button when amount exceeds balance minus 1 XLM reserve", async () => {
      mockIsValidStellarAddress.mockReturnValue(true);
      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} xlmBalance="10.0000000" />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");

      await user.type(destinationInput, validDestination);
      // Balance is 10, minus 1 XLM reserve = 9 XLM max sendable
      // Try to send 9.5 which exceeds max
      await user.type(amountInput, "9.5");

      await waitFor(() => {
        const sendButton = screen.getByRole("button", { name: /send_button/i });
        expect(sendButton).toBeDisabled();
      });
    });

    it("allows send button when amount is within balance minus 1 XLM", async () => {
      mockIsValidStellarAddress.mockReturnValue(true);
      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} xlmBalance="10.0000000" />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");

      await user.type(destinationInput, validDestination);
      // Balance is 10, minus 1 XLM reserve = 9 XLM max sendable
      await user.type(amountInput, "8.5");

      await waitFor(() => {
        const sendButton = screen.getByRole("button", { name: /send_button/i });
        expect(sendButton).toBeEnabled();
      });
    });
  });

  describe("Error state", () => {
    it("shows error banner on failed submission", async () => {
      mockIsValidStellarAddress.mockReturnValue(true);
      mockBuildPaymentTransaction.mockRejectedValue(new Error("Network error"));
      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      const sendButton = screen.getByRole("button", { name: /send_button/i });

      await waitFor(() => {
        expect(sendButton).toBeEnabled();
      });

      await user.click(sendButton);

      // Click confirm on the confirmation modal
      const confirmButton = await screen.findByRole("button", { name: /confirm_sign/i });
      await user.click(confirmButton);

      // Wait for error to appear in modal
      await waitFor(() => {
        const errorElement = screen.getByTestId("error-message");
        expect(errorElement).toHaveTextContent("Network error");
      });
    });
  });

  describe("Success state", () => {
    it("displays transaction hash in success state", async () => {
      const txHash = "abcd1234efgh5678ijkl9012mnop3456qrst5678";
      mockIsValidStellarAddress.mockReturnValue(true);
      mockBuildPaymentTransaction.mockResolvedValue({
        toXDR: () => "mock-xdr",
      });
      mockSignTransactionWithWallet.mockResolvedValue({
        signedXDR: "mock-signed-xdr",
      });
      mockSubmitTransaction.mockResolvedValue({ hash: txHash });

      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      const sendButton = screen.getByRole("button", { name: /send_button/i });

      await waitFor(() => {
        expect(sendButton).toBeEnabled();
      });

      await user.click(sendButton);

      // Click confirm on the confirmation modal
      const confirmButton = await screen.findByRole("button", { name: /confirm_sign/i });
      await user.click(confirmButton);

      // In the modal, tx hash should be displayed
      await waitFor(() => {
        expect(screen.getByTestId("tx-hash")).toHaveTextContent(txHash);
      });
    });

    it("renders explorer link with transaction hash in modal", async () => {
      const txHash = "abcd1234efgh5678ijkl9012mnop3456qrst5678";
      mockIsValidStellarAddress.mockReturnValue(true);
      mockBuildPaymentTransaction.mockResolvedValue({
        toXDR: () => "mock-xdr",
      });
      mockSignTransactionWithWallet.mockResolvedValue({
        signedXDR: "mock-signed-xdr",
      });
      mockSubmitTransaction.mockResolvedValue({ hash: txHash });

      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("amount_placeholder");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      const sendButton = screen.getByRole("button", { name: /send_button/i });

      await waitFor(() => {
        expect(sendButton).toBeEnabled();
      });

      await user.click(sendButton);

      const confirmButton = await screen.findByRole("button", { name: /confirm_sign/i });
      await user.click(confirmButton);

      // Verify the tx hash appears in the modal
      await waitFor(() => {
        expect(screen.getByTestId("tx-hash")).toBeInTheDocument();
      });
    });
  });
});
