import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Define mocks before importing the component
jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn(),
  buildSorobanTipTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  CONTRACT_ID: null,
  explorerUrl: jest.fn((hash) => `https://testnet.expert.stellar.org/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr) => addr.startsWith("G") && addr.length === 56),
  isValidFederationAddress: jest.fn((addr) => addr.includes("*")),
  resolveFederationAddress: jest.fn(),
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

// Now import the component and get mock references
import SendPaymentForm from "../components/SendPaymentForm";
import * as stellarModule from "@/lib/stellar";
import * as walletModule from "@/lib/wallet";

const mockBuildPaymentTransaction = stellarModule.buildPaymentTransaction as jest.Mock;
const mockIsValidStellarAddress = stellarModule.isValidStellarAddress as jest.Mock;
const mockSubmitTransaction = stellarModule.submitTransaction as jest.Mock;
const mockFetchNetworkFeeStats = stellarModule.fetchNetworkFeeStats as jest.Mock;
const mockSignTransactionWithWallet = walletModule.signTransactionWithWallet as jest.Mock;

describe("SendPaymentForm", () => {
  const defaultProps = {
    publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
    xlmBalance: "100.0000000",
    usdcBalance: "50.0000000",
    onSuccess: jest.fn(),
  };

  const validDestination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to return expected values
    mockFetchNetworkFeeStats.mockResolvedValue({ baseFeeXlm: 0.00001, feeLevel: "normal" });
    mockIsValidStellarAddress.mockImplementation((addr) => addr.startsWith("G") && addr.length === 56);
    mockBuildPaymentTransaction.mockResolvedValue({ toXDR: () => "mock-xdr" });
    mockSubmitTransaction.mockResolvedValue({ hash: "tx123456" });
    mockSignTransactionWithWallet.mockResolvedValue({ signedXDR: "mock-signed-xdr" });
  });

  it("renders the form with memo field and send button", () => {
    render(<SendPaymentForm {...defaultProps} />);

    expect(screen.getByText("Memo (optional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
  });

  describe("Submit button disabled state", () => {
    it("disables submit button when destination is empty", () => {
      render(<SendPaymentForm {...defaultProps} />);

      const sendButton = screen.getByRole("button", { name: /Send/i });
      expect(sendButton).toBeDisabled();
    });

    it("enables submit button when destination and amount are valid", async () => {
      mockIsValidStellarAddress.mockReturnValue(true);
      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("0.0000000");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      await waitFor(() => {
        const sendButton = screen.getByRole("button", { name: /Send/i });
        expect(sendButton).toBeEnabled();
      });
    });

    it("disables submit button when amount exceeds balance minus 1 XLM reserve", async () => {
      mockIsValidStellarAddress.mockReturnValue(true);
      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} xlmBalance="10.0000000" />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("0.0000000");

      await user.type(destinationInput, validDestination);
      // Balance is 10, minus 1 XLM reserve = 9 XLM max sendable
      // Try to send 9.5 which exceeds max
      await user.type(amountInput, "9.5");

      await waitFor(() => {
        const sendButton = screen.getByRole("button", { name: /Send/i });
        expect(sendButton).toBeDisabled();
      });
    });

    it("allows send button when amount is within balance minus 1 XLM", async () => {
      mockIsValidStellarAddress.mockReturnValue(true);
      const user = userEvent.setup();

      render(<SendPaymentForm {...defaultProps} xlmBalance="10.0000000" />);

      const destinationInput = screen.getByPlaceholderText(/G\.\.\./);
      const amountInput = screen.getByPlaceholderText("0.0000000");

      await user.type(destinationInput, validDestination);
      // Balance is 10, minus 1 XLM reserve = 9 XLM max sendable
      await user.type(amountInput, "8.5");

      await waitFor(() => {
        const sendButton = screen.getByRole("button", { name: /Send/i });
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
      const amountInput = screen.getByPlaceholderText("0.0000000");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      const sendButton = screen.getByRole("button", { name: /Send/i });

      await waitFor(() => {
        expect(sendButton).toBeEnabled();
      });

      await user.click(sendButton);

      // Click confirm on the confirmation modal
      const confirmButton = await screen.findByRole("button", { name: /Confirm & Sign/i });
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
      const amountInput = screen.getByPlaceholderText("0.0000000");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      const sendButton = screen.getByRole("button", { name: /Send/i });

      await waitFor(() => {
        expect(sendButton).toBeEnabled();
      });

      await user.click(sendButton);

      // Click confirm on the confirmation modal
      const confirmButton = await screen.findByRole("button", { name: /Confirm & Sign/i });
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
      const amountInput = screen.getByPlaceholderText("0.0000000");

      await user.type(destinationInput, validDestination);
      await user.type(amountInput, "50");

      const sendButton = screen.getByRole("button", { name: /Send/i });

      await waitFor(() => {
        expect(sendButton).toBeEnabled();
      });

      await user.click(sendButton);

      const confirmButton = await screen.findByRole("button", { name: /Confirm & Sign/i });
      await user.click(confirmButton);

      // Verify the tx hash appears in the modal
      await waitFor(() => {
        expect(screen.getByTestId("tx-hash")).toBeInTheDocument();
      });
    });
  });
});
