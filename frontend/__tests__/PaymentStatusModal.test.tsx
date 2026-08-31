import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PaymentStatusModal, {
  type PaymentFlowStatus,
  type PaymentStepId,
  type PaymentStepTiming,
} from "@/components/PaymentStatusModal";

const defaultStepTimings: Record<PaymentStepId, PaymentStepTiming> = {
  building: { startedAt: null, completedAt: null, error: null },
  signing: { startedAt: null, completedAt: null, error: null },
  submitting: { startedAt: null, completedAt: null, error: null },
  confirming: { startedAt: null, completedAt: null, error: null },
};

function ModalHarness({
  status,
  txHash = null,
  error = null,
  failedStep = null,
  stepTimings = defaultStepTimings,
  explorerHref = null,
}: {
  status: PaymentFlowStatus;
  txHash?: string | null;
  error?: string | null;
  failedStep?: PaymentStepId | null;
  stepTimings?: Record<PaymentStepId, PaymentStepTiming>;
  explorerHref?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open modal
      </button>
      <PaymentStatusModal
        isOpen={isOpen}
        status={currentStatus}
        txHash={txHash}
        error={error}
        failedStep={failedStep}
        stepTimings={stepTimings}
        onClose={() => setIsOpen(false)}
        explorerHref={explorerHref}
      />
    </div>
  );
}

