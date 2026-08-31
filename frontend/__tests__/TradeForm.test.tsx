import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import TradeForm from "@/components/TradeForm";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockBuildPathPaymentStrictSend = jest.fn();
const mockFetchStrictSendQuote = jest.fn();
const mockBuildSellOffer = jest.fn();
const mockBuildBuyOffer = jest.fn();
const mockSubmitTransaction = jest.fn();

jest.mock("@/lib/stellar", () => {
  const { Asset } = jest.requireActual("@stellar/stellar-sdk");
  const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  return {
    buildPathPaymentStrictSendTransaction: (...args: unknown[]) =>
      mockBuildPathPaymentStrictSend(...args),
    fetchStrictSendQuote: (...args: unknown[]) => mockFetchStrictSendQuote(...args),
    buildSellOfferTransaction: (...args: unknown[]) => mockBuildSellOffer(...args),
    buildBuyOfferTransaction: (...args: unknown[]) => mockBuildBuyOffer(...args),
    submitTransaction: (...args: unknown[]) => mockSubmitTransaction(...args),
    NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    USDC: new Asset("USDC", USDC_ISSUER),
    walletBalanceToAsset: (balance: { asset: string }) =>
      balance.asset === "native" ? Asset.native() : new Asset("USDC", USDC_ISSUER),
  };
});

const mockSignTransaction = jest.fn();
jest.mock("@stellar/freighter-api", () => ({
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
}));

