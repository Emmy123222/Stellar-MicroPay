import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BubbleNotification } from "@/components/dashboard/BubbleNotification";

describe("BubbleNotification", () => {
  it("renders message when visible", () => {
    render(<BubbleNotification message="Payment received!" visible={true} />);
    expect(screen.getByText("Payment received!")).toBeInTheDocument();
  });

  it("does not render message when not visible", () => {
    const { container } = render(<BubbleNotification message="Payment received!" visible={false} />);
    expect(container.querySelector(".opacity-0")).toBeInTheDocument();
  });
});
