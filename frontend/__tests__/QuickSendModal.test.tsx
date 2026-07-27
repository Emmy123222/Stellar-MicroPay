import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import QuickSendModal from "@/components/QuickSendModal";

// Stub the heavy SendPaymentForm so we can test the modal shell in isolation
jest.mock("@/components/SendPaymentForm", () => {
  const React = require("react");
  return function MockSendPaymentForm({
    publicKey,
    xlmBalance,
    onSuccess,
  }: {
    publicKey: string;
    xlmBalance: string;
    onSuccess?: () => void;
  }) {
    return (
      <div data-testid="send-payment-form">
        <span data-testid="mock-public-key">{publicKey}</span>
        <span data-testid="mock-xlm-balance">{xlmBalance}</span>
        <button type="button" onClick={onSuccess}>
          Confirm payment
        </button>
      </div>
    );
  };
});

const DEFAULT_PROPS = {
  isOpen: true,
  onClose: jest.fn(),
  publicKey: "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
  xlmBalance: "250.00",
  usdcBalance: "10.00",
};

beforeEach(() => {
  jest.clearAllMocks();
  document.body.style.overflow = "";
});

describe("QuickSendModal", () => {
  it("renders nothing when isOpen=false", () => {
    render(<QuickSendModal {...DEFAULT_PROPS} isOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the modal dialog when isOpen=true", () => {
    render(<QuickSendModal {...DEFAULT_PROPS} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Quick send payment")).toBeInTheDocument();
  });

  it("passes publicKey and xlmBalance down to SendPaymentForm", () => {
    render(<QuickSendModal {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("mock-public-key")).toHaveTextContent(DEFAULT_PROPS.publicKey);
    expect(screen.getByTestId("mock-xlm-balance")).toHaveTextContent(DEFAULT_PROPS.xlmBalance);
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<QuickSendModal {...DEFAULT_PROPS} onClose={onClose} />);

    await user.click(screen.getByLabelText("Close quick send modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<QuickSendModal {...DEFAULT_PROPS} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the backdrop", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<QuickSendModal {...DEFAULT_PROPS} onClose={onClose} />);

    // The backdrop is the dialog element itself (overlayRef)
    const dialog = screen.getByRole("dialog");
    await user.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the inner form signals success", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<QuickSendModal {...DEFAULT_PROPS} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Confirm payment" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores it on close", () => {
    const { unmount } = render(<QuickSendModal {...DEFAULT_PROPS} isOpen={true} />);
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("shows the Esc keyboard hint", () => {
    render(<QuickSendModal {...DEFAULT_PROPS} />);
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });

  it("does not call onClose when clicking inside the modal panel", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<QuickSendModal {...DEFAULT_PROPS} onClose={onClose} />);

    // Click the inner form card — not the backdrop
    await user.click(screen.getByTestId("send-payment-form"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
