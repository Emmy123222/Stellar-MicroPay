import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import OnboardingTour from "@/components/OnboardingTour";

/**
 * Harness renders target elements the tour highlights plus a "launch point"
 * button. Toggling the launch point drives the tour's `isVisible` prop, which
 * mirrors how the dashboard orchestrates the tour.
 */
function Harness() {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setVisible(true)}>
        Show tour
      </button>
      <div className="balance-card">Balance</div>
      <div className="send-payment-form">Send form</div>
      <a href="/transactions">View Transactions</a>
      <OnboardingTour
        isVisible={visible}
        onComplete={() => setVisible(false)}
        onSkip={() => setVisible(false)}
      />
    </div>
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe("OnboardingTour — keyboard accessibility", () => {
  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the tour dialog and its controls when open", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Show tour" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Skip tour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("makes non-tour content inert while open and restores it on close", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    expect(container.hasAttribute("inert")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Show tour" }));

    // The tour is portaled straight to body, so the surrounding content —
    // including the harness container — should be made inert.
    await waitFor(() => expect(container).toHaveAttribute("inert"));

    // The portal itself must NOT be inert, otherwise the tour controls would
    // be unreachable.
    const portal = container.ownerDocument.getElementById("onboarding-tour-portal");
    expect(portal).not.toBeNull();
    expect((portal as HTMLElement).hasAttribute("inert")).toBe(false);

    // Closing via skip restores the background content.
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(container).not.toHaveAttribute("inert"));
  });

  it("traps focus within the tour controls", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Show tour" }));

    const dialog = screen.getByRole("dialog");
    const skip = screen.getByRole("button", { name: "Skip tour" });
    const next = screen.getByRole("button", { name: "Next" });

    // Initial focus lands on the tour dialog itself.
    await waitFor(() => expect(dialog).toHaveFocus());

    // Tab moves through the two controls.
    await user.tab();
    expect(skip).toHaveFocus();

    await user.tab();
    expect(next).toHaveFocus();

    // Tab past the last control wraps back to the first.
    await user.tab();
    expect(skip).toHaveFocus();

    // Shift+Tab from the first control wraps back to the last.
    await user.tab({ shift: true });
    expect(next).toHaveFocus();
  });

  it("restores focus to the launch point after skipping", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const launch = screen.getByRole("button", { name: "Show tour" });
    await user.click(launch);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(launch).toHaveFocus());
  });

  it("restores focus to the launch point after completing the tour", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const launch = screen.getByRole("button", { name: "Show tour" });
    await user.click(launch);

    const finish = await screen.findByRole("button", { name: "Next" });
    await user.click(finish);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(launch).toHaveFocus());
  });
});
