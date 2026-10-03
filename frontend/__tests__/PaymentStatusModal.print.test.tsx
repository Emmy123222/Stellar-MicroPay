/**
 * __tests__/PaymentStatusModal.print.test.tsx
 * Issue #1045 — "Print receipt" in the success state of PaymentStatusModal.
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PaymentStatusModal, {
  type PaymentStepTiming,
} from "@/components/PaymentStatusModal";

function makeTimings(): Record<string, PaymentStepTiming> {
  const base = {
    startedAt: Date.now() - 5000,
    completedAt: Date.now() - 4000,
    error: null,
  };
  return {
    building: { ...base },
    signing: { ...base },
    submitting: { ...base },
    confirming: { ...base, completedAt: Date.now() - 1000 },
  } as unknown as Record<string, PaymentStepTiming>;
}

describe("PaymentStatusModal — Print receipt (#1045)", () => {
  let printSpy: jest.Mock;

  beforeEach(() => {
    printSpy = jest.fn();
    window.print = printSpy;
    Element.prototype.scrollIntoView = jest.fn();
  });

  const baseProps = {
    isOpen: true,
    txHash: "abc123def456",
    error: null as string | null,
    failedStep: null,
    stepTimings: makeTimings(),
    onClose: jest.fn(),
    explorerHref: "https://stellar.expert/explorer/testnet/tx/abc123def456",
  };

  it("shows the Print receipt button in the success state", () => {
    render(<PaymentStatusModal {...baseProps} status="success" />);

    expect(screen.getByTestId("print-receipt-button")).toBeInTheDocument();
    expect(screen.getByText("Print receipt")).toBeInTheDocument();
  });

  it("invokes window.print on click and marks the body for the print stylesheet", async () => {
    render(
      <PaymentStatusModal
        {...baseProps}
        status="success"
        receipt={{
          sender: "GSender",
          recipient: "GRecipient",
          amount: "12.5",
          asset: "XLM",
          memo: "rent",
          completedAt: new Date("2026-09-26T10:00:00Z").getTime(),
        }}
      />
    );

    fireEvent.click(screen.getByTestId("print-receipt-button"));
    expect(document.body.classList.contains("receipt-modal-printing")).toBe(
      true
    );

    await waitFor(() => {
      expect(printSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(document.body.classList.contains("receipt-modal-printing")).toBe(
        false
      );
    });
  });

  it("renders the receipt sheet with all required details", () => {
    render(
      <PaymentStatusModal
        {...baseProps}
        status="success"
        receipt={{
          sender: "GSender0001",
          recipient: "GRecipient0001",
          amount: "12.5",
          asset: "XLM",
          memo: "rent",
          completedAt: new Date("2026-09-26T10:00:00Z").getTime(),
        }}
      />
    );

    const sheet = screen.getByTestId("payment-receipt-sheet");
    expect(sheet).toHaveClass("receipt-modal-sheet");
    expect(sheet.textContent).toContain("GSender0001");
    expect(sheet.textContent).toContain("GRecipient0001");
    expect(sheet.textContent).toContain("12.5000000 XLM");
    expect(sheet.textContent).toContain("rent");
    expect(sheet.textContent).toContain("abc123def456");
    expect(sheet.textContent).toContain(baseProps.explorerHref!);
  });

  it("does not show the print button in non-success states", () => {
    render(<PaymentStatusModal {...baseProps} status="building" />);

    expect(screen.queryByTestId("print-receipt-button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-receipt-sheet")
    ).not.toBeInTheDocument();
  });
});
