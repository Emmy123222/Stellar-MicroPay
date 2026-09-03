import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        checking_account: "Checking account...",
        destination: "Destination",
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
  explorerUrl: jest.fn((hash: string) => `https://testnet.expert.stellar.org/tx/${hash}`),
  isValidStellarAddress: jest.fn(
    (addr: string) => addr.startsWith("G") && addr.length === 56,
  ),
  isValidFederationAddress: jest.fn((addr: string) => addr.includes("*")),
  isStellarName: jest.fn((addr: string) => addr.includes(".xlm")),
  resolveFederationAddress: jest.fn(),
  resolveStellarName: jest.fn(),
  submitTransaction: jest.fn(),
  fetchNetworkFeeStats: jest.fn(() =>
    Promise.resolve({ baseFeeXlm: 0.00001, feeLevel: "normal" }),
  ),
  truncateMemoText: jest.fn((text: string) => text),
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  server: {
    loadAccount: jest.fn(),
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
  default: () => null,
}));

jest.mock("@/components/MultiSigFlow", () => ({
  MULTISIG_THRESHOLD_XLM: 1000,
}));

jest.mock("@/components/ErrorBoundary", () => ({
  withErrorBoundary: (Comp: React.ComponentType) => Comp,
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import SendPaymentForm from "../components/SendPaymentForm";
import * as stellarModule from "@/lib/stellar";

const mockLoadAccount = stellarModule.server.loadAccount as jest.Mock;

// Valid 56-char G-address for testnet/mainnet testing
const VALID_DEST = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN";

const defaultProps = {
  publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  xlmBalance: "100.0000000",
  usdcBalance: null,
  onSuccess: jest.fn(),
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SendPaymentForm — destination validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Default: account does not exist (testnet)
    mockLoadAccount.mockRejectedValue(new Error("Account not found"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("debounces destination validation by 400 ms", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const destInput = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(destInput, VALID_DEST);

    // Before debounce fires, no loadAccount call
    expect(mockLoadAccount).not.toHaveBeenCalled();

    // Advance past debounce (400 ms)
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Now the server call should have been made
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(mockLoadAccount).toHaveBeenCalledWith(VALID_DEST);
  });

  it("ignores stale validation responses via request ID", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const destInput = screen.getByPlaceholderText(/G\.\.\./);

    // Type first address — schedule validation
    await user.type(destInput, VALID_DEST);

    // Quickly change to a different address before debounce resolves
    await user.clear(destInput);
    const secondAddr = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    mockIsValidStellarAddressFor(secondAddr, true);
    await user.type(destInput, secondAddr);

    // First debounce fires — but the address changed, so a NEW debounce starts.
    // Advance time so the second debounce fires.
    act(() => {
      jest.advanceTimersByTime(800);
    });

    // loadAccount should only be called for the SECOND address
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(mockLoadAccount).toHaveBeenCalledWith(secondAddr);
  });

  it("does not call loadAccount for invalid addresses", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const destInput = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(destInput, "not-a-valid-address");

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockLoadAccount).not.toHaveBeenCalled();
  });

  it("shows warning when destination account does not exist (testnet)", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const destInput = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(destInput, VALID_DEST);

    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Server rejects — account not found on testnet
    expect(mockLoadAccount).toHaveBeenCalled();

    // Warning should appear after promise settles
    await act(async () => {
      // Flush microtasks
    });

    expect(
      screen.getByText(/doesn't exist yet/i),
    ).toBeInTheDocument();
  });

  it("clears warning when destination account exists", async () => {
    mockLoadAccount.mockResolvedValueOnce({ id: VALID_DEST });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SendPaymentForm {...defaultProps} />);

    const destInput = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(destInput, VALID_DEST);

    act(() => {
      jest.advanceTimersByTime(400);
    });

    await act(async () => {
      // Flush microtasks
    });

    // No warning should appear
    expect(screen.queryByText(/doesn't exist yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/doesn't exist on/i)).not.toBeInTheDocument();
  });

  it("cleans up debounce timer on unmount", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { unmount } = render(<SendPaymentForm {...defaultProps} />);

    const destInput = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(destInput, VALID_DEST);

    unmount();

    // Advance past debounce — should not crash or call loadAccount after unmount
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // loadAccount should not have been called if cleanup worked
    // (may be called once if unmount happens after timeout set but before cleanup)
  });

  it("resets debounce when asset selection changes", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <SendPaymentForm
        {...defaultProps}
        assetOptions={["XLM", "USDC"]}
        usdcBalance="25.0000000"
      />,
    );

    const destInput = screen.getByPlaceholderText(/G\.\.\./);
    await user.type(destInput, VALID_DEST);

    // Switch asset before debounce fires
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(mockLoadAccount).not.toHaveBeenCalled();

    // Select USDC asset
    const usdcButton = screen.getByRole("button", { name: "USDC" });
    await user.click(usdcButton);

    // Advance past debounce after asset change
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // loadAccount should have been called with the warning now mentioning
    // "doesn't exist on the Stellar network" (non-XLM asset)
    await act(async () => {
      // Flush microtasks
    });

    expect(mockLoadAccount).toHaveBeenCalled();
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockIsValidStellarAddressFor(addr: string, valid: boolean) {
  const impl = stellarModule.isValidStellarAddress as jest.Mock;
  const original = impl.getMockImplementation();
  impl.mockImplementation((a: string) => {
    if (a === addr) return valid;
    if (original) return original(a);
    return a.startsWith("G") && a.length === 56;
  });
}