describe("PaymentStatusModal", () => {
  describe("pending states", () => {
    it("renders building state correctly", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="building" />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Processing payment")).toBeInTheDocument();
      expect(screen.getByText("Building")).toBeInTheDocument();
      expect(screen.getByText("In progress")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    });

    it("renders signing state correctly", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 1000, completedAt: Date.now() - 500, error: null },
      };
      render(<ModalHarness status="signing" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Processing payment")).toBeInTheDocument();
      expect(screen.getByText("Signing")).toBeInTheDocument();
      expect(screen.getByText("In progress")).toBeInTheDocument();
      expect(screen.getByText("Building")).toBeInTheDocument();
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });

    it("renders submitting state correctly", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 2000, completedAt: Date.now() - 1500, error: null },
        signing: { startedAt: Date.now() - 1500, completedAt: Date.now() - 1000, error: null },
      };
      render(<ModalHarness status="submitting" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Processing payment")).toBeInTheDocument();
      expect(screen.getByText("Submitting")).toBeInTheDocument();
      expect(screen.getByText("In progress")).toBeInTheDocument();
    });

    it("renders confirming state correctly", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 3000, completedAt: Date.now() - 2500, error: null },
        signing: { startedAt: Date.now() - 2500, completedAt: Date.now() - 2000, error: null },
        submitting: { startedAt: Date.now() - 2000, completedAt: Date.now() - 1500, error: null },
      };
      render(<ModalHarness status="confirming" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Processing payment")).toBeInTheDocument();
      expect(screen.getByText("Confirming")).toBeInTheDocument();
      expect(screen.getByText("In progress")).toBeInTheDocument();
    });
  });

  describe("success state", () => {
    it("renders success state correctly", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 4000, completedAt: Date.now() - 3500, error: null },
        signing: { startedAt: Date.now() - 3500, completedAt: Date.now() - 3000, error: null },
        submitting: { startedAt: Date.now() - 3000, completedAt: Date.now() - 2500, error: null },
        confirming: { startedAt: Date.now() - 2500, completedAt: Date.now() - 2000, error: null },
      };
      render(
        <ModalHarness
          status="success"
          txHash="ABC123DEF456"
          explorerHref="https://stellar.expert/tx/ABC123DEF456"
          stepTimings={stepTimings}
        />
      );

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Complete")).toBeInTheDocument();
      expect(
        screen.getByText("Your transaction has been confirmed on the Stellar network.")
      ).toBeInTheDocument();
      expect(screen.getByText("Transaction confirmed")).toBeInTheDocument();
      expect(screen.getByText("ABC123DEF456")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /View on Stellar Expert/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("shows all steps as completed in success state", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 4000, completedAt: Date.now() - 3500, error: null },
        signing: { startedAt: Date.now() - 3500, completedAt: Date.now() - 3000, error: null },
        submitting: { startedAt: Date.now() - 3000, completedAt: Date.now() - 2500, error: null },
        confirming: { startedAt: Date.now() - 2500, completedAt: Date.now() - 2000, error: null },
      };
      render(<ModalHarness status="success" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      const completedCaptions = screen.getAllByText("Completed");
      expect(completedCaptions).toHaveLength(4);
    });
  });

  describe("failed state", () => {
    it("renders failed state with step error", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 1000, completedAt: null, error: "Network error" },
      };
      render(
        <ModalHarness
          status="error"
          failedStep="building"
          error="Transaction failed"
          stepTimings={stepTimings}
        />
      );

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Payment failed")).toBeInTheDocument();
      expect(screen.getByText("The transaction stopped before completion.")).toBeInTheDocument();
      expect(screen.getByText("Network error")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    it("renders failed state with general error", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="error" error="Insufficient funds" failedStep={null} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Payment failed")).toBeInTheDocument();
      expect(screen.getByText("Insufficient funds")).toBeInTheDocument();
    });

    it("shows failed step with error message", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 1000, completedAt: Date.now() - 500, error: null },
        signing: { startedAt: Date.now() - 500, completedAt: null, error: "User rejected signing" },
      };
      render(<ModalHarness status="error" failedStep="signing" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Signing")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("User rejected signing")).toBeInTheDocument();
    });
  });

  describe("close functionality", () => {
    it("closes on close button click in success state", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      const openButton = screen.getByRole("button", { name: "Open modal" });
      await user.click(openButton);

      const closeButton = screen.getByRole("button", { name: "Close" });
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText("Complete")).not.toBeInTheDocument();
      });
    });

    it("closes on close button click in error state", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="error" error="Failed" />);

      const openButton = screen.getByRole("button", { name: "Open modal" });
      await user.click(openButton);

      const closeButton = screen.getByRole("button", { name: "Close" });
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText("Payment failed")).not.toBeInTheDocument();
      });
    });

    it("closes on Escape key in terminal states", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      const openButton = screen.getByRole("button", { name: "Open modal" });
      await user.click(openButton);

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByText("Complete")).not.toBeInTheDocument();
      });
    });

    it("does not show close button in pending states", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="building" />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    });
  });

  describe("state transitions", () => {
    it("transitions from building to signing", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 1000, completedAt: Date.now() - 500, error: null },
      };
      render(<ModalHarness status="signing" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Building")).toBeInTheDocument();
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.getByText("Signing")).toBeInTheDocument();
      expect(screen.getByText("In progress")).toBeInTheDocument();
    });

    it("transitions from signing to submitting", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 2000, completedAt: Date.now() - 1500, error: null },
        signing: { startedAt: Date.now() - 1500, completedAt: Date.now() - 1000, error: null },
      };
      render(<ModalHarness status="submitting" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Building")).toBeInTheDocument();
      expect(screen.getByText("Signing")).toBeInTheDocument();
      expect(screen.getByText("Submitting")).toBeInTheDocument();
      expect(screen.getByText("In progress")).toBeInTheDocument();
    });

    it("transitions from submitting to confirming", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 3000, completedAt: Date.now() - 2500, error: null },
        signing: { startedAt: Date.now() - 2500, completedAt: Date.now() - 2000, error: null },
        submitting: { startedAt: Date.now() - 2000, completedAt: Date.now() - 1500, error: null },
      };
      render(<ModalHarness status="confirming" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Confirming")).toBeInTheDocument();
      expect(screen.getByText("In progress")).toBeInTheDocument();
    });

    it("transitions from confirming to success", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 4000, completedAt: Date.now() - 3500, error: null },
        signing: { startedAt: Date.now() - 3500, completedAt: Date.now() - 3000, error: null },
        submitting: { startedAt: Date.now() - 3000, completedAt: Date.now() - 2500, error: null },
        confirming: { startedAt: Date.now() - 2500, completedAt: Date.now() - 2000, error: null },
      };
      render(<ModalHarness status="success" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Complete")).toBeInTheDocument();
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("transitions from any step to error", async () => {
      const user = userEvent.setup();
      const stepTimings = {
        ...defaultStepTimings,
        building: { startedAt: Date.now() - 1000, completedAt: null, error: "Timeout" },
        signing: { startedAt: null, completedAt: null, error: null },
        submitting: { startedAt: null, completedAt: null, error: null },
        confirming: { startedAt: null, completedAt: null, error: null },
      };
      render(<ModalHarness status="error" failedStep="building" stepTimings={stepTimings} />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      expect(screen.getByText("Payment failed")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Timeout")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("renders with proper ARIA attributes", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="building" />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "payment-status-title");
    });

    it("has proper heading for screen readers", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));

      const title = screen.getByRole("heading", { level: 3 });
      expect(title).toHaveAttribute("id", "payment-status-title");
    });
  });

  describe("focus trap & focus-return (#597)", () => {
    it("moves focus into the modal when it opens", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));
      const dialog = await screen.findByRole("dialog");

      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
    });

    it("Tab key keeps focus inside the modal while it is open", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));
      const dialog = await screen.findByRole("dialog");

      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });

      // Tab once — should still be inside the modal
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);

      // Tab again — still inside
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("Shift+Tab also keeps focus inside the modal", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      await user.click(screen.getByRole("button", { name: "Open modal" }));
      const dialog = await screen.findByRole("dialog");

      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });

      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("returns focus to the opener button after the modal closes via Escape", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      const opener = screen.getByRole("button", { name: "Open modal" });
      await user.click(opener);

      await screen.findByRole("dialog");

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(opener).toHaveFocus();
      });
    });

    it("returns focus to the opener button after the modal closes via Close button", async () => {
      const user = userEvent.setup();
      render(<ModalHarness status="success" />);

      const opener = screen.getByRole("button", { name: "Open modal" });
      await user.click(opener);

      await screen.findByRole("dialog");
      const closeBtn = screen.getByRole("button", { name: /^Close$/i });
      await user.click(closeBtn);

      await waitFor(() => {
        expect(opener).toHaveFocus();
      });
    });
  });
});