jest.mock("@/components/icons", () => ({
  SwapIcon: ({ className }: { className?: string }) => (
    <svg data-testid="swap-icon" className={className} />
  ),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PUBLIC_KEY = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";

function renderTradeForm(overrides = {}) {
  const props = {
    publicKey: PUBLIC_KEY,
    onTradeComplete: jest.fn(),
    onError: jest.fn(),
    onSuccess: jest.fn(),
    ...overrides,
  };
  render(<TradeForm {...props} />);
  return props;
}

function getAmountInput() {
  return screen.getByPlaceholderText("0.00");
}

function getSubmitButton() {
  return screen.getByRole("button", { name: /execute market order|place .+ order/i });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TradeForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const fakeTx = { toXDR: () => "AAAA" };
    mockBuildPathPaymentStrictSend.mockResolvedValue(fakeTx);
    mockFetchStrictSendQuote.mockResolvedValue({ destinationAmount: "20", path: [] });
    mockBuildSellOffer.mockResolvedValue(fakeTx);
    mockBuildBuyOffer.mockResolvedValue(fakeTx);
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "SIGNED_XDR" });
    mockSubmitTransaction.mockResolvedValue({ hash: "TX_HASH" });
  });

  // ── Initial render ─────────────────────────────────────────────────────────

  it("renders Market Order selected by default", () => {
    renderTradeForm();
    const marketBtn = screen.getByRole("button", { name: "Market Order" });
    expect(marketBtn).toHaveClass("bg-stellar-500");
  });

  it("renders XLM → USDC asset selectors by default", () => {
    renderTradeForm();
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("XLM");
    expect(selects[1]).toHaveValue("USDC");
  });

  it("submit button is disabled when amount is empty", () => {
    renderTradeForm();
    expect(getSubmitButton()).toBeDisabled();
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it("submit button enables when amount is entered for a market order", async () => {
    const user = userEvent.setup();
    renderTradeForm();
    await user.type(getAmountInput(), "5");
    expect(getSubmitButton()).not.toBeDisabled();
  });

  it("calls onError when selling and buying the same asset", async () => {
    const user = userEvent.setup();
    const { onError } = renderTradeForm();

    // Set both selects to XLM
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "XLM");
    await user.type(getAmountInput(), "10");
    await user.click(getSubmitButton());

    expect(onError).toHaveBeenCalledWith("Cannot trade the same asset");
  });

  it("calls onError when limit order is submitted without price", async () => {
    const user = userEvent.setup();
    const { onError } = renderTradeForm();

    await user.click(screen.getByRole("button", { name: "Limit Order" }));
    await user.type(getAmountInput(), "10");

    // Submit button should be disabled because price is empty — but if user manages to submit:
    // The form validates !amount || (orderType === "limit" && !price)
    // Since price is empty the button remains disabled; let's verify it
    expect(getSubmitButton()).toBeDisabled();
    expect(onError).not.toHaveBeenCalled();
  });

  // ── Asset pair swap ────────────────────────────────────────────────────────

  it("swaps asset pair when the swap button is clicked", async () => {
    const user = userEvent.setup();
    renderTradeForm();

    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("XLM");
    expect(selects[1]).toHaveValue("USDC");

    await user.click(screen.getByTestId("swap-icon").closest("button")!);

    expect(selects[0]).toHaveValue("USDC");
    expect(selects[1]).toHaveValue("XLM");
  });

  // ── Market order submission ────────────────────────────────────────────────

  it("calls buildPathPaymentStrictSendTransaction for a market order", async () => {
    const user = userEvent.setup();
    const { onSuccess, onTradeComplete } = renderTradeForm();

    await user.type(getAmountInput(), "10");
    await user.click(getSubmitButton());

    await waitFor(() => expect(mockBuildPathPaymentStrictSend).toHaveBeenCalledTimes(1));
    const callArgs = mockBuildPathPaymentStrictSend.mock.calls[0][0];
    expect(callArgs.fromPublicKey).toBe(PUBLIC_KEY);
    expect(callArgs.sendAmount).toBe("10");

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("Market order executed successfully!"));
    expect(onTradeComplete).toHaveBeenCalledTimes(1);
  });

  it("resets the amount field after a successful market order", async () => {
    const user = userEvent.setup();
    renderTradeForm();

    await user.type(getAmountInput(), "10");
    await user.click(getSubmitButton());

    await waitFor(() => expect(mockBuildPathPaymentStrictSend).toHaveBeenCalled());
    await waitFor(() => expect(getAmountInput()).toHaveValue(null));
  });

  // ── Limit order submission ─────────────────────────────────────────────────

  it("shows Buy/Sell side buttons when limit order is selected", async () => {
    const user = userEvent.setup();
    renderTradeForm();

    await user.click(screen.getByRole("button", { name: "Limit Order" }));

    expect(screen.getByRole("button", { name: "Buy Order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sell Order" })).toBeInTheDocument();
  });

  it("calls buildSellOfferTransaction for a limit sell order", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderTradeForm();

    await user.click(screen.getByRole("button", { name: "Limit Order" }));
    await user.click(screen.getByRole("button", { name: "Sell Order" }));

    await user.type(getAmountInput(), "5");
    await user.type(screen.getByPlaceholderText("Price"), "0.2");
    await user.click(getSubmitButton());

    await waitFor(() => expect(mockBuildSellOffer).toHaveBeenCalledTimes(1));
    const args = mockBuildSellOffer.mock.calls[0][0];
    expect(args.fromPublicKey).toBe(PUBLIC_KEY);
    expect(args.amount).toBe("5");
    expect(args.price).toBe("0.2");

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("Sell order placed successfully!"));
  });

  it("calls buildBuyOfferTransaction for a limit buy order", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderTradeForm();

    await user.click(screen.getByRole("button", { name: "Limit Order" }));
    // "Buy Order" is selected by default

    await user.type(getAmountInput(), "3");
    await user.type(screen.getByPlaceholderText("Price"), "0.5");
    await user.click(getSubmitButton());

    await waitFor(() => expect(mockBuildBuyOffer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("Buy order placed successfully!"));
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it("calls onError when signing fails", async () => {
    const user = userEvent.setup();
    const { onError } = renderTradeForm();

    mockSignTransaction.mockResolvedValue({ error: { message: "User rejected" } });

    await user.type(getAmountInput(), "10");
    await user.click(getSubmitButton());

    await waitFor(() => expect(onError).toHaveBeenCalledWith("User rejected"));
  });

  it("calls onError when submitTransaction throws", async () => {
    const user = userEvent.setup();
    const { onError } = renderTradeForm();

    mockSubmitTransaction.mockRejectedValue(new Error("Network timeout"));

    await user.type(getAmountInput(), "10");
    await user.click(getSubmitButton());

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Network timeout"));
  });

  // ── Slippage tolerance (#619) ──────────────────────────────────────────────

  describe("slippage tolerance", () => {
    it("defaults to 0.5% and lets the user pick a preset", async () => {
      const user = userEvent.setup();
      renderTradeForm();

      const slippageInput = screen.getByLabelText(/slippage tolerance/i);
      expect(slippageInput).toHaveValue(0.5);

      await user.click(screen.getByRole("button", { name: "1%" }));
      expect(slippageInput).toHaveValue(1);
    });

    it("is hidden for limit orders", async () => {
      const user = userEvent.setup();
      renderTradeForm();

      await user.click(screen.getByRole("button", { name: "Limit Order" }));
      expect(screen.queryByLabelText(/slippage tolerance/i)).not.toBeInTheDocument();
    });

    it("sends a destination minimum reflecting the tolerance", async () => {
      const user = userEvent.setup();
      renderTradeForm();

      await user.clear(screen.getByLabelText(/slippage tolerance/i));
      await user.type(screen.getByLabelText(/slippage tolerance/i), "1");
      await user.type(getAmountInput(), "10");
      await user.click(getSubmitButton());

      await waitFor(() => expect(mockBuildPathPaymentStrictSend).toHaveBeenCalledTimes(1));
      const args = mockBuildPathPaymentStrictSend.mock.calls[0][0];
      // Quote returns 20 units; 1% tolerance ⇒ 19.8 minimum
      expect(args.destMin).toBe("19.8000000");
      expect(args.sendAmount).toBe("10");
      expect(args.path).toEqual([]);
    });

    it("uses the freshest quote and its path for the destination minimum", async () => {
      const user = userEvent.setup();
      renderTradeForm();

      mockFetchStrictSendQuote.mockResolvedValue({
        destinationAmount: "50",
        path: ["HOP"],
      });

      await user.type(getAmountInput(), "10");
      await user.click(getSubmitButton());

      await waitFor(() => expect(mockBuildPathPaymentStrictSend).toHaveBeenCalledTimes(1));
      const args = mockBuildPathPaymentStrictSend.mock.calls[0][0];
      // 0.5% default tolerance on a 50-unit quote
      expect(args.destMin).toBe("49.7500000");
      expect(args.path).toEqual(["HOP"]);
    });

    it("shows the expected and minimum received amounts once quoted", async () => {
      const user = userEvent.setup();
      renderTradeForm();

      await user.type(getAmountInput(), "10");

      expect(await screen.findByText("20.00 USDC")).toBeInTheDocument();
      expect(screen.getByText("19.90 USDC")).toBeInTheDocument();
    });

    it("errors and skips submission when no trade path exists", async () => {
      const user = userEvent.setup();
      const { onError } = renderTradeForm();

      mockFetchStrictSendQuote.mockResolvedValue(null);

      await user.type(getAmountInput(), "10");
      await user.click(getSubmitButton());

      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith("No trade path available for this asset pair.")
      );
      expect(mockBuildPathPaymentStrictSend).not.toHaveBeenCalled();
    });

    it("disables submission while the slippage tolerance is out of range", async () => {
      const user = userEvent.setup();
      renderTradeForm();

      await user.type(getAmountInput(), "10");
      await user.clear(screen.getByLabelText(/slippage tolerance/i));
      await user.type(screen.getByLabelText(/slippage tolerance/i), "80");

      expect(getSubmitButton()).toBeDisabled();
      expect(
        screen.getByText(/Enter a slippage tolerance between 0 and 50%/i)
      ).toBeInTheDocument();
    });
  });

  it("shows Processing... while the trade is in flight", async () => {
    const user = userEvent.setup();
    renderTradeForm();

    // Delay resolution so we can observe the loading state
    mockBuildPathPaymentStrictSend.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ toXDR: () => "AAAA" }), 200))
    );

    await user.type(getAmountInput(), "10");
    await user.click(getSubmitButton());

    expect(screen.getByRole("button", { name: /processing/i })).toBeInTheDocument();
  });
});
