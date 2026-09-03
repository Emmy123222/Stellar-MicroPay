import React from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import "@testing-library/jest-dom";
import ExternalPaymentBanner from "@/components/ExternalPaymentBanner";

describe("ExternalPaymentBanner", () => {
  const onDismiss = jest.fn();

  beforeEach(() => {
    onDismiss.mockClear();
  });

  it("is visible when rendered (visible under the condition that triggers it)", () => {
    render(<ExternalPaymentBanner onDismiss={onDismiss} />);
    expect(screen.getByText(/Payment request from external app/i)).toBeInTheDocument();
  });

  it("renders the default message when no message prop is supplied", () => {
    render(<ExternalPaymentBanner onDismiss={onDismiss} />);
    expect(screen.getByText(/Send a payment using the pre-filled form below/i)).toBeInTheDocument();
  });

  it("renders a custom message when the message prop is provided", () => {
    render(<ExternalPaymentBanner message="Pay 5 XLM to charity.stellar" onDismiss={onDismiss} />);
    expect(screen.getByText("Pay 5 XLM to charity.stellar")).toBeInTheDocument();
  });

  it("shows the origin domain when the originDomain prop is provided", () => {
    render(<ExternalPaymentBanner originDomain="app.example.com" onDismiss={onDismiss} />);
    expect(screen.getByText("app.example.com")).toBeInTheDocument();
  });

  it("does not render an origin line when originDomain is omitted", () => {
    render(<ExternalPaymentBanner onDismiss={onDismiss} />);
    expect(screen.queryByText(/Origin:/i)).not.toBeInTheDocument();
  });

  it("calls onDismiss when the Dismiss button is clicked", async () => {
    const user = userEvent.setup();
    render(<ExternalPaymentBanner onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: /Dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("banner disappears after the parent acts on the dismiss callback", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [visible, setVisible] = React.useState(true);
      return visible ? (
        <ExternalPaymentBanner onDismiss={() => setVisible(false)} />
      ) : (
        <p>dismissed</p>
      );
    }

    render(<Harness />);
    expect(screen.getByText(/Payment request from external app/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Dismiss/i }));

    expect(screen.queryByText(/Payment request from external app/i)).not.toBeInTheDocument();
    expect(screen.getByText("dismissed")).toBeInTheDocument();
  });

  it("renders without crashing when only the required onDismiss prop is provided", () => {
    expect(() => render(<ExternalPaymentBanner onDismiss={onDismiss} />)).not.toThrow();
  });
});
